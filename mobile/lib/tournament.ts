import { Match, SessionData } from './types';

function asMatchArray(value: SessionData['matches'][string] | undefined): Match[] {
  if (!Array.isArray(value) || (value.length > 0 && typeof value[0] === 'string')) return [];
  return value as Match[];
}

function asSingleMatch(value: SessionData['matches'][string] | undefined): Match | null {
  if (!value || Array.isArray(value) || typeof value !== 'object') return null;
  return value as Match;
}

export function playerName(data: SessionData | null, id?: string | null) {
  if (!id || !data?.players) return '待定';
  return data.players.find((p) => p.id === id)?.name || '待定';
}

export function getAllMatches(data: SessionData | null): Match[] {
  const m = data?.matches;
  if (!m) return [];
  return [
    ...asMatchArray(m.prelim),
    ...asMatchArray(m.quarter),
    ...asMatchArray(m.revival),
    ...(asSingleMatch(m.challenge) ? [asSingleMatch(m.challenge)!] : []),
    ...asMatchArray(m.semi),
    ...(asSingleMatch(m.final) ? [asSingleMatch(m.final)!] : []),
  ];
}

export function readyMatches(data: SessionData | null): Match[] {
  return getAllMatches(data).filter((m) => m.status === 'pending' && m.p1Id && m.p2Id);
}

export function sessionStats(matches: Match[]) {
  const playable = matches.filter((m) => m.p1Id && m.p2Id);
  const total = playable.length;
  const done = playable.filter((m) => m.status === 'done').length;
  const pending = playable.filter((m) => m.status === 'pending').length;
  return {
    total,
    done,
    pending,
    pct: total ? Math.round((done / total) * 100) : 0,
  };
}
