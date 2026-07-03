'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArenaReplayRow, ArenaStateRow } from '@/lib/constants';
import { getEventSlug, getSupabase } from '@/lib/supabase';
import { loadArenaCache, saveArenaCache } from '@/lib/cache';

export type SyncStatus = 'connecting' | 'synced' | 'error' | 'unconfigured' | 'cached';

const LIVE_POLL_MS = 800;
const IDLE_POLL_MS = 4000;
const REPLAY_POLL_MS = 12000;

// #region agent log
function portalDebugLog(hypothesisId: string, location: string, message: string, data: Record<string, unknown> = {}) {
  fetch('http://127.0.0.1:7781/ingest/44c3a4a2-b31c-4d72-b415-659fb6f08241', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'aee127' },
    body: JSON.stringify({
      sessionId: 'aee127',
      runId: 'pre-fix',
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {
    fetch('/debug/agent-log.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'aee127',
        runId: 'pre-fix',
        hypothesisId,
        location,
        message,
        data,
        timestamp: Date.now(),
      }),
    }).catch(() => {});
  });
}
// #endregion

export function useArenaData(tab: 'live' | 'schedule' | 'replay' | 'results') {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('connecting');
  const [configError, setConfigError] = useState<string | null>(null);
  const [arenaState, setArenaState] = useState<ArenaStateRow | null>(null);
  const [replays, setReplays] = useState<ArenaReplayRow[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [usingCache, setUsingCache] = useState(false);
  const revisionRef = useRef(-1);
  const replayHashRef = useRef('');

  const applyCacheFallback = useCallback(() => {
    const slug = getEventSlug();
    const cached = loadArenaCache(slug);
    if (!cached) return false;
    if (cached.arenaState) {
      revisionRef.current = cached.arenaState.revision ?? revisionRef.current;
      setArenaState(cached.arenaState);
    }
    if (cached.replays.length) {
      replayHashRef.current = cached.replays.map((r) => `${r.id}:${r.has_video}`).join('|');
      setReplays(cached.replays);
    }
    setLastUpdated(new Date(cached.savedAt));
    setUsingCache(true);
    setSyncStatus('cached');
    return true;
  }, []);

  const fetchArenaState = useCallback(async () => {
    const supabase = getSupabase();
    const slug = getEventSlug();
    if (!supabase) {
      // #region agent log
      portalDebugLog('H5', 'cloud-player/lib/useArenaData.ts:61', 'portal arena fetch unconfigured', {
        slug,
      });
      // #endregion
      setSyncStatus('unconfigured');
      setConfigError('請設定 NEXT_PUBLIC_SUPABASE_URL 與 ANON_KEY');
      return false;
    }

    const { data, error } = await supabase
      .from('arena_state')
      .select('*')
      .eq('event_slug', slug)
      .maybeSingle();

    if (error) throw error;
    if (data) {
      const row = data as ArenaStateRow;
      // #region agent log
      portalDebugLog('H5,H3', 'cloud-player/lib/useArenaData.ts:81', 'portal arena fetch row', {
        slug,
        revision: row.revision,
        updatedAt: row.updated_at,
        juniorPlayers: row.junior?.players?.length || 0,
        seniorPlayers: row.senior?.players?.length || 0,
        hasLive: Boolean(row.live),
        liveUpdatedAt: row.live?.updatedAt || null,
        liveSession: row.live?.session || null,
      });
      // #endregion
      if (row.revision !== revisionRef.current) {
        revisionRef.current = row.revision;
        setArenaState(row);
      }
    } else {
      // #region agent log
      portalDebugLog('H5', 'cloud-player/lib/useArenaData.ts:99', 'portal arena fetch empty', {
        slug,
      });
      // #endregion
    }
    return true;
  }, []);

  const fetchReplays = useCallback(async () => {
    const supabase = getSupabase();
    const slug = getEventSlug();
    if (!supabase) return false;

    const { data, error } = await supabase
      .from('arena_replays')
      .select('id, event_slug, match_group_id, battle_num, metadata, has_video, created_at')
      .eq('event_slug', slug)
      .order('created_at', { ascending: false })
      .limit(80);

    if (error) throw error;
    const rows = (data as ArenaReplayRow[]) || [];
    const hash = rows.map((r) => `${r.id}:${r.has_video}`).join('|');
    // #region agent log
    portalDebugLog('H4,H5', 'cloud-player/lib/useArenaData.ts:117', 'portal replay fetch rows', {
      slug,
      count: rows.length,
      videoCount: rows.filter((r) => r.has_video).length,
      firstId: rows[0]?.id || null,
      hash,
    });
    // #endregion
    if (hash !== replayHashRef.current) {
      replayHashRef.current = hash;
      setReplays(rows);
    }
    return true;
  }, []);

  const persistCache = useCallback((state: ArenaStateRow | null, replayRows: ArenaReplayRow[]) => {
    const slug = getEventSlug();
    if (slug && (state || replayRows.length)) {
      saveArenaCache(slug, state, replayRows);
    }
  }, []);

  const refresh = useCallback(async (opts?: { forceReplays?: boolean }) => {
    const supabase = getSupabase();
    if (!supabase) {
      setSyncStatus('unconfigured');
      setConfigError('請設定 NEXT_PUBLIC_SUPABASE_URL 與 ANON_KEY');
      return;
    }

    try {
      const needsReplays = opts?.forceReplays || tab === 'replay';
      await Promise.all([
        fetchArenaState(),
        needsReplays ? fetchReplays() : Promise.resolve(true),
      ]);
      setSyncStatus('synced');
      setConfigError(null);
      setUsingCache(false);
      setLastUpdated(new Date());
    } catch (err) {
      // #region agent log
      portalDebugLog('H5', 'cloud-player/lib/useArenaData.ts:151', 'portal refresh failed', {
        tab,
        forceReplays: Boolean(opts?.forceReplays),
        error: String((err as Error)?.message || err),
      });
      // #endregion
      if (applyCacheFallback()) {
        setConfigError(null);
      } else {
        setSyncStatus('error');
      }
    }
  }, [fetchArenaState, fetchReplays, tab, applyCacheFallback]);

  useEffect(() => {
    const slug = getEventSlug();
    const cached = loadArenaCache(slug);
    if (cached?.arenaState) {
      revisionRef.current = cached.arenaState.revision ?? -1;
      setArenaState(cached.arenaState);
      if (cached.replays.length) {
        replayHashRef.current = cached.replays.map((r) => `${r.id}:${r.has_video}`).join('|');
        setReplays(cached.replays);
      }
      setLastUpdated(new Date(cached.savedAt));
    }
    refresh({ forceReplays: tab === 'replay' });
    const ms = tab === 'live' ? LIVE_POLL_MS : tab === 'replay' ? REPLAY_POLL_MS : IDLE_POLL_MS;
    const id = setInterval(() => refresh(), ms);
    return () => clearInterval(id);
  }, [refresh, tab]);

  useEffect(() => {
    if (syncStatus === 'synced' && (arenaState || replays.length)) {
      persistCache(arenaState, replays);
    }
  }, [arenaState, replays, syncStatus, persistCache]);

  useEffect(() => {
    const supabase = getSupabase();
    const slug = getEventSlug();
    if (!supabase) return;

    const channel = supabase
      .channel(`arena:${slug}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'arena_state',
          filter: `event_slug=eq.${slug}`,
        },
        (payload) => {
          const row = payload.new as ArenaStateRow | null;
          if (!row?.event_slug) return;
          // #region agent log
          portalDebugLog('H5,H3', 'cloud-player/lib/useArenaData.ts:202', 'portal arena realtime event', {
            slug,
            revision: row.revision,
            previousRevision: revisionRef.current,
            hasLive: Boolean(row.live),
            liveUpdatedAt: row.live?.updatedAt || null,
            liveSession: row.live?.session || null,
          });
          // #endregion
          if (row.revision !== revisionRef.current) {
            revisionRef.current = row.revision;
            setArenaState(row);
            setLastUpdated(new Date());
            setSyncStatus('synced');
            setUsingCache(false);
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'arena_replays',
          filter: `event_slug=eq.${slug}`,
        },
        () => {
          // #region agent log
          portalDebugLog('H4,H5', 'cloud-player/lib/useArenaData.ts:223', 'portal replay realtime event', {
            slug,
          });
          // #endregion
          fetchReplays()
            .then(() => {
              setLastUpdated(new Date());
              setSyncStatus('synced');
              setUsingCache(false);
            })
            .catch(() => {});
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchReplays]);

  useEffect(() => {
    if (tab !== 'replay') return;
    fetchReplays().catch(() => {});
  }, [tab, fetchReplays]);

  return {
    syncStatus,
    configError,
    arenaState,
    replays,
    lastUpdated,
    usingCache,
    refresh,
  };
}
