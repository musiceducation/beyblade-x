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

export const FINISH_ANNOUNCE_LABELS: Record<string, { zh: string; en: string }> = {
  extreme: { zh: '極致收尾', en: 'Xtreme Finish' },
  over: { zh: '擊飛結局', en: 'Over Finish' },
  burst: { zh: '爆裂結局', en: 'Burst Finish' },
  spin: { zh: '殘存結局', en: 'Spin Finish' },
};

export const REPLAY_FINISH_FALLBACK_GAP_MS = 2200;
export const REPLAY_FINISH_MIN_GAP_MS = 2400;
export const REPLAY_ANNOUNCE_MS = 1800;

export type ReplayFinishEvent = {
  type: string;
  player?: number;
  finishType?: string;
  points?: number;
  scores?: number[];
  ts?: number;
};

export type FinishScheduleEntry = {
  event: ReplayFinishEvent;
  delay: number;
  videoSeek: number | null;
};

export function isReplayDebug() {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('bex-replay-debug') === '1'
    || new URLSearchParams(window.location.search).has('replayDebug');
}

export function replayDebug(...args: unknown[]) {
  if (isReplayDebug()) console.log('[replay]', ...args);
}

export function replayTimelineBase(meta: ReplayMetadata) {
  const events = meta.events || [];
  const launch = events.find((e) => e.type === 'launch');
  const battleStart = events.find((e) => e.type === 'battleStart');
  return launch?.ts || battleStart?.ts || 0;
}

export function getReplayStartScores(meta: ReplayMetadata): [number, number] {
  const fromEvent = meta.events?.find((e) => e.type === 'battleStart')?.scores;
  if (fromEvent && fromEvent.length >= 2) return [fromEvent[0], fromEvent[1]];
  if (meta.startScores) return meta.startScores;
  return [0, 0];
}

export function buildFinishSchedule(meta: ReplayMetadata, videoDurationSec = 0): FinishScheduleEntry[] {
  const base = replayTimelineBase(meta);
  const finishes = (meta.events || []).filter((e) => e.type === 'finish');
  if (!finishes.length) return [];

  const hasTimestamps = base > 0 && finishes.every((e) => e.ts);

  if (!hasTimestamps) {
    if (videoDurationSec > 0) {
      const spanMs = Math.max(2800, videoDurationSec * 1000 * 0.9);
      const leadMs = Math.min(800, spanMs * 0.08);
      const tailMs = Math.min(1200, spanMs * 0.1);
      const usable = Math.max(1200, spanMs - leadMs - tailMs);
      const step = finishes.length > 1 ? usable / (finishes.length - 1) : 0;
      return finishes.map((event, i) => {
        const delay = leadMs + step * i;
        return { event, delay, videoSeek: delay / 1000 };
      });
    }
    let delay = 500;
    return finishes.map((event) => {
      const entry: FinishScheduleEntry = { event, delay, videoSeek: null };
      delay += REPLAY_FINISH_FALLBACK_GAP_MS;
      return entry;
    });
  }

  let lastDelay = 350;
  return finishes.map((event) => {
    const idealDelay = Math.max(350, (event.ts || 0) - base);
    const delay = lastDelay > 350
      ? Math.max(idealDelay, lastDelay + REPLAY_FINISH_MIN_GAP_MS)
      : idealDelay;
    lastDelay = delay;
    return {
      event,
      delay,
      videoSeek: Math.max(0, ((event.ts || 0) - base) / 1000),
    };
  });
}

export function waitForVideoReady(video: HTMLVideoElement): Promise<number> {
  if (!video.src) return Promise.resolve(0);
  if (video.readyState >= 3 && Number.isFinite(video.duration)) return Promise.resolve(video.duration);

  return new Promise((resolve) => {
    const done = () => resolve(Number.isFinite(video.duration) ? video.duration : 0);
    video.addEventListener('canplay', done, { once: true });
    video.addEventListener('loadedmetadata', () => {
      if (video.readyState >= 2) done();
    }, { once: true });
    window.setTimeout(done, 4000);
  });
}

export async function prepareReplayVideo(video: HTMLVideoElement, url: string): Promise<number> {
  const current = video.currentSrc || video.src || '';
  if (current !== url && !current.endsWith(url)) {
    video.src = url;
  }
  const duration = await waitForVideoReady(video);
  try {
    video.currentTime = 0;
  } catch { /* seek unsupported */ }
  try {
    await video.play();
    video.muted = false;
    video.volume = 1;
    applyReplayPlaybackRate(video);
  } catch (err) {
    replayDebug('autoplay blocked', err);
  }
  replayDebug('video ready', { duration, url });
  return duration;
}

export async function syncReplayVideoTime(video: HTMLVideoElement, targetSec: number) {
  if (!Number.isFinite(video.duration)) return;
  const safe = Math.min(Math.max(0, targetSec), Math.max(0, video.duration - 0.05));
  const drift = Math.abs(video.currentTime - safe);
  if (drift <= 0.4) return;
  replayDebug('seek', { from: video.currentTime.toFixed(2), to: safe.toFixed(2) });
  try {
    video.currentTime = safe;
    await video.play();
  } catch { /* autoplay policy */ }
}

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

/** Shared with arena host — same localStorage keys for speed / zoom prefs */
export const REPLAY_SPEED_KEY = 'bex-replay-speed';
export const REPLAY_ZOOM_KEY = 'bex-replay-zoom';
export const REPLAY_SPEED_OPTIONS = [0.25, 0.5, 0.75, 1] as const;
export const REPLAY_ZOOM_OPTIONS = [1, 1.5, 2] as const;
export const DEFAULT_REPLAY_SPEED = 0.5;

export function formatVideoClock(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function getReplayPlaybackRate() {
  if (typeof window === 'undefined') return DEFAULT_REPLAY_SPEED;
  const v = parseFloat(localStorage.getItem(REPLAY_SPEED_KEY) || String(DEFAULT_REPLAY_SPEED));
  return (REPLAY_SPEED_OPTIONS as readonly number[]).includes(v) ? v : DEFAULT_REPLAY_SPEED;
}

export function setReplayPlaybackRate(rate: number) {
  if (typeof window === 'undefined') return;
  if (!(REPLAY_SPEED_OPTIONS as readonly number[]).includes(rate)) return;
  localStorage.setItem(REPLAY_SPEED_KEY, String(rate));
}

export function getReplayZoom() {
  if (typeof window === 'undefined') return 1;
  const v = parseFloat(localStorage.getItem(REPLAY_ZOOM_KEY) || '1');
  return (REPLAY_ZOOM_OPTIONS as readonly number[]).includes(v) ? v : 1;
}

export function setReplayZoom(zoom: number) {
  if (typeof window === 'undefined') return;
  if (!(REPLAY_ZOOM_OPTIONS as readonly number[]).includes(zoom)) return;
  localStorage.setItem(REPLAY_ZOOM_KEY, String(zoom));
}

export function cycleReplayZoom() {
  const cur = getReplayZoom();
  const idx = REPLAY_ZOOM_OPTIONS.indexOf(cur as typeof REPLAY_ZOOM_OPTIONS[number]);
  const next = REPLAY_ZOOM_OPTIONS[(idx + 1) % REPLAY_ZOOM_OPTIONS.length];
  setReplayZoom(next);
  return next;
}

export function replayZoomLabel(zoom: number) {
  if (zoom <= 1) return '🔍 1×';
  if (zoom === 1.5) return '🔍 1.5×';
  return '🔍 2×';
}

export function applyReplayZoom(video: HTMLVideoElement | null, zoom: number) {
  if (!video) return;
  video.style.transform = zoom === 1 ? '' : `scale(${zoom})`;
  video.style.transformOrigin = 'center center';
}

export function applyReplayPlaybackRate(video: HTMLVideoElement | null, rate?: number) {
  if (!video) return;
  const r = rate ?? getReplayPlaybackRate();
  video.defaultPlaybackRate = r;
  video.playbackRate = r;
}

export function replayScaleMs(ms: number) {
  const rate = getReplayPlaybackRate();
  return rate > 0 ? ms / rate : ms;
}

export function scoresAtVideoTime(
  schedule: FinishScheduleEntry[],
  timeSec: number,
  startScores: [number, number],
): [number, number] {
  let scores: [number, number] = [...startScores];
  schedule.forEach((entry) => {
    if (entry.videoSeek != null && entry.videoSeek <= timeSec + 0.05 && entry.event.scores) {
      scores = [entry.event.scores[0], entry.event.scores[1]];
    }
  });
  return scores;
}
