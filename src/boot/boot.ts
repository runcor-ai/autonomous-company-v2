// V2 boot orchestration (T055) — the 16-step boot sequence per `contracts/sibling-bindings.md`.
//
// Returns a `BootedHarness` containing every constructed component + the engine + the bus +
// the startup record. `agent/index.ts` and `control/index.ts` consume this to drive the cycle
// loop. The boot is fail-closed (FR-011, FR-012): if ANY step throws, the process surfaces
// the error with the offending component name and exits non-zero before any LLM call fires.
//
// Steps 1–16 mirror the contract verbatim. Comments mark each step.

import path from 'node:path';
import { mkdir } from 'node:fs/promises';
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
      componentRequire(`${name}/package.json`);
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

  // Step 6: data cube
  const dataDbPath = dbPathFor(env, args.agentRole, 'data');
  let dataCube: DataCube;
  try {
    dataCube = new DataCube({ dbPath: dataDbPath });
  } catch (err) {
    componentHealth['runcor-data'] = { status: 'fail', reason: err instanceof Error ? err.message : String(err) };
    throw new BootError('runcor-data', err instanceof Error ? err.message : String(err));
  }

  // Step 7: integration
  let integration: Integration;
  try {
    const dummyModel = { complete: async () => ({ text: '' }) };
    integration = createIntegration({
      model: dummyModel,
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

  // Cycle/day accessors (closures the tools and cycle loop share).
  const cycleState = { current: 0 };
  const dayState = { current: 0 };
  const cycleAccessor = {
    get: (): number => cycleState.current,
    set: (c: number): void => { cycleState.current = c; },
  };
  const dayAccessor = {
    get: (): number => dayState.current,
    set: (d: number): void => { dayState.current = d; },
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
