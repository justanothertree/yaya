-- Step 1 of the Feed plan, asked of the real functions as the seeded members: browsing stays in
-- its owner's own Chronicle and reaches neither the Feed nor a friend's Chronicle Friends tab.
--
-- ⛔ NEEDS THE DRAFT APPLIED FIRST, and refuses to run otherwise:
--      docs/2026-11-13-feed-hides-browsing.DRAFT.sql
-- It is not applied to production. This file runs only where a throwaway database has been built
-- from the schema baseline and seed -- the `db guards` CI job, by way of a scratch-probe branch --
-- and it rolls back. NEVER against production: it writes sittings and changes sharing levels.
--
-- WHAT IT ASKS, section by section:
--   0  the draft is applied: each reader carries the filter once, and each body's md5 is the
--      "after" value docs/2026-11-13-feed-hides-browsing.checks.sql expects
--   A  the fixture: the owner shares their timeline, has a sitting they timed on an activity shared
--      with friends, and has browsed a room whose auto activity is ALSO shared with friends -- the
--      one way browsing reaches other people today. The fixture is proven before it is used.
--   B  the friend: the Friends tab and the Feed show the sitting and not the visit
--   C  the owner: their own Feed shows the sitting and not the visit; their own Chronicle still has
--      the visit, because it is tracked privately rather than thrown away
--   D  a stranger sees neither -- the control that the sharing really is friends-only
--   E  the rollback, applied in here and rolled back with everything else: each body's md5 returns
--      to the "before" value, and the visit is back in both places. So B and C fail without the
--      draft, and the rollback is the exact way back.
--   F  grants: anon executes neither reader, authenticated executes both
-- On failure it raises, naming every check that failed. A green run prints the four md5s.

begin;

create temp table fails(check_name text, detail text);
create temp table ids(k text primary key, v uuid);
create temp table seen(k text primary key, v jsonb);
grant select, insert on fails to authenticated, anon;
grant select, insert, update on ids, seen to authenticated, anon;

create temp table who as
  select '00000000-0000-4000-a000-000000000001'::uuid as owner,
         '00000000-0000-4000-a000-000000000002'::uuid as friend,
         '00000000-0000-4000-a000-000000000003'::uuid as stranger;
grant select on who to authenticated, anon;

/* the readers, asked in one place so every section asks the same question */
create or replace function pg_temp.has_detail(p_feed jsonb, p_detail text) returns boolean
language sql immutable as $$
  select exists (select 1 from jsonb_array_elements(coalesce(p_feed, '[]'::jsonb)) x
                  where x->>'kind' = 'sitting' and x->>'detail' = p_detail)
$$;
create or replace function pg_temp.has_activity(p_log jsonb, p_name text) returns boolean
language sql immutable as $$
  select exists (select 1 from jsonb_array_elements(coalesce(p_log, '[]'::jsonb)) x
                  where x->>'activity' = p_name)
$$;

-- ── 0. the draft is applied ───────────────────────────────────────────────────────────────────
insert into fails select 'DRAFT NOT APPLIED',
       p.proname || ' does not carry the filter exactly once'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f'
   and p.proname in ('chronicle_friends_log', 'feed_recent')
   and (length(p.prosrc) - length(replace(p.prosrc, 'and not a.auto', '')))
       / length('and not a.auto') <> 1;

select p.proname as reader, md5(p.prosrc) as body_md5_with_the_draft
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f'
   and p.proname in ('chronicle_friends_log', 'feed_recent')
 order by p.proname;

insert into fails select 'the body is not the one checks.sql expects after the draft',
       p.proname || ': ' || md5(p.prosrc)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  join (values ('chronicle_friends_log', '377de6b6bdea3c6ed6cf15bf3a86a46a'),
               ('feed_recent',           'f2841a1db68556e37e984a90721570cb')) as w(fn, md5)
    on w.fn = p.proname
 where n.nspname = 'public' and p.prokind = 'f' and md5(p.prosrc) <> w.md5;

-- ── A. the fixture, as the owner ──────────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', (select owner::text from who), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare v_on boolean; v_act uuid; v_tier public.visibility_tier;
begin
  v_on := public.chronicle_share_timeline(true);
  if not v_on then insert into fails values ('FIXTURE: the timeline did not switch on', ''); end if;

  v_act := public.chronicle_activity_save(null, 'Feed probe: guitar', 'life', null, null, null, null);
  insert into ids values ('timed_act', v_act);
  v_tier := public.chronicle_activity_set_visibility(v_act, 'friends');
  if v_tier <> 'friends' then
    insert into fails values ('FIXTURE: the timed activity is not shared with friends', v_tier::text);
  end if;

  /* browsing, the way the site records it: one beat in a room */
  perform public.chronicle_visit('Feed probe room', 120);
exception when others then
  insert into fails values ('FIXTURE: setting up as the owner raised', sqlerrm);
end $$;

reset role;

/* the timed sitting, written directly: an hour, ended an hour ago */
insert into public.chronicle_entries (owner, activity, started_at, ended_at)
select (select owner from who), (select v from ids where k = 'timed_act'),
       clock_timestamp() - interval '2 hours', clock_timestamp() - interval '1 hour';

insert into ids
select 'room_act', a.id from public.chronicle_activities a
 where a.owner = (select owner from who) and a.auto and a.name = 'Feed probe room';
insert into fails select 'FIXTURE: the visit made no auto activity', ''
 where not exists (select 1 from ids where k = 'room_act');
insert into fails select 'FIXTURE: the visit recorded no sitting', ''
 where not exists (select 1 from public.chronicle_entries
                    where activity = (select v from ids where k = 'room_act') and ended_at is not null);

/* share the room's auto activity with friends -- the route by which browsing leaks today */
select set_config('request.jwt.claims',
  json_build_object('sub', (select owner::text from who), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_tier public.visibility_tier;
begin
  v_tier := public.chronicle_activity_set_visibility((select v from ids where k = 'room_act'), 'friends');
  if v_tier <> 'friends' then
    insert into fails values ('FIXTURE: the room''s activity is not shared with friends', v_tier::text);
  end if;
exception when others then
  insert into fails values ('FIXTURE: sharing the room''s activity raised', sqlerrm);
end $$;
reset role;

-- ── B. the friend ─────────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', (select friend::text from who), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into seen values
  ('friend_timeline_on', to_jsonb(public.chronicle_shares_timeline((select owner from who)))),
  ('friend_log',  public.chronicle_friends_log(clock_timestamp() - interval '1 day', null)),
  ('friend_feed', public.feed_recent(clock_timestamp() - interval '1 day', null, 40, 'you_and_friends'));
reset role;

insert into fails select 'FIXTURE: the friend cannot see the owner''s timeline', ''
 where (select v from seen where k = 'friend_timeline_on') is distinct from 'true'::jsonb;
insert into fails select 'the friend''s Friends tab lost the timed sitting', ''
 where not pg_temp.has_activity((select v from seen where k = 'friend_log'), 'Feed probe: guitar');
insert into fails select 'BROWSING reached the friend''s Friends tab', ''
 where pg_temp.has_activity((select v from seen where k = 'friend_log'), 'Feed probe room');
insert into fails select 'the friend''s Feed lost the timed sitting', ''
 where not pg_temp.has_detail((select v from seen where k = 'friend_feed'), 'Feed probe: guitar');
insert into fails select 'BROWSING reached the friend''s Feed', ''
 where pg_temp.has_detail((select v from seen where k = 'friend_feed'), 'Feed probe room');

-- ── C. the owner ──────────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', (select owner::text from who), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into seen values
  ('owner_feed', public.feed_recent(clock_timestamp() - interval '1 day', null, 40, 'you_and_friends')),
  ('owner_own',  public.chronicle_entries_between(clock_timestamp() - interval '1 day',
                                                  clock_timestamp() + interval '1 minute'));
reset role;

insert into fails select 'the owner''s Feed lost their timed sitting', ''
 where not pg_temp.has_detail((select v from seen where k = 'owner_feed'), 'Feed probe: guitar');
insert into fails select 'BROWSING reached the owner''s own Feed', ''
 where pg_temp.has_detail((select v from seen where k = 'owner_feed'), 'Feed probe room');
insert into fails select 'the visit is gone from the owner''s own Chronicle', 'it should be kept, privately'
 where not exists (select 1 from jsonb_array_elements((select v from seen where k = 'owner_own')) x
                    where (x->>'activity')::uuid = (select v from ids where k = 'room_act'));

-- ── D. a stranger sees neither ────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', (select stranger::text from who), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into seen values
  ('stranger_log',  public.chronicle_friends_log(clock_timestamp() - interval '1 day', null)),
  ('stranger_feed', public.feed_recent(clock_timestamp() - interval '1 day', null, 40, 'all_members'));
reset role;

insert into fails select 'a stranger saw the owner''s sittings', ''
 where pg_temp.has_activity((select v from seen where k = 'stranger_log'), 'Feed probe: guitar')
    or pg_temp.has_detail((select v from seen where k = 'stranger_feed'), 'Feed probe: guitar')
    or pg_temp.has_detail((select v from seen where k = 'stranger_feed'), 'Feed probe room');

-- ── E. the rollback: the way back, and the proof B and C can fail ─────────────────────────────
\ir ../../docs/2026-11-13-feed-hides-browsing.ROLLBACK.sql

select p.proname as reader, md5(p.prosrc) as body_md5_after_the_rollback
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f'
   and p.proname in ('chronicle_friends_log', 'feed_recent')
 order by p.proname;

insert into fails select 'the rollback did not restore the body checks.sql expects before the draft',
       p.proname || ': ' || md5(p.prosrc)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  join (values ('chronicle_friends_log', '1b3354fb5be0bdd7c4ab8c79c459286e'),
               ('feed_recent',           'd89d80e09622db1b406ec17168fbaeff')) as w(fn, md5)
    on w.fn = p.proname
 where n.nspname = 'public' and p.prokind = 'f' and md5(p.prosrc) <> w.md5;

select set_config('request.jwt.claims',
  json_build_object('sub', (select friend::text from who), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into seen values
  ('friend_log_without', public.chronicle_friends_log(clock_timestamp() - interval '1 day', null));
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', (select owner::text from who), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into seen values
  ('owner_feed_without',
   public.feed_recent(clock_timestamp() - interval '1 day', null, 40, 'you_and_friends'));
reset role;

insert into fails select 'without the draft the visit is still missing from the Friends tab',
       'so section B could not have failed'
 where not pg_temp.has_activity((select v from seen where k = 'friend_log_without'), 'Feed probe room');
insert into fails select 'without the draft the visit is still missing from the owner''s Feed',
       'so section C could not have failed'
 where not pg_temp.has_detail((select v from seen where k = 'owner_feed_without'), 'Feed probe room');

-- ── F. grants ─────────────────────────────────────────────────────────────────────────────────
insert into fails select 'anon can execute a reader', p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f'
   and p.proname in ('chronicle_friends_log', 'feed_recent')
   and has_function_privilege('anon', p.oid, 'execute');
insert into fails select 'authenticated cannot execute a reader', p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f'
   and p.proname in ('chronicle_friends_log', 'feed_recent')
   and not has_function_privilege('authenticated', p.oid, 'execute');

-- ── the verdict ───────────────────────────────────────────────────────────────────────────────
do $$
declare n int; msg text;
begin
  select count(*), string_agg('  - ' || check_name || ': ' || detail, E'\n')
    into n, msg from fails;
  if n > 0 then
    raise exception E'FEED HIDES BROWSING FAILED -- % check(s):\n%', n, msg;
  end if;
end $$;

select 'browsing stays out of the Feed and the Friends tab' as result, count(*) as failures from fails;

rollback;
