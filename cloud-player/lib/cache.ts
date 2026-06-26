'use client';

import { ArenaReplayRow, ArenaStateRow } from '@/lib/constants';

const CACHE_PREFIX = 'bex-cloud-cache:';

export type ArenaCachePayload = {
  arenaState: ArenaStateRow | null;
  replays: ArenaReplayRow[];
  savedAt: number;
};

export function loadArenaCache(eventSlug: string): ArenaCachePayload | null {
  if (typeof window === 'undefined' || !eventSlug) return null;
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${eventSlug}`);
    if (!raw) return null;
    const data = JSON.parse(raw) as ArenaCachePayload;
    if (!data || typeof data.savedAt !== 'number') return null;
    return data;
  } catch {
    return null;
  }
}

export function saveArenaCache(
  eventSlug: string,
  arenaState: ArenaStateRow | null,
  replays: ArenaReplayRow[],
) {
  if (typeof window === 'undefined' || !eventSlug) return;
  const payload: ArenaCachePayload = {
    arenaState,
    replays,
    savedAt: Date.now(),
  };
  try {
    localStorage.setItem(`${CACHE_PREFIX}${eventSlug}`, JSON.stringify(payload));
  } catch {
    /* quota exceeded — ignore */
  }
}
