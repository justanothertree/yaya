-- The nudge on an open match (migration 20261117003350_lab_match_nudge), asked as every kind of
-- caller: who may call lab_match_topic_member, who it answers yes for, and which roles the two
-- realtime.messages policies are written for. Each case is a real call under a real role with real
-- claims.
--
-- HOW TO RUN: db-guards.yml runs it on the throwaway stack it builds. ⚠️ `supabase db reset` there
-- is the 4 Nov dump plus the seed, NOT the migrations directory, and the Lab came later — so the
-- workflow first applies the three migrations this asks about, as production ran them:
--   for m in 20261109030613_lab_catalog_and_feedback 20261115002456_lab_matches_and_results \
--            20261117003350_lab_match_nudge; do
--     psql "$DB_URL" -v ON_ERROR_STOP=1 -q -1 -f "supabase/migrations/$m.sql"; done
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/lab-nudge-guards.sql
-- Everything here is in one transaction that rolls back; it leaves nothing behind. It raises,
-- listing every failed case, if anything is wrong, and says how many cases it asked otherwise.
--
-- ⚠️ WHY A GUEST MATTERS HERE MORE THAN ANYWHERE: the policies are on realtime.messages, a table
-- the Realtime server reads with the caller's own role. A policy written `to public`, or a function
-- anon could execute, would let anybody holding the publishable key listen on a match's topic.
-- `revoke … from public` does not cover anon in this project (CLAUDE.md §3), so this asks anon
-- itself, by privilege and by calling.
--
-- ⚠️ IT REFUSES TO PASS BY ASKING NOTHING: block 0 checks the function, the policies and the seed's
-- members are there before anything is asked of them.

begin;

insert into public.lab_demos (id) values ('reversi') on conflict (id) do nothing;

do $$
declare
  o  uuid := '00000000-0000-4000-a000-000000000001'; -- seedowner: a player
  f  uuid := '00000000-0000-4000-a000-000000000002'; -- seedfriend: the other player
  s  uuid := '00000000-0000-4000-a000-000000000003'; -- seedstranger: in no match
  mid uuid;
  topic text;
  fails text[] := '{}';
  asked int := 0;
  ok boolean;
  t text;
  n int;
begin
 begin
  /* ---------------------------------------------------------------- 0. the fixtures are real */
  if to_regprocedure('public.lab_match_topic_member(text)') is null then
    raise exception 'FIXTURE: lab_match_topic_member(text) does not exist; is the nudge migration applied?';
  end if;
  if (select count(*) from auth.users where id in (o, f, s)) <> 3 then
    raise exception 'FIXTURE: the seed''s owner, friend and stranger are not all there';
  end if;
  if (select count(*) from pg_policies
       where schemaname = 'realtime' and tablename = 'messages' and policyname like 'lab matches:%') = 0 then
    raise exception 'FIXTURE: no lab match policies on realtime.messages';
  end if;
  insert into public.lab_matches (demo_id, mode, player_a, player_b)
  values ('reversi', 'versus', o, f) returning id into mid;
  topic := 'labmatch:' || mid;

  /* ---------------------------------------------------------------- 1. who holds execute */
  asked := asked + 1;
  if has_function_privilege('anon', 'public.lab_match_topic_member(text)', 'execute') then
    fails := array_append(fails, '1: anon can execute lab_match_topic_member');
  end if;
  asked := asked + 1;
  if not has_function_privilege('authenticated', 'public.lab_match_topic_member(text)', 'execute') then
    fails := array_append(fails, '1: authenticated cannot execute lab_match_topic_member');
  end if;
  asked := asked + 1;
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid = 'public.lab_match_topic_member(text)'::regprocedure
                and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
    fails := array_append(fails, '1: PUBLIC holds execute on lab_match_topic_member');
  end if;

  /* ---------------------------------------------------------------- 2. a guest, calling it */
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
  foreach t in array array[format('select public.lab_match_topic_member(%L)', topic),
                           'select public.lab_match_topic_member(''labmatch:x'')'] loop
    asked := asked + 1;
    begin
      execute t;
      fails := array_append(fails, '2: a guest ran ' || t);
    exception when insufficient_privilege then null;
    end;
  end loop;
  perform set_config('role', 'postgres', true);

  /* ---------------------------------------------------------------- 3. who it says yes to */
  perform set_config('role', 'authenticated', true);
  foreach t in array array[o::text, f::text] loop
    perform set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true);
    asked := asked + 1;
    if not public.lab_match_topic_member(topic) then
      fails := array_append(fails, '3: a player of the match is refused its topic: ' || t);
    end if;
    -- the same player, on a topic that is not exactly a match's
    foreach topic in array array['labmatch:' || upper(mid::text) || 'x', 'labmatch:' || mid || ':x',
                                 'x' || 'labmatch:' || mid, 'labmatch:', 'labmatch:' || gen_random_uuid(),
                                 'realtime:labmatch:' || mid] loop
      asked := asked + 1;
      if public.lab_match_topic_member(topic) then
        fails := array_append(fails, '3: a player was let onto ' || topic);
      end if;
    end loop;
    topic := 'labmatch:' || mid;
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  asked := asked + 1;
  if public.lab_match_topic_member(topic) then
    fails := array_append(fails, '3: a member in no match was let onto its topic');
  end if;
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  asked := asked + 1;
  if public.lab_match_topic_member(topic) then
    fails := array_append(fails, '3: a token with no sub was let onto a topic');
  end if;
  perform set_config('role', 'postgres', true);

  /* ---------------------------------------------------------------- 4. the policies' roles */
  asked := asked + 1;
  select string_agg(policyname || ' ' || cmd || ' ' || array_to_string(roles, ','), ' | ' order by policyname)
    into t
  from pg_policies
  where schemaname = 'realtime' and tablename = 'messages' and policyname like 'lab matches:%';
  if t is distinct from 'lab matches: players can listen SELECT authenticated | lab matches: players can nudge INSERT authenticated' then
    fails := array_append(fails, '4: the lab match policies are ' || coalesce(t, 'none'));
  end if;
  asked := asked + 1;
  select count(*) into n from pg_policies
   where schemaname = 'realtime' and tablename = 'messages'
     and ('anon' = any(roles) or 'public' = any(roles))
     and (qual ilike '%lab_match%' or with_check ilike '%lab_match%');
  if n <> 0 then
    fails := array_append(fails, format('4: %s policies on realtime.messages reach lab matches for anon or public', n));
  end if;

 exception when others then
  fails := array_append(fails, 'UNEXPECTED after ' || asked || ' cases: ' || sqlerrm);
 end;
  perform set_config('role', 'postgres', true);
  if array_length(fails, 1) > 0 then
    raise exception E'lab nudge: % of % cases failed:\n  %', array_length(fails, 1), asked,
      array_to_string(fails, E'\n  ');
  end if;
  raise notice 'lab nudge: all % cases hold', asked;
end;
$$;

rollback;
