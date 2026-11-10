-- ✅ APPLIED to production 9 Nov 2026 (stamped 20261110025332 in UTC) as migration `circuit_grid_sessions`,
-- step 3 of the Chronicle release, docs/2026-11-09-chronicle-release-plan.md. Production
-- recorded md5(statements[1]) = 5eb8002a18ea00f5662c061bab2edc96, this file's body byte for byte
-- (supabase/migrations/applied.md5).
--
-- 20c: the Circuit grid sees sessions, and a typed total keeps them.
-- The body is docs/2026-11-09-circuit-grid-sessions.DRAFT.sql after its
-- leading comment block, which holds the reasoning, the tests and the rollback. Before step 1,
-- check A held: the six functions the release patches were byte for byte what run C7 tested.

create or replace function public.circuit_session_sums(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'that range ends before it starts';
  end if;
  if p_to - p_from > 400 then raise exception 'that is too long a range'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'person', z.person_id, 'exercise', z.exercise_id,
             'on', to_char(z.on_day, 'YYYY-MM-DD'), 'value', z.v)
           order by z.person_id, z.on_day, z.exercise_id)
      from (select s.person_id, s.exercise_id, s.on_day, sum(s.value) as v
              from public.chronicle_sets s
              join public.circuit_people p on p.id = s.person_id
             where s.entry is not null
               and s.on_day >= p_from and s.on_day < p_to
               -- a set counts in a column only while its owner still owns that person
               and p.owner_user_id = s.owner
               and public.circuit_can_see_person(s.person_id)
             group by s.person_id, s.exercise_id, s.on_day) z
  ), '[]'::jsonb);
end $$;

create or replace function public.circuit_cell_set(
  p_person text, p_exercise text, p_day date,
  p_total numeric, p_seen_sessions numeric, p_seen_manual numeric
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sessions numeric;
  v_manual numeric;
  v_holding int;
  v_row text;
  v_new numeric;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  -- ⚠️ THE CIRCUIT'S OWN EDIT RULE, asked by hand: circuit_logs keeps it in RLS policies, and a
  -- SECURITY DEFINER function does not consult them
  if not coalesce(public.circuit_can_edit_person(p_person), false) then
    raise exception 'you cannot change that person';
  end if;
  if p_day is null or nullif(btrim(coalesce(p_exercise, '')), '') is null then
    raise exception 'which day, and which exercise?';
  end if;
  if not exists (
    select 1 from public.circuit_people p,
           jsonb_array_elements(case when jsonb_typeof(p.exercises) = 'array' then p.exercises else '[]'::jsonb end) e
     where p.id = p_person and e->>'id' = p_exercise) then
    raise exception 'no such exercise';
  end if;
  if p_total is null or p_total < 0 or p_total > 1e9 then
    raise exception 'that is not a number of anything';
  end if;

  -- one cell at a time — the same lock every set writer takes (see the links draft)
  perform public.chronicle_cell_lock(p_person, p_exercise, p_day);

  select coalesce(sum(s.value), 0) into v_sessions
    from public.chronicle_sets s
    join public.circuit_people p on p.id = s.person_id
   where s.person_id = p_person and s.exercise_id = p_exercise and s.on_day = p_day
     and s.entry is not null and p.owner_user_id = s.owner;

  select count(*) filter (where z.has), coalesce(sum(z.val), 0) into v_holding, v_manual
    from (select exists (select 1 from jsonb_array_elements(
                           case when jsonb_typeof(l.entries) = 'array' then l.entries else '[]'::jsonb end) e
                          where e->>'eid' = p_exercise) as has,
                 (select coalesce(sum(case when (e->>'val') ~ '^[0-9]+(\.[0-9]+)?$' then (e->>'val')::numeric else 0 end), 0)
                    from jsonb_array_elements(
                           case when jsonb_typeof(l.entries) = 'array' then l.entries else '[]'::jsonb end) e
                   where e->>'eid' = p_exercise) as val
            from public.circuit_logs l
           where l.person_id = p_person and l.date = p_day
             for update of l) z;
  if v_holding > 1 then
    raise exception 'that day has % logs holding this exercise — put them together before changing it', v_holding;
  end if;

  -- ⚠️ WHAT THE CALLER SAW MUST STILL BE TRUE. "20" typed over "12 from sessions, 0 by hand" is a
  -- manual part of 8; the same 20 typed after a 5-rep session landed would be 3 — or 8 with a total of
  -- 25. Two meanings, so neither is guessed: the save is refused with the figures as they now are.
  if p_seen_sessions is distinct from v_sessions or p_seen_manual is distinct from v_manual then
    raise exception 'that day changed while you were typing — it is now % (% from sessions)',
      v_sessions + v_manual, v_sessions;
  end if;
  if p_total < v_sessions then
    raise exception 'sessions count % on that day — lower them in Chronicle, in that day''s log', v_sessions;
  end if;

  v_new := p_total - v_sessions;
  select l.id into v_row from public.circuit_logs l
   where l.person_id = p_person and l.date = p_day
   order by exists (select 1 from jsonb_array_elements(
                      case when jsonb_typeof(l.entries) = 'array' then l.entries else '[]'::jsonb end) e
                     where e->>'eid' = p_exercise) desc, l.id
   limit 1;
  if v_row is null then
    if v_new = 0 then
      return jsonb_build_object('total', p_total, 'sessions', v_sessions, 'manual', 0);
    end if;
    -- the id the grid would have given it, so a later save from the grid finds the same row
    v_row := 'l-' || p_person || '-' || to_char(p_day, 'YYYY-MM-DD');
    insert into public.circuit_logs (id, person_id, date, entries)
    values (v_row, p_person, p_day, '[]'::jsonb)
    on conflict (id) do nothing;
  end if;

  update public.circuit_logs
     set entries = coalesce((select jsonb_agg(e) from jsonb_array_elements(
                               case when jsonb_typeof(entries) = 'array' then entries else '[]'::jsonb end) e
                              where e->>'eid' <> p_exercise), '[]'::jsonb)
                   || case when v_new > 0
                           then jsonb_build_array(jsonb_build_object('eid', p_exercise, 'val', v_new))
                           else '[]'::jsonb end,
         updated_at = now()
   where id = v_row;

  return jsonb_build_object('total', p_total, 'sessions', v_sessions, 'manual', v_new);
end $$;

revoke all on function public.circuit_session_sums(date, date) from public, anon;
revoke all on function public.circuit_cell_set(text, text, date, numeric, numeric, numeric) from public, anon;
grant execute on function public.circuit_session_sums(date, date) to authenticated;
grant execute on function public.circuit_cell_set(text, text, date, numeric, numeric, numeric) to authenticated;
