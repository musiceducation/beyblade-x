'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PHASE_LABELS, SessionData } from '@/lib/constants';
import { getAllMatches, playerName, sortMatches } from '@/lib/tournament';

type RoomReplay = {
  id: string;
  match_id: string | null;
  battle_num: number | null;
  metadata: Record<string, unknown>;
  has_video: boolean;
  videoUrl: string | null;
};

type RoomPublic = {
  code: string;
  revision: number;
  junior: SessionData;
  senior: SessionData;
  live?: {
    updatedAt?: number;
    session?: string;
    phase?: string;
    p1Name?: string;
    p2Name?: string;
    scores?: [number, number];
    battle?: number;
    matchOver?: boolean;
    matchLabel?: string | null;
    active?: boolean;
  } | null;
};

type Props = {
  code: string;
  sessionParam?: string;
};

export default function LiveBroadcast({ code }: Props) {
  const [room, setRoom] = useState<RoomPublic | null>(null);
  const [replays, setReplays] = useState<RoomReplay[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [roomRes, replayRes] = await Promise.all([
      fetch(`/api/rooms/${encodeURIComponent(code)}`, { cache: 'no-store' }),
      fetch(`/api/rooms/${encodeURIComponent(code)}/replays`, { cache: 'no-store' }),
    ]);
    const roomData = await roomRes.json();
    if (!roomRes.ok) throw new Error(roomData.error || '讀取失敗');
    setRoom(roomData.room);
    if (replayRes.ok) {
      const replayData = await replayRes.json();
      setReplays((replayData.replays || []) as RoomReplay[]);
    }
  }, [code]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        await load();
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
  }, [load]);

  const sessionData = room?.junior || null;
  const live = room?.live;
  const liveFresh = Boolean(
    live?.active
    && live.session === 'junior'
    && live.updatedAt
    && Date.now() - live.updatedAt < 60000
    && !live.matchOver,
  );

  const active = useMemo(() => {
    const m = getAllMatches(sessionData).find((x) => x.id === sessionData?.activeMatchId);
    return m?.p1Id && m?.p2Id ? m : null;
  }, [sessionData]);

  const activeMatchId = sessionData?.activeMatchId || null;
  const cameraReplay = useMemo(() => {
    const withVideo = replays.filter((r) => r.has_video && r.videoUrl);
    if (!withVideo.length) return null;
    if (activeMatchId) {
      const matchReplay = withVideo.find((r) => r.match_id === activeMatchId);
      if (matchReplay) return matchReplay;
    }
    return withVideo[0];
  }, [activeMatchId, replays]);

  const upcoming = useMemo(() =>
    sortMatches(
      getAllMatches(sessionData).filter((m) => m.status === 'pending' && m.p1Id && m.p2Id),
    ).slice(0, 3),
  [sessionData]);

  const p1Name = liveFresh ? (live?.p1Name || 'Blader 1') : playerName(sessionData, active?.p1Id);
  const p2Name = liveFresh ? (live?.p2Name || 'Blader 2') : playerName(sessionData, active?.p2Id);
  const scores = liveFresh
    ? (live?.scores || [0, 0])
    : (active?.liveScores || active?.scores || [0, 0]);
  const label = liveFresh
    ? (live?.matchLabel || PHASE_LABELS[live?.phase || ''] || '對戰')
    : (active?.label || (active ? PHASE_LABELS[active.phase] : '') || '');
  const battle = liveFresh
    ? live?.battle
    : (active?.liveBattles || active?.battles);
  const hasLive = liveFresh || Boolean(active);

  return (
    <div className="broadcast-shell">
      <div className="broadcast-card broadcast-card--wide">
        <header className="broadcast-header">
          <span className="broadcast-brand">BEYBATTLE</span>
          <span className="broadcast-room">{code}</span>
          {label && <span className="broadcast-phase">{label}</span>}
        </header>

        {error && <p className="broadcast-error">{error}</p>}

        {cameraReplay?.videoUrl ? (
          <section className="broadcast-camera" aria-label="對戰鏡頭">
            <video
              key={cameraReplay.id}
              className="broadcast-camera-video"
              src={cameraReplay.videoUrl}
              controls
              playsInline
              autoPlay
              muted
            />
            <p className="broadcast-camera-caption">
              {String(cameraReplay.metadata?.matchLabel || '對戰')}
              {cameraReplay.battle_num ? ` · 第 ${cameraReplay.battle_num} 局` : ''}
            </p>
          </section>
        ) : (
          <p className="broadcast-empty">等待對戰鏡頭…</p>
        )}

        {hasLive ? (
          <section className="broadcast-live">
            <p className="broadcast-label">即時比分</p>
            <div className="broadcast-scores">
              <div className="broadcast-player broadcast-player--red">
                <span>{p1Name}</span>
                <strong>{scores[0]}</strong>
              </div>
              <span className="broadcast-vs">VS</span>
              <div className="broadcast-player broadcast-player--blue">
                <span>{p2Name}</span>
                <strong>{scores[1]}</strong>
              </div>
            </div>
            <p className="broadcast-battle">
              {battle ? `第 ${battle} 局` : '比賽進行中'}
            </p>
          </section>
        ) : null}

        {upcoming.length > 0 && (
          <section className="broadcast-next">
            <p className="broadcast-label">即將開始</p>
            <ul>
              {upcoming.map((m) => (
                <li key={m.id}>
                  <span className="broadcast-next-label">{m.label || PHASE_LABELS[m.phase]}</span>
                  <span>
                    {playerName(sessionData, m.p1Id)} vs {playerName(sessionData, m.p2Id)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
