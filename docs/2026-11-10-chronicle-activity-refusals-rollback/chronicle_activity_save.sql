CREATE OR REPLACE FUNCTION public.chronicle_activity_save(p_id uuid, p_name text, p_cat text, p_colour text, p_metric text, p_session integer, p_shared boolean DEFAULT NULL::boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_id uuid; v_count int;
  v_metric text := nullif(btrim(coalesce(p_metric,'')),'');
  -- clamped rather than raised, like the estimate on a goal: losing the whole save over an
  -- optional field is a worse outcome than losing the field
  v_session int := case
                     when p_session is null then null
                     when p_session <= 0 then null
                     when p_session > 1440 then 1440
                     else p_session
                   end;
  v_clash uuid;
  v_away  boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  /**
   * ⚠️ A UNIQUE INDEX IS NOT A SENTENCE. `chronicle_activities_owner_name_key` was the only
   * thing stopping two activities sharing a name, so a second "Gym" came back as
   * "duplicate key value violates unique constraint ..." — which `saveActivity` passes
   * straight to the screen. That is a reasonable thing to read in a log and not a thing to
   * hand somebody standing on a platform, and the Now room makes it a LIKELY answer rather
   * than a rare one: typing a name you already have is the obvious mistake there.
   *
   * ⚠️ AND THE ARCHIVED CASE IS A DIFFERENT SENTENCE. The index does not care, so both clashes
   * read identically — but "you already have one called Gym" is a confusing thing to be told
   * about a Gym that is not in your list. It is archived, and the control that undoes that
   * says "Bring back", so the message says so too.
   *
   * ⚠️ IT COVERS THE RENAME AS WELL AS THE INSERT, which is why it sits above the branch
   * rather than inside it: renaming Drawing to Gym hits the same index and said the same
   * thing. `id <> p_id` is what lets an activity keep its own name.
   */
  select id, archived_at is not null into v_clash, v_away
    from public.chronicle_activities
   where owner = auth.uid() and name = btrim(p_name)
     and (p_id is null or id <> p_id)
   limit 1;
  if v_clash is not null then
    if v_away then
      raise exception '% is archived — bring it back in Chronicle', btrim(p_name);
    else
      raise exception 'you already have one called %', btrim(p_name);
    end if;
  end if;
  if p_id is null then
    select count(*) into v_count from public.chronicle_activities where owner = auth.uid();
    if v_count >= 200 then raise exception 'that is 200 activities — archive one'; end if;
    insert into public.chronicle_activities (owner, name, cat, colour, metric, session_mins)
    values (auth.uid(), btrim(p_name), p_cat, nullif(btrim(coalesce(p_colour,'')),''),
            v_metric, v_session)
    returning id into v_id;
  else
    update public.chronicle_activities
       set name = btrim(p_name), cat = p_cat,
           /**
            * ⚠️ NULL LEAVES THE COLOUR ALONE; '' CLEARS IT. The same rule as a session's note, and
            * for the same reason: the room passes null here on every rename — it has never had a
            * colour picker — so this line read "throw away whatever colour this activity had"
            * every time somebody corrected a name or changed a category.
            *
            * ⚠️ AND IT STOPPED BEING THEORETICAL WHEN THE IMPORT SHIPPED. Nothing in the room can
            * set a colour, so for a long time there was none to lose. chronicle_export writes the
            * column and chronicle_import puts it back, so a restored file is now the one way an
            * activity can HAVE a colour — and renaming it afterwards was deleting that.
            */
           colour = case when p_colour is null then colour
                         else nullif(btrim(p_colour), '') end,
           metric = case when p_metric is null then metric else v_metric end,
           session_mins = v_session,
           shared = coalesce(p_shared, shared)
     where id = p_id and owner = auth.uid()
    returning id into v_id;
    if v_id is null then raise exception 'no such activity'; end if;
  end if;
  return v_id;
end $function$
