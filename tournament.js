/**
 * Tournament — roster, draw, bracket schedule
 */

const QUARTER_ENTRANTS = 8;
const DEFAULT_SCHEDULE_RULES = '比賽流程：初賽 → 復活賽（僅初賽落敗）→ 複賽（落敗直接淘汰）→ 四強挑戰 → 準決賽 → 決賽 · 無季軍戰 · 賽程表可直接改分、設勝負、雙擊進入計分';
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
  scheduleRules: '',
};

function createEmptySessionData() {
  return {
    players: [],
    drawn: false,
    matches: {},
    eliminatedIds: [],
    revivalWinnerId: null,
    activeMatchId: null,
    scheduleRules: '',
  };
}

function getScheduleRulesFromData(data) {
  const text = (data?.scheduleRules || '').trim();
  return text || DEFAULT_SCHEDULE_RULES;
}

function getScheduleRules() {
  return getScheduleRulesFromData(tournamentState);
}

function setScheduleRules(text) {
  const trimmed = (text || '').trim();
  tournamentState.scheduleRules = trimmed === DEFAULT_SCHEDULE_RULES ? '' : trimmed;
  persistSession();
  renderScheduleRules();
}

function renderScheduleRules() {
  const el = $('#tournament-rundown');
  const input = $('#schedule-rules-input');
  const rules = getScheduleRules();
  if (el) el.textContent = rules;
  if (input && document.activeElement !== input) input.value = rules;
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
    scheduleRules: tournamentState.scheduleRules || '',
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
  tournamentState.scheduleRules = data.scheduleRules || '';
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
  if (!tournamentSync.enabled || tournamentSync.applyingRemote || tournamentSync.pushing) {
    // #region agent log
    if (typeof portalDebugLog === 'function') {
      portalDebugLog('H2', 'tournament.js:121', 'local tournament push skipped', {
        enabled: tournamentSync.enabled,
        applyingRemote: tournamentSync.applyingRemote,
        pushing: tournamentSync.pushing,
        revision: tournamentSync.revision,
        session: tournamentState.session,
      });
    }
    // #endregion
    return;
  }

  tournamentSync.pushing = true;
  updateSyncIndicator('syncing');
  try {
    const outgoingPayload = buildFullSyncPayload();
    // #region agent log
    if (typeof portalDebugLog === 'function') {
      portalDebugLog('H2', 'tournament.js:139', 'local tournament push started', {
        revision: outgoingPayload.revision,
        session: tournamentState.session,
        juniorPlayers: outgoingPayload.junior?.players?.length || 0,
        seniorPlayers: outgoingPayload.senior?.players?.length || 0,
        juniorDrawn: Boolean(outgoingPayload.junior?.drawn),
        seniorDrawn: Boolean(outgoingPayload.senior?.drawn),
      });
    }
    // #endregion
    const res = await fetch('/tournament/state.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(outgoingPayload),
      cache: 'no-store',
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      tournamentSync.revision = data.revision;
      // #region agent log
      if (typeof portalDebugLog === 'function') {
        portalDebugLog('H2', 'tournament.js:160', 'local tournament push succeeded', {
          serverRevision: data.revision,
          updatedAt: data.updatedAt || null,
          httpStatus: res.status,
        });
      }
      // #endregion
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
      // #region agent log
      if (typeof portalDebugLog === 'function') {
        portalDebugLog('H2', 'tournament.js:176', 'local tournament conflict', {
          clientRevision: outgoingPayload.revision,
          serverRevision: data.revision,
          httpStatus: res.status,
        });
      }
      // #endregion
      showSyncConflictModal(data);
      updateSyncIndicator('error');
    } else {
      // #region agent log
      if (typeof portalDebugLog === 'function') {
        portalDebugLog('H2', 'tournament.js:187', 'local tournament push rejected', {
          clientRevision: outgoingPayload.revision,
          httpStatus: res.status,
          responseRevision: data.revision || null,
        });
      }
      // #endregion
      updateSyncIndicator('error');
    }
  } catch (err) {
    // #region agent log
    if (typeof portalDebugLog === 'function') {
      portalDebugLog('H2', 'tournament.js:198', 'local tournament push failed', {
        revision: tournamentSync.revision,
        error: String(err?.message || err),
      });
    }
    // #endregion
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

  const pollMs = document.hidden ? 4000 : SYNC_POLL_MS;

  if (tournamentSync.pendingConflict) {
    tournamentSync.pollTimer = setTimeout(pollTournamentState, pollMs);
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

  tournamentSync.pollTimer = setTimeout(pollTournamentState, pollMs);
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
  // #region agent log
  if (typeof portalDebugLog === 'function') {
    portalDebugLog('H2,H5', 'tournament.js:422', 'local tournament session persisted', {
      session: tournamentState.session,
      skipPush,
      syncEnabled: tournamentSync.enabled,
      revision: tournamentSync.revision,
      players: tournamentState.players.length,
      drawn: tournamentState.drawn,
      activeMatchId: tournamentState.activeMatchId || null,
    });
  }
  // #endregion
  if (!skipPush && tournamentSync.enabled && !tournamentSync.applyingRemote) {
    pushTournamentState();
  }
  if (!skipPush && typeof scheduleCloudTournamentPush === 'function') {
    scheduleCloudTournamentPush();
  }
  if (!skipPush && typeof scheduleRoomSessionPush === 'function') {
    scheduleRoomSessionPush();
  }
}

function loadSession(session) {
  tournamentState.session = session;
  const data = getSessionData();
  applySessionData(data);
  advanceWinners();
  persistSession();
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

function makeMatch(phase, index, p1Id, p2Id, label, extra = {}) {
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
    ...extra,
  };
}

function getPrelimTarget(playerCount) {
  if (playerCount > QUARTER_ENTRANTS) return QUARTER_ENTRANTS;
  if (playerCount > 2 && playerCount % 2 === 1) return playerCount - 1;
  return 0;
}

function getMaxPrelimRound() {
  let max = 1;
  (tournamentState.matches.prelim || []).forEach((m) => {
    max = Math.max(max, m.round || 1);
  });
  Object.keys(tournamentState.matches.prelimByes || {}).forEach((round) => {
    max = Math.max(max, Number(round) || 1);
  });
  return Math.min(4, max);
}

function prelimRoundHasFollowUp(roundNo) {
  return roundNo < getMaxPrelimRound() || (roundNo === 1 && prelimNeedsRound2());
}

function repairRoundByePairs(phase, targetCount, labelPrefix) {
  const bucket = tournamentState.matches;
  const byeKey = `${phase}Byes`;
  if (!bucket[byeKey] || !bucket[phase]) return false;

  let changed = false;
  Object.keys(bucket[byeKey]).forEach((roundStr) => {
    const roundNo = Number(roundStr);
    const roundByes = bucket[byeKey][roundNo];
    if (!roundByes?.length) return;

    while (roundByes.length >= 2) {
      const p1 = roundByes.shift();
      const p2 = roundByes.shift();
      const exists = bucket[phase].some((m) =>
        (m.round || 1) === roundNo
        && ((m.p1Id === p1 && m.p2Id === p2) || (m.p1Id === p2 && m.p2Id === p1))
      );
      if (exists) continue;

      const label = `${labelPrefix} R${roundNo}-${bucket[phase].filter((m) => (m.round || 1) === roundNo).length + 1}`;
      bucket[phase].push(makeMatch(phase, bucket[phase].length, p1, p2, label, { round: roundNo }));
      changed = true;
    }
  });
  return changed;
}

function prelimNeedsRound2() {
  return getMaxPrelimRound() >= 2 || (() => {
    const prelim = tournamentState.matches.prelim || [];
    const r1 = prelim.filter((m) => (m.round || 1) === 1);
    const r1Byes = (tournamentState.matches.prelimByes || {})[1] || [];
    if (!r1.length) return false;
    return r1Byes.length + r1.length > QUARTER_ENTRANTS;
  })();
}

function getPrelimByePlayerIds(roundNo) {
  const byes = (tournamentState.matches.prelimByes || {})[roundNo] || [];
  const ids = byes.filter(Boolean);
  if (roundNo !== 1) return ids;

  const inLaterRound = new Set();
  (tournamentState.matches.prelim || []).forEach((m) => {
    if ((m.round || 1) >= 2) {
      if (m.p1Id) inLaterRound.add(m.p1Id);
      if (m.p2Id) inLaterRound.add(m.p2Id);
    }
  });
  Object.entries(tournamentState.matches.prelimByes || {}).forEach(([round, roundByes]) => {
    if (Number(round) >= 2) roundByes.forEach((id) => { if (id) inLaterRound.add(id); });
  });
  return ids.filter((id) => !inLaterRound.has(id));
}

function getPrelimByeEntries(roundNo) {
  const byes = (tournamentState.matches.prelimByes || {})[roundNo] || [];
  const visibleIds = new Set(getPrelimByePlayerIds(roundNo));
  return byes
    .map((id, index) => ({ id, index }))
    .filter((entry) => entry.id && visibleIds.has(entry.id));
}

function adminUpdatePrelimBye(roundNo, byeIndex, playerInput) {
  const byes = (tournamentState.matches.prelimByes || {})[roundNo];
  if (!byes || byeIndex < 0 || byeIndex >= byes.length) return false;

  const name = (playerInput || '').trim().slice(0, 16);
  if (!name) {
    alert('輪空選手名字不能留空');
    return false;
  }

  const oldId = byes[byeIndex];
  const existing = tournamentState.players.find((player) =>
    player.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0
  );
  const nextId = existing?.id || resolveMatchPlayerInput(name);
  if (!nextId || nextId === oldId) return true;

  const completedMatch = (tournamentState.matches.prelim || []).find((match) =>
    match.status === 'done' && (match.p1Id === nextId || match.p2Id === nextId)
  );
  if (completedMatch) {
    alert(`${playerName(nextId)} 已完成 ${completedMatch.label}，不能改為輪空選手`);
    return false;
  }

  let swapped = false;
  const sourceMatch = (tournamentState.matches.prelim || []).find((match) =>
    match.status === 'pending' && (match.p1Id === nextId || match.p2Id === nextId)
  );
  if (sourceMatch) {
    if (sourceMatch.p1Id === nextId) sourceMatch.p1Id = oldId;
    else sourceMatch.p2Id = oldId;
    sourceMatch.pairingLocked = true;
    adminResetMatchFields(sourceMatch);
    swapped = true;
  }

  if (!swapped) {
    const byeMaps = tournamentState.matches.prelimByes || {};
    for (const roundByes of Object.values(byeMaps)) {
      const sourceIndex = roundByes.findIndex((id) => id === nextId);
      if (sourceIndex >= 0) {
        roundByes[sourceIndex] = oldId;
        swapped = true;
        break;
      }
    }
  }

  byes[byeIndex] = nextId;
  advanceWinners();
  persistSession();
  renderTournamentUI({ scrollActive: false });
  addLog(`⚙ 初賽 R${roundNo} 輪空改為 ${escapeHtml(playerName(nextId))}`, 'system');
  return true;
}

function renderPrelimByeList(roundNo) {
  const entries = getPrelimByeEntries(roundNo);
  if (!entries.length) return '';
  const hint = prelimRoundHasFollowUp(roundNo) ? `→ R${roundNo + 1}` : '→ 複賽';
  return `<ul class="bracket-bye-list" aria-label="初賽 R${roundNo} 輪空">
    ${entries.map(({ id, index }) => `
      <li class="bracket-bye-item">
        <span class="bracket-label">R${roundNo} 輪空</span>
        <label class="bracket-bye-player-edit">
          <input class="bracket-bye-player-input" type="text" maxlength="16"
            list="bye-player-options-${roundNo}-${index}" value="${escapeHtml(playerName(id))}"
            placeholder="輸入或選擇名字" autocomplete="off" aria-label="輪空選手">
          <datalist id="bye-player-options-${roundNo}-${index}">
            ${tournamentState.players.map((player) => `<option value="${escapeHtml(player.name)}"></option>`).join('')}
          </datalist>
        </label>
        <button type="button" class="btn btn-xs btn-ghost btn-save-bye-adjust"
          data-round="${roundNo}" data-bye-index="${index}">儲存</button>
        <span class="bracket-bye-hint">${hint}</span>
      </li>`).join('')}
  </ul>`;
}

function getActiveQuarterMatches() {
  const q = tournamentState.matches.quarter;
  if (!q) return [];
  return q.filter((m) => m.p1Id && m.p2Id);
}

function isQuarterSingleSlot(slot) {
  if (!slot) return false;
  return Boolean((slot.p1Id && !slot.p2Id) || (!slot.p1Id && slot.p2Id));
}

function getQuarterSlotChampion(slot) {
  if (!slot) return null;
  // 只認正式完場勝者；單人輪空須等雙人場全部打完後才 finalize
  if (slot.status === 'done' && slot.winnerId) return slot.winnerId;
  return null;
}

function repairQuarterByeSlots() {
  const q = tournamentState.matches.quarter;
  if (!q) return false;

  let changed = false;
  const singleIndices = [];
  q.forEach((slot, idx) => {
    if (slot.status === 'done' || slot.pairingLocked) return;
    if (isQuarterSingleSlot(slot)) singleIndices.push(idx);
  });

  while (singleIndices.length >= 2) {
    const i = singleIndices.shift();
    const j = singleIndices.shift();
    const a = q[i];
    const b = q[j];
    const bPlayer = b.p1Id || b.p2Id;
    if (!bPlayer) continue;

    if (a.p1Id && !a.p2Id) a.p2Id = bPlayer;
    else if (!a.p1Id && a.p2Id) a.p1Id = bPlayer;
    else continue;

    adminClearMatchSlot(b);
    adminResetMatchFields(a);
    changed = true;
  }

  return changed;
}

/** 全部雙人複賽打完後，剩餘單人輪空才正式晉級（避免未打完就進準決賽） */
function finalizeQuarterByeSlots() {
  const q = tournamentState.matches.quarter;
  if (!q) return false;

  const dualMatches = q.filter((m) => m.p1Id && m.p2Id);
  // 尚有未完雙人場時，輪空不可先晉級
  if (dualMatches.some((m) => m.status !== 'done' || !m.winnerId)) {
    return false;
  }

  let changed = false;
  q.forEach((slot) => {
    if (slot.status === 'done' || !isQuarterSingleSlot(slot)) return;
    autoAdvanceBye(slot);
    if (tournamentState.activeMatchId === slot.id) {
      tournamentState.activeMatchId = null;
    }
    changed = true;
  });
  return changed;
}

function syncPendingBracketPairing(match, p1Id, p2Id) {
  if (!match || match.status === 'done' || match.pairingLocked) return;
  const wasPlayed = match.status === 'done' && (match.scores || match.liveScores);
  match.p1Id = p1Id || null;
  match.p2Id = p2Id || null;
  if (!match.p1Id && !match.p2Id) {
    if (!wasPlayed) adminResetMatchFields(match);
  } else if (match.p1Id && match.p2Id) {
    if (!wasPlayed) adminResetMatchFields(match);
  } else {
    adminResetMatchFields(match);
  }
}

function validateUniqueEntrants(ids, context) {
  const seen = new Set();
  for (const id of ids) {
    if (!id) continue;
    if (seen.has(id)) {
      console.warn(`Duplicate player in ${context}:`, id);
      return false;
    }
    seen.add(id);
  }
  return true;
}

function createReductionRound(phase, roundNo, entrants, targetCount, labelPrefix, startIndex = 0) {
  const ids = [...entrants];
  validateUniqueEntrants(ids, `${labelPrefix} R${roundNo}`);

  if (ids.length <= targetCount) {
    return { matches: [], byes: ids };
  }

  let matchesNeeded = Math.min(Math.floor(ids.length / 2), Math.max(0, ids.length - targetCount));
  const matches = [];
  for (let i = 0; i < matchesNeeded; i++) {
    const p1Id = ids[i * 2];
    const p2Id = ids[i * 2 + 1];
    const needsRoundLabel = roundNo > 1 || ids.length > targetCount;
    const label = needsRoundLabel
      ? `${labelPrefix} R${roundNo}-${i + 1}`
      : `${labelPrefix} ${i + 1}`;
    matches.push(makeMatch(phase, startIndex + i, p1Id, p2Id, label, { round: roundNo }));
  }

  let byes = ids.slice(matchesNeeded * 2);
  while (byes.length >= 2) {
    const p1Id = byes.shift();
    const p2Id = byes.shift();
    const label = `${labelPrefix} R${roundNo}-${matches.length + 1}`;
    matches.push(makeMatch(phase, startIndex + matches.length, p1Id, p2Id, label, { round: roundNo }));
  }

  return { matches, byes };
}

function ensureReductionRound(phase, targetCount, labelPrefix, entrants, roundNo) {
  const bucket = tournamentState.matches;
  const byeKey = `${phase}Byes`;
  if (!bucket[phase]) bucket[phase] = [];
  if (!bucket[byeKey]) bucket[byeKey] = {};
  if (bucket[phase].some((m) => (m.round || 1) === roundNo)) return;
  const { matches, byes } = createReductionRound(
    phase,
    roundNo,
    entrants,
    targetCount,
    labelPrefix,
    bucket[phase].length,
  );
  bucket[phase].push(...matches);
  bucket[byeKey][roundNo] = byes;
}

function advanceReductionPhase(phase, targetCount, labelPrefix) {
  const bucket = tournamentState.matches;
  const matches = bucket[phase] || [];
  const byeKey = `${phase}Byes`;
  const directKey = `${phase}Direct`;

  if (!matches.length) {
    return {
      complete: true,
      survivors: bucket[directKey] || [],
    };
  }

  let roundNo = 1;
  while (true) {
    const roundMatches = matches.filter((m) => (m.round || 1) === roundNo);
    if (!roundMatches.length) {
      return { complete: false, survivors: [] };
    }
    roundMatches.forEach(autoAdvanceBye);
    if (!roundMatches.every((m) => m.status === 'done' && m.winnerId)) {
      return { complete: false, survivors: [] };
    }

    const roundByes = (bucket[byeKey] && bucket[byeKey][roundNo]) || [];
    const matchWinners = roundMatches.map((m) => m.winnerId).filter(Boolean);
    const survivors = [...roundByes, ...matchWinners];

    if (survivors.length <= targetCount) {
      return { complete: true, survivors };
    }

    const nextRoundExists = matches.some((m) => (m.round || 1) === roundNo + 1);
    ensureReductionRound(phase, targetCount, labelPrefix, survivors, roundNo + 1);
    if (!nextRoundExists) return { complete: false, survivors };
    roundNo += 1;
  }
}

function buildBracketFromDraw(playerIds) {
  const shuffled = shuffle(playerIds);
  const matches = {};

  matches.prelim = [];
  matches.prelimByes = {};
  matches.prelimDirect = [];
  const prelimTarget = getPrelimTarget(shuffled.length);
  if (prelimTarget > 0 && shuffled.length > prelimTarget) {
    const firstRound = createReductionRound('prelim', 1, shuffled, prelimTarget, '初賽');
    matches.prelim = firstRound.matches;
    matches.prelimByes[1] = firstRound.byes;
  } else {
    matches.prelimDirect = shuffled;
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

function getRevivalEntrantIds() {
  const m = tournamentState.matches;
  const ids = new Set();
  (m.revival || []).forEach((match) => {
    if (match.p1Id) ids.add(match.p1Id);
    if (match.p2Id) ids.add(match.p2Id);
  });
  (m.revivalDirect || []).forEach((id) => { if (id) ids.add(id); });
  Object.values(m.revivalByes || {}).flat().forEach((id) => { if (id) ids.add(id); });
  return ids;
}

function revivalEntrantsMatch(expectedLosers) {
  const expected = new Set(expectedLosers);
  const current = getRevivalEntrantIds();
  if (expected.size !== current.size) return false;
  for (const id of expected) {
    if (!current.has(id)) return false;
  }
  return true;
}

function clearRevivalBracket() {
  tournamentState.matches.revival = [];
  tournamentState.matches.revivalByes = {};
  tournamentState.matches.revivalDirect = [];
  tournamentState.revivalWinnerId = null;
  if (tournamentState.matches.challenge) {
    tournamentState.matches.challenge.p1Id = null;
    tournamentState.matches.challenge.p2Id = null;
    adminResetMatchFields(tournamentState.matches.challenge);
  }
}

function getPrelimLosersForRevival(prelimSurvivors) {
  const survivors = new Set(prelimSurvivors || []);
  return getPrelimLosers().filter((id) => id && !survivors.has(id));
}

function syncRevivalFromPrelim(prelimResult, prelimSurvivors) {
  const revivalLosers = getPrelimLosersForRevival(prelimSurvivors);
  tournamentState.eliminatedIds = revivalLosers;

  if (!prelimResult.complete || revivalLosers.length < 2) {
    if (!revivalEntrantsMatch(revivalLosers)) clearRevivalBracket();
    return;
  }

  if (!revivalEntrantsMatch(revivalLosers)) {
    clearRevivalBracket();
    setupRevivalBracket(revivalLosers);
  }
}

function setupRevivalBracket(eliminatedIds) {
  const prelimLosers = new Set(getPrelimLosers());
  const entrants = eliminatedIds.filter((id) => prelimLosers.has(id));
  validateUniqueEntrants(entrants, '復活賽');
  const shuffled = shuffle(entrants);
  tournamentState.matches.revival = [];
  tournamentState.matches.revivalByes = {};
  tournamentState.matches.revivalDirect = [];

  if (shuffled.length <= 1) {
    tournamentState.matches.revivalDirect = shuffled;
    return;
  }

  const firstRound = createReductionRound('revival', 1, shuffled, 1, '復活');
  tournamentState.matches.revival = firstRound.matches;
  tournamentState.matches.revivalByes[1] = firstRound.byes;
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

function isLegacyRevivalBracket(rev) {
  return rev?.some((m) => m.label === '逆轉小羊決賽');
}

function advanceLegacyRevival(rev) {
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

function advanceRevival() {
  const rev = tournamentState.matches.revival;
  if (!rev) return;

  if (isLegacyRevivalBracket(rev)) {
    advanceLegacyRevival(rev);
    return;
  }

  const result = advanceReductionPhase('revival', 1, '復活');
  if (result.complete && result.survivors[0]) {
    tournamentState.revivalWinnerId = result.survivors[0];
    if (tournamentState.matches.challenge) {
      tournamentState.matches.challenge.p1Id = result.survivors[0];
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
  const q = tournamentState.matches.quarter || [];
  const occupied = q.filter((m) => m.p1Id || m.p2Id);
  if (!occupied.length) return false;
  // 雙人場須打完；單人輪空須已 finalize 為 done（不可未完場就進準決賽）
  return occupied.every((m) => m.status === 'done' && m.winnerId);
}

function isRevivalComplete() {
  const rev = tournamentState.matches.revival;
  if (isLegacyRevivalBracket(rev)) {
    const revFinal = rev.find((m) => m.label === '逆轉小羊決賽');
    return revFinal?.status === 'done' && !!revFinal.winnerId;
  }
  if (!rev?.length) return Boolean(tournamentState.revivalWinnerId || tournamentState.matches.revivalDirect?.length);
  return Boolean(tournamentState.revivalWinnerId);
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
  const quarters = m.quarter || [];
  const topFour = quarters.slice(0, 4).map(getQuarterSlotChampion);

  if (tournamentState.revivalWinnerId && m.challenge?.status === 'done') {
    const challengedId = m.challenge.p2Id;
    const qIdx = quarters.findIndex((q) =>
      q.winnerId === challengedId || q.p1Id === challengedId || q.p2Id === challengedId
    );
    if (qIdx >= 0) topFour[qIdx] = m.challenge.winnerId;
  }

  return topFour;
}

function clearPendingBracketSlots(matches) {
  if (!matches) return;
  const list = Array.isArray(matches) ? matches : [matches];
  list.forEach((s) => {
    if (s.status !== 'done' && !s.pairingLocked) {
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

  repairRoundByePairs('prelim', QUARTER_ENTRANTS, '初賽');
  let prelimResult = advanceReductionPhase('prelim', QUARTER_ENTRANTS, '初賽');
  if (repairRoundByePairs('prelim', QUARTER_ENTRANTS, '初賽')) {
    prelimResult = advanceReductionPhase('prelim', QUARTER_ENTRANTS, '初賽');
  }

  for (let i = 0; i < 4; i++) {
    if (m.quarter[i]) {
      if (m.quarter[i].pairingLocked) continue;
      if (!prelimResult.complete) {
        if (m.quarter[i].status !== 'done') {
          m.quarter[i].p1Id = null;
          m.quarter[i].p2Id = null;
          m.quarter[i].winnerId = null;
          m.quarter[i].status = 'pending';
          m.quarter[i].scores = null;
          m.quarter[i].battles = null;
          m.quarter[i].liveScores = null;
        }
        continue;
      }

      const quarterMatch = m.quarter[i];
      const quarterWasPlayed = quarterMatch.status === 'done'
        && (quarterMatch.scores || quarterMatch.liveScores);
      quarterMatch.p1Id = prelimResult.survivors[i * 2] || null;
      quarterMatch.p2Id = prelimResult.survivors[i * 2 + 1] || null;
      if (!quarterMatch.p1Id && !quarterMatch.p2Id) {
        if (!quarterWasPlayed) adminResetMatchFields(quarterMatch);
      } else if (quarterMatch.p1Id && quarterMatch.p2Id) {
        if (!quarterWasPlayed) adminResetMatchFields(quarterMatch);
      } else {
        // 複賽輪空不可自動完場，須等雙人對戰。
        adminResetMatchFields(quarterMatch);
      }
    }
  }

  repairQuarterByeSlots();
  finalizeQuarterByeSlots();

  syncRevivalFromPrelim(prelimResult, prelimResult.survivors);

  advanceRevival();

  const topFour = getOfficialTopFour();
  if (topFour && m.semi) {
    syncPendingBracketPairing(m.semi[0], topFour[0], topFour[1]);
    syncPendingBracketPairing(m.semi[1], topFour[2], topFour[3]);
  } else {
    clearPendingBracketSlots(m.semi);
    clearPendingBracketSlots(m.final);
  }

  // Slot-indexed fill (same as semis): one semi done → finals shows winner vs 待定
  if (m.final) {
    syncPendingBracketPairing(
      m.final,
      m.semi?.[0]?.winnerId || null,
      m.semi?.[1]?.winnerId || null,
    );
  }
}

const PHASE_ORDER = { prelim: 0, revival: 1, quarter: 2, challenge: 3, semi: 4, final: 5 };

function getAllMatchesFlat() {
  return getAllMatches({ matches: tournamentState.matches });
}

function getReadyMatches() {
  return getAllMatchesFlat()
    .filter((m) => m.status === 'pending' && m.p1Id && m.p2Id)
    .sort((a, b) => {
      const priorityDiff = (b.queuePriority || 0) - (a.queuePriority || 0);
      return priorityDiff || (PHASE_ORDER[a.phase] ?? 9) - (PHASE_ORDER[b.phase] ?? 9);
    });
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
      document.body.classList.remove('victory-open');
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
  delete match.queuePriority;
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

function adminRequirePin() {
  return true;
}

function adminResetMatchFields(match) {
  match.status = 'pending';
  match.winnerId = null;
  match.scores = null;
  match.battles = null;
  match.liveScores = null;
  match.liveBattles = null;
}

function adminClearMatchSlot(match) {
  adminResetMatchFields(match);
  match.p1Id = null;
  match.p2Id = null;
  delete match.pairingLocked;
  delete match.queuePriority;
}

function getMatchPairingPlayerIds(match) {
  const ids = [];
  getAllMatchesFlat().forEach((candidate) => {
    if (candidate.phase !== match.phase || (candidate.status === 'done' && candidate.id !== match.id)) return;
    [candidate.p1Id, candidate.p2Id].forEach((id) => {
      if (id && !ids.includes(id)) ids.push(id);
    });
  });
  return ids;
}

function resolveMatchPlayerInput(value) {
  const name = (value || '').trim().slice(0, 16);
  if (!name) return null;
  const existing = tournamentState.players.find((player) =>
    player.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0
  );
  if (existing) return existing.id;
  const player = { id: genId(), name };
  tournamentState.players.push(player);
  return player.id;
}

function adminUpdateMatch(matchId, label, p1Name, p2Name) {
  const match = findMatch(matchId);
  if (!match) return false;

  const nextLabel = (label || '').trim().slice(0, 40);
  match.label = nextLabel;

  if (match.status === 'done') {
    persistSession();
    renderTournamentUI({ scrollActive: false });
    return true;
  }

  if (tournamentState.activeMatchId === matchId) {
    alert('此場正在計分，請先返回賽程或完成比賽再調整');
    return false;
  }

  const normalizedP1 = (p1Name || '').trim().slice(0, 16);
  const normalizedP2 = (p2Name || '').trim().slice(0, 16);
  if (normalizedP1 && normalizedP2
    && normalizedP1.localeCompare(normalizedP2, undefined, { sensitivity: 'accent' }) === 0) {
    alert('同一位選手不能同時出現在對戰雙方');
    return false;
  }

  const nextP1 = resolveMatchPlayerInput(normalizedP1);
  const nextP2 = resolveMatchPlayerInput(normalizedP2);

  const pairingChanged = match.p1Id !== nextP1 || match.p2Id !== nextP2;
  if (pairingChanged) {
    const oldIds = [match.p1Id, match.p2Id].filter(Boolean);
    const newIds = [nextP1, nextP2].filter(Boolean);
    const displaced = oldIds.filter((id) => !newIds.includes(id));

    for (const selectedId of newIds) {
      if (oldIds.includes(selectedId)) continue;
      const source = getAllMatchesFlat().find((candidate) =>
        candidate.id !== match.id
        && candidate.phase === match.phase
        && candidate.status === 'pending'
        && (candidate.p1Id === selectedId || candidate.p2Id === selectedId)
      );
      if (!source) continue;
      const replacement = displaced.shift() || null;
      if (source.p1Id === selectedId) source.p1Id = replacement;
      else source.p2Id = replacement;
      source.pairingLocked = true;
      adminResetMatchFields(source);
    }

    match.p1Id = nextP1;
    match.p2Id = nextP2;
    match.pairingLocked = true;
    adminResetMatchFields(match);
  }

  persistSession();
  renderTournamentUI({ scrollActive: false });
  addLog(`⚙ 已調整 ${escapeHtml(match.label)}`, 'system');
  return true;
}

function adminSwapMatchSides(matchId) {
  const match = findMatch(matchId);
  if (!match || match.status === 'done' || !match.p1Id || !match.p2Id) return false;
  if (tournamentState.activeMatchId === matchId) {
    alert('此場正在計分，不能交換紅藍方');
    return false;
  }
  [match.p1Id, match.p2Id] = [match.p2Id, match.p1Id];
  if (match.liveScores) [match.liveScores[0], match.liveScores[1]] = [match.liveScores[1], match.liveScores[0]];
  match.pairingLocked = true;
  persistSession();
  renderTournamentUI({ scrollActive: false });
  return true;
}

function adminRestoreAutomaticPairing(matchId) {
  const match = findMatch(matchId);
  if (!match || match.status === 'done') return false;
  delete match.pairingLocked;
  delete match.queuePriority;
  advanceWinners();
  persistSession();
  renderTournamentUI({ scrollActive: false });
  return true;
}

function adminToggleNextPriority(matchId) {
  const match = findMatch(matchId);
  if (!match || match.status !== 'pending' || !match.p1Id || !match.p2Id) return false;
  if (match.queuePriority) delete match.queuePriority;
  else {
    getAllMatchesFlat().forEach((candidate) => { delete candidate.queuePriority; });
    match.queuePriority = Date.now();
  }
  persistSession();
  renderTournamentUI({ scrollActive: false });
  return true;
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
  if (myPhase <= PHASE_ORDER.revival) {
    tournamentState.revivalWinnerId = null;
  }
  getAllMatchesFlat().forEach((m) => {
    if ((PHASE_ORDER[m.phase] ?? 0) > myPhase) adminClearMatchSlot(m);
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
    // Tied / trailing (e.g. 0:0) still needs a decisive winner score for display
    if (finalScores[wIdx] <= finalScores[lIdx]) {
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
    <h1>咩咩遊樂園 — 賽程表</h1><p>${new Date().toLocaleString()}</p><p>${escapeHtml(getScheduleRules())}</p>${rows.join('')}
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
  if (typeof scheduleRoomLiveScores === 'function') {
    scheduleRoomLiveScores(scores, battles);
  }
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
  tournamentState.drawn = true;
  tournamentState.eliminatedIds = [];
  tournamentState.revivalWinnerId = null;
  tournamentState.activeMatchId = null;
  advanceWinners();
  persistSession();
  renderTournamentUI();
  addLog(`抽籤完成 — ${ids.length} 名選手，初賽打至 ${Math.min(ids.length, QUARTER_ENTRANTS)} 強`);
  spawnConfetti(40);
}

function resetTournament() {
  if (!confirm('清除本場抽籤與賽程？（選手名單保留）')) return;
  tournamentState.drawn = false;
  tournamentState.matches = {};
  tournamentState.eliminatedIds = [];
  tournamentState.revivalWinnerId = null;
  tournamentState.activeMatchId = null;
  if (typeof releaseMatchLock === 'function') releaseMatchLock();
  persistSession();
  renderTournamentUI();
  addLog('已重設賽程（選手名單保留）');
  if (typeof showToast === 'function') showToast('已重設賽程');
}

function resetRoster() {
  if (!tournamentState.players.length && !tournamentState.drawn) {
    if (typeof showToast === 'function') showToast('選手名單已是空的');
    return;
  }
  const msg = tournamentState.drawn
    ? '清空選手名單並一併清除抽籤與賽程？此操作無法復原。'
    : '清空本場選手名單？';
  if (!confirm(msg)) return;

  tournamentState.players = [];
  tournamentState.drawn = false;
  tournamentState.matches = {};
  tournamentState.eliminatedIds = [];
  tournamentState.revivalWinnerId = null;
  tournamentState.activeMatchId = null;
  if (typeof releaseMatchLock === 'function') releaseMatchLock();
  const bulk = $('#bulk-players');
  if (bulk) bulk.value = '';
  persistSession();
  renderTournamentUI();
  addLog('已重置選手名單');
  if (typeof showToast === 'function') showToast('選手名單已清空');
}

async function loadMatchToScoreboard(matchId) {
  const match = findMatch(matchId);
  if (!match) return;
  if (!match.p1Id && !match.p2Id) {
    alert('此對戰尚未確定選手');
    return;
  }
  if (match.phase === 'quarter' && isQuarterSingleSlot(match) && match.status !== 'done') {
    alert('複賽輪空席位須等其他雙人場打完後才自動晉級，或先在「調整場次」配對對手');
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
  if (typeof roomSetActive === 'function') {
    roomSetActive(matchId).catch(() => {});
  }
  const scoreHint = match.scores ? ` · 戰績 <span class="log-score">${match.scores[0]} : ${match.scores[1]}</span>` : '';
  addLog(`── ${match.label} ──`, 'system', { type: 'log-section' });
  addLog(
    `${escapeHtml(playerName(match.p1Id))} <span class="log-vs">vs</span> ${escapeHtml(playerName(match.p2Id))}${scoreHint}`,
    'system',
    { type: 'log-section' }
  );
  hideVictorySchedulePanel();
  $('#victory-overlay').hidden = true;
  document.body.classList.remove('victory-open');

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

  const matchId = tournamentState.activeMatchId;
  const side = resolveWinnerSide(match, winnerSide);
  const ok = recordMatchWinner(matchId, side, result);
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
    if (typeof roomRecordWinner === 'function') {
      roomRecordWinner(matchId, side, scores, battles).catch(() => {});
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

  if (count) count.textContent = `${tournamentState.players.length} / 不限`;

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
  prelim: { title: '初賽', sub: 'R1 → R2 → 複賽', cls: 'phase-prelim' },
  revival: { title: '復活賽', sub: '僅初賽落敗者', cls: 'phase-revival' },
  quarter: { title: '複賽', sub: '8 → 4 · 落敗直接淘汰', cls: 'phase-quarter' },
  challenge: { title: '四強挑戰', sub: '小羊抽籤', cls: 'phase-challenge' },
  semi: { title: '準決賽', sub: '4 → 2', cls: 'phase-semi' },
  final: { title: '決賽', sub: '冠軍', cls: 'phase-final' },
};

function renderPairingOptions(match) {
  const suggestedIds = getMatchPairingPlayerIds(match);
  const allIds = [
    ...suggestedIds,
    ...tournamentState.players.map((player) => player.id).filter((id) => !suggestedIds.includes(id)),
  ];
  return allIds
    .map((id) => `<option value="${escapeHtml(playerName(id))}"></option>`)
    .join('');
}

function renderMatchCard(match) {
  const isByePending = match.phase === 'quarter' && isQuarterSingleSlot(match) && match.status !== 'done';
  const active = !isByePending && match.id === tournamentState.activeMatchId;
  const statusClass = match.status === 'done' ? 'done' : isByePending ? 'pending bye-pending' : active ? 'active' : 'pending';
  const statusLabel = match.status === 'done' ? '完畢' : isByePending ? '輪空' : active ? '進行中' : '待賽';
  const p1Win = match.winnerId === match.p1Id;
  const p2Win = match.winnerId === match.p2Id;
  const canStart = !isByePending && (match.p1Id || match.p2Id);
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

  const pairingEditor = match.status !== 'done' ? `
    <div class="bracket-pairing-edit">
      <label>
        <span>紅方</span>
        <input class="bracket-player-select" data-side="1" type="text" maxlength="16"
          list="match-player-options-${escapeHtml(match.id)}" value="${escapeHtml(match.p1Id ? playerName(match.p1Id) : '')}"
          placeholder="輸入或選擇名字" autocomplete="off">
      </label>
      <button type="button" class="btn btn-xs btn-ghost btn-swap-sides" title="交換紅藍方">⇄</button>
      <label>
        <span>藍方</span>
        <input class="bracket-player-select" data-side="2" type="text" maxlength="16"
          list="match-player-options-${escapeHtml(match.id)}" value="${escapeHtml(match.p2Id ? playerName(match.p2Id) : '')}"
          placeholder="輸入或選擇名字" autocomplete="off">
      </label>
      <datalist id="match-player-options-${escapeHtml(match.id)}">${renderPairingOptions(match)}</datalist>
    </div>` : '';

  const adjustEditor = `
    <details class="bracket-adjust">
      <summary>調整場次${match.pairingLocked ? ' · 手動配對' : ''}${match.queuePriority ? ' · 優先' : ''}</summary>
      <div class="bracket-adjust-panel">
        <label class="bracket-label-edit">
          <span>場次名稱</span>
          <input class="bracket-label-input" type="text" maxlength="40" value="${escapeHtml(match.label)}">
        </label>
        ${pairingEditor}
        <div class="bracket-adjust-actions">
          <button type="button" class="btn btn-xs btn-primary btn-save-match-adjust">儲存調整</button>
          ${match.status !== 'done' && match.p1Id && match.p2Id ? `
            <button type="button" class="btn btn-xs btn-ghost btn-toggle-next-priority">
              ${match.queuePriority ? '取消優先' : '設為下一場'}
            </button>` : ''}
          ${match.status !== 'done' && match.pairingLocked ? `
            <button type="button" class="btn btn-xs btn-ghost btn-restore-pairing">恢復自動配對</button>` : ''}
        </div>
        ${match.status === 'done'
          ? '<p class="bracket-adjust-hint">已完場，只可修改名稱；如需改選手請先撤銷結果。</p>'
          : isByePending
            ? '<p class="bracket-adjust-hint">可直接輸入新名字；新選手會加入名單。輪空席位須等其他雙人場打完後才晉級。</p>'
            : '<p class="bracket-adjust-hint">可直接輸入新名字或選擇現有選手；跨場選手會自動交換位置。</p>'}
      </div>
    </details>`;

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
      <div class="slot-divider">${isByePending ? '輪空' : (scoreText || 'VS')}</div>
      <div class="${slotClass(2, match.p2Id, p2Win, p1Win)}">
        <span class="slot-name">${escapeHtml(playerName(match.p2Id))}</span>
        <span class="slot-side-meta">
          ${slotScore(1)}
          ${p2Win ? '<span class="slot-crown" aria-hidden="true">👑</span>' : ''}
        </span>
      </div>
    </div>
    ${scoreEditor}
    ${adjustEditor}
  </li>`;
}

function renderPrelimRoundColumn(roundNo) {
  const list = (tournamentState.matches.prelim || []).filter((m) => (m.round || 1) === roundNo);
  const byeList = renderPrelimByeList(roundNo);
  const maxRound = getMaxPrelimRound();
  const r1ByesWaiting = roundNo > 1
    && roundNo <= maxRound
    && !list.length
    && getPrelimByePlayerIds(roundNo - 1).length
    && !(tournamentState.matches.prelim || []).some((m) => (m.round || 1) >= roundNo);

  const hasContent = list.length || byeList || r1ByesWaiting;
  if (!hasContent) return '';

  const meta = PHASE_STYLES.prelim;
  const done = list.filter((m) => m.status === 'done').length;
  const title = `初賽 R${roundNo}`;
  const sub = roundNo < maxRound
    ? `第 ${roundNo} 輪 · 輪空進 R${roundNo + 1}`
    : roundNo === maxRound && maxRound < 4
      ? `第 ${roundNo} 輪 · 晉級複賽`
      : `第 ${roundNo} 輪`;

  let body = '';
  if (list.length) {
    body += `<ul class="bracket-matches">${list.map(renderMatchCard).join('')}</ul>`;
  }
  if (byeList) body += byeList;
  if (r1ByesWaiting) {
    body += `<div class="bracket-gate-body bracket-r2-wait">
      <p class="bracket-gate-hint">待 R${roundNo - 1} 全部完成後，輪空選手與勝者在此對戰</p>
    </div>`;
  }

  return `<div class="bracket-column ${meta.cls} phase-prelim-r${roundNo}">
    <div class="bracket-column-head">
      <h3 class="bracket-column-title">${title}</h3>
      <span class="bracket-column-sub">${sub}</span>
      <span class="bracket-column-progress">${list.length ? `${done}/${list.length}` : (byeList || r1ByesWaiting ? '輪空' : '—')}</span>
    </div>
    ${body}
  </div>`;
}

function renderPrelimBoard() {
  const maxRound = getMaxPrelimRound();
  let html = '';
  for (let roundNo = 1; roundNo <= maxRound; roundNo += 1) {
    html += renderPrelimRoundColumn(roundNo);
  }
  return html;
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
    nextHint = `<p class="bracket-next-hint flow-hint">${escapeHtml(getScheduleRules())}</p>`;
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
  renderScheduleRules();
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
    renderPrelimBoard() +
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
      if (e.target.closest('button, input, select, summary, details, label')) return;
      const id = card.dataset.matchId;
      if (id) loadMatchToScoreboard(id);
    });
  });

  bracket.querySelectorAll('.bracket-adjust').forEach((details) => {
    details.addEventListener('click', (e) => e.stopPropagation());
    details.addEventListener('dblclick', (e) => e.stopPropagation());
  });

  bracket.querySelectorAll('.btn-save-match-adjust').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = btn.closest('.bracket-match');
      if (!card) return;
      const label = card.querySelector('.bracket-label-input')?.value || '';
      const p1Name = card.querySelector('.bracket-player-select[data-side="1"]')?.value;
      const p2Name = card.querySelector('.bracket-player-select[data-side="2"]')?.value;
      adminUpdateMatch(card.dataset.matchId, label, p1Name, p2Name);
    });
  });

  bracket.querySelectorAll('.btn-swap-sides').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      adminSwapMatchSides(btn.closest('.bracket-match')?.dataset.matchId);
    });
  });

  bracket.querySelectorAll('.btn-restore-pairing').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      adminRestoreAutomaticPairing(btn.closest('.bracket-match')?.dataset.matchId);
    });
  });

  bracket.querySelectorAll('.btn-toggle-next-priority').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      adminToggleNextPriority(btn.closest('.bracket-match')?.dataset.matchId);
    });
  });

  bracket.querySelectorAll('.btn-save-bye-adjust').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = btn.closest('.bracket-bye-item');
      const name = item?.querySelector('.bracket-bye-player-input')?.value || '';
      adminUpdatePrelimBye(
        parseInt(btn.dataset.round, 10),
        parseInt(btn.dataset.byeIndex, 10),
        name,
      );
    });
  });

  bracket.querySelectorAll('.bracket-bye-player-input').forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      input.closest('.bracket-bye-item')?.querySelector('.btn-save-bye-adjust')?.click();
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
  if (typeof wireRoomBindUi === 'function') wireRoomBindUi();
  if (typeof initRoomSyncFromQuery === 'function') initRoomSyncFromQuery();

  sessionSelect?.addEventListener('change', () => {
    loadSession(sessionSelect.value);
    if (typeof roomSync !== 'undefined' && roomSync?.enabled) {
      roomSync.session = sessionSelect.value === 'senior' ? 'senior' : 'junior';
      if (typeof applyRoomSessionToLocal === 'function') {
        applyRoomSessionToLocal().catch(() => {});
      }
    }
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
  $('#btn-reset-roster')?.addEventListener('click', resetRoster);

  $('#btn-save-schedule-rules')?.addEventListener('click', () => {
    setScheduleRules($('#schedule-rules-input')?.value || '');
    $('#schedule-rules-edit')?.removeAttribute('open');
    if (typeof showToast === 'function') showToast('賽程規定已儲存');
  });
  $('#btn-reset-schedule-rules')?.addEventListener('click', () => {
    tournamentState.scheduleRules = '';
    persistSession();
    renderScheduleRules();
    $('#schedule-rules-edit')?.removeAttribute('open');
    if (typeof showToast === 'function') showToast('已還原預設規定');
  });
  $('#schedule-rules-edit')?.addEventListener('toggle', () => {
    if ($('#schedule-rules-edit')?.open) {
      const input = $('#schedule-rules-input');
      if (input) {
        input.value = getScheduleRules();
        input.focus();
      }
    }
  });
  $('#schedule-rules-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      $('#btn-save-schedule-rules')?.click();
    }
  });

  document.querySelectorAll('.tournament-tools-menu button').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.closest('details')?.removeAttribute('open');
    });
  });
}
