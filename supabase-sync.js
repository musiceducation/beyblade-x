/**
 * Push tournament + replay data from the arena host to Supabase via local server proxy.
 * Secret key lives in arena-secrets.local.json (read by serve-https.py only).
 */

const supabaseSyncState = {
  lastTournamentRevision: -1,
  tournamentPushing: false,
  lastError: null,
  cloudServerReady: false,
};

function getArenaConfig() {
  return typeof window !== 'undefined' ? window.ARENA_CONFIG : null;
}

function isSupabaseSyncEnabled() {
  const c = getArenaConfig();
  return Boolean(c?.eventSlug && supabaseSyncState.cloudServerReady);
}

function supabasePublicUrl() {
  const url = getArenaConfig()?.supabase?.url;
  return url ? url.replace(/\/$/, '') : null;
}

function replayPublicVideoUrl(replayId) {
  const base = supabasePublicUrl();
  const slug = getArenaConfig()?.eventSlug;
  if (!base || !slug) return null;
  return `${base}/storage/v1/object/public/replay-videos/${slug}/${replayId}.webm`;
}

async function refreshCloudStatus() {
  try {
    const res = await fetch('/cloud/status.json', { cache: 'no-store' });
    const data = await res.json();
    supabaseSyncState.cloudServerReady = Boolean(data.ok);
    return data;
  } catch {
    supabaseSyncState.cloudServerReady = false;
    return null;
  }
}

async function pushTournamentToSupabase(revision, junior, senior) {
  if (!isSupabaseSyncEnabled() || supabaseSyncState.tournamentPushing) return false;

  const rev = Math.max(revision, supabaseSyncState.lastTournamentRevision + 1);
  if (typeof rev !== 'number' || rev <= supabaseSyncState.lastTournamentRevision) {
    return false;
  }

  supabaseSyncState.tournamentPushing = true;
  try {
    const res = await fetch('/cloud/tournament.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: rev, junior: junior || {}, senior: senior || {} }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `cloud tournament ${res.status}`);
    }

    supabaseSyncState.lastTournamentRevision = rev;
    supabaseSyncState.lastError = null;
    if (typeof updateCloudSyncIndicator === 'function') updateCloudSyncIndicator('synced');
    return true;
  } catch (err) {
    supabaseSyncState.lastError = String(err.message || err);
    console.warn('Cloud tournament push failed', err);
    if (typeof updateCloudSyncIndicator === 'function') updateCloudSyncIndicator('error', supabaseSyncState.lastError);
    return false;
  } finally {
    supabaseSyncState.tournamentPushing = false;
  }
}

async function pushTournamentPayloadToSupabase(payload) {
  if (!payload || typeof payload.revision !== 'number') return false;
  return pushTournamentToSupabase(payload.revision, payload.junior, payload.senior);
}

async function uploadReplayToSupabase(session, blob, attempt = 0) {
  if (!isSupabaseSyncEnabled() || !session?.id) return false;

  const maxAttempts = 3;

  try {
    const metaRes = await fetch('/cloud/replay/meta.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(session),
    });
    const metaData = await metaRes.json().catch(() => ({}));
    if (!metaRes.ok || !metaData.ok) {
      throw new Error(metaData.error || `cloud replay meta ${metaRes.status}`);
    }

    if (blob && session.videoId && blob.size > 1024) {
      const videoRes = await fetch(`/cloud/replay/${encodeURIComponent(session.id)}/video`, {
        method: 'POST',
        headers: { 'Content-Type': 'video/webm' },
        body: blob,
      });
      const videoData = await videoRes.json().catch(() => ({}));
      if (!videoRes.ok || !videoData.ok) {
        throw new Error(videoData.error || `cloud replay video ${videoRes.status}`);
      }
    }

    session.cloudSynced = true;
    session.cloudSyncError = null;
    return true;
  } catch (err) {
    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      return uploadReplayToSupabase(session, blob, attempt + 1);
    }
    session.cloudSynced = false;
    session.cloudSyncError = String(err.message || err);
    console.warn('Cloud replay upload failed', err);
    return false;
  }
}

function getPlayerPortalUrl() {
  const c = getArenaConfig();
  if (c?.playerPortalUrl) return c.playerPortalUrl.replace(/\/$/, '');
  return null;
}

function updateCloudSyncIndicator(status, detail) {
  const el = $('#cloud-sync-status');
  if (!el) return;
  const c = getArenaConfig();
  if (!c?.eventSlug) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const labels = {
    synced: '雲端已同步',
    syncing: '雲端同步中…',
    error: '雲端失敗',
    idle: '雲端待命',
    unconfigured: '雲端未設定',
  };
  el.textContent = labels[status] || labels.idle;
  el.dataset.status = status;
  el.title = detail || (status === 'error' && supabaseSyncState.lastError) || 'Supabase 雲端';
}

function initSupabaseSync() {
  refreshCloudStatus().then((data) => {
    if (isSupabaseSyncEnabled()) {
      updateCloudSyncIndicator('idle');
    } else if (getArenaConfig()?.eventSlug) {
      updateCloudSyncIndicator(
        'unconfigured',
        '請建立 arena-secrets.local.json（含 service key）並重啟 ./start.sh',
      );
    }
  });
}

let cloudPushTimer = null;

function scheduleCloudTournamentPush() {
  if (!isSupabaseSyncEnabled()) return;
  clearTimeout(cloudPushTimer);
  cloudPushTimer = setTimeout(() => {
    if (typeof buildFullSyncPayload !== 'function') return;
    updateCloudSyncIndicator('syncing');
    const payload = buildFullSyncPayload();
    const rev = typeof tournamentSync !== 'undefined' ? tournamentSync.revision : 0;
    payload.revision = Math.max(rev, supabaseSyncState.lastTournamentRevision + 1);
    pushTournamentPayloadToSupabase(payload).catch(console.error);
  }, 300);
}
