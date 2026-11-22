-- ✅ APPLIED to production 22 Nov 2026 (UTC) as migration `lab_twentyone_by_turns`, version 20261122124855,
-- with Evan's approval of the Lab by-turns queue. Production recorded md5(statements[1]) =
-- 6fb75bac6d260a963be2bf3545764a0e over 571 bytes, this file's body byte for byte.
-- Block A of the checks matched what was tested beside it before the apply. Block B:
-- lab_match_playable's body 62810430 (… twentyone), one definition, callable by
-- neither anon nor authenticated. lab-move v7, which plays all of batch 4, went live after it.
-- Why, and the rollback: docs/applied/2026-11-16-lab-twentyone-by-turns.DRAFT.sql and
-- docs/2026-11-16-lab-twentyone-by-turns.ROLLBACK.sql.

create or replace function public.lab_match_playable(p_demo text)
returns boolean
language sql immutable
set search_path = public, pg_temp
as $$ select p_demo in ('reversi', 'chess', 'pool', 'gomoku', 'draughts', 'dots', 'fourrow', 'mancala', 'morris', 'hex', 'ultimate', 'breakthrough', 'fences', 'halma', 'go', 'fox', 'cube', 'artillery', 'bowling', 'curling', 'putt', 'darts', 'backgammon', 'seabattle', 'dice', 'yacht', 'shut', 'codebreaker', 'shadowbox', 'rps', 'gin', 'cribbage', 'dominoes', 'hearts', 'spades', 'eights', 'liars', 'poker', 'lamps', 'twentyone') $$;