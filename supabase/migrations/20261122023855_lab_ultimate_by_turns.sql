-- ✅ APPLIED to production 22 Nov 2026 (UTC) as migration `lab_ultimate_by_turns`, version 20261122023855,
-- with Evan's approval of the Lab by-turns queue. Production recorded md5(statements[1]) =
-- 6523248745316a16131a29fb3fe7811c over 275 bytes, this file's body byte for byte.
-- Block A of the checks matched what was tested beside it before the apply. Block B:
-- lab_match_playable's body b6ba192d (… ultimate), one definition, callable by
-- neither anon nor authenticated. lab-move v6, which plays all of batch 3, went live after it.
-- Why, and the rollback: docs/applied/2026-11-16-lab-ultimate-by-turns.DRAFT.sql and
-- docs/2026-11-16-lab-ultimate-by-turns.ROLLBACK.sql.

create or replace function public.lab_match_playable(p_demo text)
returns boolean
language sql immutable
set search_path = public, pg_temp
as $$ select p_demo in ('reversi', 'chess', 'pool', 'gomoku', 'draughts', 'dots', 'fourrow', 'mancala', 'morris', 'hex', 'ultimate') $$;