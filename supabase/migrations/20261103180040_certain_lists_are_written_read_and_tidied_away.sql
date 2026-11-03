-- ✅ APPLIED 3 Nov 2026 as `certain_lists_are_written_read_and_tidied_away`.
--
-- The writer, the reader and the cleanup for `visibility_certain`.
--
-- ⚠️ NAMES THAT ARE NOT FRIENDS ARE DROPPED RATHER THAN REFUSED, which is a product
-- decision and not laziness. The picker fills a list from a circle, and a circle can hold
-- somebody who has since drifted; refusing the whole save would let one stale name block an
-- unrelated edit to a block. The count returned says how many landed, so a caller that wants to
-- tell the owner can.
--
-- ⚠️ AND DELETING AN ITEM TAKES ITS LIST WITH IT, through five AFTER DELETE triggers
-- rather than a foreign key -- `item_id` is text pointing at five different tables, so no FK can
-- do the job. Without them a list outlives the thing it was about: rows nobody can see, audit or
-- remove, naming a uuid that no longer exists.
--
-- Measured in rolled-back transactions:
--   a list of 3 (one friend, one stranger, one name nobody has)   1 landed
--   read back                                                     just the friend
--   setting a list on somebody else's block                       refused, "no such item"
--   setting an EMPTY list                                         0 rows -- Only me
--   setting it again                                              the friend can see it again
--   deleting the BLOCK                                            0 rows left behind

/**
 * Replace the Certain list for one item.
 *
 * Usernames rather than ids, like every other client-facing function here, and the same no-leak
 * property falls out: a name nobody has and a name belonging to a stranger are equally not-a-
 * friend, so neither can be told from the other by the answer.
 *
 * ⚠️ ACCEPTED FRIENDS ONLY, CHECKED HERE. `certain` sits below `friends` on the ladder, so a
 * list that could name a stranger would make the narrow level wider than the broad one. Names
 * that are not friends are DROPPED rather than refused: the picker fills from a circle, and a
 * circle can hold somebody who has since drifted -- refusing the whole save would make one stale
 * name block an unrelated edit. The count returned says how many actually landed, so a caller
 * that cares can tell.
 *
 * ⚠️ AN EMPTY LIST IS ONLY ME, with no special case anywhere. `can_see_item` requires a row to
 * exist, so no rows means nobody but the owner -- which is what Evan asked for and what a reader
 * gets for free rather than through a branch somebody has to remember.
 */
create or replace function public.visibility_certain_set(
  p_kind text, p_id text, p_usernames text[])
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me uuid := auth.uid();
  n integer;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(v_me), false) then
    raise exception 'your account is suspended';
  end if;
  if not public.owns_item(p_kind, p_id, v_me) then
    /* the same sentence whether the item is somebody else's or does not exist */
    raise exception 'no such item';
  end if;

  delete from public.visibility_certain
   where item_kind = p_kind and item_id = p_id and owner = v_me;

  insert into public.visibility_certain (owner, item_kind, item_id, friend)
  select v_me, p_kind, p_id, p.user_id
    from unnest(coalesce(p_usernames, array[]::text[])) as u(name)
    join public.profiles p on lower(p.username::text) = lower(btrim(u.name))
   where p.user_id <> v_me
     and coalesce(public.are_friends(v_me, p.user_id), false)
  on conflict (item_kind, item_id, friend) do nothing;

  get diagnostics n = row_count;
  return n;
end $function$;

/** The list as the picker needs it back: the usernames still on it and still friends. */
create or replace function public.visibility_certain_get(p_kind text, p_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if not public.owns_item(p_kind, p_id, v_me) then raise exception 'no such item'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'username', p.username::text,
             'name', coalesce(p.first_name, p.username::text)
           ) order by lower(coalesce(p.first_name, p.username::text)))
      from public.visibility_certain vc
      join public.profiles p on p.user_id = vc.friend
     where vc.item_kind = p_kind and vc.item_id = p_id and vc.owner = v_me
       /* a row whose friendship has ended grants nothing, so it is not part of the answer */
       and coalesce(public.are_friends(v_me, vc.friend), false)
  ), '[]'::jsonb);
end $function$;

revoke all on function public.visibility_certain_set(text, text, text[]) from public, anon;
revoke all on function public.visibility_certain_get(text, text) from public, anon;
grant execute on function public.visibility_certain_set(text, text, text[]) to authenticated;
grant execute on function public.visibility_certain_get(text, text) to authenticated;

/**
 * ⚠️ DELETING AN ITEM MUST TAKE ITS LIST WITH IT, and no foreign key can do that job here --
 * `item_id` is text pointing at five different tables. Without this a deleted block's uuid is
 * still named in `visibility_certain`, and while a fresh `gen_random_uuid()` colliding with it
 * is not a real risk, a list belonging to nothing is a row nobody can see, audit or remove.
 */
create or replace function public.visibility_certain_forget()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  delete from public.visibility_certain
   where item_kind = tg_argv[0] and item_id = old.id::text;
  return old;
end $function$;

revoke all on function public.visibility_certain_forget() from public, anon, authenticated;

drop trigger if exists profile_blocks_forget_certain on public.profile_blocks;
create trigger profile_blocks_forget_certain after delete on public.profile_blocks
  for each row execute function public.visibility_certain_forget('profile_block');

drop trigger if exists chronicle_activities_forget_certain on public.chronicle_activities;
create trigger chronicle_activities_forget_certain after delete on public.chronicle_activities
  for each row execute function public.visibility_certain_forget('chronicle_activity');

drop trigger if exists chronicle_goals_forget_certain on public.chronicle_goals;
create trigger chronicle_goals_forget_certain after delete on public.chronicle_goals
  for each row execute function public.visibility_certain_forget('chronicle_goal');

drop trigger if exists circuit_people_forget_certain on public.circuit_people;
create trigger circuit_people_forget_certain after delete on public.circuit_people
  for each row execute function public.visibility_certain_forget('circuit_person');

drop trigger if exists player_registry_forget_certain on public.player_registry;
create trigger player_registry_forget_certain after delete on public.player_registry
  for each row execute function public.visibility_certain_forget('player_registry');
