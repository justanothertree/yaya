-- ✅ APPLIED to production 22 Nov 2026 (UTC) as migration `lab_go_by_turns`, version 20261122025122,
-- with Evan's approval of the Lab by-turns queue. Production recorded md5(statements[1]) =
-- 07598cbef9ad622ec8ebcf4062bc50b6 over 316 bytes, this file's body byte for byte.
-- Block A of the checks matched what was tested beside it before the apply. Block B:
-- lab_match_playable's body ecc3f356 (… go), one definition, callable by
-- neither anon nor authenticated. lab-move v6, which plays all of batch 3, went live after it.
-- Why, and the rollback: docs/applied/2026-11-16-lab-go-by-turns.DRAFT.sql and
-- docs/2026-11-16-lab-go-by-turns.ROLLBACK.sql.

create or replace function public.lab_match_playable(p_demo text)
returns boolean
language sql immutable
set search_path = public, pg_temp
as $$ select p_demo in ('reversi', 'chess', 'pool', 'gomoku', 'draughts', 'dots', 'fourrow', 'mancala', 'morris', 'hex', 'ultimate', 'breakthrough', 'fences', 'halma', 'go') $$;