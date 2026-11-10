-- ✅ APPLIED to production 9 Nov 2026 (stamped 20261110025449 in UTC) as migration `chronicle_repeat_marks`,
-- step 5 of the Chronicle release, docs/2026-11-09-chronicle-release-plan.md. Production
-- recorded md5(statements[1]) = 26d53226fac700aeef1928ee75574620, this file's body byte for byte
-- (supabase/migrations/applied.md5).
--
-- 17d step 1: a repeating goal ticked by hand is ticked for its own window.
-- The body is docs/2026-11-08-chronicle-repeat-marks.DRAFT.sql after its
-- leading comment block, which holds the reasoning, the tests and the rollback. Before step 1,
-- check A held: the six functions the release patches were byte for byte what run C7 tested.

-- ── THE TABLE ───────────────────────────────────────────────────────────────────────────────

create table if not exists public.chronicle_goal_marks (
  goal        uuid not null references public.chronicle_goals(id) on delete cascade,
  -- ⚠️ THE SCOPE IS PART OF THE KEY. A daily mark on a Sunday and a weekly mark for the week
  -- starting that Sunday have the same goal and the same date; without the scope, a goal changed
  -- from daily to weekly would read one day's tick as the whole week's.
  scope       text not null,
  -- the local start of the window — a day, a Sunday, a 1st, a 1 January — sent by the client,
  -- exactly as the tally's windows are, because local midnight is the client's
  window_from date not null,
  -- the same window as two instants, so the server can tell which mark is CURRENT without knowing
  -- the member's zone (the profile, step 3) and refuse one that has not begun
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  progress    numeric not null default 0,
  done_at     timestamptz,
  set_at      timestamptz not null default now(),
  primary key (goal, scope, window_from),
  constraint chronicle_goal_marks_scope_known
    check (scope = any (array['day', 'week', 'month', 'quarter', 'year'])),
  constraint chronicle_goal_marks_progress_range check (progress >= 0 and progress <= 1e9),
  -- ⚠️ FACTS ABOUT THE ROW ARE CONSTRAINTS, so the writer and the import cannot disagree about them
  constraint chronicle_goal_marks_window_shape check (
    ends_at > starts_at
    and ends_at <= starts_at + interval '367 days'
    -- any zone is within fourteen hours of UTC, so local midnight is on the UTC date or either side
    and abs((starts_at at time zone 'utc')::date - window_from) <= 1)
);

-- deny-all, and the revoke names anon because pg_default_acl hands it arwdDxtm on every new table
alter table public.chronicle_goal_marks enable row level security;
revoke all on table public.chronicle_goal_marks from public, anon, authenticated;

-- ── THE WRITER ──────────────────────────────────────────────────────────────────────────────

create or replace function public.chronicle_goal_mark(
  p_goal uuid, p_from date, p_starts timestamptz, p_ends timestamptz,
  p_progress numeric, p_done boolean
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_scope text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  -- ⚠️ ONLY A REPEATING GOAL HAS WINDOWS. A one-off keeps using chronicle_goal_progress, whose
  -- single row IS its single window — so a mark on one would be a second answer to one question.
  select g.scope into v_scope from public.chronicle_goals g
   where g.id = p_goal and g.owner = auth.uid() and g.repeat_every is not null;
  if v_scope is null then raise exception 'no such repeating goal'; end if;
  if p_from is null or p_starts is null or p_ends is null then
    raise exception 'that window does not make sense';
  end if;
  -- ⚠️ NO WINDOW THAT HAS NOT BEGUN. Ticking tomorrow's floss today is a claim about a day nobody
  -- has had. An hour of slack, because the instants come from the member's clock.
  if p_starts > now() + interval '1 hour' then
    raise exception 'that window has not started';
  end if;

  -- null means "I am not talking about this", as everywhere else in this room (CLAUDE.md §8)
  insert into public.chronicle_goal_marks as m
    (goal, scope, window_from, starts_at, ends_at, progress, done_at)
  values (p_goal, v_scope, p_from, p_starts, p_ends,
          greatest(0, least(coalesce(p_progress, 0), 1e9)),
          case when p_done then now() end)
  on conflict (goal, scope, window_from) do update
     set progress  = case when p_progress is null then m.progress
                          else greatest(0, least(p_progress, 1e9)) end,
         done_at   = case when p_done is null then m.done_at
                          when p_done then coalesce(m.done_at, now())
                          else null end,
         starts_at = excluded.starts_at,
         ends_at   = excluded.ends_at,
         set_at    = now();
exception
  -- the shape check is the one a bad window meets; say it in the room's words, not the table's
  when check_violation then raise exception 'that window does not make sense';
end $$;

revoke all on function public.chronicle_goal_mark(uuid, date, timestamptz, timestamptz, numeric, boolean)
  from public, anon;
grant execute on function public.chronicle_goal_mark(uuid, date, timestamptz, timestamptz, numeric, boolean)
  to authenticated;

-- ── THE READER ──────────────────────────────────────────────────────────────────────────────
-- Asked for the windows on screen, the way chronicle_tally is: the client sends (goal, from) pairs
-- and gets back the marks that exist, keyed `<goal>@<YYYY-MM-DD>` like the client's windowKey. A
-- window with no mark is untouched — progress 0, not done — which `asOf` in marks.ts supplies.
-- ⚠️ to_char, not ::text, for the key's date: ::text follows DateStyle, and a session set to
-- 'SQL, DMY' would key every mark 07/11/2026 and the client would find none of them.

create or replace function public.chronicle_goal_marks_for(p_asks jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_asks is null or jsonb_typeof(p_asks) <> 'array' then
    raise exception 'asks must be a list';
  end if;
  -- the client's ASKS_AT_ONCE, the same wall chronicle_tally has
  if jsonb_array_length(p_asks) > 1200 then raise exception 'too many windows in one ask'; end if;

  return jsonb_build_object(
    'marks', coalesce((
      select jsonb_object_agg(
               m.goal::text || '@' || to_char(m.window_from, 'YYYY-MM-DD'),
               jsonb_build_object('progress', m.progress, 'done', m.done_at is not null))
        from (select distinct (a->>'id')::uuid as id, (a->>'from')::date as f
                from jsonb_array_elements(p_asks) a) q
        -- ⚠️ YOURS ONLY, and only at the goal's CURRENT scope — see the note on the key
        join public.chronicle_goals g on g.id = q.id and g.owner = auth.uid()
        join public.chronicle_goal_marks m
          on m.goal = g.id and m.scope = g.scope and m.window_from = q.f
    ), '{}'::jsonb),
    -- the ticks from before marks existed: one moment per repeating goal, placed by the client
    'legacy', coalesce((
      select jsonb_object_agg(g.id::text, round(extract(epoch from g.done_at) * 1000))
        from public.chronicle_goals g
       where g.owner = auth.uid() and g.repeat_every is not null and g.done_at is not null
         and g.id in (select (a->>'id')::uuid from jsonb_array_elements(p_asks) a)
    ), '{}'::jsonb));
end $$;

revoke all on function public.chronicle_goal_marks_for(jsonb) from public, anon;
grant execute on function public.chronicle_goal_marks_for(jsonb) to authenticated;

-- ── THE EXPORT AND THE IMPORT CARRY THEM ────────────────────────────────────────────────────
-- Patched in place rather than retyped, the way 20261103200705 did it: each substitution must
-- match EXACTLY ONCE in the live text or the migration raises, so a function that has moved on
-- since this was written stops the migration instead of being half-patched.
--
-- ⚠️ THE MARKS RIDE INSIDE EACH GOAL, like notes inside a sitting, so a file cannot carry a mark
-- for a goal it does not also describe — and the import still checks the goal is yours, repeating,
-- and not somebody else's id typed into a file.

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
       E'''created_at'', g.created_at, ''updated_at'', g.updated_at)',
       E'''created_at'', g.created_at, ''updated_at'', g.updated_at,\n'
       || E'               ''marks'', coalesce((\n'
       || E'                  select jsonb_agg(jsonb_build_object(\n'
       || E'                           ''scope'', mk.scope, ''from'', mk.window_from,\n'
       || E'                           ''starts_at'', mk.starts_at, ''ends_at'', mk.ends_at,\n'
       || E'                           ''progress'', mk.progress, ''done_at'', mk.done_at,\n'
       || E'                           ''set_at'', mk.set_at)\n'
       || E'                         order by mk.scope, mk.window_from)\n'
       || E'                    from public.chronicle_goal_marks mk where mk.goal = g.id\n'
       || E'               ), ''[]''::jsonb))'),
      ('chronicle_import',
       E'n_rout int := 0; n_plan int := 0;',
       E'n_rout int := 0; n_plan int := 0;\n  n_mark int := 0; mk jsonb;'),
      ('chronicle_import',
       E'+ coalesce(jsonb_array_length(p_doc->''plans''), 0);',
       E'+ coalesce(jsonb_array_length(p_doc->''plans''), 0)\n'
       || E'         /* the marks ride inside the goals, so the outer wall counts them too */\n'
       || E'         + coalesce((select sum(jsonb_array_length(g->''marks''))\n'
       || E'                       from jsonb_array_elements(coalesce(p_doc->''goals'', ''[]''::jsonb)) g\n'
       || E'                      where jsonb_typeof(g->''marks'') = ''array''), 0);'),
      ('chronicle_import',
       E'  for x in select * from jsonb_array_elements(coalesce(p_doc->''plans'', ''[]''::jsonb)) loop',
       E'  /* ⚠️ MARKS AFTER EVERY GOAL, for the same reason entries come after activities: what they\n'
       || E'     hang off has to be there first. A goal the file names but the account already had is\n'
       || E'     still yours, so its missing windows go back too — add-never-replace on the key. The\n'
       || E'     writer''s own rules are kept here as well: yours, repeating, and begun. */\n'
       || E'  for x in select * from jsonb_array_elements(coalesce(p_doc->''goals'', ''[]''::jsonb)) loop\n'
       || E'    continue when jsonb_typeof(x->''marks'') is distinct from ''array'';\n'
       || E'    for mk in select * from jsonb_array_elements(x->''marks'') loop\n'
       || E'      begin\n'
       || E'        if not exists (select 1 from public.chronicle_goals g\n'
       || E'                        where g.id = (x->>''id'')::uuid and g.owner = me\n'
       || E'                          and g.repeat_every is not null)\n'
       || E'           or (mk->>''starts_at'')::timestamptz > now() + interval ''1 hour'' then\n'
       || E'          refused := refused + 1;\n'
       || E'        else\n'
       || E'          insert into public.chronicle_goal_marks\n'
       || E'            (goal, scope, window_from, starts_at, ends_at, progress, done_at, set_at)\n'
       || E'          values (\n'
       || E'            (x->>''id'')::uuid, mk->>''scope'', (mk->>''from'')::date,\n'
       || E'            (mk->>''starts_at'')::timestamptz, (mk->>''ends_at'')::timestamptz,\n'
       || E'            greatest(0, least(coalesce((mk->>''progress'')::numeric, 0), 1e9)),\n'
       || E'            (mk->>''done_at'')::timestamptz,\n'
       || E'            coalesce((mk->>''set_at'')::timestamptz, now()))\n'
       || E'          on conflict (goal, scope, window_from) do nothing;\n'
       || E'          if found then n_mark := n_mark + 1; else refused := refused + 1; end if;\n'
       || E'        end if;\n'
       || E'      exception when others then refused := refused + 1;\n'
       || E'      end;\n'
       || E'    end loop;\n'
       || E'  end loop;\n\n'
       || E'  for x in select * from jsonb_array_elements(coalesce(p_doc->''plans'', ''[]''::jsonb)) loop'),
      /* ⚠️ KEYED ON `'plans', n_plan, ` ALONE, not the whole result line: the day-notes draft adds
         `'notes', n_note,` to that line, and a whole-line anchor made the two drafts work in one
         order only */
      ('chronicle_import',
       E'''plans'', n_plan, ',
       E'''plans'', n_plan, ''marks'', n_mark, ')
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
