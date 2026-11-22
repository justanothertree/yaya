-- ✅ APPLIED to production 22 Nov 2026 (UTC) as migration `lab_hex_by_turns`, version 20261122023840:
-- md5(statements[1]) = 1c1fcb6ebb6db9397687d2aa04188782, this file's body. The record is
-- supabase/migrations/20261122023840_lab_hex_by_turns.sql.
--
-- (as drafted) Hex by turns: step 10 of the Lab multiplayer plan, the third of the toys whose rules were written for the call rooms (Mancala, Nine men's morris, Hex, …).
--
-- One function, replaced: lab_match_playable names the toys a match may be played on, and Hex joins
-- Reversi, Chess, Pool, Five in a row, Draughts, Dots, Four in a row, Mancala and Nine men's morris. Nothing else changes:
-- no table, no column, no grant. `create or replace` keeps the function's privileges, which are
-- none for anon and authenticated (only lab_match_challenge calls it), and block B of the checks
-- beside this proves that.
--
-- ⚠️ IT ASSUMES NINE MEN'S MORRIS IS ALREADY PLAYABLE (docs/2026-11-16-lab-morris-by-turns.DRAFT.sql).
-- Block A of the checks says which list production holds; on anything shorter, stop and apply the
-- earlier drafts first, or this would quietly make their toys playable too.
--
-- ⚠️ ORDER WITH THE REDEPLOY: apply this AFTER the lab-move that knows Hex's rules is live.
-- The other way round, a challenge could be accepted by a function that refuses it as "a toy or
-- settings that cannot be played by turns" — harmless, but a dead invitation.
--
-- ROLLBACK: docs/2026-11-16-lab-hex-by-turns.ROLLBACK.sql. CHECKS: …checks.sql beside it.
create or replace function public.lab_match_playable(p_demo text)
returns boolean
language sql immutable
set search_path = public, pg_temp
as $$ select p_demo in ('reversi', 'chess', 'pool', 'gomoku', 'draughts', 'dots', 'fourrow', 'mancala', 'morris', 'hex') $$;
