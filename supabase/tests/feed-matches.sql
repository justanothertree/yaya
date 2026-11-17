-- A finished Lab match in the Feed (docs/2026-11-16-feed-finished-matches.DRAFT.sql), asked of
-- feed_recent by every kind of viewer, under real claims, in one transaction that rolls back.
--
-- HOW TO RUN: against a database with the Lab catalog, the matches migration
-- (20261115002456_lab_matches_and_results), the two Feed migrations of 14 Nov and the draft
-- applied:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/feed-matches.sql
-- It raises, naming every failed case, if anything is wrong, and says how many it asked otherwise.
--
-- THE PEOPLE: Ann (the seed's owner) and Bo (the seed's friend) play. Cy is Ann's friend and not
-- Bo's. Di is a friend of both. The seed's stranger is friends with nobody.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-a000-0000000000c1', 'feedcy@example.test'),
  ('00000000-0000-4000-a000-0000000000c2', 'feeddi@example.test');
insert into public.player_registry (player_name) values ('feedcy'), ('feeddi');
insert into public.profiles (user_id, username, first_name, age_band) values
  ('00000000-0000-4000-a000-0000000000c1', 'feedcy', 'Cy', 'adult'),
  ('00000000-0000-4000-a000-0000000000c2', 'feeddi', 'Di', 'adult');
update public.profiles set age_band = 'adult',
       first_name = case user_id when '00000000-0000-4000-a000-000000000001' then 'Ann'
                                 when '00000000-0000-4000-a000-000000000002' then 'Bo' else first_name end
 where user_id in ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000002');
insert into public.friendships (user_a, user_b, requested_by, status, responded_at)
select least(a, b), greatest(a, b), a, 'accepted', now()
  from (values
    ('00000000-0000-4000-a000-000000000001'::uuid, '00000000-0000-4000-a000-000000000002'::uuid),
    ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-0000000000c1'),
    ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-0000000000c2'),
    ('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-0000000000c2')) v(a, b)
on conflict do nothing;
insert into public.lab_demos (id) values ('reversi'), ('chess'), ('pool') on conflict (id) do nothing;
insert into public.lab_demos (id, hidden) values ('retiredtoy', true) on conflict (id) do update set hidden = true;

-- a database that has been played on may hold an open match between the two: it is rolled back
-- with everything else, and the finished matches it holds are left out of the reading below
delete from public.lab_matches
 where status in ('invited', 'active')
   and least(player_a, player_b) = '00000000-0000-4000-a000-000000000001'
   and greatest(player_a, player_b) = '00000000-0000-4000-a000-000000000002';

-- finished matches, written as lab_match_commit and lab_match_resign leave them
insert into public.lab_matches (id, demo_id, mode, player_a, player_b, status, state, seq, result, finished_at)
values
  -- Ann challenged Bo to chess; Bo resigned: Ann's win
  ('10000000-0000-4000-8000-000000000001', 'chess', 'versus', '00000000-0000-4000-a000-000000000001',
   '00000000-0000-4000-a000-000000000002', 'finished', '{"moves":[]}', 3,
   '{"winner": 0, "how": "resigned"}', now() - interval '1 hour'),
  -- Bo challenged Ann to reversi and won it on the board: Bo's win, with a score
  ('10000000-0000-4000-8000-000000000002', 'reversi', 'versus', '00000000-0000-4000-a000-000000000002',
   '00000000-0000-4000-a000-000000000001', 'finished', '{"n":6}', 30,
   '{"winner": 0, "how": "played", "score": "24–12"}', now() - interval '2 hours'),
  -- Ann and Bo drew at reversi: the challenger's row, both of them named where allowed
  ('10000000-0000-4000-8000-000000000003', 'reversi', 'versus', '00000000-0000-4000-a000-000000000001',
   '00000000-0000-4000-a000-000000000002', 'finished', '{"n":6}', 32,
   '{"winner": "draw", "how": "played", "score": "18–18"}', now() - interval '3 hours'),
  -- together, the two of them beat the computer at pool
  ('10000000-0000-4000-8000-000000000004', 'pool', 'together', '00000000-0000-4000-a000-000000000001',
   '00000000-0000-4000-a000-000000000002', 'finished', '{}', 12,
   '{"winner": 0, "how": "played"}', now() - interval '4 hours'),
  -- together, the computer beat them: never posted
  ('10000000-0000-4000-8000-000000000005', 'chess', 'together', '00000000-0000-4000-a000-000000000002',
   '00000000-0000-4000-a000-000000000001', 'finished', '{"moves":[]}', 20,
   '{"winner": 1, "how": "played"}', now() - interval '5 hours'),
  -- a retired toy: never posted
  ('10000000-0000-4000-8000-000000000006', 'retiredtoy', 'versus', '00000000-0000-4000-a000-000000000001',
   '00000000-0000-4000-a000-000000000002', 'finished', '{}', 5,
   '{"winner": 0, "how": "played"}', now() - interval '6 hours');
-- and one still going, which is nobody's news yet
insert into public.lab_matches (id, demo_id, mode, player_a, player_b, status, state, seq, turn, turn_since)
values ('10000000-0000-4000-8000-000000000007', 'chess', 'versus', '00000000-0000-4000-a000-000000000001',
        '00000000-0000-4000-a000-000000000002', 'active', '{"moves":[]}', 1, 1, now());

create temporary table seen (viewer text, scope text, id text, who text, outcome text,
                             other text, other_who text, other_mine boolean, how text, result text)
  on commit drop;
grant all on seen to authenticated;

do $$
declare
  v record;
  s text;
begin
  for v in select * from (values
    ('ann', '00000000-0000-4000-a000-000000000001'), ('bo', '00000000-0000-4000-a000-000000000002'),
    ('cy', '00000000-0000-4000-a000-0000000000c1'), ('di', '00000000-0000-4000-a000-0000000000c2'),
    ('stranger', '00000000-0000-4000-a000-000000000003')) x(name, id)
  loop
    foreach s in array array['you_and_friends', 'all_members'] loop
      perform set_config('request.jwt.claims', json_build_object('sub', v.id, 'role', 'authenticated')::text, true);
      perform set_config('role', 'authenticated', true);
      insert into seen
      select v.name, s, e->>'id', e->>'who', e->>'outcome', e->>'other', e->>'other_who',
             (e->>'other_mine')::boolean, e->>'how', e->>'result'
        from jsonb_array_elements(public.feed_recent(now() - interval '1 day', now(), 40, s)) e
       where e->>'kind' = 'match' and e->>'id' like '10000000-%';
      perform set_config('role', 'postgres', true);
    end loop;
  end loop;
end $$;

do $$
declare
  fails text[] := '{}';
  asked int := 0;
  t text;
begin
  -- 1. the four that may be posted are posted to Ann, the two that may not are not
  asked := asked + 1;
  select string_agg(right(id, 1), '' order by id) into t from seen where viewer = 'ann' and scope = 'you_and_friends';
  if t is distinct from '1234' then fails := fails || ('1: Ann sees matches ' || coalesce(t, 'none')); end if;

  -- 2. whose row it is: the winner's, the challenger's for a draw and for a win together
  asked := asked + 1;
  select string_agg(right(id, 1) || ':' || who || ':' || outcome, ' ' order by id) into t
    from seen where viewer = 'ann' and scope = 'you_and_friends';
  if t is distinct from '1:seedowner:won 2:seedfriend:won 3:seedowner:drew 4:seedowner:together' then
    fails := fails || ('2: rows are ' || coalesce(t, 'none'));
  end if;

  -- 3. one of the two players sees the other named; the loser sees "you"
  asked := asked + 1;
  select other || '|' || other_mine into t from seen where viewer = 'bo' and id like '%1' and scope = 'you_and_friends';
  if t is distinct from 'Bo|true' then fails := fails || ('3: Bo on his loss sees ' || coalesce(t, 'nothing')); end if;

  -- 4. ⚠️ a friend of Ann's who is not Bo's sees Ann's win and never Bo's name
  asked := asked + 1;
  if exists (select 1 from seen where viewer = 'cy' and (other is not null or other_who is not null)) then
    fails := fails || '4: Cy, a friend of one, was told who the other player was'::text;
  end if;
  asked := asked + 1;
  select string_agg(right(id, 1), '' order by id) into t from seen where viewer = 'cy' and scope = 'you_and_friends';
  if t is distinct from '134' then fails := fails || ('4b: Cy sees ' || coalesce(t, 'none') || ', not Ann''s three'); end if;

  -- 5. a friend of both sees both named
  asked := asked + 1;
  select string_agg(right(id, 1) || other_who, ' ' order by id) into t from seen where viewer = 'di' and scope = 'you_and_friends';
  if t is distinct from '1seedfriend 2seedowner 3seedfriend 4seedfriend' then
    fails := fails || ('5: Di, a friend of both, sees ' || coalesce(t, 'none'));
  end if;

  -- 6. the wide scope is a wider list of people, never a wider naming: a stranger reads no names
  asked := asked + 1;
  if exists (select 1 from seen where viewer = 'stranger' and other is not null) then
    fails := fails || '6: a stranger was told who played'::text;
  end if;
  asked := asked + 1;
  if exists (select 1 from seen where viewer = 'stranger' and scope = 'you_and_friends') then
    fails := fails || '6b: a stranger''s own feed holds other people''s matches'::text;
  end if;

  -- 7. nothing about a move, a loss together, a retired toy, or a match still going
  asked := asked + 1;
  if exists (select 1 from seen where right(id, 1) in ('5', '6', '7')) then
    fails := fails || '7: a loss together, a retired toy or a match in play reached the Feed'::text;
  end if;

  -- 8. how it ended and the toy's own score travel, and nothing else of the result
  asked := asked + 1;
  select string_agg(right(id, 1) || ':' || coalesce(how, '-') || ':' || coalesce(result, '-'), ' ' order by id) into t
    from seen where viewer = 'ann' and scope = 'you_and_friends';
  if t is distinct from '1:resigned:- 2:played:24–12 3:played:18–18 4:played:-' then
    fails := fails || ('8: ' || coalesce(t, 'none'));
  end if;

  if array_length(fails, 1) > 0 then
    raise exception 'feed matches: % of % cases failed:%', array_length(fails, 1), asked,
      E'\n  ' || array_to_string(fails, E'\n  ');
  end if;
  raise notice 'feed matches: all % cases hold', asked;
end $$;

rollback;
