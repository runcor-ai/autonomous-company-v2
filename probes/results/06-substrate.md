# Probe #6 — runcor-substrate

**Status:** FULL PASS (first one)

**Ran:** 2026-05-18
**Probe source:** `scripts/probe/06-substrate.ts`

## Verdict

The substrate works correctly AND V2 wires it correctly. This is the first component in the probe sequence to pass both checks.

## Component (PASS)

- `PromptStack.assemble()` composes layers in registration order, joined with `\n\n---\n\n`
- Empty layers (`null` or `""` return) are correctly skipped
- `nonEmptyLayerNames(ctx)` returns just the contributing layer names
- Discernment-gate `evaluateOutput` runs 10 law checks:
  - Grounded output → `outcome: pass` (0/10 failed)
  - Ungrounded entity reference (random UUID) → `outcome: block` with `reason: "Critical law violation: reality"`
- Severity overrides work (reality + constraint = critical → block; uncertainty = warning; simplicity = advisory)

## V2 wiring (PASS)

| Check | Result |
|---|---|
| V2 creates `Substrate(...)` | YES (boot.ts:420) |
| V2 installs substrate (monkey-patches engine.modelRouter) | YES (boot.ts:458 — `installer.install(engineForInstall)`) |
| V2 calls `assertInstallerEngaged` to verify monkey-patch | YES (boot.ts:459) |
| V2 registers all 7 expected layers | YES (Laws, Reality, Drives, Goals, Identity, Capabilities, MemoryRecall) |

## Note

My probe's regex check failed because V2 destructures (`const installer = substrate.installer; installer.install(...)`) instead of dot-chaining. Manual verification of boot.ts:453-460 confirms the install happens correctly. The substrate's monkey-patch IS active in V2.

## Forensic match

The V2 forensic showed substrate fired 13 `discernment_flagged` events with `failedLawId: reality` — that confirms the gate is actually running. Now we know structurally why: substrate is properly installed.

This is the component most directly responsible for **what works** in V2.
