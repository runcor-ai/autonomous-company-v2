// Dashboard-side hierarchical summary store. Pure observer-layer artifact —
// has nothing to do with runcor-memory. The agent never reads from this; it's
// generated, persisted, and rendered entirely outside the agent's cognitive path.
//
// Layout: a single JSON file at <agent-state-dir>/dashboard-summaries.json.
// Survives process restarts so the cycles-since-boot history is preserved.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export interface SummaryChunk {
  tier: 'L1' | 'L2' | 'L3';
  startCycle: number;
  endCycle: number;
  content: string;
  createdAt: number;
}

interface StoreShape {
  v2: SummaryChunk[];
  control: SummaryChunk[];
}

export class SummaryStore {
  private path: string;
  private data: StoreShape;

  constructor(path: string) {
    this.path = path;
    this.data = this.load();
  }

  add(role: 'v2' | 'control', chunk: SummaryChunk): void {
    this.data[role] = this.data[role] ?? [];
    // Dedupe by (tier, endCycle) — re-runs on restart shouldn't double-write.
    this.data[role] = this.data[role].filter(
      (c) => !(c.tier === chunk.tier && c.endCycle === chunk.endCycle),
    );
    this.data[role].push(chunk);
    this.save();
  }

  list(role: 'v2' | 'control'): SummaryChunk[] {
    return [...(this.data[role] ?? [])];
  }

  /** Last cycle covered by ANY L1 chunk for this role (so the generator knows
   *  whether the next 20-cycle window has already been summarized). */
  lastCoveredEnd(role: 'v2' | 'control', tier: 'L1' | 'L2' | 'L3' = 'L1'): number {
    const chunks = (this.data[role] ?? []).filter((c) => c.tier === tier);
    if (chunks.length === 0) return -1;
    return Math.max(...chunks.map((c) => c.endCycle));
  }

  private load(): StoreShape {
    if (!existsSync(this.path)) return { v2: [], control: [] };
    try {
      const raw = readFileSync(this.path, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<StoreShape>;
      return { v2: parsed.v2 ?? [], control: parsed.control ?? [] };
    } catch {
      return { v2: [], control: [] };
    }
  }

  private save(): void {
    try {
      writeFileSync(this.path, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[summary-store] save failed:', err);
    }
  }
}
