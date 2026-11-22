-- ✅ APPLIED to production 17 Nov 2026 (UTC) as migration `lab_gomoku_by_turns`, version 20261117043810, with Evan's
-- approval of the Lab by-turns queue. Production recorded md5(statements[1]) =
-- 63e4587ba8e271e2dc56dbf96cc233a5 over 204 bytes, this file's body byte for byte. Block A of the
-- checks matched what was tested beside it before the apply. Block B: lab_match_playable's body 0ed51b64 (… gomoku), one definition, callable by neither
-- anon nor authenticated.
-- Why, and the rollback: docs/2026-11-16-lab-gomoku-by-turns.DRAFT.sql and the files beside it.

create or replace function public.lab_match_playable(p_demo text)
returns boolean
language sql immutable
set search_path = public, pg_temp
as $$ select p_demo in ('reversi', 'chess', 'pool', 'gomoku') $$;