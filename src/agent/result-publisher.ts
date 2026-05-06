// result.md publisher (T149, FR-120, FR-121).
//
// Writes the generated Markdown to disk (under agent-state/) and, when GIT_PUSH_REPO is
// configured, commits + pushes to the configured public results repo. Publication is
// best-effort: if git push fails, the local file persists and the dashboard's /result route
// serves it.

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';

const exec = promisify(execFile);

export interface PublishResultArgs {
  agentRole: 'v2' | 'control';
  agentStateDir: string;
  resultMd: string;
  gitPushRepo?: string;
  gitPushToken?: string;
}

export interface PublishResultOutcome {
  localPath: string;
  pushed: boolean;
  error?: string;
}

export async function publishResult(args: PublishResultArgs): Promise<PublishResultOutcome> {
  const localPath = path.join(args.agentStateDir, `result-${args.agentRole}.md`);
  await mkdir(args.agentStateDir, { recursive: true });
  await writeFile(localPath, args.resultMd, 'utf8');

  if (!args.gitPushRepo || !args.gitPushToken) {
    return { localPath, pushed: false };
  }

  try {
    const dir = path.join(os.tmpdir(), `runcor-v2-results-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const authedUrl = args.gitPushRepo.replace(/^https:\/\//, `https://x-access-token:${args.gitPushToken}@`);
    await exec('git', ['clone', authedUrl, dir], { timeout: 60_000 });
    await exec('git', ['-C', dir, 'config', 'user.email', 'agent@runcor.ai'], { timeout: 5_000 });
    await exec('git', ['-C', dir, 'config', 'user.name', 'runcor agent'], { timeout: 5_000 });

    const target = path.join(dir, `result-${args.agentRole}.md`);
    await writeFile(target, args.resultMd, 'utf8');
    await exec('git', ['-C', dir, 'add', `result-${args.agentRole}.md`], { timeout: 10_000 });
    const { stdout: status } = await exec('git', ['-C', dir, 'status', '--porcelain'], { timeout: 5_000 });
    if (!status.trim()) {
      return { localPath, pushed: false };
    }
    await exec('git', ['-C', dir, 'commit', '-m', `result: ${args.agentRole} run summary`], { timeout: 10_000 });
    await exec('git', ['-C', dir, 'push', 'origin', 'HEAD'], { timeout: 60_000 });
    return { localPath, pushed: true };
  } catch (err) {
    return { localPath, pushed: false, error: err instanceof Error ? err.message : String(err) };
  }
}
