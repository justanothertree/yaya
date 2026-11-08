-- One canonical set — an exercise's quantity on a day — asked of the real functions as seeded
-- members.
--
-- ⛔ NEEDS THE DRAFT APPLIED FIRST, and refuses to run otherwise:
--      docs/2026-11-08-chronicle-sets.DRAFT.sql
-- It is not applied to production. This file runs only where a throwaway database has been built
-- from the migrations and seed — the `db guards` CI job — and it rolls back. NEVER against
-- production: it writes rows, edits a person's exercise list and suspends a member.
--
-- WHAT IT ASKS, section by section:
--   0  the draft is applied and there are two members to act as
--   A  the table is deny-all to every role and every privilege, TRUNCATE included; anon has no door
--   B  a set is written for your own person and exercise, with or without a sitting — and eleven
--      refusals, each in its own words: nobody's person, an unclaimed one, a stranger's sitting,
--      the wrong day, no number, and the rest
--   C  the name is a SNAPSHOT (§15b): rename the exercise and the set reads by the new name with
--      the old one kept; delete it and the old name stays; re-make one with the same name and the
--      set does NOT reattach to it
--   D  a correction is one row: change and drop, and another member can do neither
--   E  a sitting's start moved across a day moves its sets' day IN THE SAME CALL (§15c) — and a
--      refusal moves neither; a move to another activity moves no set; a running sitting too
--   F  deleting the sitting deletes its sets; deleting the person keeps them, unattached
--   G  the reader: yours only, half-open, ISO whatever the DateStyle
--   H  the export carries every field and the import puts each back — dropped one at a time — and
--      a tampered file reaches nobody's sitting and attaches to nobody's person
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
/* today's UTC midnight, and days counted from it — the writer's day bound is written in UTC */
create temp table t as
  select (date_trunc('day', now() at time zone 'utc') at time zone 'utc') as t0,
         (now() at time zone 'utc')::date as today;
grant select on subject, t to authenticated, anon;
grant select, insert on fails to authenticated, anon;
grant select, insert, update on ids to authenticated, anon;

-- ── 0. THE DRAFT MUST BE APPLIED, OR EVERY CHECK BELOW IS ABOUT NOTHING ──────────────────────
do $$
begin
  if to_regclass('public.chronicle_sets') is null
     or to_regprocedure('public.chronicle_set_add(text, text, numeric, date, uuid)') is null
     or to_regprocedure('public.chronicle_entry_edit_day(uuid, timestamptz, timestamptz, uuid, date)') is null then
    raise exception 'apply docs/2026-11-08-chronicle-sets.DRAFT.sql before this file';
  end if;
end $$;

insert into fails select 'FIXTURE: no member to act as', 'seed the database first'
where (select me from subject) is null;
insert into fails select 'FIXTURE: no second member', 'the refusals below would ask nobody'
where (select other from subject) is null or (select other from subject) = (select me from subject);

/* three people: mine, the other member's, and one that belongs to no login — the shape §15d is
   about. Every exercise list is the Circuit's real blob shape. */
insert into public.circuit_people (id, name, exercises, owner_user_id) values
  ('sets-mine', 'Sets: mine',
   '[{"id":"ex-quad","name":"Quad Curl","unit":"reps","mult":1,"col":0,"row":0},
     {"id":"ex-bench","name":"Bench","unit":"reps","mult":2,"col":0,"row":1}]',
   (select me from subject)),
  ('sets-theirs', 'Sets: theirs',
   '[{"id":"ex-quad","name":"Quad Curl","unit":"reps","mult":1,"col":0,"row":0}]',
   (select other from subject)),
  ('sets-nobody', 'Sets: nobody',
   '[{"id":"ex-quad","name":"Quad Curl","unit":"reps","mult":1,"col":0,"row":0}]',
   null);

-- ── A. deny-all, by privilege, and no door for anon ────────────────────────────────────────
insert into fails
select 'the sets table grants ' || pv || ' to ' || r, 'it should be reached only by functions'
from (values ('anon'), ('authenticated')) rs(r),
     (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'),
             ('TRIGGER')) ps(pv)
where has_table_privilege(r, 'public.chronicle_sets', pv);
insert into fails select 'row level security is off on the sets table', 'deny-all needs it on'
where not (select relrowsecurity from pg_class where oid = 'public.chronicle_sets'::regclass);
create temp table fns as select * from (values
  ('public.chronicle_set_add(text, text, numeric, date, uuid)'),
  ('public.chronicle_set_change(uuid, numeric)'),
  ('public.chronicle_set_drop(uuid)'),
  ('public.chronicle_sets_between(date, date)'),
  ('public.chronicle_entry_edit_day(uuid, timestamptz, timestamptz, uuid, date)'),
  ('public.chronicle_running_fix_day(timestamptz, uuid, date)')) v(f);
insert into fails select 'anon can execute', f from fns where has_function_privilege('anon', f, 'execute');
insert into fails select 'a member cannot execute', f from fns where not has_function_privilege('authenticated', f, 'execute');

-- ── B. as the member: sets written, and the refusals ───────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', (select other::text from subject), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare a uuid;
begin
  a := public.chronicle_activity_save(null, 'Sets: their gym', 'free', null, 'reps', null);
  insert into ids values ('their_entry', public.chronicle_entry_add(a,
    (select t0 from t) - interval '14 hours', (select t0 from t) - interval '13 hours', null));
exception when others then insert into fails values ('the other member''s sitting raised', sqlerrm);
end $$;
reset role;

select set_config('request.jwt.claims',
  json_build_object('sub', (select me::text from subject), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare a uuid; d uuid;
begin
  a := public.chronicle_activity_save(null, 'Sets: gym', 'free', null, 'reps', null);
  d := public.chronicle_activity_save(null, 'Sets: drawing', 'locked', null, null, null);
  insert into ids values ('gym', a), ('drawing', d);
  -- a sitting yesterday (UTC), 10:00 to 11:00, and two sets counted during it
  insert into ids values ('entry', public.chronicle_entry_add(a,
    (select t0 from t) - interval '14 hours', (select t0 from t) - interval '13 hours', null));
  insert into ids values
    ('quad', public.chronicle_set_add('sets-mine', 'ex-quad', 12, (select today from t) - 1,
                                      (select v from ids where k = 'entry'))),
    ('bench', public.chronicle_set_add('sets-mine', 'ex-bench', 8, (select today from t) - 1,
                                       (select v from ids where k = 'entry'))),
    -- and one typed into the grid today, with no sitting at all
    ('grid', public.chronicle_set_add('sets-mine', 'ex-quad', 20, (select today from t)));
exception when others then insert into fails values ('writing sets raised', sqlerrm);
end $$;
reset role;

insert into fails select 'the sets did not land as written', coalesce(string_agg(
    exercise_id || '=' || value || '@' || (on_day - (select today from t)) || coalesce(':' || exercise_name, ''), ', '), 'none')
from public.chronicle_sets where owner = (select me from subject)
having string_agg(exercise_id || '=' || value || '@' || (on_day - (select today from t)) || ':' || exercise_name, ', '
                  order by exercise_id, value)
       is distinct from 'ex-bench=8@-1:Bench, ex-quad=12@-1:Quad Curl, ex-quad=20@0:Quad Curl';

create temp table tries(what text, person text, ex text, val numeric, day_shift int, entry_k text, want text);
insert into tries values
  ('another member''s person',     'sets-theirs', 'ex-quad', 5,    0, null,          'no such person of yours'),
  ('a person nobody has claimed',  'sets-nobody', 'ex-quad', 5,    0, null,          'no such person of yours'),
  ('a person that does not exist', 'sets-none',   'ex-quad', 5,    0, null,          'no such person of yours'),
  ('an exercise not on the list',  'sets-mine',   'ex-none', 5,    0, null,          'no such exercise'),
  ('nothing',                      'sets-mine',   'ex-quad', 0,    0, null,          'that is not a number of anything'),
  ('less than nothing',            'sets-mine',   'ex-quad', -3,   0, null,          'that is not a number of anything'),
  ('too many to be true',          'sets-mine',   'ex-quad', 2e9,  0, null,          'that is not a number of anything'),
  ('no number',                    'sets-mine',   'ex-quad', null, 0, null,          'that is not a number of anything'),
  ('a day that has not come',      'sets-mine',   'ex-quad', 5,    2, null,          'that day has not come yet'),
  ('another member''s sitting',    'sets-mine',   'ex-quad', 5,   -1, 'their_entry', 'no such session'),
  ('a day far from the sitting',   'sets-mine',   'ex-quad', 5,   -4, 'entry',       'that is not the day that session starts on');
grant select on tries to authenticated, anon;

set local role authenticated;
do $$
declare r record; got text;
begin
  for r in select * from tries loop
    got := null;
    begin
      perform public.chronicle_set_add(r.person, r.ex, r.val, (select today from t) + r.day_shift,
                                       (select v from ids where k = r.entry_k));
    exception when others then got := sqlerrm;
    end;
    if got is distinct from r.want then
      insert into fails values ('refusing ' || r.what, coalesce(got, 'it was accepted'));
    end if;
  end loop;
end $$;
reset role;
insert into fails select 'a refused set still landed', count(*)::text
from public.chronicle_sets having count(*) <> 3;

-- nobody, and a suspended member
select set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare got text;
begin
  begin perform public.chronicle_set_add('sets-mine', 'ex-quad', 5, (select today from t));
  exception when others then got := sqlerrm; end;
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
  begin perform public.chronicle_set_add('sets-mine', 'ex-quad', 5, (select today from t));
  exception when others then got := sqlerrm; end;
  if got is distinct from 'your account is suspended' then
    insert into fails values ('refusing a suspended member', coalesce(got, 'it was accepted'));
  end if;
end $$;
reset role;
update public.profiles set suspended = false where user_id = (select me from subject);

-- ── C. the name is a snapshot, and identity is the id ──────────────────────────────────────
create temp table seen(k text primary key, v jsonb);
grant select, insert, update on seen to authenticated, anon;

/* renamed in the Circuit: the set keeps what it was called, and says what it is called now */
update public.circuit_people
   set exercises = jsonb_set(exercises, '{0,name}', '"Quad Curls"') where id = 'sets-mine';
set local role authenticated;
do $$
begin
  insert into seen values ('renamed', public.chronicle_sets_between((select today from t) - 1, (select today from t)));
end $$;
reset role;
insert into fails select 'a renamed exercise', coalesce((select v::text from seen where k = 'renamed'), 'nothing')
where (select jsonb_agg(jsonb_build_array(x->>'name', x->>'now') order by x->>'exercise')
         from seen, jsonb_array_elements(v) x where k = 'renamed')
      is distinct from '[["Bench","Bench"],["Quad Curl","Quad Curls"]]'::jsonb;

/* deleted, then re-made with the SAME NAME under a new id: the old sets stay the old exercise */
update public.circuit_people
   set exercises = '[{"id":"ex-bench","name":"Bench","unit":"reps","mult":2,"col":0,"row":1},
                     {"id":"ex-quad-2","name":"Quad Curl","unit":"reps","mult":1,"col":0,"row":0}]'
 where id = 'sets-mine';
set local role authenticated;
do $$
begin
  insert into seen values ('gone', public.chronicle_sets_between((select today from t) - 1, (select today from t) + 1));
end $$;
reset role;
insert into fails select 'a deleted exercise, or one reconnected by its name', coalesce((select v::text from seen where k = 'gone'), 'nothing')
where (select jsonb_agg(jsonb_build_array(x->>'exercise', x->>'name', x->'now') order by x->>'exercise', (x->>'value')::numeric)
         from seen, jsonb_array_elements(v) x where k = 'gone')
      is distinct from '[["ex-bench","Bench","Bench"],["ex-quad","Quad Curl",null],["ex-quad","Quad Curl",null]]'::jsonb;
insert into fails select 'deleting an exercise deleted its sets', count(*)::text
from public.chronicle_sets where exercise_id = 'ex-quad' having count(*) <> 2;

-- ── D. a correction is one row ─────────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', (select other::text from subject), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare got1 text; got2 text;
begin
  begin perform public.chronicle_set_change((select v from ids where k = 'quad'), 99);
  exception when others then got1 := sqlerrm; end;
  begin perform public.chronicle_set_drop((select v from ids where k = 'grid'));
  exception when others then got2 := sqlerrm; end;
  if got1 is distinct from 'no such set' or got2 is distinct from 'no such set' then
    insert into fails values ('another member changing or dropping my set', coalesce(got1, 'changed') || ' / ' || coalesce(got2, 'dropped'));
  end if;
end $$;
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', (select me::text from subject), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  perform public.chronicle_set_change((select v from ids where k = 'quad'), 15);
  perform public.chronicle_set_drop((select v from ids where k = 'grid'));
exception when others then insert into fails values ('correcting my own sets raised', sqlerrm);
end $$;
reset role;
insert into fails select 'the correction did not land, or another member''s did',
       string_agg(exercise_id || '=' || value, ', ' order by exercise_id)
from public.chronicle_sets where owner = (select me from subject)
having string_agg(exercise_id || '=' || value, ', ' order by exercise_id) is distinct from 'ex-bench=8, ex-quad=15';

-- ── E. a sitting moved, and its sets with it — or neither ──────────────────────────────────
set local role authenticated;
do $$
declare got text;
begin
  -- a move to another activity moves no set
  perform public.chronicle_entry_edit((select v from ids where k = 'entry'),
    (select t0 from t) - interval '14 hours', (select t0 from t) - interval '13 hours', null,
    (select v from ids where k = 'drawing'));
  -- a refusal from the sitting's own rules rolls the sets back with it
  begin
    perform public.chronicle_entry_edit_day((select v from ids where k = 'entry'),
      (select t0 from t) - interval '37 hours', (select t0 from t) - interval '38 hours', null,
      (select today from t) - 2);
  exception when others then got := sqlerrm; end;
  if got is distinct from 'that span ends before it starts' then
    insert into fails values ('a backwards span through the day editor', coalesce(got, 'it was accepted'));
  end if;
  -- a day that is not the new start's is refused before anything moves
  got := null;
  begin
    perform public.chronicle_entry_edit_day((select v from ids where k = 'entry'),
      (select t0 from t) - interval '38 hours', (select t0 from t) - interval '37 hours', null,
      (select today from t) - 6);
  exception when others then got := sqlerrm; end;
  if got is distinct from 'that is not the day that session starts on' then
    insert into fails values ('a day far from the new start', coalesce(got, 'it was accepted'));
  end if;
exception when others then insert into fails values ('moving the sitting raised', sqlerrm);
end $$;
reset role;
insert into fails select 'a move or a refused edit touched the sets',
       string_agg(exercise_id || '@' || (on_day - (select today from t)), ', ' order by exercise_id)
from public.chronicle_sets where entry = (select v from ids where k = 'entry')
having string_agg(exercise_id || '@' || (on_day - (select today from t)), ', ' order by exercise_id)
       is distinct from 'ex-bench@-1, ex-quad@-1';
insert into fails select 'a refused edit still moved the sitting', started_at::text
from public.chronicle_entries where id = (select v from ids where k = 'entry')
  and started_at <> (select t0 from t) - interval '14 hours';

/* the real thing: one day back, sitting and sets together, the same two rows */
create temp table before_ids as select id from public.chronicle_sets where entry = (select v from ids where k = 'entry');
set local role authenticated;
do $$
begin
  perform public.chronicle_entry_edit_day((select v from ids where k = 'entry'),
    (select t0 from t) - interval '38 hours', (select t0 from t) - interval '37 hours', null,
    (select today from t) - 2);
exception when others then insert into fails values ('moving the sitting a day back raised', sqlerrm);
end $$;
reset role;
insert into fails select 'the sets did not follow their sitting, or were made again',
       string_agg(id::text || '@' || (on_day - (select today from t)), ', ')
from public.chronicle_sets where entry = (select v from ids where k = 'entry')
having count(*) <> 2 or bool_or(on_day <> (select today from t) - 2)
    or bool_or(id not in (select id from before_ids));
insert into fails select 'the sitting did not move', started_at::text
from public.chronicle_entries where id = (select v from ids where k = 'entry')
  and started_at <> (select t0 from t) - interval '38 hours';

/* a running sitting, its start fixed back past midnight */
set local role authenticated;
do $$
declare e uuid;
begin
  e := public.chronicle_start((select v from ids where k = 'gym'));
  insert into ids values ('running', e);
  perform public.chronicle_set_add('sets-mine', 'ex-bench', 4, (select today from t), e);
  perform public.chronicle_running_fix_day(now() - interval '20 hours', null,
                                           ((now() - interval '20 hours') at time zone 'utc')::date);
exception when others then insert into fails values ('fixing the running sitting raised', sqlerrm);
end $$;
reset role;
insert into fails select 'a running sitting''s set did not follow its start', on_day::text
from public.chronicle_sets where entry = (select v from ids where k = 'running')
  and on_day <> ((now() - interval '20 hours') at time zone 'utc')::date;

-- ── F. what a deletion takes ───────────────────────────────────────────────────────────────
set local role authenticated;
do $$
begin
  perform public.chronicle_entry_drop((select v from ids where k = 'running'));
exception when others then insert into fails values ('dropping a sitting raised', sqlerrm);
end $$;
reset role;
insert into fails select 'a deleted sitting left its sets behind', count(*)::text
from public.chronicle_sets where entry = (select v from ids where k = 'running') having count(*) > 0;

-- ── G. the reader: mine only, half-open, ISO ───────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', (select other::text from subject), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  insert into seen values ('theirs', public.chronicle_sets_between((select today from t) - 30, (select today from t) + 1));
end $$;
reset role;
insert into fails select 'another member reads my sets', (select v::text from seen where k = 'theirs')
where (select v from seen where k = 'theirs') <> '[]'::jsonb;

select set_config('request.jwt.claims',
  json_build_object('sub', (select me::text from subject), 'role', 'authenticated')::text, true);
set local datestyle = 'SQL, DMY';
set local role authenticated;
do $$
declare got text;
begin
  insert into seen values
    ('two_back', public.chronicle_sets_between((select today from t) - 2, (select today from t) - 1)),
    ('one_back', public.chronicle_sets_between((select today from t) - 1, (select today from t)));
  begin perform public.chronicle_sets_between((select today from t), (select today from t) - 1);
  exception when others then got := sqlerrm; end;
  if got is distinct from 'that range ends before it starts' then
    insert into fails values ('a backwards range', coalesce(got, 'it was answered'));
  end if;
  got := null;
  begin perform public.chronicle_sets_between((select today from t) - 500, (select today from t));
  exception when others then got := sqlerrm; end;
  if got is distinct from 'that is too long a range' then
    insert into fails values ('a range of 500 days', coalesce(got, 'it was answered'));
  end if;
end $$;
reset role;
reset datestyle;
insert into fails select 'the reader''s days', (select v::text from seen where k = 'two_back')
where (select jsonb_agg(x->>'on') from seen, jsonb_array_elements(v) x where k = 'two_back')
      is distinct from jsonb_build_array(to_char((select today from t) - 2, 'YYYY-MM-DD'),
                                         to_char((select today from t) - 2, 'YYYY-MM-DD'));
insert into fails select 'the reader still finds the sets on the day they moved from', (select v::text from seen where k = 'one_back')
where (select v from seen where k = 'one_back') <> '[]'::jsonb;

-- ── H. the export carries every field, and the import puts each one back ───────────────────
/* every field away from its default: a person, a sitting, a value, and moments moved back by hand
   because now() is fixed for the transaction and an invented one would equal it */
update public.chronicle_sets set created_at = now() - interval '3 days', updated_at = now() - interval '2 days'
 where owner = (select me from subject);
create temp table docs(k text primary key, body jsonb);
grant select, insert on docs to authenticated, anon;
set local role authenticated;
do $$ begin insert into docs values ('orig', public.chronicle_export()); end $$;
reset role;
create temp view orig_sets as select body->'sets' as v from docs where k = 'orig';
grant select on orig_sets to authenticated, anon;

insert into fails select 'the export does not carry the sets', coalesce((select v::text from orig_sets), 'none')
where coalesce(jsonb_array_length((select v from orig_sets)), 0) <> 2;
insert into fails select 'the export''s set is missing a field', f
from (values ('id'), ('person'), ('exercise'), ('name'), ('entry'), ('on_day'), ('value'),
             ('created_at'), ('updated_at')) fs(f)
where not ((select v->0 from orig_sets) ? f);

create temp table trips(field text);
insert into trips values (null), ('id'), ('person'), ('exercise'), ('name'), ('entry'), ('on_day'),
                         ('value'), ('created_at'), ('updated_at');
grant select on trips to authenticated, anon;
do $$
declare r record; doc jsonb; back jsonb; res jsonb;
begin
  for r in select * from trips loop
    delete from public.chronicle_sets where owner = (select me from subject);
    doc := jsonb_build_object('kind', 'chronicle', 'version', 1, 'sets',
             (select jsonb_agg(case when r.field is null then s else s - r.field end)
                from jsonb_array_elements((select v from orig_sets)) s));
    perform set_config('role', 'authenticated', true);
    res := public.chronicle_import(doc);
    back := public.chronicle_export()->'sets';
    perform set_config('role', 'postgres', true);
    if r.field is null then
      if back is distinct from (select v from orig_sets) then
        insert into fails values ('the round trip changed the sets', coalesce(back::text, 'null'));
      end if;
      if (res->>'sets')::int is distinct from 2 then
        insert into fails values ('the import did not count the sets it put back', res::text);
      end if;
    elsif back is not distinct from (select v from orig_sets) then
      insert into fails values ('the import does not really carry ' || r.field, 'dropping it changed nothing');
    end if;
  end loop;
exception when others then insert into fails values ('the round trip raised', sqlerrm);
end $$;
reset role;

/* a tampered file: a set on the other member's sitting is refused; one naming their person is
   kept — it is your reps — but attached to nobody, and keeps its name */
do $$
declare doc jsonb; res jsonb;
begin
  doc := jsonb_build_object('kind', 'chronicle', 'version', 1, 'sets', jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'person', 'sets-mine', 'exercise', 'ex-quad',
                       'name', 'Quad Curl', 'entry', (select v from ids where k = 'their_entry'),
                       'on_day', (select today from t) - 1, 'value', 50),
    jsonb_build_object('id', '00000000-0000-4000-8000-0000000000aa', 'person', 'sets-theirs',
                       'exercise', 'ex-quad', 'name', 'Quad Curl', 'entry', null,
                       'on_day', (select today from t), 'value', 7)));
  perform set_config('role', 'authenticated', true);
  res := public.chronicle_import(doc);
  perform set_config('role', 'postgres', true);
  if exists (select 1 from public.chronicle_sets where entry = (select v from ids where k = 'their_entry')) then
    insert into fails values ('a file put a set on another member''s sitting', res::text);
  end if;
  if (select person_id is not null or exercise_name <> 'Quad Curl' from public.chronicle_sets
       where id = '00000000-0000-4000-8000-0000000000aa') is distinct from false then
    insert into fails values ('a file attached a set to another member''s person, or lost it', res::text);
  end if;
  if (res->>'sets')::int is distinct from 1 then
    insert into fails values ('the tampered file was counted wrongly', res::text);
  end if;
exception when others then insert into fails values ('the tampered import raised', sqlerrm);
end $$;
reset role;

/* deleting the person keeps the sets, unattached — a person's row going does not unmake the reps */
delete from public.circuit_people where id = 'sets-mine';
insert into fails select 'deleting the person took the sets with it, or left them attached',
       count(*)::text || ' / ' || count(person_id)::text
from public.chronicle_sets where owner = (select me from subject) and exercise_id in ('ex-quad', 'ex-bench')
having count(*) < 2 or count(person_id) > 0;

-- ── the verdict ─────────────────────────────────────────────────────────────────────────────
do $$
declare n int; msg text;
begin
  select count(*), string_agg('  - ' || check_name || ': ' || detail, E'\n')
    into n, msg from fails;
  if n > 0 then
    raise exception E'CHRONICLE SETS FAILED -- % check(s):\n%', n, msg;
  end if;
end $$;

select 'a set is recorded once, keeps its name, and moves with its sitting' as result, count(*) as failures from fails;

rollback;
