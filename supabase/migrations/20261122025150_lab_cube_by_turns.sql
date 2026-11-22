-- ✅ APPLIED to production 22 Nov 2026 (UTC) as migration `lab_cube_by_turns`, version 20261122025150,
-- with Evan's approval of the Lab by-turns queue. Production recorded md5(statements[1]) =
-- e40b08c35926dc6afd1a69a99aa7c07a over 331 bytes, this file's body byte for byte.
-- Block A of the checks matched what was tested beside it before the apply. Block B:
-- lab_match_playable's body 42898e1e (… cube), one definition, callable by
-- neither anon nor authenticated. lab-move v6, which plays all of batch 3, went live after it.
-- Why, and the rollback: docs/applied/2026-11-16-lab-cube-by-turns.DRAFT.sql and
-- docs/2026-11-16-lab-cube-by-turns.ROLLBACK.sql.

create or replace function public.lab_match_playable(p_demo text)
returns boolean
language sql immutable
set search_path = public, pg_temp
as $$ select p_demo in ('reversi', 'chess', 'pool', 'gomoku', 'draughts', 'dots', 'fourrow', 'mancala', 'morris', 'hex', 'ultimate', 'breakthrough', 'fences', 'halma', 'go', 'fox', 'cube') $$;