-- ⏳ DRAFT, NOT APPLIED. A daily job that deletes pg_cron's run history older than seven days.
-- Evan, 22 Nov 2026: "Cron log trim: YES, set up a daily job that deletes only
-- cron.job_run_details rows older than 7 days. Nothing else, and no user tables."
--
-- WHY. pg_cron writes a row to cron.job_run_details for every run of every job and never removes
-- one. Phone alerts' sweep (docs/2026-11-22-phone-alerts.DRAFT.sql) runs every minute, which is
-- 1,440 rows a day from the moment it is applied, on a 500 MB plan (CLAUDE.md §5).
--
-- WHAT IT DELETES, measured on 22 Nov before this was written: the table held 551 rows, 280 kB,
-- from 3 Jul to 22 Nov, all from the four `refresh-fund-prices-*` jobs. Seven days is the whole
-- history kept from now on, for every job — so the first run takes roughly 520 of those rows
-- (everything from before 15 Nov). Nothing in this repository reads the table; a grep for
-- job_run_details finds only a comment in the schema dump.
--
-- ⚠️ `end_time`, NOT `start_time`, as Supabase's own docs write it. A run that never finished has
-- no end_time and is never deleted: a job that hung or died is exactly the history worth keeping,
-- and there is at most one such row per failure.
--
-- ⚠️ ONLY WHERE pg_cron IS INSTALLED, like the phone alerts sweep: production has 1.6.4, a CI stack
-- does not, and `cron.schedule` with an existing name replaces that job, so running this twice
-- leaves one job. 04:17 UTC is 11:17 PM in New York (12:17 AM in summer), away from the fund
-- price jobs at 21:10–21:16 UTC.
--
-- TESTED: supabase/tests/cron-log-trim.sql runs the job's command, read out of this file, against
-- a stand-in table of rows either side of the line, and checks only the old finished ones go.
-- ROLLBACK: docs/2026-11-22-cron-log-trim.ROLLBACK.sql (unschedules it; deletes nothing).

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'cron-log-trim',
      '17 4 * * *',
      $job$delete from cron.job_run_details where end_time < now() - interval '7 days'$job$);
  end if;
end;
$$;
