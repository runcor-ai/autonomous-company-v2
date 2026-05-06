// git_push (T064) — commit a file to the agent's public thoughts repo.
//
// Per contracts/mcp-local-tools.md. Idempotent on path+content (a second call with identical
// inputs is a no-op git commit because git skips empty diffs).

import { execFile } from 'node:child_process';
import { mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import type { LocalToolFactory } from '../types.js';
import { okResult, errResult } from '../tool-result.js';

const exec = promisify(execFile);

interface CloneState {
  dir: string;
  repoUrl: string;
}

let cloneState: CloneState | null = null;

async function ensureClone(repoUrl: string, token: string): Promise<string> {
  if (cloneState && cloneState.repoUrl === repoUrl) {
    try {
      await stat(path.join(cloneState.dir, '.git'));
      // Pull latest before each push to reduce conflict risk.
      await exec('git', ['-C', cloneState.dir, 'pull', '--rebase', '--autostash'], { timeout: 30_000 });
      return cloneState.dir;
    } catch {
      cloneState = null;
    }
  }

  const dir = path.join(os.tmpdir(), `runcor-v2-thoughts-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  // Embed token in URL: https://x-access-token:<token>@github.com/...
  const authedUrl = repoUrl.replace(/^https:\/\//, `https://x-access-token:${token}@`);
  await exec('git', ['clone', authedUrl, dir], { timeout: 60_000 });
  await exec('git', ['-C', dir, 'config', 'user.email', 'agent@runcor.ai'], { timeout: 5_000 });
  await exec('git', ['-C', dir, 'config', 'user.name', 'runcor agent'], { timeout: 5_000 });
  cloneState = { dir, repoUrl };
  return dir;
}

export const gitPush: LocalToolFactory = (deps) => ({
  name: 'git_push',
  description: "Commit a file to the agent's public thoughts repo and push.",
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', pattern: '^[a-zA-Z0-9_\\-/.]+$' },
      content: { type: 'string', maxLength: 50_000 },
      commitMessage: { type: 'string', minLength: 1, maxLength: 500 },
    },
    required: ['path', 'content', 'commitMessage'],
  },
  handler: async (args) => {
    const repoUrl = deps.env.gitPushRepo;
    const token = deps.env.gitPushToken;
    if (!repoUrl || !token) {
      return errResult('git_unconfigured', { hint: 'GIT_PUSH_REPO/GIT_PUSH_TOKEN not set' });
    }

    const filePath = typeof args.path === 'string' ? args.path : '';
    const content = typeof args.content === 'string' ? args.content : '';
    const commitMessage = typeof args.commitMessage === 'string' ? args.commitMessage : '';
    if (!filePath || !commitMessage) return errResult('path/commitMessage required');
    if (filePath.includes('..')) return errResult('path_traversal_rejected');

    try {
      const dir = await ensureClone(repoUrl, token);
      const target = path.join(dir, filePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, 'utf8');

      await exec('git', ['-C', dir, 'add', filePath], { timeout: 10_000 });
      const { stdout: status } = await exec('git', ['-C', dir, 'status', '--porcelain'], { timeout: 5_000 });
      if (!status.trim()) {
        return okResult({ pushed: false, reason: 'no_changes' });
      }

      await exec('git', ['-C', dir, 'commit', '-m', commitMessage], { timeout: 10_000 });
      await exec('git', ['-C', dir, 'push', 'origin', 'HEAD'], { timeout: 60_000 });
      return okResult({ pushed: true, path: filePath });
    } catch (err) {
      // Reset the cached clone on failure so the next call re-clones cleanly.
      if (cloneState) {
        try {
          await rm(cloneState.dir, { recursive: true, force: true });
        } catch {
          // ignore
        }
        cloneState = null;
      }
      return errResult(err instanceof Error ? err.message : 'git_failure');
    }
  },
});
