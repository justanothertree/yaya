-- ✅ APPLIED 3 Nov 2026 as `the_setters_say_what_they_stored`.
--
-- ⚠️ A SETTER THAT RETURNS NOTHING MAKES THE PICKER LIE, AND THE CLAMP IS WHY. All four
-- of these silently narrow a tier above the account's ceiling -- deliberately, because refusing
-- would make a new member's own default unsaveable. The cost of that silence was being paid on
-- screen: the control went on showing what was ASKED FOR while the database held something
-- narrower, so somebody capped at Friends who chose "Anyone" read "Anyone" afterwards. A privacy
-- control that overstates its reach is the one thing it must never do.
--
-- `set_my_snake_visibility` returned a ROW COUNT, which was a worse answer than it looked:
-- `player_registry` holds one row per handle, so three handles gave `3` and no handle gave `0` --
-- indistinguishable from a refusal. It returns the tier now, or null when there is no handle to
-- set, which the client reads as "nothing here to change" rather than showing a level nothing is
-- stored at. Nothing read the integer; AccountSettings.tsx destructured `{ error }` only.
--
-- `save_my_profile_blocks` returns a jsonb array of position/visibility pairs, because it saves a
-- PAGE and each block is clamped on its own. Read back from the table rather than captured from
-- the INSERT's RETURNING -- the same value by a path that shares no arithmetic with the write.
--
-- DROP + CREATE rather than CREATE OR REPLACE, because a return type cannot be replaced -- which
-- loses the ACL, hence the explicit REVOKE/GRANT. Without it check H in visibility-guards.sql
-- goes red on the next run, which is the check doing its job. `save_my_profile_blocks` is edited
-- by substitution rather than retyped: 8 kB of allowlist, caps, position-keyed lists and five
-- paragraphs of reasoning is not something to hand-copy for a one-line return.
--
-- Measured as a member whose ceiling is `members`:
--   set_my_activity_visibility(public)   returned and stored `members`
--   set_my_activity_visibility(certain)  returned `certain`
--   set_person_visibility(public)        returned `members`
--   ... on somebody else's person        refused -- "not your circuit"
--   set_my_snake_visibility(public)      returned `public` for the owner, whose ceiling allows it
--   save_my_profile_blocks([public, friends])
--                                        returned [{1, members}, {2, friends}], table agrees
--
-- ⚠️ ONE CASE IS UNEXERCISED AND WORTH KNOWING: every member on the site today has at
-- least one claimed handle, so the null return from `set_my_snake_visibility` cannot be reached
-- by anybody now. A brand-new signup has none until they claim one, and the client handles it.

/* ⚠️ A SETTER THAT RETURNS NOTHING MAKES THE PICKER LIE, AND THE CLAMP IS WHY. Every one of
   these silently narrows a tier above the account's ceiling -- deliberately, because refusing
   would make a new member's own default unsaveable. The cost of that silence was being paid on
   screen: the control kept showing what was ASKED FOR while the database held something
   narrower, so somebody who picked "Anyone" and was capped at "Friends" went on reading
   "Anyone". A privacy control that overstates its reach is the one thing it must never do.

   All four returned void or a row count, so this is DROP + CREATE rather than CREATE OR REPLACE,
   and that loses the ACL -- hence the explicit REVOKE/GRANT at the end. Without it check H in
   visibility-guards.sql would go red on the next run, which is the check doing its job. */

drop function if exists public.set_my_activity_visibility(public.visibility_tier);

create function public.set_my_activity_visibility(p_tier public.visibility_tier)
returns public.visibility_tier
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_tier public.visibility_tier;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  /* suspension reaches SECURITY DEFINER functions only here -- see the 3 Nov migration that
     guarded the first ten. These seven were missed because they are not pictures, library or
     circles: a guestbook note, two chronicle notes, a whole chronicle restore, and the three
     visibility setters. */
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  update public.profiles
     set activity_visibility = public.clamp_visibility(auth.uid(), p_tier)
   where user_id = auth.uid()
   returning activity_visibility into v_tier;
  return v_tier;
end
$$;

drop function if exists public.set_person_visibility(text, public.visibility_tier);

create function public.set_person_visibility(
  p_person_id text,
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
  /* Clamped against the ROW'S OWNER, never against auth.uid(). An admin may set a tier on
     somebody else's circuit, and the admin's own ceiling is `public` - so clamping to the caller
     would let a moderation action publish a member's person past that member's ceiling. The
     owner's ceiling is the one that describes the person being published. */
  update public.circuit_people
     set visibility = public.clamp_visibility(owner_user_id, p_tier)
   where id = p_person_id and (owner_user_id = auth.uid() or public.is_admin())
   returning visibility into v_tier;
  if v_tier is null then raise exception 'not your circuit'; end if;
  return v_tier;
end
$$;

drop function if exists public.set_my_snake_visibility(public.visibility_tier);

/* ⚠️ THIS ONE RETURNED A ROW COUNT, AND A ROW COUNT IS NOT AN ANSWER TO THE QUESTION ASKED.
   `player_registry` holds one row per HANDLE, so a member with three claimed handles got `3` and
   a member with none got `0` -- and `0` is indistinguishable from "refused". The tier is what
   the caller wanted to know. A member with no handle gets null, which the client reads as "there
   is nothing here to set", and that is the honest answer rather than a zero dressed as one.
   Nothing read the integer: AccountSettings.tsx:528 destructures `{ error }` only. */
create function public.set_my_snake_visibility(p_tier public.visibility_tier)
returns public.visibility_tier
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
  with w as (
    update public.player_registry
       set visibility = public.clamp_visibility(auth.uid(), p_tier)
     where user_id = auth.uid()
     returning visibility
  )
  /* every handle of theirs moves together, so they all hold the same value; min() is just a way
     to pick one out of a set that cannot disagree */
  select min(w.visibility) into v_tier from w;
  return v_tier;
end
$$;

/* ⚠️ `save_my_profile_blocks` IS EDITED BY SUBSTITUTION, NOT RETYPED. It is 8 kB of allowlist,
   size caps, the position-keyed Certain lists and five paragraphs explaining why each is the way
   it is -- and a hand-copied body is a chance to change something nobody asked to change. Two
   edits: the return type, and a read of what was actually stored, appended after the last write.

   It returns a jsonb array rather than one tier because it saves a PAGE: twenty blocks, each
   clamped on its own. Read back from the table rather than captured from the INSERT's RETURNING,
   which is the same value by a path that shares no arithmetic with the write. */
do $mig$
declare
  v_src text;
  v_out text;
  v_tail constant text := E'on conflict (item_kind, item_id, friend) do nothing;\nend;';
  v_add constant text := E'on conflict (item_kind, item_id, friend) do nothing;\n'
    || E'\n'
    || E'  /* WHAT WAS STORED, NOT WHAT WAS ASKED FOR. Every tier above this account''s ceiling\n'
    || E'     was quietly narrowed by the clamp above, and until now the editor had no way to\n'
    || E'     know -- so a block saved as "Anyone with an account" by a member capped at Friends\n'
    || E'     went on reading "Anyone with an account" on screen. Keyed by position, which is the\n'
    || E'     only identity a block has across this function. */\n'
    || E'  return coalesce((\n'
    || E'    select jsonb_agg(jsonb_build_object(''position'', b.position,\n'
    || E'                                        ''visibility'', b.visibility)\n'
    || E'                     order by b.position)\n'
    || E'      from public.profile_blocks b where b.user_id = v_me\n'
    || E'  ), ''[]''::jsonb);\n'
    || E'end;';
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'save_my_profile_blocks';
  if v_src is null then raise exception 'save_my_profile_blocks not found'; end if;
  if position(v_tail in v_src) = 0 then
    raise exception 'the last write is not where this migration expects it';
  end if;
  if position(' RETURNS void' in v_src) = 0 then
    raise exception 'save_my_profile_blocks no longer returns void';
  end if;

  v_out := replace(v_src, v_tail, v_add);
  v_out := replace(v_out, ' RETURNS void', ' RETURNS jsonb');
  if v_out = v_src then raise exception 'nothing was substituted'; end if;

  drop function public.save_my_profile_blocks(jsonb);
  execute v_out;
end
$mig$;

/* DROP took the ACL with it. Four functions, each member-callable and each refusing anon. */
revoke all on function public.set_my_activity_visibility(public.visibility_tier) from public, anon;
revoke all on function public.set_person_visibility(text, public.visibility_tier) from public, anon;
revoke all on function public.set_my_snake_visibility(public.visibility_tier) from public, anon;
revoke all on function public.save_my_profile_blocks(jsonb) from public, anon;
grant execute on function public.set_my_activity_visibility(public.visibility_tier) to authenticated;
grant execute on function public.set_person_visibility(text, public.visibility_tier) to authenticated;
grant execute on function public.set_my_snake_visibility(public.visibility_tier) to authenticated;
grant execute on function public.save_my_profile_blocks(jsonb) to authenticated;

do $check$
declare r record;
begin
  for r in
    select * from (values
      ('set_my_activity_visibility', 'visibility_tier'),
      ('set_person_visibility', 'visibility_tier'),
      ('set_my_snake_visibility', 'visibility_tier'),
      ('save_my_profile_blocks', 'jsonb'),
      ('chronicle_activity_set_visibility', 'visibility_tier'),
      ('chronicle_goal_set_visibility', 'visibility_tier')
    ) as v(fn, want)
  loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = r.fn
         and pg_get_function_result(p.oid) = r.want
         and p.prosecdef
         and has_function_privilege('authenticated', p.oid, 'execute')
         and not has_function_privilege('anon', p.oid, 'execute')
         and p.proconfig @> array['search_path=public, pg_temp']
    ) then
      raise exception '% is not a member-callable definer returning %, with search_path pinned',
        r.fn, r.want;
    end if;
  end loop;
end
$check$;
