-- ✅ APPLIED to production 22 Nov 2026 (UTC) as migration `lab_poker_by_turns`, version 20261122124737:
-- md5(statements[1]) = bf4b0dd3e094e15a4ee78bd88325d7a1, this file's body. The record is
-- supabase/migrations/20261122124737_lab_poker_by_turns.sql.
--
-- (as drafted) Hold’em by turns: step 10 of the Lab multiplayer plan, one of the toys
-- whose rules were written for the call rooms.
--
-- One function, replaced: lab_match_playable names the toys a match may be played on, and
-- Hold’em joins the list. Nothing else changes: no table, no column, no grant. `create or replace`
-- keeps the function's privileges, which are none for anon and authenticated (only
-- lab_match_challenge calls it), and block B of the checks beside this proves that.
--
-- ⚠️ IT ASSUMES LIAR'S DICE IS ALREADY PLAYABLE (docs/2026-11-16-lab-liars-by-turns.DRAFT.sql).
-- Block A of the checks says which list production holds; on anything shorter, stop and apply the
-- earlier drafts first, or this would quietly make their toys playable too.
--
-- ⚠️ ORDER WITH THE REDEPLOY: apply this AFTER the lab-move that knows Hold’em's rules is live.
-- The other way round, a challenge could be accepted by a function that refuses it as "a toy or
-- settings that cannot be played by turns" — harmless, but a dead invitation.
--
-- ROLLBACK: docs/2026-11-16-lab-poker-by-turns.ROLLBACK.sql. CHECKS: …checks.sql beside it.
create or replace function public.lab_match_playable(p_demo text)
returns boolean
language sql immutable
set search_path = public, pg_temp
as $$ select p_demo in ('reversi', 'chess', 'pool', 'gomoku', 'draughts', 'dots', 'fourrow', 'mancala', 'morris', 'hex', 'ultimate', 'breakthrough', 'fences', 'halma', 'go', 'fox', 'cube', 'artillery', 'bowling', 'curling', 'putt', 'darts', 'backgammon', 'seabattle', 'dice', 'yacht', 'shut', 'codebreaker', 'shadowbox', 'rps', 'gin', 'cribbage', 'dominoes', 'hearts', 'spades', 'eights', 'liars', 'poker') $$;
