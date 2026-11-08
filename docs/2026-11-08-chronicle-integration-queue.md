# Chronicle — the integration queue, as of 8 Nov 2026 (evening)

**A snapshot, not a ledger.** Every head and CI result below was read on 8 Nov 2026 and is a
claim with a date on it (CLAUDE.md §2). `gh pr list --json headRefOid,statusCheckRollup` answers
the same question today in one call. Nothing here is merged or deployed, and no production SQL
has run.

## The stack, and what each piece needs

| PR  | Branch                      | Base   | Kind                         | CI that runs on it               |
| --- | --------------------------- | ------ | ---------------------------- | -------------------------------- |
| #33 | `chronicle/daily-flow`      | `main` | frontend                     | lint, test, build, db guards     |
| #36 | `chronicle/workout-counter` | #33    | frontend                     | db guards only                   |
| #37 | `chronicle/journal-list`    | #36    | frontend                     | db guards only                   |
| #38 | `chronicle/due-states`      | #37    | frontend                     | db guards only                   |
| #41 | `chronicle/idea-to-goal`    | #38    | frontend                     | db guards only                   |
| #42 | `chronicle/count-door`      | #41    | frontend                     | db guards only                   |
| #43 | `chronicle/long-run`        | #42    | frontend                     | db guards only                   |
| #73 | `chronicle/marks-wired`     | #43    | frontend + DB draft          | db guards only (draft unapplied) |
| #83 | `chronicle/weekdays-wired`  | #73    | frontend + DB draft          | db guards only (draft unapplied) |
| #76 | `chronicle/day-notes`       | #43    | frontend + DB draft          | db guards only (draft unapplied) |
| #84 | `chronicle/day-log-notes`   | #76    | frontend                     | db guards only                   |
| #85 | `chronicle/sets-model`      | #43    | frontend + DB draft          | db guards only (draft unapplied) |
| #91 | `chronicle/sets-links`      | #86    | frontend + DB draft          | db guards only (draft unapplied) |
| #92 | `chronicle/sets-grid`       | #91    | frontend + DB draft          | db guards only (draft unapplied) |
| #93 | `chronicle/sets-conversion` | #92    | proposal (DB draft)          | db guards only (draft unapplied) |
| #51 | `chronicle/flow-test`       | `main` | DB test                      | lint, test, build, db guards     |
| #67 | `chronicle/flow-in-ci`      | #51    | CI (one line)                | db guards — both suites ran      |
| #39 | `chronicle/weekday-logic`   | #38    | proposal — superseded by #83 | —                                |
| #46 | `chronicle/repeat-marks`    | #39    | proposal — superseded by #73 | —                                |

⚠️ **"db guards ✅" ON A STACKED PR IS NOT A FRONTEND PASS, AND IT DOES NOT RUN THE DRAFTS.** Lint,
test and build run only on pull requests to `main`, and the `db guards` job builds its database
from the migrations, where no draft is. So a stacked PR's green check says the standing guards
still hold and nothing more. Every stacked head has had zero-warning lint, `npm run typecheck`,
every test and the build run **locally at that exact head**. The drafts are exercised through the
scratch probe branch below.

## Review batches, in merge order

1. **#51 → #67 — the database flow test, then the line that runs it on every push.** Independent of
   everything else.
2. **#33 → #36 → #37 → #38 — the daily flow.** Frontend only.
3. **#41 → #42 → #43 — three small doors.** Frontend only.
4. **#73 → #83 — per-window marks, then weekdays.** Needs release sequencing, not just review:
   - (a) apply the marks draft (step 1) and the weekday draft — in either order;
   - (b) merge and deploy batches 2–4;
   - (c) apply the marks profile draft (step 3).

   **The room must not deploy before (a)**: every tick on a repeating goal would come back refused,
   and a schedule could not be saved.

5. **#76 → #84 — a note with no session, then its row in the Day log.** Apply
   `docs/2026-11-08-chronicle-day-notes.DRAFT.sql`, then merge and deploy.
6. **#85 — sets, step 1.** Apply `docs/2026-11-08-chronicle-sets.DRAFT.sql` whenever convenient.
   Nothing reads it yet, so it changes no number anybody sees.

**Batches 4, 5 and 6 conflict with each other only in count lines**, and the integration branch
shows each resolution:

- `Putback` in cloud.ts;
- the restore toast in YourCopy.tsx;
- the double's store and import;
- two adjacent effects in Timer.tsx.

7. **#91 → #92 → #93 — sets step 2 and the conversion proposal**, follow-ons to the #86 boundary,
   under OPEN-DECISIONS §19g:
   - (a) apply the links draft, then the grid draft, after #85's;
   - (b) merge and deploy #91 and #92;
   - #93 is a proposal: it is NOT for applying until a cutover is chosen with its freeze (§20d).

**Parked:**

- #39 and #46 are superseded by #83 and #73. I have not closed either.
- The claim migration (§15d, OPEN-DECISIONS §19e) has no branch, by design.
- Sets step 2 has no branch: what the tally, the Circuit grid and the day's feed should read
  waits on three answers in OPEN-DECISIONS §19g.

## The second combined tree — `chronicle/integration-2`, #94, also never to be merged

It is #86's tree plus #91–#93, at the same commit as #93's head, so its full CI is about exactly that
tree. #86 is left as the boundary it was reviewed as. The drafts it carries ran on the scratch
branch, whose copies of every draft and SQL test were compared with this head's files and are
byte-for-byte identical. The 68-check Auth/PostgREST run (C1) was against those bytes; it is not a
claim that #94's frontend ran anywhere but CI and the preview double.

## The combined tree — `chronicle/integration`, a draft PR to `main` that is never to be merged

It is batches 1–6 merged together, with every conflict resolved in a merge commit whose message
says how. **It exists so the whole tree gets CI at an exact head**, and it gets the full set
because it targets `main`: lint, test, build, and `db guards`, including the daily flow from #67.
Its PR carries the run.

⚠️ **That run is about the frontend and the standing guards, not the drafts**, because `db guards`
builds its database from the migrations. The drafts are applied and asked on the scratch probe
branch, `chronicle/ci-probe-flow`. Its runner is the only file it changes, and it applies every
draft before running every suite. On 8 Nov it ran this combined tree's drafts and tests by merging
`chronicle/integration` in. That branch is scratch and never to be merged.

## Evidence, kept apart

| Kind                                                                          | What it covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preview double (the in-browser stand-in)                                      | every screen in this queue, desktop and 375 with touch emulated, on each branch and on the integration tree together                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Real Postgres functions, a seeded member's role and JWT claim set by the test | `chronicle-daily-flow.sql` (#51), `chronicle-round-trip.sql`, `chronicle-repeat-marks.sql` (#73, now with weekly and monthly windows that do not start today), `chronicle-day-notes.sql` (#76), `chronicle-weekdays.sql` (#83), `chronicle-sets.sql` (#85) — all four drafts applied, in more than one order. Each test was also run with faults planted in its draft; every fault was named by its own check (three marks runs, two day-notes runs, one weekday run with five faults, one sets run with five). The standing visibility guards caught one real gap, the sets wrappers' suspended check, on the sets draft's first run. |
| Real Supabase Auth + PostgREST, in CI's throwaway local stack                 | two accounts signed up over `/auth/v1`, then every new writer and reader over `/rest/v1/rpc` with each account's own token: the daily flow, marks, weekday schedules and sets, including a sitting and its set moved a day back. Another account and anon were refused at every door, and every new table was refused when read directly — 54 checks, all passed                                                                                                                                                                                                                                                                       |
| A browser signed in through Supabase                                          | **none** — the pane's dev server reaches no database, deliberately, and production is out of bounds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| A real phone                                                                  | **none** — OPEN-DECISIONS §19f lists the checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
