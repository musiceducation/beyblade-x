'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArenaReplayRow,
  PHASE_LABELS,
} from '@/lib/constants';
import {
  FINISH_ICONS,
  FINISH_LABELS,
  formatReplayDate,
  formatReplayTime,
  groupReplays,
  matchGroupSummary,
  replayBattleDelta,
  replayFinishEvents,
  replayMeta,
  downloadCloudReplay,
} from '@/lib/replay';
import { replayVideoUrl } from '@/lib/supabase';

type Props = {
  replays: ArenaReplayRow[];
  session: string;
  search: string;
  activeReplayId: string | null;
  onSelectReplay: (id: string | null) => void;
};

function FinishChips({ meta }: { meta: ReturnType<typeof replayMeta> }) {
  const finishes = replayFinishEvents(meta);
  if (!finishes.length) {
    return <span className="replay-round-muted">無得分紀錄</span>;
  }
  return (
    <span className="replay-finish-chips">
      {finishes.map((e, i) => {
        const icon = FINISH_ICONS[e.finishType || ''] || '·';
        const label = FINISH_LABELS[e.finishType || ''] || e.finishType;
        const side = e.player === 1 ? 'p1' : 'p2';
        return (
          <span
            key={`${e.ts}-${i}`}
            className={`replay-finish-chip replay-finish-chip--${side}`}
            title={label}
          >
            P{e.player} {icon} +{e.points}
          </span>
        );
      })}
    </span>
  );
}

export default function ReplayTab({
  replays,
  session,
  search,
  activeReplayId,
  onSelectReplay,
}: Props) {
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'downloading'>('idle');
  const [shareCopied, setShareCopied] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  const filteredReplays = useMemo(() => {
    return replays.filter((r) => {
      const meta = replayMeta(r);
      if (meta.session && meta.session !== session) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        (meta.p1Name || '').toLowerCase().includes(q)
        || (meta.p2Name || '').toLowerCase().includes(q)
      );
    });
  }, [replays, session, search]);

  const replayGroups = useMemo(() => groupReplays(filteredReplays), [filteredReplays]);
  const videoCount = filteredReplays.filter((r) => r.has_video).length;

  const activeReplay = filteredReplays.find((r) => r.id === activeReplayId)
    ?? replays.find((r) => r.id === activeReplayId)
    ?? null;
  const activeMeta = activeReplay ? replayMeta(activeReplay) : null;

  const activeGroup = useMemo(() => {
    if (!activeReplayId) return null;
    return replayGroups.find((g) => g.some((r) => r.id === activeReplayId)) || null;
  }, [replayGroups, activeReplayId]);

  const activeRoundIndex = activeGroup?.findIndex((r) => r.id === activeReplayId) ?? -1;
  const prevRound = activeGroup && activeRoundIndex > 0 ? activeGroup[activeRoundIndex - 1] : null;
  const nextRound = activeGroup && activeRoundIndex >= 0 && activeRoundIndex < activeGroup.length - 1
    ? activeGroup[activeRoundIndex + 1]
    : null;

  useEffect(() => {
    if (activeReplayId || !replayGroups.length) return;
    const firstVideo = filteredReplays.find((r) => r.has_video);
    if (firstVideo) onSelectReplay(firstVideo.id);
  }, [activeReplayId, filteredReplays, replayGroups.length, onSelectReplay]);

  useEffect(() => {
    if (!activeReplayId || !stageRef.current) return;
    stageRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activeReplayId]);

  const shareReplay = () => {
    if (!activeReplay) return;
    const url = `${window.location.origin}${window.location.pathname}?replay=${encodeURIComponent(activeReplay.id)}`;
    navigator.clipboard.writeText(url).then(() => {
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 2000);
    }).catch(() => window.prompt('複製連結：', url));
  };

  if (!replayGroups.length) {
    return (
      <section className="player-section" aria-label="戰鬥回放">
        <div className="player-empty replay-empty-state">
          <span className="replay-empty-icon" aria-hidden="true">🎬</span>
          <p>{search ? '找不到相關回放' : '尚無回放'}</p>
          <p className="replay-empty-hint">比賽結束後會由場內主機自動上傳</p>
        </div>
      </section>
    );
  }

  return (
    <section
      className={`player-section player-replay-layout${activeReplay ? ' has-player' : ''}`}
      aria-label="戰鬥回放"
    >
      <div className="player-replay-stats">
        <span>
          <strong>{replayGroups.length}</strong>
          {' '}
          場對戰
        </span>
        <span className="player-replay-stats-sep">·</span>
        <span>
          <strong>{videoCount}</strong>
          {' '}
          段影片
        </span>
      </div>

      {activeReplay && (
        <div className="player-replay-stage" ref={stageRef}>
          {activeReplay.has_video ? (
            <video
              key={activeReplay.id}
              className="player-replay-video"
              controls
              playsInline
              preload="metadata"
              src={replayVideoUrl(activeReplay.id) || undefined}
            />
          ) : (
            <div className="player-replay-no-video">
              <span aria-hidden="true">📋</span>
              <p>此局無影片，僅有比分紀錄</p>
            </div>
          )}
          <div className="player-replay-footer">
            <div className="player-replay-footer-main">
              <p className="player-replay-title">
                <span className="replay-title-names">
                  <span className="replay-name-p1">{activeMeta?.p1Name || 'Blader 1'}</span>
                  <span className="replay-title-vs">vs</span>
                  <span className="replay-name-p2">{activeMeta?.p2Name || 'Blader 2'}</span>
                </span>
                <span className="replay-title-meta">
                  第 {activeReplay.battle_num ?? activeMeta?.battleNum ?? '?'} 局
                  {activeMeta?.phase && PHASE_LABELS[activeMeta.phase]
                    ? ` · ${PHASE_LABELS[activeMeta.phase]}`
                    : ''}
                </span>
              </p>
              {activeMeta && (
                <div className="player-replay-round-nav">
                  <button
                    type="button"
                    className="replay-nav-btn"
                    disabled={!prevRound}
                    onClick={() => prevRound && onSelectReplay(prevRound.id)}
                  >
                    ← 上一局
                  </button>
                  <span className="replay-nav-pos">
                    {activeRoundIndex + 1} / {activeGroup?.length ?? 1}
                  </span>
                  <button
                    type="button"
                    className="replay-nav-btn"
                    disabled={!nextRound}
                    onClick={() => nextRound && onSelectReplay(nextRound.id)}
                  >
                    下一局 →
                  </button>
                </div>
              )}
            </div>
            <div className="player-replay-actions">
              {activeReplay.has_video ? (
                <>
                  <button
                    type="button"
                    className="player-replay-action"
                    onClick={shareReplay}
                  >
                    {shareCopied ? '已複製' : '分享'}
                  </button>
                  <button
                    type="button"
                    className="player-replay-action player-replay-action--primary"
                    disabled={downloadStatus === 'downloading'}
                    onClick={() => downloadCloudReplay(
                      activeReplay,
                      replayVideoUrl(activeReplay.id),
                      {
                        p1Name: activeMeta?.p1Name,
                        p2Name: activeMeta?.p2Name,
                        battleNum: activeReplay.battle_num ?? activeMeta?.battleNum,
                      },
                      setDownloadStatus,
                    )}
                  >
                    {downloadStatus === 'downloading' ? '下載中…' : '下載'}
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}

      <div className="player-replay-list">
        {replayGroups.map((rounds) => {
          const summary = matchGroupSummary(rounds);
          const phaseLabel = summary.phase ? PHASE_LABELS[summary.phase] : null;
          const groupActive = rounds.some((r) => r.id === activeReplayId);

          return (
            <article
              key={rounds[0].match_group_id || rounds[0].id}
              className={`replay-group${groupActive ? ' is-active' : ''}`}
            >
              <header className="replay-group-head">
                <div className="replay-group-names">
                  <span className={`replay-group-player${summary.winner === 'p1' ? ' winner' : ''}`}>
                    {summary.p1Name}
                  </span>
                  <span className="replay-group-vs">vs</span>
                  <span className={`replay-group-player${summary.winner === 'p2' ? ' winner' : ''}`}>
                    {summary.p2Name}
                  </span>
                </div>
                <div className="replay-group-meta-row">
                  {phaseLabel && <span className="replay-tag">{phaseLabel}</span>}
                  {summary.hasMatchEnd && <span className="replay-tag replay-tag-win">Match 結束</span>}
                  {summary.videoCount > 0 && (
                    <span className="replay-tag replay-tag-video">{summary.videoCount} 影片</span>
                  )}
                  <span className="replay-group-score">
                    總分 {summary.total[0]}:{summary.total[1]}
                  </span>
                  <span className="replay-group-time">{formatReplayDate(summary.createdAt)}</span>
                </div>
              </header>
              <ul className="replay-rounds">
                {rounds.map((r) => {
                  const meta = replayMeta(r);
                  const delta = replayBattleDelta(meta);
                  const isActive = activeReplayId === r.id;
                  const videoUrl = r.has_video ? replayVideoUrl(r.id) : null;

                  return (
                    <li key={r.id} className={`replay-round-item${isActive ? ' is-active' : ''}`}>
                      {videoUrl ? (
                        <video
                          className="replay-round-thumb"
                          preload="metadata"
                          muted
                          playsInline
                          src={`${videoUrl}#t=0.3`}
                          aria-hidden="true"
                        />
                      ) : (
                        <div className="replay-round-thumb replay-round-thumb--empty" aria-hidden="true">
                          📋
                        </div>
                      )}
                      <button
                        type="button"
                        className="replay-round-btn"
                        onClick={() => onSelectReplay(r.id)}
                      >
                        <span className="replay-round-top">
                          <span className="replay-round-badge">B{r.battle_num ?? '?'}</span>
                          <span className="replay-round-delta">
                            本局 +{delta[0]}:+{delta[1]}
                          </span>
                          <span className="replay-round-total">
                            {meta.finalScores?.[0] ?? 0}:{meta.finalScores?.[1] ?? 0}
                          </span>
                          {r.has_video && <span className="replay-round-video-tag">影片</span>}
                        </span>
                        <FinishChips meta={meta} />
                        <span className="replay-round-time">{formatReplayTime(r.created_at)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </article>
          );
        })}
      </div>
    </section>
  );
}
