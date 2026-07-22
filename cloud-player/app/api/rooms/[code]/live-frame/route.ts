import { NextRequest } from 'next/server';
import { verifyRefereeToken } from '@/lib/room-auth';
import { uploadRoomLiveFrame } from '@/lib/room-live-frame';
import { jsonWithCors, optionsResponse } from '@/lib/cors';

type Ctx = { params: Promise<{ code: string }> };

export async function OPTIONS(req: NextRequest) {
  return optionsResponse(req);
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { code: raw } = await ctx.params;
  const code = raw.toUpperCase();
  const token = String(req.headers.get('x-referee-token') || '');
  if (!verifyRefereeToken(code, token)) {
    return jsonWithCors(req, { error: '需要裁判權限' }, { status: 401 });
  }

  const contentType = req.headers.get('content-type') || 'image/jpeg';
  let bytes: Buffer;

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('frame') || form.get('image');
    if (!file || typeof file === 'string') {
      return jsonWithCors(req, { error: '缺少 frame 圖片' }, { status: 400 });
    }
    bytes = Buffer.from(await (file as Blob).arrayBuffer());
  } else {
    bytes = Buffer.from(await req.arrayBuffer());
    if (!bytes.length) {
      return jsonWithCors(req, { error: '空的圖片內容' }, { status: 400 });
    }
  }

  try {
    const result = await uploadRoomLiveFrame(code, bytes);
    return jsonWithCors(req, { ok: true, ...result });
  } catch (e) {
    return jsonWithCors(req, { error: e instanceof Error ? e.message : '上傳失敗' }, { status: 500 });
  }
}
