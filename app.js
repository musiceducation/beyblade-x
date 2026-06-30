/**
 * 咩咩遊樂園 — Beyblade X 陀螺競賽
 * Scoring, live camera, and visual effects
 */

const LAUNCH_SEQUENCE = ['Three', 'Two', 'One', 'Go Shoot!'];

const PHASE_LABELS = {
  prelim: '初賽',
  playoff: '附加賽',
  revival: '復活賽',
  quarter: '複賽',
  challenge: '四強挑戰',
  semi: '準決賽',
  final: '決賽',
};

const SESSION_LABELS = {
  junior: '第一場 親子組（6–12歲）',
  senior: '第二場 公開組（12歲+）',
};

const MATCH_TARGET_KEY = 'bex-match-target';
const DEFAULT_MATCH_TARGET = 4;

function getMatchTarget() {
  const v = parseInt(localStorage.getItem(MATCH_TARGET_KEY), 10);
  return Number.isFinite(v) && v >= 1 && v <= 10 ? v : DEFAULT_MATCH_TARGET;
}

function setMatchTarget(n) {
  localStorage.setItem(MATCH_TARGET_KEY, String(Math.max(1, Math.min(10, n))));
}

function updateMatchTargetUI() {
  const target = getMatchTarget();
  const label = document.querySelector('.match-target');
  if (label) label.textContent = `${target} 分制`;
  const input = $('#match-target-input');
  if (input) input.value = String(target);
  updateScoreTracks();
}

const FINISH_POINTS = {
  spin: 1,
  burst: 2,
  over: 2,
  extreme: 3,
};

const FINISH_LABELS = {
  extreme: { zh: '極致收尾', en: 'Xtreme Finish' },
  over: { zh: '擊飛結局', en: 'Over Finish' },
  burst: { zh: '爆裂結局', en: 'Burst Finish' },
  spin: { zh: '殘存結局', en: 'Spin Finish' },
};

const FINISH_DESCRIPTIONS = {
  extreme: '將對手陀螺擊入戰鬥盤外圍的「極限區域」洞口',
  over: '利用撞擊力道，將對手陀螺直接打出場外（掉入擊飛區域）',
  burst: '在戰鬥中將對手陀螺零件撞至分離、解體',
  spin: '對手陀螺先停止旋轉，而自己的陀螺依然持續旋轉（續轉勝）',
};

const state = {
  scores: [0, 0],
  currentBattle: 1,
  matchOver: false,
  readyForNextRound: false,
  finishHistory: [],
  victoryMatchId: null,
  cameraStream: null,
  cameraMode: 'local',
  cameraPeer: null,
  activeRemoteCall: null,
  signalPollTimer: null,
  djiRefreshTimer: null,
  djiInfo: null,
  remoteRoomId: null,
  remoteLink: '',
  lanBaseUrl: '',
  phoneCamBaseUrl: '',
};

// DOM refs
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const scoreEls = [$('#score-p1'), $('#score-p2')];
const nameEls = [$('#name-p1'), $('#name-p2')];
const playerCards = [$('.player-red'), $('.player-blue')];

// ─── Scoring (Official 4-point cumulative Match) ───────────

function finishTooltip(type) {
  const f = FINISH_LABELS[type];
  const pts = FINISH_POINTS[type];
  return `${f.zh} ${f.en} — ${FINISH_DESCRIPTIONS[type]} (+${pts})`;
}

const FINISH_SHORT = {
  spin: '殘存',
  burst: '爆裂',
  over: '擊飛',
  extreme: '極致',
};

function syncFinishButtons() {
  $$('.btn-finish').forEach((btn) => {
    const type = btn.dataset.type;
    const f = FINISH_LABELS[type];
    if (!f) return;
    btn.title = finishTooltip(type);
    const nameEl = btn.querySelector('.finish-name');
    if (nameEl) nameEl.textContent = FINISH_SHORT[type] || f.zh;
    const ptsEl = btn.querySelector('strong');
    if (ptsEl) ptsEl.textContent = `+${FINISH_POINTS[type]}`;
  });
}

function finishLabel(type) {
  const f = FINISH_LABELS[type];
  return `${f.zh} ${f.en}`;
}

function updateScoreDisplay() {
  scoreEls.forEach((el, i) => {
    el.textContent = state.scores[i];
  });
  updateScoreTracks();
  $('#battle-num').textContent = state.currentBattle;
  const liveBattle = $('#live-replay-battle-num');
  if (liveBattle) liveBattle.textContent = state.currentBattle;
  if (typeof updateTournamentLiveScores === 'function') {
    updateTournamentLiveScores(state.scores, state.currentBattle);
  }
  pushArenaLiveState();
  if (typeof updateArgueReplayButton === 'function') updateArgueReplayButton();
}

let arenaLiveTimer = null;

function buildArenaLivePayload() {
  let matchLabel = null;
  if (typeof tournamentState !== 'undefined' && tournamentState.activeMatchId && typeof findMatch === 'function') {
    const match = findMatch(tournamentState.activeMatchId);
    if (match) matchLabel = match.label || null;
  }
  return {
    session: $('#session-select')?.value || 'junior',
    phase: $('#phase-select')?.value || 'prelim',
    p1Name: nameEls[0]?.value?.trim() || 'Blader 1',
    p2Name: nameEls[1]?.value?.trim() || 'Blader 2',
    scores: [...state.scores],
    battle: state.currentBattle,
    matchOver: state.matchOver,
    matchLabel,
    active: true,
    broadcastStatus: typeof arenaBroadcast !== 'undefined' ? arenaBroadcast.status : 'live',
    broadcastMessage: typeof arenaBroadcast !== 'undefined' ? arenaBroadcast.message : '',
    stationName: typeof getStationName === 'function' ? getStationName() : '台 1',
  };
}

function pushArenaLiveState() {
  if (isLaunchCritical()) return;
  clearTimeout(arenaLiveTimer);
  arenaLiveTimer = setTimeout(() => {
    if (isLaunchCritical()) return;
    fetch('/arena/live.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildArenaLivePayload()),
      cache: 'no-store',
    }).catch(() => {});
  }, 150);
}

function updateArenaSyncBanner() {
  const banner = $('#arena-sync-banner');
  if (!banner) return;

  const tEl = $('#tournament-sync-status');
  const cEl = $('#cloud-sync-status');
  const tStatus = tEl?.dataset.status || 'local';
  const cStatus = cEl?.hidden ? null : (cEl?.dataset.status || 'idle');
  const lock = typeof matchLockState !== 'undefined' ? matchLockState.remoteLock : null;
  const myId = typeof getOperatorId === 'function' ? getOperatorId() : null;

  const issues = [];
  let primaryIssue = '';
  if (tStatus === 'error' || tStatus === 'offline') {
    issues.push('賽程同步異常');
    primaryIssue = primaryIssue || 'tournament';
  }
  if (cStatus === 'error') {
    issues.push('雲端同步失敗');
    primaryIssue = primaryIssue || 'cloud';
  }
  if (lock?.matchId && lock.operatorId !== myId) {
    issues.push(`${lock.operatorLabel || '其他台'} 進行 ${lock.matchLabel || lock.matchId}`);
    primaryIssue = primaryIssue || 'lock';
  }
  let pendingReplays = 0;
  if (typeof replayState !== 'undefined') {
    pendingReplays = replayState.replays.filter((r) => r.videoId && r.cloudSynced === false).length;
    if (pendingReplays > 0) {
      issues.push(`回放待傳 ${pendingReplays}`);
      primaryIssue = primaryIssue || 'replay';
    }
  }

  if (!issues.length) {
    banner.hidden = true;
    banner.textContent = '';
    delete banner.dataset.primaryIssue;
    banner.title = '';
    return;
  }
  banner.hidden = false;
  banner.dataset.level = tStatus === 'offline' || cStatus === 'error' ? 'error' : 'warn';
  banner.dataset.primaryIssue = primaryIssue;
  banner.textContent = issues.join(' · ');
  banner.title = primaryIssue === 'replay'
    ? '點一下前往「戰鬥回放」並重試上傳'
    : primaryIssue === 'cloud'
      ? '點一下開啟開賽檢查'
      : '';
}

function initArenaSyncBanner() {
  $('#arena-sync-banner')?.addEventListener('click', () => {
    const issue = $('#arena-sync-banner')?.dataset.primaryIssue;
    if (issue === 'replay') {
      if (typeof switchAppView === 'function') switchAppView('replay');
      if (typeof retryPendingReplayUploads === 'function') {
        retryPendingReplayUploads().catch(console.error);
      }
      if (typeof showToast === 'function') showToast('已前往回放並重試上傳');
      return;
    }
    if (issue === 'cloud' || issue === 'tournament') {
      $('#event-checklist-modal').hidden = false;
      if (typeof runEventChecklist === 'function') runEventChecklist();
    }
  });
}

function renderScoreTrack(container, score) {
  if (!container) return;
  container.innerHTML = '';
  for (let p = 0; p < getMatchTarget(); p++) {
    const seg = document.createElement('span');
    seg.className = 'score-seg' + (p < score ? ' filled' : '');
    container.appendChild(seg);
  }
}

function updateScoreTracks() {
  for (let i = 0; i < 2; i++) {
    renderScoreTrack($(`#broadcast-rail-p${i + 1}`), state.scores[i]);
  }
}

function addLog(message, team = 'system', opts = {}) {
  const log = $('#battle-log');
  const li = document.createElement('li');
  li.className = team === 1 ? 'red' : team === 2 ? 'blue' : 'system';
  if (opts.type) li.classList.add(opts.type);
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  li.innerHTML = `<span class="log-time">${time}</span>${message}`;
  log.prepend(li);
  renderBattleLogStats();
  return li;
}

function escapeLogText(value) {
  if (typeof escapeHtml === 'function') return escapeHtml(value);
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function exportBattleLog() {
  const items = [...($('#battle-log')?.querySelectorAll('li') || [])].reverse();
  if (!items.length) {
    showToast('戰報為空');
    return;
  }
  const lines = items.map((li) => li.textContent?.trim()).filter(Boolean);
  const stats = { spin: 0, burst: 0, over: 0, extreme: 0 };
  lines.forEach((line) => {
    if (line.includes('殘存')) stats.spin += 1;
    if (line.includes('爆裂')) stats.burst += 1;
    if (line.includes('擊飛')) stats.over += 1;
    if (line.includes('極致')) stats.extreme += 1;
  });
  const header = `咩咩遊樂園 戰報\n${new Date().toLocaleString()}\n\n`;
  const summary = `統計 — 殘存:${stats.spin} 爆裂:${stats.burst} 擊飛:${stats.over} 極致:${stats.extreme}\n\n`;
  downloadBlob(
    `beyblade-log-${Date.now()}.txt`,
    new Blob([header + summary + lines.join('\n')], { type: 'text/plain;charset=utf-8' }),
  );
}

function renderBattleLogStats() {
  const el = $('#battle-log-stats');
  if (!el) return;
  const items = $('#battle-log')?.querySelectorAll('li') || [];
  const stats = { spin: 0, burst: 0, over: 0, extreme: 0 };
  items.forEach((li) => {
    const t = li.textContent || '';
    if (t.includes('殘存')) stats.spin += 1;
    if (t.includes('爆裂')) stats.burst += 1;
    if (t.includes('擊飛')) stats.over += 1;
    if (t.includes('極致')) stats.extreme += 1;
  });
  const total = stats.spin + stats.burst + stats.over + stats.extreme;
  el.textContent = total
    ? `共 ${total} 次得分 · 殘存 ${stats.spin} · 爆裂 ${stats.burst} · 擊飛 ${stats.over} · 極致 ${stats.extreme}`
    : '';
}

function showToast(text) {
  const toast = $('#finish-toast');
  $('#toast-text').textContent = text;
  toast.hidden = false;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => { toast.hidden = true; }, 400);
  }, 2500);
  renderBattleLogStats();
}

let finishAnnounceHideTimer = null;

function showFinishAnnounce(type, player, points, playerNameOverride) {
  const overlay = $('#finish-announce');
  if (!overlay) return;

  const f = FINISH_LABELS[type];
  if (!f) return;

  const name = playerNameOverride
    || nameEls[player - 1]?.value?.trim()
    || `Blader ${player}`;
  const enEl = overlay.querySelector('.finish-announce-en');
  const zhEl = overlay.querySelector('.finish-announce-zh');
  const ptsEl = overlay.querySelector('.finish-announce-points');
  const playerEl = overlay.querySelector('.finish-announce-player');

  if (enEl) enEl.textContent = f.en;
  if (zhEl) zhEl.textContent = f.zh;
  if (ptsEl) ptsEl.textContent = `+${points}`;
  if (playerEl) playerEl.textContent = name;

  overlay.className = `finish-announce finish-announce--${type} finish-announce--p${player}`;
  overlay.hidden = false;
  void overlay.offsetWidth;
  overlay.classList.add('show');

  if (finishAnnounceHideTimer) clearTimeout(finishAnnounceHideTimer);
  const announceMs = document.body.classList.contains('replay-theater-active') ? 1800 : 2400;
  finishAnnounceHideTimer = setTimeout(() => {
    overlay.classList.remove('show');
    finishAnnounceHideTimer = setTimeout(() => {
      overlay.hidden = true;
      finishAnnounceHideTimer = null;
    }, 400);
  }, announceMs);
}

function hideFinishAnnounce() {
  const overlay = $('#finish-announce');
  if (finishAnnounceHideTimer) {
    clearTimeout(finishAnnounceHideTimer);
    finishAnnounceHideTimer = null;
  }
  if (!overlay) return;
  overlay.classList.remove('show');
  overlay.hidden = true;
}

function adjustScore(player, delta) {
  if (state.matchOver || launchPlaying || scoringLocked) return;
  const idx = player - 1;
  const next = Math.max(0, Math.min(getMatchTarget(), state.scores[idx] + delta));
  if (next === state.scores[idx]) return;
  state.scores[idx] = next;
  updateScoreDisplay();
  addLog(`⚙ 手動調分 P${player} → ${state.scores[0]} : ${state.scores[1]}`, 'system');
  const target = getMatchTarget();
  if (state.scores[0] >= target || state.scores[1] >= target) {
    endMatch(state.scores[0] >= target ? 0 : 1);
  }
}

function setScoreDirect(player, value) {
  if (state.matchOver) return;
  const idx = player - 1;
  const v = Math.max(0, Math.min(getMatchTarget(), parseInt(value, 10) || 0));
  state.scores[idx] = v;
  updateScoreDisplay();
}

function awardFinish(player, type) {
  if (state.matchOver || launchPlaying || scoringLocked) return;

  const pts = FINISH_POINTS[type];
  const idx = player - 1;
  const name = nameEls[idx].value || `Blader ${player}`;
  const scoresBefore = [...state.scores];
  const matchOverBefore = state.matchOver;

  state.scores[idx] += pts;
  updateScoreDisplay();
  const inLive = document.body.classList.contains('launch-live');
  if (inLive) {
    const numEl = scoreEls[idx];
    numEl?.classList.add('score-pop-num');
    setTimeout(() => numEl?.classList.remove('score-pop-num'), 350);
    const rail = $(`#broadcast-rail-p${player}`);
    const filledSeg = rail?.querySelectorAll('.score-seg.filled');
    const lastFilled = filledSeg?.[filledSeg.length - 1];
    if (lastFilled) {
      lastFilled.classList.add('seg-pop');
      setTimeout(() => lastFilled.classList.remove('seg-pop'), 400);
    }
  } else {
    playerCards[idx].classList.add('score-pop');
    setTimeout(() => playerCards[idx].classList.remove('score-pop'), 350);
  }

  const label = finishLabel(type);
  const logEl = addLog(
    `第 ${state.currentBattle} 局 · <strong>${escapeLogText(name)}</strong> — ${label} <span class="log-points">+${pts}</span> · 比分 <span class="log-score">${state.scores[0]} : ${state.scores[1]}</span>`,
    player
  );
  state.finishHistory.push({ player, type, pts, scoresBefore, matchOverBefore, logEl });
  updateUndoButton();

  if (typeof onReplayFinish === 'function') {
    onReplayFinish(player, type, pts, state.scores);
  }
  showFinishAnnounce(type, player, pts);
  if (!state.matchOver && !isTouchDevice()) {
    setTimeout(() => showToast('按 Space 準備下一局'), 2600);
  }

  triggerFinishEffect(type, player);
  checkMatchEnd();
  const lastEntry = state.finishHistory[state.finishHistory.length - 1];
  if (lastEntry && state.matchOver) {
    lastEntry.endedMatch = true;
  }
  if (!state.matchOver) {
    state.readyForNextRound = true;
    updateNextRoundLaunchHint();
  }
  updateUndoButton();
}

function revertMatchEndingFinish(options = {}) {
  const { skipPin = false } = options;
  const matchId = state.victoryMatchId;
  const lastEntry = state.finishHistory[state.finishHistory.length - 1];

  if (!state.matchOver) return false;

  if (matchId && typeof adminRevertMatch === 'function') {
    const revertOpts = requirePin ? {} : { skipPin: true, silent: true };
    if (!adminRevertMatch(matchId, revertOpts)) return false;
  }

  if (lastEntry?.endedMatch) {
    state.finishHistory.pop();
    state.scores = [...lastEntry.scoresBefore];
    lastEntry.logEl?.remove();
    if (typeof onReplayUndoFinish === 'function') {
      onReplayUndoFinish(lastEntry.player, lastEntry.type, lastEntry.pts);
    }
    addLog(`↩ 已撤銷 ${finishLabel(lastEntry.type)}（P${lastEntry.player} −${lastEntry.pts}）`, 'system');
  } else {
    state.finishHistory = [];
  }

  state.matchOver = false;
  state.readyForNextRound = true;
  state.victoryMatchId = null;
  if (matchId && typeof tournamentState !== 'undefined') {
    tournamentState.activeMatchId = matchId;
    if (typeof persistSession === 'function') persistSession();
    if (typeof renderTournamentUI === 'function') renderTournamentUI();
  }
  $('#victory-overlay').hidden = true;
  updateScoreDisplay();
  updateUndoButton();
  showToast('已撤銷完場，可繼續計分');
  return true;
}

function undoLastFinish() {
  const last = state.finishHistory[state.finishHistory.length - 1];
  if (!last) {
    showToast('尚無可撤銷的得分');
    return;
  }

  if (last.endedMatch || state.matchOver) {
    revertMatchEndingFinish({ skipPin: true });
    return;
  }

  state.finishHistory.pop();
  state.scores = [...last.scoresBefore];
  state.readyForNextRound = false;
  updateScoreDisplay();
  last.logEl?.remove();
  updateUndoButton();

  if (typeof onReplayUndoFinish === 'function') {
    onReplayUndoFinish(last.player, last.type, last.pts);
  }

  addLog(`↩ 已撤銷 ${finishLabel(last.type)}（P${last.player} −${last.pts}）`, 'system');
  showToast('已撤銷上一個得分');
}

function updateUndoButton() {
  const btn = $('#btn-undo-finish');
  if (!btn) return;
  const last = state.finishHistory[state.finishHistory.length - 1];
  const canUndo = state.finishHistory.length > 0 && (!state.matchOver || last?.endedMatch);
  btn.disabled = !canUndo;
  btn.title = canUndo
    ? (last?.endedMatch ? '撤銷致勝得分（還原完場）' : '撤銷上一個得分')
    : (state.matchOver ? 'Match 已結束' : '尚無可撤銷的得分');
  btn.setAttribute('aria-disabled', btn.disabled ? 'true' : 'false');
}

function checkMatchEnd() {
  const p1 = state.scores[0];
  const p2 = state.scores[1];

  const target = getMatchTarget();
  if (p1 >= target || p2 >= target) {
    const winner = p1 >= target ? 0 : 1;
    endMatch(winner);
  }
}

function nextBattle() {
  if (state.matchOver) {
    state.scores = [0, 0];
    state.currentBattle = 1;
    state.matchOver = false;
    state.finishHistory = [];
    updateUndoButton();
    $('#victory-overlay').hidden = true;
    updateScoreDisplay();
    addLog('— 新 Match 開始（分數歸零）—');
    if (typeof onReplayNewMatch === 'function') onReplayNewMatch();
    if (typeof onReplayDiscard === 'function') onReplayDiscard();
    resetLaunchTimer();
    showToast('新 Match 開始');
    return;
  }

  if (typeof onReplayBattleEnd === 'function') {
    onReplayBattleEnd([...state.scores], state.currentBattle);
  }
  state.finishHistory = [];
  updateUndoButton();
  state.readyForNextRound = false;
  state.currentBattle++;
  updateScoreDisplay();
  addLog(`— 第 ${state.currentBattle} 局對戰開始（${state.scores[0]} : ${state.scores[1]}）—`);
  resetLaunchTimer(false);
  showToast(`第 ${state.currentBattle} 局`);
}

function endMatch(winnerIdx) {
  state.matchOver = true;
  state.readyForNextRound = false;
  state.victoryMatchId = (typeof tournamentState !== 'undefined' && tournamentState.activeMatchId)
    ? tournamentState.activeMatchId
    : null;
  const name = nameEls[winnerIdx].value || `Blader ${winnerIdx + 1}`;
  const score = state.scores[winnerIdx];
  const target = getMatchTarget();
  const detail = `率先取得 ${target} 分（${score} : ${state.scores[1 - winnerIdx]}）· 共 ${state.currentBattle} 局對戰`;

  $('#victory-name').textContent = name;
  $('#victory-detail').textContent = detail;
  const inTournament = typeof tournamentState !== 'undefined' && tournamentState.activeMatchId;
  const revertBtn = $('#btn-victory-revert');
  if (revertBtn) {
    revertBtn.hidden = !inTournament;
    if (inTournament) {
      revertBtn.classList.add('btn-victory-revert--prominent');
      revertBtn.textContent = '↩ 撤銷本場結果（按錯可還原）';
    }
  }
  if (!inTournament && typeof hideVictorySchedulePanel === 'function') {
    hideVictorySchedulePanel();
    $('#btn-dismiss-victory').textContent = '繼續';
  }
  $('#victory-overlay').hidden = false;

  const scoreLine = `<span class="log-score">${score} : ${state.scores[1 - winnerIdx]}</span>`;
  if (inTournament) {
    addLog(`Match 結束 · 比分 ${scoreLine} · ${state.currentBattle} 局`, winnerIdx + 1);
  } else {
    addLog(
      `🏆 本場 Match 勝者：<strong>${escapeLogText(name)}</strong> · ${scoreLine} · ${state.currentBattle} 局`,
      winnerIdx + 1,
      { type: 'log-result' }
    );
  }
  playVictoryEffect(winnerIdx + 1, true);
  spawnConfetti(120);
  if (typeof onTournamentMatchWin === 'function') {
    onTournamentMatchWin(winnerIdx + 1, {
      scores: [...state.scores],
      battles: state.currentBattle,
    });
  }
  if (typeof onReplayMatchEnd === 'function') {
    onReplayMatchEnd(winnerIdx, state.scores, state.currentBattle);
  }
}

function resetMatchScoresOnly(options = {}) {
  const { keepLaunch = false } = options;
  state.scores = [0, 0];
  state.currentBattle = 1;
  state.matchOver = false;
  state.readyForNextRound = false;
  state.finishHistory = [];
  state.victoryMatchId = null;
  updateUndoButton();
  updateScoreDisplay();
  $('#victory-overlay').hidden = true;
  resetLaunchTimer(!keepLaunch);
}

function loadMatchScores(scores, battles, matchOver) {
  state.scores = [...scores];
  state.currentBattle = battles || 1;
  state.matchOver = !!matchOver;
  state.finishHistory = [];
  updateUndoButton();
  updateScoreDisplay();
  $('#victory-overlay').hidden = true;
  resetLaunchTimer();
}

function resetMatch(silent) {
  if (!silent && (state.scores[0] || state.scores[1] || state.currentBattle > 1) && !confirm('重置整場 Match？累積分數將歸零。')) return;

  state.scores = [0, 0];
  state.currentBattle = 1;
  state.matchOver = false;
  state.readyForNextRound = false;
  state.finishHistory = [];
  updateUndoButton();
  updateScoreDisplay();
  $('#victory-overlay').hidden = true;
  if (!silent) {
    $('#battle-log').innerHTML = '';
    addLog('新 Match 開始 — 官方 4 分累積制');
  }
  if (typeof onReplayNewMatch === 'function') onReplayNewMatch();
  if (typeof onReplayDiscard === 'function') onReplayDiscard();
  resetLaunchTimer();
}

// ─── Launch countdown ──────────────────────────────────────

let launchTimers = [];
let launchPlaying = false;

const goShootAudio = $('#go-shoot-audio');
// Timings from 321goshoot.m4a (~7.38s, silence-detected)
const GO_SHOOT_SYNC = [
  { at: 0.34, label: 'Three' },
  { at: 1.42, label: 'Two' },
  { at: 2.32, label: 'One' },
  { at: 4.0, label: 'Go Shoot!', fx: true },
];
const GO_SHOOT_DURATION = 7.384;
const LAUNCH_ZOOM_MS = 200;
const PARTICLE_CAP = 160;
const COMPETITION_MODE_KEY = 'bex-competition-mode';
const LOW_FX_MODE_KEY = 'bex-low-fx-mode';
const REPLAY_BITRATE_KEY = 'bex-replay-bitrate';
let launchRaf = null;
let launchStep = -1;
let goShootFxFired = false;
let cameraLaunchActive = false;
let launchEnteredFullscreen = false;

let launchFullscreenActive = false;
let launchStandbyActive = false;
let scoringLocked = false;

const FULLSCREEN_LOCK_KEY = 'bex-fullscreen-lock';
let arenaFullscreenLocked = sessionStorage.getItem(FULLSCREEN_LOCK_KEY) === '1';
let arenaFullscreenExitAllowed = false;

function setArenaFullscreenLocked(locked) {
  arenaFullscreenLocked = locked;
  if (locked) sessionStorage.setItem(FULLSCREEN_LOCK_KEY, '1');
  else sessionStorage.removeItem(FULLSCREEN_LOCK_KEY);
  const btn = $('#btn-fullscreen');
  if (btn) {
    btn.classList.toggle('fullscreen-locked', locked && !!document.fullscreenElement);
    btn.title = locked
      ? '全螢幕已鎖定（再按 ⛶ 退出）'
      : '全螢幕';
  }
}

function isArenaFullscreenLocked() {
  return arenaFullscreenLocked;
}

function updateFullscreenButtonState() {
  const btn = $('#btn-fullscreen');
  if (!btn) return;
  const inFs = !!document.fullscreenElement;
  btn.classList.toggle('fullscreen-locked', arenaFullscreenLocked && inFs);
  btn.title = arenaFullscreenLocked && inFs
    ? '全螢幕已鎖定（再按 ⛶ 退出）'
    : '全螢幕';
}

async function toggleArenaFullscreen() {
  if (!document.fullscreenElement) {
    setArenaFullscreenLocked(true);
    try {
      await document.documentElement.requestFullscreen();
      launchFullscreenActive = true;
      launchEnteredFullscreen = true;
    } catch (_) { /* user gesture / browser policy */ }
    updateFullscreenButtonState();
    return;
  }

  setArenaFullscreenLocked(false);
  arenaFullscreenExitAllowed = true;
  launchFullscreenActive = false;
  launchEnteredFullscreen = false;
  try {
    await document.exitFullscreen();
  } catch (_) { /* ignore */ }
  updateFullscreenButtonState();
}

function isCompetitionMode() {
  return sessionStorage.getItem(COMPETITION_MODE_KEY) !== '0';
}

function setCompetitionMode(on) {
  sessionStorage.setItem(COMPETITION_MODE_KEY, on ? '1' : '0');
  const toggle = $('#competition-mode-toggle');
  if (toggle) toggle.checked = on;
}

function isLowFxMode() {
  return sessionStorage.getItem(LOW_FX_MODE_KEY) === '1';
}

function setLowFxMode(on) {
  sessionStorage.setItem(LOW_FX_MODE_KEY, on ? '1' : '0');
  const toggle = $('#low-fx-mode-toggle');
  if (toggle) toggle.checked = on;
  if (on && animFrame) {
    cancelAnimationFrame(animFrame);
    animFrame = null;
    particles = [];
    if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

function getReplayBitrate() {
  const v = parseInt(localStorage.getItem(REPLAY_BITRATE_KEY), 10);
  if (Number.isFinite(v) && v >= 800000 && v <= 6000000) return v;
  return 2500000;
}

function setReplayBitrate(bps) {
  localStorage.setItem(REPLAY_BITRATE_KEY, String(Math.max(800000, Math.min(6000000, bps))));
}

function isLaunchCritical() {
  return launchPlaying
    || launchStandbyActive
    || document.body.classList.contains('launch-countdown');
}

function setScoringLocked(locked) {
  scoringLocked = locked;
  document.body.classList.toggle('scoring-locked', locked);
  $$('.btn-finish, .btn-score-adj').forEach((el) => {
    el.disabled = locked || state.matchOver;
  });
  const nextBtn = $('#btn-next-battle');
  if (nextBtn) nextBtn.disabled = locked || state.matchOver;
}

async function warmCompetitionAssets() {
  if (audioCtx?.state === 'suspended') {
    try { await audioCtx.resume(); } catch (_) { /* ignore */ }
  }
  if (!goShootAudio) return false;
  const ready = await ensureGoShootAudioReady();
  if (!ready || goShootAudio.readyState < 2) return false;
  try {
    const volume = goShootAudio.volume;
    goShootAudio.volume = 0;
    goShootAudio.currentTime = 0;
    const p = goShootAudio.play();
    if (p) await p;
    goShootAudio.pause();
    goShootAudio.currentTime = 0;
    goShootAudio.volume = volume;
    return true;
  } catch (_) {
    return goShootAudio.readyState >= 2;
  }
}

async function enterCameraZoomMode() {
  if (!state.cameraStream && $('#cam-source').value === 'local') {
    try {
      await startLocalCamera();
    } catch (_) { /* continue with placeholder */ }
  }

  if (!cameraLaunchActive) {
    cameraLaunchActive = true;
    document.body.classList.add('launch-active');
    showExitLaunchButton();
    await enterBrowserFullscreen();
    if (LAUNCH_ZOOM_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, LAUNCH_ZOOM_MS));
    }
  } else {
    launchFullscreenActive = !!document.fullscreenElement;
    if (!document.fullscreenElement) {
      await enterBrowserFullscreen();
    }
  }
}

function showLaunchStandbyHint() {
  const overlayText = $('#launch-camera-text');
  const hint = $('.launch-camera-hint');
  const startBtn = $('#btn-start-countdown');
  const touch = isTouchDevice();

  if (overlayText) {
    overlayText.className = 'launch-camera-text launch-standby-text show';
    overlayText.textContent = 'Ready';
    overlayText.setAttribute('data-text', 'Ready');
  }
  if (hint) {
    hint.textContent = touch
      ? '點下方「開始倒數」或點擊畫面 · Esc 返回賽程'
      : '按 Space 或點「開始倒數」· Esc 返回賽程';
  }
  if (startBtn) {
    startBtn.hidden = false;
    startBtn.textContent = touch ? '開始倒數' : '開始倒數 (Space)';
  }

  const timerEl = $('#launch-timer');
  if (timerEl) {
    timerEl.hidden = true;
    timerEl.textContent = 'Ready';
    timerEl.classList.remove('counting', 'go-shoot');
  }
}

function hideLaunchStandbyHint() {
  const startBtn = $('#btn-start-countdown');
  if (startBtn) startBtn.hidden = true;
}

async function enterCameraStandbyMode() {
  if (state.matchOver || launchPlaying) return;

  document.body.classList.remove('launch-countdown');
  document.body.classList.add('launch-live');
  await enterCameraZoomMode();

  launchStandbyActive = true;
  document.body.classList.add('launch-standby');
  setScoringLocked(true);
  showLiveReplayButton();

  const overlay = $('#launch-camera-overlay');
  overlay.hidden = false;
  overlay.setAttribute('aria-hidden', 'false');
  showLaunchStandbyHint();

  const badge = $('#rec-badge');
  if (badge) badge.setAttribute('data-hint', isTouchDevice() ? '點下方開始' : 'Space 開始倒數');
  const relaunch = $('#btn-relaunch');
  if (relaunch) relaunch.hidden = true;

  warmCompetitionAssets().catch(() => {});
}

async function runLaunchCountdownSequence() {
  const el = $('#launch-timer');
  const btn = $('#btn-launch');
  const relaunchBtn = $('#btn-relaunch');
  if (launchPlaying || launchTimers.length || launchRaf) return;

  hideLaunchStandbyHint();
  btn.disabled = true;
  if (relaunchBtn) relaunchBtn.disabled = true;
  el.classList.add('counting');
  el.classList.remove('go-shoot');
  el.textContent = '…';

  const overlay = $('#launch-camera-overlay');
  overlay.hidden = false;
  overlay.setAttribute('aria-hidden', 'false');
  clearLaunchOverlayText();
  document.body.classList.add('launch-countdown', 'launch-live');
  document.body.classList.remove('launch-standby');
  setScoringLocked(true);
  showLiveReplayButton();

  if ($('#voice-countdown').checked && goShootAudio) {
    startLaunchCountdownAudio();
  } else {
    await startLaunchCountdownFallback();
  }
}

async function startLaunchCountdownFromStandby() {
  if (!launchStandbyActive || state.matchOver) return;
  if (launchPlaying || launchTimers.length || launchRaf) return;
  launchStandbyActive = false;
  await runLaunchCountdownSequence();
}

function handleLaunchStandbyStart() {
  startLaunchCountdownFromStandby();
}

function updateNextRoundLaunchHint() {
  const badge = $('#rec-badge');
  const relaunch = $('#btn-relaunch');
  if (!state.readyForNextRound || state.matchOver || launchPlaying) {
    return;
  }
  const inLive = document.body.classList.contains('launch-live')
    || document.body.classList.contains('launch-active');
  if (!inLive) return;

  if (badge) {
    badge.setAttribute(
      'data-hint',
      isTouchDevice() ? '點「倒數」下一局' : 'Space 下一局倒數'
    );
  }
  if (relaunch) {
    relaunch.hidden = false;
    relaunch.disabled = false;
  }
}

async function prepareNextRound() {
  if (typeof onReplayBattleEnd === 'function') {
    onReplayBattleEnd([...state.scores], state.currentBattle);
  }
  state.currentBattle++;
  updateScoreDisplay();
  addLog(`— 第 ${state.currentBattle} 局對戰準備（${state.scores[0]} : ${state.scores[1]}）—`);
}

async function startQuickNextRoundCountdown() {
  if (state.matchOver || launchPlaying || launchTimers.length || launchRaf) return;
  if (!state.readyForNextRound && !document.body.classList.contains('launch-live')) return;

  state.readyForNextRound = false;
  launchStandbyActive = false;
  document.body.classList.remove('launch-standby');
  hideLaunchStandbyHint();

  await prepareNextRound();

  if (!cameraLaunchActive) {
    if (typeof switchAppView === 'function') switchAppView('camera');
    await enterCameraZoomMode();
  }

  await runLaunchCountdownSequence();
}

async function lockArenaEscapeKey() {
  try {
    if (navigator.keyboard?.lock && document.fullscreenElement) {
      await navigator.keyboard.lock(['Escape']);
    }
  } catch (_) { /* unsupported or denied */ }
}

function unlockArenaEscapeKey() {
  try {
    navigator.keyboard?.unlock?.();
  } catch (_) { /* ignore */ }
}

async function enterBrowserFullscreen() {
  setArenaFullscreenLocked(true);
  if (document.fullscreenElement) {
    launchEnteredFullscreen = true;
    launchFullscreenActive = true;
    await lockArenaEscapeKey();
    updateFullscreenButtonState();
    return;
  }
  try {
    await document.documentElement.requestFullscreen();
    launchEnteredFullscreen = true;
    launchFullscreenActive = true;
    await lockArenaEscapeKey();
  } catch (_) { /* user gesture / browser policy */ }
  updateFullscreenButtonState();
}

function exitBrowserFullscreen(force = false) {
  if (!force && isArenaFullscreenLocked()) return;
  launchFullscreenActive = false;
  launchEnteredFullscreen = false;
  unlockArenaEscapeKey();
  if (document.fullscreenElement) {
    arenaFullscreenExitAllowed = true;
    document.exitFullscreen().catch(() => {});
  }
  if (force) {
    setArenaFullscreenLocked(false);
  }
  updateFullscreenButtonState();
}

function showExitLaunchButton() {
  const btn = $('#btn-exit-launch');
  if (btn) btn.hidden = false;
}

function hideExitLaunchButton() {
  const btn = $('#btn-exit-launch');
  if (btn) btn.hidden = true;
}

function showLiveReplayButton() {
  const replay = $('#btn-live-replay');
  if (replay) replay.hidden = false;
  if (typeof updateArgueReplayButton === 'function') updateArgueReplayButton();
}

function hideLiveReplayButton() {
  const replay = $('#btn-live-replay');
  if (replay) replay.hidden = true;
}

function isTouchDevice() {
  return window.matchMedia('(hover: none)').matches || 'ontouchstart' in window;
}

function enterCameraLaunchMode() {
  return enterCameraZoomMode().then(() => runLaunchCountdownSequence());
}

let launchOverlayHideTimer = null;
let goShootTextHideTimer = null;

const GO_SHOOT_TEXT_VISIBLE_MS = 780;
const GO_SHOOT_TEXT_BURST_MS = 420;

let burstRingTimers = [];
let impactBurstTimer = null;

function resetBurstRings() {
  burstRingTimers.forEach(clearTimeout);
  burstRingTimers = [];
  ['#burst-ring', '#burst-ring-2', '#launch-burst-ring', '#launch-burst-ring-2'].forEach((sel) => {
    const ring = $(sel);
    if (!ring) return;
    ring.classList.remove('animate');
    ring.style.removeProperty('width');
    ring.style.removeProperty('height');
    ring.style.removeProperty('opacity');
    ring.style.removeProperty('border-color');
    ring.style.removeProperty('color');
  });
}

function resetLaunchOverlayFx() {
  if (impactBurstTimer) {
    clearTimeout(impactBurstTimer);
    impactBurstTimer = null;
  }
  const impactBurst = $('.launch-impact-burst');
  if (impactBurst) impactBurst.className = 'launch-impact-burst';
  const flash = $('#flash-overlay');
  if (flash) {
    flash.className = '';
    flash.classList.remove('active');
    flash.style.removeProperty('--flash-opacity');
  }
  document.body.classList.remove('go-shoot-moment', 'anime-impact-frame', 'shake', 'shake-heavy', 'shake-go-shoot');
  const vp = $('#camera-viewport');
  if (vp) vp.classList.remove('shake', 'shake-heavy', 'shake-go-shoot');
}

function resetLaunchFx() {
  resetBurstRings();
  resetLaunchOverlayFx();
}

function hideLaunchOverlay() {
  if (launchOverlayHideTimer) {
    clearTimeout(launchOverlayHideTimer);
    launchOverlayHideTimer = null;
  }
  const overlay = $('#launch-camera-overlay');
  overlay.hidden = true;
  overlay.setAttribute('aria-hidden', 'true');
  clearLaunchOverlayText();
}

function exitCameraLaunchMode(options = {}) {
  const opts = typeof options === 'number' ? { overlayDelay: options } : (options || {});
  const { overlayDelay = 0, keepFullscreen = false, targetView = null } = opts;

  if (!cameraLaunchActive && !document.body.classList.contains('launch-active')) return;

  cameraLaunchActive = false;
  launchStandbyActive = false;
  document.body.classList.remove('launch-active', 'launch-countdown', 'launch-live', 'launch-standby');

  if (keepFullscreen || isArenaFullscreenLocked()) {
    launchFullscreenActive = !!document.fullscreenElement;
  } else {
    exitBrowserFullscreen(true);
  }

  hideExitLaunchButton();
  hideLiveReplayButton();
  resetLaunchFx();
  if (launchOverlayHideTimer) {
    clearTimeout(launchOverlayHideTimer);
    launchOverlayHideTimer = null;
  }
  if (overlayDelay > 0) {
    launchOverlayHideTimer = setTimeout(hideLaunchOverlay, overlayDelay);
  } else {
    hideLaunchOverlay();
  }
  const badge = $('#rec-badge');
  if (badge) badge.removeAttribute('data-hint');
  const relaunch = $('#btn-relaunch');
  if (relaunch) relaunch.hidden = true;
  if (targetView) showAppView(targetView);
}

async function exitLaunchToTournament() {
  const inLaunch = cameraLaunchActive || document.body.classList.contains('launch-active');
  if (inLaunch) {
    stopLaunchPlayback();
    exitCameraLaunchMode({ keepFullscreen: true });
  }
  showAppView('tournament');
  if (!document.fullscreenElement) {
    try {
      await enterBrowserFullscreen();
    } catch (_) { /* browser policy */ }
  }
}

function stopLaunchPlayback() {
  launchStandbyActive = false;
  setScoringLocked(false);
  if (launchPlaying || launchTimers.length || launchRaf) {
    launchTimers.forEach(clearTimeout);
    launchTimers = [];
    if (launchRaf) cancelAnimationFrame(launchRaf);
    launchRaf = null;
    launchPlaying = false;
    if (goShootAudio) {
      goShootAudio.pause();
      goShootAudio.currentTime = 0;
      goShootAudio.onended = null;
    }
  }
  const el = $('#launch-timer');
  el.hidden = true;
  el.textContent = 'Ready';
  el.classList.remove('counting', 'go-shoot');
  $('#btn-launch').disabled = false;
  updateRelaunchButton();
}

function clearLaunchOverlayText() {
  if (goShootTextHideTimer) {
    clearTimeout(goShootTextHideTimer);
    goShootTextHideTimer = null;
  }
  const overlayText = $('#launch-camera-text');
  if (!overlayText) return;
  overlayText.textContent = '';
  overlayText.removeAttribute('data-text');
  overlayText.className = 'launch-camera-text';
}

function triggerGoShootTextBurst() {
  flashScreen('go-shoot-flash', 120, 0.85);
  burstRing('#ffd60a');
  burstRing('#ff2d55', 50, 2);
  spawnParticles(scaledFxCount(32), '#ff2d55', 'burst');
  spawnParticles(scaledFxCount(20), '#ffd60a', 'extreme');
  spawnStreakBurst(scaledFxCount(14), '#ffffff');

  const impactBurst = $('.launch-impact-burst');
  if (impactBurst) {
    impactBurst.className = 'launch-impact-burst show step-3';
    if (impactBurstTimer) clearTimeout(impactBurstTimer);
    impactBurstTimer = setTimeout(() => {
      impactBurst.className = 'launch-impact-burst';
      impactBurstTimer = null;
    }, 560);
  }
}

function scheduleGoShootTextHide() {
  if (goShootTextHideTimer) clearTimeout(goShootTextHideTimer);
  goShootTextHideTimer = setTimeout(() => {
    const overlayText = $('#launch-camera-text');
    if (overlayText && overlayText.textContent) {
      overlayText.classList.remove('show');
      overlayText.classList.add('burst-out');
      triggerGoShootTextBurst();
      setTimeout(clearLaunchOverlayText, GO_SHOOT_TEXT_BURST_MS);
    }
    goShootTextHideTimer = null;
  }, GO_SHOOT_TEXT_VISIBLE_MS);
}

function triggerAnimeImpact(stepIndex) {
  const overlay = $('#launch-camera-overlay');
  const impactBurst = $('.launch-impact-burst');

  if (overlay) {
    overlay.classList.remove('anime-hit');
    void overlay.offsetWidth;
    overlay.classList.add('anime-hit');
  }

  if (impactBurst) {
    impactBurst.className = `launch-impact-burst show step-${stepIndex}`;
    if (impactBurstTimer) clearTimeout(impactBurstTimer);
    impactBurstTimer = setTimeout(() => {
      impactBurst.className = 'launch-impact-burst';
      impactBurstTimer = null;
    }, 560);
  }

  document.body.classList.remove('anime-impact-frame');
  void document.body.offsetWidth;
  document.body.classList.add('anime-impact-frame');
  setTimeout(() => document.body.classList.remove('anime-impact-frame'), stepIndex >= 2 ? 140 : 100);
}

function getLaunchFxScale() {
  if (isLowFxMode()) return 0;
  let scale = 1;
  if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) scale *= 0.55;
  else if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) scale *= 0.72;
  if (isCompetitionMode() && isLaunchCritical()) scale *= 0.82;
  return scale;
}

function scaledFxCount(base) {
  return Math.max(8, Math.round(base * getLaunchFxScale()));
}

function showLaunchOverlayText(label, stepIndex) {
  const overlayText = $('#launch-camera-text');
  const timerEl = $('#launch-timer');
  if (!overlayText) return;

  overlayText.className = 'launch-camera-text';
  overlayText.classList.add(`step-${stepIndex}`);
  if (label === 'Go Shoot!') overlayText.classList.add('go-shoot');
  overlayText.textContent = label;
  overlayText.setAttribute('data-text', label);

  requestAnimationFrame(() => {
    void overlayText.offsetWidth;
    overlayText.classList.add('show');
  });

  if (label === 'Go Shoot!') {
    scheduleGoShootTextHide();
  }

  if (timerEl) {
    timerEl.textContent = label;
    timerEl.classList.toggle('go-shoot', label === 'Go Shoot!');
  }

  requestAnimationFrame(() => triggerCountdownStepEffect(label, stepIndex));
}

function triggerCountdownStepEffect(label, stepIndex) {
  const colors = ['#00d4ff', '#ffd60a', '#ff2d55'];
  const color = colors[stepIndex];

  if (label === 'Go Shoot!') {
    triggerGoShootMoment();
    return;
  }

  triggerAnimeImpact(stepIndex);
  pulseCamera();

  if (stepIndex === 0) {
    flashScreen('anime-impact', 90, 0.75);
    flashScreen('blue-flash', 80, 0.5);
    shakeScreen('light', 300);
    burstRing(color);
    spawnParticles(scaledFxCount(28), color, 'burst');
    spawnStreakBurst(scaledFxCount(12), color);
  } else if (stepIndex === 1) {
    flashScreen('anime-impact', 100, 0.85);
    flashScreen('gold-flash', 90, 0.6);
    shakeScreen('light', 380);
    burstRing(color);
    burstRing('#ffffff', 70, 2);
    spawnParticles(scaledFxCount(40), color, 'burst');
    spawnStreakBurst(scaledFxCount(16), color);
  } else {
    flashScreen('anime-impact', 130, 1);
    flashScreen('burst-flash', 150, 0.9);
    setTimeout(() => flashScreen('extreme-flash', 90, 0.45), 70);
    shakeScreen('heavy', 580);
    burstRing(color);
    burstRing('#ffffff', 60, 2);
    spawnParticles(scaledFxCount(52), color, 'burst');
    spawnParticles(scaledFxCount(18), '#ffffff', 'extreme');
    spawnStreakBurst(scaledFxCount(20), color);
  }
  playBeep(440 + stepIndex * 110, 0.1 + stepIndex * 0.05);
}

function stopGoShootAudio() {
  resetLaunchTimer();
}

function getScaledSync() {
  const duration = goShootAudio.duration;
  if (!duration || Number.isNaN(duration)) {
    return GO_SHOOT_SYNC.map((s) => ({ ...s, at: s.at }));
  }
  const scale = duration / GO_SHOOT_DURATION;
  return GO_SHOOT_SYNC.map((s) => ({ ...s, at: s.at * scale }));
}

function syncLaunchVisuals() {
  if (!launchPlaying || !goShootAudio) return;

  const t = goShootAudio.currentTime;
  const steps = getScaledSync();

  for (let i = launchStep + 1; i < steps.length; i++) {
    if (t < steps[i].at - 0.008) break;
    launchStep = i;
    showLaunchOverlayText(steps[i].label, i);
    if (steps[i].fx) goShootFxFired = true;
  }

  if (launchPlaying && launchStep < steps.length - 1) {
    launchRaf = requestAnimationFrame(syncLaunchVisuals);
  } else {
    launchRaf = null;
  }
}

function updateRelaunchButton() {
  const btn = $('#btn-relaunch');
  if (!btn) return;
  const show = document.body.classList.contains('launch-live')
    && !launchPlaying
    && !state.matchOver;
  btn.hidden = !show;
  btn.disabled = launchPlaying;
}

function finishLaunchCountdown() {
  launchTimers.forEach((id) => {
    clearTimeout(id);
    clearInterval(id);
  });
  launchTimers = [];
  if (launchRaf) cancelAnimationFrame(launchRaf);
  launchRaf = null;
  launchStep = -1;
  goShootFxFired = false;
  const el = $('#launch-timer');
  const btn = $('#btn-launch');
  el.textContent = '⚔';
  el.classList.remove('counting', 'go-shoot');
  btn.disabled = false;
  launchPlaying = false;
  state.readyForNextRound = false;
  setScoringLocked(false);
  if (goShootAudio) goShootAudio.onended = null;
  addLog('Three, Two, One, Go Shoot!');
  if (typeof onReplayBattleStart === 'function') onReplayBattleStart();
  document.body.classList.remove('launch-countdown');
  document.body.classList.add('launch-live');
  showLiveReplayButton();
  if (launchOverlayHideTimer) {
    clearTimeout(launchOverlayHideTimer);
    launchOverlayHideTimer = null;
  }
  launchOverlayHideTimer = setTimeout(hideLaunchOverlay, 200);
  const badge = $('#rec-badge');
  if (badge) badge.setAttribute('data-hint', isTouchDevice() ? '點右上角返回賽程' : 'Esc 返回賽程');
  showExitLaunchButton();
  updateRelaunchButton();
}

function triggerGoShootMoment() {
  document.body.classList.add('go-shoot-moment');
  triggerAnimeImpact(3);

  shakeScreen('go-shoot', 1000);

  flashScreen('anime-impact', 180, 1);
  flashScreen('go-shoot-flash', 320, 0.95);
  setTimeout(() => flashScreen('burst-flash', 150, 0.65), 90);
  setTimeout(() => flashScreen('lens-flare', 500, 0.45), 160);

  burstRing('#ffd60a');
  burstRing('#ff2d55', 70, 2);
  burstRing('#00d4ff', 130);
  burstRing('#ffffff', 200, 2);

  spawnParticles(scaledFxCount(72), '#ff2d55', 'burst');
  spawnParticles(scaledFxCount(48), '#ffd60a', 'extreme');
  spawnParticles(scaledFxCount(36), '#00d4ff', 'burst');
  spawnParticles(scaledFxCount(24), '#ffffff', 'extreme');
  spawnStreakBurst(scaledFxCount(32), '#ffffff');
  spawnConfetti(scaledFxCount(28));

  const overlay = $('#launch-camera-overlay');
  if (overlay) {
    overlay.classList.add('shockwave');
    setTimeout(() => overlay.classList.remove('shockwave'), 950);
  }

  pulseCamera();
  playBeep(880, 0.35);
  setTimeout(() => playBeep(1100, 0.25), 80);
  setTimeout(() => playBeep(660, 0.2), 200);

  setTimeout(() => document.body.classList.remove('go-shoot-moment'), 1100);
}

function resetLaunchTimer(exitFullscreen = true) {
  if (!exitFullscreen) state.readyForNextRound = false;
  stopLaunchPlayback();
  if (exitFullscreen) {
    exitCameraLaunchMode({ keepFullscreen: isArenaFullscreenLocked() });
  } else {
    document.body.classList.remove('launch-countdown');
    hideLaunchOverlay();
  }
}

async function startLaunchCountdownFallback() {
  const el = $('#launch-timer');
  let step = 0;

  function showStep() {
    const label = LAUNCH_SEQUENCE[step];
    showLaunchOverlayText(label, step);

    step++;
    if (step >= LAUNCH_SEQUENCE.length) {
      clearInterval(fallbackInterval);
      setTimeout(finishLaunchCountdown, 900);
    }
  }

  let fallbackInterval;
  showStep();
  fallbackInterval = setInterval(showStep, 900);
  launchTimers = [fallbackInterval];
}

async function ensureGoShootAudioReady() {
  if (!goShootAudio) return false;
  if (goShootAudio.readyState >= 3) return true;
  try {
    goShootAudio.load();
    await new Promise((resolve, reject) => {
      const finish = (ok) => {
        goShootAudio.removeEventListener('canplaythrough', onReady);
        goShootAudio.removeEventListener('error', onError);
        ok ? resolve() : reject();
      };
      const onReady = () => finish(true);
      const onError = () => finish(false);
      goShootAudio.addEventListener('canplaythrough', onReady, { once: true });
      goShootAudio.addEventListener('error', onError, { once: true });
    });
    return true;
  } catch (_) {
    return goShootAudio.readyState >= 2;
  }
}

async function startLaunchCountdownAudio() {
  goShootAudio.currentTime = 0;
  launchPlaying = true;
  launchStep = -1;
  goShootFxFired = false;

  goShootAudio.onended = () => {
    if (launchPlaying) finishLaunchCountdown();
  };

  if (goShootAudio.readyState < 2) {
    await ensureGoShootAudioReady();
  }

  const playPromise = goShootAudio.play();
  if (playPromise) {
    playPromise.then(() => {
      syncLaunchVisuals();
    }).catch(() => {
      if (goShootAudio) {
        goShootAudio.pause();
        goShootAudio.currentTime = 0;
      }
      launchPlaying = false;
      $('#launch-timer').classList.add('counting');
      startLaunchCountdownFallback();
    });
  } else {
    syncLaunchVisuals();
  }
}

async function startLaunchCountdown() {
  if (state.matchOver) return;
  if (launchPlaying || launchTimers.length || launchRaf) return;

  if (launchStandbyActive) {
    await startLaunchCountdownFromStandby();
    return;
  }

  if (state.readyForNextRound || document.body.classList.contains('launch-live')) {
    await startQuickNextRoundCountdown();
    return;
  }

  if (typeof switchAppView === 'function') switchAppView('camera');
  await enterCameraStandbyMode();
}

function getPhaseLabel() {
  return PHASE_LABELS[$('#phase-select').value] || '';
}

function getSessionLabel() {
  return SESSION_LABELS[$('#session-select').value] || '';
}

// ─── Visual & audio effects ────────────────────────────────

const audioCtx = typeof AudioContext !== 'undefined' ? new (window.AudioContext || window.webkitAudioContext)() : null;

function playBeep(freq, duration) {
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.frequency.value = freq;
  osc.type = 'square';
  gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
  osc.start(audioCtx.currentTime);
  osc.stop(audioCtx.currentTime + duration);
}

function playFinishImpact(type) {
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();

  const now = audioCtx.currentTime;
  const gain = audioCtx.createGain();
  const osc = audioCtx.createOscillator();
  const punchFreq = {
    spin: 520,
    burst: 95,
    over: 220,
    extreme: 70,
  }[type] || 180;

  osc.type = type === 'spin' ? 'sawtooth' : 'square';
  osc.frequency.setValueAtTime(punchFreq * 1.8, now);
  osc.frequency.exponentialRampToValueAtTime(punchFreq, now + 0.16);
  gain.gain.setValueAtTime(type === 'extreme' ? 0.18 : 0.14, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.45);

  const noiseBuffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.18, audioCtx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }
  const noise = audioCtx.createBufferSource();
  const noiseGain = audioCtx.createGain();
  noise.buffer = noiseBuffer;
  noiseGain.gain.setValueAtTime(type === 'spin' ? 0.04 : 0.1, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
  noise.connect(noiseGain);
  noiseGain.connect(audioCtx.destination);
  noise.start(now);
}

function speakFinishTerm(type) {
  const f = FINISH_LABELS[type];
  if (!f || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(f.en);
  utterance.lang = 'en-US';
  utterance.rate = 0.88;
  utterance.pitch = type === 'extreme' ? 0.72 : 0.82;
  utterance.volume = 1;
  setTimeout(() => window.speechSynthesis.speak(utterance), 120);
}

function flashScreen(className = '', duration = 80, peakOpacity = 0.85) {
  const flash = $('#flash-overlay');
  flash.className = className;
  flash.style.setProperty('--flash-opacity', peakOpacity);
  flash.classList.add('active');
  setTimeout(() => {
    flash.classList.remove('active');
    flash.style.removeProperty('--flash-opacity');
  }, duration);
}

function getShakeTarget() {
  if (document.body.classList.contains('replay-theater-active')) {
    return $('#replay-theater');
  }
  return document.body.classList.contains('launch-active')
    ? $('#camera-viewport')
    : document.body;
}

function shakeScreen(intensity = 'light', duration = 400) {
  const target = getShakeTarget();
  if (!target) return;
  const cls = intensity === 'go-shoot' ? 'shake-go-shoot'
    : intensity === 'heavy' ? 'shake-heavy' : 'shake';
  target.classList.remove('shake', 'shake-heavy', 'shake-go-shoot');
  void target.offsetWidth;
  target.classList.add(cls);
  setTimeout(() => target.classList.remove(cls), duration);
}

function pulseCamera() {
  const vp = $('#camera-viewport');
  if (!vp) return;
  vp.classList.remove('cam-punch');
  void vp.offsetWidth;
  vp.classList.add('cam-punch');
}

function triggerFinishEffect(type, player) {
  const inReplay = document.body.classList.contains('replay-theater-active');
  const inLive = document.body.classList.contains('launch-live');
  const inLaunch = document.body.classList.contains('launch-active');

  const color = player === 1 ? '#ff2d55' : '#00d4ff';
  const liteFx = inReplay || inLive || inLaunch;

  if (type === 'burst') {
    shakeScreen('heavy', liteFx ? 420 : 600);
    flashScreen('burst-flash');
    burstRing(color);
    spawnParticles(scaledFxCount(liteFx ? 18 : 40), color, 'burst');
    playBeep(120, 0.15);
  } else if (type === 'extreme') {
    shakeScreen('heavy', liteFx ? 520 : 600);
    flashScreen('extreme-flash');
    spawnParticles(scaledFxCount(liteFx ? 28 : 80), '#bf5af2', 'extreme');
    spawnParticles(scaledFxCount(liteFx ? 14 : 40), '#ffd60a', 'extreme');
    playBeep(80, 0.25);
  } else if (type === 'over') {
    shakeScreen('light', liteFx ? 340 : 400);
    flashScreen();
    spawnParticles(scaledFxCount(liteFx ? 10 : 25), '#ffd60a', 'over');
    playBeep(300, 0.1);
  } else {
    spawnParticles(scaledFxCount(liteFx ? 8 : 15), color, 'spin');
    playBeep(520, 0.06);
  }

  playFinishImpact(type);
  if (!inReplay) speakFinishTerm(type);
}

function burstRing(color, delay = 0, ringIndex = 1) {
  const id = setTimeout(() => {
    const selectors = ringIndex === 2
      ? ['#burst-ring-2', '#launch-burst-ring-2']
      : ['#burst-ring', '#launch-burst-ring'];

    selectors.forEach((sel) => {
      const ring = $(sel);
      if (!ring) return;
      ring.style.color = color;
      ring.style.borderColor = color;
      ring.style.removeProperty('width');
      ring.style.removeProperty('height');
      ring.style.removeProperty('opacity');
      ring.classList.remove('animate');
      void ring.offsetWidth;
      ring.classList.add('animate');
      ring.addEventListener('animationend', () => {
        ring.classList.remove('animate');
        ring.style.removeProperty('width');
        ring.style.removeProperty('height');
        ring.style.removeProperty('opacity');
      }, { once: true });
    });
  }, delay);
  burstRingTimers.push(id);
}

function playVictoryEffect(player, isMatch) {
  const color = player === 1 ? '#ff2d55' : '#00d4ff';
  spawnConfetti(isMatch ? 120 : 50);
  spawnParticles(30, color, 'victory');
  if (isMatch) {
    for (let i = 0; i < 3; i++) {
      setTimeout(() => playBeep(523 + i * 131, 0.15), i * 150);
    }
  }
}

// ─── Particle system ───────────────────────────────────────

const canvas = $('#particle-canvas');
const ctx = canvas ? canvas.getContext('2d') : null;
let particles = [];
let animFrame = null;

function resizeCanvas() {
  if (!canvas) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

class Particle {
  constructor(x, y, color, type) {
    this.x = x;
    this.y = y;
    this.color = color;
    this.type = type;
    const angle = Math.random() * Math.PI * 2;
    const speed = type === 'streak' ? 14 + Math.random() * 18
      : type === 'burst' ? 6 + Math.random() * 16
      : 2 + Math.random() * 8;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed - (type === 'over' ? 6 : 0);
    this.life = 1;
    this.decay = type === 'streak' ? 0.028 + Math.random() * 0.025
      : 0.012 + Math.random() * 0.02;
    this.size = type === 'extreme' ? 5 + Math.random() * 8
      : type === 'streak' ? 3 + Math.random() * 4
      : 2 + Math.random() * 5;
    this.stretch = type === 'streak' ? 4 + Math.random() * 6 : 1;
    this.rotation = Math.random() * Math.PI * 2;
    this.spin = (Math.random() - 0.5) * 0.3;
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vy += 0.15;
    this.vx *= 0.98;
    this.life -= this.decay;
    this.rotation += this.spin;
  }

  draw() {
    const alpha = Math.max(0, this.life);
    if (alpha <= 0) return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.color;

    if (this.type === 'extreme') {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.rotation);
      ctx.beginPath();
      ctx.moveTo(0, -this.size);
      ctx.lineTo(this.size * 0.6, this.size * 0.4);
      ctx.lineTo(-this.size * 0.6, this.size * 0.4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else if (this.type === 'streak') {
      const w = this.size * this.stretch * 2;
      const h = this.size;
      ctx.fillRect(this.x - w / 2, this.y - h / 2, w, h);
    } else {
      const half = this.size / 2;
      ctx.fillRect(this.x - half, this.y - half, this.size, this.size);
    }
    ctx.globalAlpha = 1;
  }
}

function spawnParticles(count, color, type) {
  if (isLowFxMode() || !ctx || !canvas) return;
  const room = Math.max(0, PARTICLE_CAP - particles.length);
  count = Math.min(count, room);
  if (count <= 0) return;
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  for (let i = 0; i < count; i++) {
    particles.push(new Particle(cx, cy, color, type));
  }
  startParticleLoop();
}

function spawnStreakBurst(count, color) {
  if (isLowFxMode() || !ctx || !canvas) return;
  const room = Math.max(0, PARTICLE_CAP - particles.length);
  count = Math.min(count, room);
  if (count <= 0) return;
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  for (let i = 0; i < count; i++) {
    particles.push(new Particle(cx, cy, color, 'streak'));
  }
  startParticleLoop();
}

function spawnConfetti(count) {
  if (isLowFxMode() || !ctx || !canvas) return;
  const room = Math.max(0, PARTICLE_CAP - particles.length);
  count = Math.min(count, room);
  if (count <= 0) return;
  const colors = ['#ff2d55', '#00d4ff', '#ffd60a', '#bf5af2', '#fff'];
  for (let i = 0; i < count; i++) {
    const x = Math.random() * window.innerWidth;
    particles.push(new Particle(x, -20, colors[i % colors.length], 'extreme'));
  }
  startParticleLoop();
}

function startParticleLoop() {
  if (animFrame || !ctx || !canvas || isLowFxMode() || document.hidden) return;
  function loop() {
    if (document.hidden || isLowFxMode()) {
      animFrame = null;
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles = particles.filter((p) => p.life > 0);
    particles.forEach((p) => { p.update(); p.draw(); });
    if (particles.length > 0) {
      animFrame = requestAnimationFrame(loop);
    } else {
      animFrame = null;
    }
  }
  animFrame = requestAnimationFrame(loop);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && animFrame) {
    cancelAnimationFrame(animFrame);
    animFrame = null;
  } else if (!document.hidden && particles.length > 0 && !isLowFxMode()) {
    startParticleLoop();
  }
});

// ─── Camera ────────────────────────────────────────────────

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function pickBestLanIp(ips) {
  const list = [...ips];
  const private = (ip) => {
    const p = ip.split('.').map(Number);
    if (p[0] === 192 && p[1] === 168) return 3;
    if (p[0] === 10) return 2;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return 1;
    return 0;
  };
  list.sort((a, b) => private(b) - private(a));
  return list[0] || null;
}

async function fetchLanIpFromServer() {
  try {
    const r = await fetch('/lan-ip.json', { cache: 'no-store' });
    if (r.ok) {
      const data = await r.json();
      if (data.ip && !data.ip.startsWith('127.')) return data.ip;
    }
  } catch (_) { /* offline or old server */ }
  return null;
}

function detectLocalIp() {
  return new Promise((resolve) => {
    let done = false;
    const finish = async (ip) => {
      if (done) return;
      done = true;
      if (ip) {
        resolve(ip);
        return;
      }
      resolve(await fetchLanIpFromServer());
    };

    if (!window.RTCPeerConnection) {
      finish(null);
      return;
    }

    const ips = new Set();
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pc.createDataChannel('');
    pc.onicecandidate = (e) => {
      if (!e.candidate) {
        finish(pickBestLanIp(ips));
        return;
      }
      const match = e.candidate.candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
      if (match) {
        const ip = match[1];
        if (!ip.startsWith('127.') && !ip.startsWith('169.254.')) ips.add(ip);
      }
    };
    pc.createOffer()
      .then((o) => pc.setLocalDescription(o))
      .catch(() => finish(null));
    setTimeout(() => {
      pc.close();
      finish(pickBestLanIp(ips));
    }, 3000);
  });
}

async function getLanBaseUrl() {
  const { protocol, port, pathname } = location;
  const host = location.hostname;
  const basePath = pathname.replace(/[^/]*$/, '');
  const portPart = port ? `:${port}` : '';

  if (host !== 'localhost' && host !== '127.0.0.1') {
    return `${protocol}//${host}${portPart}${basePath}`;
  }

  const ip = await detectLocalIp();
  if (ip) return `${protocol}//${ip}${portPart}${basePath}`;
  return `${protocol}//${host}${portPart}${basePath}`;
}

/** Phone camera must use HTTPS (Safari blocks getUserMedia on http:// LAN IP) */
const PHONE_HTTPS_PORT = 8443;
const ROOM_STORAGE_KEY = 'bex-remote-room';

const PEER_CONFIG = {
  debug: 0,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  },
};

function hostPeerId(room) {
  return `bex-${String(room || '').trim().toUpperCase()}`;
}

async function getPhoneCamBaseUrl() {
  const basePath = location.pathname.replace(/[^/]*$/, '') || '/';
  const host = location.hostname;
  let addr = host;
  if (host === 'localhost' || host === '127.0.0.1') {
    addr = (await detectLocalIp()) || host;
  }
  if (addr === 'localhost' || addr === '127.0.0.1') return '';
  return `https://${addr}:${PHONE_HTTPS_PORT}${basePath}`;
}

async function getHostAppHttpsUrl() {
  const basePath = location.pathname.replace(/[^/]*$/, '') || '/';
  const host = location.hostname;
  let addr = host;
  if (host === 'localhost' || host === '127.0.0.1') {
    addr = (await detectLocalIp()) || host;
  }
  if (addr === 'localhost' || addr === '127.0.0.1') {
    return `https://localhost:${PHONE_HTTPS_PORT}${basePath === '/' ? '/' : basePath}`;
  }
  return `https://${addr}:${PHONE_HTTPS_PORT}${basePath}`;
}

function hostNeedsHttpsForRemote() {
  const host = location.hostname;
  const isLocalhost = host === 'localhost' || host === '127.0.0.1';
  return !window.isSecureContext && !isLocalhost;
}

async function updateHostSecureWarning() {
  const el = $('#host-secure-warn');
  if (!el) return;
  if ($('#cam-source').value !== 'remote' || !hostNeedsHttpsForRemote()) {
    el.hidden = true;
    return;
  }
  const httpsUrl = await getHostAppHttpsUrl();
  el.hidden = false;
  el.innerHTML =
    '<strong>主機須用 HTTPS 才能顯示手機畫面</strong><br>' +
    '你目前用 HTTP 開啟，WebRTC 無法接收手機鏡頭。<br>' +
    `請改用：<a href="${httpsUrl}" target="_blank" rel="noopener">${httpsUrl}</a>`;
}

function getRemoteCamUrl(room) {
  const code = String(room || '').trim().toUpperCase();
  const base = state.phoneCamBaseUrl;
  if (!base || base.includes('localhost') || base.includes('127.0.0.1')) {
    return null;
  }
  return `${base}remote-cam.html?room=${code}`;
}

function setRemoteStatus(msg, ok) {
  const el = $('#remote-status');
  if (el) {
    el.textContent = msg;
    el.style.color = ok ? 'var(--blue)' : ok === false ? 'var(--red)' : '';
  }
  updateRemoteCamButtons();
}

async function prepareRemoteRoom(forceNew = false) {
  state.lanBaseUrl = await getLanBaseUrl();
  state.phoneCamBaseUrl = await getPhoneCamBaseUrl();

  if (forceNew) {
    state.remoteRoomId = generateRoomCode();
    sessionStorage.setItem(ROOM_STORAGE_KEY, state.remoteRoomId);
  } else if (!state.remoteRoomId) {
    state.remoteRoomId = sessionStorage.getItem(ROOM_STORAGE_KEY) || generateRoomCode();
    sessionStorage.setItem(ROOM_STORAGE_KEY, state.remoteRoomId);
  }
  state.remoteRoomId = state.remoteRoomId.toUpperCase();
  state.remoteLink = getRemoteCamUrl(state.remoteRoomId);

  if (!state.remoteLink) {
    setRemoteStatus('正在取得本機 IP…', null);
    state.remoteLink = `https://[主機IP]:${PHONE_HTTPS_PORT}/remote-cam.html?room=${state.remoteRoomId}`;
    retryResolvePhoneUrl();
  }

  updateRemoteQrDisplay();
}

let phoneUrlRetryTimer = null;

async function retryResolvePhoneUrl(attempt = 0) {
  if (phoneUrlRetryTimer) clearTimeout(phoneUrlRetryTimer);
  if (state.remoteLink && !state.remoteLink.includes('[主機IP]')) return;

  state.phoneCamBaseUrl = await getPhoneCamBaseUrl();
  const url = getRemoteCamUrl(state.remoteRoomId);
  if (url) {
    state.remoteLink = url;
    setRemoteStatus(`等待手機掃 QR（房間 ${state.remoteRoomId}）`, true);
    updateRemoteQrDisplay();
    return;
  }

  if (attempt < 8) {
    phoneUrlRetryTimer = setTimeout(() => retryResolvePhoneUrl(attempt + 1), 1000);
  } else {
    setRemoteStatus('無法取得 LAN IP，請改用 https://你的IP:8443/ 開啟', false);
  }
}

function updateRemoteQrDisplay() {
  if (!state.remoteRoomId) return;
  $('#remote-room-code').textContent = state.remoteRoomId;
  const linkEl = $('#remote-link-text');
  if (linkEl) linkEl.textContent = state.remoteLink ? state.remoteLink : '';
  if (state.remoteLink && !state.remoteLink.includes('[主機IP]')) {
    $('#remote-qr').src =
      `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(state.remoteLink)}`;
  }
  updateRemoteCamButtons();
}

async function updatePlayerQrDisplay() {
  const linkEl = $('#player-qr-link');
  const qrImg = $('#player-qr');
  if (!linkEl) return;

  const cloudUrl = typeof getPlayerPortalUrl === 'function' ? getPlayerPortalUrl() : null;
  const base = cloudUrl || await getLanBaseUrl();
  const url = cloudUrl || `${base}player.html`;
  linkEl.textContent = url;

  if (qrImg && url && !url.includes('localhost') && !url.includes('127.0.0.1') && !url.includes('your-cloud-player')) {
    qrImg.hidden = false;
    qrImg.src =
      `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(url)}`;
  } else if (qrImg) {
    qrImg.hidden = true;
  }
}

function updateRemoteCamButtons() {
  const startBtn = $('#btn-cam-start');
  if (!startBtn || $('#cam-source').value !== 'remote') return;
  if (hasLiveRemoteVideo()) {
    startBtn.textContent = '已連線';
    startBtn.disabled = true;
  } else if (isHostPeerReady()) {
    startBtn.textContent = '等待手機掃 QR';
    startBtn.disabled = true;
  } else {
    startBtn.textContent = '連接鏡頭';
    startBtn.disabled = false;
  }
}

let remoteInboundStream = null;
let remoteFeedLogged = false;

function hasLiveRemoteVideo() {
  const track = state.cameraStream?.getVideoTracks?.()?.[0];
  return !!(track && track.readyState === 'live');
}

function resetRemoteInboundStream() {
  remoteInboundStream = null;
  remoteFeedLogged = false;
}

function mergeRemoteTrack(track) {
  if (!track) return;
  if (!remoteInboundStream) remoteInboundStream = new MediaStream();
  remoteInboundStream.getTracks()
    .filter((t) => t.kind === track.kind)
    .forEach((t) => remoteInboundStream.removeTrack(t));
  remoteInboundStream.addTrack(track);
  if (track.kind === 'video') attachRemoteStream(remoteInboundStream);
}

function attachRemoteStream(remoteStream) {
  if (!remoteStream) return;
  const videoTrack = remoteStream.getVideoTracks()[0];
  if (!videoTrack) {
    return;
  }

  if (state.cameraStream && state.cameraStream !== remoteStream && state.cameraStream.getTracks) {
    state.cameraStream.getTracks().forEach((t) => t.stop());
  }
  state.cameraStream = remoteStream;
  const video = $('#camera-feed');
  video.srcObject = remoteStream;
  applyMirror();

  const markFeedReady = () => {
    if (!video.videoWidth) return;
    showCameraActive(true);
    setRemoteStatus('手機鏡頭已連線 ✓', true);
    if (!remoteFeedLogged) {
      remoteFeedLogged = true;
      addLog('手機 / 平板鏡頭已連線 — 畫面已顯示');
    }
    updateRemoteCamButtons();
  };

  video.onloadeddata = markFeedReady;
  video.onresize = markFeedReady;

  const tryPlay = () => {
    video.muted = true;
    video.playsInline = true;
    const p = video.play();
    if (p && p.catch) {
      p.catch((err) => {
        setTimeout(tryPlay, 300);
      });
    }
  };
  tryPlay();
  setTimeout(tryPlay, 500);
  setTimeout(markFeedReady, 1200);

  videoTrack.onunmute = () => {
    tryPlay();
    markFeedReady();
  };
  videoTrack.onended = () => {
    setRemoteStatus('手機連線已中斷', false);
    hideCameraFeed();
    state.cameraStream = null;
    resetRemoteInboundStream();
    updateRemoteCamButtons();
  };
}

function bindRemoteCall(call) {
  if (state.activeRemoteCall) {
    state.activeRemoteCall.close();
  }
  state.activeRemoteCall = call;

  call.answer(new MediaStream());

  call.on('stream', (remoteStream) => {
    attachRemoteStream(remoteStream);
  });

  const pc = call.peerConnection;
  if (pc) {
    pc.ontrack = (evt) => {
      const stream = evt.streams && evt.streams[0];
      if (stream) attachRemoteStream(stream);
    };
  }

  call.on('close', () => {
    if (state.activeRemoteCall === call) state.activeRemoteCall = null;
    setRemoteStatus('手機連線已關閉', false);
  });
  call.on('error', (err) => {
    setRemoteStatus('連線錯誤：' + (err.message || err.type || 'unknown'), false);
  });
}

async function signalRequest(kind, payload) {
  const room = String(state.remoteRoomId || '').trim().toUpperCase();
  if (!room) return {};
  const url = `/signal/${encodeURIComponent(room)}/${kind}`;
  if (payload) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
    return r.ok ? r.json() : {};
  }
  const r = await fetch(url, { cache: 'no-store' });
  return r.ok ? r.json() : {};
}

function waitForIceGathering(pc, timeout = 2500) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, timeout);
    function done() {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', onChange);
      resolve();
    }
    function onChange() {
      if (pc.iceGatheringState === 'complete') done();
    }
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}

function stopSignalPolling() {
  if (state.signalPollTimer) {
    clearTimeout(state.signalPollTimer);
    state.signalPollTimer = null;
  }
}

async function pollForPhoneOffer() {
  stopSignalPolling();
  if ($('#cam-source').value !== 'remote' || !state.cameraPeer) return;

  try {
    const offer = await signalRequest('offer');
    if (offer && offer.type === 'offer') {
      if (hasLiveRemoteVideo()) {
        setRemoteStatus('手機鏡頭已連線 ✓', true);
      } else {
        let pc = state.cameraPeer;
        const offerSdp = offer.sdp || '';
        const answeredSameOffer = pc?.remoteDescription?.sdp === offerSdp;

        if (answeredSameOffer) {
          if (!hasLiveRemoteVideo()) {
            setRemoteStatus(
              pc.connectionState === 'connected' ? '已連線，等待畫面…' : '已回覆手機，等待畫面…',
              true,
            );
          }
        } else {
          if (pc?.remoteDescription || pc?.signalingState !== 'stable') {
            destroyCameraPeer();
            resetRemoteInboundStream();
            pc = createHostPeerConnection();
            state.cameraPeer = pc;
          }
          setRemoteStatus('收到手機，正在建立畫面…', null);
          await pc.setRemoteDescription(offer);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await waitForIceGathering(pc);
          await signalRequest('answer', pc.localDescription);
          setRemoteStatus('已回覆手機，等待畫面…', true);
        }
      }
    }
  } catch (err) {
    console.error(err);
    setRemoteStatus('本機信令錯誤，正在重試…', false);
  }

  const delay = hasLiveRemoteVideo() ? 2000 : 600;
  state.signalPollTimer = setTimeout(pollForPhoneOffer, delay);
}

function createHostPeerConnection() {
  const pc = new RTCPeerConnection(PEER_CONFIG.config);

  pc.ontrack = (evt) => {
    if (evt.track) {
      mergeRemoteTrack(evt.track);
      return;
    }
    const stream = evt.streams && evt.streams[0];
    if (stream) stream.getTracks().forEach(mergeRemoteTrack);
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') {
      if (!hasLiveRemoteVideo()) setRemoteStatus('已連線，等待畫面…', true);
    } else if (pc.connectionState === 'failed') {
      setRemoteStatus('連線失敗，請手機按重試或產生新房間碼', false);
      resetRemoteInboundStream();
    } else if (pc.connectionState === 'disconnected') {
      setRemoteStatus('手機暫時斷線，等待恢復…', null);
    }
    updateRemoteCamButtons();
  };

  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'failed') {
      setRemoteStatus('連線失敗，請手機按重試', false);
    }
    updateRemoteCamButtons();
  };

  return pc;
}

function isLocalHost() {
  const host = location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

async function redirectHostToLanIfNeeded() {
  if (!isLocalHost()) return true;
  const ip = await detectLocalIp();
  if (!ip) return false;
  sessionStorage.setItem('cam-source-pref', 'remote');
  sessionStorage.setItem(VIEW_STORAGE_KEY, 'camera');
  const target = `https://${ip}:${PHONE_HTTPS_PORT}${location.pathname}${location.search}${location.hash}`;
  location.replace(target);
  return false;
}

async function updateLocalhostWarn() {
  const el = $('#host-secure-warn');
  if (!el || $('#cam-source').value !== 'remote' || !isLocalHost()) {
    if (el && $('#cam-source').value === 'remote' && !isLocalHost()) el.hidden = true;
    return;
  }
  const ip = await detectLocalIp();
  el.hidden = false;
  if (ip) {
    const url = `https://${ip}:${PHONE_HTTPS_PORT}/`;
    el.innerHTML =
      '<strong>localhost 無法接收手機畫面</strong><br>' +
      '手機連線需要主機用區網 IP 開啟。<br>' +
      `<a href="${url}">👉 點此改用 ${url}</a>`;
  } else {
    el.innerHTML =
      '<strong>localhost 無法接收手機畫面</strong><br>' +
      '請改用 <code>https://你的IP:8443/</code> 開啟此頁。';
  }
}

function updateCamSourcePanels() {
  const mode = $('#cam-source').value;
  state.cameraMode = mode;
  $('#cam-local-panel').hidden = mode !== 'local';
  $('#cam-remote-panel').hidden = mode !== 'remote';
  $('#cam-dji-panel').hidden = mode !== 'dji';
  $('#cam-url-panel').hidden = mode !== 'url';
  const mirrorWrap = $('#cam-mirror-wrap');
  if (mirrorWrap) mirrorWrap.hidden = mode === 'remote' || mode === 'dji';
  if (mode === 'remote') {
    redirectHostToLanIfNeeded().then((stay) => {
      if (!stay) return;
      prepareRemoteRoom(false)
        .then(() => {
          updateHostSecureWarning();
          updateLocalhostWarn();
          return ensureRemoteHostPeer();
        })
        .catch(console.error);
    });
  } else if ($('#host-secure-warn')) {
    $('#host-secure-warn').hidden = true;
  }
  if (mode === 'dji') {
    loadDjiInfo().catch(console.error);
  }
  if (mode === 'local') {
    listCameras({ requestPermission: true, preferExternal: false });
  }
}

function showCameraActive(useVideo) {
  const video = $('#camera-feed');
  const img = $('#camera-feed-img');
  video.classList.toggle('active', useVideo);
  if (img) img.hidden = useVideo;
  $('#camera-placeholder').classList.add('hidden');
  $('#rec-badge').hidden = false;
  $('#btn-cam-start').disabled = true;
  $('#btn-cam-stop').disabled = false;
  updateRemoteCamButtons();
  if (typeof onCameraFeedActive === 'function') onCameraFeedActive();
}

function hideCameraFeed() {
  const video = $('#camera-feed');
  const img = $('#camera-feed-img');
  video.srcObject = null;
  video.classList.remove('active');
  if (img) {
    img.removeAttribute('src');
    img.hidden = true;
  }
  $('#camera-placeholder').classList.remove('hidden');
  $('#rec-badge').hidden = true;
  $('#btn-cam-start').disabled = false;
  $('#btn-cam-stop').disabled = true;
  updateRemoteCamButtons();
  if (typeof onCameraFeedStopped === 'function') onCameraFeedStopped();
}

function isBuiltInMacCamera(label) {
  return /macbook|facetime|built-in|內建|isight/i.test(label || '');
}

function isExternalCameraLabel(label) {
  return /dji|osmo|action|pocket|usb|capture|elgato|cam link|continuity|iphone|sony|canon|logitech|webcam|uvc|hdmi/i.test(label || '');
}

async function ensureCameraPermissionForEnumerate() {
  if (!navigator.mediaDevices?.enumerateDevices) return false;
  try {
    let devices = await navigator.mediaDevices.enumerateDevices();
    if (devices.some((d) => d.kind === 'videoinput' && d.label)) return true;
    const tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    tmp.getTracks().forEach((t) => t.stop());
    return true;
  } catch (_) {
    return false;
  }
}

function updateCamDeviceHint(camCount) {
  const hint = $('#cam-local-hint');
  const djiHint = $('#cam-dji-usb-hint');
  if (!hint || !djiHint) return;
  const select = $('#cam-device');
  const hasExternal = [...select.options].some((o) => o.value && isExternalCameraLabel(o.textContent));
  const onlyBuiltIn = camCount <= 1 || [...select.options].every((o) => !o.value || isBuiltInMacCamera(o.textContent));
  djiHint.hidden = hasExternal || !onlyBuiltIn;
  if (camCount === 0) {
    hint.textContent = '找不到鏡頭。請允許瀏覽器相機權限後再按「重新掃描裝置」。';
  } else if (hasExternal) {
    hint.textContent = '已偵測到外接鏡頭，請從下拉選單選擇 DJI / USB 裝置。';
  } else {
    hint.textContent = '支援 Mac Continuity Camera、USB 鏡頭、采集卡等';
  }
}

async function listCameras(options = {}) {
  const { requestPermission = false, preferExternal = false } = options;
  try {
    if (requestPermission) await ensureCameraPermissionForEnumerate();
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter((d) => d.kind === 'videoinput');
    cams.sort((a, b) => {
      const aExt = isExternalCameraLabel(a.label);
      const bExt = isExternalCameraLabel(b.label);
      const aBuiltIn = isBuiltInMacCamera(a.label);
      const bBuiltIn = isBuiltInMacCamera(b.label);
      if (aExt && !bExt) return -1;
      if (!aExt && bExt) return 1;
      if (!aBuiltIn && bBuiltIn) return -1;
      if (aBuiltIn && !bBuiltIn) return 1;
      return (a.label || '').localeCompare(b.label || '');
    });
    const select = $('#cam-device');
    const prev = select.value;
    select.innerHTML = '<option value="">預設鏡頭</option>';
    cams.forEach((cam, i) => {
      const opt = document.createElement('option');
      opt.value = cam.deviceId;
      const name = cam.label || `鏡頭 ${i + 1}`;
      opt.textContent = isExternalCameraLabel(name) ? `📷 ${name}` : name;
      select.appendChild(opt);
    });
    if (prev && [...select.options].some((o) => o.value === prev)) {
      select.value = prev;
    } else if (preferExternal) {
      const external = [...select.options].find((o) => o.value && isExternalCameraLabel(o.textContent));
      if (external) select.value = external.value;
    }
    select.disabled = cams.length === 0;
    updateCamDeviceHint(cams.length);
    return cams;
  } catch (e) {
    console.warn('Could not list cameras', e);
    updateCamDeviceHint(0);
    return [];
  }
}

async function refreshCameraDevices() {
  await listCameras({ requestPermission: true, preferExternal: true });
  const select = $('#cam-device');
  const picked = select.options[select.selectedIndex];
  if (picked?.value && isExternalCameraLabel(picked.textContent)) {
    addLog(`已選外接鏡頭：${picked.textContent.replace(/^📷\s*/, '')}`);
  } else {
    addLog('已重新掃描鏡頭裝置');
  }
}

async function startLocalCamera() {
  await ensureCameraPermissionForEnumerate();
  const deviceId = $('#cam-device').value;
  const baseVideo = deviceId
    ? { deviceId: { exact: deviceId } }
    : { facingMode: 'environment' };
  const attempts = [
    { video: { width: { ideal: 1280 }, height: { ideal: 720 }, ...baseVideo }, audio: false },
    { video: baseVideo, audio: false },
  ];
  let stream;
  let lastErr;
  for (const constraints of attempts) {
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!stream) throw lastErr || new Error('無法連接鏡頭');

  state.cameraStream = stream;
  const video = $('#camera-feed');
  video.srcObject = stream;
  showCameraActive(true);
  applyMirror();
  await listCameras({ requestPermission: true });
  const label = stream.getVideoTracks()[0]?.label || '本機鏡頭';
  addLog(`本機鏡頭已連接：${label}`);
}

function destroyCameraPeer() {
  stopSignalPolling();
  if (state.activeRemoteCall) {
    state.activeRemoteCall.close();
    state.activeRemoteCall = null;
  }
  if (state.cameraPeer) {
    if (typeof state.cameraPeer.destroy === 'function') {
      state.cameraPeer.destroy();
    } else if (typeof state.cameraPeer.close === 'function') {
      state.cameraPeer.close();
    }
    state.cameraPeer = null;
  }
  resetRemoteInboundStream();
}

function isHostPeerReady() {
  return state.cameraPeer
    && state.cameraPeer.connectionState !== 'closed'
    && state.remoteRoomId;
}

async function ensureRemoteHostPeer() {
  if (isLocalHost()) {
    await updateLocalhostWarn();
    setRemoteStatus('請改用區網 IP 開啟（見上方紅色提示）', false);
    return;
  }
  if (hostNeedsHttpsForRemote()) {
    await updateHostSecureWarning();
    setRemoteStatus('請改用 HTTPS 開啟主機（見上方紅色提示）', false);
    return;
  }
  if (!state.remoteRoomId) await prepareRemoteRoom(false);
  if (isHostPeerReady()) {
    setRemoteStatus(`等待手機掃 QR（房間 ${state.remoteRoomId}）`, true);
    pollForPhoneOffer();
    return;
  }
  await startRemoteCamera(true);
}

async function startRemoteCamera(retrySameRoom = false) {
  if (isLocalHost()) {
    await updateLocalhostWarn();
    setRemoteStatus('請改用區網 IP 開啟（見上方紅色提示）', false);
    return;
  }
  if (hostNeedsHttpsForRemote()) {
    await updateHostSecureWarning();
    setRemoteStatus('請改用 HTTPS 開啟主機（見上方提示）', false);
    throw new Error('Host must use HTTPS to receive phone camera');
  }

  if (!state.remoteRoomId) await prepareRemoteRoom(false);
  else if (!retrySameRoom) {
    state.lanBaseUrl = await getLanBaseUrl();
    state.phoneCamBaseUrl = await getPhoneCamBaseUrl();
    state.remoteLink = getRemoteCamUrl(state.remoteRoomId) || state.remoteLink;
    updateRemoteQrDisplay();
  }

  if (isHostPeerReady()) {
    setRemoteStatus(`等待手機掃 QR（房間 ${state.remoteRoomId}）`, true);
    pollForPhoneOffer();
    return;
  }

  destroyCameraPeer();
  resetRemoteInboundStream();

  setRemoteStatus('正在就緒…');

  await signalRequest('clear', {});

  state.cameraPeer = createHostPeerConnection();

  setRemoteStatus(`等待手機掃 QR（房間 ${state.remoteRoomId}）`, true);
  addLog(`手機鏡頭房間 ${state.remoteRoomId} 已就緒 — 本機信令等待手機`);
  pollForPhoneOffer();
}

const DJI_RTMP_PORT = 1935;
const DJI_STREAM_KEY = 'dji';

function buildDjiRtmpUrls(ip) {
  if (!ip) return { rtmpUrl: null, rtmpServer: null };
  const server = `rtmp://${ip}:${DJI_RTMP_PORT}/live/`;
  return { rtmpUrl: `${server}${DJI_STREAM_KEY}`, rtmpServer: server };
}

function arenaServerConnectHint() {
  const { protocol, port } = location;
  if (protocol === 'file:') {
    return '請執行 ./start.sh，用 https://localhost:8443/ 開啟（唔好直接開 HTML 檔）';
  }
  if (port && port !== '8443') {
    return `你而家用緊 :${port}（Live Server 等），請改開 https://localhost:8443/`;
  }
  return '無法連接伺服器 — 請在終端執行 ./start.sh';
}

async function loadDjiInfo() {
  const urlEl = $('#dji-rtmp-url');
  const serverEl = $('#dji-rtmp-server');
  const statusEl = $('#dji-status');
  if (urlEl) urlEl.textContent = '載入中…';
  if (serverEl) serverEl.textContent = '載入中…';

  let info = null;
  let fromServer = false;
  try {
    const r = await fetch('/dji-info.json', { cache: 'no-store' });
    if (r.ok) {
      info = await r.json();
      fromServer = true;
    }
  } catch (_) { /* server offline or not serve-https.py */ }

  if (!fromServer) {
    const ip = await detectLocalIp();
    const urls = buildDjiRtmpUrls(ip);
    info = {
      ok: false,
      ip,
      streamKey: DJI_STREAM_KEY,
      frameUrl: '/dji-frame.jpg',
      ffmpeg: null,
      relayRunning: false,
      rtmpUrl: urls.rtmpUrl,
      rtmpServer: urls.rtmpServer,
      error: !ip
        ? '無法取得本機 IP — 請用 https://電腦IP:8443/ 開啟'
        : arenaServerConnectHint(),
    };
  } else if (!info.rtmpUrl) {
    const ip = info.ip || (await detectLocalIp());
    const urls = buildDjiRtmpUrls(ip);
    info = { ...info, ip, rtmpUrl: urls.rtmpUrl, rtmpServer: urls.rtmpServer };
  }

  state.djiInfo = info;
  if (urlEl) urlEl.textContent = info.rtmpUrl || '無法取得 IP';
  if (serverEl) serverEl.textContent = info.rtmpServer || '—';
  const urlInline = $('#dji-rtmp-url-inline');
  if (urlInline) urlInline.textContent = info.rtmpUrl || '—';
  if (statusEl) {
    statusEl.textContent = info.ok
      ? '按「連接鏡頭」後，在 DJI Mimo 開始直播'
      : (info.error || '需要 ffmpeg：brew install ffmpeg');
    statusEl.style.color = info.ok ? '' : 'var(--red)';
  }
  return info;
}

function stopDjiRefresh() {
  if (state.djiRefreshTimer) {
    clearInterval(state.djiRefreshTimer);
    state.djiRefreshTimer = null;
  }
}

async function stopDjiRelay() {
  stopDjiRefresh();
  try {
    await fetch('/dji/stop', { method: 'POST' });
  } catch (_) { /* server offline */ }
}

async function startDjiCamera() {
  const info = await loadDjiInfo();
  if (!info.ok) {
    alert(info.error || '請先安裝 ffmpeg：brew install ffmpeg');
    return;
  }

  const startRes = await fetch('/dji/start', { method: 'POST' }).then((r) => r.json());
  if (!startRes.ok) {
    alert(startRes.message || '無法啟動 DJI 轉流');
    return;
  }

  const img = $('#camera-feed-img');
  const video = $('#camera-feed');
  video.srcObject = null;
  video.classList.remove('active');

  const frameUrl = `${location.origin}${info.frameUrl}`;
  let gotFrame = false;

  function refreshFrame() {
    img.src = `${frameUrl}?t=${Date.now()}`;
  }

  img.onload = () => {
    gotFrame = true;
    showCameraActive(false);
    img.hidden = false;
    applyMirror();
    $('#dji-status').textContent = 'DJI 畫面已連線 ✓';
    $('#dji-status').style.color = 'var(--blue)';
  };
  img.onerror = () => {
    if (!gotFrame) {
      const ip = state.djiInfo?.ip || '';
      $('#dji-status').innerHTML = [
        '等待 DJI Mimo 開始直播…',
        ip ? `Mimo 填 <strong>rtmp://${ip}:1935/live/</strong> + 金鑰 <strong>dji</strong>` : '',
        '若顯示「直播間異常」：手機同 Mac 同一 Wi‑Fi、關 VPN，並允許 Mac 防火牆接收連線',
      ].filter(Boolean).join('<br>');
      $('#dji-status').style.color = 'var(--gold)';
    }
  };

  stopDjiRefresh();
  refreshFrame();
  state.djiRefreshTimer = setInterval(refreshFrame, 33);
  state.cameraStream = { _dji: true };
  addLog(`DJI Action/Pocket 等待 RTMP：${info.rtmpUrl}`);
  $('#dji-status').textContent = '轉流已就緒，請在 DJI Mimo 開始直播';
}

function startUrlCamera() {
  const url = $('#cam-url-input').value.trim();
  if (!url) {
    alert('請輸入鏡頭影像 URL');
    return;
  }

  const img = $('#camera-feed-img');
  const video = $('#camera-feed');
  video.srcObject = null;
  video.classList.remove('active');

  img.onload = () => {
    showCameraActive(false);
    img.hidden = false;
    applyMirror();
    addLog(`網路鏡頭已連接：${url}`);
  };
  img.onerror = () => {
    hideCameraFeed();
    alert('無法載入影像 URL，請確認網址與 App 設定');
  };
  img.src = url.includes('?') ? `${url}&t=${Date.now()}` : `${url}?t=${Date.now()}`;
  state.cameraStream = { _url: url };
}

async function startCamera() {
  try {
    const mode = $('#cam-source').value;
    state.cameraMode = mode;

    if (mode === 'remote') {
      const stay = await redirectHostToLanIfNeeded();
      if (!stay) return;
      await prepareRemoteRoom(false);
      stopCamera(false, true);
      updateCamSourcePanels();
      await ensureRemoteHostPeer();
      return;
    }

    stopCamera(false);
    updateCamSourcePanels();

    if (mode === 'local') {
      await startLocalCamera();
    } else if (mode === 'dji') {
      await startDjiCamera();
    } else if (mode === 'url') {
      startUrlCamera();
    }
  } catch (err) {
    alert(state.cameraMode === 'local'
      ? '無法開啟鏡頭，請檢查權限或裝置'
      : '鏡頭連線失敗：' + (err.message || err));
    console.error(err);
  }
}

function stopCamera(resetUi = true, keepPeer = false) {
  if (state.cameraStream && state.cameraStream._dji) {
    stopDjiRelay();
  }
  if (state.cameraStream && state.cameraStream.getTracks) {
    state.cameraStream.getTracks().forEach((t) => t.stop());
  }
  state.cameraStream = null;
  if (!keepPeer) destroyCameraPeer();

  const img = $('#camera-feed-img');
  if (img) {
    img.onload = null;
    img.onerror = null;
    img.removeAttribute('src');
    img.hidden = true;
  }

  if (resetUi) hideCameraFeed();
  setRemoteStatus('已中斷連線');
  updateRemoteCamButtons();
}

function applyMirror() {
  const mirror = (state.cameraMode === 'remote' || state.cameraMode === 'dji')
    ? false
    : $('#cam-mirror').checked;
  const video = $('#camera-feed');
  const img = $('#camera-feed-img');
  video.classList.toggle('mirrored', mirror);
  if (img) img.classList.toggle('mirrored', mirror);
}

async function copyDjiRtmp() {
  if (!state.djiInfo) await loadDjiInfo();
  const url = state.djiInfo?.rtmpUrl;
  if (!url) {
    alert('無法取得 RTMP 位址');
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    $('#dji-status').textContent = 'RTMP 已複製到剪貼簿';
    $('#dji-status').style.color = 'var(--blue)';
  } catch (_) {
    prompt('複製此 RTMP 到 DJI Mimo：', url);
  }
}

async function copyRemoteLink() {
  if (!state.remoteLink) await prepareRemoteRoom();
  try {
    await navigator.clipboard.writeText(state.remoteLink);
    setRemoteStatus('連結已複製到剪貼簿', true);
  } catch (_) {
    prompt('複製此連結到手機瀏覽器：', state.remoteLink);
  }
}

async function copyPlayerLink() {
  const cloudUrl = typeof getPlayerPortalUrl === 'function' ? getPlayerPortalUrl() : null;
  const base = await getLanBaseUrl();
  const url = cloudUrl || `${base}player.html`;
  try {
    await navigator.clipboard.writeText(url);
    if (typeof showToast === 'function') showToast('選手查閱連結已複製');
  } catch (_) {
    prompt('複製此連結給選手：', url);
  }
}

// ─── App views (tabs) ──────────────────────────────────────

const VIEW_STORAGE_KEY = 'bex-app-view';

function applyAppViewState(viewId) {
  $$('.app-nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === viewId);
  });
  $$('.app-view').forEach((view) => {
    view.classList.toggle('active', view.id === `view-${viewId}`);
  });
}

function showAppView(viewId, persist = true) {
  if (persist) sessionStorage.setItem(VIEW_STORAGE_KEY, viewId);
  applyAppViewState(viewId);
  if (viewId === 'camera') updateCamSourcePanels();
  if (viewId === 'tournament') {
    updatePlayerQrDisplay().catch(console.error);
    if (typeof renderTournamentUI === 'function') renderTournamentUI();
  }
}

function switchAppView(viewId, persist = true) {
  if (document.body.classList.contains('launch-active')) {
    if (persist) sessionStorage.setItem(VIEW_STORAGE_KEY, viewId);
    return;
  }
  showAppView(viewId, persist);
}

function closeOpenModals() {
  let closed = false;
  [
    ['#shortcuts-modal', () => { if (typeof toggleShortcutsModal === 'function') toggleShortcutsModal(false); }],
    ['#event-checklist-modal', (el) => { el.hidden = true; }],
    ['#admin-settings-modal', (el) => { el.hidden = true; }],
    ['#sync-conflict-modal', (el) => { el.hidden = true; }],
  ].forEach(([sel, close]) => {
    const el = $(sel);
    if (el && !el.hidden) {
      close(el);
      closed = true;
    }
  });
  return closed;
}

function isExitLaunchButtonVisible() {
  const btn = $('#btn-exit-launch');
  return Boolean(btn && !btn.hidden);
}

function handleEscapeKey() {
  if (closeOpenModals()) return true;

  if (isExitLaunchButtonVisible()) {
    exitLaunchToTournament();
    return true;
  }

  // 全螢幕鎖定時攔截 Esc，避免瀏覽器退出全螢幕（Esc 只對應 ✕ 賽程）
  if (document.fullscreenElement && isArenaFullscreenLocked()) {
    return true;
  }

  return false;
}

function initAppViews() {
  const nav = $('.app-nav');
  if (nav) {
    nav.addEventListener('click', (e) => {
      const btn = e.target.closest('.app-nav-btn');
      if (!btn?.dataset.view) return;
      switchAppView(btn.dataset.view);
    });
  }

  const saved = sessionStorage.getItem(VIEW_STORAGE_KEY);
  switchAppView(saved && $(`#view-${saved}`) ? saved : 'battle', false);
}

// ─── Event bindings ────────────────────────────────────────

function init() {
  $$('.btn-finish').forEach((btn) => {
    btn.addEventListener('click', () => {
      awardFinish(parseInt(btn.dataset.player, 10), btn.dataset.type);
    });
  });

  $('#btn-next-battle').addEventListener('click', nextBattle);
  $('#btn-undo-finish')?.addEventListener('click', undoLastFinish);
  $('#btn-reset-match').addEventListener('click', resetMatch);
  $('#btn-launch').addEventListener('click', startLaunchCountdown);
  $('#btn-relaunch').addEventListener('click', startLaunchCountdown);
  $('#btn-dismiss-victory').addEventListener('click', () => {
    const inTournamentFlow = $('#victory-overlay').classList.contains('victory-overlay--tournament');
    if (typeof hideVictorySchedulePanel === 'function') hideVictorySchedulePanel();
    $('#victory-overlay').hidden = true;
    $('#btn-dismiss-victory').textContent = '繼續';
    if (inTournamentFlow && typeof switchAppView === 'function') {
      switchAppView('tournament');
    }
  });
  $('#btn-victory-bracket')?.addEventListener('click', () => {
    if (typeof hideVictorySchedulePanel === 'function') hideVictorySchedulePanel();
    $('#victory-overlay').hidden = true;
    $('#btn-dismiss-victory').textContent = '繼續';
    if (typeof switchAppView === 'function') switchAppView('tournament');
  });
  $('#btn-victory-revert')?.addEventListener('click', () => {
    revertMatchEndingFinish();
  });

  $$('.btn-score-adj').forEach((btn) => {
    btn.addEventListener('click', () => {
      adjustScore(parseInt(btn.dataset.player, 10), parseInt(btn.dataset.delta, 10));
    });
  });

  $('#btn-clear-log').addEventListener('click', () => {
    $('#battle-log').innerHTML = '';
    renderBattleLogStats();
  });
  $('#btn-export-log')?.addEventListener('click', exportBattleLog);

  $('#btn-cam-start').addEventListener('click', startCamera);
  $('#btn-cam-stop').addEventListener('click', () => stopCamera());
  $('#cam-mirror').addEventListener('change', applyMirror);
  $('#cam-source').addEventListener('change', () => {
    sessionStorage.setItem('cam-source-pref', $('#cam-source').value);
    updateCamSourcePanels();
    if ($('#cam-source').value === 'remote') {
      switchAppView('camera');
    }
  });
  $('#cam-device').addEventListener('change', () => {
    if (state.cameraStream && state.cameraMode === 'local') startCamera();
  });
  $('#btn-cam-refresh').addEventListener('click', () => {
    refreshCameraDevices().catch(console.error);
  });

  if (navigator.mediaDevices?.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', () => {
      if ($('#cam-source').value !== 'local') return;
      listCameras({ requestPermission: true, preferExternal: true }).then((cams) => {
        if (cams.some((c) => isExternalCameraLabel(c.label))) {
          addLog('偵測到新鏡頭裝置，請從下拉選單選擇');
        }
      });
    });
  }
  $('#btn-copy-remote-link').addEventListener('click', copyRemoteLink);
  $('#btn-copy-dji-rtmp').addEventListener('click', copyDjiRtmp);
  $('#btn-new-room').addEventListener('click', async () => {
    if (state.cameraStream && !confirm('產生新房间碼會中斷現有連線，確定？')) return;
    stopCamera();
    await prepareRemoteRoom(true);
    await ensureRemoteHostPeer();
    addLog(`新手機鏡頭房間：${state.remoteRoomId}`);
  });
  $('#btn-cam-url-apply').addEventListener('click', () => {
    if (state.cameraMode !== 'url') $('#cam-source').value = 'url';
    updateCamSourcePanels();
    startCamera();
  });

  $('#btn-fullscreen').addEventListener('click', () => {
    toggleArenaFullscreen();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const tag = e.target?.tagName;
    const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (inField) {
      if (handleEscapeKey()) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    const handled = handleEscapeKey();
    if (handled || (document.fullscreenElement && isArenaFullscreenLocked())) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, { capture: true });

  document.addEventListener('keydown', (e) => {
    const tag = e.target?.tagName;
    const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    const shortcutsOpen = !$('#shortcuts-modal')?.hidden;

    if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (!inField) {
        e.preventDefault();
        if (typeof toggleShortcutsModal === 'function') toggleShortcutsModal();
      }
      return;
    }
    if (shortcutsOpen && e.key === 'Escape') return;
    if (inField) return;

    const p1Keys = { '1': 'spin', '2': 'burst', '3': 'over', '4': 'extreme' };
    const p2Keys = { '7': 'spin', '8': 'burst', '9': 'over', '0': 'extreme' };
    if (p1Keys[e.key]) {
      e.preventDefault();
      awardFinish(1, p1Keys[e.key]);
      return;
    }
    if (p2Keys[e.key]) {
      e.preventDefault();
      awardFinish(2, p2Keys[e.key]);
      return;
    }
    if ((e.key === 'n' || e.key === 'N') && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      nextBattle();
      return;
    }
    if ((e.key === 'l' || e.key === 'L') && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      if (!state.matchOver && !launchPlaying) startLaunchCountdown();
      return;
    }

    if ((e.key === ' ' || e.code === 'Space') && launchStandbyActive && !launchPlaying) {
      e.preventDefault();
      startLaunchCountdownFromStandby();
      return;
    }
    if ((e.key === ' ' || e.code === 'Space') && !state.matchOver && !launchPlaying && !launchStandbyActive) {
      if (state.readyForNextRound || document.body.classList.contains('launch-live')) {
        e.preventDefault();
        startQuickNextRoundCountdown();
        return;
      }
    }
    if (e.key === 'Escape') return;

    if ((e.key === 'z' || e.key === 'Z') && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const btn = $('#btn-undo-finish');
      if (btn && !btn.disabled) {
        e.preventDefault();
        undoLastFinish();
      }
    }
  });

  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) {
      arenaFullscreenExitAllowed = false;
      launchFullscreenActive = true;
      lockArenaEscapeKey();
      updateFullscreenButtonState();
      return;
    }

    unlockArenaEscapeKey();
    launchFullscreenActive = false;
    updateFullscreenButtonState();

    if (isArenaFullscreenLocked() && !arenaFullscreenExitAllowed) {
      document.documentElement.requestFullscreen()
        .then(() => lockArenaEscapeKey())
        .catch(() => {});
      return;
    }

    arenaFullscreenExitAllowed = false;
  });

  $('#btn-exit-launch').addEventListener('click', () => {
    exitLaunchToTournament();
  });
  $('#btn-start-countdown')?.addEventListener('click', (e) => {
    e.stopPropagation();
    handleLaunchStandbyStart();
  });
  const launchOverlay = $('#launch-camera-overlay');
  if (launchOverlay) {
    launchOverlay.addEventListener('click', (e) => {
      if (!document.body.classList.contains('launch-standby')) return;
      if (e.target.closest('#btn-start-countdown')) return;
      handleLaunchStandbyStart();
    });
  }

  updateScoreDisplay();
  $('#session-select').addEventListener('change', () => {
    addLog(`切換至 ${getSessionLabel()}`);
    const overlayLink = $('#overlay-link');
    if (overlayLink) overlayLink.href = `overlay.html?session=${$('#session-select').value}`;
    pushArenaLiveState();
  });
  $('#phase-select').addEventListener('change', () => {
    addLog(`比賽階段：${getPhaseLabel()}`);
    pushArenaLiveState();
  });
  nameEls.forEach((el) => {
    el.addEventListener('input', pushArenaLiveState);
  });

  syncFinishButtons();
  initTournament();
  initReplay();
  initAppViews();
  initArenaSyncBanner();
  updateUndoButton();
  updateMatchTargetUI();
  updateFullscreenButtonState();
  if (typeof initArenaAdmin === 'function') initArenaAdmin();
  if (typeof initSupabaseSync === 'function') initSupabaseSync();
  if (typeof initMatchLockPoll === 'function') initMatchLockPoll();
  if (typeof initArenaBroadcast === 'function') initArenaBroadcast();
  setCompetitionMode(isCompetitionMode());
  setLowFxMode(isLowFxMode());
  $('#competition-mode-toggle')?.addEventListener('change', (e) => {
    setCompetitionMode(e.target.checked);
    if (typeof showToast === 'function') {
      showToast(e.target.checked ? '比賽模式：倒數優先、減少延遲' : '比賽模式已關閉');
    }
  });
  $('#low-fx-mode-toggle')?.addEventListener('change', (e) => {
    setLowFxMode(e.target.checked);
    if (typeof showToast === 'function') {
      showToast(e.target.checked ? '低特效模式：關閉粒子動畫' : '低特效模式已關閉');
    }
  });
  $('#replay-bitrate-select')?.addEventListener('change', (e) => {
    setReplayBitrate(parseInt(e.target.value, 10));
    if (typeof showToast === 'function') showToast('回放錄製碼率已更新（下一局生效）');
  });
  const bitrateSelect = $('#replay-bitrate-select');
  if (bitrateSelect) bitrateSelect.value = String(getReplayBitrate());
  $('#btn-checklist-warm')?.addEventListener('click', async () => {
    const ok = await warmCompetitionAssets();
    if (typeof showToast === 'function') {
      showToast(ok ? '倒數音效已預熱' : '音效預熱失敗，請再試一次');
    }
    if (typeof runEventChecklist === 'function') runEventChecklist();
  });
  document.body.addEventListener('pointerdown', () => {
    warmCompetitionAssets().catch(() => {});
  }, { once: true });
  $('#btn-copy-player-link')?.addEventListener('click', () => { copyPlayerLink().catch(console.error); });
  updatePlayerQrDisplay().catch(console.error);

  const camPref = sessionStorage.getItem('cam-source-pref');
  if (camPref && $('#cam-source option[value="' + camPref + '"]')) {
    $('#cam-source').value = camPref;
  }

  addLog(`歡迎來到咩咩遊樂園陀螺競賽 — ${getSessionLabel()} · ${getPhaseLabel()}`);
  addLog(`官方規則：整場 Match 累積計分，先取 ${getMatchTarget()} 分者勝`);
  addLog('得分判定：極致收尾 +3 · 擊飛／爆裂結局 +2 · 殘存結局 +1');
  addLog('國際對決口令：Three, Two, One, Go Shoot!');
  updateCamSourcePanels();
  updateHostSecureWarning();
  getLanBaseUrl().then(async (url) => {
    state.lanBaseUrl = url;
    state.phoneCamBaseUrl = await getPhoneCamBaseUrl();
  });
  if (goShootAudio) goShootAudio.load();
  listCameras({ requestPermission: true });
  pushArenaLiveState();
}

document.addEventListener('DOMContentLoaded', init);
