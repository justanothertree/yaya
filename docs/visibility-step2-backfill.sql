-- ============================================================================
-- Visibility tiers — STEP 2 of 5: backfill so existing exposure carries.
-- Design + decisions: docs/visibility-tiers-design.md
--
-- Step 1 landed every row on 'private' via the column default. This sets
-- existing rows to what they are ALREADY exposed as today, so that when step 3
-- flips the policies nothing visibly changes for anyone.
--
-- Still safe: no policy reads `visibility` yet, so this cannot alter access.
-- ============================================================================

-- circuit_people: the old is_public boolean is the whole of today's rule.
-- Everything else stays private and remains reachable through circuit group
-- sharing, which is a separate mechanism and is untouched.
update public.circuit_people set visibility = 'public' where is_public;
update public.circuit_people set visibility = 'private' where not is_public;

-- chat_rooms: today chat_room_member() decides by kind.
--   circuit -> membership of the circuit governs        -> private
--   dm      -> membership of the room governs           -> private
--   lounge  -> any unsuspended account                  -> members
-- The tier is the floor for everyone the membership check does not already let in.
update public.chat_rooms set visibility = 'members' where kind = 'lounge';
update public.chat_rooms set visibility = 'private' where kind in ('circuit', 'dm');

-- player_registry: a handle linked to an account currently reveals the person
-- to friends only (snake_friend_names). Unlinked handles have no account behind
-- them, so the tier is moot; private is the safe resting state.
update public.player_registry set visibility = 'friends' where user_id is not null;
update public.player_registry set visibility = 'private' where user_id is null;


-- ============================================================================
-- VERIFY — the dataset is small enough to check exhaustively, not by sampling.
-- ============================================================================

-- 1. circuit_people: visibility must agree with is_public on every row.
select id, coalesce(name, '(unnamed)') as name,
       is_public, visibility::text,
       (is_public = (visibility = 'public')) as agrees
from public.circuit_people
order by id;
-- expected: agrees = true on all 8 rows

-- 2. chat_rooms: every row matches the kind mapping above.
select kind, visibility::text, count(*)
from public.chat_rooms group by 1, 2 order by 1;
-- expected: circuit/private, dm/private, lounge/members

-- 3. player_registry: linked handles are 'friends', unlinked are 'private'.
select (user_id is not null) as linked, visibility::text, count(*)
from public.player_registry group by 1, 2 order by 1;
-- expected: true/friends = 10, false/private = 98

-- 4. Nothing is accidentally public.
select 'circuit_people' as t, count(*) from public.circuit_people where visibility = 'public'
union all select 'chat_rooms', count(*) from public.chat_rooms where visibility = 'public'
union all select 'player_registry', count(*) from public.player_registry where visibility = 'public';
-- expected: circuit_people = 1 (Evan), everything else 0

-- ROLLBACK: update each table set visibility = 'private';
-- (nothing reads the column until step 3, so this is a no-op for access)
