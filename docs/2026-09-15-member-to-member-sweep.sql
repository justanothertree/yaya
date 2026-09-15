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
select 'viewer' as part, username from public.profiles
 where coalesce(suspended,false)=false order by created_at limit 1
union all
select 'subject', username from public.profiles
 where coalesce(suspended,false)=false order by created_at offset 1 limit 1;


-- ── 2. PII IS OWN-ROW-OR-ADMIN ──────────────────────────────────────────────────────────────
-- The sharpest question here. update_my_profile stores phone, birthday, address, venmo, cashapp
-- and zelle; the 2026-08-19 sweep recorded those as own-row-or-admin. That was a month and a lot
-- of profile work ago, so this asks the database whether it is still true — as the viewer,
-- about the subject.
--
-- EXPECT: ZERO ROWS. A row means one member can read another's contact and payment details.
begin;
  select set_config('request.jwt.claims',
    json_build_object('sub', (select user_id from public.profiles
                              where coalesce(suspended,false)=false
                              order by created_at limit 1),
                      'role','authenticated')::text, true);
  set local role authenticated;

  select p.username, p.phone, p.address, p.birthday, p.venmo, p.cashapp, p.zelle
    from public.profiles p
   where p.user_id = (select user_id from public.profiles
                      where coalesce(suspended,false)=false
                      order by created_at offset 1 limit 1)
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
  select set_config('request.jwt.claims',
    json_build_object('sub', (select user_id from public.profiles
                              where coalesce(suspended,false)=false
                              order by created_at limit 1),
                      'role','authenticated')::text, true);
  set local role authenticated;

  select t as tier,
         public.can_see((select user_id from public.profiles
                         where coalesce(suspended,false)=false
                         order by created_at offset 1 limit 1),
                        t::public.visibility_tier) as allowed
    from unnest(array['public','members','friends','private']) t;
rollback;


-- ── 4. EVERY BLOCK OF THEIRS, AND WHETHER THIS VIEWER PASSES IT ─────────────────────────────
-- EXPECT: allowed = false on every 'private' row, and on 'friends' rows unless they are friends.
begin;
  select set_config('request.jwt.claims',
    json_build_object('sub', (select user_id from public.profiles
                              where coalesce(suspended,false)=false
                              order by created_at limit 1),
                      'role','authenticated')::text, true);
  set local role authenticated;

  select b.block_type, b.visibility,
         public.can_see(b.user_id, b.visibility) as allowed
    from public.profile_blocks b
   where b.user_id = (select user_id from public.profiles
                      where coalesce(suspended,false)=false
                      order by created_at offset 1 limit 1)
   order by b.position;
rollback;


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
