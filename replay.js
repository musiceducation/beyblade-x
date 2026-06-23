/**
 * Battle replay — grouped by Match, multi-round, fullscreen theater
 */

const REPLAY_LIST_KEY = 'bex-battle-replays-v2';
const REPLAY_DB_NAME = 'bex-replay-videos';
const REPLAY_DB_VERSION = 1;
const MAX_REPLAYS = 60;

const replayState = {
  replays: [],
  session: null,
  recorder: null,
  recordingSessionId: null,
  recorderChunks: [],
  imgCapture: null,
  playback: null,
  savedBattleState: null,
  videoUrls: [],
  activeMatchGroupKey: null,
  activeMatchGroupId: null,
  db: null,
  finalizeChain: Promise.resolve(),
};

function replayId() {
  return `r-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function getReplayContext() {
  const sessionEl = $('#session-select');
  const phaseEl = $('#phase-select');
  return {
    session: sessionEl?.value || 'junior',
    phase: phaseEl?.value || 'prelim',
    tournamentMatchId: typeof tournamentState !== 'undefined' ? tournamentState.activeMatchId : null,
    p1Name: nameEls[0]?.value?.trim() || 'Blader 1',
    p2Name: nameEls[1]?.value?.trim() || 'Blader 2',
  };
}

function replayContextKey(ctx) {
  return `${ctx.session}|${ctx.phase}|${ctx.tournamentMatchId || ''}|${ctx.p1Name}|${ctx.p2Name}`;
}

function ensureMatchGroup(ctx) {
  const key = replayContextKey(ctx);
  if (replayState.activeMatchGroupKey !== key || !replayState.activeMatchGroupId) {
    replayState.activeMatchGroupKey = key;
    replayState.activeMatchGroupId = `m-${Date.now()}`;
  }
  return replayState.activeMatchGroupId;
}

function resetMatchGroup() {
  replayState.activeMatchGroupKey = null;
  replayState.activeMatchGroupId = null;
}

function loadReplayList() {
  try {
    const raw = localStorage.getItem(REPLAY_LIST_KEY);
    replayState.replays = raw ? JSON.parse(raw) : [];
    if (!raw) {
      const legacy = localStorage.getItem('bex-battle-replays-v1');
      if (legacy) {
        replayState.replays = JSON.parse(legacy);
        saveReplayList();
      }
    }
  } catch {
    replayState.replays = [];
  }
}

function saveReplayList() {
  localStorage.setItem(REPLAY_LIST_KEY, JSON.stringify(replayState.replays.slice(0, MAX_REPLAYS)));
}

function queueReplayFinalize(task) {
  replayState.finalizeChain = replayState.finalizeChain
    .then(task)
    .catch((err) => console.warn('Replay finalize failed', err));
  return replayState.finalizeChain;
}

function openReplayDb() {
  if (replayState.db) return Promise.resolve(replayState.db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(REPLAY_DB_NAME, REPLAY_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('videos')) {
        db.createObjectStore('videos');
      }
    };
    req.onsuccess = () => {
      replayState.db = req.result;
      resolve(replayState.db);
    };
    req.onerror = () => reject(req.error);
  });
}

async function saveReplayVideo(id, blob) {
  const db = await openReplayDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('videos', 'readwrite');
    tx.objectStore('videos').put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getReplayVideo(id) {
  const db = await openReplayDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('videos', 'readonly');
    const req = tx.objectStore('videos').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function deleteReplayVideo(id) {
  const db = await openReplayDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('videos', 'readwrite');
    tx.objectStore('videos').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function stopImgCapture() {
  if (replayState.imgCapture?.timer) {
    clearInterval(replayState.imgCapture.timer);
  }
  replayState.imgCapture = null;
}

function getRecordableStream() {
  if (typeof getBeyScanRecordStream === 'function') {
    const scanStream = getBeyScanRecordStream();
    if (scanStream) return scanStream;
  }

  if (state.cameraStream) return state.cameraStream;

  const video = $('#camera-feed');
  if (video?.srcObject && video.classList.contains('active') && typeof video.captureStream === 'function') {
    try {
      return video.captureStream(30);
    } catch (_) { /* fall through */ }
  }

  const img = $('#camera-feed-img');
  if (img && !img.hidden && img.src && img.complete && img.naturalWidth > 0) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = img.naturalWidth || 1280;
    canvas.height = img.naturalHeight || 720;

    const draw = () => {
      if (img.naturalWidth) {
        if (canvas.width !== img.naturalWidth) canvas.width = img.naturalWidth;
        if (canvas.height !== img.naturalHeight) canvas.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      }
    };
    draw();
    const timer = setInterval(draw, 1000 / 15);
    replayState.imgCapture = { timer, canvas };
    return canvas.captureStream(15);
  }

  return null;
}

function stopReplayRecording(discard = false) {
  stopImgCapture();
  const rec = replayState.recorder;
  replayState.recorder = null;
  replayState.recordingSessionId = null;
  if (!rec) return Promise.resolve(null);

  return new Promise((resolve) => {
    rec.onstop = () => {
      if (discard || !replayState.recorderChunks.length) {
        replayState.recorderChunks = [];
        resolve(null);
        return;
      }
      const mime = rec.mimeType || 'video/webm';
      const blob = new Blob(replayState.recorderChunks, { type: mime });
      replayState.recorderChunks = [];
      resolve(blob.size > 1024 ? blob : null);
    };
    if (rec.state !== 'inactive') rec.stop();
    else resolve(null);
  });
}

function startReplayRecording(sessionId) {
  if (replayState.recorder && replayState.recordingSessionId === sessionId) return;

  const startNew = () => {
    replayState.recorderChunks = [];
    const stream = getRecordableStream();
    if (!stream || typeof MediaRecorder === 'undefined') return;

    const mimeTypes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    const mimeType = mimeTypes.find((t) => MediaRecorder.isTypeSupported(t));
    if (!mimeType) return;

    try {
      const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2500000 });
      rec.ondataavailable = (e) => {
        if (e.data?.size) replayState.recorderChunks.push(e.data);
      };
      rec.start(1000);
      replayState.recorder = rec;
      replayState.recordingSessionId = sessionId;
    } catch (err) {
      console.warn('Replay recording unavailable', err);
    }
  };

  if (replayState.recorder) {
    stopReplayRecording(true).then(startNew).catch(startNew);
    return;
  }
  startNew();
}

function sessionHasActivity(session) {
  return session.events.some((e) => e.type === 'finish' || e.type === 'launch');
}

function sessionFinalScores(session) {
  const finishes = session.events.filter((e) => e.type === 'finish');
  if (finishes.length) return [...finishes[finishes.length - 1].scores];
  return [...(session.startScores || [0, 0])];
}

function createReplaySession(battleNum) {
  const ctx = getReplayContext();
  return {
    id: replayId(),
    createdAt: new Date().toISOString(),
    battleNum: battleNum || state.currentBattle,
    matchGroupId: ensureMatchGroup(ctx),
    contextKey: replayContextKey(ctx),
    startScores: [...state.scores],
    events: [{
      type: 'battleStart',
      battle: battleNum || state.currentBattle,
      scores: [...state.scores],
      ts: Date.now(),
    }],
    ...ctx,
  };
}

function ensureReplaySession(battleNum) {
  const num = battleNum || state.currentBattle;
  const ctx = getReplayContext();
  const key = replayContextKey(ctx);

  if (replayState.session) {
    if (replayState.session.battleNum !== num || replayState.session.contextKey !== key) {
      const stale = replayState.session;
      replayState.session = null;
      queueReplayFinalize(() => finalizeReplaySession(stale, sessionFinalScores(stale), {
        battleNum: stale.battleNum,
        discardVideo: !sessionHasActivity(stale),
      }));
    }
  }

  if (!replayState.session) {
    replayState.session = createReplaySession(num);
  }

  return replayState.session;
}

function recordReplayLaunch() {
  const session = ensureReplaySession(state.currentBattle);
  session.events.push({ type: 'launch', battle: state.currentBattle, ts: Date.now() });
  startReplayRecording(session.id);
}

function recordReplayFinish(player, finishType, points, scores) {
  const session = ensureReplaySession(state.currentBattle);
  session.events.push({
    type: 'finish',
    player,
    finishType,
    points,
    scores: [...scores],
    battle: state.currentBattle,
    ts: Date.now(),
  });
}

async function finalizeReplaySession(session, finalScores, options = {}) {
  if (!session) return;

  const blob = await stopReplayRecording(options.discardVideo);
  session.finalScores = [...finalScores];
  session.battleNum = options.battleNum || session.battleNum;
  session.endedAt = new Date().toISOString();
  session.startScores = session.startScores || session.events.find((e) => e.type === 'battleStart')?.scores || [0, 0];
  if (!session.matchGroupId) {
    session.matchGroupId = ensureMatchGroup(session);
  }

  if (options.matchEnd) {
    session.events.push({
      type: 'matchEnd',
      winner: options.winner,
      scores: [...finalScores],
      battles: options.battles,
      ts: Date.now(),
    });
  }

  const hasFinish = session.events.some((e) => e.type === 'finish');
  if (!hasFinish && !blob) return;

  if (blob) {
    session.videoId = session.id;
    try {
      await saveReplayVideo(session.id, blob);
    } catch (err) {
      console.warn('Could not save replay video', err);
      session.videoId = null;
    }
  }

  replayState.replays.unshift(session);
  if (replayState.replays.length > MAX_REPLAYS) {
    const removed = replayState.replays.splice(MAX_REPLAYS);
    removed.forEach((r) => {
      if (r.videoId) deleteReplayVideo(r.videoId).catch(() => {});
    });
  }
  saveReplayList();
  renderReplayList();
}

function discardReplaySession() {
  if (replayState.session) {
    const stale = replayState.session;
    replayState.session = null;
    stopReplayRecording(true).catch(() => {});
    return stale;
  }
  stopReplayRecording(true).catch(() => {});
  return null;
}

function formatReplayTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

function replayBattleDelta(replay) {
  const start = replay.startScores || replay.events.find((e) => e.type === 'battleStart')?.scores || [0, 0];
  const end = replay.finalScores || start;
  return [end[0] - start[0], end[1] - start[1]];
}

function replayFinishSummary(events) {
  const icons = { burst: '💥', over: '⬆', extreme: '⚡', spin: '🌀' };
  return events
    .filter((e) => e.type === 'finish')
    .map((e) => icons[e.finishType] || '·')
    .join(' ');
}

function replayFinishLabel(finishType) {
  if (typeof FINISH_LABELS !== 'undefined' && FINISH_LABELS[finishType]) {
    return FINISH_LABELS[finishType].zh;
  }
  return finishType;
}

function replayFinishChips(events) {
  const icons = { burst: '💥', over: '⬆', extreme: '⚡', spin: '🌀' };
  return events
    .filter((e) => e.type === 'finish')
    .map((e) => {
      const icon = icons[e.finishType] || '·';
      const label = replayFinishLabel(e.finishType);
      const playerClass = e.player === 1 ? 'p1' : 'p2';
      return `<span class="replay-finish-chip replay-finish-chip--${playerClass}" title="${escapeReplayText(label)}">P${e.player} ${icon} +${e.points}</span>`;
    })
    .join('');
}

function replayTimelineBase(replay) {
  const launch = replay.events.find((e) => e.type === 'launch');
  const battleStart = replay.events.find((e) => e.type === 'battleStart');
  return launch?.ts || battleStart?.ts || 0;
}

function formatReplayOffset(ms) {
  const sec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

function buildFinishSchedule(replay) {
  const base = replayTimelineBase(replay);
  const finishes = replay.events.filter((e) => e.type === 'finish');
  const hasTimestamps = base > 0 && finishes.every((e) => e.ts);

  if (!hasTimestamps) {
    let delay = 500;
    return finishes.map((event) => {
      const entry = { event, delay, videoSeek: null };
      delay += 1700;
      return entry;
    });
  }

  return finishes.map((event) => ({
    event,
    delay: Math.max(350, event.ts - base),
    videoSeek: Math.max(0, (event.ts - base) / 1000),
  }));
}

function renderReplayEvents(replay) {
  const container = $('#replay-events');
  if (!container) return;

  const finishes = replay.events.filter((e) => e.type === 'finish');
  if (!finishes.length) {
    container.hidden = true;
    container.innerHTML = '';
    return;
  }

  const base = replayTimelineBase(replay);
  container.hidden = false;
  container.innerHTML = finishes.map((event) => {
    const offset = base && event.ts ? formatReplayOffset(event.ts - base) : '—';
    const playerClass = event.player === 1 ? 'p1' : 'p2';
    const name = event.player === 1 ? replay.p1Name : replay.p2Name;
    return `
      <div class="replay-event-row replay-event-row--${playerClass}">
        <span class="replay-event-time">${offset}</span>
        <span class="replay-event-label">${escapeReplayText(name)} · ${escapeReplayText(replayFinishLabel(event.finishType))}</span>
        <span class="replay-event-points">+${event.points}</span>
      </div>`;
  }).join('');
}

function updateReplayCountBadge() {
  const badge = $('#replay-count');
  if (!badge) return;
  const count = replayState.replays.length;
  if (!count) {
    badge.hidden = true;
    badge.textContent = '';
    return;
  }
  badge.hidden = false;
  badge.textContent = `${count} 局`;
}

function getMatchRounds(replay) {
  const gid = replay.matchGroupId || replay.id;
  return replayState.replays
    .filter((r) => (r.matchGroupId || r.id) === gid)
    .sort((a, b) => a.battleNum - b.battleNum || a.createdAt.localeCompare(b.createdAt));
}

function groupReplaysByMatch(replays) {
  const map = new Map();
  replays.forEach((r) => {
    const gid = r.matchGroupId || r.id;
    if (!map.has(gid)) map.set(gid, []);
    map.get(gid).push(r);
  });
  return [...map.values()]
    .map((rounds) => rounds.sort((a, b) => a.battleNum - b.battleNum || a.createdAt.localeCompare(b.createdAt)))
    .sort((a, b) => (b[0]?.createdAt || '').localeCompare(a[0]?.createdAt || ''));
}

function matchGroupSummary(rounds) {
  const last = rounds[rounds.length - 1];
  const total = last?.finalScores || [0, 0];
  const phase = typeof PHASE_LABELS !== 'undefined' ? PHASE_LABELS[last?.phase] : last?.phase;
  const videoCount = rounds.filter((r) => r.videoId).length;
  return {
    p1Name: last?.p1Name || 'Blader 1',
    p2Name: last?.p2Name || 'Blader 2',
    total,
    phase,
    roundCount: rounds.length,
    videoCount,
    hasMatchEnd: rounds.some((r) => r.events?.some((e) => e.type === 'matchEnd')),
  };
}

function renderReplayList() {
  const list = $('#replay-list');
  if (!list) return;

  updateReplayCountBadge();

  if (!replayState.replays.length) {
    list.innerHTML = `
      <li class="replay-empty">
        <span class="replay-empty-icon" aria-hidden="true">🎬</span>
        尚無回放紀錄。每局結束或 Match 結束後自動儲存，同一 Match 的多局會歸在同一組。
      </li>`;
    return;
  }

  const groups = groupReplaysByMatch(replayState.replays);
  list.innerHTML = groups.map((rounds) => {
    const summary = matchGroupSummary(rounds);
    const groupId = rounds[0].matchGroupId || rounds[0].id;
    const videoTag = summary.videoCount
      ? `<span class="replay-tag">${summary.videoCount} 段影片</span>`
      : '';
    const matchTag = summary.hasMatchEnd ? '<span class="replay-tag replay-tag-win">Match 結束</span>' : '';
    const roundsHtml = rounds.map((r) => {
      const delta = replayBattleDelta(r);
      const total = r.finalScores || [0, 0];
      const chips = replayFinishChips(r.events);
      const active = replayState.playback?.replay?.id === r.id ? ' is-active' : '';
      const videoBadge = r.videoId ? '<span class="replay-item-video">影片</span>' : '';
      return `
        <li class="replay-round-item${active}" data-id="${r.id}">
          <button type="button" class="replay-item-btn">
            <span class="replay-item-badge">B${r.battleNum}</span>
            <span class="replay-item-row">
              <span class="replay-item-delta">本局 +${delta[0]} : +${delta[1]}</span>
              <span class="replay-item-meta">總分 ${total[0]} : ${total[1]}</span>
              ${videoBadge}
            </span>
            <span class="replay-item-chips">${chips || '<span class="replay-item-meta">無得分</span>'}</span>
            <span class="replay-item-time">${formatReplayTime(r.createdAt)}</span>
          </button>
        </li>`;
    }).join('');

    return `
      <li class="replay-match-group" data-group-id="${groupId}">
        <div class="replay-match-header">
          <span class="replay-match-title">${escapeReplayText(summary.p1Name)} vs ${escapeReplayText(summary.p2Name)}</span>
          <div class="replay-match-actions">
            <button type="button" class="btn btn-sm btn-ghost btn-replay-match-play" data-group-id="${groupId}">▶ 整場回放</button>
          </div>
          <span class="replay-match-meta">
            <span>共 ${summary.roundCount} 局 · 總分 ${summary.total[0]} : ${summary.total[1]}</span>
            ${summary.phase ? `<span>${summary.phase}</span>` : ''}
            ${videoTag}${matchTag}
          </span>
        </div>
        <ul class="replay-rounds">${roundsHtml}</ul>
      </li>`;
  }).join('');
}

function renderReplayRoundTabs(rounds, activeId) {
  const tabs = $('#replay-round-tabs');
  const playAll = $('#btn-replay-play-all');
  if (!tabs) return;

  if (rounds.length <= 1) {
    tabs.hidden = true;
    tabs.innerHTML = '';
    if (playAll) playAll.hidden = true;
    return;
  }

  tabs.hidden = false;
  if (playAll) playAll.hidden = false;
  tabs.innerHTML = rounds.map((r) => {
    const active = r.id === activeId ? ' active' : '';
    return `<button type="button" class="replay-round-tab${active}" data-id="${r.id}">第 ${r.battleNum} 局</button>`;
  }).join('');
}

function escapeReplayText(value) {
  if (typeof escapeHtml === 'function') return escapeHtml(value);
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function trackVideoUrl(url) {
  if (!url) return url;
  replayState.videoUrls.push(url);
  return url;
}

function revokeVideoUrls() {
  replayState.videoUrls.forEach((url) => URL.revokeObjectURL(url));
  replayState.videoUrls = [];
}

function setReplayControlsDisabled(disabled) {
  $$('.btn-finish').forEach((btn) => { btn.disabled = disabled; });
  ['#btn-launch', '#btn-next-battle', '#btn-replay-play', '#btn-replay-play-all'].forEach((sel) => {
    const el = $(sel);
    if (el) el.disabled = disabled;
  });
}

function saveLiveBattleState() {
  replayState.savedBattleState = {
    scores: [...state.scores],
    currentBattle: state.currentBattle,
    matchOver: state.matchOver,
    p1Name: nameEls[0]?.value || '',
    p2Name: nameEls[1]?.value || '',
  };
}

function restoreLiveBattleState() {
  const saved = replayState.savedBattleState;
  if (!saved) return;
  state.scores = [...saved.scores];
  state.currentBattle = saved.currentBattle;
  state.matchOver = saved.matchOver;
  nameEls[0].value = saved.p1Name;
  nameEls[1].value = saved.p2Name;
  updateScoreDisplay();
  replayState.savedBattleState = null;
}

function updateReplayHud(replay, scores, label) {
  const start = replay.events.find((e) => e.type === 'battleStart')?.scores || replay.startScores || [0, 0];
  const display = scores || start;
  const p1 = $('#replay-hud-p1');
  const p2 = $('#replay-hud-p2');
  const s1 = $('#replay-hud-s1');
  const s2 = $('#replay-hud-s2');
  const battle = $('#replay-hud-battle');
  const hudLabel = $('#replay-hud-label');
  if (p1) p1.textContent = replay.p1Name;
  if (p2) p2.textContent = replay.p2Name;
  if (s1) s1.textContent = display[0];
  if (s2) s2.textContent = display[1];
  if (battle) battle.textContent = `第 ${replay.battleNum} 局`;
  if (hudLabel && label) hudLabel.textContent = label;
}

function pulseReplayHudScore(player) {
  const scoreEl = player === 1 ? $('#replay-hud-s1') : $('#replay-hud-s2');
  if (!scoreEl) return;
  scoreEl.classList.remove('replay-hud-pop');
  void scoreEl.offsetWidth;
  scoreEl.classList.add('replay-hud-pop');
  setTimeout(() => scoreEl.classList.remove('replay-hud-pop'), 420);
}

function playReplayFinishFeedback(event) {
  pulseReplayHudScore(event.player);
  if (typeof playBeep === 'function') {
    const beeps = { burst: [120, 0.15], extreme: [80, 0.25], over: [300, 0.1], spin: [520, 0.06] };
    const [freq, dur] = beeps[event.finishType] || beeps.spin;
    playBeep(freq, dur);
  }
}

function hideReplayTheater() {
  const theater = $('#replay-theater');
  const tv = $('#replay-theater-video');
  if (tv) {
    tv.pause();
    tv.removeAttribute('src');
    tv.classList.add('no-video');
  }
  theater?.classList.remove('replay-theater--no-video');
  theater?.setAttribute('hidden', '');
  theater?.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('replay-theater-active');
}

async function waitForTheaterVideoMeta() {
  const tv = $('#replay-theater-video');
  if (!tv?.src) return 0;
  if (tv.readyState >= 1 && Number.isFinite(tv.duration)) return tv.duration;

  return new Promise((resolve) => {
    const finish = () => resolve(Number.isFinite(tv.duration) ? tv.duration : 0);
    tv.addEventListener('loadedmetadata', finish, { once: true });
    setTimeout(finish, 2500);
  });
}

async function showReplayTheater(replay, videoUrl) {
  const theater = $('#replay-theater');
  const tv = $('#replay-theater-video');
  if (!theater || !tv) return;

  theater.removeAttribute('hidden');
  theater.setAttribute('aria-hidden', 'false');
  document.body.classList.add('replay-theater-active');
  theater.classList.toggle('replay-theater--no-video', !videoUrl);

  const start = replay.events.find((e) => e.type === 'battleStart')?.scores || replay.startScores || [0, 0];
  updateReplayHud(replay, start, videoUrl ? '回放中…' : '重播得分（無影片）');

  if (videoUrl) {
    tv.classList.remove('no-video');
    tv.src = videoUrl;
    tv.currentTime = 0;
    try {
      await tv.play();
    } catch (_) { /* autoplay policy */ }
  } else {
    tv.pause();
    tv.removeAttribute('src');
    tv.classList.add('no-video');
  }

  if (typeof switchAppView === 'function' && !document.querySelector('#view-replay.active')) {
    switchAppView('replay');
  }
}

function resetReplayPlaybackTimers() {
  if (replayState.playback?.timers) {
    replayState.playback.timers.forEach(clearTimeout);
  }
  hideReplayTheater();
  document.body.classList.remove('replay-playing');
  setReplayControlsDisabled(false);
}

function stopReplayPlayback(options = {}) {
  const { keepPanel = false } = options;
  if (replayState.playback) {
    replayState.playback.cancelled = true;
    replayState.playback.timers.forEach(clearTimeout);
    replayState.playback = null;
  }
  hideReplayTheater();
  restoreLiveBattleState();
  document.body.classList.remove('replay-playing');
  setReplayControlsDisabled(false);

  if (!keepPanel) {
    revokeVideoUrls();
    const video = $('#replay-video');
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    $('#replay-player')?.setAttribute('hidden', '');
    renderReplayList();
  }
}

async function loadReplayVideoUrl(replay) {
  if (!replay?.videoId) return null;
  const blob = await getReplayVideo(replay.videoId);
  if (!blob) return null;
  return trackVideoUrl(URL.createObjectURL(blob));
}

async function openReplayPlayer(id, options = {}) {
  const { autoPlay = false, playMatch = false } = options;
  const replay = replayState.replays.find((r) => r.id === id);
  if (!replay) return;

  stopReplayPlayback({ keepPanel: true });

  const rounds = getMatchRounds(replay);
  const panel = $('#replay-player');
  const title = $('#replay-player-title');
  const progress = $('#replay-player-progress');
  const video = $('#replay-video');
  const downloadBtn = $('#btn-replay-download');
  const delta = replayBattleDelta(replay);
  const total = replay.finalScores || [0, 0];

  if (title) {
    title.textContent = `${replay.p1Name} vs ${replay.p2Name} · 第 ${replay.battleNum} 局`;
  }
  if (progress) {
    const groupHint = rounds.length > 1 ? ` · 整場共 ${rounds.length} 局` : '';
    progress.textContent = `本局 +${delta[0]} : +${delta[1]} · 總分 ${total[0]} : ${total[1]}${groupHint} · ${formatReplayTime(replay.createdAt)}`;
  }

  renderReplayEvents(replay);
  renderReplayRoundTabs(rounds, replay.id);
  panel?.removeAttribute('hidden');

  const videoUrl = await loadReplayVideoUrl(replay);
  if (video && videoUrl) {
    video.src = videoUrl;
    video.hidden = false;
    downloadBtn.hidden = false;
    downloadBtn.onclick = () => {
      const a = document.createElement('a');
      a.href = videoUrl;
      a.download = `beyblade-replay-b${replay.battleNum}.webm`;
      a.click();
    };
  } else if (video) {
    video.hidden = true;
    downloadBtn.hidden = true;
  }

  replayState.playback = { replay, rounds, videoUrl, timers: [], cancelled: false };
  renderReplayList();

  if (autoPlay) {
    if (playMatch) playReplayMatch().catch(console.error);
    else playReplayScores().catch(console.error);
  }
}

function openMatchReplay(groupId, roundId) {
  const rounds = replayState.replays
    .filter((r) => (r.matchGroupId || r.id) === groupId)
    .sort((a, b) => a.battleNum - b.battleNum || a.createdAt.localeCompare(b.createdAt));
  if (!rounds.length) return;

  const startId = roundId || rounds[0].id;
  openReplayPlayer(startId, { autoPlay: true, playMatch: true }).catch(console.error);
}

function scheduleReplayStep(fn, delay) {
  if (!replayState.playback || replayState.playback.cancelled) return;
  const id = setTimeout(() => {
    if (!replayState.playback || replayState.playback.cancelled) return;
    fn();
  }, delay);
  replayState.playback.timers.push(id);
}

function waitMs(ms) {
  return new Promise((resolve) => {
    scheduleReplayStep(resolve, ms);
  });
}

function playReplayRound(replay, videoUrl, options = {}) {
  const { roundIndex = 0, roundTotal = 1 } = options;

  return new Promise((resolve) => {
    if (!replayState.playback || replayState.playback.cancelled) {
      resolve();
      return;
    }

    replayState.playback.replay = replay;
    replayState.playback.videoUrl = videoUrl;

    const startEvent = replay.events.find((e) => e.type === 'battleStart');
    const startScores = [...(startEvent?.scores || replay.startScores || [0, 0])];

    const roundLabel = roundTotal > 1
      ? `整場回放 · 第 ${roundIndex + 1}/${roundTotal} 局`
      : (videoUrl ? '回放中…' : '重播得分（無影片）');

    showReplayTheater(replay, videoUrl).then(async () => {
      updateReplayHud(replay, startScores, roundLabel);
      renderReplayEvents(replay);
      renderReplayRoundTabs(replayState.playback.rounds, replay.id);
      renderReplayList();

      const schedule = buildFinishSchedule(replay);
      const videoDuration = videoUrl ? await waitForTheaterVideoMeta() : 0;
      const tv = $('#replay-theater-video');
      let lastDelay = 350;

      schedule.forEach((entry) => {
        lastDelay = Math.max(lastDelay, entry.delay);
        scheduleReplayStep(() => {
          if (!replayState.playback || replayState.playback.cancelled) return;

          if (videoUrl && tv && entry.videoSeek != null && Number.isFinite(tv.duration)) {
            try {
              tv.currentTime = Math.min(entry.videoSeek, Math.max(0, tv.duration - 0.05));
            } catch (_) { /* seek unsupported */ }
          }

          updateReplayHud(replay, entry.event.scores, roundLabel);
          playReplayFinishFeedback(entry.event);
        }, entry.delay);
      });

      const endDelay = Math.max(
        lastDelay + 1200,
        videoDuration > 0 ? videoDuration * 1000 + 400 : 0,
        schedule.length ? schedule[schedule.length - 1].delay + 1200 : 800,
      );

      scheduleReplayStep(() => resolve(), endDelay);
    });
  });
}

async function playReplayScores() {
  if (!replayState.playback?.replay || document.body.classList.contains('replay-playing')) return;

  saveLiveBattleState();
  replayState.playback.cancelled = false;
  replayState.playback.timers = [];
  document.body.classList.add('replay-playing');
  setReplayControlsDisabled(true);

  const replay = replayState.playback.replay;
  let videoUrl = replayState.playback.videoUrl;
  if (replay.videoId && !videoUrl) {
    videoUrl = await loadReplayVideoUrl(replay);
    replayState.playback.videoUrl = videoUrl;
  }

  await playReplayRound(replay, videoUrl, { roundIndex: 0, roundTotal: 1 });

  if (!replayState.playback?.cancelled) {
    document.body.classList.remove('replay-playing');
    hideReplayTheater();
    restoreLiveBattleState();
    setReplayControlsDisabled(false);
    if (typeof showToast === 'function') showToast('回放結束');
  }
}

async function playReplayMatch() {
  const playback = replayState.playback;
  if (!playback?.rounds?.length || document.body.classList.contains('replay-playing')) return;

  saveLiveBattleState();
  playback.cancelled = false;
  playback.timers = [];
  document.body.classList.add('replay-playing');
  setReplayControlsDisabled(true);

  const rounds = playback.rounds;
  for (let i = 0; i < rounds.length; i++) {
    if (playback.cancelled) break;
    const round = rounds[i];
    const videoUrl = await loadReplayVideoUrl(round);
    await playReplayRound(round, videoUrl, { roundIndex: i, roundTotal: rounds.length });
    if (playback.cancelled) break;
    if (i < rounds.length - 1) await waitMs(900);
  }

  if (!playback.cancelled) {
    document.body.classList.remove('replay-playing');
    hideReplayTheater();
    restoreLiveBattleState();
    setReplayControlsDisabled(false);
    if (typeof showToast === 'function') showToast(`整場 ${rounds.length} 局回放結束`);
  }
}

async function clearAllReplays() {
  if (!replayState.replays.length) return;
  if (!confirm('清除全部戰鬥回放？影片也會一併刪除。')) return;
  stopReplayPlayback();
  discardReplaySession();
  resetMatchGroup();
  const ids = replayState.replays.filter((r) => r.videoId).map((r) => r.videoId);
  replayState.replays = [];
  saveReplayList();
  renderReplayList();
  await Promise.all(ids.map((id) => deleteReplayVideo(id).catch(() => {})));
}

function initReplay() {
  loadReplayList();
  renderReplayList();

  $('#replay-list')?.addEventListener('click', (e) => {
    const playMatchBtn = e.target.closest('.btn-replay-match-play');
    if (playMatchBtn?.dataset.groupId) {
      e.preventDefault();
      openMatchReplay(playMatchBtn.dataset.groupId);
      return;
    }

    const round = e.target.closest('.replay-round-item');
    if (round?.dataset.id) {
      openReplayPlayer(round.dataset.id).catch(console.error);
    }
  });

  $('#replay-round-tabs')?.addEventListener('click', (e) => {
    const tab = e.target.closest('.replay-round-tab');
    if (tab?.dataset.id) openReplayPlayer(tab.dataset.id).catch(console.error);
  });

  $('.app-nav')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.app-nav-btn');
    if (!btn?.dataset.view || btn.dataset.view === 'replay') return;
    if (document.body.classList.contains('replay-playing')) {
      stopReplayPlayback({ keepPanel: true });
    }
  });

  $('#btn-replay-play')?.addEventListener('click', () => { playReplayScores().catch(console.error); });
  $('#btn-replay-play-all')?.addEventListener('click', () => { playReplayMatch().catch(console.error); });
  $('#btn-replay-stop')?.addEventListener('click', () => stopReplayPlayback({ keepPanel: true }));
  $('#btn-replay-close')?.addEventListener('click', stopReplayPlayback);
  $('#btn-replay-theater-stop')?.addEventListener('click', () => stopReplayPlayback({ keepPanel: true }));
  $('#btn-clear-replays')?.addEventListener('click', clearAllReplays);
}

function onReplayBattleStart() {
  recordReplayLaunch();
}

function onReplayFinish(player, finishType, points, scores) {
  recordReplayFinish(player, finishType, points, scores);
}

function onReplayBattleEnd(scores, battleNum) {
  const session = replayState.session;
  if (!session || session.battleNum !== battleNum) return;
  replayState.session = null;
  return queueReplayFinalize(() => finalizeReplaySession(session, scores, { battleNum }));
}

function onReplayMatchEnd(winnerIdx, scores, battles) {
  const session = replayState.session;
  if (!session) return;
  replayState.session = null;
  return queueReplayFinalize(() => finalizeReplaySession(session, scores, {
    battleNum: battles,
    matchEnd: true,
    winner: winnerIdx + 1,
    battles,
  }));
}

function onReplayDiscard() {
  discardReplaySession();
}

function onReplayNewMatch() {
  resetMatchGroup();
}
