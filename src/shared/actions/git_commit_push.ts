// Action: git_commit_push — write file(s) into a cloned workspace repo, commit, push.

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface GitFile {
  /** Path inside the workspace repo. */
  path: string;
  content: string;
}

export interface GitCommitPushInput {
  files: GitFile[];
  message: string;
  authorName?: string;
  authorEmail?: string;
}

export interface GitCommitPushResult {
  sha: string;
  filesCommitted: string[];
  pushed: boolean;
}

export interface GitWorkspaceConfig {
  /** owner/repo, e.g. 'runcor-ai/v2-workspace'. */
  repo: string;
  /** Auth token with write access. */
  token: string;
  /** Persistent local clone path; created on first call. */
  localCheckoutDir?: string;
  /** Branch to push to. Default 'main'. */
  branch?: string;
}

export interface GitCommitPusher {
  commitAndPush(input: GitCommitPushInput): Promise<GitCommitPushResult>;
}

export function createGitCommitPusher(config: GitWorkspaceConfig): GitCommitPusher {
  const branch = config.branch ?? 'main';
  const localDir = config.localCheckoutDir ?? path.join(os.tmpdir(), `runcor-${config.repo.replace('/', '_')}`);
  const remoteUrl = `https://x-access-token:${config.token}@github.com/${config.repo}.git`;

  async function ensureClone(): Promise<void> {
    try {
      await fs.access(path.join(localDir, '.git'));
      await exec('git', ['-C', localDir, 'fetch', '--depth=1', 'origin', branch]);
      await exec('git', ['-C', localDir, 'checkout', branch]);
      await exec('git', ['-C', localDir, 'reset', '--hard', `origin/${branch}`]);
    } catch {
      await fs.mkdir(path.dirname(localDir), { recursive: true });
      await exec('git', ['clone', '--depth=1', '--branch', branch, remoteUrl, localDir]);
    }
  }

  return {
    async commitAndPush(input) {
      await ensureClone();
      const writtenPaths: string[] = [];
      for (const f of input.files) {
        const target = path.join(localDir, f.path);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, f.content, 'utf-8');
        writtenPaths.push(f.path);
      }
      await exec('git', ['-C', localDir, 'add', ...writtenPaths]);
      await exec('git', [
        '-C', localDir,
        '-c', `user.name=${input.authorName ?? 'runcor-agent-v2'}`,
        '-c', `user.email=${input.authorEmail ?? 'agent@runcor.ai'}`,
        'commit', '-m', input.message,
      ]);
      const sha = (await exec('git', ['-C', localDir, 'rev-parse', 'HEAD'])).stdout.trim();
      try {
        await exec('git', ['-C', localDir, 'push', 'origin', branch]);
        return { sha, filesCommitted: writtenPaths, pushed: true };
      } catch {
        return { sha, filesCommitted: writtenPaths, pushed: false };
      }
    },
  };
}

export function createMockGitCommitPusher(): GitCommitPusher {
  let counter = 0;
  return {
    async commitAndPush(input) {
      counter++;
      return { sha: `mocksha${counter}`, filesCommitted: input.files.map(f => f.path), pushed: true };
    },
  };
}
