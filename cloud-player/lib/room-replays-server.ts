import { getServiceSupabase } from '@/lib/rooms-server';

export type RoomReplayRow = {
  id: string;
  room_code: string;
  match_id: string | null;
  battle_num: number | null;
  metadata: Record<string, unknown>;
  has_video: boolean;
  created_at: string;
  updated_at: string;
};

export type PublicRoomReplay = RoomReplayRow & {
  videoUrl: string | null;
};

function supabaseUrl() {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '');
}

export function roomReplayStoragePath(roomCode: string, replayId: string, ext = 'mp4') {
  return `rooms/${roomCode.toUpperCase()}/${replayId}.${ext}`;
}

export function roomReplayPublicUrl(roomCode: string, replayId: string, ext = 'mp4') {
  const base = supabaseUrl();
  if (!base) return null;
  return `${base}/storage/v1/object/public/replay-videos/${roomReplayStoragePath(roomCode, replayId, ext)}`;
}

export function toPublicReplay(row: RoomReplayRow): PublicRoomReplay {
  return {
    ...row,
    videoUrl: row.has_video ? roomReplayPublicUrl(row.room_code, row.id) : null,
  };
}

export async function listRoomReplays(roomCode: string): Promise<PublicRoomReplay[]> {
  const sb = getServiceSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('room_replays')
    .select('*')
    .eq('room_code', roomCode.toUpperCase())
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data || []) as RoomReplayRow[]).map(toPublicReplay);
}

export async function upsertRoomReplayMeta(
  roomCode: string,
  payload: {
    id: string;
    matchId?: string | null;
    battleNum?: number;
    metadata?: Record<string, unknown>;
  },
) {
  const sb = getServiceSupabase();
  if (!sb) throw new Error('伺服器未設定 Supabase');

  const row = {
    id: payload.id,
    room_code: roomCode.toUpperCase(),
    match_id: payload.matchId || null,
    battle_num: payload.battleNum ?? null,
    metadata: payload.metadata || {},
    has_video: false,
    updated_at: new Date().toISOString(),
  };

  const { error } = await sb.from('room_replays').upsert(row, { onConflict: 'id' });
  if (error) throw new Error(error.message);

  const { data, error: readErr } = await sb
    .from('room_replays')
    .select('*')
    .eq('id', payload.id)
    .single();
  if (readErr) throw new Error(readErr.message);
  return data as RoomReplayRow;
}

export async function uploadRoomReplayVideo(
  roomCode: string,
  replayId: string,
  videoBytes: Buffer | Uint8Array,
  contentType = 'video/mp4',
) {
  const sb = getServiceSupabase();
  if (!sb) throw new Error('伺服器未設定 Supabase');
  if (!videoBytes?.length || videoBytes.length < 512) {
    throw new Error('影片太小或無效');
  }

  const ext = contentType.includes('mp4') ? 'mp4' : 'webm';
  const path = roomReplayStoragePath(roomCode, replayId, ext);

  const { error: upErr } = await sb.storage
    .from('replay-videos')
    .upload(path, videoBytes, { contentType, upsert: true });
  if (upErr) throw new Error(upErr.message);

  const { error: patchErr } = await sb
    .from('room_replays')
    .update({ has_video: true, updated_at: new Date().toISOString() })
    .eq('id', replayId)
    .eq('room_code', roomCode.toUpperCase());
  if (patchErr) throw new Error(patchErr.message);

  return roomReplayPublicUrl(roomCode, replayId, ext);
}
