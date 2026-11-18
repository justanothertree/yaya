-- Chat for a match by turns (docs/2026-11-18-lab-match-chat.DRAFT.sql), asked as every kind of
-- caller: a guest, a stranger, the two players, a suspended player and a pair no longer friends.
-- Each case is a real call under a real role with real claims.
--
-- HOW TO RUN, until the draft is applied and recorded as a migration: on the throwaway stack
-- db-guards.yml builds. ⚠️ Its `supabase db reset` is the 4 Nov dump plus the seed, which predates
-- the Lab, so the three migrations the nudge guards apply come first, then the draft:
--   for m in 20261109030613_lab_catalog_and_feedback 20261115002456_lab_matches_and_results \
--            20261117003350_lab_match_nudge; do
--     psql "$DB_URL" -v ON_ERROR_STOP=1 -q -1 -f "supabase/migrations/$m.sql"; done
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f docs/2026-11-18-lab-match-chat.DRAFT.sql
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/lab-match-chat.sql
-- Measured that way on 18 Nov 2026, on a stack reset exactly as the job resets it: all 30 hold.
-- Everything here is in one transaction that rolls back. It raises, listing every failed case, if
-- anything is wrong, and says how many cases it asked otherwise.
--
-- ⚠️ IT REFUSES TO PASS BY ASKING NOTHING: block 0 checks the draft and the seed are there.

begin;

insert into public.lab_demos (id) values ('reversi'), ('chess') on conflict (id) do nothing;

do $$
declare
  o  uuid := '00000000-0000-4000-a000-000000000001'; -- seedowner: seat 0
  f  uuid := '00000000-0000-4000-a000-000000000002'; -- seedfriend: seat 1
  s  uuid := '00000000-0000-4000-a000-000000000003'; -- seedstranger
  mid uuid;
  cid uuid;
  j jsonb;
  t text;
  n int;
  first_id bigint;
  fails text[] := '{}';
  asked int := 0;
begin
 begin
  /* ---------------------------------------------------------------- 0. the fixtures are real */
  if to_regclass('public.lab_match_chat') is null or to_regprocedure('public.lab_match_say(uuid, text)') is null
     or to_regprocedure('public.lab_match_lines(uuid, bigint)') is null then
    raise exception 'FIXTURE: the chat draft is not applied';
  end if;
  if not public.lab_pair_friends(o, f) or public.lab_pair_friends(o, s) then
    raise exception 'FIXTURE: the seed''s owner and friend are not friends, or the stranger is';
  end if;
  delete from public.lab_matches where least(player_a, player_b) = least(o, f) and greatest(player_a, player_b) = greatest(o, f);
  insert into public.lab_matches (demo_id, mode, player_a, player_b) values ('reversi', 'versus', o, f) returning id into mid;
  insert into public.lab_matches (demo_id, mode, player_a, player_b, status) values ('chess', 'versus', o, f, 'declined') returning id into cid;

  /* ---------------------------------------------------------------- 1. the table is shut */
  asked := asked + 1;
  select count(*) into n
  from (values ('anon'), ('authenticated')) r(role)
  cross join (values ('select'), ('insert'), ('update'), ('delete'), ('truncate'), ('references'), ('trigger')) p(priv)
  where has_table_privilege(r.role, 'public.lab_match_chat', p.priv);
  if n <> 0 then fails := array_append(fails, format('1: %s table privileges held by anon/authenticated', n)); end if;
  asked := asked + 1;
  if exists (select 1 from pg_class c where c.oid = 'public.lab_match_chat'::regclass
               and (not c.relrowsecurity or exists (select 1 from pg_policy p where p.polrelid = c.oid))) then
    fails := array_append(fails, '1: the chat table has RLS off, or a policy');
  end if;
  asked := asked + 1;
  if has_sequence_privilege('anon', 'public.lab_match_chat_id_seq', 'usage')
     or has_sequence_privilege('authenticated', 'public.lab_match_chat_id_seq', 'usage') then
    fails := array_append(fails, '1: anon or authenticated can use the chat id sequence');
  end if;

  /* ---------------------------------------------------------------- 2. who may call */
  asked := asked + 1;
  select string_agg(p.proname || ':' || has_function_privilege('anon', p.oid, 'execute')::text || ':'
                    || has_function_privilege('authenticated', p.oid, 'execute')::text, ' ' order by p.proname)
    into t from pg_proc p join pg_namespace s2 on s2.oid = p.pronamespace
   where s2.nspname = 'public' and p.proname in ('lab_match_say', 'lab_match_lines');
  if t is distinct from 'lab_match_lines:false:true lab_match_say:false:true' then
    fails := array_append(fails, '2: callable chat functions are ' || coalesce(t, 'none'));
  end if;

  /* ---------------------------------------------------------------- 3. a guest */
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
  foreach t in array array[format('select public.lab_match_say(%L, ''hi'')', mid),
                           format('select public.lab_match_lines(%L)', mid),
                           'select count(*) from public.lab_match_chat'] loop
    asked := asked + 1;
    begin
      execute t;
      fails := array_append(fails, '3: a guest ran ' || t);
    exception when insufficient_privilege then null;
    end;
  end loop;
  perform set_config('role', 'postgres', true);

  /* ---------------------------------------------------------------- 4. a stranger */
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  foreach t in array array[format('select public.lab_match_say(%L, ''hi'')', mid),
                           format('select public.lab_match_lines(%L)', mid)] loop
    asked := asked + 1;
    begin
      execute t;
      fails := array_append(fails, '4: a stranger ran ' || t);
    exception when sqlstate 'P0002' then null;
    end;
  end loop;

  /* ---------------------------------------------------------------- 5. the two players */
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  asked := asked + 1;
  j := public.lab_match_say(mid, '  your move whenever  ');
  first_id := (j->>'id')::bigint;
  if j->>'body' <> 'your move whenever' or (j->>'seat')::int <> 0 or not (j->>'mine')::boolean then
    fails := array_append(fails, '5: the challenger''s line came back as ' || j::text);
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
  asked := asked + 1;
  j := public.lab_match_lines(mid);
  if jsonb_array_length(j) <> 1 or j->0->>'body' <> 'your move whenever' or (j->0->>'mine')::boolean
     or (j->0->>'seat')::int <> 0 then
    fails := array_append(fails, '5: the friend read ' || j::text);
  end if;
  asked := asked + 1;
  j := public.lab_match_say(mid, 'on it');
  if (j->>'seat')::int <> 1 then fails := array_append(fails, '5: the friend spoke from seat ' || (j->>'seat')); end if;
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  asked := asked + 1;
  j := public.lab_match_lines(mid, first_id);
  if jsonb_array_length(j) <> 1 or j->0->>'body' <> 'on it' or (j->0->>'mine')::boolean then
    fails := array_append(fails, '5: the lines after the first read ' || j::text);
  end if;

  /* ---------------------------------------------------------------- 6. what a line may be */
  foreach t in array array['', '   ', repeat('x', 301), E'one\ntwo', E'tab\there', E'bell\x07'] loop
    asked := asked + 1;
    begin
      perform public.lab_match_say(mid, t);
      fails := array_append(fails, '6: a line was taken: ' || left(t, 20));
    exception when sqlstate '22023' then null;
    end;
  end loop;
  asked := asked + 1;
  if (public.lab_match_say(mid, repeat('y', 300))->>'body') <> repeat('y', 300) then
    fails := array_append(fails, '6: a line of exactly 300 was not taken whole');
  end if;

  /* ---------------------------------------------------------------- 7. a declined challenge */
  asked := asked + 1;
  begin
    perform public.lab_match_say(cid, 'hello?');
    fails := array_append(fails, '7: a declined challenge took a line');
  exception when sqlstate '22023' then null;
  end;
  perform set_config('role', 'postgres', true);
  update public.lab_matches set status = 'finished', state = '{}', result = '{"winner":0}', finished_at = now()
   where id = cid;
  perform set_config('role', 'authenticated', true);
  asked := asked + 1;
  if (public.lab_match_say(cid, 'good game')->>'body') <> 'good game' then
    fails := array_append(fails, '7: a finished match did not take "good game"');
  end if;

  /* ---------------------------------------------------------------- 8. twenty a minute */
  for n in 1..20 loop
    begin
      perform public.lab_match_say(mid, 'line ' || n);
    exception when sqlstate '54000' then
      -- the challenger has said two already this minute: the twentieth of theirs is refused
      if n <= 18 then fails := array_append(fails, '8: refused at only ' || n); end if;
    end;
  end loop;
  asked := asked + 1;
  begin
    perform public.lab_match_say(mid, 'one too many');
    fails := array_append(fails, '8: a twenty-first line in a minute was taken');
  exception when sqlstate '54000' then null;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
  asked := asked + 1;
  begin
    perform public.lab_match_say(mid, 'my own twenty are untouched');
  exception when sqlstate '54000' then
    fails := array_append(fails, '8: one seat''s lines counted against the other''s');
  end;

  /* ---------------------------------------------------------------- 9. five hundred a match */
  perform set_config('role', 'postgres', true);
  insert into public.lab_match_chat (match_id, by_seat, body, at)
  select mid, 1, 'old ' || g, now() - interval '1 day' from generate_series(1, 500) g;
  perform set_config('role', 'authenticated', true);
  asked := asked + 1;
  begin
    perform public.lab_match_say(mid, 'and one more');
    fails := array_append(fails, '9: a full chat took a line');
  exception when sqlstate '54000' then null;
  end;
  asked := asked + 1;
  if jsonb_array_length(public.lab_match_lines(mid)) <> 100 then
    fails := array_append(fails, '9: a long chat did not read back as its last hundred');
  end if;

  /* ---------------------------------------------------------------- 10. a suspended player */
  perform set_config('role', 'postgres', true);
  delete from public.lab_match_chat where match_id = mid and body like 'old %';
  update public.profiles set suspended = true where user_id = f;
  perform set_config('role', 'authenticated', true);
  asked := asked + 1;
  begin
    perform public.lab_match_say(cid, 'still here');
    fails := array_append(fails, '10: a suspended player said a line');
  exception when sqlstate '42501' then null;
  end;
  perform set_config('role', 'postgres', true);
  update public.profiles set suspended = false where user_id = f;

  /* ---------------------------------------------------------------- 11. no longer friends */
  delete from public.friendships where user_a = least(o, f) and user_b = greatest(o, f);
  perform set_config('role', 'authenticated', true);
  foreach t in array array[format('select public.lab_match_say(%L, ''hi'')', mid),
                           format('select public.lab_match_lines(%L)', mid)] loop
    asked := asked + 1;
    begin
      execute t;
      fails := array_append(fails, '11: after unfriending, ran ' || t);
    exception when sqlstate 'P0002' then null;
    end;
  end loop;

  /* ---------------------------------------------------------------- 12. the lines go with the match */
  perform set_config('role', 'postgres', true);
  delete from public.lab_matches where id = mid;
  asked := asked + 1;
  if exists (select 1 from public.lab_match_chat where match_id = mid) then
    fails := array_append(fails, '12: a deleted match left its lines behind');
  end if;

 exception when others then
  fails := array_append(fails, 'UNEXPECTED after ' || asked || ' cases: ' || sqlerrm);
 end;
  perform set_config('role', 'postgres', true);
  if array_length(fails, 1) > 0 then
    raise exception E'lab match chat: % of % cases failed:\n  %', array_length(fails, 1), asked,
      array_to_string(fails, E'\n  ');
  end if;
  raise notice 'lab match chat: all % cases hold', asked;
end;
$$;

rollback;
