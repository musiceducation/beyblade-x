'use client';

import { useMemo } from 'react';
import { PHASE_LABELS, SessionData } from '@/lib/constants';
import MatchCard from '@/components/MatchCard';
import {
  getAllMatches,
  matchInvolvesName,
  playerName,
  sessionStats,
  sortMatches,
} from '@/lib/tournament';
import type { Match } from '@/lib/constants';

type Props = {
  sessionData: SessionData | null;
  search: string;
};

export default function LiveTab({ sessionData, search }: Props) {
  const matches = useMemo(() => getAllMatches(sessionData), [sessionData]);
  const stats = useMemo(() => sessionStats(matches), [matches]);

  const active = matches.find((m) => m.id === sessionData?.activeMatchId);
  const activeValid = active?.p1Id && active?.p2Id ? active : null;

  const upcoming = useMemo(() =>
    sortMatches(
      matches
        .filter((m) => m.status === 'pending' && m.p1Id && m.p2Id)
        .filter((m) => matchInvolvesName(m, sessionData, search)),
    ).slice(0, 4),
  [matches, sessionData, search]);

  const recent = useMemo(() =>
    sortMatches(
      matches
        .filter((m) => m.status === 'done' && (m.p1Id || m.p2Id))
        .filter((m) => matchInvolvesName(m, sessionData, search)),
    )
      .reverse()
      .slice(0, 3),
  [matches, sessionData, search]);

  if (!sessionData?.drawn) {
    return (
      <section className="player-section" aria-label="即時比分">
        <div className="portal-empty">
          <span className="portal-empty-icon" aria-hidden="true">🎯</span>
          <p>尚未抽籤</p>
          <p className="portal-empty-hint">賽程建立後會顯示即時比分</p>
        </div>
      </section>
    );
  }

  return (
    <section className="player-section live-tab" aria-label="即時比分">
      <div className="live-summary">
        <div className="live-summary-stat">
          <strong>{stats.done}</strong>
          <span>已完</span>
        </div>
        <div className="live-summary-bar" aria-hidden="true">
          <div className="live-summary-bar-fill" style={{ width: `${stats.pct}%` }} />
        </div>
        <div className="live-summary-stat">
          <strong>{stats.total}</strong>
          <span>總場</span>
        </div>
      </div>

      {activeValid ? (
        <div className="live-hero">
          <p className="live-hero-label">進行中</p>
          <h2 className="live-hero-title">
            {activeValid.label || PHASE_LABELS[activeValid.phase] || '對戰'}
          </h2>
          <div className="live-hero-scores">
            <div className="live-hero-player live-hero-player--red">
              <span>{playerName(sessionData, activeValid.p1Id)}</span>
              <strong>{(activeValid.liveScores || activeValid.scores || [0, 0])[0]}</strong>
            </div>
            <span className="live-hero-vs">VS</span>
            <div className="live-hero-player live-hero-player--blue">
              <span>{playerName(sessionData, activeValid.p2Id)}</span>
              <strong>{(activeValid.liveScores || activeValid.scores || [0, 0])[1]}</strong>
            </div>
          </div>
          <p className="live-hero-battle">
            {activeValid.liveBattles || activeValid.battles
              ? `第 ${activeValid.liveBattles || activeValid.battles} 局`
              : '比賽進行中'}
          </p>
        </div>
      ) : (
        <div className="portal-empty portal-empty--inline">
          <p>目前沒有進行中的對戰</p>
          {stats.pending > 0 && (
            <p className="portal-empty-hint">{stats.pending} 場待賽</p>
          )}
        </div>
      )}

      {upcoming.length > 0 && (
        <div className="live-block">
          <h3 className="live-block-title">即將開始</h3>
          <ul className="match-card-list">
            {upcoming.map((m: Match) => (
              <li key={m.id}>
                <MatchCard match={m} data={sessionData} activeMatchId={sessionData?.activeMatchId} compact />
              </li>
            ))}
          </ul>
        </div>
      )}

      {recent.length > 0 && (
        <div className="live-block">
          <h3 className="live-block-title">最近結果</h3>
          <ul className="match-card-list">
            {recent.map((m: Match) => (
              <li key={m.id}>
                <MatchCard match={m} data={sessionData} activeMatchId={sessionData?.activeMatchId} compact />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
