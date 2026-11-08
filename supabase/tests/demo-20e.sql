-- ⛔ SCRATCH BRANCH chronicle/ci-probe-flow ONLY — never to be merged.
-- A DEMONSTRATION for OPEN-DECISIONS §20e, not a test: it prints what restoring a file does to a
-- converted cell that was retyped after the file was made, and rolls back. It raises nothing.
begin;
create temp table subject as select p.user_id as me from public.profiles p
  where coalesce(p.suspended, false) = false order by p.username limit 1;
create temp table t as select (now() at time zone 'utc')::date as today;
create temp table out(k text primary key, v jsonb);
grant select on subject, t to authenticated;
grant select, insert on out to authenticated;
insert into public.circuit_people (id, name, exercises, owner_user_id) values
  ('rt-mine', 'Restore: mine', '[{"id":"ex-quad","name":"Quad Curl","unit":"reps","mult":1,"col":0,"row":0}]',
   (select me from subject));
insert into public.circuit_logs (id, person_id, date, entries) values
  ('rt-l1', 'rt-mine', (select today from t) - 2, '[{"eid":"ex-quad","val":10}]');
insert into out values ('1 converted', public.circuit_convert_person('rt-mine', true));
select set_config('request.jwt.claims',
  json_build_object('sub', (select me::text from subject), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare d jsonb;
begin
  d := public.chronicle_export();
  insert into out values ('2 the cell, as exported', public.circuit_manual_sums((select today from t) - 7, (select today from t)));
  insert into out values ('3 retyped to 25', public.circuit_cell_set('rt-mine', 'ex-quad', (select today from t) - 2, 25, 0, 10));
  insert into out values ('4 the cell, retyped', public.circuit_manual_sums((select today from t) - 7, (select today from t)));
  insert into out values ('5 the file restored', public.chronicle_import(d));
  insert into out values ('6 the cell, after the restore', public.circuit_manual_sums((select today from t) - 7, (select today from t)));
end $$;
reset role;
select k, case when k like '%the cell%'
  then (select jsonb_agg(m->'value') from jsonb_array_elements(v->'manual') m where m->>'person' = 'rt-mine')
  else v end as v
from out order by k;
select string_agg(s.value::text || ':' || coalesce(s.source_log, '-'), ', ' order by s.value) as "the cell's sets now"
from public.chronicle_sets s where s.person_id = 'rt-mine';
rollback;
