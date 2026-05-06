// Atomic post-cycle side-effects pipeline (T104, FR-018, FR-019d).
//
// Per `contracts/sibling-bindings.md` §C — runs ONLY when the cycle's `engine.trigger(...)`
// resolved successfully (status: 'completed' or 'completed_with_flag'). On `cycle_failed_call`,
// NONE of these run (FR-018).
//
// Steps:
//   C1. Episodic memory.record (`episodic`-tagged MemoryNode)
//   C2. dataCube.ingest (the cycle's action result)
//   C3. Identity reflection (cadence: every IDENTITY_REFLECT_EVERY cycles)
//   C4. Goal proposals + acceptance (cadence)
//   C5. Watchdog audit
//   C6. Skills synthesis (cadence)
//   C7. memory.cycle (R9 — once per cycle, at end)

import type { MemorySystem } from 'runcor-memory';
import type { DataCube } from 'runcor-data';
import type { Identity } from 'runcor-identity';
import type { Goals } from 'runcor-goals';
import type { Watchdog, AuditInput, Capability } from 'runcor-watchdog';
import type { Skills } from 'runcor-skills';
import type { DialecticConfig, DialecticResult } from 'runcor-dialectic';

const IDENTITY_REFLECT_EVERY = 20;
const GOAL_PROPOSE_EVERY = 10;
const SKILL_SYNTHESIZE_EVERY = 50;

export interface ActionInvocation {
  name: string;
  args: Record<string, unknown>;
  resultSummary: string;
  reasoning: string;
}

export interface SideEffectsArgs {
  cycle: number;
  memory: MemorySystem;
  dataCube: DataCube;
  identity: Identity | null;
  goals: Goals | null;
  watchdog: Watchdog | null;
  skills: Skills | null;
  /** Dialectic, used by identity.reflect / goals.propose / skills.synthesize. Null in control. */
  dialectic: ((config: DialecticConfig) => Promise<DialecticResult>) | null;
  action: ActionInvocation | null;
  /** Recent-action history so watchdog and identity see real trajectories. */
  recentActions: Array<{ tool: string; count: number; lastUsed?: string }>;
  /** Recent-action records for identity reflection (with score). */
  recentActionRecords: Array<{ action: string; confidence: number; score: number }>;
  /** Stated problems the agent has surfaced (for watchdog). */
  statedProblems: Array<{ text: string; source: string }>;
  /** Available capabilities from the engine adapter view. */
  availableCapabilities: Array<{ name: string; description: string }>;
}

export interface SideEffectsResult {
  episodicNodeId?: string;
  dataIngestEvents: number;
  identityReflected: boolean;
  goalProposalsAccepted: number;
  watchdogFindings: number;
  skillSynthesized: boolean;
  memoryCycleRan: boolean;
  errors: Array<{ step: string; error: string }>;
}

const DIALECTIC_LIKE = (
  dialectic: ((config: DialecticConfig) => Promise<DialecticResult>) | null,
): ((cfg: { problem: string; maxRounds?: number }) => Promise<{ answer: string }>) | null => {
  if (!dialectic) return null;
  return async ({ problem, maxRounds }) => {
    const result = await dialectic({ problem, ...(typeof maxRounds === 'number' ? { maxRounds } : {}) });
    return { answer: result.answer };
  };
};

export async function runSideEffects(args: SideEffectsArgs): Promise<SideEffectsResult> {
  const result: SideEffectsResult = {
    dataIngestEvents: 0,
    identityReflected: false,
    goalProposalsAccepted: 0,
    watchdogFindings: 0,
    skillSynthesized: false,
    memoryCycleRan: false,
    errors: [],
  };
  args.memory.setCycle(args.cycle);

  // C1. Episodic memory write.
  if (args.action) {
    try {
      const summary = `Cycle ${args.cycle}: invoked ${args.action.name}(${JSON.stringify(args.action.args)}); result: ${args.action.resultSummary}; reasoning: ${args.action.reasoning}.`;
      const r = await args.memory.record(summary, {
        tags: ['episodic', `cycle:${args.cycle}`, `action:${args.action.name}`],
        R: 0.5,
      });
      result.episodicNodeId = r.nodeId;
    } catch (e) {
      result.errors.push({ step: 'episodic_record', error: e instanceof Error ? e.message : String(e) });
    }
  }

  // C2. Data cube ingestion.
  if (args.action) {
    try {
      await args.dataCube.ingest({
        cycle: args.cycle,
        source: args.action.name,
        payload: { args: args.action.args, result: args.action.resultSummary, reasoning: args.action.reasoning },
      });
      result.dataIngestEvents = 1;
    } catch (e) {
      result.errors.push({ step: 'data_ingest', error: e instanceof Error ? e.message : String(e) });
    }
  }

  // C3. Identity reflection (cadence).
  const dialecticLike = DIALECTIC_LIKE(args.dialectic);
  if (args.identity && dialecticLike && args.cycle > 0 && args.cycle % IDENTITY_REFLECT_EVERY === 0) {
    try {
      await args.identity.reflect({
        recentActions: args.recentActionRecords,
        context: `Cycle ${args.cycle} reflective audit. The agent's own self-theory should be revised in light of recent trajectories.`,
        dialectic: dialecticLike,
        currentCycle: args.cycle,
        cause: 'periodic',
      });
      result.identityReflected = true;
    } catch (e) {
      result.errors.push({ step: 'identity_reflect', error: e instanceof Error ? e.message : String(e) });
    }
  }

  // C4. Goal proposals + acceptance (cadence).
  if (args.goals && dialecticLike && args.cycle > 0 && args.cycle % GOAL_PROPOSE_EVERY === 0) {
    try {
      const proposals = await args.goals.propose({
        recentActions: args.recentActionRecords.map((r) => ({ action: r.action })),
        context: `Cycle ${args.cycle} — propose goals consistent with recent trajectories.`,
        level: 'initiative',
        dialectic: dialecticLike,
      });
      for (const p of proposals.slice(0, 2)) {
        args.goals.accept(p, { currentCycle: args.cycle });
        result.goalProposalsAccepted += 1;
      }
    } catch (e) {
      result.errors.push({ step: 'goals_propose', error: e instanceof Error ? e.message : String(e) });
    }
  }

  // C5. Watchdog audit.
  if (args.watchdog) {
    try {
      const auditInput: AuditInput = {
        statedProblems: args.statedProblems,
        availableCapabilities: args.availableCapabilities as Capability[],
        recentActions: args.recentActions,
      };
      const findings = await args.watchdog.audit(auditInput);
      for (const f of findings) {
        await args.memory.record(`Watchdog: ${f.category} — ${f.problem} (capability: ${f.capability}). Validated: ${f.validated}.`, {
          tags: ['watchdog_finding', f.validated ? 'open' : 'dismissed'],
          R: 0.6,
        });
        result.watchdogFindings += 1;
      }
    } catch (e) {
      result.errors.push({ step: 'watchdog_audit', error: e instanceof Error ? e.message : String(e) });
    }
  }

  // C6. Skills synthesis (cadence; only when there's enough trajectory data).
  if (args.skills && args.cycle > 0 && args.cycle % SKILL_SYNTHESIZE_EVERY === 0 && args.recentActionRecords.length >= 3) {
    try {
      const successful = args.recentActionRecords.filter((r) => r.score >= 0.7);
      if (successful.length >= 3) {
        const proposal = await args.skills.proposeSkill({
          pattern: {
            name: `cycle-${args.cycle}-pattern`,
            description: `Pattern observed across recent successful trajectories (cycle ${args.cycle}).`,
            trajectories: successful.map((r) => ({
              action: r.action,
              input: {},
              output: {},
              score: r.score,
            })),
            context: `Agent at cycle ${args.cycle}.`,
          },
        });
        await args.memory.record(JSON.stringify({ name: proposal.name, description: proposal.description, confidence: proposal.confidence, rppSource: proposal.rppSource.slice(0, 1000) }), {
          tags: ['skill_proposal'],
          R: 0.5,
        });
        result.skillSynthesized = true;
      }
    } catch (e) {
      result.errors.push({ step: 'skills_synthesize', error: e instanceof Error ? e.message : String(e) });
    }
  }

  // C7. Memory consolidation cycle (R9 — once per cycle, at end).
  try {
    await args.memory.cycle();
    result.memoryCycleRan = true;
  } catch (e) {
    result.errors.push({ step: 'memory_cycle', error: e instanceof Error ? e.message : String(e) });
  }

  return result;
}
