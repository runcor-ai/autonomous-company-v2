# Probe #5 — runcor-watchdog

**Status:** COMPONENT PASS / V2 STEERING GAP

**Ran:** 2026-05-18
**Probe source:** `scripts/probe/05-watchdog.ts`

## Verdict

Watchdog matchers work. V2 calls audit() and writes findings to memory. **What's missing is a `WatchdogLayer` in the prompt-stack** that always injects active findings into the next cycle's prompt. Findings reach memory but the agent only sees them if MemoryRecall happens to match.

## Component (PASS)

- `unusedCapabilityMatchingProblem` matcher fires when a stated problem references a capability that hasn't been invoked
- `repeatedResearchWithoutExecution` matcher fires when research tools have heavy use + action tools have zero use + word overlap with stated problems
- Dedup correctly removes duplicate candidate findings
- `skipValidation: true` returns matched candidates without requiring dialectic
- Findings are renderable as prompt instructions:
  ```
  [watchdog] unused-capability-matching-stated-problem: capability "email_send" is
  available but unused despite stated problem "I need to email the founder about Q3 OKRs".
  Consider invoking email_send.
  ```

## V2 wiring

| Check | Result |
|---|---|
| V2 calls `watchdog.audit()` | YES (in side-effects C5 block) |
| V2 writes findings to memory with `watchdog_finding` tag | YES |
| V2 surfaces findings in cycle prompt via dedicated layer | **NO — no WatchdogLayer exists** |
| Findings only reach the agent via MemoryRecallLayer similarity match | YES — incidental, not reliable |

## The steering gap

Side-effects writes:
```typescript
await args.memory.record(
  `Watchdog: ${f.category} — ${f.problem} (capability: ${f.capability}). Validated: ${f.validated}.`,
  { tags: ['watchdog_finding', f.validated ? 'open' : 'dismissed'], R: 0.6 },
);
```

This goes into the memory pile. The agent's next cycle's `MemoryRecallLayer` does a similarity query against `memoryRecallQuery` (derived from the cycle's context, NOT a query about "what should I stop doing"). So watchdog findings only surface if the agent's current focus happens to lexically resemble the finding text.

The audit's "findings logged but ignored" diagnosis was right in effect. The fix is structural:

## Fix shape

Add a `WatchdogLayer` in V2's prompt-stack:
```typescript
// src/substrate-layers/watchdog.ts (new)
export class WatchdogLayer implements PromptLayer {
  readonly name = 'watchdog';
  constructor(private readonly getOpenFindings: () => Finding[]) {}
  render(_context: LayerContext): string {
    const findings = this.getOpenFindings();
    if (findings.length === 0) return '';
    const lines = ['Open watchdog findings (gaps between stated needs and your actions):'];
    for (const f of findings.slice(0, 5)) {
      lines.push(`  - ${f.category}: "${f.problem.slice(0,80)}" — consider invoking ${f.capability}`);
    }
    return lines.join('\n');
  }
}
```

Register it between `IdentityLayer` and `CapabilitiesLayer` so the agent sees its blind spots BEFORE choosing the next action. This makes the watchdog signal deterministic, not lottery-based.
