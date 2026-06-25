export const PHASE_LABELS: Record<string, string> = {
  prelim: '初賽',
  revival: '復活賽',
  quarter: '複賽',
  challenge: '四強挑戰',
  semi: '準決賽',
  final: '決賽',
};

export const PHASE_ORDER: Record<string, number> = {
  prelim: 0,
  revival: 1,
  quarter: 2,
  challenge: 3,
  semi: 4,
  final: 5,
};

export const SESSION_LABELS: Record<string, string> = {
  junior: '第一場 親子組',
  senior: '第二場 公開組',
};

export const POLL_MS = 1500;

export type Player = { id: string; name: string };

export type Match = {
  id: string;
  phase: string;
  label?: string;
  p1Id?: string | null;
  p2Id?: string | null;
  status: 'pending' | 'done';
  winnerId?: string | null;
  scores?: [number, number] | null;
  liveScores?: [number, number] | null;
  battles?: number;
  liveBattles?: number;
};

export type SessionData = {
  players: Player[];
  drawn: boolean;
  matches: Record<string, Match | Match[]>;
  activeMatchId?: string | null;
};

export type ArenaLiveState = {
  updatedAt?: number;
  session?: string;
  phase?: string;
  p1Name?: string;
  p2Name?: string;
  scores?: [number, number];
  battle?: number;
  matchOver?: boolean;
  matchLabel?: string | null;
  active?: boolean;
  broadcastStatus?: 'live' | 'break' | 'delay' | string;
  broadcastMessage?: string;
  stationName?: string;
};

export type ArenaStateRow = {
  event_slug: string;
  revision: number;
  updated_at: string;
  junior: SessionData;
  senior: SessionData;
  live?: ArenaLiveState | null;
};

export type ArenaReplayRow = {
  id: string;
  event_slug: string;
  match_group_id: string | null;
  battle_num: number | null;
  metadata: Record<string, unknown>;
  has_video: boolean;
  created_at: string;
};
