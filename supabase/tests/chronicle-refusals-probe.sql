-- ⛔ SCRATCH PROBE ONLY. Asks every Chronicle writer, as a seeded member, for its refusal to a value
-- that breaks a rule, and prints the message exactly as a member would read it. Rolls back.

begin;
create temp table ids(k text primary key, v uuid);
create temp table cases(n int, k text, sql text);
create temp table seen(n int, k text, said text);
create temp table subject as
  select (select p.user_id from public.profiles p where coalesce(p.suspended, false) = false
           order by p.username limit 1) as me;
create temp table t as
  select (date_trunc('day', now() at time zone 'utc') at time zone 'utc') as t0,
         (now() at time zone 'utc')::date as today;
grant select on subject, t, cases to authenticated;
grant select, insert, update on ids, seen to authenticated;

insert into public.circuit_people (id, name, exercises, owner_user_id, visibility) values
  ('fz-mine', 'Fuzz: mine', '[{"id":"x-sq","name":"Squat","unit":"reps","mult":1,"col":0,"row":0}]',
   (select me from subject), 'private');

select set_config('request.jwt.claims',
  json_build_object('sub', (select me::text from subject), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare a uuid; e uuid;
begin
  a := public.chronicle_activity_save(null, 'Fuzz: gym', 'free', null, 'reps', null);
  insert into ids values ('a', a);
  e := public.chronicle_entry_add(a, (select t0 from t) - interval '14 hours', (select t0 from t) - interval '13 hours', null);
  insert into ids values ('e', e);
  insert into ids values ('g', public.chronicle_goal_save(null, 'Fuzz goal', 'week', null, 1, 100, 'reps', null, null, a, null, 'amount', null, 0));
  insert into ids values ('r', public.chronicle_routine_save(null, 'Fuzz routine', '[]'::jsonb));
  insert into ids values ('n', public.chronicle_note_add(e, 'a note'));
  perform public.chronicle_exercise_link('fz-mine', 'x-sq', a);
  insert into ids values ('s', public.chronicle_set_add('fz-mine', 'x-sq', 5, (select today from t) - 1, e));
end $$;
reset role;

insert into cases values
  -- activities
  (1,  'activity: empty name',          $c$select public.chronicle_activity_save(null, '', 'free', null, null, null)$c$),
  (2,  'activity: blank name',          $c$select public.chronicle_activity_save(null, '   ', 'free', null, null, null)$c$),
  (3,  'activity: 61-char name',        $c$select public.chronicle_activity_save(null, repeat('x', 61), 'free', null, null, null)$c$),
  (4,  'activity: no name',             $c$select public.chronicle_activity_save(null, null, 'free', null, null, null)$c$),
  (5,  'activity: unknown kind',        $c$select public.chronicle_activity_save(null, 'Fz5', 'work', null, null, null)$c$),
  (6,  'activity: colour "red"',        $c$select public.chronicle_activity_save(null, 'Fz6', 'free', 'red', null, null)$c$),
  (7,  'activity: 17-char unit',        $c$select public.chronicle_activity_save(null, 'Fz7', 'free', null, repeat('m', 17), null)$c$),
  (8,  'activity: session 0',           $c$select public.chronicle_activity_save(null, 'Fz8', 'free', null, null, 0)$c$),
  (9,  'activity: session 1441',        $c$select public.chronicle_activity_save(null, 'Fz9', 'free', null, null, 1441)$c$),
  (10, 'activity: session 2.5',         $c$select public.chronicle_activity_save(null, 'Fz10', 'free', null, null, p_session => '2.5')$c$),
  -- goals
  (20, 'goal: empty title',             $c$select public.chronicle_goal_save(null, '', 'week', null, 1, null, null, null, null, null, null, 'minutes', null, 0)$c$),
  (21, 'goal: 121-char title',          $c$select public.chronicle_goal_save(null, repeat('t', 121), 'week', null, 1, null, null, null, null, null, null, 'minutes', null, 0)$c$),
  (22, 'goal: scope "decade"',          $c$select public.chronicle_goal_save(null, 'Fz22', 'decade', null, 1, null, null, null, null, null, null, 'minutes', null, 0)$c$),
  (23, 'goal: every 0 weeks',           $c$select public.chronicle_goal_save(null, 'Fz23', 'week', null, 0, null, null, null, null, null, null, 'minutes', null, 0)$c$),
  (24, 'goal: every 53 weeks',          $c$select public.chronicle_goal_save(null, 'Fz24', 'week', null, 53, null, null, null, null, null, null, 'minutes', null, 0)$c$),
  (25, 'goal: target 0',                $c$select public.chronicle_goal_save(null, 'Fz25', 'week', null, 1, 0, 'reps', null, null, (select v from ids where k = 'a'), null, 'amount', null, 0)$c$),
  (26, 'goal: target -1',               $c$select public.chronicle_goal_save(null, 'Fz26', 'week', null, 1, -1, 'reps', null, null, (select v from ids where k = 'a'), null, 'amount', null, 0)$c$),
  (27, 'goal: target 2e9',              $c$select public.chronicle_goal_save(null, 'Fz27', 'week', null, 1, 2e9, 'reps', null, null, (select v from ids where k = 'a'), null, 'amount', null, 0)$c$),
  (28, 'goal: 17-char unit',            $c$select public.chronicle_goal_save(null, 'Fz28', 'week', null, 1, 10, repeat('u', 17), null, null, (select v from ids where k = 'a'), null, 'amount', null, 0)$c$),
  (29, 'goal: unit, no target',         $c$select public.chronicle_goal_save(null, 'Fz29', 'week', null, 1, null, 'reps', null, null, null, null, 'minutes', null, 0)$c$),
  (30, 'goal: target, no unit',         $c$select public.chronicle_goal_save(null, 'Fz30', 'week', null, 1, 10, null, null, null, null, null, 'minutes', null, 0)$c$),
  (31, 'goal: 2001-char note',          $c$select public.chronicle_goal_save(null, 'Fz31', 'week', null, 1, null, null, repeat('n', 2001), null, null, null, 'minutes', null, 0)$c$),
  (32, 'goal: estimate 0',              $c$select public.chronicle_goal_save(null, 'Fz32', 'week', null, 1, null, null, null, null, null, null, 'minutes', 0, 0)$c$),
  (33, 'goal: estimate 10081',          $c$select public.chronicle_goal_save(null, 'Fz33', 'week', null, 1, null, null, null, null, null, null, 'minutes', 10081, 0)$c$),
  (34, 'goal: estimate 1.5',            $c$select public.chronicle_goal_save(null, 'Fz34', 'week', null, 1, null, null, null, null, null, null, 'minutes', p_est => '1.5', p_priority => 0)$c$),
  (35, 'goal: priority 3',              $c$select public.chronicle_goal_save(null, 'Fz35', 'week', null, 1, null, null, null, null, null, null, 'minutes', null, 3)$c$),
  (36, 'goal: counts "hours"',          $c$select public.chronicle_goal_save(null, 'Fz36', 'week', null, 1, null, null, null, null, null, null, 'hours', null, 0)$c$),
  (37, 'goal: activity and kind',       $c$select public.chronicle_goal_save(null, 'Fz37', 'week', null, 1, 10, 'min', null, null, (select v from ids where k = 'a'), 'free', 'minutes', null, 0)$c$),
  (38, 'goal: amount, no activity',     $c$select public.chronicle_goal_save(null, 'Fz38', 'week', null, 1, 10, 'reps', null, null, null, null, 'amount', null, 0)$c$),
  (39, 'goal: life, repeating',         $c$select public.chronicle_goal_save(null, 'Fz39', 'life', null, 1, null, null, null, null, null, null, 'minutes', null, 0)$c$),
  (40, 'goal: week, no repeat',         $c$select public.chronicle_goal_save(null, 'Fz40', 'week', null, null, null, null, null, null, null, null, 'minutes', null, 0)$c$),
  (41, 'goal: activity, no target',     $c$select public.chronicle_goal_save(null, 'Fz41', 'week', null, 1, null, null, null, null, (select v from ids where k = 'a'), null, 'minutes', null, 0)$c$),
  -- sittings
  (50, 'sitting: ends before start',    $c$select public.chronicle_entry_add((select v from ids where k = 'a'), (select t0 from t) - interval '2 hours', (select t0 from t) - interval '3 hours', null)$c$),
  (51, 'sitting: ends as it starts',    $c$select public.chronicle_entry_add((select v from ids where k = 'a'), (select t0 from t) - interval '2 hours', (select t0 from t) - interval '2 hours', null)$c$),
  (52, 'sitting: 25 hours',             $c$select public.chronicle_entry_add((select v from ids where k = 'a'), (select t0 from t) - interval '30 hours', (select t0 from t) - interval '5 hours', null)$c$),
  (53, 'sitting: in the future',        $c$select public.chronicle_entry_add((select v from ids where k = 'a'), (select t0 from t) + interval '48 hours', (select t0 from t) + interval '49 hours', null)$c$),
  (54, 'sitting: 4001-char note',       $c$select public.chronicle_entry_add((select v from ids where k = 'a'), (select t0 from t) - interval '4 hours', (select t0 from t) - interval '3 hours', repeat('n', 4001))$c$),
  (55, 'sitting: nobody''s activity',   $c$select public.chronicle_entry_add(gen_random_uuid(), (select t0 from t) - interval '4 hours', (select t0 from t) - interval '3 hours', null)$c$),
  (56, 'edit: ends before start',       $c$select public.chronicle_entry_edit((select v from ids where k = 'e'), (select t0 from t) - interval '13 hours', (select t0 from t) - interval '14 hours', null)$c$),
  (57, 'quality 0',                     $c$select public.chronicle_entry_quality((select v from ids where k = 'e'), 0)$c$),
  (58, 'quality 6',                     $c$select public.chronicle_entry_quality((select v from ids where k = 'e'), 6)$c$),
  (59, 'quality 40000',                 $c$select public.chronicle_entry_quality((select v from ids where k = 'e'), 40000)$c$),
  (60, 'quality 4.5',                   $c$select public.chronicle_entry_quality((select v from ids where k = 'e'), p_quality => '4.5')$c$),
  (61, 'amount 2e9',                    $c$select public.chronicle_entry_amount((select v from ids where k = 'e'), 2e9)$c$),
  (62, 'amount -4 (21b)',               $c$select public.chronicle_entry_amount((select v from ids where k = 'e'), -4)$c$),
  -- notes
  (70, 'note: empty',                   $c$select public.chronicle_note_add((select v from ids where k = 'e'), '')$c$),
  (71, 'note: blank',                   $c$select public.chronicle_note_add((select v from ids where k = 'e'), '   ')$c$),
  (72, 'note: 4001 chars',              $c$select public.chronicle_note_add((select v from ids where k = 'e'), repeat('n', 4001))$c$),
  (73, 'note edit: 4001 chars',         $c$select public.chronicle_note_edit((select v from ids where k = 'n'), repeat('n', 4001))$c$),
  (74, 'day note: empty',               $c$select public.chronicle_day_note_add((select today from t), '')$c$),
  (75, 'day note: 4001 chars',          $c$select public.chronicle_day_note_add((select today from t), repeat('n', 4001))$c$),
  (76, 'day note: year 2100',           $c$select public.chronicle_day_note_add('2100-01-01', 'later')$c$),
  -- plans
  (80, 'plan: ends before start',       $c$select public.chronicle_plan_save(null, (select v from ids where k = 'a'), (select t0 from t) + interval '11 hours', (select t0 from t) + interval '10 hours', null)$c$),
  (81, 'plan: 25 hours',                $c$select public.chronicle_plan_save(null, (select v from ids where k = 'a'), (select t0 from t) + interval '1 hours', (select t0 from t) + interval '26 hours', null)$c$),
  (82, 'plan: 501-char note',           $c$select public.chronicle_plan_save(null, (select v from ids where k = 'a'), (select t0 from t) + interval '10 hours', (select t0 from t) + interval '11 hours', repeat('n', 501))$c$),
  -- routines
  (90, 'routine: empty name',           $c$select public.chronicle_routine_save(null, '', '[]'::jsonb)$c$),
  (91, 'routine: 61-char name',         $c$select public.chronicle_routine_save(null, repeat('r', 61), '[]'::jsonb)$c$),
  (92, 'routine: steps not a list',     $c$select public.chronicle_routine_save(null, 'Fz92', '{}'::jsonb)$c$),
  (93, 'routine: step 99999999999 min', $c$select public.chronicle_routine_save(null, 'Fz93', jsonb_build_array(jsonb_build_object('activity', (select v from ids where k = 'a'), 'mins', 99999999999)))$c$),
  (94, 'routine: step 2.5 min',         $c$select public.chronicle_routine_save(null, 'Fz94', jsonb_build_array(jsonb_build_object('activity', (select v from ids where k = 'a'), 'mins', 2.5)))$c$),
  (95, 'routine: step activity "abc"',  $c$select public.chronicle_routine_save(null, 'Fz95', '[{"activity":"abc","mins":5}]'::jsonb)$c$),
  -- sets, goals' progress, schedules, the grid
  (100, 'set: value 0',                 $c$select public.chronicle_set_add('fz-mine', 'x-sq', 0, (select today from t) - 1)$c$),
  (101, 'set: value 2e9',               $c$select public.chronicle_set_add('fz-mine', 'x-sq', 2e9, (select today from t) - 1)$c$),
  (102, 'set: unknown exercise',        $c$select public.chronicle_set_add('fz-mine', 'x-none', 5, (select today from t) - 1)$c$),
  (103, 'set change: 0',                $c$select public.chronicle_set_change((select v from ids where k = 's'), 0)$c$),
  (104, 'set change: 2e9',              $c$select public.chronicle_set_change((select v from ids where k = 's'), 2e9)$c$),
  (110, 'goal progress -1',             $c$select public.chronicle_goal_progress((select v from ids where k = 'g'), -1, false)$c$),
  (111, 'goal progress 2e9',            $c$select public.chronicle_goal_progress((select v from ids where k = 'g'), 2e9, false)$c$),
  (112, 'goal mark: ends before start', $c$select public.chronicle_goal_mark((select v from ids where k = 'g'), (select today from t), (select t0 from t) + interval '1 day', (select t0 from t), 1, false)$c$),
  (113, 'goal mark: progress -1',       $c$select public.chronicle_goal_mark((select v from ids where k = 'g'), (select today from t), (select t0 from t), (select t0 from t) + interval '7 days', -1, false)$c$),
  (114, 'weekdays 0',                   $c$select public.chronicle_goal_days_set((select v from ids where k = 'g'), 0::smallint, (select today from t))$c$),
  (115, 'weekdays 128',                 $c$select public.chronicle_goal_days_set((select v from ids where k = 'g'), 128::smallint, (select today from t))$c$),
  (116, 'weekdays 200000',              $c$select public.chronicle_goal_days_set((select v from ids where k = 'g'), p_days => '200000', p_from => (select today from t))$c$),
  (120, 'grid: -1',                     $c$select public.circuit_cell_set('fz-mine', 'x-sq', (select today from t) - 3, -1, 0, 0)$c$),
  (121, 'grid: 2e9',                    $c$select public.circuit_cell_set('fz-mine', 'x-sq', (select today from t) - 3, 2e9, 0, 0)$c$),
  (122, 'link: unknown person',         $c$select public.chronicle_exercise_link('fz-none', 'x-sq', (select v from ids where k = 'a'))$c$),
  -- timer, visits, import
  (130, 'start: nobody''s activity',    $c$select public.chronicle_start(gen_random_uuid())$c$),
  (131, 'stop: nothing running',        $c$select public.chronicle_stop(null)$c$),
  (132, 'visit: -5 seconds',            $c$select public.chronicle_visit('chronicle', -5)$c$),
  (140, 'import: version "x"',          $c$select public.chronicle_import('{"kind":"chronicle","version":"x"}'::jsonb)$c$),
  (141, 'import: a row with a bad time', $c$select public.chronicle_import(jsonb_build_object('kind', 'chronicle', 'version', 1, 'entries', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'activity', (select v from ids where k = 'a'), 'started_at', 'yesterday'))))$c$);

set local role authenticated;
do $$
declare c record; got text;
begin
  for c in select * from cases order by n loop
    begin
      execute c.sql;
      got := 'accepted';
    exception when others then got := sqlerrm;
    end;
    insert into seen values (c.n, c.k, got);
  end loop;
end $$;
reset role;

\pset format unaligned
\pset tuples_only on
select '#### REFUSAL ' || n || ' | '
       || case when said ~* '(violates|invalid input syntax|out of range|overflow|null value|<NULL>|duplicate key|does not exist|malformed|cannot cast|syntax error|is not unique|function public\.)'
               then 'RAW' else 'ok ' end
       || ' | ' || k || ' | ' || said
  from seen order by n;

-- the 1b pre-check's pattern, against values that pass the cast and values that do not
insert into public.circuit_logs (id, person_id, date, entries) values
  ('fz-log', 'fz-mine', (select today from t) - 1,
   '[{"eid":"x-sq","val":"1.2.3"},{"eid":"x-sq","val":"."},{"eid":"x-sq","val":"12."},{"eid":"x-sq","val":".5"},{"eid":"x-sq","val":3.5}]');
select '#### PRECHECK would_error=' || count(*)
  from public.circuit_logs l
  join public.circuit_people p on p.id = l.person_id
  cross join lateral jsonb_array_elements(
         case when jsonb_typeof(l.entries) = 'array' then l.entries else '[]'::jsonb end) en
 where l.id = 'fz-log'
   and (en->>'val') ~ '^[0-9.]+$'
   and ((en->>'val') ~ '\..*\.' or (en->>'val') !~ '[0-9]');
select '#### CASTS ' || string_agg(v || '=' || case when v ~ '^[0-9.]+$' then (case when v ~ '\..*\.' or v !~ '[0-9]' then 'fails' else 'casts' end) else 'skipped' end, ' ')
  from (values ('1.2.3'), ('.'), ('12.'), ('.5'), ('3.5')) x(v);
set local role authenticated;
do $$
declare got text;
begin
  perform public.chronicle_moments((select t0 from t) - interval '1 day', (select t0 from t));
  got := 'answered';
exception when others then got := sqlerrm;
end $$;
reset role;
do $$
declare got text;
begin
  begin perform '1.2.3'::numeric; got := 'cast'; exception when others then got := sqlerrm; end;
  raise notice '#### CAST 1.2.3 -> %', got;
  begin perform '.'::numeric; got := 'cast'; exception when others then got := sqlerrm; end;
  raise notice '#### CAST . -> %', got;
  begin perform '12.'::numeric; got := 'cast'; exception when others then got := sqlerrm; end;
  raise notice '#### CAST 12. -> %', got;
  begin perform '.5'::numeric; got := 'cast'; exception when others then got := sqlerrm; end;
  raise notice '#### CAST .5 -> %', got;
end $$;
set local role authenticated;
do $$
declare got text;
begin
  begin
    perform public.chronicle_moments((select t0 from t) - interval '1 day', (select t0 from t));
    got := 'answered';
  exception when others then got := sqlerrm;
  end;
  raise notice '#### MOMENTS with 1.2.3 stored -> %', got;
end $$;
reset role;
\pset format aligned
\pset tuples_only off
rollback;
