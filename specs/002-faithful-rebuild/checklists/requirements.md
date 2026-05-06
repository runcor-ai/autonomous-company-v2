# Specification Quality Checklist: V2 Faithful Rebuild — Primordial Agent on the Full runcor Harness

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-05-05
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Items marked incomplete require spec updates before `/speckit.clarify` or `/speckit.plan`.

### Domain caveat — naming sibling components is intentional, not an implementation leak

The 14 runcor sibling components named throughout the spec (runcor, runcor-substrate, runcor-memory, runcor-data, runcor-integration, runcor-dialectic, runcor-meta, runcor-watchdog, runcor-skills, runcor-drives, runcor-identity, runcor-goals, runcor-temporal, runcor-coherence) are NOT implementation details for the purposes of this spec. They are the **experimental contract** itself: Constitution Principle V ("Cognitive substrate is non-negotiable") and Principle VI ("Control on the same rails") explicitly require that these specific components be the substrate of the experiment. The contrast between V2-with-harness and naive-control-without-harness IS the experimental result. Removing these names from the spec would obscure the testable claim. The spec deliberately stays at the level of *which components must be present and how they must compose*, and avoids prescribing internal APIs, file structure, or programming-language choices — those belong in plan.md.

### Resolved clarifications

- **FR-200 (resolved 2026-05-05)**: Action-surface intake. Locked to **Option C** — V2 hosts a local in-process MCP server module exposing the 7 inherited actions, which `runcor-integration` discovers at boot identically to any other MCP server. Ground-truth-verified by the operator against `runcor/FEATURES.md` and `runcor/src/adapter/`: the engine ships zero built-in tools and its adapter is purely a consumer of external MCP servers, so Option B (built-in registry) was architecturally impossible. The local MCP module is V2-internal infrastructure, not one of the canonical 14 cognitive harness components — the canonical 14 stays stable. See FR-200, FR-200a, FR-200b, FR-200c.

### Validation iteration log

- **Iteration 1 (2026-05-05)**: All Content Quality and Feature Readiness items pass; one marker (FR-200) flagged on action-surface boundary.
- **Iteration 2 (2026-05-05)**: Operator answered FR-200 with Option C + ground-truth verification of engine architecture. Marker removed; spec updated (FR-200, FR-200a, FR-200b, FR-200c added; FR-090, FR-092 tightened to single-intake; non-goals annotated). All checklist items now pass.
