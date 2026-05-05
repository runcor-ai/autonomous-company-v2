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
  // Bar + chart are always visible. We only POPULATE them when authenticated AND
  // scores exist. No auth = silent (chart shows empty axes; bar stays at 0/—).
  const token = sessionStorage.getItem('opToken');
  if (!token) {
    drawChart([]);
    $('current-score').textContent = '(no scored summaries yet)';
    return;
  }
  const data = await fetchJson('/scores', { headers: { Authorization: 'Bearer ' + token } });
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

function renderTranscript() {
  const showV2 = $('filter-v2').checked;
  const showControl = $('filter-control').checked;
  const merged = [];
  if (showV2) for (const c of currentCyclesCache.v2) merged.push(['v2', c]);
  if (showControl) for (const c of currentCyclesCache.control) merged.push(['control', c]);
  // Most recent first.
  merged.sort((a, b) => {
    const ta = a[1].startedAt || '';
    const tb = b[1].startedAt || '';
    return tb.localeCompare(ta);
  });
  const html = merged.map(([k, c]) => renderCycleEntry(k, c)).join('');
  $('transcript').innerHTML = html || '<div class="muted">no cycles yet</div>';
  $('transcript-status').textContent = `${currentCyclesCache.v2.length} V2 + ${currentCyclesCache.control.length} control cycles`;
}

async function reloadTranscript() {
  const [v2, ctrl] = await Promise.all([
    fetchJson('/v2/transcript'),
    fetchJson('/control/transcript'),
  ]);
  if (Array.isArray(v2)) currentCyclesCache.v2 = v2;
  if (Array.isArray(ctrl)) currentCyclesCache.control = ctrl;
  renderTranscript();
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

  $('filter-v2').addEventListener('change', renderTranscript);
  $('filter-control').addEventListener('change', renderTranscript);

  await refreshOnce();
  await refreshScores();
  await reloadTranscript();
  startSse();
  setInterval(refreshOnce, POLL_MS);
  setInterval(refreshScores, POLL_MS * 3);
})();
