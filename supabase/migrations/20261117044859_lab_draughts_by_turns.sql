-- ✅ APPLIED to production 17 Nov 2026 (UTC) as migration `lab_draughts_by_turns`, version 20261117044859, with Evan's
-- approval of the Lab by-turns queue. Production recorded md5(statements[1]) =
-- 871cceacb47a409328ac4fa8d39450ab over 216 bytes, this file's body byte for byte. Block A of the
-- checks matched what was tested beside it before the apply. Block B: lab_match_playable's body 7859d76c (… draughts), one definition, callable by
-- neither anon nor authenticated.
-- Why, and the rollback: docs/2026-11-16-lab-draughts-by-turns.DRAFT.sql and the files beside it.

create or replace function public.lab_match_playable(p_demo text)
returns boolean
language sql immutable
set search_path = public, pg_temp
as $$ select p_demo in ('reversi', 'chess', 'pool', 'gomoku', 'draughts') $$;