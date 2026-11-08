-- ⛔ SCRATCH BRANCH chronicle/ci-probe-flow ONLY — never to be merged.
-- PERTURBATION RUN: two faults put in on purpose, to prove the Chronicle flow test names them.
--   1. chronicle_entry_amount ADDS instead of setting — the double-count bug the test exists for.
--      Replaced in CI's throwaway database only; it is destroyed when the job ends.
--   2. chronicle-daily-flow.sql has its first pg_sleep removed, so the switch is a mis-press.
create or replace function public.chronicle_entry_amount(p_id uuid, p_amount numeric)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.chronicle_entries set amount = coalesce(amount, 0) + p_amount
   where id = p_id and owner = auth.uid();
  if not found then raise exception 'no such entry'; end if;
end $$;
\ir chronicle-daily-flow.sql
