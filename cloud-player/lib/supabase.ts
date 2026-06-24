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

export function replayVideoUrl(replayId: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
  const slug = getEventSlug();
  if (!url) return null;
  return `${url}/storage/v1/object/public/replay-videos/${slug}/${replayId}.webm`;
}
