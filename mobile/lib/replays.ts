import AsyncStorage from '@react-native-async-storage/async-storage';
import { LocalReplay } from './types';

const KEY = 'beybattle-replays-v1';

export async function loadLocalReplays(roomCode?: string): Promise<LocalReplay[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const all = raw ? (JSON.parse(raw) as LocalReplay[]) : [];
    if (!roomCode) return all.sort((a, b) => b.createdAt - a.createdAt);
    return all
      .filter((r) => r.roomCode === roomCode.toUpperCase())
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

async function persist(all: LocalReplay[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(all.slice(0, 80)));
}

export async function saveLocalReplay(replay: LocalReplay) {
  const all = await loadLocalReplays();
  all.unshift(replay);
  await persist(all);
}

export async function markReplayUploaded(id: string, cloudVideoUrl: string | null) {
  const all = await loadLocalReplays();
  const idx = all.findIndex((r) => r.id === id);
  if (idx < 0) return;
  all[idx] = { ...all[idx]!, uploaded: true, cloudVideoUrl: cloudVideoUrl || undefined };
  await persist(all);
}

export async function updateLocalReplay(id: string, patch: Partial<LocalReplay>) {
  const all = await loadLocalReplays();
  const idx = all.findIndex((r) => r.id === id);
  if (idx < 0) return;
  all[idx] = { ...all[idx]!, ...patch };
  await persist(all);
}

export async function clearLocalReplays(roomCode?: string) {
  if (!roomCode) {
    await AsyncStorage.removeItem(KEY);
    return;
  }
  const all = await loadLocalReplays();
  const next = all.filter((r) => r.roomCode !== roomCode.toUpperCase());
  await persist(next);
}

export async function countPendingUploads(roomCode: string) {
  const all = await loadLocalReplays(roomCode);
  return all.filter((r) => !r.uploaded).length;
}
