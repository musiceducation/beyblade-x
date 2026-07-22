'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';
import {
  createPeerConnection,
  newPeerId,
  sdpPayload,
  sendWebrtcSignal,
  subscribeWebrtcChannel,
  waitIceGatheringComplete,
  type WebrtcSignal,
} from '@/lib/webrtc-live';

type Props = {
  code: string;
  refereeToken: string;
};

type Mode = 'camera' | 'screen';

const MAX_VIEWERS = 8;

const SHARE_AUDIO = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
} as const;

async function attachMicTracks(stream: MediaStream) {
  try {
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    mic.getAudioTracks().forEach((track) => {
      track.contentHint = 'speech';
      stream.addTrack(track);
    });
  } catch {
    /* mic optional when screen already has audio */
  }
}

export default function RoomLiveCamera({ code, refereeToken }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const publisherIdRef = useRef(newPeerId('pub'));
  const modeRef = useRef<Mode>('camera');
  const helloTimerRef = useRef<number | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [mode, setMode] = useState<Mode>('camera');
  const [viewerCount, setViewerCount] = useState(0);
  const [audioOn, setAudioOn] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const setWebrtcFlag = useCallback(async (active: boolean, nextMode: Mode) => {
    await fetch(`/api/rooms/${encodeURIComponent(code)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-referee-token': refereeToken,
      },
      body: JSON.stringify({
        action: 'set_webrtc_live',
        session: 'junior',
        active,
        mode: nextMode,
      }),
    });
  }, [code, refereeToken]);

  const refreshViewerCount = useCallback(() => {
    let n = 0;
    peersRef.current.forEach((pc) => {
      if (pc.connectionState === 'connected' || pc.connectionState === 'connecting') n += 1;
    });
    setViewerCount(n);
  }, []);

  const closePeer = useCallback((viewerId: string) => {
    const pc = peersRef.current.get(viewerId);
    if (!pc) return;
    pc.close();
    peersRef.current.delete(viewerId);
    pendingIceRef.current.delete(viewerId);
    refreshViewerCount();
  }, [refreshViewerCount]);

  const closeAllPeers = useCallback(() => {
    peersRef.current.forEach((pc) => pc.close());
    peersRef.current.clear();
    pendingIceRef.current.clear();
    setViewerCount(0);
  }, []);

  const flushPendingIce = async (viewerId: string, pc: RTCPeerConnection) => {
    const queued = pendingIceRef.current.get(viewerId) || [];
    pendingIceRef.current.delete(viewerId);
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        /* ignore */
      }
    }
  };

  const connectViewer = useCallback(async (viewerId: string) => {
    const stream = streamRef.current;
    const channel = channelRef.current;
    if (!stream || !channel) return;
    if (peersRef.current.has(viewerId)) closePeer(viewerId);
    if (peersRef.current.size >= MAX_VIEWERS) {
      setError(`最多同時 ${MAX_VIEWERS} 個觀看端（含 OBS）`);
      return;
    }

    const pc = createPeerConnection();
    peersRef.current.set(viewerId, pc);
    refreshViewerCount();

    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    pc.onicecandidate = (ev) => {
      if (!ev.candidate || !channelRef.current) return;
      sendWebrtcSignal(channelRef.current, {
        kind: 'ice',
        from: publisherIdRef.current,
        to: viewerId,
        candidate: ev.candidate.toJSON(),
      }).catch(() => {});
    };

    pc.onconnectionstatechange = () => {
      refreshViewerCount();
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        closePeer(viewerId);
      }
    };

    const offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
    await pc.setLocalDescription(offer);
    // Send offer ASAP; trickle the rest of ICE over the signal channel
    await sendWebrtcSignal(channel, {
      kind: 'offer',
      from: publisherIdRef.current,
      to: viewerId,
      sdp: sdpPayload(pc.localDescription || offer),
    });
    await waitIceGatheringComplete(pc);
  }, [closePeer, refreshViewerCount]);

  const handleSignalRef = useRef<(signal: WebrtcSignal) => void>(() => {});
  handleSignalRef.current = (signal: WebrtcSignal) => {
    if (signal.kind === 'viewer-hello') {
      connectViewer(signal.viewerId).catch((e) => {
        setError(e instanceof Error ? e.message : '連線觀看端失敗');
      });
      return;
    }
    if (signal.kind === 'answer' && signal.to === publisherIdRef.current) {
      const pc = peersRef.current.get(signal.from);
      if (!pc || pc.signalingState === 'stable') return;
      pc.setRemoteDescription(sdpPayload(signal.sdp))
        .then(() => flushPendingIce(signal.from, pc))
        .catch((e) => {
          setError(e instanceof Error ? e.message : '觀看端回應失敗');
        });
      return;
    }
    if (signal.kind === 'ice' && signal.to === publisherIdRef.current && signal.candidate) {
      const pc = peersRef.current.get(signal.from);
      if (!pc || !pc.remoteDescription) {
        const q = pendingIceRef.current.get(signal.from) || [];
        q.push(signal.candidate);
        pendingIceRef.current.set(signal.from, q);
        return;
      }
      pc.addIceCandidate(signal.candidate).catch(() => {});
    }
  };

  const cleanupMediaAndChannel = useCallback(async (announceBye: boolean) => {
    if (helloTimerRef.current) {
      window.clearInterval(helloTimerRef.current);
      helloTimerRef.current = null;
    }
    closeAllPeers();
    if (channelRef.current) {
      if (announceBye) {
        try {
          await sendWebrtcSignal(channelRef.current, {
            kind: 'publisher-bye',
            publisherId: publisherIdRef.current,
          });
        } catch {
          /* ignore */
        }
      }
      const sb = getSupabase();
      if (sb) sb.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setAudioOn(false);
  }, [closeAllPeers]);

  const stopStream = useCallback(async () => {
    await cleanupMediaAndChannel(true);
    setStreaming(false);
    setStatus('');
    setWebrtcFlag(false, modeRef.current).catch(() => {});
  }, [cleanupMediaAndChannel, setWebrtcFlag]);

  const startWithStream = async (stream: MediaStream, nextMode: Mode) => {
    setError('');
    setStatus('');
    const sb = getSupabase();
    if (!sb) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('未設定 Supabase，無法即時直播');
    }

    await cleanupMediaAndChannel(false);

    publisherIdRef.current = newPeerId('pub');
    modeRef.current = nextMode;
    streamRef.current = stream;
    const hasAudio = stream.getAudioTracks().length > 0;
    setAudioOn(hasAudio);
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play().catch(() => {});
    }
    setMode(nextMode);
    setStreaming(true);

    const channel = await subscribeWebrtcChannel(sb, code, (signal) => {
      handleSignalRef.current(signal);
    });
    channelRef.current = channel;

    const announce = () => sendWebrtcSignal(channel, {
      kind: 'publisher-hello',
      publisherId: publisherIdRef.current,
      mode: modeRef.current,
    });
    await announce();
    if (helloTimerRef.current) window.clearInterval(helloTimerRef.current);
    helloTimerRef.current = window.setInterval(() => {
      if (channelRef.current === channel) announce().catch(() => {});
    }, 4000);
    await setWebrtcFlag(true, nextMode);
    const audioHint = hasAudio ? '含聲音／音樂' : '無音訊（瀏覽器未授權）';
    setStatus(
      nextMode === 'screen'
        ? `畫面分享中 · ${audioHint} · OBS／直播頁即時顯示`
        : `鏡頭直播中 · ${audioHint} · OBS／直播頁即時顯示`,
    );
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      await startWithStream(stream, 'camera');
    } catch (e) {
      setError(e instanceof Error ? e.message : '無法開啟鏡頭');
      await cleanupMediaAndChannel(false);
      setStreaming(false);
    }
  };

  const startScreen = async () => {
    try {
      const displayConstraints: DisplayMediaStreamOptions = {
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
        audio: SHARE_AUDIO,
      };
      // Chrome: include system / tab audio when sharing
      Object.assign(displayConstraints, {
        systemAudio: 'include',
        preferCurrentTab: false,
      });

      const stream = await navigator.mediaDevices.getDisplayMedia(displayConstraints);
      stream.getAudioTracks().forEach((track) => {
        track.contentHint = 'music';
      });
      // Also add mic so host voice rides with screen/music
      await attachMicTracks(stream);

      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        stopStream().catch(() => {});
      });
      await startWithStream(stream, 'screen');
      if (!stream.getAudioTracks().length) {
        setError('未能分享聲音：分享 Chrome 分頁時請勾選「分享分頁音訊」，或允許麥克風。');
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotAllowedError') return;
      setError(e instanceof Error ? e.message : '無法分享畫面');
      await cleanupMediaAndChannel(false);
      setStreaming(false);
    }
  };

  useEffect(() => () => {
    cleanupMediaAndChannel(true).catch(() => {});
    setWebrtcFlag(false, modeRef.current).catch(() => {});
  }, [cleanupMediaAndChannel, setWebrtcFlag]);

  return (
    <section className="player-section room-live-camera" aria-label="鏡頭直播">
      <p className="lobby-hint">
        即時影音（WebRTC）：畫面 + 音樂／咪。分享畫面時請勾選「分享音訊」。
        開播後用 OBS「瀏覽器來源」開直播頁即可。
      </p>
      <div className="room-live-camera-preview">
        <video ref={videoRef} className="room-live-camera-video" playsInline muted autoPlay />
      </div>
      <div className="room-live-camera-actions">
        {!streaming ? (
          <>
            <button type="button" className="lobby-submit" onClick={startCamera}>
              開始鏡頭直播（含咪）
            </button>
            <button type="button" className="lobby-submit" onClick={startScreen}>
              分享畫面 + 音樂
            </button>
          </>
        ) : (
          <button type="button" className="lobby-submit" onClick={() => stopStream()}>
            停止直播
          </button>
        )}
      </div>
      {status && (
        <p className="lobby-hint">
          {status}
          {streaming ? ` · 觀看端 ${viewerCount}` : ''}
          {streaming && mode === 'screen' ? ' · 畫面分享' : ''}
          {streaming && audioOn ? ' · 音訊開' : ''}
        </p>
      )}
      {error && <p className="lobby-error">{error}</p>}
    </section>
  );
}
