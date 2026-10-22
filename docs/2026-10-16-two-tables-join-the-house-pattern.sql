-- 2026-10-16 — profile_blocks and profile_notes join the house pattern.
--
-- ✅ APPLIED as migration `profile_blocks_and_notes_deny_all_grants` (version
-- 20261016045431). Re-verified 2026-10-22: all three tables still read `true, 0, 0`, and no
-- new table has arrived in `public` carrying the default grants.
--
-- CLAUDE.md §3 opens with the house pattern for member data: "table with RLS on, zero policies,
-- no grants — deny-all — reached only through SECURITY DEFINER RPCs that check auth.uid() and
-- consult can_see(). profile_blocks, profile_notes and member_library all work this way."
--
-- Measured on 2026-10-15, two of the three did not:
--
--   member_library   rls_on=true, policies=0, grants=0   ← the pattern
--   profile_blocks   rls_on=true, policies=0, grants=13
--   profile_notes    rls_on=true, policies=0, grants=13
--
-- This is the revoke that makes the sentence true, and the reasoning for it. It is deliberately
-- the only thing in the migration: these are live profile tables.


-- ═══ WHAT THE 13 WERE ═══════════════════════════════════════════════════════════════════════
--
-- Worth writing down per role, because "13 grants" hides the shape and the shape is the point:
--
--   anon           INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER          (6)
--   authenticated  INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, SELECT  (7)
--
-- anon is missing SELECT and nothing else, because 2026-09-15-public-activity-and-unused-grants
-- revoked exactly that — `revoke select on public.profile_blocks from anon` and the same for
-- notes. That pass was right about the principle and reached one privilege of six. Its own note
-- says it verified the tables "by asking as anon, which read zero rows from every one of them",
-- which is a check on SELECT; the five it left behind were never asked about.
--
-- ⚠️ AND NOBODY EVER GRANTED ANY OF IT. The 13 are the schema's DEFAULT ACL:
--
--   select pg_get_userbyid(defaclrole), defaclacl::text from pg_default_acl d
--     left join pg_namespace n on n.oid = d.defaclnamespace
--    where n.nspname = 'public' and d.defaclobjtype = 'r';
--
-- answers `{postgres=arwdDxtm/postgres, anon=arwdDxtm/postgres, authenticated=arwdDxtm/postgres,
-- service_role=arwdDxtm/postgres}` — all seven privileges, to both client roles, on every table
-- created in `public` from now until somebody changes that default. Demonstrated by accident
-- while testing something else: a scratch table created in `public` and granted NOTHING was
-- readable by `authenticated` on its first query. So this revoke is a correction, not a fix.
-- The next table added to `public` will arrive with the same 13, and the house pattern has to
-- be re-asserted by hand each time — which is what section 4b of the member-to-member sweep
-- now exists to notice.


-- ═══ WHY IT WAS WORTH DOING, AND WHERE THE ORIGINAL REASONING WAS WRONG ═════════════════════
--
-- The honest framing on 2026-10-15 was: not a live hole, because RLS with zero policies returns
-- nothing, every real reader goes through a definer RPC, and the grant is inert. Clean it up for
-- CLAUDE.md's own rule — don't grant what cannot be used — because the grant is inert only while
-- the table has no policy, and the day anybody adds one it becomes live without that being a
-- decision anybody made.
--
-- That is right about four privileges out of five and WRONG about the fifth.
--
-- ⚠️ RLS DOES NOT COVER TRUNCATE. There is no TRUNCATE policy type — CREATE POLICY takes ALL,
-- SELECT, INSERT, UPDATE and DELETE — so a TRUNCATE grant is not neutralised by a deny-all
-- table the way the others are. Measured on a scratch table with RLS on and zero policies,
-- holding three rows, granted the same privileges anon held here:
--
--   INSERT    refused  — new row violates row-level security policy
--   DELETE    allowed, affected 0 rows      (RLS hid them; the grant achieved nothing)
--   TRUNCATE  SUCCEEDED — table emptied     (RLS never applied)
--
-- So "the grant is inert" was a claim about reads that happened to be made about a privilege
-- list containing a destructive one. The thing standing between `anon` and an empty
-- profile_blocks was not RLS and not a privilege check: it was PostgREST having no verb that
-- emits TRUNCATE. That is a real barrier and it held — this was not exploitable — but it is the
-- API's surface area rather than the database's, and it is not what anybody reviewing those
-- grants would have assumed was doing the work.
--
-- The lesson is narrower than "audit your grants" and worth keeping: when reasoning that a
-- grant is made harmless by RLS, enumerate the privileges and ask it of each one, because the
-- argument is per-privilege and one of them is not covered.


-- ═══ SAFE BY CONSTRUCTION, AND THEN MEASURED ANYWAY ═════════════════════════════════════════
--
-- Eleven functions touch the two tables, and all eleven are SECURITY DEFINER owned by postgres:
--
--   reads   get_demo_profile, get_member_chronicle, get_profile_blocks, get_public_profile,
--           guestbook_open_to, list_achievements, list_activity_notices, list_profile_notes
--   writes  delete_profile_note, post_profile_note, save_my_profile_blocks
--
-- A definer runs as its owner, so what anon and authenticated hold on the table cannot reach it.
-- That is the argument; §2 says not to ship the argument on its own.
--
-- The mechanism, on a scratch table with RLS on, zero policies and the caller granted nothing:
--
--   caller's own direct select   0 rows
--   definer read                 1 row    (the row that was there)
--   definer write                2 rows   (inserted, then counted)
--
-- And the product, before and after the revoke: 72 readings — 6 viewers × every reader of these
-- two tables — hashed into one snapshot.
--
--   before  72 rows, md5 e53ef2b35f37aaa1f290508f5bf43489
--   after   72 rows, md5 e53ef2b35f37aaa1f290508f5bf43489
--
-- ⚠️ THAT HASH IS A CLAIM WITH A DATE ON IT, AND THE DATE IS THE POINT. It hashes LIVE member
-- content, so it is a valid before/after only across a change made in one sitting — which is
-- what it was for, minutes apart on 2026-10-16. Re-run on 2026-10-22 it reads
-- 9c62780e013ce28f704207c0fdc8d96b, because `profile_blocks` went from 34 rows to 40 and
-- `profile_notes` from 11 to 12: members added things. Nothing regressed. Do not re-run this
-- hash as a regression test and do not "fix" a mismatch — §11's rule about lists that have to
-- be maintained by hand applies to measured constants too.
--
-- What IS durable is the ordering underneath it, so that is the check worth keeping: a stranger
-- must see strictly fewer of a subject's blocks than a friend, an admin or the subject does,
-- whenever the subject holds a gated one. Re-measured 2026-10-22, after the revoke and 25
-- unrelated commits:
--
--   subject   self/admin   friend   stranger
--   Josh          20         20        19
--   Salty          4          4         3
--   evan           9          9      (none)
--
-- ⚠️ `evan` has no stranger reading because every viewer in the set is their friend, their
-- admin, or themselves — the same flat-fixture trap as the first snapshot, one subject down.
-- Josh and Salty carry the result; evan's row establishes nothing and is left visible saying so
-- rather than removed, because a column of blanks is the honest shape of that gap.
--
-- ⚠️ THE VIEWER SET IS THE WHOLE VALUE OF THAT SNAPSHOT, and the first one I built was useless.
-- It had four viewers who all saw everything — two friends of the subject, one admin, and the
-- subject themselves — so every hash was identical and a broken tier filter would have produced
-- the same figure. Cam and Moxol are in it now precisely because they are neither friends nor
-- admins: they see 3 of Salty's 4 blocks and 19 of Josh's 20, where the others see all. With
-- that, a tier regression moves the snapshot; without it, nothing does. Pick viewers who are
-- refused something, or the baseline agrees with any bug you like.


-- ═══ THE REVOKE ═════════════════════════════════════════════════════════════════════════════
--
-- `public, anon, authenticated` rather than just the two roles, per CLAUDE.md §3: a revoke aimed
-- at PUBLIC does not cover anon here, and the reverse is just as true, so name all three. PUBLIC
-- held nothing on these tables, so that third name is a no-op kept for the habit.
--
-- postgres and service_role keep their seven each: postgres owns every definer that does the
-- real work, and service_role is the server-side path.

revoke all on public.profile_blocks from public, anon, authenticated;
revoke all on public.profile_notes  from public, anon, authenticated;


-- ═══ AFTER ══════════════════════════════════════════════════════════════════════════════════
--
-- All eight member-data tables now read true, 0, 0:
--
--   chronicle_activities, chronicle_entries, chronicle_goals, chronicle_plans,
--   chronicle_routines, member_library, profile_blocks, profile_notes
--
-- Per privilege, both client roles, both tables — all false:
--
--   select t.tbl, r.role,
--          has_table_privilege(r.role, t.tbl, 'select')   as sel,
--          has_table_privilege(r.role, t.tbl, 'insert')   as ins,
--          has_table_privilege(r.role, t.tbl, 'update')   as upd,
--          has_table_privilege(r.role, t.tbl, 'delete')   as del,
--          has_table_privilege(r.role, t.tbl, 'truncate') as trunc
--     from unnest(array['public.profile_blocks','public.profile_notes']) t(tbl)
--     cross join unnest(array['anon','authenticated']) r(role);
--
-- postgres and service_role: 7 privileges each, unchanged. Rows: 34 blocks, 11 notes, unchanged.


-- ═══ WHAT THIS BROKE, WHICH IS THE PART I NEARLY SHIPPED WITHOUT NOTICING ═══════════════════
--
-- ⚠️ docs/2026-09-15-member-to-member-sweep.sql SECTION 4 READ `public.profile_blocks`
-- DIRECTLY, and only ever worked because `authenticated` held the SELECT grant this file
-- removes. After the revoke it raises `permission denied for table profile_blocks`. The 2026-09-15
-- grants file ends with the sentence "The sweep's section 4 is the regression test", so the
-- regression test for this surface was the thing the change broke. It is repaired in that file
-- and now goes through `get_profile_blocks`, which is both unaffected by grants and the only way
-- the product ever reads a block.
--
-- Chasing that turned up three more faults in the sweep, none of them caused by this change, all
-- of them the same species — a check that cannot fail:
--
--   §1   never parsed. `select ... order by created_at limit 1 union all select ...` is a syntax
--        error in Postgres without parentheses around the branches. Section 1 had not run once
--        since it was written.
--
--   §2–4 asked their questions about NOBODY. Each block does `set local role authenticated` and
--        then resolves the SUBJECT with `(select user_id from public.profiles where ... offset 1)`.
--        Under that role, RLS on `profiles` leaves the viewer exactly ONE visible row — their own
--        — so the subject lookup returns NULL silently. Measured: rows of `profiles` visible to a
--        member = 1, subject lookup = NULL. §2's `where p.user_id = <NULL>` matches nothing, so
--        "EXPECT ZERO ROWS. A row means one member can read another's contact and payment
--        details" returned zero rows unconditionally — the sweep's own sharpest question,
--        incapable of answering. §3 fed NULL to can_see and read false on every tier including
--        ones that should be true. Ids are now resolved BEFORE the role changes.
--
--   §2   and then STILL had nothing at stake, one level down. The subject is picked as the
--        second-oldest account, and that account has no phone, address, birthday, venmo, cashapp
--        or zelle — so even with the NULL fixed, a stranger was being asked to read six columns
--        that were all already empty. Only two of thirteen members have any PII at all. The
--        subject is now picked for having the most to lose, and §1b PRINTS the stake, because a
--        picking rule can come up toothless again on future data and that must be visible.
--
-- Perturbed before being believed, per §2 of CLAUDE.md:
--
--   evan → evan (own row, which the rule ALLOWS)      1 row   ← the query can fire
--   Cam  → evan (5 PII fields, not an admin)          0 rows  ← the rule genuinely holds
--
-- The first of those is the control that makes the second mean something. And the good news is
-- real: with a subject who actually has contact and payment details, a member cannot read them.
-- That had never been established before today.


-- ═══ THREE MORE TABLES IN THE SAME SHAPE — NAMED, NOT CHANGED ═══════════════════════════════
--
-- Same query, asked of every table in `public`: RLS on, zero policies, still granted to a client
-- role. After this migration, three remain.
--
--   invites               authenticated 7
--   profile_rooms         anon 6 + authenticated 7   — anon still holds TRUNCATE
--   profile_room_invites  anon 6 + authenticated 7   — anon still holds TRUNCATE
--
-- profile_rooms and profile_room_invites are the other two tables 2026-09-15 revoked SELECT from
-- anon on, left in exactly the state this file has just taken profile_blocks and profile_notes
-- out of. invites was recorded as deliberate in that file — "get_invite_by_token is how an invite
-- is read, it is a definer, and a future policy on this table would want the grant already in
-- place" — which is a decision rather than an oversight, and is also precisely the condition
-- that makes a grant become live without anybody choosing it.
--
-- Not touched here: this migration is about the two tables CLAUDE.md names, and the instruction
-- was not to combine it with anything else. Raised separately.


-- ── HOW TO CHECK IT ─────────────────────────────────────────────────────────────────────────
-- The house pattern, which should read true/0/0 on every row. The same query lives at the end of
-- docs/rpc-inventory.md:

select c.relname, c.relrowsecurity as rls_on,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policies,
       (select count(*) from information_schema.role_table_grants g
         where g.table_schema='public' and g.table_name=c.relname
           and g.grantee in ('anon','authenticated')) as grants
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname='public' and c.relkind='r'
  and c.relname in ('profile_blocks','profile_notes','member_library',
                    'chronicle_activities','chronicle_entries','chronicle_goals',
                    'chronicle_plans','chronicle_routines')
order by c.relname;

-- And the standing version, which asks the question of the whole schema rather than of a list
-- somebody has to keep up to date. Every row is a table whose grant is inert only for as long
-- as it has no policy:

select c.relname,
  (select count(*) from information_schema.role_table_grants g
    where g.table_schema='public' and g.table_name=c.relname and g.grantee='anon') as anon,
  (select count(*) from information_schema.role_table_grants g
    where g.table_schema='public' and g.table_name=c.relname and g.grantee='authenticated') as authed,
  has_table_privilege('anon', c.oid, 'truncate') as anon_truncate
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname='public' and c.relkind='r' and c.relrowsecurity
  and (select count(*) from pg_policy p where p.polrelid = c.oid) = 0
  and (select count(*) from information_schema.role_table_grants g
        where g.table_schema='public' and g.table_name=c.relname
          and g.grantee in ('anon','authenticated')) > 0
order by c.relname;
