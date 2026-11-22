-- Lab matches by turns, asked as every kind of caller: a guest, the two players, a stranger, a
-- suspended friend, and the edge function (the service role). Each case is a real call under a
-- real role with real claims, against the functions as docs/applied/2026-11-14-lab-matches.DRAFT.sql
-- defines them.
--
-- HOW TO RUN: on the throwaway stack db-guards.yml builds (`supabase db reset`), which is the 4 Nov
-- dump and so has no Lab catalog yet — that arrived on 9 Nov as its own migration —
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/20261109030613_lab_catalog_and_feedback.sql
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f docs/applied/2026-11-14-lab-matches.DRAFT.sql
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/lab-matches.sql
-- Everything is in one transaction that rolls back; it leaves nothing behind. It raises, listing
-- every failed case, if anything is wrong, and says how many cases it asked otherwise.
--
-- ⚠️ IT REFUSES TO PASS BY ASKING NOTHING: block 0 checks the fixtures are what the cases assume.

begin;

-- fixtures: the seed's owner and friend, plus two more friends of the owner's — one suspended
insert into auth.users (id, email) values
  ('00000000-0000-4000-a000-0000000000b1', 'labsusp@example.test'),
  ('00000000-0000-4000-a000-0000000000b2', 'labpal@example.test');
insert into public.player_registry (player_name) values ('labsusp'), ('labpal');
insert into public.profiles (user_id, username, age_band, suspended) values
  ('00000000-0000-4000-a000-0000000000b1', 'labsusp', 'adult', true),
  ('00000000-0000-4000-a000-0000000000b2', 'labpal', 'adult', false);
insert into public.friendships (user_a, user_b, requested_by, status, responded_at)
select least('00000000-0000-4000-a000-000000000001'::uuid, u), greatest('00000000-0000-4000-a000-000000000001'::uuid, u),
       '00000000-0000-4000-a000-000000000001', 'accepted', now()
  from (values ('00000000-0000-4000-a000-0000000000b1'::uuid), ('00000000-0000-4000-a000-0000000000b2'::uuid)) v(u);
-- the two toys a match may be played on, as production's catalog must have them (checks.sql A)
insert into public.lab_demos (id) values ('reversi'), ('chess') on conflict (id) do nothing;

do $$
declare
  o  uuid := '00000000-0000-4000-a000-000000000001'; -- seedowner
  f  uuid := '00000000-0000-4000-a000-000000000002'; -- seedfriend: the owner's friend
  s  uuid := '00000000-0000-4000-a000-000000000003'; -- seedstranger: friends with nobody here
  x  uuid := '00000000-0000-4000-a000-0000000000b1'; -- labsusp: the owner's friend, suspended
  y  uuid := '00000000-0000-4000-a000-0000000000b2'; -- labpal: the owner's friend
  fails text[] := '{}';
  asked int := 0;
  j jsonb;
  t text;
  n int;
  mid uuid;   -- the reversi match
  mid2 uuid;  -- a match with the suspended friend, never begun
  cid uuid;   -- the chess match
  st text;
begin
 begin
  /* ---------------------------------------------------------------- 0. the fixtures are real */
  if not public.lab_pair_friends(o, f) or public.lab_pair_friends(o, s) or not public.lab_pair_friends(o, x)
     or not public.lab_pair_friends(o, y) or public.is_suspended(y)
     or not public.is_suspended(x) or public.is_suspended(o) or public.is_suspended(f) then
    raise exception 'FIXTURE: the friendships or suspensions are not what these cases assume';
  end if;

  /* ---------------------------------------------------------------- 1. nothing by table verb */
  asked := asked + 1;
  select count(*) into n
  from (values ('lab_matches'), ('lab_match_moves'), ('lab_results')) t(tb)
  cross join (values ('anon'), ('authenticated')) r(role)
  cross join (values ('select'), ('insert'), ('update'), ('delete'), ('truncate'), ('references'), ('trigger')) p(priv)
  where has_table_privilege(r.role, 'public.' || t.tb, p.priv);
  if n <> 0 then fails := array_append(fails, format('1: %s table privileges held by anon/authenticated', n)); end if;

  asked := asked + 1;
  if exists (select 1 from pg_class c join pg_namespace s2 on s2.oid = c.relnamespace
             where s2.nspname = 'public' and c.relname in ('lab_matches', 'lab_match_moves', 'lab_results')
               and (not c.relrowsecurity
                    or exists (select 1 from pg_policy pol where pol.polrelid = c.oid))) then
    fails := array_append(fails, '1: a match table without RLS, or with a policy');
  end if;

  /* ---------------------------------------------------------------- 2. exactly these are callable */
  asked := asked + 1;
  select string_agg(p.proname || ':' || (case when has_function_privilege('anon', p.oid, 'execute') then 'anon' else '' end)
                    || (case when has_function_privilege('authenticated', p.oid, 'execute') then '+auth' else '' end),
                    ' ' order by p.proname) into t
  from pg_proc p join pg_namespace s2 on s2.oid = p.pronamespace
  where s2.nspname = 'public'
    and (p.proname like 'lab\_match%' or p.proname in ('lab_my_turns', 'lab_pair_friends'));
  -- the service role keeps execute on everything, as it does throughout this schema; what matters
  -- is that a member can reach only the seven member functions, and never the three that write games
  if t is distinct from 'lab_match_begin: lab_match_challenge:+auth lab_match_claim:+auth lab_match_commit: lab_match_decline:+auth lab_match_get:+auth lab_match_json: lab_match_list:+auth lab_match_load: lab_match_mine: lab_match_playable: lab_match_record: lab_match_resign:+auth lab_match_suspended: lab_match_timeout: lab_my_turns:+auth lab_pair_friends:' then
    fails := array_append(fails, '2: callable match functions are ' || coalesce(t, 'none'));
  end if;
  asked := asked + 1;
  if not (has_function_privilege('service_role', 'public.lab_match_begin(uuid, uuid, jsonb, smallint, jsonb)', 'execute')
          and has_function_privilege('service_role', 'public.lab_match_commit(uuid, int, uuid, jsonb, jsonb, smallint, jsonb, jsonb)', 'execute')
          and has_function_privilege('service_role', 'public.lab_match_load(uuid)', 'execute')) then
    fails := array_append(fails, '2: the edge function cannot reach the functions that write games');
  end if;

  /* ---------------------------------------------------------------- 3. a guest */
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
  foreach t in array array['select public.lab_match_list()', 'select public.lab_my_turns()',
                           format('select public.lab_match_challenge(%L, ''reversi'', ''versus'')', f),
                           'select count(*) from public.lab_matches'] loop
    asked := asked + 1;
    begin
      execute t;
      fails := array_append(fails, '3: a guest ran ' || t);
    exception when insufficient_privilege then null;
    end;
  end loop;
  perform set_config('role', 'postgres', true);

  /* ---------------------------------------------------------------- 4. challenging */
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  foreach t in array array[
      format('select public.lab_match_challenge(%L, ''reversi'', ''versus'')', s),   -- not a friend
      format('select public.lab_match_challenge(%L, ''reversi'', ''versus'')', x),   -- suspended
      format('select public.lab_match_challenge(%L, ''reversi'', ''versus'')', o),   -- yourself
      format('select public.lab_match_challenge(%L, ''swarm'', ''versus'')', f),     -- not by turns
      format('select public.lab_match_challenge(%L, ''reversi'', ''solo'')', f),     -- no such mode
      format('select public.lab_match_challenge(%L, ''reversi'', ''versus'', ''[1]'')', f)] loop
    asked := asked + 1;
    begin
      execute t;
      fails := array_append(fails, '4: refused challenge ran: ' || t);
    exception when others then null;
    end;
  end loop;

  asked := asked + 1;
  j := public.lab_match_challenge(f, 'reversi', 'versus', '{"size": 8}');
  mid := (j->>'id')::uuid;
  if j->>'status' <> 'invited' or (j->>'you')::int <> 0 or j ? 'state' or j ? 'secret' then
    fails := array_append(fails, '4: a challenge reads ' || j::text);
  end if;
  asked := asked + 1;
  if (public.lab_match_challenge(f, 'reversi', 'versus')->>'id')::uuid <> mid then
    fails := array_append(fails, '4: a second challenge to the same friend and toy opened another');
  end if;

  -- the friend sees the invitation; the same challenge from their side is the same match
  perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
  asked := asked + 1;
  if (public.lab_my_turns()->>'invites')::int <> 1 or (public.lab_match_challenge(o, 'reversi', 'versus')->>'id')::uuid <> mid then
    fails := array_append(fails, '4: the friend does not see one invitation, the same match');
  end if;

  -- a stranger cannot tell this match from one that does not exist
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  asked := asked + 1;
  begin
    perform public.lab_match_get(mid);
    fails := array_append(fails, '4: a stranger read the match');
  exception when sqlstate 'P0002' then null;
  end;
  asked := asked + 1;
  begin
    perform public.lab_match_get(gen_random_uuid());
    fails := array_append(fails, '4: a made-up id read as something');
  exception when sqlstate 'P0002' then null;
  end;
  asked := asked + 1;
  if jsonb_array_length(public.lab_match_list()) <> 0 then
    fails := array_append(fails, '4: a stranger lists somebody else''s match');
  end if;
  perform set_config('role', 'postgres', true);

  /* ---------------------------------------------------------------- 5. the edge function starts it */
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
  asked := asked + 1;
  begin
    perform public.lab_match_begin(mid, o, '{"n":8}', 0::smallint); -- the challenger cannot accept
    fails := array_append(fails, '5: the challenger accepted their own invitation');
  exception when sqlstate '22023' then null;
  end;
  asked := asked + 1;
  j := public.lab_match_begin(mid, f, '{"n":8,"cells":[],"turn":1}', 0::smallint, '{"deck":[1,2,3]}');
  if j->>'status' <> 'active' or (j->>'turn')::int <> 0 or j ? 'secret' or j->'state'->>'n' <> '8' then
    fails := array_append(fails, '5: a begun match reads ' || j::text);
  end if;

  /* ---------------------------------------------------------------- 6. moves */
  asked := asked + 1;
  begin
    perform public.lab_match_commit(mid, 0, f, '19', '{"n":8}', 1::smallint); -- not f's turn
    fails := array_append(fails, '6: a move out of turn was taken');
  exception when sqlstate '42501' then null;
  end;
  asked := asked + 1;
  begin
    perform public.lab_match_commit(mid, 5, o, '19', '{"n":8}', 1::smallint); -- a board long gone
    fails := array_append(fails, '6: a move against another board was taken');
  exception when sqlstate '40001' then null;
  end;
  asked := asked + 1;
  begin
    perform public.lab_match_commit(mid, 0, s, '19', '{"n":8}', 1::smallint); -- not a player
    fails := array_append(fails, '6: a stranger''s move was taken');
  exception when sqlstate '42501' then null;
  end;
  asked := asked + 1;
  begin
    perform public.lab_match_commit(mid, 0, o, '19', jsonb_build_object('pad', repeat('x', 17000)), 1::smallint);
    fails := array_append(fails, '6: a 17 kB game was stored');
  exception when check_violation then null;
  end;
  asked := asked + 1;
  j := public.lab_match_commit(mid, 0, o, '19', '{"n":8,"m":[19]}', 1::smallint);
  if (j->>'seq')::int <> 1 or (j->>'turn')::int <> 1 or j->>'status' <> 'active' or j->'result' <> 'null'::jsonb then
    fails := array_append(fails, '6: after a move the match reads ' || j::text);
  end if;
  -- the same move sent twice: the second finds the board moved on
  asked := asked + 1;
  begin
    perform public.lab_match_commit(mid, 0, o, '19', '{"n":8,"m":[19]}', 1::smallint);
    fails := array_append(fails, '6: one move landed twice');
  exception when sqlstate '40001' then null;
  end;
  asked := asked + 1;
  if (select count(*) from public.lab_match_moves where match_id = mid) <> 1
     or (select by_seat from public.lab_match_moves where match_id = mid and seq = 1) <> 0 then
    fails := array_append(fails, '6: the history is not one move by seat 0');
  end if;
  asked := asked + 1;
  begin
    perform public.lab_match_commit(mid, 1, f, '26', '{"n":8}', null, '{"winner":7}');
    fails := array_append(fails, '6: a result naming seat 7 was taken');
  exception when sqlstate '22023' then null;
  end;
  perform set_config('role', 'postgres', true);

  /* ---------------------------------------------------------------- 7. resigning, and the results */
  perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  asked := asked + 1;
  if (public.lab_my_turns()->>'your_move')::int <> 1 then
    fails := array_append(fails, '7: it is the friend''s move, and lab_my_turns does not say so');
  end if;
  asked := asked + 1;
  j := public.lab_match_resign(mid);
  if j->>'status' <> 'finished' or j->'result'->>'winner' <> '0' or j->'result'->>'how' <> 'resigned' then
    fails := array_append(fails, '7: a resignation reads ' || j::text);
  end if;
  perform set_config('role', 'postgres', true);
  asked := asked + 1;
  select string_agg(r.metric->>'outcome' || '/' || r.checked_by || '/' || (r.user_id = o)::text, ' ' order by r.user_id) into t
    from public.lab_results r where r.match_id = mid;
  if t is distinct from 'won/match@1/true lost/match@1/false' then
    fails := array_append(fails, '7: the results of a resignation are ' || coalesce(t, 'none'));
  end if;

  /* ---------------------------------------------------------------- 8. a timeout, claimed */
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  cid := (public.lab_match_challenge(f, 'chess', 'versus')->>'id')::uuid;
  perform set_config('role', 'service_role', true);
  perform public.lab_match_begin(cid, f, '{"moves":[]}', 0::smallint);
  perform set_config('role', 'authenticated', true);
  -- o is to move; f may not claim yet, and o may never claim on their own turn
  perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
  asked := asked + 1;
  begin
    perform public.lab_match_claim(cid);
    fails := array_append(fails, '8: a win was claimed after no time at all');
  exception when sqlstate '22023' then null;
  end;
  perform set_config('role', 'postgres', true);
  update public.lab_matches set turn_since = now() - interval '8 days' where id = cid;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  asked := asked + 1;
  begin
    perform public.lab_match_claim(cid);
    fails := array_append(fails, '8: the player whose turn it is claimed the win');
  exception when sqlstate '22023' then null;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
  asked := asked + 1;
  if not (public.lab_match_get(cid)->>'can_claim')::boolean then
    fails := array_append(fails, '8: the waiting player is not told they can claim');
  end if;
  asked := asked + 1;
  j := public.lab_match_claim(cid);
  if j->'result'->>'winner' <> '1' or j->'result'->>'how' <> 'timeout' then
    fails := array_append(fails, '8: a claimed win reads ' || j::text);
  end if;
  perform set_config('role', 'postgres', true);

  /* ---------------------------------------------------------------- 9. an invitation nobody answered */
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  mid := (public.lab_match_challenge(f, 'reversi', 'versus')->>'id')::uuid;
  perform set_config('role', 'postgres', true);
  update public.lab_matches set created_at = now() - interval '8 days' where id = mid;
  perform set_config('role', 'authenticated', true);
  asked := asked + 1;
  select e->>'status' into st from jsonb_array_elements(public.lab_match_list()) e where (e->>'id')::uuid = mid;
  if st is distinct from 'expired' then
    fails := array_append(fails, '9: an old invitation reads ' || coalesce(st, 'missing'));
  end if;
  perform set_config('role', 'service_role', true);
  asked := asked + 1;
  begin
    perform public.lab_match_begin(mid, f, '{"n":8}', 0::smallint);
    fails := array_append(fails, '9: an expired invitation was accepted');
  exception when sqlstate '22023' then null;
  end;
  perform set_config('role', 'postgres', true);

  /* ---------------------------------------------------------------- 10. friends no longer */
  update public.lab_matches set created_at = now() where id = mid;
  perform set_config('role', 'service_role', true);
  perform public.lab_match_begin(mid, f, '{"n":8}', 0::smallint);
  perform set_config('role', 'postgres', true);
  delete from public.friendships where user_a = least(o, f) and user_b = greatest(o, f);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  asked := asked + 1;
  begin
    perform public.lab_match_get(mid);
    fails := array_append(fails, '10: a match was read after the friendship ended');
  exception when sqlstate 'P0002' then null;
  end;
  asked := asked + 1;
  if jsonb_array_length(public.lab_match_list()) <> 0 then
    fails := array_append(fails, '10: matches with a former friend are still listed');
  end if;
  perform set_config('role', 'service_role', true);
  asked := asked + 1;
  begin
    perform public.lab_match_commit(mid, 0, o, '19', '{"n":8}', 1::smallint);
    fails := array_append(fails, '10: a move was taken between former friends');
  exception when sqlstate '22023' or sqlstate '42501' then null;
  end;
  -- the next challenge o makes ends the match with their former friend
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  perform public.lab_match_challenge(y, 'chess', 'versus'); -- a friend still: it goes through
  perform set_config('role', 'postgres', true);
  asked := asked + 1;
  if (select status from public.lab_matches where id = mid) <> 'ended'
     or (select count(*) from public.lab_results where user_id in (o, f)) <> 4 then
    fails := array_append(fails, '10: the open match did not end, or the results already won went');
  end if;

  /* ---------------------------------------------------------------- 11. sixty moves a minute */
  insert into public.friendships (user_a, user_b, requested_by, status, responded_at)
    values (least(o, f), greatest(o, f), o, 'accepted', now());
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  mid := (public.lab_match_challenge(f, 'reversi', 'versus')->>'id')::uuid;
  perform set_config('role', 'service_role', true);
  perform public.lab_match_begin(mid, f, '{"n":8}', 0::smallint);
  perform set_config('role', 'postgres', true);
  insert into public.lab_match_moves (match_id, seq, by_seat, move)
    select cid, 100 + g, 0, '1' from generate_series(1, 60) g; -- sixty of o's, seat 0, just now
  perform set_config('role', 'service_role', true);
  asked := asked + 1;
  begin
    perform public.lab_match_commit(mid, 0, o, '19', '{"n":8}', 1::smallint);
    fails := array_append(fails, '11: a sixty-first move in a minute was taken');
  exception when sqlstate '54000' then null;
  end;
  perform set_config('role', 'postgres', true);

  /* ---------------------------------------------------------------- 12. a suspended member */
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  mid := (public.lab_match_challenge(y, 'reversi', 'versus')->>'id')::uuid;
  perform set_config('role', 'postgres', true);
  update public.profiles set suspended = true where user_id = y;
  perform set_config('request.jwt.claims', json_build_object('sub', y, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  asked := asked + 1;
  begin
    perform public.lab_match_decline(mid);
    fails := array_append(fails, '12: a suspended member declined');
  exception when sqlstate '42501' then null;
  end;
  asked := asked + 1;
  if jsonb_array_length(public.lab_match_list()) < 1 then
    fails := array_append(fails, '12: a suspended member cannot see their own matches');
  end if;
  -- ⚠️ AND THROUGH THE EDGE FUNCTION'S DOOR, where there is no caller: is_suspended answers NULL
  -- under the service key, which is how a suspended pair once accepted and moved (14 Nov). A match
  -- with x (suspended) cannot be begun, and a going match cannot be moved by y once suspended.
  perform set_config('role', 'postgres', true);
  insert into public.lab_matches (demo_id, mode, player_a, player_b, settings)
    values ('chess', 'versus', o, x, '{}') returning id into mid2;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
  asked := asked + 1;
  begin
    perform public.lab_match_begin(mid2, x, '{"moves":[]}', 0::smallint);
    fails := array_append(fails, '12: a match with a suspended player was begun by the service');
  exception when sqlstate '22023' then null;
  end;
  perform set_config('role', 'postgres', true);
  update public.profiles set suspended = false where user_id = y;
  perform set_config('role', 'service_role', true);
  -- y to move, because o has spent the minute's sixty moves in case 11 and would be refused for that
  perform public.lab_match_begin(mid, y, '{"moves":[]}', 1::smallint);
  perform set_config('role', 'postgres', true);
  update public.profiles set suspended = true where user_id = y;
  perform set_config('role', 'service_role', true);
  asked := asked + 1;
  begin
    perform public.lab_match_commit(mid, 0, y, '{"m":"e2e4"}', '{"moves":["e2e4"]}', 0::smallint);
    fails := array_append(fails, '12: a suspended player moved through the service');
  exception when sqlstate '42501' then null;
  end;
  perform set_config('role', 'postgres', true);
  update public.profiles set suspended = false where user_id = y;

  /* ---------------------------------------------------------------- 13. nothing returns `secret` */
  asked := asked + 1;
  if exists (select 1 from public.lab_matches m
              where public.lab_match_json(m, m.player_a, true) ? 'secret') then
    fails := array_append(fails, '13: a player''s view carries secret');
  end if;

 exception when others then
  fails := array_append(fails, 'UNEXPECTED after ' || asked || ' cases: ' || sqlerrm);
 end;
  perform set_config('role', 'postgres', true);
  if array_length(fails, 1) > 0 then
    raise exception E'lab matches: % of % cases failed:\n  %', array_length(fails, 1), asked,
      array_to_string(fails, E'\n  ');
  end if;
  raise notice 'lab matches: all % cases hold', asked;
end;
$$;

rollback;
