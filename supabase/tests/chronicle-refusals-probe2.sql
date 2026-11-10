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
  (200, $k$sitting: no times$k$, $c$select public.chronicle_entry_add((select v from ids where k = 'a'), null, null, null)$c$),
  (201, $k$sitting: no end$k$, $c$select public.chronicle_entry_add((select v from ids where k = 'a'), (select t0 from t) - interval '3 hours', null, null)$c$),
  (202, $k$sitting: no start$k$, $c$select public.chronicle_entry_add((select v from ids where k = 'a'), null, (select t0 from t) - interval '3 hours', null)$c$),
  (203, $k$sitting: no activity$k$, $c$select public.chronicle_entry_add(null, (select t0 from t) - interval '4 hours', (select t0 from t) - interval '3 hours', null)$c$),
  (204, $k$edit: no start$k$, $c$select public.chronicle_entry_edit((select v from ids where k = 'e'), null, (select t0 from t) - interval '13 hours', null)$c$),
  (205, $k$edit: no end$k$, $c$select public.chronicle_entry_edit((select v from ids where k = 'e'), (select t0 from t) - interval '14 hours', null, null)$c$),
  (206, $k$edit: nobody's sitting$k$, $c$select public.chronicle_entry_edit(gen_random_uuid(), (select t0 from t) - interval '14 hours', (select t0 from t) - interval '13 hours', null)$c$),
  (207, $k$edit day: no day$k$, $c$select public.chronicle_entry_edit_day((select v from ids where k = 'e'), (select t0 from t) - interval '14 hours', (select t0 from t) - interval '13 hours', (select v from ids where k = 'a'), null)$c$),
  (208, $k$quality: nobody's sitting$k$, $c$select public.chronicle_entry_quality(gen_random_uuid(), 3)$c$),
  (209, $k$amount: nobody's sitting$k$, $c$select public.chronicle_entry_amount(gen_random_uuid(), 3)$c$),
  (210, $k$drop: nobody's sitting$k$, $c$select public.chronicle_entry_drop(gen_random_uuid())$c$),
  (211, $k$picture: nobody's sitting$k$, $c$select public.chronicle_entry_picture(gen_random_uuid(), gen_random_uuid())$c$),
  (220, $k$note: no body$k$, $c$select public.chronicle_note_add((select v from ids where k = 'e'), null)$c$),
  (221, $k$note: nobody's sitting$k$, $c$select public.chronicle_note_add(gen_random_uuid(), 'hello')$c$),
  (222, $k$note edit: nobody's note$k$, $c$select public.chronicle_note_edit(gen_random_uuid(), 'hello')$c$),
  (223, $k$note drop: nobody's note$k$, $c$select public.chronicle_note_drop(gen_random_uuid())$c$),
  (224, $k$day note: no day$k$, $c$select public.chronicle_day_note_add(null, 'hello')$c$),
  (225, $k$day note: no body$k$, $c$select public.chronicle_day_note_add((select today from t), null)$c$),
  (230, $k$plan: no times$k$, $c$select public.chronicle_plan_save(null, (select v from ids where k = 'a'), null, null, null)$c$),
  (231, $k$plan: no activity$k$, $c$select public.chronicle_plan_save(null, null, (select t0 from t) + interval '10 hours', (select t0 from t) + interval '11 hours', null)$c$),
  (232, $k$plan: nobody's activity$k$, $c$select public.chronicle_plan_save(null, gen_random_uuid(), (select t0 from t) + interval '10 hours', (select t0 from t) + interval '11 hours', null)$c$),
  (233, $k$plan: ends as it starts$k$, $c$select public.chronicle_plan_save(null, (select v from ids where k = 'a'), (select t0 from t) + interval '10 hours', (select t0 from t) + interval '10 hours', null)$c$),
  (234, $k$plan done: nobody's plan$k$, $c$select public.chronicle_plan_did(gen_random_uuid())$c$),
  (235, $k$plan drop: nobody's plan$k$, $c$select public.chronicle_plan_drop(gen_random_uuid())$c$),
  (240, $k$set: no number$k$, $c$select public.chronicle_set_add('fz-mine', 'x-sq', null, (select today from t) - 1)$c$),
  (241, $k$set: no day$k$, $c$select public.chronicle_set_add('fz-mine', 'x-sq', 5, null)$c$),
  (242, $k$set: no person$k$, $c$select public.chronicle_set_add(null, 'x-sq', 5, (select today from t) - 1)$c$),
  (243, $k$set change: nobody's set$k$, $c$select public.chronicle_set_change(gen_random_uuid(), 5)$c$),
  (244, $k$set drop: nobody's set$k$, $c$select public.chronicle_set_drop(gen_random_uuid())$c$),
  (245, $k$set: the day after tomorrow$k$, $c$select public.chronicle_set_add('fz-mine', 'x-sq', 5, (select today from t) + 2)$c$),
  (250, $k$goal: no scope$k$, $c$select public.chronicle_goal_save(null, 'Fz250', null, null, 1, null, null, null, null, null, null, 'minutes', null, 0)$c$),
  (251, $k$goal edit: nobody's goal$k$, $c$select public.chronicle_goal_save(gen_random_uuid(), 'Fz251', 'week', null, 1, null, null, null, null, null, null, 'minutes', null, 0)$c$),
  (252, $k$goal progress: nobody's goal$k$, $c$select public.chronicle_goal_progress(gen_random_uuid(), 1, false)$c$),
  (253, $k$goal drop: nobody's goal$k$, $c$select public.chronicle_goal_drop(gen_random_uuid())$c$),
  (254, $k$goal mark: no day$k$, $c$select public.chronicle_goal_mark((select v from ids where k = 'g'), null, (select t0 from t), (select t0 from t) + interval '7 days', 1, false)$c$),
  (255, $k$goal mark: no window$k$, $c$select public.chronicle_goal_mark((select v from ids where k = 'g'), (select today from t), null, null, 1, false)$c$),
  (256, $k$goal mark: nobody's goal$k$, $c$select public.chronicle_goal_mark(gen_random_uuid(), (select today from t), (select t0 from t), (select t0 from t) + interval '7 days', 1, false)$c$),
  (257, $k$weekdays: no days$k$, $c$select public.chronicle_goal_days_set((select v from ids where k = 'g'), null, (select today from t))$c$),
  (258, $k$weekdays: no start day$k$, $c$select public.chronicle_goal_days_set((select v from ids where k = 'g'), 31::smallint, null)$c$),
  (259, $k$weekdays: nobody's goal$k$, $c$select public.chronicle_goal_days_set(gen_random_uuid(), 31::smallint, (select today from t))$c$),
  (260, $k$activity: no kind$k$, $c$select public.chronicle_activity_save(null, 'Fz260', null, null, null, null)$c$),
  (261, $k$activity edit: nobody's$k$, $c$select public.chronicle_activity_save(gen_random_uuid(), 'Fz261', 'free', null, null, null)$c$),
  (262, $k$archive: nobody's activity$k$, $c$select public.chronicle_activity_archive(gen_random_uuid(), true)$c$),
  (263, $k$activity share: nobody's$k$, $c$select public.chronicle_activity_share(gen_random_uuid(), true)$c$),
  (264, $k$goal share: nobody's$k$, $c$select public.chronicle_goal_share(gen_random_uuid(), true)$c$),
  (270, $k$routine: no steps$k$, $c$select public.chronicle_routine_save(null, 'Fz270', null)$c$),
  (271, $k$routine edit: nobody's$k$, $c$select public.chronicle_routine_save(gen_random_uuid(), 'Fz271', '[]'::jsonb)$c$),
  (272, $k$routine drop: nobody's$k$, $c$select public.chronicle_routine_drop(gen_random_uuid())$c$),
  (280, $k$start: no activity$k$, $c$select public.chronicle_start(null)$c$),
  (281, $k$grid: no day$k$, $c$select public.circuit_cell_set('fz-mine', 'x-sq', null, 5, 0, 0)$c$),
  (282, $k$grid: nobody's person$k$, $c$select public.circuit_cell_set('fz-none', 'x-sq', (select today from t) - 3, 5, 0, 0)$c$),
  (283, $k$grid: no exercise$k$, $c$select public.circuit_cell_set('fz-mine', null, (select today from t) - 3, 5, 0, 0)$c$),
  (284, $k$link: no exercise$k$, $c$select public.chronicle_exercise_link('fz-mine', null, (select v from ids where k = 'a'))$c$),
  (290, $k$import: no file$k$, $c$select public.chronicle_import(null)$c$),
  (291, $k$import: a list, not a file$k$, $c$select public.chronicle_import('[]'::jsonb)$c$),
  (292, $k$visit: no seconds$k$, $c$select public.chronicle_visit('chronicle', null)$c$),
  (293, $k$visit: no room$k$, $c$select public.chronicle_visit(null, 30)$c$);

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

\pset format aligned
\pset tuples_only off
rollback;
