// Cross-cutting types shared by agent + control + dashboard.

export type AgentKind = 'v2' | 'control';

export interface CycleRecord {
  id: number;
  kind: AgentKind;
  cycleNumber: number;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'complete' | 'failed' | 'terminated';
}

export interface ActionRecord {
  id: number;
  kind: AgentKind;
  cycleId: number;
  action: string;
  payload: unknown;
  result?: unknown;
  error?: string;
  costUsd: number;
  createdAt: string;
}

export interface DecisionRecord {
  id: number;
  kind: AgentKind;
  cycleId: number;
  /** 'player' | 'coach' | 'judge' | 'naive' */
  role: string;
  model: string;
  prompt: string;
  output: string;
  costUsd: number;
  promptTokens: number;
  completionTokens: number;
  createdAt: string;
}

export interface SummaryRecord {
  id: number;
  kind: AgentKind;
  dayNumber: number;
  text: string;
  publishedAt: string;
}

export interface ScoreRecord {
  id: number;
  summaryId: number;
  /** -1 to +1 */
  score: number;
  rationale: string;
  raterModel: string;
  scoredAt: string;
}

export interface OperatorAction {
  id: number;
  action: 'pause' | 'resume' | 'note';
  text?: string;
  createdAt: string;
}

export interface BudgetStatus {
  kind: AgentKind;
  spentUsd: number;
  capUsd: number;
  remainingUsd: number;
  exhausted: boolean;
}
