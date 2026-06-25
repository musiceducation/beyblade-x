const $ = (sel) => document.querySelector(sel);

const SESSION_LABELS = { junior: '低齡組', senior: '高齡組' };
const PHASE_LABELS = {
  prelim: '初賽', revival: '復活賽', quarter: '複賽',
  challenge: '四強挑戰', semi: '準決賽', final: '決賽',
};

let tournamentRevision = -1;
let tournamentState = null;
let arenaLive = null;
const params = new URLSearchParams(location.search);
let session = params.get('session') || 'junior';

function playerName(data, id) {
  if (!id || !data?.players) return '待定';
  return data.players.find((p) => p.id === id)?.name || '待定';
}

function phaseLabel(phase, matchLabel) {
  return matchLabel || PHASE_LABELS[phase] || phase || '';
}

function renderNextMatch(data) {
  const nextEl = $('#overlay-next');
  if (!data?.drawn) {
    nextEl.hidden = true;
    return;
  }
  const next = getAllMatches(data)
    .filter((m) => m.status === 'pending' && m.p1Id && m.p2Id)
    .slice(0, 1)[0];
  if (next) {
    nextEl.hidden = false;
    $('#overlay-next-text').textContent =
      `${next.label || PHASE_LABELS[next.phase] || ''} · ${playerName(data, next.p1Id)} vs ${playerName(data, next.p2Id)}`;
  } else {
    nextEl.hidden = true;
  }
}

function showLive(names, scores, battle, label) {
  const liveEl = $('#overlay-live');
  const emptyEl = $('#overlay-empty');
  liveEl.hidden = false;
  emptyEl.hidden = true;
  $('#overlay-p1-name').textContent = names[0];
  $('#overlay-p2-name').textContent = names[1];
  $('#overlay-p1-score').textContent = scores[0];
  $('#overlay-p2-score').textContent = scores[1];
  $('#overlay-battle').textContent = battle ? `第 ${battle} 局` : '進行中';
  $('#overlay-phase').textContent = label || '';
}

function render() {
  const data = tournamentState?.[session];
  const liveEl = $('#overlay-live');
  const emptyEl = $('#overlay-empty');

  const liveSession = arenaLive?.session || session;
  $('#overlay-session').textContent = SESSION_LABELS[liveSession] || liveSession;

  const arenaFresh = arenaLive?.active
    && arenaLive.updatedAt
    && (Date.now() - arenaLive.updatedAt) < 30000;

  if (arenaFresh && !arenaLive.matchOver) {
    showLive(
      [arenaLive.p1Name || 'Blader 1', arenaLive.p2Name || 'Blader 2'],
      arenaLive.scores || [0, 0],
      arenaLive.battle || 1,
      phaseLabel(arenaLive.phase, arenaLive.matchLabel),
    );
    renderNextMatch(data);
    return;
  }

  if (data?.drawn) {
    const matches = getAllMatches(data);
    const active = matches.find((m) => m.id === data.activeMatchId);

    if (active?.p1Id && active?.p2Id && active.status !== 'done') {
      showLive(
        [playerName(data, active.p1Id), playerName(data, active.p2Id)],
        active.liveScores || active.scores || [0, 0],
        active.liveBattles || active.battles || 1,
        phaseLabel(active.phase, active.label),
      );
    } else {
      liveEl.hidden = true;
      emptyEl.hidden = false;
      emptyEl.textContent = data.activeMatchId ? '等待開賽…' : '目前沒有進行中的對戰';
      $('#overlay-phase').textContent = '';
    }
    renderNextMatch(data);
    return;
  }

  liveEl.hidden = true;
  $('#overlay-next').hidden = true;
  emptyEl.hidden = false;
  emptyEl.textContent = arenaLive?.active ? '等待賽程資料…' : '尚未抽籤 · 請在主機開啟對戰';
  $('#overlay-phase').textContent = '';
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
    } else if (typeof data.revision === 'number') {
      tournamentRevision = Math.max(tournamentRevision, data.revision);
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
setInterval(pollTournament, 2000);
setInterval(pollArenaLive, 800);
