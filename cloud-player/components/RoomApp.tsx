'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SessionData } from '@/lib/constants';
import { getAllMatches, playerName } from '@/lib/tournament';
import LiveTab from '@/components/LiveTab';
import ScheduleTab from '@/components/ScheduleTab';
import ResultsTab from '@/components/ResultsTab';
import RefereePanel from '@/components/RefereePanel';
import BattleScoreboard from '@/components/BattleScoreboard';
import RoomReplayTab from '@/components/RoomReplayTab';
import RoomLiveCamera from '@/components/RoomLiveCamera';

type RoomPublic = {
  code: string;
  revision: number;
  updated_at: string;
  junior: SessionData;
  senior: SessionData;
  live?: Record<string, unknown> | null;
};

type Props = {
  code: string;
  refereeToken: string | null;
  playerId: string | null;
  playerName: string;
  onLeave: () => void;
  onPlayerUpdated: (playerId: string, name: string) => void;
  initialTab?: Tab;
};

type Tab = 'live' | 'schedule' | 'results' | 'replay' | 'camera' | 'referee' | 'battle';

const MAC_ARENA_KEY = 'bex-mac-arena-url';
const SESSION: 'junior' = 'junior';

export default function RoomApp({
  code,
  refereeToken,
  playerName: initialName,
  onLeave,
  initialTab,
}: Props) {
  const [room, setRoom] = useState<RoomPublic | null>(null);
  const [tab, setTab] = useState<Tab>(
    initialTab || (refereeToken ? 'battle' : 'live'),
  );
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [macArenaUrl, setMacArenaUrl] = useState('');

  const isReferee = Boolean(refereeToken);

  useEffect(() => {
    try {
      setMacArenaUrl(localStorage.getItem(MAC_ARENA_KEY) || 'https://localhost:8443/');
    } catch {
      setMacArenaUrl('https://localhost:8443/');
    }
  }, []);

  const loadRoom = useCallback(async () => {
    const res = await fetch(`/api/rooms/${encodeURIComponent(code)}`, { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '讀取房間失敗');
    setRoom(data.room);
    return data.room as RoomPublic;
  }, [code]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        await loadRoom();
        if (!cancelled) setError('');
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '連線失敗');
      }
    };
    tick();
    const id = window.setInterval(tick, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [loadRoom]);

  const sessionData = room?.[SESSION] || null;

  const patch = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/rooms/${encodeURIComponent(code)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(refereeToken ? { 'x-referee-token': refereeToken } : {}),
      },
      body: JSON.stringify({ session: SESSION, ...body }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '操作失敗');
    setRoom(data.room);
    return data;
  }, [code, refereeToken]);

  const pendingCount = useMemo(() => {
    return getAllMatches(sessionData).filter((m) => m.status === 'pending' && m.p1Id && m.p2Id).length;
  }, [sessionData]);

  const macScoreLink = useMemo(() => {
    if (!isReferee || !refereeToken || !macArenaUrl) return null;
    try {
      const u = new URL(macArenaUrl);
      u.searchParams.set('platformRoom', code);
      u.searchParams.set('refereeToken', refereeToken);
      u.searchParams.set('roomsApi', window.location.origin);
      return u.toString();
    } catch {
      return null;
    }
  }, [code, isReferee, macArenaUrl, refereeToken]);

  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: 'battle', label: '對戰計分', show: isReferee },
    { id: 'live', label: '直播', show: true },
    { id: 'schedule', label: '賽程', show: true },
    { id: 'results', label: '成績', show: true },
    { id: 'replay', label: '回放', show: true },
    { id: 'camera', label: '鏡頭', show: isReferee },
    { id: 'referee', label: '裁判', show: isReferee },
  ];

  return (
    <div className="portal-shell room-shell">
      <header className="room-header">
        <div className="room-header-top">
          <div>
            <p className="room-code-label">BEYBATTLE · 房號</p>
            <h1 className="room-code">{code}</h1>
          </div>
          <div className="room-header-actions">
            <a
              className="room-live-link"
              href={`/live/${encodeURIComponent(code)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              直播畫面
            </a>
            <button type="button" className="player-refresh" onClick={onLeave} title="離開房間">
              ✕
            </button>
          </div>
        </div>
        <div className="room-meta-row">
          {isReferee ? <span className="room-badge room-badge--ref">裁判模式</span> : (
            <span className="room-badge">{initialName || '玩家'}</span>
          )}
          <span className="room-badge room-badge--session">BEYBATTLE</span>
          {room && (
            <span className="room-rev">rev {room.revision}</span>
          )}
        </div>

        <div className="player-toolbar room-rename-row">
          <input
            type="search"
            className="player-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜尋選手…"
            aria-label="搜尋選手"
          />
          <button
            type="button"
            className="lobby-submit room-rename-btn"
            onClick={() => setSearch((s) => s.trim())}
          >
            尋找
          </button>
        </div>

        {isReferee && (
          <div className="mac-arena-row">
            <label>
              本機計分台網址
              <input
                className="player-search"
                value={macArenaUrl}
                onChange={(e) => {
                  setMacArenaUrl(e.target.value);
                  try {
                    localStorage.setItem(MAC_ARENA_KEY, e.target.value);
                  } catch {
                    /* ignore */
                  }
                }}
                placeholder="https://localhost:8443/"
              />
            </label>
            {macScoreLink && (
              <a className="room-live-link" href={macScoreLink} target="_blank" rel="noopener noreferrer">
                開啟本機計分台
              </a>
            )}
          </div>
        )}
      </header>

      <nav className="player-tabs room-tabs" aria-label="房間分頁">
        {tabs.filter((t) => t.show).map((t) => (
          <button
            key={t.id}
            type="button"
            className={`player-tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <span className="player-tab-label">{t.label}</span>
            {t.id === 'schedule' && pendingCount > 0 && (
              <span className="player-tab-badge">{pendingCount}</span>
            )}
          </button>
        ))}
      </nav>

      <main className="player-main">
        {error && <p className="lobby-error">{error}</p>}
        {!room && !error && <p className="portal-empty">載入房間中…</p>}

        {room && tab === 'battle' && isReferee && (
          <BattleScoreboard
            sessionData={sessionData}
            onAction={async (action, payload) => {
              await patch({ action, ...payload });
            }}
            playerLabel={(id) => playerName(sessionData, id)}
          />
        )}
        {room && tab === 'live' && (
          <LiveTab
            sessionData={sessionData}
            search={search}
            liveOverlay={room.live as never}
            sessionKey={SESSION}
          />
        )}
        {room && tab === 'schedule' && (
          <ScheduleTab
            sessionData={sessionData}
            sessionLabel="BEYBATTLE"
            search={search}
          />
        )}
        {room && tab === 'results' && (
          <ResultsTab
            sessionData={sessionData}
            sessionLabel="BEYBATTLE"
            search={search}
          />
        )}
        {room && tab === 'replay' && (
          <RoomReplayTab code={code} search={search} />
        )}
        {room && tab === 'camera' && isReferee && refereeToken && (
          <RoomLiveCamera code={code} refereeToken={refereeToken} />
        )}
        {room && tab === 'referee' && isReferee && (
          <RefereePanel
            sessionData={sessionData}
            onAction={async (action, payload) => {
              await patch({ action, ...payload });
            }}
            playerLabel={(id) => playerName(sessionData, id)}
            onOpenBattle={() => setTab('battle')}
          />
        )}
      </main>
    </div>
  );
}
