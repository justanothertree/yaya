-- ✅ APPLIED 30 Oct 2026 as `suspension_reaches_the_social_tables`.
--
-- ⚠️ THIS FILE DIVERGES FROM THE STATEMENT RECORDED IN `schema_migrations`, ON PURPOSE AND BY
-- TWO ADDED LINES. Everything here ran as written; what was added afterwards is the wrapper
-- that lets it run a SECOND time without failing, so the repository can rebuild its own schema
-- from a baseline (see docs/ci/db-guards.yml). The md5 check in supabase/migrations/README.md
-- will report this file as changed, which is the intended and documented exception rather than
-- drift -- the SQL that touches the database is identical.
--
-- A suspended member could still comment on and react to workout logs.
--
-- ⚠️ EIGHT TABLES HAD THE GUARD AND TWO DID NOT. `circuit_logs`, `circuit_people`,
-- `circuit_movies`, `circuit_ratings`, `circuit_watchlist`, `pools`, `pool_people` and
-- `pool_votes` each carry a RESTRICTIVE `*_not_suspended` policy. `circuit_log_comments` and
-- `circuit_log_reactions` — the two tables that carry somebody's WORDS and somebody's NAME onto
-- another member's screen — did not. Suspension stopped you logging a workout and left you free
-- to talk under everybody else's.
--
-- ⚠️ RESTRICTIVE, NOT PERMISSIVE, AND THE DIFFERENCE IS THE WHOLE FEATURE. Permissive policies
-- are OR-ed together, so a permissive "not suspended" policy would ADD access rather than remove
-- it and the other eight tables would be protecting nothing. Checked rather than assumed:
-- `polpermissive` is false on all eight, and these two match them.
--
-- ⚠️ THE REACTIONS TABLE WAS NOT IN THE REPORT AND IS FIXED ANYWAY. It is the same hole in the
-- sibling table, found by asking which tables lack the policy rather than by opening the one that
-- was named. CLAUDE.md §10 allows the adjacent fix when it is small and clearly safe; this one is
-- four lines and identical to the eight already in place.
--
-- ⚠️ MEASURED, AND THE FIRST TWO ATTEMPTS MEASURED NOTHING. Staging this needs care, because a
-- suspended member cannot SELECT a log either — so a fixture that looks up the log id *after*
-- suspending finds nothing, both inserts fail on a null id, and the run reports a tidy "refused"
-- that is about the wrong thing entirely. The first attempt did exactly that. The second had a
-- "control" that inserted zero rows and reported SUCCEEDED, because `insert ... select` over an
-- empty select succeeds trivially.
--
-- The version that proves something resolves the ids as the privileged role BEFORE suspending
-- anyone, and asserts row counts:
--
--   (fixture) log resolved            20260101050
--   (control) NOT suspended comments  inserted 1
--   suspended member comments         SUCCEEDED - inserted 1   <- the hole
--   suspended member reacts           SUCCEEDED - inserted 1   <- the hole
--
-- After, with the same fixture: controls still insert 1, a non-suspended member can still read
-- comments, and both suspended attempts are refused.

drop policy if exists circuit_log_comments_not_suspended on public.circuit_log_comments;
create policy circuit_log_comments_not_suspended on public.circuit_log_comments
  as restrictive for all to authenticated
  using (not public.is_suspended(auth.uid()))
  with check (not public.is_suspended(auth.uid()));

drop policy if exists circuit_log_reactions_not_suspended on public.circuit_log_reactions;
create policy circuit_log_reactions_not_suspended on public.circuit_log_reactions
  as restrictive for all to authenticated
  using (not public.is_suspended(auth.uid()))
  with check (not public.is_suspended(auth.uid()));
