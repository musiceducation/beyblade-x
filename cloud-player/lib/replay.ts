import { ArenaReplayRow } from '@/lib/constants';

export const FINISH_ICONS: Record<string, string> = {
  burst: '💥',
  over: '⬆',
  extreme: '⚡',
  spin: '🌀',
};

export const FINISH_LABELS: Record<string, string> = {
  burst: '擊飛',
  over: '昇華',
  extreme: '極限',
  spin: '停轉',
};

export type ReplayMetadata = {
  session?: string;
  phase?: string;
  p1Name?: string;
  p2Name?: string;
  battleNum?: number;
  startScores?: [number, number];
  finalScores?: [number, number];
  createdAt?: string;
  events?: Array<{
    type: string;
    player?: number;
    finishType?: string;
    points?: number;
    scores?: number[];
    ts?: number;
  }>;
};

export function replayMeta(row: ArenaReplayRow): ReplayMetadata {
  return (row.metadata || {}) as ReplayMetadata;
}

export function replayBattleDelta(meta: ReplayMetadata) {
  const start = meta.startScores
    || meta.events?.find((e) => e.type === 'battleStart')?.scores
    || [0, 0];
  const end = meta.finalScores || start;
  return [end[0] - start[0], end[1] - start[1]] as [number, number];
}

export function formatReplayTime(iso?: string) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('zh-Hant', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export function formatReplayDate(iso?: string) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('zh-Hant', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export function replayFinishEvents(meta: ReplayMetadata) {
  return (meta.events || []).filter((e) => e.type === 'finish');
}

export function matchGroupSummary(rounds: ArenaReplayRow[]) {
  const last = rounds[rounds.length - 1];
  const meta = replayMeta(last);
  const total = meta.finalScores || [0, 0];
  const videoCount = rounds.filter((r) => r.has_video).length;
  const hasMatchEnd = rounds.some((r) =>
    replayMeta(r).events?.some((e) => e.type === 'matchEnd'),
  );
  let winner: 'p1' | 'p2' | null = null;
  if (total[0] > total[1]) winner = 'p1';
  else if (total[1] > total[0]) winner = 'p2';

  return {
    p1Name: meta.p1Name || 'Blader 1',
    p2Name: meta.p2Name || 'Blader 2',
    phase: meta.phase,
    total,
    winner,
    roundCount: rounds.length,
    videoCount,
    hasMatchEnd,
    createdAt: rounds[0]?.created_at || last.created_at,
  };
}

export function groupReplays(replays: ArenaReplayRow[]) {
  const map = new Map<string, ArenaReplayRow[]>();
  replays.forEach((r) => {
    const gid = r.match_group_id || r.id;
    if (!map.has(gid)) map.set(gid, []);
    map.get(gid)!.push(r);
  });
  return [...map.values()]
    .map((rounds) =>
      rounds.sort(
        (a, b) =>
          (a.battle_num || 0) - (b.battle_num || 0)
          || a.created_at.localeCompare(b.created_at),
      ),
    )
    .sort((a, b) => b[0]?.created_at.localeCompare(a[0]?.created_at || '') || 0);
}

export function replayDownloadFilename(meta: {
  p1Name?: string;
  p2Name?: string;
  battleNum?: number;
}) {
  const safe = (s?: string) =>
    (s || 'player').replace(/[^\w\u4e00-\u9fff-]+/g, '-').replace(/^-|-$/g, '') || 'player';
  return `beyblade-${safe(meta.p1Name)}-vs-${safe(meta.p2Name)}-b${meta.battleNum ?? 0}.webm`;
}

export async function downloadCloudReplay(
  replay: ArenaReplayRow,
  videoUrl: string | null,
  meta?: { p1Name?: string; p2Name?: string; battleNum?: number },
  onStatus?: (status: 'idle' | 'downloading') => void,
) {
  if (!videoUrl) return;
  const filename = replayDownloadFilename({
    ...meta,
    battleNum: meta?.battleNum ?? replay.battle_num ?? 0,
  });
  onStatus?.('downloading');
  try {
    const res = await fetch(videoUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error(`download ${res.status}`);
    const blobUrl = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);
  } catch (err) {
    console.warn('Replay download failed', err);
    window.open(videoUrl, '_blank', 'noopener');
  } finally {
    onStatus?.('idle');
  }
}
