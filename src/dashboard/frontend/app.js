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
    fetchJson('/v2/overview').then((d) => renderOverview('v2-overview', d)),
    fetchJson('/v2/drives').then((d) => $('v2-drives').textContent = fmt(d?.summary ?? d)),
    fetchJson('/v2/identity').then((d) => $('v2-identity').textContent = fmt(d?.block ?? d)),
    fetchJson('/v2/goals').then((d) => $('v2-goals').textContent = fmt(d?.block ?? d)),
    fetchJson('/v2/coherence').then((d) => $('v2-coherence').textContent = fmt(d?.block ?? d)),
    fetchJson('/v2/watchdog').then((d) => $('v2-watchdog').textContent = fmt(d)),
    fetchJson('/v2/memory').then((d) => $('v2-memory').textContent = fmt(d)),
  ];
  const controlTasks = [
    fetchJson('/control/overview').then((d) => renderOverview('control-overview', d)),
    fetchJson('/control/memory').then((d) => $('control-memory').textContent = fmt(d)),
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

// ── cycle summaries (cheap-model paraphrase of last 5 cycles) ──
async function refreshSummaries() {
  const [v2, ctrl] = await Promise.all([
    fetchJson('/v2/cycle-summary'),
    fetchJson('/control/cycle-summary'),
  ]);
  renderSummary('v2', v2);
  renderSummary('control', ctrl);
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

function renderCycleEntry(kind, c) {
  const decisions = c.decisions ?? [];
  const actions = c.actions ?? [];
  const totalCost = decisions.reduce((s, d) => s + (d.costUsd || 0), 0);
  const totalTokens = decisions.reduce((s, d) => s + (d.promptTokens || 0) + (d.completionTokens || 0), 0);
  const ts = c.completedAt ?? c.startedAt ?? '';

  let body = '';
  for (const d of decisions) {
    body += `
      <div class="t-decision">
        <div class="t-d-meta">${escapeHtml(d.role)}/${escapeHtml(d.model)} · ${d.promptTokens}p+${d.completionTokens}c tok · $${(d.costUsd || 0).toFixed(6)}</div>
        <div class="t-d-output">${md(d.output)}</div>
      </div>`;
  }
  for (const a of actions) {
    const payload = a.payload !== undefined && a.payload !== null
      ? `<code class="t-payload">${escapeHtml(JSON.stringify(a.payload))}</code>`
      : '';
    body += `<div class="t-action"><span class="t-tag t-tag-action">action</span> <strong>${escapeHtml(String(a.action))}</strong> ${payload}</div>`;
  }
  return `
    <article class="t-entry t-${kind}">
      <header class="t-head">
        <span class="t-tag t-tag-${kind}">${kind}</span>
        <span class="t-cycle">cycle ${c.cycleNumber}</span>
        <span class="t-status t-status-${c.status}">${c.status}</span>
        <span class="t-cost">$${totalCost.toFixed(6)} · ${totalTokens} tok</span>
        <span class="t-time">${ts.slice(11, 19)}</span>
      </header>
      ${body}
    </article>`;
}

let currentCyclesCache = { v2: [], control: [] };
let renderScheduled = false;
const TRANSCRIPT_LIMIT = 30;
let loadingOlder = { v2: false, control: false };

function renderTranscript() {
  // Two columns side-by-side, V2 left + control right. Each column shows its
  // own cycles most-recent-first.
  const sortDesc = (a, b) => (b.startedAt || '').localeCompare(a.startedAt || '');
  const v2Sorted = [...currentCyclesCache.v2].sort(sortDesc);
  const ctrlSorted = [...currentCyclesCache.control].sort(sortDesc);
  const olderBtn = (kind, list) => list.length === 0 ? '' :
    `<button class="t-older" data-kind="${kind}">Load older cycles</button>`;
  $('transcript-v2').innerHTML = v2Sorted.length === 0
    ? '<div class="muted">no V2 cycles yet</div>'
    : v2Sorted.map((c) => renderCycleEntry('v2', c)).join('') + olderBtn('v2', v2Sorted);
  $('transcript-control').innerHTML = ctrlSorted.length === 0
    ? '<div class="muted">no control cycles yet</div>'
    : ctrlSorted.map((c) => renderCycleEntry('control', c)).join('') + olderBtn('control', ctrlSorted);
  $('v2-transcript-count').textContent = `${v2Sorted.length} cycles`;
  $('control-transcript-count').textContent = `${ctrlSorted.length} cycles`;
  $('transcript-status').textContent = `(${v2Sorted.length} V2 + ${ctrlSorted.length} control)`;

  document.querySelectorAll('.t-older').forEach((btn) => {
    btn.addEventListener('click', () => loadOlder(btn.dataset.kind));
  });
}

async function reloadTranscript() {
  // Recent slice — returns the newest TRANSCRIPT_LIMIT cycles. Lazy-load older
  // appends via loadOlder(kind).
  const [v2, ctrl] = await Promise.all([
    fetchJson(`/v2/transcript?limit=${TRANSCRIPT_LIMIT}`),
    fetchJson(`/control/transcript?limit=${TRANSCRIPT_LIMIT}`),
  ]);
  if (Array.isArray(v2)) currentCyclesCache.v2 = mergeCycles(currentCyclesCache.v2, v2);
  if (Array.isArray(ctrl)) currentCyclesCache.control = mergeCycles(currentCyclesCache.control, ctrl);
  renderTranscript();
}

function mergeCycles(existing, incoming) {
  // Dedup by cycleNumber + status (status can change running→complete).
  const map = new Map();
  for (const c of existing) map.set(c.cycleNumber, c);
  for (const c of incoming) map.set(c.cycleNumber, c);
  return Array.from(map.values());
}

async function loadOlder(kind) {
  if (loadingOlder[kind]) return;
  loadingOlder[kind] = true;
  const cache = currentCyclesCache[kind];
  const oldestCycleNumber = cache.length > 0
    ? Math.min(...cache.map((c) => c.cycleNumber))
    : undefined;
  const url = oldestCycleNumber !== undefined
    ? `/${kind}/transcript?limit=${TRANSCRIPT_LIMIT}&before=${oldestCycleNumber}`
    : `/${kind}/transcript?limit=${TRANSCRIPT_LIMIT}`;
  const data = await fetchJson(url);
  if (Array.isArray(data) && data.length > 0) {
    currentCyclesCache[kind] = mergeCycles(currentCyclesCache[kind], data);
    renderTranscript();
  }
  loadingOlder[kind] = false;
}

function scheduleTranscriptReload() {
  if (renderScheduled) return;
  renderScheduled = true;
  setTimeout(() => { renderScheduled = false; void reloadTranscript(); }, 1500);
}

function startSse() {
  let es;
  const connect = () => {
    es = new EventSource('/transcript/live');
    es.onerror = () => { es.close(); setTimeout(connect, 3000); };
    ['cycle', 'decision', 'action', 'summary', 'score', 'operator'].forEach((t) => {
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
