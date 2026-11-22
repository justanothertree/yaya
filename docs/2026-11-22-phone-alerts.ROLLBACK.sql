-- ROLLBACK for docs/2026-11-22-phone-alerts.DRAFT.sql: every object it created, gone.
--
-- ⚠️ THIS DROPS TABLES, SO IT DELETES THEIR ROWS — every member's devices and choices, and any
-- alert not yet sent — and is run only with Evan's yes. While nothing has used it (before the
-- VAPID key), it deletes nothing anybody made. Afterwards, browsers that subscribed keep their
-- subscriptions until they next sign out or switch alerts off; nothing will be sent to them.
--
-- db-guards' perturbation runs use it between variants, so it is run on a throwaway stack against
-- the draft it undoes.

do $$
begin
  /* the sweep exists only where pg_cron does, and unscheduling a name that is not there raises */
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from cron.job where jobname = 'push-sweep') then
    perform cron.unschedule('push-sweep');
  end if;
end $$;

drop table if exists public.push_deliveries, public.push_outbox, public.push_devices,
  public.push_prefs, public.push_config cascade;
drop function if exists public.push_device_add(text, text, text, text);
drop function if exists public.push_device_remove(text);
drop function if exists public.push_devices_mine();
drop function if exists public.push_prefs_get();
drop function if exists public.push_prefs_set(boolean, boolean, boolean, boolean, boolean);
drop function if exists public.push_test();
drop function if exists public.push_waiting(bigint, uuid);
drop function if exists public.push_claim(int);
drop function if exists public.push_delivery(bigint, uuid, text);
drop function if exists public.push_done(bigint, text);
drop function if exists public.push_expire(bigint);
drop function if exists public.push_device_gone(uuid);
drop function if exists public.push_stuck();
drop function if exists public.push_http_post(text, jsonb, jsonb);
drop function if exists public.push_kick();
drop function if exists public.push_outbox_kick();
