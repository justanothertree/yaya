-- ✅ APPLIED 3 Nov 2026 as `the_cards_goal_counts_follow_each_goals_level`
-- (stamped 20261104 in UTC).
--
-- ⚠️ "N GOALS ON THE GO" WAS THE ONE THING ON THE CHRONICLE CARD THAT NO LEVEL GOVERNED.
-- `get_member_chronicle` gates goal TITLES twice -- a visible block asking for goals, and
-- `can_see_item` per goal -- and then counted `reached` and `open` over every goal the owner had,
-- with no visibility test at all. A member whose only goal is Only me told each of their friends
-- they had one on the go.
--
-- ⚠️ IT WAS A DECISION, NOT AN OVERSIGHT, which is why the migration carries an argument.
-- docs/2026-10-14-chronicle-profile-block.sql settled "counts, never titles": the counts were the
-- block's payload, gated by the block's own visibility, and the consent was for a shape rather
-- than for each row. What did not survive the Sharing panel is the premise. A goal carries its own
-- level now, and there is a room built for setting it, so "Only me" has to mean the goal is not
-- there -- not that the title is withheld while its existence is announced.
--
-- ⚠️ THE PREDICATE IS COPIED FROM THE LIST ELEVEN LINES ABOVE, never written afresh. Two filters
-- over the same rows that are meant to agree will stop agreeing; this way a goal is counted
-- exactly when it could be listed. No `v_target = v_viewer` escape is needed, because `can_see`
-- answers true for an owner at every tier and `can_see_item` short-circuits to true for them at
-- `certain`.
--
-- Verified in one rolled-back transaction. Fixture: 5 goals on a friends-visible card asking for
-- goals -- 2 private (one open, one done 2 days ago), 2 friends (one open, one done), 1 certain
-- with the viewer on its list.
--
--   the friend on the list    reached 1, open 2   titles: CERTAIN open, FRIENDS done, FRIENDS open
--   a member who is not a friend   the card is friends-only, so the whole answer is null
--   the owner                 reached 2, open 3   -- unchanged, which is the reading that must not
--                                                    change
--
-- Before this, the friend saw reached 2 and open 3: both private goals counted. The counts and the
-- titles now agree exactly -- 1 + 2 = the three titles listed.
--
-- ⚠️ THE visibility-matrix HASH DOES NOT MOVE, AND THAT IS NOT THE CHANGE FAILING. The matrix
-- walks `get_profile_blocks`, `get_member_activity` and `get_member_trophies`; none of them reads
-- `chronicle_goals` at all, let alone through this function. Asked of the catalogue rather than
-- assumed: twelve functions mention `chronicle_goals` and `get_member_chronicle` is the only one
-- of them that consults `can_see`. Measured after: cells 196, blocks 539, activity 6,945,
-- trophies 130, md5 b89fc62c856482e4e5b248651da62fa0 -- identical. A clean matrix is not a clean
-- site, as that file says of itself; the Chronicle card fetches its own figures and no matrix cell
-- has ever counted them.
--
-- The guard against it coming back lives in supabase/tests/certain-lists.sql: a viewer who can see
-- the card but not an Only-me goal must get a count that leaves it out, asserted against the
-- titles in the same answer so the two can never drift apart silently.

/* THE CARD'S GOAL COUNTS WERE THE ONE THING ON IT THAT NO LEVEL GOVERNED. `get_member_chronicle`
   gates the goal TITLES twice over -- a visible block asking for goals, and `can_see_item` per
   goal -- and then counted `reached` and `open` over every goal the owner has, with no visibility
   test at all, and returned them whether or not the block asked for goals. So a member whose only
   goal is Only me told each of their friends they had one on the go.

   It was a considered decision rather than an oversight, which is why this is a migration with an
   argument in it: the counts are the block's own payload, gated by the block's visibility, and
   "counts, never titles" was the whole shape of the consent -- see
   docs/2026-10-14-chronicle-profile-block.sql. The part that did not survive the Sharing panel is
   the premise. Once a goal carries its own level, and a person can set it in a room built for
   setting it, "Only me" has to mean the goal is not there, not that its title is withheld while
   its existence is announced.

   ⚠️ `can_see_item`, NOT A SECOND RULE OF ITS OWN, and the predicate is copied from the goals
   list eleven lines above rather than written afresh. Two filters over the same rows that are
   meant to agree will stop agreeing; this way a goal is counted exactly when it could be listed.
   It also needs no `v_target = v_viewer` escape, because `can_see` answers true for the owner at
   every tier and `can_see_item` short-circuits to true for them at `certain` -- so an owner's own
   card still counts everything, which is the one reading that must not change.

   ⚠️ AND IT STAYS IN SQL, so a hidden goal is never sent. The alternative -- counting everything
   and filtering in the client -- would put the number on the wire and leave the rule one bundle
   away from being wrong.

   ⚠️ NOT GATED ON `v_wants_goals`, deliberately. That switch decides whether titles are shown;
   it has never governed the counts and nothing here changes what it means. A card showing hours
   and no goals still says how many goals the viewer could have seen, which is now a number about
   goals that are genuinely theirs to see. */
do $mig$
declare
  v_src text;
  v_out text;
  v_old constant text :=
    E'  select count(*) filter (where g.done_at is not null and g.done_at >= v_from),\n'
    || E'         count(*) filter (where g.done_at is null)\n'
    || E'    into v_reached, v_open\n'
    || E'  from public.chronicle_goals g\n'
    || E'  where g.owner = v_target;\n';
  v_new constant text :=
    E'  -- ⚠️ THE SAME PREDICATE AS THE LIST ABOVE, so a goal is COUNTED exactly when it could be\n'
    || E'  -- LISTED. These used to count every goal the owner had: a member whose only goal was\n'
    || E'  -- Only me told each of their friends they had one on the go. No `v_target = v_viewer`\n'
    || E'  -- escape is needed -- can_see answers true for the owner at every tier -- so an owner''s\n'
    || E'  -- own card still counts everything.\n'
    || E'  select count(*) filter (where g.done_at is not null and g.done_at >= v_from),\n'
    || E'         count(*) filter (where g.done_at is null)\n'
    || E'    into v_reached, v_open\n'
    || E'  from public.chronicle_goals g\n'
    || E'  where g.owner = v_target\n'
    || E'    and public.can_see_item(v_target, g.visibility,\n'
    || E'                            ''chronicle_goal'', g.id::text);\n';
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'get_member_chronicle';
  if v_src is null then raise exception 'get_member_chronicle not found'; end if;
  if (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'the goal counts are not where this migration expects them';
  end if;
  v_out := replace(v_src, v_old, v_new);
  execute v_out;
end
$mig$;
