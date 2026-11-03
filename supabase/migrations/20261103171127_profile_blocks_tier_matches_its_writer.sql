-- ✅ APPLIED 3 Nov 2026 as `profile_blocks_tier_matches_its_writer`.
--
-- `save_my_profile_blocks` validates `visibility` against four values and nothing else enforced
-- that, so any writer which was not that function could store a fifth. Now the table says it.
--
-- ⚠️ THE LADDER HAS FIVE LEVELS AND THIS TABLE ACCEPTS FOUR, deliberately. `certain`
-- has no per-item list behind it yet, so a block holding it would be a tier no reader honours --
-- and a control that overstates what it does is the one thing a privacy control must never be.
-- This constraint is expected to change when per-item lists land.
--
-- Current values at the time of writing: friends 3, members 27, public 10 -- all inside the set.

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profile_blocks_tier_accepted') then
    /* The same four values `save_my_profile_blocks` validates against, as a CHECK, so the rule
       survives a writer that is not that function. The ladder has FIVE levels and this table
       accepts four: `certain` has no per-item list behind it yet, and a tier this table can hold
       but no reader honours is worse than one it refuses.

       ⚠️ POSITIVE LIST RATHER THAN `<> 'certain'`, so a sixth tier added to the enum later is
       refused here until somebody decides what it means for a block -- a negative test would let
       it straight in. This constraint is expected to change when per-item lists land; that is
       the point at which `certain` becomes a thing a block can honestly be. */
    alter table public.profile_blocks
      add constraint profile_blocks_tier_accepted
      check (visibility in ('public', 'friends', 'members', 'private'));
  end if;
end $$;
