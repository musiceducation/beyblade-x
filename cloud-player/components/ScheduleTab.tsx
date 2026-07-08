'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { PHASE_LABELS, SessionData } from '@/lib/constants';
import MatchCard from '@/components/MatchCard';
import {
  PhaseFilter,
  PHASE_LIST,
  getAllMatches,
  getPrelimRoundColumns,
  getQuarterByePlayerIds,
  groupMatchesByPhase,
  matchInvolvesName,
  playerName,
  scheduleHasVisibleContent,
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
  const prelimColumns = useMemo(() => getPrelimRoundColumns(sessionData), [sessionData]);
  const quarterByes = useMemo(() => getQuarterByePlayerIds(sessionData), [sessionData]);
  const hasVisibleSchedule = useMemo(
    () => scheduleHasVisibleContent(sessionData, phaseFilter, filtered, prelimColumns, search),
    [sessionData, phaseFilter, filtered, prelimColumns, search],
  );

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

      { !hasVisibleSchedule ? (
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
              {phase === 'prelim' && prelimColumns.length > 0 ? (
                <div className="schedule-prelim-board">
                  {prelimColumns.map((column) => {
                    const visibleMatches = search
                      ? column.matches.filter((m) => matchInvolvesName(m, sessionData, search))
                      : column.matches;
                    const visibleByes = search
                      ? column.byeIds.filter((id) => playerName(sessionData, id).toLowerCase().includes(search.toLowerCase()))
                      : column.byeIds;
                    if (!visibleMatches.length && !visibleByes.length) return null;
                    const done = visibleMatches.filter((m) => m.status === 'done').length;
                    return (
                      <section key={column.roundNo} className={`schedule-prelim-column schedule-prelim-column--r${column.roundNo}`}>
                        <header className="schedule-prelim-head">
                          <h4>{column.title}</h4>
                          <span className="schedule-prelim-sub">{column.sub}</span>
                          <span className="schedule-prelim-progress">
                            {visibleMatches.length ? `${done}/${visibleMatches.length}` : (visibleByes.length ? '輪空' : '—')}
                          </span>
                        </header>
                        {visibleMatches.length > 0 && (
                          <ul className="match-card-list">
                            {visibleMatches.map((m) => {
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
                        {visibleByes.length > 0 && (
                          <ul className="schedule-bye-list" aria-label={`${column.title} 輪空`}>
                            {visibleByes.map((id) => (
                              <li key={`${column.roundNo}-${id}`} className="schedule-bye-item">
                                <span className="schedule-bye-label">R{column.roundNo} 輪空</span>
                                <span className="schedule-bye-name">{playerName(sessionData, id)}</span>
                                <span className="schedule-bye-hint">{column.byeHint}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>
                    );
                  })}
                </div>
              ) : (
                <>
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
                  {phase === 'quarter' && quarterByes.length > 0 && (
                    <ul className="schedule-bye-list" aria-label="複賽輪空">
                      {quarterByes
                        .filter(({ playerId }) => !search || playerName(sessionData, playerId).toLowerCase().includes(search.toLowerCase()))
                        .map(({ slotIndex, playerId }) => (
                          <li key={`quarter-bye-${slotIndex}`} className="schedule-bye-item">
                            <span className="schedule-bye-label">複賽 {slotIndex + 1} 輪空</span>
                            <span className="schedule-bye-name">{playerName(sessionData, playerId)}</span>
                            <span className="schedule-bye-hint">→ 準決賽</span>
                          </li>
                        ))}
                    </ul>
                  )}
                </>
              )}
            </section>
          ))}
        </div>
      ) : phaseFilter === 'prelim' && prelimColumns.length > 0 ? (
        <div className="schedule-prelim-board schedule-prelim-board--solo">
          {prelimColumns.map((column) => {
            const visibleMatches = search
              ? column.matches.filter((m) => matchInvolvesName(m, sessionData, search))
              : column.matches;
            const visibleByes = search
              ? column.byeIds.filter((id) => playerName(sessionData, id).toLowerCase().includes(search.toLowerCase()))
              : column.byeIds;
            if (!visibleMatches.length && !visibleByes.length) return null;
            const done = visibleMatches.filter((m) => m.status === 'done').length;
            return (
              <section key={column.roundNo} className={`schedule-prelim-column schedule-prelim-column--r${column.roundNo}`}>
                <header className="schedule-prelim-head">
                  <h4>{column.title}</h4>
                  <span className="schedule-prelim-sub">{column.sub}</span>
                  <span className="schedule-prelim-progress">
                    {visibleMatches.length ? `${done}/${visibleMatches.length}` : (visibleByes.length ? '輪空' : '—')}
                  </span>
                </header>
                {visibleMatches.length > 0 && (
                  <ul className="match-card-list">
                    {visibleMatches.map((m) => {
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
                {visibleByes.length > 0 && (
                  <ul className="schedule-bye-list" aria-label={`${column.title} 輪空`}>
                    {visibleByes.map((id) => (
                      <li key={`${column.roundNo}-${id}`} className="schedule-bye-item">
                        <span className="schedule-bye-label">R{column.roundNo} 輪空</span>
                        <span className="schedule-bye-name">{playerName(sessionData, id)}</span>
                        <span className="schedule-bye-hint">{column.byeHint}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <>
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
          {phaseFilter === 'quarter' && quarterByes.length > 0 && (
            <ul className="schedule-bye-list" aria-label="複賽輪空">
              {quarterByes
                .filter(({ playerId }) => !search || playerName(sessionData, playerId).toLowerCase().includes(search.toLowerCase()))
                .map(({ slotIndex, playerId }) => (
                  <li key={`quarter-bye-${slotIndex}`} className="schedule-bye-item">
                    <span className="schedule-bye-label">複賽 {slotIndex + 1} 輪空</span>
                    <span className="schedule-bye-name">{playerName(sessionData, playerId)}</span>
                    <span className="schedule-bye-hint">→ 準決賽</span>
                  </li>
                ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
