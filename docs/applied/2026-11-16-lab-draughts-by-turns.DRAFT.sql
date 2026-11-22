-- ✅ APPLIED to production 17 Nov 2026 (UTC) as migration `lab_draughts_by_turns`, version 20261117044859:
-- md5(statements[1]) = 871cceacb47a409328ac4fa8d39450ab, this file's body. The record is
-- supabase/migrations/20261117044859_lab_draughts_by_turns.sql.
--
-- (as drafted) Draughts by turns: step 4 of the Lab multiplayer plan, the second of
-- the remaining versus toys (Five in a row, Draughts, Dots, Four in a row).
--
-- One function, replaced: lab_match_playable names the toys a match may be played on, and Draughts
-- joins Reversi, Chess, Pool and Five in a row. Nothing else changes: no table, no column, no grant.
-- `create or replace` keeps the function's privileges, which are none for anon and authenticated
-- (only lab_match_challenge calls it), and block B of the checks beside this proves that.
--
-- ⚠️ IT ASSUMES FIVE IN A ROW IS ALREADY PLAYABLE (docs/2026-11-16-lab-gomoku-by-turns.DRAFT.sql).
-- Block A of the checks says which list production holds; on anything shorter, stop and apply the
-- earlier drafts first, or this would quietly make their toys playable too.
--
-- ⚠️ ORDER WITH THE REDEPLOY: apply this AFTER the lab-move that knows Draughts' rules is
-- live. The other way round, a challenge could be accepted by a function that refuses it as "a toy
-- or settings that cannot be played by turns" — harmless, but a dead invitation.
--
-- ROLLBACK: docs/2026-11-16-lab-draughts-by-turns.ROLLBACK.sql. CHECKS: …checks.sql beside it.
create or replace function public.lab_match_playable(p_demo text)
returns boolean
language sql immutable
set search_path = public, pg_temp
as $$ select p_demo in ('reversi', 'chess', 'pool', 'gomoku', 'draughts') $$;
