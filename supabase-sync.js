/**
 * Push tournament + replay data from the arena host to Supabase (cloud).
 * Requires window.ARENA_CONFIG in arena-config.local.js
 */

const supabaseSyncState = {
  lastTournamentRevision: -1,
  tournamentPushing: false,
};

function getArenaConfig() {
  return typeof window !== 'undefined' ? window.ARENA_CONFIG : null;
}

function isSupabaseSyncEnabled() {
  const c = getArenaConfig();
  return Boolean(c?.supabase?.url && c?.supabase?.serviceKey && c?.eventSlug);
}

function supabaseHeaders() {
  const key = getArenaConfig().supabase.serviceKey;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

function supabaseBase() {
  return getArenaConfig().supabase.url.replace(/\/$/, '');
}

function replayStoragePath(replayId) {
  return `${getArenaConfig().eventSlug}/${replayId}.webm`;
}

function replayPublicVideoUrl(replayId) {
  if (!isSupabaseSyncEnabled()) return null;
  const base = supabaseBase();
  const slug = getArenaConfig().eventSlug;
  return `${base}/storage/v1/object/public/replay-videos/${slug}/${replayId}.webm`;
}

async function pushTournamentToSupabase(revision, junior, senior) {
  if (!isSupabaseSyncEnabled() || supabaseSyncState.tournamentPushing) return false;
  if (typeof revision !== 'number' || revision <= supabaseSyncState.lastTournamentRevision) {
    return false;
  }

  supabaseSyncState.tournamentPushing = true;
  try {
    const body = {
      event_slug: getArenaConfig().eventSlug,
      revision,
      updated_at: new Date().toISOString(),
      junior: junior || {},
      senior: senior || {},
    };

    const res = await fetch(`${supabaseBase()}/rest/v1/arena_state`, {
      method: 'POST',
      headers: {
        ...supabaseHeaders(),
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`arena_state ${res.status} ${text}`);
    }

    supabaseSyncState.lastTournamentRevision = revision;
    if (typeof updateCloudSyncIndicator === 'function') updateCloudSyncIndicator('synced');
    return true;
  } catch (err) {
    console.warn('Supabase tournament push failed', err);
    if (typeof updateCloudSyncIndicator === 'function') updateCloudSyncIndicator('error');
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
  const eventSlug = getArenaConfig().eventSlug;

  try {
    const metaRow = {
      id: session.id,
      event_slug: eventSlug,
      match_group_id: session.matchGroupId || session.id,
      battle_num: session.battleNum || 1,
      metadata: session,
      has_video: Boolean(blob && session.videoId),
      updated_at: new Date().toISOString(),
    };

    const metaRes = await fetch(`${supabaseBase()}/rest/v1/arena_replays`, {
      method: 'POST',
      headers: {
        ...supabaseHeaders(),
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify(metaRow),
    });

    if (!metaRes.ok) {
      const text = await metaRes.text().catch(() => '');
      throw new Error(`arena_replays ${metaRes.status} ${text}`);
    }

    if (blob && session.videoId && blob.size > 1024) {
      const path = replayStoragePath(session.id);
      const videoRes = await fetch(
        `${supabaseBase()}/storage/v1/object/replay-videos/${path}`,
        {
          method: 'POST',
          headers: {
            apikey: getArenaConfig().supabase.serviceKey,
            Authorization: `Bearer ${getArenaConfig().supabase.serviceKey}`,
            'Content-Type': 'video/webm',
            'x-upsert': 'true',
          },
          body: blob,
        },
      );

      if (!videoRes.ok) {
        const text = await videoRes.text().catch(() => '');
        throw new Error(`storage ${videoRes.status} ${text}`);
      }

      await fetch(`${supabaseBase()}/rest/v1/arena_replays?id=eq.${encodeURIComponent(session.id)}`, {
        method: 'PATCH',
        headers: supabaseHeaders(),
        body: JSON.stringify({ has_video: true, updated_at: new Date().toISOString() }),
      });
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
    console.warn('Supabase replay upload failed', err);
    return false;
  }
}

function getPlayerPortalUrl() {
  const c = getArenaConfig();
  if (c?.playerPortalUrl) return c.playerPortalUrl.replace(/\/$/, '');
  return null;
}

function updateCloudSyncIndicator(status) {
  const el = $('#cloud-sync-status');
  if (!el) return;
  if (!isSupabaseSyncEnabled()) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const labels = {
    synced: '雲端已同步',
    syncing: '雲端同步中…',
    error: '雲端失敗',
    idle: '雲端待命',
  };
  el.textContent = labels[status] || labels.idle;
  el.dataset.status = status;
}

function initSupabaseSync() {
  if (isSupabaseSyncEnabled()) {
    updateCloudSyncIndicator('idle');
  }
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
    payload.revision = Math.max(rev, supabaseSyncState.lastTournamentRevision + 1, Date.now());
    pushTournamentPayloadToSupabase(payload).catch(console.error);
  }, 600);
}
