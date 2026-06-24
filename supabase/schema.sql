-- Beyblade X arena — Supabase schema (Approach B: cloud player portal)
-- Run in Supabase SQL Editor for your project.

-- Tournament state (one row per event)
create table if not exists public.arena_state (
  event_slug text primary key,
  revision bigint not null default 0,
  updated_at timestamptz not null default now(),
  junior jsonb not null default '{}'::jsonb,
  senior jsonb not null default '{}'::jsonb
);

-- Replay metadata (videos in Storage bucket replay-videos)
create table if not exists public.arena_replays (
  id text primary key,
  event_slug text not null,
  match_group_id text,
  battle_num int,
  metadata jsonb not null default '{}'::jsonb,
  has_video boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists arena_replays_event_slug_idx on public.arena_replays (event_slug);
create index if not exists arena_replays_match_group_idx on public.arena_replays (match_group_id);

alter table public.arena_state enable row level security;
alter table public.arena_replays enable row level security;

-- Public read for player portal (anon key)
create policy "arena_state_public_read"
  on public.arena_state for select
  to anon, authenticated
  using (true);

create policy "arena_replays_public_read"
  on public.arena_replays for select
  to anon, authenticated
  using (true);

-- Writes use service_role key from host (bypasses RLS) — no public write policies.

-- Storage: create bucket "replay-videos" in Dashboard (public) or run:
-- insert into storage.buckets (id, name, public) values ('replay-videos', 'replay-videos', true);

create policy "replay_videos_public_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'replay-videos');

-- Host uploads via service_role (bypasses RLS on storage).
