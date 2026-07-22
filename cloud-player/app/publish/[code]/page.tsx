'use client';

import { use, useMemo } from 'react';
import RoomLiveCamera from '@/components/RoomLiveCamera';

type Props = {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ token?: string }>;
};

export default function PublishPage({ params, searchParams }: Props) {
  const { code: rawCode } = use(params);
  const { token } = use(searchParams);
  const code = useMemo(() => rawCode.toUpperCase(), [rawCode]);

  if (!token) {
    return (
      <div className="portal-shell">
        <p className="lobby-error">缺少裁判憑證，請由 App「鏡頭」重新開啟即時直播。</p>
      </div>
    );
  }

  return (
    <div className="portal-shell">
      <header className="lobby-header" style={{ marginBottom: 16 }}>
        <p className="lobby-kicker">BEYBATTLE · 即時直播</p>
        <h1 className="lobby-title">房間 {code}</h1>
        <p className="lobby-hint">
          連續影音 + 聲音（音樂／咪）。選「分享畫面 + 音樂」時請勾選分享音訊；觀眾可全螢幕放大或縮回。
        </p>
      </header>
      <RoomLiveCamera code={code} refereeToken={token} />
    </div>
  );
}
