// V2 process dispatcher (T050) — single binary that runs `agent` | `control` | `dashboard`.
//
// Usage:
//   node dist/main.js agent       # V2 process (full harness + dashboard)
//   node dist/main.js control     # control process (single Player call, fixed cadence)
//   node dist/main.js dashboard   # dashboard-only mode for query / observation

import { runAgent } from './agent/index.js';
import { runControl } from './control/index.js';

async function main(): Promise<void> {
  const role = (process.argv[2] ?? 'agent').toLowerCase();

  if (role === 'agent' || role === 'v2') {
    const result = await runAgent();
    console.log('[v2] agent finished:', result);
    return;
  }

  if (role === 'control') {
    const result = await runControl();
    console.log('[v2] control finished:', result);
    return;
  }

  if (role === 'dashboard') {
    console.error('[v2] dashboard-only mode not implemented in v0.1 — run `agent` or `control`');
    process.exit(2);
  }

  console.error(`[v2] unknown role: ${role}. Use one of: agent, control, dashboard.`);
  process.exit(2);
}

const shutdown = (signal: string): void => {
  console.log(`[v2] received ${signal}; cycle loop will exit at next opportunity.`);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch((err) => {
  console.error('[v2] fatal:', err);
  process.exit(1);
});
