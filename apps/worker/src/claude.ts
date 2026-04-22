import { spawn, execSync } from 'node:child_process';
import Anthropic from '@anthropic-ai/sdk';
import type { Task, ChatContextMessage } from '@motaskbot/shared/types';
import { createLogger } from './logger.js';

const log = createLogger('claude');

export interface ClaudeConfig {
  apiKey?: string;
  cliPath?: string;
}

export async function executeTaskWithClaude(
  task: Task,
  context: ChatContextMessage[],
  config: ClaudeConfig,
): Promise<string> {
  if (config.apiKey) return executeViaApi(task, context, config.apiKey);
  return executeViaCli(task, context, config.cliPath ?? 'claude');
}

function buildContextBlock(context: ChatContextMessage[]): string {
  if (context.length === 0) return '';
  const lines = context.map((m) => {
    const who = m.role === 'user' ? 'USER' : m.role === 'assistant' ? 'ASSISTANT' : 'SYSTEM';
    return `[${who}] ${m.content}`;
  });
  return `Previous conversation in this chat:\n\n${lines.join('\n\n')}\n\n---\n\n`;
}

// ---- Option A: Anthropic API ----
async function executeViaApi(task: Task, context: ChatContextMessage[], apiKey: string): Promise<string> {
  log.info(`executing task ${task.id} via Anthropic API`);
  const client = new Anthropic({ apiKey });

  const messages: Anthropic.MessageParam[] = [];
  for (const m of context) {
    if (m.role === 'user' || m.role === 'assistant') {
      messages.push({ role: m.role, content: m.content });
    }
  }
  messages.push({
    role: 'user',
    content: `Task: ${task.title}\n\nInstructions:\n${task.instructions}`,
  });

  const res = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system:
      'You are an AI task executor inside MoTaskBot. Complete the user task using the conversation context. Return a clear, actionable response.',
    messages,
  });

  const out = res.content
    .map((c) => (c.type === 'text' ? c.text : ''))
    .join('\n')
    .trim();
  if (!out) throw new Error('Empty response from Anthropic API');
  return out;
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

// ---- Option B: Claude Code CLI subprocess ----
function executeViaCli(task: Task, context: ChatContextMessage[], cliPath: string): Promise<string> {
  const resolved = resolveCliPath(cliPath);
  log.info(`executing task ${task.id} via Claude CLI (${resolved})`);
  const prompt =
    buildContextBlock(context) +
    `Task: ${task.title}\n\nInstructions:\n${task.instructions}\n\nComplete this task and return the result only.`;

  return new Promise((resolve, reject) => {
    const model = process.env.CLAUDE_MODEL || 'haiku';
    const proc = spawn(resolved, ['-p', prompt, '--model', model, '--output-format', 'text'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', (err) => reject(new Error(`Failed to spawn Claude CLI: ${err.message}`)));
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`Claude CLI exit ${code}: ${stderr || stdout}`));
      const out = stdout.trim();
      if (!out) return reject(new Error('Empty output from Claude CLI'));
      resolve(out);
    });
  });
}
