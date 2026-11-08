-- ⛔ SCRATCH BRANCH chronicle/ci-probe-flow ONLY — never to be merged.
-- RUN C: one fault — chronicle_entry_amount forgets to check the OWNER, so any member can set any
-- sitting's count. The security half of the test has to name it. Throwaway database only.
create or replace function public.chronicle_entry_amount(p_id uuid, p_amount numeric)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  update public.chronicle_entries
     set amount = case when p_amount is null or p_amount < 0 then null else least(p_amount, 1e9) end
   where id = p_id;
  if not found then raise exception 'no such entry'; end if;
end $$;
\ir chronicle-daily-flow.sql
