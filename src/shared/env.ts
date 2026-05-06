// Environment loader + validator for V2.
//
// Required env vars are checked at boot per FR-011 (boot fails closed if any required env is
// missing). Operator-only auth, model provider key, and outward-action credentials are pinned;
// optional capabilities (Firecrawl, web search providers) degrade gracefully when their env
// is absent — V2's local MCP module surfaces a smaller tool set in that case.

export interface V2Env {
  /** OpenRouter API key — required for all model calls (every component). */
  openrouterApiKey: string;
  /** Operator auth bearer token — required for /operator/* endpoints (FR-132). */
  operatorAuthToken: string;
  /** Run policy. */
  maxCycles: number;
  v2BudgetUsd: number;
  controlBudgetUsd: number;
  controlIntervalSeconds: number;
  /** Dashboard. */
  dashboardHost: string;
  dashboardPort: number;
  dashboardPublicUrl: string;
  /** Rater (out-of-band scorer). */
  raterModel: string;
  raterIntervalMs: number;
  /** Outward-action capabilities — optional. When absent, the corresponding tool is omitted. */
  firecrawlApiKey?: string;
  runnerEmail?: { user: string; pass: string; imapHost: string; smtpHost: string; imapPort: number; smtpPort: number };
  gitPushRepo?: string;
  gitPushToken?: string;
  webSearchApiKey?: string;
  /** Storage paths — siblings own their own DBs; V2 owns rater.db + operator.db. */
  agentStateDir: string;
  scratchpadDir: string;
  /** V2-002 monitor cadence (FR-019g). */
  harnessMonitorIntervalCycles: number;
  /** CycleRecord SSE buffer size (data-model.md). */
  cycleRecordBufferSize: number;
  /** Reset-on-boot flag (clears all state). */
  resetOnBoot: boolean;
}

class EnvError extends Error {
  constructor(public readonly missingKey: string) {
    super(`Missing required env var: ${missingKey}`);
    this.name = 'EnvError';
  }
}

function reqEnv(name: string): string {
  const v = process.env[name];
  if (typeof v !== 'string' || v.length === 0) {
    throw new EnvError(name);
  }
  return v;
}

function optEnv(name: string): string | undefined {
  const v = process.env[name];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function intEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (typeof v !== 'string' || v.length === 0) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function boolEnv(name: string): boolean {
  return process.env[name] === 'true';
}

/**
 * Load + validate V2 env. Throws on missing required keys.
 * Optional capabilities are populated if their full credential set is present, omitted otherwise.
 */
export function loadV2Env(): V2Env {
  const env: V2Env = {
    openrouterApiKey: reqEnv('OPENROUTER_API_KEY'),
    operatorAuthToken: reqEnv('OPERATOR_AUTH_TOKEN'),
    maxCycles: intEnv('MAX_CYCLES', 1000),
    v2BudgetUsd: intEnv('V2_BUDGET_USD', 100),
    controlBudgetUsd: intEnv('CONTROL_BUDGET_USD', 100),
    controlIntervalSeconds: intEnv('CONTROL_INTERVAL_SECONDS', 300),
    dashboardHost: optEnv('DASHBOARD_HOST') ?? '0.0.0.0',
    dashboardPort: intEnv('DASHBOARD_PORT', 8080),
    dashboardPublicUrl: optEnv('DASHBOARD_PUBLIC_URL') ?? 'http://localhost:8080',
    raterModel: optEnv('RATER_MODEL') ?? 'anthropic/claude-3.5-sonnet',
    raterIntervalMs: intEnv('RATER_INTERVAL_MS', 60_000),
    agentStateDir: optEnv('AGENT_STATE_DIR') ?? './agent-state',
    scratchpadDir: optEnv('SCRATCHPAD_DIR') ?? './agent-state/scratchpad',
    harnessMonitorIntervalCycles: intEnv('HARNESS_MONITOR_INTERVAL_CYCLES', 100),
    cycleRecordBufferSize: intEnv('CYCLE_RECORD_BUFFER_SIZE', 200),
    resetOnBoot: boolEnv('RESET_ON_BOOT'),
  };

  if (optEnv('FIRECRAWL_API_KEY')) {
    env.firecrawlApiKey = optEnv('FIRECRAWL_API_KEY');
  }

  const emailUser = optEnv('RUNNER_EMAIL_USER');
  const emailPass = optEnv('RUNNER_EMAIL_PASS');
  const imapHost = optEnv('RUNNER_EMAIL_IMAP_HOST');
  const smtpHost = optEnv('RUNNER_EMAIL_SMTP_HOST');
  if (emailUser && emailPass && imapHost && smtpHost) {
    env.runnerEmail = {
      user: emailUser,
      pass: emailPass,
      imapHost,
      smtpHost,
      imapPort: intEnv('RUNNER_EMAIL_IMAP_PORT', 993),
      smtpPort: intEnv('RUNNER_EMAIL_SMTP_PORT', 465),
    };
  }

  if (optEnv('GIT_PUSH_REPO') && optEnv('GIT_PUSH_TOKEN')) {
    env.gitPushRepo = optEnv('GIT_PUSH_REPO');
    env.gitPushToken = optEnv('GIT_PUSH_TOKEN');
  }

  if (optEnv('WEB_SEARCH_API_KEY')) {
    env.webSearchApiKey = optEnv('WEB_SEARCH_API_KEY');
  }

  return env;
}
