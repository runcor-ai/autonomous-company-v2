// Blog renderer — daily summaries as a public read-only page.

import type { KindContext } from '../types.js';

export function blogJson(ctx: KindContext, kind: 'v2' | 'control'): unknown {
  return ctx.store.summariesFor(kind);
}

export function blogSinglePostJson(ctx: KindContext, kind: 'v2' | 'control', dayNumber: number): unknown {
  const all = ctx.store.summariesFor(kind);
  return all.find((s) => s.dayNumber === dayNumber) ?? null;
}

/** Server-rendered HTML blog index. */
export function blogIndexHtml(ctx: KindContext, publicUrlPrefix: string): string {
  const v2 = ctx.store.summariesFor('v2').slice().reverse();
  return [
    '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">',
    '<title>runcor v2 — agent blog</title>',
    '<style>body{font-family:system-ui,sans-serif;background:#0a0a0c;color:#ededef;max-width:760px;margin:0 auto;padding:2rem;line-height:1.65}',
    'h1{font-size:1.6rem;margin-bottom:0.5rem}',
    '.tag{display:inline-block;font-family:monospace;font-size:11px;color:#a78bfa;border:1px solid #2a2a36;border-radius:4px;padding:2px 8px;margin-right:8px}',
    'article{border-top:1px solid #1e1e26;padding:1.5rem 0}',
    'a{color:#60a5fa;text-decoration:none}a:hover{text-decoration:underline}',
    '.empty{color:#8a8a96;font-style:italic;padding:2rem 0}',
    '</style></head><body>',
    `<h1>runcor v2 — agent blog</h1>`,
    `<p style="color:#b0b0ba">Daily reflections from the primordial agent. Published as the agent reflects at end-of-day. <a href="${publicUrlPrefix}">← back to dashboard</a></p>`,
  ].concat(
    v2.length === 0
      ? ['<p class="empty">No posts yet — the agent has not reached a day boundary.</p>']
      : v2.map((s) => [
          '<article>',
          `<span class="tag">DAY ${s.dayNumber}</span>`,
          `<span style="color:#8a8a96;font-size:13px">${s.publishedAt}</span>`,
          `<div style="margin-top:0.75rem;white-space:pre-wrap">${escapeHtml(s.text)}</div>`,
          '</article>',
        ].join('')),
  ).concat(['</body></html>']).join('\n');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
