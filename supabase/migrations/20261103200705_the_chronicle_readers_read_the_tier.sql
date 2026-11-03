-- ✅ APPLIED 3 Nov 2026 as `the_chronicle_readers_read_the_tier`.
--
-- ⚠️ `shared` CANNOT EXPRESS `certain`, AND A CHECK CONSTRAINT SAYS SO. Chronicle has
-- carried a boolean since long before the ladder, and `chronicle_activities_tier_agrees` pins it:
-- `shared = (visibility in ('friends','members','public'))`. So an activity or goal at `certain`
-- has `shared = false`, BY CONSTRAINT -- and five readers asked the boolean, which hid the row
-- from the very people its list names. The level would have shipped doing nothing on all five,
-- and looked exactly like an empty list.
--
-- The boolean stays: it is what `chronicle_activity_share` writes, what the import reads, and
-- what `chronicle_tier_sync` keeps in step. What changed is that READERS stopped asking it, and
-- the migration asserts no reader anywhere still gates on `and <alias>.shared`.
--
-- ⚠️ AND THE OWN-SITTINGS BRANCH ASKS A THIRD QUESTION, which is why it does not get
-- `can_see_item`. `feed_recent` adds your own sittings to your own feed, and `can_see_item` is
-- true for the owner by definition -- so swapping it in there would have put every PRIVATE
-- sitting into the feed, the opposite of what the boolean did. What that branch means is "am I
-- sharing this with anybody", which is `item_reaches_anyone`: friends-or-wider reaches people,
-- `certain` reaches whoever is still on the list, and an empty list reaches nobody. That last
-- clause is Evan's rule that an empty list means Only me, honoured even in the owner's own feed.
--
-- Also here: the two tier setters Chronicle did not have. `chronicle_activity_share(id, on)`
-- writes a boolean and the sync turns it into friends-or-private, which is every tier a boolean
-- can name. The new setters take a tier and return the one STORED, clamped twice -- by the
-- account's ceiling and by Chronicle's own cap at friends, because without the second clamp a
-- member whose ceiling is `public` would get a constraint violation instead of a narrower tier.
-- Clamped inside the UPDATE rather than into a variable first, because check I in
-- visibility-guards.sql judges each STATEMENT and a tier assembled two lines earlier reads,
-- correctly, as a write with no clamp in it.
--
-- Measured, one activity and one goal walked through all three levels:
--                      own feed   friend on the list   friend off it
--   friends               1              1 / 1              1 / 1
--   certain               1              1 / 1              0 / 0
--   private               0              0 / 0              0 / 0
--   certain, empty list   0
--   set_visibility(activity, public)  -> stored `friends`   (the double clamp)
--   set_visibility(activity, certain) -> stored `certain`, shared false
--   and all three `*_mine` readers now carry the tier

/* ⚠️ `shared` CANNOT EXPRESS `certain`, AND THE SCHEMA SAYS SO IN A CHECK. Chronicle has carried
   a boolean since long before the ladder, and `chronicle_activities_tier_agrees` pins it:
   `shared = (visibility in ('friends','members','public'))`. So an activity or a goal set to
   `certain` has `shared = false`, by constraint -- and every reader that asks the boolean hides
   it from the very people its list names. The feature would have shipped doing nothing, on five
   surfaces, and looked exactly like an empty list.

   The boolean stays. It is what `chronicle_activity_share` writes, what the import reads, and
   what `chronicle_tier_sync` keeps in step; removing it is a contract break for no gain. What
   changes is that READERS stop asking it. */

/* ⚠️ AND THE OWN-SITTINGS BRANCH ASKS A DIFFERENT QUESTION, which is why it does not get
   `can_see_item`. `feed_recent` adds your own sittings to your own feed, and `can_see_item` is
   true for the owner by definition -- so swapping it in there would put every PRIVATE sitting
   into the feed, which is the opposite of what the boolean was doing. The question that branch
   is actually asking is "am I sharing this with anybody", and that is a third predicate: a tier
   of friends or wider reaches people, `certain` reaches whoever is still on the list, and an
   empty list reaches nobody -- Evan's rule that an empty list means Only me. */
create or replace function public.item_reaches_anyone(
  p_owner uuid,
  p_tier public.visibility_tier,
  p_item_kind text,
  p_item_id text
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with t as (
    /* the tier it is actually SERVED at, the same clamp `can_see` applies on read -- a row
       stored above its owner's ceiling does not reach the people the stored value names */
    select least(coalesce(p_tier, 'private'::public.visibility_tier),
                 public.visibility_ceiling(p_owner)) as tier
  )
  select case
    when (select tier from t) in ('friends', 'members', 'public') then true
    when (select tier from t) = 'certain' then exists (
      select 1 from public.visibility_certain vc
       where vc.item_kind = p_item_kind
         and vc.item_id   = p_item_id
         and vc.owner     = p_owner
         /* a row whose friendship has ended grants nothing, so it does not count as reach */
         and coalesce(public.are_friends(p_owner, vc.friend), false))
    else false
  end;
$$;

/* Nothing member-callable needs it: both callers are SECURITY DEFINER and run as the owner.
   CLAUDE.md §3 -- do not grant what cannot be used, because a grant nobody needs is an entry
   somebody has to reason about at every review. */
revoke all on function public.item_reaches_anyone(uuid, public.visibility_tier, text, text)
  from public, anon, authenticated;

do $mig$
declare
  r record;
  v_src text;
  v_out text;
  v_hits int;
  v_done int := 0;
begin
  for r in
    select * from (values
      /* a friend's sitting: the activity's own list decides, and `are_friends` is already
         required one line above, so this narrows and never widens */
      ('chronicle_friends_log',
       E'\n         and a.shared\n',
       E'\n         and public.can_see_item(e.owner, a.visibility,\n'
       || E'                                 ''chronicle_activity'', a.id::text)\n', 1),
      /* the goals strip on somebody's profile */
      ('get_member_chronicle',
       E'where gl.owner = v_target and gl.shared\n',
       E'where gl.owner = v_target\n'
       || E'         and public.can_see_item(v_target, gl.visibility,\n'
       || E'                                 ''chronicle_goal'', gl.id::text)\n', 1),
      /* your own sittings in your own feed -- "am I sharing this", not "may I see it" */
      ('feed_recent',
       E'\n       and a.shared\n',
       E'\n       and public.item_reaches_anyone(v_me, a.visibility,\n'
       || E'                                      ''chronicle_activity'', a.id::text)\n', 1),
      /* and the three readers of your OWN things carry the tier, so a picker can show it.
         `shared` is still sent: it is what the current bundle reads, and a reader that drops a
         field somebody is using is a breakage dressed as a cleanup. */
      ('chronicle_activities_mine',
       E'''session'', a.session_mins, ''shared'', a.shared\n',
       E'''session'', a.session_mins, ''shared'', a.shared,\n'
       || E'             ''visibility'', a.visibility\n', 1),
      ('chronicle_goals_mine',
       E'''shared'', g.shared,\n',
       E'''shared'', g.shared, ''visibility'', g.visibility,\n', 1),
      ('chronicle_sharing_mine',
       E'''colour'', a.colour, ''shared'', a.shared)\n',
       E'''colour'', a.colour, ''shared'', a.shared,\n'
       || E'                                          ''visibility'', a.visibility)\n', 1),
      ('chronicle_sharing_mine',
       E'order by a.shared desc, a.name)',
       E'order by public.item_reaches_anyone(\n'
       || E'                                  auth.uid(), a.visibility,\n'
       || E'                                  ''chronicle_activity'', a.id::text) desc,\n'
       || E'                                a.name)', 1)
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

    v_out := replace(v_src, r.old, r.new);
    execute v_out;
    v_done := v_done + 1;
  end loop;
  if v_done <> 7 then raise exception 'expected 7 substitutions, made %', v_done; end if;

  /* THE CENSUS AGAIN, and this one is the point of the migration: no reader may still be
     deciding who sees a chronicle row by looking at the boolean. The writers may --
     `chronicle_activity_share`, `chronicle_goal_share`, `chronicle_activity_save`, the import,
     and `chronicle_tier_sync` itself -- and `chronicle_activities_mine` still SENDS it. What is
     forbidden is `and a.shared` or `and gl.shared` as a gate in a WHERE. */
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and regexp_replace(regexp_replace(p.prosrc, '/\*.*?\*/', ' ', 'gs'),
                          '--[^' || chr(10) || ']*', ' ', 'g')
             ~* '\mand\s+[a-z_]+\.shared\M'
  ) then
    raise exception 'a reader still gates on the shared boolean';
  end if;
end
$mig$;

/* THE TIER SETTERS CHRONICLE DID NOT HAVE. `chronicle_activity_share(id, on)` writes a boolean
   and `chronicle_tier_sync` turns it into friends-or-private, which is every tier the boolean
   can name. Picking `certain` needs a setter that takes a tier.

   ⚠️ TWO CEILINGS, AND BOTH ARE REAL: the account's, from `clamp_visibility`, and chronicle's
   own, `*_tier_capped`, which allows private, certain and friends and nothing above. Without the
   second one a member whose ceiling is `public` would get a constraint violation from the table
   instead of a narrower tier -- an error where there should be a decision.

   Clamped in the UPDATE itself rather than into a variable first, because check I in
   visibility-guards.sql judges each STATEMENT: a tier assembled two lines earlier reads, quite
   correctly, as a statement that writes a tier without clamping it. */
create or replace function public.chronicle_activity_set_visibility(
  p_id uuid,
  p_tier public.visibility_tier
) returns public.visibility_tier
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_tier public.visibility_tier;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if p_id is null then raise exception 'which activity'; end if;
  update public.chronicle_activities
     set visibility = least(public.clamp_visibility(auth.uid(), p_tier),
                            'friends'::public.visibility_tier)
   where id = p_id and owner = auth.uid()
   returning visibility into v_tier;
  -- the same sentence whether it is somebody else's or does not exist
  if v_tier is null then raise exception 'no such activity'; end if;
  return v_tier;
end
$$;

create or replace function public.chronicle_goal_set_visibility(
  p_id uuid,
  p_tier public.visibility_tier
) returns public.visibility_tier
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_tier public.visibility_tier;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if p_id is null then raise exception 'which goal'; end if;
  update public.chronicle_goals
     set visibility = least(public.clamp_visibility(auth.uid(), p_tier),
                            'friends'::public.visibility_tier),
         updated_at = now()
   where id = p_id and owner = auth.uid()
   returning visibility into v_tier;
  if v_tier is null then raise exception 'no such goal'; end if;
  return v_tier;
end
$$;

revoke all on function public.chronicle_activity_set_visibility(uuid, public.visibility_tier)
  from public, anon;
revoke all on function public.chronicle_goal_set_visibility(uuid, public.visibility_tier)
  from public, anon;
grant execute on function public.chronicle_activity_set_visibility(uuid, public.visibility_tier)
  to authenticated;
grant execute on function public.chronicle_goal_set_visibility(uuid, public.visibility_tier)
  to authenticated;
