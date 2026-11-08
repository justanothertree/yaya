-- Which days a goal asks about — its weekdays and its creation day — asked of the real functions
-- as a seeded member.
--
-- ⛔ NEEDS THE DRAFT APPLIED FIRST, and refuses to run otherwise:
--      docs/2026-11-08-chronicle-weekdays.DRAFT.sql
-- It is not applied to production. This file runs only where a throwaway database has been built
-- from the migrations and seed — the `db guards` CI job — and it rolls back. NEVER against
-- production: it writes rows and suspends a member to ask about refusals.
--
-- WHAT IT ASKS, section by section:
--   0  the draft is applied and there are two members to act as, or nothing below means anything
--   A  the table is deny-all to every role and every privilege, TRUNCATE included; anon has no door
--   B  a schedule is set from today, a second change on one day replaces the first, yesterday
--      (UTC) is the earliest start — and seven refusals, each in its own words
--   C  the goals reader carries `made` and `days`, in ISO whatever the session's DateStyle, oldest
--      first, and nothing of anybody else's
--   D  the export carries every field of a schedule row and the import puts each back — dropped one
--      at a time to prove each is carried — but ONLY for a goal the same import created
--   E  an edit never erases a schedule: a rename keeps it, and turning the goal into a one-off
--      keeps its rows while the writer refuses to add to them; deleting the goal takes them
-- On failure it raises, naming every check that failed. A green run prints one row.

begin;

create temp table fails(check_name text, detail text);
create temp table ids(k text primary key, v uuid);
create temp table subject as
  select (select p.user_id from public.profiles p
           where coalesce(p.suspended, false) = false
           order by p.username limit 1) as me,
         (select p.user_id from public.profiles p
           where coalesce(p.suspended, false) = false
           order by p.username offset 1 limit 1) as other;
/* the days, in UTC — the server's own bound is written in UTC, so the test speaks it too */
create temp table d as
  select (now() at time zone 'utc')::date as today,
         (now() at time zone 'utc')::date - 1 as yest,
         (now() at time zone 'utc')::date - 2 as too_early;
grant select on subject, d to authenticated, anon;
grant select, insert on fails to authenticated, anon;
grant select, insert, update on ids to authenticated, anon;

-- ── 0. THE DRAFT MUST BE APPLIED, OR EVERY CHECK BELOW IS ABOUT NOTHING ──────────────────────
do $$
begin
  if to_regclass('public.chronicle_goal_days') is null
     or to_regprocedure('public.chronicle_goal_days_set(uuid, smallint, date)') is null
     or position('chronicle_goal_days' in
          pg_get_functiondef('public.chronicle_goals_mine()'::regprocedure)) = 0 then
    raise exception 'apply docs/2026-11-08-chronicle-weekdays.DRAFT.sql before this file';
  end if;
end $$;

insert into fails select 'FIXTURE: no member to act as', 'seed the database first'
where (select me from subject) is null;
insert into fails select 'FIXTURE: no second member', 'the refusals below would ask nobody'
where (select other from subject) is null or (select other from subject) = (select me from subject);

-- ── A. deny-all, by privilege, and no door for anon ────────────────────────────────────────
insert into fails
select 'the schedule table grants ' || pv || ' to ' || r, 'it should be reached only by functions'
from (values ('anon'), ('authenticated')) rs(r),
     (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'),
             ('TRIGGER')) ps(pv)
where has_table_privilege(r, 'public.chronicle_goal_days', pv);
insert into fails select 'row level security is off on the schedule table', 'deny-all needs it on'
where not (select relrowsecurity from pg_class where oid = 'public.chronicle_goal_days'::regclass);
insert into fails select 'anon can execute the schedule writer', ''
where has_function_privilege('anon', 'public.chronicle_goal_days_set(uuid, smallint, date)', 'execute');
insert into fails select 'a member cannot execute the schedule writer', ''
where not has_function_privilege('authenticated', 'public.chronicle_goal_days_set(uuid, smallint, date)', 'execute');

-- ── B. as the member: set, replace, and the refusals ───────────────────────────────────────
-- the other member's goal first, made as them
select set_config('request.jwt.claims',
  json_build_object('sub', (select other::text from subject), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  insert into ids values
    ('theirs', public.chronicle_goal_save(null, 'Days: theirs', 'day', null, 1, null, null,
                                          null, null, null, null, 'minutes', null, 0));
exception when others then insert into fails values ('the other member''s goal raised', sqlerrm);
end $$;
reset role;

select set_config('request.jwt.claims',
  json_build_object('sub', (select me::text from subject), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  --                                  id    title          scope   anchor  rep  target unit
  insert into ids values
    ('swim',   public.chronicle_goal_save(null, 'Days: swim', 'day', null, 1, null, null,
                                          null, null, null, null, 'minutes', null, 0)),
    ('weekly', public.chronicle_goal_save(null, 'Days: weekly', 'week', null, 1, null, null,
                                          null, null, null, null, 'minutes', null, 0)),
    ('once',   public.chronicle_goal_save(null, 'Days: once', 'day',
                                          (select today from d), null, null, null,
                                          null, null, null, null, 'minutes', null, 0)),
    ('plain',  public.chronicle_goal_save(null, 'Days: plain daily', 'day', null, 1, null, null,
                                          null, null, null, null, 'minutes', null, 0));
  -- weekdays from yesterday (the earliest the server allows), then today, then today again
  perform public.chronicle_goal_days_set((select v from ids where k = 'swim'), 62::smallint, (select yest from d));
  perform public.chronicle_goal_days_set((select v from ids where k = 'swim'), 20::smallint, (select today from d));
  perform public.chronicle_goal_days_set((select v from ids where k = 'swim'), 4::smallint, (select today from d));
exception when others then insert into fails values ('setting a schedule raised', sqlerrm);
end $$;
reset role;

insert into fails select 'the schedule did not land as two rows, today''s replaced',
       coalesce((select string_agg(from_day::text || '=' || days, ', ' order by from_day)
                   from public.chronicle_goal_days where goal = (select v from ids where k = 'swim')), 'none')
where (select array_agg(array[from_day - (select yest from d), days] order by from_day)
         from public.chronicle_goal_days where goal = (select v from ids where k = 'swim'))
      is distinct from array[array[0, 62], array[1, 4]];
insert into fails select 'a schedule row took the wrong owner', owner::text
from public.chronicle_goal_days
where goal = (select v from ids where k = 'swim') and owner <> (select me from subject);

/* each refusal, in the writer's own words — a refusal that names the wrong reason is how a
   later edit moves a check without anybody noticing */
create temp table tries(what text, goal_k text, days int, from_k text, want text);
insert into tries values
  ('a start two days ago (UTC)',      'swim',   4,   'too_early', 'a schedule change starts today or later'),
  ('no start at all',                 'swim',   4,   null,        'a schedule change starts today or later'),
  ('a goal for no days',              'swim',   0,   'today',     'a goal has to be for at least one day'),
  ('a mask past Saturday',            'swim',   128, 'today',     'a goal has to be for at least one day'),
  ('no mask at all',                  'swim',   null,'today',     'a goal has to be for at least one day'),
  ('a weekly goal',                   'weekly', 4,   'today',     'no such repeating daily goal'),
  ('a one-off',                       'once',   4,   'today',     'no such repeating daily goal'),
  ('another member''s goal',          'theirs', 4,   'today',     'no such repeating daily goal');
grant select on tries to authenticated, anon;

set local role authenticated;
do $$
declare t record; got text;
begin
  for t in select * from tries loop
    got := null;
    begin
      perform public.chronicle_goal_days_set(
        (select v from ids where k = t.goal_k), t.days::smallint,
        case t.from_k when 'too_early' then (select too_early from d)
                      when 'today' then (select today from d) end);
    exception when others then got := sqlerrm;
    end;
    if got is distinct from t.want then
      insert into fails values ('refusing ' || t.what, coalesce(got, 'it was accepted'));
    end if;
  end loop;
end $$;
reset role;
insert into fails select 'a refused schedule still landed', goal::text || ' ' || from_day
from public.chronicle_goal_days
where goal in (select v from ids where k in ('weekly', 'once', 'theirs'))
   or (goal = (select v from ids where k = 'swim') and from_day = (select too_early from d))
   or (goal = (select v from ids where k = 'swim') and days not in (62, 4));

-- not authenticated, and suspended
select set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare got text;
begin
  begin
    perform public.chronicle_goal_days_set((select v from ids where k = 'swim'), 4::smallint, (select today from d));
  exception when others then got := sqlerrm;
  end;
  if got is distinct from 'not authenticated' then
    insert into fails values ('refusing nobody', coalesce(got, 'it was accepted'));
  end if;
end $$;
reset role;

update public.profiles set suspended = true where user_id = (select me from subject);
select set_config('request.jwt.claims',
  json_build_object('sub', (select me::text from subject), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare got text;
begin
  begin
    perform public.chronicle_goal_days_set((select v from ids where k = 'swim'), 127::smallint, (select today from d));
  exception when others then got := sqlerrm;
  end;
  if got is distinct from 'your account is suspended' then
    insert into fails values ('refusing a suspended member', coalesce(got, 'it was accepted'));
  end if;
end $$;
reset role;
update public.profiles set suspended = false where user_id = (select me from subject);

-- ── C. what the goals reader hands back ────────────────────────────────────────────────────
/* ⚠️ UNDER A DateStyle THAT PRINTS DAY FIRST: a `from` built by casting a date to text would come
   back "08/11/2026", which the client would read as no date at all */
set local datestyle = 'SQL, DMY';
set local role authenticated;
do $$
declare mine jsonb; g jsonb; made_ms numeric;
begin
  mine := public.chronicle_goals_mine();
  select x into g from jsonb_array_elements(mine) x where (x->>'id')::uuid = (select v from ids where k = 'swim');
  if g->'days' is distinct from jsonb_build_array(
       jsonb_build_object('from', to_char((select yest from d), 'YYYY-MM-DD'), 'days', 62),
       jsonb_build_object('from', to_char((select today from d), 'YYYY-MM-DD'), 'days', 4)) then
    insert into fails values ('the reader''s schedule', coalesce((g->'days')::text, 'missing'));
  end if;
  made_ms := (select extract(epoch from created_at) * 1000 from public.chronicle_goals
               where id = (select v from ids where k = 'swim'));
  if (g->>'made') is null or abs((g->>'made')::numeric - made_ms) > 1 then
    insert into fails values ('the reader''s creation moment', coalesce(g->>'made', 'missing') || ' vs ' || made_ms);
  end if;
  select x into g from jsonb_array_elements(mine) x where (x->>'id')::uuid = (select v from ids where k = 'plain');
  if g->'days' is distinct from '[]'::jsonb then
    insert into fails values ('a goal with no schedule should read an empty list', coalesce((g->'days')::text, 'missing'));
  end if;
  if exists (select 1 from jsonb_array_elements(mine) x where (x->>'id')::uuid = (select v from ids where k = 'theirs')) then
    insert into fails values ('the reader handed back another member''s goal', '');
  end if;
exception when others then insert into fails values ('reading the goals raised', sqlerrm);
end $$;
reset role;
reset datestyle;

-- ── D. the export carries every field, the import puts each back — for a goal it created ────
/* every field away from its default: two rows, two masks, and set_at moved back by hand, because
   now() is fixed for the whole transaction and a set_at the import invents would equal it */
update public.chronicle_goal_days set set_at = now() - interval '3 days'
 where goal = (select v from ids where k = 'swim') and from_day = (select yest from d);

create temp table docs(k text primary key, body jsonb);
grant select, insert, update on docs to authenticated, anon;
set local role authenticated;
do $$
begin
  insert into docs values ('orig', public.chronicle_export());
end $$;
reset role;

create temp view orig_days as
  select g->'days' as v, (g->>'created_at') as made
    from docs, jsonb_array_elements(body->'goals') g
   where k = 'orig' and (g->>'id')::uuid = (select v from ids where k = 'swim');
grant select on orig_days to authenticated, anon;

insert into fails select 'the export does not carry the schedule',
       coalesce((select v::text from orig_days), 'no goal in the file')
where coalesce(jsonb_array_length((select v from orig_days)), 0) <> 2;
insert into fails select 'the export''s schedule row is missing a field', f
from (values ('from'), ('days'), ('set_at')) fs(f)
where not ((select v->0 from orig_days) ? f);

/* the goal goes, the file brings it back with its schedule; then once per field, with that field
   taken out of the file, and the result must DIFFER, or the field is not really carried */
create temp table trips(field text);
insert into trips values (null), ('from'), ('days'), ('set_at');
grant select on trips to authenticated, anon;

do $$
declare t record; doc jsonb; back jsonb; res jsonb; made text;
begin
  for t in select * from trips loop
    delete from public.chronicle_goals where id = (select v from ids where k = 'swim');
    doc := (select body from docs where k = 'orig');
    /* only the goal under test, so the counts below are about it alone */
    doc := jsonb_set(doc, '{goals}', (
      select jsonb_agg(case when t.field is null then g
                            else jsonb_set(g, '{days}', (select jsonb_agg(dd - t.field)
                                                          from jsonb_array_elements(g->'days') dd)) end)
        from jsonb_array_elements(doc->'goals') g
       where (g->>'id')::uuid = (select v from ids where k = 'swim')));
    perform set_config('role', 'authenticated', true);
    res := public.chronicle_import(doc);
    select g->'days', g->>'created_at' into back, made
      from jsonb_array_elements(public.chronicle_export()->'goals') g
     where (g->>'id')::uuid = (select v from ids where k = 'swim');
    perform set_config('role', 'postgres', true);
    if t.field is null then
      if back is distinct from (select v from orig_days) then
        insert into fails values ('the round trip changed the schedule', coalesce(back::text, 'null'));
      end if;
      if made is distinct from (select o.made from orig_days o) then
        insert into fails values ('the round trip moved the day the goal was made', coalesce(made, 'null'));
      end if;
      if (res->>'schedules')::int is distinct from 2 or (res->>'goals')::int is distinct from 1 then
        insert into fails values ('the import did not count what it put back', res::text);
      end if;
    elsif back is not distinct from (select v from orig_days) then
      insert into fails values ('the import does not really carry ' || t.field,
                                'dropping it from the file changed nothing');
    end if;
  end loop;
exception when others then insert into fails values ('the round trip raised', sqlerrm);
end $$;
reset role;

/* a file naming goals that are ALREADY here — one of mine with no schedule, and another member's —
   plus a weekly goal and a daily one with a mask of zero, both new: none of the four may gain a
   schedule, and the two new goals still arrive */
do $$
declare doc jsonb; res jsonb; new_week uuid := gen_random_uuid(); new_zero uuid := gen_random_uuid();
begin
  insert into ids values ('new_week', new_week), ('new_zero', new_zero);
  doc := jsonb_build_object('kind', 'chronicle', 'version', 1, 'goals', jsonb_build_array(
    jsonb_build_object('id', (select v from ids where k = 'plain'), 'title', 'Days: plain daily',
                       'scope', 'day', 'repeat_every', 1,
                       'days', jsonb_build_array(jsonb_build_object('from', '2026-01-01', 'days', 4))),
    jsonb_build_object('id', (select v from ids where k = 'theirs'), 'title', 'Days: theirs',
                       'scope', 'day', 'repeat_every', 1,
                       'days', jsonb_build_array(jsonb_build_object('from', '2026-01-01', 'days', 4))),
    jsonb_build_object('id', new_week, 'title', 'Days: new weekly', 'scope', 'week', 'repeat_every', 1,
                       'days', jsonb_build_array(jsonb_build_object('from', '2026-01-01', 'days', 4))),
    jsonb_build_object('id', new_zero, 'title', 'Days: new, no days', 'scope', 'day', 'repeat_every', 1,
                       'days', jsonb_build_array(jsonb_build_object('from', '2026-01-01', 'days', 0)))));
  perform set_config('role', 'authenticated', true);
  res := public.chronicle_import(doc);
  perform set_config('role', 'postgres', true);
  if exists (select 1 from public.chronicle_goal_days
              where goal in (select v from ids where k in ('plain', 'theirs', 'new_week', 'new_zero'))) then
    insert into fails values ('a file gave a schedule to a goal it should not have', res::text);
  end if;
  if coalesce((res->>'schedules')::int, -1) <> 0 or coalesce((res->>'goals')::int, -1) <> 2 then
    insert into fails values ('the tampered file was counted wrongly', res::text);
  end if;
exception when others then insert into fails values ('the tampered import raised', sqlerrm);
end $$;
reset role;

-- ── E. an edit never erases a schedule; deleting the goal does ─────────────────────────────
set local role authenticated;
do $$
declare got text; n int;
begin
  -- a rename keeps it
  perform public.chronicle_goal_save((select v from ids where k = 'swim'), 'Days: swim, renamed', 'day',
                                     null, 1, null, null, null, null, null, null, 'minutes', null, 0);
  -- a one-off now: the rows stay, and the writer will not add to them
  perform public.chronicle_goal_save((select v from ids where k = 'swim'), 'Days: swim, once', 'day',
                                     (select today from d), null, null, null, null, null, null, null,
                                     'minutes', null, 0);
  begin
    perform public.chronicle_goal_days_set((select v from ids where k = 'swim'), 127::smallint, (select today from d));
  exception when others then got := sqlerrm;
  end;
  if got is distinct from 'no such repeating daily goal' then
    insert into fails values ('scheduling a goal that became a one-off', coalesce(got, 'it was accepted'));
  end if;
  -- and daily again: its own past is still there
  perform public.chronicle_goal_save((select v from ids where k = 'swim'), 'Days: swim', 'day',
                                     null, 1, null, null, null, null, null, null, 'minutes', null, 0);
exception when others then insert into fails values ('editing the goal raised', sqlerrm);
end $$;
reset role;
insert into fails select 'an edit erased the schedule',
       coalesce((select string_agg(from_day::text || '=' || days, ', ')
                   from public.chronicle_goal_days where goal = (select v from ids where k = 'swim')), 'none')
where (select count(*) from public.chronicle_goal_days
        where goal = (select v from ids where k = 'swim') and days in (62, 4)) <> 2;

set local role authenticated;
do $$
begin
  perform public.chronicle_goal_drop((select v from ids where k = 'swim'));
exception when others then insert into fails values ('deleting the goal raised', sqlerrm);
end $$;
reset role;
insert into fails select 'deleting a goal left its schedule behind', count(*)::text
from public.chronicle_goal_days where goal = (select v from ids where k = 'swim')
having count(*) > 0;

-- ── the verdict ─────────────────────────────────────────────────────────────────────────────
do $$
declare n int; msg text;
begin
  select count(*), string_agg('  - ' || check_name || ': ' || detail, E'\n')
    into n, msg from fails;
  if n > 0 then
    raise exception E'CHRONICLE WEEKDAYS FAILED -- % check(s):\n%', n, msg;
  end if;
end $$;

select 'a goal asks about its own days, and an edit rewrites none of them' as result, count(*) as failures from fails;

rollback;
