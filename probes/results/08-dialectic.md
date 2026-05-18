# Probe #8 — runcor-dialectic

**Status:** FULL PASS

**Ran:** 2026-05-18
**Probe source:** `scripts/probe/08-dialectic.ts`

## Verdict

Dialectic works. V2 wires it correctly. Player/Coach/Judge canonical topology produces transcripts with all 3 roles firing.

## Canonical role-set (verified)

| Role | Model | Notes |
|---|---|---|
| Player | `openrouter/nvidia/nemotron-3-super-120b-a12b` | Drafts the answer |
| Coach | `openrouter/qwen/qwen3-32b` | Challenges the draft (the qwen we identified earlier) |
| Judge | `openrouter/meta-llama/llama-3.1-8b-instruct` | Synthesizes/selects |

## Component (PASS)

- Provider registry parses `provider/model` strings correctly
- `dialectic(config)` dispatches Player → Coach → Judge across rounds
- Transcript contains entries for all 3 roles
- Returns a final answer string
- MaxRounds bounds the dialectic (we used 2, got 7 transcript entries)

## V2 wiring (PASS)

- `src/agent/side-effects.ts` defines `DIALECTIC_LIKE` wrapper
- `identity.reflect(input)` receives the wrapped dialectic for self-theory updates
- `goals.propose(input)` receives the wrapped dialectic for goal proposal

## Test-side notes

`MockAdapter`'s `name` is a readonly instance property — subclassing doesn't override it. Solution: wrap in a plain object with `{name, complete: mock.complete.bind(mock)}` and register that.

Cost computation returns undefined when using mock models (no price entry). The transcript + answer still work fine; just cost telemetry is empty in mock mode. Real OpenRouter usage would populate cost normally.
