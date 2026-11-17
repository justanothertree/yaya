-- ROLLBACK for docs/2026-11-15-lab-pool-by-turns.DRAFT.sql: Reversi and Chess only, as before.
-- Pool matches already open stay readable and finishable; only new Pool challenges are refused.
create or replace function public.lab_match_playable(p_demo text)
returns boolean
language sql immutable
set search_path = public, pg_temp
as $$ select p_demo in ('reversi', 'chess') $$;
