-- Multi-room tournament platform (App / cloud)
-- Run in Supabase SQL Editor after schema.sql (or standalone).

create table if not exists public.rooms (
  code text primary key,
  referee_password_hash text not null,
  revision bigint not null default 0,
  updated_at timestamptz not null default now(),
  junior jsonb not null default '{}'::jsonb,
  senior jsonb not null default '{}'::jsonb,
  live jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.rooms enable row level security;

grant select on public.rooms to anon, authenticated;
grant select, insert, update, delete on public.rooms to service_role;

drop policy if exists "rooms_public_read" on public.rooms;
create policy "rooms_public_read"
  on public.rooms for select
  to anon, authenticated
  using (true);

-- Writes go through Next.js API with service_role (bypasses RLS).
-- Do not add public INSERT/UPDATE policies.
