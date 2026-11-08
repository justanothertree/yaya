-- ⛔ DRAFT — NOT APPLIED TO PRODUCTION. Built on 9 Nov 2026 for implementation and isolated testing
-- only, under OPEN-DECISIONS §19g as Evan answered it that day. Applying it is a separate approval,
-- and it must follow docs/2026-11-08-chronicle-sets.DRAFT.sql, whose functions it replaces. It has
-- been run only in the `db guards` CI job's throwaway database, through a scratch branch.
--
-- STEP 2a OF RECORDED-ONCE — an exercise counts toward an activity, and the goals see it.
--
-- ── EVAN'S ANSWER, §19g(1) ──────────────────────────────────────────────────────────────────
--
-- "Link exercises to activities only when their actual normalized units match. Don't infer
-- compatibility from names or mix seconds with reps. Preserve unmapped legacy records; queue
-- ambiguous mappings instead of guessing."
--
--   chronicle_unit()              ONE table from a unit word to a canonical unit, or to nothing.
--                                 src/chronicle/units.ts is the same table, and a test compares
--                                 the two. Nothing means "cannot be compared", and it agrees with
--                                 NOTHING — not with another nothing.
--   chronicle_exercise_link()     refuses unless both sides normalise and agree, in words that say
--                                 which of the three it was. Names are never read.
--   chronicle_link_ok()           the same question at READ time, because an exercise's unit or an
--                                 activity's metric can change after the link was made. A link that
--                                 has stopped agreeing counts nothing until it agrees again.
--
-- ── HOW A SET REACHES A NUMBER, WITHOUT ANY NUMBER COUNTING IT TWICE ────────────────────────
--
-- ⚠️ WRITE-THROUGH, NOT READ-TIME SUMMING. A sitting's `amount` is read by six functions — its row,
-- the rail, the grids, the profile, the friends' feed and the goals. Teaching all six to add sets
-- would be six places to get one rule right. So a set counted during a sitting, for an exercise
-- linked to that sitting's activity, ADDS ITS VALUE TO THE SITTING'S AMOUNT in the same statement
-- that writes it, and is marked `counted`. Changing or deleting it takes back exactly what it
-- added. Every reader goes on reading `amount` and is unchanged.
--
--   the sitting       amount includes its counted sets. chronicle_entry_amount refuses an amount
--                     below them, saying how much they count, because lowering it would
--                     silently uncount reps the sets still say were done.
--   a move            to an activity whose unit differs takes the counted sets back OUT of the
--                     amount and uncounts them. The editor already clears a count whose unit
--                     changes ("sixty reps is not sixty pages"); this makes that clearing legal. A
--                     move between two activities in the same unit changes nothing.
--   a link made later counts sets from then on. It does not reach back into sittings already
--                     counted, which would change numbers that were final.
--   the grid          a contribution typed into the Circuit grid has no sitting. Until a person's
--                     logs are converted (a separate draft) it lives in `circuit_logs`, and the
--                     goals read it there through chronicle_manual_amount, for linked exercises
--                     only. A set WITH a sitting is never read there, and a grid contribution is
--                     never in an `amount` — the two halves cannot overlap.
--
-- ── ALSO HERE ───────────────────────────────────────────────────────────────────────────────
--   chronicle_tally   each ask may carry `from_day` and `to_day`, the window as LOCAL dates, which
--                     is what a date-only grid contribution has to be compared with. An ask without
--                     them counts exactly what it did before.
--   export / import   `exercise_links` travel, and each set says whether it was counted.
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────────────────────
--   1. re-run chronicle_tally, chronicle_entry_amount, chronicle_export and chronicle_import's
--      previous text, saved from pg_get_functiondef before applying (CLAUDE.md §4)
--   2. re-run docs/2026-11-08-chronicle-sets.DRAFT.sql's function bodies (it is idempotent for
--      functions), which restores the set writers without write-through
--   3. drop function public.chronicle_manual_amount(uuid, date, date);
--      drop function public.chronicle_my_exercises();
--      drop function public.chronicle_exercise_link(text, text, uuid);
--      drop function public.chronicle_link_ok(text, text, uuid);
--      drop table public.chronicle_exercise_links;
--      alter table public.chronicle_sets drop column counted;
--      drop function public.chronicle_unit(text);
-- ⚠️ Counted sets have already added to their sittings' amounts, and step 3 does not take that back:
-- the reps were done and the sitting says so. Undoing that is per sitting, by hand, and asked first.

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
    v_counted := true;
  elsif p_day is null or p_day > (now() at time zone 'utc')::date + 1 then
    raise exception 'that day has not come yet';
  end if;

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
  select s.id, s.entry, s.value, s.counted into r from public.chronicle_sets s
   where s.id = p_id and s.owner = auth.uid()
     for update;
  if not found then raise exception 'no such set'; end if;
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
  select s.id, s.entry, s.value, s.counted into r from public.chronicle_sets s
   where s.id = p_id and s.owner = auth.uid()
     for update;
  if not found then raise exception 'no such set'; end if;
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
  return;
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
   where lk.owner = auth.uid()
     and en->>'eid' = lk.exercise_id
     and (en->>'val') ~ '^[0-9]+(\.[0-9]+)?$'
     and (en->>'val')::numeric > 0
     and public.chronicle_link_ok(lk.person_id, lk.exercise_id, lk.activity)
$$;

revoke all on function public.chronicle_unit(text) from public, anon;
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
       E'n_set int := 0; n_link int := 0;'),
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
  if v_done <> 11 then raise exception 'expected 11 substitutions, made %', v_done; end if;
end $mig$;
