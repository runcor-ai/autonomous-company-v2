# Probe #10 — runcor-skills

**Status:** FULL PASS

`proposeSkill` extracts an R++ block from dialectic output and computes confidence from trajectory statistics. `describePattern` provides a non-LLM summary. V2 calls `skills.proposeSkill` in side-effects C6 with `SKILL_SYNTHESIZE_EVERY = 50` cadence.

Note: `parsedCleanly: false` here because we didn't pass an `rpp-parser` peer — that's an optional dep. With a real parser, V2 would have higher-confidence proposals when the synthesized R++ validates.
