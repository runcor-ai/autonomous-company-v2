// Per-cycle remote backup to immutable git history.
//
// Why this exists: 2026-05-08 — RESET_ON_BOOT wiped the volume mid-experiment, losing
// 2400+ cycles of cognitive state. Volume snapshots aren't enabled and the operator
// declined to top up. The fix: every cycle's snapshot pushed to a GitHub repo so the
// run survives ANY local-volume failure mode (reset, deletion, container loss).
//
// Subscribes to cycle_record + a curated set of intra-cycle bus events. Per cycle:
//   1. accumulate events for that cycle's role
//   2. on cycle_record, write snapshot JSON
//   3. commit + push (serialized — one push at a time)
//
// Failures are logged but never block the cycle loop. The next cycle will catch up
// because the local clone retains uncommitted state and `git pull --rebase --autostash`
// reconciles before the next commit.
//
// Path layout in the repo:
//   state-archive/<bootIso>/<role>/cycle-NNNNNNN.json
//
// Each redeploy gets its own bootIso directory — old runs are preserved in git history
// forever. cycle numbers are 7-digit zero-padded so directory listings sort cleanly.

import { execFile } from 'node:child_process';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import type { EventBus } from '../dashboard/event-bus.js';

const exec = promisify(execFile);

// Events buffered per cycle alongside the cycle_record. Chosen for maximum forensic
// value: prompt assembled, gate decisions, model results, costs, side-effect errors,
// scheduling, day-boundary triggers, harness engagement transitions.
const EVENTS_TO_BUFFER = [
  'prompt_assembled',
  'discernment',
  'discernment_flagged',
  'flag_burst_warning',
  'execution_state_change',
  'execution_complete',
  'cost_request',
  'cost_budget_warning',
  'cost_budget_exceeded',
  'side_effect_error',
  'next_wake_scheduled',
  'day_boundary',
  'result_published',
  'harness_engaged',
  'harness_disengaged',
  'adapter_tool_call',
];

export interface StateArchiverArgs {
  bus: EventBus;
  /** GitHub repo as 'owner/name' or full HTTPS URL. */
  gitPushRepo: string;
  /** GitHub token with push access to the repo. */
  gitPushToken: string;
  /** Sortable boot identifier (typically ISO timestamp with `:` and `.` replaced by `-`). */
  bootIso: string;
}

export async function startStateArchiver(args: StateArchiverArgs): Promise<() => void> {
  const { bus, gitPushRepo, gitPushToken, bootIso } = args;

  // Resolve repo URL.
  let repoUrl = gitPushRepo;
  if (repoUrl.match(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/)) {
    repoUrl = `https://github.com/${repoUrl}.git`;
  }
  if (!repoUrl.endsWith('.git')) repoUrl = `${repoUrl}.git`;
  const authedUrl = repoUrl.replace(/^https:\/\//, `https://x-access-token:${gitPushToken}@`);

  // Clone (or refresh) the working dir. PID-keyed so concurrent processes don't collide.
  const cloneDir = path.join(os.tmpdir(), `runcor-state-archive-${process.pid}`);
  try {
    await stat(path.join(cloneDir, '.git'));
    await exec('git', ['-C', cloneDir, 'pull', '--rebase', '--autostash'], { timeout: 60_000 });
  } catch {
    await exec('git', ['clone', authedUrl, cloneDir], { timeout: 180_000 });
    await exec('git', ['-C', cloneDir, 'config', 'user.email', 'archiver@runcor.ai'], { timeout: 5_000 });
    await exec('git', ['-C', cloneDir, 'config', 'user.name', 'runcor state archiver'], { timeout: 5_000 });
  }

  // Empty-repo handling: a brand-new GitHub repo has no HEAD. Seed an initial commit on
  // `main` so subsequent `git add/commit/push` works. Idempotent — only runs when HEAD
  // doesn't resolve.
  try {
    await exec('git', ['-C', cloneDir, 'rev-parse', 'HEAD'], { timeout: 5_000 });
  } catch {
    await exec('git', ['-C', cloneDir, 'checkout', '-b', 'main'], { timeout: 5_000 });
    const readmePath = path.join(cloneDir, 'README.md');
    await writeFile(
      readmePath,
      '# v2 state archive\n\nPer-cycle snapshots of the runcor V2 experiment, written by `state-archiver.ts`.\nEach run lands under `state-archive/<bootIso>/<role>/`.\n',
      'utf-8',
    );
    await exec('git', ['-C', cloneDir, 'add', 'README.md'], { timeout: 5_000 });
    await exec('git', ['-C', cloneDir, 'commit', '-m', 'seed: initial commit (state-archiver)'], { timeout: 10_000 });
    await exec('git', ['-C', cloneDir, 'push', '-u', 'origin', 'main'], { timeout: 60_000 });
  }

  // eslint-disable-next-line no-console
  console.log(`[archiver] ready: dir=${cloneDir} repo=${repoUrl} run=${bootIso}`);

  // Per-role event buffer accumulated since that role's last cycle_record.
  const eventBuffers: Record<string, Array<{ event: string; data: unknown; ts: number }>> = {};
  const ensureBuffer = (role: string): Array<{ event: string; data: unknown; ts: number }> => {
    let buf = eventBuffers[role];
    if (!buf) {
      buf = [];
      eventBuffers[role] = buf;
    }
    return buf;
  };

  const handlers: Array<{ event: string; fn: (data: Record<string, unknown>) => void }> = [];

  for (const eventName of EVENTS_TO_BUFFER) {
    const fn = (data: Record<string, unknown>): void => {
      const role = typeof data.agentRole === 'string' ? data.agentRole : 'unknown';
      ensureBuffer(role).push({ event: eventName, data, ts: Date.now() });
    };
    bus.on(eventName, fn);
    handlers.push({ event: eventName, fn });
  }

  // Serialized push chain. Pushes execute one at a time so concurrent cycle_records
  // (v2 + control) queue cleanly instead of racing on the working tree.
  let pushChain: Promise<void> = Promise.resolve();

  const cycleRecordHandler = (record: Record<string, unknown>): void => {
    const cycleNum = typeof record.cycle === 'number' ? record.cycle : 0;
    const role = typeof record.agentRole === 'string' ? record.agentRole : 'unknown';
    const buffered = ensureBuffer(role).slice();
    eventBuffers[role] = [];

    pushChain = pushChain.then(async () => {
      const filePath = `state-archive/${bootIso}/${role}/cycle-${String(cycleNum).padStart(7, '0')}.json`;
      try {
        const snapshot = {
          bootIso,
          role,
          cycle: cycleNum,
          ts: Date.now(),
          cycleRecord: record,
          events: buffered,
        };
        const target = path.join(cloneDir, filePath);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, JSON.stringify(snapshot, null, 2), 'utf-8');

        try {
          await exec('git', ['-C', cloneDir, 'pull', '--rebase', '--autostash'], { timeout: 30_000 });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[archiver] pull failed (continuing):', err instanceof Error ? err.message : err);
        }

        await exec('git', ['-C', cloneDir, 'add', filePath], { timeout: 10_000 });
        const { stdout: status } = await exec('git', ['-C', cloneDir, 'status', '--porcelain'], { timeout: 5_000 });
        if (!status.trim()) return;
        await exec(
          'git',
          ['-C', cloneDir, 'commit', '-m', `archive ${role} cycle ${cycleNum} (${bootIso})`],
          { timeout: 15_000 },
        );
        await exec('git', ['-C', cloneDir, 'push', 'origin', 'HEAD'], { timeout: 90_000 });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
          `[archiver] cycle ${cycleNum} (${role}) push failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    });
  };
  bus.on('cycle_record', cycleRecordHandler);
  handlers.push({ event: 'cycle_record', fn: cycleRecordHandler });

  return () => {
    for (const h of handlers) bus.off(h.event, h.fn);
  };
}
