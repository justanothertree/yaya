# Chronicle — the integration queue, as of 8 Nov 2026

**A snapshot, not a ledger.** Every head and CI result below was read on 8 Nov 2026 and is a
claim with a date on it (CLAUDE.md §2). `gh pr list --json headRefOid,statusCheckRollup` answers
the same question today in one call. Nothing here is merged or deployed, and no production SQL
has run.

## The stack, and what each piece needs

| PR  | Branch                      | Base   | Head      | Kind                         | CI at that head                   |
| --- | --------------------------- | ------ | --------- | ---------------------------- | --------------------------------- |
| #33 | `chronicle/daily-flow`      | `main` | `0e36851` | frontend                     | lint, test, build, db guards ✅   |
| #36 | `chronicle/workout-counter` | #33    | `85f224e` | frontend                     | db guards ✅ (only one that runs) |
| #37 | `chronicle/journal-list`    | #36    | `aaf30cd` | frontend                     | db guards ✅                      |
| #38 | `chronicle/due-states`      | #37    | `d87dcf8` | frontend                     | db guards ✅                      |
| #41 | `chronicle/idea-to-goal`    | #38    | `492646a` | frontend                     | db guards ✅                      |
| #42 | `chronicle/count-door`      | #41    | `7922aae` | frontend                     | db guards ✅                      |
| #43 | `chronicle/long-run`        | #42    | `c47177e` | frontend                     | db guards ✅                      |
| #73 | `chronicle/marks-wired`     | #43    | see PR    | frontend + DB draft          | db guards (drafts not applied)    |
| #39 | `chronicle/weekday-logic`   | #38    | `da8b6e0` | proposal, unwired            | db guards ✅                      |
| #46 | `chronicle/repeat-marks`    | #39    | `ca05932` | proposal — superseded by #73 | db guards ✅                      |
| #76 | `chronicle/day-notes`       | #43    | see PR    | frontend + DB draft          | db guards (draft not applied)     |
| #51 | `chronicle/flow-test`       | `main` | `f50fc22` | DB test                      | lint, test, build, db guards ✅   |
| #67 | `chronicle/flow-in-ci`      | #51    | `43c6ced` | CI (one line)                | db guards ✅ — both suites ran    |

⚠️ **"db guards ✅" ON A STACKED PR IS NOT A FRONTEND PASS.** Lint, test and build run only on pull
requests to `main`. Every stacked head has had lint, typecheck, every test and the build run
**locally at that exact head** instead, and they run in CI when each is retargeted to `main`.

`chronicle/ci-probe-flow` is a scratch branch that swaps what the guards job runs; it is never to
be merged.

## Review batches, in merge order

1. **#51 → #67 — the database flow test, then the line that runs it on every push.** Independent of
   everything else. #51 has the full CI set. #67 changes one workflow step and proved itself on its
   own run. Merge #51, retarget #67 to `main`, merge.
2. **#33 → #36 → #37 → #38 — the daily flow.** Frontend only; no database change.
   - #33: opens on what is due, ▶ starts a goal's activity, ✎ Note on the running sitting.
   - #36: the counter built for between sets, with Undo.
   - #37: the Journal half.
   - #38: due / pending / done states, with the midnight fix.
3. **#41 → #42 → #43 — three small doors.** Frontend only.
   - #41: an idea becomes a goal through the form.
   - #42: a sitting offers to name what it counts.
   - #43: a timer left running says since when.
4. **#73 — per-window marks.** Needs release sequencing, not just review:
   - (a) approve and apply step 1, `docs/2026-11-08-chronicle-repeat-marks.DRAFT.sql`;
   - (b) merge and deploy batches 2–4;
   - (c) apply step 3, `docs/2026-11-08-chronicle-repeat-marks-profile.DRAFT.sql`.

   **The room must not deploy before (a)**, or every tick on a repeating goal comes back refused.

5. **#76 — a note with no session.** The same release shape as #73, with one step:
   - (a) approve and apply `docs/2026-11-08-chronicle-day-notes.DRAFT.sql`;
   - (b) merge and deploy.

   It is stacked on #43 rather than on #73, so the two are independent. Either draft can be
   applied first, and both orders have run in CI. **They conflict in two places, both trivial:**
   each adds a count to `Putback` in cloud.ts and to the restore toast in YourCopy.tsx. Keep
   both counts.

**Parked:** #39 (weekday schedules) needs §16f and §16g answered and its own database approval.
#46 is superseded by #73 and can be closed whenever convenient — I have not closed it.

## The combined tree

`chronicle/marks-wired` (#73) is every frontend change plus the marks, so it is the tree to try
whole. At its head: zero-warning lint, `npm run typecheck`, all 2,854 tests and the build pass
locally, and the room was driven in the preview double at desktop and 375.

## Evidence, kept apart

| Kind                                                                          | What it covers                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preview double (the in-browser stand-in)                                      | every screen in this queue, desktop and 375 with touch emulated                                                                                                                                                                                                       |
| Real Postgres functions, a seeded member's role and JWT claim set by the test | `chronicle-daily-flow.sql` (#51, on every push once #67 lands); `chronicle-repeat-marks.sql` (#73, through the scratch branch); the export/import round trip                                                                                                          |
| Real Supabase Auth + PostgREST, in CI's throwaway local stack                 | two accounts signed up over `/auth/v1`, then the daily flow and the marks over `/rest/v1/rpc` with each one's own token: 32 checks, all passed (run 42495071765), including another account and anon refused at every door and both tables refused when read directly |
| A browser signed in through Supabase                                          | **none** — the pane's dev server points at nothing, deliberately, and production is out of bounds                                                                                                                                                                     |
| A real phone                                                                  | **none** — waiting on Evan, with #33's steps                                                                                                                                                                                                                          |
