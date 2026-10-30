-- ✅ APPLIED 29 Oct 2026 as `one_switch_for_sharing_a_chronicle`.
--
-- Two one-field writers, so that sharing a chronicle is a switch rather than an expedition.
--
-- ⚠️ THE FEATURE WAS UNREACHABLE AND THE NUMBERS SAY SO. Measured across all 14 members on
-- 29 Oct: **1** has a Chronicle card on their profile, **0** have ticked "Show my timeline", and
-- **0** have ticked "Friends can see this" on any activity. So `chronicle_friends_log` has
-- returned an empty array to every member of this site on every day it has existed. Not because
-- people declined — because the three switches live on `#profile`, which has no nav entry, in a
-- different room from the data they are about, and the one screen that is empty BECAUSE they are
-- off named them in prose with not one link in it.
--
-- ⚠️ THE DEFAULT STAYS OFF. A timeline is a sitting-by-sitting record of somebody's day and
-- CLAUDE.md §3 is unambiguous that two different tiers are not one decision. Nobody becomes more
-- visible here without choosing it; what changes is that choosing it takes one tap in the room
-- where the data is made.
--
-- ⚠️ `chronicle_activity_share` EXISTS BECAUSE `chronicle_activity_save` WOULD HAVE EATEN THE
-- SITTING LENGTH. That function protects `colour`, `metric` and `shared` against a caller that
-- does not mention them — null leaves each alone — and then writes `session_mins = v_session`
-- flat, so a caller passing null for a field it does not care about clears it. A share toggle is
-- exactly that caller. The shape is already in the codebase as `chronicle_goal_share(p_id, p_on)`,
-- so this is the same answer the goals got, for the same reason: one field, one writer, nothing
-- else in the statement to be wrong about.
--
-- ⚠️ THE CONFIG IS MERGED, NEVER REPLACED. A chronicle card may already be asking for `days`,
-- `live` or `goals`, and `config = '{"timeline":true}'` would throw all three away — the §8
-- "a save that writes every column is a delete for the ones the caller forgot" shape, which this
-- repository has now found four times. `||` on jsonb overwrites one key and keeps the rest.
--
-- ⚠️ `chronicle_sharing_mine` IS ONE CALL RATHER THAN THREE, because the room needs the switch
-- state, whether a card exists and the activity ticks before it can render anything at all, and a
-- switch that paints in three stages reads as broken.
--
-- ⚠️ AND TURNING IT OFF KEEPS THE CARD. The card and the timeline are two decisions: somebody may
-- want their hours on their profile and not their sittings, which is precisely the pair the
-- profile editor offers. Switching off here sets `timeline` false and leaves everything else
-- standing, so it is reversible without losing what the card was already showing.

create or replace function public.chronicle_activity_share(p_id uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_id is null then raise exception 'which activity'; end if;
  update public.chronicle_activities
     set shared = coalesce(p_on, false)
   where id = p_id and owner = auth.uid();
  if not found then raise exception 'no such activity'; end if;
end $function$;

revoke all on function public.chronicle_activity_share(uuid, boolean) from public, anon;
grant execute on function public.chronicle_activity_share(uuid, boolean) to authenticated;

create or replace function public.chronicle_share_timeline(p_on boolean)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me  uuid := auth.uid();
  v_id  uuid;
  v_pos int;
begin
  if v_me is null then raise exception 'not authenticated'; end if;

  select id into v_id
    from public.profile_blocks
   where user_id = v_me and block_type = 'chronicle'
   order by position
   limit 1;

  if v_id is null then
    /* No card yet. Switching OFF without one is already the answer, so nothing is created --
       otherwise a toggle you never turned on would leave a card on your page. */
    if not coalesce(p_on, false) then return false; end if;
    select coalesce(max(position), 0) + 1 into v_pos
      from public.profile_blocks where user_id = v_me;
    /* ⚠️ 'friends', AND THE EDITOR WILL NOT OFFER 'public' FOR THIS TYPE EITHER. A timeline is
       friends-only wherever it is switched on, and a card created by this switch must not start
       wider than the thing it is being created to carry. */
    insert into public.profile_blocks (user_id, block_type, position, size, config, visibility)
    values (v_me, 'chronicle', v_pos, 'medium', '{"timeline": true}'::jsonb, 'friends');
    return true;
  end if;

  update public.profile_blocks
     set config = coalesce(config, '{}'::jsonb) || jsonb_build_object('timeline', coalesce(p_on, false))
   where id = v_id and user_id = v_me;

  return coalesce(p_on, false);
end $function$;

revoke all on function public.chronicle_share_timeline(boolean) from public, anon;
grant execute on function public.chronicle_share_timeline(boolean) to authenticated;

create or replace function public.chronicle_sharing_mine()
returns jsonb
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select jsonb_build_object(
    'timeline', public.chronicle_shares_timeline(auth.uid()),
    'hasCard', exists (select 1 from public.profile_blocks
                        where user_id = auth.uid() and block_type = 'chronicle'),
    'activities', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'cat', a.cat,
                                          'colour', a.colour, 'shared', a.shared)
                       order by a.shared desc, a.name)
        from public.chronicle_activities a
       where a.owner = auth.uid() and a.archived_at is null), '[]'::jsonb))
  where auth.uid() is not null;
$function$;

revoke all on function public.chronicle_sharing_mine() from public, anon;
grant execute on function public.chronicle_sharing_mine() to authenticated;
