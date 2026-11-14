CREATE OR REPLACE FUNCTION public.chronicle_entry_amount(p_id uuid, p_amount numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  /* ⚠️ NOT BELOW ITS COUNTED SETS — lowering it would uncount reps the sets still say were
     done. Correcting it is done on the sets, which takes back exactly what each added. */
  if coalesce(p_amount, 0) < coalesce((select sum(st.value) from public.chronicle_sets st
                                        where st.entry = p_id and st.owner = auth.uid()
                                          and st.counted), 0) then
    raise exception 'this sitting''s sets count % — change those to go lower',
      (select sum(st.value) from public.chronicle_sets st
        where st.entry = p_id and st.owner = auth.uid() and st.counted);
  end if;
  update public.chronicle_entries
     set amount = case when p_amount is null or p_amount < 0 then null
                       else least(p_amount, 1e9) end
   where id = p_id and owner = auth.uid();
  if not found then raise exception 'no such entry'; end if;
end $function$
