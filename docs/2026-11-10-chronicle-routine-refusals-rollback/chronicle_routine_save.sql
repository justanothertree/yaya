CREATE OR REPLACE FUNCTION public.chronicle_routine_save(p_id uuid, p_name text, p_steps jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_id uuid; v_count int; v_clean jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if p_steps is null or jsonb_typeof(p_steps) <> 'array' then raise exception 'steps must be a list'; end if;
  if jsonb_array_length(p_steps) > 40 then raise exception 'that is more than forty steps'; end if;

  /**
   * ⚠️ EVERY STEP'S ACTIVITY IS CHECKED AGAINST THE CALLER'S OWN, and a step naming anybody
   * else's is dropped rather than stored. A routine is a list of ids somebody can type, so
   * trusting it would let a request point a routine at another member's activity — and a tap on
   * that step would then try to start it. The join does the filtering; nothing is raised, because
   * a routine missing a step is still a routine and refusing the whole save would be worse.
   */
  select coalesce(jsonb_agg(jsonb_build_object(
           'activity', a.id,
           'mins', case when (s->>'mins') ~ '^[0-9]+$' then least((s->>'mins')::int, 600) else null end
         ) order by s.ord), '[]'::jsonb)
    into v_clean
    from jsonb_array_elements(p_steps) with ordinality s(s, ord)
    join public.chronicle_activities a
      on a.id = (s->>'activity')::uuid and a.owner = auth.uid();

  if p_id is null then
    select count(*) into v_count from public.chronicle_routines where owner = auth.uid();
    if v_count >= 40 then raise exception 'that is forty routines — delete one'; end if;
    insert into public.chronicle_routines (owner, name, steps)
    values (auth.uid(), btrim(p_name), v_clean) returning id into v_id;
  else
    update public.chronicle_routines
       set name = btrim(p_name), steps = v_clean, updated_at = now()
     where id = p_id and owner = auth.uid()
    returning id into v_id;
    if v_id is null then raise exception 'no such routine'; end if;
  end if;
  return v_id;
end $function$
