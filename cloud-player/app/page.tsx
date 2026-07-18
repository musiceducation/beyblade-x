'use client';

import { useCallback, useEffect, useState } from 'react';
import Lobby from '@/components/Lobby';
import RoomApp from '@/components/RoomApp';
import PlayerPortal from '@/components/PlayerPortal';

type RoomSession = {
  code: string;
  refereeToken: string | null;
  playerId: string | null;
  playerName: string;
};

const STORAGE_KEY = 'bex-platform-room-v1';

function loadStored(): RoomSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as RoomSession : null;
  } catch {
    return null;
  }
}

export default function Home() {
  const [legacy, setLegacy] = useState(false);
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<RoomSession | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('legacy') === '1' || params.get('event')) {
      setLegacy(true);
      setReady(true);
      return;
    }
    const roomParam = params.get('room');
    const stored = loadStored();
    if (roomParam && stored?.code === roomParam.toUpperCase()) {
      setSession(stored);
    } else if (roomParam) {
      setSession(null);
    } else if (stored) {
      setSession(stored);
    }
    setReady(true);
  }, []);

  const enter = useCallback((info: RoomSession) => {
    setSession(info);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(info));
    const url = new URL(window.location.href);
    url.searchParams.set('room', info.code);
    url.searchParams.delete('legacy');
    window.history.replaceState({}, '', url);
  }, []);

  const leave = useCallback(() => {
    setSession(null);
    localStorage.removeItem(STORAGE_KEY);
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState({}, '', url);
  }, []);

  if (!ready) {
    return <div className="portal-shell"><p className="portal-empty">載入中…</p></div>;
  }

  if (legacy) return <PlayerPortal />;

  if (!session) return <Lobby onEntered={enter} />;

  return (
    <RoomApp
      code={session.code}
      refereeToken={session.refereeToken}
      playerId={session.playerId}
      playerName={session.playerName}
      onLeave={leave}
      onPlayerUpdated={(playerId, playerName) => {
        const next = { ...session, playerId, playerName };
        setSession(next);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      }}
    />
  );
}
