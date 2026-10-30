-- ✅ APPLIED 30 Oct 2026 as `everyone_here_today_is_an_adult`.
--
-- Evan, who knows every member of this site personally, states that none of the fourteen is a
-- minor. This records that, and it is the input Phase 2 was gated on.
--
-- ⚠️ IT SETS ONLY ROWS THAT WERE UNKNOWN. `where age_band is null` rather than a blanket update,
-- so a row somebody has deliberately marked `minor` can never be cleared by re-running this.
-- Thirteen rows moved; evan's was already `adult` from `feed_waits_for_an_adult`.
--
-- ⚠️ THE DEFAULT IS UNTOUCHED AND MUST STAY UNTOUCHED. `profiles.age_band` has no column default
-- and `complete_member_signup` never mentions it, so the next person through the invite flow
-- lands as NULL — unknown — and `visibility_ceiling` caps them at `friends` until somebody marks
-- them. That is the whole protection for the next minor to join, and it survives precisely
-- because nothing here made 'adult' a default. Checked both halves rather than assumed:
-- `pg_attrdef` has no entry for the column, and the signup function's text does not contain
-- `age_band`.
--
-- After: 14 adult, 0 unknown, 0 minor. Ceilings: 13 × members, 1 × public (evan, the only admin).

update public.profiles
   set age_band = 'adult'
 where age_band is null;
