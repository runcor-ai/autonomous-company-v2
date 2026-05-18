# Probe #13 — runcor-coherence

**Status:** COMPONENT PASS / V2 READ-ONLY USE

Coherence constructs. Full API surface available (`submit, route, parallel, checkCoherence, recombine, registerEngine, detect, ...`). V2 imports + constructs it; dashboard reads from it (`/coherence` endpoint). But the cycle loop never SUBMITS tasks — no `coherence.submit/route/parallel` calls anywhere in the cycle path.

Net effect: registeredEngines stays at 0, no multi-engine routing happens. Coherence is structurally present but functionally unused at runtime — same dormant pattern as runcor-meta + runcor-integration's reachableSources gap.

For the Lattice rebuild: if multi-engine routing isn't needed yet, drop coherence from the required-14 list. If it IS the design (different roles run on different model families), wire `coherence.submit` into the cycle's task dispatch.
