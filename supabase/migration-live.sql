-- Add live overlay column for faster cloud score sync (run once in Supabase SQL Editor)
alter table public.arena_state
  add column if not exists live jsonb not null default '{}'::jsonb;
