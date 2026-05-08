// git_push (T064) — commit a file to a GitHub repository and push.
//
// Per contracts/mcp-local-tools.md. Idempotent on path+content (a second call with identical
// inputs is a no-op git commit because git skips empty diffs).
//
// Default target: the agent's configured "thoughts" repo (GIT_PUSH_REPO env). The agent can
// override per-call with `repo: 'owner/name'` to push to any GitHub repo its token has write
// access to — useful after creating a new repo via github_create_repo.

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

// Cache one clone per repo URL. Multiple repos → multiple cached clones.
const cloneStates: Map<string, CloneState> = new Map();

async function ensureClone(repoUrl: string, token: string): Promise<string> {
  const cached = cloneStates.get(repoUrl);
  if (cached) {
    try {
      await stat(path.join(cached.dir, '.git'));
      // Pull latest before each push to reduce conflict risk.
      await exec('git', ['-C', cached.dir, 'pull', '--rebase', '--autostash'], { timeout: 30_000 });
      return cached.dir;
    } catch {
      cloneStates.delete(repoUrl);
    }
  }

  const dir = path.join(os.tmpdir(), `runcor-v2-git-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(dir, { recursive: true });
  // Embed token in URL: https://x-access-token:<token>@github.com/...
  const authedUrl = repoUrl.replace(/^https:\/\//, `https://x-access-token:${token}@`);
  await exec('git', ['clone', authedUrl, dir], { timeout: 60_000 });
  await exec('git', ['-C', dir, 'config', 'user.email', 'agent@runcor.ai'], { timeout: 5_000 });
  await exec('git', ['-C', dir, 'config', 'user.name', 'runcor agent'], { timeout: 5_000 });
  cloneStates.set(repoUrl, { dir, repoUrl });
  return dir;
}

/** Resolve the repo URL: prefer the per-call argument, fall back to the env default. */
function resolveRepoUrl(repoArg: string | undefined, defaultUrl: string | undefined): string | null {
  if (repoArg && repoArg.length > 0) {
    // Accept either "owner/name" or full URL.
    if (repoArg.match(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/)) {
      return `https://github.com/${repoArg}.git`;
    }
    if (repoArg.match(/^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(\.git)?$/)) {
      return repoArg.endsWith('.git') ? repoArg : `${repoArg}.git`;
    }
    return null;
  }
  if (defaultUrl) {
    if (defaultUrl.match(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/)) {
      return `https://github.com/${defaultUrl}.git`;
    }
    return defaultUrl.endsWith('.git') ? defaultUrl : `${defaultUrl}.git`;
  }
  return null;
}

export const gitPush: LocalToolFactory = (deps) => ({
  name: 'git_push',
  description:
    "Commit a file to a GitHub repository and push. Default target is the agent's configured thoughts repo. Pass `repo: 'owner/name'` to push to a different repo (you must have write access — typically a repo you created via github_create_repo).",
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', pattern: '^[a-zA-Z0-9_\\-/.]+$' },
      content: { type: 'string', maxLength: 50_000 },
      commitMessage: { type: 'string', minLength: 1, maxLength: 500 },
      repo: {
        type: 'string',
        description: 'Optional. Full path "owner/name" or HTTPS URL. Defaults to GIT_PUSH_REPO.',
      },
    },
    required: ['path', 'content', 'commitMessage'],
  },
  handler: async (args) => {
    const token = deps.env.gitPushToken;
    if (!token) {
      return errResult('git_unconfigured', { hint: 'GIT_PUSH_TOKEN not set' });
    }
    const repoArg = typeof args.repo === 'string' ? args.repo : undefined;
    const repoUrl = resolveRepoUrl(repoArg, deps.env.gitPushRepo);
    if (!repoUrl) {
      return errResult('repo_unresolved', {
        hint: 'Provide repo as "owner/name", or set GIT_PUSH_REPO in env.',
      });
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
      return okResult({ pushed: true, path: filePath, repo: repoUrl });
    } catch (err) {
      // Reset the cached clone for THIS repo on failure so the next call re-clones cleanly.
      const failed = cloneStates.get(repoUrl);
      if (failed) {
        try {
          await rm(failed.dir, { recursive: true, force: true });
        } catch {
          // ignore
        }
        cloneStates.delete(repoUrl);
      }
      return errResult(err instanceof Error ? err.message : 'git_failure');
    }
  },
});
