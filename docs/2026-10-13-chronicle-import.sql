-- ✅ APPLIED as migrations `chronicle_import` then `chronicle_import_keeps_created_at`, 13 Oct 2026
--
-- chronicle_import(p_doc jsonb): put a saved file back.
--
-- WHY
-- ---
-- The export shipped a day earlier on the Account page's own stated grounds — "a file is the copy
-- that survives losing the account". A copy you cannot put back does not survive anything, so this
-- is the other half rather than a feature in its own right.
--
-- THE ONE RULE EVERYTHING ELSE FOLLOWS FROM
-- -----------------------------------------
-- It ADDS, it never REPLACES: `on conflict (id) do nothing` on every insert. That does two jobs.
--
--  1. It is the promise the Account page already makes about the other backup — putting one back
--     adds what is missing and leaves everything you already have alone. Restoring onto a machine
--     that has been used since must not overwrite the newer thing with the older one.
--  2. It is a door. The ids in a file are the ids the rows had, and a file can be edited by
--     anybody — so an import naming a row id belonging to SOMEBODY ELSE must not write to it.
--     `do nothing` means it cannot: the row exists, so the insert is skipped, and that row's owner
--     is never consulted or changed. There is no code path in this function that updates an
--     existing row, which is why there is no code path that can update a stranger's.
--
-- `owner` always comes from auth.uid(). The export deliberately omits it; this would ignore it.
--
-- ROW BY ROW, AND WHY THAT IS NOT LAZINESS
-- ----------------------------------------
-- Each row goes in inside its own exception block, which is slower than a set-based insert and is
-- the only honest way. These tables carry real check constraints — a goal's unit must accompany
-- its target, an entry must end after it starts, a category must be one of three words — and one
-- set-based statement fails ENTIRELY on the first row that breaks one. The alternative is
-- restating those constraints as WHERE clauses in the function, which is a second copy of the
-- rules that drifts from the table the moment either changes. So the table stays the one
-- authority, a row it refuses is counted in `skipped`, and the rest still go in.
--
-- Activities are inserted FIRST, and everything pointing at an activity is checked against what
-- the account now owns. A reference that resolves to nothing is dropped rather than stored; without
-- the check the foreign key would raise and be counted anyway, so the difference is only in what
-- the person is told — "skipped" should mean a row that could not be put back, not one naming an
-- activity that was about to be inserted two loops up.
--
-- A RESTORED ROW KEEPS THE DAY IT WAS MADE
-- ----------------------------------------
-- created_at and updated_at default to now(), so letting them default would stamp every row in a
-- two-year-old backup with the moment it was put back — losing information the file was carrying,
-- and making a round trip through a file a thing that changes the data. That was the second
-- migration; the first had it wrong.
--
-- MEASURED
-- --------
--  · Round trip: insert rows, export (A), delete exactly those rows, import A, export (B).
--    A = B, identical, md5 of the whole document minus its timestamp. The import reported adding
--    back precisely the 16 rows deleted and skipping the 10 that were still there.
--  · Round trip AGAIN with every column set to a non-default value — archived_at, done_at, anchor,
--    progress, priority, est_mins, amount, quality, colour, metric, session_mins, routine steps,
--    created_at and updated_at dated 2024. Identical. The first round trip proved less than it
--    looked: its fixture left all of those at their defaults, so nothing would have detected the
--    import dropping them.
--  · A second import of the same file adds 0 and skips everything; the account is unchanged.
--  · A file edited to rename a row that already exists leaves that row alone — nothing in the
--    account is called HACKED afterwards.
--  · Refused: no session; {"kind":"songs"}; a file with no kind; version 2; a bare array; null; a
--    bare string; 50,001 rows.
--  · Skipped rather than fatal: an entry naming nobody's activity; a goal breaking a check
--    constraint while a valid goal beside it still goes in; an entry ending before it starts; a
--    second sitting left running where the table allows exactly one.
--  · 3,293 entries put back in 454ms, against the authenticator role's 8s statement_timeout.
--
-- WHAT VERIFYING IT IN THE BROWSER FOUND, THAT READING IT DID NOT
-- --------------------------------------------------------------
--  · The room did not repaint. A put-back into an empty account restored 17 sessions and 11 goals,
--    the file came back byte-identical, and the page still said there was nothing here. The room
--    reads once on mount and after its own edits; an import is an edit it did not make. It takes
--    an onPutBack callback now.
--  · THE ROOM HAD NO TOAST AT ALL. `<Toast/>` is mounted per room — the Circuit, Ratings, the
--    Instrument and Account each mount their own — and chronicle never did, so every showToast
--    call it made went nowhere, including the export's failure messages shipped the day before.
--    Nothing noticed while the room had nothing to say. A put-back does: a file that is not ours,
--    or one the account already holds, changes nothing on screen, so the sentence is the only
--    feedback there is. All five paths were then watched landing in the live region:
--      "Added 39 — 17 sessions, 6 activities, 11 goals."
--      "Everything in that file was already here"
--      "Not a chronicle file"  /  "That file is from a newer version"  /  "That file could not be read"
--  · Postgres writes an exception message in lower case, so a refusal arrived as "not a chronicle
--    file" beside the room's own "That file could not be read". Sentence-cased where it is shown.

-- the standing check
select p.proname,
       p.prosecdef as definer,
       p.provolatile as volatility,
       has_function_privilege('anon', p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
       coalesce(array_to_string(p.proacl::text[], ' | '), '(default: PUBLIC)') as acl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('chronicle_export', 'chronicle_import');
