'use client';

import { PHASE_LABELS } from '@/lib/constants';
import { SessionData } from '@/lib/constants';
import {
  computeAwards,
  computeStandings,
  getAllMatches,
  playerName,
} from '@/lib/tournament';

type Props = {
  sessionData: SessionData | null;
  sessionLabel: string;
  search: string;
};

export default function ResultsTab({ sessionData, sessionLabel, search }: Props) {
  const standings = computeStandings(sessionData);
  const awards = computeAwards(sessionData);
  const filtered = search
    ? standings.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()))
    : standings;

  const playerMatches = search && sessionData
    ? getAllMatches(sessionData).filter((m) => {
      if (m.status !== 'done') return false;
      const q = search.toLowerCase();
      return playerName(sessionData, m.p1Id).toLowerCase().includes(q)
        || playerName(sessionData, m.p2Id).toLowerCase().includes(q);
    })
    : [];

  if (!sessionData?.drawn) {
    return <p className="player-empty">尚未抽籤或建立賽程</p>;
  }

  return (
    <div className="results-panel">
      {awards && (
        <section className="results-awards" aria-label="頒獎名單">
          <h2 className="results-section-title">🏆 頒獎</h2>
          <ul className="results-award-list">
            <li><span className="results-award-rank">冠軍</span> {awards.champion}</li>
            <li><span className="results-award-rank">亞軍</span> {awards.runnerUp}</li>
            <li><span className="results-award-rank">四強</span> {awards.top4.join('、')}</li>
          </ul>
        </section>
      )}

      <section className="results-standings" aria-label="勝負統計">
        <h2 className="results-section-title">📊 勝負統計</h2>
        {!filtered.length ? (
          <p className="player-empty">{search ? '找不到相關選手' : '尚無完場資料'}</p>
        ) : (
          <ol className="results-standing-list">
            {filtered.map((s, i) => {
              const highlight = search && s.name.toLowerCase().includes(search.toLowerCase());
              return (
                <li key={s.id} className={`results-standing-item${highlight ? ' highlight' : ''}`}>
                  <span className="results-standing-rank">{i + 1}</span>
                  <span className="results-standing-name">{s.name}</span>
                  <span className="results-standing-record">{s.wins} 勝 {s.losses} 負</span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {playerMatches.length > 0 && (
        <section className="results-player-matches" aria-label="選手戰績">
          <h2 className="results-section-title">{search} · 對戰紀錄</h2>
          <ul className="results-match-list">
            {playerMatches.map((m) => (
              <li key={m.id} className="results-match-item">
                {m.label || PHASE_LABELS[m.phase] || ''}
                {' · '}
                {playerName(sessionData, m.p1Id)} vs {playerName(sessionData, m.p2Id)}
                {m.scores ? ` — ${m.scores[0]}:${m.scores[1]}` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
