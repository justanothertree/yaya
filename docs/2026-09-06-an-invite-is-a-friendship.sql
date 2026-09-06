-- 2026-09-06 — if you invited them, you are friends
--
-- WHY: an invite link is the strongest statement of "I know this person" the site has. You
-- generated a token, you sent it to someone, they used it to make an account. And then the two
-- of you were strangers to the software: no friendship, so no shared pool, no reviews visible to
-- each other, and a friend request still to send to somebody you had just personally let in.
--
-- Signing up through your invite now makes you friends, and the eight invites already spent are
-- backfilled to match — "if I've invited someone they should be my friend" reads on the past
-- tense too, and it is the same rule either way.
--
--
-- ⚠️ NO EXISTING ROW IS TOUCHED. `on conflict do nothing`, deliberately, rather than upserting
-- the pair to 'accepted'. If a friendship row already exists it is either already accepted
-- (nothing to do) or it is pending or declined — and a decline is somebody's explicit no. An
-- invite is a good reason to CREATE a friendship and a terrible reason to overturn a refusal,
-- which is what a blanket upsert would quietly do.
--
--
-- ⚠️ CLASS-AGNOSTIC. Invites carry a `class` (all nine so far are 'friend'; the column allows
-- family too) which becomes the member's role. Whichever it is, you invited them — the role
-- decides what they can do on the site, not whether you know each other.

begin;

create or replace function public.complete_member_signup(
  p_token uuid,
  p_username text,
  p_display_name text,
  p_contact_email text default null::text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_invite record;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select * into v_invite
    from public.invites
   where token = p_token
     and used_at is null
     and (expires_at is null or expires_at > now());
  if not found then raise exception 'invite not found or already used'; end if;
  insert into public.player_registry (player_name) values (p_username)
    on conflict (player_name) do nothing;
  insert into public.profiles (user_id, username, first_name, email)
  values (v_uid, p_username, p_display_name, p_contact_email)
  on conflict (user_id) do update
    set username = excluded.username,
        first_name = excluded.first_name,
        email = coalesce(excluded.email, public.profiles.email),
        updated_at = now();
  insert into public.user_roles (user_id, role) values (v_uid, v_invite.class)
  on conflict (user_id) do update set role = excluded.role;
  update public.invites set used_at = now(), used_by = v_uid where token = p_token;

  -- ── the new part: whoever let you in is your friend ──
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

-- ── backfill: the invites already spent ─────────────────────────────────────────────────────
-- Eight used, all with a recorded inviter, five of those pairs already friends by hand — so
-- this creates three. Measured before running; a different number means something moved.
-- ⚠️ `distinct on` the PAIR, not on the whole row. Two invites between the same two people
-- would otherwise both be selected — same pair, different used_at — and one statement offering
-- the same primary key twice is a needless thing to hand the conflict clause.
insert into public.friendships (user_a, user_b, requested_by, status, responded_at)
select distinct on (least(i.created_by, i.used_by), greatest(i.created_by, i.used_by))
       least(i.created_by, i.used_by),
       greatest(i.created_by, i.used_by),
       i.created_by,
       'accepted',
       coalesce(i.used_at, now())
from public.invites i
where i.used_by is not null
  and i.created_by is not null
  and i.created_by <> i.used_by
order by least(i.created_by, i.used_by), greatest(i.created_by, i.used_by), i.used_at
on conflict (user_a, user_b) do nothing;

-- ── while we are here: grants that do nothing but could ─────────────────────────────────────
/*
 * ⚠️ NOT A HOLE TODAY, and worth saying so precisely rather than dressing it up. `invites` has
 * RLS enabled with ZERO policies, so every direct read and write is already denied and the
 * table is reachable only through the definer RPCs. `friendships` has exactly one policy —
 * select, where you are one of the pair — so all direct writes are denied there too, and anon
 * has no auth.uid() and therefore matches nothing.
 *
 * But both tables still carry SELECT/INSERT/UPDATE/DELETE/TRUNCATE grants for `anon`, which is
 * inert only because of what is absent. The day somebody adds a permissive write policy `to
 * public` — the same shape as the select policy already there — that grant is what decides
 * whether a signed-out stranger can use it. Taking it away costs nothing and removes the
 * standing dependency on nobody making that mistake. Same reasoning as 2026-09-04's anon trim.
 */
-- Verified first that this cannot break signing up: get_invite_by_token is SECURITY DEFINER
-- owned by postgres and granted to anon, so the signed-out invite preview reads the table
-- through the function's privileges, not through anon's.
revoke all on public.invites from anon;
revoke all on public.friendships from anon;

commit;

-- ── HOW TO CHECK IT WORKED ──────────────────────────────────────────────────────────────────
--   select count(*) from public.friendships where status='accepted';   -- 6 before, 9 after
--   select count(*) from public.invites i
--    where i.used_by is not null and i.created_by is not null
--      and not public.are_friends(i.created_by, i.used_by);            -- 0
-- Nothing in the app changes: AcceptInvite already calls complete_member_signup, so the next
-- person to use a link is simply friends with whoever sent it.
--
-- ── THE OTHER OPTION, WRITTEN OUT AND NOT RUN ───────────────────────────────────────────────
-- "Everyone on the website is my friend, like Tom." One trigger on profiles would do it:
--
--   create function public.befriend_the_owner() returns trigger
--   language plpgsql security definer set search_path to 'public' as $$
--   declare v_owner uuid := '<your user id>';
--   begin
--     if new.user_id <> v_owner then
--       insert into public.friendships (user_a, user_b, requested_by, status, responded_at)
--       values (least(v_owner, new.user_id), greatest(v_owner, new.user_id),
--               v_owner, 'accepted', now())
--       on conflict (user_a, user_b) do nothing;
--     end if;
--     return new;
--   end $$;
--   create trigger profiles_befriend_owner after insert on public.profiles
--     for each row execute function public.befriend_the_owner();
--
-- ⚠️ IT IS NOT SYMMETRICAL WITH THE INVITE RULE, and the difference matters more the more open
-- the site gets. An invite means you personally know them. "Everyone" means whoever the door
-- lets in — so while every account still comes from a link you sent, the two rules agree; the
-- moment anybody can sign up, or your friends can invite their own friends, this one makes
-- every stranger able to see everything you have marked friends-only, and puts them in every
-- pool you aim at "all my friends". That is the decision to make before opening the door, not
-- after, which is why this is a comment.
