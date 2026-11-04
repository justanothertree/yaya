-- ✅ APPLIED 3 Nov 2026 as `the_panel_says_when_the_card_itself_reaches_nobody`
-- (stamped 20261104 in UTC).
--
-- ⚠️ THE SHARING PANEL SAID "FRIENDS CAN SEE YOUR SITTINGS" ABOUT A CARD SET TO ONLY ME.
-- Not a new bug -- it shipped with the panel -- and the cause is that the panel asked the one
-- question an owner cannot fail. `chronicle_shares_timeline(p_owner)` ends in
-- `can_see_item(p_owner, b.visibility, 'profile_block', b.id)`, which is exactly right for its
-- other two callers: `feed_recent` and `chronicle_friends_log` ask it about SOMEBODY ELSE, where
-- "can I see their block" is the question and the viewer is the one being tested. Called by the
-- owner about their own block it is always true.
--
-- Measured on the one chronicle card on the site, forced to each tier in a rolled-back
-- transaction: `can_see_item` answered t at `friends`, t at `private` and t at `certain` with an
-- empty list, while `item_reaches_anyone` said f for the last two. So `timeline` came back true in
-- all three. The switch read On, all 23 activity rows read their levels, and the reach was nobody.
--
-- ⚠️ THE SWITCH'S OWN STATE IS NOT THE BUG AND MUST NOT CHANGE, which is why this adds keys
-- rather than fixing `timeline`. A tick that un-ticks itself because the card is private is a
-- control fighting the person holding it: they press it again and watch it bounce. The missing
-- fact is a SECOND one, the same shape as `reaches` on an activity row -- the level is one thing
-- and whether it arrives anywhere is another.
--
-- ⚠️ AND ONE KEY PER SWITCH RATHER THAN ONE FOR THE CARD. `get_member_chronicle` reads its two
-- opt-ins with `bool_or` over every chronicle block the viewer may see, so a timeline on a private
-- block and goals on a friends-visible one is a reachable state, and a single `cardReaches` would
-- claim reach for whichever half did not have it. Each key asks for its own config key on its own
-- block, so it cannot be wrong for a shape nobody has rather than merely unlikely to be.
--
-- Verified after, in one rolled-back transaction (the card's tier and config perturbed in turn):
--   friends                 timeline=t timelineReaches=t wantsGoals=t goalsReach=t  hasCard=t
--   private                 timeline=t timelineReaches=f wantsGoals=t goalsReach=f
--   certain, empty list     timeline=t timelineReaches=f wantsGoals=t goalsReach=f
--   certain, one friend     timeline=t timelineReaches=t wantsGoals=t goalsReach=t
--   `goals` key removed     wantsGoals=f goalsReach=f  timelineReaches=t
--   `goals` only, no timeline  timeline=f timelineReaches=f wantsGoals=t goalsReach=t
--   anon may execute        f
--
-- The last two rows are the ones that prove the keys are independent rather than one fact twice.
--
-- The counts on the profile card -- "1 goal on the go" -- are deliberately NOT touched. They are
-- the Chronicle block's documented payload, gated by the block's own visibility and showing no
-- titles: see docs/2026-10-14-chronicle-profile-block.sql and the note on ChronicleBlock in
-- ProfileBlocks.tsx. A goal's own level governs its TITLE. The panel's copy says so rather than
-- implying that `private` hides a goal's existence from somebody who can see the card.

/* THE PANEL SAID "FRIENDS CAN SEE YOUR SITTINGS" ABOUT A CARD SET TO ONLY ME, and the reason is
   that it asked the one question an owner cannot fail. `chronicle_shares_timeline(p_owner)` ends
   in `can_see_item(p_owner, b.visibility, 'profile_block', b.id)`, which is exactly right for its
   other two callers -- `feed_recent` and `chronicle_friends_log` ask it about SOMEBODY ELSE, where
   "can I see their block" is the question. Called by the owner about themselves it is always true:
   measured on the one chronicle card on the site, forced to each tier in a rolled-back
   transaction, `can_see_item` answered t at `friends`, t at `private` and t at `certain` with an
   empty list, so `timeline` came back true in all three while `item_reaches_anyone` said f for the
   last two. The switch read On, every activity row read Friends, and the reach was nobody.

   ⚠️ THE SWITCH'S OWN STATE IS NOT THE BUG AND MUST NOT CHANGE. `timeline` is what the owner
   ticked, and a tick that un-ticks itself because the card is private would be a control fighting
   the person holding it -- they would press it again and watch it bounce. The missing fact is a
   SECOND one, which is the same shape as `reaches` on an activity row: the level is one thing and
   whether it arrives anywhere is another. So this adds two keys and alters none.

   ⚠️ AND ONE PER SWITCH RATHER THAN ONE FOR THE CARD, because the two halves can sit on different
   blocks. `get_member_chronicle` reads its opt-ins with `bool_or` over every chronicle block the
   viewer may see, so a timeline on a private block and goals on a friends-visible one is a
   reachable state, and a single `cardReaches` would claim reach for whichever half did not have
   it. Each key asks for its own config key and its own block, which cannot be wrong for a shape
   nobody has rather than merely unlikely to be.

   Written out in full rather than patched again: two surgical substitutions have landed on this
   body and no file in the repository held its text. */
create or replace function public.chronicle_sharing_mine()
returns jsonb
language sql
stable security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    /* THE TICK, NOT THE REACH -- see `timelineReaches` below for whether it arrives anywhere */
    'timeline', public.chronicle_shares_timeline(auth.uid()),
    'hasCard', exists (select 1 from public.profile_blocks
                        where user_id = auth.uid() and block_type = 'chronicle'),
    'activities', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'cat', a.cat,
                                          'colour', a.colour, 'shared', a.shared,
                                          'reaches', public.item_reaches_anyone(
                                            auth.uid(), a.visibility,
                                            'chronicle_activity', a.id::text),
                                          'visibility', a.visibility)
                       order by public.item_reaches_anyone(
                                  auth.uid(), a.visibility,
                                  'chronicle_activity', a.id::text) desc,
                                a.name)
        from public.chronicle_activities a
       where a.owner = auth.uid() and a.archived_at is null), '[]'::jsonb),
    /* the SECOND switch -- a block asking for goals, which is not the timeline's */
    'wantsGoals', exists (select 1 from public.profile_blocks
                            where user_id = auth.uid() and block_type = 'chronicle'
                              and coalesce((config->>'goals')::boolean, false)),
    /* whether the card carrying each switch reaches anybody at all. `item_reaches_anyone`, never
       `can_see_item`: the owner is asking about themselves and can always see their own block. */
    'timelineReaches', exists (select 1 from public.profile_blocks b
                                where b.user_id = auth.uid() and b.block_type = 'chronicle'
                                  and coalesce((b.config->>'timeline')::boolean, false)
                                  and public.item_reaches_anyone(
                                        auth.uid(), b.visibility,
                                        'profile_block', b.id::text)),
    'goalsReach', exists (select 1 from public.profile_blocks b
                           where b.user_id = auth.uid() and b.block_type = 'chronicle'
                             and coalesce((b.config->>'goals')::boolean, false)
                             and public.item_reaches_anyone(
                                   auth.uid(), b.visibility,
                                   'profile_block', b.id::text)),
    'goals', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'title', g.title,
                                          'done', g.done_at is not null,
                                          'shared', g.shared,
                                          'reaches', public.item_reaches_anyone(
                                            auth.uid(), g.visibility,
                                            'chronicle_goal', g.id::text),
                                          'visibility', g.visibility)
                       order by public.item_reaches_anyone(
                                  auth.uid(), g.visibility,
                                  'chronicle_goal', g.id::text) desc,
                                g.priority desc, g.sort, g.title)
        from public.chronicle_goals g
       where g.owner = auth.uid()), '[]'::jsonb))
  where auth.uid() is not null;
$$;
