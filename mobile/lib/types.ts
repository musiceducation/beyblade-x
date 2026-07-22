export type Player = { id: string; name: string };

export type Match = {
  id: string;
  phase: string;
  label?: string;
  round?: number;
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
  matches: Record<string, Match | Match[] | string[] | Record<string, string[]>>;
  eliminatedIds?: string[];
  revivalWinnerId?: string | null;
  activeMatchId?: string | null;
  scheduleRules?: string;
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
  broadcastStatus?: string;
  broadcastMessage?: string;
  cameraFrameUrl?: string;
  cameraUpdatedAt?: number;
  webrtcLive?: boolean;
  webrtcMode?: 'camera' | 'screen' | string;
};

export type PublicRoom = {
  code: string;
  revision: number;
  updated_at: string;
  junior: SessionData;
  senior: SessionData;
  live?: ArenaLiveState | Record<string, unknown> | null;
  created_at?: string;
};

export type RoomSession = {
  code: string;
  refereeToken: string | null;
  playerId: string | null;
  playerName: string;
};

export type LocalReplay = {
  id: string;
  roomCode: string;
  matchId?: string | null;
  matchLabel?: string;
  battleNum: number;
  uri: string;
  createdAt: number;
  uploaded?: boolean;
  cloudVideoUrl?: string;
};

export type RoomReplayPublic = {
  id: string;
  room_code: string;
  match_id: string | null;
  battle_num: number | null;
  metadata: Record<string, unknown>;
  has_video: boolean;
  created_at: string;
  videoUrl: string | null;
};
