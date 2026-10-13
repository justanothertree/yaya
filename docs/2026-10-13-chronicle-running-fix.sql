-- ✅ APPLIED as migration `chronicle_running_fix`, 13 Oct 2026
--
-- chronicle_running_fix(p_from, p_activity): correct the session you are in the middle of.
--
-- WHY
-- ---
-- The room's entry editor needs both ends of a span, so it was offered only on FINISHED sessions —
-- a consequence of the editor's shape rather than a decision, and the comment beside it said as
-- much: "only a finished span can be edited: the editor needs both ends, and the running one is
-- closed with Stop rather than by typing a time into it".
--
-- The second half of that still holds. The first half had a cost: the two mistakes you notice
-- WHILE WORKING both had the same remedy, which was to press Stop. That ends the session at a
-- moment you did not choose and leaves you starting a second one — a worse record of the day than
-- the one you were trying to fix.
--
-- The two are pressing Start on the wrong activity, and pressing it twenty minutes after you
-- actually began. This takes either, or both.
--
-- WHAT IT DELIBERATELY CANNOT DO
-- ------------------------------
-- There is no p_to. The one open entry is open BECAUSE it has no end; typing one in is what Stop
-- is for, and a function that could close it would be a second way to do the thing the room
-- already has a button for — with none of Stop's own rules about notes and short sittings. The
-- editor in the room hides the end box, the amount, the rating and the note while a session is
-- running for the same reason: those are all things you say about a session once you know how it
-- went.
--
-- THE RULES IT KEEPS
-- ------------------
--  · there has to be something running — the one open row per owner, which a partial unique index
--    already guarantees is at most one
--  · null leaves each field alone, the rule every save path in this module now keeps
--  · a start cannot be in the future, and cannot be more than a day ago (the same ceiling
--    chronicle_entry_edit puts on a finished span)
--  · the activity has to be the caller's — checked against auth.uid(), not against the entry,
--    because a uuid naming somebody else's activity is a real row the foreign key would accept,
--    which would leave this person's session pointing into another member's list and their minutes
--    in that member's totals
--
-- MEASURED, in a simulated session
-- --------------------------------
--  · with nothing running: refused, "nothing is running"
--  · moving it: the activity changes; the start, the note and its open-ness do not
--  · winding the start back: the start changes; the activity does not
--  · both at once: both change
--  · refused: "that is in the future" / "that is more than a day ago" / "that is not one of your
--    activities" — and none of those three moved anything
--  · called with no arguments at all: a no-op, not an error
--  · anon false, authenticated true
--
-- AND IN THE ROOM
-- ---------------
--  · the running row has a pencil for the first time — four on screen where there were three
--  · its editor offers exactly four controls: the activity, one date, Save, Cancel. No end box, no
--    amount, no rating, no note.
--  · driven through the UI: "Chronicle (on the site)" begun 7 minutes ago became "Gym" begun 26
--    minutes ago, and the session was still running afterwards
--  · a finished session's editor is unchanged — two dates, the rating, the note box and the rest
--  · at 375 the running editor is three rows with no overflow at the row, the list, the card or
--    the document, and nothing under 24px
--
-- Six tests pin it in the preview double, each made to fail: ending the session while correcting
-- it (4 red), accepting a start in the future (1), accepting somebody else's activity (1), reading
-- null as "clear it" (3), and correcting the wrong row — the last entry rather than the open one
-- (2).

-- the standing check
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as definer,
       has_function_privilege('anon', p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'chronicle_%'
order by p.proname;
