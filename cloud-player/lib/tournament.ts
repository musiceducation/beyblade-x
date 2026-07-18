import {
  Match,
  PHASE_LABELS,
  PHASE_ORDER,
  SessionData,
} from '@/lib/constants';

export const PHASE_LIST = [
  'prelim',
  'revival',
  'quarter',
  'challenge',
  'semi',
  'final',
] as const;

export type PhaseFilter = 'all' | (typeof PHASE_LIST)[number];

export type PrelimRoundColumn = {
  roundNo: number;
  title: string;
  sub: string;
  matches: Match[];
  byeIds: string[];
  byeHint: string;
};

const QUARTER_ENTRANTS = 8;

function asMatchArray(value: SessionData['matches'][string] | undefined): Match[] {
  if (!Array.isArray(value) || (value.length > 0 && typeof value[0] === 'string')) return [];
  return value as Match[];
}

function asSingleMatch(value: SessionData['matches'][string] | undefined): Match | null {
  if (!value || Array.isArray(value) || typeof value !== 'object') return null;
  return value as Match;
}

function prelimMatches(data: SessionData | null): Match[] {
  return asMatchArray(data?.matches?.prelim);
}

function prelimByeMap(data: SessionData | null): Record<string, string[]> {
  const raw = data?.matches?.prelimByes;
  if (!raw || Array.isArray(raw)) return {};
  return raw as Record<string, string[]>;
}

export function getMaxPrelimRound(data: SessionData | null): number {
  let max = 1;
  prelimMatches(data).forEach((m) => {
    max = Math.max(max, m.round || 1);
  });
  Object.keys(prelimByeMap(data)).forEach((round) => {
    max = Math.max(max, Number(round) || 1);
  });
  return Math.min(4, max);
}

function prelimNeedsRound2(data: SessionData | null): boolean {
  if (getMaxPrelimRound(data) >= 2) return true;
  const r1 = prelimMatches(data).filter((m) => (m.round || 1) === 1);
  const r1Byes = prelimByeMap(data)[1] || [];
  if (!r1.length) return false;
  return r1Byes.length + r1.length > QUARTER_ENTRANTS;
}

function prelimRoundHasFollowUp(data: SessionData | null, roundNo: number): boolean {
  return roundNo < getMaxPrelimRound(data) || (roundNo === 1 && prelimNeedsRound2(data));
}

export function getPrelimByePlayerIds(data: SessionData | null, roundNo: number): string[] {
  const ids = (prelimByeMap(data)[String(roundNo)] || []).filter(Boolean);
  if (roundNo !== 1) return ids;

  const inLaterRound = new Set<string>();
  prelimMatches(data).forEach((m) => {
    if ((m.round || 1) >= 2) {
      if (m.p1Id) inLaterRound.add(m.p1Id);
      if (m.p2Id) inLaterRound.add(m.p2Id);
    }
  });
  Object.entries(prelimByeMap(data)).forEach(([round, roundByes]) => {
    if (Number(round) >= 2) roundByes.forEach((id) => { if (id) inLaterRound.add(id); });
  });
  return ids.filter((id) => !inLaterRound.has(id));
}

export function getPrelimRoundColumns(data: SessionData | null): PrelimRoundColumn[] {
  const maxRound = getMaxPrelimRound(data);
  const columns: PrelimRoundColumn[] = [];

  for (let roundNo = 1; roundNo <= maxRound; roundNo += 1) {
    const matches = prelimMatches(data).filter((m) => (m.round || 1) === roundNo);
    const byeIds = getPrelimByePlayerIds(data, roundNo);
    const waiting = roundNo > 1
      && roundNo <= maxRound
      && !matches.length
      && getPrelimByePlayerIds(data, roundNo - 1).length > 0
      && !prelimMatches(data).some((m) => (m.round || 1) >= roundNo);

    if (!matches.length && !byeIds.length && !waiting) continue;

    columns.push({
      roundNo,
      title: `初賽 R${roundNo}`,
      sub: roundNo < maxRound
        ? `第 ${roundNo} 輪 · 輪空進 R${roundNo + 1}`
        : `第 ${roundNo} 輪 · 晉級複賽`,
      matches,
      byeIds,
      byeHint: prelimRoundHasFollowUp(data, roundNo) ? `→ R${roundNo + 1}` : '→ 複賽',
    });
  }

  return columns;
}

export function playerName(data: SessionData | null, id?: string | null) {
  if (!id || !data?.players) return '待定';
  return data.players.find((p) => p.id === id)?.name || '待定';
}

function quarterMatches(data: SessionData | null): Match[] {
  return asMatchArray(data?.matches?.quarter);
}

export function getQuarterSlotChampion(slot: Match | null | undefined): string | null {
  if (!slot) return null;
  if (slot.status === 'done' && slot.winnerId) return slot.winnerId;
  return null;
}

export function getQuarterByePlayerIds(data: SessionData | null): { slotIndex: number; playerId: string }[] {
  return quarterMatches(data)
    .map((slot, slotIndex) => {
      if (slot.status === 'done') return null;
      if (slot.p1Id && !slot.p2Id) return { slotIndex, playerId: slot.p1Id };
      if (!slot.p1Id && slot.p2Id) return { slotIndex, playerId: slot.p2Id };
      return null;
    })
    .filter(Boolean) as { slotIndex: number; playerId: string }[];
}

function isQuarterComplete(data: SessionData | null): boolean {
  const occupied = quarterMatches(data).filter((m) => m.p1Id || m.p2Id);
  if (!occupied.length) return false;
  return occupied.every((m) => m.status === 'done' && m.winnerId);
}

function isRevivalComplete(data: SessionData | null): boolean {
  if (!data?.matches) return false;
  if (data.revivalWinnerId) return true;
  const rev = asMatchArray(data.matches.revival);
  if (!rev.length) return false;
  return rev.some((m) => m.label === '逆轉小羊決賽' && m.status === 'done' && m.winnerId)
    || Boolean(data.revivalWinnerId);
}

function needsRevivalPath(data: SessionData | null): boolean {
  return asMatchArray(data?.matches?.revival).length > 0;
}

function isChallengeComplete(data: SessionData | null): boolean {
  if (!data?.revivalWinnerId) return true;
  const ch = asSingleMatch(data.matches?.challenge);
  return Boolean(ch?.status === 'done' && ch.winnerId);
}

export function isOfficialTopFourReady(data: SessionData | null): boolean {
  if (!isQuarterComplete(data)) return false;
  if (needsRevivalPath(data)) {
    if (!isRevivalComplete(data)) return false;
    if (data?.revivalWinnerId && !isChallengeComplete(data)) return false;
  }
  return true;
}

export function getOfficialTopFour(data: SessionData | null): (string | null)[] | null {
  if (!isOfficialTopFourReady(data)) return null;
  const quarters = quarterMatches(data);
  const topFour = quarters.slice(0, 4).map(getQuarterSlotChampion);
  const challenge = asSingleMatch(data?.matches?.challenge);

  if (data?.revivalWinnerId && challenge?.status === 'done') {
    const challengedId = challenge.p2Id;
    const qIdx = quarters.findIndex((q) =>
      q.winnerId === challengedId || q.p1Id === challengedId || q.p2Id === challengedId
    );
    if (qIdx >= 0) topFour[qIdx] = challenge.winnerId || null;
  }

  return topFour;
}

export function getAllMatches(data: SessionData | null): Match[] {
  const m = data?.matches;
  if (!m) return [];
  return [
    ...asMatchArray(m.prelim),
    ...quarterMatches(data),
    ...asMatchArray(m.revival),
    ...(asSingleMatch(m.challenge) ? [asSingleMatch(m.challenge)!] : []),
    ...asMatchArray(m.semi),
    ...(asSingleMatch(m.final) ? [asSingleMatch(m.final)!] : []),
  ];
}

export function prelimColumnHasVisibleContent(
  data: SessionData | null,
  column: PrelimRoundColumn,
  search: string,
): boolean {
  if (!search) return column.matches.length > 0 || column.byeIds.length > 0;
  const q = search.toLowerCase();
  return column.matches.some((m) => matchInvolvesName(m, data, search))
    || column.byeIds.some((id) => playerName(data, id).toLowerCase().includes(q));
}

export function scheduleHasVisibleContent(
  data: SessionData | null,
  phaseFilter: PhaseFilter,
  filtered: Match[],
  prelimColumns: PrelimRoundColumn[],
  search: string,
): boolean {
  const prelimVisible = prelimColumns.some((column) =>
    prelimColumnHasVisibleContent(data, column, search)
  );

  if (phaseFilter === 'prelim') return prelimVisible;
  if (phaseFilter === 'quarter') {
    const visibleQuarterByes = getQuarterByePlayerIds(data).some(({ playerId }) =>
      !search || playerName(data, playerId).toLowerCase().includes(search.toLowerCase())
    );
    return filtered.length > 0 || visibleQuarterByes;
  }
  if (phaseFilter === 'all') return filtered.length > 0 || prelimVisible;
  return filtered.length > 0;
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
  return [...matches].sort((a, b) => {
    const priorityA = a.status === 'pending' ? a.queuePriority || 0 : 0;
    const priorityB = b.status === 'pending' ? b.queuePriority || 0 : 0;
    const priorityDiff = priorityB - priorityA;
    if (priorityDiff !== 0) return priorityDiff;
    const phaseDiff = (PHASE_ORDER[a.phase] ?? 9) - (PHASE_ORDER[b.phase] ?? 9);
    if (phaseDiff !== 0) return phaseDiff;
    if (a.phase === 'prelim' && b.phase === 'prelim') {
      return (a.round || 1) - (b.round || 1);
    }
    return 0;
  });
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
  const fin = asSingleMatch(data.matches.final);
  if (!fin?.winnerId) return null;
  const champion = playerName(data, fin.winnerId);
  const runnerId = fin.winnerId === fin.p1Id ? fin.p2Id : fin.p1Id;
  const runnerUp = playerName(data, runnerId);
  const officialTopFour = getOfficialTopFour(data)?.filter(Boolean) as string[] | null;
  const semis = asMatchArray(data.matches.semi).map((m) => m.winnerId).filter(Boolean);
  const top4Ids = officialTopFour?.length
    ? officialTopFour
    : [...new Set([...semis, fin.p1Id, fin.p2Id].filter(Boolean))] as string[];
  const top4 = top4Ids.map((id) => playerName(data, id));
  return { champion, runnerUp, top4 };
}
