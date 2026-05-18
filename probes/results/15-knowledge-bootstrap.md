# Probe #15 — knowledge-source bootstrap readiness

**Status:** PRIMITIVES READY / LATTICE WIRING REQUIRED

This isn't a current-V2 functional probe. It's a readiness check for the Lattice design's "knowledge sources are MCP servers" decision.

## Primitives present (verified through other probes)

| Primitive | Where | Probe |
|---|---|---|
| `engine.addAdapter({transport, tools})` | runcor | #14 — method exists |
| `engine.listAdapterTools()` | runcor | #14 + V2 uses for CapabilitiesLayer |
| `engine.callAdapterTool(qualifiedName, args)` | runcor | proven by every successful cycle in V2 (cycle.ts:314) |
| `runcor-integration.discoverSchemas + synthesizeTools + registerWithEngine` | runcor-integration | #12 — verified |

V2 currently uses `addAdapter` only for LOCAL tools (`src/mcp-local/server.ts` exposed as in-process adapter). The same mechanism works for external MCP servers — V2 just doesn't have any configured.

## Lattice wiring required

```typescript
// LatticeConfig (new):
interface LatticeConfig {
  identity, memory, dials,
  knowledgeSources: MCPSourceConfig[],   // ← MISSING
}

interface MCPSourceConfig {
  transport: 'stdio' | 'http' | 'in-process',
  endpoint: string,
  scope: 'read' | 'read_write',
  capabilityToken?: string,
}

// boot path (new):
for (const ks of latticeConfig.knowledgeSources) {
  await engine.addAdapter(buildMcpAdapter(ks));
}
// runcor-integration's discoverSchemas can ALSO populate tools from DB-shaped sources
if (dbSources.length > 0) {
  const report = await integration.discoverSchemas({ reachable: dbSources, cycle: 0 });
  const tools = integration.synthesizeTools(report, DEFAULT_SAFETY_POLICY);
  await integration.registerWithEngine(engine, tools);
}
```

## Same mechanism serves two purposes

Per the design decision (2026-05-18):
1. **Knowledge sources** = MCP servers the harness ships with (CRM, wiki, metrics)
2. **Inter-lattice coordination** = peer lattices exposing MCP endpoints

Both flow through the same `engine.addAdapter` path. runcor-integration handles the DB-shaped subset; raw MCP servers connect directly via the engine's adapter system.

## Verdict

No new component needed. No new probe failure. Just **Lattice-build work**: write the boot path that reads `LatticeConfig.knowledgeSources`, instantiates MCP adapters for each, and registers them with the engine. The engine + runcor-integration already handle the runtime side.
