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
  buildFinishSchedule,
  FINISH_ANNOUNCE_LABELS,
  getReplayStartScores,
  isReplayDebug,
  prepareReplayVideo,
  replayDebug,
  replayMeta,
  REPLAY_ANNOUNCE_MS,
  syncReplayVideoTime,
} from '@/lib/replay';
import { ReplayParticleFx, triggerReplayFinishFx } from '@/lib/replayFx';
import { replayVideoUrl } from '@/lib/supabase';

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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef(new ReplayParticleFx());
  const cancelledRef = useRef(false);
  const timersRef = useRef<number[]>([]);

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

  const round = rounds[roundIndex] ?? rounds[0];
  const meta = round ? replayMeta(round) : null;

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
  }, []);

  const scheduleStep = useCallback((fn: () => void, delay: number) => {
    const id = window.setTimeout(() => {
      if (!cancelledRef.current) fn();
    }, delay);
    timersRef.current.push(id);
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
    const url = r.has_video ? replayVideoUrl(r.id) : null;
    let videoDuration = 0;

    if (url && video) {
      videoDuration = await prepareReplayVideo(video, url);
    } else if (video) {
      video.pause();
      video.removeAttribute('src');
    }

    if (cancelledRef.current) return;

    const schedule = buildFinishSchedule(roundMeta, videoDuration);
    replayDebug('portal round', {
      id: r.id,
      videoDuration,
      schedule: schedule.map((e) => ({
        delay: e.delay,
        seek: e.videoSeek,
        type: e.event.finishType,
      })),
    });

    let lastDelay = 350;
    schedule.forEach((entry) => {
      lastDelay = Math.max(lastDelay, entry.delay);
      scheduleStep(() => {
        if (cancelledRef.current) return;
        if (url && video && entry.videoSeek != null) {
          syncReplayVideoTime(video, entry.videoSeek).catch(() => {});
        }
        const s = entry.event.scores;
        if (s && s.length >= 2) setScores([s[0], s[1]]);
        playFinishFeedback(entry.event, roundMeta);
      }, entry.delay);
    });

    const tailMs = url ? 1500 : 800;
    const endDelay = Math.max(
      lastDelay + tailMs,
      videoDuration > 0 ? videoDuration * 1000 + 300 : 0,
      schedule.length ? schedule[schedule.length - 1].delay + tailMs : 600,
    );
    await waitMs(endDelay, () => cancelledRef.current);
  }, [mode, playFinishFeedback, rounds, scheduleStep]);

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
    clearTimers();
    setAnnounce(null);
    particlesRef.current.clear();
    videoRef.current?.pause();
    onClose();
  }, [clearTimers, onClose]);

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
      if (cancelledRef.current || video.ended) return;
      video.play().catch(() => {});
    };
    video.addEventListener('pause', onPause);
    return () => video.removeEventListener('pause', onPause);
  }, [mounted, roundIndex]);

  useEffect(() => {
    runPlayback().catch(console.error);
    return () => {
      cancelledRef.current = true;
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

      <video
        ref={videoRef}
        className="portal-replay-theater-video"
        playsInline
      />

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
