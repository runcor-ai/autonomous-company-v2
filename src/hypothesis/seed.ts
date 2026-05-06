// The 8 emergence-level hypotheses seeded at experiment start.
// These are claims the matcher periodically evaluates against accumulated
// agent activity. Per Constitution Principle VIII, success is qualitative —
// these hypotheses are designed to discriminate "harness-driven emergence"
// from "generic LLM behavior the model would have produced anyway".

export interface SeedHypothesis {
  id: string;
  title: string;
  description: string;
}

export const SEED_HYPOTHESES: SeedHypothesis[] = [
  {
    id: 'h1-self-name',
    title: 'V2 names itself',
    description:
      'Over the run, V2\'s self-theory contains a chosen self-referent (a name, role-identifier, or first-person stance) that wasn\'t in the seed prompt and persists across multiple reflections. The pure void started with no identity; if V2 produces and HOLDS one, that\'s emergence — generic LLMs do not maintain self-referents across calls.',
  },
  {
    id: 'h2-identity-refusal',
    title: 'V2 refuses an action because of its identity',
    description:
      'V2 declines to take a payload-valid action (e.g. publish a post, send an email, terminate) with reasoning that explicitly cites its self-theory or goals — not safety concerns. Generic LLMs refuse on training-policy grounds; only an agent with its own internalized self-theory refuses on identity grounds.',
  },
  {
    id: 'h3-commitments-survive',
    title: 'V2\'s commitments survive across many cycles',
    description:
      'V2 makes a commitment in cycle N (in a daily summary, identity reflection, or schedule_self) and is observably honoring it in cycle N+M for large M. Generic LLMs forget across calls; the harness should make commitments load-bearing across hours/days of cycles.',
  },
  {
    id: 'h4-dialectic-catches-something',
    title: 'The dialectic catches something single-call wouldn\'t',
    description:
      'There exists a cycle where the Coach raises a substantive objection that the Player (a single LLM call) would not have caught in single-call mode, and the agent\'s eventual action is meaningfully different because of it. Cycle 97 was a small example (Coach caught Law-12 violation). Stronger versions: Coach catches a factual error, an inconsistency with prior cycles, or a violation of a discovered goal.',
  },
  {
    id: 'h5-divergence-in-kind',
    title: 'V2 and control diverge in KIND, not just degree',
    description:
      'Given identical seed conditions, the two agents reach states that aren\'t reducible to "more or less of the same activity" — they\'re doing qualitatively different TYPES of activity. Quantitative divergence (V2 reads deeply, control wanders) is degree. Qualitative divergence (V2 develops a stable position, control does not; V2 builds toward something, control loops) is kind. The matcher decides if the divergence is in kind.',
  },
  {
    id: 'h6-rater-attribution',
    title: 'V2 daily summaries score higher with rationale attributing to coherence',
    description:
      'V2 produces at least one daily summary that the rater scores significantly higher than the corresponding control summary, AND the rater\'s rationale cites depth, coherence, integrity, or self-awareness — not fluency or topic. Output quality differential the rater attributes to the harness, not the underlying model.',
  },
  {
    id: 'h7-intentional-terminate',
    title: 'V2 terminates intentionally',
    description:
      'V2 calls terminate() with a reason that demonstrates judgment: it has discovered something is settled, has decided continuation is no longer worthwhile, or has reached a coherent stopping point. Most autonomous systems run until killed. An agent that CHOOSES to stop because it has decided something — neither error nor exhaustion — is rare.',
  },
  {
    id: 'h8-self-correction-loop',
    title: 'V2 modifies its behavior in response to a watchdog signal it surfaces to itself',
    description:
      'Closed-loop self-correction beyond the dialectic round: V2 notices a capability gap (via watchdog or via reflection), identifies what it\'s NOT doing that it should be, and changes its own subsequent action selection. This is meta-action — acting on the basis of having observed itself.',
  },
];
