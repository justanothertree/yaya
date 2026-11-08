-- ⛔ SCRATCH BRANCH chronicle/ci-probe-flow ONLY — never to be merged.
-- RUN B2: one fault — chronicle_entry_amount ADDS instead of setting. Throwaway database only.
create or replace function public.chronicle_entry_amount(p_id uuid, p_amount numeric)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.chronicle_entries set amount = coalesce(amount, 0) + p_amount
   where id = p_id and owner = auth.uid();
  if not found then raise exception 'no such entry'; end if;
end $$;
\ir chronicle-daily-flow.sql
