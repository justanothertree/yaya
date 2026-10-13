-- ✅ APPLIED as migration `chronicle_entry_edit_can_move_activity`, 13 Oct 2026
--
-- chronicle_entry_edit: a session can be moved to another activity.
--
-- WHY
-- ---
-- Pressing Start on the wrong activity is the likeliest mistake a stopwatch allows, and until now
-- the only remedy was to delete the session and type it in again — losing the amount, the rating,
-- and the day it was recorded. Everything else about a finished session was already editable; what
-- it WAS was the one fact fixed at the moment you were least able to get it right.
--
-- DROPPED AND RECREATED, NOT REPLACED, AND THE DEFAULT IS WHY THAT IS SAFE
-- ------------------------------------------------------------------------
-- `create or replace` cannot add a parameter: a different signature makes an OVERLOAD, and an
-- overload here would be worse than useless. A four-argument call would match both the old
-- function and the new one's defaulted form, and Postgres would refuse it as not unique — so the
-- room would break for everybody rather than for nobody.
--
-- Dropping a live function is a contract break unless the replacement answers the calls already in
-- flight, and `p_activity uuid default null` does. The bundle somebody has open right now names
-- four arguments; PostgREST matches by name and a defaulted parameter is optional, so that call
-- still resolves and still means "leave the activity alone" — which is exactly what it did before.
-- Both statements are in one migration, so there is no moment where neither function exists.
--
-- NULL MEANS LEAVE IT ALONE, NOT "NO ACTIVITY"
-- --------------------------------------------
-- The only reading that keeps the old call's old meaning. An entry always has an activity — the
-- column is NOT NULL — so there is no "none" to set it to anyway.
--
-- THE ACTIVITY IS CHECKED AGAINST THE CALLER, NOT AGAINST THE ENTRY
-- -----------------------------------------------------------------
-- This is the part the foreign key would NOT have caught. A caller who can name one activity can
-- name any uuid, and somebody else's activity is a real row, so the reference would be accepted —
-- leaving that person holding a session of their own that points into another member's list, and
-- putting their minutes into that person's totals from the other side. It is refused by ownership,
-- not by existence.
--
-- An ARCHIVED activity of your own is allowed. Archived means put away, not gone; refusing it
-- would make tidying up irreversible for any session already recorded against it.
--
-- MEASURED
-- --------
--  · Behavioural baseline before and after, in a simulated session: the identical four-argument
--    call the live bundle makes produces md5 ef8a5486388a59e4c5f312d8e8ec8ae3 both times — same
--    activity, same times, same trimmed note.
--  · The four refusals are word for word unchanged:
--    "both ends, please" / "that span ends before it starts" / "that is more than a day" /
--    "no such entry".
--  · One function afterwards, five parameters, no overload; anon false, authenticated true.
--  · Moving a session keeps its amount (7.5) and its rating (3).
--  · An activity that is not the caller's is refused with "that is not one of your activities",
--    and the session does not move. ⚠️ THIS DATABASE HAS ONE OWNER, so that case was exercised
--    with a uuid naming no activity at all; the predicate is `id = p_activity and owner =
--    auth.uid()`, which fails the same way for a stranger's real row, but the stronger test needs
--    a second account and has not been run.
--  · An archived activity of the caller's is accepted.
--  · In the room: a session rated 5 moved from Drawing to Writing, kept the 5, and the day's
--    totals followed it — Drawing left the list, Writing went to 35m. At 375 the editor wraps to
--    six rows with no overflow at the row, the list, the card or the document, and nothing under
--    24px.
--
-- The pencil's label said "Change when this was" and now says "Change this session", because it
-- no longer only changes when.

-- the standing check
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as definer,
       has_function_privilege('anon', p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'chronicle_entry_edit';
