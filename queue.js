const $ = (sel) => document.querySelector(sel);

const SESSION_LABELS = { junior: '低齡組', senior: '高齡組' };
const PHASE_LABELS = {
  prelim: '初賽', revival: '復活賽', quarter: '複賽',
  challenge: '四強挑戰', semi: '準決賽', final: '決賽',
};

const params = new URLSearchParams(location.search);
let session = params.get('session') || 'junior';
let tournamentState = null;
let arenaLive = null;
let tournamentRevision = -1;

function playerName(data, id) {
  if (!id || !data?.players) return '待定';
  return data.players.find((p) => p.id === id)?.name || '待定';
}

function formatMatchHtml(data, match, scores) {
  if (!match?.p1Id && !match?.p2Id) return '<p class="queue-empty">—</p>';
  const title = match.label || PHASE_LABELS[match.phase] || '';
  const p1 = playerName(data, match.p1Id);
  const p2 = playerName(data, match.p2Id);
  const sc = scores ? `<p class="queue-match-score">${scores[0]} : ${scores[1]}</p>` : '';
  return `
    <p class="queue-match-title">${title}</p>
    <p class="queue-match-names"><span class="red">${p1}</span><span class="vs">VS</span><span class="blue">${p2}</span></p>
    ${sc}`;
}

function renderBroadcast() {
  const el = $('#queue-broadcast');
  if (!el) return;
  const status = arenaLive?.broadcastStatus;
  const msg = arenaLive?.broadcastMessage;
  if (status && status !== 'live' && (msg || status)) {
    el.hidden = false;
    el.dataset.status = status;
    const prefix = status === 'break' ? '休息' : status === 'delay' ? '延遲' : '';
    el.textContent = msg ? `${prefix} · ${msg}` : prefix;
  } else if (msg) {
    el.hidden = false;
    el.dataset.status = 'live';
    el.textContent = msg;
  } else {
    el.hidden = true;
    el.textContent = '';
  }
}

function render() {
  const data = tournamentState?.[session];
  $('#queue-session').textContent = SESSION_LABELS[session] || session;
  renderBroadcast();

  const nowEl = $('#queue-now-body');
  const ondeckEl = $('#queue-ondeck-body');
  const nextEl = $('#queue-next-body');

  const arenaFresh = arenaLive?.active
    && arenaLive.updatedAt
    && (Date.now() - arenaLive.updatedAt) < 30000
    && (arenaLive.session || session) === session;

  if (arenaFresh && !arenaLive.matchOver) {
    nowEl.innerHTML = `
      <p class="queue-match-title">${arenaLive.matchLabel || PHASE_LABELS[arenaLive.phase] || '進行中'}</p>
      <p class="queue-match-names"><span class="red">${arenaLive.p1Name || 'Blader 1'}</span><span class="vs">VS</span><span class="blue">${arenaLive.p2Name || 'Blader 2'}</span></p>
      <p class="queue-match-score">${(arenaLive.scores || [0, 0]).join(' : ')}</p>`;
  } else if (data?.drawn && data.activeMatchId) {
    const active = findMatchInData(data, data.activeMatchId);
    if (active?.p1Id && active?.p2Id && active.status !== 'done') {
      nowEl.innerHTML = formatMatchHtml(data, active, active.liveScores || active.scores);
    } else {
      nowEl.innerHTML = '<p class="queue-empty">等待開賽…</p>';
    }
  } else {
    nowEl.innerHTML = '<p class="queue-empty">等待對戰…</p>';
  }

  if (!data?.drawn) {
    ondeckEl.innerHTML = '<p class="queue-empty">尚未抽籤</p>';
    nextEl.innerHTML = '<p class="queue-empty">—</p>';
    return;
  }

  const queue = getQueueMatches(data, 3);
  ondeckEl.innerHTML = queue[0]
    ? formatMatchHtml(data, queue[0])
    : '<p class="queue-empty">—</p>';
  nextEl.innerHTML = queue[1]
    ? formatMatchHtml(data, queue[1])
    : '<p class="queue-empty">—</p>';
}

function findMatchInData(data, id) {
  return getAllMatches(data).find((m) => m.id === id);
}

function updateClock() {
  const el = $('#queue-clock');
  if (el) {
    el.textContent = new Date().toLocaleTimeString('zh-Hant', { hour: '2-digit', minute: '2-digit' });
  }
}

async function pollTournament() {
  try {
    const since = tournamentRevision < 0 ? -1 : tournamentRevision;
    const res = await fetch(`/tournament/state.json?since=${since}`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    if (data.junior !== undefined || data.senior !== undefined) {
      tournamentState = data;
      if (typeof data.revision === 'number') tournamentRevision = data.revision;
      render();
    }
  } catch { /* ignore */ }
}

async function pollArenaLive() {
  try {
    const res = await fetch('/arena/live.json', { cache: 'no-store' });
    if (!res.ok) return;
    arenaLive = await res.json();
    render();
  } catch { /* ignore */ }
}

pollTournament();
pollArenaLive();
updateClock();
setInterval(pollTournament, 2000);
setInterval(pollArenaLive, 800);
setInterval(updateClock, 10000);
