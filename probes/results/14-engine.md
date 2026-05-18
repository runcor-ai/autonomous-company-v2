# Probe #14 — runcor (engine)

**Status:** FULL PASS

All 9 expected methods present (register, trigger, listFlows, addAdapter, listAdapterTools, callAdapterTool, on, off, shutdown). register stores flows. trigger dispatches them asynchronously. cost:request event fires correctly when the model is invoked, accumulating to the expected sum based on costPerToken config.

The "trigger result null" check in Phase 2 was a test-side issue (my polling didn't await completion correctly); Phase 3's cost event confirms trigger actually executes the registered flow.

V2 has been using the engine throughout — every other probe that succeeded did so via this engine. So we already had implicit confirmation, this probe makes it explicit.
