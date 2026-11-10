CREATE OR REPLACE FUNCTION public.chronicle_goal_save(p_id uuid, p_title text, p_scope text, p_anchor date, p_repeat integer, p_target numeric, p_unit text, p_note text, p_sort integer, p_activity uuid, p_cat text, p_counts text, p_est integer, p_priority integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_id uuid; v_count int; v_act uuid := p_activity;
  v_counts text := case when p_counts = 'amount' then 'amount' else 'minutes' end;
  -- ⚠️ CLAMPED RATHER THAN RAISED, both of them, for the same reason the counts correction below
  -- is: a goal with a silly estimate is still a goal somebody is trying to write down, and losing
  -- the whole save over the optional field is a worse outcome than losing the field.
  v_est int := case
                 when p_est is null then null
                 when p_est <= 0 then null
                 when p_est > 10080 then 10080
                 else p_est
               end;
  v_pri smallint := least(greatest(coalesce(p_priority, 0), 0), 2)::smallint;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if v_act is not null and not exists (
        select 1 from public.chronicle_activities where id = v_act and owner = auth.uid()) then
    v_act := null;
  end if;
  /**
   * ⚠️ AN AMOUNT NEEDS SOMETHING THAT COUNTS ONE. Counting an amount without an activity is
   * refused by a constraint, so it is corrected here rather than raised: the goal is still a goal,
   * it just measures time instead.
   *
   * ⚠️ AND AN ACTIVITY THAT NAMES NO METRIC COUNTS NOTHING EITHER, which this missed. The room
   * only offers the choice when the chosen activity has a metric — but the chooser is a separate
   * control from the source, and it keeps its answer when the source moves beneath it. Picking
   * Gym, choosing "count the reps", then changing the source to an activity that counts nothing
   * saved a goal measuring a quantity its source never records. Driven in the room: a goal
   * pointed at Dishes read "0 / 10 done" with twelve minutes of Dishes in the log, two inches
   * from another goal pointed at the same activity reading "12 / 10 minutes".
   *
   * Corrected rather than raised, like its sibling above, and here rather than only in the room,
   * because a rule the client alone keeps is a rule that lasts until the next caller.
   */
  if v_counts = 'amount' and (
       v_act is null
       or not exists (select 1 from public.chronicle_activities a
                       where a.id = v_act and a.owner = auth.uid()
                         and nullif(btrim(coalesce(a.metric, '')), '') is not null))
  then
    v_counts := 'minutes';
  end if;
  if p_id is null then
    select count(*) into v_count from public.chronicle_goals where owner = auth.uid();
    if v_count >= 500 then raise exception 'that is 500 goals — finish or delete one'; end if;
    insert into public.chronicle_goals
      (owner, title, scope, anchor, repeat_every, target, unit, note, sort, activity, cat, counts,
       est_mins, priority)
    values (auth.uid(), btrim(p_title), p_scope, p_anchor, p_repeat, p_target,
            nullif(btrim(coalesce(p_unit,'')),''), nullif(btrim(coalesce(p_note,'')),''),
            coalesce(p_sort,0),
            v_act, nullif(btrim(coalesce(p_cat,'')),''), v_counts, v_est, v_pri)
    returning id into v_id;
  else
    update public.chronicle_goals
       set title = btrim(p_title), scope = p_scope, anchor = p_anchor, repeat_every = p_repeat,
           target = p_target, unit = nullif(btrim(coalesce(p_unit,'')),''),
           /**
            * ⚠️ NULL LEAVES THE NOTE ALONE; '' CLEARS IT. This read `note = p_note`, and the room
            * has never sent one — `saveGoal` omits the field entirely — so every edit of a goal
            * said "throw away whatever was written here".
            *
            * ⚠️ IT STOPPED BEING THEORETICAL WHEN THE IMPORT SHIPPED, which is the same story as
            * the colour on an activity. Nothing in the room can write a goal's note, so there was
            * none to lose; chronicle_export carries the column and chronicle_import puts it back,
            * so a restored file is now the one way a goal can HAVE a note — and the next edit was
            * deleting it. The third instance of this shape in two days, after a session's note:
            * an optional field, a caller that does not mention it, and a function that reads
            * silence as erasure.
            */
           note = case when p_note is null then note
                       else nullif(btrim(p_note), '') end,
           sort = coalesce(p_sort, sort), activity = v_act,
           cat = nullif(btrim(coalesce(p_cat,'')),''), counts = v_counts,
           est_mins = v_est, priority = v_pri, updated_at = now()
     where id = p_id and owner = auth.uid()
    returning id into v_id;
    if v_id is null then raise exception 'no such goal'; end if;
  end if;
  return v_id;
end $function$
