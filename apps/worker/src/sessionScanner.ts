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
  log.info(`synced ${sessions.length} claude sessions`);
  return sessions.length;
}

export function startSessionScanner(sb: MoTaskBotClient, intervalMs = 30_000) {
  scanSessions(sb).catch((e) => log.error('initial scan failed', (e as Error).message));
  setInterval(() => {
    scanSessions(sb).catch((e) => log.error('scan failed', (e as Error).message));
  }, intervalMs);
}
