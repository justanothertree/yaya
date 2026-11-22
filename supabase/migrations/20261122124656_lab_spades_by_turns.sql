-- ✅ APPLIED to production 22 Nov 2026 (UTC) as migration `lab_spades_by_turns`, version 20261122124656,
-- with Evan's approval of the Lab by-turns queue. Production recorded md5(statements[1]) =
-- 3271e8254fea88ae681f1bd9fba3783d over 521 bytes, this file's body byte for byte.
-- Block A of the checks matched what was tested beside it before the apply. Block B:
-- lab_match_playable's body adab29bc (… spades), one definition, callable by
-- neither anon nor authenticated. lab-move v7, which plays all of batch 4, went live after it.
-- Why, and the rollback: docs/applied/2026-11-16-lab-spades-by-turns.DRAFT.sql and
-- docs/2026-11-16-lab-spades-by-turns.ROLLBACK.sql.

create or replace function public.lab_match_playable(p_demo text)
returns boolean
language sql immutable
set search_path = public, pg_temp
as $$ select p_demo in ('reversi', 'chess', 'pool', 'gomoku', 'draughts', 'dots', 'fourrow', 'mancala', 'morris', 'hex', 'ultimate', 'breakthrough', 'fences', 'halma', 'go', 'fox', 'cube', 'artillery', 'bowling', 'curling', 'putt', 'darts', 'backgammon', 'seabattle', 'dice', 'yacht', 'shut', 'codebreaker', 'shadowbox', 'rps', 'gin', 'cribbage', 'dominoes', 'hearts', 'spades') $$;