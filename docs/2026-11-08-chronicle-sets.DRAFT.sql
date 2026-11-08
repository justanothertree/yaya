-- ⛔ DRAFT — NOT APPLIED TO PRODUCTION. Built on 8 Nov 2026 for implementation and LOCAL testing
-- only, under OPEN-DECISIONS §15b, §15c and §15d as Evan answered them that day. Applying it is a
-- separate approval. It has been run only in the `db guards` CI job's throwaway database, through
-- a scratch branch. When it is applied for real, this header is replaced by the migration's name.
--
-- STEP 1 OF docs/2026-11-07-chronicle-recorded-once.md §2f — "record once, see it in both places".
-- One table, the canonical row for a quantity of one exercise on one day, whichever interface it
-- was typed into, and the writers that keep its rules. NOTHING READS IT YET: the tally, the
-- Circuit grid and chronicle_moments learn it in step 2, one reader at a time, so applying this
-- file changes no number anybody sees.
--
-- ── EVAN'S ANSWERS, AND WHERE EACH IS KEPT ──────────────────────────────────────────────────
--
-- §15b  "Exercise records retain stable exercise identity plus a snapshot of the name when
--       recorded. Deleting an exercise definition must not destroy historical records. Never
--       reconnect exercises by matching names."
--         `exercise_id` is the identity. `exercise_name` is copied FROM THE DEFINITION by the
--         writer — never taken from the caller — at the moment the set is written. The reader
--         hands back both that and the definition's current name, which is null once the
--         exercise is gone; nothing anywhere looks an exercise up by its name. A person's row
--         being deleted leaves the set in place with `person_id` null, rather than cascading.
--
-- §15c  "Moving a sitting between activities does not change which exercises its sets
--       represent. … Editing its start across a date boundary must update associated set dates
--       atomically, keeping feeds and tallies consistent without duplicates."
--         A move touches no set: chronicle_entry_edit's `p_activity` is the only thing it sets.
--         A start edited across midnight goes through chronicle_entry_edit_day, which edits the
--         sitting and moves its sets' day in ONE function call — one transaction, so no reader
--         can see the two disagree — and UPDATES the rows in place, so nothing can be counted
--         twice. A running sitting's start has the same door, chronicle_running_fix_day.
--         ⚠️ THE DAY IS SENT, NOT DERIVED, because it is a LOCAL date and the server has no zone.
--         It is carried on the row rather than read off the sitting because the Circuit grid is
--         social: a friend looking at your column must see a set on the day YOU did it, not on
--         whatever day the instant falls in where they are.
--
-- §15d  "Account-linked people may use canonical sets while unclaimed people retain
--       circuit_logs."
--         The writer refuses any `circuit_people` row whose `owner_user_id` is not the caller,
--         so a set can only ever be written for an account-linked person, by that account.
--         `circuit_logs` is not touched here and nothing is migrated: moving a claimed person's
--         rows is its own reviewable item, parked behind its four requirements (§15d).
--
-- ── PERMISSIONS ─────────────────────────────────────────────────────────────────────────────
-- The house pattern: RLS on, zero policies, no grants, reached only through SECURITY DEFINER
-- functions that check auth.uid(). ⚠️ circuit_people keeps its rules in RLS POLICIES, and a
-- SECURITY DEFINER function does not consult them — so every function here checks the person's
-- `owner_user_id` and the entry's `owner` by hand, on its own first lines.
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────────────────────
--   1. re-run chronicle_export and chronicle_import's previous text, saved from
--      pg_get_functiondef before this is applied (CLAUDE.md §4's baseline-first rule)
--   2. drop function public.chronicle_running_fix_day(timestamptz, uuid, date);
--      drop function public.chronicle_entry_edit_day(uuid, timestamptz, timestamptz, uuid, date);
--      drop function public.chronicle_sets_between(date, date);
--      drop function public.chronicle_set_drop(uuid);
--      drop function public.chronicle_set_change(uuid, numeric);
--      drop function public.chronicle_set_add(text, text, numeric, date, uuid);
--      drop table public.chronicle_sets;
-- Nothing reads the table until step 2, so until then dropping it loses only what was written
-- to it — export first and ask before doing that, because those are somebody's reps.

-- ── THE TABLE ───────────────────────────────────────────────────────────────────────────────

create table if not exists public.chronicle_sets (
  id            uuid primary key default gen_random_uuid(),
  owner         uuid not null references public.profiles(user_id) on delete cascade,
  -- whose Circuit grid the exercise is defined on: the owner's own person. SET NULL, NOT CASCADE:
  -- a person's row going does not unmake what was done, and the set keeps its id and its name.
  person_id     text references public.circuit_people(id) on delete cascade,
  -- an id inside that person's `exercises` jsonb — no foreign key is possible into a blob, which
  -- is exactly why the name is also kept (§15b)
  exercise_id   text not null,
  -- the exercise's name WHEN THE SET WAS WRITTEN, copied from the definition by the writer
  exercise_name text not null,
  -- the sitting it was counted during, or null for one typed into the Circuit's grid. CASCADE:
  -- deleting the sitting deletes what it counted, and the grid loses exactly what it put there.
  entry         uuid references public.chronicle_entries(id) on delete cascade,
  -- the LOCAL day it counts for, sent by the client — see §15c above for why it is carried
  on_day        date not null,
  value         numeric not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint chronicle_sets_value check (value > 0 and value <= 1e9),
  constraint chronicle_sets_named check (char_length(btrim(exercise_name)) between 1 and 200),
  constraint chronicle_sets_exercise check (char_length(exercise_id) between 1 and 200)
);
create index if not exists chronicle_sets_mine on public.chronicle_sets (owner, on_day);
create index if not exists chronicle_sets_by_entry on public.chronicle_sets (entry) where entry is not null;

alter table public.chronicle_sets enable row level security;
revoke all on table public.chronicle_sets from public, anon, authenticated;

-- ── THE WRITERS ─────────────────────────────────────────────────────────────────────────────

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
  v_id uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(v_me), false) then
    raise exception 'your account is suspended';
  end if;
  if p_value is null or p_value <= 0 or p_value > 1e9 then
    raise exception 'that is not a number of anything';
  end if;

  -- ⚠️ THE PERSON BY HAND: circuit_people's eight policies do not apply in here (§15d)
  select p.exercises into v_ex from public.circuit_people p
   where p.id = p_person;
  if not found then raise exception 'no such person of yours'; end if;

  -- ⚠️ THE NAME FROM THE DEFINITION, NEVER FROM THE CALLER (§15b). A name the client sends could
  -- be anything; the one in the person's own list is what the exercise was called right now.
  select nullif(btrim(e->>'name'), '') into v_name
    from jsonb_array_elements(case when jsonb_typeof(v_ex) = 'array' then v_ex else '[]'::jsonb end) e
   where e->>'id' = p_exercise
   limit 1;
  if v_name is null then raise exception 'no such exercise'; end if;

  if p_entry is not null then
    select e.started_at into v_start from public.chronicle_entries e
     where e.id = p_entry and e.owner = v_me;
    if not found then raise exception 'no such session'; end if;
    -- every local day on Earth is within one of UTC's: anything further is not that day
    if p_day is null or abs(p_day - (v_start at time zone 'utc')::date) > 1 then
      raise exception 'that is not the day that session starts on';
    end if;
  elsif p_day is null or p_day > (now() at time zone 'utc')::date + 1 then
    raise exception 'that day has not come yet';
  end if;

  insert into public.chronicle_sets (owner, person_id, exercise_id, exercise_name, entry, on_day, value)
  values (v_me, p_person, p_exercise, left(v_name, 200), p_entry, p_day, p_value)
  returning id into v_id;
  return v_id;
end $$;

-- a correction: one row, one number, both readings move together because both read it
create or replace function public.chronicle_set_change(p_id uuid, p_value numeric)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if p_value is null or p_value <= 0 or p_value > 1e9 then
    raise exception 'that is not a number of anything';
  end if;
  update public.chronicle_sets set value = p_value, updated_at = now()
   where id = p_id and owner = auth.uid();
  if not found then raise exception 'no such set'; end if;
end $$;

create or replace function public.chronicle_set_drop(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  delete from public.chronicle_sets where id = p_id and owner = auth.uid();
  if not found then raise exception 'no such set'; end if;
end $$;

-- ── THE READER ──────────────────────────────────────────────────────────────────────────────
-- Your own sets on [p_from, p_to), half-open like every range here.
--
-- ⚠️ TWO NAMES, AND NEITHER IS LOOKED UP BY NAME. `name` is the snapshot taken when the set was
-- written; `now` is what the same EXERCISE ID is called in your person's list today, or null when
-- that exercise — or that person — is gone. A renamed exercise reads by its new name, a deleted one
-- by its old, and an exercise deleted and re-made with the same name is a different id and stays
-- apart (§15b).

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
                        and e->>'name' = s.exercise_name
                      limit 1),
             -- ⚠️ to_char, never ::text: the session's DateStyle would print "08/11/2026"
             'on', to_char(s.on_day, 'YYYY-MM-DD'), 'value', s.value)
           order by s.on_day, s.created_at, s.id)
      from public.chronicle_sets s
     where s.owner = auth.uid() and s.on_day >= p_from and s.on_day < p_to
  ), '[]'::jsonb);
end $$;

-- ── A SITTING'S START, AND ITS SETS' DAY, IN ONE CALL (§15c) ────────────────────────────────
-- ⚠️ A WRAPPER RATHER THAN A REWRITE. chronicle_entry_edit is live, carries a comment trail about
-- every silent erasure it has had, and has four callers' worth of contract; this calls it as it is
-- and then moves the sets, inside the same function call, so a refusal from either half rolls back
-- both. The room uses it only for a sitting that has sets, so until step 2 ships nothing calls it.

create or replace function public.chronicle_entry_edit_day(
  p_id uuid, p_from timestamptz, p_to timestamptz, p_activity uuid, p_day date
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  /* ⚠️ SAID HERE, NOT LEFT TO THE FUNCTION IT WRAPS: the standing visibility guards ask every
     member-callable writer to refuse a suspended member in its own body, and the first run of
     this draft failed them for leaning on chronicle_entry_edit's check. A rule kept one call
     down is a rule the next edit to that call can drop. */
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if p_from is not null and (p_day is null or abs(p_day - (p_from at time zone 'utc')::date) > 1) then
    raise exception 'that is not the day that session starts on';
  end if;
  -- null leaves the note alone: the same promise every editor of a sitting makes
  perform public.chronicle_entry_edit(p_id, p_from, p_to, null, p_activity);
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
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  perform public.chronicle_running_fix(p_from, p_activity);
  select e.id, e.started_at into v_id, v_start from public.chronicle_entries e
   where e.owner = auth.uid() and e.ended_at is null
   order by e.started_at desc limit 1;
  if v_id is null then return; end if;
  if p_day is null or abs(p_day - (v_start at time zone 'utc')::date) > 1 then
    raise exception 'that is not the day that session starts on';
  end if;
  update public.chronicle_sets set on_day = p_day, updated_at = now()
   where entry = v_id and owner = auth.uid() and on_day is distinct from p_day;
end $$;

revoke all on function public.chronicle_set_add(text, text, numeric, date, uuid) from public, anon;
revoke all on function public.chronicle_set_change(uuid, numeric) from public, anon;
revoke all on function public.chronicle_set_drop(uuid) from public, anon;
revoke all on function public.chronicle_sets_between(date, date) from public, anon;
revoke all on function public.chronicle_entry_edit_day(uuid, timestamptz, timestamptz, uuid, date) from public, anon;
revoke all on function public.chronicle_running_fix_day(timestamptz, uuid, date) from public, anon;
grant execute on function public.chronicle_set_add(text, text, numeric, date, uuid) to authenticated;
grant execute on function public.chronicle_set_change(uuid, numeric) to authenticated;
grant execute on function public.chronicle_set_drop(uuid) to authenticated;
grant execute on function public.chronicle_sets_between(date, date) to authenticated;
grant execute on function public.chronicle_entry_edit_day(uuid, timestamptz, timestamptz, uuid, date) to authenticated;
grant execute on function public.chronicle_running_fix_day(timestamptz, uuid, date) to authenticated;

-- ── THE EXPORT AND THE IMPORT CARRY THEM ────────────────────────────────────────────────────
-- Patched in place, each substitution matching EXACTLY ONCE or the migration raises. ⚠️ Every
-- anchor is one the marks, day-notes and weekday drafts leave alone, so the four apply in any
-- order — the mistake db630f5 fixed between the first two.
--
-- ⚠️ ON THE WAY BACK IN, A PERSON THAT IS NOT YOURS HERE BECOMES NONE — the set keeps its exercise
-- id and its name, and is never re-attached to an exercise by matching names (§15b). A set naming
-- a sitting that is not yours is refused outright, because that would put your reps on somebody
-- else's sitting from the other side.

do $mig$
declare
  r record;
  v_src text;
  v_hits int;
  v_done int := 0;
begin
  for r in
    select * from (values
      ('chronicle_export',
       E'''goals'', coalesce((',
       E'''sets'', coalesce((\n'
       || E'      select jsonb_agg(jsonb_build_object(\n'
       || E'               ''id'', s.id, ''person'', s.person_id, ''exercise'', s.exercise_id,\n'
       || E'               ''name'', s.exercise_name, ''entry'', s.entry, ''on_day'', s.on_day,\n'
       || E'               ''value'', s.value, ''created_at'', s.created_at, ''updated_at'', s.updated_at)\n'
       || E'             order by s.on_day, s.created_at, s.id)\n'
       || E'        from public.chronicle_sets s where s.owner = me), ''[]''::jsonb),\n'
       || E'    ''goals'', coalesce(('),
      ('chronicle_import',
       E'n_ent int := 0;',
       E'n_ent int := 0; n_set int := 0;'),
      ('chronicle_import',
       E'+ coalesce(jsonb_array_length(p_doc->''entries''), 0)',
       E'+ coalesce(jsonb_array_length(p_doc->''entries''), 0)\n'
       || E'         + coalesce(jsonb_array_length(p_doc->''sets''), 0)'),
      ('chronicle_import',
       E'  for x in select * from jsonb_array_elements(coalesce(p_doc->''plans'', ''[]''::jsonb)) loop',
       E'  /* ⚠️ SETS AFTER THE SITTINGS THEY HANG OFF, with the writer''s rules: a sitting that is\n'
       || E'     yours or none, a number of something, a day that has come, and a name. */\n'
       || E'  for x in select * from jsonb_array_elements(coalesce(p_doc->''sets'', ''[]''::jsonb)) loop\n'
       || E'    begin\n'
       || E'      if nullif(x->>''exercise'', '''') is null\n'
       || E'         or nullif(btrim(x->>''name''), '''') is null\n'
       || E'         or (x->>''on_day'') is null\n'
       || E'         or (x->>''on_day'')::date > (now() at time zone ''utc'')::date + 1\n'
       || E'         or coalesce((x->>''value'')::numeric, 0) <= 0\n'
       || E'         or (x->>''value'')::numeric > 1e9\n'
       || E'         or ((x->>''entry'') is not null\n'
       || E'             and not exists (select 1 from public.chronicle_entries e\n'
       || E'                              where e.id = (x->>''entry'')::uuid and e.owner = me)) then\n'
       || E'        refused := refused + 1;\n'
       || E'      else\n'
       || E'        insert into public.chronicle_sets\n'
       || E'          (id, owner, person_id, exercise_id, exercise_name, entry, on_day, value,\n'
       || E'           created_at, updated_at)\n'
       || E'        values (\n'
       || E'          (x->>''id'')::uuid, me,\n'
       || E'          x->>''person'',\n'
       || E'          x->>''exercise'', left(btrim(x->>''name''), 200), (x->>''entry'')::uuid,\n'
       || E'          (x->>''on_day'')::date, (x->>''value'')::numeric,\n'
       || E'          coalesce((x->>''created_at'')::timestamptz, now()),\n'
       || E'          coalesce((x->>''updated_at'')::timestamptz, now()))\n'
       || E'        on conflict (id) do nothing;\n'
       || E'        if found then n_set := n_set + 1; else refused := refused + 1; end if;\n'
       || E'      end if;\n'
       || E'    exception when others then refused := refused + 1;\n'
       || E'    end;\n'
       || E'  end loop;\n\n'
       || E'  for x in select * from jsonb_array_elements(coalesce(p_doc->''plans'', ''[]''::jsonb)) loop'),
      ('chronicle_import',
       E'''entries'', n_ent,',
       E'''entries'', n_ent, ''sets'', n_set,')
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
  if v_done <> 5 then raise exception 'expected 5 substitutions, made %', v_done; end if;
end $mig$;
