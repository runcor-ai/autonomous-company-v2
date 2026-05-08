// V2 boot orchestration (T055) — the 16-step boot sequence per `contracts/sibling-bindings.md`.
//
// Returns a `BootedHarness` containing every constructed component + the engine + the bus +
// the startup record. `agent/index.ts` and `control/index.ts` consume this to drive the cycle
// loop. The boot is fail-closed (FR-011, FR-012): if ANY step throws, the process surfaces
// the error with the offending component name and exits non-zero before any LLM call fires.
//
// Steps 1–16 mirror the contract verbatim. Comments mark each step.

import path from 'node:path';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { createV2Engine } from '../engine/factory.js';
import { registerPrimordialCycleFlow } from '../engine/flows/primordial-cycle.js';
import { registerNaiveControlCycleFlow } from '../engine/flows/naive-control-cycle.js';
import { subscribeEngineTelemetry } from '../engine/telemetry.js';
import { CANONICAL_COMPONENTS, type CanonicalComponentName } from './components.js';
import { assertInstallerEngaged } from './installer-check.js';
import { buildStartupRecord, type StartupRecord } from './startup-record.js';
import { createLocalMcpServer, type LocalMcpServer } from '../mcp-local/index.js';
import { EventBus } from '../dashboard/event-bus.js';
import {
  V2RealityLayer,
  DrivesLayer,
  GoalsLayer,
  IdentityLayer,
  CapabilitiesLayer,
  MemoryRecallLayer,
} from '../substrate-layers/index.js';
import { loadV2Env, type V2Env } from '../shared/env.js';
import { loadControlConfig, type LoadedControlConfig } from '../control/config.js';

import { Substrate, LawsLayer, type SubstrateInstaller } from 'runcor-substrate';
import { MemorySystem, MemoryDatabase } from 'runcor-memory';
import { DataCube } from 'runcor-data';
import { createIntegration, DEFAULT_SAFETY_POLICY } from 'runcor-integration';
import type { Integration } from 'runcor-integration';
import { createIdentity, type Identity } from 'runcor-identity';
import { createGoals, type Goals } from 'runcor-goals';
import { createCoherence, type Coherence } from 'runcor-coherence';
import { createTemporal, type Temporal } from 'runcor-temporal';
import { createWatchdog, type Watchdog } from 'runcor-watchdog';
import { createSkills, type Skills } from 'runcor-skills';
import { dialectic, type DialecticConfig, type DialecticResult } from 'runcor-dialectic';
import type { Runcor } from 'runcor';

export type AgentRole = 'v2' | 'control';

export interface BootArgs {
  agentRole: AgentRole;
  /** When true, control mode skips constructing cognitive components per FR-101. */
  cognitiveDisabled?: boolean;
  /** Reachable schema sources for runcor-integration discovery (FR-090). Empty by default. */
  reachableSources?: Array<{ kind: 'sqlite' | 'http' | 'mcp_server'; uri: string }>;
}

export interface BootedHarness {
  agentRole: AgentRole;
  env: V2Env;
  engine: Runcor;
  substrate: Substrate;
  memory: MemorySystem;
  dataCube: DataCube;
  integration: Integration;
  identity: Identity | null;
  goals: Goals | null;
  coherence: Coherence | null;
  temporal: Temporal;
  watchdog: Watchdog | null;
  skills: Skills | null;
  dialectic: ((config: DialecticConfig) => Promise<DialecticResult>) | null;
  localMcp: LocalMcpServer;
  bus: EventBus;
  controlConfig?: LoadedControlConfig;
  startupRecord: StartupRecord;
  /** Cycle counter accessor — incremented by the cycle loop. */
  cycleAccessor: { get(): number; set(c: number): void };
  /** Day-of-run counter accessor (used by publish_post tagging). */
  dayAccessor: { get(): number; set(d: number): void };
  /** Termination signal — set by terminate tool. */
  terminationState: { isTerminated(): boolean; requestTerminate(reason: string): void; reason(): string | null };
}

class BootError extends Error {
  constructor(public readonly component: string, message: string) {
    super(`[boot] ${component}: ${message}`);
    this.name = 'BootError';
  }
}

function dbPathFor(env: V2Env, role: AgentRole, name: string): string {
  const dir = path.resolve(env.agentStateDir);
  const prefix = role === 'v2' ? 'agent' : 'control';
  return path.join(dir, `${prefix}-${name}.db`);
}

/**
 * Verify every canonical component package can be import'd. We don't need to *load* most of
 * them at this point (we'll instantiate as we go); we just need to assert resolvability so
 * a missing dep fails before we touch the model router. The require() approach piggybacks
 * on Node's package resolution.
 */
const componentRequire = createRequire(import.meta.url);

function verifyComponentResolution(): Partial<Record<CanonicalComponentName, { status: 'pass' | 'fail'; reason?: string }>> {
  const health: Partial<Record<CanonicalComponentName, { status: 'pass' | 'fail'; reason?: string }>> = {};
  const missing: string[] = [];
  for (const name of CANONICAL_COMPONENTS) {
    try {
      // Use require.resolve(name) instead of require(`${name}/package.json`).
      // Most siblings ship an `exports` field that whitelists only `.` and not
      // `./package.json`, so the package.json subpath form fails Node's strict
      // subpath-exports check (ERR_PACKAGE_PATH_NOT_EXPORTED) even though the
      // module is fully resolvable. require.resolve(name) goes through the
      // main exports entry, which is always allowed.
      componentRequire.resolve(name);
      health[name] = { status: 'pass' };
    } catch (err) {
      missing.push(name);
      health[name] = { status: 'fail', reason: err instanceof Error ? err.message : String(err) };
    }
  }
  if (missing.length > 0) {
    throw new BootError('component-resolution', `Missing or unresolvable: ${missing.join(', ')}`);
  }
  return health;
}

/**
 * RESET_ON_BOOT implementation. Removes agent-state files for the given role + role-shared
 * dashboard files, leaving operator.db intact. Best-effort: any single delete failure is
 * logged but does not block boot — the goal is "as much fresh state as we can manage,"
 * not all-or-nothing atomicity.
 *
 * Files removed (per-role):
 *   - <agent|control>-{memory,data,temporal,identity,goals,coherence,integration}.db
 *     and their -wal / -shm SQLite sidecars
 *   - cycle-state-<role>.json
 *
 * Files removed (role-shared dashboard):
 *   - bus-events.jsonl (transcript history)
 *   - dashboard-summaries.json (hierarchical L1 summaries)
 *   - rater.db / -wal / -shm (scoring history — orphan rows otherwise)
 *
 * Files PRESERVED:
 *   - operator.db (operator audit log — Principle IX historical record)
 *
 * Scratchpad: cleared (agent's prior fs_write outputs would otherwise pollute fs_read on the
 * fresh run).
 */
async function performResetOnBoot(
  agentStateDir: string,
  scratchpadDir: string,
  agentRole: AgentRole,
): Promise<void> {
  const startTs = Date.now();
  const removed: string[] = [];
  const failed: Array<{ file: string; error: string }> = [];

  const componentDbBases = ['memory', 'data', 'temporal', 'identity', 'goals', 'coherence', 'integration'];
  const sqliteSuffixes = ['.db', '.db-wal', '.db-shm'];
  const targets: string[] = [];

  // CRITICAL: must use the SAME prefix mapping that dbPathFor() uses, otherwise reset
  // tries to delete files that don't exist while the real ones survive. v2 → 'agent',
  // control → 'control'. Bug landed once (2026-05-08) where the role name was used
  // verbatim ('v2-memory.db') and identity + goals persisted across reset, taking the
  // corrupted self-theory with them. Don't repeat.
  const dbPrefix = agentRole === 'v2' ? 'agent' : 'control';

  // Per-role component DBs.
  for (const base of componentDbBases) {
    for (const suf of sqliteSuffixes) {
      targets.push(path.join(agentStateDir, `${dbPrefix}-${base}${suf}`));
    }
  }
  // Per-role cycle/day persistence file. Note: this DOES use agentRole directly because
  // boot.ts:294 writes `cycle-state-${args.agentRole}.json`, not the prefix.
  targets.push(path.join(agentStateDir, `cycle-state-${agentRole}.json`));

  // Role-shared dashboard state. Wiping these on V2 boot is intentional — a reset of V2
  // means we're discarding the experiment series; transcript + scores + summaries from
  // the prior series would otherwise be misleading at /transcript, /scores, /blog.
  targets.push(path.join(agentStateDir, 'bus-events.jsonl'));
  targets.push(path.join(agentStateDir, 'dashboard-summaries.json'));
  for (const suf of sqliteSuffixes) {
    targets.push(path.join(agentStateDir, `rater${suf}`));
  }

  for (const target of targets) {
    try {
      await rm(target, { force: true });
      removed.push(path.basename(target));
    } catch (err) {
      failed.push({ file: path.basename(target), error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Clear scratchpad contents (agent's fs_write outputs from the prior run).
  try {
    const entries = await readdir(scratchpadDir);
    for (const entry of entries) {
      try {
        await rm(path.join(scratchpadDir, entry), { recursive: true, force: true });
        removed.push(`scratchpad/${entry}`);
      } catch (err) {
        failed.push({ file: `scratchpad/${entry}`, error: err instanceof Error ? err.message : String(err) });
      }
    }
  } catch {
    // Scratchpad dir might not exist on first boot — that's fine.
  }

  const elapsedMs = Date.now() - startTs;
  // eslint-disable-next-line no-console
  console.log(`[boot:RESET_ON_BOOT] role=${agentRole} removed=${removed.length} failed=${failed.length} ms=${elapsedMs}`);
  if (failed.length > 0) {
    // eslint-disable-next-line no-console
    console.warn('[boot:RESET_ON_BOOT] failures:', failed);
  }
  // eslint-disable-next-line no-console
  console.log('[boot:RESET_ON_BOOT] PRESERVED: operator.db (audit log untouched).');
}

export async function boot(args: BootArgs): Promise<BootedHarness> {
  // Step 1: env
  let env: V2Env;
  try {
    env = loadV2Env();
  } catch (err) {
    throw new BootError('env', err instanceof Error ? err.message : String(err));
  }
  await mkdir(env.agentStateDir, { recursive: true });
  await mkdir(env.scratchpadDir, { recursive: true });

  // Step 1.5: RESET_ON_BOOT — wipe agent state before any component initializes (env.resetOnBoot).
  // What gets wiped: memory, data, temporal, identity, goals, coherence, integration DBs (per
  // role), the cycle-state JSON, the persisted bus-events transcript, the rater scoring DB, the
  // dashboard summary store, the agent's scratchpad files. What is PRESERVED: operator.db
  // (the operator's audit log — Principle IX historical record, not agent state).
  // The reset is per-role: booting the V2 process wipes V2's stores; control's stores are
  // touched only when the control process boots. Both roles share rater.db, summary-store, and
  // bus-events — these are dashboard-side and get wiped on the first reset boot of either role.
  if (env.resetOnBoot) {
    await performResetOnBoot(env.agentStateDir, env.scratchpadDir, args.agentRole);
  }

  // Step 2: 14-component resolution check
  const componentHealth = verifyComponentResolution();

  // Step 3+4: providers + engine
  let engine: Runcor;
  try {
    engine = await createV2Engine({ openrouterApiKey: env.openrouterApiKey });
  } catch (err) {
    throw new BootError('runcor', err instanceof Error ? err.message : String(err));
  }

  // Step 5: memory
  const memDbPath = dbPathFor(env, args.agentRole, 'memory');
  let memory: MemorySystem;
  try {
    const memDb = new MemoryDatabase(memDbPath);
    memory = new MemorySystem({ db: memDb, agentRole: args.agentRole === 'v2' ? 'autonomous primordial agent' : 'naive control' });
  } catch (err) {
    componentHealth['runcor-memory'] = { status: 'fail', reason: err instanceof Error ? err.message : String(err) };
    throw new BootError('runcor-memory', err instanceof Error ? err.message : String(err));
  }

  // Shared ModelComplete wrapper for components whose pipelines need an LLM (data cube
  // entity extraction, integration schema classification). Routes through engine.modelRouter
  // so calls are substrate-gated per FR-010 — entity extraction isn't agent reasoning, but
  // the constitutional rule is uniform: every LLM call goes through the engine. Performance
  // overhead is acceptable; if cost becomes a problem, we can introduce a separate
  // observer-side direct caller (parallel to src/rater) — that's an architectural change
  // and a separate commit.
  // Bug fixed 2026-05-08: pre-fix, DataCube was constructed WITHOUT a model, so every
  // ingest() call threw "DataCube.ingest requires a `model` to be configured" silently
  // (caught by side-effects.ts try/catch + logged into result.errors). The data cube
  // stayed empty across thousands of cycles, the readiness gates never released,
  // goals.propose() and identity.reflect() never fired against grounded world-state.
  // engine.modelRouter is TS-private at compile time but accessible at runtime (the substrate
  // installer reads it the same way). Cast to bypass the visibility check.
  const looseEngineForModel = engine as unknown as { modelRouter: { complete: (req: Record<string, unknown>) => Promise<{ text: string }> } };
  // Component pipelines (DataCube identify/normalize/conflict + integration schema discovery)
  // do strict JSON.parse on responses. The default 'openrouter/auto' router lands on
  // gemini-2.5-flash-lite which produced prose-wrapped or truncated JSON under the
  // substrate-prepended Laws+Reality systemPrompt — observed live 2026-05-08 (cycle 56–61
  // failed with "Unterminated string in JSON at position 3545"). Force a model with strong
  // JSON adherence for these calls. claude-3.5-haiku is the right balance: ~10× the cost of
  // flash-lite (~$1/1M tokens) but produces strict JSON reliably.
  const COMPONENT_MODEL = 'anthropic/claude-3.5-haiku';
  const componentModel = {
    complete: async (request: { prompt?: string; systemPrompt?: string; responseFormat?: 'text' | 'json'; temperature?: number; maxTokens?: number; model?: string }): Promise<{ text: string }> => {
      // Force the JSON-strict model unless the caller explicitly chose one. Data-cube +
      // integration never specify model, so this defaults the entire component-side path.
      const requestWithModel = { ...request, model: request.model ?? COMPONENT_MODEL };
      const response = await looseEngineForModel.modelRouter.complete(requestWithModel as unknown as Record<string, unknown>);
      return { text: response.text };
    },
  };

  // Step 6: data cube
  const dataDbPath = dbPathFor(env, args.agentRole, 'data');
  let dataCube: DataCube;
  try {
    dataCube = new DataCube({ dbPath: dataDbPath, model: componentModel });
  } catch (err) {
    componentHealth['runcor-data'] = { status: 'fail', reason: err instanceof Error ? err.message : String(err) };
    throw new BootError('runcor-data', err instanceof Error ? err.message : String(err));
  }

  // Step 7: integration
  let integration: Integration;
  try {
    integration = createIntegration({
      model: componentModel,
      dbPath: dbPathFor(env, args.agentRole, 'integration'),
    });
  } catch (err) {
    componentHealth['runcor-integration'] = { status: 'fail', reason: err instanceof Error ? err.message : String(err) };
    throw new BootError('runcor-integration', err instanceof Error ? err.message : String(err));
  }

  // Step 8: substrate (with V2's full canonical 7-layer set, in the contract's order)
  let substrate: Substrate;
  try {
    // LawsLayer needs the laws prompt — the Substrate constructor handles loading it; for our
    // explicit layer registration we read it back via substrate.lawsPrompt after construction.
    // Workaround: construct twice — first with default layers to get lawsPrompt, then construct
    // the real one with the full layer set. Cheap (laws are cached after first load).
    const transient = new Substrate();
    substrate = new Substrate({
      memory,
      layers: [
        new LawsLayer(transient.lawsPrompt),
        new V2RealityLayer(),
        new DrivesLayer(),
        new GoalsLayer(),
        new IdentityLayer(),
        new CapabilitiesLayer(),
        new MemoryRecallLayer(),
      ],
    });
  } catch (err) {
    componentHealth['runcor-substrate'] = { status: 'fail', reason: err instanceof Error ? err.message : String(err) };
    throw new BootError('runcor-substrate', err instanceof Error ? err.message : String(err));
  }

  // Step 9: install substrate + verify engagement (FR-012)
  const installer: SubstrateInstaller = substrate.installer;
  // Runcor's modelRouter is TypeScript-private; the substrate installer reads it at runtime
  // (the privacy is compile-time only). Cast to the substrate's InstallableEngine shape.
  const engineForInstall = engine as unknown as Parameters<typeof installer.install>[0];
  try {
    installer.install(engineForInstall);
    assertInstallerEngaged({ installer, engine: engineForInstall as unknown as { modelRouter?: { complete: unknown } } });
  } catch (err) {
    componentHealth['runcor-substrate'] = { status: 'fail', reason: err instanceof Error ? err.message : String(err) };
    throw new BootError('runcor-substrate', err instanceof Error ? err.message : String(err));
  }

  // Wire the substrate's `ecosystem:discernment_flagged` event onto V2's bus so cycle.ts can
  // observe per-cycle flag verdicts. Substrate emits on the engine's EventEmitter directly,
  // but those event names aren't in runcor's typed EventEmitter map, so we cast to a plain
  // EventEmitter shape.
  const bus = new EventBus({ bufferSize: env.cycleRecordBufferSize * 4 });
  const looseEngine = engine as unknown as { on(ev: string, cb: (payload: Record<string, unknown>) => void): void };
  looseEngine.on('ecosystem:discernment_flagged', (payload) => {
    bus.emit('discernment_flagged', payload);
  });
  looseEngine.on('ecosystem:discernment', (payload) => {
    bus.emit('discernment', payload);
  });

  // Step 10: cognitive components (skipped in control per FR-101).
  let identity: Identity | null = null;
  let goals: Goals | null = null;
  let coherence: Coherence | null = null;
  let watchdog: Watchdog | null = null;
  let skills: Skills | null = null;
  let dialecticFn: ((config: DialecticConfig) => Promise<DialecticResult>) | null = null;

  let temporal: Temporal;
  try {
    temporal = createTemporal({ dbPath: dbPathFor(env, args.agentRole, 'temporal') });
  } catch (err) {
    componentHealth['runcor-temporal'] = { status: 'fail', reason: err instanceof Error ? err.message : String(err) };
    throw new BootError('runcor-temporal', err instanceof Error ? err.message : String(err));
  }

  if (!args.cognitiveDisabled) {
    try {
      identity = createIdentity({ dbPath: dbPathFor(env, args.agentRole, 'identity'), memory });
    } catch (err) {
      componentHealth['runcor-identity'] = { status: 'fail', reason: err instanceof Error ? err.message : String(err) };
      throw new BootError('runcor-identity', err instanceof Error ? err.message : String(err));
    }
    try {
      goals = createGoals({ dbPath: dbPathFor(env, args.agentRole, 'goals'), memory });
    } catch (err) {
      componentHealth['runcor-goals'] = { status: 'fail', reason: err instanceof Error ? err.message : String(err) };
      throw new BootError('runcor-goals', err instanceof Error ? err.message : String(err));
    }
    try {
      coherence = createCoherence({ dbPath: dbPathFor(env, args.agentRole, 'coherence'), memory });
    } catch (err) {
      componentHealth['runcor-coherence'] = { status: 'fail', reason: err instanceof Error ? err.message : String(err) };
      throw new BootError('runcor-coherence', err instanceof Error ? err.message : String(err));
    }
    try {
      watchdog = createWatchdog();
    } catch (err) {
      componentHealth['runcor-watchdog'] = { status: 'fail', reason: err instanceof Error ? err.message : String(err) };
      throw new BootError('runcor-watchdog', err instanceof Error ? err.message : String(err));
    }
    try {
      dialecticFn = (config: DialecticConfig) => dialectic(config);
      skills = createSkills({ dialectic: async ({ problem, maxRounds }) => ({ answer: (await dialecticFn!({ problem, ...(typeof maxRounds === 'number' ? { maxRounds } : {}) })).answer }) });
    } catch (err) {
      componentHealth['runcor-skills'] = { status: 'fail', reason: err instanceof Error ? err.message : String(err) };
      throw new BootError('runcor-skills', err instanceof Error ? err.message : String(err));
    }
  }

  // Step 11: register cycle flows + boot local MCP module + register adapter
  registerPrimordialCycleFlow(engine);
  registerNaiveControlCycleFlow(engine);

  // Cycle/day accessors — persisted to <agent-state>/cycle-state-<role>.json so
  // process restarts (Railway redeploys) DON'T reset experimental continuity.
  const cycleStatePath = `${env.agentStateDir}/cycle-state-${args.agentRole}.json`;
  const initialState = (() => {
    try {
      const raw = readFileSync(cycleStatePath, 'utf-8');
      const parsed = JSON.parse(raw) as { cycle?: number; day?: number };
      return { cycle: typeof parsed.cycle === 'number' ? parsed.cycle : 0, day: typeof parsed.day === 'number' ? parsed.day : 0 };
    } catch {
      return { cycle: 0, day: 0 };
    }
  })();
  const cycleState = { current: initialState.cycle };
  const dayState = { current: initialState.day };
  const persistCycleState = (): void => {
    try {
      writeFileSync(cycleStatePath, JSON.stringify({ cycle: cycleState.current, day: dayState.current }));
    } catch (err) {
      console.error('[boot] cycle-state persist failed:', err);
    }
  };
  if (initialState.cycle > 0) {
    console.log(`[boot] resumed ${args.agentRole} from cycle ${initialState.cycle} (day ${initialState.day})`);
  }
  const cycleAccessor = {
    get: (): number => cycleState.current,
    set: (c: number): void => { cycleState.current = c; persistCycleState(); },
  };
  const dayAccessor = {
    get: (): number => dayState.current,
    set: (d: number): void => { dayState.current = d; persistCycleState(); },
  };

  // Termination state.
  const termState = { terminated: false, reason: null as string | null };
  const terminationState = {
    isTerminated: (): boolean => termState.terminated,
    requestTerminate: (reason: string): void => {
      termState.terminated = true;
      termState.reason = reason;
    },
    reason: (): string | null => termState.reason,
  };

  const localMcp = createLocalMcpServer({
    env,
    memory,
    dataCube,
    agentRole: args.agentRole,
    context: {
      cycle: () => cycleState.current,
      dayOfRun: () => dayState.current,
    },
    requestTerminate: terminationState.requestTerminate,
  });
  try {
    await engine.addAdapter(localMcp.asAdapterConfig());
  } catch (err) {
    throw new BootError('local-mcp-adapter', err instanceof Error ? err.message : String(err));
  }

  // Step 12: integration discovery + register
  if (args.reachableSources && args.reachableSources.length > 0) {
    try {
      const report = await integration.discoverSchemas({ reachable: args.reachableSources, cycle: 0 });
      const tools = integration.synthesizeTools(report, DEFAULT_SAFETY_POLICY);
      // runcor-integration's EngineLike differs structurally from runcor's Runcor in the
      // ToolResult / ToolCallResult naming — the runtime shapes are compatible (both have
      // `content` + `isError`), but the type union flags a difference at the optional-vs-
      // required `isError` field. Cast to bridge.
      await integration.registerWithEngine(engine as unknown as Parameters<typeof integration.registerWithEngine>[0], tools);
    } catch (err) {
      componentHealth['runcor-integration'] = { status: 'fail', reason: err instanceof Error ? err.message : String(err) };
      throw new BootError('runcor-integration', err instanceof Error ? err.message : String(err));
    }
  }

  // Step 13: smoke check (lightweight: brand + isInstalled — already verified at step 9)

  // Step 14: build StartupRecord
  let controlConfig: LoadedControlConfig | undefined;
  try {
    controlConfig = await loadControlConfig();
  } catch {
    controlConfig = undefined;
  }
  const startupRecord = buildStartupRecord({
    agentRole: args.agentRole,
    ...(controlConfig ? { controlConfigHash: controlConfig.hash } : {}),
    envSummary: {
      hasOpenRouterKey: env.openrouterApiKey.length > 0,
      hasOperatorAuthToken: env.operatorAuthToken.length > 0,
      hasFirecrawlKey: !!env.firecrawlApiKey,
      hasRunnerEmail: !!env.runnerEmail,
      hasGitPushCreds: !!env.gitPushRepo && !!env.gitPushToken,
    },
    substrateInstallerEngaged: true,
    componentHealth,
  });
  bus.emit('startup_record', startupRecord as unknown as Record<string, unknown>);

  // Step 15: subscribe to engine telemetry
  subscribeEngineTelemetry({ engine, bus, agentRole: args.agentRole });

  // Step 16: cycle loop is started by the caller (agent/index.ts or control/index.ts).
  return {
    agentRole: args.agentRole,
    env,
    engine,
    substrate,
    memory,
    dataCube,
    integration,
    identity,
    goals,
    coherence,
    temporal,
    watchdog,
    skills,
    dialectic: dialecticFn,
    localMcp,
    bus,
    ...(controlConfig ? { controlConfig } : {}),
    startupRecord,
    cycleAccessor,
    dayAccessor,
    terminationState,
  };
}
