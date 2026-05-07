// runcor v2 dashboard — vanilla JS frontend.

const POLL_MS = 4000;

// ── helpers ──
const $ = (id) => document.getElementById(id);
const fmt = (obj) => {
  if (obj === null || obj === undefined) return '';
  if (typeof obj === 'string') return obj;
  return JSON.stringify(obj, null, 2);
};

async function fetchJson(path, init = {}) {
  try {
    const res = await fetch(path, { ...init, cache: 'no-store' });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return await res.json();
  } catch (e) {
    return { error: String(e) };
  }
}

function renderOverview(elId, ov) {
  if (!ov || ov.error) { $(elId).textContent = ov?.error ?? '…'; return; }
  $(elId).innerHTML = `
    <div class="overview-row">
      <span class="badge">cycles</span><strong>${ov.cycleCount ?? 0}</strong>
      <span class="badge">last</span>${ov.lastCycleStatus ?? '—'}
      <span class="badge">spent</span>$${(ov.spentUsd ?? 0).toFixed(4)} / $${(ov.capUsd ?? 0).toFixed(2)}
      <span class="badge">summaries</span>${ov.summariesPublished ?? 0}
    </div>`;
}

// ── poll panels ──
// ── per-panel readable formatters (replace raw JSON dumps) ──
function formatDrives(d) {
  if (!d || d.error) return d?.error ?? 'no data';
  const drives = ['resource', 'curiosity', 'reactivity', 'coherence'];
  const lines = drives.map((k) => {
    const v = d[k] ?? 0;
    const bars = '█'.repeat(Math.round(v * 20)).padEnd(20, '·');
    return `${k.padEnd(11)} ${v.toFixed(2)}  ${bars}`;
  });
  lines.push('');
  lines.push(`computed at cycle ${d.computedAtCycle ?? '—'}`);
  return lines.join('\n');
}

function formatIdentity(d) {
  if (!d || d.error) return d?.error ?? 'no data';
  // Live shape from runcor-identity component (current + history).
  if (d.current) {
    const c = d.current;
    const lines = [
      `Self-theory v${c.version} (last reflected cycle ${c.lastReflectedCycle ?? 0})`,
    ];
    const claims = c.claims ?? [];
    if (claims.length > 0) {
      lines.push('');
      lines.push('Claims:');
      claims.slice(0, 6).forEach((cl) => lines.push(`  • ${cl}`));
    }
    const traits = c.traits ?? {};
    const traitKeys = Object.keys(traits);
    if (traitKeys.length > 0) {
      lines.push('');
      lines.push('Traits:');
      traitKeys.slice(0, 8).forEach((k) => lines.push(`  ${k.padEnd(14)} ${(+traits[k]).toFixed(2)}`));
    }
    if (claims.length === 0 && traitKeys.length === 0) {
      lines.push('');
      lines.push('(no claims or traits yet — first reflection has not produced content)');
    }
    return lines.join('\n');
  }
  // Legacy fallback shape (snapshot list).
  const snaps = d.snapshots ?? [];
  if (snaps.length === 0) return 'No identity reflections yet — the agent has not formed a self-theory.';
  return snaps.slice(0, 1).map((s) => String(s.content ?? '').trim()).join('\n');
}

function formatGoals(d) {
  if (!d || d.error) return d?.error ?? 'no data';
  // Live shape from runcor-goals component.
  if (Array.isArray(d.active)) {
    if (d.active.length === 0) return 'No active goals — periodic propose() calls have not produced accepted goals yet.';
    const lines = [];
    if (d.stack?.dominantGoalId != null) {
      lines.push(`Dominant goal id: ${d.stack.dominantGoalId} (intensity ${(+d.stack.maxIntensity || 0).toFixed(2)})`);
      lines.push('');
    }
    d.active.slice(0, 8).forEach((g) => {
      const lvl = g.level ? `[${g.level}]` : '';
      const intensity = typeof g.intensity === 'number' ? ` (i=${g.intensity.toFixed(2)})` : '';
      const text = g.text ?? g.statement ?? g.description ?? '(no text)';
      const cond = g.satisfactionCondition ? `\n     when: ${g.satisfactionCondition}` : '';
      lines.push(`${lvl} #${g.id}${intensity} — ${text}${cond}`);
    });
    return lines.join('\n');
  }
  // Legacy fallback (plan).
  if (!d.plan) return 'No goals proposed yet.';
  const items = d.plan.items ?? [];
  return items.length === 0 ? 'Plan exists but is empty.' : items.slice(0, 8).map((i) => `[${i.status}] ${i.text ?? ''}`).join('\n');
}

function formatCoherence(d) {
  if (!d || d.error) return d?.error ?? 'no data';
  // Live shape from runcor-coherence component.
  if (Array.isArray(d.problems) || Array.isArray(d.registeredEngines)) {
    const engines = d.registeredEngines ?? [];
    const problems = d.problems ?? [];
    const lines = [
      `${engines.length} registered engine${engines.length === 1 ? '' : 's'}`,
      `${problems.length} detected problem${problems.length === 1 ? '' : 's'}`,
    ];
    if (problems.length === 0 && engines.length === 0) {
      lines.push('');
      lines.push('(coherence component idle — no engines registered, no problems detected)');
    }
    if (problems.length > 0) {
      lines.push('');
      lines.push('Problems:');
      problems.slice(0, 4).forEach((p) => {
        const desc = p.description ?? p.problem ?? p.summary ?? JSON.stringify(p).slice(0, 100);
        lines.push(`  • ${desc}`);
      });
    }
    return lines.join('\n');
  }
  // Legacy fallback shape.
  const at = (d.activeTasks ?? []).length;
  const op = (d.openProblems ?? []).length;
  const fl = (d.initiatedFlows ?? []).length;
  return `${at} active · ${op} problems · ${fl} flows`;
}

function formatWatchdog(d) {
  if (!d || d.error) return d?.error ?? 'no data';
  const findings = d.findings ?? [];
  if (findings.length === 0) return 'No watchdog findings — the agent has not exhibited any flagged patterns.';
  return findings.slice(0, 5).map((f) => {
    const cat = f.category ?? '?';
    const cap = f.capability ? ` [${f.capability}]` : '';
    const problem = f.problem ?? f.summary ?? '';
    return `${cat}${cap}\n  ${problem}`;
  }).join('\n\n');
}

function formatMemory(d) {
  if (!d || d.error) return d?.error ?? 'no data';
  const s = d.stats ?? {};
  const short = s.shortCubeCount ?? 0;
  const long = s.longCubeCount ?? 0;
  const retired = s.retiredCount ?? 0;
  const lines = [
    `${short} short-term · ${long} long-term · ${retired} retired`,
    `Total active: ${short + long}`,
  ];
  const nodes = d.nodes ?? [];
  if (nodes.length > 0) {
    lines.push('');
    lines.push(`Recent (top ${Math.min(5, nodes.length)} by relevance):`);
    nodes.slice(0, 5).forEach((n) => {
      const content = String(n.content ?? '').replace(/\s+/g, ' ').slice(0, 110);
      const tags = (n.tags ?? []).slice(0, 2).join(',');
      const tagPart = tags ? `  [${tags}]` : '';
      lines.push(`  • ${content}${tagPart}`);
    });
  } else {
    lines.push('');
    lines.push('(no nodes recorded yet)');
  }
  return lines.join('\n');
}

async function refreshOnce() {
  const v2Tasks = [
    fetchJson('/overview?role=v2').then((d) => renderOverview('v2-overview', d)),
    fetchJson('/drives?role=v2').then((d) => $('v2-drives').textContent = formatDrives(d)),
    fetchJson('/identity?role=v2').then((d) => $('v2-identity').textContent = formatIdentity(d)),
    fetchJson('/goals?role=v2').then((d) => $('v2-goals').textContent = formatGoals(d)),
    fetchJson('/coherence?role=v2').then((d) => $('v2-coherence').textContent = formatCoherence(d)),
    fetchJson('/watchdog?role=v2').then((d) => $('v2-watchdog').textContent = formatWatchdog(d)),
    fetchJson('/memory?role=v2').then((d) => $('v2-memory').textContent = formatMemory(d)),
  ];
  const controlTasks = [
    fetchJson('/overview?role=control').then((d) => renderOverview('control-overview', d)),
    fetchJson('/memory?role=control').then((d) => $('control-memory').textContent = formatMemory(d)),
  ];
  await Promise.all([...v2Tasks, ...controlTasks]);
}

// ── good/evil chart ──
function drawChart(perSummary) {
  const c = $('chart');
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = '#2a2a36'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(40, 10); ctx.lineTo(40, H - 30); ctx.stroke();
  const zeroY = (H - 30 + 10) / 2;
  ctx.strokeStyle = '#3a3a4a';
  ctx.beginPath(); ctx.moveTo(40, zeroY); ctx.lineTo(W - 10, zeroY); ctx.stroke();
  ctx.fillStyle = '#8a8a96'; ctx.font = '11px monospace';
  ctx.fillText('+1', 8, 15); ctx.fillText(' 0', 14, zeroY + 4); ctx.fillText('-1', 12, H - 28);
  // Y-axis qualitative labels — horizontal, anchored at the chart edge.
  ctx.fillStyle = '#86efac'; ctx.font = 'bold 12px sans-serif';
  ctx.fillText('benevolent', 50, 28);
  ctx.fillStyle = '#fca5a5'; ctx.font = 'bold 12px sans-serif';
  ctx.fillText('harmful', 50, H - 14);

  const scored = (perSummary ?? []).filter((s) => s.score !== null);
  if (scored.length === 0) { ctx.fillText('no scored summaries yet', 60, zeroY - 10); return; }
  const v2 = scored.filter((s) => s.kind === 'v2');
  const ctrl = scored.filter((s) => s.kind === 'control');
  const drawSeries = (series, color) => {
    if (series.length === 0) return;
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath();
    series.forEach((s, i) => {
      const x = 40 + (i + 1) * ((W - 60) / Math.max(series.length, 1));
      const y = zeroY - s.score * ((H - 40) / 2);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    series.forEach((s, i) => {
      const x = 40 + (i + 1) * ((W - 60) / Math.max(series.length, 1));
      const y = zeroY - s.score * ((H - 40) / 2);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    });
  };
  drawSeries(v2, '#22d3ee');
  drawSeries(ctrl, '#a3e635');
  ctx.fillStyle = '#22d3ee'; ctx.fillRect(W - 110, 14, 10, 10); ctx.fillStyle = '#ededef'; ctx.fillText('V2', W - 95, 23);
  ctx.fillStyle = '#a3e635'; ctx.fillRect(W - 60, 14, 10, 10); ctx.fillStyle = '#ededef'; ctx.fillText('control', W - 45, 23);
}

async function refreshScores() {
  // /scores returns { v2: [...scores...], control: [...scores...] }.
  // Plot only the last 5 scores per role on the chart.
  const data = await fetchJson('/scores');
  if (data?.error) {
    drawChart([]);
    $('current-score').textContent = `(${data.error})`;
    return;
  }
  // Plot every score point both roles have produced. /scores returns newest-first;
  // reverse so the chart plots oldest-on-left, newest-on-right.
  const v2 = (data.v2 ?? []).slice().reverse();
  const ctrl = (data.control ?? []).slice().reverse();
  const merged = [
    ...v2.map((s) => ({ kind: 'v2', score: s.score })),
    ...ctrl.map((s) => ({ kind: 'control', score: s.score })),
  ];
  drawChart(merged);
  const latestV2 = (data.v2 ?? [])[0];
  const latestCtrl = (data.control ?? [])[0];
  const parts = [];
  if (latestV2) parts.push(`V2 latest: ${latestV2.score >= 0 ? '+' : ''}${latestV2.score.toFixed(2)} @ cycle ${latestV2.dayNumber}`);
  if (latestCtrl) parts.push(`control latest: ${latestCtrl.score >= 0 ? '+' : ''}${latestCtrl.score.toFixed(2)} @ cycle ${latestCtrl.dayNumber}`);
  $('current-score').textContent = parts.length > 0 ? parts.join(' · ') : '(no scored summaries yet)';
}

// ── hypotheses (emergence-claim evaluations) ──
async function refreshHypotheses() {
  const data = await fetchJson('/hypothesis');
  if (!Array.isArray(data)) {
    $('hypotheses').innerHTML = `<div class="muted">${data?.error ?? 'no data'}</div>`;
    return;
  }
  const cards = data.map((h) => {
    const e = h.latest;
    const status = e?.status ?? 'pending';
    const conf = e?.confidence != null ? `${(e.confidence * 100).toFixed(0)}%` : '—';
    const at = e?.evaluatedAt
      ? (() => {
          const ts = typeof e.evaluatedAt === 'number' ? new Date(e.evaluatedAt).toISOString() : String(e.evaluatedAt);
          const cyc = e.evaluatedAtV2Cycle != null ? `cycle ${e.evaluatedAtV2Cycle} · ` : '';
          return `${cyc}${ts.slice(11, 19)} UTC`;
        })()
      : 'not yet evaluated';
    const statusClass = `hyp-status-${status.replace(/[^a-z-]/g, '')}`;
    const description = `<details><summary class="hyp-desc-summary">definition</summary><div class="hyp-desc">${escapeHtml(h.description)}</div></details>`;
    const evalBody = e
      ? `<div class="hyp-reasoning">${escapeHtml(e.reasoning)}</div>
         <div class="hyp-evidence"><strong>evidence:</strong> ${escapeHtml(e.evidence)}</div>
         <div class="hyp-rebuttal"><strong>generic-LLM rebuttal:</strong> ${escapeHtml(e.genericLlmRebuttal)}</div>`
      : '<div class="muted">no evaluation yet — first matcher tick after V2 reaches cycle 5 + interval (30 min default)</div>';
    return `<article class="hyp-card">
      <header>
        <span class="hyp-status-badge ${statusClass}">${status}</span>
        <span class="hyp-conf">${conf}</span>
        <span class="hyp-title">${escapeHtml(h.title)}</span>
        <span class="hyp-at muted">${at}</span>
      </header>
      ${description}
      ${evalBody}
    </article>`;
  }).join('');
  $('hypotheses').innerHTML = cards;
}

// ── score summaries (paraphrase of recent harm/benevolent score trend, every 5 scores) ──
async function refreshScoreSummaries() {
  try {
    const [v2, ctrl] = await Promise.all([
      fetchJson('/score-summary?role=v2'),
      fetchJson('/score-summary?role=control'),
    ]);
    renderScoreSummary('v2', v2);
    renderScoreSummary('control', ctrl);
  } catch (_e) {
    renderScoreSummary('v2', { summary: '', chunkCount: 0 });
    renderScoreSummary('control', { summary: '', chunkCount: 0 });
  }
}
function renderScoreSummary(kind, data) {
  const body = $(`${kind}-score-summary`);
  const meta = $(`${kind}-score-summary-meta`);
  if (!body) return;
  if (!data || data.error) {
    body.textContent = data?.error ?? '(no data)';
    if (meta) meta.textContent = '';
    return;
  }
  body.innerHTML = md(data.summary || '_No score summary yet — first overall summary after the first scoring round._');
  if (meta) {
    const lastEnd = data.lastEndCycle ?? 0;
    const count = data.scoreCount ?? 0;
    const mean = data.meanScore;
    if (lastEnd > 0 && count > 0) {
      const meanPart = typeof mean === 'number' ? ` · mean ${mean >= 0 ? '+' : ''}${mean.toFixed(2)}` : '';
      meta.textContent = `${count} score${count === 1 ? '' : 's'} · through cycle ${lastEnd}${meanPart}`;
    } else {
      meta.textContent = '';
    }
  }
}

// ── cycle summaries (V2-002: derived from /cycle-summary, hierarchical L1 chunks) ──
async function refreshSummaries() {
  try {
    const [v2, ctrl] = await Promise.all([
      fetchJson('/cycle-summary?role=v2&limit=5'),
      fetchJson('/cycle-summary?role=control&limit=5'),
    ]);
    renderSummary('v2', v2);
    renderSummary('control', ctrl);
  } catch (_e) {
    renderSummary('v2', { summary: '', lastCycle: 0, generatedAt: '', actionMix: [] });
    renderSummary('control', { summary: '', lastCycle: 0, generatedAt: '', actionMix: [] });
  }
}
function renderSummary(kind, data) {
  const body = $(`${kind}-summary`);
  const meta = $(`${kind}-summary-meta`);
  if (!data || data.error) {
    body.textContent = data?.error ?? '(no data)';
    meta.textContent = '';
    return;
  }
  body.innerHTML = md(data.summary || '(empty)');
  const cached = data.fromCache ? ' (cached)' : '';
  meta.textContent = `cycle ${data.lastCycle} · ${(data.generatedAt ?? '').slice(11, 19)} UTC${cached}`;

  // GOALS/IDENTITY/DRIVES used to live in the summary panel but they have
  // dedicated panels at the top of the dashboard now — removed to avoid
  // duplication and the misleading "(no harness)" labels for V2.

  const mixEl = $(`${kind}-summary-actionmix`);
  if (mixEl) {
    const mix = data.actionMix || [];
    const total = mix.reduce((s, m) => s + m.count, 0);
    if (total === 0) {
      mixEl.textContent = '(no actions yet)';
    } else {
      mixEl.innerHTML = mix.map((m) => {
        const pct = Math.round((m.count / total) * 100);
        const dots = '•'.repeat(Math.max(1, Math.round(m.count / 2)));
        return `<div class="amix-row"><code>${m.action}</code> <span class="amix-dots">${dots}</span> <span class="amix-pct">${m.count} (${pct}%)</span></div>`;
      }).join('');
    }
  }
}

// ── transcript: history-on-load + live updates + markdown rendering ──

const md = (text) => {
  if (!text || typeof text !== 'string') return '';
  try {
    const html = window.marked.parse(text, { breaks: true, gfm: true });
    return window.DOMPurify.sanitize(html);
  } catch {
    return escapeHtml(text);
  }
};
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

// V2-002 transcript: bus events grouped by (agentRole, cycle). Each cycle shows the
// events that fired during it (prompt_assembled, discernment, cost_request, etc).

const TRANSCRIPT_LIMIT = 5000; // matches server cap (≈ 570 cycles of history per role)
let renderScheduled = false;

// Parse model output text — usually JSON {action, args, reasoning} but may be plain markdown.
function renderModelOutput(text) {
  if (!text || typeof text !== 'string') return '';
  // Strip ```json ... ``` fence if model wrapped its JSON in code blocks.
  const fenceMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/);
  const stripped = fenceMatch ? fenceMatch[1].trim() : text.trim();
  let parsed = null;
  try { parsed = JSON.parse(stripped); } catch (_) { /* not JSON */ }
  if (parsed && typeof parsed === 'object') {
    const action = parsed.action ?? '(none)';
    const args = parsed.args ? `<code class="t-payload">${escapeHtml(JSON.stringify(parsed.args))}</code>` : '';
    const reasoning = typeof parsed.reasoning === 'string' && parsed.reasoning.trim()
      ? `<div class="t-reasoning">${md(parsed.reasoning)}</div>`
      : '';
    return `
      <div class="t-action"><span class="t-tag t-tag-action">action</span> <strong>${escapeHtml(String(action))}</strong> ${args}</div>
      ${reasoning}`;
  }
  // Free-form markdown response (e.g. dialectic Player/Coach/Judge prose).
  return `<div class="t-d-output">${md(text)}</div>`;
}

function renderEventLine(ev) {
  const time = new Date(ev.ts ?? Date.now()).toISOString().slice(11, 19);
  const type = ev.event ?? '?';
  const data = ev.data ?? {};
  // Rich rendering for the events that carry model output.
  if (type === 'execution_complete') {
    const text = data?.result?.text ?? '';
    const model = data?.result?.model ?? '?';
    const provider = data?.result?.provider ?? '?';
    const usage = data?.result?.usage;
    const tokenSummary = usage ? `${usage.promptTokens ?? 0}p + ${usage.completionTokens ?? 0}c tok` : '';
    return `
      <div class="t-event t-execution-complete">
        <div class="t-d-meta"><span class="t-time">${time}</span> <span class="t-tag">${type}</span> ${escapeHtml(provider)}/${escapeHtml(model)} · ${escapeHtml(tokenSummary)}</div>
        ${renderModelOutput(text)}
      </div>`;
  }
  let summary = '';
  if (type === 'cycle_record') {
    summary = `status=${data.status ?? '?'} (${(data.endedAt ?? 0) - (data.startedAt ?? 0)}ms)`;
  } else if (type === 'prompt_assembled') {
    summary = `layers=[${(data.nonEmptyLayers ?? []).join(',')}]`;
  } else if (type === 'discernment') {
    summary = `verdict=${data.verdict ?? data.outcome ?? '?'}`;
  } else if (type === 'discernment_flagged') {
    summary = `law=${data.failedLawId ?? '?'}`;
  } else if (type === 'cost_request') {
    summary = `cost=$${(data.cost ?? 0).toFixed(6)} model=${data.model ?? '?'} (${data.promptTokens ?? 0}p+${data.completionTokens ?? 0}c)`;
  } else if (type === 'next_wake_scheduled') {
    summary = `${Math.round((data.ms ?? 0) / 1000)}s — ${data.reason ?? ''}`;
  } else if (type === 'adapter_tool_call') {
    summary = `${data.toolName ?? data.tool ?? '?'} ${data.success === false ? '(failed)' : ''}`;
  } else {
    summary = JSON.stringify(data).slice(0, 100);
  }
  return `<div class="t-event"><span class="t-time">${time}</span> <span class="t-tag">${type}</span> ${escapeHtml(summary)}</div>`;
}

function renderCycleBlock(kind, cycle, events) {
  const evs = events.map(renderEventLine).join('');
  return `<article class="t-entry t-${kind}">
    <header class="t-head">
      <span class="t-tag t-tag-${kind}">${kind}</span>
      <span class="t-cycle">cycle ${cycle}</span>
      <span class="t-status">${events.length} events</span>
    </header>
    ${evs}
  </article>`;
}

let cachedEvents = [];

function renderTranscript() {
  // Group events by (agentRole, cycle). Render most-recent cycle first per column.
  const byRole = { v2: new Map(), control: new Map() };
  for (const ev of cachedEvents) {
    const role = ev.data?.agentRole === 'control' ? 'control' : 'v2';
    const cycle = typeof ev.data?.cycle === 'number' ? ev.data.cycle : -1;
    if (!byRole[role].has(cycle)) byRole[role].set(cycle, []);
    byRole[role].get(cycle).push(ev);
  }

  for (const role of ['v2', 'control']) {
    const cycles = Array.from(byRole[role].entries()).sort((a, b) => b[0] - a[0]);
    const el = $(`transcript-${role}`);
    if (!el) continue;
    el.innerHTML = cycles.length === 0
      ? `<div class="muted">no ${role} events yet</div>`
      : cycles.map(([c, evs]) => renderCycleBlock(role, c, evs)).join('');
    const countEl = $(`${role}-transcript-count`);
    if (countEl) countEl.textContent = `${cycles.length} cycles in buffer`;
  }
  const statusEl = $('transcript-status');
  if (statusEl) {
    const v2Count = byRole.v2.size;
    const ctrlCount = byRole.control.size;
    statusEl.textContent = `(buffer: ${v2Count} V2 + ${ctrlCount} control cycles — older history evicted from ring)`;
  }
}

async function reloadTranscript() {
  const data = await fetchJson(`/transcript?limit=${TRANSCRIPT_LIMIT}`);
  if (data?.events && Array.isArray(data.events)) {
    cachedEvents = data.events;
    renderTranscript();
  }
}

function scheduleTranscriptReload() {
  if (renderScheduled) return;
  renderScheduled = true;
  setTimeout(() => { renderScheduled = false; void reloadTranscript(); }, 1500);
}

function startSse() {
  let es;
  const connect = () => {
    es = new EventSource('/transcript');
    es.onerror = () => { es.close(); setTimeout(connect, 3000); };
    // V2-002 emits these event types per src/dashboard/server.ts eventNames list.
    const eventTypes = [
      'cycle_record', 'prompt_assembled', 'discernment', 'discernment_flagged',
      'flag_burst_warning', 'cost_request', 'execution_state_change',
      'execution_complete', 'adapter_tool_call', 'next_wake_scheduled',
      'day_boundary', 'harness_engaged', 'harness_disengaged',
    ];
    eventTypes.forEach((t) => {
      es.addEventListener(t, () => scheduleTranscriptReload());
    });
  };
  connect();
}

// Transcript tabs — switch between V2 and control panes (full-width per pane).
document.querySelectorAll('.t-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    const which = btn.dataset.tab;
    document.querySelectorAll('.t-tab').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.transcript-pane').forEach((p) => {
      p.style.display = p.dataset.pane === which ? '' : 'none';
    });
  });
});

// ── boot ──
(async function () {
  const params = new URLSearchParams(location.search);
  const token = params.get('opToken');
  if (token) { sessionStorage.setItem('opToken', token); history.replaceState({}, '', location.pathname); }

  await refreshOnce();
  await refreshScores();
  await refreshSummaries();
  await refreshScoreSummaries();
  await refreshHypotheses();
  await reloadTranscript();
  startSse();
  setInterval(refreshOnce, POLL_MS);
  setInterval(refreshScores, 150_000);
  setInterval(refreshSummaries, 150_000);
  setInterval(refreshScoreSummaries, 150_000);
  setInterval(refreshHypotheses, 150_000);
})();
