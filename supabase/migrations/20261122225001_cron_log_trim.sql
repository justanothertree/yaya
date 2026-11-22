-- ✅ APPLIED to production 22 Nov 2026 (5:50 PM EST, 22:50 UTC) as migration `cron_log_trim`, version
-- 20261122225001, with Evan's yes of 22 Nov ("Cron log trim: YES, set up a daily job that deletes only
-- cron.job_run_details rows older than 7 days. Nothing else, and no user tables."). Production
-- recorded md5(statements[1]) = 45c475bbc3dfe3feab3135a3983c1ca8 over 266 bytes, this file's body byte for byte.
-- After it: one new job, cron-log-trim (jobid 6), '17 4 * * *', active, as postgres, with exactly
-- the command below; the five jobs before it unchanged. The table then held 562 rows, 523 of them
-- finished more than seven days ago, which is what its first run takes.
-- Why, and the rollback: docs/applied/2026-11-22-cron-log-trim.DRAFT.sql and
-- docs/2026-11-22-cron-log-trim.ROLLBACK.sql.

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
