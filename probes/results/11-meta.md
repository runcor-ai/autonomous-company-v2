# Probe #11 — runcor-meta

**Status:** COMPONENT OK / V2 NEVER USES IT

Meta constructs fine, exposes API: `pressure, wrap, checkpoint, recordTrajectory, getRecentCalibration, count, close`.

V2 scan: **0 files import, 0 construct, 0 invoke.** Meta is listed in V2's `boot/components.ts` as a required component (so the boot guard verifies the package resolves) but no behavioral integration exists.

## Implication for Lattice rebuild

Either:
1. **Drop runcor-meta from the required-14 list** if V2 has no use for calibration scoring + escalation
2. **Wire it in**: add a `MetaLayer` that surfaces trajectory calibration scores into the prompt-stack, and call `meta.recordTrajectory()` after each cycle's action

Currently it's neither — listed as required but doing nothing. Audit was right.
