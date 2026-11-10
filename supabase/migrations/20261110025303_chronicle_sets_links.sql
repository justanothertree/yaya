-- ✅ APPLIED to production 9 Nov 2026 (stamped 20261110025303 in UTC) as migration `chronicle_sets_links`,
-- step 2 of the Chronicle release, docs/2026-11-09-chronicle-release-plan.md. Production
-- recorded md5(statements[1]) = 5ded75e0a6028a4d47a1e65c0f1b2f7d, this file's body byte for byte
-- (supabase/migrations/applied.md5).
--
-- 20c: a Circuit exercise counts toward an activity where the units agree.
-- The body is docs/2026-11-09-chronicle-sets-links.DRAFT.sql after its
-- leading comment block, which holds the reasoning, the tests and the rollback. Before step 1,
-- check A held: the six functions the release patches were byte for byte what run C7 tested.

-- ── THE UNIT TABLE ──────────────────────────────────────────────────────────────────────────

create or replace function public.chronicle_unit(p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case lower(btrim(coalesce(p, '')))
    when 'rep' then 'reps' when 'reps' then 'reps' when 'repetition' then 'reps'
    when 'repetitions' then 'reps'
    when 'sec' then 'sec' when 'secs' then 'sec' when 's' then 'sec' when 'second' then 'sec'
    when 'seconds' then 'sec'
    when 'min' then 'min' when 'mins' then 'min' when 'minute' then 'min' when 'minutes' then 'min'
    when 'hr' then 'hr' when 'hrs' then 'hr' when 'h' then 'hr' when 'hour' then 'hr'
    when 'hours' then 'hr'
    when 'mi' then 'mi' when 'mile' then 'mi' when 'miles' then 'mi'
    when 'km' then 'km' when 'kms' then 'km' when 'kilometre' then 'km' when 'kilometres' then 'km'
    when 'kilometer' then 'km' when 'kilometers' then 'km'
    -- ⚠️ NOTHING ELSE. "other", "laps", "pages", "" and null cannot be compared with anything,
    -- including each other — two activities both counting "laps" are not evidence that a Circuit
    -- exercise in "other" is laps. They are listed as needing a decision instead.
    else null end
$$;

-- ── A SET SAYS WHETHER IT IS IN ITS SITTING'S AMOUNT ────────────────────────────────────────

alter table public.chronicle_sets add column if not exists counted boolean not null default false;

-- ── THE LINKS ───────────────────────────────────────────────────────────────────────────────

create table if not exists public.chronicle_exercise_links (
  owner       uuid not null references public.profiles(user_id) on delete cascade,
  person_id   text not null references public.circuit_people(id) on delete cascade,
  exercise_id text not null,
  activity    uuid not null references public.chronicle_activities(id) on delete cascade,
  created_at  timestamptz not null default now(),
  -- one exercise counts toward at most one activity, or a set would have two homes
  primary key (person_id, exercise_id)
);
alter table public.chronicle_exercise_links enable row level security;
revoke all on table public.chronicle_exercise_links from public, anon, authenticated;

-- whether a link agrees NOW: the person is yours, the exercise is still on its list, the activity is
-- yours, and both units normalise and match
create or replace function public.chronicle_link_ok(p_person text, p_exercise text, p_activity uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.circuit_people p
      cross join lateral jsonb_array_elements(
             case when jsonb_typeof(p.exercises) = 'array' then p.exercises else '[]'::jsonb end) e
      join public.chronicle_activities a on a.id = p_activity and a.owner = auth.uid()
     where p.id = p_person and p.owner_user_id = auth.uid()
       and e->>'id' = p_exercise
       and public.chronicle_unit(e->>'unit') is not null
       and public.chronicle_unit(e->>'unit') = public.chronicle_unit(a.metric))
$$;

create or replace function public.chronicle_exercise_link(p_person text, p_exercise text, p_activity uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  v_unit text;
  v_metric text;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(v_me), false) then
    raise exception 'your account is suspended';
  end if;
  if not exists (select 1 from public.circuit_people p where p.id = p_person and p.owner_user_id = v_me) then
    raise exception 'no such person of yours';
  end if;
  select e->>'unit' into v_unit
    from public.circuit_people p,
         jsonb_array_elements(case when jsonb_typeof(p.exercises) = 'array' then p.exercises else '[]'::jsonb end) e
   where p.id = p_person and e->>'id' = p_exercise
   limit 1;
  if not found then raise exception 'no such exercise'; end if;

  if p_activity is null then
    delete from public.chronicle_exercise_links where person_id = p_person and exercise_id = p_exercise and owner = v_me;
    return;
  end if;

  select a.metric into v_metric from public.chronicle_activities a
   where a.id = p_activity and a.owner = v_me and a.archived_at is null;
  if not found then raise exception 'that is not one of your activities'; end if;
  if nullif(btrim(coalesce(v_metric, '')), '') is null then
    raise exception 'that activity does not count anything';
  end if;
  -- ⚠️ THE THREE REFUSALS SAY WHICH THEY ARE, because "cannot be linked" with no reason sends
  -- somebody renaming things until it works — which is guessing, the thing being refused
  if public.chronicle_unit(v_unit) is null or public.chronicle_unit(v_metric) is null then
    raise exception 'those units cannot be compared (% and %)', coalesce(nullif(v_unit, ''), 'none'), v_metric;
  end if;
  if public.chronicle_unit(v_unit) <> public.chronicle_unit(v_metric) then
    raise exception 'they count different things (% and %)', v_unit, v_metric;
  end if;

  insert into public.chronicle_exercise_links (owner, person_id, exercise_id, activity)
  values (v_me, p_person, p_exercise, p_activity)
  on conflict (person_id, exercise_id) do update set activity = excluded.activity, created_at = now();
end $$;

-- every exercise on your own people, with its unit as written and as normalised, and its link
create or replace function public.chronicle_my_exercises()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'person', p.id, 'exercise', e->>'id', 'name', e->>'name',
             'unit', e->>'unit', 'canon', public.chronicle_unit(e->>'unit'),
             'activity', lk.activity,
             'ok', case when lk.activity is null then null
                        else public.chronicle_link_ok(p.id, e->>'id', lk.activity) end)
           order by p.id, (e->>'row')::numeric nulls last, e->>'name')
      from public.circuit_people p
      cross join lateral jsonb_array_elements(
             case when jsonb_typeof(p.exercises) = 'array' then p.exercises else '[]'::jsonb end) e
      left join public.chronicle_exercise_links lk
        on lk.person_id = p.id and lk.exercise_id = e->>'id' and lk.owner = auth.uid()
     where p.owner_user_id = auth.uid() and nullif(e->>'id', '') is not null
  ), '[]'::jsonb);
end $$;

-- ── ONE CELL AT A TIME ──────────────────────────────────────────────────────────────────────
-- A Circuit cell — one person's exercise on one day — is written by two kinds of thing: a set
-- counted during a sitting, and a total typed into the grid (the grid draft's circuit_cell_set,
-- which works out the manual part as the total minus the sessions). Each takes this lock first, for
-- the length of its own transaction, so the grid can never read the sessions, have a set land, and
-- then write a manual part computed from a figure that is already out of date.

create or replace function public.chronicle_cell_lock(p_person text, p_exercise text, p_day date)
returns void
language sql
volatile
set search_path = public, pg_temp
as $$
  select pg_advisory_xact_lock(hashtextextended(
           coalesce(p_person, '') || '/' || coalesce(p_exercise, '') || '/' || coalesce(p_day::text, ''), 0))
$$;

-- ── THE SET WRITERS, NOW WRITING THROUGH ────────────────────────────────────────────────────
-- Replaces the step-1 bodies. Every refusal they had is kept in the same words and order; what
-- changes is the last few lines of each.

create or replace function public.chronicle_set_add(
  p_person text, p_exercise text, p_value numeric, p_day date, p_entry uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  v_ex jsonb;
  v_name text;
  v_start timestamptz;
  v_activity uuid;
  v_counted boolean := false;
  v_id uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(v_me), false) then
    raise exception 'your account is suspended';
  end if;
  if p_value is null or p_value <= 0 or p_value > 1e9 then
    raise exception 'that is not a number of anything';
  end if;
  select p.exercises into v_ex from public.circuit_people p
   where p.id = p_person and p.owner_user_id = v_me;
  if not found then raise exception 'no such person of yours'; end if;
  select nullif(btrim(e->>'name'), '') into v_name
    from jsonb_array_elements(case when jsonb_typeof(v_ex) = 'array' then v_ex else '[]'::jsonb end) e
   where e->>'id' = p_exercise
   limit 1;
  if v_name is null then raise exception 'no such exercise'; end if;

  if p_entry is not null then
    -- ⚠️ LOCKED, so two sets written at once to one sitting add to its amount one after the other
    -- rather than both reading the same starting figure
    select e.started_at, e.activity into v_start, v_activity from public.chronicle_entries e
     where e.id = p_entry and e.owner = v_me
       for update;
    if not found then raise exception 'no such session'; end if;
    if p_day is null or abs(p_day - (v_start at time zone 'utc')::date) > 1 then
      raise exception 'that is not the day that session starts on';
    end if;
    v_counted := exists (select 1 from public.chronicle_exercise_links lk
                          where lk.person_id = p_person and lk.exercise_id = p_exercise
                            and lk.owner = v_me and lk.activity = v_activity)
                 and public.chronicle_link_ok(p_person, p_exercise, v_activity);
  elsif p_day is null or p_day > (now() at time zone 'utc')::date + 1 then
    raise exception 'that day has not come yet';
  end if;

  perform public.chronicle_cell_lock(p_person, p_exercise, p_day);
  insert into public.chronicle_sets (owner, person_id, exercise_id, exercise_name, entry, on_day, value, counted)
  values (v_me, p_person, p_exercise, left(v_name, 200), p_entry, p_day, p_value, v_counted)
  returning id into v_id;
  if v_counted then
    update public.chronicle_entries set amount = least(coalesce(amount, 0) + p_value, 1e9)
     where id = p_entry;
  end if;
  return v_id;
end $$;

create or replace function public.chronicle_set_change(p_id uuid, p_value numeric)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare r record;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if p_value is null or p_value <= 0 or p_value > 1e9 then
    raise exception 'that is not a number of anything';
  end if;
  select s.id, s.entry, s.value, s.counted, s.person_id, s.exercise_id, s.on_day into r
    from public.chronicle_sets s
   where s.id = p_id and s.owner = auth.uid()
     for update;
  if not found then raise exception 'no such set'; end if;
  perform public.chronicle_cell_lock(r.person_id, r.exercise_id, r.on_day);
  if r.counted then
    update public.chronicle_entries
       set amount = nullif(greatest(0, least(coalesce(amount, 0) + (p_value - r.value), 1e9)), 0)
     where id = r.entry;
  end if;
  update public.chronicle_sets set value = p_value, updated_at = now() where id = p_id;
end $$;

create or replace function public.chronicle_set_drop(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare r record;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  select s.id, s.entry, s.value, s.counted, s.person_id, s.exercise_id, s.on_day into r
    from public.chronicle_sets s
   where s.id = p_id and s.owner = auth.uid()
     for update;
  if not found then raise exception 'no such set'; end if;
  perform public.chronicle_cell_lock(r.person_id, r.exercise_id, r.on_day);
  if r.counted then
    update public.chronicle_entries
       set amount = nullif(greatest(0, coalesce(amount, 0) - r.value), 0)
     where id = r.entry;
  end if;
  delete from public.chronicle_sets where id = p_id;
end $$;

-- ── THE READER SAYS WHICH SETS ARE COUNTED ─────────────────────────────────────────────────
-- Replaces the step-1 reader with one more field, so the sitting editor can say how much of a
-- count its sets hold before somebody tries to lower it below that.

create or replace function public.chronicle_sets_between(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'that range ends before it starts';
  end if;
  if p_to - p_from > 400 then raise exception 'that is too long a range'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'entry', s.entry, 'person', s.person_id, 'exercise', s.exercise_id,
             'name', s.exercise_name,
             'now', (select nullif(btrim(e->>'name'), '')
                       from public.circuit_people p,
                            jsonb_array_elements(case when jsonb_typeof(p.exercises) = 'array'
                                                      then p.exercises else '[]'::jsonb end) e
                      where p.id = s.person_id and p.owner_user_id = auth.uid()
                        and e->>'id' = s.exercise_id
                      limit 1),
             'on', to_char(s.on_day, 'YYYY-MM-DD'), 'value', s.value, 'counted', s.counted)
           order by s.on_day, s.created_at, s.id)
      from public.chronicle_sets s
     where s.owner = auth.uid() and s.on_day >= p_from and s.on_day < p_to
  ), '[]'::jsonb);
end $$;

-- ── A MOVE BETWEEN UNITS UNCOUNTS ───────────────────────────────────────────────────────────
-- Replaces the step-1 day editors. Their refusals and their day-moving are unchanged.

create or replace function public.chronicle_sets_uncount_if_unit_changed(p_entry uuid, p_was_unit text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_now text;
begin
  select public.chronicle_unit(a.metric) into v_now
    from public.chronicle_entries e join public.chronicle_activities a on a.id = e.activity
   where e.id = p_entry and e.owner = auth.uid();
  if v_now is not distinct from p_was_unit then return; end if;
  update public.chronicle_entries e
     set amount = nullif(greatest(0, coalesce(e.amount, 0) - coalesce((
                    select sum(s.value) from public.chronicle_sets s
                     where s.entry = p_entry and s.owner = auth.uid() and s.counted), 0)), 0)
   where e.id = p_entry and e.owner = auth.uid();
  update public.chronicle_sets set counted = false, updated_at = now()
   where entry = p_entry and owner = auth.uid() and counted;
end $$;

create or replace function public.chronicle_entry_edit_day(
  p_id uuid, p_from timestamptz, p_to timestamptz, p_activity uuid, p_day date
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_was text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if p_from is not null and (p_day is null or abs(p_day - (p_from at time zone 'utc')::date) > 1) then
    raise exception 'that is not the day that session starts on';
  end if;
  select public.chronicle_unit(a.metric) into v_was
    from public.chronicle_entries e join public.chronicle_activities a on a.id = e.activity
   where e.id = p_id and e.owner = auth.uid();
  perform public.chronicle_entry_edit(p_id, p_from, p_to, null, p_activity);
  update public.chronicle_sets set on_day = p_day, updated_at = now()
   where entry = p_id and owner = auth.uid() and on_day is distinct from p_day;
  perform public.chronicle_sets_uncount_if_unit_changed(p_id, v_was);
end $$;

create or replace function public.chronicle_running_fix_day(
  p_from timestamptz, p_activity uuid, p_day date
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_start timestamptz;
  v_was text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  select e.id, public.chronicle_unit(a.metric) into v_id, v_was
    from public.chronicle_entries e join public.chronicle_activities a on a.id = e.activity
   where e.owner = auth.uid() and e.ended_at is null
   order by e.started_at desc limit 1;
  perform public.chronicle_running_fix(p_from, p_activity);
  if v_id is null then return; end if;
  select e.started_at into v_start from public.chronicle_entries e where e.id = v_id;
  if p_day is null or abs(p_day - (v_start at time zone 'utc')::date) > 1 then
    raise exception 'that is not the day that session starts on';
  end if;
  update public.chronicle_sets set on_day = p_day, updated_at = now()
   where entry = v_id and owner = auth.uid() and on_day is distinct from p_day;
  perform public.chronicle_sets_uncount_if_unit_changed(v_id, v_was);
end $$;

-- ── WHAT THE GRID CONTRIBUTES TO A GOAL, BEFORE A PERSON'S LOGS ARE CONVERTED ───────────────
-- The manual half of a linked exercise's days, read where it lives today: circuit_logs. Every row
-- for the person and day is summed, so two logs for one day — which nothing prevents — both count,
-- exactly as the grid shows them. The conversion draft replaces this body; nothing else changes.

create or replace function public.chronicle_manual_amount(p_activity uuid, p_from date, p_to date)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum((en->>'val')::numeric), 0)
    from public.chronicle_exercise_links lk
    join public.circuit_people p on p.id = lk.person_id and p.owner_user_id = auth.uid()
    join public.circuit_logs l on l.person_id = lk.person_id and l.date >= p_from and l.date < p_to
    cross join lateral jsonb_array_elements(
           case when jsonb_typeof(l.entries) = 'array' then l.entries else '[]'::jsonb end) en
   where lk.owner = auth.uid() and lk.activity = p_activity
     and en->>'eid' = lk.exercise_id
     and (en->>'val') ~ '^[0-9]+(\.[0-9]+)?$'
     and (en->>'val')::numeric > 0
     and public.chronicle_link_ok(lk.person_id, lk.exercise_id, lk.activity)
$$;

revoke all on function public.chronicle_unit(text) from public, anon;
revoke all on function public.chronicle_cell_lock(text, text, date) from public, anon, authenticated;
revoke all on function public.chronicle_link_ok(text, text, uuid) from public, anon, authenticated;
revoke all on function public.chronicle_manual_amount(uuid, date, date) from public, anon, authenticated;
revoke all on function public.chronicle_sets_uncount_if_unit_changed(uuid, text) from public, anon, authenticated;
revoke all on function public.chronicle_exercise_link(text, text, uuid) from public, anon;
revoke all on function public.chronicle_my_exercises() from public, anon;
grant execute on function public.chronicle_unit(text) to authenticated;
grant execute on function public.chronicle_exercise_link(text, text, uuid) to authenticated;
grant execute on function public.chronicle_my_exercises() to authenticated;
-- the step-1 writers were replaced above and keep the grants they had; said again so a reader of
-- this file alone sees the whole surface
revoke all on function public.chronicle_set_add(text, text, numeric, date, uuid) from public, anon;
revoke all on function public.chronicle_set_change(uuid, numeric) from public, anon;
revoke all on function public.chronicle_set_drop(uuid) from public, anon;
revoke all on function public.chronicle_entry_edit_day(uuid, timestamptz, timestamptz, uuid, date) from public, anon;
revoke all on function public.chronicle_running_fix_day(timestamptz, uuid, date) from public, anon;
revoke all on function public.chronicle_sets_between(date, date) from public, anon;

-- ── THE LIVE FUNCTIONS, PATCHED IN PLACE ────────────────────────────────────────────────────
-- Each substitution must match EXACTLY ONCE in the live text, or the migration raises. Every anchor
-- is one none of the four earlier drafts rewrites, so the five apply in any order after step 1.

do $mig$
declare
  r record;
  v_src text;
  v_hits int;
  v_done int := 0;
begin
  for r in
    select * from (values
      /* the sitting's own count may not go below what its sets say was done */
      ('chronicle_entry_amount',
       E'  update public.chronicle_entries\n     set amount = case when p_amount is null or p_amount < 0 then null',
       E'  /* ⚠️ NOT BELOW ITS COUNTED SETS — lowering it would uncount reps the sets still say were\n'
       || E'     done. Correcting it is done on the sets, which takes back exactly what each added. */\n'
       || E'  if coalesce(p_amount, 0) < coalesce((select sum(st.value) from public.chronicle_sets st\n'
       || E'                                        where st.entry = p_id and st.owner = auth.uid()\n'
       || E'                                          and st.counted), 0) then\n'
       || E'    raise exception ''this sitting''''s sets count % — change those to go lower'',\n'
       || E'      (select sum(st.value) from public.chronicle_sets st\n'
       || E'        where st.entry = p_id and st.owner = auth.uid() and st.counted);\n'
       || E'  end if;\n'
       || E'  update public.chronicle_entries\n     set amount = case when p_amount is null or p_amount < 0 then null'),
      /* each ask may carry its window as local dates, for what has only a date */
      ('chronicle_tally',
       E'(x->>''to'')::timestamptz as t',
       E'(x->>''to'')::timestamptz as t,\n'
       || E'           (x->>''from_day'')::date as fd, (x->>''to_day'')::date as td'),
      ('chronicle_tally',
       E'             end), 0) as total',
       E'             end), 0)\n'
       || E'           /* the grid''s manual half of a linked exercise, by local day — never a set with a\n'
       || E'              sitting, which is already in that sitting''s amount */\n'
       || E'           + case when g.counts = ''amount'' and g.activity is not null\n'
       || E'                       and a.fd is not null and a.td is not null\n'
       || E'                  then public.chronicle_manual_amount(g.activity, a.fd, a.td) else 0 end as total'),
      ('chronicle_tally',
       E'     group by a.k\n',
       E'     group by a.k, g.counts, g.activity, a.fd, a.td\n'),
      /* the links travel in the file, and each set says whether it was counted */
      ('chronicle_export',
       E'''routines'', coalesce((',
       E'''exercise_links'', coalesce((\n'
       || E'      select jsonb_agg(jsonb_build_object(\n'
       || E'               ''person'', lk.person_id, ''exercise'', lk.exercise_id,\n'
       || E'               ''activity'', lk.activity, ''created_at'', lk.created_at)\n'
       || E'             order by lk.person_id, lk.exercise_id)\n'
       || E'        from public.chronicle_exercise_links lk where lk.owner = me), ''[]''::jsonb),\n'
       || E'    ''routines'', coalesce(('),
      ('chronicle_export',
       E'''value'', s.value, ''created_at'', s.created_at',
       E'''value'', s.value, ''counted'', s.counted, ''created_at'', s.created_at'),
      /* ⚠️ THE DECLARATION BEFORE ANYTHING THAT USES IT: each substitution is CREATEd as it goes,
         and plpgsql refuses a function naming a variable it has not declared — the first run of
         this file stopped exactly there */
      ('chronicle_import',
       E'n_set int := 0;',
       E'n_set int := 0; n_link int := 0; fresh_entries uuid[] := ''{}'';'),
      /* the sittings THIS import created: only theirs hold what the file's sets say */
      ('chronicle_import',
       E'          n_ent := n_ent + 1;\n',
       E'          n_ent := n_ent + 1;\n'
       || E'          fresh_entries := fresh_entries || (x->>''id'')::uuid;\n'),
      /* ⚠️ A COUNTED SET ONLY COMES BACK WITH ITS SITTING — see the header */
      ('chronicle_import',
       E'      if nullif(x->>''exercise'', '''') is null\n',
       E'      if (coalesce((x->>''counted'')::boolean, false) and (x->>''entry'') is not null\n'
       || E'          and not ((x->>''entry'')::uuid = any (fresh_entries)))\n'
       || E'         or nullif(x->>''exercise'', '''') is null\n'),
      ('chronicle_import',
       E'exercise_name, entry, on_day, value,\n           created_at, updated_at)',
       E'exercise_name, entry, on_day, value,\n           created_at, updated_at, counted)'),
      ('chronicle_import',
       E'          coalesce((x->>''updated_at'')::timestamptz, now()))\n        on conflict (id) do nothing;\n        if found then n_set',
       E'          coalesce((x->>''updated_at'')::timestamptz, now()),\n'
       || E'          /* counted only WITH a sitting: the file''s amount already holds it */\n'
       || E'          (x->>''entry'') is not null and coalesce((x->>''counted'')::boolean, false))\n'
       || E'        on conflict (id) do nothing;\n        if found then n_set'),
      ('chronicle_import',
       E'  for x in select * from jsonb_array_elements(coalesce(p_doc->''plans'', ''[]''::jsonb)) loop',
       E'  /* ⚠️ A LINK ONLY WHERE IT AGREES HERE: your person, your activity, units that normalise\n'
       || E'     and match. One that does not is refused and counted, never guessed into place. */\n'
       || E'  for x in select * from jsonb_array_elements(coalesce(p_doc->''exercise_links'', ''[]''::jsonb)) loop\n'
       || E'    begin\n'
       || E'      if not public.chronicle_link_ok(x->>''person'', x->>''exercise'', (x->>''activity'')::uuid) then\n'
       || E'        refused := refused + 1;\n'
       || E'      else\n'
       || E'        insert into public.chronicle_exercise_links (owner, person_id, exercise_id, activity, created_at)\n'
       || E'        values (me, x->>''person'', x->>''exercise'', (x->>''activity'')::uuid,\n'
       || E'                coalesce((x->>''created_at'')::timestamptz, now()))\n'
       || E'        on conflict (person_id, exercise_id) do nothing;\n'
       || E'        if found then n_link := n_link + 1; else refused := refused + 1; end if;\n'
       || E'      end if;\n'
       || E'    exception when others then refused := refused + 1;\n'
       || E'    end;\n'
       || E'  end loop;\n\n'
       || E'  for x in select * from jsonb_array_elements(coalesce(p_doc->''plans'', ''[]''::jsonb)) loop'),
      ('chronicle_import',
       E'''sets'', n_set,',
       E'''sets'', n_set, ''links'', n_link,')
    ) as v(fn, old, new)
  loop
    select pg_get_functiondef(p.oid) into v_src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.proname = r.fn;
    if v_src is null then raise exception 'function % not found', r.fn; end if;

    v_hits := (length(v_src) - length(replace(v_src, r.old, ''))) / length(r.old);
    if v_hits <> 1 then
      raise exception 'expected 1 of [%] in %, found %', r.old, r.fn, v_hits;
    end if;

    execute replace(v_src, r.old, r.new);
    v_done := v_done + 1;
  end loop;
  if v_done <> 13 then raise exception 'expected 13 substitutions, made %', v_done; end if;
end $mig$;
