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

const DB_UNREACHABLE_MSG =
  '無法連線資料庫（Supabase URL 無效或專案已暫停／刪除）。請檢查 Vercel 的 NEXT_PUBLIC_SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY 後重新部署。';

export function getSupabaseUrl() {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '');
}

export function getServiceSupabase() {
  if (adminClient) return adminClient;
  const url = getSupabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  adminClient = createClient(url, key, { auth: { persistSession: false } });
  return adminClient;
}

/** Map opaque supabase-js / undici errors into actionable Traditional Chinese. */
export function formatRoomsDbError(error: unknown, fallback = '資料庫操作失敗'): string {
  const raw =
    typeof error === 'string'
      ? error
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message || '')
        : error instanceof Error
          ? error.message
          : '';

  const msg = raw.trim();
  if (!msg) return fallback;

  const lower = msg.toLowerCase();
  if (
    lower.includes('fetch failed')
    || lower.includes('failed to fetch')
    || lower.includes('enotfound')
    || lower.includes('getaddrinfo')
    || lower.includes('name not resolved')
    || lower.includes('nxdomain')
    || lower.includes('network')
    || lower.includes('econnrefused')
    || lower.includes('econnreset')
    || lower.includes('certificate')
    || lower.includes('ssl')
  ) {
    return DB_UNREACHABLE_MSG;
  }

  // Avoid leaking raw TypeError / undici stacks to the phone UI.
  if (/^typeerror:/i.test(msg) || /^error:/i.test(msg)) {
    return DB_UNREACHABLE_MSG;
  }

  return msg;
}

export function roomsDbConfigError(): string | null {
  const url = getSupabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url && !key) {
    return '伺服器未設定 NEXT_PUBLIC_SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY';
  }
  if (!url) return '伺服器未設定 NEXT_PUBLIC_SUPABASE_URL';
  if (!key) return '伺服器未設定 SUPABASE_SERVICE_ROLE_KEY';
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      return 'NEXT_PUBLIC_SUPABASE_URL 必須是 https://';
    }
  } catch {
    return 'NEXT_PUBLIC_SUPABASE_URL 格式無效';
  }
  return null;
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
