-- ✅ APPLIED 31 Oct 2026 as `circles_can_be_named_and_filled`.
--
-- Phase 5 of docs/2026-10-30-one-visibility-ladder-plan.md: the management layer for Certain
-- friends. Phase 1 created `visibility_circles` and `visibility_circle_members` deliberately
-- uncalled; this is how an owner names one and puts people in it.
--
-- ⚠️ IT GRANTS NOTHING, AND THAT IS THE POINT OF LANDING IT ON ITS OWN. `can_see` still has no
-- `certain` branch, so a friend who is genuinely in a circle is still refused -- measured, with a
-- control so it is not just a function that says false to everything:
--
--   the friend, who IS in the circle, asking `certain`   false   <- circles grant nothing yet
--   the same friend asking `friends`                     true    <- the relationship still works
--   the same friend asking `private`                     false   <- only me means no one else
--   the owner, asking `certain` about their own row      true
--
-- So this is safe to ship before the ladder learns to read it, and it is the half the UI needs
-- before a picker can offer the level at all.
--
-- ⚠️ FRIENDSHIP IS REQUIRED TO ADD AND NOT TO REMOVE, which looks like an inconsistency and is
-- the only arrangement that works. `certain` sits BELOW `friends`, so it must never reach
-- somebody `friends` would not -- a stranger cannot be put in a circle. But when a friendship
-- ENDS the membership row survives, and an owner who could not then take it out would be left
-- looking at a name they cannot tidy away. Measured: after unfriending, the member is still
-- listed with `friend: false`, can be removed, and cannot be re-added.
--
-- ⚠️ AND THE STALE ROW IS LISTED RATHER THAN HIDDEN. Filtering it out of
-- `my_visibility_circles` would be tidier to write and dishonest to read. When `certain` is
-- wired, `can_see` must require friendship AND membership -- so a stale row grants nothing, and
-- this surface is where that is visible instead of silently true.
--
-- ⚠️ USERNAMES, NOT USER IDS, because that is this project's client-facing handle
-- (`remove_friend(p_username)`, `request_friend(p_username)`) and the client has no user ids for
-- other members. It also makes the no-leak rule fall out by construction: a name nobody has and
-- a name belonging to a stranger are equally not-a-friend, so both get the same sentence.
-- Measured -- `add a non-friend` and `add a nonexistent name` both answer
-- "that is not one of your friends", with `add a friend` succeeding as the control.
--
-- Verified in rolled-back transactions against the live database:
--   create, with the name trimmed                 'Inner Ring'
--   rename                                        'Family'
--   a duplicate name                              refused, "you already have a circle called that"
--   a blank name / a 41-character name            refused, each with its own message
--   add a friend (control)                        members = 1
--   add a non-friend / a nonexistent username     refused, the SAME sentence for both
--   add the same person twice                     members = 1, no error
--   remove                                        members = 0
--   another member renaming or deleting my circle refused, "no such circle"
--   another member listing circles                []
--   the 20-circle cap                             the 21st refused; renaming still works at 20
--   anon / PUBLIC execute on all four             none; members only
--   the two tables, per privilege                 still deny-all including TRUNCATE
--
-- ⚠️ WHAT THIS DOES NOT DECIDE, and must not be read as having decided: how an ITEM points at a
-- circle. `can_see(p_owner, p_tier)` takes no circle, and an owner may have several, so wiring
-- `certain` needs an answer to "which circle?" -- either `certain` means "anyone in any of my
-- circles" (in which case naming them is only an organising aid) or every row carrying `certain`
-- names one, which is a new column on five tables and a third argument to a function used in
-- eleven RLS policies. "Reusable named circles" points at the second; it is a big enough change
-- to be asked rather than assumed, and nothing here forecloses it.
--
-- One consequence to settle with it: deleting a circle that rows point at must leave those rows
-- at `private`, not `friends`. The cascade on `visibility_circle_members` handles people; it says
-- nothing about items, because no item points at a circle yet.

create or replace function public.visibility_circle_save(p_id uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me   uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_id   uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if v_name = '' then raise exception 'a circle needs a name'; end if;
  if length(v_name) > 40 then raise exception 'that name is too long (40 characters)'; end if;

  if p_id is null then
    /* A cap because there is no other bound on this: a circle is cheap to make and the picker
       has to list them all. Twenty is far past any real use and still a list somebody can read. */
    if (select count(*) from public.visibility_circles where owner = v_me) >= 20 then
      raise exception 'that is as many circles as one account can have (20)';
    end if;
    insert into public.visibility_circles (owner, name) values (v_me, v_name) returning id into v_id;
    return v_id;
  end if;

  /* The same message for "not yours" and "not there", so this cannot be used to find out which. */
  update public.visibility_circles set name = v_name
   where id = p_id and owner = v_me
   returning id into v_id;
  if v_id is null then raise exception 'no such circle'; end if;
  return v_id;
exception
  when unique_violation then raise exception 'you already have a circle called that';
end $function$;

create or replace function public.visibility_circle_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from public.visibility_circles where id = p_id and owner = auth.uid() returning id into v_id;
  if v_id is null then raise exception 'no such circle'; end if;
end $function$;

create or replace function public.visibility_circle_set_member(
  p_id uuid, p_username text, p_in boolean)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me   uuid := auth.uid();
  v_them uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.visibility_circles where id = p_id and owner = v_me) then
    raise exception 'no such circle';
  end if;

  select user_id into v_them from public.profiles
   where lower(username::text) = lower(btrim(coalesce(p_username, '')));

  /* ONE ANSWER FOR "no such person" AND "not your friend", which is the house rule about never
     leaking whether a member exists. Both land on the same sentence by construction here,
     because a name nobody has and a name belonging to a stranger are equally not-a-friend. */
  if v_them is null or v_them = v_me then
    raise exception 'that is not one of your friends';
  end if;

  if coalesce(p_in, false) then
    /* ⚠️ FRIENDSHIP IS REQUIRED TO ADD, AND NOT TO REMOVE. `certain` sits BELOW `friends` on the
       ladder, so it must never reach somebody `friends` would not -- which is why a stranger
       cannot be put in a circle at all. Removal is deliberately not gated the same way: when a
       friendship ends the circle row survives, and an owner who could not then take it out would
       be stuck looking at a name they cannot tidy away. */
    if not coalesce(public.are_friends(v_me, v_them), false) then
      raise exception 'that is not one of your friends';
    end if;
    if (select count(*) from public.visibility_circle_members where circle_id = p_id) >= 200 then
      raise exception 'that circle is full (200 people)';
    end if;
    insert into public.visibility_circle_members (circle_id, member)
    values (p_id, v_them)
    on conflict (circle_id, member) do nothing;
  else
    delete from public.visibility_circle_members where circle_id = p_id and member = v_them;
  end if;
end $function$;

create or replace function public.my_visibility_circles()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  /* ⚠️ A MEMBER WHOSE FRIENDSHIP ENDED IS LISTED, WITH `friend` FALSE, RATHER THAN HIDDEN.
     Dropping them would be tidier to write and dishonest to read: the row is still there, it
     still counts for nothing, and an owner who cannot see it cannot tidy it away. `can_see` will
     require friendship AND membership when `certain` is wired, so a stale row grants nothing --
     this is the surface that says so out loud. */
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'created_at', c.created_at,
        'members', coalesce(m.members, '[]'::jsonb)
      ) order by lower(c.name)
    ),
    '[]'::jsonb)
  from public.visibility_circles c
  left join lateral (
    select jsonb_agg(
             jsonb_build_object(
               'username', p.username::text,
               'name', coalesce(p.first_name, p.username::text),
               'friend', coalesce(public.are_friends(c.owner, vm.member), false)
             ) order by lower(coalesce(p.first_name, p.username::text))
           ) as members
      from public.visibility_circle_members vm
      join public.profiles p on p.user_id = vm.member
     where vm.circle_id = c.id
  ) m on true
  where c.owner = auth.uid();
$function$;

revoke all on function public.visibility_circle_save(uuid, text) from public, anon;
revoke all on function public.visibility_circle_delete(uuid) from public, anon;
revoke all on function public.visibility_circle_set_member(uuid, text, boolean) from public, anon;
revoke all on function public.my_visibility_circles() from public, anon;

grant execute on function public.visibility_circle_save(uuid, text) to authenticated;
grant execute on function public.visibility_circle_delete(uuid) to authenticated;
grant execute on function public.visibility_circle_set_member(uuid, text, boolean) to authenticated;
grant execute on function public.my_visibility_circles() to authenticated;
