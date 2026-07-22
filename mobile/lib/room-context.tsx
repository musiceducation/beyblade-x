import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getRoom, patchRoom } from './rooms-api';
import { clearRoomSession, loadRoomSession, saveRoomSession } from './session';
import { PublicRoom, RoomSession, SessionData } from './types';

const SESSION = 'junior' as const;

type Ctx = {
  ready: boolean;
  session: RoomSession | null;
  room: PublicRoom | null;
  sessionData: SessionData | null;
  isReferee: boolean;
  error: string;
  enter: (s: RoomSession) => Promise<void>;
  leave: () => Promise<void>;
  refresh: () => Promise<void>;
  action: (action: string, payload?: Record<string, unknown>) => Promise<void>;
  updatePlayer: (playerId: string, playerName: string) => Promise<void>;
};

const RoomContext = createContext<Ctx | null>(null);

export function RoomProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<RoomSession | null>(null);
  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    loadRoomSession()
      .then((s) => {
        setSession(s);
        setReady(true);
      })
      .catch(() => {
        setReady(true);
      });
  }, []);

  const refresh = useCallback(async () => {
    if (!session?.code) return;
    try {
      const next = await getRoom(session.code);
      setRoom(next);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '讀取房間失敗');
    }
  }, [session?.code]);

  useEffect(() => {
    if (!session?.code) {
      setRoom(null);
      return;
    }
    refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [session?.code, refresh]);

  const enter = useCallback(async (s: RoomSession) => {
    await saveRoomSession(s);
    setSession(s);
  }, []);

  const leave = useCallback(async () => {
    await clearRoomSession();
    setSession(null);
    setRoom(null);
  }, []);

  const action = useCallback(async (act: string, payload: Record<string, unknown> = {}) => {
    if (!session?.code) throw new Error('未入房');
    const data = await patchRoom(
      session.code,
      { action: act, session: SESSION, ...payload },
      session.refereeToken,
    );
    setRoom(data.room);
  }, [session]);

  const updatePlayer = useCallback(async (playerId: string, playerName: string) => {
    if (!session) return;
    const next = { ...session, playerId, playerName };
    await saveRoomSession(next);
    setSession(next);
  }, [session]);

  const value = useMemo<Ctx>(() => ({
    ready,
    session,
    room,
    sessionData: room?.[SESSION] || null,
    isReferee: Boolean(session?.refereeToken),
    error,
    enter,
    leave,
    refresh,
    action,
    updatePlayer,
  }), [
    ready, session, room, error, enter, leave, refresh, action, updatePlayer,
  ]);

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}

export function useRoom() {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error('useRoom outside provider');
  return ctx;
}
