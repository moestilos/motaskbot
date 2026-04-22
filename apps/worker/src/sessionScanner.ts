import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { MoTaskBotClient } from '@motaskbot/shared/supabase';
import { createLogger } from './logger.js';

const log = createLogger('scanner');

const PROJECTS_ROOT = join(homedir(), '.claude', 'projects');

interface SessionInfo {
  session_id: string;
  project_dir: string;
  project_label: string;
  preview: string | null;
  message_count: number;
  last_activity_at: string;
}

// Claude Code encodes project paths as folder names like
// "C--Users-gmate-Desktop-Workflow-MoePDF". Best-effort decode.
function decodeProjectFolder(name: string): string {
  // Replace leading "C--" with "C:\" and remaining "-" with "\"
  const driveMatch = name.match(/^([A-Za-z])--/);
  if (driveMatch) {
    return driveMatch[1] + ':\\' + name.slice(3).replace(/-/g, '\\');
  }
  return name.replace(/-/g, '/');
}

function labelFromPath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  // If inside a .claude/worktrees/* subtree, use repo name (folder before .claude)
  const claudeIdx = parts.indexOf('.claude');
  if (claudeIdx > 0 && parts[claudeIdx + 1] === 'worktrees') {
    return parts[claudeIdx - 1];
  }
  return parts[parts.length - 1] ?? path;
}

async function parseSessionFile(filePath: string, project_dir: string): Promise<SessionInfo | null> {
  try {
    const raw = await readFile(filePath, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length === 0) return null;

    let session_id: string | null = null;
    let firstUserMsg: string | null = null;
    let last_ts: string | null = null;
    let msg_count = 0;
    let realCwd: string | null = null;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (!session_id && entry.sessionId) session_id = entry.sessionId;
        if (!realCwd && typeof entry.cwd === 'string') realCwd = entry.cwd;
        if (entry.timestamp) last_ts = entry.timestamp;
        if (entry.type === 'user' || entry.type === 'assistant') msg_count++;
        if (!firstUserMsg && entry.type === 'user' && entry.message?.content) {
          const content = entry.message.content;
          if (typeof content === 'string') firstUserMsg = content;
          else if (Array.isArray(content)) {
            const text = content.find((c: any) => c.type === 'text');
            if (text?.text) firstUserMsg = text.text;
          }
        }
      } catch {}
    }
    const finalDir = realCwd ?? project_dir;

    if (!session_id) {
      // Fallback: session_id = filename without .jsonl
      const base = filePath.split(/[\\/]/).pop()!;
      session_id = base.replace(/\.jsonl$/, '');
    }

    const stats = await stat(filePath);
    return {
      session_id,
      project_dir: finalDir,
      project_label: labelFromPath(finalDir),
      preview: firstUserMsg?.slice(0, 200) ?? null,
      message_count: msg_count,
      last_activity_at: last_ts ?? stats.mtime.toISOString(),
    };
  } catch (e) {
    log.warn(`parse failed ${filePath}`, (e as Error).message);
    return null;
  }
}

export async function scanSessions(sb: MoTaskBotClient): Promise<number> {
  let projectFolders: string[];
  try {
    projectFolders = await readdir(PROJECTS_ROOT);
  } catch (e) {
    log.warn(`Cannot read ${PROJECTS_ROOT}: ${(e as Error).message}`);
    return 0;
  }

  const sessions: SessionInfo[] = [];

  for (const folder of projectFolders) {
    const folderPath = join(PROJECTS_ROOT, folder);
    const project_dir = decodeProjectFolder(folder);
    let files: string[];
    try {
      files = await readdir(folderPath);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const info = await parseSessionFile(join(folderPath, f), project_dir);
      if (info) sessions.push(info);
    }
  }

  if (sessions.length === 0) {
    log.info('no sessions found');
    return 0;
  }

  const { error } = await sb.from('claude_sessions').upsert(
    sessions.map((s) => ({ ...s, discovered_at: new Date().toISOString() })),
    { onConflict: 'session_id' },
  );
  if (error) {
    log.error('upsert sessions failed', error.message);
    return 0;
  }

  await syncProjectsAndChats(sb, sessions);

  log.info(`synced ${sessions.length} claude sessions`);
  return sessions.length;
}

async function syncProjectsAndChats(sb: MoTaskBotClient, sessions: SessionInfo[]) {
  // 1. Unique project_dirs → upsert project rows (source='claude_code')
  const uniqueDirs = new Map<string, string>(); // dir → label
  for (const s of sessions) uniqueDirs.set(s.project_dir, s.project_label);

  const projectRows = Array.from(uniqueDirs.entries()).map(([dir, label]) => ({
    name: label,
    working_dir: dir,
    source: 'claude_code' as const,
  }));

  if (projectRows.length > 0) {
    const { error } = await sb
      .from('projects')
      .upsert(projectRows, { onConflict: 'working_dir', ignoreDuplicates: false });
    if (error) {
      log.warn(`project upsert failed: ${error.message}`);
      return;
    }
  }

  // 2. Load back project ids by working_dir
  const dirs = Array.from(uniqueDirs.keys());
  const { data: projects, error: pErr } = await sb
    .from('projects')
    .select('id, working_dir')
    .in('working_dir', dirs);
  if (pErr || !projects) {
    log.warn(`project reload failed: ${pErr?.message}`);
    return;
  }
  const dirToProjectId = new Map(projects.map((p) => [p.working_dir!, p.id]));

  // 3. Upsert one chat per session (keyed on claude_session_id)
  const chatRows = sessions
    .map((s) => {
      const project_id = dirToProjectId.get(s.project_dir);
      if (!project_id) return null;
      const name =
        s.preview && s.preview.length > 0
          ? s.preview.split(/\s+/).slice(0, 6).join(' ').slice(0, 50)
          : `session ${s.session_id.slice(0, 6)}`;
      return {
        project_id,
        name,
        working_dir: s.project_dir,
        claude_session_id: s.session_id,
        context: [] as unknown[],
      };
    })
    .filter(Boolean) as any[];

  if (chatRows.length > 0) {
    const { error } = await sb
      .from('chats')
      .upsert(chatRows, { onConflict: 'claude_session_id', ignoreDuplicates: true });
    if (error) log.warn(`chat upsert failed: ${error.message}`);
  }
}

export function startSessionScanner(sb: MoTaskBotClient, intervalMs = 30_000) {
  scanSessions(sb).catch((e) => log.error('initial scan failed', (e as Error).message));
  setInterval(() => {
    scanSessions(sb).catch((e) => log.error('scan failed', (e as Error).message));
  }, intervalMs);
}
