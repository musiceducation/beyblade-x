'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PHASE_LABELS, SessionData } from '@/lib/constants';
import {
  exitElementFullscreen,
  getFullscreenElement,
  prefersCssFullscreen,
  requestElementFullscreen,
  subscribeFullscreenChange,
} from '@/lib/fullscreen';
import { getAllMatches, playerName, sortMatches } from '@/lib/tournament';
import BroadcastFx, { BroadcastFxHandle, FINISH_FX } from '@/components/BroadcastFx';
import LiveWebRtcPlayer from '@/components/LiveWebRtcPlayer';

type RoomReplay = {
  id: string;
  match_id: string | null;
  battle_num: number | null;
  metadata: Record<string, unknown>;
  has_video: boolean;
  videoUrl: string | null;
};

type LiveState = {
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
  cameraFrameUrl?: string;
  cameraUpdatedAt?: number;
  webrtcLive?: boolean;
  webrtcMode?: string;
  finishSide?: 1 | 2;
  finishType?: string;
  finishPts?: number;
  finishAt?: number;
  broadcastStatus?: string;
  broadcastMessage?: string;
};

type RoomPublic = {
  code: string;
  revision: number;
  junior: SessionData;
  senior: SessionData;
  live?: LiveState | null;
};

type Props = {
  code: string;
  sessionParam?: string;
};

type FinishCallout = {
  side: 1 | 2;
  label: string;
  pts: number;
  flash: string;
};

const MATCH_TARGET = 4;

export default function LiveBroadcast({ code }: Props) {
  const fxRef = useRef<BroadcastFxHandle>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const cssFullscreenRef = useRef(false);
  const prevScoresRef = useRef<[number, number] | null>(null);
  const prevFinishAtRef = useRef<number | null>(null);
  const prevMatchOverRef = useRef<boolean | null>(null);

  const [room, setRoom] = useState<RoomPublic | null>(null);
  const [replays, setReplays] = useState<RoomReplay[]>([]);
  const [error, setError] = useState('');
  const [flashClass, setFlashClass] = useState('');
  const [scorePopSide, setScorePopSide] = useState<0 | 1 | 2>(0);
  const [finishCallout, setFinishCallout] = useState<FinishCallout | null>(null);
  const [winBanner, setWinBanner] = useState<string | null>(null);
  const [webrtcConnected, setWebrtcConnected] = useState(false);
  const [webrtcStatus, setWebrtcStatus] = useState('等待裁判開播…');
  const [audioMuted, setAudioMuted] = useState(true);
  const [unmuteToken, setUnmuteToken] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const triggerFlash = useCallback((kind: string) => {
    setFlashClass(kind);
    window.setTimeout(() => setFlashClass(''), 520);
  }, []);

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
  const liveDisplay = Boolean(
    live?.session === 'junior'
    && live.updatedAt
    && Date.now() - live.updatedAt < 60000
    && (live.active || live.matchOver),
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

  const p1Name = liveDisplay ? (live?.p1Name || 'Blader 1') : playerName(sessionData, active?.p1Id);
  const p2Name = liveDisplay ? (live?.p2Name || 'Blader 2') : playerName(sessionData, active?.p2Id);
  const scores: [number, number] = liveDisplay
    ? (live?.scores || [0, 0])
    : (active?.liveScores || active?.scores || [0, 0]);
  const label = liveDisplay
    ? (live?.matchLabel || PHASE_LABELS[live?.phase || ''] || '對戰')
    : (active?.label || (active ? PHASE_LABELS[active.phase] : '') || '');
  const battle = liveDisplay
    ? live?.battle
    : (active?.liveBattles || active?.battles);
  const hasLive = liveDisplay || Boolean(active);
  const liveFrameFresh = Boolean(
    live?.cameraFrameUrl
    && live.cameraUpdatedAt
    && Date.now() - live.cameraUpdatedAt < 15000,
  );
  const liveFrameSrc = !webrtcConnected && liveFrameFresh && live?.cameraFrameUrl
    ? `${live.cameraFrameUrl}?t=${live.cameraUpdatedAt}`
    : null;
  const showReplayFallback = !webrtcConnected && !liveFrameSrc && Boolean(cameraReplay?.videoUrl);
  const hasCamera = webrtcConnected || Boolean(liveFrameSrc) || showReplayFallback || Boolean(live?.webrtcLive);
  const broadcastBanner = live?.broadcastStatus && live.broadcastStatus !== 'live'
    ? `${live.broadcastStatus === 'break' ? '休息' : live.broadcastStatus === 'delay' ? '延遲' : live.broadcastStatus}${live.broadcastMessage ? ` · ${live.broadcastMessage}` : ''}`
    : live?.broadcastMessage || null;

  useEffect(() => {
    if (!hasLive) {
      prevScoresRef.current = null;
      return;
    }
    const prev = prevScoresRef.current;
    if (prev && (prev[0] !== scores[0] || prev[1] !== scores[1])) {
      const side: 0 | 1 | 2 = scores[0] > prev[0] ? 1 : scores[1] > prev[1] ? 2 : 0;
      if (side) {
        setScorePopSide(side);
        window.setTimeout(() => setScorePopSide(0), 650);
        if (!live?.finishAt || live.finishAt === prevFinishAtRef.current) {
          triggerFlash(side === 1 ? 'red' : 'blue');
          fxRef.current?.burst(side === 1 ? '#ff2d55' : '#00d4ff', 32);
        }
      }
    }
    prevScoresRef.current = [...scores];
  }, [hasLive, live?.finishAt, scores, triggerFlash]);

  useEffect(() => {
    if (!live?.finishAt || live.finishAt === prevFinishAtRef.current) return;
    prevFinishAtRef.current = live.finishAt;
    const meta = FINISH_FX[live.finishType || ''] || FINISH_FX.spin;
    const side = live.finishSide === 2 ? 2 : 1;
    const pts = live.finishPts || 1;
    setFinishCallout({
      side,
      label: meta.label,
      pts,
      flash: meta.flash,
    });
    triggerFlash(meta.flash);
    fxRef.current?.burst(meta.color, meta.particles, live.finishType === 'extreme' ? 'extreme' : 'burst');
    if (live.finishType === 'extreme') {
      fxRef.current?.burst('#ffd60a', 24, 'extreme');
    }
    const timer = window.setTimeout(() => setFinishCallout(null), 1800);
    return () => window.clearTimeout(timer);
  }, [live?.finishAt, live?.finishPts, live?.finishSide, live?.finishType, triggerFlash]);

  useEffect(() => {
    const over = Boolean(live?.matchOver);
    if (prevMatchOverRef.current === null) {
      prevMatchOverRef.current = over;
      return;
    }
    if (!prevMatchOverRef.current && over) {
      const winner = scores[0] >= scores[1] ? p1Name : p2Name;
      setWinBanner(`${winner} 勝出！`);
      triggerFlash('gold');
      fxRef.current?.burst('#ffd60a', 80, 'victory');
      fxRef.current?.burst('#ff2d55', 48, 'victory');
      fxRef.current?.burst('#00d4ff', 48, 'victory');
      window.setTimeout(() => setWinBanner(null), 3200);
    }
    prevMatchOverRef.current = over;
  }, [live?.matchOver, p1Name, p2Name, scores, triggerFlash]);

  const p1MatchPoint = scores[0] === MATCH_TARGET - 1 && scores[1] < MATCH_TARGET - 1;
  const p2MatchPoint = scores[1] === MATCH_TARGET - 1 && scores[0] < MATCH_TARGET - 1;

  useEffect(() => {
    const onFs = () => {
      const el = stageRef.current;
      if (getFullscreenElement() === el) {
        cssFullscreenRef.current = false;
        setIsFullscreen(true);
        return;
      }
      // Native FS exited (Esc etc.). Leave CSS fallback alone.
      if (!cssFullscreenRef.current) {
        setIsFullscreen(false);
      }
    };
    return subscribeFullscreenChange(onFs);
  }, []);

  useEffect(() => {
    if (!isFullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isFullscreen]);

  const toggleFullscreen = useCallback(async () => {
    const el = stageRef.current;
    if (!el) return;

    if (isFullscreen || getFullscreenElement() === el) {
      await exitElementFullscreen();
      cssFullscreenRef.current = false;
      setIsFullscreen(false);
      return;
    }

    // Always expand via CSS first so iOS never appears "dead" while native FS hangs.
    cssFullscreenRef.current = true;
    setIsFullscreen(true);
    setUnmuteToken((n) => n + 1);

    if (prefersCssFullscreen()) return;

    const ok = await requestElementFullscreen(el);
    if (ok) {
      cssFullscreenRef.current = false;
    }
  }, [isFullscreen]);

  const unmuteAudio = useCallback(() => {
    setUnmuteToken((n) => n + 1);
  }, []);

  return (
    <div className="broadcast-shell">
      <BroadcastFx ref={fxRef} />

      <div className="broadcast-stage">
        <div
          ref={stageRef}
          className={`broadcast-camera-stage${hasCamera ? '' : ' broadcast-camera-stage--empty'}${isFullscreen ? ' broadcast-camera-stage--fullscreen' : ''}`}
        >
          <LiveWebRtcPlayer
            code={code}
            className="broadcast-camera-video"
            onConnectedChange={setWebrtcConnected}
            onStatusChange={setWebrtcStatus}
            onMutedChange={setAudioMuted}
            unmuteToken={unmuteToken}
          />
          {!webrtcConnected && liveFrameSrc ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              key={live?.cameraUpdatedAt}
              className="broadcast-camera-video broadcast-camera-video--fallback"
              src={liveFrameSrc}
              alt="對戰鏡頭"
            />
          ) : null}
          {!webrtcConnected && !liveFrameSrc && showReplayFallback && cameraReplay?.videoUrl ? (
            <video
              key={cameraReplay.id}
              className="broadcast-camera-video broadcast-camera-video--fallback"
              src={cameraReplay.videoUrl}
              controls
              playsInline
              autoPlay
            />
          ) : null}
          {!webrtcConnected && !liveFrameSrc && !showReplayFallback ? (
            <div className="broadcast-camera-placeholder">
              <p>{webrtcStatus || '等待對戰鏡頭…'}</p>
              <span>裁判請在房間「鏡頭」開即時直播，或按「分享畫面 + 音樂」</span>
            </div>
          ) : null}

          <div className={`broadcast-flash${flashClass ? ` broadcast-flash--${flashClass}` : ''}${flashClass ? ' broadcast-flash--on' : ''}`} aria-hidden />

          {finishCallout && (
            <div
              className={`broadcast-finish-call broadcast-finish-call--${finishCallout.flash} broadcast-finish-call--side-${finishCallout.side}`}
              aria-live="assertive"
            >
              <span className="broadcast-finish-call-type">{finishCallout.label}</span>
              <span className="broadcast-finish-call-pts">+{finishCallout.pts}</span>
            </div>
          )}

          {winBanner && (
            <div className="broadcast-win-banner" aria-live="assertive">
              <span>{winBanner}</span>
            </div>
          )}

          <div className="broadcast-stage-controls">
            {webrtcConnected && audioMuted ? (
              <button type="button" className="broadcast-stage-btn" onClick={unmuteAudio}>
                開啟聲音
              </button>
            ) : null}
            <button type="button" className="broadcast-stage-btn" onClick={toggleFullscreen}>
              {isFullscreen ? '縮回' : '全螢幕'}
            </button>
          </div>

          <div className="broadcast-hud-top">
            <span className="broadcast-brand">BEYBATTLE</span>
            <span className="broadcast-room">{code}</span>
            {label && <span className="broadcast-phase">{label}</span>}
            {broadcastBanner && (
              <span className="broadcast-status-banner" data-status={live?.broadcastStatus || 'live'}>
                {broadcastBanner}
              </span>
            )}
          </div>

          {hasLive && (
            <div className="broadcast-hud-bottom">
              <div className={`broadcast-hud-player broadcast-hud-player--red${scorePopSide === 1 ? ' broadcast-hud-player--pop' : ''}${p1MatchPoint ? ' broadcast-hud-player--match-point' : ''}`}>
                <span className="broadcast-hud-name">{p1Name}</span>
                <strong>{scores[0]}</strong>
              </div>
              <div className="broadcast-hud-center">
                <span className="broadcast-vs">VS</span>
                {battle ? <span className="broadcast-hud-battle">第 {battle} 局</span> : null}
              </div>
              <div className={`broadcast-hud-player broadcast-hud-player--blue${scorePopSide === 2 ? ' broadcast-hud-player--pop' : ''}${p2MatchPoint ? ' broadcast-hud-player--match-point' : ''}`}>
                <span className="broadcast-hud-name">{p2Name}</span>
                <strong>{scores[1]}</strong>
              </div>
            </div>
          )}
        </div>

        {error && <p className="broadcast-error">{error}</p>}

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
