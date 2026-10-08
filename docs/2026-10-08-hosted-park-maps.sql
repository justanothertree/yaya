-- 2026-10-08 — a map you can host, and other people can walk into.
--
-- ✅ APPLIED as migrations:
--      park_maps_published_and_hosted_rooms
--      park_map_rpcs
--      park_map_rpcs_lock_out_anon
--
-- ── WHY ────────────────────────────────────────────────────────────────────────────────────
--
-- Asked for as: "join a friend on their map and they cant join me on my map. should be hosted
-- searchable and inviteable/joinable like snake".
--
-- That was not an oversight. `joinPark` refuses the socket outright while `worldIsDrawn()`, and
-- commit 38c225a says why: "A drawn map is not on the wire — the relay has no message for one
-- and adding it would mean every client agreeing how to read a drawing — so two people in one
-- room with different maps would stand on rocks the other cannot see and be stopped by hedges
-- that are not there."
--
-- Half of that reasoning has since stopped being true, and half of it never was the real
-- obstacle:
--
--   * "every client agreeing how to read a drawing" is SOLVED. The relay already carries
--     drawings — every player's `look` and every `boss`'s art — through packLook/readDrawing,
--     with a thinning ladder so a detailed creature gets a rougher copy instead of a refusal.
--
--   * The real obstacle is SIZE. The relay refuses anything over 12,000 characters (park looks
--     are capped at 11,500 and thinned to fit). A map is capped at 200KB — about 17x that. A map
--     carries a palette of up to 24 drawings, its pieces, a ground drawing and a 23,040-cell
--     no-walk grid. It is not a message; it is a document.
--
-- So the map does not go on the wire at all. It lives here, the room carries a REFERENCE, and
-- every client fetches the same bytes by id before it stands on them. That is also what makes it
-- searchable: a map with an id, an owner and a name is a thing you can look up.
--
-- ── WHY NOT member_library ─────────────────────────────────────────────────────────────────
--
-- It was the obvious home and it does not fit, for two reasons that are both hard constraints
-- rather than preferences:
--
--   member_library_body_size   CHECK (octet_length(body::text) <= 131072)      -- 128KB
--   member_library_kind_check  CHECK (kind = ANY ('{song,loop,art,look,pet,wins}'))
--
-- A map is capped at 200KB locally. Putting maps in that table means either a server cap TIGHTER
-- than the client's — which is the "silent half-save" the library already paid for once, where
-- `put` discards the refusal and the person is told "Kept" about something the account will never
-- hold — or raising a cap that five other kinds share. One home per thing.
--
-- ── THE SHAPE, AND WHERE IT CAME FROM ──────────────────────────────────────────────────────
--
-- Almost none of this is new. `profile_rooms` / `profile_room_invites` already solve "a host
-- opens a room, an audience may enter, an invite is an explicit grant", and park_room_member is
-- profile_room_member with the park's audiences. Copying a pattern that is already reviewed beats
-- inventing a second one that has to be reviewed from scratch.
--
--   park_maps          a map somebody published. RLS on, ZERO policies, NO grants.
--   park_rooms         one per host (unique owner), pointing at one of their maps.
--   park_room_invites  (room, user) — an explicit grant, whatever the audience says.
--
-- Caps, and the bill they bound:
--   * 256KB per map server-side, deliberately LOOSER than the client's 200KB. The server cap must
--     never be the tighter of the two or a map that saved locally is refused here with nothing to
--     say about it.
--   * four published maps per person, counted excluding the name being written so saving over a
--     map you already published is never refused for being one too many.
--   * worst case for eight people: 8 x 4 x 256KB ~ 8MB, against 26MB used of a 500MB free tier.
--     Publishing is opt-in, so the usual case is far less. Revisit at ~50 active hosts, which is
--     the same line member_library's note draws.
--
-- 'public' is not an offered audience. A park is for members and the relay has no anonymous door.
--
-- ── WHAT WAS CHECKED, AND WHAT CAME BACK ───────────────────────────────────────────────────
--
-- Every probe below ran inside BEGIN ... ROLLBACK against two real accounts (Cam hosting, Josh
-- visiting, who are NOT friends — checked, because "visitor sees nothing" is worthless if they
-- were never entitled to see anything).
--
--   anon                      may_execute_map false, may_browse false, may_publish false,
--                             may_read_table false
--   authenticated, direct     permission denied for table park_rooms   <- the deny-all is real,
--                             and this is what the probe hit when it tried to cheat past the RPCs
--   host, RPCs only           publishes, opens, lists own maps 1, sees own room 1, gets map true
--   visitor, not a friend     sees room 0, browse 0, host's maps 0
--   visitor, INVITED          sees room 1, browse 1, gets map TRUE, host's maps STILL 0
--   host closes the park      invited visitor: sees room 0, browse 0
--
-- The invited row is the control: one thing changed and exactly the right things moved. The last
-- column of it is the one worth keeping — an invite grants THIS ROOM'S MAP, never the host's
-- library.
--
-- Advisors after the change: the only findings naming these objects are `rls_enabled_no_policy`
-- (INFO) on all three tables, which IS the house pattern and which member_library carries too,
-- and `authenticated_security_definer_function_executable` on the RPCs, which is the point of
-- them — they are the only door and each checks auth.uid() itself. None of them appear under
-- `anon_security_definer_function_executable`.
--
-- ⚠️ STANDING CHECK. `revoke ... from public` does NOT cover anon in this project; anon holds
-- execute directly. Every function below was revoked from BOTH and then proved:

select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
  and (p.proname like 'park\_%' or p.proname like '%\_park\_room%')
order by p.proname;
-- EXPECT: eleven rows, anon false on every one.

-- ⚠️ AND THE TABLES ARE DENY-ALL, which is the half a function review cannot see:
select c.relname,
       c.relrowsecurity as rls_on,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policies,
       has_table_privilege('anon', c.oid, 'select') as anon_select,
       has_table_privilege('authenticated', c.oid, 'select') as auth_select
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('park_maps', 'park_rooms', 'park_room_invites');
-- EXPECT: rls_on true, policies 0, both selects false, on all three.

-- ── STILL TO DO ON THE CLIENT ──────────────────────────────────────────────────────────────
--
-- The lock in joinPark stays until the client can guarantee the thing it was protecting: that
-- everybody in a room is standing on the same bytes. That means the room carries the map id, the
-- joiner fetches THAT map before entering, and a client that cannot fetch it does not join. An
-- unpublished local map keeps the lock exactly as it is today — walking your own sketch is still
-- a thing you do alone, and that is still the honest answer for it.

-- ── ADDED: the guest list ──────────────────────────────────────────────────────────────────
--
-- ✅ APPLIED as migration: list_park_room_invites
--
-- invite_to_park_room and uninvite_from_park_room shipped with the first migration and had no
-- lister, which made them a permission you could grant and never see. The profile call's note
-- says why that is worse than it looks: a list you can add to but not remove from is a permission
-- that quietly outlives the reason for it.
--
-- list_park_room_invites() is the mirror of list_profile_room_invites() — `r.owner = auth.uid()`
-- is its whole access rule, so a guest asking gets an empty list rather than somebody else's.
--
-- Checked, rolled back, same two accounts:
--   host asks     1 row, "Josh"      <- the control: without it, the guest's 0 means nothing
--   guest asks    0 rows
--   anon          execute refused
--
-- And the audience it makes useful:
--   private room + invite    guest walks in     <- an invite is an explicit grant, so it works
--                                                 whatever the audience says
