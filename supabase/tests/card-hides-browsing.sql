-- Step 2 of the Feed plan, asked of the real functions as the seeded members: browsing stays on
-- its owner's side of the profile card, and leaves the Sharing panel's list of activities.
--
-- ⛔ NEEDS THE DRAFT APPLIED FIRST, and refuses to run otherwise:
--      docs/2026-11-14-card-hides-browsing.DRAFT.sql
-- It is not applied to production. This file runs only where a throwaway database has been built
-- from the schema baseline and seed -- the `db guards` CI job, by way of a scratch-probe branch --
-- and it rolls back. NEVER against production: it writes sittings, a profile block and sharing
-- levels.
--
-- ⚠️ AND THE PROBE MUST REPLAY THE MIGRATIONS APPLIED SINCE THE DUMP BEFORE THE DRAFT. One of them
-- (20261110030419_chronicle_repeat_marks_profile) rewrote get_member_chronicle's goal lines, so
-- without it this database's card is not production's and section 0's md5s cannot match.
--
-- WHAT IT ASKS, section by section:
--   0  the draft is applied: each function carries its filter once per query over activities, and
--      each body's md5 is the "after" value docs/2026-11-14-card-hides-browsing.checks.sql expects
--   A  the fixture: the owner has a Chronicle card friends can see, with "now" switched on; an hour
--      they timed on an activity of their own; and browsing -- a room visited, 45 minutes in it
--      earlier, its auto activity shared with friends, and the room's activity running right now.
--      The fixture is proven before it is used.
--   B  the friend: the card shows the hour and not the room, in the top five, in the Free Time
--      total and in "now"
--   C  the owner: their own card still shows the room in all three; their Sharing panel lists the
--      activity they made and not the room; their own Chronicle still has every visit
--   D  a stranger gets no card at all -- the control that the card really is friends-only
--   E  the rollback, applied in here and rolled back with everything else: each body's md5 returns
--      to the "before" value, and the room is back on the friend's card and in the panel. So B and
--      C fail without the draft, and the rollback is the exact way back.
--   F  grants: anon executes neither function, authenticated executes both
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
         '00000000-0000-4000-a000-000000000003'::uuid as stranger,
         'seedowner'::text as owner_name;
grant select on who to authenticated, anon;

/* the card's three figures, asked in one place so every section asks the same question */
create or replace function pg_temp.in_top(p_card jsonb, p_name text) returns boolean
language sql immutable as $$
  select exists (select 1 from jsonb_array_elements(coalesce(p_card->'top', '[]'::jsonb)) x
                  where x->>'name' = p_name)
$$;
create or replace function pg_temp.free_mins(p_card jsonb) returns int
language sql immutable as $$ select coalesce((p_card->'time'->>'free')::int, 0) $$;
create or replace function pg_temp.lists(p_panel jsonb, p_name text) returns boolean
language sql immutable as $$
  select exists (select 1 from jsonb_array_elements(coalesce(p_panel->'activities', '[]'::jsonb)) x
                  where x->>'name' = p_name)
$$;

-- ── 0. the draft is applied ───────────────────────────────────────────────────────────────────
insert into fails select 'DRAFT NOT APPLIED', p.proname || ' does not carry the filter as often as it reads activities'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  join (values ('get_member_chronicle',   '(v_target = v_viewer or not a.auto)', 3),
               ('chronicle_sharing_mine', 'and not a.auto',                      1)) as w(fn, filter, times)
    on w.fn = p.proname
 where n.nspname = 'public' and p.prokind = 'f'
   and (length(p.prosrc) - length(replace(p.prosrc, w.filter, ''))) / length(w.filter) <> w.times;

select p.proname as function, md5(p.prosrc) as body_md5_with_the_draft
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f'
   and p.proname in ('get_member_chronicle', 'chronicle_sharing_mine')
 order by p.proname;

insert into fails select 'the body is not the one checks.sql expects after the draft',
       p.proname || ': ' || md5(p.prosrc)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  join (values ('chronicle_sharing_mine', '702f1932689bcdd33b16f0171dbe9b89'),
               ('get_member_chronicle',   'ae31965d4220269491da5b0b1f59f6ed')) as w(fn, md5)
    on w.fn = p.proname
 where n.nspname = 'public' and p.prokind = 'f' and md5(p.prosrc) <> w.md5;

-- ── A. the fixture ────────────────────────────────────────────────────────────────────────────
/* a Chronicle card on the owner's page that friends can see, showing what is running now. Written
   directly, as the seed writes blocks: save_my_profile_blocks replaces a whole page, and this
   should not depend on what else the owner's page holds. */
insert into public.profile_blocks (user_id, block_type, position, size, config, visibility)
select owner, 'chronicle', 93, 'small', '{"timeline": true, "live": true}'::jsonb, 'friends'
  from who;

select set_config('request.jwt.claims',
  json_build_object('sub', (select owner::text from who), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare v_act uuid;
begin
  v_act := public.chronicle_activity_save(null, 'Card probe: guitar', 'life', null, null, null, null);
  insert into ids values ('timed_act', v_act);
  /* browsing, the way the site records it: one beat in a room */
  perform public.chronicle_visit('Card probe room', 120);
exception when others then
  insert into fails values ('FIXTURE: setting up as the owner raised', sqlerrm);
end $$;

reset role;

insert into ids
select 'room_act', a.id from public.chronicle_activities a
 where a.owner = (select owner from who) and a.auto and a.name = 'Card probe room';
insert into fails select 'FIXTURE: the visit made no auto activity', ''
 where not exists (select 1 from ids where k = 'room_act');

/* an hour of guitar, ended an hour ago, and 45 minutes in the room before it -- a long stay is a
   state the site writes itself, one beat at a time */
insert into public.chronicle_entries (owner, activity, started_at, ended_at)
select (select owner from who), (select v from ids where k = 'timed_act'),
       clock_timestamp() - interval '2 hours', clock_timestamp() - interval '1 hour'
union all
select (select owner from who), (select v from ids where k = 'room_act'),
       clock_timestamp() - interval '3 hours', clock_timestamp() - interval '2 hours 15 minutes';

/* as the owner again: share the room with friends, the one level a browsing row could ever have
   reached anybody through, and start it running, which chronicle_start allows */
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
  perform public.chronicle_start((select v from ids where k = 'room_act'));
exception when others then
  insert into fails values ('FIXTURE: sharing or starting the room raised', sqlerrm);
end $$;
reset role;

insert into fails select 'FIXTURE: the room is not the sitting running now', ''
 where not exists (select 1 from public.chronicle_entries
                    where owner = (select owner from who) and ended_at is null
                      and activity = (select v from ids where k = 'room_act'));

-- ── B. the friend ─────────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', (select friend::text from who), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into seen values
  ('friend_card', public.get_member_chronicle((select owner_name from who), 7));
reset role;

insert into fails select 'FIXTURE: the friend cannot see the owner''s card', ''
 where (select v from seen where k = 'friend_card') is null
    or (select v from seen where k = 'friend_card') = 'null'::jsonb;
insert into fails select 'the friend''s card lost the hour of guitar', ''
 where not pg_temp.in_top((select v from seen where k = 'friend_card'), 'Card probe: guitar');
insert into fails select 'BROWSING is in the top five on the friend''s card', ''
 where pg_temp.in_top((select v from seen where k = 'friend_card'), 'Card probe room');
insert into fails select 'BROWSING is "now" on the friend''s card',
       (select v from seen where k = 'friend_card')->'now'->>'name'
 where (select v from seen where k = 'friend_card')->'now' is not null
   and (select v from seen where k = 'friend_card')->'now' <> 'null'::jsonb;

-- ── C. the owner ──────────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', (select owner::text from who), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into seen values
  ('owner_card',  public.get_member_chronicle((select owner_name from who), 7)),
  ('owner_panel', public.chronicle_sharing_mine()),
  ('owner_own',   public.chronicle_entries_between(clock_timestamp() - interval '1 day',
                                                   clock_timestamp() + interval '1 minute'));
reset role;

insert into fails select 'the owner''s own card lost the room from the top five', 'it is theirs to see'
 where not pg_temp.in_top((select v from seen where k = 'owner_card'), 'Card probe room');
insert into fails select 'the owner''s own card lost the room from "now"',
       coalesce((select v from seen where k = 'owner_card')->'now'->>'name', 'nothing')
 where (select v from seen where k = 'owner_card')->'now'->>'name' is distinct from 'Card probe room';
/* the 45 minutes are Free Time on the owner's card and nowhere on the friend's: a total that still
   counted browsing would differ by nothing */
insert into fails select 'BROWSING is in the Free Time total on the friend''s card',
       'owner ' || pg_temp.free_mins((select v from seen where k = 'owner_card'))
       || ', friend ' || pg_temp.free_mins((select v from seen where k = 'friend_card'))
 where pg_temp.free_mins((select v from seen where k = 'owner_card'))
       - pg_temp.free_mins((select v from seen where k = 'friend_card')) < 45;
insert into fails select 'the Sharing panel lost the activity the owner made', ''
 where not pg_temp.lists((select v from seen where k = 'owner_panel'), 'Card probe: guitar');
insert into fails select 'BROWSING is still offered in the Sharing panel', 'shared with friends, and inert'
 where pg_temp.lists((select v from seen where k = 'owner_panel'), 'Card probe room');
insert into fails select 'the visits are gone from the owner''s own Chronicle', 'they should be kept, privately'
 where (select count(*) from jsonb_array_elements((select v from seen where k = 'owner_own')) x
         where (x->>'activity')::uuid = (select v from ids where k = 'room_act')) < 2;

-- ── D. a stranger gets no card at all ─────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', (select stranger::text from who), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into seen values
  ('stranger_card', coalesce(public.get_member_chronicle((select owner_name from who), 7), 'null'::jsonb));
reset role;

insert into fails select 'a stranger saw the owner''s card', ''
 where (select v from seen where k = 'stranger_card') <> 'null'::jsonb;

-- ── E. the rollback: the way back, and the proof B and C can fail ─────────────────────────────
\ir ../../docs/2026-11-14-card-hides-browsing.ROLLBACK.sql

select p.proname as function, md5(p.prosrc) as body_md5_after_the_rollback
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f'
   and p.proname in ('get_member_chronicle', 'chronicle_sharing_mine')
 order by p.proname;

insert into fails select 'the rollback did not restore the body checks.sql expects before the draft',
       p.proname || ': ' || md5(p.prosrc)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  join (values ('chronicle_sharing_mine', 'caf481fcd16fb245ae40c7e93a8e9e7e'),
               ('get_member_chronicle',   '175d50d2a9a4a43baa8e801e10603ca9')) as w(fn, md5)
    on w.fn = p.proname
 where n.nspname = 'public' and p.prokind = 'f' and md5(p.prosrc) <> w.md5;

select set_config('request.jwt.claims',
  json_build_object('sub', (select friend::text from who), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into seen values
  ('friend_card_without', public.get_member_chronicle((select owner_name from who), 7));
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', (select owner::text from who), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into seen values ('owner_panel_without', public.chronicle_sharing_mine());
reset role;

insert into fails select 'without the draft the room is still missing from the friend''s card',
       'so section B could not have failed'
 where not pg_temp.in_top((select v from seen where k = 'friend_card_without'), 'Card probe room')
    or (select v from seen where k = 'friend_card_without')->'now'->>'name' is distinct from 'Card probe room'
    /* within a minute, not equal: the room is still running, so it has grown since C asked */
    or abs(pg_temp.free_mins((select v from seen where k = 'friend_card_without'))
           - pg_temp.free_mins((select v from seen where k = 'owner_card'))) > 1;
insert into fails select 'without the draft the room is still missing from the Sharing panel',
       'so section C could not have failed'
 where not pg_temp.lists((select v from seen where k = 'owner_panel_without'), 'Card probe room');

-- ── F. grants ─────────────────────────────────────────────────────────────────────────────────
insert into fails select 'anon can execute a function the draft changes', p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f'
   and p.proname in ('get_member_chronicle', 'chronicle_sharing_mine')
   and has_function_privilege('anon', p.oid, 'execute');
insert into fails select 'authenticated cannot execute a function the draft changes', p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f'
   and p.proname in ('get_member_chronicle', 'chronicle_sharing_mine')
   and not has_function_privilege('authenticated', p.oid, 'execute');

-- ── the verdict ───────────────────────────────────────────────────────────────────────────────
do $$
declare n int; msg text;
begin
  select count(*), string_agg('  - ' || check_name || ': ' || detail, E'\n')
    into n, msg from fails;
  if n > 0 then
    raise exception E'CARD HIDES BROWSING FAILED -- % check(s):\n%', n, msg;
  end if;
end $$;

select 'browsing stays off the card and out of the Sharing panel' as result, count(*) as failures from fails;

rollback;
