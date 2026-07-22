import { ArenaLiveState } from '@/lib/constants';
import { getServiceSupabase } from '@/lib/rooms-server';

function supabaseUrl() {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '');
}

export function roomLiveFrameStoragePath(roomCode: string) {
  return `rooms/${roomCode.toUpperCase()}/live.jpg`;
}

export function roomLiveFramePublicUrl(roomCode: string) {
  const base = supabaseUrl();
  if (!base) return null;
  return `${base}/storage/v1/object/public/replay-videos/${roomLiveFrameStoragePath(roomCode)}`;
}

export function mergeRoomLiveState(
  prev: ArenaLiveState | Record<string, unknown> | null | undefined,
  next: ArenaLiveState,
): ArenaLiveState {
  const p = (prev || {}) as ArenaLiveState;
  return {
    ...next,
    cameraFrameUrl: next.cameraFrameUrl ?? p.cameraFrameUrl,
    cameraUpdatedAt: next.cameraUpdatedAt ?? p.cameraUpdatedAt,
    webrtcLive: next.webrtcLive !== undefined ? next.webrtcLive : p.webrtcLive,
    webrtcMode: next.webrtcMode ?? p.webrtcMode,
  };
}

export async function uploadRoomLiveFrame(roomCode: string, jpegBytes: Buffer | Uint8Array) {
  const sb = getServiceSupabase();
  if (!sb) throw new Error('伺服器未設定 Supabase');
  if (!jpegBytes?.length || jpegBytes.length < 256) {
    throw new Error('畫面太小或無效');
  }

  const path = roomLiveFrameStoragePath(roomCode);
  const { error: upErr } = await sb.storage
    .from('replay-videos')
    .upload(path, jpegBytes, { contentType: 'image/jpeg', upsert: true });
  if (upErr) throw new Error(upErr.message);

  const frameUrl = roomLiveFramePublicUrl(roomCode);
  if (!frameUrl) throw new Error('無法產生公開網址');

  const { data: row, error: readErr } = await sb
    .from('rooms')
    .select('live, revision')
    .eq('code', roomCode.toUpperCase())
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!row) throw new Error('找不到房間');

  const prevLive = (row.live || {}) as ArenaLiveState;
  const live: ArenaLiveState = {
    ...prevLive,
    cameraFrameUrl: frameUrl,
    cameraUpdatedAt: Date.now(),
  };

  const { error: patchErr } = await sb
    .from('rooms')
    .update({
      live,
      revision: Number(row.revision || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('code', roomCode.toUpperCase());
  if (patchErr) throw new Error(patchErr.message);

  return { frameUrl, updatedAt: live.cameraUpdatedAt };
}
