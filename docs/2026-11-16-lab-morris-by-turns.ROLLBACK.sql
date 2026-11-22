-- ROLLBACK for docs/applied/2026-11-16-lab-morris-by-turns.DRAFT.sql: back to the list before Nine men's morris.
-- Nine men's morris matches already open stay readable and finishable; only new challenges are refused.
create or replace function public.lab_match_playable(p_demo text)
returns boolean
language sql immutable
set search_path = public, pg_temp
as $$ select p_demo in ('reversi', 'chess', 'pool', 'gomoku', 'draughts', 'dots', 'fourrow', 'mancala') $$;
