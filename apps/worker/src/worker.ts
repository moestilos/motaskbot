import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../../../.env') });
loadEnv(); // also load local .env if present (no override)
import { createServerClient, type MoTaskBotClient } from '@motaskbot/shared/supabase';
import type { Task, Chat, ChatContextMessage } from '@motaskbot/shared/types';
import { executeTaskWithClaude } from './claude.js';
import { startSessionScanner } from './sessionScanner.js';
import { pickVerifyCommand, runVerify } from './verify.js';
import { createLogger } from './logger.js';

const log = createLogger('worker');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || undefined;
const CLAUDE_CLI = process.env.CLAUDE_CLI || 'claude';
const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5000);
const MOTASKBOT_EMAIL = process.env.MOTASKBOT_EMAIL;
const MOTASKBOT_PASSWORD = process.env.MOTASKBOT_PASSWORD;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  log.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env');
  process.exit(1);
}

const sb: MoTaskBotClient = createServerClient(SUPABASE_URL, SUPABASE_KEY);

async function ensureAuth() {
  if (!MOTASKBOT_EMAIL || !MOTASKBOT_PASSWORD) {
    log.warn('MOTASKBOT_EMAIL/PASSWORD not set — worker will rely on raw key (may fail if RLS locked)');
    return;
  }
  const { data, error } = await sb.auth.signInWithPassword({
    email: MOTASKBOT_EMAIL,
    password: MOTASKBOT_PASSWORD,
  });
  if (error || !data.session) {
    log.error('worker sign-in failed', error?.message ?? 'no session');
    process.exit(1);
  }
  log.info(`worker authenticated as ${MOTASKBOT_EMAIL}`);
}

const claudeConfig = { apiKey: ANTHROPIC_API_KEY, cliPath: CLAUDE_CLI };
log.info('claude backend', ANTHROPIC_API_KEY ? 'Anthropic API' : `CLI (${CLAUDE_CLI})`);

// In-flight guard to avoid double-processing
const inFlight = new Set<string>();

async function claimTask(taskId: string): Promise<Task | null> {
  // Atomic claim: set status to 'running' only if currently 'pending'
  const { data, error } = await sb
    .from('tasks')
    .update({ status: 'running' })
    .eq('id', taskId)
    .eq('status', 'pending')
    .select()
    .single();
  if (error) {
    if (error.code === 'PGRST116') return null; // no row (already claimed)
    log.warn(`claim failed for ${taskId}`, error.message);
    return null;
  }
  return data;
}

async function getChat(chatId: string): Promise<Chat | null> {
  const { data, error } = await sb.from('chats').select('*').eq('id', chatId).single();
  if (error) {
    log.error(`fetch chat ${chatId} failed`, error.message);
    return null;
  }
  return data;
}

async function completeTask(
  task: Task,
  result: string,
  newContext: ChatContextMessage[],
  newSessionId: string | null,
  prevSessionId: string | null,
  usage: { inputTokens: number | null; outputTokens: number | null; totalCostUsd: number | null; durationMs: number | null },
) {
  const chatUpdate: Record<string, unknown> = { context: newContext };
  if (newSessionId && newSessionId !== prevSessionId) chatUpdate.claude_session_id = newSessionId;
  const [tUpd, cUpd] = await Promise.all([
    sb.from('tasks').update({
      status: 'completed',
      result,
      error: null,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      total_cost_usd: usage.totalCostUsd,
      duration_ms: usage.durationMs,
    } as any).eq('id', task.id),
    sb.from('chats').update(chatUpdate).eq('id', task.chat_id),
  ]);
  if (tUpd.error) log.error(`update task ${task.id} failed`, tUpd.error.message);
  if (cUpd.error) log.error(`update chat ${task.chat_id} failed`, cUpd.error.message);
}

async function failTask(task: Task, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  await sb.from('tasks').update({ status: 'failed', error: message }).eq('id', task.id);
}

async function processTask(taskId: string) {
  if (inFlight.has(taskId)) return;
  inFlight.add(taskId);
  try {
    const task = await claimTask(taskId);
    if (!task) return; // already claimed by someone
    log.info(`▶ running task ${task.id}: ${task.title}`);

    const chat = await getChat(task.chat_id);
    if (!chat) throw new Error('Chat not found');

    const isChat = (task as any).kind === 'chat';
    let { output, sessionId, inputTokens, outputTokens, totalCostUsd, durationMs } =
      await executeTaskWithClaude(task, chat.context ?? [], claudeConfig, {
        workingDir: isChat ? null : chat.working_dir,
        sessionId: isChat ? null : chat.claude_session_id,
        model: (task as any).model ?? undefined,
        chatMode: isChat,
      });

    // ---- Autoheal: verify build + ask Claude to fix on failure ----
    const AUTOHEAL_ENABLED = !isChat && process.env.AUTOHEAL !== '0';
    const MAX_HEAL_ATTEMPTS = Number(process.env.AUTOHEAL_MAX_ATTEMPTS ?? 2);
    let healLog = '';
    if (AUTOHEAL_ENABLED && chat.working_dir) {
      const verifyCmd = await pickVerifyCommand(chat.working_dir);
      if (verifyCmd) {
        for (let attempt = 1; attempt <= MAX_HEAL_ATTEMPTS; attempt++) {
          const v = await runVerify(verifyCmd, chat.working_dir);
          if (v.ok) {
            healLog += `\n\n[autoheal] ✓ ${v.command} passed (attempt ${attempt}/${MAX_HEAL_ATTEMPTS})`;
            log.info(`autoheal ok after ${attempt} attempt(s)`);
            break;
          }
          healLog += `\n\n[autoheal] ✗ ${v.command} failed (attempt ${attempt}/${MAX_HEAL_ATTEMPTS}, exit ${v.exitCode})`;
          log.warn(`autoheal attempt ${attempt} failed — asking Claude to fix`);
          if (attempt === MAX_HEAL_ATTEMPTS) {
            healLog += `\nGave up after ${MAX_HEAL_ATTEMPTS} attempts. Output:\n${v.output.slice(-2000)}`;
            break;
          }
          const fixPrompt = `Previous change broke the build.\n\nCommand: ${v.command}\nExit code: ${v.exitCode}\nOutput (last 2000 chars):\n\n${v.output.slice(-2000)}\n\nFix this. Do not explain — just edit the files.`;
          const fixRes = await executeTaskWithClaude(
            { ...task, instructions: fixPrompt, title: `autoheal: ${task.title}` },
            [],
            claudeConfig,
            { workingDir: chat.working_dir, sessionId: sessionId ?? chat.claude_session_id },
          );
          output += `\n\n--- Autoheal attempt ${attempt} ---\n${fixRes.output}`;
          if (fixRes.sessionId) sessionId = fixRes.sessionId;
        }
      }
    }

    const now = new Date().toISOString();
    const newContext: ChatContextMessage[] = [
      ...(chat.context ?? []),
      { role: 'user', content: `[Task: ${task.title}]\n${task.instructions}`, task_id: task.id, at: now },
      { role: 'assistant', content: output + healLog, task_id: task.id, at: now },
    ];
    await completeTask(task, output + healLog, newContext, sessionId, chat.claude_session_id, {
      inputTokens, outputTokens, totalCostUsd, durationMs,
    });
    log.info(`✓ completed task ${task.id}${sessionId ? ` (session ${sessionId.slice(0, 8)})` : ''}`);
  } catch (err) {
    log.error(`✗ task ${taskId} failed`, (err as Error).message);
    const { data: t } = await sb.from('tasks').select('*').eq('id', taskId).single();
    if (t) await failTask(t, err);
  } finally {
    inFlight.delete(taskId);
  }
}

async function drainPending() {
  const { data, error } = await sb
    .from('tasks')
    .select('id')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) {
    log.error('drain query failed', error.message);
    return;
  }
  if (!data?.length) return;
  log.info(`draining ${data.length} pending tasks`);
  for (const row of data) await processTask(row.id);
}

function subscribe() {
  const ch = sb
    .channel('worker-tasks')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tasks' }, (payload) => {
      const t = payload.new as Task;
      if (t.status === 'pending') {
        log.info(`→ new pending task received: ${t.id}`);
        processTask(t.id).catch((e) => log.error('processTask error', (e as Error).message));
      }
    })
    .subscribe((status) => log.info(`realtime status: ${status}`));
  return ch;
}

async function main() {
  log.info('starting MoTaskBot worker', { url: SUPABASE_URL });
  await ensureAuth();
  startSessionScanner(sb, 30_000);
  await drainPending();
  subscribe();
  // Safety net poll in case realtime drops
  setInterval(() => {
    drainPending().catch((e) => log.error('poll error', (e as Error).message));
  }, POLL_INTERVAL_MS);
  log.info(`worker online. Realtime + ${POLL_INTERVAL_MS}ms poll fallback.`);
}

main().catch((e) => {
  log.error('fatal', (e as Error).message);
  process.exit(1);
});

process.on('SIGINT', () => {
  log.info('shutting down');
  process.exit(0);
});
