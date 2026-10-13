-- ✅ APPLIED as migration `chronicle_entry_edit_keeps_the_note`, 13 Oct 2026
--
-- chronicle_entry_edit: a null note now means LEAVE IT ALONE, not "clear it".
--
-- THE BUG, WHICH WAS SHIPPED AND REAL
-- -----------------------------------
-- Opening a session's editor and pressing Save — changing nothing — destroyed whatever you had
-- written about that session. Measured in the harness before the fix: a note reading
-- "drafted chapter three" became null with no other field touched.
--
-- Two halves made it. The room called `editEntry(id, from, to, null)` with the note hard-coded
-- null on every edit, and the function read null as "clear it":
--     note = nullif(btrim(coalesce(p_note, '')), '')
-- Each half is unremarkable on its own. Together they are a delete.
--
-- AND IT WAS INVISIBLE, WHICH IS WHY IT LASTED
-- --------------------------------------------
-- Nothing on the page ever showed a session's note. There has been a box for one beside Stop since
-- the room was built — "a note, if you like" — and the day list rendered the activity, the length,
-- the amount, the rating and whether it fell short, but never the note. A PLAN's note has been
-- rendered beside its plan all along, which is what makes the gap obvious once you look for it.
-- So the field could be written, never read, and then quietly destroyed: there was no screen on
-- which the loss could show.
--
-- WHY THE CONTRACT CHANGED AND NOT JUST THE CALLER
-- ------------------------------------------------
-- The caller was the thing that was wrong, and fixing only the caller leaves the trap set: four
-- positional arguments where the fourth silently means "throw away what is there". Null now means
-- what it already means for p_activity one field up — leave it as it is — so a caller that forgets
-- the argument can no longer lose somebody's writing.
--
-- It also repairs the bundle people already have open. That bundle passes null on every edit, so
-- from the moment this landed it stopped destroying notes, rather than from whenever its owner next
-- reloads. Clearing one is still possible and now has to be asked for: pass an empty string.
--
-- MEASURED, in a simulated session
-- --------------------------------
--  · the live bundle's own call — null note, times changed — keeps "drafted chapter three"
--  · a new note is written and trimmed: "  tidied up  " → "tidied up"
--  · '' clears it; a box holding only spaces clears it
--  · the four refusals are word for word unchanged, and so is the fifth from the migration before
--    this one: both ends, please / that span ends before it starts / that is more than a day /
--    no such entry / that is not one of your activities
--  · the times still move
--
-- AND IN THE ROOM
-- ---------------
--  · the note is shown in the day list, in italics on its own line, 302px wide at 375 and unclipped
--  · the editor opens holding it, and Save keeps it — the exact sequence that destroyed it
--  · rewriting trims; emptying the box clears it and the row stops showing one
--  · at 375 the editor wraps to five rows with no overflow at the row, the list, the card or the
--    document, and nothing under 24px
--
-- Four tests pin the rule in the preview double. Perturbed with the original bug — `note` passed
-- straight through, so null clears — four of them go red.

-- the standing check
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as definer,
       has_function_privilege('anon', p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'chronicle_entry_edit';
