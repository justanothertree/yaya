-- ✅ APPLIED to production 17 Nov 2026 (UTC) as migration `lab_pool_by_turns`, version 20261117004038:
-- md5(statements[1]) = 55040414f1e9e3ce784252d2243ee158, this file's body. The record is
-- supabase/migrations/20261117004038_lab_pool_by_turns.sql.
--
-- (as drafted) Pool by turns: step 7 of docs/2026-11-14-lab-async-matches-plan.md.
--
-- One function, replaced: lab_match_playable names the toys a match may be played on, and Pool
-- joins Reversi and Chess. Nothing else changes: no table, no column, no grant. `create or replace`
-- keeps the function's privileges, which are none for anon and authenticated (it is called only by
-- lab_match_challenge), and block B of the checks below proves that.
--
-- ⚠️ ORDER WITH THE REDEPLOY: apply this AFTER lab-move version 2 (which knows Pool's rules) is
-- live. The other way round, a Pool challenge could be accepted by a function that refuses it as
-- "a toy or settings that cannot be played by turns" — harmless, but a dead invitation.
--
-- ROLLBACK: docs/2026-11-15-lab-pool-by-turns.ROLLBACK.sql. CHECKS: …checks.sql beside it.
create or replace function public.lab_match_playable(p_demo text)
returns boolean
language sql immutable
set search_path = public, pg_temp
as $$ select p_demo in ('reversi', 'chess', 'pool') $$;
