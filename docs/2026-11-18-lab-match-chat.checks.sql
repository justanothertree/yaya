-- READ-ONLY CHECKS for docs/2026-11-18-lab-match-chat.DRAFT.sql, to run against production.
--
-- Each block runs in a read-only transaction. If any answer differs from what the block expects,
-- stop: do not apply the draft (block A), or apply the ROLLBACK beside it (block B) — and read the
-- warning at the top of the rollback first, because once players have written lines, dropping the
-- table deletes them.
--
-- THE FINGERPRINTS are md5 of each function's body as stored (`prosrc`), read on the local stack
-- (Supabase CLI 2.122.0, Postgres 17) straight after applying the draft on 18 Nov 2026:
--
--   lab_match_say     f8ad01cbb357bf3a70ffcbafa3f0cd18
--   lab_match_lines   82511bea7c07233b14a573cfc9d5ce67
--
-- On that stack supabase/tests/lab-match-chat.sql passed all 30 cases, and was made to fail by a
-- table grant to authenticated, by a declined challenge left open, and by the rate limit lifted.

-- ── A. Before applying ──────────────────────────────────────────────────────────────────────
begin transaction read only;

-- A1. Expect NO ROWS: nothing the draft creates exists yet.
select 'table' as kind, c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'lab_match_chat'
union all
select 'function', p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('lab_match_say', 'lab_match_lines');

-- A2. Expect ONE ROW, true: the match helpers the draft calls are there, and lab_matches with them.
select to_regclass('public.lab_matches') is not null
       and to_regprocedure('public.lab_match_mine(uuid)') is not null
       and to_regprocedure('public.is_suspended(uuid)') is not null as ready;

rollback;

-- ── B. After applying ───────────────────────────────────────────────────────────────────────
begin transaction read only;

-- B1. Expect TWO ROWS, exactly these: each function once, by its fingerprint above, callable by
-- authenticated and not by anon.
select p.proname, md5(p.prosrc) as body_md5,
       has_function_privilege('anon', p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
       p.prosecdef as security_definer
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('lab_match_say', 'lab_match_lines')
order by p.proname;
--   lab_match_lines | 82511bea7c07233b14a573cfc9d5ce67 | f | t | t
--   lab_match_say   | f8ad01cbb357bf3a70ffcbafa3f0cd18 | f | t | t

-- B2. Expect ONE ROW: RLS on, no policy, and none of the seven table privileges for anon or
-- authenticated (TRUNCATE included, which RLS does not cover), nor the sequence's.
select c.relrowsecurity as rls_on,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policies,
       (select count(*) from (values ('anon'), ('authenticated')) r(role)
          cross join (values ('select'), ('insert'), ('update'), ('delete'), ('truncate'),
                             ('references'), ('trigger')) v(priv)
         where has_table_privilege(r.role, c.oid, v.priv)) as table_privileges,
       has_sequence_privilege('anon', 'public.lab_match_chat_id_seq', 'usage')
         or has_sequence_privilege('authenticated', 'public.lab_match_chat_id_seq', 'usage') as sequence_usage
from pg_class c where c.oid = 'public.lab_match_chat'::regclass;
--   t | 0 | 0 | f

-- B3. Expect ONE ROW, 0: no lines yet, so nothing has been written before the client exists.
select count(*) as lines from public.lab_match_chat;

rollback;
