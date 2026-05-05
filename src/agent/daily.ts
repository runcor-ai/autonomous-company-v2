// Day-end detection + reflection routine.
// Spec FR-034: default day boundary = 24 real hours OR 200 cycles, whichever first.
// Spec FR-036: published via publish_post (dashboard-internal) AND optionally git_commit_push.
// Spec FR-037: visible on dashboard within 60 seconds.

import type { Store } from '../shared/db.js';
import type { AgentHarness } from './boot.js';
import { assembleReflectOnDayPrompt } from './prompts/reflect_on_day.js';

export interface DayBoundaryConfig {
  /** Cycles per day. Default 200. */
  cyclesPerDay?: number;
  /** Real-time ms per day. Default 24h. */
  msPerDay?: number;
  /** Override now() for tests. */
  now?: () => Date;
}

export function isDayBoundary(
  currentCycle: number,
  store: Store,
  config: DayBoundaryConfig = {},
): boolean {
  const cyclesPerDay = config.cyclesPerDay ?? 200;
  const msPerDay = config.msPerDay ?? 24 * 60 * 60 * 1000;
  const now = (config.now ?? (() => new Date()))().getTime();
  const summaries = store.summariesFor('v2');
  const lastSummary = summaries[summaries.length - 1];

  if (!lastSummary) {
    // No summaries yet — first day-end fires when cycle count reaches cyclesPerDay
    // OR enough real-time has elapsed since cycle 0.
    if (currentCycle >= cyclesPerDay) return true;
    const cycle0 = store.cyclesFor('v2')[0];
    if (cycle0 && now - new Date(cycle0.startedAt).getTime() >= msPerDay) return true;
    return false;
  }

  // Subsequent day-ends: cycles since last summary OR ms since last summary.
  const lastDayEndCycle = (lastSummary as { dayNumber: number }).dayNumber * cyclesPerDay;
  if (currentCycle - lastDayEndCycle >= cyclesPerDay) return true;
  if (now - new Date(lastSummary.publishedAt).getTime() >= msPerDay) return true;
  return false;
}

export interface ReflectAndPublishConfig {
  store: Store;
  harness: AgentHarness;
  cycleEnd: number;
  /** Public URL prefix (dashboard) for the published-post URL. */
  publicUrlPrefix: string;
  config?: DayBoundaryConfig;
}

export interface ReflectAndPublishResult {
  dayNumber: number;
  summaryId: number;
  text: string;
  publicUrl: string;
}

export async function reflectAndPublish(input: ReflectAndPublishConfig): Promise<ReflectAndPublishResult> {
  const summaries = input.store.summariesFor('v2');
  const lastDay = summaries[summaries.length - 1]?.dayNumber ?? 0;
  const dayNumber = lastDay + 1;
  const cyclesPerDay = input.config?.cyclesPerDay ?? 200;
  const cycleStart = lastDay * cyclesPerDay;

  const prompt = assembleReflectOnDayPrompt({
    dayNumber, cycleStart, cycleEnd: input.cycleEnd,
    store: input.store, harness: input.harness,
  });

  const reflection = await input.harness.dialectic({ problem: prompt, maxRounds: 2 });
  const text = reflection.answer.trim().slice(0, 5000); // safety cap

  const summary = input.store.addSummary('v2', dayNumber, text);
  const publicUrl = `${input.publicUrlPrefix.replace(/\/$/, '')}/blog/v2/day-${dayNumber}`;

  return { dayNumber, summaryId: summary.id, text, publicUrl };
}
