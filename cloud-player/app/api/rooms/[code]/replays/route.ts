import { NextRequest } from 'next/server';
import { verifyRefereeToken } from '@/lib/room-auth';
import { getServiceSupabase } from '@/lib/rooms-server';
import {
  listRoomReplays,
  toPublicReplay,
  upsertRoomReplayMeta,
} from '@/lib/room-replays-server';
import { jsonWithCors, optionsResponse } from '@/lib/cors';

type Ctx = { params: Promise<{ code: string }> };

export async function OPTIONS(req: NextRequest) {
  return optionsResponse(req);
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { code: raw } = await ctx.params;
  const code = raw.toUpperCase();
  const sb = getServiceSupabase();
  if (!sb) {
    return jsonWithCors(req, { error: '伺服器未設定' }, { status: 503 });
  }

  const { data: room } = await sb.from('rooms').select('code').eq('code', code).maybeSingle();
  if (!room) return jsonWithCors(req, { error: '找不到房間' }, { status: 404 });

  try {
    const replays = await listRoomReplays(code);
    return jsonWithCors(req, { replays });
  } catch (e) {
    return jsonWithCors(req, { error: e instanceof Error ? e.message : '讀取回放失敗' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { code: raw } = await ctx.params;
  const code = raw.toUpperCase();
  const sb = getServiceSupabase();
  if (!sb) {
    return jsonWithCors(req, { error: '伺服器未設定' }, { status: 503 });
  }

  const token = String(req.headers.get('x-referee-token') || '');
  if (!verifyRefereeToken(code, token)) {
    return jsonWithCors(req, { error: '需要裁判權限' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const id = String(body.id || '').trim();
  if (!id) return jsonWithCors(req, { error: '缺少回放 id' }, { status: 400 });

  const { data: room } = await sb.from('rooms').select('code').eq('code', code).maybeSingle();
  if (!room) return jsonWithCors(req, { error: '找不到房間' }, { status: 404 });

  try {
    const row = await upsertRoomReplayMeta(code, {
      id,
      matchId: body.matchId ? String(body.matchId) : null,
      battleNum: body.battleNum != null ? Number(body.battleNum) : undefined,
      metadata: typeof body.metadata === 'object' && body.metadata ? body.metadata : {
        matchLabel: body.matchLabel,
        roomCode: code,
        createdAt: body.createdAt,
      },
    });
    return jsonWithCors(req, { replay: toPublicReplay(row) });
  } catch (e) {
    return jsonWithCors(req, { error: e instanceof Error ? e.message : '建立回放失敗' }, { status: 500 });
  }
}
