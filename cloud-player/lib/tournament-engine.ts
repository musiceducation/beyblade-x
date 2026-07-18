import { Match, SessionData } from '@/lib/constants';
import { getAllMatches } from '@/lib/tournament';

const QUARTER_ENTRANTS = 8;

export function createEmptySessionData(): SessionData {
  return {
    players: [],
    drawn: false,
    matches: {},
    revivalWinnerId: null,
    activeMatchId: null,
    scheduleRules: '',
  };
}

function genId() {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function makeMatch(
  phase: string,
  index: number,
  p1Id: string | null,
  p2Id: string | null,
  label: string,
  extra: Partial<Match> = {},
): Match {
  return {
    id: `${phase}-${index}`,
    phase,
    label: label || '',
    p1Id: p1Id || null,
    p2Id: p2Id || null,
    winnerId: null,
    status: 'pending',
    scores: null,
    battles: undefined,
    liveScores: null,
    ...extra,
  };
}

function adminResetMatchFields(match: Match) {
  match.status = 'pending';
  match.winnerId = null;
  match.scores = null;
  match.battles = undefined;
  match.liveScores = null;
  match.liveBattles = undefined;
}

function adminClearMatchSlot(match: Match) {
  adminResetMatchFields(match);
  match.p1Id = null;
  match.p2Id = null;
  delete match.pairingLocked;
  delete match.queuePriority;
}

function getPrelimTarget(playerCount: number) {
  if (playerCount > QUARTER_ENTRANTS) return QUARTER_ENTRANTS;
  if (playerCount > 2 && playerCount % 2 === 1) return playerCount - 1;
  return 0;
}

function validateUniqueEntrants(ids: (string | null | undefined)[]) {
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id) continue;
    if (seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

function createReductionRound(
  phase: string,
  roundNo: number,
  entrants: string[],
  targetCount: number,
  labelPrefix: string,
  startIndex = 0,
) {
  const ids = [...entrants];
  validateUniqueEntrants(ids);
  if (ids.length <= targetCount) return { matches: [] as Match[], byes: ids };

  let matchesNeeded = Math.min(Math.floor(ids.length / 2), Math.max(0, ids.length - targetCount));
  const matches: Match[] = [];
  for (let i = 0; i < matchesNeeded; i++) {
    const p1Id = ids[i * 2]!;
    const p2Id = ids[i * 2 + 1]!;
    const needsRoundLabel = roundNo > 1 || ids.length > targetCount;
    const label = needsRoundLabel
      ? `${labelPrefix} R${roundNo}-${i + 1}`
      : `${labelPrefix} ${i + 1}`;
    matches.push(makeMatch(phase, startIndex + i, p1Id, p2Id, label, { round: roundNo }));
  }

  let byes = ids.slice(matchesNeeded * 2);
  while (byes.length >= 2) {
    const p1Id = byes.shift()!;
    const p2Id = byes.shift()!;
    const label = `${labelPrefix} R${roundNo}-${matches.length + 1}`;
    matches.push(makeMatch(phase, startIndex + matches.length, p1Id, p2Id, label, { round: roundNo }));
  }

  return { matches, byes };
}

type MatchesBucket = SessionData['matches'];

function asMatchList(value: MatchesBucket[string] | undefined): Match[] {
  if (!Array.isArray(value)) return [];
  if (value.length && typeof value[0] === 'string') return [];
  return value as Match[];
}

function asStringList(value: MatchesBucket[string] | undefined): string[] {
  if (!Array.isArray(value)) return [];
  if (value.length && typeof value[0] !== 'string') return [];
  return value as string[];
}

function ensureReductionRound(
  bucket: MatchesBucket,
  phase: string,
  targetCount: number,
  labelPrefix: string,
  entrants: string[],
  roundNo: number,
) {
  const byeKey = `${phase}Byes`;
  if (!Array.isArray(bucket[phase]) || (bucket[phase] as unknown[]).some((x) => typeof x === 'string')) {
    bucket[phase] = [];
  }
  if (!bucket[byeKey] || Array.isArray(bucket[byeKey])) bucket[byeKey] = {};
  const phaseMatches = asMatchList(bucket[phase]);
  if (phaseMatches.some((m) => (m.round || 1) === roundNo)) return;
  const { matches, byes } = createReductionRound(
    phase,
    roundNo,
    entrants,
    targetCount,
    labelPrefix,
    phaseMatches.length,
  );
  phaseMatches.push(...matches);
  bucket[phase] = phaseMatches;
  (bucket[byeKey] as Record<string, string[]>)[String(roundNo)] = byes;
}

function autoAdvanceBye(match: Match) {
  if (!match || match.status === 'done') return;
  if (match.p1Id && !match.p2Id) {
    match.winnerId = match.p1Id;
    match.status = 'done';
  } else if (!match.p1Id && match.p2Id) {
    match.winnerId = match.p2Id;
    match.status = 'done';
  }
}

function advanceReductionPhase(
  bucket: MatchesBucket,
  phase: string,
  targetCount: number,
  labelPrefix: string,
) {
  const matches = asMatchList(bucket[phase]);
  const byeKey = `${phase}Byes`;
  const directKey = `${phase}Direct`;

  if (!matches.length) {
    return { complete: true, survivors: asStringList(bucket[directKey]) };
  }

  let roundNo = 1;
  while (true) {
    const roundMatches = matches.filter((m) => (m.round || 1) === roundNo);
    if (!roundMatches.length) return { complete: false, survivors: [] as string[] };
    roundMatches.forEach(autoAdvanceBye);
    if (!roundMatches.every((m) => m.status === 'done' && m.winnerId)) {
      return { complete: false, survivors: [] as string[] };
    }

    const byeMap = (!Array.isArray(bucket[byeKey]) && bucket[byeKey]
      ? bucket[byeKey]
      : {}) as Record<string, string[]>;
    const roundByes = byeMap[String(roundNo)] || [];
    const matchWinners = roundMatches.map((m) => m.winnerId).filter(Boolean) as string[];
    const survivors = [...roundByes, ...matchWinners];

    if (survivors.length <= targetCount) return { complete: true, survivors };

    const nextRoundExists = matches.some((m) => (m.round || 1) === roundNo + 1);
    ensureReductionRound(bucket, phase, targetCount, labelPrefix, survivors, roundNo + 1);
    if (!nextRoundExists) return { complete: false, survivors };
    roundNo += 1;
  }
}

function repairRoundByePairs(
  bucket: MatchesBucket,
  phase: string,
  labelPrefix: string,
) {
  const byeKey = `${phase}Byes`;
  const rawByes = bucket[byeKey];
  if (!rawByes || Array.isArray(rawByes)) return false;
  const byeMap = rawByes as Record<string, string[]>;
  const phaseMatches = asMatchList(bucket[phase]);
  let changed = false;

  Object.keys(byeMap).forEach((roundStr) => {
    const roundNo = Number(roundStr);
    const roundByes = byeMap[roundStr];
    if (!roundByes?.length) return;
    while (roundByes.length >= 2) {
      const p1 = roundByes.shift()!;
      const p2 = roundByes.shift()!;
      const exists = phaseMatches.some((m) =>
        (m.round || 1) === roundNo
        && ((m.p1Id === p1 && m.p2Id === p2) || (m.p1Id === p2 && m.p2Id === p1)),
      );
      if (exists) continue;
      const label = `${labelPrefix} R${roundNo}-${phaseMatches.filter((m) => (m.round || 1) === roundNo).length + 1}`;
      phaseMatches.push(makeMatch(phase, phaseMatches.length, p1, p2, label, { round: roundNo }));
      changed = true;
    }
  });
  if (changed) bucket[phase] = phaseMatches;
  return changed;
}

function isQuarterSingleSlot(slot: Match) {
  return Boolean((slot.p1Id && !slot.p2Id) || (!slot.p1Id && slot.p2Id));
}

function getQuarterSlotChampion(slot: Match | undefined) {
  if (!slot) return null;
  if (slot.status === 'done' && slot.winnerId) return slot.winnerId;
  return null;
}

function repairQuarterByeSlots(quarter: Match[]) {
  let changed = false;
  const singleIndices: number[] = [];
  quarter.forEach((slot, idx) => {
    if (slot.status === 'done' || slot.pairingLocked) return;
    if (isQuarterSingleSlot(slot)) singleIndices.push(idx);
  });
  while (singleIndices.length >= 2) {
    const i = singleIndices.shift()!;
    const j = singleIndices.shift()!;
    const a = quarter[i]!;
    const b = quarter[j]!;
    const bPlayer = b.p1Id || b.p2Id;
    if (!bPlayer) continue;
    if (a.p1Id && !a.p2Id) a.p2Id = bPlayer;
    else if (!a.p1Id && a.p2Id) a.p1Id = bPlayer;
    else continue;
    adminClearMatchSlot(b);
    adminResetMatchFields(a);
    changed = true;
  }
  return changed;
}

function finalizeQuarterByeSlots(data: SessionData) {
  const q = asMatchList(data.matches.quarter);
  if (!q.length) return false;
  const dualMatches = q.filter((m) => m.p1Id && m.p2Id);
  if (dualMatches.some((m) => m.status !== 'done' || !m.winnerId)) return false;
  let changed = false;
  q.forEach((slot) => {
    if (slot.status === 'done' || !isQuarterSingleSlot(slot)) return;
    autoAdvanceBye(slot);
    if (data.activeMatchId === slot.id) data.activeMatchId = null;
    changed = true;
  });
  return changed;
}

function getPrelimLosers(data: SessionData) {
  const prelim = asMatchList(data.matches.prelim);
  return prelim
    .filter((x) => x.status === 'done' && x.winnerId)
    .map((x) => (x.winnerId === x.p1Id ? x.p2Id : x.p1Id))
    .filter(Boolean) as string[];
}

function getRevivalEntrantIds(data: SessionData) {
  const m = data.matches;
  const ids = new Set<string>();
  asMatchList(m.revival).forEach((match) => {
    if (match.p1Id) ids.add(match.p1Id);
    if (match.p2Id) ids.add(match.p2Id);
  });
  asStringList(m.revivalDirect).forEach((id) => {
    if (id) ids.add(id);
  });
  const byeMap = (!Array.isArray(m.revivalByes) && m.revivalByes
    ? m.revivalByes
    : {}) as Record<string, string[]>;
  Object.values(byeMap).flat().forEach((id) => { if (id) ids.add(id); });
  return ids;
}

function revivalEntrantsMatch(data: SessionData, expectedLosers: string[]) {
  const expected = new Set(expectedLosers);
  const current = getRevivalEntrantIds(data);
  if (expected.size !== current.size) return false;
  for (const id of expected) if (!current.has(id)) return false;
  return true;
}

function clearRevivalBracket(data: SessionData) {
  data.matches.revival = [];
  data.matches.revivalByes = {};
  data.matches.revivalDirect = [];
  data.revivalWinnerId = null;
  const challenge = data.matches.challenge;
  if (challenge && !Array.isArray(challenge) && typeof challenge === 'object' && 'id' in challenge) {
    const ch = challenge as Match;
    ch.p1Id = null;
    ch.p2Id = null;
    adminResetMatchFields(ch);
  }
}

function setupRevivalBracket(data: SessionData, eliminatedIds: string[]) {
  const prelimLosers = new Set(getPrelimLosers(data));
  const entrants = eliminatedIds.filter((id) => prelimLosers.has(id));
  const shuffled = shuffle(entrants);
  data.matches.revival = [];
  data.matches.revivalByes = {};
  data.matches.revivalDirect = [];
  if (shuffled.length <= 1) {
    data.matches.revivalDirect = shuffled;
    return;
  }
  const firstRound = createReductionRound('revival', 1, shuffled, 1, '復活');
  data.matches.revival = firstRound.matches;
  data.matches.revivalByes = { 1: firstRound.byes };
}

function syncRevivalFromPrelim(
  data: SessionData,
  prelimResult: { complete: boolean; survivors: string[] },
) {
  const revivalLosers = getPrelimLosers(data).filter(
    (id) => id && !prelimResult.survivors.includes(id),
  );
  data.eliminatedIds = revivalLosers;

  if (!prelimResult.complete || revivalLosers.length < 2) {
    if (!revivalEntrantsMatch(data, revivalLosers)) clearRevivalBracket(data);
    return;
  }
  if (!revivalEntrantsMatch(data, revivalLosers)) {
    clearRevivalBracket(data);
    setupRevivalBracket(data, revivalLosers);
  }
}

function advanceRevival(data: SessionData) {
  const rev = asMatchList(data.matches.revival);
  if (!rev.length && !asStringList(data.matches.revivalDirect).length) return;
  const result = advanceReductionPhase(data.matches, 'revival', 1, '復活');
  if (result.complete && result.survivors[0]) {
    data.revivalWinnerId = result.survivors[0];
    const challenge = data.matches.challenge;
    if (challenge && !Array.isArray(challenge) && typeof challenge === 'object' && 'id' in challenge) {
      (challenge as Match).p1Id = result.survivors[0];
    }
  }
}

function isQuarterComplete(data: SessionData) {
  const q = asMatchList(data.matches.quarter);
  const occupied = q.filter((m) => m.p1Id || m.p2Id);
  if (!occupied.length) return false;
  return occupied.every((m) => m.status === 'done' && m.winnerId);
}

function isRevivalComplete(data: SessionData) {
  const rev = asMatchList(data.matches.revival);
  if (!rev.length) {
    return Boolean(data.revivalWinnerId || asStringList(data.matches.revivalDirect).length);
  }
  return Boolean(data.revivalWinnerId);
}

function needsRevivalPath(data: SessionData) {
  return asMatchList(data.matches.revival).length > 0;
}

function isChallengeComplete(data: SessionData) {
  if (!data.revivalWinnerId) return true;
  const ch = data.matches.challenge;
  return Boolean(
    ch
    && !Array.isArray(ch)
    && typeof ch === 'object'
    && (ch as Match).status === 'done'
    && (ch as Match).winnerId,
  );
}

function isOfficialTopFourReady(data: SessionData) {
  if (!isQuarterComplete(data)) return false;
  if (needsRevivalPath(data)) {
    if (!isRevivalComplete(data)) return false;
    if (data.revivalWinnerId && !isChallengeComplete(data)) return false;
  }
  return true;
}

function getOfficialTopFour(data: SessionData): (string | null)[] | null {
  if (!isOfficialTopFourReady(data)) return null;
  const m = data.matches;
  const quarters = asMatchList(m.quarter);
  const topFour = quarters.slice(0, 4).map(getQuarterSlotChampion);
  const challenge = m.challenge;
  if (
    data.revivalWinnerId
    && challenge
    && !Array.isArray(challenge)
    && typeof challenge === 'object'
    && (challenge as Match).status === 'done'
  ) {
    const ch = challenge as Match;
    const challengedId = ch.p2Id;
    const qIdx = quarters.findIndex((q) =>
      q.winnerId === challengedId || q.p1Id === challengedId || q.p2Id === challengedId,
    );
    if (qIdx >= 0) topFour[qIdx] = ch.winnerId || null;
  }
  return topFour;
}

function clearPendingBracketSlots(matches: Match | Match[] | undefined) {
  if (!matches) return;
  const list = Array.isArray(matches) ? matches : [matches];
  list.forEach((s) => {
    if (s.status !== 'done' && !s.pairingLocked) {
      s.p1Id = null;
      s.p2Id = null;
      s.winnerId = null;
      s.status = 'pending';
      s.scores = null;
      s.battles = undefined;
      s.liveScores = null;
    }
  });
}

function syncPendingBracketPairing(match: Match | undefined, p1Id: string | null, p2Id: string | null) {
  if (!match || match.status === 'done' || match.pairingLocked) return;
  match.p1Id = p1Id || null;
  match.p2Id = p2Id || null;
  if (!match.p1Id && !match.p2Id) {
    adminResetMatchFields(match);
  } else if (match.p1Id && match.p2Id) {
    adminResetMatchFields(match);
  } else {
    adminResetMatchFields(match);
  }
}

export function advanceWinners(data: SessionData) {
  const m = data.matches;
  if (!m.prelim) return;

  repairRoundByePairs(m, 'prelim', '初賽');
  let prelimResult = advanceReductionPhase(m, 'prelim', QUARTER_ENTRANTS, '初賽');
  if (repairRoundByePairs(m, 'prelim', '初賽')) {
    prelimResult = advanceReductionPhase(m, 'prelim', QUARTER_ENTRANTS, '初賽');
  }

  const quarter = asMatchList(m.quarter);
  for (let i = 0; i < 4; i++) {
    const slot = quarter[i];
    if (!slot) continue;
    if (slot.pairingLocked) continue;
    if (!prelimResult.complete) {
      if (slot.status !== 'done') {
        slot.p1Id = null;
        slot.p2Id = null;
        slot.winnerId = null;
        slot.status = 'pending';
        slot.scores = null;
        slot.battles = undefined;
        slot.liveScores = null;
      }
      continue;
    }
    const quarterWasPlayed = slot.status === 'done' && (slot.scores || slot.liveScores);
    slot.p1Id = prelimResult.survivors[i * 2] || null;
    slot.p2Id = prelimResult.survivors[i * 2 + 1] || null;
    if (!slot.p1Id && !slot.p2Id) {
      if (!quarterWasPlayed) adminResetMatchFields(slot);
    } else if (slot.p1Id && slot.p2Id) {
      if (!quarterWasPlayed) adminResetMatchFields(slot);
    } else {
      adminResetMatchFields(slot);
    }
  }

  repairQuarterByeSlots(quarter);
  finalizeQuarterByeSlots(data);
  syncRevivalFromPrelim(data, prelimResult);
  advanceRevival(data);

  const topFour = getOfficialTopFour(data);
  const semi = asMatchList(m.semi);
  if (topFour && semi.length) {
    syncPendingBracketPairing(semi[0], topFour[0] || null, topFour[1] || null);
    syncPendingBracketPairing(semi[1], topFour[2] || null, topFour[3] || null);
  } else {
    clearPendingBracketSlots(semi);
    if (m.final && !Array.isArray(m.final) && typeof m.final === 'object') {
      clearPendingBracketSlots(m.final as Match);
    }
  }

  if (m.final && !Array.isArray(m.final) && typeof m.final === 'object') {
    syncPendingBracketPairing(
      m.final as Match,
      semi[0]?.winnerId || null,
      semi[1]?.winnerId || null,
    );
  }
}

export function buildBracketFromDraw(playerIds: string[]) {
  const shuffled = shuffle(playerIds);
  const matches: MatchesBucket = {};

  matches.prelim = [];
  matches.prelimByes = {};
  matches.prelimDirect = [];
  const prelimTarget = getPrelimTarget(shuffled.length);
  if (prelimTarget > 0 && shuffled.length > prelimTarget) {
    const firstRound = createReductionRound('prelim', 1, shuffled, prelimTarget, '初賽');
    matches.prelim = firstRound.matches;
    matches.prelimByes = { 1: firstRound.byes };
  } else {
    matches.prelimDirect = shuffled;
  }

  matches.quarter = Array.from({ length: 4 }, (_, i) =>
    makeMatch('quarter', i, null, null, `複賽 ${i + 1}`),
  );
  matches.revival = [];
  matches.challenge = makeMatch('challenge', 0, null, null, '四強挑戰');
  matches.semi = [
    makeMatch('semi', 0, null, null, '準決賽 1'),
    makeMatch('semi', 1, null, null, '準決賽 2'),
  ];
  matches.final = makeMatch('final', 0, null, null, '決賽（冠軍）');
  return matches;
}

export function addPlayer(data: SessionData, name: string) {
  const trimmed = (name || '').trim().slice(0, 16);
  if (!trimmed) return { ok: false as const, error: '請輸入名字' };
  if (data.players.some((p) => p.name === trimmed)) {
    return { ok: false as const, error: '名字已存在' };
  }
  const player = { id: genId(), name: trimmed };
  data.players.push(player);
  return { ok: true as const, player };
}

export function renamePlayer(data: SessionData, playerId: string, name: string) {
  const trimmed = (name || '').trim().slice(0, 16);
  if (!trimmed) return { ok: false as const, error: '請輸入名字' };
  const player = data.players.find((p) => p.id === playerId);
  if (!player) return { ok: false as const, error: '找不到選手' };
  if (data.players.some((p) => p.id !== playerId && p.name === trimmed)) {
    return { ok: false as const, error: '名字已存在' };
  }
  player.name = trimmed;
  return { ok: true as const, player };
}

export function removePlayer(data: SessionData, playerId: string) {
  data.players = data.players.filter((p) => p.id !== playerId);
  return { ok: true as const };
}

export function runDraw(data: SessionData) {
  const ids = data.players.map((p) => p.id);
  if (ids.length < 2) return { ok: false as const, error: '至少需要 2 名選手' };
  data.matches = buildBracketFromDraw(ids);
  data.drawn = true;
  data.revivalWinnerId = null;
  data.activeMatchId = null;
  advanceWinners(data);
  return { ok: true as const };
}

export function resetSchedule(data: SessionData) {
  data.drawn = false;
  data.matches = {};
  data.revivalWinnerId = null;
  data.activeMatchId = null;
  return { ok: true as const };
}

export function recordMatchWinner(
  data: SessionData,
  matchId: string,
  winnerSide: 1 | 2,
  scores?: [number, number],
  battles?: number,
) {
  const match = getAllMatches(data).find((m) => m.id === matchId);
  if (!match || match.status === 'done') {
    return { ok: false as const, error: '場次不存在或已完場' };
  }
  const winnerId = winnerSide === 1 ? match.p1Id : match.p2Id;
  if (!winnerId) return { ok: false as const, error: '此場尚未配對' };

  match.winnerId = winnerId;
  match.status = 'done';
  delete match.queuePriority;
  match.liveScores = null;
  match.liveBattles = undefined;
  if (scores) {
    match.scores = [...scores] as [number, number];
  }
  if (typeof battles === 'number' && Number.isFinite(battles) && battles >= 1) {
    match.battles = Math.floor(battles);
  }
  data.activeMatchId = null;
  advanceWinners(data);
  return { ok: true as const, match };
}

export function setActiveMatch(data: SessionData, matchId: string | null) {
  data.activeMatchId = matchId;
  return { ok: true as const };
}

export function setLiveScores(
  data: SessionData,
  matchId: string,
  scores: [number, number],
  battles?: number,
) {
  const match = getAllMatches(data).find((m) => m.id === matchId);
  if (!match || match.status === 'done') {
    return { ok: false as const, error: '場次不存在或已完場' };
  }
  match.liveScores = [...scores] as [number, number];
  if (typeof battles === 'number' && Number.isFinite(battles) && battles >= 1) {
    match.liveBattles = Math.floor(battles);
  }
  data.activeMatchId = matchId;
  return { ok: true as const };
}

/** Replace an entire session payload (roster + bracket + live). Referee only. */
export function replaceSessionData(data: SessionData, incoming: SessionData) {
  data.players = Array.isArray(incoming.players) ? incoming.players : [];
  data.drawn = Boolean(incoming.drawn);
  data.matches = incoming.matches && typeof incoming.matches === 'object' ? incoming.matches : {};
  data.eliminatedIds = Array.isArray(incoming.eliminatedIds) ? incoming.eliminatedIds : [];
  data.revivalWinnerId = incoming.revivalWinnerId ?? null;
  data.activeMatchId = incoming.activeMatchId ?? null;
  data.scheduleRules = typeof incoming.scheduleRules === 'string' ? incoming.scheduleRules : '';
  return { ok: true as const };
}
