'use client';

import { useEffect, useRef, useState } from 'react';
import { preferMp4Replay, resolveReplayVideoUrls } from '@/lib/supabase';

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
  const [urls, setUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setActiveIndex(0);
    setLoading(true);
    resolveReplayVideoUrls(replayId).then((list) => {
      if (cancelled) return;
      setUrls(list);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [replayId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !urls.length) return;
    video.load();
  }, [urls, activeIndex, videoRef]);

  if (loading) {
    return (
      <div className="replay-video-loading" aria-busy="true" aria-label="載入影片中">
        <span className="replay-video-loading-spinner" aria-hidden="true" />
      </div>
    );
  }

  if (!urls.length) return null;

  const downloadUrl = urls.find((u) => u.endsWith('.mp4')) || urls[0];
  const needsMp4 = preferMp4Replay() && !urls.some((u) => u.endsWith('.mp4'));

  if (failed && activeIndex >= urls.length - 1) {
    return (
      <div className="replay-video-fallback">
        <p>{needsMp4 ? '此回放尚未提供 iPhone 格式' : '此裝置無法播放這段回放'}</p>
        <p className="replay-video-fallback-hint">
          {needsMp4
            ? '請在場內主機重新同步此局回放（會自動轉成 MP4），或先使用下方下載。'
            : '請在場內重新同步回放，或使用下方「下載」。'}
        </p>
        <a className="replay-video-fallback-link" href={downloadUrl} download>
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
