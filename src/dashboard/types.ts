// Dashboard context — what the server needs from the agent + control + operator.

import type { Store } from '../shared/db.js';
import type { AgentHarness } from '../agent/boot.js';

/** Read-only handles the dashboard uses to render state. */
export interface KindContext {
  store: Store;
  /** Live harness handle when dashboard runs in-process with the agent. */
  harness?: AgentHarness;
  /** USD spent / cap, fed by the runner. */
  budget: { spentUsd: () => number; capUsd: number };
}

export interface DashboardContext {
  v2: KindContext;
  control?: KindContext;
  /** Bearer token gating the operator-only endpoints. */
  operatorAuthToken: string;
  /** Public URL prefix used in rendered links. */
  publicUrlPrefix: string;
  /** Override now() for tests. */
  now?: () => Date;
  /** Summarizer config for the cycle-summary panels. When omitted, summaries are stubbed. */
  summarizer?: { apiKey: string; model: string };
}

/** Live SSE event published to /transcript. */
export interface TranscriptEvent {
  kind: 'v2' | 'control';
  type: 'cycle' | 'decision' | 'action' | 'summary' | 'score' | 'operator';
  cycleId?: number;
  payload: unknown;
  ts: string;
}
