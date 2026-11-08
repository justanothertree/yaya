-- The Circuit grid and Chronicle's sessions, one cell at a time — asked of the real functions as
-- seeded members.
--
-- ⛔ NEEDS THREE DRAFTS APPLIED FIRST, in order, and refuses to run otherwise:
--      docs/2026-11-08-chronicle-sets.DRAFT.sql
--      docs/2026-11-09-chronicle-sets-links.DRAFT.sql
--      docs/2026-11-09-circuit-grid-sessions.DRAFT.sql
-- None is applied to production. This runs only in a throwaway database — the `db guards` CI job —
-- and rolls back. NEVER against production.
--
-- WHAT IT ASKS, section by section:
--   0  the drafts are applied; two members, neither of whom is an admin of the other's people
--   A  privileges: anon has no door to either function
--   B  who sees which sessions: the owner; a member of a circuit the person is in; NOT a member who
--      shares no circuit with a private person; and never a set with no sitting
--   C  a typed total: 20 over 12 from sessions stores 8; saving 20 again still 20, not 28; a later
--      session adds and the 8 stays; a stale save, a total below the sessions, another member, an
--      exercise not on the list, two rows holding the exercise and a suspended member are each
--      refused in their own words; a total equal to the sessions empties the manual part and keeps
--      the row (with its comments)
--   D  nothing counted twice: the day's workout line shows the typed part only; a Gym goal counts the
--      sitting (with its sets in it) and the typed part once each
--   E  corrections: a set taken back lowers the cell; a sitting moved a day takes its sessions with
--      it and leaves the typed part where it was typed
-- On failure it raises, naming every check that failed. A green run prints one row.

begin;

create temp table fails(check_name text, detail text);
create temp table ids(k text primary key, v uuid);
create temp table subject as
  select (select p.user_id from public.profiles p where coalesce(p.suspended, false) = false
           order by p.username limit 1) as me,
         (select p.user_id from public.profiles p where coalesce(p.suspended, false) = false
           order by p.username offset 1 limit 1) as other;
create temp table t as
  select (date_trunc('day', now() at time zone 'utc') at time zone 'utc') as t0,
         (now() at time zone 'utc')::date as today;
create temp table seen(k text primary key, v jsonb);
grant select on subject, t to authenticated, anon;
grant select, insert on fails to authenticated, anon;
grant select, insert, update on ids, seen to authenticated, anon;

-- ── 0 ───────────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.circuit_cell_set(text, text, date, numeric, numeric, numeric)') is null
     or to_regprocedure('public.chronicle_exercise_link(text, text, uuid)') is null then
    raise exception 'apply the sets, links and grid drafts before this file';
  end if;
end $$;
insert into fails select 'FIXTURE: no second member', ''
where (select other from subject) is null or (select other from subject) = (select me from subject);
insert into fails select 'FIXTURE: the other member is an admin, so "you cannot change that person" cannot be asked', ''
where exists (select 1 from public.admin_users where user_id = (select other from subject));

/* my person in a circuit the other member is also in, and one of mine in no circuit, private */
insert into public.circuit_people (id, name, exercises, owner_user_id, visibility) values
  ('cg-mine', 'Grid: mine',
   '[{"id":"ex-quad","name":"Quad Curl","unit":"reps","mult":1,"col":0,"row":0},
     {"id":"ex-bench","name":"Bench","unit":"reps","mult":2,"col":0,"row":1}]',
   (select me from subject), 'private'),
  ('cg-alone', 'Grid: alone',
   '[{"id":"ex-quad","name":"Quad Curl","unit":"reps","mult":1,"col":0,"row":0}]',
   (select me from subject), 'private');
insert into public.circuit_groups (id, name, created_by)
values ('00000000-0000-4000-8000-00000000c0de', 'Grid: a circuit', (select me from subject));
insert into public.circuit_group_members (group_id, user_id) values
  ('00000000-0000-4000-8000-00000000c0de', (select me from subject)),
  ('00000000-0000-4000-8000-00000000c0de', (select other from subject));
insert into public.circuit_person_groups (person_id, group_id)
values ('cg-mine', '00000000-0000-4000-8000-00000000c0de');

-- ── A ───────────────────────────────────────────────────────────────────────────────────────
insert into fails select 'anon can execute', f from (values
  ('public.circuit_session_sums(date, date)'),
  ('public.circuit_cell_set(text, text, date, numeric, numeric, numeric)')) v(f)
where has_function_privilege('anon', f, 'execute');

-- ── fixtures as the member: a Gym sitting yesterday with 12 Quad Curl in it, Quad Curl linked ──
select set_config('request.jwt.claims',
  json_build_object('sub', (select me::text from subject), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare a uuid; e uuid;
begin
  a := public.chronicle_activity_save(null, 'Grid: gym', 'free', null, 'reps', null);
  insert into ids values ('gym', a);
  perform public.chronicle_exercise_link('cg-mine', 'ex-quad', a);
  e := public.chronicle_entry_add(a, (select t0 from t) - interval '14 hours', (select t0 from t) - interval '13 hours', null);
  insert into ids values ('s', e);
  insert into ids values ('set12', public.chronicle_set_add('cg-mine', 'ex-quad', 12, (select today from t) - 1, e));
  -- a set on the person in no circuit, and one with no sitting at all
  perform public.chronicle_set_add('cg-alone', 'ex-quad', 9, (select today from t) - 1,
            public.chronicle_entry_add(a, (select t0 from t) - interval '12 hours', (select t0 from t) - interval '11 hours', null));
  perform public.chronicle_set_add('cg-mine', 'ex-bench', 40, (select today from t) - 1);
exception when others then insert into fails values ('the fixtures raised', sqlerrm);
end $$;
reset role;

-- ── B. who sees which sessions ─────────────────────────────────────────────────────────────
set local role authenticated;
do $$ begin
  insert into seen values ('mine', public.circuit_session_sums((select today from t) - 7, (select today from t) + 1));
end $$;
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', (select other::text from subject), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  insert into seen values ('theirs', public.circuit_session_sums((select today from t) - 7, (select today from t) + 1));
end $$;
reset role;
insert into fails select 'what the owner sees', (select v::text from seen where k = 'mine')
where (select jsonb_agg(jsonb_build_array(x->>'person', x->>'exercise', (x->>'value')::numeric) order by x->>'person')
         from seen, jsonb_array_elements(v) x where k = 'mine')
      is distinct from '[["cg-alone","ex-quad",9],["cg-mine","ex-quad",12]]'::jsonb;
insert into fails select 'what a member of the same circuit sees', (select v::text from seen where k = 'theirs')
where (select jsonb_agg(jsonb_build_array(x->>'person', x->>'exercise', (x->>'value')::numeric))
         from seen, jsonb_array_elements(v) x where k = 'theirs')
      is distinct from '[["cg-mine","ex-quad",12]]'::jsonb;

-- ── C. a typed total ───────────────────────────────────────────────────────────────────────
create temp table tries(n int, what text, who text, person text, ex text, day_shift int,
                        total numeric, seen_s numeric, seen_m numeric, want text);
insert into tries values
  (1, 'twenty over twelve',              'me',    'cg-mine', 'ex-quad', -1, 20, 12, 0, null),
  (2, 'twenty again, as seen',           'me',    'cg-mine', 'ex-quad', -1, 20, 12, 8, null),
  (3, 'a save from a stale screen',      'me',    'cg-mine', 'ex-quad', -1, 25, 12, 0,
      'that day changed while you were typing — it is now 20 (12 from sessions)'),
  (4, 'another member',                  'other', 'cg-mine', 'ex-quad', -1, 30, 12, 8, 'you cannot change that person'),
  (5, 'an exercise not on the list',     'me',    'cg-mine', 'ex-none', -1, 30, 0, 0, 'no such exercise'),
  (6, 'no number',                       'me',    'cg-mine', 'ex-quad', -1, null, 12, 8, 'that is not a number of anything');
grant select on tries to authenticated, anon;

do $$
declare r record; got text;
begin
  for r in select * from tries order by n loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', (case when r.who = 'me' then (select me from subject) else (select other from subject) end)::text,
                        'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    got := null;
    begin
      perform public.circuit_cell_set(r.person, r.ex, (select today from t) + r.day_shift, r.total, r.seen_s, r.seen_m);
    exception when others then got := sqlerrm;
    end;
    perform set_config('role', 'postgres', true);
    if got is distinct from r.want then
      insert into fails values ('a typed total: ' || r.what, coalesce(got, 'it was accepted'));
    end if;
  end loop;
end $$;
reset role;

create temp view cell as
  select coalesce(sum(case when e->>'eid' = 'ex-quad' then (e->>'val')::numeric end), 0) as manual,
         count(distinct l.id) as rows
    from public.circuit_logs l
    left join lateral jsonb_array_elements(l.entries) e on true
   where l.person_id = 'cg-mine' and l.date = (select today from t) - 1;
grant select on cell to authenticated, anon;
insert into fails select 'twenty over twelve did not store eight, or stored it twice', manual::text || ' in ' || rows || ' rows'
from cell where manual <> 8 or rows <> 1;

/* a later session adds; the typed part stays */
select set_config('request.jwt.claims',
  json_build_object('sub', (select me::text from subject), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare got text;
begin
  insert into ids values ('set5', public.chronicle_set_add('cg-mine', 'ex-quad', 5, (select today from t) - 1, (select v from ids where k = 's')));
  begin
    perform public.circuit_cell_set('cg-mine', 'ex-quad', (select today from t) - 1, 10, 17, 8);
  exception when others then got := sqlerrm; end;
  if got is distinct from 'sessions count 17 on that day — lower them in Chronicle, in that day''s log' then
    insert into fails values ('a total below the sessions', coalesce(got, 'it was accepted'));
  end if;
exception when others then insert into fails values ('a later session raised', sqlerrm);
end $$;
reset role;
insert into fails select 'a later session moved the typed part', manual::text from cell where manual <> 8;

-- ── D. nothing counted twice ───────────────────────────────────────────────────────────────
set local role authenticated;
do $$
declare g uuid;
begin
  insert into seen values ('moments', public.chronicle_moments((select t0 from t) - interval '1 day', (select t0 from t)));
  g := public.chronicle_goal_save(null, 'Grid: reps', 'week', null, 1, 500, 'reps',
                                  null, null, (select v from ids where k = 'gym'), null, 'amount', null, 0);
  insert into seen values ('tally', public.chronicle_tally(jsonb_build_array(jsonb_build_object(
    'key', 'w', 'id', g, 'from', (select t0 from t) - interval '1 day', 'to', (select t0 from t),
    'from_day', (select today from t) - 1, 'to_day', (select today from t)))));
exception when others then insert into fails values ('reading the day raised', sqlerrm);
end $$;
reset role;
insert into fails select 'the day''s workout line', (select v::text from seen where k = 'moments')
where (select jsonb_agg(x->>'title') from seen, jsonb_array_elements(v) x
        where k = 'moments' and x->>'kind' = 'workout' and x->>'about' = 'Grid: mine')
      is distinct from '["Quad Curl 8 reps"]'::jsonb;
/* the sitting's 17 (12 + 5, counted, IN its amount) and the typed 8 — once each: 25, the grid's total */
insert into fails select 'a goal counting a cell', (select v::text from seen where k = 'tally')
where ((select v from seen where k = 'tally')->>'w')::numeric is distinct from 25;

-- ── E. corrections ─────────────────────────────────────────────────────────────────────────
set local role authenticated;
do $$
begin
  -- a total equal to the sessions: the typed part goes, the row stays
  perform public.circuit_cell_set('cg-mine', 'ex-quad', (select today from t) - 1, 17, 17, 8);
  -- a set taken back lowers the cell
  perform public.chronicle_set_drop((select v from ids where k = 'set5'));
  -- the sitting moved a day back takes its sessions with it
  perform public.chronicle_entry_edit_day((select v from ids where k = 's'),
    (select t0 from t) - interval '38 hours', (select t0 from t) - interval '37 hours', null, (select today from t) - 2);
  insert into seen values ('after', public.circuit_session_sums((select today from t) - 7, (select today from t) + 1));
exception when others then insert into fails values ('correcting raised', sqlerrm);
end $$;
reset role;
insert into fails select 'a total equal to the sessions', manual::text || ' in ' || rows || ' rows'
from cell where manual <> 0 or rows <> 1;
insert into fails select 'after a drop and a move', (select v::text from seen where k = 'after')
where (select jsonb_agg(jsonb_build_array(x->>'on', (x->>'value')::numeric)) from seen, jsonb_array_elements(v) x
        where k = 'after' and x->>'person' = 'cg-mine')
      is distinct from jsonb_build_array(jsonb_build_array(to_char((select today from t) - 2, 'YYYY-MM-DD'), 12));

/* two rows for one day both holding the exercise: refused, not guessed */
insert into public.circuit_logs (id, person_id, date, entries) values
  ('cg-dup-1', 'cg-mine', (select today from t) - 4, '[{"eid":"ex-quad","val":3}]'),
  ('cg-dup-2', 'cg-mine', (select today from t) - 4, '[{"eid":"ex-quad","val":4}]');
update public.profiles set suspended = true where user_id = (select other from subject);
set local role authenticated;
do $$
declare got text; got2 text;
begin
  begin perform public.circuit_cell_set('cg-mine', 'ex-quad', (select today from t) - 4, 10, 0, 7);
  exception when others then got := sqlerrm; end;
  if got is distinct from 'that day has 2 logs holding this exercise — put them together before changing it' then
    insert into fails values ('two rows holding the exercise', coalesce(got, 'it was accepted'));
  end if;
end $$;
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', (select other::text from subject), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare got text;
begin
  begin perform public.circuit_session_sums((select today from t) - 7, (select today from t));
  exception when others then got := sqlerrm; end;
  if got is distinct from 'your account is suspended' then
    insert into fails values ('a suspended member reading sessions', coalesce(got, 'it was answered'));
  end if;
end $$;
reset role;
update public.profiles set suspended = false where user_id = (select other from subject);

-- ── the verdict ─────────────────────────────────────────────────────────────────────────────
do $$
declare n int; msg text;
begin
  select count(*), string_agg('  - ' || check_name || ': ' || coalesce(detail, ''), E'\n') into n, msg from fails;
  if n > 0 then raise exception E'CIRCUIT GRID SESSIONS FAILED -- % check(s):\n%', n, msg; end if;
end $$;

select 'a typed cell keeps its sessions, and nothing is counted twice' as result, count(*) as failures from fails;

rollback;
