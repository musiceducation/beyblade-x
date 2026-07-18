import { NextRequest } from 'next/server';
import { issueRefereeToken, verifyRefereePassword } from '@/lib/room-auth';
import { getServiceSupabase, RoomRow } from '@/lib/rooms-server';
import { jsonWithCors, optionsResponse } from '@/lib/cors';

type Ctx = { params: Promise<{ code: string }> };

export async function OPTIONS(req: NextRequest) {
  return optionsResponse(req);
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { code: raw } = await ctx.params;
  const code = raw.toUpperCase();
  const sb = getServiceSupabase();
  if (!sb) {
    return jsonWithCors(req, { error: '伺服器未設定' }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const password = String(body.refereePassword || '');

  const { data, error } = await sb.from('rooms').select('*').eq('code', code).maybeSingle();
  if (error) return jsonWithCors(req, { error: error.message }, { status: 500 });
  if (!data) return jsonWithCors(req, { error: '找不到房間' }, { status: 404 });

  const row = data as RoomRow;
  if (!verifyRefereePassword(password, row.referee_password_hash)) {
    return jsonWithCors(req, { error: '裁判密碼錯誤' }, { status: 401 });
  }

  return jsonWithCors(req, { refereeToken: issueRefereeToken(code) });
}
