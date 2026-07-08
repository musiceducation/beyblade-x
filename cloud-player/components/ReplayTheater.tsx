'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { ArenaReplayRow } from '@/lib/constants';
import {
  applyReplayZoom,
  buildFinishSchedule,
  FINISH_ANNOUNCE_LABELS,
  getReplayPlaybackRate,
  getReplayStartScores,
  getReplayZoom,
  isReplayDebug,
  prepareReplayVideo,
  replayDebug,
  replayMeta,
  REPLAY_ANNOUNCE_MS,
  scoresAtVideoTime,
} from '@/lib/replay';
import { ReplayParticleFx, triggerReplayFinishFx } from '@/lib/replayFx';
import { getReplayVideoUrls } from '@/lib/supabase';
import ReplayPlayerBar from '@/components/ReplayPlayerBar';

export type ReplayTheaterMode = 'single' | 'match';

type AnnounceState = {
  type: string;
  player: number;
  points: number;
  name: string;
} | null;

type Props = {
  rounds: ArenaReplayRow[];
  initialRoundId: string;
  mode: ReplayTheaterMode;
  onClose: () => void;
};

function waitMs(ms: number, cancelled: () => boolean) {
  return new Promise<void>((resolve) => {
    const id = window.setTimeout(() => resolve(), ms);
    const check = window.setInterval(() => {
      if (cancelled()) {
        window.clearTimeout(id);
        window.clearInterval(check);
        resolve();
      }
    }, 120);
    window.setTimeout(() => window.clearInterval(check), ms + 50);
  });
}

export default function ReplayTheater({
  rounds,
  initialRoundId,
  mode,
  onClose,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef(new ReplayParticleFx());
  const cancelledRef = useRef(false);
  const timersRef = useRef<number[]>([]);
  const userPausedRef = useRef(false);
  const theaterRef = useRef<{
    fired: Set<number>;
    schedule: ReturnType<typeof buildFinishSchedule>;
    startScores: [number, number];
    roundMeta: ReturnType<typeof replayMeta>;
    roundLabel: string;
    scrubbing: boolean;
  } | null>(null);
  const roundResolveRef = useRef<(() => void) | null>(null);

  const [mounted, setMounted] = useState(false);
  const [roundIndex, setRoundIndex] = useState(() =>
    Math.max(0, rounds.findIndex((r) => r.id === initialRoundId)),
  );
  const [scores, setScores] = useState<[number, number]>([0, 0]);
  const [label, setLabel] = useState('回放中…');
  const [announce, setAnnounce] = useState<AnnounceState>(null);
  const [fx, setFx] = useState({ flash: '', shake: '' });
  const [popPlayer, setPopPlayer] = useState<1 | 2 | null>(null);
  const [hasVideo, setHasVideo] = useState(true);
  const [showChrome, setShowChrome] = useState(false);

  const round = rounds[roundIndex] ?? rounds[0];
  const meta = round ? replayMeta(round) : null;

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
  }, []);

  const finishRound = useCallback(() => {
    const resolve = roundResolveRef.current;
    if (resolve) {
      roundResolveRef.current = null;
      resolve();
    }
  }, []);

  const showAnnounce = useCallback((type: string, player: number, points: number, name: string) => {
    setAnnounce({ type, player, points, name });
    const id = window.setTimeout(() => setAnnounce(null), REPLAY_ANNOUNCE_MS);
    timersRef.current.push(id);
  }, []);

  const playFinishFeedback = useCallback((event: {
    finishType?: string;
    player?: number;
    points?: number;
  }, roundMeta: ReturnType<typeof replayMeta>) => {
    const player = event.player || 1;
    const type = event.finishType || 'spin';
    const name = player === 1 ? roundMeta.p1Name || 'Blader 1' : roundMeta.p2Name || 'Blader 2';
    setPopPlayer(player === 1 ? 1 : 2);
    window.setTimeout(() => setPopPlayer(null), 420);
    showAnnounce(type, player, event.points || 0, name);
    const payload = triggerReplayFinishFx(type, player, particlesRef.current);
    setFx({ flash: payload.flash, shake: payload.shake });
    window.setTimeout(() => setFx({ flash: '', shake: '' }), payload.flash ? 120 : 450);
  }, [showAnnounce]);

  const onTheaterTimeUpdate = useCallback(() => {
    const tr = theaterRef.current;
    const video = videoRef.current;
    if (!tr || !video || tr.scrubbing) return;
    const t = video.currentTime;
    tr.schedule.forEach((entry, i) => {
      if (tr.fired.has(i)) return;
      if (entry.videoSeek == null || t < entry.videoSeek - 0.08) return;
      tr.fired.add(i);
      const s = entry.event.scores;
      if (s && s.length >= 2) setScores([s[0], s[1]]);
      playFinishFeedback(entry.event, tr.roundMeta);
    });
  }, [playFinishFeedback]);

  const waitForVideoEnd = useCallback((video: HTMLVideoElement, videoDuration: number) => {
    return new Promise<void>((resolve) => {
      roundResolveRef.current = resolve;
      const onEnd = () => finishRound();
      video.addEventListener('ended', onEnd, { once: true });
      const rate = getReplayPlaybackRate();
      const maxMs = videoDuration > 0 ? (videoDuration / rate) * 1000 + 3000 : 120000;
      const fallbackId = window.setTimeout(onEnd, maxMs);
      timersRef.current.push(fallbackId);
    });
  }, [finishRound]);

  const playRoundWithVideo = useCallback(async (
    r: ArenaReplayRow,
    roundMeta: ReturnType<typeof replayMeta>,
    startScores: [number, number],
    roundLabel: string,
    url: string | string[],
    video: HTMLVideoElement,
  ) => {
    const videoDuration = await prepareReplayVideo(video, url);
    applyReplayZoom(video, getReplayZoom());
    if (cancelledRef.current) return;

    const schedule = buildFinishSchedule(roundMeta, videoDuration);
    theaterRef.current = {
      fired: new Set(),
      schedule,
      startScores,
      roundMeta,
      roundLabel,
      scrubbing: false,
    };

    setShowChrome(true);
    replayDebug('portal round-video', { id: r.id, videoDuration, finishes: schedule.length });

    const onTime = () => onTheaterTimeUpdate();
    video.addEventListener('timeupdate', onTime);
    await waitForVideoEnd(video, videoDuration);
    video.removeEventListener('timeupdate', onTime);
    theaterRef.current = null;

    if (!cancelledRef.current) await waitMs(800, () => cancelledRef.current);
  }, [onTheaterTimeUpdate, waitForVideoEnd]);

  const playRoundWithoutVideo = useCallback(async (
    roundMeta: ReturnType<typeof replayMeta>,
    roundLabel: string,
  ) => {
    const schedule = buildFinishSchedule(roundMeta, 0);
    let lastDelay = 350;
    schedule.forEach((entry) => {
      lastDelay = Math.max(lastDelay, entry.delay);
      const id = window.setTimeout(() => {
        if (cancelledRef.current) return;
        const s = entry.event.scores;
        if (s && s.length >= 2) setScores([s[0], s[1]]);
        playFinishFeedback(entry.event, roundMeta);
      }, entry.delay);
      timersRef.current.push(id);
    });
    const endDelay = Math.max(
      lastDelay + 800,
      schedule.length ? schedule[schedule.length - 1].delay + 800 : 600,
    );
    await waitMs(endDelay, () => cancelledRef.current);
  }, [playFinishFeedback]);

  const playRound = useCallback(async (idx: number) => {
    const r = rounds[idx];
    if (!r || cancelledRef.current) return;

    const roundMeta = replayMeta(r);
    const startScores = getReplayStartScores(roundMeta);
    const roundTotal = rounds.length;
    const roundLabel = mode === 'match' && roundTotal > 1
      ? `整場回放 · 第 ${idx + 1}/${roundTotal} 局`
      : (r.has_video ? '回放中…' : '重播得分（無影片）');

    setRoundIndex(idx);
    setScores(startScores);
    setLabel(roundLabel);
    setHasVideo(!!r.has_video);

    const video = videoRef.current;
    const urls = r.has_video ? getReplayVideoUrls(r.id) : [];

    if (urls.length && video) {
      await playRoundWithVideo(r, roundMeta, startScores, roundLabel, urls, video);
    } else {
      setShowChrome(false);
      if (video) {
        video.pause();
        video.removeAttribute('src');
      }
      await playRoundWithoutVideo(roundMeta, roundLabel);
    }
  }, [mode, playRoundWithVideo, playRoundWithoutVideo, rounds]);

  const runPlayback = useCallback(async () => {
    cancelledRef.current = false;
    clearTimers();
    particlesRef.current.clear();

    const indices = mode === 'match'
      ? rounds.map((_, i) => i)
      : [Math.max(0, rounds.findIndex((r) => r.id === initialRoundId))];

    for (let i = 0; i < indices.length; i++) {
      if (cancelledRef.current) break;
      await playRound(indices[i]);
      if (cancelledRef.current) break;
      if (i < indices.length - 1) await waitMs(900, () => cancelledRef.current);
    }

    if (!cancelledRef.current) onClose();
  }, [clearTimers, initialRoundId, mode, onClose, playRound, rounds]);

  const stop = useCallback(() => {
    cancelledRef.current = true;
    finishRound();
    clearTimers();
    setAnnounce(null);
    setShowChrome(false);
    particlesRef.current.clear();
    videoRef.current?.pause();
    onClose();
  }, [clearTimers, finishRound, onClose]);

  useEffect(() => {
    setMounted(true);
    if (isReplayDebug()) console.info('[replay] portal debug mode on');
  }, []);

  useEffect(() => {
    particlesRef.current.attach(canvasRef.current);
    const onResize = () => particlesRef.current.resize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [mounted]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPause = () => {
      if (cancelledRef.current || video.ended || userPausedRef.current) return;
      video.play().catch(() => {});
    };
    video.addEventListener('pause', onPause);
    return () => video.removeEventListener('pause', onPause);
  }, [mounted, roundIndex]);

  useEffect(() => {
    runPlayback().catch(console.error);
    return () => {
      cancelledRef.current = true;
      finishRound();
      clearTimers();
      particlesRef.current.clear();
    };
    // Theater mounts once per playback session with fixed props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.body.classList.add('portal-replay-theater-active');
    return () => document.body.classList.remove('portal-replay-theater-active');
  }, []);

  const handleTheaterScrub = useCallback((timeSec: number) => {
    const tr = theaterRef.current;
    if (!tr) return;
    tr.scrubbing = true;
    tr.schedule.forEach((entry, i) => {
      if (entry.videoSeek == null) return;
      if (entry.videoSeek <= timeSec + 0.08) tr.fired.add(i);
      else tr.fired.delete(i);
    });
    setScores(scoresAtVideoTime(tr.schedule, timeSec, tr.startScores));
    window.setTimeout(() => {
      if (theaterRef.current) theaterRef.current.scrubbing = false;
    }, 120);
  }, []);

  if (!mounted || !round || !meta) return null;

  const labels = announce ? FINISH_ANNOUNCE_LABELS[announce.type] : null;

  return createPortal(
    <div
      className={`portal-replay-theater${fx.shake ? ` ${fx.shake}` : ''}${!hasVideo ? ' portal-replay-theater--no-video' : ''}`}
      role="dialog"
      aria-label="得分回放"
    >
      <div className="portal-replay-fx" aria-hidden="true">
        <canvas ref={canvasRef} className="portal-replay-particles" />
        <div className={`portal-replay-flash${fx.flash ? ` portal-replay-flash--${fx.flash}` : ''}${fx.flash ? ' active' : ''}`} />
      </div>

      {!hasVideo && (
        <div className="portal-replay-theater-backdrop">
          <p>得分回放</p>
        </div>
      )}

      <div className="portal-replay-theater-viewport replay-player-viewport" ref={viewportRef}>
        <video
          ref={videoRef}
          className="portal-replay-theater-video"
          playsInline
        />
      </div>

      <div className="portal-replay-vignette" aria-hidden="true" />

      <div className="portal-replay-hud">
        <p className="portal-replay-hud-battle">
          第 {round.battle_num ?? meta.battleNum ?? '?'} 局
        </p>
        <div className="portal-replay-hud-scores">
          <div className="portal-replay-hud-player portal-replay-hud-red">
            <span>{meta.p1Name || 'Blader 1'}</span>
            <strong className={popPlayer === 1 ? 'pop' : ''}>{scores[0]}</strong>
          </div>
          <span className="portal-replay-hud-vs">VS</span>
          <div className="portal-replay-hud-player portal-replay-hud-blue">
            <span>{meta.p2Name || 'Blader 2'}</span>
            <strong className={popPlayer === 2 ? 'pop' : ''}>{scores[1]}</strong>
          </div>
        </div>
        <p className="portal-replay-hud-label">{label}</p>
      </div>

      {showChrome && (
        <ReplayPlayerBar
          videoRef={videoRef}
          viewportRef={viewportRef}
          wide
          className="portal-replay-theater-chrome"
          onUserPauseChange={(paused) => { userPausedRef.current = paused; }}
          onScrub={handleTheaterScrub}
        />
      )}

      <button
        type="button"
        className="portal-replay-theater-stop"
        onClick={stop}
      >
        ✕ 停止回放
      </button>

      {announce && labels && (
        <div
          className={`portal-finish-announce portal-finish-announce--${announce.type} portal-finish-announce--p${announce.player} show`}
          aria-live="assertive"
        >
          <div className="portal-finish-announce-backdrop" aria-hidden="true" />
          <div className="portal-finish-announce-inner">
            <p className="portal-finish-announce-player">{announce.name}</p>
            <h2 className="portal-finish-announce-en">{labels.en}</h2>
            <p className="portal-finish-announce-zh">{labels.zh}</p>
            <p className="portal-finish-announce-points">+{announce.points}</p>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
