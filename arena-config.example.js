/**
 * Copy to arena-config.local.js and fill in public values.
 * Copy arena-secrets.example.json → arena-secrets.local.json for the service role key.
 */
window.ARENA_CONFIG = {
  /** Unique id for this event (same value in Vercel NEXT_PUBLIC_EVENT_SLUG) */
  eventSlug: 'mie-mie-2026',

  /** Fixed player / rooms platform URL (Vercel or local Next) */
  playerPortalUrl: 'http://localhost:3000',

  /**
   * Optional override for rooms API origin (defaults to playerPortalUrl).
   * Used by room-sync.js when binding Mac scoreboard to a cloud room.
   */
  roomsApiBase: 'http://localhost:3000',

  /** Public Supabase URL (for replay video links in the browser) */
  supabase: {
    url: 'https://YOUR_PROJECT.supabase.co',
  },
};
