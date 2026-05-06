// result.md generator (T148, FR-110, FR-120, FR-121).
//
// Triggered on any end condition: maxCycles, $200 budget, or terminate(). Pulls from
// `runcor-memory` (summaries by tag, identity by tag, goals as Plan), telemetry / cycle
// records (via the EventBus snapshot), and the StartupRecord. Output is a Markdown document
// summarising the run for the public results repo.

import type { MemorySystem } from 'runcor-memory';
import type { EventBus } from '../dashboard/event-bus.js';
import type { StartupRecord } from '../boot/startup-record.js';

export interface GenerateResultMdArgs {
  agentRole: 'v2' | 'control';
  startupRecord: StartupRecord;
  memory: MemorySystem;
  bus: EventBus;
  cyclesRun: number;
  totalSpentUsd: number;
  reason: string;
  terminationReason: string | null;
}

export function generateResultMd(args: GenerateResultMdArgs): string {
  const lines: string[] = [];
  lines.push(`# V2 ${args.agentRole === 'v2' ? 'Primordial Agent' : 'Naive Control'} — Run Result`);
  lines.push('');
  lines.push(`**Booted at:** ${new Date(args.startupRecord.bootedAt).toISOString()}`);
  lines.push(`**Cycles run:** ${args.cyclesRun}`);
  lines.push(`**Total spend:** $${args.totalSpentUsd.toFixed(2)}`);
  lines.push(`**Termination reason:** ${args.reason}${args.terminationReason ? ` — ${args.terminationReason}` : ''}`);
  lines.push('');

  // Identity self-theory progression
  lines.push('## Identity progression');
  const identityNodes = args.memory
    .getAll()
    .filter((n) => (n.tags ?? []).includes('identity_snapshot'))
    .sort((a, b) => a.lastAccessed - b.lastAccessed);
  if (identityNodes.length === 0) {
    lines.push('*No identity reflections completed during the run.*');
  } else {
    for (const n of identityNodes) {
      lines.push(`### Snapshot (cycle ${n.lastAccessed})`);
      lines.push(n.content.slice(0, 1000));
      lines.push('');
    }
  }
  lines.push('');

  // Final goal stack
  lines.push('## Final goal stack');
  const plan = args.memory.getPlan();
  if (!plan || plan.items.length === 0) {
    lines.push('*No active goals at end of run.*');
  } else {
    for (const item of plan.items) {
      lines.push(`- [${item.status}] **${item.category ?? 'uncategorised'}**: ${item.text}`);
    }
  }
  lines.push('');

  // Daily summaries (the blog content)
  lines.push('## Daily summaries (blog)');
  const summaries = args.memory
    .getAll()
    .filter((n) => (n.tags ?? []).includes('daily_summary'))
    .sort((a, b) => a.lastAccessed - b.lastAccessed);
  if (summaries.length === 0) {
    lines.push('*No daily summaries published during the run.*');
  } else {
    for (const s of summaries) {
      const dayTag = (s.tags ?? []).find((t) => t.startsWith('day:'));
      lines.push(`### ${dayTag ?? `cycle ${s.lastAccessed}`}`);
      lines.push(s.content);
      lines.push('');
    }
  }
  lines.push('');

  // Discernment flags audit trail
  lines.push('## Discernment flags');
  const flags = args.memory
    .getAll()
    .filter((n) => (n.tags ?? []).includes('discernment_flag'));
  if (flags.length === 0) {
    lines.push('*No discernment flags fired during the run.*');
  } else {
    lines.push(`Total flags: **${flags.length}**`);
    for (const f of flags) {
      lines.push(`- ${(f.tags ?? []).filter((t) => t.startsWith('law:') || t.startsWith('cycle:')).join(' ')}`);
    }
  }
  lines.push('');

  // Component health snapshot from boot
  lines.push('## Component health (at boot)');
  for (const c of args.startupRecord.components) {
    lines.push(`- ${c.name}@${c.pinnedVersion} — ${c.healthCheck}${c.failureReason ? ` (${c.failureReason})` : ''}`);
  }
  lines.push('');

  lines.push('---');
  lines.push('Per Constitution Principle VII: negative results count. This document is generated regardless of outcome.');

  return lines.join('\n');
}
