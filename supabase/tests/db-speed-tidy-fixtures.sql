-- Rows for the database speed tidy-up's before/after test, in every one of the 25 tables whose
-- policies docs/2026-11-25-db-speed-tidy.DRAFT.sql rewrites.
--
-- HOW TO RUN: db-guards.yml, on its throwaway database, after seed.sql and before the look. It
-- COMMITS, because the draft is loaded between two looks and each runs in its own session.
--
-- ⚠️ WHY THE ROWS ARE SHAPED LIKE THIS. A visibility test over empty tables passes whatever the
-- policies say (CLAUDE.md §2: "a room with nothing in it passes every check there is"), and the
-- seed has rows in only six of these 25. So each table gets rows belonging to DIFFERENT people:
--   owner    …001  the admin            friend    …002  the admin's friend
--   stranger …003  nobody's friend     suspended …004  a member who is suspended
-- — and the suspended member owns something in most tables, because eleven of the 54 policies are
-- RESTRICTIVE "not suspended" ones and would never be asked anything otherwise.
--
-- ⚠️ EACH ROW IS WRITTEN AS ITS OWNER. circuit_movies and circuit_watchlist stamp their creator
-- from auth.uid() on insert (circuit_movie_stamp_creator, watchlist_stamp_adder), so a row put in
-- with no claims would belong to nobody and test the "nobody" case for every row.

\set ON_ERROR_STOP 1

-- the fourth member, suspended
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('00000000-0000-4000-a000-000000000004', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'suspended@example.test', '', now(), now(), now())
on conflict (id) do nothing;
insert into public.player_registry (player_name) values ('seedsuspended') on conflict do nothing;
insert into public.profiles (user_id, username, first_name, age_band, suspended)
values ('00000000-0000-4000-a000-000000000004', 'seedsuspended', 'Suspended', 'adult', true)
on conflict (user_id) do nothing;

-- write as `who` until the next call: auth.uid() reads this
create function pg_temp.as_member(who text) returns void language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', '00000000-0000-4000-a000-00000000000' || who,
                                      'role', 'authenticated')::text, false);
$$;

-- ── circuit: groups, members, people, logs and what hangs off them ─────────────────────────────
select pg_temp.as_member('3');
insert into public.circuit_groups (id, name, created_by)
values ('00000000-0000-4000-b000-000000000002', 'Stranger circuit', '00000000-0000-4000-a000-000000000003');
select pg_temp.as_member('4');
insert into public.circuit_groups (id, name, created_by)
values ('00000000-0000-4000-b000-000000000003', 'Suspended circuit', '00000000-0000-4000-a000-000000000004');

insert into public.circuit_group_members (group_id, user_id, role) values
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000002', 'member'),
  ('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000003', 'owner'),
  ('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000001', 'member'),
  ('00000000-0000-4000-b000-000000000003', '00000000-0000-4000-a000-000000000004', 'owner')
on conflict do nothing;

insert into public.circuit_people (id, name, owner_user_id, visibility) values
  ('seed-person-3', 'Stranger', '00000000-0000-4000-a000-000000000003', 'friends'),
  ('seed-person-4', 'Suspended', '00000000-0000-4000-a000-000000000004', 'members')
on conflict (id) do nothing;
insert into public.circuit_person_groups (person_id, group_id, added_by) values
  ('seed-person-3', '00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000003'),
  ('seed-person-4', '00000000-0000-4000-b000-000000000003', '00000000-0000-4000-a000-000000000004')
on conflict do nothing;
insert into public.circuit_logs (id, person_id, date, entries) values
  ('seed-log-3', 'seed-person-3', current_date, '[]'::jsonb),
  ('seed-log-4', 'seed-person-4', current_date, '[]'::jsonb)
on conflict (id) do nothing;

insert into public.circuit_log_comments (log_id, user_id, author_name, body) values
  ('seed-log-1', '00000000-0000-4000-a000-000000000002', 'Friend', 'nice one'),
  ('seed-log-2', '00000000-0000-4000-a000-000000000001', 'Owner', 'keep going'),
  ('seed-log-3', '00000000-0000-4000-a000-000000000003', 'Stranger', 'my own'),
  ('seed-log-4', '00000000-0000-4000-a000-000000000004', 'Suspended', 'from the bench');
insert into public.circuit_log_reactions (log_id, user_id, emoji) values
  ('seed-log-1', '00000000-0000-4000-a000-000000000002', '👍'),
  ('seed-log-3', '00000000-0000-4000-a000-000000000003', '🎉'),
  ('seed-log-4', '00000000-0000-4000-a000-000000000004', '🔥')
on conflict do nothing;

-- films and ratings: one each in the shared circuit, one just-me, one each in the other two
select pg_temp.as_member('1');
insert into public.circuit_movies (id, title, group_id) values
  ('seed-film-1', 'Owner film', '00000000-0000-4000-b000-000000000001');
select pg_temp.as_member('2');
insert into public.circuit_movies (id, title, group_id) values ('seed-film-2', 'Just me', null);
select pg_temp.as_member('3');
insert into public.circuit_movies (id, title, group_id) values
  ('seed-film-3', 'Stranger film', '00000000-0000-4000-b000-000000000002');
select pg_temp.as_member('4');
insert into public.circuit_movies (id, title, group_id) values
  ('seed-film-4', 'Suspended film', '00000000-0000-4000-b000-000000000003');

insert into public.circuit_ratings (movie_id, user_id, score) values
  ('seed-film-1', '00000000-0000-4000-a000-000000000001', 80),
  ('seed-film-1', '00000000-0000-4000-a000-000000000002', 60),
  ('seed-film-2', '00000000-0000-4000-a000-000000000002', 90),
  ('seed-film-3', '00000000-0000-4000-a000-000000000003', 70),
  ('seed-film-4', '00000000-0000-4000-a000-000000000004', 10)
on conflict do nothing;

-- pools, their people, options and votes
insert into public.pools (id, owner_user_id, name, audience) values
  ('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-a000-000000000001', 'Owner pool', 'friends'),
  ('00000000-0000-4000-c000-000000000002', '00000000-0000-4000-a000-000000000003', 'Stranger pool', 'selected'),
  ('00000000-0000-4000-c000-000000000003', '00000000-0000-4000-a000-000000000004', 'Suspended pool', 'just_me');
insert into public.pool_people (pool_id, user_id) values
  ('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-a000-000000000002'),
  ('00000000-0000-4000-c000-000000000002', '00000000-0000-4000-a000-000000000001')
on conflict do nothing;

select pg_temp.as_member('2');
insert into public.circuit_watchlist (id, title, group_id) values
  ('seed-watch-1', 'Group pick', '00000000-0000-4000-b000-000000000001');
select pg_temp.as_member('1');
insert into public.circuit_watchlist (id, title, pool_id) values
  ('seed-watch-2', 'Owner pool pick', '00000000-0000-4000-c000-000000000001');
select pg_temp.as_member('3');
insert into public.circuit_watchlist (id, title, pool_id) values
  ('seed-watch-3', 'Stranger pool pick', '00000000-0000-4000-c000-000000000002');
select pg_temp.as_member('4');
insert into public.circuit_watchlist (id, title, group_id) values
  ('seed-watch-4', 'Suspended pick', '00000000-0000-4000-b000-000000000003');

insert into public.pool_votes (item_id, user_id) values
  ('seed-watch-2', '00000000-0000-4000-a000-000000000002'),
  ('seed-watch-3', '00000000-0000-4000-a000-000000000001'),
  ('seed-watch-1', '00000000-0000-4000-a000-000000000003'),
  ('seed-watch-4', '00000000-0000-4000-a000-000000000004')
on conflict do nothing;

-- ── the rest of public ────────────────────────────────────────────────────────────────────────
insert into public.friendships (user_a, user_b, requested_by, status, responded_at) values
  ('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000003',
   '00000000-0000-4000-a000-000000000003', 'pending', null),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000004',
   '00000000-0000-4000-a000-000000000001', 'accepted', now())
on conflict do nothing;

insert into public.account_features (user_id, feature, enabled) values
  ('00000000-0000-4000-a000-000000000001', 'beta', true),
  ('00000000-0000-4000-a000-000000000002', 'beta', false),
  ('00000000-0000-4000-a000-000000000004', 'pets', true)
on conflict do nothing;
insert into public.activity_reads (user_id) values
  ('00000000-0000-4000-a000-000000000001'), ('00000000-0000-4000-a000-000000000002'),
  ('00000000-0000-4000-a000-000000000004')
on conflict do nothing;
insert into public.user_roles (user_id, role) values
  ('00000000-0000-4000-a000-000000000001', 'admin'), ('00000000-0000-4000-a000-000000000002', 'user')
on conflict do nothing;

select pg_temp.as_member('1');
insert into public.bug_report (reporter, body) values ('00000000-0000-4000-a000-000000000001', 'seed bug one');
select pg_temp.as_member('3');
insert into public.bug_report (reporter, body) values ('00000000-0000-4000-a000-000000000003', 'seed bug two');

-- the circuit rooms come from circuit_groups' own trigger; the Lounge is made here
insert into public.chat_rooms (id, kind) values ('00000000-0000-4000-d000-000000000001', 'lounge')
on conflict do nothing;
insert into public.chat_reads (user_id, room_id)
select '00000000-0000-4000-a000-000000000001'::uuid, r.id from public.chat_rooms r
 where r.group_id = '00000000-0000-4000-b000-000000000001'
union all
select '00000000-0000-4000-a000-000000000002'::uuid, r.id from public.chat_rooms r
 where r.group_id = '00000000-0000-4000-b000-000000000001'
union all
select '00000000-0000-4000-a000-000000000003'::uuid, '00000000-0000-4000-d000-000000000001'::uuid
on conflict do nothing;

-- ── finance ───────────────────────────────────────────────────────────────────────────────────
insert into finance.family_accounts (id, display_name, user_id) values
  ('00000000-0000-4000-e000-000000000001', 'Kid A', '00000000-0000-4000-a000-000000000001'),
  ('00000000-0000-4000-e000-000000000002', 'Kid B', '00000000-0000-4000-a000-000000000002'),
  ('00000000-0000-4000-e000-000000000003', 'Kid C', '00000000-0000-4000-a000-000000000003');
insert into finance.executed_trades (id, asset_symbol, asset_type, platform, execution_time,
                                     dollar_amount, price, units_acquired, user_id) values
  ('00000000-0000-4000-e000-000000000011', 'VTI', 'stock', 'seed', now(), 100, 50, 2, '00000000-0000-4000-a000-000000000001'),
  ('00000000-0000-4000-e000-000000000012', 'BTC', 'crypto', 'seed', now(), 50, 100000, 0.0005, '00000000-0000-4000-a000-000000000002'),
  ('00000000-0000-4000-e000-000000000013', 'VXUS', 'stock', 'seed', now(), 60, 60, 1, '00000000-0000-4000-a000-000000000004');
insert into finance.allocations (family_account_id, executed_trade_id, units_allocated, user_id) values
  ('00000000-0000-4000-e000-000000000001', '00000000-0000-4000-e000-000000000011', 1, '00000000-0000-4000-a000-000000000001'),
  ('00000000-0000-4000-e000-000000000002', '00000000-0000-4000-e000-000000000012', 0.0005, '00000000-0000-4000-a000-000000000002');
insert into finance.user_preferences (user_id, dark_mode) values
  ('00000000-0000-4000-a000-000000000001', true), ('00000000-0000-4000-a000-000000000003', false)
on conflict do nothing;

select set_config('request.jwt.claims', '', false);

-- every table has rows of at least two different people, or the look would prove less than it says
do $$
declare
  t text;
  n bigint;
begin
  foreach t in array array[
    'finance.allocations', 'finance.executed_trades', 'finance.family_accounts',
    'finance.user_preferences', 'public.account_features', 'public.activity_reads',
    'public.bug_report', 'public.chat_reads', 'public.circuit_group_members',
    'public.circuit_groups', 'public.circuit_log_comments', 'public.circuit_log_reactions',
    'public.circuit_logs', 'public.circuit_movies', 'public.circuit_people',
    'public.circuit_person_groups', 'public.circuit_ratings', 'public.circuit_watchlist',
    'public.friendships', 'public.pool_people', 'public.pool_votes', 'public.pools',
    'public.profiles', 'public.user_roles'] loop
    execute format('select count(*) from %s', t) into n;
    if n < 2 then
      raise exception 'db speed tidy fixtures: % holds % rows, and two people''s are needed', t, n;
    end if;
  end loop;
  raise notice 'db speed tidy fixtures: rows of two or more people in every table but admin_users';
end;
$$;
