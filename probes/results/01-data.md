# Probe #1 — runcor-data (BEFORE + AFTER Tier 1 rewrite)

## BEFORE fix (2026-05-17)

| Metric | Value |
|---|---|
| Entities created from 20 V2-shape ingests | 9 |
| Edges | 0 |
| Failure rate | 55% (JSON parse, timeouts, network) |
| Goal-propose readiness gate (≥10) | CLOSED |
| Identity-reflect readiness gate (≥15) | CLOSED |
| Per-ingest latency | 30-152 seconds (4-5 serial LLM calls) |
| Sample entity types | `[greeting]`, `[github_repo_creation]`, `[decision_log_entry]` — wrappers around action payloads, not real-world facts |

## ROOT CAUSE

The 5-stage LLM pipeline (identify→normalize→relate→conflict→persist) treats V2's action results as raw text and asks the LLM to invent entity types. But action results aren't extractable texts — they're structured events with known shapes that the LLM can't classify reliably.

## AFTER fix (2026-05-18) — V2-action extractor in runcor-data

Added `runcor-data/src/v2-action-extractor.ts`. Recognizes `v2-local-actions.<verb>` source pattern. Per-action handlers produce real entities + edges deterministically. No LLM calls, no JSON parse failures.

| Metric | Value |
|---|---|
| Entities from same 20 ingests | **49** |
| Edges | **36** |
| Failure rate | **0%** |
| Goal-propose gate | **OPEN** |
| Identity-reflect gate | **OPEN** |
| Per-ingest latency | **~3ms** |
| Entity types | `agent_cycle`, `github_repo`, `github_file`, `scratchpad_file`, `webpage`, `email_message`, `search_query`, `web_result`, `person`, `email_thread`, `blog_post` |

## Cascade unblocks

Per the dependency chain in probe #7 result, this fix unblocks:
- runcor-goals: cube has 49 entities → propose can fire when V2 calls it
- runcor-identity: cube has 49 entities → reflect can fire (was blocked at 0/15)
- substrate RealityLayer: now has structured entities + edges to render
- runcor-data queryReality: works against real-world entities, not action wrappers

Probes 2-7 listed structural issues that all dissolve once the cube populates correctly.

## Implementation

- File: `runcor-data/src/v2-action-extractor.ts` (10 action handlers, dedup by stable key)
- Splice point: `data-cube.ts ingest()` checks `isV2ActionSource(input.source)` and routes to `persistExtraction` instead of `runPipeline`
- LLM pipeline retained for non-V2 sources (backwards compatible)
- Commit: runcor-data `899701b`
