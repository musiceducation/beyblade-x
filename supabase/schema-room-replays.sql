-- Room-based battle replays (BEYBATTLE App + cloud-player)
-- Run in Supabase SQL Editor after schema-rooms.sql

create table if not exists public.room_replays (
  id text primary key,
  room_code text not null references public.rooms(code) on delete cascade,
  match_id text,
  battle_num int,
  metadata jsonb not null default '{}'::jsonb,
  has_video boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists room_replays_room_code_idx on public.room_replays (room_code);
create index if not exists room_replays_match_idx on public.room_replays (match_id);

alter table public.room_replays enable row level security;

grant select on public.room_replays to anon, authenticated;
grant select, insert, update, delete on public.room_replays to service_role;

drop policy if exists "room_replays_public_read" on public.room_replays;
create policy "room_replays_public_read"
  on public.room_replays for select
  to anon, authenticated
  using (true);

-- Videos: storage bucket replay-videos, path rooms/{ROOM_CODE}/{replay_id}.mp4
-- Host / API uploads via service_role (same as arena_replays).
