-- ✅ APPLIED to production 17 Nov 2026 (UTC) as migration `lab_fourrow_by_turns`, version 20261117044939, with Evan's
-- approval of the Lab by-turns queue. Production recorded md5(statements[1]) =
-- 5618c6407353a4a274471b7103b19cf9 over 235 bytes, this file's body byte for byte. Block A of the
-- checks matched what was tested beside it before the apply. Block B: lab_match_playable's body 9daa1f0e (… fourrow), one definition, callable by neither
-- anon nor authenticated. lab-move v3, which plays all four of batch 2, went live after it.
-- Why, and the rollback: docs/2026-11-16-lab-fourrow-by-turns.DRAFT.sql and the files beside it.

create or replace function public.lab_match_playable(p_demo text)
returns boolean
language sql immutable
set search_path = public, pg_temp
as $$ select p_demo in ('reversi', 'chess', 'pool', 'gomoku', 'draughts', 'dots', 'fourrow') $$;