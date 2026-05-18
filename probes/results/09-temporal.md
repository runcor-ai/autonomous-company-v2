# Probe #9 — runcor-temporal

**Status:** FULL PASS

`computeNextWake` produces sensible sleep durations across idle/moderate/high pressure (idle=30 min, high=125s, clamped to 30s floor / 6h ceiling). `isDayBoundary` correctly triggers on either the 200-cycle OR 24-hour threshold.

V2's `cycle.ts` calls both — no fixed-cadence fallback for V2 (control uses fixedSleepMs per Principle X).
