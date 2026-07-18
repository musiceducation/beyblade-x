import { ArenaLiveState, PHASE_LABELS, SessionData } from '@/lib/constants';
import { getAllMatches, playerName } from '@/lib/tournament';

export function buildRoomLiveOverlay(
  session: 'junior' | 'senior',
  data: SessionData,
  opts?: { matchOver?: boolean; matchId?: string | null },
): ArenaLiveState {
  const matchId = opts?.matchId ?? data.activeMatchId;
  const match = matchId ? getAllMatches(data).find((m) => m.id === matchId) : null;
  if (!match?.p1Id || !match?.p2Id) {
    return {
      updatedAt: Date.now(),
      session,
      active: false,
      matchOver: true,
      broadcastStatus: 'live',
    };
  }

  const scores = (match.liveScores || match.scores || [0, 0]) as [number, number];
  return {
    updatedAt: Date.now(),
    session,
    phase: match.phase,
    p1Name: playerName(data, match.p1Id),
    p2Name: playerName(data, match.p2Id),
    scores,
    battle: match.liveBattles || match.battles || 1,
    matchOver: Boolean(opts?.matchOver || match.status === 'done'),
    matchLabel: match.label || PHASE_LABELS[match.phase] || '對戰',
    active: !(opts?.matchOver || match.status === 'done'),
    broadcastStatus: 'live',
  };
}
