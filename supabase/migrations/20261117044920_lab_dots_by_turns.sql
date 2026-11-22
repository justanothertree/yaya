-- ✅ APPLIED to production 17 Nov 2026 (UTC) as migration `lab_dots_by_turns`, version 20261117044920, with Evan's
-- approval of the Lab by-turns queue. Production recorded md5(statements[1]) =
-- ed1a29de5ed9bfd50ae56a48096be98c over 224 bytes, this file's body byte for byte. Block A of the
-- checks matched what was tested beside it before the apply. Block B: lab_match_playable's body 2c255a28 (… dots), one definition, callable by neither
-- anon nor authenticated.
-- Why, and the rollback: docs/2026-11-16-lab-dots-by-turns.DRAFT.sql and the files beside it.

create or replace function public.lab_match_playable(p_demo text)
returns boolean
language sql immutable
set search_path = public, pg_temp
as $$ select p_demo in ('reversi', 'chess', 'pool', 'gomoku', 'draughts', 'dots') $$;