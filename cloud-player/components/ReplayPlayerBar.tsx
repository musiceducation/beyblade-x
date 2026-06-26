'use client';

import {
  useCallback,
  useEffect,
  useState,
} from 'react';
import {
  applyReplayPlaybackRate,
  applyReplayZoom,
  cycleReplayZoom,
  formatVideoClock,
  getReplayPlaybackRate,
  getReplayZoom,
  replayZoomLabel,
  REPLAY_SPEED_OPTIONS,
  setReplayPlaybackRate,
  setReplayZoom,
} from '@/lib/replay';

type Props = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  viewportRef?: React.RefObject<HTMLDivElement | null>;
  wide?: boolean;
  className?: string;
  hidden?: boolean;
  onUserPauseChange?: (paused: boolean) => void;
  onScrub?: (timeSec: number) => void;
};

export default function ReplayPlayerBar({
  videoRef,
  viewportRef,
  wide = false,
  className = '',
  hidden = false,
  onUserPauseChange,
  onScrub,
}: Props) {
  const [speed, setSpeed] = useState(getReplayPlaybackRate);
  const [zoom, setZoom] = useState(getReplayZoom);
  const [scrubbing, setScrubbing] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [paused, setPaused] = useState(true);

  const syncFromVideo = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!scrubbing) setCurrent(video.currentTime || 0);
    if (Number.isFinite(video.duration)) setDuration(video.duration);
    setPaused(video.paused);
  }, [scrubbing, videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || hidden) return;

    applyReplayPlaybackRate(video, speed);
    applyReplayZoom(video, zoom);
    if (viewportRef?.current) viewportRef.current.dataset.zoom = String(zoom);

    const onMeta = () => syncFromVideo();
    const onTime = () => {
      if (!scrubbing) setCurrent(video.currentTime || 0);
    };
    const onPlay = () => {
      setPaused(false);
      onUserPauseChange?.(false);
    };
    const onPause = () => {
      setPaused(true);
    };

    video.addEventListener('loadedmetadata', onMeta);
    video.addEventListener('durationchange', onMeta);
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    syncFromVideo();

    return () => {
      video.removeEventListener('loadedmetadata', onMeta);
      video.removeEventListener('durationchange', onMeta);
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
    };
  }, [hidden, onUserPauseChange, scrubbing, speed, syncFromVideo, videoRef, viewportRef, zoom]);

  if (hidden) return null;

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video?.src) return;
    if (video.paused) {
      onUserPauseChange?.(false);
      video.play().catch(() => {});
    } else {
      onUserPauseChange?.(true);
      video.pause();
    }
  };

  const onSpeedChange = (value: string) => {
    const rate = parseFloat(value);
    setSpeed(rate);
    setReplayPlaybackRate(rate);
    applyReplayPlaybackRate(videoRef.current, rate);
  };

  const onZoomClick = () => {
    const next = cycleReplayZoom();
    setZoom(next);
    applyReplayZoom(videoRef.current, next);
    if (viewportRef?.current) viewportRef.current.dataset.zoom = String(next);
  };

  const onScrubInput = (value: string) => {
    const video = videoRef.current;
    const t = parseFloat(value);
    if (!video || !Number.isFinite(t)) return;
    try {
      video.currentTime = t;
    } catch { /* seek unsupported */ }
    setCurrent(t);
    onScrub?.(t);
  };

  return (
    <div className={`replay-player-bar${className ? ` ${className}` : ''}`}>
      <div className="replay-player-speed-row">
        <button
          type="button"
          className={`btn-replay-player-zoom${zoom > 1 ? ' is-active' : ''}`}
          title={zoom === 1 ? '放大影片' : `目前 ${zoom}× · 點擊切換`}
          onClick={onZoomClick}
        >
          {replayZoomLabel(zoom)}
        </button>
        <select
          className="replay-player-speed"
          aria-label="回放速度"
          title="慢動作重播"
          value={String(speed)}
          onChange={(e) => onSpeedChange(e.target.value)}
        >
          {REPLAY_SPEED_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt === 1 ? '1× 正常' : opt === 0.5 ? '0.5× 慢動作' : opt === 0.25 ? '0.25× 超慢' : `${opt}×`}
            </option>
          ))}
        </select>
      </div>
      <div className={`replay-player-progress${wide ? ' replay-player-progress--wide' : ''}`}>
        <button
          type="button"
          className="btn-replay-player-play"
          aria-label={paused ? '播放' : '暫停'}
          onClick={togglePlay}
        >
          {paused ? '▶' : '⏸'}
        </button>
        <span className="replay-player-time">{formatVideoClock(current)}</span>
        <input
          type="range"
          className="replay-player-scrubber"
          min={0}
          max={Math.max(duration, 0.1)}
          step={0.05}
          value={current}
          aria-label="播放進度"
          onPointerDown={() => {
            setScrubbing(true);
            onUserPauseChange?.(true);
            videoRef.current?.pause();
          }}
          onPointerUp={() => {
            setScrubbing(false);
            onUserPauseChange?.(false);
            videoRef.current?.play().catch(() => {});
          }}
          onChange={(e) => onScrubInput(e.target.value)}
        />
        <span className="replay-player-time">{formatVideoClock(duration)}</span>
      </div>
    </div>
  );
}
