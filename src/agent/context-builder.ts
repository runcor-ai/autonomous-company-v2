// Cycle context builder (T103) — assembles the LayerContext per `contracts/sibling-bindings.md` §A.
//
// Reads from the harness:
//   - drives via runcor-drives.computeDrives({ memory, temporal })
//   - top goal via goals.stack(currentCycle).dominant
//   - last plan via memory.getPlan()
//   - memory recall via memory.query(queryText) where queryText is the FR-076 fixed template
//   - identity self-theory from latest MemoryNode tagged ['identity_snapshot']
//   - capabilities via engine.listAdapterTools()
//   - reality slice via dataCube.queryReality({ goal, drive })
//
// FR-076b: when goals.top() AND memory.getPlan() are BOTH empty, MemoryRecall renders empty —
// we still build the LayerContext (drives + capabilities are non-empty), we just skip the
// memory.query() call entirely.

import type { LayerContext } from 'runcor-substrate';
import type { Runcor } from 'runcor';
import type { MemorySystem } from 'runcor-memory';
import type { DataCube } from 'runcor-data';
import type { Goals, Goal } from 'runcor-goals';
import type { DrivePressure } from 'runcor-drives';

export interface BuildLayerContextArgs {
  cycle: number;
  agentRole: 'v2' | 'control';
  engine: Runcor;
  memory: MemorySystem;
  dataCube: DataCube;
  /** Goals component, or null in the control process (FR-101). */
  goals: Goals | null;
  /** Current drive pressures, computed by the cycle code from the drives module. */
  drivePressure: DrivePressure;
}

export interface BuildLayerContextResult {
  layerContext: LayerContext;
  /** The query text used (or null if FR-076b empty contract fired). For telemetry. */
  memoryRecallQuery: string | null;
}

const DOMINANT_DRIVES: ReadonlyArray<'resource' | 'curiosity' | 'reactivity' | 'coherence'> = [
  'resource',
  'curiosity',
  'reactivity',
  'coherence',
];

function intensityOf(drives: DrivePressure, key: 'resource' | 'curiosity' | 'reactivity' | 'coherence'): number {
  return drives[key]?.intensity ?? 0;
}

function buildSubstrateDrives(drives: DrivePressure): LayerContext['drives'] {
  const dominantKey = drives.dominantDrive ?? DOMINANT_DRIVES.reduce<'resource' | 'curiosity' | 'reactivity' | 'coherence'>(
    (best, k) => (intensityOf(drives, k) > intensityOf(drives, best) ? k : best),
    'resource',
  );
  return {
    resource: intensityOf(drives, 'resource'),
    curiosity: intensityOf(drives, 'curiosity'),
    reactivity: intensityOf(drives, 'reactivity'),
    coherence: intensityOf(drives, 'coherence'),
    dominant: { label: dominantKey, value: intensityOf(drives, dominantKey) },
  };
}

function getTopGoal(goals: Goals | null, currentCycle: number): { goal: Goal | null; layerShape: LayerContext['topGoal'] } {
  if (!goals) return { goal: null, layerShape: null };
  const stack = goals.stack(currentCycle);
  const top = stack.dominant ?? null;
  if (!top) return { goal: null, layerShape: null };
  return {
    goal: top,
    layerShape: { text: top.text, category: `goal:${top.level}` },
  };
}

function getIdentitySelfTheory(memory: MemorySystem): string | null {
  // sibling-bindings.md §A5 — read the latest 'identity_snapshot' MemoryNode.
  const all = memory.getAll();
  let best: { node: typeof all[0]; createdCycle: number } | null = null;
  for (const node of all) {
    if (!node.tags || !node.tags.includes('identity_snapshot')) continue;
    // Some snapshots may not have tracked created_cycle (older nodes default 0); use lastAccessed
    // as a fallback ordering hint. Newest wins regardless.
    const cyc = node.lastAccessed ?? 0;
    if (!best || cyc > best.createdCycle) {
      best = { node, createdCycle: cyc };
    }
  }
  return best?.node.content ?? null;
}

export async function buildLayerContext(args: BuildLayerContextArgs): Promise<BuildLayerContextResult> {
  const { cycle, agentRole, engine, memory, dataCube, goals, drivePressure } = args;

  const substrateDrives = buildSubstrateDrives(drivePressure);
  const dominantLabel = substrateDrives.dominant?.label ?? 'resource';

  const { goal: topGoal, layerShape: topGoalLayer } = getTopGoal(goals, cycle);
  const lastPlan = memory.getPlan();
  const lastPlanPrecis = lastPlan?.strategy ? lastPlan.strategy.slice(0, 200) : null;

  // FR-076b: skip memory.query when both topGoal and plan are empty.
  let recalledNodes: LayerContext['recalledNodes'] = [];
  let memoryRecallQuery: string | null = null;
  if (topGoal || lastPlanPrecis) {
    memoryRecallQuery = `Goal: ${topGoal?.text ?? ''}. Drive: ${dominantLabel}. Last plan: ${lastPlanPrecis ?? ''}.`;
    try {
      const results = await memory.query(memoryRecallQuery, 5);
      recalledNodes = results.map((r) => ({
        id: r.node.id,
        content: r.node.content,
        M: r.node.M,
        tags: r.node.tags ?? [],
        created_cycle: r.node.lastAccessed,
      }));
    } catch {
      // Memory query failures are non-fatal; the layer just renders empty.
      recalledNodes = [];
    }
  }

  const identitySelfTheory = getIdentitySelfTheory(memory);

  // sibling-bindings.md §A6 — capabilities from the engine adapter view.
  const adapterTools = engine.listAdapterTools();
  const capabilityList = adapterTools.map((t) => ({
    name: t.qualifiedName,
    description: t.description ?? '',
  }));

  // sibling-bindings.md §A7 — reality slice from runcor-data.
  let realitySlice: LayerContext['realitySlice'] = null;
  try {
    const slice = await dataCube.queryReality({
      ...(topGoal?.text ? { goal: topGoal.text } : {}),
      drive: dominantLabel,
    });
    // Cast: runcor-data's RealitySlice has different field names than substrate's RealitySlice
    // type. V2RealityLayer reads the runcor-data shape directly via the `rendered` field;
    // substrate's default LayerContext type is just a structural hint here.
    realitySlice = slice as unknown as LayerContext['realitySlice'];
  } catch {
    realitySlice = null;
  }

  const layerContext: LayerContext = {
    cycle,
    agentRole,
    baseRequest: { prompt: '' }, // populated by the flow handler before the call
    drives: substrateDrives,
    topGoal: topGoalLayer,
    identitySelfTheory,
    lastPlanPrecis,
    recalledNodes,
    realitySlice,
    capabilityList,
  };

  return { layerContext, memoryRecallQuery };
}
