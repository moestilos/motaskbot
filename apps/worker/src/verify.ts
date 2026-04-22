import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from './logger.js';

const log = createLogger('verify');

export interface VerifyResult {
  ok: boolean;
  command: string;
  exitCode: number;
  output: string;
}

/**
 * Pick a verification command for a working directory.
 * Priority: package.json "scripts.build" → "scripts.typecheck" → "scripts.check" → null.
 * Returns null if no verify step applies (e.g. non-JS project or no scripts).
 */
export async function pickVerifyCommand(cwd: string | null | undefined): Promise<string[] | null> {
  if (!cwd) return null;
  try {
    const pkgRaw = await readFile(join(cwd, 'package.json'), 'utf8');
    const pkg = JSON.parse(pkgRaw);
    const scripts = pkg.scripts || {};
    const pm = await detectPM(cwd);
    for (const name of ['build', 'typecheck', 'check', 'lint']) {
      if (scripts[name]) return [pm, 'run', name];
    }
  } catch {}
  return null;
}

async function detectPM(cwd: string): Promise<string> {
  try {
    await readFile(join(cwd, 'pnpm-lock.yaml'), 'utf8');
    return 'pnpm';
  } catch {}
  try {
    await readFile(join(cwd, 'yarn.lock'), 'utf8');
    return 'yarn';
  } catch {}
  try {
    await readFile(join(cwd, 'bun.lockb'), 'utf8');
    return 'bun';
  } catch {}
  return 'npm';
}

export function runVerify(cmd: string[], cwd: string, timeoutMs = 180_000): Promise<VerifyResult> {
  const command = cmd.join(' ');
  log.info(`running verify: ${command} (cwd=${cwd})`);
  return new Promise((resolve) => {
    const proc = spawn(cmd[0], cmd.slice(1), {
      cwd,
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    let output = '';
    const onData = (d: Buffer) => {
      output += d.toString();
      if (output.length > 32_000) output = output.slice(-32_000); // cap
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);

    const killTimer = setTimeout(() => {
      log.warn(`verify timeout after ${timeoutMs}ms, killing`);
      proc.kill();
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(killTimer);
      resolve({ ok: code === 0, command, exitCode: code ?? -1, output: output.trim() });
    });
    proc.on('error', (err) => {
      clearTimeout(killTimer);
      resolve({ ok: false, command, exitCode: -1, output: `spawn error: ${err.message}` });
    });
  });
}
