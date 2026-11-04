-- ✅ APPLIED 3 Nov 2026 as `the_sharing_panel_gets_its_goals_half` (stamped 20261104 in UTC).
--
-- ⚠️ `certain` WORKED FOR A GOAL ALL THE WAY DOWN AND HAD NO CONTROL ANYWHERE ON SCREEN.
-- `chronicle_goal_set_visibility` stores the level, `can_see_item` honours its list,
-- `chronicle_export` carries the list and `chronicle-round-trip.sql` proves it comes back. The
-- only thing a person could press that reached the level at all was the ◉ glyph in a goal row,
-- which cycles two states and sits in a cluster of three identical-looking buttons -- so the tier
-- was reachable from a restored file and from nowhere anybody would look. The Sharing panel
-- already owns this question for activities; this is the same payload for goals.
--
-- ⚠️ A GOAL'S SWITCH IS NOT THE TIMELINE'S, AND CONFLATING THEM WOULD BE A LIE ON SCREEN.
-- The panel's "Share my Chronicle with friends" is `chronicle_shares_timeline`, which asks
-- whether a visible chronicle block has `config.timeline` -- that is the SITTINGS switch. A goal
-- reaches a profile through a different one: `get_member_chronicle` shows goals only when a
-- visible block has `config.goals`. Two keys in one block's config, two independent answers, and
-- a goals section gated on the timeline switch would hide itself from somebody whose card shows
-- goals and no timeline -- which is the one person it is for. `wantsGoals` is that second switch,
-- so the section can name which of the two halves is missing instead of implying there is one.
--
-- ⚠️ AND `reaches` PER GOAL, FOR THE REASON THE ACTIVITIES ALREADY HAVE IT. A goal at `certain`
-- with nobody on its list is SET to a sharing level and reaches no one, so a row built on the
-- tier alone reads as shared. `item_reaches_anyone` is the same predicate `get_member_chronicle`
-- reaches through `can_see_item`, so the panel's row and the profile's strip cannot disagree.
--
-- Not capped, deliberately, where `get_member_chronicle` caps the PROFILE at six goals. Those are
-- two different questions: the profile is a display and six is a kindness to the reader, while
-- this is the control surface, and a goal missing from it is a goal whose audience cannot be
-- changed. The ordering puts whatever reaches somebody first, so the ones that matter sit at the
-- top of a long list rather than lost in it.
--
-- Verified in a rolled-back transaction, as the member with goals at three different tiers:
--   wantsGoals (that member's card currently)   true
--   goals returned                              4
--   Certain, one friend      {"vis":"certain","shared":false,"reaches":true}
--   Shared with everyone     {"vis":"friends","shared":true,"reaches":true}
--   Certain, nobody picked   {"vis":"certain","shared":false,"reaches":false}
--   the first three, in order   Certain, one friend | Shared with everyone | Make my website better
--   wantsGoals after the card stops asking for goals   false
--   and timeline is still its own answer               true
--
-- The substitution is the surgical kind for the reason the PLACEHOLDER incident gives: the body
-- it edits is 60-odd lines this migration has no business retyping, and `replace` on a tail it
-- asserts appears exactly once cannot mistype the part it leaves alone.

/* THE GOALS HALF OF SHARING, WHICH HAD NO ROOM OF ITS OWN. `certain` works for a goal all the way
   down -- `chronicle_goal_set_visibility` stores it, `can_see_item` honours it, the export carries
   its list -- and the only control that could reach it was the ◉ glyph in the goal row, which is
   two states wide and sits in a cluster of three. So the level was reachable from a file and from
   nowhere a person would look. The Sharing panel already owns this question for activities; this
   is the same payload for goals.

   ⚠️ A GOAL'S SWITCH IS NOT THE TIMELINE'S, AND CONFLATING THEM WOULD BE A LIE ON SCREEN. The
   panel's "Share my Chronicle with friends" is `chronicle_shares_timeline`, which asks whether a
   visible chronicle block has `config.timeline` -- that is the SITTINGS switch. A goal reaches a
   profile through a different one: `get_member_chronicle` shows goals only when a visible block
   has `config.goals`. Two blocks' worth of config, two independent answers, and a goals section
   gated on the timeline switch would hide itself for somebody whose card shows goals and no
   timeline. `wantsGoals` is that second switch, so the section can say which of the two halves is
   missing instead of implying there is one.

   ⚠️ AND `reaches` PER GOAL FOR THE REASON THE ACTIVITIES HAVE IT. A goal at `certain` with nobody
   on its list is SET to a sharing level and reaches no one, so a row built on the tier alone reads
   as shared. `item_reaches_anyone` is the same predicate `get_member_chronicle` effectively asks
   through `can_see_item`, so the panel's row and the profile's strip cannot disagree.

   Not capped, deliberately, where `get_member_chronicle` caps the PROFILE at six. These are two
   different questions: the profile is a display and six is a kindness to the reader, while this is
   the control surface and a goal missing from it is a goal whose audience cannot be changed. The
   ordering puts whatever reaches somebody first, so the ones that matter are at the top of a long
   list rather than lost in it. */
do $mig$
declare
  v_src text;
  v_out text;
  v_old constant text :=
    E'       where a.owner = auth.uid() and a.archived_at is null), ''[]''::jsonb))\n'
    || E'  where auth.uid() is not null;\n';
  v_new constant text :=
    E'       where a.owner = auth.uid() and a.archived_at is null), ''[]''::jsonb),\n'
    || E'    /* the SECOND switch -- a block asking for goals, which is not the timeline''s */\n'
    || E'    ''wantsGoals'', exists (select 1 from public.profile_blocks\n'
    || E'                            where user_id = auth.uid() and block_type = ''chronicle''\n'
    || E'                              and coalesce((config->>''goals'')::boolean, false)),\n'
    || E'    ''goals'', coalesce((\n'
    || E'      select jsonb_agg(jsonb_build_object(''id'', g.id, ''title'', g.title,\n'
    || E'                                          ''done'', g.done_at is not null,\n'
    || E'                                          ''shared'', g.shared,\n'
    || E'                                          ''reaches'', public.item_reaches_anyone(\n'
    || E'                                            auth.uid(), g.visibility,\n'
    || E'                                            ''chronicle_goal'', g.id::text),\n'
    || E'                                          ''visibility'', g.visibility)\n'
    || E'                       order by public.item_reaches_anyone(\n'
    || E'                                  auth.uid(), g.visibility,\n'
    || E'                                  ''chronicle_goal'', g.id::text) desc,\n'
    || E'                                g.priority desc, g.sort, g.title)\n'
    || E'        from public.chronicle_goals g\n'
    || E'       where g.owner = auth.uid()), ''[]''::jsonb))\n'
    || E'  where auth.uid() is not null;\n';
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'chronicle_sharing_mine';
  if v_src is null then raise exception 'chronicle_sharing_mine not found'; end if;
  if (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'the tail of chronicle_sharing_mine is not where this migration expects it';
  end if;
  v_out := replace(v_src, v_old, v_new);
  execute v_out;
end
$mig$;
