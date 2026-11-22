-- Does the cron log trim delete only finished runs older than seven days, and nothing else?
--
-- HOW TO RUN: db-guards.yml reads the job's command out of docs/2026-11-22-cron-log-trim.DRAFT.sql
-- (the text between its $job$ quotes) and passes it in as :trim_command, so what runs here is the
-- statement production will schedule, never a second copy typed in beside it:
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -v trim_command="$cmd" -f supabase/tests/cron-log-trim.sql
--
-- CI's stack has no pg_cron, so a stand-in cron.job_run_details is made with the columns the
-- command names, inside a transaction that rolls back. A bystander table in the same schema checks
-- that the statement reaches no other table.

\set ON_ERROR_STOP 1
begin;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    raise exception 'this stack already has a cron schema; the stand-in would shadow nothing';
  end if;
end $$;

create schema cron;
create table cron.job_run_details (
  runid bigint primary key,
  jobid bigint,
  status text,
  start_time timestamptz,
  end_time timestamptz
);
create table cron.bystander (id int primary key, at timestamptz);

insert into cron.job_run_details values
  (1, 1, 'succeeded', now() - interval '120 days', now() - interval '120 days'),            -- goes
  (2, 2, 'failed',    now() - interval '7 days 2 hours', now() - interval '7 days 1 hour'),  -- goes
  (3, 1, 'succeeded', now() - interval '6 days 23 hours', now() - interval '6 days 23 hours'), -- stays
  (4, 3, 'succeeded', now() - interval '5 minutes', now() - interval '4 minutes'),          -- stays
  (5, 2, 'running',   now() - interval '30 days', null),                                    -- stays: never finished
  (6, 4, 'succeeded', now() - interval '8 days', now() - interval '6 days 12 hours');       -- stays: ENDED inside the week
insert into cron.bystander values (1, now() - interval '400 days');

:trim_command;

do $$
declare
  kept bigint[] := (select array_agg(runid order by runid) from cron.job_run_details);
begin
  if kept is distinct from array[3, 4, 5, 6]::bigint[] then
    raise exception 'cron log trim: expected runs 3, 4, 5 and 6 to stay, but kept %', kept;
  end if;
  if (select count(*) from cron.bystander) <> 1 then
    raise exception 'cron log trim reached a table that is not cron.job_run_details';
  end if;
  raise notice 'cron log trim: deletes only runs that finished more than seven days ago';
end $$;

rollback;
