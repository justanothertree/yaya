-- ⛔ DRAFT — A PROPOSAL FOR REVIEW. NOT APPLIED, NOT APPROVED FOR PRODUCTION, AND NOT TO BE RUN
-- AGAINST ANY PERSON'S REAL LOGS. Evan, 9 Nov 2026 (§19g(3)): "YES TO A SEPARATE CONVERSION DRAFT …
-- This is not approval to apply the conversion to production." It has been run only in the
-- `db guards` CI job's throwaway database, through a scratch branch, against fixtures.
-- It follows the sets, links and grid drafts.
--
-- STEP 3 OF RECORDED-ONCE — an already-linked person's typed cells move from circuit_logs to sets.
--
-- ── EVAN'S RULES, AND WHERE EACH IS KEPT ────────────────────────────────────────────────────
--
-- "Design and test conversion for already-linked people before switching their grid to canonical
--  sets. Keep account claiming separate."
--      circuit_convert_person refuses a person no account owns. It never sets an owner.
--
-- "Preserve originals and stable source identifiers."
--      circuit_logs is not changed, at all. Each set made from a log carries `source_log` (the row's
--      id) and `source_index` (the entry's position), and a unique index on the two.
--
-- "Re-running conversion must not duplicate records."
--      The unique index makes a second insert of the same entry do nothing, and a person already
--      converted is answered "already converted" without touching anything.
--
-- "Reconcile amounts by person, exercise, day and unit."
--      Before the marker flips, every (person, exercise, day) is summed from the logs and from the
--      sets just written, and any difference raises — the whole conversion rolls back. Unit is a
--      property of the exercise, carried through by its id, so a cell cannot change unit on the way.
--      ⚠️ AND IT IS AGAINST WHAT THE READERS WILL READ, not only what this run wrote. After the
--      switch they read EVERY set with no sitting, and a person can already hold one: the sets
--      writer takes `p_entry null` from the API, and an imported file restores them. Nothing before
--      the switch counts such a set (the grid sums only sets with a sitting, and the goals read the
--      logs), so it would start counting at the marker. Each one is reported as a problem by its id
--      and stops the person like any other. Its owner can take it back with chronicle_set_drop, or
--      the cutover can decide it should count. The reconciliation then compares the logs with every
--      set the readers will read, so one written between the scan and the marker raises too.
--
-- "Preserve date-only records without inventing times; report records that cannot be converted
--  rather than dropping them."
--      A set made from a log has a date and no sitting — nothing is given a time. An entry that cannot
--      become a set (an exercise no longer on the person's list, a value that is not a positive
--      number) is reported with its log id and position, and ANY such entry stops the person's
--      conversion: nothing is written and the marker stays off, so the grid goes on reading the logs
--      and nothing disappears from it. A `__total__` entry — an imported day with no breakdown — is
--      not a cell, is not converted, is counted in the report as kept, and is still read in place.
--
-- "Keep the existing reader until conversion is validated, then switch without missing or
--  double-counting records."
--      Every reader of the manual part asks circuit_people_converted, and the marker is set in the
--      same transaction as the sets it switches to. Before it, readers read the logs; after it, the
--      sets with no sitting. There is no moment at which both, or neither, are read.
--
-- "Freezing legacy writes belongs to that coordinated future cutover—not an independent production
--  change now."
--      Nothing here freezes, deletes or revokes anything. ⚠️ AND THAT IS WHY THIS MUST NOT BE APPLIED
--      ALONE: after a person's marker flips, a write from an older bundle straight into
--      circuit_logs would be kept but no longer read. The cutover needs the freeze; this does not
--      pretend to be it.
--
-- ── ROLLBACK, PER PERSON ────────────────────────────────────────────────────────────────────
--   delete from public.circuit_people_converted where person_id = '<id>';
--   delete from public.chronicle_sets where person_id = '<id>' and source_log is not null;
-- Readers go back to the logs, which were never changed. A manual part typed AFTER conversion lives
-- in a set with no source, and is the one thing a rollback must decide about — it says so. If it is
-- left, a re-run reports it as a problem rather than counting it beside the logs it replaced.

-- ── THE MARKER, IN A TABLE OF ITS OWN ───────────────────────────────────────────────────────
-- ⚠️ NOT A COLUMN ON circuit_people. That table's own policies let an owner update their row, so a
-- column there could be flipped from the browser, switching a person's grid away from logs that were
-- never converted. Deny-all here; only the conversion function writes it.

create table if not exists public.circuit_people_converted (
  person_id    text primary key references public.circuit_people(id) on delete cascade,
  converted_at timestamptz not null default now(),
  report       jsonb not null
);
alter table public.circuit_people_converted enable row level security;
revoke all on table public.circuit_people_converted from public, anon, authenticated;

alter table public.chronicle_sets add column if not exists source_log text;
alter table public.chronicle_sets add column if not exists source_index int;
create unique index if not exists chronicle_sets_from_log
  on public.chronicle_sets (source_log, source_index) where source_log is not null;

create or replace function public.circuit_is_converted(p_person text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.circuit_people_converted c where c.person_id = p_person)
$$;

-- ── THE CONVERSION ──────────────────────────────────────────────────────────────────────────
-- p_apply false is a dry run: the same report, nothing written. Run by the owner of the database
-- at a cutover, never by a member — no role is granted it.

create or replace function public.circuit_convert_person(p_person text, p_apply boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
  v_ex jsonb;
  v_problems jsonb := '[]'::jsonb;
  v_kept int := 0;
  v_empty int := 0;
  v_cells int := 0;
  v_total numeric := 0;
  v_inserted int := 0;
  v_mismatch int;
  r record;
  v_report jsonb;
begin
  select p.owner_user_id, p.exercises into v_owner, v_ex
    from public.circuit_people p where p.id = p_person
     for update;
  if not found then raise exception 'no such person'; end if;
  -- ⚠️ CLAIMING IS SEPARATE (§19e): a person no account owns is not converted, and nothing here
  -- gives one an owner
  if v_owner is null then
    raise exception 'only a person linked to an account is converted — claiming is a separate step';
  end if;
  if public.circuit_is_converted(p_person) then
    return jsonb_build_object('person', p_person, 'already', true, 'applied', false);
  end if;

  create temp table if not exists conv_candidates (
    log_id text, idx int, eid text, name text, on_day date, value numeric) on commit drop;
  delete from conv_candidates;

  for r in
    select l.id as log_id, l.date, en.value as entry, en.ordinality::int as idx
      from public.circuit_logs l
      cross join lateral jsonb_array_elements(
             case when jsonb_typeof(l.entries) = 'array' then l.entries else '[]'::jsonb end)
             with ordinality en
     where l.person_id = p_person
     order by l.date, l.id, en.ordinality
  loop
    if r.entry->>'eid' = '__total__' then
      v_kept := v_kept + 1;
    elsif coalesce(r.entry->>'val', '') !~ '^[0-9]+(\.[0-9]+)?$' then
      v_problems := v_problems || jsonb_build_array(jsonb_build_object(
        'log', r.log_id, 'index', r.idx, 'eid', r.entry->>'eid', 'val', r.entry->'val',
        'why', 'not a number of anything'));
    elsif (r.entry->>'val')::numeric = 0 then
      v_empty := v_empty + 1;
    elsif not exists (select 1 from jsonb_array_elements(
                        case when jsonb_typeof(v_ex) = 'array' then v_ex else '[]'::jsonb end) e
                       where e->>'id' = r.entry->>'eid' and nullif(btrim(e->>'name'), '') is not null) then
      v_problems := v_problems || jsonb_build_array(jsonb_build_object(
        'log', r.log_id, 'index', r.idx, 'eid', r.entry->>'eid', 'val', r.entry->'val',
        'why', 'that exercise is no longer on this person''s list, so it has no name to keep'));
    else
      insert into conv_candidates values (
        r.log_id, r.idx, r.entry->>'eid',
        (select btrim(e->>'name') from jsonb_array_elements(v_ex) e where e->>'id' = r.entry->>'eid' limit 1),
        r.date, (r.entry->>'val')::numeric);
      v_cells := v_cells + 1;
      v_total := v_total + (r.entry->>'val')::numeric;
    end if;
  end loop;

  -- ⚠️ A SET THE GRID HAS NEVER COUNTED, which the switch would start counting: no sitting, no
  -- source, held by the person's owner. That is exactly what the readers after the marker read.
  for r in
    select s.id, s.exercise_id, s.on_day, s.value from public.chronicle_sets s
     where s.person_id = p_person and s.entry is null and s.source_log is null and s.owner = v_owner
     order by s.on_day, s.exercise_id, s.id
  loop
    v_problems := v_problems || jsonb_build_array(jsonb_build_object(
      'set', r.id, 'eid', r.exercise_id, 'on', to_char(r.on_day, 'YYYY-MM-DD'), 'val', r.value,
      'why', 'a set with no sitting, which the grid has never counted — the switch would start counting it'));
  end loop;

  v_report := jsonb_build_object(
    'person', p_person, 'cells', v_cells, 'total', v_total, 'kept_totals', v_kept,
    'empty', v_empty, 'problems', v_problems,
    'days', (select count(distinct on_day) from conv_candidates));

  -- ⚠️ ANY PROBLEM STOPS THE PERSON: converting the rest would switch the grid to sets and leave the
  -- reported entries in logs nothing reads any more — a drop, by another name
  if jsonb_array_length(v_problems) > 0 or not p_apply then
    return v_report || jsonb_build_object('applied', false);
  end if;

  insert into public.chronicle_sets
    (owner, person_id, exercise_id, exercise_name, entry, on_day, value, counted, source_log, source_index)
  select v_owner, p_person, c.eid, left(c.name, 200), null, c.on_day, c.value, false, c.log_id, c.idx
    from conv_candidates c
  on conflict (source_log, source_index) where source_log is not null do nothing;
  get diagnostics v_inserted = row_count;

  -- ⚠️ RECONCILED BEFORE THE MARKER, by person, exercise and day: what the logs held and every set the
  -- readers will read once it is set must be the same number in every cell, or nothing happens at all.
  -- The predicate is the readers' own, not "has a source", so nothing can be counted that was not here
  select count(*) into v_mismatch from (
    select coalesce(a.eid, b.eid) as eid, coalesce(a.on_day, b.on_day) as on_day
      from (select eid, on_day, sum(value) as v from conv_candidates group by eid, on_day) a
      full join (select exercise_id as eid, on_day, sum(value) as v from public.chronicle_sets
                  where person_id = p_person and source_log is not null group by exercise_id, on_day) b
        on a.eid = b.eid and a.on_day = b.on_day
     where a.v is distinct from b.v) z;
  if v_mismatch > 0 then
    raise exception 'conversion of % does not reconcile in % cells — nothing was changed', p_person, v_mismatch;
  end if;

  insert into public.circuit_people_converted (person_id, report)
  values (p_person, v_report || jsonb_build_object('inserted', v_inserted));
  return v_report || jsonb_build_object('applied', true, 'inserted', v_inserted);
end $$;

-- ── THE READERS OF THE MANUAL PART, SWITCHED BY THE MARKER ──────────────────────────────────

-- the goals' grid half (replaces the links draft's body; everything else about it is unchanged)
create or replace function public.chronicle_manual_amount(p_activity uuid, p_from date, p_to date)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select sum((en->>'val')::numeric)
      from public.chronicle_exercise_links lk
      join public.circuit_people p on p.id = lk.person_id and p.owner_user_id = auth.uid()
      join public.circuit_logs l on l.person_id = lk.person_id and l.date >= p_from and l.date < p_to
      cross join lateral jsonb_array_elements(
             case when jsonb_typeof(l.entries) = 'array' then l.entries else '[]'::jsonb end) en
     where lk.owner = auth.uid() and lk.activity = p_activity
       and not public.circuit_is_converted(lk.person_id)
       and en->>'eid' = lk.exercise_id
       and (en->>'val') ~ '^[0-9]+(\.[0-9]+)?$'
       and (en->>'val')::numeric > 0
       and public.chronicle_link_ok(lk.person_id, lk.exercise_id, lk.activity)), 0)
  + coalesce((
    select sum(s.value)
      from public.chronicle_exercise_links lk
      join public.circuit_people p on p.id = lk.person_id and p.owner_user_id = auth.uid()
      join public.chronicle_sets s on s.person_id = lk.person_id and s.exercise_id = lk.exercise_id
     where lk.owner = auth.uid() and lk.activity = p_activity
       and public.circuit_is_converted(lk.person_id)
       and s.entry is null and s.owner = auth.uid()
       and s.on_day >= p_from and s.on_day < p_to
       and public.chronicle_link_ok(lk.person_id, lk.exercise_id, lk.activity)), 0)
$$;

-- the grid's manual part for converted people, for whoever may see them
create or replace function public.circuit_manual_sums(p_from date, p_to date)
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
  return jsonb_build_object(
    'converted', coalesce((select jsonb_agg(c.person_id order by c.person_id)
                             from public.circuit_people_converted c
                            where public.circuit_can_see_person(c.person_id)), '[]'::jsonb),
    'manual', coalesce((
      select jsonb_agg(jsonb_build_object('person', z.person_id, 'exercise', z.exercise_id,
                                          'on', to_char(z.on_day, 'YYYY-MM-DD'), 'value', z.v)
                       order by z.person_id, z.on_day, z.exercise_id)
        from (select s.person_id, s.exercise_id, s.on_day, sum(s.value) as v
                from public.chronicle_sets s
                join public.circuit_people p on p.id = s.person_id
               where s.entry is null and s.on_day >= p_from and s.on_day < p_to
                 and p.owner_user_id = s.owner
                 and public.circuit_is_converted(s.person_id)
                 and public.circuit_can_see_person(s.person_id)
               group by s.person_id, s.exercise_id, s.on_day) z), '[]'::jsonb));
end $$;

-- the cell writer (replaces the grid draft's body): the manual part from logs, or from sets with no
-- sitting once the person is converted — every refusal and its words unchanged
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
  v_owner uuid;
  v_conv boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
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

  perform public.chronicle_cell_lock(p_person, p_exercise, p_day);
  v_conv := public.circuit_is_converted(p_person);
  select owner_user_id into v_owner from public.circuit_people where id = p_person;

  select coalesce(sum(s.value), 0) into v_sessions
    from public.chronicle_sets s
    join public.circuit_people p on p.id = s.person_id
   where s.person_id = p_person and s.exercise_id = p_exercise and s.on_day = p_day
     and s.entry is not null and p.owner_user_id = s.owner;

  if v_conv then
    select coalesce(sum(s.value), 0) into v_manual from public.chronicle_sets s
     where s.person_id = p_person and s.exercise_id = p_exercise and s.on_day = p_day
       and s.entry is null and s.owner = v_owner;
    v_holding := 0;
  else
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
  end if;
  if v_holding > 1 then
    raise exception 'that day has % logs holding this exercise — put them together before changing it', v_holding;
  end if;
  if p_seen_sessions is distinct from v_sessions or p_seen_manual is distinct from v_manual then
    raise exception 'that day changed while you were typing — it is now % (% from sessions)',
      v_sessions + v_manual, v_sessions;
  end if;
  if p_total < v_sessions then
    raise exception 'sessions count % on that day — lower them in Chronicle, in that day''s log', v_sessions;
  end if;
  v_new := p_total - v_sessions;

  if v_conv then
    -- ⚠️ ONE MANUAL SET PER CELL AFTER THIS: the converted ones it replaces keep their originals in
    -- circuit_logs, which this never touches
    delete from public.chronicle_sets s
     where s.person_id = p_person and s.exercise_id = p_exercise and s.on_day = p_day
       and s.entry is null and s.owner = v_owner;
    if v_new > 0 then
      insert into public.chronicle_sets (owner, person_id, exercise_id, exercise_name, entry, on_day, value)
      select v_owner, p_person, p_exercise, left(btrim(e->>'name'), 200), null, p_day, v_new
        from public.circuit_people p, jsonb_array_elements(p.exercises) e
       where p.id = p_person and e->>'id' = p_exercise
       limit 1;
    end if;
    return jsonb_build_object('total', p_total, 'sessions', v_sessions, 'manual', v_new);
  end if;

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

revoke all on function public.circuit_is_converted(text) from public, anon, authenticated;
revoke all on function public.circuit_convert_person(text, boolean) from public, anon, authenticated;
revoke all on function public.circuit_manual_sums(date, date) from public, anon;
grant execute on function public.circuit_manual_sums(date, date) to authenticated;
revoke all on function public.circuit_cell_set(text, text, date, numeric, numeric, numeric) from public, anon;

-- ── THE DAY'S WORKOUT LINE, SWITCHED BY THE SAME MARKER ─────────────────────────────────────
-- chronicle_moments is live, so it is patched in place: the logs half reads only `__total__` entries
-- for a converted person (the imported days that were never cells), and a second half reads that
-- person's sets with no sitting. Each anchor must match its expected count or this raises.

do $mig$
declare
  r record;
  v_src text;
  v_hits int;
  v_done int := 0;
begin
  for r in
    select * from (values
      ('chronicle_moments',
       E'                   where jsonb_typeof(l.entries) = ''array''\n                     and (en->>''val'') ~ ''^[0-9.]+$''',
       E'                   where jsonb_typeof(l.entries) = ''array''\n'
       || E'                     and (not public.circuit_is_converted(p.id) or en->>''eid'' = ''__total__'')\n'
       || E'                     and (en->>''val'') ~ ''^[0-9.]+$''', 1),
      ('chronicle_moments',
       E'               where jsonb_typeof(l.entries) = ''array''\n                 and (en->>''val'') ~ ''^[0-9.]+$''',
       E'               where jsonb_typeof(l.entries) = ''array''\n'
       || E'                 and (not public.circuit_is_converted(p.id) or en->>''eid'' = ''__total__'')\n'
       || E'                 and (en->>''val'') ~ ''^[0-9.]+$''', 1),
      ('chronicle_moments',
       E'    ) t\n    where t.kind = ''rating''',
       E'      union all\n'
       || E'      /* a converted person''s typed cells, now sets with no sitting — the same line, by day */\n'
       || E'      select ''workout''::text, null::timestamptz, s.on_day::text,\n'
       || E'             (select string_agg(x.said, '' · '') from (\n'
       || E'                select coalesce(nullif(btrim(s2.exercise_name), ''''), ''something'')\n'
       || E'                       || '' '' || trim(to_char(sum(s2.value), ''FM999999990.##''))\n'
       || E'                       || coalesce('' '' || nullif(nullif(lower(btrim(max(ex.un))), ''''), ''other''), '''') as said\n'
       || E'                  from public.chronicle_sets s2\n'
       || E'                  left join lateral (select e->>''unit'' as un from jsonb_array_elements(pp.exercises) e\n'
       || E'                                      where e->>''id'' = s2.exercise_id limit 1) ex on true\n'
       || E'                 where s2.person_id = s.person_id and s2.on_day = s.on_day and s2.entry is null\n'
       || E'                 group by s2.exercise_id, s2.exercise_name\n'
       || E'                 order by s2.exercise_name limit 4) x),\n'
       || E'             null::int, nullif(btrim(pp.name), ''''),\n'
       || E'             (select count(distinct s3.exercise_id)::text from public.chronicle_sets s3\n'
       || E'               where s3.person_id = s.person_id and s3.on_day = s.on_day and s3.entry is null)\n'
       || E'        from (select distinct person_id, on_day from public.chronicle_sets\n'
       || E'               where entry is null and owner = v_me) s\n'
       || E'        join public.circuit_people pp on pp.id = s.person_id and pp.owner_user_id = v_me\n'
       || E'       where public.circuit_is_converted(s.person_id)\n'
       || E'         and s.on_day >= (v_from - interval ''1 day'')::date\n'
       || E'         and s.on_day <= (v_to + interval ''1 day'')::date\n'
       || E'    ) t\n    where t.kind = ''rating''', 1)
    ) as v(fn, old, new, want)
  loop
    select pg_get_functiondef(p.oid) into v_src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.proname = r.fn;
    if v_src is null then raise exception 'function % not found', r.fn; end if;
    v_hits := (length(v_src) - length(replace(v_src, r.old, ''))) / length(r.old);
    if v_hits <> r.want then
      raise exception 'expected % of [%] in %, found %', r.want, r.old, r.fn, v_hits;
    end if;
    execute replace(v_src, r.old, r.new);
    v_done := v_done + 1;
  end loop;
  if v_done <> 3 then raise exception 'expected 3 substitutions, made %', v_done; end if;
end $mig$;
