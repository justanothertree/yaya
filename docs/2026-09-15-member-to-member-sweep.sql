-- 2026-09-15 — what one member can see of another. READ ONLY.
--
-- WHY THIS IS A SCRIPT AND NOT A REVIEW
--
-- The anon sweep could be done by probing the live site, because anon is a role anybody can
-- assume. Member-to-member cannot: it needs two signed-in accounts, and the function BODIES live
-- in the Supabase migrations rather than in this repo, so reading the code is not available
-- either. What IS available is asking the database to answer as one member about another.
--
-- ⚠️ IT TESTS BEHAVIOUR, NOT CODE. A pass means "this rule held for these two members today". It
-- does not mean the function is correct for every pair, and it cannot see a rule nobody thought
-- to check. Treat a FAIL as certain and a PASS as evidence. Section 6 is how the code itself
-- gets reviewed.
--
-- ⚠️ READ ONLY. Nothing here writes, and the parts that assume a session are wrapped in a
-- transaction that rolls back, so a mistake of mine cannot become a mistake in your database.
--
-- ⚠️ RUN ONE SECTION AT A TIME and paste what comes back. Independent blocks, so an error in one
-- does not cost you the others.
--
-- The viewer is the OLDEST account and the subject is the second oldest, picked automatically so
-- there are no ids to paste anywhere.


-- ── 1. WHO IS PLAYING WHOM ──────────────────────────────────────────────────────────────────
-- EXPECT: two different usernames.
--
-- ⚠️ THE PARENTHESES ARE LOAD-BEARING. Postgres will not accept `order by`/`limit` inside a
-- branch of a UNION without them, so the version that stood here from 2026-09-15 until
-- 2026-10-16 was a syntax error, and section 1 had never run even once.
(select 'viewer' as part, username from public.profiles
  where coalesce(suspended,false)=false order by created_at limit 1)
union all
(select 'subject', username from public.profiles
  where coalesce(suspended,false)=false order by created_at offset 1 limit 1);

-- ── 1b. WHAT IS ACTUALLY AT STAKE ───────────────────────────────────────────────────────────
-- ⚠️ READ THIS BEFORE BELIEVING SECTIONS 2 TO 4. Each of those is a question about the
-- subject, and a question about a subject who holds nothing is one that passes by default.
-- If `pii_fields` is 0, section 2 proves nothing. If `private` and `friends` are both 0,
-- section 4 proves nothing — every block is public, so withholding none is correct.
--
-- EXPECT: pii_fields > 0, and at least one non-public block. Where it is 0, say so in the
-- write-up rather than reporting a pass.
with viewer as (
  select user_id from public.profiles
   where coalesce(suspended,false)=false order by created_at limit 1),
subject as (
  select p.user_id, p.username from public.profiles p
   where coalesce(p.suspended,false)=false
     and p.user_id <> (select user_id from viewer)
   order by (p.phone is not null)::int + (p.address is not null)::int
          + (p.birthday is not null)::int + (p.venmo is not null)::int
          + (p.cashapp is not null)::int + (p.zelle is not null)::int desc,
           (select count(*) from public.profile_blocks b where b.user_id = p.user_id) desc,
           p.created_at
   limit 1)
select s.username as subject,
       (select (p.phone is not null)::int + (p.address is not null)::int
             + (p.birthday is not null)::int + (p.venmo is not null)::int
             + (p.cashapp is not null)::int + (p.zelle is not null)::int
          from public.profiles p where p.user_id = s.user_id) as pii_fields,
       (select count(*) from public.profile_blocks b
         where b.user_id = s.user_id and b.visibility = 'private') as private,
       (select count(*) from public.profile_blocks b
         where b.user_id = s.user_id and b.visibility = 'friends') as friends,
       (select count(*) from public.profile_blocks b
         where b.user_id = s.user_id and b.visibility = 'members') as members,
       (select count(*) from public.profile_blocks b
         where b.user_id = s.user_id and b.visibility = 'public') as public,
       public.are_friends((select user_id from viewer), s.user_id) as viewer_is_their_friend
  from subject s;



-- ── 2. PII IS OWN-ROW-OR-ADMIN ──────────────────────────────────────────────────────────────
-- The sharpest question here. update_my_profile stores phone, birthday, address, venmo, cashapp
-- and zelle; the 2026-08-19 sweep recorded those as own-row-or-admin. That was a month and a lot
-- of profile work ago, so this asks the database whether it is still true — as the viewer,
-- about the subject.
--
-- EXPECT: ZERO ROWS. A row means one member can read another's contact and payment details.
begin;
  -- ⚠️ BOTH IDS ARE RESOLVED HERE, BEFORE THE ROLE CHANGES, and that ordering is the whole
  -- correctness of the block. Once the role is `authenticated`, RLS on `profiles` leaves the
  -- viewer exactly ONE visible row — their own — so a subquery that looks the SUBJECT up by
  -- name returns NULL without erroring, and the test below then asks its question about nobody.
  -- Measured 2026-10-16: rows of `profiles` visible to a member = 1, and the subject lookup
  -- came back NULL, which is what made sections 2 and 4 incapable of reporting a failure.
  select set_config('sweep.viewer', (select user_id::text from public.profiles
                                      where coalesce(suspended,false)=false
                                      order by created_at limit 1), true);
  -- ⚠️ AND THE SUBJECT IS PICKED FOR HAVING SOMETHING TO LOSE. "Second oldest" is a stable
  -- rule that needs no ids pasted anywhere, which is why it was chosen — but on 2026-10-16 it
  -- picked a subject with no PII and no private block, so section 2 asked a stranger to read
  -- fields that were all NULL and section 4 asked them to read blocks that were all 'public'.
  -- Both reported a pass about a question with nothing in it. So: most PII fields first, then
  -- most blocks. Section 1b PRINTS the stake, because the pick can still come up toothless on
  -- some future data and that has to be visible rather than silent.
  select set_config('sweep.subject', (select p.user_id::text from public.profiles p
                                       where coalesce(p.suspended,false)=false
                                         and p.user_id <> current_setting('sweep.viewer')::uuid
                                       order by (p.phone is not null)::int + (p.address is not null)::int
                                               + (p.birthday is not null)::int + (p.venmo is not null)::int
                                               + (p.cashapp is not null)::int + (p.zelle is not null)::int desc,
                                                (select count(*) from public.profile_blocks b
                                                  where b.user_id = p.user_id) desc,
                                                p.created_at
                                       limit 1), true);
  -- a statement of its own: two set_config() calls in ONE select have no guaranteed order,
  -- so reading sweep.subject in the same statement that sets it can read it unset.
  select set_config('sweep.subject_name', (select p.username from public.profiles p
                                       where p.user_id = current_setting('sweep.subject')::uuid), true);
  select set_config('request.jwt.claims',
    json_build_object('sub', current_setting('sweep.viewer'),
                      'role','authenticated')::text, true);
  set local role authenticated;

  select p.username, p.phone, p.address, p.birthday, p.venmo, p.cashapp, p.zelle
    from public.profiles p
   where p.user_id = current_setting('sweep.subject')::uuid
     and (p.phone is not null or p.address is not null or p.birthday is not null
       or p.venmo is not null or p.cashapp is not null or p.zelle is not null);
rollback;


-- ── 3. THE TIERS THEMSELVES ─────────────────────────────────────────────────────────────────
-- can_see is the one place the visibility rule lives, so ask it directly rather than only
-- through its callers.
--
-- EXPECT: public = true, members = true, private = FALSE.
-- friends = true only if these two accounts are actually friends.
begin;
  -- ⚠️ BOTH IDS ARE RESOLVED HERE, BEFORE THE ROLE CHANGES, and that ordering is the whole
  -- correctness of the block. Once the role is `authenticated`, RLS on `profiles` leaves the
  -- viewer exactly ONE visible row — their own — so a subquery that looks the SUBJECT up by
  -- name returns NULL without erroring, and the test below then asks its question about nobody.
  -- Measured 2026-10-16: rows of `profiles` visible to a member = 1, and the subject lookup
  -- came back NULL, which is what made sections 2 and 4 incapable of reporting a failure.
  select set_config('sweep.viewer', (select user_id::text from public.profiles
                                      where coalesce(suspended,false)=false
                                      order by created_at limit 1), true);
  -- ⚠️ AND THE SUBJECT IS PICKED FOR HAVING SOMETHING TO LOSE. "Second oldest" is a stable
  -- rule that needs no ids pasted anywhere, which is why it was chosen — but on 2026-10-16 it
  -- picked a subject with no PII and no private block, so section 2 asked a stranger to read
  -- fields that were all NULL and section 4 asked them to read blocks that were all 'public'.
  -- Both reported a pass about a question with nothing in it. So: most PII fields first, then
  -- most blocks. Section 1b PRINTS the stake, because the pick can still come up toothless on
  -- some future data and that has to be visible rather than silent.
  select set_config('sweep.subject', (select p.user_id::text from public.profiles p
                                       where coalesce(p.suspended,false)=false
                                         and p.user_id <> current_setting('sweep.viewer')::uuid
                                       order by (p.phone is not null)::int + (p.address is not null)::int
                                               + (p.birthday is not null)::int + (p.venmo is not null)::int
                                               + (p.cashapp is not null)::int + (p.zelle is not null)::int desc,
                                                (select count(*) from public.profile_blocks b
                                                  where b.user_id = p.user_id) desc,
                                                p.created_at
                                       limit 1), true);
  -- a statement of its own: two set_config() calls in ONE select have no guaranteed order,
  -- so reading sweep.subject in the same statement that sets it can read it unset.
  select set_config('sweep.subject_name', (select p.username from public.profiles p
                                       where p.user_id = current_setting('sweep.subject')::uuid), true);
  select set_config('request.jwt.claims',
    json_build_object('sub', current_setting('sweep.viewer'),
                      'role','authenticated')::text, true);
  set local role authenticated;

  select t as tier,
         public.can_see(current_setting('sweep.subject')::uuid,
                        t::public.visibility_tier) as allowed
    from unnest(array['public','members','friends','private']) t;
rollback;


-- ── 4. EVERY BLOCK OF THEIRS, AND WHETHER THIS VIEWER PASSES IT ─────────────────────────────
-- EXPECT: NO 'private' row appears at all, and no 'friends' row unless they really are
-- friends (1b says which). Every row that DOES appear is one this viewer is allowed.
-- ⚠️ The output has no 'allowed' column any more: the RPC answers by OMITTING what is
-- withheld, so absence is the pass and a 'private' row showing up is the failure.
--
-- ⚠️ THROUGH THE RPC, NOT THE TABLE. This block used to select from `public.profile_blocks`
-- directly, which worked only because `authenticated` still held a SELECT grant on it. The
-- 2026-10-16 revoke that finished the house pattern turned that read into `permission denied`,
-- so the block had to change — and the RPC is the more faithful question anyway, because
-- `get_profile_blocks` is the only way the product ever reads a block. It applies `can_see`
-- itself, so what it hands over IS the answer: a block that appears here is one this viewer
-- may see, and one that is missing is one they may not.
begin;
  -- ⚠️ BOTH IDS ARE RESOLVED HERE, BEFORE THE ROLE CHANGES, and that ordering is the whole
  -- correctness of the block. Once the role is `authenticated`, RLS on `profiles` leaves the
  -- viewer exactly ONE visible row — their own — so a subquery that looks the SUBJECT up by
  -- name returns NULL without erroring, and the test below then asks its question about nobody.
  -- Measured 2026-10-16: rows of `profiles` visible to a member = 1, and the subject lookup
  -- came back NULL, which is what made sections 2 and 4 incapable of reporting a failure.
  select set_config('sweep.viewer', (select user_id::text from public.profiles
                                      where coalesce(suspended,false)=false
                                      order by created_at limit 1), true);
  -- ⚠️ AND THE SUBJECT IS PICKED FOR HAVING SOMETHING TO LOSE. "Second oldest" is a stable
  -- rule that needs no ids pasted anywhere, which is why it was chosen — but on 2026-10-16 it
  -- picked a subject with no PII and no private block, so section 2 asked a stranger to read
  -- fields that were all NULL and section 4 asked them to read blocks that were all 'public'.
  -- Both reported a pass about a question with nothing in it. So: most PII fields first, then
  -- most blocks. Section 1b PRINTS the stake, because the pick can still come up toothless on
  -- some future data and that has to be visible rather than silent.
  select set_config('sweep.subject', (select p.user_id::text from public.profiles p
                                       where coalesce(p.suspended,false)=false
                                         and p.user_id <> current_setting('sweep.viewer')::uuid
                                       order by (p.phone is not null)::int + (p.address is not null)::int
                                               + (p.birthday is not null)::int + (p.venmo is not null)::int
                                               + (p.cashapp is not null)::int + (p.zelle is not null)::int desc,
                                                (select count(*) from public.profile_blocks b
                                                  where b.user_id = p.user_id) desc,
                                                p.created_at
                                       limit 1), true);
  -- a statement of its own: two set_config() calls in ONE select have no guaranteed order,
  -- so reading sweep.subject in the same statement that sets it can read it unset.
  select set_config('sweep.subject_name', (select p.username from public.profiles p
                                       where p.user_id = current_setting('sweep.subject')::uuid), true);
  select set_config('request.jwt.claims',
    json_build_object('sub', current_setting('sweep.viewer'),
                      'role','authenticated')::text, true);
  set local role authenticated;

  select b->>'block_type' as block_type, b->>'visibility' as visibility
    from jsonb_array_elements(
           public.get_profile_blocks(current_setting('sweep.subject_name'))) b
   order by (b->>'position')::int;
rollback;


-- ── 4b. AND THE TABLE ITSELF IS UNREACHABLE ─────────────────────────────────────────────────
-- The house pattern asserted rather than assumed. CLAUDE.md §3 says these tables are reached
-- ONLY through definer RPCs, and until 2026-10-16 two of the three named there were ALSO
-- granted directly to `anon` and `authenticated`. This is the line that notices the day one of
-- them grows a grant again — which the schema's own default ACL does to any NEW table in
-- `public` without anybody asking for it.
--
-- EXPECT: 'refused' on all four rows.
select t as table_name, r as role_tried,
       case when has_table_privilege(r, 'public.'||t, 'select')
              or has_table_privilege(r, 'public.'||t, 'truncate')
            then '⚠️ GRANTED' else 'refused' end as verdict
  from unnest(array['profile_blocks','profile_notes']) t,
       unnest(array['anon','authenticated']) r
 order by 1, 2;


-- ── 5. TWO STANDING AUDITS ──────────────────────────────────────────────────────────────────
-- Neither is about one pair of members; both are about the shape of the surface.

-- a) EXPECT ZERO ROWS. A SECURITY DEFINER that resolves names through the CALLER'S search_path
--    is the classic privilege-escalation shape, which is why every definer here pins one.
select p.proname, pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef
   and not exists (
     select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c where c like 'search_path=%')
 order by 1;

-- b) EXPECT ZERO ROWS. Anything named for acting on your OWN row that nevertheless takes a
--    parameter naming a user. These are safe today because they read auth.uid() and take no
--    target — this is the check that notices the day one of them grows one.
select p.proname, pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and (p.proname like 'set_my_%' or p.proname like 'update_my_%' or p.proname like 'get_my_%')
   and pg_get_function_identity_arguments(p.oid) ilike '%user%'
 order by 1;


-- ── 6. THE CODE ITSELF ──────────────────────────────────────────────────────────────────────
-- ⚠️ THE ONLY PART THAT REVIEWS RATHER THAN TESTS, and the reason it is last is that it is the
-- one thing a behavioural check cannot do: sections 2 to 4 can only find a rule that is wrong
-- for THESE TWO members, and cannot see a rule that is missing entirely.
--
-- These four are the whole member-to-member profile surface. Paste the output back.
--
-- get_member_activity is also what unblocks the public activity feed: guessing at its return
-- type inside a migration that runs against production is not a thing to do.
select pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('get_member_profile','get_profile_blocks',
                     'get_member_activity','list_profile_notes')
 order by p.proname;
