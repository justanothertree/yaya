-- ✅ APPLIED as migrations `chronicle_activity_save_keeps_the_colour` and
--    `chronicle_goal_save_keeps_the_note`, 13 Oct 2026
--
-- The same mistake as a session's note, in two more places — and the import is what woke them up.
--
-- THE SHAPE
-- ---------
-- An optional column, a caller that does not mention it, and a save function that reads that
-- silence as erasure:
--
--   chronicle_activities.colour  ← saveActivity passes null on every rename; the room has never
--                                  had a colour picker
--   chronicle_goals.note         ← saveGoal omits the field entirely; the room has no box for it
--
-- Both functions then said, unconditionally:
--   colour = nullif(btrim(coalesce(p_colour,'')),'')
--   note   = p_note
--
-- So every rename deleted an activity's colour and every goal edit deleted a goal's note.
--
-- WHY IT WAS HARMLESS UNTIL THIS WEEK, AND IS NOT NOW
-- ---------------------------------------------------
-- Nothing in the room can write either field, so for the whole life of the room there was nothing
-- to lose — an erasure of a column that is always already null is a no-op. chronicle_export carries
-- both columns and chronicle_import puts them back, so from the day the import shipped a RESTORED
-- FILE became the one way an activity can have a colour or a goal can have a note. The next
-- ordinary edit in the room then deleted it.
--
-- Measured before the fix, in a simulated session: a file carrying "#aabbcc" and "because I keep
-- meaning to" was imported, then the room's own two calls were made — a rename and a re-save — and
-- both fields read NULL afterwards.
--
-- THE FIX IS THE ENTRY'S FIX, TWICE
-- ---------------------------------
-- Null leaves the value alone; '' clears it. The same rule as chronicle_entry_edit's note and
-- p_activity, so there is now one rule for every optional field on every save path in this module:
-- silence means "I am not talking about this", never "throw it away".
--
-- MEASURED AFTER
-- --------------
--  · the import puts "#aabbcc" and "because I keep meaning to" in; the room's rename and re-save
--    leave both exactly as they were
--  · and those edits still took: the activity is renamed and recategorised, the goal retitled with
--    a new scope, target and priority
--  · '' clears a colour; '   ' clears a goal note
--  · a brand new activity still starts with no colour; a new goal written WITH a note keeps it,
--    trimmed: "  written down  " → "written down"
--  · the refusals are unchanged: "no such activity" / "no such goal"
--  · in the room, through the preview double: renaming an activity keeps its metric, and editing a
--    goal keeps its tick, its progress and its source
--
-- Four tests pin the two rules. Perturbed with the original bugs — colour and note assigned
-- straight through — two go red each.
--
-- LEFT FOR EVAN, DELIBERATELY
-- ---------------------------
-- Both columns are still unreachable from the room: there is no colour picker on an activity and
-- no note box on a goal. They are in the table, in the type, on the save path, in the export and in
-- the import, and nothing on screen writes or shows them. Making either visible is a design
-- decision about the room rather than a bug fix — a colour per activity would read instantly in a
-- list of bars, and a goal's note is the obvious home for "why this matters" — so both are named
-- here rather than invented.

-- the standing check
select p.proname,
       p.prosecdef as definer,
       has_function_privilege('anon', p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('chronicle_activity_save', 'chronicle_goal_save', 'chronicle_entry_edit')
order by p.proname;
