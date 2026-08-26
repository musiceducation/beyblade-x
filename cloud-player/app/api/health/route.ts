import { NextRequest } from 'next/server';
import {
  formatRoomsDbError,
  getServiceSupabase,
  getSupabaseUrl,
  roomsDbConfigError,
} from '@/lib/rooms-server';
import { jsonWithCors, optionsResponse } from '@/lib/cors';

export async function OPTIONS(req: NextRequest) {
  return optionsResponse(req);
}

/** Lightweight readiness for rooms DB (used to diagnose create-room fetch failures). */
export async function GET(req: NextRequest) {
  const configError = roomsDbConfigError();
  if (configError) {
    return jsonWithCors(
      req,
      { ok: false, rooms: false, error: configError },
      { status: 503 },
    );
  }

  const sb = getServiceSupabase();
  if (!sb) {
    return jsonWithCors(
      req,
      { ok: false, rooms: false, error: '伺服器未設定' },
      { status: 503 },
    );
  }

  const { error } = await sb.from('rooms').select('code').limit(1);
  if (error) {
    return jsonWithCors(
      req,
      {
        ok: false,
        rooms: false,
        supabaseHost: (() => {
          try {
            return new URL(getSupabaseUrl()).host;
          } catch {
            return null;
          }
        })(),
        error: formatRoomsDbError(error),
      },
      { status: 503 },
    );
  }

  return jsonWithCors(req, { ok: true, rooms: true });
}
