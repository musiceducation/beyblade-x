import {
  Match,
  PHASE_LABELS,
  PHASE_ORDER,
  SessionData,
} from '@/lib/constants';

export const PHASE_LIST = [
  'prelim',
  'playoff',
  'revival',
  'quarter',
  'challenge',
  'semi',
  'final',
] as const;

export type PhaseFilter = 'all' | (typeof PHASE_LIST)[number];

export function playerName(data: SessionData | null, id?: string | null) {
  if (!id || !data?.players) return '待定';
  return data.players.find((p) => p.id === id)?.name || '待定';
}

export function getAllMatches(data: SessionData | null): Match[] {
  const m = data?.matches;
  if (!m?.prelim) return [];
  const prelim = Array.isArray(m.prelim) ? m.prelim : [];
  return [
    ...prelim,
    ...((m.playoff as Match[]) || []),
    ...((m.quarter as Match[]) || []),
    ...((m.revival as Match[]) || []),
    ...(m.challenge ? [m.challenge as Match] : []),
    ...((m.semi as Match[]) || []),
    ...(m.final ? [m.final as Match] : []),
  ];
}

export function matchInvolvesName(match: Match, data: SessionData | null, query: string) {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    playerName(data, match.p1Id).toLowerCase().includes(q)
    || playerName(data, match.p2Id).toLowerCase().includes(q)
  );
}

export function formatMatchScore(match: Match) {
  const scores = match.status === 'done' ? match.scores : match.liveScores;
  if (!scores) return '';
  return `${scores[0]} : ${scores[1]}`;
}

export function matchStatus(match: Match, activeMatchId?: string | null) {
  if (match.status === 'done') return 'done' as const;
  if (match.id === activeMatchId) return 'active' as const;
  return 'pending' as const;
}

export function matchStatusLabel(status: ReturnType<typeof matchStatus>) {
  if (status === 'done') return '完畢';
  if (status === 'active') return '進行中';
  return '待賽';
}

export function sortMatches(matches: Match[]) {
  return [...matches].sort(
    (a, b) => (PHASE_ORDER[a.phase] ?? 9) - (PHASE_ORDER[b.phase] ?? 9),
  );
}

export function groupMatchesByPhase(matches: Match[]) {
  const groups = new Map<string, Match[]>();
  matches.forEach((m) => {
    const phase = m.phase || 'other';
    if (!groups.has(phase)) groups.set(phase, []);
    groups.get(phase)!.push(m);
  });
  return PHASE_LIST
    .filter((phase) => groups.has(phase))
    .map((phase) => ({
      phase,
      label: PHASE_LABELS[phase] || phase,
      matches: groups.get(phase) || [],
    }));
}

export function sessionStats(matches: Match[]) {
  const withPlayers = matches.filter((m) => m.p1Id || m.p2Id);
  const done = withPlayers.filter((m) => m.status === 'done').length;
  const active = withPlayers.filter((m) => m.status !== 'done').length;
  const pending = withPlayers.filter((m) => m.status === 'pending' && m.p1Id && m.p2Id).length;
  const pct = withPlayers.length ? Math.round((done / withPlayers.length) * 100) : 0;
  return { total: withPlayers.length, done, active, pending, pct };
}

export function filterReplaysBySession<T extends { metadata: Record<string, unknown> }>(
  replays: T[],
  session: string,
  search: string,
) {
  return replays.filter((r) => {
    const meta = r.metadata as { session?: string; p1Name?: string; p2Name?: string };
    if (meta.session && meta.session !== session) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (meta.p1Name || '').toLowerCase().includes(q)
      || (meta.p2Name || '').toLowerCase().includes(q)
    );
  });
}

export type PlayerStanding = { id: string; name: string; wins: number; losses: number };

export function computeStandings(data: SessionData | null): PlayerStanding[] {
  if (!data?.players?.length) return [];
  const stats = new Map(data.players.map((p) => [p.id, { id: p.id, name: p.name, wins: 0, losses: 0 }]));
  getAllMatches(data).forEach((m) => {
    if (m.status !== 'done' || !m.winnerId) return;
    const loserId = m.winnerId === m.p1Id ? m.p2Id : m.p1Id;
    const winner = stats.get(m.winnerId);
    if (winner) winner.wins += 1;
    if (loserId) {
      const loser = stats.get(loserId);
      if (loser) loser.losses += 1;
    }
  });
  return [...stats.values()].sort((a, b) => b.wins - a.wins || a.losses - b.losses);
}

export type SessionAwards = {
  champion: string;
  runnerUp: string;
  top4: string[];
};

export function computeAwards(data: SessionData | null): SessionAwards | null {
  if (!data?.matches) return null;
  const fin = data.matches.final as Match | undefined;
  if (!fin?.winnerId) return null;
  const champion = playerName(data, fin.winnerId);
  const runnerId = fin.winnerId === fin.p1Id ? fin.p2Id : fin.p1Id;
  const runnerUp = playerName(data, runnerId);
  const semis = ((data.matches.semi as Match[]) || []).map((m) => m.winnerId).filter(Boolean);
  const top4Ids = [...new Set([...semis, fin.p1Id, fin.p2Id].filter(Boolean))] as string[];
  const top4 = top4Ids.map((id) => playerName(data, id));
  return { champion, runnerUp, top4 };
}
