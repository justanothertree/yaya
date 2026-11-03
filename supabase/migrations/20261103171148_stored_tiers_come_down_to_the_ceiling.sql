-- ✅ APPLIED 3 Nov 2026 as `stored_tiers_come_down_to_the_ceiling`.
--
-- Evan's decision, 3 Nov: tighten the rows that sit above their owner's ceiling now.
--
--   column                          before   after
--   profiles.activity_visibility         1       0
--   circuit_people.visibility            1       0
--   profile_blocks.visibility            3       0
--   player_registry.visibility           0       0
--   chronicle_activities / _goals        0       0   (a second, lower cap of their own)
--
-- ⚠️ NOBODY'S EFFECTIVE VISIBILITY CHANGED, AND THAT IS PROVABLE RATHER THAN MERELY
-- MEASURED. The read doors already compute `least(stored, ceiling)`; this sets
-- `stored := least(stored, ceiling)`; and `least(least(x,c),c) = least(x,c)`. The
-- member-to-member matrix is unchanged afterwards (196 cells / 539 / 7,118 / 130, md5
-- 8e163d91a6925025e270416c6d387718), which is the expected result rather than a sign that
-- nothing happened.
--
-- What it removes is the LATENT widening: those stored values were held back only by the
-- ceiling, and would have activated the day a ceiling rose -- a member marked admin, or
-- publishing opening to adults, as the plan intends. Nobody chooses that on the day it happens.
--
-- From now on `visibility-guards.sql` FAILS on any row above its ceiling, where it used to
-- report one. It could not fail before: a suite that stays red until somebody else's data is
-- rewritten is a suite that gets ignored.

/* Bring every stored tier down to what its owner is allowed to choose.

   These are real members' saved settings, which is why they sat untouched until Evan said to
   tighten them: rewriting another member's choice is the owner's call under CLAUDE.md §4, not a
   migration's. Two things make it the right call rather than a loss. The read doors already
   clamp, so nobody's effective visibility changes today -- what changes is that the stored value
   stops disagreeing with it. And "Anyone" honestly meant "any member" when these were chosen,
   because only members could load a profile then, so `members` records the intent more faithfully
   than `public` does.

   What it removes is a LATENT widening: `least(stored, ceiling)` starts returning the wider value
   the day a ceiling rises -- a member marked admin, or publishing opening to adults -- and nobody
   chooses that on the day it happens.

   Counted immediately before this ran: profiles 1, circuit_people 1, profile_blocks 3,
   player_registry 0. Only rows strictly above their ceiling are touched. */

update public.profiles p
   set activity_visibility = least(p.activity_visibility, public.visibility_ceiling(p.user_id))
 where p.activity_visibility > public.visibility_ceiling(p.user_id);

update public.circuit_people c
   set visibility = least(c.visibility, public.visibility_ceiling(c.owner_user_id))
 where c.visibility > public.visibility_ceiling(c.owner_user_id);

update public.profile_blocks b
   set visibility = least(b.visibility, public.visibility_ceiling(b.user_id))
 where b.visibility > public.visibility_ceiling(b.user_id);

update public.player_registry r
   set visibility = least(r.visibility, public.visibility_ceiling(r.user_id))
 where r.visibility > public.visibility_ceiling(r.user_id);
