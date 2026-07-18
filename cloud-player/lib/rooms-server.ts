import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SessionData } from '@/lib/constants';
import { createEmptySessionData } from '@/lib/tournament-engine';

export type RoomRow = {
  code: string;
  referee_password_hash: string;
  revision: number;
  updated_at: string;
  junior: SessionData;
  senior: SessionData;
  live: Record<string, unknown> | null;
  created_at?: string;
};

export type PublicRoom = Omit<RoomRow, 'referee_password_hash'>;

let adminClient: SupabaseClient | null = null;

export function getServiceSupabase() {
  if (adminClient) return adminClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  adminClient = createClient(url, key, { auth: { persistSession: false } });
  return adminClient;
}

export function toPublicRoom(row: RoomRow): PublicRoom {
  const { referee_password_hash: _, ...rest } = row;
  return rest;
}

export function emptyRoomPayload() {
  return {
    junior: createEmptySessionData(),
    senior: createEmptySessionData(),
    live: {},
    revision: 0,
  };
}
