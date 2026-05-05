// V2 agent cycle — Phase 3: real harness integration.
//
// Per US2 (spec.md), the cycle protocol:
//   1. Drives compute pressures.
//   2. Identity / Goals render their blocks.
//   3. Substrate-style prompt-stack assembled.
//   4. Dialectic reasons (Player/Coach/Judge — replaces single Player call).
//   5. Action parsed from answer.
//   6. Action recorded (Phase 5 wires real execution).
//   7. Watchdog observes (post-cycle capability-gap scan).
//   8. Coherence registers a Task for this cycle.
//   9. Memory persists via our Store (each subsystem owns its DB too).
//  10. Drives recompute from updated state (next cycle reads them).

import type { Store } from '../shared/db.js';
import type { OpenRouterClient } from '../shared/openrouter.js';
import type { AgentHarness } from './boot.js';
import type { ActionDispatcher } from './dispatcher.js';
import { assembleCyclePrompt } from './prompts/cycle_prompt.js';

const SENSES = ['web_scrape', 'web_search', 'http_fetch', 'fs_read', 'inbox_read', 'time', 'fetch_chunk'];
const ACTIONS = ['email_send', 'http_post', 'fs_write', 'git_commit_push', 'publish_post', 'schedule_self', 'terminate'];

export interface AgentCycleInput {
  store: Store;
  /** Used only for token-cost budget tracking on dialectic calls. */
  openrouter: OpenRouterClient;
  harness: AgentHarness;
  cycleNumber: number;
  /** Budget remaining (USD). Drives resource pressure. */
  budgetRemainingUsd: number;
  /** Estimated USD burn per cycle. Drives resource pressure. */
  burnPerCycleUsd: number;
  /** Optional live-event hook (used by orchestrator to feed dashboard SSE). */
  onEvent?: (event: { type: 'cycle' | 'decision' | 'action'; payload: unknown }) => void;
  /** Action dispatcher — when omitted, actions are recorded but not executed. */
  dispatcher?: ActionDispatcher;
}

export interface AgentCycleResult {
  cycleId: number;
  prompt: string;
  answer: string;
  parsedAction?: { action: string; payload: unknown; thought?: string };
  watchdogFindings: number;
  coherenceTaskId: number;
}

/** Extract the first balanced `{...}` JSON object from text. Returns null if none. */
function extractFirstObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export async function runAgentCycle(input: AgentCycleInput): Promise<AgentCycleResult> {
  const { store, harness, cycleNumber } = input;

  // 0. Open the cycle row.
  const cycleRow = store.startCycle('v2', cycleNumber);

  try {
    // 1. Compute drives — feed all four (resource, curiosity, reactivity, coherence).
    // Previously only resource was fed → curiosity/reactivity/coherence were undefined →
    // emitted no pressure → agent had no internal reason to act → 32/45 cycles were 'none'.
    const allActions = store.cyclesFor('v2').flatMap((c) => store.actionsFor(c.id));
    const sensesUsed = new Set(allActions.map((a) => a.action).filter((a) => SENSES.includes(a)));
    const senseCyclesAgo = (() => {
      // Cycles since the agent last invoked any sense action (not 'none').
      for (let i = allActions.length - 1; i >= 0; i--) {
        if (SENSES.includes(allActions[i]!.action)) return cycleNumber - allActions[i]!.cycleId;
      }
      return cycleNumber;
    })();

    const drives = harness.drivesCompute({
      resource: {
        remaining: input.budgetRemainingUsd,
        total: input.budgetRemainingUsd + (cycleNumber * input.burnPerCycleUsd),
        burnPerCycle: input.burnPerCycleUsd,
        cyclesUsed: cycleNumber,
      },
      curiosity: {
        // Knows about all 5 senses; explored = those it has actually invoked.
        // recentExplorationCycles grows the longer it ignores its senses.
        knownAreas: SENSES,
        exploredAreas: Array.from(sensesUsed),
        recentExplorationCycles: senseCyclesAgo,
      },
      reactivity: {
        // For Phase 6 we synthesize a "the world has been quiet" signal — every
        // 10 cycles a low-urgency 'tick' event arrives. Once Phase 7 wires real
        // inbox / webhook polling, replace with actual events.
        pendingEvents: cycleNumber > 0 && cycleNumber % 10 === 0
          ? [{ kind: 'cycle-tick', urgency: 'low' as const, age: 0 }]
          : [],
      },
      coherence: {
        // Compare self-theory claims against actually-taken non-'none' actions.
        // If identity says "I observe and act" but every cycle was 'none',
        // coherence pressure rises.
        selfTheoryClaims: safeIdentityClaims(harness),
        recentActions: allActions.slice(-10).map((a) => ({
          action: a.action,
          confidence: 0.7,
        })),
      },
    });

    // 2. Render identity + goals + drives.
    const drivesText = harness.drivesRender(drives);
    const identityText = safeIdentityRender(harness);
    const goalsText = harness.goals.renderBlock(cycleNumber);

    // 3. Recent action results — surface what previous actions actually returned
    //    so the agent can build on them instead of re-deciding from a void each cycle.
    const recentActionRows = allActions.slice(-5);
    const recentActionResults = recentActionRows.map((a) => ({
      cycleNumber: store.cyclesFor('v2').find((c) => c.id === a.cycleId)?.cycleNumber ?? a.cycleId,
      action: a.action,
      success: a.error === undefined,
      result: a.result,
      ...(a.error !== undefined ? { error: a.error } : {}),
    }));

    // 3b. Loop detection — if the agent has picked the same (action, payload-hash)
    //     3+ times consecutively, surface a warning so it knows to break out.
    let loopWarning: string | undefined;
    if (allActions.length >= 3) {
      const last3 = allActions.slice(-3);
      const sigs = last3.map((a) => `${a.action}|${JSON.stringify(a.payload)}`);
      if (sigs[0] === sigs[1] && sigs[1] === sigs[2]) {
        loopWarning = `You have picked the SAME action with the SAME payload 3 cycles in a row: ${last3[0]!.action} ${JSON.stringify(last3[0]!.payload).slice(0, 200)}. Either it is genuinely the right next move (rare — explain why in your thought) or you are looping. Try something different — a different URL, a different sense, a different verb.`;
      }
    }

    // 4. Assemble cycle prompt (substrate-style stack).
    const prompt = assembleCyclePrompt({
      cycleNumber,
      drives,
      drivesText,
      identityText,
      goalsText,
      capabilities: { senses: SENSES, actions: ACTIONS },
      recentActionResults,
      ...(loopWarning !== undefined ? { loopWarning } : {}),
    });

    // 4. Dialectic reasons.
    const result = await harness.dialectic({ problem: prompt, maxRounds: 2 });
    const answer = result.answer;

    // Persist as a decision row. Real cost comes from dialectic (Player+Coach+Judge);
    // dialectic owns its own cost tracker so we record what it returns rather than
    // double-charging via OpenRouterClient.
    // Persist each Player / Coach / Judge round as its own decision row so the
    // dashboard transcript shows the full deliberation, not just the final answer.
    // Falls back to one synthetic 'player' row when the dialectic doesn't expose
    // a transcript (mocks in tests).
    const rounds = result.transcript && result.transcript.length > 0
      ? result.transcript
      : [{ role: 'player', model: 'dialectic',
           content: answer, costUsd: result.costUsd ?? 0,
           promptTokens: result.promptTokens ?? 0,
           completionTokens: result.completionTokens ?? 0 }];
    let lastDecisionRecord: ReturnType<typeof store.recordDecision> | undefined;
    for (const r of rounds) {
      lastDecisionRecord = store.recordDecision({
        kind: 'v2',
        cycleId: cycleRow.id,
        role: r.role,
        model: r.model,
        prompt: r.role === 'player' && r === rounds[0] ? prompt : '',  // only first row carries the cycle prompt
        output: r.content,
        costUsd: r.costUsd,
        promptTokens: r.promptTokens,
        completionTokens: r.completionTokens,
        createdAt: new Date().toISOString(),
      });
    }
    void input.openrouter; // referenced for symmetry; dialectic owns its own cost tracking
    input.onEvent?.({ type: 'decision', payload: {
      cycleNumber,
      rounds: rounds.length,
      totalCostUsd: rounds.reduce((s, r) => s + r.costUsd, 0),
      totalTokens: rounds.reduce((s, r) => s + r.promptTokens + r.completionTokens, 0),
      preview: answer.slice(0, 200),
    }});
    void lastDecisionRecord;

    // 5. Parse action — try first object, then fall back to a "repair" dialectic
    //    call if the Player's output didn't include a parseable JSON action.
    let parsed: AgentCycleResult['parsedAction'] | undefined;
    const tryParse = (text: string): AgentCycleResult['parsedAction'] | undefined => {
      const objText = extractFirstObject(text);
      if (objText === null) return undefined;
      try {
        const obj = JSON.parse(objText) as Record<string, unknown>;
        if (typeof obj['action'] === 'string') {
          return {
            action: obj['action'] as string,
            payload: obj['payload'],
            ...(typeof obj['thought'] === 'string' ? { thought: obj['thought'] as string } : {}),
          };
        }
      } catch { /* */ }
      return undefined;
    };
    parsed = tryParse(answer);
    if (!parsed) {
      // Repair pass — single re-prompt asking for ONLY the JSON.
      try {
        const repair = await harness.dialectic({
          problem: `Your previous response did not contain a parseable JSON action object. Re-emit ONLY the JSON, no prose, no code fences:\n\n{"action": "<action_name>", "payload": {...}, "thought": "<one short sentence>"}\n\nYour previous response was:\n${answer.slice(0, 1000)}`,
          maxRounds: 1,
        });
        parsed = tryParse(repair.answer);
      } catch { /* repair failed; cycle proceeds with no action */ }
    }
    // 6. EXECUTE the action via dispatcher (real provider call), then record.
    //    Per-action timeout (45s) + result size cap (64KB at storage).
    if (parsed) {
      let executionResult: unknown = 'no-dispatcher';
      let executionError: string | undefined;
      if (input.dispatcher) {
        const dispatcher = input.dispatcher;
        try {
          const dispatched = await Promise.race([
            dispatcher.execute(parsed.action, parsed.payload),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`action ${parsed!.action} timed out after 45s`)), 45_000),
            ),
          ]);
          executionResult = dispatched.result;
          if (!dispatched.success && dispatched.error) executionError = dispatched.error;
        } catch (e) {
          executionError = (e as Error).message;
        }
      }
      // Cap result at 64KB at storage (chunked retrieval still works for the head).
      const cappedResult = capResultSize(executionResult, 64 * 1024);
      const recordOpts: Parameters<typeof store.recordAction>[4] = { result: cappedResult };
      if (executionError !== undefined) recordOpts.error = executionError;
      store.recordAction('v2', cycleRow.id, parsed.action, parsed.payload, recordOpts);
      input.onEvent?.({ type: 'action', payload: {
        cycleNumber, action: parsed.action,
        ...(parsed.thought ? { thought: parsed.thought } : {}),
        success: executionError === undefined,
        ...(executionError !== undefined ? { error: executionError } : {}),
      }});
    }

    // 7. Watchdog observes.
    const findings = await harness.watchdog.audit({
      statedProblems: parsed?.thought
        ? [{ text: parsed.thought, source: `cycle-${cycleNumber}` }]
        : [],
      availableCapabilities: [...SENSES, ...ACTIONS].map((name) => ({
        name,
        description: SENSES.includes(name) ? `sense: ${name}` : `action: ${name}`,
      })),
      recentActions: parsed && parsed.action !== 'none'
        ? [{ tool: parsed.action, count: 1, lastUsed: String(cycleNumber) }]
        : [],
      skipValidation: true, // Phase 3 — defer dialectic-validation to keep cycle deterministic
    });

    // 8. Coherence registers this cycle as a Task.
    const taskId = harness.coherence.submit({
      contract: `#> spec\nGoal: cycle ${cycleNumber} — autonomous next-step decision\nMUST: produce a JSON action object`,
      inputs: { cycleNumber, prompt },
    });

    // 9. Periodic identity reflection (every 20 cycles) and goals proposal (every 30 cycles).
    //    Without these, identity & goals stay forever empty — the IDENTITY and GOALS
    //    blocks in the prompt are always "(none discovered)". Each trigger uses the
    //    dialectic, costing one extra Player+Coach+Judge round.
    if (cycleNumber > 0 && cycleNumber % 20 === 0) {
      try {
        await harness.identity.reflect({
          recentActions: allActions.slice(-15).map((a) => ({
            action: a.action,
            confidence: a.error === undefined ? 0.7 : 0.3,
            score: a.error === undefined ? 0.7 : 0.2,
            metadata: { payload: a.payload, ...(a.error !== undefined ? { error: a.error } : {}) },
          })),
          context: `cycle ${cycleNumber}; last action chosen: ${parsed?.action ?? 'none'}`,
          dialectic: harness.dialectic,
          currentCycle: cycleNumber,
          cause: 'periodic-reflection',
        });
      } catch (e) { console.warn(`[runcor] identity.reflect cycle ${cycleNumber} failed: ${(e as Error).message}`); }
    }
    if (cycleNumber > 0 && cycleNumber % 30 === 0) {
      try {
        const candidates = await harness.goals.propose({
          recentActions: allActions.slice(-15).map((a) => ({
            action: a.action, score: a.error === undefined ? 0.7 : 0.2,
          })),
          context: `cycle ${cycleNumber}; what purpose does the agent's recent activity point to?`,
          level: 'purpose',
          dialectic: harness.dialectic,
        });
        if (candidates.length > 0) {
          // Auto-accept the first candidate so it actually shows up in the goal stack.
          // (Spec-purist: in production, an operator could review these instead.)
          harness.goals.accept(candidates[0]!, { currentCycle: cycleNumber });
        }
      } catch (e) { console.warn(`[runcor] goals.propose cycle ${cycleNumber} failed: ${(e as Error).message}`); }
    }
    // Always: tick the goals decay each cycle so unmaintained goals retire.
    try { harness.goals.decayStep(cycleNumber); } catch { /* noop */ }

    // Done.
    store.completeCycle(cycleRow.id, 'complete');
    input.onEvent?.({ type: 'cycle', payload: {
      cycleNumber, status: 'complete',
      action: parsed?.action ?? 'none',
      watchdogFindings: findings.length,
      coherenceTaskId: taskId,
    }});
    return {
      cycleId: cycleRow.id,
      prompt,
      answer,
      ...(parsed !== undefined ? { parsedAction: parsed } : {}),
      watchdogFindings: findings.length,
      coherenceTaskId: taskId,
    };
  } catch (err) {
    store.completeCycle(cycleRow.id, 'failed');
    throw err;
  }
}

/** Cap a value at maxBytes (UTF-8) for storage. Strings get truncated; objects
 *  get serialized then truncated; primitive types pass through. */
function capResultSize(v: unknown, maxBytes: number): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === 'string') {
    if (v.length <= maxBytes) return v;
    return v.slice(0, maxBytes) + `\n…[storage cap reached at ${maxBytes} bytes; original was ${v.length} bytes]`;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  // For objects, serialize, check size, truncate JSON if needed.
  const s = JSON.stringify(v);
  if (s.length <= maxBytes) return v;
  return {
    __truncated: true,
    __originalBytes: s.length,
    __cap: maxBytes,
    head: s.slice(0, maxBytes - 200),
  };
}

function safeIdentityRender(harness: AgentHarness): string {
  // Identity may have no snapshots yet (pure void seed). renderBlock should handle that
  // but we guard so cycle 0 doesn't fail before reflection has run.
  try {
    const text = harness.identity.renderBlock();
    return text || '(no self-theory yet — to be discovered)';
  } catch {
    return '(no self-theory yet — to be discovered)';
  }
}

function safeIdentityClaims(harness: AgentHarness): string[] {
  // Surface current self-theory claims for the coherence drive to compare
  // against actions taken. Empty until the agent has reflected.
  try {
    const current = harness.identity.current() as { claims?: string[] } | undefined;
    return current?.claims ?? [];
  } catch {
    return [];
  }
}
