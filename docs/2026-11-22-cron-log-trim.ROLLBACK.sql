-- ROLLBACK for supabase/migrations/20261122225001_cron_log_trim.sql: the job unscheduled. It deletes nothing,
-- and puts back nothing the job already deleted — run history older than seven days is gone for
-- good once the job has run, which is what was asked for.
--
-- ⚠️ NESTED, NOT ONE CONDITION: PL/pgSQL plans a whole expression before evaluating it, so
-- `cron.job` in the same IF as the extension check fails on a stack with no pg_cron.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'cron-log-trim') then
      perform cron.unschedule('cron-log-trim');
    end if;
  end if;
end;
$$;
