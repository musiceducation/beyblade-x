'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArenaReplayRow, ArenaStateRow } from '@/lib/constants';
import { getEventSlug, getSupabase } from '@/lib/supabase';

export type SyncStatus = 'connecting' | 'synced' | 'error' | 'unconfigured';

const LIVE_POLL_MS = 800;
const IDLE_POLL_MS = 4000;
const REPLAY_POLL_MS = 6000;

export function useArenaData(tab: 'live' | 'schedule' | 'replay' | 'results') {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('connecting');
  const [configError, setConfigError] = useState<string | null>(null);
  const [arenaState, setArenaState] = useState<ArenaStateRow | null>(null);
  const [replays, setReplays] = useState<ArenaReplayRow[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const revisionRef = useRef(-1);
  const replayHashRef = useRef('');

  const fetchArenaState = useCallback(async () => {
    const supabase = getSupabase();
    const slug = getEventSlug();
    if (!supabase) {
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
      if (row.revision !== revisionRef.current) {
        revisionRef.current = row.revision;
        setArenaState(row);
      }
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
    if (hash !== replayHashRef.current) {
      replayHashRef.current = hash;
      setReplays(rows);
    }
    return true;
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
      setLastUpdated(new Date());
    } catch {
      setSyncStatus('error');
    }
  }, [fetchArenaState, fetchReplays, tab]);

  useEffect(() => {
    refresh({ forceReplays: tab === 'replay' });
    const ms = tab === 'live' ? LIVE_POLL_MS : tab === 'replay' ? REPLAY_POLL_MS : IDLE_POLL_MS;
    const id = setInterval(() => refresh(), ms);
    return () => clearInterval(id);
  }, [refresh, tab]);

  useEffect(() => {
    const supabase = getSupabase();
    const slug = getEventSlug();
    if (!supabase) return;

    const channel = supabase
      .channel(`arena_state:${slug}`)
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
          if (row.revision !== revisionRef.current) {
            revisionRef.current = row.revision;
            setArenaState(row);
            setLastUpdated(new Date());
            setSyncStatus('synced');
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

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
    refresh,
  };
}
