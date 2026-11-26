-- READ-ONLY CHECKS for docs/applied/2026-11-18-lab-match-chat.DRAFT.sql, to run against production.
--
-- Each block runs in a read-only transaction. If any answer differs from what the block expects,
-- stop: do not apply the draft (block A), or apply the ROLLBACK beside it (block B) — and read the
-- warning at the top of the rollback first, because once players have written lines, dropping the
-- table deletes them.
--
-- THE FINGERPRINTS are md5 of each function's body as stored (`prosrc`), which is the text between
-- the draft's $$ and so the same on any Postgres. Re-measured on 22 Nov 2026, after the day's
-- window became `interval '24 hours'`, by applying the draft to four plain builds
-- (supabase/tests/plain-postgres): Postgres 16 copies of main, of main with only the three Lab
-- migrations the chat needs and of main with every Lab migration through dominoes, and a Postgres
-- 17 copy of main — identical on all four, and identical to the md5 of the text between the file's
-- own $$:
--
--   lab_match_say     b41d31fc7ff9c0669e295ba6c75167ed
--   lab_match_lines   82511bea7c07233b14a573cfc9d5ce67   (unchanged from 18 Nov: the caps are all
--                                                         in lab_match_say)
--
-- and the draft file's body, as scripts/migration-md5.mjs's bodyOf takes it (the leading comment
-- lines dropped, so the header can still be annotated), which is what production's
-- md5(statements[1]) must equal once it is applied:
--
--   docs/applied/2026-11-18-lab-match-chat.DRAFT.sql   5c4323e2b3aee06193af60cfaf02cd0d   (5,180 bytes)
--
-- On each of those, blocks A and B read as written below, supabase/tests/lab-match-chat.sql passed
-- all 43 cases, lab-matches.sql passed all 49 before the draft, with it and after the rollback, and
-- the rollback left block A reading as it did before. On the build through dominoes the chat file
-- was made to fail by every way of getting the per-member caps wrong that was tried: lifted (13 and
-- 14), the minute alone or the day alone lifted (13; 14), each one line too generous (13; 14),
-- counted from the seat the caller has in THIS match (13, 14), counted only in matches with this
-- same partner (14, by the line in a match with the stranger), a two-day window (14), both seats
-- counted (13, 14); and four that the 37 cases before these all passed: declined matches skipped
-- — or invited, going or ended ones, or every status but finished — (13, 14), a minute of one
-- second (13) or of two minutes (13), and the day written `interval '1 day'` (14, in its two made
-- zones and not in UTC, where a day is always 24 hours). Declined skipped, both minutes and the
-- '1 day' were run on the Postgres 17 build too, with the same result. Case 1 and B2, which that
-- change left alone, were made to fail earlier the same day: both caught SELECT, UPDATE and USAGE
-- on the id sequence, a column grant and TRUNCATE; the seven-privilege B2 this replaces caught only
-- the USAGE and the TRUNCATE, and read 0 and f for the other three. On the Postgres 17 build, whose
-- default ACL hands anon and authenticated arwdDxtm as production's does, B2 reads exactly
-- t | 0 | 16 | 0 | 0 | 0; a MAINTAIN grant to authenticated made it 16 | 1 and failed case 1, and
-- the old B2 read 0 for it.
--   Case 8 was given the per-match minute's edges after all of that, the same day: eight of the
-- challenger's lines from 50 seconds ago in its match and seat, and ten from 70. The file as it
-- now stands was run on the build through dominoes only — 43 hold, blocks A and B and the rollback
-- as above — and fails case 8 for a per-match minute of one second, of none (`at >= now()`) or of
-- two minutes, and for a per-match cap of twenty-one: four that the old case 8 passed. Case 9
-- then pins five hundred a match exactly (filled to 499, the 500th taken from the friend's seat,
-- the 501st refused as full and by nothing else): a cap of 499, 501, 525 or none each fails it,
-- where the old case passed anything from 501 to 532 and any refusal at all. Same build, 43 hold.
-- (On 18 Nov, before the per-member caps, it passed 30 on the local stack, Supabase CLI 2.122.0 and
-- Postgres 17, and failed for a table grant to authenticated, a declined challenge left open and the
-- rate limit lifted.)

-- ── A. Before applying ──────────────────────────────────────────────────────────────────────
begin transaction read only;

-- A1. Expect NO ROWS: nothing the draft creates exists yet — the table, its sequence, its two
-- indexes, the two functions.
select 'relation' as kind, c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('lab_match_chat', 'lab_match_chat_id_seq', 'lab_match_chat_match', 'lab_match_chat_said')
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
--   lab_match_say   | b41d31fc7ff9c0669e295ba6c75167ed | f | t | t

-- B2. Expect ONE ROW, exactly t | 0 | 16 | 0 | 0 | 0: RLS on, no policy, and NONE of every privilege
-- there is, for anon or for authenticated. The table's privileges are asked of the server rather
-- than typed (acldefault names them all), so on Postgres 17, as production is, MAINTAIN is asked
-- too — the schema's default ACL hands it out (arwdDxtm) — and on 16, where has_table_privilege
-- refuses the word, it is not. `asked` is how many role-and-privilege pairs were put: 16 means
-- MAINTAIN was among them; 14 is a Postgres 16, and anything else means stop and look. TRUNCATE is
-- among them, which RLS does not cover. Then the four a column can carry, granted on any column,
-- and all three of the id sequence's: USAGE, SELECT and UPDATE.
select c.relrowsecurity as rls_on,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policies,
       (select count(*) from aclexplode(acldefault('r', c.relowner)) a
          cross join (values ('anon'), ('authenticated')) r(role)) as asked,
       (select count(*) from aclexplode(acldefault('r', c.relowner)) a
          cross join (values ('anon'), ('authenticated')) r(role)
         where has_table_privilege(r.role, c.oid, a.privilege_type)) as table_privileges,
       (select count(*) from (values ('select'), ('insert'), ('update'), ('references')) v(priv)
          cross join (values ('anon'), ('authenticated')) r(role)
         where has_any_column_privilege(r.role, c.oid, v.priv)) as column_privileges,
       (select count(*) from aclexplode(acldefault('s', s.relowner)) a
          cross join (values ('anon'), ('authenticated')) r(role)
         where has_sequence_privilege(r.role, s.oid, a.privilege_type)) as sequence_privileges
from pg_class c, pg_class s
where c.oid = 'public.lab_match_chat'::regclass and s.oid = 'public.lab_match_chat_id_seq'::regclass;
--   t | 0 | 16 | 0 | 0 | 0

-- B3. Expect ONE ROW, 0: no lines yet, so nothing has been written before the client exists.
select count(*) as lines from public.lab_match_chat;

-- B4. Expect TWO ROWS, exactly these: the table's own two indexes — one that lab_match_lines pages
-- by, and the one the per-member counts in lab_match_say probe once per match.
select i.indexrelid::regclass as index, pg_get_indexdef(i.indexrelid) as definition
from pg_index i where i.indrelid = 'public.lab_match_chat'::regclass and not i.indisprimary
order by i.indexrelid::regclass::text;
--   lab_match_chat_match | CREATE INDEX lab_match_chat_match ON public.lab_match_chat USING btree (match_id, id)
--   lab_match_chat_said  | CREATE INDEX lab_match_chat_said ON public.lab_match_chat USING btree (match_id, by_seat, at)

rollback;
