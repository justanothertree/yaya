-- ✅ APPLIED 3 Nov 2026 as `an_invite_is_redeemed_once_and_only_by_a_newcomer`.
--
-- ⚠️ ONE LINK, TWO MEMBERS. The invite was read with a plain SELECT and marked used
-- with `where token = p_token` and nothing else -- so two people opening the same link both saw
-- it unused, both proceeded, and the second simply overwrote `used_by`. The invite admitted two
-- and recorded one. `for update` makes the second wait; repeating `used_at is null` on the UPDATE
-- makes it find nothing. Both, because the lock is lost the moment somebody calls this from a
-- path that does not take it.
--
-- ⚠️ AND AN EXISTING MEMBER OPENING AN INVITE OVERWROTE THEMSELVES. The profiles
-- upsert took `username` and `first_name` from the form; the user_roles upsert took `role` from
-- the INVITE'S class. Following somebody else's link renamed you and changed your class.
-- Signing up happens once, so this refuses rather than merging.
--
-- ⚠️ THE BODY'S COMMENT ABOUT AN ADMIN BEING DEMOTED IS WRONG, and the very next
-- migration corrects it in place. It is left here because this file records what was APPLIED,
-- and rewriting history to hide a mistake is a worse habit than carrying it with its correction
-- attached. `is_admin()` reads `admin_users`, not `user_roles`.
--
-- Verified in rolled-back transactions, with two throwaway auth identities:
--   a newcomer redeems it            ok; used_by is them; the inviter is friended
--   a second person, same link       refused, "invite not found or already used"
--   an existing member, FRESH link   refused, "you are already a member"
--   the admin, FRESH link            refused, same; role unchanged; invite still unused
--   their username and class after   untouched

create or replace function public.complete_member_signup(
  p_token uuid, p_username text, p_display_name text, p_contact_email text default null)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_invite record;
  v_uid uuid := auth.uid();
  v_rows int;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  /* ⚠️ FOR UPDATE, AND THE USED CHECK REPEATED ON THE WRITE. Without the lock two redemptions of
     the same link both read it as unused and both proceed; without `used_at is null` on the
     UPDATE the second one simply overwrites `used_by`, so the invite silently admits two people
     and records only the later. The lock makes the second one wait, and the guarded update makes
     it find nothing -- belt and braces, because the lock alone is lost the moment somebody calls
     this from a different path. */
  select * into v_invite
    from public.invites
   where token = p_token
     and used_at is null
     and (expires_at is null or expires_at > now())
   for update;
  if not found then raise exception 'invite not found or already used'; end if;

  /* ⚠️ AN EXISTING MEMBER OPENING AN INVITE USED TO OVERWRITE THEMSELVES. The profiles upsert set
     `username` and `first_name` from the form, and the user_roles upsert set `role` from the
     INVITE'S class -- so following somebody else's link renamed you and changed what you are.
     For an admin opening a `member` invite that is a demotion, performed by clicking a link.
     Signing up is something you do once; this refuses rather than merging. */
  if exists (select 1 from public.profiles where user_id = v_uid)
     or exists (select 1 from public.user_roles where user_id = v_uid) then
    raise exception 'you are already a member';
  end if;

  insert into public.player_registry (player_name) values (p_username)
    on conflict (player_name) do nothing;

  insert into public.profiles (user_id, username, first_name, email)
  values (v_uid, p_username, p_display_name, p_contact_email);

  insert into public.user_roles (user_id, role) values (v_uid, v_invite.class);

  update public.invites
     set used_at = now(), used_by = v_uid
   where token = p_token and used_at is null;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'invite not found or already used'; end if;

  -- ── whoever let you in is your friend ──
  -- least/greatest because friendships store the pair in a fixed order (see are_friends), and
  -- the primary key is that ordered pair.
  if v_invite.created_by is not null and v_invite.created_by <> v_uid then
    insert into public.friendships (user_a, user_b, requested_by, status, responded_at)
    values (
      least(v_invite.created_by, v_uid),
      greatest(v_invite.created_by, v_uid),
      v_invite.created_by,
      'accepted',
      now()
    )
    on conflict (user_a, user_b) do nothing;
  end if;
end;
$function$;
