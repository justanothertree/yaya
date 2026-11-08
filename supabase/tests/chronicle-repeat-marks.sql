-- Repeating goals moved by hand, one row per window — asked of the real functions as a member.
--
-- ⛔ A THROWAWAY DATABASE ONLY, and one the two drafts have been applied to first:
--      docs/2026-11-08-chronicle-repeat-marks.DRAFT.sql          (step 1: table, writer, reader,
--                                                                  export and import)
--      docs/2026-11-08-chronicle-repeat-marks-profile.DRAFT.sql  (step 3: the profile reader)
-- Neither is a migration yet, so CI's database does not have them and this file is NOT run by the
-- `db guards` job. It runs through a scratch branch that applies both drafts and then this, in the
-- same throwaway database. It writes inside a transaction that always rolls back, and like every
-- account-writing test here it is never pointed at production, rolled back or not.
--
-- WHAT IT IS EVIDENCE OF: the real Postgres functions under a seeded member's role and JWT claim,
-- which this file sets itself. NOT Supabase Auth, NOT PostgREST, NOT a browser.
--
-- WHAT IT ASKS, section by section:
--   0  the drafts are applied and there are two members to act as, or nothing below means anything
--   A  the table is deny-all to every role and every privilege, TRUNCATE included; anon has no door
--   B  a tick is per window, a past window can be fixed, null leaves a value alone, a second tick
--      keeps the first moment — and six refusals, each in its own words
--   C  what the reader hands back: your marks only, at the goal's current scope, keyed in ISO
--      whatever the session's DateStyle, and the ticks from before marks as `legacy`
--   D  the export carries every field of a mark and the import puts each one back — dropped one at
--      a time to prove each is really carried — and a tampered file reaches nobody else's goal
--   E  the profile: a repeating goal says how THIS window went, a one-off reads as it always did
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
/* the windows, worked out once in UTC — the server is given instants and has no opinion */
create temp table win as
  select k, f, (f::timestamp at time zone 'utc') as s,
         ((f + len)::timestamp at time zone 'utc') as e
    from (values
      ('today',     (now() at time zone 'utc')::date,      1),
      ('yesterday', (now() at time zone 'utc')::date - 1,  1),
      ('ahead',     (now() at time zone 'utc')::date + 2,  1),
      ('week',      (now() at time zone 'utc')::date
                     - extract(dow from (now() at time zone 'utc'))::int, 7)
    ) v(k, f, len);
grant select on subject, win to authenticated, anon;
grant select, insert on fails to authenticated, anon;
grant select, insert, update on ids to authenticated, anon;

-- ── 0. THE DRAFTS MUST BE APPLIED, OR EVERY CHECK BELOW IS ABOUT NOTHING ─────────────────────
do $$
begin
  if to_regclass('public.chronicle_goal_marks') is null
     or to_regprocedure('public.chronicle_goal_marks_for(jsonb)') is null then
    raise exception 'apply docs/2026-11-08-chronicle-repeat-marks.DRAFT.sql before this file';
  end if;
  if position('chronicle_goal_marks' in
       pg_get_functiondef('public.get_member_chronicle(text, integer)'::regprocedure)) = 0 then
    raise exception 'apply docs/2026-11-08-chronicle-repeat-marks-profile.DRAFT.sql before this file';
  end if;
end $$;

insert into fails select 'FIXTURE: no member to act as', 'seed the database first'
where (select me from subject) is null;
insert into fails select 'FIXTURE: no second member', 'the refusals below would ask nobody'
where (select other from subject) is null or (select other from subject) = (select me from subject);

-- ── A. deny-all, by privilege, and no door for anon ────────────────────────────────────────
insert into fails
select 'the marks table grants ' || pv || ' to ' || r, 'it should be reached only by functions'
from (values ('anon'), ('authenticated')) rs(r),
     (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'),
             ('TRIGGER')) ps(pv)
where has_table_privilege(r, 'public.chronicle_goal_marks', pv);
insert into fails select 'row level security is off on the marks table', 'deny-all needs it on'
where not (select relrowsecurity from pg_class where oid = 'public.chronicle_goal_marks'::regclass);
insert into fails select 'anon can execute', f
from (values ('public.chronicle_goal_mark(uuid, date, timestamptz, timestamptz, numeric, boolean)'),
             ('public.chronicle_goal_marks_for(jsonb)')) fs(f)
where has_function_privilege('anon', f, 'execute');
insert into fails select 'a member cannot execute', f
from (values ('public.chronicle_goal_mark(uuid, date, timestamptz, timestamptz, numeric, boolean)'),
             ('public.chronicle_goal_marks_for(jsonb)')) fs(f)
where not has_function_privilege('authenticated', f, 'execute');

-- ── B. as the member: ticks, per window ────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', (select me::text from subject), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
begin
  --                                  id    title        scope  anchor  rep  target unit
  insert into ids values
    ('floss',   public.chronicle_goal_save(null, 'Marks: floss', 'day', null, 1, null, null,
                                           null, null, null, null, 'minutes', null, 0)),
    ('stretch', public.chronicle_goal_save(null, 'Marks: stretch', 'day', null, 1, 20, 'minutes',
                                           null, null, null, null, 'minutes', null, 0)),
    ('weekly',  public.chronicle_goal_save(null, 'Marks: weekly', 'week', null, 1, null, null,
                                           null, null, null, null, 'minutes', null, 0)),
    ('once',    public.chronicle_goal_save(null, 'Marks: once', 'day',
                                           (select f from win where k = 'today'), null, null, null,
                                           null, null, null, null, 'minutes', null, 0));
  -- a tick under the OLD room, on the row, before any mark exists: the `legacy` evidence
  perform public.chronicle_goal_progress((select v from ids where k = 'floss'), 0, true);
  perform public.chronicle_goal_progress((select v from ids where k = 'once'), 0, true);
exception when others then
  insert into fails values ('making the goals raised', sqlerrm);
end $$;

do $$
declare t record;
begin
  select * into t from win where k = 'today';
  perform public.chronicle_goal_mark((select v from ids where k = 'floss'), t.f, t.s, t.e, null, true);
exception when others then insert into fails values ('ticking today raised', sqlerrm);
end $$;

do $$
declare t record;
begin
  -- a past window can be fixed: forgot yesterday, ticked it, then thought better of it
  select * into t from win where k = 'yesterday';
  perform public.chronicle_goal_mark((select v from ids where k = 'floss'), t.f, t.s, t.e, null, true);
  perform public.chronicle_goal_mark((select v from ids where k = 'floss'), t.f, t.s, t.e, null, false);
exception when others then insert into fails values ('fixing yesterday raised', sqlerrm);
end $$;

do $$
declare t record;
begin
  -- a count moved, then ticked with the count left alone: null means "not talking about it"
  select * into t from win where k = 'today';
  perform public.chronicle_goal_mark((select v from ids where k = 'stretch'), t.f, t.s, t.e, 12, null);
  perform public.chronicle_goal_mark((select v from ids where k = 'stretch'), t.f, t.s, t.e, null, true);
  select * into t from win where k = 'week';
  perform public.chronicle_goal_mark((select v from ids where k = 'weekly'), t.f, t.s, t.e, null, true);
exception when others then insert into fails values ('moving a count raised', sqlerrm);
end $$;

reset role;

insert into fails select 'today''s tick did not land', coalesce(done_at::text, 'no row')
from (select (select done_at from public.chronicle_goal_marks
               where goal = (select v from ids where k = 'floss')
                 and window_from = (select f from win where k = 'today')) as done_at) x
where done_at is null;
insert into fails select 'unticking yesterday did not stick', done_at::text
from public.chronicle_goal_marks
where goal = (select v from ids where k = 'floss')
  and window_from = (select f from win where k = 'yesterday') and done_at is not null;
insert into fails select 'a tick with a null count moved the count', progress::text
from public.chronicle_goal_marks
where goal = (select v from ids where k = 'stretch')
  and window_from = (select f from win where k = 'today')
  and (progress <> 12 or done_at is null);
insert into fails select 'a mark took the goal''s scope wrongly', scope
from public.chronicle_goal_marks
where goal = (select v from ids where k = 'weekly') and scope <> 'week';

/* a second tick must keep the FIRST moment. now() is fixed for the whole transaction, so the first
   moment is moved back by hand first — otherwise "kept" and "overwritten" are the same value */
update public.chronicle_goal_marks set done_at = now() - interval '5 hours'
 where goal = (select v from ids where k = 'floss')
   and window_from = (select f from win where k = 'today');

set local role authenticated;
do $$
declare t record;
begin
  select * into t from win where k = 'today';
  perform public.chronicle_goal_mark((select v from ids where k = 'floss'), t.f, t.s, t.e, null, true);
exception when others then insert into fails values ('ticking twice raised', sqlerrm);
end $$;
reset role;
insert into fails select 'a second tick moved the first tick''s moment', done_at::text
from public.chronicle_goal_marks
where goal = (select v from ids where k = 'floss')
  and window_from = (select f from win where k = 'today')
  and done_at is distinct from now() - interval '5 hours';

-- ── B, the refusals — each must raise, and in the room's own words ─────────────────────────
create temp table tries(what text, goal_k text, win_k text, f_shift int, s_shift interval,
                        e_shift interval, want text);
grant select on tries to authenticated, anon;
insert into tries values
  ('a one-off goal',                'once',  'today', 0, '0',        '0',         'no such repeating goal'),
  ('a window that has not begun',   'floss', 'ahead', 0, '0',        '0',         'that window has not started'),
  ('a window ending before it starts','floss','today',0, '0',        '-2 days',   'that window does not make sense'),
  ('a date five days off its instants','floss','today',5,'0',        '0',         'that window does not make sense'),
  ('a window longer than a year',   'floss', 'today', 0, '0',        '400 days',  'that window does not make sense');

set local role authenticated;
do $$
declare t record; w record; got text;
begin
  for t in select * from tries loop
    select * into w from win where k = t.win_k;
    got := null;
    begin
      perform public.chronicle_goal_mark((select v from ids where k = t.goal_k),
                                         w.f + t.f_shift, w.s + t.s_shift, w.e + t.e_shift,
                                         null, true);
    exception when others then got := sqlerrm;
    end;
    if got is distinct from t.want then
      insert into fails values ('refusing ' || t.what, coalesce(got, 'it was accepted'));
    end if;
  end loop;
  -- and a null date, which the table would refuse anyway but the writer should say first
  got := null;
  begin
    select * into w from win where k = 'today';
    perform public.chronicle_goal_mark((select v from ids where k = 'floss'), null, w.s, w.e, null, true);
  exception when others then got := sqlerrm;
  end;
  if got is distinct from 'that window does not make sense' then
    insert into fails values ('refusing a window with no date', coalesce(got, 'it was accepted'));
  end if;
end $$;
reset role;

-- another member, on my goal: refused, and nothing of mine moves
select set_config('request.jwt.claims',
  json_build_object('sub', (select other::text from subject), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare w record; got text;
begin
  insert into ids values
    ('theirs', public.chronicle_goal_save(null, 'Marks: theirs', 'day', null, 1, null, null,
                                          null, null, null, null, 'minutes', null, 0));
  select * into w from win where k = 'today';
  perform public.chronicle_goal_mark((select v from ids where k = 'theirs'), w.f, w.s, w.e, 3, true);
  perform public.chronicle_goal_progress((select v from ids where k = 'theirs'), 0, true);
  begin
    perform public.chronicle_goal_mark((select v from ids where k = 'floss'), w.f, w.s, w.e, null, false);
  exception when others then got := sqlerrm;
  end;
  if got is distinct from 'no such repeating goal' then
    insert into fails values ('another member marking my goal', coalesce(got, 'it was accepted'));
  end if;
exception when others then insert into fails values ('the other member''s setup raised', sqlerrm);
end $$;
reset role;
insert into fails select 'another member''s refused untick still landed', 'today is unticked'
where (select done_at from public.chronicle_goal_marks
        where goal = (select v from ids where k = 'floss')
          and window_from = (select f from win where k = 'today')) is null;

-- a suspended member, refused — set and cleared inside this transaction
update public.profiles set suspended = true where user_id = (select me from subject);
select set_config('request.jwt.claims',
  json_build_object('sub', (select me::text from subject), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare w record; got text;
begin
  select * into w from win where k = 'today';
  begin
    perform public.chronicle_goal_mark((select v from ids where k = 'floss'), w.f, w.s, w.e, null, false);
  exception when others then got := sqlerrm;
  end;
  if got is distinct from 'your account is suspended' then
    insert into fails values ('a suspended member marking', coalesce(got, 'it was accepted'));
  end if;
end $$;
reset role;
update public.profiles set suspended = false where user_id = (select me from subject);

-- ── C. what the reader hands back ──────────────────────────────────────────────────────────
set local role authenticated;
-- ⚠️ a DateStyle that would key every mark 08/11/2026 if the reader used ::text
set local datestyle = 'SQL, DMY';
do $$
declare got jsonb; k_today text; k_yest text; k_str text; k_week text; k_theirs text;
begin
  k_today  := (select v from ids where k = 'floss')::text || '@' || to_char((select f from win where k = 'today'), 'YYYY-MM-DD');
  k_yest   := (select v from ids where k = 'floss')::text || '@' || to_char((select f from win where k = 'yesterday'), 'YYYY-MM-DD');
  k_str    := (select v from ids where k = 'stretch')::text || '@' || to_char((select f from win where k = 'today'), 'YYYY-MM-DD');
  k_week   := (select v from ids where k = 'weekly')::text || '@' || to_char((select f from win where k = 'week'), 'YYYY-MM-DD');
  k_theirs := (select v from ids where k = 'theirs')::text || '@' || to_char((select f from win where k = 'today'), 'YYYY-MM-DD');
  got := public.chronicle_goal_marks_for(jsonb_build_array(
    jsonb_build_object('id', (select v from ids where k = 'floss'),   'from', (select f from win where k = 'today')),
    jsonb_build_object('id', (select v from ids where k = 'floss'),   'from', (select f from win where k = 'yesterday')),
    jsonb_build_object('id', (select v from ids where k = 'stretch'), 'from', (select f from win where k = 'today')),
    jsonb_build_object('id', (select v from ids where k = 'weekly'),  'from', (select f from win where k = 'week')),
    jsonb_build_object('id', (select v from ids where k = 'once'),    'from', (select f from win where k = 'today')),
    jsonb_build_object('id', (select v from ids where k = 'theirs'),  'from', (select f from win where k = 'today'))));

  if got->'marks'->k_today is distinct from '{"done": true, "progress": 0}'::jsonb then
    insert into fails values ('reading today''s tick', coalesce((got->'marks')::text, 'null'));
  end if;
  if got->'marks'->k_yest is distinct from '{"done": false, "progress": 0}'::jsonb then
    insert into fails values ('reading yesterday''s untick', coalesce((got->'marks'->k_yest)::text, 'missing'));
  end if;
  if got->'marks'->k_str is distinct from '{"done": true, "progress": 12}'::jsonb then
    insert into fails values ('reading a count', coalesce((got->'marks'->k_str)::text, 'missing'));
  end if;
  if got->'marks'->k_week is distinct from '{"done": true, "progress": 0}'::jsonb then
    insert into fails values ('reading a weekly tick', coalesce((got->'marks'->k_week)::text, 'missing'));
  end if;
  if got->'marks' ? k_theirs then
    insert into fails values ('the reader handed me another member''s mark', k_theirs);
  end if;
  if (select count(*) from jsonb_object_keys(got->'marks')) <> 4 then
    insert into fails values ('the reader handed back marks nobody asked for',
                              (select string_agg(x, ', ') from jsonb_object_keys(got->'marks') x));
  end if;
  -- legacy: my repeating goal's row tick, and NOT the one-off's, and NOT theirs
  if not (got->'legacy' ? (select v from ids where k = 'floss')::text) then
    insert into fails values ('the row''s old tick was not handed back as legacy', coalesce((got->'legacy')::text, 'null'));
  end if;
  if got->'legacy' ? (select v from ids where k = 'once')::text then
    insert into fails values ('a one-off''s tick came back as legacy', 'it has one window, the row');
  end if;
  if got->'legacy' ? (select v from ids where k = 'theirs')::text then
    insert into fails values ('another member''s tick came back as legacy', 'it is theirs');
  end if;
exception when others then insert into fails values ('reading the marks raised', sqlerrm);
end $$;

-- the scope is part of the key: a weekly goal made daily stops reading its weekly tick
do $$
declare got jsonb;
begin
  perform public.chronicle_goal_save((select v from ids where k = 'weekly'), 'Marks: weekly', 'day',
                                     null, 1, null, null, null, null, null, null, 'minutes', null, 0);
  got := public.chronicle_goal_marks_for(jsonb_build_array(
    jsonb_build_object('id', (select v from ids where k = 'weekly'), 'from', (select f from win where k = 'week'))));
  if got->'marks' <> '{}'::jsonb then
    insert into fails values ('a weekly tick read as a daily one after the scope changed', (got->'marks')::text);
  end if;
exception when others then insert into fails values ('the scope change raised', sqlerrm);
end $$;
reset datestyle;
reset role;

-- ── D. the export carries every field, and the import puts each one back ───────────────────
/* every field of the mark under test away from its default: a count, a tick moved back by hand,
   a set_at three days old — so a field the round trip drops has somewhere to show it */
update public.chronicle_goal_marks
   set done_at = now() - interval '2 hours', set_at = now() - interval '3 days'
 where goal = (select v from ids where k = 'stretch');

create temp table docs(k text primary key, d jsonb);
grant select, insert, update on docs to authenticated, anon;

set local role authenticated;
do $$
begin
  insert into docs values ('orig', public.chronicle_export());
end $$;
reset role;

create temp view orig_marks as
  select g->'marks' as m
    from docs, jsonb_array_elements(d->'goals') g
   where k = 'orig' and (g->>'id')::uuid = (select v from ids where k = 'stretch');
grant select on orig_marks to authenticated, anon;

insert into fails select 'the export does not carry the mark',
       coalesce((select m::text from orig_marks), 'no goal in the file')
where coalesce(jsonb_array_length((select m from orig_marks)), 0) <> 1;
insert into fails select 'the export''s mark is missing a field', f
from (values ('scope'), ('from'), ('starts_at'), ('ends_at'), ('progress'), ('done_at'), ('set_at')) fs(f)
where not ((select m->0 from orig_marks) ? f);

/* drop the marks, put the file back, export again: identical — then once per field, with that one
   field taken out of the file, and the result must DIFFER, or the field is not really carried */
create temp table trips(field text);
insert into trips values (null), ('scope'), ('from'), ('starts_at'), ('ends_at'), ('progress'),
                         ('done_at'), ('set_at');
grant select on trips to authenticated, anon;

do $$
declare t record; doc jsonb; back jsonb; res jsonb;
begin
  for t in select * from trips loop
    delete from public.chronicle_goal_marks where goal = (select v from ids where k = 'stretch');
    doc := (select d from docs where k = 'orig');
    if t.field is not null then
      doc := jsonb_set(doc, '{goals}', (
        select jsonb_agg(case when (g->>'id')::uuid = (select v from ids where k = 'stretch')
                              then jsonb_set(g, '{marks}', (select jsonb_agg(mm - t.field)
                                                              from jsonb_array_elements(g->'marks') mm))
                              else g end)
          from jsonb_array_elements(doc->'goals') g));
    end if;
    perform set_config('role', 'authenticated', true);
    res := public.chronicle_import(doc);
    back := (select g->'marks' from jsonb_array_elements(public.chronicle_export()->'goals') g
              where (g->>'id')::uuid = (select v from ids where k = 'stretch'));
    perform set_config('role', 'postgres', true);
    if t.field is null then
      if back is distinct from (select m from orig_marks) then
        insert into fails values ('the round trip changed the mark', coalesce(back::text, 'null'));
      end if;
      if (res->>'marks')::int is distinct from 1 then
        insert into fails values ('the import did not count the mark it put back', res::text);
      end if;
    elsif back is not distinct from (select m from orig_marks) then
      insert into fails values ('the import does not really carry ' || t.field,
                                'dropping it from the file changed nothing');
    end if;
  end loop;
exception when others then insert into fails values ('the round trip raised', sqlerrm);
end $$;
reset role;

-- a tampered file: somebody else's goal id, a one-off, and a window that has not begun
do $$
declare doc jsonb; res jsonb; w record; theirs_before int; once_before int; ahead_before int;
begin
  select * into w from win where k = 'ahead';
  theirs_before := (select count(*) from public.chronicle_goal_marks where goal = (select v from ids where k = 'theirs'));
  once_before   := (select count(*) from public.chronicle_goal_marks where goal = (select v from ids where k = 'once'));
  ahead_before  := (select count(*) from public.chronicle_goal_marks where window_from = w.f);
  doc := jsonb_build_object('kind', 'chronicle', 'version', 1, 'goals', jsonb_build_array(
    jsonb_build_object('id', (select v from ids where k = 'theirs'), 'title', 'not mine', 'scope', 'day',
                       'repeat_every', 1, 'marks', jsonb_build_array(jsonb_build_object(
                         'scope', 'day', 'from', (select f from win where k = 'yesterday'),
                         'starts_at', (select s from win where k = 'yesterday'),
                         'ends_at', (select e from win where k = 'yesterday'),
                         'progress', 99, 'done_at', now()))),
    jsonb_build_object('id', (select v from ids where k = 'once'), 'title', 'Marks: once', 'scope', 'day',
                       'anchor', (select f from win where k = 'today'),
                       'marks', jsonb_build_array(jsonb_build_object(
                         'scope', 'day', 'from', (select f from win where k = 'today'),
                         'starts_at', (select s from win where k = 'today'),
                         'ends_at', (select e from win where k = 'today'), 'done_at', now()))),
    jsonb_build_object('id', (select v from ids where k = 'stretch'), 'title', 'Marks: stretch', 'scope', 'day',
                       'repeat_every', 1, 'target', 20, 'unit', 'minutes',
                       'marks', jsonb_build_array(jsonb_build_object(
                         'scope', 'day', 'from', w.f, 'starts_at', w.s, 'ends_at', w.e,
                         'done_at', now())))));
  perform set_config('role', 'authenticated', true);
  res := public.chronicle_import(doc);
  perform set_config('role', 'postgres', true);
  if (select count(*) from public.chronicle_goal_marks where goal = (select v from ids where k = 'theirs')) <> theirs_before then
    insert into fails values ('a file reached another member''s goal', res::text);
  end if;
  if (select count(*) from public.chronicle_goal_marks where goal = (select v from ids where k = 'once')) <> once_before then
    insert into fails values ('a file put a mark on a one-off', res::text);
  end if;
  if (select count(*) from public.chronicle_goal_marks where window_from = w.f) <> ahead_before then
    insert into fails values ('a file ticked a window that has not begun', res::text);
  end if;
  if coalesce((res->>'marks')::int, -1) <> 0 then
    insert into fails values ('the tampered file was counted as putting marks back', res::text);
  end if;
exception when others then insert into fails values ('the tampered import raised', sqlerrm);
end $$;
reset role;

-- deleting a goal takes its marks with it
set local role authenticated;
do $$
begin
  perform public.chronicle_goal_drop((select v from ids where k = 'floss'));
exception when others then insert into fails values ('dropping a goal raised', sqlerrm);
end $$;
reset role;
insert into fails select 'a dropped goal''s marks stayed behind', count(*)::text
from public.chronicle_goal_marks where goal = (select v from ids where k = 'floss')
having count(*) > 0;

-- ── E. the profile: how THIS window went ───────────────────────────────────────────────────
/* only E's goals, so the counts are about exactly them; one chronicle block that asks for goals */
delete from public.chronicle_goals where owner = (select me from subject);
delete from public.profile_blocks where user_id = (select me from subject) and block_type = 'chronicle';
insert into public.profile_blocks (user_id, block_type, position, config, visibility)
values ((select me from subject), 'chronicle', 0, '{"goals": true}', 'members');

set local role authenticated;
do $$
declare w record;
begin
  insert into ids values
    ('p_stale', public.chronicle_goal_save(null, 'P: ticked yesterday', 'day', null, 1, null, null,
                                           null, 1, null, null, 'minutes', null, 0)),
    ('p_now',   public.chronicle_goal_save(null, 'P: ticked today', 'day', null, 1, null, null,
                                           null, 2, null, null, 'minutes', null, 0)),
    /* ⚠️ A SECOND "TICKED TODAY", AND THE COUNTS DEPEND ON IT. With one, the right answer is
       reached 2 / open 1 — and so is the OLD reader's, which counts the stale row tick as reached
       and today's mark as open: a check that agrees with the bug it is for. Two separate them. */
    ('p_now2',  public.chronicle_goal_save(null, 'P: also ticked today', 'day', null, 1, null, null,
                                           null, 4, null, null, 'minutes', null, 0)),
    ('p_once',  public.chronicle_goal_save(null, 'P: one-off, done', 'day',
                                           (select f from win where k = 'today'), null, null, null,
                                           null, 3, null, null, 'minutes', null, 0));
  -- the stale one carries the OLD room's row tick too, which is what kept it ✓ for ever
  perform public.chronicle_goal_progress((select v from ids where k = 'p_stale'), 0, true);
  select * into w from win where k = 'yesterday';
  perform public.chronicle_goal_mark((select v from ids where k = 'p_stale'), w.f, w.s, w.e, null, true);
  select * into w from win where k = 'today';
  perform public.chronicle_goal_mark((select v from ids where k = 'p_now'), w.f, w.s, w.e, null, true);
  perform public.chronicle_goal_mark((select v from ids where k = 'p_now2'), w.f, w.s, w.e, null, true);
  perform public.chronicle_goal_progress((select v from ids where k = 'p_once'), 0, true);
exception when others then insert into fails values ('the profile''s goals raised', sqlerrm);
end $$;

do $$
declare card jsonb; g jsonb;
begin
  card := public.get_member_chronicle(
            (select username::text from public.profiles where user_id = (select me from subject)), 7);
  if card is null then
    insert into fails values ('the profile card came back empty', 'the block or the reader');
    return;
  end if;
  for g in select * from jsonb_array_elements(card->'goals') loop
    if (g->>'title' = 'P: ticked yesterday' and (g->>'done')::boolean)
       or (g->>'title' like 'P: %ticked today' and not (g->>'done')::boolean)
       or (g->>'title' = 'P: one-off, done' and not (g->>'done')::boolean) then
      insert into fails values ('the profile says the wrong thing about ' || (g->>'title'), g::text);
    end if;
  end loop;
  if jsonb_array_length(card->'goals') <> 4 then
    insert into fails values ('the profile lists the wrong goals', (card->'goals')::text);
  end if;
  if (card->>'reached')::int <> 3 or (card->>'open')::int <> 1 then
    insert into fails values ('the profile counts the wrong way',
                              'reached ' || (card->>'reached') || ', open ' || (card->>'open'));
  end if;
exception when others then insert into fails values ('reading the profile raised', sqlerrm);
end $$;
reset role;

-- ── the verdict ─────────────────────────────────────────────────────────────────────────────
do $$
declare n int; msg text;
begin
  select count(*), string_agg('  - ' || check_name || ': ' || detail, E'\n')
    into n, msg from fails;
  if n > 0 then
    raise exception E'CHRONICLE MARKS FAILED -- % check(s):\n%', n, msg;
  end if;
end $$;

select 'repeating goals keep one mark per window' as result, count(*) as failures from fails;

rollback;
