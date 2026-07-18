import Constants from 'expo-constants';
import { PublicRoom, RoomSession } from './types';

function defaultApiBase() {
  const fromEnv = process.env.EXPO_PUBLIC_API_BASE?.replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const host = hostUri.split(':')[0];
    if (host && host !== 'localhost') return `http://${host}:3000`;
  }
  return 'http://localhost:3000';
}

export function getApiBase() {
  return defaultApiBase();
}

async function parseJson(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function createRoom(refereePassword: string): Promise<{
  room: PublicRoom;
  refereeToken: string;
}> {
  const res = await fetch(`${getApiBase()}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refereePassword }),
  });
  return parseJson(res);
}

export async function authReferee(code: string, refereePassword: string): Promise<string> {
  const res = await fetch(`${getApiBase()}/api/rooms/${encodeURIComponent(code)}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refereePassword }),
  });
  const data = await parseJson(res);
  return data.refereeToken as string;
}

export async function getRoom(code: string): Promise<PublicRoom> {
  const res = await fetch(`${getApiBase()}/api/rooms/${encodeURIComponent(code)}`, {
    cache: 'no-store',
  });
  const data = await parseJson(res);
  return data.room as PublicRoom;
}

export async function patchRoom(
  code: string,
  body: Record<string, unknown>,
  refereeToken?: string | null,
): Promise<{ room: PublicRoom; player?: { id: string; name: string } | null }> {
  const res = await fetch(`${getApiBase()}/api/rooms/${encodeURIComponent(code)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(refereeToken ? { 'x-referee-token': refereeToken } : {}),
    },
    body: JSON.stringify(body),
  });
  return parseJson(res);
}

export async function joinAsPlayer(
  code: string,
  name: string,
  refereeToken?: string | null,
): Promise<RoomSession> {
  const data = await patchRoom(
    code,
    { action: 'player_join', session: 'junior', name },
    refereeToken,
  );
  return {
    code: code.toUpperCase(),
    refereeToken: refereeToken || null,
    playerId: data.player?.id || null,
    playerName: data.player?.name || name,
  };
}
