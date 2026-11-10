CREATE OR REPLACE FUNCTION public.get_member_chronicle(p_username text, p_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_viewer uuid := auth.uid();
  v_target uuid;
  v_ok boolean;
  v_live boolean;
  v_wants_goals boolean;
  v_days int;
  v_from timestamptz;
  v_to timestamptz := clock_timestamp();
  v_time jsonb;
  v_top jsonb;
  v_now jsonb;
  v_goals jsonb;
  v_reached int;
  v_open int;
begin
  if v_viewer is null then raise exception 'not authenticated'; end if;

  select p.user_id into v_target
  from public.profiles p
  where lower(p.username) = lower(p_username) and coalesce(p.suspended, false) = false;
  if v_target is null then return null; end if;

  -- THE GATE, and both opt-ins, in one pass over the blocks this viewer may see.
  -- v_ok:          is there a chronicle block for them at all?
  -- v_live:        has a block they can see asked to show what is running right now?
  -- v_wants_goals: has a block they can see asked to show goals at all?
  --
  -- Neither opt-in is a parameter, and that is the point: the window (p_days) is not a privacy
  -- boundary, but what somebody is doing this minute and what they are trying to change about
  -- their life are, so a caller cannot ask for either.
  select bool_or(true),
         bool_or(coalesce((b.config->>'live')::boolean, false)),
         bool_or(coalesce((b.config->>'goals')::boolean, false))
    into v_ok, v_live, v_wants_goals
  from public.profile_blocks b
  where b.user_id = v_target and b.block_type = 'chronicle'
    and (v_target = v_viewer or public.can_see_item(v_target, b.visibility, 'profile_block', b.id::text));
  if not coalesce(v_ok, false) then return null; end if;

  v_days := least(greatest(coalesce(p_days, 7), 1), 90);
  v_from := v_to - make_interval(days => v_days);

  -- the overlap sum is chronicle_sum's, character for character
  select coalesce(jsonb_object_agg(t.cat, round(t.mins)), '{}'::jsonb) into v_time
  from (
    select a.cat,
           sum(greatest(0, extract(epoch from (
             least(coalesce(e.ended_at, clock_timestamp()), v_to)
             - greatest(e.started_at, v_from))))) / 60.0 as mins
      from public.chronicle_entries e
      join public.chronicle_activities a on a.id = e.activity and a.owner = v_target
     where e.owner = v_target
       and e.started_at < v_to
       and coalesce(e.ended_at, clock_timestamp()) > v_from
     group by a.cat
  ) t
  where t.mins >= 1;

  select coalesce(jsonb_agg(x order by x.mins desc, x.name), '[]'::jsonb) into v_top
  from (
    select a.name, a.cat, a.colour,
           round(sum(greatest(0, extract(epoch from (
             least(coalesce(e.ended_at, clock_timestamp()), v_to)
             - greatest(e.started_at, v_from))))) / 60.0) as mins
      from public.chronicle_entries e
      join public.chronicle_activities a on a.id = e.activity and a.owner = v_target
     where e.owner = v_target
       and e.started_at < v_to
       and coalesce(e.ended_at, clock_timestamp()) > v_from
     group by a.id, a.name, a.cat, a.colour
     having sum(greatest(0, extract(epoch from (
              least(coalesce(e.ended_at, clock_timestamp()), v_to)
              - greatest(e.started_at, v_from))))) / 60.0 >= 1
     order by mins desc, a.name
     limit 5
  ) x;

  if v_live then
    select to_jsonb(t) into v_now
    from (
      select a.name, a.cat, a.colour,
             round(extract(epoch from (clock_timestamp() - e.started_at)) / 60.0) as mins
        from public.chronicle_entries e
        join public.chronicle_activities a on a.id = e.activity and a.owner = v_target
       where e.owner = v_target and e.ended_at is null
       order by e.started_at desc
       limit 1
    ) t;
  end if;

  -- TWO SWITCHES, BOTH REQUIRED: a visible block asked for goals, and the owner ticked this goal.
  -- Six at most, so a page cannot become a wall of somebody's ambitions. No progress figure: a
  -- goal's window comes from goalWindow in src/chronicle/goal.ts and the server has no copy of it,
  -- which is also why chronicle_tally takes its windows from the caller. What a shared goal says
  -- is what it IS, not how far along.
  if v_wants_goals then
    select coalesce(jsonb_agg(
             jsonb_build_object('title', g.title, 'target', g.target,
                                'unit', g.unit, 'done', g.done)
             order by g.ord), '[]'::jsonb)
      into v_goals
    from (
      select gl.title, gl.target, gl.unit, (gl.done_at is not null) as done,
             row_number() over (order by gl.priority desc, gl.sort, gl.title) as ord
        from public.chronicle_goals gl
       where gl.owner = v_target
         and public.can_see_item(v_target, gl.visibility,
                                 'chronicle_goal', gl.id::text)
       order by gl.priority desc, gl.sort, gl.title
       limit 6
    ) g;
  end if;

  -- ⚠️ THE SAME PREDICATE AS THE LIST ABOVE, so a goal is COUNTED exactly when it could be
  -- LISTED. These used to count every goal the owner had: a member whose only goal was
  -- Only me told each of their friends they had one on the go. No `v_target = v_viewer`
  -- escape is needed -- can_see answers true for the owner at every tier -- so an owner's
  -- own card still counts everything.
  select count(*) filter (where g.done_at is not null and g.done_at >= v_from),
         count(*) filter (where g.done_at is null)
    into v_reached, v_open
  from public.chronicle_goals g
  where g.owner = v_target
    and public.can_see_item(v_target, g.visibility,
                            'chronicle_goal', g.id::text);

  return jsonb_build_object(
    'days', v_days,
    'time', v_time,
    'top', v_top,
    'now', v_now,
    'goals', coalesce(v_goals, '[]'::jsonb),
    'reached', v_reached,
    'open', v_open
  );
end $function$
