-- 2026-09-15 — a profile page its owner can hand out as a link
--
--
-- WHAT THIS IS FOR
--
-- "I'm showcasing the website... I imagine some friends may want to show other people their
-- profile by linking it, if they chose public settings for stuff."
--
-- docs/2026-09-11-demo-profile.sql opened exactly one anonymous door and argued, at length, that
-- it should stay one. This widens it, so the argument has to be answered rather than skipped.
--
--
-- ⚠️ THE OLD FILE SAYS THIS SHAPE IS WRONG. Quoting it, because it is the thing being revisited:
--
--     "The obvious version of this feature is get_public_profile(p_username text) granted to
--      anon, and it is the wrong shape: the moment a username is a parameter, an anonymous
--      caller can walk the whole members table by guessing names, and every profile's public
--      tier is readable by anyone who can type."
--
-- That was right, and it is right about the version it describes — one where a username alone is
-- enough. The objection is ENUMERATION, and enumeration only bites when the answer depends on
-- something the caller did not already know. So the parameter comes back, and an opt-in comes
-- with it:
--
--   · a username is not enough. The row must have public_page set, by its owner, for itself.
--   · a name nobody has, and a name belonging to somebody who has not opted in, return the SAME
--     null through the same code path. So this cannot answer "is there a member called sarah" —
--     which is the membership oracle the sign-in page is also careful about (see
--     sendPasswordReset, which refuses to say whether an address has an account).
--   · what can be walked is therefore exactly the set of people who asked to be walkable, which
--     is what "a page I can link" means. Nobody is opted in by default.
--
-- ⚠️ EVERYTHING ELSE THE DEMO FILE DECIDED STAYS DECIDED. Public blocks and only public blocks;
-- a named field list rather than select *, so a column added to profiles later cannot appear in
-- an anonymous payload because somebody forgot this function exists; no user_id, no email, no
-- friend status, nothing about who else is on the site. Suspended profiles are not served.
--
-- ⚠️ is_demo IS NOT REPLACED. It still does its own job — the no-argument showcase page, the one
-- a visitor reaches with no name to type — and is left exactly as it is. A profile can be one,
-- the other, both or neither.
--
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists public_page boolean not null default false;

comment on column public.profiles.public_page is
  'The owner has chosen that this page can be read by anyone with the link. Gates '
  'get_public_profile and nothing else; blocks are still filtered to the public tier.';


create or replace function public.get_public_profile(p_username text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user  uuid;
  v_name  text;
  v_first text;
  v_since text;
begin
  /* ⚠️ ONE LOOKUP, and every way of failing it leaves v_user null and returns the same thing.
     No separate "no such member" branch, because the difference between "not here" and "here
     but not public" is precisely what an anonymous caller must not be able to measure. */
  if p_username is null or length(p_username) > 64 then
    return null;
  end if;

  select p.user_id, p.username::text, p.first_name, to_char(p.created_at, 'YYYY-MM-DD')
    into v_user, v_name, v_first, v_since
    from public.profiles p
   where lower(p.username::text) = lower(p_username)
     and p.public_page
     and coalesce(p.suspended, false) = false
   limit 1;

  if v_user is null then
    return null;
  end if;

  return jsonb_build_object(
    'username', v_name,
    'first_name', v_first,
    'member_since', v_since,
    'is_me', false,
    /* a stranger has no relationship, and saying so is not the same as leaving it out */
    'friend_status', null,
    'shared_circuits', '[]'::jsonb,
    'movies_rated', (
      select count(*) from public.circuit_ratings r where r.user_id = v_user
    ),
    'snake_best', (
      select jsonb_build_object('score', l.score, 'game_mode', l.game_mode,
                                'achieved', to_char(l.created_at, 'YYYY-MM-DD'))
        from public.leaderboard l
        join public.player_registry reg on reg.id = l.player_id
       where reg.user_id = v_user
       order by l.score desc
       limit 1
    ),
    /* ⚠️ 'private', exactly as the demo reports it, and NOT the owner's real setting.
       Activity is a separate feed with its own gate (get_member_activity, which already returns
       a stranger the items without the circuit NAME — see 2026-08-21-member-activity-detail).
       Wiring it to an anonymous caller is a second decision and gets its own migration; until
       then this says the true thing about what THIS payload carries, which is no activity. */
    'activity_visibility', 'private',
    'look', (
      select jsonb_build_object('theme', pl.look_theme, 'palette', pl.look_palette,
                                'flair', pl.look_flair, 'backdrop', pl.look_backdrop)
        from public.profiles pl where pl.user_id = v_user
    ),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'block_type', b.block_type, 'position', b.position,
               'size', b.size, 'config', b.config, 'visibility', b.visibility
             ) order by b.position)
        from public.profile_blocks b
       where b.user_id = v_user
         and b.visibility = 'public'
    ), '[]'::jsonb)
  );
end
$function$;

-- ⚠️ anon AND authenticated, same as the demo: a signed-in visitor following the link should see
-- the page the link promises, not a different one.
revoke all on function public.get_public_profile(text) from public;
grant execute on function public.get_public_profile(text) to anon, authenticated;


-- ── TURNING IT ON ───────────────────────────────────────────────────────────────────────────
-- Nothing changes for anybody until a profile opts itself in:
--
--   update public.profiles set public_page = true where lower(username) = lower('evan');
--
-- To take a page down again:
--
--   update public.profiles set public_page = false where lower(username) = lower('evan');
--
--
-- ── LOOK BEFORE YOU SWITCH IT ON ────────────────────────────────────────────────────────────
--
-- ⚠️ get_public_profile RETURNS NULL UNTIL public_page IS SET, so it cannot be used to preview
-- what publishing would expose — asking it first is asking the wrong question in the wrong
-- order. This is the query to run BEFORE the update above, and it needs no function and changes
-- nothing:
--
--   select b.position, b.block_type, b.visibility,
--          left(b.config::text, 200) as config_head
--     from public.profile_blocks b
--     join public.profiles p on p.user_id = b.user_id
--    where lower(p.username::text) = lower('evan')
--      and b.visibility = 'public'
--    order by b.position;
--
-- Every row it returns is a block that would be readable by anyone with the link. "Public" was a
-- setting made when only members could see the page at all, so read that list with the open
-- internet in mind rather than trusting the label it was given under the old meaning.
--
--
-- ── HOW TO CHECK IT AFTERWARDS ──────────────────────────────────────────────────────────────
-- What a stranger actually receives, once you have opted in:
--
--   select jsonb_pretty(public.get_public_profile('evan'));
--
-- A name nobody has, and a real member who has not opted in, must look identical:
--
--   select public.get_public_profile('definitely-not-a-member');  -- expect NULL
--   select public.get_public_profile('<a real member who has not opted in>');  -- expect NULL
--
-- And the set of reachable pages is exactly the set that asked to be:
--
--   select username from public.profiles where public_page;
