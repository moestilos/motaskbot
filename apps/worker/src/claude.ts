import { spawn, execSync } from 'node:child_process';
import type { Task, ChatContextMessage } from '@motaskbot/shared/types';
import { createLogger } from './logger.js';

const log = createLogger('claude');

export interface ClaudeConfig {
  cliPath?: string;
}

export interface ExecuteOptions {
  workingDir?: string | null;
  sessionId?: string | null;
  model?: string | null;
  chatMode?: boolean; // no tools, no autoheal, no session-resume
}

export interface ExecuteResult {
  output: string;
  sessionId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalCostUsd: number | null;
  durationMs: number | null;
}

export async function executeTaskWithClaude(
  task: Task,
  context: ChatContextMessage[],
  config: ClaudeConfig,
  opts: ExecuteOptions = {},
): Promise<ExecuteResult> {
  // Subscription-only: always route through Claude Code CLI. No Anthropic API.
  return executeViaCli(task, context, config.cliPath ?? 'claude', opts);
}

function buildContextBlock(context: ChatContextMessage[]): string {
  if (context.length === 0) return '';
  const lines = context.map((m) => {
    const who = m.role === 'user' ? 'USER' : m.role === 'assistant' ? 'ASSISTANT' : 'SYSTEM';
    return `[${who}] ${m.content}`;
  });
  return `Previous conversation in this chat:\n\n${lines.join('\n\n')}\n\n---\n\n`;
}

function resolveCliPath(cliPath: string): string {
  if (cliPath.includes('/') || cliPath.includes('\\')) return cliPath;
  try {
    const cmd = process.platform === 'win32' ? `where ${cliPath}` : `which ${cliPath}`;
    const out = execSync(cmd, { encoding: 'utf8' }).split(/\r?\n/).find(Boolean);
    if (out) return out.trim();
  } catch {}
  return cliPath;
}

function executeViaCli(
  task: Task,
  context: ChatContextMessage[],
  cliPath: string,
  opts: ExecuteOptions,
): Promise<ExecuteResult> {
  const resolved = resolveCliPath(cliPath);
  log.info(
    `task ${task.id} via CLI (${resolved}) cwd=${opts.workingDir ?? '(default)'} resume=${opts.sessionId ?? '(new)'}`,
  );

  // Chat mode = pure Q&A, no tools, no session resume.
  // Task mode w/ session = CC manages context. Task mode w/o session = seed context manually.
  const prompt = opts.chatMode
    ? (buildContextBlock(context) + task.instructions)
    : opts.sessionId
      ? `Task: ${task.title}\n\nInstructions:\n${task.instructions}`
      : buildContextBlock(context) +
        `Task: ${task.title}\n\nInstructions:\n${task.instructions}\n\nComplete this task and return the result only.`;

  const model = opts.model || process.env.CLAUDE_MODEL || 'haiku';
  const args = ['-p', prompt, '--model', model, '--output-format', 'json'];

  if (opts.chatMode) {
    args.push('--disallowed-tools', 'Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,NotebookEdit,TodoWrite');
  } else {
    if (opts.sessionId) args.push('--resume', opts.sessionId);
    if (process.env.CLAUDE_SAFE !== '1') args.push('--dangerously-skip-permissions');
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(resolved, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
      cwd: opts.workingDir || undefined,
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', (err) => reject(new Error(`Failed to spawn Claude CLI: ${err.message}`)));
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`Claude CLI exit ${code}: ${stderr || stdout}`));
      const trimmed = stdout.trim();
      if (!trimmed) return reject(new Error('Empty output from Claude CLI'));
      let output = trimmed;
      let sessionId: string | null = null;
      let inputTokens: number | null = null;
      let outputTokens: number | null = null;
      let totalCostUsd: number | null = null;
      let durationMs: number | null = null;
      try {
        const json = JSON.parse(trimmed);
        output = json.result ?? json.response ?? json.text ?? trimmed;
        sessionId = json.session_id ?? json.sessionId ?? null;
        const u = json.usage ?? {};
        inputTokens = u.input_tokens ?? null;
        outputTokens = u.output_tokens ?? null;
        totalCostUsd = json.total_cost_usd ?? null;
        durationMs = json.duration_ms ?? null;
      } catch {}
      resolve({ output, sessionId, inputTokens, outputTokens, totalCostUsd, durationMs });
    });
  });
}
