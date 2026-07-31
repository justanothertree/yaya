-- ============================================================================
-- Visibility tiers — STEP 3b: two bugs found reviewing steps 1-3.
-- APPLIED 2026-07-31. Both were introduced by this epic, not pre-existing.
-- ============================================================================
--
-- BUG 1 (the serious one) — circuit_people had TWO sources of truth.
--
--   step 2 backfilled `visibility` from `is_public` and left both columns live:
--     set_person_public()        wrote is_public   only
--     circuit_public()           read  is_public   only
--     circuit_can_see_person()   read  visibility  only   <- new in step 3
--
--   So the moment anyone used the "Make public" toggle in CircuitsPanel, the two
--   would disagree, and in the dangerous direction: circuit_public() would serve
--   the board to the entire internet while the members-side predicate still
--   treated it as private. Toggling back off had the mirror problem.
--
--   FIX: `visibility` is authoritative everywhere. circuit_public() now selects
--   on visibility = 'public'; set_person_public() writes BOTH columns so nothing
--   can drift before is_public is dropped in step 5.
--
--   VERIFIED: public board output identical to before the swap (1 person,
--   71 movies) and `select count(*) from circuit_people
--   where is_public <> (visibility = 'public')` returns 0.
--
--
-- BUG 2 — claiming a Snake handle left it at the 'private' default.
--
--   The 10 already-linked handles were backfilled to 'friends', so the
--   friends-only reveal kept working for them. But claim_snake_name,
--   claim_my_reserved_snake_name, link_snake_names_to_accounts and
--   complete_member_signup all set user_id without touching visibility, so
--   every handle claimed from now on would have stayed private and silently
--   never revealed to friends. Works for existing people, broken for new ones,
--   with no error -- the worst shape of bug.
--
--   FIX: a trigger on the unlinked -> linked transition, so it covers all four
--   paths and any future writer. It only fires on that transition, so someone
--   who deliberately sets 'private' afterwards keeps it.
--
--   VERIFIED in a rolled-back transaction:
--     1. inserted, unlinked          -> private
--     2. claimed by an account       -> friends
--     3. owner later chooses private -> private   (choice preserved)
--
-- The SQL for both is in migration `visibility_fix_dual_source_and_snake_claim`.
-- ============================================================================

-- Standing check — run after any change touching circuit_people. Must be 0
-- until step 5 drops is_public.
select count(*) as flags_disagree
from public.circuit_people
where is_public <> (visibility = 'public');

-- Standing check — a linked handle should never sit at 'private' unless its
-- owner chose that deliberately. Worth eyeballing rather than asserting zero.
select player_name, visibility::text
from public.player_registry
where user_id is not null and visibility = 'private';
