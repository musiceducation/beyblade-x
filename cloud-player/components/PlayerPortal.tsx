'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SESSION_LABELS } from '@/lib/constants';
import LiveTab from '@/components/LiveTab';
import ReplayTab from '@/components/ReplayTab';
import ResultsTab from '@/components/ResultsTab';
import ScheduleTab from '@/components/ScheduleTab';
import { filterReplaysBySession, getAllMatches, matchInvolvesName, playerName, sortMatches } from '@/lib/tournament';
import { getSavedFollowName, requestNotifyPermission, saveFollowName, useFollowPlayer } from '@/lib/follow';
import { useArenaData } from '@/lib/useArenaData';
import { PHASE_LABELS } from '@/lib/constants';

type Tab = 'live' | 'schedule' | 'replay' | 'results';

const SYNC_LABELS = {
  connecting: '連線中',
  synced: '已同步',
  error: '連線失敗',
  unconfigured: '未設定',
  cached: '離線快取',
} as const;

function formatUpdatedAt(date: Date | null) {
  if (!date) return '';
  return date.toLocaleTimeString('zh-Hant', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function PlayerPortal() {
  const [tab, setTab] = useState<Tab>('live');
  const [session, setSession] = useState('junior');
  const [search, setSearch] = useState('');
  const [activeReplayId, setActiveReplayId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [followSaved, setFollowSaved] = useState('');

  const { syncStatus, configError, arenaState, replays, lastUpdated, usingCache, refresh } = useArenaData(tab);

  const selectReplay = useCallback((id: string | null) => {
    setActiveReplayId(id);
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('replay', id);
    else url.searchParams.delete('replay');
    window.history.replaceState({}, '', url);
  }, []);

  const setTabWithUrl = useCallback((next: Tab) => {
    setTab(next);
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    window.history.replaceState({}, '', url);
  }, []);

  const setSessionWithUrl = useCallback((next: string) => {
    setSession(next);
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('session', next);
    window.history.replaceState({}, '', url);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const urlTab = params.get('tab');
    const urlSession = params.get('session');
    const replayId = params.get('replay');
    const follow = params.get('follow');
    if (urlTab === 'live' || urlTab === 'schedule' || urlTab === 'replay' || urlTab === 'results') setTab(urlTab);
    if (urlSession === 'junior' || urlSession === 'senior') setSession(urlSession);
    if (follow) setSearch(follow);
    else {
      const saved = getSavedFollowName();
      if (saved) setSearch(saved);
    }
    setFollowSaved(getSavedFollowName());
    if (replayId) {
      setActiveReplayId(replayId);
      setTab('replay');
    }
  }, []);

  const sessionData = arenaState?.[session as 'junior' | 'senior'] || null;
  useFollowPlayer(search, sessionData);
  const matches = useMemo(() => getAllMatches(sessionData), [sessionData]);
  const filteredReplays = useMemo(
    () => filterReplaysBySession(replays, session, search),
    [replays, session, search],
  );
  const replayTabCount = filteredReplays.length;
  const pendingCount = matches.filter((m) => m.status === 'pending' && m.p1Id && m.p2Id).length;
  const hasLive = Boolean(sessionData?.activeMatchId);

  const nextForSearch = search
    ? sortMatches(
      matches.filter((m) => m.status === 'pending' && m.p1Id && m.p2Id),
    ).find((m) => matchInvolvesName(m, sessionData, search))
    : null;

  const handleRefresh = async () => {
    setRefreshing(true);
    await refresh({ forceReplays: true });
    setRefreshing(false);
  };

  const tabDefs: { id: Tab; label: string; icon: string }[] = [
    { id: 'live', label: '即時', icon: '⚡' },
    { id: 'schedule', label: '賽程', icon: '📋' },
    { id: 'results', label: '成績', icon: '🏆' },
    { id: 'replay', label: '回放', icon: '🎬' },
  ];

  const renderTabs = (position: 'top' | 'bottom') => (
    <nav className={`player-tabs player-tabs--${position}`} aria-label="查閱分頁">
      {tabDefs.map(({ id, label, icon }) => (
        <button
          key={id}
          type="button"
          className={`player-tab${tab === id ? ' active' : ''}`}
          onClick={() => setTabWithUrl(id)}
        >
          <span className="player-tab-icon" aria-hidden="true">{icon}</span>
          <span className="player-tab-label">{label}</span>
          {id === 'live' && hasLive && <span className="player-tab-live" aria-label="進行中" />}
          {id === 'schedule' && pendingCount > 0 && (
            <span className="player-tab-badge">{pendingCount}</span>
          )}
          {id === 'replay' && replayTabCount > 0 && (
            <span className="player-tab-badge">{replayTabCount}</span>
          )}
        </button>
      ))}
    </nav>
  );

  return (
    <div className="portal-shell">
      <div className="player-sticky-shell">
      <header className="player-header">
        <div className="player-header-top">
          <div className="player-brand">
            <span className="player-brand-mark">X</span>
            <div>
              <h1>咩咩遊樂園</h1>
              <p className="player-subtitle">雲端賽程 · 比分 · 回放</p>
            </div>
          </div>
          <button
            type="button"
            className="player-refresh"
            onClick={handleRefresh}
            disabled={refreshing}
            aria-label="重新整理"
            title="重新整理"
          >
            {refreshing ? '…' : '↻'}
          </button>
        </div>

        <div className="player-sync-row">
          <span className="player-sync-dot" data-status={syncStatus} />
          <span className="player-sync-label">{SYNC_LABELS[syncStatus]}</span>
          {lastUpdated && (
            <span className="player-sync-time">更新 {formatUpdatedAt(lastUpdated)}</span>
          )}
        </div>

        {configError && <p className="player-config-error">{configError}</p>}
        {usingCache && syncStatus === 'cached' && (
          <p className="player-cache-banner">目前顯示離線快取，連線恢復後會自動更新</p>
        )}

        <div className="session-pills" role="tablist" aria-label="場次">
          {(['junior', 'senior'] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              className={`session-pill${session === key ? ' active' : ''}`}
              onClick={() => setSessionWithUrl(key)}
            >
              {SESSION_LABELS[key]}
            </button>
          ))}
        </div>

        <div className="player-toolbar">
          <input
            type="search"
            className="player-search"
            placeholder="搜尋選手名字…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="搜尋選手"
          />
          {search && (
            <button
              type="button"
              className="player-search-clear"
              onClick={() => setSearch('')}
              aria-label="清除搜尋"
            >
              ✕
            </button>
          )}
          <button
            type="button"
            className={`player-notify-btn${search && followSaved.toLowerCase() === search.toLowerCase() ? ' active' : ''}`}
            onClick={() => {
              if (!search) return;
              saveFollowName(search);
              setFollowSaved(search);
            }}
            title="追蹤目前搜尋的選手"
            aria-label="追蹤選手"
          >
            ⭐
          </button>
          <button
            type="button"
            className="player-notify-btn"
            onClick={requestNotifyPermission}
            title="開啟下一場提醒"
            aria-label="開啟通知"
          >
            🔔
          </button>
        </div>
      </header>

      {renderTabs('top')}
      </div>

      <main className="player-main">
        {nextForSearch && (
          <p className="player-next-alert">
            📣 {search} — 下一場：
            {nextForSearch.label || PHASE_LABELS[nextForSearch.phase] || ''}
            {' · '}
            {playerName(sessionData, nextForSearch.p1Id)} vs {playerName(sessionData, nextForSearch.p2Id)}
          </p>
        )}

        {tab === 'live' && (
          <LiveTab
            sessionData={sessionData}
            search={search}
            liveOverlay={arenaState?.live}
            sessionKey={session}
          />
        )}
        {tab === 'schedule' && (
          <ScheduleTab
            sessionData={sessionData}
            sessionLabel={SESSION_LABELS[session]}
            search={search}
          />
        )}
        {tab === 'results' && (
          <ResultsTab
            sessionData={sessionData}
            sessionLabel={SESSION_LABELS[session]}
            search={search}
          />
        )}
        {tab === 'replay' && (
          <ReplayTab
            replays={replays}
            session={session}
            search={search}
            activeReplayId={activeReplayId}
            onSelectReplay={selectReplay}
          />
        )}
      </main>

      {renderTabs('bottom')}

      <footer className="player-footer">
        <p>雲端查閱 · 4G / 任何網絡皆可 · 由場內主機同步資料</p>
      </footer>
    </div>
  );
}
