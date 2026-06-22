/**
 * 咩咩遊樂園 — Beyblade X 陀螺競賽
 * Scoring, live camera, and visual effects
 */

const LAUNCH_SEQUENCE = ['Three', 'Two', 'One', 'Go Shoot!'];

const PHASE_LABELS = {
  prelim: '初賽',
  quarter: '複賽',
  revival: '迷失小羊復活賽',
  challenge: '四強資格爭奪戰',
  semi: '準決賽',
  final: '總決賽',
};

const SESSION_LABELS = {
  junior: '第一場 低齡組（6–12歲）',
  senior: '第二場 高齡組（12歲+）',
};

const MATCH_TARGET = 4;

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
  cameraStream: null,
  cameraMode: 'local',
  cameraPeer: null,
  activeRemoteCall: null,
  remoteRoomId: null,
  remoteLink: '',
  lanBaseUrl: '',
  phoneCamBaseUrl: '',
};

// DOM refs
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const scoreEls = [$('#score-p1'), $('#score-p2')];
const trackEls = [$('#track-p1'), $('#track-p2')];
const nameEls = [$('#name-p1'), $('#name-p2')];
const playerCards = [$('.player-red'), $('.player-blue')];

// ─── Scoring (Official 4-point cumulative Match) ───────────

function finishTooltip(type) {
  const f = FINISH_LABELS[type];
  const pts = FINISH_POINTS[type];
  return `${f.zh} ${f.en} — ${FINISH_DESCRIPTIONS[type]} (+${pts})`;
}

function syncFinishButtons() {
  $$('.btn-finish').forEach((btn) => {
    const type = btn.dataset.type;
    const f = FINISH_LABELS[type];
    if (!f) return;
    btn.title = finishTooltip(type);
    const nameEl = btn.querySelector('.finish-name');
    if (nameEl) {
      nameEl.innerHTML = `${f.zh}<em>${f.en.replace(' Finish', '')}</em>`;
    }
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
  if (typeof updateTournamentLiveScores === 'function') {
    updateTournamentLiveScores(state.scores, state.currentBattle);
  }
}

function updateScoreTracks() {
  trackEls.forEach((container, i) => {
    container.innerHTML = '';
    for (let p = 0; p < MATCH_TARGET; p++) {
      const seg = document.createElement('span');
      seg.className = 'score-seg' + (p < state.scores[i] ? ' filled' : '');
      container.appendChild(seg);
    }
  });
}

function addLog(message, team = 'system', opts = {}) {
  const log = $('#battle-log');
  const li = document.createElement('li');
  li.className = team === 1 ? 'red' : team === 2 ? 'blue' : 'system';
  if (opts.type) li.classList.add(opts.type);
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  li.innerHTML = `<span class="log-time">${time}</span>${message}`;
  log.prepend(li);
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
}

function awardFinish(player, type) {
  if (state.matchOver) return;

  const pts = FINISH_POINTS[type];
  const idx = player - 1;
  const name = nameEls[idx].value || `Blader ${player}`;

  state.scores[idx] += pts;
  updateScoreDisplay();
  playerCards[idx].classList.add('score-pop');
  setTimeout(() => playerCards[idx].classList.remove('score-pop'), 350);

  const label = finishLabel(type);
  addLog(
    `第 ${state.currentBattle} 局 · <strong>${name}</strong> — ${label} <span class="log-points">+${pts}</span> · 比分 <span class="log-score">${state.scores[0]} : ${state.scores[1]}</span>`,
    player
  );
  showToast(`${FINISH_LABELS[type].zh}! +${pts}`);

  triggerFinishEffect(type, player);
  checkMatchEnd();
}

function checkMatchEnd() {
  const p1 = state.scores[0];
  const p2 = state.scores[1];

  if (p1 >= MATCH_TARGET || p2 >= MATCH_TARGET) {
    const winner = p1 >= MATCH_TARGET ? 0 : 1;
    endMatch(winner);
  }
}

function nextBattle() {
  if (state.matchOver) {
    state.scores = [0, 0];
    state.currentBattle = 1;
    state.matchOver = false;
    $('#victory-overlay').hidden = true;
    updateScoreDisplay();
    addLog('— 新 Match 開始（分數歸零）—');
    resetLaunchTimer();
    showToast('新 Match 開始');
    return;
  }

  state.currentBattle++;
  updateScoreDisplay();
  addLog(`— 第 ${state.currentBattle} 局對戰開始（${state.scores[0]} : ${state.scores[1]}）—`);
  resetLaunchTimer(false);
  showToast(`第 ${state.currentBattle} 局`);
}

function endMatch(winnerIdx) {
  state.matchOver = true;
  const name = nameEls[winnerIdx].value || `Blader ${winnerIdx + 1}`;
  const score = state.scores[winnerIdx];
  const detail = `率先取得 ${MATCH_TARGET} 分（${score} : ${state.scores[1 - winnerIdx]}）· 共 ${state.currentBattle} 局對戰`;

  $('#victory-name').textContent = name;
  $('#victory-detail').textContent = detail;
  $('#victory-overlay').hidden = false;

  const inTournament = typeof tournamentState !== 'undefined' && tournamentState.activeMatchId;
  const scoreLine = `<span class="log-score">${score} : ${state.scores[1 - winnerIdx]}</span>`;
  if (inTournament) {
    addLog(`Match 結束 · 比分 ${scoreLine} · ${state.currentBattle} 局`, winnerIdx + 1);
  } else {
    addLog(
      `🏆 本場 Match 勝者：<strong>${name}</strong> · ${scoreLine} · ${state.currentBattle} 局`,
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
}

function resetMatchScoresOnly() {
  state.scores = [0, 0];
  state.currentBattle = 1;
  state.matchOver = false;
  updateScoreDisplay();
  $('#victory-overlay').hidden = true;
  resetLaunchTimer();
}

function loadMatchScores(scores, battles, matchOver) {
  state.scores = [...scores];
  state.currentBattle = battles || 1;
  state.matchOver = !!matchOver;
  updateScoreDisplay();
  $('#victory-overlay').hidden = true;
  resetLaunchTimer();
}

function resetMatch(silent) {
  if (!silent && (state.scores[0] || state.scores[1] || state.currentBattle > 1) && !confirm('重置整場 Match？累積分數將歸零。')) return;

  state.scores = [0, 0];
  state.currentBattle = 1;
  state.matchOver = false;
  updateScoreDisplay();
  $('#victory-overlay').hidden = true;
  if (!silent) {
    $('#battle-log').innerHTML = '';
    addLog('新 Match 開始 — 官方 4 分累積制');
  }
  resetLaunchTimer();
}

// ─── Launch countdown ──────────────────────────────────────

let launchTimers = [];
let launchPlaying = false;

const goShootAudio = $('#go-shoot-audio');
// Measured from waveform (6.528s clip): Three, Two, One, Go Shoot!
const GO_SHOOT_SYNC = [
  { at: 0.12, label: 'Three' },
  { at: 1.32, label: 'Two' },
  { at: 2.54, label: 'One' },
  { at: 4.18, label: 'Go Shoot!', fx: true },
];
const GO_SHOOT_DURATION = 6.528;
const LAUNCH_ZOOM_MS = 600;
let launchRaf = null;
let launchStep = -1;
let goShootFxFired = false;
let cameraLaunchActive = false;
let launchEnteredFullscreen = false;

async function enterBrowserFullscreen() {
  if (document.fullscreenElement) return;
  try {
    await document.documentElement.requestFullscreen();
    launchEnteredFullscreen = true;
  } catch (_) { /* user gesture / browser policy */ }
}

function exitBrowserFullscreen() {
  if (launchEnteredFullscreen && document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
  launchEnteredFullscreen = false;
}

function enterCameraLaunchMode() {
  return new Promise(async (resolve) => {
    if (!state.cameraStream && $('#cam-source').value === 'local') {
      try {
        await startLocalCamera();
      } catch (_) { /* continue with placeholder */ }
    }

    const overlay = $('#launch-camera-overlay');
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    clearLaunchOverlayText();
    document.body.classList.add('launch-countdown');

    if (!cameraLaunchActive) {
      cameraLaunchActive = true;
      document.body.classList.add('launch-active');
      await enterBrowserFullscreen();
      setTimeout(resolve, LAUNCH_ZOOM_MS);
    } else {
      resolve();
    }
  });
}

let launchOverlayHideTimer = null;
let goShootTextHideTimer = null;

const GO_SHOOT_TEXT_VISIBLE_MS = 580;
const GO_SHOOT_TEXT_FADE_MS = 160;

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

function exitCameraLaunchMode(overlayDelay = 0) {
  cameraLaunchActive = false;
  document.body.classList.remove('launch-active', 'launch-countdown', 'launch-live');
  exitBrowserFullscreen();
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

function scheduleGoShootTextHide() {
  if (goShootTextHideTimer) clearTimeout(goShootTextHideTimer);
  goShootTextHideTimer = setTimeout(() => {
    const overlayText = $('#launch-camera-text');
    if (overlayText && overlayText.textContent) {
      overlayText.classList.remove('show');
      overlayText.classList.add('fade-out');
      setTimeout(clearLaunchOverlayText, GO_SHOOT_TEXT_FADE_MS);
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
    setTimeout(() => {
      impactBurst.className = 'launch-impact-burst';
    }, 560);
  }

  document.body.classList.remove('anime-impact-frame');
  void document.body.offsetWidth;
  document.body.classList.add('anime-impact-frame');
  setTimeout(() => document.body.classList.remove('anime-impact-frame'), stepIndex >= 2 ? 140 : 100);
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
  void overlayText.offsetWidth;
  overlayText.classList.add('show');

  if (label === 'Go Shoot!') {
    scheduleGoShootTextHide();
  }

  if (timerEl) {
    timerEl.textContent = label;
    timerEl.classList.toggle('go-shoot', label === 'Go Shoot!');
  }

  triggerCountdownStepEffect(label, stepIndex);
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
    spawnParticles(45, color, 'burst');
    spawnStreakBurst(18, color);
  } else if (stepIndex === 1) {
    flashScreen('anime-impact', 100, 0.85);
    flashScreen('gold-flash', 90, 0.6);
    shakeScreen('light', 380);
    burstRing(color);
    burstRing('#ffffff', 70, 2);
    spawnParticles(65, color, 'burst');
    spawnStreakBurst(26, color);
  } else {
    flashScreen('anime-impact', 130, 1);
    flashScreen('burst-flash', 150, 0.9);
    setTimeout(() => flashScreen('extreme-flash', 90, 0.45), 70);
    shakeScreen('heavy', 580);
    burstRing(color);
    burstRing('#ffffff', 60, 2);
    spawnParticles(95, color, 'burst');
    spawnParticles(35, '#ffffff', 'extreme');
    spawnStreakBurst(35, color);
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
    if (t < steps[i].at) break;
    launchStep = i;
    showLaunchOverlayText(steps[i].label, i);
    if (steps[i].fx) goShootFxFired = true;
  }

  launchRaf = requestAnimationFrame(syncLaunchVisuals);
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
  if (goShootAudio) goShootAudio.onended = null;
  addLog('Three, Two, One, Go Shoot!');
  document.body.classList.remove('launch-countdown');
  document.body.classList.add('launch-live');
  if (launchOverlayHideTimer) {
    clearTimeout(launchOverlayHideTimer);
    launchOverlayHideTimer = null;
  }
  launchOverlayHideTimer = setTimeout(hideLaunchOverlay, 200);
  const badge = $('#rec-badge');
  if (badge) badge.setAttribute('data-hint', 'Esc 退出全屏');
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

  spawnParticles(130, '#ff2d55', 'burst');
  spawnParticles(85, '#ffd60a', 'extreme');
  spawnParticles(65, '#00d4ff', 'burst');
  spawnParticles(45, '#ffffff', 'extreme');
  spawnStreakBurst(65, '#ffffff');
  spawnConfetti(55);

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
  el.textContent = 'Ready';
  el.classList.remove('counting', 'go-shoot');
  $('#btn-launch').disabled = false;
  updateRelaunchButton();
  if (exitFullscreen) exitCameraLaunchMode();
  else {
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

function startLaunchCountdownAudio() {
  goShootAudio.currentTime = 0;
  launchPlaying = true;
  launchStep = -1;
  goShootFxFired = false;

  goShootAudio.onended = () => {
    if (launchPlaying) finishLaunchCountdown();
  };

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
  const el = $('#launch-timer');
  const btn = $('#btn-launch');
  const relaunchBtn = $('#btn-relaunch');
  if (launchPlaying || launchTimers.length || launchRaf) return;

  btn.disabled = true;
  if (relaunchBtn) relaunchBtn.disabled = true;
  el.classList.add('counting');
  el.classList.remove('go-shoot');
  el.textContent = '…';

  await enterCameraLaunchMode();

  if ($('#voice-countdown').checked && goShootAudio) {
    startLaunchCountdownAudio();
  } else {
    await startLaunchCountdownFallback();
  }
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

function shakeScreen(intensity = 'light', duration = 400) {
  const cls = intensity === 'go-shoot' ? 'shake-go-shoot'
    : intensity === 'heavy' ? 'shake-heavy' : 'shake';
  document.body.classList.remove('shake', 'shake-heavy', 'shake-go-shoot');
  void document.body.offsetWidth;
  document.body.classList.add(cls);
  setTimeout(() => document.body.classList.remove(cls), duration);
}

function pulseCamera() {
  const vp = $('#camera-viewport');
  if (!vp) return;
  vp.classList.remove('cam-punch');
  void vp.offsetWidth;
  vp.classList.add('cam-punch');
}

function triggerFinishEffect(type, player) {
  const color = player === 1 ? '#ff2d55' : '#00d4ff';

  if (type === 'burst') {
    document.body.classList.add('shake-heavy');
    flashScreen('burst-flash');
    burstRing(color);
    spawnParticles(40, color, 'burst');
    playBeep(120, 0.15);
    setTimeout(() => document.body.classList.remove('shake-heavy'), 600);
  } else if (type === 'extreme') {
    document.body.classList.add('shake-heavy');
    flashScreen('extreme-flash');
    spawnParticles(80, '#bf5af2', 'extreme');
    spawnParticles(40, '#ffd60a', 'extreme');
    playBeep(80, 0.25);
    setTimeout(() => document.body.classList.remove('shake-heavy'), 600);
  } else if (type === 'over') {
    document.body.classList.add('shake');
    flashScreen();
    spawnParticles(25, '#ffd60a', 'over');
    playBeep(300, 0.1);
    setTimeout(() => document.body.classList.remove('shake'), 400);
  } else {
    spawnParticles(15, color, 'spin');
    playBeep(520, 0.06);
  }
}

function burstRing(color, delay = 0, ringIndex = 1) {
  setTimeout(() => {
    const ring = ringIndex === 2 ? $('#burst-ring-2') : $('#burst-ring');
    if (!ring) return;
    ring.style.borderColor = color;
    ring.classList.remove('animate');
    void ring.offsetWidth;
    ring.classList.add('animate');
  }, delay);
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
    ctx.save();
    ctx.globalAlpha = Math.max(0, this.life);
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);
    ctx.fillStyle = this.color;

    if (this.type === 'extreme') {
      ctx.beginPath();
      ctx.moveTo(0, -this.size);
      ctx.lineTo(this.size * 0.6, this.size * 0.4);
      ctx.lineTo(-this.size * 0.6, this.size * 0.4);
      ctx.closePath();
      ctx.fill();
    } else if (this.type === 'streak') {
      ctx.fillRect(-this.size * this.stretch, -this.size / 2, this.size * this.stretch * 2, this.size);
    } else {
      ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size);
    }
    ctx.restore();
  }
}

function spawnParticles(count, color, type) {
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  for (let i = 0; i < count; i++) {
    particles.push(new Particle(cx, cy, color, type));
  }
  startParticleLoop();
}

function spawnStreakBurst(count, color) {
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  for (let i = 0; i < count; i++) {
    particles.push(new Particle(cx, cy, color, 'streak'));
  }
  startParticleLoop();
}

function spawnConfetti(count) {
  const colors = ['#ff2d55', '#00d4ff', '#ffd60a', '#bf5af2', '#fff'];
  for (let i = 0; i < count; i++) {
    const x = Math.random() * window.innerWidth;
    particles.push(new Particle(x, -20, colors[i % colors.length], 'extreme'));
  }
  startParticleLoop();
}

function startParticleLoop() {
  if (animFrame || !ctx || !canvas) return;
  function loop() {
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

// ─── Camera ────────────────────────────────────────────────

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function detectLocalIp() {
  return new Promise((resolve) => {
    if (!window.RTCPeerConnection) {
      resolve(null);
      return;
    }
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pc.createDataChannel('');
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      const match = e.candidate.candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
      if (match && !match[1].startsWith('127.')) {
        pc.close();
        resolve(match[1]);
      }
    };
    pc.createOffer()
      .then((o) => pc.setLocalDescription(o))
      .catch(() => resolve(null));
    setTimeout(() => {
      pc.close();
      resolve(null);
    }, 2500);
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
  if (location.protocol === 'https:' && Number(location.port) === PHONE_HTTPS_PORT) {
    return `${location.origin}${basePath}`;
  }
  const host = location.hostname;
  let addr = host;
  if (host === 'localhost' || host === '127.0.0.1') {
    addr = (await detectLocalIp()) || host;
  }
  return `https://${addr}:${PHONE_HTTPS_PORT}${basePath}`;
}

async function getHostAppHttpsUrl() {
  const basePath = location.pathname.replace(/[^/]*$/, '') || '/';
  if (location.protocol === 'https:' && Number(location.port) === PHONE_HTTPS_PORT) {
    return `${location.origin}${basePath === '/' ? '/' : basePath}`;
  }
  const host = location.hostname;
  let addr = host;
  if (host === 'localhost' || host === '127.0.0.1') {
    addr = (await detectLocalIp()) || host;
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
    setRemoteStatus('無法取得 LAN IP，QR 可能無法使用', false);
    state.remoteLink = `https://[主機IP]:${PHONE_HTTPS_PORT}/remote-cam.html?room=${state.remoteRoomId}`;
  }

  updateRemoteQrDisplay();
}

function updateRemoteQrDisplay() {
  if (!state.remoteRoomId) return;
  $('#remote-room-code').textContent = state.remoteRoomId;
  $('#remote-link-text').textContent = state.remoteLink || '';
  if (state.remoteLink && !state.remoteLink.includes('[主機IP]')) {
    $('#remote-qr').src =
      `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(state.remoteLink)}`;
  }
}

function attachRemoteStream(remoteStream) {
  if (!remoteStream) return;

  if (state.cameraStream && state.cameraStream.getTracks) {
    state.cameraStream.getTracks().forEach((t) => t.stop());
  }
  state.cameraStream = remoteStream;
  const video = $('#camera-feed');
  video.srcObject = remoteStream;
  showCameraActive(true);
  applyMirror();
  setRemoteStatus('手機鏡頭已連線 ✓', true);
  addLog('手機 / 平板鏡頭已連線 — 畫面已顯示');

  const tryPlay = () => {
    video.play().catch(() => {});
  };
  tryPlay();
  if (remoteStream.getVideoTracks().length === 0) {
    remoteStream.onaddtrack = () => {
      tryPlay();
      setRemoteStatus('手機鏡頭已連線 ✓', true);
    };
  }

  remoteStream.getTracks().forEach((track) => {
    track.onended = () => {
      setRemoteStatus('手機連線已中斷', false);
      hideCameraFeed();
      state.cameraStream = null;
    };
  });
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

function updateCamSourcePanels() {
  const mode = $('#cam-source').value;
  state.cameraMode = mode;
  $('#cam-local-panel').hidden = mode !== 'local';
  $('#cam-remote-panel').hidden = mode !== 'remote';
  $('#cam-url-panel').hidden = mode !== 'url';
  if (mode === 'remote') {
    prepareRemoteRoom(false)
      .then(() => {
        updateHostSecureWarning();
        return ensureRemoteHostPeer();
      })
      .catch(console.error);
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
}

async function listCameras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter((d) => d.kind === 'videoinput');
    const select = $('#cam-device');
    const prev = select.value;
    select.innerHTML = '<option value="">預設鏡頭</option>';
    cams.forEach((cam, i) => {
      const opt = document.createElement('option');
      opt.value = cam.deviceId;
      opt.textContent = cam.label || `鏡頭 ${i + 1}`;
      select.appendChild(opt);
    });
    if (prev && [...select.options].some((o) => o.value === prev)) select.value = prev;
    select.disabled = cams.length === 0;
  } catch (e) {
    console.warn('Could not list cameras', e);
  }
}

async function startLocalCamera() {
  const deviceId = $('#cam-device').value;
  const constraints = {
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'environment' }),
    },
    audio: false,
  };

  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  state.cameraStream = stream;
  const video = $('#camera-feed');
  video.srcObject = stream;
  showCameraActive(true);
  applyMirror();
  await listCameras();
  addLog('本機鏡頭已連接');
}

function destroyCameraPeer() {
  if (state.activeRemoteCall) {
    state.activeRemoteCall.close();
    state.activeRemoteCall = null;
  }
  if (state.cameraPeer) {
    state.cameraPeer.destroy();
    state.cameraPeer = null;
  }
}

function isHostPeerReady() {
  return state.cameraPeer
    && state.cameraPeer.open
    && !state.cameraPeer.destroyed
    && state.cameraPeer.id === hostPeerId(state.remoteRoomId);
}

async function ensureRemoteHostPeer() {
  if (hostNeedsHttpsForRemote()) {
    await updateHostSecureWarning();
    setRemoteStatus('請改用 HTTPS 開啟主機（見上方紅色提示）', false);
    return;
  }
  if (!state.remoteRoomId) await prepareRemoteRoom(false);
  if (isHostPeerReady()) {
    setRemoteStatus(`主機已就緒 — 房間碼 ${state.remoteRoomId}，等待手機連線`, true);
    return;
  }
  await startRemoteCamera(true);
}

async function startRemoteCamera(retrySameRoom = false) {
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
    setRemoteStatus(`主機已就緒 — 房間碼 ${state.remoteRoomId}，等待手機連線`, true);
    return;
  }

  destroyCameraPeer();

  const hostId = hostPeerId(state.remoteRoomId);
  setRemoteStatus('等待手機連線…（請掃 QR 或開連結）');

  return new Promise((resolve, reject) => {
    state.cameraPeer = new Peer(hostId, PEER_CONFIG);

    state.cameraPeer.on('open', () => {
      setRemoteStatus(`主機已就緒 — 房間碼 ${state.remoteRoomId}，請手機按「開啟鏡頭並連線」`, true);
      addLog(`手機鏡頭房間 ${state.remoteRoomId} 已上線 — 等待手機`);
      resolve();
    });

    state.cameraPeer.on('call', (call) => {
      bindRemoteCall(call);
    });

    state.cameraPeer.on('disconnected', () => {
      setRemoteStatus('Peer 已斷線，正在重連…', false);
      state.cameraPeer.reconnect();
    });

    state.cameraPeer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        setRemoteStatus('房間 ID 被佔用，2 秒後重試…', false);
        destroyCameraPeer();
        setTimeout(() => {
          startRemoteCamera(true).then(resolve).catch(reject);
        }, 2000);
        return;
      }
      if (err.type === 'network' || err.type === 'server-error') {
        setRemoteStatus('Peer 伺服器錯誤，請檢查網路', false);
      } else {
        setRemoteStatus('Peer 錯誤：' + (err.message || err.type), false);
      }
      reject(err);
    });
  });
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
      await prepareRemoteRoom(false);
      stopCamera(false, true);
    } else {
      stopCamera(false);
      updateCamSourcePanels();
    }

    if (mode === 'local') {
      await startLocalCamera();
    } else if (mode === 'remote') {
      await ensureRemoteHostPeer();
    } else if (mode === 'url') {
      updateCamSourcePanels();
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
}

function applyMirror() {
  const mirror = $('#cam-mirror').checked;
  const video = $('#camera-feed');
  const img = $('#camera-feed-img');
  video.classList.toggle('mirrored', mirror);
  if (img) img.classList.toggle('mirrored', mirror);
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

// ─── App views (tabs) ──────────────────────────────────────

const VIEW_STORAGE_KEY = 'bex-app-view';

function switchAppView(viewId, persist = true) {
  if (document.body.classList.contains('launch-active')) return;

  $$('.app-nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === viewId);
  });
  $$('.app-view').forEach((view) => {
    view.classList.toggle('active', view.id === `view-${viewId}`);
  });

  if (viewId === 'camera' && $('#cam-source').value === 'remote') {
    updateCamSourcePanels();
  }

  if (persist) sessionStorage.setItem(VIEW_STORAGE_KEY, viewId);
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
  $('#btn-reset-match').addEventListener('click', resetMatch);
  $('#btn-launch').addEventListener('click', startLaunchCountdown);
  $('#btn-relaunch').addEventListener('click', startLaunchCountdown);
  $('#btn-dismiss-victory').addEventListener('click', () => {
    $('#victory-overlay').hidden = true;
  });
  $('#btn-clear-log').addEventListener('click', () => {
    $('#battle-log').innerHTML = '';
  });

  $('#btn-cam-start').addEventListener('click', startCamera);
  $('#btn-cam-stop').addEventListener('click', () => stopCamera());
  $('#cam-mirror').addEventListener('change', applyMirror);
  $('#cam-source').addEventListener('change', () => {
    updateCamSourcePanels();
  });
  $('#cam-device').addEventListener('change', () => {
    if (state.cameraStream && state.cameraMode === 'local') startCamera();
  });
  $('#btn-cam-refresh').addEventListener('click', async () => {
    try {
      const tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      tmp.getTracks().forEach((t) => t.stop());
    } catch (_) { /* need permission to read labels */ }
    await listCameras();
    addLog('已重新掃描鏡頭裝置');
  });
  $('#btn-copy-remote-link').addEventListener('click', copyRemoteLink);
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
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (cameraLaunchActive || document.body.classList.contains('launch-active'))) {
      resetLaunchTimer();
    }
  });

  updateScoreDisplay();
  $('#session-select').addEventListener('change', () => {
    addLog(`切換至 ${getSessionLabel()}`);
  });
  $('#phase-select').addEventListener('change', () => {
    addLog(`比賽階段：${getPhaseLabel()}`);
  });

  syncFinishButtons();
  initTournament();
  initAppViews();

  addLog(`歡迎來到咩咩遊樂園陀螺競賽 — ${getSessionLabel()} · ${getPhaseLabel()}`);
  addLog('官方規則：整場 Match 累積計分，先取 4 分者勝');
  addLog('得分判定：極致收尾 +3 · 擊飛／爆裂結局 +2 · 殘存結局 +1');
  addLog('國際對決口令：Three, Two, One, Go Shoot!');
  updateCamSourcePanels();
  updateHostSecureWarning();
  getLanBaseUrl().then(async (url) => {
    state.lanBaseUrl = url;
    state.phoneCamBaseUrl = await getPhoneCamBaseUrl();
  });
  listCameras();
}

document.addEventListener('DOMContentLoaded', init);
