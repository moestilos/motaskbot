import { spawnSync } from 'node:child_process';
import { createLogger } from './logger.js';

const log = createLogger('autoPush');

interface PushResult {
  pushed: boolean;
  commit?: string;
  skipped?: string;
  error?: string;
}

function run(cwd: string, args: string[]): { stdout: string; stderr: string; code: number } {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false });
  return {
    stdout: (res.stdout || '').trim(),
    stderr: (res.stderr || '').trim(),
    code: res.status ?? -1,
  };
}

export async function autoPushIfDirty(workingDir: string, taskTitle: string, taskId: string): Promise<PushResult> {
  try {
    // Is git repo?
    const topLevel = run(workingDir, ['rev-parse', '--show-toplevel']);
    if (topLevel.code !== 0) {
      return { pushed: false, skipped: 'not a git repo' };
    }

    // Anything to commit?
    const status = run(workingDir, ['status', '--porcelain']);
    if (status.code !== 0) {
      return { pushed: false, error: `git status failed: ${status.stderr}` };
    }
    if (!status.stdout) {
      return { pushed: false, skipped: 'working tree clean' };
    }

    // Upstream tracking set?
    const upstream = run(workingDir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    if (upstream.code !== 0) {
      return { pushed: false, skipped: 'no upstream branch tracking set' };
    }

    // Stage + commit
    const add = run(workingDir, ['add', '-A']);
    if (add.code !== 0) return { pushed: false, error: `git add failed: ${add.stderr}` };

    const msg = `motaskbot: ${taskTitle.slice(0, 60)}\n\nAutomated commit from MoTaskBot task ${taskId}`;
    const commit = run(workingDir, ['commit', '-m', msg]);
    if (commit.code !== 0) {
      return { pushed: false, error: `git commit failed: ${commit.stderr || commit.stdout}` };
    }

    const sha = run(workingDir, ['rev-parse', '--short', 'HEAD']).stdout;

    // Push
    const push = run(workingDir, ['push']);
    if (push.code !== 0) {
      return { pushed: false, commit: sha, error: `git push failed: ${push.stderr}` };
    }

    log.info(`auto-push ${sha} → ${upstream.stdout}`);
    return { pushed: true, commit: sha };
  } catch (e) {
    return { pushed: false, error: (e as Error).message };
  }
}
