// Scores endpoint — external rater results. Per Constitution Principle III + IX,
// this endpoint is BLOCKED from the agent's egress (FR-029, FR-038).
//
// Egress blocking strategy: bind /scores to a separate auth header that only the
// frontend (operator + public observers) gets. The agent never has this header.
// In production the egress block is also enforced at the network layer (firewall
// or sidecar) — the application-level guard here is defense-in-depth.

import type { ScoreRecord, SummaryRecord } from '../../shared/types.js';
import type { KindContext } from '../types.js';

export interface ScoresPayload {
  /** Per summary, the score series for charting. */
  perSummary: Array<{
    summaryId: number;
    kind: SummaryRecord['kind'];
    dayNumber: number;
    publishedAt: string;
    score: number | null;
    rationale: string | null;
    raterModel: string | null;
  }>;
  /** Most recent score for the spectrum bar. */
  currentScore: { kind: 'v2' | 'control'; score: number; raterModel: string } | null;
}

export function scoresPayload(v2Ctx: KindContext, controlCtx?: KindContext): ScoresPayload {
  const allSummaries: SummaryRecord[] = [
    ...v2Ctx.store.summariesFor('v2'),
    ...(controlCtx ? controlCtx.store.summariesFor('control') : []),
  ];
  const allScores: ScoreRecord[] = [
    ...v2Ctx.store.allScores(),
    ...(controlCtx ? controlCtx.store.allScores() : []),
  ];
  const scoreById = new Map(allScores.map((s) => [s.summaryId, s]));

  const perSummary = allSummaries.map((s) => {
    const sc = scoreById.get(s.id);
    return {
      summaryId: s.id,
      kind: s.kind,
      dayNumber: s.dayNumber,
      publishedAt: s.publishedAt,
      score: sc?.score ?? null,
      rationale: sc?.rationale ?? null,
      raterModel: sc?.raterModel ?? null,
    };
  });

  const lastV2 = perSummary.filter((x) => x.kind === 'v2' && x.score !== null).pop();
  const currentScore = lastV2
    ? { kind: 'v2' as const, score: lastV2.score!, raterModel: lastV2.raterModel ?? '' }
    : null;

  return { perSummary, currentScore };
}

/** Bearer-token guard for the scores endpoint. The agent's process MUST NOT have this token. */
export function isAuthorizedForScores(authHeader: string | undefined, expected: string): boolean {
  if (typeof authHeader !== 'string' || authHeader.length === 0) return false;
  const prefix = 'Bearer ';
  if (!authHeader.startsWith(prefix)) return false;
  const provided = authHeader.slice(prefix.length).trim();
  if (provided.length !== expected.length || expected.length === 0) return false;
  // Constant-time compare.
  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
