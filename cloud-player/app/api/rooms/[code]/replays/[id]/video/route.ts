import { NextRequest } from 'next/server';
import { verifyRefereeToken } from '@/lib/room-auth';
import { uploadRoomReplayVideo } from '@/lib/room-replays-server';
import { jsonWithCors, optionsResponse } from '@/lib/cors';

type Ctx = { params: Promise<{ code: string; id: string }> };

export async function OPTIONS(req: NextRequest) {
  return optionsResponse(req);
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { code: raw, id } = await ctx.params;
  const code = raw.toUpperCase();
  const replayId = String(id || '').trim();
  if (!replayId) {
    return jsonWithCors(req, { error: '缺少回放 id' }, { status: 400 });
  }

  const token = String(req.headers.get('x-referee-token') || '');
  if (!verifyRefereeToken(code, token)) {
    return jsonWithCors(req, { error: '需要裁判權限' }, { status: 401 });
  }

  const contentType = req.headers.get('content-type') || 'video/mp4';
  let bytes: Buffer;

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('video');
    if (!file || typeof file === 'string') {
      return jsonWithCors(req, { error: '缺少 video 檔案' }, { status: 400 });
    }
    const ab = await (file as Blob).arrayBuffer();
    bytes = Buffer.from(ab);
  } else {
    const ab = await req.arrayBuffer();
    bytes = Buffer.from(ab);
    if (!bytes.length) {
      return jsonWithCors(req, { error: '空的影片內容' }, { status: 400 });
    }
  }

  try {
    const videoUrl = await uploadRoomReplayVideo(code, replayId, bytes, contentType.split(';')[0] || 'video/mp4');
    return jsonWithCors(req, { ok: true, videoUrl });
  } catch (e) {
    return jsonWithCors(req, { error: e instanceof Error ? e.message : '上傳失敗' }, { status: 500 });
  }
}

export const maxDuration = 120;
