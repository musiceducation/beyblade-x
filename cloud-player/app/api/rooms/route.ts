import { NextRequest } from 'next/server';
import {
  generateRoomCode,
  hashRefereePassword,
  issueRefereeToken,
} from '@/lib/room-auth';
import {
  emptyRoomPayload,
  formatRoomsDbError,
  getServiceSupabase,
  roomsDbConfigError,
  toPublicRoom,
  RoomRow,
} from '@/lib/rooms-server';
import { jsonWithCors, optionsResponse } from '@/lib/cors';

export async function OPTIONS(req: NextRequest) {
  return optionsResponse(req);
}

export async function POST(req: NextRequest) {
  const configError = roomsDbConfigError();
  if (configError) {
    return jsonWithCors(req, { error: configError }, { status: 503 });
  }

  const sb = getServiceSupabase();
  if (!sb) {
    return jsonWithCors(
      req,
      { error: '伺服器未設定 SUPABASE_SERVICE_ROLE_KEY' },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const password = String(body.refereePassword || '').trim();
  if (password.length < 4) {
    return jsonWithCors(req, { error: '裁判密碼至少 4 個字元' }, { status: 400 });
  }

  const payload = emptyRoomPayload();
  let code = '';
  let row: RoomRow | null = null;

  for (let attempt = 0; attempt < 8; attempt++) {
    code = generateRoomCode(6);
    const { data, error } = await sb
      .from('rooms')
      .insert({
        code,
        referee_password_hash: hashRefereePassword(password),
        revision: 0,
        junior: payload.junior,
        senior: payload.senior,
        live: payload.live,
      })
      .select('*')
      .single();

    if (!error && data) {
      row = data as RoomRow;
      break;
    }
    if (error?.code !== '23505') {
      return jsonWithCors(
        req,
        { error: formatRoomsDbError(error, '建立房間失敗') },
        { status: 500 },
      );
    }
  }

  if (!row) {
    return jsonWithCors(req, { error: '無法產生可用房號，請重試' }, { status: 500 });
  }

  return jsonWithCors(req, {
    room: toPublicRoom(row),
    refereeToken: issueRefereeToken(row.code),
  });
}
