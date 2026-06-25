import { Match, PHASE_LABELS, SessionData } from '@/lib/constants';
import {
  formatMatchScore,
  matchStatus,
  matchStatusLabel,
  playerName,
} from '@/lib/tournament';

type Props = {
  match: Match;
  data: SessionData | null;
  activeMatchId?: string | null;
  highlight?: boolean;
  compact?: boolean;
  id?: string;
};

export default function MatchCard({
  match,
  data,
  activeMatchId,
  highlight = false,
  compact = false,
  id,
}: Props) {
  const status = matchStatus(match, activeMatchId);
  const statusLabel = matchStatusLabel(status);
  const scoreText = formatMatchScore(match);
  const p1Win = match.winnerId === match.p1Id;
  const p2Win = match.winnerId === match.p2Id;
  const scores = match.status === 'done' ? match.scores : match.liveScores;

  return (
    <article
      id={id}
      className={`match-card match-card--${status}${highlight ? ' match-card--highlight' : ''}${compact ? ' match-card--compact' : ''}`}
    >
      <div className="match-card-head">
        <span className="match-card-phase">{match.label || PHASE_LABELS[match.phase] || match.phase}</span>
        <span className={`match-card-status match-card-status--${status}`}>
          {statusLabel}
          {scoreText ? ` · ${scoreText}` : ''}
        </span>
      </div>
      <div className="match-card-slots">
        <div className={`match-card-slot match-card-slot--red${p1Win ? ' winner' : ''}`}>
          <span className="match-card-name">{playerName(data, match.p1Id)}</span>
          {(status === 'active' || status === 'done') && scores && (
            <strong className="match-card-score">{scores[0]}</strong>
          )}
        </div>
        <div className={`match-card-slot match-card-slot--blue${p2Win ? ' winner' : ''}`}>
          <span className="match-card-name">{playerName(data, match.p2Id)}</span>
          {(status === 'active' || status === 'done') && scores && (
            <strong className="match-card-score">{scores[1]}</strong>
          )}
        </div>
      </div>
      {status === 'active' && (match.liveBattles || match.battles) ? (
        <p className="match-card-battle">第 {match.liveBattles || match.battles} 局</p>
      ) : null}
    </article>
  );
}
