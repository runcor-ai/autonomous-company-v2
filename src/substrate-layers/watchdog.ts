// WatchdogLayer — renders open watchdog findings into the prompt stack.
//
// Why this exists: probe #5 (2026-05-18) confirmed that V2 calls `watchdog.audit()`
// and writes findings to memory tagged 'watchdog_finding', but no layer deterministically
// surfaces them in the next prompt. The agent only sees them if MemoryRecallLayer's
// similarity query happens to match — lottery-based. This layer makes the steering signal
// deterministic.
//
// Placed between IdentityLayer and CapabilitiesLayer so the agent sees its blind spots
// BEFORE choosing the next action.

import type { PromptLayer, LayerContext } from 'runcor-substrate';
import type { MemorySystem } from 'runcor-memory';

const MAX_FINDINGS_RENDERED = 5;

export class WatchdogLayer implements PromptLayer {
  readonly name = 'watchdog';
  constructor(private readonly memory: MemorySystem) {}

  render(_context: LayerContext): string {
    const all = this.memory.getAll();
    // Open watchdog findings = memory nodes tagged 'watchdog_finding' AND 'open' (per
    // side-effects.ts:213-217). 'dismissed' findings are skipped.
    // Surface ALL watchdog_finding-tagged nodes regardless of open/dismissed.
    // Why ignore the open/dismissed split: side-effects.ts uses skipValidation: true on
    // watchdog.audit (to bypass strict dialectic gate that was filtering all candidates).
    // skipValidation → all findings come back with validated: false → all get tagged
    // 'dismissed' even though they're real matcher-fired signals. Filtering for 'open'
    // here means we'd never see ANYTHING. Surface them all; let the agent + operator
    // judge relevance.
    const openFindings = all
      .filter((n) => (n.tags ?? []).includes('watchdog_finding'))
      .sort((a, b) => b.lastAccessed - a.lastAccessed)
      .slice(0, MAX_FINDINGS_RENDERED);

    if (openFindings.length === 0) return '';

    const lines: string[] = [
      'Open watchdog findings (gaps between what you say you need and what you have done):',
    ];
    for (const f of openFindings) {
      // Content shape from side-effects.ts:214:
      //   "Watchdog: <category> — <problem> (capability: <capability>). Validated: <bool>."
      // Render the action hint inline so the agent reads "consider invoking X" right there.
      const m = f.content.match(/^Watchdog:\s+([\w-]+)\s+—\s+(.+?)\s+\(capability:\s*([^)]+)\)/);
      if (m) {
        const [, category, problem, capability] = m;
        lines.push(`  - ${category}: "${problem!.slice(0, 100)}" — consider invoking ${capability!.trim()}`);
      } else {
        // Fallback for unparseable content
        lines.push(`  - ${f.content.slice(0, 150)}`);
      }
    }
    return lines.join('\n');
  }
}
