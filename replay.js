/**
 * Battle replay — grouped by Match, multi-round, fullscreen theater
 */

const REPLAY_LIST_KEY = 'bex-battle-replays-v2';
const REPLAY_DB_NAME = 'bex-replay-videos';
const REPLAY_DB_VERSION = 1;
const MAX_REPLAYS = 60;
const REPLAY_FINISH_FALLBACK_GAP_MS = 2200;
const REPLAY_FINISH_MIN_GAP_MS = 2400;
const REPLAY_ANNOUNCE_MS = 1800;
const REPLAY_SPEED_KEY = 'bex-replay-speed';
const REPLAY_ZOOM_KEY = 'bex-replay-zoom';
const REPLAY_SPEED_OPTIONS = [0.25, 0.5, 0.75, 1];
const REPLAY_ZOOM_OPTIONS = [1, 1.5, 2];
const DEFAULT_REPLAY_SPEED = 0.5;

function getReplayPlaybackRate() {
  const v = parseFloat(localStorage.getItem(REPLAY_SPEED_KEY) || String(DEFAULT_REPLAY_SPEED));
  return REPLAY_SPEED_OPTIONS.includes(v) ? v : DEFAULT_REPLAY_SPEED;
}

function setReplayPlaybackRate(rate) {
  const n = parseFloat(rate);
  if (!REPLAY_SPEED_OPTIONS.includes(n)) return;
  localStorage.setItem(REPLAY_SPEED_KEY, String(n));
  syncReplaySpeedSelects(n);
  applyReplayPlaybackRate($('#replay-video'));
  applyReplayPlaybackRate($('#replay-theater-video'));
}

function syncReplaySpeedSelects(rate) {
  ['#replay-speed-select', '#replay-theater-speed', '#replay-sidebar-speed'].forEach((sel) => {
    const el = $(sel);
    if (el) el.value = String(rate);
  });
}

function formatVideoClock(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function replayScaleMs(ms) {
  const rate = getReplayPlaybackRate();
  return rate > 0 ? ms / rate : ms;
}

function applyReplayPlaybackRate(video) {
  if (!video) return;
  const rate = getReplayPlaybackRate();
  video.defaultPlaybackRate = rate;
  video.playbackRate = rate;
}

function getReplayZoom() {
  const v = parseFloat(localStorage.getItem(REPLAY_ZOOM_KEY) || '1');
  return REPLAY_ZOOM_OPTIONS.includes(v) ? v : 1;
}

function replayZoomLabel(zoom) {
  if (zoom <= 1) return '🔍 1×';
  if (zoom === 1.5) return '🔍 1.5×';
  return '🔍 2×';
}

function applyReplayZoom(video, viewport) {
  const zoom = getReplayZoom();
  if (viewport) viewport.dataset.zoom = String(zoom);
  if (video) {
    video.style.transform = zoom === 1 ? '' : `scale(${zoom})`;
    video.style.transformOrigin = 'center center';
  }
}

function setReplayZoom(zoom) {
  const n = parseFloat(zoom);
  if (!REPLAY_ZOOM_OPTIONS.includes(n)) return;
  localStorage.setItem(REPLAY_ZOOM_KEY, String(n));
  syncReplayZoomButtons(n);
  applyReplayZoom($('#replay-video'), $('#replay-sidebar-viewport'));
  applyReplayZoom($('#replay-theater-video'), $('#replay-theater-viewport'));
}

function cycleReplayZoom() {
  const cur = getReplayZoom();
  const idx = REPLAY_ZOOM_OPTIONS.indexOf(cur);
  setReplayZoom(REPLAY_ZOOM_OPTIONS[(idx + 1) % REPLAY_ZOOM_OPTIONS.length]);
}

function syncReplayZoomButtons(zoom) {
  const label = replayZoomLabel(zoom);
  ['#btn-replay-sidebar-zoom', '#btn-replay-theater-zoom'].forEach((sel) => {
    const btn = $(sel);
    if (btn) {
      btn.textContent = label;
      btn.title = zoom === 1 ? '放大影片' : `目前 ${zoom}× · 點擊切換`;
      btn.classList.toggle('is-active', zoom > 1);
    }
  });
}

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
  serverUploadPending: 0,
  recordingPaused: sessionStorage.getItem('bex-replay-paused') === '1',
  debug: false,
  micStream: null,
  sidebarScrubbing: false,
};

function isReplayDebug() {
  return replayState.debug
    || localStorage.getItem('bex-replay-debug') === '1'
    || new URLSearchParams(location.search).has('replayDebug');
}

function replayDebug(...args) {
  if (isReplayDebug()) console.log('[replay]', ...args);
}

function replayNeedsLanUpload(replay) {
  if (!replay) return false;
  if (replay.serverSynced === true) return false;
  if (replay.serverSynced === false) return true;
  return true;
}

function replayNeedsCloudUpload(replay) {
  if (!replay) return false;
  if (typeof isSupabaseSyncEnabled !== 'function' || !isSupabaseSyncEnabled()) return false;
  if (replay.cloudSynced === true) return false;
  if (replay.cloudSynced === false) return true;
  return replay.serverSynced === true || replayHasVideo(replay);
}

function mergeReplayFromServer(local, server) {
  const merged = local ? { ...local, ...server } : { ...server };
  if (local?.serverSynced !== undefined) merged.serverSynced = local.serverSynced;
  else merged.serverSynced = true;
  if (local?.cloudSynced !== undefined) {
    merged.cloudSynced = local.cloudSynced;
  } else if (typeof isSupabaseSyncEnabled === 'function' && !isSupabaseSyncEnabled()) {
    merged.cloudSynced = true;
  }
  if (local?.serverSyncError) merged.serverSyncError = local.serverSyncError;
  if (local?.cloudSyncError) merged.cloudSyncError = local.cloudSyncError;
  if ((local?.events?.length || 0) > (server.events?.length || 0)) merged.events = local.events;
  return merged;
}

function updateReplaySyncStatus() {
  const el = $('#replay-sync-status');
  if (!el) return;
  el.hidden = false;
  const pendingLan = replayState.replays.filter((r) => replayNeedsLanUpload(r)).length;
  const pendingCloud = replayState.replays.filter((r) => replayNeedsCloudUpload(r)).length;
  const uploading = replayState.serverUploadPending;
  const retryBtn = $('#btn-replay-retry-upload');
  const hasPending = pendingLan > 0 || pendingCloud > 0;
  if (retryBtn) retryBtn.hidden = !hasPending && uploading === 0;
  if (uploading > 0) {
    el.textContent = `上傳中 ${uploading}`;
    el.dataset.status = 'syncing';
  } else if (pendingLan > 0 || pendingCloud > 0) {
    const parts = [];
    if (pendingLan) parts.push(`LAN ${pendingLan}`);
    if (pendingCloud) parts.push(`雲 ${pendingCloud}`);
    el.textContent = `待上傳 ${parts.join(' · ')}`;
    el.dataset.status = 'pending';
  } else if (replayState.replays.length) {
    el.textContent = typeof isSupabaseSyncEnabled === 'function' && isSupabaseSyncEnabled()
      ? '已同步 (LAN+雲)'
      : '已同步';
    el.dataset.status = 'synced';
  } else {
    el.textContent = '';
    el.dataset.status = 'idle';
  }
  if (typeof updateArenaSyncBanner === 'function') updateArenaSyncBanner();
}

async function uploadReplayMetadata(session) {
  const r = await fetch('/replay/upload.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(session),
  });
  if (!r.ok) throw new Error(`metadata ${r.status}`);
  return r.json();
}

async function uploadReplayVideoBlob(replayId, blob) {
  const r = await fetch(`/replay/${replayId}/video`, {
    method: 'POST',
    headers: { 'Content-Type': 'video/webm' },
    body: blob,
  });
  if (!r.ok) throw new Error(`video ${r.status}`);
  return r.json();
}

async function uploadReplayToServer(session, blob, attempt = 0) {
  const maxAttempts = 3;
  replayState.serverUploadPending += 1;
  updateReplaySyncStatus();
  try {
    await uploadReplayMetadata(session);
    if (blob && session.videoId) {
      await uploadReplayVideoBlob(session.id, blob);
    }
    session.serverSynced = true;
    session.serverSyncError = null;
    saveReplayList();
    if (typeof uploadReplayToSupabase === 'function' && isSupabaseSyncEnabled()) {
      await uploadReplayToSupabase(session, blob);
      saveReplayList();
    }
  } catch (err) {
    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
      replayState.serverUploadPending -= 1;
      return uploadReplayToServer(session, blob, attempt + 1);
    }
    session.serverSynced = false;
    session.serverSyncError = String(err.message || err);
    saveReplayList();
    console.warn('Replay server upload failed', err);
  } finally {
    replayState.serverUploadPending = Math.max(0, replayState.serverUploadPending - 1);
    updateReplaySyncStatus();
    renderReplayList();
  }
}

async function retryPendingReplayUploads() {
  const pending = replayState.replays.filter(
    (r) => replayNeedsLanUpload(r) || replayNeedsCloudUpload(r),
  );
  for (const replay of pending) {
    let blob = null;
    if (replay.videoId) {
      try {
        blob = await getReplayVideo(replay.videoId);
      } catch (_) { /* no local video */ }
    }
    if (replayNeedsLanUpload(replay)) {
      uploadReplayToServer(replay, blob).catch(console.error);
    } else if (typeof uploadReplayToSupabase === 'function' && replayNeedsCloudUpload(replay)) {
      uploadReplayToSupabase(replay, blob).then(() => {
        saveReplayList();
        updateReplaySyncStatus();
        renderReplayList();
      }).catch(console.error);
    }
  }
}

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

async function ensureReplayMicStream() {
  if (replayState.micStream?.active) return replayState.micStream;
  if (!navigator.mediaDevices?.getUserMedia) return null;
  try {
    replayState.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    replayDebug('mic ready', replayState.micStream.getAudioTracks()[0]?.label);
  } catch (err) {
    console.warn('Replay mic unavailable', err);
    return null;
  }
  return replayState.micStream;
}

function releaseReplayMicStream() {
  replayState.micStream?.getTracks().forEach((t) => t.stop());
  replayState.micStream = null;
}

function buildRecordingStream(videoStream) {
  const tracks = [...videoStream.getVideoTracks()];
  const audioTracks = videoStream.getAudioTracks();
  if (audioTracks.length) {
    tracks.push(...audioTracks);
  } else if (replayState.micStream?.active) {
    tracks.push(...replayState.micStream.getAudioTracks());
  }
  return new MediaStream(tracks);
}

function recordingHasAudio(stream) {
  return stream.getAudioTracks().some((t) => t.enabled && t.readyState === 'live');
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

function updateReplayPauseUi() {
  const btn = $('#btn-replay-pause-upload');
  if (!btn) return;
  btn.textContent = replayState.recordingPaused ? '▶ 恢復錄製上傳' : '⏸ 暫停錄製上傳';
  btn.classList.toggle('active', replayState.recordingPaused);
  btn.setAttribute('aria-pressed', replayState.recordingPaused ? 'true' : 'false');
}

function setReplayRecordingPaused(paused) {
  replayState.recordingPaused = paused;
  sessionStorage.setItem('bex-replay-paused', paused ? '1' : '0');
  updateReplayPauseUi();
  if (typeof updateArenaSyncBanner === 'function') updateArenaSyncBanner();
}

function startReplayRecording(sessionId) {
  if (replayState.recordingPaused) return;
  if (replayState.recorder && replayState.recordingSessionId === sessionId) return;

  const startNew = async () => {
    replayState.recorderChunks = [];
    const videoStream = getRecordableStream();
    if (!videoStream || typeof MediaRecorder === 'undefined') return;

    await ensureReplayMicStream();
    const stream = buildRecordingStream(videoStream);

    const mimeTypes = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4',
    ];
    const mimeType = mimeTypes.find((t) => MediaRecorder.isTypeSupported(t));
    if (!mimeType) return;

    try {
      const rec = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: typeof getReplayBitrate === 'function' ? getReplayBitrate() : 2500000,
        audioBitsPerSecond: recordingHasAudio(stream) ? 128000 : undefined,
      });
      rec.ondataavailable = (e) => {
        if (e.data?.size) replayState.recorderChunks.push(e.data);
      };
      rec.start(1000);
      replayState.recorder = rec;
      replayState.recordingSessionId = sessionId;
      replayDebug('recording', {
        mimeType,
        audio: recordingHasAudio(stream),
      });
      updateArgueReplayButton();
    } catch (err) {
      console.warn('Replay recording unavailable', err);
    }
  };

  if (replayState.recorder) {
    stopReplayRecording(true).then(startNew).catch(startNew);
    return;
  }
  startNew().catch(console.error);
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
  updateArgueReplayButton();
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
  updateArgueReplayButton();
}

function onReplayUndoFinish(player, finishType, points) {
  const session = replayState.session;
  if (!session) return;
  for (let i = session.events.length - 1; i >= 0; i--) {
    const e = session.events[i];
    if (e.type === 'finish' && e.player === player && e.finishType === finishType && e.points === points) {
      session.events.splice(i, 1);
      break;
    }
  }
}

function replayPublicLink(replay) {
  const portal = typeof getPlayerPortalUrl === 'function' ? getPlayerPortalUrl() : null;
  if (portal) return `${portal}?replay=${encodeURIComponent(replay.id)}`;
  const base = location.origin + location.pathname.replace(/[^/]*$/, '');
  return `${base}player.html?replay=${encodeURIComponent(replay.id)}`;
}

async function shareReplayLink(replay) {
  const url = replayPublicLink(replay);
  if (await copyTextToClipboard(url)) {
    if (typeof showToast === 'function') showToast('回放連結已複製');
    return;
  }
  prompt('複製回放連結：', url);
}

async function postReplayDelete(id) {
  try {
    await fetch(`/replay/${encodeURIComponent(id)}/delete.json`, { method: 'POST' });
  } catch (err) {
    console.warn('Server replay delete failed', err);
  }

  if (typeof isSupabaseSyncEnabled === 'function' && isSupabaseSyncEnabled()) {
    try {
      await fetch(`/cloud/replay/${encodeURIComponent(id)}/delete.json`, { method: 'POST' });
    } catch (err) {
      console.warn('Cloud replay delete failed', err);
    }
  }
}

async function deleteReplayById(id) {
  if (!id) return;
  if (!confirm('刪除此局回放？')) return;

  if (replayState.playback?.replay?.id === id) stopReplayPlayback();

  const idx = replayState.replays.findIndex((r) => r.id === id);
  if (idx >= 0) {
    const replay = replayState.replays[idx];
    if (replay.videoId) await deleteReplayVideo(replay.videoId).catch(() => {});
    replayState.replays.splice(idx, 1);
    saveReplayList();
    renderReplayList();
  }

  await postReplayDelete(id);
}

async function syncReplayListFromServer() {
  try {
    const res = await fetch('/replay/index.json?since=-1', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    if (!Array.isArray(data.replays)) return;

    const localById = new Map(replayState.replays.map((r) => [r.id, r]));
    const merged = new Map();
    data.replays.forEach((serverReplay) => {
      merged.set(serverReplay.id, mergeReplayFromServer(localById.get(serverReplay.id), serverReplay));
    });
    replayState.replays.forEach((localReplay) => {
      if (!merged.has(localReplay.id)) merged.set(localReplay.id, localReplay);
    });

    replayState.replays = [...merged.values()].sort(
      (a, b) => (b.createdAt || b.endedAt || '').localeCompare(a.createdAt || a.endedAt || ''),
    );
    saveReplayList();
    renderReplayList();
  } catch (err) {
    console.warn('Replay list sync failed', err);
  }
}

async function downloadReplayMatch(groupId) {
  const rounds = replayState.replays
    .filter((r) => (r.matchGroupId || r.id) === groupId)
    .sort((a, b) => a.battleNum - b.battleNum);
  for (const r of rounds) {
    if (!replayHasVideo(r)) continue;
    const url = await loadReplayVideoUrl(r);
    if (url) await downloadReplayVideo(r, url);
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  if (typeof showToast === 'function') showToast(`已下載 ${rounds.filter(replayHasVideo).length} 段影片`);
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
  updateArgueReplayButton();
  if (session.serverSynced !== true) {
    session.serverSynced = false;
    session.cloudSynced = false;
    uploadReplayToServer(session, blob).catch(console.error);
  }
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

function buildFinishSchedule(replay, videoDurationSec = 0) {
  const base = replayTimelineBase(replay);
  const finishes = replay.events.filter((e) => e.type === 'finish');
  if (!finishes.length) return [];

  const hasTimestamps = base > 0 && finishes.every((e) => e.ts);

  if (!hasTimestamps) {
    if (videoDurationSec > 0) {
      const spanMs = Math.max(2800, videoDurationSec * 1000 * 0.9);
      const leadMs = Math.min(800, spanMs * 0.08);
      const tailMs = Math.min(1200, spanMs * 0.1);
      const usable = Math.max(1200, spanMs - leadMs - tailMs);
      const step = finishes.length > 1 ? usable / (finishes.length - 1) : 0;
      return finishes.map((event, i) => {
        const delay = leadMs + step * i;
        return { event, delay, videoSeek: delay / 1000 };
      });
    }
    let delay = 500;
    return finishes.map((event) => {
      const entry = { event, delay, videoSeek: null };
      delay += REPLAY_FINISH_FALLBACK_GAP_MS;
      return entry;
    });
  }

  let lastDelay = 350;
  return finishes.map((event) => {
    const idealDelay = Math.max(350, event.ts - base);
    const delay = lastDelay > 350
      ? Math.max(idealDelay, lastDelay + REPLAY_FINISH_MIN_GAP_MS)
      : idealDelay;
    lastDelay = delay;
    return {
      event,
      delay,
      videoSeek: Math.max(0, (event.ts - base) / 1000),
    };
  });
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
  const syncEl = $('#replay-sync-status');
  if (!badge) return;
  const count = replayState.replays.length;
  if (!count) {
    badge.hidden = true;
    badge.textContent = '';
    if (syncEl) syncEl.hidden = true;
    return;
  }
  badge.hidden = false;
  badge.textContent = `${count} 局`;
  if (syncEl) syncEl.hidden = false;
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
      const thumb = replayHasVideo(r)
        ? `<video class="replay-item-thumb" preload="metadata" muted playsinline src="${replayServerVideoUrl(r)}#t=0.3"></video>`
        : '';
      return `
        <li class="replay-round-item${active}" data-id="${r.id}">
          ${thumb}
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
          <button type="button" class="btn btn-sm btn-ghost btn-replay-delete" data-id="${r.id}" title="刪除此局">✕</button>
        </li>`;
    }).join('');

    return `
      <li class="replay-match-group" data-group-id="${groupId}">
        <div class="replay-match-header">
          <span class="replay-match-title">${escapeReplayText(summary.p1Name)} vs ${escapeReplayText(summary.p2Name)}</span>
          <div class="replay-match-actions">
            <button type="button" class="btn btn-sm btn-ghost btn-replay-match-play" data-group-id="${groupId}">▶ 整場回放</button>
            <button type="button" class="btn btn-sm btn-ghost btn-replay-match-download" data-group-id="${groupId}">⬇ 整場</button>
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

async function flushLiveRecordingBlob() {
  const rec = replayState.recorder;
  const mime = rec?.mimeType || 'video/webm';
  if (rec?.state === 'recording') {
    await new Promise((resolve) => {
      const onData = (e) => {
        if (e.data?.size) replayState.recorderChunks.push(e.data);
        rec.removeEventListener('dataavailable', onData);
        resolve();
      };
      rec.addEventListener('dataavailable', onData, { once: true });
      try {
        rec.requestData();
      } catch {
        resolve();
      }
      window.setTimeout(resolve, 450);
    });
  }
  if (!replayState.recorderChunks.length) return null;
  return new Blob(replayState.recorderChunks, { type: mime });
}

function getCurrentMatchReplays() {
  const ctx = getReplayContext();
  const key = replayContextKey(ctx);
  const gid = replayState.activeMatchGroupId || replayState.session?.matchGroupId;
  if (!gid) return [];
  return replayState.replays
    .filter((r) => {
      if ((r.matchGroupId || r.id) !== gid) return false;
      if (!r.contextKey) return true;
      return r.contextKey === key;
    })
    .sort((a, b) => b.battleNum - a.battleNum || (b.createdAt || '').localeCompare(a.createdAt || ''));
}

function hasArgueReplaySource() {
  if (replayState.recorderChunks.length > 0) return true;
  const session = replayState.session;
  if (session?.events?.some((e) => e.type === 'launch' || e.type === 'finish')) return true;
  return getCurrentMatchReplays().some((r) =>
    (r.events || []).some((e) => e.type === 'finish'));
}

function updateArgueReplayButton() {
  const buttons = [$('#btn-argue-replay'), $('#btn-live-replay')];
  const available = hasArgueReplaySource();
  const playing = document.body.classList.contains('replay-playing');
  buttons.forEach((btn) => {
    if (!btn) return;
    btn.disabled = false;
    btn.classList.toggle('is-idle', !available || playing);
    btn.title = available
      ? '爭議時立即重播本局（含現場收音）'
      : '需先 Go Shoot 或已有得分紀錄';
  });
}

async function finishArguePlayback(tempVideoUrl) {
  document.body.classList.remove('replay-playing');
  hideReplayTheater();
  restoreLiveBattleState();
  setReplayControlsDisabled(false);
  if (replayState.playback?.videoUrl === tempVideoUrl) {
    replayState.playback = null;
  }
  if (tempVideoUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(tempVideoUrl);
  }
  updateArgueReplayButton();
}

async function playArgueReplay() {
  if (document.body.classList.contains('replay-playing')) return;
  if (!hasArgueReplaySource()) {
    if (typeof showToast === 'function') showToast('需先按 Go Shoot 開始錄製，或本局已有得分');
    return;
  }

  const session = replayState.session;
  const hasLiveSession = session?.events?.some((e) => e.type === 'launch' || e.type === 'finish');

  if (hasLiveSession) {
    const blob = await flushLiveRecordingBlob();
    const replay = {
      ...session,
      p1Name: session.p1Name || nameEls[0]?.value?.trim() || 'Blader 1',
      p2Name: session.p2Name || nameEls[1]?.value?.trim() || 'Blader 2',
      finalScores: sessionFinalScores(session),
      startScores: session.startScores
        || session.events.find((e) => e.type === 'battleStart')?.scores
        || [0, 0],
    };

    let videoUrl = null;
    if (blob?.size > 1024) videoUrl = trackVideoUrl(URL.createObjectURL(blob));

    saveLiveBattleState();
    replayState.playback = { replay, rounds: [replay], videoUrl, timers: [], cancelled: false };
    document.body.classList.add('replay-playing');
    setReplayControlsDisabled(true);
    updateArgueReplayButton();

    if (typeof showToast === 'function') {
      showToast(videoUrl ? '爭議回放（含收音）' : '爭議回放（得分紀錄）');
    }

    await playReplayRound(replay, videoUrl, { roundIndex: 0, roundTotal: 1 });

    if (!replayState.playback?.cancelled) {
      await finishArguePlayback(videoUrl);
    }
    return;
  }

  const saved = getCurrentMatchReplays().find((r) =>
    (r.events || []).some((e) => e.type === 'finish'));
  if (!saved) {
    if (typeof showToast === 'function') showToast('尚無可重播的內容');
    return;
  }

  const videoUrl = await loadReplayVideoUrl(saved);
  saveLiveBattleState();
  replayState.playback = { replay: saved, rounds: [saved], videoUrl, timers: [], cancelled: false };
  document.body.classList.add('replay-playing');
  setReplayControlsDisabled(true);
  updateArgueReplayButton();

  await playReplayRound(saved, videoUrl, { roundIndex: 0, roundTotal: 1 });

  if (!replayState.playback?.cancelled) {
    await finishArguePlayback(videoUrl?.startsWith('blob:') ? videoUrl : null);
  }
}

function pulseReplayHudScore(player) {
  const scoreEl = player === 1 ? $('#replay-hud-s1') : $('#replay-hud-s2');
  if (!scoreEl) return;
  scoreEl.classList.remove('replay-hud-pop');
  void scoreEl.offsetWidth;
  scoreEl.classList.add('replay-hud-pop');
  setTimeout(() => scoreEl.classList.remove('replay-hud-pop'), 420);
}

function playReplayFinishFeedback(event, replay) {
  pulseReplayHudScore(event.player);
  const playerName = event.player === 1 ? replay.p1Name : replay.p2Name;
  if (typeof showFinishAnnounce === 'function') {
    showFinishAnnounce(event.finishType, event.player, event.points, playerName);
  }
  if (typeof triggerFinishEffect === 'function') {
    triggerFinishEffect(event.finishType, event.player);
  }
}

function hideReplayTheater() {
  const theater = $('#replay-theater');
  const tv = $('#replay-theater-video');
  finishTheaterRound();
  hideTheaterControls();
  if (typeof hideFinishAnnounce === 'function') hideFinishAnnounce();
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  theater?.classList.remove('shake', 'shake-heavy', 'shake-go-shoot');
  if (tv) {
    detachTheaterVideoSync(tv);
    detachTheaterVideoGuard(tv);
    tv.pause();
    tv.removeAttribute('src');
    tv.classList.add('no-video');
    tv.defaultPlaybackRate = 1;
    tv.playbackRate = 1;
  }
  theater?.classList.remove('replay-theater--no-video');
  theater?.setAttribute('hidden', '');
  theater?.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('replay-theater-active');
}

function showTheaterControls(tv) {
  const controls = $('#replay-theater-controls');
  if (!controls || !tv) return;
  const refreshDuration = () => {
    const duration = Number.isFinite(tv.duration) ? tv.duration : 0;
    const scrubber = $('#replay-theater-scrubber');
    if (scrubber && duration > 0) scrubber.max = String(duration);
    updateTheaterScrubber(tv.currentTime || 0, duration);
  };
  refreshDuration();
  if (!tv.dataset.replayDurationBound) {
    tv.dataset.replayDurationBound = '1';
    tv.addEventListener('loadedmetadata', refreshDuration);
    tv.addEventListener('durationchange', refreshDuration);
  }
  syncReplaySpeedSelects(getReplayPlaybackRate());
  syncReplayZoomButtons(getReplayZoom());
  applyReplayZoom(tv, $('#replay-theater-viewport'));
  updateTheaterPlayButton(tv);
  controls.removeAttribute('hidden');
}

function showSidebarVideoControls(show) {
  const controls = $('#replay-sidebar-controls');
  if (!controls) return;
  if (show) controls.removeAttribute('hidden');
  else controls.setAttribute('hidden', '');
}

function updateSidebarScrubber(currentSec, durationSec) {
  const scrubber = $('#replay-sidebar-scrubber');
  if (scrubber && !replayState.sidebarScrubbing) {
    scrubber.value = String(Math.max(0, currentSec));
    if (Number.isFinite(durationSec) && durationSec > 0) {
      scrubber.max = String(durationSec);
    }
  }
  const cur = $('#replay-sidebar-time-current');
  const tot = $('#replay-sidebar-time-total');
  if (cur) cur.textContent = formatVideoClock(currentSec);
  if (tot) tot.textContent = formatVideoClock(durationSec);
}

function updateSidebarPlayButton(video) {
  const btn = $('#btn-replay-sidebar-play');
  if (!btn) return;
  const paused = video ? video.paused : true;
  btn.textContent = paused ? '▶' : '⏸';
  btn.setAttribute('aria-label', paused ? '播放' : '暫停');
}

function refreshSidebarVideoUi(video) {
  if (!video?.src) return;
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  updateSidebarScrubber(video.currentTime || 0, duration);
  updateSidebarPlayButton(video);
  applyReplayPlaybackRate(video);
  applyReplayZoom(video, $('#replay-sidebar-viewport'));
}

function toggleSidebarPlayPause() {
  const video = $('#replay-video');
  if (!video?.src) return;
  if (video.paused) video.play().catch(() => {});
  else video.pause();
}

function initSidebarVideoControls() {
  const video = $('#replay-video');
  if (!video || video.dataset.replaySidebarBound === '1') return;
  video.dataset.replaySidebarBound = '1';

  const onMeta = () => refreshSidebarVideoUi(video);
  video.addEventListener('loadedmetadata', onMeta);
  video.addEventListener('durationchange', onMeta);
  video.addEventListener('timeupdate', () => {
    if (replayState.sidebarScrubbing) return;
    updateSidebarScrubber(video.currentTime, video.duration);
  });
  video.addEventListener('play', () => updateSidebarPlayButton(video));
  video.addEventListener('pause', () => updateSidebarPlayButton(video));
  video.addEventListener('ended', () => updateSidebarPlayButton(video));

  $('#btn-replay-sidebar-play')?.addEventListener('click', () => toggleSidebarPlayPause());
  $('#replay-sidebar-speed')?.addEventListener('change', (e) => {
    setReplayPlaybackRate(parseFloat(e.target.value, 10));
  });
  $('#btn-replay-sidebar-zoom')?.addEventListener('click', () => cycleReplayZoom());

  const scrubber = $('#replay-sidebar-scrubber');
  scrubber?.addEventListener('pointerdown', () => {
    replayState.sidebarScrubbing = true;
    video.pause();
  });
  scrubber?.addEventListener('input', (e) => {
    const t = parseFloat(e.target.value, 10);
    if (!Number.isFinite(t)) return;
    try { video.currentTime = t; } catch (_) { /* seek unsupported */ }
    updateSidebarScrubber(t, video.duration);
  });
  const endScrub = () => {
    replayState.sidebarScrubbing = false;
    updateSidebarPlayButton(video);
  };
  scrubber?.addEventListener('pointerup', endScrub);
  scrubber?.addEventListener('change', endScrub);
}

function hideTheaterControls() {
  $('#replay-theater-controls')?.setAttribute('hidden', '');
}

function updateTheaterScrubber(currentSec, durationSec) {
  const scrubber = $('#replay-theater-scrubber');
  if (scrubber && !replayState.playback?.theater?.scrubbing) {
    scrubber.value = String(Math.max(0, currentSec));
    if (Number.isFinite(durationSec) && durationSec > 0) {
      scrubber.max = String(durationSec);
    }
  }
  const cur = $('#replay-theater-time-current');
  const tot = $('#replay-theater-time-total');
  if (cur) cur.textContent = formatVideoClock(currentSec);
  if (tot) tot.textContent = formatVideoClock(durationSec);
}

function updateTheaterPlayButton(tv) {
  const btn = $('#btn-replay-theater-play');
  if (!btn) return;
  const paused = tv ? tv.paused : true;
  btn.textContent = paused ? '▶' : '⏸';
  btn.setAttribute('aria-label', paused ? '播放' : '暫停');
}

function scoresAtTheaterTime(schedule, timeSec, startScores) {
  let scores = [...startScores];
  schedule.forEach((entry) => {
    if (entry.videoSeek != null && entry.videoSeek <= timeSec + 0.05 && entry.event.scores) {
      scores = [entry.event.scores[0], entry.event.scores[1]];
    }
  });
  return scores;
}

function syncTheaterFiredFromTime(theater, timeSec) {
  theater.schedule.forEach((entry, i) => {
    if (entry.videoSeek == null) return;
    if (entry.videoSeek <= timeSec + 0.08) theater.fired.add(i);
    else theater.fired.delete(i);
  });
}

function seekTheaterTo(timeSec) {
  const theater = replayState.playback?.theater;
  if (!theater?.tv) return;
  const tv = theater.tv;
  const duration = Number.isFinite(tv.duration) ? tv.duration : 0;
  const safe = Math.min(Math.max(0, timeSec), Math.max(0, duration - 0.05));
  try {
    tv.currentTime = safe;
  } catch (_) { /* seek unsupported */ }
  updateTheaterScrubber(safe, duration);
  syncTheaterFiredFromTime(theater, safe);
  updateReplayHud(theater.replay, scoresAtTheaterTime(theater.schedule, safe, theater.startScores), theater.roundLabel);
}

function onTheaterTimeUpdate() {
  const theater = replayState.playback?.theater;
  if (!theater?.tv || theater.scrubbing) return;
  const tv = theater.tv;
  const t = tv.currentTime;
  updateTheaterScrubber(t, tv.duration);
  theater.schedule.forEach((entry, i) => {
    if (theater.fired.has(i)) return;
    if (entry.videoSeek == null || t < entry.videoSeek - 0.08) return;
    theater.fired.add(i);
    updateReplayHud(theater.replay, entry.event.scores, theater.roundLabel);
    playReplayFinishFeedback(entry.event, theater.replay);
  });
}

function attachTheaterVideoSync(tv) {
  detachTheaterVideoSync(tv);
  const onTime = () => onTheaterTimeUpdate();
  const onPlay = () => updateTheaterPlayButton(tv);
  const onPause = () => updateTheaterPlayButton(tv);
  tv._theaterOnTime = onTime;
  tv._theaterOnPlay = onPlay;
  tv._theaterOnPause = onPause;
  tv.addEventListener('timeupdate', onTime);
  tv.addEventListener('play', onPlay);
  tv.addEventListener('pause', onPause);
}

function detachTheaterVideoSync(tv) {
  if (!tv) return;
  if (tv._theaterOnTime) tv.removeEventListener('timeupdate', tv._theaterOnTime);
  if (tv._theaterOnPlay) tv.removeEventListener('play', tv._theaterOnPlay);
  if (tv._theaterOnPause) tv.removeEventListener('pause', tv._theaterOnPause);
  delete tv._theaterOnTime;
  delete tv._theaterOnPlay;
  delete tv._theaterOnPause;
}

function finishTheaterRound() {
  const resolve = replayState.playback?.theaterResolve;
  if (resolve) {
    replayState.playback.theaterResolve = null;
    resolve();
  }
}

function toggleTheaterPlayPause() {
  const theater = replayState.playback?.theater;
  if (!theater?.tv) return;
  if (theater.tv.paused) {
    theater.userPaused = false;
    theater.tv.play().catch(() => {});
  } else {
    theater.userPaused = true;
    theater.tv.pause();
  }
}

function waitForTheaterVideoEnd(tv) {
  return new Promise((resolve) => {
    if (!replayState.playback || replayState.playback.cancelled) {
      resolve();
      return;
    }
    replayState.playback.theaterResolve = resolve;
    const onEnd = () => finishTheaterRound();
    tv.addEventListener('ended', onEnd, { once: true });
    const dur = Number.isFinite(tv.duration) ? tv.duration : 0;
    const rate = getReplayPlaybackRate();
    const maxMs = dur > 0 ? (dur / rate) * 1000 + 3000 : 120000;
    const fallbackId = setTimeout(onEnd, maxMs);
    replayState.playback.timers.push(fallbackId);
  });
}

async function playReplayRoundWithVideo(replay, videoUrl, options, startScores, roundLabel, tv, videoDuration) {
  const schedule = buildFinishSchedule(replay, videoDuration);
  replayDebug('round-video', {
    id: replay.id,
    battleNum: replay.battleNum,
    videoDuration,
    finishes: schedule.length,
  });

  replayState.playback.theater = {
    replay,
    roundLabel,
    schedule,
    tv,
    startScores,
    fired: new Set(),
    userPaused: false,
    scrubbing: false,
  };

  showTheaterControls(tv);
  attachTheaterVideoSync(tv);
  await waitForTheaterVideoEnd(tv);
  detachTheaterVideoSync(tv);
  replayState.playback.theater = null;

  if (!replayState.playback?.cancelled) {
    await waitMs(800);
  }
}

async function playReplayRoundWithoutVideo(replay, roundLabel, schedule) {
  let lastDelay = 350;
  schedule.forEach((entry) => {
    lastDelay = Math.max(lastDelay, entry.delay);
    scheduleReplayStep(() => {
      if (!replayState.playback || replayState.playback.cancelled) return;
      updateReplayHud(replay, entry.event.scores, roundLabel);
      playReplayFinishFeedback(entry.event, replay);
    }, entry.delay);
  });

  const tailMs = 800;
  const endDelay = Math.max(
    lastDelay + tailMs,
    schedule.length ? schedule[schedule.length - 1].delay + tailMs : 600,
  );
  await waitMs(endDelay);
}

function theaterVideoSrcMatches(tv, videoUrl) {
  if (!tv || !videoUrl) return false;
  try {
    const current = tv.currentSrc || tv.src || '';
    return current === videoUrl || current.endsWith(videoUrl);
  } catch {
    return false;
  }
}

function waitForTheaterVideoReady(tv) {
  if (!tv?.src) return Promise.resolve(0);
  if (tv.readyState >= 3 && Number.isFinite(tv.duration)) return Promise.resolve(tv.duration);

  return new Promise((resolve) => {
    const done = () => resolve(Number.isFinite(tv.duration) ? tv.duration : 0);
    tv.addEventListener('canplay', done, { once: true });
    tv.addEventListener('loadedmetadata', () => {
      if (tv.readyState >= 2) done();
    }, { once: true });
    setTimeout(done, 4000);
  });
}

async function prepareTheaterVideo(tv, videoUrl) {
  if (!tv || !videoUrl) return 0;
  if (!theaterVideoSrcMatches(tv, videoUrl)) {
    tv.src = videoUrl;
  }
  tv.classList.remove('no-video');
  attachTheaterVideoGuard(tv);
  const duration = await waitForTheaterVideoReady(tv);
  try {
    tv.currentTime = 0;
  } catch (_) { /* seek unsupported */ }
  applyReplayPlaybackRate(tv);
  applyReplayZoom(tv, $('#replay-theater-viewport'));
  try {
    await tv.play();
    tv.muted = false;
    tv.volume = 1;
  } catch (err) {
    replayDebug('autoplay blocked', err);
  }
  replayDebug('video ready', { duration, src: videoUrl });
  return duration;
}

async function syncTheaterVideoTime(tv, targetSec) {
  if (!tv || targetSec == null || !Number.isFinite(tv.duration)) return;
  const safe = Math.min(Math.max(0, targetSec), Math.max(0, tv.duration - 0.05));
  const drift = Math.abs(tv.currentTime - safe);
  if (drift <= 0.4) return;
  replayDebug('seek', { from: tv.currentTime.toFixed(2), to: safe.toFixed(2) });
  try {
    tv.currentTime = safe;
    await tv.play();
  } catch (_) { /* autoplay policy */ }
}

function attachTheaterVideoGuard(tv) {
  if (!tv || tv.dataset.replayGuard === '1') return;
  tv.dataset.replayGuard = '1';
  tv.addEventListener('pause', () => {
    if (!document.body.classList.contains('replay-playing') || replayState.playback?.cancelled) return;
    if (tv.ended) return;
    const theater = replayState.playback?.theater;
    if (theater?.userPaused || theater?.scrubbing) return;
    tv.play().catch(() => {});
  });
}

function detachTheaterVideoGuard(tv) {
  if (!tv) return;
  delete tv.dataset.replayGuard;
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
    if (!theaterVideoSrcMatches(tv, videoUrl)) {
      tv.src = videoUrl;
    }
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
    finishTheaterRound();
    replayState.playback.timers.forEach(clearTimeout);
    replayState.playback = null;
  }
  hideReplayTheater();
  restoreLiveBattleState();
  document.body.classList.remove('replay-playing');
  setReplayControlsDisabled(false);
  updateArgueReplayButton();

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

function replayHasVideo(replay) {
  return !!(replay?.videoId || replay?.hasVideo);
}

function replayServerVideoUrl(replay) {
  return `/replay/${replay.id}/video.webm`;
}

function replayDownloadFilename(replay) {
  const safe = (s) => String(s || '').replace(/[^\w\u4e00-\u9fff-]+/g, '-').replace(/^-|-$/g, '') || 'player';
  return `beyblade-${safe(replay.p1Name)}-vs-${safe(replay.p2Name)}-b${replay.battleNum}.webm`;
}

async function downloadReplayVideo(replay, videoUrl) {
  if (!videoUrl || !replay) return;
  const filename = replayDownloadFilename(replay);
  try {
    let blobUrl = videoUrl;
    if (!videoUrl.startsWith('blob:')) {
      const res = await fetch(`${videoUrl}?download=1`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`download ${res.status}`);
      blobUrl = URL.createObjectURL(await res.blob());
    }
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (blobUrl !== videoUrl) URL.revokeObjectURL(blobUrl);
  } catch (err) {
    console.warn('Replay download failed', err);
    window.open(videoUrl, '_blank', 'noopener');
  }
}

async function loadReplayVideoUrl(replay) {
  if (!replayHasVideo(replay)) return null;
  if (replay.videoId) {
    try {
      const blob = await getReplayVideo(replay.videoId);
      if (blob?.size > 0) return trackVideoUrl(URL.createObjectURL(blob));
    } catch (_) { /* fall through to server */ }
  }
  return replayServerVideoUrl(replay);
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
  const shareBtn = $('#btn-replay-share');
  const matchDlBtn = $('#btn-replay-download-match');
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
    applyReplayPlaybackRate(video);
    video.hidden = false;
    showSidebarVideoControls(true);
    syncReplaySpeedSelects(getReplayPlaybackRate());
    refreshSidebarVideoUi(video);
    downloadBtn.hidden = false;
    downloadBtn.onclick = () => { downloadReplayVideo(replay, videoUrl).catch(console.error); };
    if (shareBtn) {
      shareBtn.hidden = false;
      shareBtn.onclick = () => { shareReplayLink(replay).catch(console.error); };
    }
    if (matchDlBtn) {
      matchDlBtn.hidden = rounds.length <= 1;
      matchDlBtn.onclick = () => {
        downloadReplayMatch(replay.matchGroupId || replay.id).catch(console.error);
      };
    }
  } else if (video) {
    video.hidden = true;
    showSidebarVideoControls(false);
    downloadBtn.hidden = true;
    if (shareBtn) shareBtn.hidden = true;
    if (matchDlBtn) matchDlBtn.hidden = true;
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
  }, replayScaleMs(delay));
  replayState.playback.timers.push(id);
}

function waitMs(ms) {
  return new Promise((resolve) => {
    scheduleReplayStep(resolve, ms);
  });
}

async function playReplayRound(replay, videoUrl, options = {}) {
  const { roundIndex = 0, roundTotal = 1 } = options;

  if (!replayState.playback || replayState.playback.cancelled) return;

  replayState.playback.replay = replay;
  replayState.playback.videoUrl = videoUrl;

  const startEvent = replay.events.find((e) => e.type === 'battleStart');
  const startScores = [...(startEvent?.scores || replay.startScores || [0, 0])];

  const roundLabel = roundTotal > 1
    ? `整場回放 · 第 ${roundIndex + 1}/${roundTotal} 局`
    : (videoUrl ? '回放中…' : '重播得分（無影片）');

  await showReplayTheater(replay, videoUrl);
  if (!replayState.playback || replayState.playback.cancelled) return;

  updateReplayHud(replay, startScores, roundLabel);
  renderReplayEvents(replay);
  renderReplayRoundTabs(replayState.playback.rounds, replay.id);
  renderReplayList();

  const tv = $('#replay-theater-video');
  let videoDuration = 0;
  if (videoUrl && tv) {
    videoDuration = await prepareTheaterVideo(tv, videoUrl);
  }
  if (!replayState.playback || replayState.playback.cancelled) return;

  const schedule = buildFinishSchedule(replay, videoDuration);
  replayDebug('round', {
    id: replay.id,
    battleNum: replay.battleNum,
    videoDuration,
    finishes: schedule.length,
    schedule: schedule.map((e) => ({
      delay: e.delay,
      seek: e.videoSeek,
      type: e.event.finishType,
      player: e.event.player,
    })),
  });

  if (videoUrl && tv) {
    await playReplayRoundWithVideo(replay, videoUrl, options, startScores, roundLabel, tv, videoDuration);
  } else {
    await playReplayRoundWithoutVideo(replay, roundLabel, schedule);
  }
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
  const hasLocal = replayState.replays.length > 0;
  const msg = hasLocal
    ? '清除全部戰鬥回放？本機、伺服器及雲端影片也會一併刪除。'
    : '本機無回放。是否清除伺服器及雲端上的舊回放？';
  if (!confirm(msg)) return;

  stopReplayPlayback();
  discardReplaySession();
  resetMatchGroup();
  releaseReplayMicStream();

  const ids = replayState.replays.filter((r) => r.videoId).map((r) => r.videoId);
  replayState.replays = [];
  saveReplayList();
  renderReplayList();
  await Promise.all(ids.map((id) => deleteReplayVideo(id).catch(() => {})));

  try {
    const res = await fetch('/replay/clear.json', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || `server clear ${res.status}`);
  } catch (err) {
    console.warn('Server replay clear failed', err);
    if (typeof showToast === 'function') showToast('伺服器回放清除失敗');
  }

  try {
    const res = await fetch('/cloud/replay/clear.json', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      if (data.error !== 'cloud not configured') {
        throw new Error(data.error || `cloud clear ${res.status}`);
      }
    } else if (typeof showToast === 'function') {
      showToast(`雲端回放已清除（${data.deletedRows ?? 0} 筆）`);
    }
  } catch (err) {
    console.warn('Cloud replay clear failed', err);
    if (typeof showToast === 'function') showToast('雲端回放清除失敗');
  }

  updateReplaySyncStatus();
}

async function initReplay() {
  if (isReplayDebug()) {
    replayState.debug = true;
    console.info('[replay] debug mode on (?replayDebug=1)');
  }
  loadReplayList();
  renderReplayList();
  await syncReplayListFromServer();
  updateReplaySyncStatus();
  retryPendingReplayUploads();

  $('#replay-list')?.addEventListener('click', (e) => {
    const delBtn = e.target.closest('.btn-replay-delete');
    if (delBtn?.dataset.id) {
      e.preventDefault();
      e.stopPropagation();
      deleteReplayById(delBtn.dataset.id).catch(console.error);
      return;
    }

    const matchDlBtn = e.target.closest('.btn-replay-match-download');
    if (matchDlBtn?.dataset.groupId) {
      e.preventDefault();
      downloadReplayMatch(matchDlBtn.dataset.groupId).catch(console.error);
      return;
    }

    const playMatchBtn = e.target.closest('.btn-replay-match-play');
    if (playMatchBtn?.dataset.groupId) {
      e.preventDefault();
      openMatchReplay(playMatchBtn.dataset.groupId);
      return;
    }

    const roundBtn = e.target.closest('.replay-item-btn');
    const round = e.target.closest('.replay-round-item');
    const replayId = round?.dataset.id;
    if (replayId && (roundBtn || (round && !e.target.closest('.btn-replay-delete')))) {
      openReplayPlayer(replayId).catch(console.error);
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
  $('#btn-replay-theater-play')?.addEventListener('click', () => toggleTheaterPlayPause());
  $('#replay-theater-speed')?.addEventListener('change', (e) => {
    setReplayPlaybackRate(parseFloat(e.target.value, 10));
  });
  $('#btn-replay-theater-zoom')?.addEventListener('click', () => cycleReplayZoom());

  const scrubber = $('#replay-theater-scrubber');
  scrubber?.addEventListener('pointerdown', () => {
    const theater = replayState.playback?.theater;
    if (!theater) return;
    theater.scrubbing = true;
    theater.tv?.pause();
  });
  scrubber?.addEventListener('input', (e) => {
    seekTheaterTo(parseFloat(e.target.value, 10));
  });
  const endScrub = () => {
    const theater = replayState.playback?.theater;
    if (!theater) return;
    theater.scrubbing = false;
    if (!theater.userPaused && !theater.tv?.ended) {
      theater.tv?.play().catch(() => {});
    }
  };
  scrubber?.addEventListener('pointerup', endScrub);
  scrubber?.addEventListener('change', endScrub);

  $('#btn-argue-replay')?.addEventListener('click', () => { playArgueReplay().catch(console.error); });
  $('#btn-live-replay')?.addEventListener('click', () => { playArgueReplay().catch(console.error); });
  $('#btn-clear-replays')?.addEventListener('click', clearAllReplays);
  $('#btn-replay-pause-upload')?.addEventListener('click', () => {
    setReplayRecordingPaused(!replayState.recordingPaused);
  });
  $('#btn-replay-retry-upload')?.addEventListener('click', () => {
    retryPendingReplayUploads().then(() => {
      if (typeof showToast === 'function') showToast('已重試待上傳回放');
      updateReplaySyncStatus();
    }).catch(console.error);
  });
  updateReplayPauseUi();
  updateArgueReplayButton();
  initSidebarVideoControls();

  syncReplaySpeedSelects(getReplayPlaybackRate());
  syncReplayZoomButtons(getReplayZoom());
  $('#replay-speed-select')?.addEventListener('change', (e) => {
    setReplayPlaybackRate(parseFloat(e.target.value, 10));
    if (typeof showToast === 'function') {
      const rate = getReplayPlaybackRate();
      showToast(rate === 1 ? '回放速度：正常' : `回放速度：${rate}× 慢動作`);
    }
  });

  const replayParam = new URLSearchParams(location.search).get('replay');
  if (replayParam) {
    syncReplayListFromServer().then(() => openReplayPlayer(replayParam)).catch(console.error);
  }
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
  releaseReplayMicStream();
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
  releaseReplayMicStream();
  resetMatchGroup();
}
