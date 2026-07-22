'use client';

import { useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';
import {
  createPeerConnection,
  newPeerId,
  sdpPayload,
  sendWebrtcSignal,
  subscribeWebrtcChannel,
  type WebrtcSignal,
} from '@/lib/webrtc-live';

type Props = {
  code: string;
  className?: string;
  onConnectedChange?: (connected: boolean) => void;
  onStatusChange?: (status: string) => void;
  onMutedChange?: (muted: boolean) => void;
  /** Imperative unmute trigger from parent (e.g. after user taps fullscreen). */
  unmuteToken?: number;
};

export default function LiveWebRtcPlayer({
  code,
  className,
  onConnectedChange,
  onStatusChange,
  onMutedChange,
  unmuteToken = 0,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const viewerIdRef = useRef(newPeerId('view'));
  const publisherIdRef = useRef<string | null>(null);
  const onConnectedChangeRef = useRef(onConnectedChange);
  const onStatusChangeRef = useRef(onStatusChange);
  const onMutedChangeRef = useRef(onMutedChange);
  const [connected, setConnected] = useState(false);
  const [muted, setMuted] = useState(true);

  onConnectedChangeRef.current = onConnectedChange;
  onStatusChangeRef.current = onStatusChange;
  onMutedChangeRef.current = onMutedChange;

  useEffect(() => {
    onConnectedChangeRef.current?.(connected);
  }, [connected]);

  useEffect(() => {
    onMutedChangeRef.current?.(muted);
  }, [muted]);

  const applyStreamTrack = (track: MediaStreamTrack, inbound?: MediaStream) => {
    const video = videoRef.current;
    if (!video) return;
    if (inbound) {
      video.srcObject = inbound;
      return;
    }
    let stream = video.srcObject as MediaStream | null;
    if (!stream) {
      stream = new MediaStream();
      video.srcObject = stream;
    }
    if (!stream.getTracks().some((t) => t.id === track.id)) {
      stream.addTrack(track);
    }
  };

  const playWithAudioBestEffort = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      video.muted = true;
      await video.play();
      video.muted = false;
      setMuted(false);
    } catch {
      video.muted = true;
      setMuted(true);
      video.play().catch(() => {});
    }
  };

  useEffect(() => {
    if (!unmuteToken) return;
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    setMuted(false);
    video.play().catch(() => {
      video.muted = true;
      setMuted(true);
    });
  }, [unmuteToken]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | null = null;
    const sb = getSupabase();
    if (!sb) {
      onStatusChangeRef.current?.('未設定 Supabase，無法接收即時鏡頭');
      return;
    }

    const cleanupPc = () => {
      pcRef.current?.close();
      pcRef.current = null;
      pendingIceRef.current = [];
      if (videoRef.current) videoRef.current.srcObject = null;
      setConnected(false);
    };

    const isLive = () => {
      const state = pcRef.current?.connectionState;
      return state === 'connected' || state === 'connecting';
    };

    const sayHello = async () => {
      if (!channelRef.current || isLive()) return;
      await sendWebrtcSignal(channelRef.current, {
        kind: 'viewer-hello',
        viewerId: viewerIdRef.current,
      });
      if (!pcRef.current) onStatusChangeRef.current?.('正在連接裁判鏡頭…');
    };

    const flushIce = async (pc: RTCPeerConnection) => {
      const queued = pendingIceRef.current;
      pendingIceRef.current = [];
      for (const candidate of queued) {
        try {
          await pc.addIceCandidate(candidate);
        } catch {
          /* ignore */
        }
      }
    };

    const handleSignal = async (signal: WebrtcSignal) => {
      if (cancelled) return;

      if (signal.kind === 'publisher-hello') {
        const samePub = publisherIdRef.current === signal.publisherId;
        publisherIdRef.current = signal.publisherId;
        // Heartbeat from same publisher — don't tear down a good link
        if (samePub && isLive()) return;
        cleanupPc();
        await sayHello();
        return;
      }

      if (signal.kind === 'publisher-bye') {
        if (!publisherIdRef.current || signal.publisherId === publisherIdRef.current) {
          publisherIdRef.current = null;
          cleanupPc();
          onStatusChangeRef.current?.('裁判已停止直播');
        }
        return;
      }

      if (signal.kind === 'offer' && signal.to === viewerIdRef.current) {
        publisherIdRef.current = signal.from;
        cleanupPc();
        const pc = createPeerConnection();
        pcRef.current = pc;
        onStatusChangeRef.current?.('正在建立影音連線…');

        pc.ontrack = (ev) => {
          applyStreamTrack(ev.track, ev.streams[0]);
          setConnected(true);
          onStatusChangeRef.current?.('');
          playWithAudioBestEffort();
        };

        pc.onicecandidate = (ev) => {
          if (!ev.candidate || !channelRef.current) return;
          sendWebrtcSignal(channelRef.current, {
            kind: 'ice',
            from: viewerIdRef.current,
            to: signal.from,
            candidate: ev.candidate.toJSON(),
          }).catch(() => {});
        };

        pc.onconnectionstatechange = () => {
          if (pc.connectionState === 'connected') {
            setConnected(true);
            onStatusChangeRef.current?.('');
            playWithAudioBestEffort();
          }
          if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
            setConnected(false);
            onStatusChangeRef.current?.('連線中斷，重試中…');
            cleanupPc();
            window.setTimeout(() => {
              if (!cancelled) sayHello().catch(() => {});
            }, 1200);
          }
        };

        await pc.setRemoteDescription(sdpPayload(signal.sdp));
        await flushIce(pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (!channelRef.current) return;
        await sendWebrtcSignal(channelRef.current, {
          kind: 'answer',
          from: viewerIdRef.current,
          to: signal.from,
          sdp: sdpPayload(pc.localDescription || answer),
        });
        return;
      }

      if (signal.kind === 'ice' && signal.to === viewerIdRef.current && signal.candidate) {
        const pc = pcRef.current;
        if (!pc || !pc.remoteDescription) {
          pendingIceRef.current.push(signal.candidate);
          return;
        }
        try {
          await pc.addIceCandidate(signal.candidate);
        } catch {
          /* ignore */
        }
      }
    };

    (async () => {
      try {
        const channel = await subscribeWebrtcChannel(sb, code, (signal) => {
          handleSignal(signal).catch((e) => {
            onStatusChangeRef.current?.(e instanceof Error ? e.message : '直播訊號錯誤');
          });
        });
        if (cancelled) {
          sb.removeChannel(channel);
          return;
        }
        channelRef.current = channel;
        await sayHello();
        retryTimer = window.setInterval(() => {
          if (!cancelled && !isLive()) sayHello().catch(() => {});
        }, 3000);
      } catch (e) {
        if (!cancelled) {
          onStatusChangeRef.current?.(e instanceof Error ? e.message : '無法連線即時頻道');
        }
      }
    })();

    return () => {
      cancelled = true;
      if (retryTimer) window.clearInterval(retryTimer);
      cleanupPc();
      if (channelRef.current) {
        sb.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [code]);

  return (
    <video
      ref={videoRef}
      className={className}
      playsInline
      autoPlay
      muted={muted}
      style={{ display: connected ? 'block' : 'none' }}
    />
  );
}
