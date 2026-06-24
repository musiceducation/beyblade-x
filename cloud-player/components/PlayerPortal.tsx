'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ArenaReplayRow,
  ArenaStateRow,
  Match,
  PHASE_LABELS,
  PHASE_ORDER,
  POLL_MS,
  SESSION_LABELS,
  SessionData,
} from '@/lib/constants';
import { getEventSlug, getSupabase, replayVideoUrl } from '@/lib/supabase';

type Tab = 'live' | 'schedule' | 'replay';

function playerName(data: SessionData | null, id?: string | null) {
  if (!id || !data?.players) return '待定';
  return data.players.find((p) => p.id === id)?.name || '待定';
}

function getAllMatches(data: SessionData | null): Match[] {
  const m = data?.matches;
  if (!m?.prelim) return [];
  const prelim = Array.isArray(m.prelim) ? m.prelim : [];
  return [
    ...prelim,
    ...((m.quarter as Match[]) || []),
    ...((m.revival as Match[]) || []),
    ...(m.challenge ? [m.challenge as Match] : []),
    ...((m.semi as Match[]) || []),
    ...(m.final ? [m.final as Match] : []),
  ];
}

function matchInvolvesName(match: Match, data: SessionData | null, query: string) {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    playerName(data, match.p1Id).toLowerCase().includes(q)
    || playerName(data, match.p2Id).toLowerCase().includes(q)
  );
}

function formatMatchScore(match: Match) {
  const scores = match.status === 'done' ? match.scores : match.liveScores;
  if (!scores) return '';
  return `${scores[0]} : ${scores[1]}`;
}

function groupReplays(replays: ArenaReplayRow[]) {
  const map = new Map<string, ArenaReplayRow[]>();
  replays.forEach((r) => {
    const gid = r.match_group_id || r.id;
    if (!map.has(gid)) map.set(gid, []);
    map.get(gid)!.push(r);
  });
  return [...map.values()]
    .map((rounds) =>
      rounds.sort(
        (a, b) =>
          (a.battle_num || 0) - (b.battle_num || 0)
          || a.created_at.localeCompare(b.created_at),
      ),
    )
    .sort((a, b) => b[0]?.created_at.localeCompare(a[0]?.created_at || '') || 0);
}

export default function PlayerPortal() {
  const [tab, setTab] = useState<Tab>('live');
  const [session, setSession] = useState('junior');
  const [search, setSearch] = useState('');
  const [syncStatus, setSyncStatus] = useState<'connecting' | 'synced' | 'error' | 'unconfigured'>(
    'connecting',
  );
  const [arenaState, setArenaState] = useState<ArenaStateRow | null>(null);
  const [replays, setReplays] = useState<ArenaReplayRow[]>([]);
  const [activeReplayId, setActiveReplayId] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  const poll = useCallback(async () => {
    const supabase = getSupabase();
    const slug = getEventSlug();
    if (!supabase) {
      setSyncStatus('unconfigured');
      setConfigError('請設定 NEXT_PUBLIC_SUPABASE_URL 與 ANON_KEY');
      return;
    }

    try {
      const { data: state, error: stateErr } = await supabase
        .from('arena_state')
        .select('*')
        .eq('event_slug', slug)
        .maybeSingle();

      if (stateErr) throw stateErr;
      if (state) setArenaState(state as ArenaStateRow);

      const { data: replayRows, error: replayErr } = await supabase
        .from('arena_replays')
        .select('*')
        .eq('event_slug', slug)
        .order('created_at', { ascending: false })
        .limit(60);

      if (replayErr) throw replayErr;
      setReplays((replayRows as ArenaReplayRow[]) || []);
      setSyncStatus('synced');
      setConfigError(null);
    } catch {
      setSyncStatus('error');
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  const sessionData = arenaState?.[session as 'junior' | 'senior'] || null;
  const matches = getAllMatches(sessionData);
  const active = matches.find((m) => m.id === sessionData?.activeMatchId);
  const filteredMatches = search
    ? matches.filter((m) => matchInvolvesName(m, sessionData, search))
    : matches;
  const sortedMatches = [...filteredMatches].sort(
    (a, b) => (PHASE_ORDER[a.phase] ?? 9) - (PHASE_ORDER[b.phase] ?? 9),
  );

  const ready = matches
    .filter((m) => m.status === 'pending' && m.p1Id && m.p2Id)
    .filter((m) => matchInvolvesName(m, sessionData, search))
    .sort((a, b) => (PHASE_ORDER[a.phase] ?? 9) - (PHASE_ORDER[b.phase] ?? 9))
    .slice(0, 3);

  const allWithPlayers = matches.filter((m) => m.p1Id || m.p2Id);
  const doneCount = allWithPlayers.filter((m) => m.status === 'done').length;
  const pct = allWithPlayers.length
    ? Math.round((doneCount / allWithPlayers.length) * 100)
    : 0;

  const filteredReplays = search
    ? replays.filter((r) => {
        const meta = r.metadata as { p1Name?: string; p2Name?: string };
        const q = search.toLowerCase();
        return (
          (meta.p1Name || '').toLowerCase().includes(q)
          || (meta.p2Name || '').toLowerCase().includes(q)
        );
      })
    : replays;

  const replayGroups = groupReplays(filteredReplays);
  const activeReplay = replays.find((r) => r.id === activeReplayId);
  const activeMeta = activeReplay?.metadata as {
    p1Name?: string;
    p2Name?: string;
    battleNum?: number;
  } | undefined;

  return (
    <>
      <header className="player-header">
        <div className="player-header-top">
          <h1>咩咩遊樂園</h1>
          <span className="player-sync-dot" data-status={syncStatus} title="連線狀態" />
        </div>
        <p className="player-subtitle">雲端賽程 · 比分 · 回放</p>
        {configError && <p className="player-config-error">{configError}</p>}
        <div className="player-toolbar">
          <select
            className="player-select"
            value={session}
            onChange={(e) => setSession(e.target.value)}
            aria-label="場次"
          >
            <option value="junior">{SESSION_LABELS.junior}</option>
            <option value="senior">{SESSION_LABELS.senior}</option>
          </select>
          <input
            type="search"
            className="player-search"
            placeholder="搜尋選手名字…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </header>

      <nav className="player-tabs" aria-label="查閱分頁">
        {(['live', 'schedule', 'replay'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={`player-tab${tab === t ? ' active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'live' ? '即時' : t === 'schedule' ? '賽程' : '回放'}
          </button>
        ))}
      </nav>

      <main className="player-main">
        {tab === 'live' && (
          <section className="player-section" aria-label="即時比分">
            {active && active.p1Id && active.p2Id ? (
              <div className="live-active-card">
                <p className="live-label">進行中</p>
                <h2 className="live-match-title">
                  {active.label || PHASE_LABELS[active.phase] || '對戰'}
                </h2>
                <div className="live-scores">
                  <div className="live-player live-red">
                    <span className="live-name">{playerName(sessionData, active.p1Id)}</span>
                    <strong className="live-score">
                      {(active.liveScores || active.scores || [0, 0])[0]}
                    </strong>
                  </div>
                  <span className="live-vs">VS</span>
                  <div className="live-player live-blue">
                    <span className="live-name">{playerName(sessionData, active.p2Id)}</span>
                    <strong className="live-score">
                      {(active.liveScores || active.scores || [0, 0])[1]}
                    </strong>
                  </div>
                </div>
                <p className="live-battle">
                  {active.liveBattles || active.battles
                    ? `第 ${active.liveBattles || active.battles} 局`
                    : '進行中'}
                </p>
              </div>
            ) : (
              <p className="player-empty">
                {!sessionData?.drawn ? '尚未抽籤' : '目前沒有進行中的對戰'}
              </p>
            )}
            {ready.length > 0 && (
              <div className="live-next">
                <h3>即將開始</h3>
                <ul className="schedule-list">
                  {ready.map((m) => (
                    <li key={m.id} className="schedule-card">
                      <div className="schedule-card-head">
                        <span className="schedule-phase">
                          {m.label || PHASE_LABELS[m.phase]}
                        </span>
                        <span className="schedule-status">待賽</span>
                      </div>
                      <div className="schedule-slots">
                        <div className="schedule-slot red">{playerName(sessionData, m.p1Id)}</div>
                        <div className="schedule-slot blue">{playerName(sessionData, m.p2Id)}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {tab === 'schedule' && (
          <section className="player-section" aria-label="賽程表">
            {!sessionData?.drawn ? (
              <p className="player-empty">尚未抽籤或建立賽程</p>
            ) : (
              <>
                <div className="schedule-progress">
                  <strong>{SESSION_LABELS[session]}</strong>
                  {' '}
                  · 已完成 {doneCount}/{allWithPlayers.length} 場（{pct}%）
                </div>
                {sortedMatches.length === 0 ? (
                  <p className="player-empty">{search ? '找不到相關對戰' : '尚無賽程'}</p>
                ) : (
                  <div className="schedule-list">
                    {sortedMatches.map((m) => {
                      const isActive = m.id === sessionData?.activeMatchId;
                      const status = m.status === 'done' ? 'done' : isActive ? 'active' : 'pending';
                      const statusLabel =
                        m.status === 'done' ? '完畢' : isActive ? '進行中' : '待賽';
                      const scoreText = formatMatchScore(m);
                      const p1Win = m.winnerId === m.p1Id;
                      const p2Win = m.winnerId === m.p2Id;
                      const highlight =
                        search && matchInvolvesName(m, sessionData, search) ? ' highlight' : '';

                      return (
                        <article
                          key={m.id}
                          className={`schedule-card ${status}${highlight}`}
                        >
                          <div className="schedule-card-head">
                            <span className="schedule-phase">
                              {m.label || PHASE_LABELS[m.phase] || m.phase}
                            </span>
                            <span className={`schedule-status ${status}`}>
                              {statusLabel}
                              {scoreText ? ` · ${scoreText}` : ''}
                            </span>
                          </div>
                          <div className="schedule-slots">
                            <div className={`schedule-slot red${p1Win ? ' winner' : ''}`}>
                              <span>{playerName(sessionData, m.p1Id)}</span>
                              {isActive && m.liveScores && (
                                <span className="schedule-score-badge">{m.liveScores[0]}</span>
                              )}
                            </div>
                            <div className={`schedule-slot blue${p2Win ? ' winner' : ''}`}>
                              <span>{playerName(sessionData, m.p2Id)}</span>
                              {isActive && m.liveScores && (
                                <span className="schedule-score-badge">{m.liveScores[1]}</span>
                              )}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {tab === 'replay' && (
          <section className="player-section" aria-label="戰鬥回放">
            {replayGroups.length === 0 ? (
              <p className="player-empty">{search ? '找不到相關回放' : '尚無回放'}</p>
            ) : (
              <div className="player-replay-list">
                {replayGroups.map((rounds) => {
                  const last = rounds[rounds.length - 1];
                  const meta = last.metadata as {
                    p1Name?: string;
                    p2Name?: string;
                    finalScores?: number[];
                  };
                  const total = meta.finalScores || [0, 0];
                  return (
                    <div key={last.match_group_id || last.id} className="replay-group">
                      <div className="replay-group-head">
                        {meta.p1Name || 'Blader 1'} vs {meta.p2Name || 'Blader 2'}
                        <span className="replay-group-meta">
                          共 {rounds.length} 局 · 總分 {total[0]}:{total[1]}
                        </span>
                      </div>
                      {rounds.map((r) => {
                        const m = r.metadata as {
                          startScores?: number[];
                          finalScores?: number[];
                        };
                        const delta = [
                          (m.finalScores?.[0] ?? 0) - (m.startScores?.[0] ?? 0),
                          (m.finalScores?.[1] ?? 0) - (m.startScores?.[1] ?? 0),
                        ];
                        return (
                          <button
                            key={r.id}
                            type="button"
                            className={`replay-round-btn${activeReplayId === r.id ? ' active' : ''}`}
                            onClick={() => {
                              setActiveReplayId(r.id);
                              setTab('replay');
                            }}
                          >
                            <span>
                              第 {r.battle_num} 局 · +{delta[0]}:+{delta[1]}
                              {r.has_video && <span className="has-video">影片</span>}
                            </span>
                            <span className="schedule-score-badge">
                              {m.finalScores?.[0] ?? 0}:{m.finalScores?.[1] ?? 0}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
            {activeReplay && (
              <div className="player-replay-player">
                {activeReplay.has_video ? (
                  <video
                    key={activeReplay.id}
                    className="player-replay-video"
                    controls
                    playsInline
                    src={replayVideoUrl(activeReplay.id) || undefined}
                  />
                ) : null}
                <p className="player-replay-title">
                  {activeMeta?.p1Name} vs {activeMeta?.p2Name} · 第 {activeMeta?.battleNum} 局
                  {!activeReplay.has_video ? '（無影片）' : ''}
                </p>
              </div>
            )}
          </section>
        )}
      </main>

      <footer className="player-footer">
        <p>雲端查閱 · 4G / 任何網絡皆可 · 由場內主機同步資料</p>
      </footer>
    </>
  );
}
