# Integration probe — Tiers 1+2+3 end-to-end (2026-05-18)

**Status:** FULL PASS (12/12)

**Cost:** ~$0.0006 (~30 OpenAI text-embedding-3-small calls). Zero LLM completion calls.

**Probe source:** `scripts/probe/integration-tier-123.ts`

Boots V2's components in-process, exercises the wiring cascade without spinning up the cycle loop.

## Results by section

### Section 1 — Tier 1 — DataCube V2-action extractor (no LLM)
- 9 V2-shape ingests → **24 entities, 18 edges**
- 12 real entity types extracted: `agent_cycle, blog_post, email_message, email_thread, github_file, github_repo, inbox_snapshot, person, scratchpad_file, search_query, web_result, webpage`
- Dedup merged the duplicate `git_push` to README.md into a single `github_file` entity

### Section 2 — Tier 2.1 — goals.decayStep
- 1 accepted initiative → 0 active after 30 cycles of `decayStep()`
- Confirms the V2 forensic "immortal goals" pattern is fixed

### Section 3 — Tier 2.2 — drives with real reactivity + coherence
- `reactivity=0.85` with 2 simulated pending events (flag-burst + exec-failed)
- `coherence=0.45` with "I never use email" claim + actual `email_send` action
- Both were always 0 before the fix (hardcoded empty inputs in `captureDrivePressure`)

### Section 4 — Tier 2.3 — WatchdogLayer
- Rendered "Open watchdog findings (gaps between what you say you need and what you have done):" followed by per-finding "consider invoking X" hints
- Correctly skipped `dismissed`-tagged findings

### Section 5 — Tier 3 — memory query bumps f + promotion + explicit reinforce
- `f` went 1 → 6 after 5 recall queries (was permanently 1 before fix)
- High-f schema-success node promoted to long cube on first cycle()
- `reinforce(id, 3)` bumped f by exactly 3

## Implication

All three architectural-fix tiers work in isolation AND in concert. The cascade that was broken in V2 forensic (cube empty → goals dormant → identity dormant → drives flat → no steering signals) is now structurally repaired.

Next step (when ready for cost): boot V2 locally with low budget + cheap model (nemotron-120b cycle agent at ~$0.0005/cycle) for ~10 cycles to confirm end-to-end runtime behavior. Until then, code-level wiring is verified.
