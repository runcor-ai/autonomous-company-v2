# Probe #12 — runcor-integration

**Status:** COMPONENT PASS / DORMANT IN V2 (CRITICAL FOR LATTICE)

`createIntegration({dbPath})` returns a plain object with methods `discoverSchemas`, `synthesizeTools`, `registerWithEngine`, `listKnownTools`. All work.

V2's `boot.ts` step 12 wires the three calls in sequence — but **only if `args.reachableSources && args.reachableSources.length > 0`**. V2's `agent/index.ts` calls `boot({ agentRole: 'v2', ...seed? })` and never passes `reachableSources`. So integration is constructed → idle.

## Lattice implication

This is the **most consequential dormant component** because the Lattice design uses MCP for both:
1. **Knowledge-source connection** (the gap we identified): `LatticeConfig.knowledgeSources` → MCP servers → runcor-integration discovers them → tools appear in agent's capability list
2. **Inter-lattice coordination**: peer lattices expose MCP servers → runcor-integration discovers their tools → agent calls them like local tools

Both paths require runcor-integration to actually receive a non-empty source list at boot. The fix in the Lattice rebuild:

```typescript
// agent/index.ts (lattice boot):
const harness = loadHarness(process.env.HARNESS_NAME);
const knowledgeSources = harness.knowledgeBundle.mcpSources;
const peerSources = await bridge.getPeerLatticeMcpEndpoints(harness.id);
await boot({
  agentRole: 'v2',
  reachableSources: [...knowledgeSources, ...peerSources],  // wire it!
});
```

Without this wire, all the Lattice's "knowledge + coordination via MCP" plan is paper-only.
