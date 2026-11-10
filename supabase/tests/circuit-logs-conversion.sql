-- Converting an already-linked person's typed cells from circuit_logs to sets — asked of the real
-- functions, against FIXTURES ONLY, in a throwaway database.
--
-- ⛔ NEEDS FOUR DRAFTS APPLIED FIRST, in order, and refuses to run otherwise:
--      docs/2026-11-08-chronicle-sets.DRAFT.sql
--      docs/2026-11-09-chronicle-sets-links.DRAFT.sql
--      docs/2026-11-09-circuit-grid-sessions.DRAFT.sql
--      docs/2026-11-09-circuit-logs-conversion.DRAFT.sql
-- The conversion is a proposal (OPEN-DECISIONS §19g(3)) and is not approved to run on anybody's
-- real logs. This rolls back. NEVER against production.
--
-- WHAT IT ASKS, section by section:
--   A  the marker table is deny-all; no member can run or ask about a conversion
--   B  a person no account owns is refused (claiming is separate), and an unknown person
--   C  a dry run reports and writes nothing
--   D  one entry that cannot become a set stops the whole person: reported with its log and
--      position, nothing written, no marker, the logs untouched
--   D2 so does a set the grid has never counted (no sitting, no source), reported by its id; taking
--      it back lets the person convert. And a set written DURING a run fails the reconciliation
--   E  a real run: one set per entry with its source, the logs byte for byte as they were,
--      every cell reconciled, the marker set
--   F  a re-run adds nothing, with the marker and without it
--   G  the readers switch at the marker: the workout line, the grid's manual part, the goals,
--      and a typed cell — nothing read twice, nothing dropped, `__total__` days still read in place
--   H  a file made before a cell was retyped does not put the pieces it replaced back (§20e)
-- On failure it raises, naming every check that failed. A green run prints one row.

begin;

create temp table fails(check_name text, detail text);
create temp table subject as
  with m as (select p.user_id as me from public.profiles p where coalesce(p.suspended, false) = false
              order by p.username limit 1)
  select m.me,
         (select p.user_id from public.profiles p
           where coalesce(p.suspended, false) = false and p.user_id <> m.me
             and not exists (select 1 from public.admin_users a where a.user_id = p.user_id)
           order by p.username limit 1) as other
    from m;
create temp table t as select (now() at time zone 'utc')::date as today,
                              (date_trunc('day', now() at time zone 'utc') at time zone 'utc') as t0;
create temp table seen(k text primary key, v jsonb);
create temp table ids(k text primary key, v uuid);
grant select on subject, t to authenticated, anon;
grant select, insert on fails to authenticated, anon;
grant select, insert, update on seen, ids to authenticated, anon;

do $$
begin
  if to_regprocedure('public.circuit_convert_person(text, boolean)') is null
     or to_regprocedure('public.circuit_cell_set(text, text, date, numeric, numeric, numeric)') is null then
    raise exception 'apply the sets, links, grid and conversion drafts before this file';
  end if;
end $$;
insert into fails select 'FIXTURE: no second member who is not an admin', ''
where (select other from subject) is null;

/* the fixtures: one of mine with five days of logs — two rows on one day, an empty cell, an
   imported total — one of mine with an exercise that has gone from its list, and one nobody owns */
insert into public.circuit_people (id, name, exercises, owner_user_id) values
  ('cv-mine', 'Convert: mine',
   '[{"id":"ex-quad","name":"Quad Curl","unit":"reps","mult":1,"col":0,"row":0},
     {"id":"ex-bench","name":"Bench","unit":"reps","mult":2,"col":0,"row":1}]',
   (select me from subject)),
  ('cv-gone', 'Convert: gone',
   '[{"id":"ex-quad","name":"Quad Curl","unit":"reps","mult":1,"col":0,"row":0}]',
   (select me from subject)),
  ('cv-nobody', 'Convert: nobody',
   '[{"id":"ex-quad","name":"Quad Curl","unit":"reps","mult":1,"col":0,"row":0}]', null);
insert into public.circuit_logs (id, person_id, date, entries) values
  ('cv-l1', 'cv-mine', (select today from t) - 5, '[{"eid":"ex-quad","val":10},{"eid":"ex-bench","val":4}]'),
  ('cv-l2a', 'cv-mine', (select today from t) - 3, '[{"eid":"ex-quad","val":7}]'),
  ('cv-l2b', 'cv-mine', (select today from t) - 3, '[{"eid":"ex-quad","val":3},{"eid":"ex-bench","val":0}]'),
  ('cv-l3', 'cv-mine', (select today from t) - 2, '[{"eid":"__total__","val":50}]'),
  ('cv-g1', 'cv-gone', (select today from t) - 4, '[{"eid":"ex-quad","val":2},{"eid":"ex-old","val":5}]'),
  ('cv-n1', 'cv-nobody', (select today from t) - 4, '[{"eid":"ex-quad","val":9}]');
create temp table logs_before as
  select id, md5(entries::text) as h from public.circuit_logs where person_id in ('cv-mine', 'cv-gone', 'cv-nobody');

-- ── A ───────────────────────────────────────────────────────────────────────────────────────
insert into fails select 'the marker table grants ' || pv || ' to ' || r, ''
from (values ('anon'), ('authenticated')) rs(r),
     (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) ps(pv)
where has_table_privilege(r, 'public.circuit_people_converted', pv);
insert into fails select 'a role can run or ask about a conversion: ' || r, f
from (values ('anon'), ('authenticated')) rs(r),
     (values ('public.circuit_convert_person(text, boolean)'), ('public.circuit_is_converted(text)')) fs(f)
where has_function_privilege(r, f, 'execute');

-- ── B ───────────────────────────────────────────────────────────────────────────────────────
do $$
declare got text; got2 text;
begin
  begin perform public.circuit_convert_person('cv-nobody', true); exception when others then got := sqlerrm; end;
  begin perform public.circuit_convert_person('cv-none', true); exception when others then got2 := sqlerrm; end;
  if got is distinct from 'only a person linked to an account is converted — claiming is a separate step' then
    insert into fails values ('converting a person nobody owns', coalesce(got, 'it ran'));
  end if;
  if got2 is distinct from 'no such person' then
    insert into fails values ('converting a person that does not exist', coalesce(got2, 'it ran'));
  end if;
end $$;

-- ── C. a dry run ────────────────────────────────────────────────────────────────────────────
insert into seen values ('dry', public.circuit_convert_person('cv-mine', false));
insert into fails select 'the dry run''s report', (select v::text from seen where k = 'dry')
where (select v - 'person' from seen where k = 'dry') is distinct from
      '{"cells": 4, "total": 24, "kept_totals": 1, "empty": 1, "problems": [], "days": 2, "applied": false}'::jsonb;
insert into fails select 'a dry run wrote something', count(*)::text
from public.chronicle_sets where person_id = 'cv-mine' having count(*) > 0;
insert into fails select 'a dry run set the marker', '' where public.circuit_is_converted('cv-mine');

-- ── D. one entry that cannot become a set stops the person ─────────────────────────────────
insert into seen values ('gone', public.circuit_convert_person('cv-gone', true));
insert into fails select 'the report of an exercise that has gone', (select v::text from seen where k = 'gone')
where (select jsonb_build_array(v->'applied', v->'cells', v->'problems'->0->'log', v->'problems'->0->'index',
                                v->'problems'->0->'eid')
         from seen where k = 'gone')
      is distinct from '[false, 1, "cv-g1", 2, "ex-old"]'::jsonb;
insert into fails select 'a stopped person still got sets or a marker', ''
where exists (select 1 from public.chronicle_sets where person_id = 'cv-gone')
   or public.circuit_is_converted('cv-gone');

-- ── D2. a set the grid has never counted stops the person too ─────────────────────────────
/* ⚠️ A FIXTURE THAT HOLDS NOTHING STILL. Every other person here starts with no sets, so the
   reconciliation could only ever compare the logs with what it had just written. This one already
   holds a set with no sitting, made the way the API allows, on a day with no log. The grid has never
   counted it, and after the switch it would. */
insert into public.circuit_people (id, name, exercises, owner_user_id) values
  ('cv-stray', 'Convert: stray', '[{"id":"ex-quad","name":"Quad Curl","unit":"reps","mult":1,"col":0,"row":0}]',
   (select me from subject)),
  ('cv-race', 'Convert: race', '[{"id":"ex-quad","name":"Quad Curl","unit":"reps","mult":1,"col":0,"row":0}]',
   (select me from subject));
insert into public.circuit_logs (id, person_id, date, entries) values
  ('cv-s1', 'cv-stray', (select today from t) - 4, '[{"eid":"ex-quad","val":6}]'),
  ('cv-r1', 'cv-race', (select today from t) - 4, '[{"eid":"ex-quad","val":8}]');
select set_config('request.jwt.claims',
  json_build_object('sub', (select me::text from subject), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  insert into ids values ('stray', public.chronicle_set_add('cv-stray', 'ex-quad', 5, (select today from t) - 1, null));
exception when others then insert into fails values ('making a set with no sitting raised', sqlerrm);
end $$;
reset role;
insert into seen values ('stray-dry', public.circuit_convert_person('cv-stray', false));
insert into seen values ('stray', public.circuit_convert_person('cv-stray', true));
insert into fails select 'the report of a set the grid never counted', (select v::text from seen where k = 'stray')
where (select jsonb_build_array(v->'applied', v->'cells', jsonb_array_length(v->'problems'),
                                v->'problems'->0->>'set', v->'problems'->0->>'on',
                                (v->'problems'->0->>'val')::numeric)
         from seen where k = 'stray')
      is distinct from jsonb_build_array(false, 1, 1, (select v::text from ids where k = 'stray'),
                                         to_char((select today from t) - 1, 'YYYY-MM-DD'), 5);
insert into fails select 'the dry run and the real run disagree about it', (select v::text from seen where k = 'stray-dry')
where (select v from seen where k = 'stray-dry') is distinct from (select v from seen where k = 'stray');
insert into fails select 'a person stopped by a stray set still got sets or a marker', ''
where exists (select 1 from public.chronicle_sets where person_id = 'cv-stray' and source_log is not null)
   or public.circuit_is_converted('cv-stray');
/* the way out the report points at: its owner takes the set back, and the person converts */
set local role authenticated;
do $$ begin perform public.chronicle_set_drop((select v from ids where k = 'stray'));
exception when others then insert into fails values ('taking the stray set back raised', sqlerrm);
end $$;
reset role;
insert into seen values ('stray-after', public.circuit_convert_person('cv-stray', true));
insert into fails select 'converting once the stray set was taken back', (select v::text from seen where k = 'stray-after')
where (select jsonb_build_array(v->'applied', v->'inserted', jsonb_array_length(v->'problems'))
         from seen where k = 'stray-after')
      is distinct from '[true, 1, 0]'::jsonb;

/* ⚠️ AND A SET WRITTEN IN BETWEEN. The scan runs before the insert, so only the reconciliation can
   notice one that arrives after it. A trigger stands in for the other writer: it adds a set with no
   sitting to the same cell the moment this run writes its own. This file rolls back, and drops it. */
create function public.cv_race_test() returns trigger language plpgsql as $f$
begin
  insert into public.chronicle_sets (owner, person_id, exercise_id, exercise_name, entry, on_day, value)
  values (new.owner, new.person_id, new.exercise_id, new.exercise_name, null, new.on_day, 1);
  return null;
end $f$;
create trigger cv_race_test after insert on public.chronicle_sets
  for each row when (new.source_log = 'cv-r1') execute function public.cv_race_test();
do $$
declare got text;
begin
  begin perform public.circuit_convert_person('cv-race', true); exception when others then got := sqlerrm; end;
  if got is distinct from 'conversion of cv-race does not reconcile in 1 cells — nothing was changed' then
    insert into fails values ('a set written during the run', coalesce(got, 'it was converted'));
  end if;
end $$;
drop trigger cv_race_test on public.chronicle_sets;
drop function public.cv_race_test();
insert into fails select 'a run that did not reconcile still left sets or a marker', ''
where exists (select 1 from public.chronicle_sets where person_id = 'cv-race')
   or public.circuit_is_converted('cv-race');

-- ── E. a real run ───────────────────────────────────────────────────────────────────────────
insert into seen values ('real', public.circuit_convert_person('cv-mine', true));
insert into fails select 'the real run''s report', (select v::text from seen where k = 'real')
where (select jsonb_build_array(v->'applied', v->'inserted', v->'cells') from seen where k = 'real')
      is distinct from '[true, 4, 4]'::jsonb;
insert into fails select 'the sets the run made', string_agg(source_log || '#' || source_index || '=' || exercise_id || ':' || value, ', ' order by source_log, source_index)
from public.chronicle_sets where person_id = 'cv-mine'
having string_agg(source_log || '#' || source_index || '=' || exercise_id || ':' || value || ':' || (entry is null) || ':' || exercise_name, ', ' order by source_log, source_index)
       is distinct from 'cv-l1#1=ex-quad:10:true:Quad Curl, cv-l1#2=ex-bench:4:true:Bench, cv-l2a#1=ex-quad:7:true:Quad Curl, cv-l2b#1=ex-quad:3:true:Quad Curl';
insert into fails select 'the conversion changed a log', b.id
from logs_before b join public.circuit_logs l on l.id = b.id where md5(l.entries::text) <> b.h;
insert into fails select 'the marker is not set after a real run', '' where not public.circuit_is_converted('cv-mine');

-- ── F. a re-run adds nothing ────────────────────────────────────────────────────────────────
insert into seen values ('again', public.circuit_convert_person('cv-mine', true));
insert into fails select 'a re-run with the marker', (select v::text from seen where k = 'again')
where (select v->'already' from seen where k = 'again') is distinct from 'true'::jsonb;
delete from public.circuit_people_converted where person_id = 'cv-mine';
insert into seen values ('without', public.circuit_convert_person('cv-mine', true));
insert into fails select 'a re-run without the marker', (select v::text from seen where k = 'without')
where (select jsonb_build_array(v->'applied', v->'inserted') from seen where k = 'without') is distinct from '[true, 0]'::jsonb
   or (select count(*) from public.chronicle_sets where person_id = 'cv-mine') <> 4;

-- ── G. the readers switch at the marker ────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', (select me::text from subject), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare a uuid; e uuid; g uuid;
begin
  a := public.chronicle_activity_save(null, 'Convert: gym', 'free', null, 'reps', null);
  perform public.chronicle_exercise_link('cv-mine', 'ex-quad', a);
  -- a session on the day with two rows, so the cell there has both halves
  e := public.chronicle_entry_add(a, (select t0 from t) - interval '62 hours', (select t0 from t) - interval '61 hours', null);
  perform public.chronicle_set_add('cv-mine', 'ex-quad', 12, (select today from t) - 3, e);
  insert into seen values
    ('moments', public.chronicle_moments((select t0 from t) - interval '6 days', (select t0 from t))),
    ('manual', public.circuit_manual_sums((select today from t) - 7, (select today from t))),
    ('sessions', public.circuit_session_sums((select today from t) - 7, (select today from t)));
  g := public.chronicle_goal_save(null, 'Convert: reps', 'month', null, 1, 500, 'reps',
                                  null, null, a, null, 'amount', null, 0);
  insert into seen values ('tally', public.chronicle_tally(jsonb_build_array(jsonb_build_object(
    'key', 'w', 'id', g, 'from', (select t0 from t) - interval '7 days', 'to', (select t0 from t),
    'from_day', (select today from t) - 7, 'to_day', (select today from t)))));
  -- the file H restores: made now, before the cell below is typed
  insert into seen values ('doc', public.chronicle_export());
exception when others then insert into fails values ('reading after the switch raised', sqlerrm);
end $$;
reset role;
insert into fails select 'the workout line after the switch', (select v::text from seen where k = 'moments')
where (select jsonb_agg(jsonb_build_array(x->>'on', x->>'title') order by x->>'on')
         from seen, jsonb_array_elements(v) x
        where k = 'moments' and x->>'kind' = 'workout' and x->>'about' = 'Convert: mine')
      is distinct from jsonb_build_array(
        jsonb_build_array(((select today from t) - 5)::text, 'Bench 4 reps · Quad Curl 10 reps'),
        jsonb_build_array(((select today from t) - 3)::text, 'Quad Curl 10 reps'),
        jsonb_build_array(((select today from t) - 2)::text, 'something 50'));
insert into fails select 'the grid''s manual part after the switch', (select v::text from seen where k = 'manual')
where (select jsonb_build_array(v->'converted',
         (select jsonb_agg(jsonb_build_array(m->>'on', m->>'exercise', (m->>'value')::numeric) order by m->>'on', m->>'exercise')
            from jsonb_array_elements(v->'manual') m where m->>'person' = 'cv-mine'))
         from seen where k = 'manual')
      is distinct from jsonb_build_array(jsonb_build_array('cv-mine', 'cv-stray'), jsonb_build_array(
        jsonb_build_array(to_char((select today from t) - 5, 'YYYY-MM-DD'), 'ex-bench', 4),
        jsonb_build_array(to_char((select today from t) - 5, 'YYYY-MM-DD'), 'ex-quad', 10),
        jsonb_build_array(to_char((select today from t) - 3, 'YYYY-MM-DD'), 'ex-quad', 10)));
/* the goal: the sitting's 12 (counted, in its amount) and Quad Curl's typed 10 and 10 — read from
   the sets now, NOT also from the logs that still hold them */
insert into fails select 'a goal after the switch', (select v::text from seen where k = 'tally')
where ((select v from seen where k = 'tally')->>'w')::numeric is distinct from 32;

/* a typed cell after the switch: one manual set replaces the two converted ones; the logs stay */
set local role authenticated;
do $$
declare got text;
begin
  perform public.circuit_cell_set('cv-mine', 'ex-quad', (select today from t) - 3, 30, 12, 10);
  begin perform public.circuit_cell_set('cv-mine', 'ex-quad', (select today from t) - 3, 30, 12, 10);
  exception when others then got := sqlerrm; end;
  if got is distinct from 'that day changed while you were typing — it is now 30 (12 from sessions)' then
    insert into fails values ('a stale save after the switch', coalesce(got, 'it was accepted'));
  end if;
exception when others then insert into fails values ('typing after the switch raised', sqlerrm);
end $$;
reset role;
insert into fails select 'a typed cell after the switch', string_agg(value || ':' || coalesce(source_log, '-'), ', ')
from public.chronicle_sets
where person_id = 'cv-mine' and exercise_id = 'ex-quad' and on_day = (select today from t) - 3 and entry is null
having string_agg(value || ':' || coalesce(source_log, '-'), ', ') is distinct from '18:-';
insert into fails select 'typing after the switch changed a log', b.id
from logs_before b join public.circuit_logs l on l.id = b.id where md5(l.entries::text) <> b.h;

/* another member, in no circuit with this person, sees none of its manual part */
select set_config('request.jwt.claims',
  json_build_object('sub', (select other::text from subject), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  insert into seen values ('theirs', public.circuit_manual_sums((select today from t) - 7, (select today from t)));
end $$;
reset role;
insert into fails select 'another member sees a converted person''s cells', (select v::text from seen where k = 'theirs')
where (select v from seen where k = 'theirs') <> '{"converted": [], "manual": []}'::jsonb;

-- ── H. a restore after a retype ────────────────────────────────────────────────────────────
/* the file was made in G before the cell was typed, so it still holds the two converted sets the
   typing replaced (7 and 3). Import matches by id and the typed set is a new one, so without the
   rule the cell would read 18 + 7 + 3. */
select set_config('request.jwt.claims',
  json_build_object('sub', (select me::text from subject), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  insert into seen values ('restore', public.chronicle_import((select v from seen where k = 'doc')));
  insert into seen values ('after-restore', public.circuit_manual_sums((select today from t) - 7, (select today from t)));
exception when others then insert into fails values ('restoring after the switch raised', sqlerrm);
end $$;
reset role;
insert into fails select 'the file''s doc has no converted sets to offer, so H proves nothing', ''
where not exists (select 1 from seen, jsonb_array_elements(v->'sets') x
                   where k = 'doc' and x->>'person' = 'cv-mine' and x->>'entry' is null
                     and x->>'on_day' = to_char((select today from t) - 3, 'YYYY-MM-DD'));
insert into fails select 'a restore put a retyped cell''s old pieces back', (select v::text from seen where k = 'after-restore')
where (select jsonb_agg(m->'value') from seen, jsonb_array_elements(v->'manual') m
        where k = 'after-restore' and m->>'person' = 'cv-mine' and m->>'exercise' = 'ex-quad'
          and m->>'on' = to_char((select today from t) - 3, 'YYYY-MM-DD'))
      is distinct from '[18]'::jsonb;
insert into fails select 'a restore wrote a set with no sitting for a converted person', (select v::text from seen where k = 'restore')
where ((select v from seen where k = 'restore')->>'sets')::int <> 0;

-- ── the verdict ─────────────────────────────────────────────────────────────────────────────
do $$
declare n int; msg text;
begin
  select count(*), string_agg('  - ' || check_name || ': ' || coalesce(detail, ''), E'\n') into n, msg from fails;
  if n > 0 then raise exception E'CIRCUIT LOG CONVERSION FAILED -- % check(s):\n%', n, msg; end if;
end $$;

select 'a linked person''s cells convert once, reconciled, and the readers switch together' as result, count(*) as failures from fails;

rollback;
