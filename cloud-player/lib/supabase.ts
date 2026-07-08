import { createClient, SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function getSupabase() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  client = createClient(url, key);
  return client;
}

export function getEventSlug() {
  return process.env.NEXT_PUBLIC_EVENT_SLUG || 'default';
}

export function replayVideoUrl(replayId: string, ext: 'webm' | 'mp4' = 'webm') {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
  const slug = getEventSlug();
  if (!url) return null;
  return `${url}/storage/v1/object/public/replay-videos/${slug}/${replayId}.${ext}`;
}

export function preferMp4Replay() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/i.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function getReplayVideoUrls(replayId: string): string[] {
  const webm = replayVideoUrl(replayId, 'webm');
  const mp4 = replayVideoUrl(replayId, 'mp4');
  if (!webm && !mp4) return [];
  if (preferMp4Replay()) return [mp4, webm].filter(Boolean) as string[];
  return [webm, mp4].filter(Boolean) as string[];
}
