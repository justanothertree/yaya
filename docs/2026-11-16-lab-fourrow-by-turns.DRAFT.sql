-- ⛔ DRAFT — NOT APPLIED. Four in a row by turns: step 4 of the Lab multiplayer plan, the last of
-- the remaining versus toys (Five in a row, Draughts, Dots, Four in a row).
--
-- One function, replaced: lab_match_playable names the toys a match may be played on, and Four in
-- a row joins Reversi, Chess, Pool, Five in a row, Draughts and Dots. Nothing else changes: no table, no column, no grant.
-- `create or replace` keeps the function's privileges, which are none for anon and authenticated
-- (only lab_match_challenge calls it), and block B of the checks beside this proves that.
--
-- ⚠️ IT ASSUMES DOTS IS ALREADY PLAYABLE (docs/2026-11-16-lab-dots-by-turns.DRAFT.sql).
-- Block A of the checks says which list production holds; on anything shorter, stop and apply the
-- earlier drafts first, or this would quietly make their toys playable too.
--
-- ⚠️ ORDER WITH THE REDEPLOY: apply this AFTER the lab-move that knows Four in a row's rules is
-- live. The other way round, a challenge could be accepted by a function that refuses it as "a toy
-- or settings that cannot be played by turns" — harmless, but a dead invitation.
--
-- ROLLBACK: docs/2026-11-16-lab-fourrow-by-turns.ROLLBACK.sql. CHECKS: …checks.sql beside it.
create or replace function public.lab_match_playable(p_demo text)
returns boolean
language sql immutable
set search_path = public, pg_temp
as $$ select p_demo in ('reversi', 'chess', 'pool', 'gomoku', 'draughts', 'dots', 'fourrow') $$;
