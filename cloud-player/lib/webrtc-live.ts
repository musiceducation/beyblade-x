import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

export type WebrtcSignal =
  | { kind: 'publisher-hello'; publisherId: string; mode: 'camera' | 'screen' }
  | { kind: 'publisher-bye'; publisherId: string }
  | { kind: 'viewer-hello'; viewerId: string }
  | { kind: 'offer'; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { kind: 'answer'; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { kind: 'ice'; from: string; to: string; candidate: RTCIceCandidateInit | null };

export function webrtcChannelName(roomCode: string) {
  return `beybattle-webrtc:${roomCode.toUpperCase()}`;
}

/** Plain JSON for Supabase broadcast (RTCSessionDescription objects can drop fields). */
export function sdpPayload(desc: RTCSessionDescription | RTCSessionDescriptionInit | null | undefined) {
  if (!desc?.type || !desc.sdp) {
    throw new Error('無效 SDP');
  }
  return { type: desc.type, sdp: desc.sdp } satisfies RTCSessionDescriptionInit;
}

export function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  const turnUrl = process.env.NEXT_PUBLIC_TURN_URL?.trim();
  const turnUser = process.env.NEXT_PUBLIC_TURN_USERNAME?.trim();
  const turnPass = process.env.NEXT_PUBLIC_TURN_CREDENTIAL?.trim();
  if (turnUrl && turnUser && turnPass) {
    servers.push({ urls: turnUrl, username: turnUser, credential: turnPass });
  }

  // Public fallback TURN so phone ↔ Mac can connect across NAT when custom TURN unset
  servers.push(
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  );

  return servers;
}

export function createPeerConnection() {
  return new RTCPeerConnection({
    iceServers: iceServers(),
    iceCandidatePoolSize: 8,
  });
}

export function newPeerId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function subscribeWebrtcChannel(
  supabase: SupabaseClient,
  roomCode: string,
  onSignal: (signal: WebrtcSignal) => void,
): Promise<RealtimeChannel> {
  const channel = supabase.channel(webrtcChannelName(roomCode), {
    config: { broadcast: { ack: false, self: false } },
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('即時頻道連線逾時')), 12000);
    channel
      .on('broadcast', { event: 'signal' }, ({ payload }) => {
        if (payload && typeof payload === 'object' && 'kind' in payload) {
          onSignal(payload as WebrtcSignal);
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          window.clearTimeout(timeout);
          resolve();
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          window.clearTimeout(timeout);
          reject(new Error('無法連線即時直播頻道'));
        }
      });
  });

  return channel;
}

export async function sendWebrtcSignal(channel: RealtimeChannel, signal: WebrtcSignal) {
  const status = await channel.send({
    type: 'broadcast',
    event: 'signal',
    payload: signal,
  });
  if (status !== 'ok') {
    throw new Error(`直播訊號傳送失敗（${String(status)}）`);
  }
}

/** Short wait so early candidates land in SDP; remaining trickle via ICE messages. */
export async function waitIceGatheringComplete(pc: RTCPeerConnection, ms = 1200) {
  if (pc.iceGatheringState === 'complete') return;
  await new Promise<void>((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', onChange);
      window.clearTimeout(timer);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const timer = window.setTimeout(done, ms);
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}
