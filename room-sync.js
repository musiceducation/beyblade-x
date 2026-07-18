/**
 * Sync local Mac arena scoring → cloud-player rooms API.
 * Bind with ?platformRoom=CODE&refereeToken=TOKEN or the room-bind panel.
 */
(function () {
  const STORAGE_KEY = 'bex-platform-room-bind-v1';
  const LIVE_DEBOUNCE_MS = 180;
  const SESSION_DEBOUNCE_MS = 600;

  const roomSync = {
    enabled: false,
    code: '',
    token: '',
    apiBase: '',
    session: 'junior',
    liveTimer: null,
    sessionTimer: null,
    lastError: '',
    pushing: false,
  };

  function getConfigBase() {
    const c = typeof window !== 'undefined' ? window.ARENA_CONFIG : null;
    const raw = (c && (c.roomsApiBase || c.playerPortalUrl)) || '';
    return String(raw || '').replace(/\/$/, '');
  }

  function loadStored() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveStored() {
    const payload = {
      code: roomSync.code,
      token: roomSync.token,
      apiBase: roomSync.apiBase,
      session: roomSync.session,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* ignore */
    }
  }

  function clearStored() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  function setStatus(msg, ok) {
    roomSync.lastError = ok === false ? msg : '';
    const el = document.getElementById('platform-room-status');
    if (el) {
      el.textContent = msg;
      el.dataset.ok = ok === true ? '1' : ok === false ? '0' : '';
    }
    const badge = document.getElementById('platform-room-badge');
    if (badge) {
      badge.hidden = !roomSync.enabled;
      badge.textContent = roomSync.enabled ? `雲端房 ${roomSync.code}` : '';
    }
  }

  function apiUrl(path) {
    const base = roomSync.apiBase || getConfigBase();
    if (!base) throw new Error('未設定 roomsApiBase / playerPortalUrl');
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
  }

  async function roomFetch(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    if (roomSync.token) headers['x-referee-token'] = roomSync.token;
    const res = await fetch(apiUrl(path), { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  async function roomPatch(action, payload = {}) {
    if (!roomSync.enabled || !roomSync.code || !roomSync.token) return null;
    return roomFetch(`/api/rooms/${encodeURIComponent(roomSync.code)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        action,
        session: roomSync.session,
        ...payload,
      }),
    });
  }

  function currentSessionKey() {
    const el = document.getElementById('session-select');
    return el?.value === 'senior' ? 'senior' : 'junior';
  }

  function syncSessionFromUi() {
    roomSync.session = currentSessionKey();
  }

  async function bindRoom({ code, token, apiBase, pull = true, push = false }) {
    const nextCode = String(code || '').trim().toUpperCase();
    const nextToken = String(token || '').trim();
    const nextBase = String(apiBase || getConfigBase() || '').replace(/\/$/, '');
    if (!nextCode || !nextToken) throw new Error('需要房號與裁判 token');
    if (!nextBase) throw new Error('請在 arena-config 設定 roomsApiBase 或 playerPortalUrl');

    roomSync.code = nextCode;
    roomSync.token = nextToken;
    roomSync.apiBase = nextBase;
    syncSessionFromUi();
    roomSync.enabled = true;
    saveStored();

    // Verify token with a light GET (public) then optional pull/push
    await roomFetch(`/api/rooms/${encodeURIComponent(nextCode)}`);

    if (pull && typeof applyRoomSessionToLocal === 'function') {
      await applyRoomSessionToLocal();
    } else if (push && typeof pushLocalSessionToRoom === 'function') {
      await pushLocalSessionToRoom();
    }

    setStatus(`已連接雲端房 ${nextCode}`, true);
    if (typeof showToast === 'function') showToast(`已連接雲端房 ${nextCode}`);
    return true;
  }

  async function authAndBind({ code, password, apiBase, pull = true }) {
    const nextCode = String(code || '').trim().toUpperCase();
    const nextBase = String(apiBase || getConfigBase() || '').replace(/\/$/, '');
    if (!nextBase) throw new Error('請設定 roomsApiBase / playerPortalUrl');
    roomSync.apiBase = nextBase;
    const data = await roomFetch(`/api/rooms/${encodeURIComponent(nextCode)}/auth`, {
      method: 'POST',
      body: JSON.stringify({ refereePassword: password }),
    });
    return bindRoom({
      code: nextCode,
      token: data.refereeToken,
      apiBase: nextBase,
      pull,
    });
  }

  function unbindRoom() {
    roomSync.enabled = false;
    roomSync.code = '';
    roomSync.token = '';
    clearStored();
    setStatus('未連接雲端房', null);
  }

  async function applyRoomSessionToLocal() {
    if (!roomSync.enabled) return;
    const data = await roomFetch(`/api/rooms/${encodeURIComponent(roomSync.code)}`);
    const room = data.room;
    if (!room) return;
    syncSessionFromUi();
    const sessionData = room[roomSync.session];
    if (!sessionData) return;

    if (typeof applySessionData === 'function' && typeof persistSession === 'function') {
      const hadLocal =
        typeof sessionHasData === 'function' &&
        typeof getSessionData === 'function' &&
        sessionHasData(getSessionData());
      const hadRemote =
        sessionData.drawn ||
        (sessionData.players && sessionData.players.length > 0);

      if (hadRemote) {
        applySessionData(sessionData);
        if (typeof advanceWinners === 'function') advanceWinners();
        persistSession({ skipPush: true });
        if (typeof renderTournamentUI === 'function') renderTournamentUI();
      } else if (hadLocal) {
        await pushLocalSessionToRoom();
      }
    }
  }

  async function pushLocalSessionToRoom() {
    if (!roomSync.enabled || typeof buildSessionPayload !== 'function') return;
    syncSessionFromUi();
    await roomPatch('replace_session', { sessionData: buildSessionPayload() });
  }

  function scheduleRoomLiveScores(scores, battles) {
    if (!roomSync.enabled) return;
    const matchId =
      typeof tournamentState !== 'undefined' ? tournamentState.activeMatchId : null;
    if (!matchId) return;
    clearTimeout(roomSync.liveTimer);
    roomSync.liveTimer = setTimeout(() => {
      syncSessionFromUi();
      roomPatch('set_live_scores', {
        matchId,
        scores: [Number(scores[0]) || 0, Number(scores[1]) || 0],
        battles: battles != null ? Number(battles) : undefined,
      }).catch((e) => setStatus(e.message || '推送比分失敗', false));
    }, LIVE_DEBOUNCE_MS);
  }

  function scheduleRoomSessionPush() {
    if (!roomSync.enabled) return;
    clearTimeout(roomSync.sessionTimer);
    roomSync.sessionTimer = setTimeout(() => {
      pushLocalSessionToRoom().catch((e) => setStatus(e.message || '同步賽程失敗', false));
    }, SESSION_DEBOUNCE_MS);
  }

  async function roomSetActive(matchId) {
    if (!roomSync.enabled) return;
    syncSessionFromUi();
    try {
      await roomPatch('set_active', { matchId: matchId || null });
    } catch (e) {
      setStatus(e.message || '設定進行場次失敗', false);
    }
  }

  async function roomRecordWinner(matchId, winnerSide, scores, battles) {
    if (!roomSync.enabled) return;
    syncSessionFromUi();
    try {
      await roomPatch('record_winner', {
        matchId,
        winnerSide,
        scores,
        battles,
        autoAdvance: false,
      });
    } catch (e) {
      setStatus(e.message || '完場同步失敗', false);
    }
  }

  function initRoomSyncFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('platformRoom') || params.get('room');
    const token = params.get('refereeToken') || params.get('token');
    const api = params.get('roomsApi') || params.get('api');
    if (code && token) {
      bindRoom({ code, token, apiBase: api || getConfigBase(), pull: true }).catch((e) => {
        setStatus(e.message || '連接失敗', false);
      });
      return;
    }
    const stored = loadStored();
    if (stored?.code && stored?.token) {
      bindRoom({
        code: stored.code,
        token: stored.token,
        apiBase: stored.apiBase || getConfigBase(),
        pull: true,
      }).catch(() => {
        /* stale token — stay unbound */
        unbindRoom();
      });
    } else {
      setStatus('未連接雲端房', null);
    }
  }

  function wireRoomBindUi() {
    const form = document.getElementById('platform-room-form');
    const panel = document.getElementById('platform-room-panel');
    document.getElementById('btn-platform-room')?.addEventListener('click', () => {
      if (!panel) return;
      panel.open = !panel.open;
      if (panel.open) {
        document.getElementById('platform-room-code')?.focus();
      }
    });
    if (!form) return;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const code = document.getElementById('platform-room-code')?.value;
      const password = document.getElementById('platform-room-password')?.value;
      const apiBase = document.getElementById('platform-room-api')?.value || getConfigBase();
      authAndBind({ code, password, apiBase, pull: true })
        .then(() => {
          const panel = document.getElementById('platform-room-panel');
          if (panel) panel.hidden = true;
        })
        .catch((err) => setStatus(err.message || '連接失敗', false));
    });
    document.getElementById('btn-platform-room-unbind')?.addEventListener('click', () => {
      unbindRoom();
    });
    document.getElementById('btn-platform-room-push')?.addEventListener('click', () => {
      pushLocalSessionToRoom()
        .then(() => {
          setStatus(`已上傳賽程到 ${roomSync.code}`, true);
          if (typeof showToast === 'function') showToast('賽程已上傳到雲端房');
        })
        .catch((e) => setStatus(e.message || '上傳失敗', false));
    });
    document.getElementById('btn-platform-room-pull')?.addEventListener('click', () => {
      applyRoomSessionToLocal()
        .then(() => {
          setStatus(`已從 ${roomSync.code} 下載賽程`, true);
          if (typeof showToast === 'function') showToast('已從雲端房下載賽程');
        })
        .catch((e) => setStatus(e.message || '下載失敗', false));
    });
    const apiInput = document.getElementById('platform-room-api');
    if (apiInput && !apiInput.value) apiInput.value = getConfigBase();
  }

  window.roomSync = roomSync;
  window.bindPlatformRoom = bindRoom;
  window.authAndBindPlatformRoom = authAndBind;
  window.unbindPlatformRoom = unbindRoom;
  window.scheduleRoomLiveScores = scheduleRoomLiveScores;
  window.scheduleRoomSessionPush = scheduleRoomSessionPush;
  window.roomSetActive = roomSetActive;
  window.roomRecordWinner = roomRecordWinner;
  window.pushLocalSessionToRoom = pushLocalSessionToRoom;
  window.applyRoomSessionToLocal = applyRoomSessionToLocal;
  window.initRoomSyncFromQuery = initRoomSyncFromQuery;
  window.wireRoomBindUi = wireRoomBindUi;
})();
