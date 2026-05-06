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
async function refreshOnce() {
  const v2Tasks = [
    fetchJson('/overview?role=v2').then((d) => renderOverview('v2-overview', d)),
    fetchJson('/drives?role=v2').then((d) => $('v2-drives').textContent = fmt(d?.summary ?? d)),
    fetchJson('/identity?role=v2').then((d) => $('v2-identity').textContent = fmt(d?.block ?? d)),
    fetchJson('/goals?role=v2').then((d) => $('v2-goals').textContent = fmt(d?.block ?? d)),
    fetchJson('/coherence?role=v2').then((d) => $('v2-coherence').textContent = fmt(d?.block ?? d)),
    fetchJson('/watchdog?role=v2').then((d) => $('v2-watchdog').textContent = fmt(d)),
    fetchJson('/memory?role=v2').then((d) => $('v2-memory').textContent = fmt(d)),
  ];
  const controlTasks = [
    fetchJson('/overview?role=control').then((d) => renderOverview('control-overview', d)),
    fetchJson('/memory?role=control').then((d) => $('control-memory').textContent = fmt(d)),
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
  // /scores is now PUBLIC (Constitution Principle III). No auth header needed.
  const data = await fetchJson('/scores');
  if (data?.error) {
    drawChart([]);
    $('current-score').textContent = `(${data.error})`;
    return;
  }
  drawChart(data.perSummary ?? []);
  if (data.currentScore) {
    const pct = ((data.currentScore.score + 1) / 2) * 100;
    $('spectrum-marker').style.left = pct + '%';
    const label = $('spectrum-score-label');
    if (label) {
      label.textContent = (data.currentScore.score >= 0 ? '+' : '') + data.currentScore.score.toFixed(2);
      label.style.left = pct + '%';
    }
    $('current-score').textContent = `latest: ${data.currentScore.score.toFixed(2)} (${data.currentScore.raterModel})`;
  } else {
    $('current-score').textContent = '(no scored summaries yet)';
  }
}

// ── hypotheses (emergence-claim evaluations) ──
async function refreshHypotheses() {
  const data = await fetchJson('/hypotheses');
  if (!Array.isArray(data)) {
    $('hypotheses').innerHTML = `<div class="muted">${data?.error ?? 'no data'}</div>`;
    return;
  }
  const cards = data.map((h) => {
    const e = h.latest;
    const status = e?.status ?? 'pending';
    const conf = e?.confidence != null ? `${(e.confidence * 100).toFixed(0)}%` : '—';
    const at = e?.evaluatedAt ? `cycle ${e.evaluatedAtV2Cycle} · ${e.evaluatedAt.slice(11, 19)} UTC` : 'not yet evaluated';
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

// ── cycle summaries (V2-002: derived from /cycle-summary which synthesizes recent
//    cycles from bus events — actions taken + reasoning per cycle, no LLM call) ──
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

  // Augmenting sections (goals / identity / drives / action mix).
  const renderText = (id, txt) => {
    const el = $(id);
    if (!el) return;
    if (txt && txt.trim()) {
      el.textContent = txt;
      el.classList.remove('summary-no-harness');
    } else {
      el.textContent = '(no harness)';
      el.classList.add('summary-no-harness');
    }
  };
  renderText(`${kind}-summary-goals`, data.goals);
  renderText(`${kind}-summary-identity`, data.identity);
  renderText(`${kind}-summary-drives`,
    data.drives ? `${data.drives.summary}  (max=${(data.drives.max ?? 0).toFixed(2)})` : '');

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

const TRANSCRIPT_LIMIT = 200;
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
    if (countEl) countEl.textContent = `${cycles.length} cycles`;
  }
  const statusEl = $('transcript-status');
  if (statusEl) {
    const v2Count = byRole.v2.size;
    const ctrlCount = byRole.control.size;
    statusEl.textContent = `(${v2Count} V2 + ${ctrlCount} control)`;
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

// ── boot ──
(async function () {
  const params = new URLSearchParams(location.search);
  const token = params.get('opToken');
  if (token) { sessionStorage.setItem('opToken', token); history.replaceState({}, '', location.pathname); }

  await refreshOnce();
  await refreshScores();
  await refreshSummaries();
  await refreshHypotheses();
  await reloadTranscript();
  startSse();
  setInterval(refreshOnce, POLL_MS);
  setInterval(refreshScores, POLL_MS);          // bar + chart update with the rest
  setInterval(refreshSummaries, 30_000);        // summaries refresh every 30s (server caches 60s)
  setInterval(refreshHypotheses, 60_000);       // hypotheses refresh every 60s (matcher ticks every 30 min)
})();
