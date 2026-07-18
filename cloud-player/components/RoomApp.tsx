'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SESSION_LABELS, SessionData } from '@/lib/constants';
import { getAllMatches, playerName } from '@/lib/tournament';
import LiveTab from '@/components/LiveTab';
import ScheduleTab from '@/components/ScheduleTab';
import ResultsTab from '@/components/ResultsTab';
import RefereePanel from '@/components/RefereePanel';
import BattleScoreboard from '@/components/BattleScoreboard';

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

type Tab = 'live' | 'schedule' | 'results' | 'referee' | 'battle';

const MAC_ARENA_KEY = 'bex-mac-arena-url';

export default function RoomApp({
  code,
  refereeToken,
  playerId,
  playerName: initialName,
  onLeave,
  onPlayerUpdated,
  initialTab,
}: Props) {
  const [room, setRoom] = useState<RoomPublic | null>(null);
  const [session, setSession] = useState<'junior' | 'senior'>('junior');
  const [tab, setTab] = useState<Tab>(
    initialTab || (refereeToken ? 'battle' : 'live'),
  );
  const [error, setError] = useState('');
  const [nameDraft, setNameDraft] = useState(initialName);
  const [renameBusy, setRenameBusy] = useState(false);
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

  const sessionData = room?.[session] || null;

  const patch = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/rooms/${encodeURIComponent(code)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(refereeToken ? { 'x-referee-token': refereeToken } : {}),
      },
      body: JSON.stringify({ session, ...body }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '操作失敗');
    setRoom(data.room);
    return data;
  }, [code, refereeToken, session]);

  const renameSelf = async () => {
    if (!playerId) return;
    setRenameBusy(true);
    setError('');
    try {
      const data = await patch({
        action: 'player_rename',
        playerId,
        name: nameDraft,
      });
      if (data.player) onPlayerUpdated(data.player.id, data.player.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : '改名失敗');
    } finally {
      setRenameBusy(false);
    }
  };

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
    { id: 'live', label: '即時', show: true },
    { id: 'schedule', label: '賽程', show: true },
    { id: 'results', label: '成績', show: true },
    { id: 'referee', label: '裁判', show: isReferee },
  ];

  return (
    <div className="portal-shell room-shell">
      <header className="room-header">
        <div className="room-header-top">
          <div>
            <p className="room-code-label">房號</p>
            <h1 className="room-code">{code}</h1>
          </div>
          <div className="room-header-actions">
            <a
              className="room-live-link"
              href={`/live/${encodeURIComponent(code)}?session=${session}`}
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
            <span className="room-badge">玩家</span>
          )}
          {room && (
            <span className="room-rev">rev {room.revision}</span>
          )}
        </div>

        <div className="player-toolbar room-rename-row">
          <input
            className="player-search"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            maxLength={16}
            placeholder="你的名字"
            aria-label="改名"
          />
          <button
            type="button"
            className="lobby-submit room-rename-btn"
            disabled={renameBusy || !playerId}
            onClick={renameSelf}
          >
            改名
          </button>
        </div>

        <div className="session-pills" role="tablist" aria-label="場次">
          {(['junior', 'senior'] as const).map((key) => (
            <button
              key={key}
              type="button"
              className={`session-pill${session === key ? ' active' : ''}`}
              onClick={() => setSession(key)}
            >
              {SESSION_LABELS[key]}
            </button>
          ))}
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
            search={nameDraft}
            liveOverlay={room.live as never}
            sessionKey={session}
          />
        )}
        {room && tab === 'schedule' && (
          <ScheduleTab
            sessionData={sessionData}
            sessionLabel={SESSION_LABELS[session]}
            search={nameDraft}
          />
        )}
        {room && tab === 'results' && (
          <ResultsTab
            sessionData={sessionData}
            sessionLabel={SESSION_LABELS[session]}
            search={nameDraft}
          />
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
