-- ✅ APPLIED to production 9 Nov 2026 (stamped 20261110025407 in UTC) as migration `chronicle_weekdays`,
-- step 4 of the Chronicle release, docs/2026-11-09-chronicle-release-plan.md. Production
-- recorded md5(statements[1]) = 7312ca68bd4f64f0df7b27bd81a43127, this file's body byte for byte
-- (supabase/migrations/applied.md5).
--
-- 19c: a goal asks about its own days.
-- The body is docs/2026-11-08-chronicle-weekdays.DRAFT.sql after its
-- leading comment block, which holds the reasoning, the tests and the rollback. Before step 1,
-- check A held: the six functions the release patches were byte for byte what run C7 tested.

-- ── THE TABLE ───────────────────────────────────────────────────────────────────────────────

create table if not exists public.chronicle_goal_days (
  goal      uuid not null references public.chronicle_goals(id) on delete cascade,
  -- carried so the writer and the export can select by owner without a join
  owner     uuid not null references public.profiles(user_id) on delete cascade,
  -- the local day this schedule starts on, as the client names it
  from_day  date not null,
  -- seven bits, Sunday = bit 0 (Date.getDay()), and never zero: a goal for no days is a goal in
  -- no list, which the room has already had to fix once for quarter goals
  days      smallint not null,
  set_at    timestamptz not null default now(),
  primary key (goal, from_day),
  constraint chronicle_goal_days_mask check (days between 1 and 127)
);

-- ⚠️ "ONLY A REPEATING DAY GOAL TAKES A NEW SCHEDULE" CANNOT BE A CHECK, because it is a fact about
-- a row in another table. The writer and the import both keep it, in the same words.

-- ── DENY-ALL, EXPLICITLY, INCLUDING anon ────────────────────────────────────────────────────
-- pg_default_acl on `public` hands arwdDxtm to anon and authenticated on every new table, so
-- deny-all is something this table has to be given. A revoke aimed at PUBLIC leaves anon alone.

alter table public.chronicle_goal_days enable row level security;
revoke all on table public.chronicle_goal_days from public, anon, authenticated;

-- ── THE WRITER ──────────────────────────────────────────────────────────────────────────────

create or replace function public.chronicle_goal_days_set(p_goal uuid, p_days smallint, p_from date)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(v_me), false) then
    raise exception 'your account is suspended';
  end if;
  if p_days is null or p_days < 1 or p_days > 127 then
    raise exception 'a goal has to be for at least one day';
  end if;

  -- ⚠️ THE FORWARD-ONLY RULE, KEPT BY THE SERVER RATHER THAN TRUSTED TO THE CLIENT. A schedule
  -- dated in the past is a rewrite of history by another name. The server does not know the
  -- member's zone, and every local "today" on Earth falls within a day either side of UTC's, so the
  -- bound is UTC's date minus one. That leaves a one-day window in which a member far east of UTC
  -- could date a change to their own yesterday — named here rather than discovered.
  if p_from is null or p_from < (now() at time zone 'utc')::date - 1 then
    raise exception 'a schedule change starts today or later';
  end if;

  -- ownership and shape, by hand: the table is deny-all and this function is the only door
  if not exists (
    select 1 from public.chronicle_goals g
     where g.id = p_goal and g.owner = v_me
       and g.scope = 'day' and g.repeat_every is not null
  ) then
    raise exception 'no such repeating daily goal';
  end if;

  -- changing it twice on one day replaces that day's entry rather than stacking two
  insert into public.chronicle_goal_days (goal, owner, from_day, days)
  values (p_goal, v_me, p_from, p_days)
  on conflict (goal, from_day) do update set days = excluded.days, set_at = now();
end $$;

revoke all on function public.chronicle_goal_days_set(uuid, smallint, date) from public, anon;
grant execute on function public.chronicle_goal_days_set(uuid, smallint, date) to authenticated;

-- ── THE READERS CARRY THEM ──────────────────────────────────────────────────────────────────
-- Patched in place rather than retyped, the way 20261103200705 did it: each substitution must
-- match EXACTLY ONCE in the live text or the migration raises, so a function that has moved on
-- since this was written stops the migration instead of being half-patched.
--
-- ⚠️ AND EVERY ANCHOR IS ONE THAT NEITHER OF THE OTHER TWO DRAFTS REWRITES. The marks draft and the
-- day-notes draft patch these same two functions; an anchor one of them consumes would make the
-- three work in one order only, which is the mistake db630f5 fixed between the first two.
--
--   chronicle_goals_mine   each goal gains `made` (created_at, epoch ms) and `days`
--   chronicle_export       each goal gains `days`, like `marks`: a schedule cannot travel in a
--                          file without the goal it describes
--   chronicle_import       puts `days` back for a goal THIS IMPORT CREATED, and for no other. A
--                          goal already here keeps the history it has; interleaving rows from a
--                          file into it would re-judge days that were already judged, which is
--                          rule 1 broken through the back door.

do $mig$
declare
  r record;
  v_src text;
  v_hits int;
  v_done int := 0;
begin
  for r in
    select * from (values
      ('chronicle_goals_mine',
       E'''at'', extract(epoch from g.updated_at) * 1000',
       E'''at'', extract(epoch from g.updated_at) * 1000,\n'
       || E'             /* the day it began asking — before it, nothing was met or missed */\n'
       || E'             ''made'', extract(epoch from g.created_at) * 1000,\n'
       || E'             ''days'', coalesce((\n'
       || E'                select jsonb_agg(jsonb_build_object(\n'
       || E'                         ''from'', to_char(d.from_day, ''YYYY-MM-DD''), ''days'', d.days)\n'
       || E'                       order by d.from_day)\n'
       || E'                  from public.chronicle_goal_days d where d.goal = g.id\n'
       || E'             ), ''[]''::jsonb)'),
      ('chronicle_export',
       E'''repeat_every'', g.repeat_every, ''target''',
       E'''repeat_every'', g.repeat_every,\n'
       || E'               ''days'', coalesce((\n'
       || E'                  select jsonb_agg(jsonb_build_object(\n'
       || E'                           ''from'', d.from_day, ''days'', d.days, ''set_at'', d.set_at)\n'
       || E'                         order by d.from_day)\n'
       || E'                    from public.chronicle_goal_days d where d.goal = g.id\n'
       || E'               ), ''[]''::jsonb),\n'
       || E'               ''target'''),
      ('chronicle_import',
       E'n_goal int := 0;',
       E'n_goal int := 0; n_days int := 0; dy jsonb; fresh_goals uuid[] := ''{}'';'),
      ('chronicle_import',
       E'+ coalesce(jsonb_array_length(p_doc->''goals''), 0)',
       E'+ coalesce(jsonb_array_length(p_doc->''goals''), 0)\n'
       || E'         /* the schedules ride inside the goals, so the outer wall counts them too */\n'
       || E'         + coalesce((select sum(jsonb_array_length(gd->''days''))\n'
       || E'                       from jsonb_array_elements(coalesce(p_doc->''goals'', ''[]''::jsonb)) gd\n'
       || E'                      where jsonb_typeof(gd->''days'') = ''array''), 0)'),
      ('chronicle_import',
       E'n_goal := n_goal + 1; v_goals := v_goals + 1;',
       E'n_goal := n_goal + 1; v_goals := v_goals + 1;\n'
       || E'          fresh_goals := fresh_goals || (x->>''id'')::uuid;'),
      ('chronicle_import',
       E'  for x in select * from jsonb_array_elements(coalesce(p_doc->''plans'', ''[]''::jsonb)) loop',
       E'  /* ⚠️ A SCHEDULE ONLY ARRIVES WITH ITS GOAL. Rows for a goal this import did not create\n'
       || E'     are refused, so a goal already here keeps the history it has. The writer''s shape\n'
       || E'     rules are kept as well: a repeating daily goal of yours, and a mask of 1 to 127. */\n'
       || E'  for x in select * from jsonb_array_elements(coalesce(p_doc->''goals'', ''[]''::jsonb)) loop\n'
       || E'    continue when jsonb_typeof(x->''days'') is distinct from ''array'';\n'
       || E'    for dy in select * from jsonb_array_elements(x->''days'') loop\n'
       || E'      begin\n'
       || E'        if not ((x->>''id'')::uuid = any (fresh_goals))\n'
       || E'           or not exists (select 1 from public.chronicle_goals g\n'
       || E'                           where g.id = (x->>''id'')::uuid and g.owner = me\n'
       || E'                             and g.scope = ''day'' and g.repeat_every is not null)\n'
       || E'           or (dy->>''from'') is null\n'
       || E'           or coalesce((dy->>''days'')::int, 0) not between 1 and 127 then\n'
       || E'          refused := refused + 1;\n'
       || E'        else\n'
       || E'          insert into public.chronicle_goal_days (goal, owner, from_day, days, set_at)\n'
       || E'          values ((x->>''id'')::uuid, me, (dy->>''from'')::date, (dy->>''days'')::smallint,\n'
       || E'                  coalesce((dy->>''set_at'')::timestamptz, now()))\n'
       || E'          on conflict (goal, from_day) do nothing;\n'
       || E'          if found then n_days := n_days + 1; else refused := refused + 1; end if;\n'
       || E'        end if;\n'
       || E'      exception when others then refused := refused + 1;\n'
       || E'      end;\n'
       || E'    end loop;\n'
       || E'  end loop;\n\n'
       || E'  for x in select * from jsonb_array_elements(coalesce(p_doc->''plans'', ''[]''::jsonb)) loop'),
      ('chronicle_import',
       E'''goals'', n_goal,',
       E'''goals'', n_goal, ''schedules'', n_days,')
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
  if v_done <> 7 then raise exception 'expected 7 substitutions, made %', v_done; end if;
end $mig$;
