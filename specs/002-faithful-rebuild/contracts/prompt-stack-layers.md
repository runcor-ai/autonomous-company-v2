# Contract: Prompt-Stack Layers

**Branch**: `002-faithful-rebuild` | **Date**: 2026-05-05
**FRs**: FR-015, FR-076, FR-076b, FR-100 (control parity)

This contract specifies the substrate prompt-stack's layer order and the data sources each layer reads. Layers are pluggable (`PromptLayer` interface from research.md §R3), but their *registration order* and *source bindings* are fixed by this contract. Both V2 and the control register the **same** layer set with the **same** sources — the difference between V2 and control is the cognitive harness components feeding those sources, not the layer set itself (Principle VI / FR-100).

## Layer order (deterministic)

Substrate's `PromptStack.assemble()` invokes layers in this exact order, joined with `\n\n---\n\n` separators:

1. **`laws`** (always present)
2. **`reality`** (rendered when data cube has matches)
3. **`drives`** (always present)
4. **`goals`** (empty until first goal accepted)
5. **`identity`** (empty until first reflection)
6. **`capabilities`** (always present — at minimum the 7 inherited tools)
7. **`memory_recall`** (empty at cycle 0 and any cycle where `goals.top()` AND `memory.getPlan()` are both empty)

After all layers, the user's base request (from `LayerContext.baseRequest`) is appended. The total prompt is therefore: `LAYERS_BLOCK \n\n---\n\n USER_PROMPT`.

## Layer sources

### Layer: `laws`

**Source**: hardcoded in `runcor-substrate` — the 10 Laws derived from constitution principles.
**Render**: a numbered list, each Law as one line. Each Law has an `id` (`L1`..`L10`) used by the discernment gate's verdict reasons.
**Empty contract**: NEVER empty.
**FR**: FR-002 (Laws are the only thing exposed at cycle 0 alongside drives + capabilities), FR-015.

### Layer: `reality`

**Source**: `dataCubeReader.reality({ goal: topGoalText, drive: dominantDriveLabel })`.
**Render**: the `RealitySlice.rendered` string from `runcor-data` — V2 does NOT render this layer itself; the data cube produces a structured-text summary of relevant entities + edges + open conflicts.
**Empty contract**: empty when `runcor-data` is empty (cycle 0 always; later cycles if the cube has no entities matching the goal/drive query).
**FR**: FR-081, FR-082.

### Layer: `drives`

**Source**: `runcor-drives.computeDrives({ memory, temporal })` — stateless function call, recomputed each cycle.
**Render**: a 4-line block:
```
Drives:
  resource:   <0..1>
  curiosity:  <0..1>
  reactivity: <0..1>
  coherence:  <0..1>
```
With `dominant: <label>` appended on its own line.
**Empty contract**: NEVER empty (drives are always defined, even at cycle 0 — `resource > 0` because budget is finite).
**FR**: FR-001 (drive pressures initialized at neutral values).

### Layer: `goals`

**Source**: `runcor-goals.top()` returns the current goal stack as a `Plan` — PlanItems with `category: 'goal:purpose' | 'goal:objective' | 'goal:initiative'`.
**Render**:
```
Goals:
  Purpose: <P text> (intensity <0..1>)
  Objective: <O text> (intensity <0..1>)
  Initiative: <I text> (intensity <0..1>)
```
Lines for absent levels are omitted.
**Empty contract**: empty at cycle 0 (FR-001) and any cycle where the goal stack is empty.
**FR**: FR-014, FR-001.

### Layer: `identity`

**Source**: latest MemoryNode tagged `['identity_snapshot']`, sorted by `created_cycle desc`. Read via `memory.getAll()` filter (no special API needed).
**Render**:
```
Self-theory (v<N>, last reflected at cycle <M>):
  <self-theory text, capped at 800 chars>
```
**Empty contract**: empty until first identity reflection completes successfully (FR-001 — discovered, not seeded).
**FR**: FR-013, FR-001.

### Layer: `capabilities`

**Source**: `engine.listAdapterTools()` — the engine adapter view (FR-092 / FR-200c — single source of truth).
**Render**: bulleted list of qualified tool names + 1-line descriptions, e.g.:
```
Capabilities (you may invoke any of these):
  - v2-local-actions:firecrawl_scrape — Scrape a URL.
  - v2-local-actions:inbox_read — Read recent inbox messages.
  - <dynamically-discovered>:<tool> — <description>
```
**Empty contract**: NEVER empty — at minimum the 7 inherited tools from the local MCP module are registered at boot (FR-200) before the first cycle prompt is built.
**FR**: FR-090, FR-092, FR-200, FR-200c.

### Layer: `memory_recall`

**Source**: `memory.query(queryText, topK)` where `queryText` is composed by the FR-076 fixed template:
```
Goal: <top goal text>. Drive: <dominant drive label>. Last plan: <last plan précis>.
```
Where:
- `<top goal text>` = `goals.top().items[0].text` (the highest-priority PlanItem) or `""` if no goals.
- `<dominant drive label>` = `drives.dominant().label` (one of `resource | curiosity | reactivity | coherence`).
- `<last plan précis>` = first 200 chars of `memory.getPlan().strategy` or `""` if no plan.

`topK` is owned by `runcor-memory`'s configuration (FR-076a) — V2 does NOT pass topK; the component decides.

**Render**:
```
Recently relevant from memory:
  [M=1.84, cycle 145, tags=daily_summary, day:3] <content précis>
  [M=1.21, cycle 167, tags=episodic] <content précis>
  ...
```
Each entry shows M value, originating cycle, top tags, and a content précis (capped at 200 chars).

**Empty contract** (FR-076b): the layer renders empty (NOT a fabricated query) when:
- `goals.top()` is empty AND `memory.getPlan()` is null/empty.
- Cycle 0 always satisfies this.

When only one of goals/plan is populated, the layer DOES query (with the empty field rendered as empty in the template — `"Goal: . Drive: curiosity. Last plan: ."`); the resulting query may return weak matches, which is expected behavior.

**FR**: FR-076, FR-076a, FR-076b.

## Layer registration

V2's boot wires substrate via:

```ts
const substrate = createSubstrate({
  laws: defaultLaws,                                 // from runcor-substrate
  dataCubeReader: dataCube,                          // from runcor-data
  layers: [
    new LawsLayer(),
    new RealityLayer({ dataCubeReader: dataCube }),
    new DrivesLayer({ drives: drivesModule, memory, temporal }),
    new GoalsLayer({ goals }),
    new IdentityLayer({ memory }),
    new CapabilitiesLayer({ engine }),
    new MemoryRecallLayer({ memory, goals, drives }),  // assembles the FR-076 query
  ],
});
substrate.installer.install(engine);
```

Same wiring for the control process — but the control's `goals`, `identity`, `memory` references point at *empty / disabled* component instances (FR-101). The same `LayerContext` shape flows; the layers just render empty for the control's missing components. **Identical layer set, asymmetric population — that's exactly what Principle VI requires.**

## Telemetry

For every assembled prompt, the substrate emits a `prompt_assembled` event with:
```json
{
  "cycle": <N>,
  "agentRole": "v2" | "control",
  "layerNames": ["laws", "reality", "drives", "goals", "identity", "capabilities", "memory_recall"],
  "nonEmptyLayers": ["laws", "drives", "capabilities"],
  "promptCharCount": <int>,
  "memoryRecallCount": <int>
}
```
This event is consumed by V2's EventBus and forwarded to the dashboard transcript (FR-030).

## Test invariants

1. **Cycle-0 V2 prompt** has non-empty layers `{laws, drives, capabilities}` and empty `{reality, goals, identity, memory_recall}`. (FR-001, FR-076b)
2. **Cycle-0 V2 and control prompts** have IDENTICAL layer signatures (only their substrate-fed values differ if any — but at cycle 0 for both, all the variable layers are empty, so prompts should be byte-identical except for the user message). (FR-100)
3. **Layer order is deterministic** — running assembly twice with the same `LayerContext` produces byte-identical output.
4. **No file in V2 contains a literal LAWS array, hardcoded TASK footer, or cycle-prompt template.** (FR-015 enforcement — verifiable by lint rule.)
5. **`memory_recall` layer never fabricates a query** — when goals AND plan are empty, render is null. (FR-076b)
