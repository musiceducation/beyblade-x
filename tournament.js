/**
 * Tournament — roster, draw, bracket schedule
 */

const MAX_PLAYERS = 16;
const STORAGE_KEY = 'beyblade-tournament-v1';
const SYNC_POLL_MS = 1500;
const LIVE_SYNC_DEBOUNCE_MS = 200;

const tournamentSync = {
  enabled: false,
  revision: 0,
  applyingRemote: false,
  pushing: false,
  pendingConflict: null,
  pollTimer: null,
  liveSyncTimer: null,
};

const tournamentState = {
  session: 'junior',
  players: [],
  drawn: false,
  matches: {},
  eliminatedIds: [],
  revivalWinnerId: null,
  activeMatchId: null,
};

function createEmptySessionData() {
  return {
    players: [],
    drawn: false,
    matches: {},
    eliminatedIds: [],
    revivalWinnerId: null,
    activeMatchId: null,
  };
}

function loadTournamentStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { junior: createEmptySessionData(), senior: createEmptySessionData() };
  } catch {
    return { junior: createEmptySessionData(), senior: createEmptySessionData() };
  }
}

function saveTournamentStorage(all) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

function buildSessionPayload() {
  return {
    players: tournamentState.players,
    drawn: tournamentState.drawn,
    matches: tournamentState.matches,
    eliminatedIds: tournamentState.eliminatedIds,
    revivalWinnerId: tournamentState.revivalWinnerId,
    activeMatchId: tournamentState.activeMatchId,
  };
}

function buildFullSyncPayload() {
  const all = loadTournamentStorage();
  all[tournamentState.session] = buildSessionPayload();
  return {
    revision: tournamentSync.revision,
    junior: all.junior || createEmptySessionData(),
    senior: all.senior || createEmptySessionData(),
  };
}

function sessionHasData(data) {
  return Boolean(
    data?.drawn
    || (data?.players?.length > 0)
    || (data?.matches && Object.keys(data.matches).length > 0)
  );
}

function applySessionData(data) {
  tournamentState.players = data.players || [];
  tournamentState.drawn = data.drawn || false;
  tournamentState.matches = data.matches || {};
  tournamentState.eliminatedIds = data.eliminatedIds || [];
  tournamentState.revivalWinnerId = data.revivalWinnerId || null;
  tournamentState.activeMatchId = data.activeMatchId || null;
}

function applyRemoteTournamentState(remote) {
  if (!remote || typeof remote.revision !== 'number') return false;
  if (remote.revision <= tournamentSync.revision) return false;
  if (tournamentSync.pendingConflict) return false;

  tournamentSync.applyingRemote = true;
  tournamentSync.revision = remote.revision;

  const all = loadTournamentStorage();
  ['junior', 'senior'].forEach((session) => {
    if (remote[session]) {
      all[session] = {
        ...createEmptySessionData(),
        ...remote[session],
      };
    }
  });
  saveTournamentStorage(all);

  const currentSession = tournamentState.session;
  applySessionData(all[currentSession] || createEmptySessionData());
  advanceWinners();
  renderTournamentUI({ scrollActive: false });
  updateSyncIndicator('synced');
  tournamentSync.applyingRemote = false;
  return true;
}

async function pushTournamentState() {
  if (!tournamentSync.enabled || tournamentSync.applyingRemote || tournamentSync.pushing) return;

  tournamentSync.pushing = true;
  updateSyncIndicator('syncing');
  try {
    const res = await fetch('/tournament/state.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildFullSyncPayload()),
      cache: 'no-store',
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      tournamentSync.revision = data.revision;
      updateSyncIndicator('synced');
      if (typeof pushTournamentPayloadToSupabase === 'function') {
        const payload = buildFullSyncPayload();
        payload.revision = data.revision;
        pushTournamentPayloadToSupabase(payload).catch(console.error);
      }
      return;
    }
    if (res.status === 409 && data.revision) {
      tournamentSync.pendingConflict = data;
      showSyncConflictModal(data);
      updateSyncIndicator('error');
    } else {
      updateSyncIndicator('error');
    }
  } catch {
    updateSyncIndicator('offline');
  } finally {
    tournamentSync.pushing = false;
  }
}

function showSyncConflictModal(remote) {
  tournamentSync.pendingConflict = remote;
  const modal = $('#sync-conflict-modal');
  if (!modal) return;
  modal.hidden = false;
  modal.dataset.remoteRevision = String(remote.revision || '');
}

function hideSyncConflictModal() {
  const modal = $('#sync-conflict-modal');
  if (modal) modal.hidden = true;
  tournamentSync.pendingConflict = null;
}

async function resolveSyncConflict(useRemote) {
  const remote = tournamentSync.pendingConflict;
  hideSyncConflictModal();
  if (!remote) return;

  if (useRemote) {
    tournamentSync.revision = Math.max(0, (remote.revision || 1) - 1);
    applyRemoteTournamentState(remote);
    return;
  }

  try {
    const payload = buildFullSyncPayload();
    payload.force = true;
    const res = await fetch('/tournament/state.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      tournamentSync.revision = data.revision;
      updateSyncIndicator('synced');
      if (typeof pushTournamentPayloadToSupabase === 'function') {
        const cloudPayload = buildFullSyncPayload();
        cloudPayload.revision = data.revision;
        pushTournamentPayloadToSupabase(cloudPayload).catch(console.error);
      }
    } else {
      updateSyncIndicator('error');
    }
  } catch {
    updateSyncIndicator('offline');
  }
}

function exportTournamentCsv() {
  const all = loadTournamentStorage();
  const rows = [['場次', '階段', '對戰', '選手1', '選手2', '比分', '勝者', '狀態']];
  ['junior', 'senior'].forEach((sessionKey) => {
    const data = all[sessionKey];
    if (!data?.matches?.prelim) return;
    const sessionLabel = sessionKey === 'junior' ? '親子組' : '公開組';
    getAllMatches(data).forEach((m) => {
      const p1 = data.players?.find((p) => p.id === m.p1Id)?.name || '待定';
      const p2 = data.players?.find((p) => p.id === m.p2Id)?.name || '待定';
      const scores = m.status === 'done' ? m.scores : m.liveScores;
      const scoreText = scores ? `${scores[0]}:${scores[1]}` : '';
      const winner = m.winnerId === m.p1Id ? p1 : m.winnerId === m.p2Id ? p2 : '';
      const status = m.status === 'done' ? '完畢' : m.id === data.activeMatchId ? '進行中' : '待賽';
      rows.push([
        sessionLabel,
        m.label || PHASE_LABELS[m.phase] || m.phase,
        m.id,
        p1,
        p2,
        scoreText,
        winner,
        status,
      ]);
    });
  });
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  downloadBlob(`beyblade-schedule-${Date.now()}.csv`, new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
}

function backupTournamentJson() {
  const payload = buildFullSyncPayload();
  payload.revision = tournamentSync.revision;
  payload.exportedAt = new Date().toISOString();
  downloadBlob(
    `beyblade-backup-${Date.now()}.json`,
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
  );
}

async function restoreTournamentJson(file) {
  if (!file) return;
  const text = await file.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    alert('無效的 JSON 檔');
    return;
  }
  if (!payload.junior && !payload.senior) {
    alert('備份格式不正確');
    return;
  }
  if (!confirm('還原備份會覆蓋目前賽程，確定？')) return;
  if (typeof confirmArenaPin === 'function' && !confirmArenaPin('還原賽程備份')) return;

  const all = loadTournamentStorage();
  if (payload.junior) all.junior = { ...createEmptySessionData(), ...payload.junior };
  if (payload.senior) all.senior = { ...createEmptySessionData(), ...payload.senior };
  saveTournamentStorage(all);
  applySessionData(all[tournamentState.session] || createEmptySessionData());
  advanceWinners();
  renderTournamentUI();
  if (tournamentSync.enabled) {
    const pushPayload = buildFullSyncPayload();
    pushPayload.force = true;
    try {
      const res = await fetch('/tournament/state.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pushPayload),
      });
      const data = await res.json();
      if (res.ok && data.ok) tournamentSync.revision = data.revision;
    } catch { /* local restore still applied */ }
  }
  addLog('已還原賽程備份');
}

async function pollTournamentState() {
  if (!tournamentSync.enabled) return;

  if (tournamentSync.pendingConflict) {
    tournamentSync.pollTimer = setTimeout(pollTournamentState, SYNC_POLL_MS);
    return;
  }

  try {
    const res = await fetch(`/tournament/state.json?since=${tournamentSync.revision}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('poll failed');
    const data = await res.json();
    if (data.junior !== undefined) {
      applyRemoteTournamentState(data);
    }
  } catch {
    updateSyncIndicator('offline');
  }

  tournamentSync.pollTimer = setTimeout(pollTournamentState, SYNC_POLL_MS);
}

function updateSyncIndicator(status) {
  const el = $('#tournament-sync-status');
  if (!el) return;
  const labels = {
    synced: '已同步',
    syncing: '同步中…',
    offline: '離線',
    error: '同步衝突',
    local: '本機',
  };
  el.textContent = labels[status] || labels.local;
  el.dataset.status = status;
  if (typeof updateArenaSyncBanner === 'function') updateArenaSyncBanner();
}

async function initTournamentSync() {
  try {
    const res = await fetch('/tournament/state.json?since=-1', { cache: 'no-store' });
    if (!res.ok) throw new Error('no server');
    const remote = await res.json();
    tournamentSync.enabled = true;
    tournamentSync.revision = remote.revision || 0;

    const local = loadTournamentStorage();
    const localHasData = sessionHasData(local.junior) || sessionHasData(local.senior);
    const remoteHasData = sessionHasData(remote.junior) || sessionHasData(remote.senior);

    if (remoteHasData) {
      applyRemoteTournamentState(remote);
    } else if (localHasData) {
      await pushTournamentState();
    }

    updateSyncIndicator('synced');
    pollTournamentState();
  } catch {
    tournamentSync.enabled = false;
    updateSyncIndicator('local');
  }
}

function scheduleLiveSync() {
  if (!tournamentSync.enabled || tournamentSync.applyingRemote) return;
  clearTimeout(tournamentSync.liveSyncTimer);
  tournamentSync.liveSyncTimer = setTimeout(() => {
    persistSession({ skipPush: false });
  }, LIVE_SYNC_DEBOUNCE_MS);
}

function getSessionData() {
  const all = loadTournamentStorage();
  return all[tournamentState.session] || createEmptySessionData();
}

function persistSession(options = {}) {
  const { skipPush = false } = options;
  const all = loadTournamentStorage();
  all[tournamentState.session] = buildSessionPayload();
  saveTournamentStorage(all);
  if (!skipPush && tournamentSync.enabled && !tournamentSync.applyingRemote) {
    pushTournamentState();
  }
  if (!skipPush && typeof scheduleCloudTournamentPush === 'function') {
    scheduleCloudTournamentPush();
  }
}

function loadSession(session) {
  tournamentState.session = session;
  const data = getSessionData();
  applySessionData(data);
  advanceWinners();
  renderTournamentUI();
}

function playerName(id) {
  if (!id) return '待定';
  const p = tournamentState.players.find((x) => x.id === id);
  return p ? p.name : '待定';
}

function genId() {
  return 'p_' + Math.random().toString(36).slice(2, 10);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeMatch(phase, index, p1Id, p2Id, label) {
  return {
    id: `${phase}-${index}`,
    phase,
    label: label || '',
    p1Id: p1Id || null,
    p2Id: p2Id || null,
    winnerId: null,
    status: 'pending',
    scores: null,
    battles: null,
    liveScores: null,
  };
}

function buildBracketFromDraw(playerIds) {
  const shuffled = shuffle(playerIds);
  const matches = {};

  matches.prelim = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    const idx = i / 2;
    matches.prelim.push(makeMatch('prelim', idx, shuffled[i], shuffled[i + 1] || null, `初賽 ${idx + 1}`));
  }

  matches.quarter = Array.from({ length: 4 }, (_, i) =>
    makeMatch('quarter', i, null, null, `複賽 ${i + 1}`)
  );

  matches.revival = [];
  matches.challenge = makeMatch('challenge', 0, null, null, '四強挑戰');

  matches.semi = [
    makeMatch('semi', 0, null, null, '準決賽 1'),
    makeMatch('semi', 1, null, null, '準決賽 2'),
  ];

  matches.final = makeMatch('final', 0, null, null, '決賽（冠軍）');

  return matches;
}

function setupRevivalBracket(eliminatedIds) {
  const prelimLosers = new Set(getPrelimLosers());
  const entrants = eliminatedIds.filter((id) => prelimLosers.has(id));
  const shuffled = shuffle(entrants);
  const rev = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    rev.push(makeMatch('revival', rev.length, shuffled[i], shuffled[i + 1] || null, `復活 R1-${Math.floor(i / 2) + 1}`));
  }
  rev.push(makeMatch('revival', rev.length, null, null, '復活 R2-1'));
  rev.push(makeMatch('revival', rev.length, null, null, '復活 R2-2'));
  rev.push(makeMatch('revival', rev.length, null, null, '逆轉小羊決賽'));
  tournamentState.matches.revival = rev;
}

function autoAdvanceBye(match) {
  if (!match || match.status === 'done') return;
  if (match.p1Id && !match.p2Id) {
    match.winnerId = match.p1Id;
    match.status = 'done';
  } else if (!match.p1Id && match.p2Id) {
    match.winnerId = match.p2Id;
    match.status = 'done';
  }
}

function advanceRevival() {
  const rev = tournamentState.matches.revival;
  if (!rev || rev.length === 0) return;

  const r1 = rev.filter((m) => m.label.startsWith('復活 R1'));
  r1.forEach(autoAdvanceBye);
  if (r1.length && r1.every((m) => m.status === 'done')) {
    const w = r1.map((m) => m.winnerId).filter(Boolean);
    const r2a = rev.find((m) => m.label === '復活 R2-1');
    const r2b = rev.find((m) => m.label === '復活 R2-2');
    if (r2a && w[0] && r2a.status !== 'done') {
      r2a.p1Id = w[0];
      r2a.p2Id = w[1] || null;
      autoAdvanceBye(r2a);
    }
    if (r2b && w[2] && r2b.status !== 'done') {
      r2b.p1Id = w[2];
      r2b.p2Id = w[3] || null;
      autoAdvanceBye(r2b);
    }
  }

  const r2 = rev.filter((m) => m.label.startsWith('復活 R2'));
  const final = rev.find((m) => m.label === '逆轉小羊決賽');
  r2.forEach(autoAdvanceBye);
  const activeR2 = r2.filter((m) => m.p1Id || m.p2Id);
  if (activeR2.length && activeR2.every((m) => m.status === 'done') && final && final.status !== 'done') {
    const w = activeR2.map((m) => m.winnerId).filter(Boolean);
    final.p1Id = w[0] || null;
    final.p2Id = w[1] || null;
    autoAdvanceBye(final);
  }

  const revFinal = rev.find((m) => m.label === '逆轉小羊決賽');
  if (revFinal?.winnerId) {
    tournamentState.revivalWinnerId = revFinal.winnerId;
    if (tournamentState.matches.challenge) {
      tournamentState.matches.challenge.p1Id = revFinal.winnerId;
    }
  }
}

function getPrelimLosers() {
  const prelim = tournamentState.matches.prelim;
  if (!prelim) return [];
  return prelim
    .filter((x) => x.status === 'done' && x.winnerId)
    .map((x) => (x.winnerId === x.p1Id ? x.p2Id : x.p1Id))
    .filter(Boolean);
}

function getPrelimLosersSoFar() {
  return getPrelimLosers();
}

function isQuarterComplete() {
  const q = tournamentState.matches.quarter;
  return q?.length === 4 && q.every((m) => m.status === 'done' && m.winnerId);
}

function isRevivalComplete() {
  const rev = tournamentState.matches.revival;
  if (!rev?.length) return true;
  const revFinal = rev.find((m) => m.label === '逆轉小羊決賽');
  return revFinal?.status === 'done' && !!revFinal.winnerId;
}

function needsRevivalPath() {
  return (tournamentState.matches.revival?.length ?? 0) > 0;
}

function isChallengeComplete() {
  if (!tournamentState.revivalWinnerId) return true;
  const ch = tournamentState.matches.challenge;
  return ch?.status === 'done' && !!ch.winnerId;
}

function isOfficialTopFourReady() {
  if (!isQuarterComplete()) return false;
  if (needsRevivalPath()) {
    if (!isRevivalComplete()) return false;
    if (tournamentState.revivalWinnerId && !isChallengeComplete()) return false;
  }
  return true;
}

function getOfficialTopFour() {
  if (!isOfficialTopFourReady()) return null;
  const m = tournamentState.matches;
  const topFour = m.quarter.map((x) => x.winnerId);
  if (tournamentState.revivalWinnerId && m.challenge?.status === 'done') {
    const challengedId = m.challenge.p2Id;
    const qIdx = topFour.findIndex((id) => id === challengedId);
    if (qIdx >= 0) topFour[qIdx] = m.challenge.winnerId;
  }
  return topFour;
}

function clearPendingBracketSlots(matches) {
  if (!matches) return;
  const list = Array.isArray(matches) ? matches : [matches];
  list.forEach((s) => {
    if (s.status !== 'done') {
      s.p1Id = null;
      s.p2Id = null;
      s.winnerId = null;
      s.status = 'pending';
      s.scores = null;
      s.battles = null;
      s.liveScores = null;
    }
  });
}

function advanceWinners() {
  const m = tournamentState.matches;
  if (!m.prelim) return;

  const prelimWinners = m.prelim.map((x) => x.winnerId).filter(Boolean);
  const prelimLosers = getPrelimLosers();

  for (let i = 0; i < 4; i++) {
    if (m.quarter[i]) {
      m.quarter[i].p1Id = prelimWinners[i * 2] || null;
      m.quarter[i].p2Id = prelimWinners[i * 2 + 1] || null;
      if (m.quarter[i].p1Id && !m.quarter[i].p2Id) {
        m.quarter[i].winnerId = m.quarter[i].p1Id;
        m.quarter[i].status = 'done';
      } else if (!m.quarter[i].p1Id && !m.quarter[i].p2Id) {
        m.quarter[i].status = 'pending';
        m.quarter[i].winnerId = null;
      }
    }
  }

  tournamentState.eliminatedIds = prelimLosers;
  if (prelimLosers.length >= 2 && m.prelim.every((x) => x.status === 'done') && !m.revival?.length) {
    setupRevivalBracket(prelimLosers);
  }

  advanceRevival();

  const topFour = getOfficialTopFour();
  if (topFour && m.semi) {
    m.semi[0].p1Id = topFour[0] || null;
    m.semi[0].p2Id = topFour[1] || null;
    m.semi[1].p1Id = topFour[2] || null;
    m.semi[1].p2Id = topFour[3] || null;
  } else {
    clearPendingBracketSlots(m.semi);
    clearPendingBracketSlots(m.final);
  }

  const semiWinners = m.semi?.map((x) => x.winnerId).filter(Boolean) || [];

  if (semiWinners.length >= 2 && m.final) {
    m.final.p1Id = semiWinners[0];
    m.final.p2Id = semiWinners[1];
  }
}

const PHASE_ORDER = { prelim: 0, revival: 1, quarter: 2, challenge: 3, semi: 4, final: 5 };

function getAllMatchesFlat() {
  return getAllMatches({ matches: tournamentState.matches });
}

function getReadyMatches() {
  return getAllMatchesFlat()
    .filter((m) => m.status === 'pending' && m.p1Id && m.p2Id)
    .sort((a, b) => (PHASE_ORDER[a.phase] ?? 9) - (PHASE_ORDER[b.phase] ?? 9));
}

function hideVictorySchedulePanel() {
  const overlay = $('#victory-overlay');
  const panel = $('#victory-schedule-panel');
  const bracketBtn = $('#btn-victory-bracket');
  if (panel) panel.hidden = true;
  if (bracketBtn) bracketBtn.hidden = true;
  if (overlay) overlay.classList.remove('victory-overlay--tournament');
}

function renderVictorySchedulePanel() {
  const panel = $('#victory-schedule-panel');
  const bracketBtn = $('#btn-victory-bracket');
  if (!panel) return;

  if (!tournamentState.drawn || !tournamentState.matches.prelim) {
    hideVictorySchedulePanel();
    return;
  }

  const ready = getReadyMatches();
  const all = getAllMatchesFlat().filter((m) => m.p1Id || m.p2Id);
  const done = all.filter((m) => m.status === 'done').length;
  const pct = all.length ? Math.round((done / all.length) * 100) : 0;

  let body = '';
  if (ready.length > 0) {
    body = `<ul class="victory-schedule-list">${ready.map((m, i) => `
      <li>
        <button type="button" class="victory-schedule-item${i === 0 ? ' recommended' : ''}" data-match-id="${m.id}">
          <span class="victory-schedule-item-head">
            <span class="victory-schedule-label">${escapeHtml(m.label)}</span>
            ${i === 0 ? '<span class="victory-schedule-tag">建議下一場</span>' : ''}
          </span>
          <span class="victory-schedule-players">${escapeHtml(playerName(m.p1Id))} <span class="log-vs">vs</span> ${escapeHtml(playerName(m.p2Id))}</span>
        </button>
      </li>`).join('')}</ul>`;
  } else if (done === all.length && all.length > 0) {
    body = '<p class="victory-schedule-message done-all">🏆 本場賽程已全部完成</p>';
  } else {
    const challengeHint = tournamentState.revivalWinnerId
      && tournamentState.matches.challenge
      && !tournamentState.matches.challenge.p2Id
      && isQuarterComplete()
      ? '<p class="victory-schedule-message">🐑 復活小羊可抽籤挑戰四強，請至賽程表操作</p>'
      : tournamentState.revivalWinnerId
      && tournamentState.matches.challenge
      && !tournamentState.matches.challenge.p2Id
      ? '<p class="victory-schedule-message">請先完成全部複賽，再為復活小羊抽籤挑戰</p>'
      : '';
    body = `${challengeHint}<p class="victory-schedule-message">下一場尚待對手產生，可先查看完整賽程</p>`;
  }

  panel.innerHTML = `
    <h3 class="victory-schedule-title">選擇下一場賽事</h3>
    <div class="victory-schedule-meta">
      <span>${done} / ${all.length} 已完成</span>
      <div class="victory-schedule-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
        <div class="victory-schedule-fill" style="width:${pct}%"></div>
      </div>
    </div>
    ${body}
  `;

  panel.hidden = false;
  if (bracketBtn) bracketBtn.hidden = false;

  panel.querySelectorAll('.victory-schedule-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      hideVictorySchedulePanel();
      $('#victory-overlay').hidden = true;
      loadMatchToScoreboard(btn.dataset.matchId);
    });
  });
}

function showVictoryScheduleAfterMatch() {
  const overlay = $('#victory-overlay');
  if (!overlay) return;
  overlay.classList.add('victory-overlay--tournament');
  renderVictorySchedulePanel();
  const dismissBtn = $('#btn-dismiss-victory');
  if (dismissBtn) dismissBtn.textContent = readyMatchesLabel();
}

function readyMatchesLabel() {
  const n = getReadyMatches().length;
  return n > 0 ? `稍後再選（${n} 場可開賽）` : '查看完整賽程';
}

function findMatch(id) {
  return getAllMatchesFlat().find((x) => x.id === id);
}

function recordMatchWinner(matchId, winnerSide, result) {
  const match = findMatch(matchId);
  if (!match || match.status === 'done') return false;

  const winnerId = winnerSide === 1 ? match.p1Id : match.p2Id;
  if (!winnerId) return false;

  match.winnerId = winnerId;
  match.status = 'done';
  match.liveScores = null;
  match.liveBattles = null;
  if (result?.scores) {
    match.scores = [...result.scores];
    match.battles = result.battles ?? null;
  }
  advanceWinners();
  persistSession();
  renderTournamentUI();
  if (typeof releaseMatchLock === 'function') releaseMatchLock();
  return true;
}

function adminRequirePin(actionLabel) {
  return typeof confirmArenaPin === 'function' && confirmArenaPin(actionLabel);
}

function adminResetMatchFields(match) {
  match.status = 'pending';
  match.winnerId = null;
  match.scores = null;
  match.battles = null;
  match.liveScores = null;
  match.liveBattles = null;
}

function adminSetMatchWinner(matchId, winnerSide, options = {}) {
  const match = findMatch(matchId);
  if (!match) return false;
  if (!match.p1Id || !match.p2Id) {
    alert('對戰選手未齊');
    return false;
  }
  if (!options.skipPin) {
    if (options.walkover) {
      if (!adminRequirePin('棄權判勝')) return false;
    } else {
      const wName = playerName(winnerSide === 1 ? match.p1Id : match.p2Id);
      if (!confirm(`確定「${match.label}」由 ${wName} 勝出？`)) return false;
    }
  }

  if (match.status === 'done') {
    adminRevertMatch(matchId, { skipPin: true, silent: true });
  }

  const target = typeof getMatchTarget === 'function' ? getMatchTarget() : 4;
  const scores = options.scores || (winnerSide === 1 ? [target, 0] : [0, target]);
  recordMatchWinner(matchId, winnerSide, {
    scores,
    battles: options.battles ?? match.liveBattles ?? match.battles ?? 1,
  });

  const wName = playerName(winnerSide === 1 ? match.p1Id : match.p2Id);
  addLog(`⚙ ${options.walkover ? '棄權' : '賽程'} — ${escapeHtml(match.label)} <strong>${escapeHtml(wName)}</strong> 勝`, 'system');
  if (tournamentState.activeMatchId === matchId) {
    tournamentState.activeMatchId = null;
    if (typeof resetMatchScoresOnly === 'function') resetMatchScoresOnly();
    if (typeof releaseMatchLock === 'function') releaseMatchLock();
    persistSession();
  }
  return true;
}

function adminWalkover(matchId, winnerSide) {
  return adminSetMatchWinner(matchId, winnerSide, { walkover: true });
}

function adminRevertMatch(matchId, options = {}) {
  const match = findMatch(matchId);
  if (!match || match.status !== 'done') {
    if (!options.silent) alert('此場尚未完結');
    return false;
  }
  if (!options.skipPin && !adminRequirePin('撤銷完場結果')) return false;
  if (!options.skipPin && !confirm(`撤銷「${match.label}」結果？之後輪次也會重設。`)) return false;

  const myPhase = PHASE_ORDER[match.phase] ?? 0;
  getAllMatchesFlat().forEach((m) => {
    if ((PHASE_ORDER[m.phase] ?? 0) > myPhase) adminResetMatchFields(m);
    else if (m.id === matchId) adminResetMatchFields(m);
  });

  if (!options.skipScoreboardReset && typeof state !== 'undefined' && state.matchOver && typeof resetMatchScoresOnly === 'function') {
    const onScoreboard = state.victoryMatchId === matchId
      || tournamentState.activeMatchId === matchId;
    if (onScoreboard) resetMatchScoresOnly();
  }

  advanceWinners();
  persistSession();
  renderTournamentUI();
  if (!options.silent) addLog(`↩ 已撤銷 ${escapeHtml(match.label)} 結果`, 'system');
  if (typeof releaseMatchLock === 'function') releaseMatchLock();
  return true;
}

function getMatchScoresForEdit(match) {
  if (match.status === 'done' && match.scores) return [...match.scores];
  if (match.liveScores) return [...match.liveScores];
  return [0, 0];
}

function readBracketScoreInputs(matchEl) {
  const s1 = parseInt(matchEl.querySelector('.bracket-score-in[data-side="1"]')?.value, 10);
  const s2 = parseInt(matchEl.querySelector('.bracket-score-in[data-side="2"]')?.value, 10);
  const target = typeof getMatchTarget === 'function' ? getMatchTarget() : 4;
  return [
    Math.max(0, Math.min(target, Number.isFinite(s1) ? s1 : 0)),
    Math.max(0, Math.min(target, Number.isFinite(s2) ? s2 : 0)),
  ];
}

function adminApplyBracketScores(matchId, scores) {
  const match = findMatch(matchId);
  if (!match?.p1Id || !match?.p2Id) return false;

  if (match.status === 'done') {
    match.scores = [...scores];
    persistSession();
    renderTournamentUI({ scrollActive: false });
    addLog(`⚙ ${escapeHtml(match.label)} 比分改為 <span class="log-score">${scores[0]} : ${scores[1]}</span>`, 'system');
    return true;
  }

  match.liveScores = [...scores];
  tournamentState.activeMatchId = matchId;
  if (typeof nameEls !== 'undefined') {
    nameEls[0].value = playerName(match.p1Id);
    nameEls[1].value = playerName(match.p2Id);
  }
  if (typeof state !== 'undefined') {
    state.scores = [...scores];
    state.matchOver = false;
    if (typeof updateScoreDisplay === 'function') updateScoreDisplay();
  }
  persistSession();
  renderTournamentUI({ scrollActive: false });
  return true;
}

function adminQuickWin(matchId, winnerSide, scores) {
  const match = findMatch(matchId);
  if (!match) return false;
  if (match.status === 'done') {
    const wName = playerName(winnerSide === 1 ? match.p1Id : match.p2Id);
    if (!confirm(`將「${match.label}」勝者改為 ${wName}？`)) return false;
  }
  const target = typeof getMatchTarget === 'function' ? getMatchTarget() : 4;
  let finalScores = scores ? [...scores] : null;
  if (finalScores) {
    const wIdx = winnerSide - 1;
    const lIdx = 1 - wIdx;
    if (finalScores[wIdx] < finalScores[lIdx]) {
      finalScores = winnerSide === 1 ? [target, finalScores[lIdx]] : [finalScores[lIdx], target];
    }
  }
  return adminSetMatchWinner(matchId, winnerSide, {
    scores: finalScores || undefined,
    battles: match.liveBattles || match.battles || 1,
    skipPin: true,
  });
}

function shortPlayerName(id) {
  const n = playerName(id);
  return n.length > 6 ? `${n.slice(0, 5)}…` : n;
}

function exportPrintableBracket() {
  const all = loadTournamentStorage();
  const rows = [];
  ['junior', 'senior'].forEach((sk) => {
    const data = all[sk];
    if (!data?.drawn) return;
    const label = sk === 'junior' ? '親子組' : '公開組';
    rows.push(`<h2>${label}</h2><table><thead><tr><th>場次</th><th>對戰</th><th>比分</th><th>勝者</th></tr></thead><tbody>`);
    getAllMatches(data).forEach((m) => {
      const p1 = data.players?.find((p) => p.id === m.p1Id)?.name || '—';
      const p2 = data.players?.find((p) => p.id === m.p2Id)?.name || '—';
      const sc = m.scores ? `${m.scores[0]} : ${m.scores[1]}` : '—';
      const w = m.winnerId === m.p1Id ? p1 : m.winnerId === m.p2Id ? p2 : '—';
      rows.push(`<tr><td>${m.label || ''}</td><td>${p1} vs ${p2}</td><td>${sc}</td><td>${w}</td></tr>`);
    });
    rows.push('</tbody></table>');
  });
  const win = window.open('', '_blank');
  if (!win) { alert('請允許彈出視窗以列印'); return; }
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>賽程表</title>
    <style>body{font-family:system-ui;padding:1.5rem}table{border-collapse:collapse;width:100%;margin-bottom:2rem}
    th,td{border:1px solid #ccc;padding:8px;text-align:left}h2{margin-top:1.5rem}</style></head><body>
    <h1>咩咩遊樂園 — 賽程表</h1><p>${new Date().toLocaleString()}</p>${rows.join('')}
    <script>window.onload=function(){window.print()}<\/script></body></html>`);
  win.document.close();
}

function exportStatsReport() {
  const all = loadTournamentStorage();
  const lines = ['咩咩遊樂園 — 賽後統計', new Date().toLocaleString(), ''];
  ['junior', 'senior'].forEach((sk) => {
    const data = all[sk];
    if (!data?.players?.length) return;
    lines.push(sk === 'junior' ? '【親子組】' : '【公開組】');
    const stats = new Map(data.players.map((p) => [p.id, { name: p.name, w: 0, l: 0 }]));
    getAllMatches(data).forEach((m) => {
      if (m.status !== 'done' || !m.winnerId) return;
      const lid = m.winnerId === m.p1Id ? m.p2Id : m.p1Id;
      if (stats.has(m.winnerId)) stats.get(m.winnerId).w += 1;
      if (lid && stats.has(lid)) stats.get(lid).l += 1;
    });
    [...stats.values()].sort((a, b) => b.w - a.w || a.l - b.l).forEach((s) => {
      lines.push(`${s.name} — ${s.w} 勝 ${s.l} 負`);
    });
    lines.push('');
  });
  downloadBlob(`beyblade-stats-${Date.now()}.txt`, new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
}

function exportAwardsList() {
  const all = loadTournamentStorage();
  const lines = ['咩咩遊樂園 — 頒獎名單', new Date().toLocaleString(), ''];
  ['junior', 'senior'].forEach((sk) => {
    const data = all[sk];
    const fin = data?.matches?.final;
    if (!fin?.winnerId) return;
    const champ = playerNameFromData(data, fin.winnerId);
    const runner = fin.winnerId === fin.p1Id ? playerNameFromData(data, fin.p2Id) : playerNameFromData(data, fin.p1Id);
    const semis = (data.matches.semi || []).map((m) => m.winnerId).filter(Boolean);
    const top4 = [...new Set([...semis, fin.p1Id, fin.p2Id].filter(Boolean))];
    lines.push(sk === 'junior' ? '【親子組】' : '【公開組】');
    lines.push(`冠軍：${champ}`);
    lines.push(`亞軍：${runner}`);
    lines.push(`四強：${top4.map((id) => playerNameFromData(data, id)).join('、')}`);
    lines.push('');
  });
  downloadBlob(`beyblade-awards-${Date.now()}.txt`, new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
}

function playerNameFromData(data, id) {
  if (!id) return '待定';
  return data.players?.find((p) => p.id === id)?.name || '待定';
}

function formatMatchScore(match) {
  const scores = match.status === 'done' ? match.scores : match.liveScores;
  if (!scores) return '';
  return `${scores[0]} : ${scores[1]}`;
}

function updateTournamentLiveScores(scores, battles) {
  if (!tournamentState.activeMatchId) return;
  const match = findMatch(tournamentState.activeMatchId);
  if (!match || match.status === 'done') return;
  match.liveScores = [...scores];
  match.liveBattles = battles;
  renderTournamentUI({ scrollActive: false });
  scheduleLiveSync();
}

function setChallengeOpponent(quarterIndex) {
  const m = tournamentState.matches;
  if (!m.challenge || !tournamentState.revivalWinnerId) return;
  const q = m.quarter[quarterIndex];
  if (!q?.winnerId) {
    alert('該四強席位尚未產生');
    return;
  }
  m.challenge.p2Id = q.winnerId;
  m.challenge.p1Id = tournamentState.revivalWinnerId;
  m.challenge.status = 'pending';
  m.challenge.winnerId = null;
  advanceWinners();
  persistSession();
  renderTournamentUI();
  addLog(`🐑 復活小羊挑戰：${escapeHtml(playerName(m.challenge.p1Id))} vs ${escapeHtml(playerName(m.challenge.p2Id))}`);
}

function drawRandomChallengeOpponent(forceRedraw = false) {
  const m = tournamentState.matches;
  if (!tournamentState.revivalWinnerId) {
    alert('復活小羊尚未產生，請先完成復活賽');
    return;
  }
  if (!isQuarterComplete()) {
    alert('請先完成全部複賽，產生四強');
    return;
  }
  if (m.challenge?.p2Id && !forceRedraw) {
    if (!confirm('已抽選對手，要重新抽籤？')) return;
  }
  const candidates = m.quarter.map((q, i) => (q.winnerId ? i : -1)).filter((i) => i >= 0);
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  setChallengeOpponent(pick);
  if (typeof spawnConfetti === 'function') spawnConfetti(25);
}

function addPlayer(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return false;
  if (tournamentState.players.length >= MAX_PLAYERS) {
    alert(`每場最多 ${MAX_PLAYERS} 人`);
    return false;
  }
  if (tournamentState.players.some((p) => p.name === trimmed)) return false;
  tournamentState.players.push({ id: genId(), name: trimmed });
  persistSession();
  renderRosterList();
  return true;
}

function removePlayer(id) {
  if (tournamentState.drawn && !confirm('已抽籤，刪除選手會影響賽程。確定？')) return;
  tournamentState.players = tournamentState.players.filter((p) => p.id !== id);
  persistSession();
  renderRosterList();
}

function importPlayersFromText(text) {
  const lines = text.split(/\n/).map((s) => s.trim()).filter(Boolean);
  let added = 0;
  lines.forEach((name) => {
    if (addPlayer(name)) added++;
  });
  return added;
}

function runDraw() {
  const ids = tournamentState.players.map((p) => p.id);
  if (ids.length < 2) {
    alert('至少需要 2 名選手');
    return;
  }
  if (tournamentState.drawn && !confirm('重新抽籤會覆蓋現有賽程，確定？')) return;

  tournamentState.matches = buildBracketFromDraw(ids);
  tournamentState.matches.prelim.forEach((m) => {
    if (m.p1Id && !m.p2Id) {
      m.winnerId = m.p1Id;
      m.status = 'done';
    }
  });
  tournamentState.drawn = true;
  tournamentState.eliminatedIds = [];
  tournamentState.revivalWinnerId = null;
  tournamentState.activeMatchId = null;
  advanceWinners();
  persistSession();
  renderTournamentUI();
  addLog(`抽籤完成 — ${ids.length} 名選手，${tournamentState.matches.prelim.length} 場初賽`);
  spawnConfetti(40);
}

function resetTournament() {
  if (!confirm('清除本場抽籤與賽程？（選手名單保留）')) return;
  if (typeof confirmArenaPin === 'function' && !confirmArenaPin('重設賽程')) return;
  tournamentState.drawn = false;
  tournamentState.matches = {};
  tournamentState.eliminatedIds = [];
  tournamentState.revivalWinnerId = null;
  tournamentState.activeMatchId = null;
  persistSession();
  renderTournamentUI();
}

async function loadMatchToScoreboard(matchId) {
  const match = findMatch(matchId);
  if (!match) return;
  if (!match.p1Id && !match.p2Id) {
    alert('此對戰尚未確定選手');
    return;
  }
  if (match.status === 'done') {
    if (!confirm('此場已完成，仍要重新載入？')) return;
  }

  if (typeof claimMatchLock === 'function') {
    const lockResult = await claimMatchLock(matchId, match.label, tournamentState.session);
    if (!lockResult.ok && lockResult.lock?.matchId) {
      alert(`此場已由 ${lockResult.lock.operatorLabel || '其他台'} 進行中：${lockResult.lock.matchLabel || lockResult.lock.matchId}`);
      return;
    }
  }

  const wasActive = tournamentState.activeMatchId === matchId;
  const useCameraStandby = match.status === 'pending' && !wasActive;

  if (typeof onReplayDiscard === 'function') onReplayDiscard();

  tournamentState.activeMatchId = matchId;
  nameEls[0].value = playerName(match.p1Id);
  nameEls[1].value = playerName(match.p2Id);

  const phaseSelect = $('#phase-select');
  if (phaseSelect && PHASE_LABELS[match.phase]) {
    phaseSelect.value = match.phase;
  }

  if (match.status === 'done' && match.scores) {
    loadMatchScores(match.scores, match.battles, true);
  } else {
    resetMatchScoresOnly({ keepLaunch: useCameraStandby });
    const resume = match.liveScores && (wasActive || match.liveScores[0] > 0 || match.liveScores[1] > 0);
    if (resume) {
      state.scores = [...match.liveScores];
      state.currentBattle = match.liveBattles || 1;
      updateScoreDisplay();
    } else {
      match.liveScores = [0, 0];
      match.liveBattles = 1;
    }
  }

  renderTournamentUI();
  persistSession();
  const scoreHint = match.scores ? ` · 戰績 <span class="log-score">${match.scores[0]} : ${match.scores[1]}</span>` : '';
  addLog(`── ${match.label} ──`, 'system', { type: 'log-section' });
  addLog(
    `${escapeHtml(playerName(match.p1Id))} <span class="log-vs">vs</span> ${escapeHtml(playerName(match.p2Id))}${scoreHint}`,
    'system',
    { type: 'log-section' }
  );
  hideVictorySchedulePanel();
  $('#victory-overlay').hidden = true;

  if (useCameraStandby && typeof enterCameraStandbyMode === 'function') {
    if (typeof switchAppView === 'function') switchAppView('camera');
    if (typeof applyAppViewState === 'function') applyAppViewState('camera');
    enterCameraStandbyMode().catch(console.error);
  } else if (typeof switchAppView === 'function') {
    switchAppView('battle');
  }
}

function resolveWinnerSide(match, winnerSide) {
  const n1 = nameEls[0].value.trim();
  const p1Name = playerName(match.p1Id);
  const p2Name = playerName(match.p2Id);
  if (n1 === p1Name) return 1;
  if (n1 === p2Name) return 2;
  return winnerSide;
}

function onTournamentMatchWin(winnerSide, result) {
  if (!tournamentState.activeMatchId) return;
  const match = findMatch(tournamentState.activeMatchId);
  if (!match) return;

  const side = resolveWinnerSide(match, winnerSide);
  const ok = recordMatchWinner(tournamentState.activeMatchId, side, result);
  if (ok) {
    const wName = playerName(side === 1 ? match.p1Id : match.p2Id);
    const lName = playerName(side === 1 ? match.p2Id : match.p1Id);
    const scores = result?.scores || match.scores || [0, 0];
    const battles = result?.battles ?? match.battles;
    const battleHint = battles ? ` · ${battles} 局` : '';
    addLog(
      `🏆 ${match.label} — <strong>${escapeHtml(wName)}</strong> 勝 <span class="log-score">${scores[0]} : ${scores[1]}</span>${battleHint}`,
      side,
      { type: 'log-result' }
    );
    if (match.phase === 'quarter') {
      addLog(`${escapeHtml(wName)} 晉級複賽四強 · ${escapeHtml(lName)} 直接淘汰（不進復活賽）`, 'system');
    } else if (match.phase === 'challenge') {
      addLog(`${escapeHtml(wName)} 晉級正式四強 · ${escapeHtml(lName)} 直接淘汰`, 'system');
    } else if (match.phase === 'revival') {
      addLog(`${escapeHtml(wName)} 晉級 · ${escapeHtml(lName)} 復活賽止步`, 'system');
    } else {
      addLog(`${escapeHtml(wName)} 晉級 · ${escapeHtml(lName)} 止步`, 'system');
    }
    tournamentState.activeMatchId = null;
    persistSession();
    renderTournamentUI();
    if (typeof releaseMatchLock === 'function') releaseMatchLock();
    if (typeof showVictoryScheduleAfterMatch === 'function') {
      showVictoryScheduleAfterMatch();
    }
  }
}

function renderRosterList() {
  const list = $('#roster-list');
  const count = $('#roster-count');
  if (!list) return;

  list.innerHTML = '';
  tournamentState.players.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = 'roster-item';
    li.innerHTML = `
      <span class="roster-num">${i + 1}</span>
      <input type="text" class="roster-name-input" value="${escapeHtml(p.name)}" data-id="${p.id}" maxlength="16">
      <button type="button" class="btn-icon btn-remove-player" data-id="${p.id}" title="移除">×</button>
    `;
    list.appendChild(li);
  });

  if (count) count.textContent = `${tournamentState.players.length} / ${MAX_PLAYERS}`;

  list.querySelectorAll('.roster-name-input').forEach((input) => {
    input.addEventListener('change', () => {
      const p = tournamentState.players.find((x) => x.id === input.dataset.id);
      if (p) {
        p.name = input.value.trim() || p.name;
        persistSession();
      }
    });
  });

  list.querySelectorAll('.btn-remove-player').forEach((btn) => {
    btn.addEventListener('click', () => removePlayer(btn.dataset.id));
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const PHASE_STYLES = {
  prelim: { title: '初賽', sub: '16 → 8', cls: 'phase-prelim' },
  revival: { title: '復活賽', sub: '僅初賽落敗者', cls: 'phase-revival' },
  quarter: { title: '複賽', sub: '8 → 4 · 落敗直接淘汰', cls: 'phase-quarter' },
  challenge: { title: '四強挑戰', sub: '小羊抽籤', cls: 'phase-challenge' },
  semi: { title: '準決賽', sub: '4 → 2', cls: 'phase-semi' },
  final: { title: '決賽', sub: '冠軍', cls: 'phase-final' },
};

function renderMatchCard(match) {
  const active = match.id === tournamentState.activeMatchId;
  const statusClass = match.status === 'done' ? 'done' : active ? 'active' : 'pending';
  const statusLabel = match.status === 'done' ? '完畢' : active ? '進行中' : '待賽';
  const p1Win = match.winnerId === match.p1Id;
  const p2Win = match.winnerId === match.p2Id;
  const canStart = match.p1Id || match.p2Id;
  const phaseCls = PHASE_STYLES[match.phase]?.cls || '';
  const editScores = getMatchScoresForEdit(match);
  const displayScores = match.status === 'done' ? match.scores : match.liveScores;
  const scoreText = formatMatchScore(match);
  const battleText = match.battles ? `${match.battles} 局` : active && match.liveBattles ? `${match.liveBattles} 局` : '';
  const target = typeof getMatchTarget === 'function' ? getMatchTarget() : 4;

  function slotClass(side, id, won, lost) {
    if (!id) return 'slot empty';
    if (won) return 'slot winner';
    if (lost) return 'slot loser';
    return 'slot';
  }

  function slotScore(idx) {
    if (!displayScores) return '';
    const cls = displayScores[idx] >= target ? 'slot-score win' : 'slot-score';
    return `<span class="${cls}">${displayScores[idx]}</span>`;
  }

  const scoreEditor = match.p1Id && match.p2Id ? `
    <div class="bracket-score-edit" data-match-id="${match.id}">
      <label class="bracket-score-field">
        <span class="bracket-score-name red">${escapeHtml(shortPlayerName(match.p1Id))}</span>
        <input type="number" class="bracket-score-in" data-side="1" min="0" max="${target}" value="${editScores[0]}" aria-label="P1 分數">
      </label>
      <span class="bracket-score-sep">:</span>
      <label class="bracket-score-field">
        <span class="bracket-score-name blue">${escapeHtml(shortPlayerName(match.p2Id))}</span>
        <input type="number" class="bracket-score-in" data-side="2" min="0" max="${target}" value="${editScores[1]}" aria-label="P2 分數">
      </label>
      <button type="button" class="btn btn-xs btn-ghost btn-bracket-apply" title="套用比分">套用</button>
    </div>
    <div class="bracket-actions" data-match-id="${match.id}">
      <button type="button" class="btn btn-xs ${active ? 'btn-primary' : 'btn-ghost'} btn-bracket-enter" data-match-id="${match.id}">
        ${active ? '▶ 計分中' : '進入計分'}
      </button>
      ${match.status !== 'done' ? `
        <button type="button" class="btn btn-xs btn-ghost btn-bracket-win btn-bracket-win-p1" data-side="1" title="${escapeHtml(playerName(match.p1Id))} 勝">
          ${escapeHtml(shortPlayerName(match.p1Id))} 勝
        </button>
        <button type="button" class="btn btn-xs btn-ghost btn-bracket-win btn-bracket-win-p2" data-side="2" title="${escapeHtml(playerName(match.p2Id))} 勝">
          ${escapeHtml(shortPlayerName(match.p2Id))} 勝
        </button>
        <button type="button" class="btn btn-xs btn-ghost btn-admin-walk" data-side="1" title="P1 棄權">棄</button>
        <button type="button" class="btn btn-xs btn-ghost btn-admin-walk" data-side="2" title="P2 棄權">棄</button>
      ` : `
        <button type="button" class="btn btn-xs btn-ghost btn-bracket-win btn-bracket-win-p1" data-side="1">改 ${escapeHtml(shortPlayerName(match.p1Id))} 勝</button>
        <button type="button" class="btn btn-xs btn-ghost btn-bracket-win btn-bracket-win-p2" data-side="2">改 ${escapeHtml(shortPlayerName(match.p2Id))} 勝</button>
        <button type="button" class="btn btn-xs btn-ghost btn-admin-revert" title="撤銷完場">撤銷</button>
      `}
    </div>` : '';

  return `<li class="bracket-match ${statusClass} ${phaseCls}" data-match-id="${match.id}">
    <div class="bracket-match-head">
      <span class="bracket-label">${escapeHtml(match.label)}</span>
      <div class="bracket-match-meta">
        ${scoreText ? `<span class="bracket-score-badge">${scoreText}</span>` : ''}
        ${battleText ? `<span class="bracket-battle-badge">${battleText}</span>` : ''}
        <span class="bracket-status-badge status-${statusClass}">${statusLabel}</span>
      </div>
    </div>
    <div class="bracket-slots">
      <div class="${slotClass(1, match.p1Id, p1Win, p2Win)}">
        <span class="slot-name">${escapeHtml(playerName(match.p1Id))}</span>
        <span class="slot-side-meta">
          ${slotScore(0)}
          ${p1Win ? '<span class="slot-crown" aria-hidden="true">👑</span>' : ''}
        </span>
      </div>
      <div class="slot-divider">${scoreText || 'VS'}</div>
      <div class="${slotClass(2, match.p2Id, p2Win, p1Win)}">
        <span class="slot-name">${escapeHtml(playerName(match.p2Id))}</span>
        <span class="slot-side-meta">
          ${slotScore(1)}
          ${p2Win ? '<span class="slot-crown" aria-hidden="true">👑</span>' : ''}
        </span>
      </div>
    </div>
    ${scoreEditor}
  </li>`;
}

function renderBracketColumn(phaseKey, matches) {
  if (!matches || (Array.isArray(matches) && matches.length === 0)) return '';
  const list = Array.isArray(matches) ? matches : [matches];
  const meta = PHASE_STYLES[phaseKey] || { title: phaseKey, sub: '', cls: '' };
  const done = list.filter((m) => m.status === 'done').length;

  return `<div class="bracket-column ${meta.cls}">
    <div class="bracket-column-head">
      <h3 class="bracket-column-title">${meta.title}</h3>
      <span class="bracket-column-sub">${meta.sub}</span>
      <span class="bracket-column-progress">${done}/${list.length}</span>
    </div>
    <ul class="bracket-matches">${list.map(renderMatchCard).join('')}</ul>
  </div>`;
}

function renderBracketSummary() {
  const all = getAllMatchesFlat().filter((m) => m.p1Id || m.p2Id);
  const done = all.filter((m) => m.status === 'done').length;
  const active = tournamentState.activeMatchId ? 1 : 0;
  const ready = getReadyMatches().length;
  const pct = all.length ? Math.round((done / all.length) * 100) : 0;

  let nextHint = '';
  const readyList = getReadyMatches();
  const next = readyList[0];
  if (next) {
    nextHint = `<p class="bracket-next-hint">下一場：<button type="button" class="bracket-next-link" data-match-id="${next.id}"><strong>${escapeHtml(next.label)}</strong> — ${escapeHtml(playerName(next.p1Id))} vs ${escapeHtml(playerName(next.p2Id))}</button></p>`;
  } else if (tournamentState.revivalWinnerId && isQuarterComplete() && !tournamentState.matches.challenge?.p2Id) {
    nextHint = '<p class="bracket-next-hint">🐑 復活小羊請抽籤挑戰四強其中一位</p>';
  } else if (done === all.length && all.length > 0) {
    nextHint = '<p class="bracket-next-hint done-all">本場賽程已全部完成 🏆</p>';
  } else if (!isOfficialTopFourReady()) {
    nextHint = '<p class="bracket-next-hint flow-hint">流程：初賽 → 復活賽 → 複賽 → 四強挑戰 → 準決賽 → 決賽</p>';
  }

  return `<div class="bracket-summary">
    <div class="bracket-summary-stats">
      <div class="bracket-stat"><span class="bracket-stat-num">${done}</span><span class="bracket-stat-label">已完成</span></div>
      <div class="bracket-stat"><span class="bracket-stat-num">${ready}</span><span class="bracket-stat-label">可開賽</span></div>
      <div class="bracket-stat"><span class="bracket-stat-num">${active}</span><span class="bracket-stat-label">進行中</span></div>
    </div>
    <div class="bracket-progress-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
      <div class="bracket-progress-fill" style="width:${pct}%"></div>
    </div>
    ${nextHint}
  </div>`;
}

function renderRevivalPendingColumn() {
  const losers = getPrelimLosersSoFar();
  const prelimDone = tournamentState.matches.prelim?.every((m) => m.status === 'done');
  if (prelimDone || !losers.length || tournamentState.matches.revival?.length) return '';

  const meta = PHASE_STYLES.revival;
  return `<div class="bracket-column ${meta.cls} bracket-column-gated">
    <div class="bracket-column-head">
      <h3 class="bracket-column-title">${meta.title}</h3>
      <span class="bracket-column-sub">${meta.sub}</span>
    </div>
    <div class="bracket-gate-body">
      <p class="bracket-gate-hint">初賽落敗者進入復活賽（複賽落敗者不會進入）</p>
      <ul class="revival-loser-list">${losers.map((id) => `<li>${escapeHtml(playerName(id))}</li>`).join('')}</ul>
      <p class="bracket-gate-preview">初賽全部完成後開始</p>
    </div>
  </div>`;
}

function renderSemiGateColumn() {
  if (isOfficialTopFourReady()) return renderBracketColumn('semi', tournamentState.matches.semi);

  const meta = PHASE_STYLES.semi;
  let hint = '正式四強待定';
  if (!isQuarterComplete()) {
    hint = '完成復活賽與複賽後，小羊抽籤挑戰四強';
  } else if (needsRevivalPath() && !isRevivalComplete()) {
    hint = '進行復活賽，產生逆轉小羊';
  } else if (tournamentState.revivalWinnerId && !tournamentState.matches.challenge?.p2Id) {
    hint = '🐑 請為復活小羊抽籤挑戰四強';
  } else if (tournamentState.revivalWinnerId && !isChallengeComplete()) {
    hint = '完成四強挑戰後開準決賽';
  }

  const preview = isQuarterComplete()
    ? (tournamentState.matches.quarter || []).map((q) => q.winnerId ? playerName(q.winnerId) : '待定').join(' · ')
    : '';

  return `<div class="bracket-column ${meta.cls} bracket-column-gated">
    <div class="bracket-column-head">
      <h3 class="bracket-column-title">${meta.title}</h3>
      <span class="bracket-column-sub">${meta.sub}</span>
    </div>
    <div class="bracket-gate-body">
      <p class="bracket-gate-hint">${hint}</p>
      ${preview ? `<p class="bracket-gate-preview">複賽四強：${escapeHtml(preview)}</p>` : ''}
    </div>
  </div>`;
}

function renderChallengePicker() {
  const m = tournamentState.matches;
  if (!m.challenge) return '';

  if (!tournamentState.revivalWinnerId) {
    if (!needsRevivalPath()) return '';
    return '<p class="cam-hint">復活賽完成後，逆轉小羊可抽籤挑戰四強</p>';
  }

  if (m.challenge.status === 'done') return '';

  if (!isQuarterComplete()) {
    return `<div class="challenge-picker">
      <p>🐑 復活小羊 <strong>${escapeHtml(playerName(tournamentState.revivalWinnerId))}</strong></p>
      <p class="cam-hint">複賽全部完成後，抽籤挑戰其中一位</p>
    </div>`;
  }

  if (m.challenge.p2Id) {
    return `<div class="challenge-picker">
      <p>🐑 挑戰對象：<strong>${escapeHtml(playerName(m.challenge.p2Id))}</strong></p>
      <button type="button" class="btn btn-sm btn-ghost" id="btn-redraw-challenge">重新抽籤</button>
    </div>`;
  }

  const manualOptions = (m.quarter || [])
    .map((q, i) => q.winnerId ? `<button type="button" class="btn btn-sm btn-ghost btn-pick-challenge" data-q="${i}">${escapeHtml(playerName(q.winnerId))}</button>` : '')
    .filter(Boolean)
    .join('');

  return `<div class="challenge-picker">
    <p>🐑 復活小羊 <strong>${escapeHtml(playerName(tournamentState.revivalWinnerId))}</strong> 抽籤挑戰四強：</p>
    <button type="button" class="btn btn-sm btn-primary" id="btn-draw-challenge">🎲 抽籤挑戰對手</button>
    ${manualOptions ? `<details class="challenge-manual"><summary>手動指定對手</summary><div class="challenge-btns">${manualOptions}</div></details>` : ''}
  </div>`;
}

function renderTournamentUI(options = {}) {
  const { scrollActive = true } = options;
  renderRosterList();

  const bracket = $('#bracket-view');
  const drawBadge = $('#draw-status');
  if (drawBadge) {
    drawBadge.textContent = tournamentState.drawn ? '已抽籤' : '未抽籤';
    drawBadge.className = 'draw-badge ' + (tournamentState.drawn ? 'drawn' : '');
  }

  if (!bracket) return;

  if (!tournamentState.drawn || !tournamentState.matches.prelim) {
    bracket.innerHTML = '<p class="bracket-empty">加入選手後按「抽籤配對」產生賽程表</p>';
    return;
  }

  const m = tournamentState.matches;
  const finals = m.final ? [m.final] : [];
  const revivalCol = m.revival?.length
    ? renderBracketColumn('revival', m.revival)
    : renderRevivalPendingColumn();
  const challengeCol = m.challenge
    ? `<div class="bracket-column-wrap">${renderBracketColumn('challenge', m.challenge)}${renderChallengePicker()}</div>`
    : '';

  bracket.innerHTML =
    renderBracketSummary() +
    '<div class="bracket-board">' +
    renderBracketColumn('prelim', m.prelim) +
    revivalCol +
    renderBracketColumn('quarter', m.quarter) +
    challengeCol +
    renderSemiGateColumn() +
    renderBracketColumn('final', finals) +
    '</div>';

  bracket.querySelectorAll('.btn-bracket-enter').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      loadMatchToScoreboard(btn.dataset.matchId);
    });
  });

  bracket.querySelectorAll('.btn-bracket-apply').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = btn.closest('.bracket-match');
      if (!card) return;
      const scores = readBracketScoreInputs(card);
      adminApplyBracketScores(card.dataset.matchId, scores);
    });
  });

  bracket.querySelectorAll('.btn-bracket-win').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = btn.closest('.bracket-match');
      if (!card) return;
      const scores = readBracketScoreInputs(card);
      adminQuickWin(card.dataset.matchId, parseInt(btn.dataset.side, 10), scores);
    });
  });

  bracket.querySelectorAll('.bracket-match').forEach((card) => {
    card.addEventListener('dblclick', (e) => {
      if (e.target.closest('button, input')) return;
      const id = card.dataset.matchId;
      if (id) loadMatchToScoreboard(id);
    });
  });

  bracket.querySelectorAll('.bracket-next-link').forEach((btn) => {
    btn.addEventListener('click', () => loadMatchToScoreboard(btn.dataset.matchId));
  });

  bracket.querySelectorAll('.btn-pick-challenge').forEach((btn) => {
    btn.addEventListener('click', () => setChallengeOpponent(parseInt(btn.dataset.q, 10)));
  });

  bracket.querySelectorAll('.btn-admin-walk').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = btn.closest('.bracket-match');
      adminWalkover(card?.dataset.matchId, parseInt(btn.dataset.side, 10));
    });
  });
  bracket.querySelectorAll('.btn-admin-revert').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = btn.closest('.bracket-match');
      adminRevertMatch(card?.dataset.matchId);
    });
  });

  $('#btn-draw-challenge')?.addEventListener('click', () => drawRandomChallengeOpponent(false));
  $('#btn-redraw-challenge')?.addEventListener('click', () => drawRandomChallengeOpponent(true));

  const activeEl = bracket.querySelector('.bracket-match.active');
  if (activeEl && scrollActive) {
    activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }
}

function initTournament() {
  const sessionSelect = $('#session-select');
  loadSession(sessionSelect?.value || 'junior');
  initTournamentSync();

  sessionSelect?.addEventListener('change', () => {
    loadSession(sessionSelect.value);
  });

  $('#btn-add-player')?.addEventListener('click', () => {
    const input = $('#new-player-name');
    if (addPlayer(input?.value)) input.value = '';
  });

  $('#new-player-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('#btn-add-player')?.click();
    }
  });

  $('#btn-import-players')?.addEventListener('click', () => {
    const ta = $('#bulk-players');
    const n = importPlayersFromText(ta?.value || '');
    if (ta) ta.value = '';
    addLog(`批量加入 ${n} 名選手`);
    renderRosterList();
  });

  $('#btn-draw')?.addEventListener('click', runDraw);
  $('#btn-export-csv')?.addEventListener('click', exportTournamentCsv);
  $('#btn-backup-tournament')?.addEventListener('click', backupTournamentJson);
  $('#btn-print-bracket')?.addEventListener('click', exportPrintableBracket);
  $('#btn-export-stats')?.addEventListener('click', exportStatsReport);
  $('#btn-export-awards')?.addEventListener('click', exportAwardsList);
  $('#btn-restore-tournament')?.addEventListener('click', () => $('#restore-tournament-file')?.click());
  $('#restore-tournament-file')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    restoreTournamentJson(file).catch(console.error);
    e.target.value = '';
  });
  $('#btn-sync-use-remote')?.addEventListener('click', () => resolveSyncConflict(true));
  $('#btn-sync-keep-local')?.addEventListener('click', () => resolveSyncConflict(false));
  $('#btn-reset-bracket')?.addEventListener('click', resetTournament);

  document.querySelectorAll('.tournament-tools-menu button').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.closest('details')?.removeAttribute('open');
    });
  });
}
