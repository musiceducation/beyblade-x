import { getApiBase } from './rooms-api';
import { LocalReplay } from './types';
import { markReplayUploaded } from './replays';

export type CloudReplay = {
  id: string;
  room_code: string;
  match_id: string | null;
  battle_num: number | null;
  metadata: Record<string, unknown>;
  has_video: boolean;
  created_at: string;
  videoUrl: string | null;
};

async function parseJson(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function listCloudReplays(roomCode: string): Promise<CloudReplay[]> {
  const res = await fetch(`${getApiBase()}/api/rooms/${encodeURIComponent(roomCode)}/replays`, {
    cache: 'no-store',
  });
  const data = await parseJson(res);
  return (data.replays || []) as CloudReplay[];
}

export async function uploadLiveFrame(
  roomCode: string,
  refereeToken: string,
  uri: string,
): Promise<void> {
  const code = roomCode.toUpperCase();
  const base = getApiBase();
  const form = new FormData();
  form.append('frame', {
    uri,
    name: 'live.jpg',
    type: 'image/jpeg',
  } as unknown as Blob);

  await parseJson(await fetch(`${base}/api/rooms/${encodeURIComponent(code)}/live-frame`, {
    method: 'POST',
    headers: { 'x-referee-token': refereeToken },
    body: form,
  }));
}

export async function uploadReplayToCloud(
  replay: LocalReplay,
  refereeToken: string,
): Promise<{ videoUrl: string | null }> {
  const code = replay.roomCode.toUpperCase();
  const base = getApiBase();

  await parseJson(await fetch(`${base}/api/rooms/${encodeURIComponent(code)}/replays`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-referee-token': refereeToken,
    },
    body: JSON.stringify({
      id: replay.id,
      matchId: replay.matchId,
      battleNum: replay.battleNum,
      matchLabel: replay.matchLabel,
      createdAt: replay.createdAt,
      metadata: {
        matchLabel: replay.matchLabel,
        roomCode: code,
        battleNum: replay.battleNum,
        createdAt: replay.createdAt,
      },
    }),
  }));

  const form = new FormData();
  form.append('video', {
    uri: replay.uri,
    name: `${replay.id}.mp4`,
    type: 'video/mp4',
  } as unknown as Blob);

  const videoRes = await fetch(
    `${base}/api/rooms/${encodeURIComponent(code)}/replays/${encodeURIComponent(replay.id)}/video`,
    {
      method: 'POST',
      headers: { 'x-referee-token': refereeToken },
      body: form,
    },
  );
  const videoData = await parseJson(videoRes);

  await markReplayUploaded(replay.id, videoData.videoUrl || null);
  return { videoUrl: videoData.videoUrl || null };
}

export async function uploadPendingReplays(
  roomCode: string,
  refereeToken: string,
  local: LocalReplay[],
): Promise<number> {
  const pending = local.filter((r) => !r.uploaded && r.roomCode === roomCode.toUpperCase());
  let ok = 0;
  for (const replay of pending) {
    try {
      await uploadReplayToCloud(replay, refereeToken);
      ok += 1;
    } catch (e) {
      console.warn('replay upload failed', replay.id, e);
    }
  }
  return ok;
}

export function cloudToDisplay(replay: CloudReplay) {
  const meta = replay.metadata || {};
  return {
    id: replay.id,
    title: String(meta.matchLabel || replay.match_id || '對戰'),
    battleNum: replay.battle_num || Number(meta.battleNum) || 1,
    createdAt: replay.created_at,
    uri: replay.videoUrl || '',
    cloud: true as const,
    hasVideo: replay.has_video,
  };
}
