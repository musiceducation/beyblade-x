'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Match, PHASE_LABELS, SessionData } from '@/lib/constants';
import { getAllMatches } from '@/lib/tournament';

type FinishType = 'spin' | 'burst' | 'over' | 'extreme';

const FINISH: Record<FinishType, { zh: string; pts: number }> = {
  spin: { zh: '殘存', pts: 1 },
  burst: { zh: '爆裂', pts: 2 },
  over: { zh: '擊飛', pts: 2 },
  extreme: { zh: '極致', pts: 3 },
};

type HistoryEntry = {
  player: 1 | 2;
  type: FinishType;
  pts: number;
  scoresBefore: [number, number];
  battleBefore: number;
};

type Props = {
  sessionData: SessionData | null;
  onAction: (action: string, payload?: Record<string, unknown>) => Promise<void>;
  playerLabel: (id?: string | null) => string;
};

const DEFAULT_TARGET = 4;

export default function BattleScoreboard({ sessionData, onAction, playerLabel }: Props) {
  const [matchId, setMatchId] = useState<string | null>(null);
  const [scores, setScores] = useState<[number, number]>([0, 0]);
  const [battle, setBattle] = useState(1);
  const [target, setTarget] = useState(DEFAULT_TARGET);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lastCall, setLastCall] = useState('');
  const syncTimer = useRef<number | null>(null);

  const readyMatches = useMemo(
    () => getAllMatches(sessionData).filter((m) => m.status === 'pending' && m.p1Id && m.p2Id),
    [sessionData],
  );

  const activeMatch: Match | null = useMemo(() => {
    const id = matchId || sessionData?.activeMatchId || null;
    if (!id) return null;
    return getAllMatches(sessionData).find((m) => m.id === id) || null;
  }, [matchId, sessionData]);

  useEffect(() => {
    if (!activeMatch) return;
    if (activeMatch.status === 'done' && activeMatch.scores) {
      setScores([...(activeMatch.scores as [number, number])]);
      setBattle(activeMatch.battles || 1);
      return;
    }
    const live = activeMatch.liveScores;
    if (live) {
      setScores([live[0] || 0, live[1] || 0]);
      setBattle(activeMatch.liveBattles || 1);
    } else {
      setScores([0, 0]);
      setBattle(1);
    }
    setHistory([]);
    setLastCall('');
  }, [activeMatch?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (action: string, payload?: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    try {
      await onAction(action, payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失敗');
      throw e;
    } finally {
      setBusy(false);
    }
  };

  const pushLive = (
    nextScores: [number, number],
    nextBattle: number,
    id: string,
    finish?: { side: 1 | 2; type: FinishType; pts: number },
  ) => {
    if (syncTimer.current) window.clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(() => {
      run('set_live_scores', {
        matchId: id,
        scores: nextScores,
        battles: nextBattle,
        ...(finish
          ? { finishSide: finish.side, finishType: finish.type, finishPts: finish.pts }
          : {}),
      }).catch(() => {});
    }, 160);
  };

  const selectMatch = async (id: string) => {
    setMatchId(id);
    setHistory([]);
    const match = getAllMatches(sessionData).find((m) => m.id === id);
    const resume = match?.liveScores;
    const nextScores: [number, number] = resume
      ? [resume[0] || 0, resume[1] || 0]
      : [0, 0];
    const nextBattle = match?.liveBattles || 1;
    setScores(nextScores);
    setBattle(nextBattle);
    try {
      await run('set_active', { matchId: id });
      await run('set_live_scores', {
        matchId: id,
        scores: nextScores,
        battles: nextBattle,
      });
    } catch {
      /* error shown */
    }
  };

  const applyScores = (next: [number, number], nextBattle = battle, entry?: HistoryEntry) => {
    if (!activeMatch) return;
    setScores(next);
    setBattle(nextBattle);
    if (entry) setHistory((h) => [...h, entry]);
    pushLive(next, nextBattle, activeMatch.id, entry
      ? { side: entry.player, type: entry.type, pts: entry.pts }
      : undefined);

    if (next[0] >= target || next[1] >= target) {
      const winnerSide: 1 | 2 = next[0] >= target ? 1 : 2;
      window.setTimeout(() => {
        finishMatch(winnerSide, next).catch(() => {});
      }, 280);
    }
  };

  const award = (player: 1 | 2, type: FinishType) => {
    if (!activeMatch || busy || activeMatch.status === 'done') return;
    const pts = FINISH[type].pts;
    const before: [number, number] = [...scores];
    const next: [number, number] = [...scores];
    next[player - 1] += pts;
    setLastCall(`Blader ${player} · ${FINISH[type].zh} +${pts}`);
    applyScores(next, battle, {
      player,
      type,
      pts,
      scoresBefore: before,
      battleBefore: battle,
    });
  };

  const adjust = (player: 1 | 2, delta: number) => {
    if (!activeMatch || busy || activeMatch.status === 'done') return;
    const next: [number, number] = [...scores];
    next[player - 1] = Math.max(0, next[player - 1] + delta);
    applyScores(next, battle);
  };

  const undo = () => {
    if (!history.length || !activeMatch) return;
    const last = history[history.length - 1]!;
    setHistory((h) => h.slice(0, -1));
    setScores(last.scoresBefore);
    setBattle(last.battleBefore);
    setLastCall('已撤銷');
    pushLive(last.scoresBefore, last.battleBefore, activeMatch.id);
  };

  const nextBattle = () => {
    if (!activeMatch || busy) return;
    const nextBattleNum = battle + 1;
    setBattle(nextBattleNum);
    setLastCall(`第 ${nextBattleNum} 局`);
    pushLive(scores, nextBattleNum, activeMatch.id);
  };

  const finishMatch = async (winnerSide: 1 | 2, finalScores = scores) => {
    if (!activeMatch || activeMatch.status === 'done') return;
    await run('record_winner', {
      matchId: activeMatch.id,
      winnerSide,
      scores: finalScores,
      battles: battle,
      autoAdvance: false,
    });
    setLastCall(`${playerLabel(winnerSide === 1 ? activeMatch.p1Id : activeMatch.p2Id)} 勝`);
    setMatchId(null);
  };

  const p1 = activeMatch ? playerLabel(activeMatch.p1Id) : 'Blader 1';
  const p2 = activeMatch ? playerLabel(activeMatch.p2Id) : 'Blader 2';

  return (
    <section className="battle-board" aria-label="對戰計分">
      <div className="battle-board-toolbar">
        <label className="battle-match-pick">
          <span>場次</span>
          <select
            value={activeMatch?.id || ''}
            disabled={busy}
            onChange={(e) => {
              const id = e.target.value;
              if (id) selectMatch(id);
            }}
          >
            <option value="">選擇對戰…</option>
            {readyMatches.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label || m.id} · {playerLabel(m.p1Id)} vs {playerLabel(m.p2Id)}
              </option>
            ))}
          </select>
        </label>
        <label className="battle-target">
          <span>目標</span>
          <select
            value={target}
            onChange={(e) => setTarget(Number(e.target.value) || DEFAULT_TARGET)}
          >
            {[3, 4, 5, 7].map((n) => (
              <option key={n} value={n}>{n} 分制</option>
            ))}
          </select>
        </label>
        <p className="battle-sync-hint">比分會同步到「即時」與直播畫面</p>
      </div>

      {!readyMatches.length && (
        <p className="referee-empty">目前沒有可計分場次 — 請先在「裁判」分頁抽籤並確認配對</p>
      )}

      <div className="battle-board-grid">
        <PlayerColumn
          side={1}
          name={p1}
          score={scores[0]}
          disabled={!activeMatch || busy || activeMatch.status === 'done'}
          onAward={(t) => award(1, t)}
          onAdjust={(d) => adjust(1, d)}
        />

        <div className="battle-center">
          <p className="battle-round">第 {battle} 局</p>
          <p className="battle-phase">
            {activeMatch
              ? (activeMatch.label || PHASE_LABELS[activeMatch.phase] || activeMatch.phase)
              : '尚未選場'}
          </p>
          <p className="battle-call" aria-live="polite">{lastCall || '得分判定'}</p>
          <div className="battle-scoreline" aria-label="比分">
            <strong className="score-p1">{scores[0]}</strong>
            <span>:</span>
            <strong className="score-p2">{scores[1]}</strong>
          </div>
          <div className="battle-center-actions">
            <button type="button" className="lobby-submit" disabled={!activeMatch || busy} onClick={nextBattle}>
              下一局
            </button>
            <button type="button" className="replay-nav-btn" disabled={!history.length || busy} onClick={undo}>
              撤銷
            </button>
            <button
              type="button"
              className="replay-nav-btn"
              disabled={!activeMatch || busy || activeMatch.status === 'done'}
              onClick={() => finishMatch(scores[0] >= scores[1] ? 1 : 2)}
            >
              手動完場
            </button>
          </div>
        </div>

        <PlayerColumn
          side={2}
          name={p2}
          score={scores[1]}
          disabled={!activeMatch || busy || activeMatch.status === 'done'}
          onAward={(t) => award(2, t)}
          onAdjust={(d) => adjust(2, d)}
        />
      </div>

      {error && <p className="lobby-error">{error}</p>}
    </section>
  );
}

function PlayerColumn({
  side,
  name,
  score,
  disabled,
  onAward,
  onAdjust,
}: {
  side: 1 | 2;
  name: string;
  score: number;
  disabled: boolean;
  onAward: (t: FinishType) => void;
  onAdjust: (delta: number) => void;
}) {
  return (
    <div className={`battle-player battle-player--p${side}`}>
      <p className="battle-player-label">Blader {side}</p>
      <h3 className="battle-player-name">{name}</h3>
      <p className="battle-player-score">{score}</p>
      <div className="battle-adj">
        <button type="button" disabled={disabled} onClick={() => onAdjust(-1)} aria-label="減分">−</button>
        <button type="button" disabled={disabled} onClick={() => onAdjust(1)} aria-label="加分">+</button>
      </div>
      <div className="battle-finishes">
        {(Object.keys(FINISH) as FinishType[]).map((type) => (
          <button
            key={type}
            type="button"
            className={`battle-finish battle-finish--${type}`}
            disabled={disabled}
            onClick={() => onAward(type)}
          >
            <span className="battle-finish-name">{FINISH[type].zh}</span>
            <span className="battle-finish-pts">+{FINISH[type].pts}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
