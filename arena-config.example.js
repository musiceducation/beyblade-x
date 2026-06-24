/**
 * Copy to arena-config.local.js and fill in public values.
 * Copy arena-secrets.example.json → arena-secrets.local.json for the service role key.
 */
window.ARENA_CONFIG = {
  /** Unique id for this event (same value in Vercel NEXT_PUBLIC_EVENT_SLUG) */
  eventSlug: 'mie-mie-2026',

  /** Fixed player link (Vercel deployment URL) */
  playerPortalUrl: 'https://your-cloud-player.vercel.app',

  /** Public Supabase URL (for replay video links in the browser) */
  supabase: {
    url: 'https://YOUR_PROJECT.supabase.co',
  },
};
