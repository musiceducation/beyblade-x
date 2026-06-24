/**
 * Copy to arena-config.local.js and fill in your Supabase + Vercel values.
 * arena-config.local.js is gitignored — never commit service role keys.
 */
window.ARENA_CONFIG = {
  /** Unique id for this event (same value in Vercel NEXT_PUBLIC_EVENT_SLUG) */
  eventSlug: 'mie-mie-2026',

  /** Fixed player link (Vercel deployment URL) */
  playerPortalUrl: 'https://your-cloud-player.vercel.app',

  supabase: {
    url: 'https://YOUR_PROJECT.supabase.co',
    /** Service role key — host sync only; keep secret */
    serviceKey: 'YOUR_SERVICE_ROLE_KEY',
  },
};
