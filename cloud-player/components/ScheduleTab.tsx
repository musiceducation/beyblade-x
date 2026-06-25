'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { PHASE_LABELS, SessionData } from '@/lib/constants';
import MatchCard from '@/components/MatchCard';
import {
  PhaseFilter,
  PHASE_LIST,
  getAllMatches,
  groupMatchesByPhase,
  matchInvolvesName,
  sessionStats,
  sortMatches,
} from '@/lib/tournament';

type Props = {
  sessionData: SessionData | null;
  sessionLabel: string;
  search: string;
};

export default function ScheduleTab({ sessionData, sessionLabel, search }: Props) {
  const [phaseFilter, setPhaseFilter] = useState<PhaseFilter>('all');
  const activeRef = useRef<HTMLLIElement>(null);

  const matches = useMemo(() => getAllMatches(sessionData), [sessionData]);
  const stats = useMemo(() => sessionStats(matches), [matches]);

  const filtered = useMemo(() => {
    const bySearch = search
      ? matches.filter((m) => matchInvolvesName(m, sessionData, search))
      : matches;
    const byPhase = phaseFilter === 'all'
      ? bySearch
      : bySearch.filter((m) => m.phase === phaseFilter);
    return sortMatches(byPhase);
  }, [matches, sessionData, search, phaseFilter]);

  const grouped = useMemo(() => groupMatchesByPhase(filtered), [filtered]);

  const phasesWithMatches = useMemo(() => {
    const set = new Set(matches.map((m) => m.phase));
    return PHASE_LIST.filter((p) => set.has(p));
  }, [matches]);

  useEffect(() => {
    if (!sessionData?.activeMatchId || search) return;
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [sessionData?.activeMatchId, search, phaseFilter]);

  if (!sessionData?.drawn) {
    return (
      <section className="player-section" aria-label="賽程表">
        <div className="portal-empty">
          <span className="portal-empty-icon" aria-hidden="true">📋</span>
          <p>尚未抽籤或建立賽程</p>
        </div>
      </section>
    );
  }

  return (
    <section className="player-section schedule-tab" aria-label="賽程表">
      <div className="schedule-overview">
        <div className="schedule-overview-top">
          <strong>{sessionLabel}</strong>
          <span>{stats.done}/{stats.total} 場 · {stats.pct}%</span>
        </div>
        <div className="schedule-progress-bar" role="progressbar" aria-valuenow={stats.pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="schedule-progress-bar-fill" style={{ width: `${stats.pct}%` }} />
        </div>
      </div>

      {phasesWithMatches.length > 1 && (
        <div className="phase-filters" role="tablist" aria-label="賽程階段">
          <button
            type="button"
            role="tab"
            className={`phase-filter${phaseFilter === 'all' ? ' active' : ''}`}
            onClick={() => setPhaseFilter('all')}
          >
            全部
          </button>
          {phasesWithMatches.map((phase) => (
            <button
              key={phase}
              type="button"
              role="tab"
              className={`phase-filter phase-filter--${phase}${phaseFilter === phase ? ' active' : ''}`}
              onClick={() => setPhaseFilter(phase)}
            >
              {PHASE_LABELS[phase]}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="portal-empty portal-empty--inline">
          {search ? '找不到相關對戰' : '此階段尚無賽程'}
        </p>
      ) : phaseFilter === 'all' ? (
        <div className="schedule-phase-groups">
          {grouped.map(({ phase, label, matches: phaseMatches }) => (
            <section key={phase} className={`schedule-phase-group schedule-phase-group--${phase}`}>
              <header className="schedule-phase-head">
                <h3>{label}</h3>
                <span>{phaseMatches.filter((m) => m.status === 'done').length}/{phaseMatches.length}</span>
              </header>
              <ul className="match-card-list">
                {phaseMatches.map((m) => {
                  const isActive = m.id === sessionData.activeMatchId;
                  const highlight = Boolean(search && matchInvolvesName(m, sessionData, search));
                  return (
                    <li key={m.id} ref={isActive ? activeRef : undefined}>
                      <MatchCard
                        match={m}
                        data={sessionData}
                        activeMatchId={sessionData.activeMatchId}
                        highlight={highlight}
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <ul className="match-card-list">
          {filtered.map((m) => {
            const isActive = m.id === sessionData.activeMatchId;
            const highlight = Boolean(search && matchInvolvesName(m, sessionData, search));
            return (
              <li key={m.id} ref={isActive ? activeRef : undefined}>
                <MatchCard
                  match={m}
                  data={sessionData}
                  activeMatchId={sessionData.activeMatchId}
                  highlight={highlight}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
