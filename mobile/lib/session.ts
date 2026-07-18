import AsyncStorage from '@react-native-async-storage/async-storage';
import { RoomSession } from './types';

const KEY = 'beybattle-room-v1';

export async function loadRoomSession(): Promise<RoomSession | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as RoomSession) : null;
  } catch {
    return null;
  }
}

export async function saveRoomSession(session: RoomSession) {
  await AsyncStorage.setItem(KEY, JSON.stringify(session));
}

export async function clearRoomSession() {
  await AsyncStorage.removeItem(KEY);
}
