/**
 * Host-side browser screen share → multi-viewer WebRTC (LAN).
 * Captures display with getDisplayMedia and fans out to each joined viewer.
 */

const screenShareHost = {
  active: false,
  room: null,
  viewUrl: null,
  stream: null,
  peers: new Map(), // viewerId -> RTCPeerConnection
  pollTimer: null,
};

const SCREEN_SHARE_ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

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

function updateScreenShareUi() {
  const status = document.querySelector('#screen-share-status');
  const startBtn = document.querySelector('#btn-screen-share-start');
  const stopBtn = document.querySelector('#btn-screen-share-stop');
  const copyBtn = document.querySelector('#btn-screen-share-copy');
  const linkEl = document.querySelector('#screen-share-link');
  const countEl = document.querySelector('#screen-share-viewers');

  if (startBtn) startBtn.hidden = screenShareHost.active;
  if (stopBtn) stopBtn.hidden = !screenShareHost.active;
  if (copyBtn) copyBtn.hidden = !screenShareHost.active || !screenShareHost.viewUrl;

  if (status) {
    if (!screenShareHost.active) {
      status.textContent = '未分享';
      status.dataset.state = 'idle';
    } else {
      const n = screenShareHost.peers.size;
      status.textContent = `分享中 · 房間 ${screenShareHost.room} · ${n} 位觀眾`;
      status.dataset.state = 'live';
    }
  }
  if (linkEl) {
    linkEl.textContent = screenShareHost.viewUrl || '';
    linkEl.hidden = !screenShareHost.viewUrl;
  }
  if (countEl) countEl.textContent = String(screenShareHost.peers.size);
}

async function closeScreenSharePeer(viewerId) {
  const pc = screenShareHost.peers.get(viewerId);
  if (pc) {
    try { pc.close(); } catch { /* ignore */ }
    screenShareHost.peers.delete(viewerId);
  }
}

async function connectScreenShareViewer(viewerId) {
  if (!screenShareHost.stream || screenShareHost.peers.has(viewerId)) return;

  const pc = new RTCPeerConnection(SCREEN_SHARE_ICE);
  screenShareHost.peers.set(viewerId, pc);

  screenShareHost.stream.getTracks().forEach((track) => {
    pc.addTrack(track, screenShareHost.stream);
  });

  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    if (state === 'failed' || state === 'closed' || state === 'disconnected') {
      closeScreenSharePeer(viewerId);
      updateScreenShareUi();
    }
  };

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc);
    const local = pc.localDescription;
    await fetch(`/screen-share/signal/${encodeURIComponent(viewerId)}/offer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: local.type, sdp: local.sdp }),
    });

    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && screenShareHost.active) {
      const res = await fetch(`/screen-share/signal/${encodeURIComponent(viewerId)}/answer`, { cache: 'no-store' });
      const answer = await res.json().catch(() => ({}));
      if (answer?.type === 'answer' && answer.sdp) {
        await pc.setRemoteDescription(answer);
        updateScreenShareUi();
        return;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  } catch (err) {
    console.warn('Screen share viewer connect failed', viewerId, err);
    await closeScreenSharePeer(viewerId);
  }
  updateScreenShareUi();
}

async function pollScreenShareViewers() {
  if (!screenShareHost.active) return;
  try {
    const res = await fetch('/screen-share/status.json', { cache: 'no-store' });
    const data = await res.json();
    if (!data.active) {
      await stopScreenShareHost({ silent: true });
      return;
    }
    const viewers = data.viewers || [];
    for (const v of viewers) {
      if (!v.hasOffer && !screenShareHost.peers.has(v.id)) {
        connectScreenShareViewer(v.id);
      }
    }
    updateScreenShareUi();
  } catch (err) {
    console.warn('Screen share poll failed', err);
  }
}

async function startScreenShareHost() {
  if (!window.isSecureContext) {
    alert('畫面分享需要 HTTPS。請用 https://本機IP:8443 開啟主機頁。');
    return;
  }
  if (!navigator.mediaDevices?.getDisplayMedia) {
    alert('此瀏覽器不支援畫面分享（請用 Chrome / Edge / Safari 最新版）');
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: 30, max: 30 },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        displaySurface: 'browser',
      },
      audio: true,
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
      surfaceSwitching: 'include',
      systemAudio: 'include',
    });
  } catch (err) {
    if (err?.name !== 'NotAllowedError') console.warn(err);
    return;
  }

  const startRes = await fetch('/screen-share/start', { method: 'POST' });
  const startData = await startRes.json().catch(() => ({}));
  if (!startRes.ok || !startData.ok) {
    stream.getTracks().forEach((t) => t.stop());
    alert(startData.error || '無法開始畫面分享');
    return;
  }

  screenShareHost.active = true;
  screenShareHost.room = startData.room;
  screenShareHost.viewUrl = startData.viewUrl;
  screenShareHost.stream = stream;

  stream.getVideoTracks()[0]?.addEventListener('ended', () => {
    stopScreenShareHost();
  });

  clearInterval(screenShareHost.pollTimer);
  screenShareHost.pollTimer = setInterval(pollScreenShareViewers, 1000);
  pollScreenShareViewers();
  updateScreenShareUi();

  if (typeof addLog === 'function') {
    addLog(`🖥️ 畫面分享已開始 · 房間 ${screenShareHost.room}`, 'system');
  }
}

async function stopScreenShareHost(options = {}) {
  const { silent = false } = options;
  clearInterval(screenShareHost.pollTimer);
  screenShareHost.pollTimer = null;

  for (const id of [...screenShareHost.peers.keys()]) {
    await closeScreenSharePeer(id);
  }

  if (screenShareHost.stream) {
    screenShareHost.stream.getTracks().forEach((t) => t.stop());
    screenShareHost.stream = null;
  }

  try {
    await fetch('/screen-share/stop', { method: 'POST' });
  } catch { /* ignore */ }

  screenShareHost.active = false;
  screenShareHost.room = null;
  screenShareHost.viewUrl = null;
  updateScreenShareUi();

  if (!silent && typeof addLog === 'function') {
    addLog('🖥️ 畫面分享已停止', 'system');
  }
}

async function copyScreenShareLink() {
  const url = screenShareHost.viewUrl;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    if (typeof addLog === 'function') addLog('已複製畫面分享連結', 'system');
  } catch {
    window.prompt('複製連結：', url);
  }
}

function initScreenShareHost() {
  document.querySelector('#btn-screen-share-start')?.addEventListener('click', () => {
    startScreenShareHost();
  });
  document.querySelector('#btn-screen-share-stop')?.addEventListener('click', () => {
    stopScreenShareHost();
  });
  document.querySelector('#btn-screen-share-copy')?.addEventListener('click', () => {
    copyScreenShareLink();
  });
  updateScreenShareUi();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initScreenShareHost);
} else {
  initScreenShareHost();
}
