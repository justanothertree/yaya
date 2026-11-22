-- Chat for a match by turns (docs/2026-11-18-lab-match-chat.DRAFT.sql), asked as every kind of
-- caller: a guest, a stranger, the two players, a suspended player and a pair no longer friends,
-- and then one member writing across several matches at once. Each case is a real call under a
-- real role with real claims.
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
-- With the per-member caps and the whole privilege sweep, 22 Nov 2026, built by
-- supabase/tests/plain-postgres/build.sh (plus a stand-in for the realtime.messages and
-- realtime.topic() the nudge names, which plain Postgres lacks): all 43 hold on Postgres 16 with
-- exactly the three migrations above, with all of main's, and with every Lab migration through
-- dominoes — and on Postgres 17 with all of main's, where case 1 asks MAINTAIN as well. Case 8 was
-- given the per-match minute's edges after those runs, the same day; the file as it now stands has
-- been run on the Postgres 16 build through dominoes only, where all 43 hold.
-- ⚠️ CASE 14 SETS ITS OWN TimeZone, three times — UTC, and two POSIX zones it builds from now()
-- and checks have moved their clocks — because a cap written `interval '1 day'` is wrong only
-- across a change of the clocks, and in UTC there never is one.
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
  k int;
  e text;
  k1 uuid;  -- matches for cases 13 and 14, one of every status a match can have: finished, the
  k2 uuid;  -- owner in seat 0 of k1 and k2 and seat 1 of k3 and of k4, which is with the stranger;
  k3 uuid;  -- ka going and ke ended, the owner in seat 1 and 0; kd two challenges the owner made,
  k4 uuid;  -- talked in and declined; ki one made and left open
  ka uuid;
  ke uuid;
  ki uuid;
  kd uuid[] := '{}';
  zones text[];  -- case 14's TimeZones, with what each does to a day and what to call it
  day_shift interval[];
  zone_label text[];
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
  -- EVERY privilege a table can carry, asked of the server rather than typed here: acldefault names
  -- them all, so MAINTAIN is asked where it exists — Postgres 17, as production is, whose default
  -- ACL hands it out (arwdDxtm) — and not on 16, where has_table_privilege refuses the word. How many
  -- were asked is pinned by version as well, so a list that came back short fails instead of passing.
  asked := asked + 1;
  select count(*), count(*) filter (where has_table_privilege(r.role, 'public.lab_match_chat', a.privilege_type))
    into n, k
  from pg_class c
  cross join aclexplode(acldefault('r', c.relowner)) a
  cross join (values ('anon'), ('authenticated')) r(role)
  where c.oid = 'public.lab_match_chat'::regclass;
  if k <> 0 then fails := array_append(fails, format('1: %s table privileges held by anon/authenticated', k)); end if;
  if n <> (case when current_setting('server_version_num')::int >= 170000 then 16 else 14 end) then
    fails := array_append(fails, format('1: asked %s table privileges, not every one there is', n));
  end if;
  asked := asked + 1;
  select count(*) into k
  from (values ('select'), ('insert'), ('update'), ('references')) p(priv)
  cross join (values ('anon'), ('authenticated')) r(role)
  where has_any_column_privilege(r.role, 'public.lab_match_chat', p.priv);
  if k <> 0 then fails := array_append(fails, format('1: %s column privileges held by anon/authenticated', k)); end if;
  asked := asked + 1;
  if exists (select 1 from pg_class c where c.oid = 'public.lab_match_chat'::regclass
               and (not c.relrowsecurity or exists (select 1 from pg_policy p where p.polrelid = c.oid))) then
    fails := array_append(fails, '1: the chat table has RLS off, or a policy');
  end if;
  -- and all three of the sequence's: USAGE, SELECT (currval, and reading it) and UPDATE (setval)
  asked := asked + 1;
  select count(*), count(*) filter (where has_sequence_privilege(r.role, 'public.lab_match_chat_id_seq', a.privilege_type))
    into n, k
  from pg_class c
  cross join aclexplode(acldefault('s', c.relowner)) a
  cross join (values ('anon'), ('authenticated')) r(role)
  where c.oid = 'public.lab_match_chat_id_seq'::regclass;
  if k <> 0 or n <> 6 then
    fails := array_append(fails, format('1: anon/authenticated hold %s of %s privileges on the chat id sequence', k, n));
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
  -- the challenger has said two in this match already, at now(); and the minute's two edges,
  -- written as the definer in this match and the challenger's seat: eight from fifty seconds ago,
  -- which are inside it, and ten from seventy seconds ago, which are not. So ten more make twenty.
  -- Everything said here is at now(), which a window of any length holds — so without these a
  -- window of one second passed as well as one of a minute, and so did a cap of twenty-one, since
  -- the old loop only minded a refusal that came early. One second misses the eight and takes a
  -- twenty-first; two minutes counts the ten and refuses the challenger at once. Their member's
  -- minute stays clear of thirty whatever this window does: it is these and "good game" in case 7.
  perform set_config('role', 'postgres', true);
  insert into public.lab_match_chat (match_id, by_seat, body, at)
  select mid, 0, 'fifty seconds ago ' || g, now() - interval '50 seconds' from generate_series(1, 8) g
  union all select mid, 0, 'seventy seconds ago ' || g, now() - interval '70 seconds' from generate_series(1, 10) g;
  perform set_config('role', 'authenticated', true);
  n := 0;
  e := null;
  for k in 1..10 loop
    begin
      perform public.lab_match_say(mid, 'line ' || k);
      n := n + 1;
    exception when sqlstate '54000' then e := coalesce(e, sqlerrm);
    end;
  end loop;
  if n <> 10 then
    fails := array_append(fails, format('8: %s of 10 lines taken beside the two said and the eight from fifty seconds ago: %s', n, e));
  end if;
  asked := asked + 1;
  begin
    perform public.lab_match_say(mid, 'one too many');
    fails := array_append(fails, '8: a twenty-first line in a minute was taken');
  exception when sqlstate '54000' then
    get stacked diagnostics e = message_text;
    if e not like '%twenty lines a minute%' then
      fails := array_append(fails, '8: the twenty-first was refused by the wrong cap: ' || e);
    end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
  asked := asked + 1;
  begin
    perform public.lab_match_say(mid, 'my own twenty are untouched');
  exception when sqlstate '54000' then
    fails := array_append(fails, '8: one seat''s lines counted against the other''s');
  end;

  /* ---------------------------------------------------------------- 9. five hundred a match */
  /* EXACTLY five hundred: filled to 499 whatever the cases above left in this match (case 8's
     edge rows among them), the 500th must be taken and the 501st refused by this cap and no
     other. It used to add 500 on top of what was there and accept any refusal, so a cap of 501
     to 532 passed, and so did a refusal that was really the minute cap (seat 0 is at twenty
     after case 8). So the friend says them, whose minute in this match holds one line, and the
     fill is dated 25 hours ago, outside every window in any TimeZone. */
  perform set_config('role', 'postgres', true);
  insert into public.lab_match_chat (match_id, by_seat, body, at)
  select mid, 1, 'old ' || g, now() - interval '25 hours'
    from generate_series(1, 499 - (select count(*)::int from public.lab_match_chat where match_id = mid)) g;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
  asked := asked + 1;
  begin
    perform public.lab_match_say(mid, 'the five hundredth');
    begin
      perform public.lab_match_say(mid, 'and one more');
      fails := array_append(fails, '9: a full chat took a line');
    exception when sqlstate '54000' then
      get stacked diagnostics e = message_text;
      if e not like '%chat is full%' then
        fails := array_append(fails, '9: the five hundred and first was refused by the wrong cap: ' || e);
      end if;
    end;
  exception when sqlstate '54000' then
    get stacked diagnostics e = message_text;
    fails := array_append(fails, '9: the five hundredth line was refused: ' || e);
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

  /* ---------------------------------------------------------------- 13. thirty a minute, across matches */
  -- friends again, and a clean slate: every match either of them plays goes, and the owner's are
  -- made in every status there is and from both seats, so a count that skipped a status or
  -- assumed a seat is caught: k1 and k2 finished in seat 0, k3 finished in seat 1, ka going in
  -- seat 1 and ke ended in seat 0. The declined ones are made below, the way the cap exists for.
  insert into public.friendships (user_a, user_b, requested_by, status, responded_at)
  values (least(o, f), greatest(o, f), o, 'accepted', now());
  delete from public.lab_matches where o in (player_a, player_b) or f in (player_a, player_b);
  insert into public.lab_matches (demo_id, mode, player_a, player_b, status, state, result, finished_at)
  values ('reversi', 'versus', o, f, 'finished', '{}', '{"winner":0}', now()) returning id into k1;
  insert into public.lab_matches (demo_id, mode, player_a, player_b, status, state, result, finished_at)
  values ('chess', 'versus', o, f, 'finished', '{}', '{"winner":1}', now()) returning id into k2;
  insert into public.lab_matches (demo_id, mode, player_a, player_b, status, state, result, finished_at)
  values ('reversi', 'versus', f, o, 'finished', '{}', '{"winner":0}', now()) returning id into k3;
  insert into public.lab_matches (demo_id, mode, player_a, player_b, status, state, turn, turn_since)
  values ('chess', 'versus', f, o, 'active', '{}', 0, now()) returning id into ka;
  insert into public.lab_matches (demo_id, mode, player_a, player_b, status, state)
  values ('chess', 'versus', o, f, 'ended', '{}') returning id into ke;
  -- and the minute's two edges, written as the definer: eight of the owner's lines from fifty
  -- seconds ago, which are inside it, and ten from seventy seconds ago, which are not. Everything
  -- said below is at now(), which a window of any length holds — so without these a window of one
  -- second passed as well as one of a minute. One second misses the eight and takes a thirty-first;
  -- two minutes counts the ten and refuses the owner early.
  insert into public.lab_match_chat (match_id, by_seat, body, at)
  select k1, 0, 'fifty seconds ago ' || g, now() - interval '50 seconds' from generate_series(1, 4) g
  union all select k3, 1, 'fifty seconds ago ' || g, now() - interval '50 seconds' from generate_series(1, 4) g
  union all select k2, 0, 'seventy seconds ago ' || g, now() - interval '70 seconds' from generate_series(1, 10) g;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  -- twenty-two more, so thirty with the eight, the member's most, and no match near its own
  -- twenty: the loop the cap is for, twice — challenge, talk, decline, which the challenger may do
  -- and which frees the slot at once — then a challenge left open, and three in each of ka and ke
  -- and five in the finished ones. A declined match takes no more lines; the ones it took while
  -- open still count, so a count that skips declined matches, or any status but finished, takes a
  -- thirty-first. Each line is asked on its own, so a refusal is counted and the matches are all
  -- still made.
  asked := asked + 1;
  n := 0;
  e := null;
  for k in 1..3 loop
    mid := (public.lab_match_challenge(f, 'reversi', 'versus')->>'id')::uuid;
    foreach t in array array_fill('your move whenever'::text, array[case when k < 3 then 4 else 3 end]) loop
      begin
        perform public.lab_match_say(mid, t);
        n := n + 1;
      exception when sqlstate '54000' then e := coalesce(e, sqlerrm);
      end;
    end loop;
    if k < 3 then
      perform public.lab_match_decline(mid);
      kd := kd || mid;
    else
      ki := mid;
    end if;
  end loop;
  foreach mid in array array[ka, ka, ka, ke, ke, ke, k1, k1, k2, k2, k3] loop
    begin
      perform public.lab_match_say(mid, 'spread');
      n := n + 1;
    exception when sqlstate '54000' then e := coalesce(e, sqlerrm);
    end;
  end loop;
  if n <> 22 then
    fails := array_append(fails, format('13: %s of 22 lines taken beside the eight from fifty seconds ago: %s', n, e));
  end if;
  asked := asked + 1;
  begin
    perform public.lab_match_say(k1, 'a thirty-first');
    fails := array_append(fails, '13: a thirty-first line in a minute across matches was taken');
  exception when sqlstate '54000' then
    get stacked diagnostics e = message_text;
    if e not like '%a minute across your matches%' then
      fails := array_append(fails, '13: the thirty-first was refused by the wrong cap: ' || e);
    end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
  asked := asked + 1;
  begin
    perform public.lab_match_say(k3, 'my thirty are my own');
  exception when sqlstate '54000' then
    fails := array_append(fails, '13: one member''s lines counted against the other''s');
  end;

  /* ---------------------------------------------------------------- 14. five hundred a day, across matches */
  -- written as the definer, all inside the day and outside the minute, so only the day's cap is in
  -- play: 499 of the owner's across every match above, of every status and from both seats, and
  -- k4, with the stranger — no friend, so a match the owner cannot write in today, whose lines are
  -- still the owner's; 300 of the other players' in the same matches, which are not the owner's to
  -- count. And the day's two edges: 100 of the owner's from 23½ hours ago, which are inside it, and
  -- 200 from 24½ hours ago, which are not. No match reaches its own 500.
  perform set_config('role', 'postgres', true);
  if (select string_agg(distinct x.status, ' ' order by x.status) from public.lab_matches x
       where o in (x.player_a, x.player_b)) is distinct from 'active declined ended finished invited'
     or cardinality(kd) <> 2 then
    raise exception 'FIXTURE: case 13 did not leave the owner a match of every status';
  end if;
  insert into public.lab_matches (demo_id, mode, player_a, player_b, status, state, result, finished_at)
  values ('chess', 'versus', s, o, 'finished', '{}', '{"winner":1}', now()) returning id into k4;
  delete from public.lab_match_chat c using public.lab_matches x
   where x.id = c.match_id and o in (x.player_a, x.player_b);
  insert into public.lab_match_chat (match_id, by_seat, body, at)
  select k1, 0, 'mine ' || g, now() - interval '2 hours' from generate_series(1, 150) g
  union all select k2, 0, 'mine ' || g, now() - interval '3 hours' from generate_series(1, 150) g
  union all select k3, 1, 'mine ' || g, now() - interval '23 hours 30 minutes' from generate_series(1, 100) g
  union all select k4, 1, 'mine ' || g, now() - interval '5 hours' from generate_series(1, 39) g
  union all select kd[1], 0, 'mine ' || g, now() - interval '4 hours' from generate_series(1, 20) g
  union all select kd[2], 0, 'mine ' || g, now() - interval '4 hours' from generate_series(1, 10) g
  union all select ki, 0, 'mine ' || g, now() - interval '6 hours' from generate_series(1, 10) g
  union all select ka, 1, 'mine ' || g, now() - interval '7 hours' from generate_series(1, 10) g
  union all select ke, 0, 'mine ' || g, now() - interval '8 hours' from generate_series(1, 10) g
  union all select k1, 1, 'theirs ' || g, now() - interval '1 hour' from generate_series(1, 100) g
  union all select k3, 0, 'theirs ' || g, now() - interval '1 hour' from generate_series(1, 100) g
  union all select k4, 0, 'the stranger''s ' || g, now() - interval '1 hour' from generate_series(1, 100) g
  union all select k2, 0, 'yesterday ' || g, now() - interval '24 hours 30 minutes' from generate_series(1, 200) g;
  -- ⚠️ AND ALL OF IT IN THREE TIMEZONES: UTC, and two POSIX zones made from now() so that the
  -- clocks went back, then forward, an hour twelve hours ago. Across a change, now() - '1 day' is
  -- 25 hours back, then 23 — so a day written that way counts the 200 from 24½ hours ago in the
  -- first and refuses the five hundredth, and drops the 100 from 23½ hours ago in the second and
  -- takes a five hundred and first. In UTC a day is always 24 hours, which is why this case once
  -- passed with it. Each zone is checked to have moved its clocks before it is believed.
  select array['UTC',
               format('AAA0BBB,%s/0,%s/%s', (d_back + 183) % 365, d_back, to_char(w_back, 'HH24:MI:SS')),
               format('AAA0BBB,%s/%s,%s/0', d_fwd, to_char(w_fwd, 'HH24:MI:SS'), (d_fwd + 183) % 365)]
    into zones
    from (select now() at time zone 'utc' - interval '11 hours' as w_back,  -- summer time's clock
                 now() at time zone 'utc' - interval '12 hours' as w_fwd) w  -- winter time's clock
   cross join lateral (select extract(doy from w.w_back)::int - 1 as d_back,
                              extract(doy from w.w_fwd)::int - 1 as d_fwd) d;
  day_shift := array[interval '0', interval '1 hour', interval '-1 hour'];
  zone_label := array['in UTC', 'the clocks back an hour', 'the clocks forward an hour'];
  for k in 1..3 loop
    perform set_config('TimeZone', zones[k], true);
    if (now() - interval '24 hours') - (now() - interval '1 day') is distinct from day_shift[k] then
      raise exception 'FIXTURE: the zone % did not move its clocks as case 14 needs', zones[k];
    end if;
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
    asked := asked + 1;
    begin
      perform public.lab_match_say(k2, 'the five hundredth');
    exception when sqlstate '54000' then
      fails := array_append(fails, format('14, %s: the five hundredth line of the day was refused: %s', zone_label[k], sqlerrm));
    end;
    asked := asked + 1;
    begin
      perform public.lab_match_say(k1, 'a five hundred and first');
      fails := array_append(fails, format('14, %s: a five hundred and first line in a day was taken', zone_label[k]));
    exception when sqlstate '54000' then
      get stacked diagnostics e = message_text;
      if e not like '%a day across your matches%' then
        fails := array_append(fails, format('14, %s: the five hundred and first was refused by the wrong cap: %s', zone_label[k], e));
      end if;
    end;
    perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
    asked := asked + 1;
    begin
      perform public.lab_match_say(k1, 'still mine to say');
    exception when sqlstate '54000' then
      fails := array_append(fails, format('14, %s: the friend was refused for the owner''s day', zone_label[k]));
    end;
    -- and back to the 499 for the next zone
    perform set_config('role', 'postgres', true);
    delete from public.lab_match_chat
     where match_id in (k1, k2) and body in ('the five hundredth', 'a five hundred and first', 'still mine to say');
  end loop;

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
