-- Safe to re-run. Fixes「雲端失敗」(permission denied 42501).
-- Policies already exist? Skip schema.sql policies section — only run this file.

grant select on public.arena_state to anon, authenticated;
grant select on public.arena_replays to anon, authenticated;
grant select, insert, update, delete on public.arena_state to service_role;
grant select, insert, update, delete on public.arena_replays to service_role;
