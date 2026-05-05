// Cycle-summary endpoint — generates a 1-paragraph summary of an agent's last
// N cycles using a cheap model. Cached so the dashboard polling doesn't blow
// budget on repeated identical requests.

import type { KindContext } from '../types.js';
import type { callOpenRouterChat } from '../../rater/openrouter.js';

export interface SummarizerConfig {
  apiKey: string;
  model: string;
  callImpl?: typeof callOpenRouterChat;
}

interface CacheEntry {
  generatedAt: number;
  lastCycle: number;
  summary: string;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

const SUMMARY_SYSTEM_PROMPT =
  `You are summarizing what an autonomous AI agent has been doing across its last few cycles. ` +
  `Be concise (3-5 sentences). Focus on: what action(s) the agent has been picking, what topic ` +
  `it appears to be exploring, whether it's looping or progressing, and any notable failures or ` +
  `wins. Plain prose, no bullet lists, no markdown headers. Do not editorialize about whether ` +
  `the behavior is good or bad — just describe it.`;

interface RecentCycleView {
  cycleNumber: number;
  status: string;
  action?: string;
  thought?: string;
  actionResultPreview?: string;
  decisionPreviews: string[];
}

function gatherRecentCycles(ctx: KindContext, kind: 'v2' | 'control', n: number): RecentCycleView[] {
  const cycles = ctx.store.cyclesFor(kind);
  const recent = cycles.slice(-n);
  const out: RecentCycleView[] = [];
  for (const c of recent) {
    const actions = ctx.store.actionsFor(c.id);
    const decisions = ctx.store.decisionsFor(c.id);
    const view: RecentCycleView = {
      cycleNumber: c.cycleNumber,
      status: c.status,
      decisionPreviews: decisions.map((d) => `${d.role}: ${d.output.slice(0, 200).replace(/\n+/g, ' ')}`),
    };
    if (actions[0]) {
      view.action = actions[0].action;
      const result = actions[0].result;
      view.actionResultPreview = (typeof result === 'string' ? result : JSON.stringify(result ?? '')).slice(0, 200);
    }
    // Try to pull the thought from the player decision.
    const player = decisions.find((d) => d.role === 'player' || d.role === 'naive');
    if (player) {
      try {
        const m = player.output.match(/"thought"\s*:\s*"([^"]+)"/);
        if (m) view.thought = m[1]!.slice(0, 200);
      } catch { /* */ }
    }
    out.push(view);
  }
  return out;
}

function formatForPrompt(views: RecentCycleView[]): string {
  return views.map((v) => {
    const parts: string[] = [`Cycle ${v.cycleNumber} (${v.status}):`];
    if (v.action) parts.push(`  action=${v.action}${v.thought ? ` thought=${v.thought}` : ''}`);
    if (v.actionResultPreview) parts.push(`  result=${v.actionResultPreview}`);
    return parts.join('\n');
  }).join('\n\n');
}

export async function generateCycleSummary(
  ctx: KindContext,
  kind: 'v2' | 'control',
  config: SummarizerConfig,
  options: { lastN?: number; force?: boolean } = {},
): Promise<{ summary: string; lastCycle: number; generatedAt: string; fromCache: boolean }> {
  const lastN = options.lastN ?? 5;
  const cycles = ctx.store.cyclesFor(kind);
  const lastCycle = cycles.length === 0 ? -1 : cycles[cycles.length - 1]!.cycleNumber;

  if (lastCycle === -1) {
    return { summary: '(no cycles yet)', lastCycle: -1, generatedAt: new Date().toISOString(), fromCache: false };
  }

  const cacheKey = `${kind}:${lastCycle}`;
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (!options.force && cached && (now - cached.generatedAt) < CACHE_TTL_MS) {
    return {
      summary: cached.summary,
      lastCycle: cached.lastCycle,
      generatedAt: new Date(cached.generatedAt).toISOString(),
      fromCache: true,
    };
  }

  const views = gatherRecentCycles(ctx, kind, lastN);
  const userPrompt =
    `Agent kind: ${kind}\n` +
    `Cycles to summarize (most recent first):\n\n` +
    formatForPrompt(views.reverse());

  const call = config.callImpl ?? (await import('../../rater/openrouter.js')).callOpenRouterChat;
  let summary = '(summary failed)';
  try {
    const r = await call({
      apiKey: config.apiKey,
      model: config.model,
      system: SUMMARY_SYSTEM_PROMPT,
      user: userPrompt,
      maxTokens: 400,
    });
    summary = r.text.trim();
  } catch (e) {
    summary = `(summary failed: ${(e as Error).message.slice(0, 200)})`;
  }

  const entry: CacheEntry = { generatedAt: now, lastCycle, summary };
  cache.set(cacheKey, entry);
  // Trim cache when it grows past 20 entries.
  if (cache.size > 20) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].generatedAt - b[1].generatedAt)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  return {
    summary,
    lastCycle,
    generatedAt: new Date(now).toISOString(),
    fromCache: false,
  };
}
