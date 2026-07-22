'use client';

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import LiveWebRtcPlayer from '@/components/LiveWebRtcPlayer';
import {
  exitElementFullscreen,
  getFullscreenElement,
  prefersCssFullscreen,
  requestElementFullscreen,
  subscribeFullscreenChange,
} from '@/lib/fullscreen';

type Props = {
  params: Promise<{ code: string }>;
};

/** Minimal WebRTC-only page for in-app WebView / embed. */
export default function StreamEmbedPage({ params }: Props) {
  const { code: rawCode } = use(params);
  const code = useMemo(() => rawCode.toUpperCase(), [rawCode]);
  const shellRef = useRef<HTMLDivElement>(null);
  const cssFullscreenRef = useRef(false);
  const [status, setStatus] = useState('連接中…');
  const [connected, setConnected] = useState(false);
  const [audioMuted, setAudioMuted] = useState(true);
  const [unmuteToken, setUnmuteToken] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onFs = () => {
      const el = shellRef.current;
      if (getFullscreenElement() === el) {
        cssFullscreenRef.current = false;
        setIsFullscreen(true);
        return;
      }
      if (!cssFullscreenRef.current) {
        setIsFullscreen(false);
      }
    };
    return subscribeFullscreenChange(onFs);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = shellRef.current;
    if (!el) return;

    if (isFullscreen || getFullscreenElement() === el) {
      await exitElementFullscreen();
      cssFullscreenRef.current = false;
      setIsFullscreen(false);
      return;
    }

    cssFullscreenRef.current = true;
    setIsFullscreen(true);
    setUnmuteToken((n) => n + 1);

    if (prefersCssFullscreen()) return;

    const ok = await requestElementFullscreen(el);
    if (ok) {
      cssFullscreenRef.current = false;
    }
  }, [isFullscreen]);

  return (
    <div
      ref={shellRef}
      className={`stream-embed${isFullscreen ? ' stream-embed--fullscreen' : ''}`}
    >
      <LiveWebRtcPlayer
        code={code}
        className="stream-embed-video"
        onConnectedChange={setConnected}
        onStatusChange={setStatus}
        onMutedChange={setAudioMuted}
        unmuteToken={unmuteToken}
      />
      {!connected && (
        <div className="stream-embed-status">
          <p>{status || '等待裁判開播…'}</p>
        </div>
      )}
      <div className="stream-embed-controls">
        {connected && audioMuted ? (
          <button
            type="button"
            className="stream-embed-btn"
            onClick={() => setUnmuteToken((n) => n + 1)}
          >
            開啟聲音
          </button>
        ) : null}
        <button type="button" className="stream-embed-btn" onClick={toggleFullscreen}>
          {isFullscreen ? '縮回' : '全螢幕'}
        </button>
      </div>
    </div>
  );
}
