-- Does docs/2026-11-22-phone-alerts.ROLLBACK.sql take away everything the draft made?
--
-- HOW TO RUN: db-guards.yml loads the draft, runs its tests, then loads the rollback and this file.
-- A rollback nobody has run is a hope. It raises on the first thing still there.

do $$
declare left_over text;
begin
  select string_agg(n, ', ') into left_over from (
    select c.relname::text as n from pg_class c join pg_namespace s on s.oid = c.relnamespace
     where s.nspname = 'public' and c.relname like 'push\_%'
    union all
    select p.proname::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.proname like 'push\_%'
  ) x;
  if left_over is not null then
    raise exception 'phone alerts rollback: still there: %', left_over;
  end if;
  raise notice 'the phone alerts rollback takes everything away';
end $$;
