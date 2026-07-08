'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getReplayVideoUrls } from '@/lib/supabase';

type Props = {
  replayId: string;
  className?: string;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  viewportRef?: React.RefObject<HTMLDivElement | null>;
  playsInline?: boolean;
  preload?: 'none' | 'metadata' | 'auto';
  muted?: boolean;
  onReady?: () => void;
  onError?: () => void;
};

export default function ReplayVideo({
  replayId,
  className = '',
  videoRef: externalRef,
  viewportRef,
  playsInline = true,
  preload = 'metadata',
  muted = false,
  onReady,
  onError,
}: Props) {
  const internalRef = useRef<HTMLVideoElement>(null);
  const videoRef = externalRef || internalRef;
  const [failed, setFailed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const urls = useMemo(() => getReplayVideoUrls(replayId), [replayId]);

  useEffect(() => {
    setFailed(false);
    setActiveIndex(0);
  }, [replayId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !urls.length) return;
    video.load();
  }, [urls, activeIndex, videoRef]);

  if (!urls.length) return null;

  if (failed && activeIndex >= urls.length - 1) {
    return (
      <div className="replay-video-fallback">
        <p>此裝置無法播放這段回放</p>
        <p className="replay-video-fallback-hint">iPhone 需要 MP4 格式。請在場內重新同步回放，或使用下方「下載」。</p>
        <a className="replay-video-fallback-link" href={urls[0]} download>
          下載影片
        </a>
      </div>
    );
  }

  const src = urls[Math.min(activeIndex, urls.length - 1)];

  return (
    <div className="replay-player-viewport" ref={viewportRef}>
      <video
        key={`${replayId}-${activeIndex}`}
        ref={videoRef}
        className={className}
        playsInline={playsInline}
        preload={preload}
        muted={muted}
        src={src}
        onLoadedData={() => {
          setFailed(false);
          onReady?.();
        }}
        onError={() => {
          if (activeIndex < urls.length - 1) {
            setActiveIndex((i) => i + 1);
            return;
          }
          setFailed(true);
          onError?.();
        }}
      />
    </div>
  );
}
