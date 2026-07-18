'use client';

import { useMemo, useState } from 'react';
import { SessionData } from '@/lib/constants';
import { getAllMatches } from '@/lib/tournament';

type Props = {
  sessionData: SessionData | null;
  onAction: (action: string, payload?: Record<string, unknown>) => Promise<void>;
  playerLabel: (id?: string | null) => string;
  onOpenBattle?: () => void;
};

export default function RefereePanel({
  sessionData,
  onAction,
  playerLabel,
  onOpenBattle,
}: Props) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const players = sessionData?.players || [];
  const readyMatches = useMemo(
    () => getAllMatches(sessionData).filter((m) => m.status === 'pending' && m.p1Id && m.p2Id),
    [sessionData],
  );

  const run = async (action: string, payload?: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    try {
      await onAction(action, payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失敗');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="referee-panel" aria-label="裁判控制">
      <h2 className="results-section-title">名單</h2>
      <form
        className="referee-add-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          run('add_player', { name }).then(() => setName(''));
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="新增選手"
          maxLength={16}
          className="player-search"
        />
        <button type="submit" className="lobby-submit" disabled={busy}>加入</button>
      </form>

      <ul className="referee-roster">
        {players.map((p) => (
          <li key={p.id}>
            <span>{p.name}</span>
            <button
              type="button"
              className="replay-nav-btn"
              disabled={busy}
              onClick={() => run('remove_player', { playerId: p.id })}
            >
              刪除
            </button>
          </li>
        ))}
        {!players.length && <li className="referee-empty">尚未有選手</li>}
      </ul>

      <div className="referee-actions">
        <button
          type="button"
          className="lobby-submit"
          disabled={busy || players.length < 2}
          onClick={() => run('run_draw')}
        >
          {sessionData?.drawn ? '重新抽籤' : '抽籤產生賽程'}
        </button>
        <button
          type="button"
          className="replay-nav-btn"
          disabled={busy || !sessionData?.drawn}
          onClick={() => run('reset_schedule')}
        >
          重設賽程
        </button>
      </div>

      <h2 className="results-section-title">計分</h2>
      <p className="referee-empty">
        請用「對戰計分」分頁（殘存／爆裂／擊飛／極致）。
        {readyMatches.length > 0
          ? ` 目前有 ${readyMatches.length} 場可打。`
          : ' 抽籤並配對後即可計分。'}
      </p>
      {onOpenBattle && (
        <button type="button" className="lobby-submit" onClick={onOpenBattle}>
          前往對戰計分
        </button>
      )}

      {readyMatches.length > 0 && (
        <ul className="referee-ready-list">
          {readyMatches.slice(0, 8).map((m) => (
            <li key={m.id}>
              <span>{m.label || m.id}</span>
              <span className="referee-ready-vs">
                {playerLabel(m.p1Id)} vs {playerLabel(m.p2Id)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="lobby-error">{error}</p>}
    </section>
  );
}
