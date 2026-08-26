import { NextRequest } from 'next/server';
import { verifyRefereeToken } from '@/lib/room-auth';
import {
  formatRoomsDbError,
  getServiceSupabase,
  RoomRow,
  roomsDbConfigError,
} from '@/lib/rooms-server';
import { SessionData, ArenaLiveState } from '@/lib/constants';
import {
  addPlayer,
  recordMatchWinner,
  removePlayer,
  renamePlayer,
  replaceSessionData,
  resetSchedule,
  runDraw,
  setActiveMatch,
  setLiveScores,
} from '@/lib/tournament-engine';
import { buildRoomLiveOverlay } from '@/lib/room-live';
import { mergeRoomLiveState } from '@/lib/room-live-frame';
import { getAllMatches } from '@/lib/tournament';
import { jsonWithCors, optionsResponse } from '@/lib/cors';

type Ctx = { params: Promise<{ code: string }> };

function sessionKey(_raw: unknown): 'junior' {
  return 'junior';
}

export async function OPTIONS(req: NextRequest) {
  return optionsResponse(req);
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { code: raw } = await ctx.params;
  const code = raw.toUpperCase();
  const configError = roomsDbConfigError();
  if (configError) {
    return jsonWithCors(req, { error: configError }, { status: 503 });
  }
  const sb = getServiceSupabase();
  if (!sb) {
    return jsonWithCors(req, { error: '伺服器未設定' }, { status: 503 });
  }

  const { data, error } = await sb
    .from('rooms')
    .select('code, revision, updated_at, junior, senior, live, created_at')
    .eq('code', code)
    .maybeSingle();

  if (error) {
    return jsonWithCors(req, { error: formatRoomsDbError(error) }, { status: 500 });
  }
  if (!data) return jsonWithCors(req, { error: '找不到房間' }, { status: 404 });

  return jsonWithCors(req, { room: data });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { code: raw } = await ctx.params;
  const code = raw.toUpperCase();
  const configError = roomsDbConfigError();
  if (configError) {
    return jsonWithCors(req, { error: configError }, { status: 503 });
  }
  const sb = getServiceSupabase();
  if (!sb) {
    return jsonWithCors(req, { error: '伺服器未設定' }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || '');
  const session = sessionKey(body.session);
  const token = String(req.headers.get('x-referee-token') || body.refereeToken || '');

  const { data, error } = await sb.from('rooms').select('*').eq('code', code).maybeSingle();
  if (error) {
    return jsonWithCors(req, { error: formatRoomsDbError(error) }, { status: 500 });
  }
  if (!data) return jsonWithCors(req, { error: '找不到房間' }, { status: 404 });

  const row = data as RoomRow;
  const sessionData = (row[session] || {}) as SessionData;
  if (!sessionData.players) sessionData.players = [];
  if (!sessionData.matches) sessionData.matches = {};

  const needsReferee = action !== 'player_rename' && action !== 'player_join';
  if (needsReferee && !verifyRefereeToken(code, token)) {
    return jsonWithCors(req, { error: '需要裁判權限' }, { status: 401 });
  }

  let result: { ok: boolean; error?: string; player?: { id: string; name: string } } = { ok: true };
  let live: ArenaLiveState | Record<string, unknown> | null = row.live;

  switch (action) {
    case 'add_player':
      result = addPlayer(sessionData, String(body.name || ''));
      break;
    case 'player_join':
      result = addPlayer(sessionData, String(body.name || ''));
      if (!result.ok && result.error === '名字已存在') {
        const existing = sessionData.players.find((p) => p.name === String(body.name || '').trim().slice(0, 16));
        if (existing) result = { ok: true, player: existing };
      }
      break;
    case 'rename_player':
    case 'player_rename':
      result = renamePlayer(sessionData, String(body.playerId || ''), String(body.name || ''));
      break;
    case 'remove_player':
      result = removePlayer(sessionData, String(body.playerId || ''));
      break;
    case 'run_draw':
      result = runDraw(sessionData);
      break;
    case 'reset_schedule':
      result = resetSchedule(sessionData);
      live = mergeRoomLiveState(row.live, { updatedAt: Date.now(), session, active: false, matchOver: true, broadcastStatus: 'live' });
      break;
    case 'replace_session': {
      const incoming = body.sessionData as SessionData | undefined;
      if (!incoming || typeof incoming !== 'object') {
        result = { ok: false, error: '缺少 sessionData' };
        break;
      }
      result = replaceSessionData(sessionData, incoming);
      if (result.ok) {
        live = sessionData.activeMatchId
          ? mergeRoomLiveState(row.live, buildRoomLiveOverlay(session, sessionData, { matchId: sessionData.activeMatchId }))
          : mergeRoomLiveState(row.live, { updatedAt: Date.now(), session, active: false, matchOver: true, broadcastStatus: 'live' });
      }
      break;
    }
    case 'record_winner': {
      const side = body.winnerSide === 2 ? 2 : 1;
      const scores = Array.isArray(body.scores)
        ? [Number(body.scores[0]) || 0, Number(body.scores[1]) || 0] as [number, number]
        : undefined;
      const battles = body.battles != null ? Number(body.battles) : undefined;
      const matchId = String(body.matchId || '');
      result = recordMatchWinner(sessionData, matchId, side, scores, battles);
      if (result.ok) {
        live = mergeRoomLiveState(row.live, buildRoomLiveOverlay(session, sessionData, { matchId, matchOver: true }));
        const autoAdvance = body.autoAdvance !== false;
        if (autoAdvance) {
          const nextReady = getAllMatches(sessionData).find((m) => m.status === 'pending' && m.p1Id && m.p2Id);
          if (nextReady) {
            sessionData.activeMatchId = nextReady.id;
          }
        }
      }
      break;
    }
    case 'set_active':
      result = setActiveMatch(sessionData, body.matchId ? String(body.matchId) : null);
      if (result.ok) {
        live = body.matchId
          ? mergeRoomLiveState(row.live, buildRoomLiveOverlay(session, sessionData, { matchId: String(body.matchId) }))
          : mergeRoomLiveState(row.live, { updatedAt: Date.now(), session, active: false, matchOver: true, broadcastStatus: 'live' });
      }
      break;
    case 'set_live_scores': {
      const scores = [
        Number(body.scores?.[0]) || 0,
        Number(body.scores?.[1]) || 0,
      ] as [number, number];
      const matchId = String(body.matchId || '');
      const battles = body.battles != null ? Number(body.battles) : undefined;
      result = setLiveScores(sessionData, matchId, scores, battles);
      if (result.ok) {
        const overlay = buildRoomLiveOverlay(session, sessionData, { matchId });
        const finishSide = body.finishSide === 2 ? 2 : body.finishSide === 1 ? 1 : null;
        if (finishSide && body.finishType) {
          overlay.finishSide = finishSide;
          overlay.finishType = String(body.finishType);
          overlay.finishPts = Number(body.finishPts) || 1;
          overlay.finishAt = Date.now();
        }
        live = mergeRoomLiveState(row.live, overlay);
      }
      break;
    }
    case 'set_webrtc_live': {
      const prev = (row.live || {}) as ArenaLiveState;
      live = mergeRoomLiveState(prev, {
        ...prev,
        updatedAt: Date.now(),
        webrtcLive: Boolean(body.active),
        webrtcMode: body.mode === 'screen' ? 'screen' : 'camera',
      });
      result = { ok: true };
      break;
    }
    default:
      return jsonWithCors(req, { error: `未知操作：${action}` }, { status: 400 });
  }

  if (!result.ok) {
    return jsonWithCors(req, { error: result.error || '操作失敗' }, { status: 400 });
  }

  const nextRevision = Number(row.revision || 0) + 1;
  const { data: updated, error: upErr } = await sb
    .from('rooms')
    .update({
      [session]: sessionData,
      live,
      revision: nextRevision,
      updated_at: new Date().toISOString(),
    })
    .eq('code', code)
    .select('code, revision, updated_at, junior, senior, live, created_at')
    .single();

  if (upErr) {
    return jsonWithCors(req, { error: formatRoomsDbError(upErr) }, { status: 500 });
  }

  return jsonWithCors(req, {
    room: updated,
    player: result.player || null,
  });
}
