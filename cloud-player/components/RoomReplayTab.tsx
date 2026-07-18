'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PublicRoomReplay } from '@/lib/room-replays-server';

type Props = {
  code: string;
  search: string;
};

export default function RoomReplayTab({ code, search }: Props) {
  const [replays, setReplays] = useState<PublicRoomReplay[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const res = await fetch(`/api/rooms/${encodeURIComponent(code)}/replays`, { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '讀取回放失敗');
    const list = (data.replays || []) as PublicRoomReplay[];
    setReplays(list);
    if (!activeId) {
      const first = list.find((r) => r.has_video && r.videoUrl);
      if (first) setActiveId(first.id);
    }
  }, [activeId, code]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        await load();
        if (!cancelled) setError('');
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '載入失敗');
      }
    };
    tick();
    const id = window.setInterval(tick, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [load]);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? replays.filter((r) => {
      const label = String(r.metadata?.matchLabel || r.match_id || '').toLowerCase();
      return label.includes(q);
    })
    : replays;

  const active = replays.find((r) => r.id === activeId) || filtered.find((r) => r.videoUrl);

  return (
    <section className="player-section room-replay-tab" aria-label="對戰回放">
      {error && <p className="lobby-error">{error}</p>}

      {active?.videoUrl ? (
        <div className="room-replay-player">
          <video
            key={active.id}
            className="room-replay-video"
            src={active.videoUrl}
            controls
            playsInline
            autoPlay
            muted
          />
          <p className="room-replay-caption">
            {String(active.metadata?.matchLabel || '對戰')}
            {active.battle_num ? ` · 第 ${active.battle_num} 局` : ''}
          </p>
        </div>
      ) : (
        <p className="portal-empty">尚未有對戰回放 — 裁判可在 App「鏡頭」錄製</p>
      )}

      {filtered.length > 0 && (
        <ul className="room-replay-list">
          {filtered.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className={`room-replay-item${active?.id === r.id ? ' active' : ''}`}
                disabled={!r.videoUrl}
                onClick={() => setActiveId(r.id)}
              >
                <span>{String(r.metadata?.matchLabel || '對戰')}</span>
                <span className="room-replay-meta">
                  {r.battle_num ? `第 ${r.battle_num} 局 · ` : ''}
                  {r.has_video ? '可播放' : '處理中'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
