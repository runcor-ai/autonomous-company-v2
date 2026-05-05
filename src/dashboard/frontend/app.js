// runcor v2 dashboard — vanilla JS frontend.

const POLL_MS = 4000;
const TRANSCRIPT_MAX_LINES = 200;

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
  // axes
  ctx.strokeStyle = '#2a2a36';
  ctx.lineWidth = 1;
  // y-axis at left
  ctx.beginPath(); ctx.moveTo(40, 10); ctx.lineTo(40, H - 30); ctx.stroke();
  // 0-line
  const zeroY = (H - 30 + 10) / 2;
  ctx.strokeStyle = '#3a3a4a';
  ctx.beginPath(); ctx.moveTo(40, zeroY); ctx.lineTo(W - 10, zeroY); ctx.stroke();
  // labels
  ctx.fillStyle = '#8a8a96'; ctx.font = '11px monospace';
  ctx.fillText('+1', 8, 15);
  ctx.fillText(' 0', 14, zeroY + 4);
  ctx.fillText('-1', 12, H - 28);

  const scored = (perSummary ?? []).filter((s) => s.score !== null);
  if (scored.length === 0) {
    ctx.fillText('no scored summaries yet', 60, zeroY - 10);
    return;
  }
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
  drawSeries(v2, '#22d3ee');     // V2 = cyan (matches /coherence/ subpage palette)
  drawSeries(ctrl, '#a3e635');   // control = lime

  // legend
  ctx.fillStyle = '#22d3ee'; ctx.fillRect(W - 110, 14, 10, 10); ctx.fillStyle = '#ededef'; ctx.fillText('V2', W - 95, 23);
  ctx.fillStyle = '#a3e635'; ctx.fillRect(W - 60, 14, 10, 10); ctx.fillStyle = '#ededef'; ctx.fillText('control', W - 45, 23);
}

async function refreshScores() {
  // Operator-only — frontend obtains the bearer at boot from sessionStorage if present.
  const token = sessionStorage.getItem('opToken');
  if (!token) {
    $('current-score').textContent = '(scores require operator auth — no token)';
    return;
  }
  const data = await fetchJson('/scores', { headers: { Authorization: 'Bearer ' + token } });
  if (data?.error) { $('current-score').textContent = data.error; return; }
  drawChart(data.perSummary);
  if (data.currentScore) {
    const pct = ((data.currentScore.score + 1) / 2) * 100;
    $('spectrum-marker').style.left = pct + '%';
    $('current-score').textContent = `latest: ${data.currentScore.score.toFixed(2)} (${data.currentScore.raterModel})`;
  } else {
    $('current-score').textContent = '(no scored summary yet)';
  }
}

// ── live transcript via SSE ──
function startTranscript() {
  const el = $('transcript');
  el.textContent = '';
  const append = (line) => {
    el.textContent += line + '\n';
    const lines = el.textContent.split('\n');
    if (lines.length > TRANSCRIPT_MAX_LINES) {
      el.textContent = lines.slice(-TRANSCRIPT_MAX_LINES).join('\n');
    }
    el.scrollTop = el.scrollHeight;
  };
  let es;
  const connect = () => {
    es = new EventSource('/transcript/live');
    es.onopen = () => append('— connected —');
    es.onerror = () => { append('— disconnected, retrying in 3s —'); es.close(); setTimeout(connect, 3000); };
    ['cycle', 'decision', 'action', 'summary', 'score', 'operator'].forEach((t) => {
      es.addEventListener(t, (ev) => {
        try {
          const d = JSON.parse(ev.data);
          append(`[${d.ts}] ${d.kind}/${d.type} ${typeof d.payload === 'string' ? d.payload : JSON.stringify(d.payload)}`);
        } catch {
          append(`[?] ${ev.data}`);
        }
      });
    });
  };
  connect();
}

// ── boot ──
(async function () {
  // sessionStorage opToken bootstrap: ?opToken=... in URL grants the operator view.
  const params = new URLSearchParams(location.search);
  const token = params.get('opToken');
  if (token) { sessionStorage.setItem('opToken', token); history.replaceState({}, '', location.pathname); }

  await refreshOnce();
  await refreshScores();
  startTranscript();
  setInterval(refreshOnce, POLL_MS);
  setInterval(refreshScores, POLL_MS * 3);
})();
