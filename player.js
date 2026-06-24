/**
 * Player spectator portal — read-only schedule, live scores, replays
 */

const $ = (sel) => document.querySelector(sel);

const PHASE_LABELS = {
  prelim: '初賽',
  revival: '復活賽',
  quarter: '複賽',
  challenge: '四強挑戰',
  semi: '準決賽',
  final: '決賽',
};

const PHASE_ORDER = { prelim: 0, revival: 1, quarter: 2, challenge: 3, semi: 4, final: 5 };

const SESSION_LABELS = {
  junior: '第一場 低齡組',
  senior: '第二場 高齡組',
};

const state = {
  session: 'junior',
  search: '',
  tab: 'live',
  tournamentRevision: -1,
  replayRevision: -1,
  tournament: null,
  replays: [],
  activeReplayId: null,
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setSyncStatus(status) {
  const dot = $('#player-sync-dot');
  if (dot) dot.dataset.status = status;
}

function getSessionData() {
  if (!state.tournament) return null;
  return state.tournament[state.session] || null;
}

function playerName(data, id) {
  if (!id || !data?.players) return '待定';
  const p = data.players.find((x) => x.id === id);
  return p ? p.name : '待定';
}

function getAllMatches(data) {
  const m = data?.matches;
  if (!m?.prelim) return [];
  return [
    ...m.prelim,
    ...(m.quarter || []),
    ...(m.revival || []),
    ...(m.challenge ? [m.challenge] : []),
    ...(m.semi || []),
    ...(m.final ? [m.final] : []),
  ];
}

function matchInvolvesName(match, data, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  const n1 = playerName(data, match.p1Id).toLowerCase();
  const n2 = playerName(data, match.p2Id).toLowerCase();
  return n1.includes(q) || n2.includes(q);
}

function formatMatchScore(match) {
  const scores = match.status === 'done' ? match.scores : match.liveScores;
  if (!scores) return '';
  return `${scores[0]} : ${scores[1]}`;
}

function groupReplaysByMatch(replays) {
  const map = new Map();
  replays.forEach((r) => {
    const gid = r.matchGroupId || r.id;
    if (!map.has(gid)) map.set(gid, []);
    map.get(gid).push(r);
  });
  return [...map.values()]
    .map((rounds) => rounds.sort((a, b) => a.battleNum - b.battleNum || (a.createdAt || '').localeCompare(b.createdAt || '')))
    .sort((a, b) => (b[0]?.createdAt || '').localeCompare(a[0]?.createdAt || ''));
}

function replayMatchesSearch(replay, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return (replay.p1Name || '').toLowerCase().includes(q)
    || (replay.p2Name || '').toLowerCase().includes(q);
}

function renderLive() {
  const data = getSessionData();
  const activeCard = $('#live-active');
  const empty = $('#live-empty');
  const nextEl = $('#live-next');

  if (!data?.drawn) {
    activeCard.hidden = true;
    empty.hidden = false;
    empty.textContent = '尚未抽籤';
    nextEl.hidden = true;
    return;
  }

  const matches = getAllMatches(data);
  const active = matches.find((m) => m.id === data.activeMatchId);

  if (active && active.p1Id && active.p2Id) {
    activeCard.hidden = false;
    empty.hidden = true;
    $('#live-match-title').textContent = active.label || PHASE_LABELS[active.phase] || '對戰';
    $('#live-p1-name').textContent = playerName(data, active.p1Id);
    $('#live-p2-name').textContent = playerName(data, active.p2Id);
    const scores = active.liveScores || active.scores || [0, 0];
    $('#live-p1-score').textContent = scores[0];
    $('#live-p2-score').textContent = scores[1];
    const battle = active.liveBattles || active.battles;
    $('#live-battle').textContent = battle ? `第 ${battle} 局` : '進行中';
  } else {
    activeCard.hidden = true;
    empty.hidden = false;
    empty.textContent = '目前沒有進行中的對戰';
  }

  const ready = matches
    .filter((m) => m.status === 'pending' && m.p1Id && m.p2Id)
    .filter((m) => matchInvolvesName(m, data, state.search))
    .sort((a, b) => (PHASE_ORDER[a.phase] ?? 9) - (PHASE_ORDER[b.phase] ?? 9))
    .slice(0, 3);

  if (ready.length) {
    nextEl.hidden = false;
    nextEl.innerHTML = `
      <h3>即將開始</h3>
      <ul class="schedule-list">
        ${ready.map((m) => `
          <li class="schedule-card">
            <div class="schedule-card-head">
              <span class="schedule-phase">${escapeHtml(m.label || PHASE_LABELS[m.phase] || '')}</span>
              <span class="schedule-status">待賽</span>
            </div>
            <div class="schedule-slots">
              <div class="schedule-slot red">${escapeHtml(playerName(data, m.p1Id))}</div>
              <div class="schedule-slot blue">${escapeHtml(playerName(data, m.p2Id))}</div>
            </div>
          </li>`).join('')}
      </ul>`;
  } else {
    nextEl.hidden = true;
  }
}

function renderSchedule() {
  const data = getSessionData();
  const list = $('#schedule-list');
  const empty = $('#schedule-empty');
  const progress = $('#schedule-progress');

  if (!data?.drawn || !data.matches?.prelim) {
    list.innerHTML = '';
    empty.hidden = false;
    progress.innerHTML = '';
    return;
  }

  empty.hidden = true;
  let matches = getAllMatches(data).filter((m) => m.p1Id || m.p2Id);
  if (state.search) {
    matches = matches.filter((m) => matchInvolvesName(m, data, state.search));
  }
  matches.sort((a, b) => (PHASE_ORDER[a.phase] ?? 9) - (PHASE_ORDER[b.phase] ?? 9));

  const all = getAllMatches(data).filter((m) => m.p1Id || m.p2Id);
  const done = all.filter((m) => m.status === 'done').length;
  const pct = all.length ? Math.round((done / all.length) * 100) : 0;
  progress.innerHTML = `<strong>${SESSION_LABELS[state.session]}</strong> · 已完成 ${done}/${all.length} 場（${pct}%）`;

  if (!matches.length) {
    list.innerHTML = '';
    empty.hidden = false;
    empty.textContent = state.search ? '找不到相關對戰' : '尚無賽程';
    return;
  }

  list.innerHTML = matches.map((m) => {
    const isActive = m.id === data.activeMatchId;
    const status = m.status === 'done' ? 'done' : isActive ? 'active' : 'pending';
    const statusLabel = m.status === 'done' ? '完畢' : isActive ? '進行中' : '待賽';
    const p1Win = m.winnerId === m.p1Id;
    const p2Win = m.winnerId === m.p2Id;
    const scoreText = formatMatchScore(m);
    const highlight = state.search && matchInvolvesName(m, data, state.search) ? ' highlight' : '';

    return `
      <article class="schedule-card ${status}${highlight}" data-match-id="${m.id}">
        <div class="schedule-card-head">
          <span class="schedule-phase">${escapeHtml(m.label || PHASE_LABELS[m.phase] || m.phase)}</span>
          <span class="schedule-status ${status}">${statusLabel}${scoreText ? ` · ${scoreText}` : ''}</span>
        </div>
        <div class="schedule-slots">
          <div class="schedule-slot red${p1Win ? ' winner' : ''}">
            <span>${escapeHtml(playerName(data, m.p1Id))}</span>
            ${isActive && m.liveScores ? `<span class="schedule-score-badge">${m.liveScores[0]}</span>` : ''}
          </div>
          <div class="schedule-slot blue${p2Win ? ' winner' : ''}">
            <span>${escapeHtml(playerName(data, m.p2Id))}</span>
            ${isActive && m.liveScores ? `<span class="schedule-score-badge">${m.liveScores[1]}</span>` : ''}
          </div>
        </div>
      </article>`;
  }).join('');
}

function renderReplays() {
  const list = $('#replay-list');
  const empty = $('#replay-empty');
  let replays = state.replays;

  if (state.search) {
    replays = replays.filter((r) => replayMatchesSearch(r, state.search));
  }

  if (!replays.length) {
    list.innerHTML = '';
    empty.hidden = false;
    empty.textContent = state.search ? '找不到相關回放' : '尚無回放';
    return;
  }

  empty.hidden = true;
  const groups = groupReplaysByMatch(replays);

  list.innerHTML = groups.map((rounds) => {
    const last = rounds[rounds.length - 1];
    const total = last.finalScores || [0, 0];
    const gid = last.matchGroupId || last.id;
    const roundsHtml = rounds.map((r) => {
      const delta = [
        (r.finalScores?.[0] ?? 0) - (r.startScores?.[0] ?? 0),
        (r.finalScores?.[1] ?? 0) - (r.startScores?.[1] ?? 0),
      ];
      const active = r.id === state.activeReplayId ? ' active' : '';
      const videoTag = r.hasVideo || r.videoId ? '<span class="has-video">影片</span>' : '';
      return `
        <button type="button" class="replay-round-btn${active}" data-replay-id="${r.id}">
          <span>第 ${r.battleNum} 局 · +${delta[0]}:+${delta[1]}${videoTag}</span>
          <span class="schedule-score-badge">${r.finalScores?.[0] ?? 0}:${r.finalScores?.[1] ?? 0}</span>
        </button>`;
    }).join('');

    return `
      <div class="replay-group" data-group-id="${gid}">
        <div class="replay-group-head">
          ${escapeHtml(last.p1Name || 'Blader 1')} vs ${escapeHtml(last.p2Name || 'Blader 2')}
          <span class="replay-group-meta">共 ${rounds.length} 局 · 總分 ${total[0]}:${total[1]}</span>
        </div>
        ${roundsHtml}
      </div>`;
  }).join('');
}

function renderAll() {
  renderLive();
  renderSchedule();
  renderReplays();
}

function switchTab(tabId) {
  state.tab = tabId;
  $$('.player-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  $$('.player-section').forEach((sec) => {
    const isActive = sec.id === `tab-${tabId}`;
    sec.classList.toggle('active', isActive);
    sec.hidden = !isActive;
  });
}

function $$(sel) {
  return [...document.querySelectorAll(sel)];
}

async function pollTournament() {
  try {
    const r = await fetch(`/tournament/state.json?since=${state.tournamentRevision}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    const data = await r.json();
    if (typeof data.revision === 'number' && data.revision > state.tournamentRevision) {
      state.tournamentRevision = data.revision;
      state.tournament = data;
      renderAll();
    }
    setSyncStatus('synced');
  } catch {
    setSyncStatus('error');
  }
}

async function pollReplays() {
  try {
    const r = await fetch(`/replay/index.json?since=${state.replayRevision}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    const data = await r.json();
    if (typeof data.revision === 'number' && data.revision > state.replayRevision) {
      state.replayRevision = data.revision;
      state.replays = data.replays || [];
      renderReplays();
    }
  } catch {
    /* replay poll failure is non-fatal */
  }
}

function replayDownloadFilename(replay) {
  const safe = (s) => String(s || '').replace(/[^\w\u4e00-\u9fff-]+/g, '-').replace(/^-|-$/g, '') || 'player';
  return `beyblade-${safe(replay.p1Name)}-vs-${safe(replay.p2Name)}-b${replay.battleNum}.webm`;
}

async function downloadReplayVideo(replay) {
  const videoUrl = `/replay/${replay.id}/video.webm`;
  const filename = replayDownloadFilename(replay);
  try {
    const res = await fetch(`${videoUrl}?download=1`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`download ${res.status}`);
    const blobUrl = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);
  } catch (err) {
    console.warn('Replay download failed', err);
    window.open(videoUrl, '_blank', 'noopener');
  }
}

function playReplay(replayId) {
  const replay = state.replays.find((r) => r.id === replayId);
  if (!replay) return;

  state.activeReplayId = replayId;
  const player = $('#replay-player');
  const video = $('#replay-video');
  const title = $('#replay-player-title');
  const downloadBtn = $('#btn-replay-download');
  const hasVideo = replay.hasVideo || replay.videoId;

  player.hidden = false;
  title.textContent = `${replay.p1Name} vs ${replay.p2Name} · 第 ${replay.battleNum} 局`;

  if (hasVideo) {
    video.src = `/replay/${replay.id}/video.webm`;
    video.hidden = false;
    video.play().catch(() => {});
    if (downloadBtn) {
      downloadBtn.hidden = false;
      downloadBtn.onclick = () => { downloadReplayVideo(replay).catch(console.error); };
    }
  } else {
    video.removeAttribute('src');
    video.hidden = true;
    title.textContent += '（無影片）';
    if (downloadBtn) downloadBtn.hidden = true;
  }

  renderReplays();
  switchTab('replay');
  player.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function initPlayerPortal() {
  $('#player-session')?.addEventListener('change', (e) => {
    state.session = e.target.value;
    renderAll();
  });

  $('#player-search')?.addEventListener('input', (e) => {
    state.search = e.target.value.trim();
    renderAll();
  });

  $$('.player-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  $('#replay-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.replay-round-btn');
    if (btn?.dataset.replayId) playReplay(btn.dataset.replayId);
  });

  pollTournament();
  pollReplays();
  setInterval(pollTournament, 1500);
  setInterval(pollReplays, 1500);
}

document.addEventListener('DOMContentLoaded', initPlayerPortal);
