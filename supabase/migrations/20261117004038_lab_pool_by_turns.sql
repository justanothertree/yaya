-- ✅ APPLIED to production 17 Nov 2026 (UTC) as migration `lab_pool_by_turns`, version 20261117004038, with Evan's
-- approval of the Lab by-turns queue. Production recorded md5(statements[1]) =
-- 55040414f1e9e3ce784252d2243ee158 over 194 bytes, this file's body byte for byte. Block A of the
-- checks matched what was tested beside it before the apply. Block B: lab_match_playable's body e33c8ae8 (reversi, chess, pool), one definition,
-- callable by neither anon nor authenticated. lab-move v2, which plays Pool, went live after it.
-- Why, and the rollback: docs/2026-11-15-lab-pool-by-turns.DRAFT.sql and the files beside it.

create or replace function public.lab_match_playable(p_demo text)
returns boolean
language sql immutable
set search_path = public, pg_temp
as $$ select p_demo in ('reversi', 'chess', 'pool') $$;