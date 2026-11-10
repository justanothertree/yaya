# Chronicle release plan — 17d, 18a, 19c, 19d and 20c ✅ DONE 9 Nov 2026

✅ **APPROVED AND DONE, 9 Nov 2026** ("Approve, ship inert": the plan as one step, with #93's reader
shipping inert). The plan as approved is below, unchanged; what happened is here.

| step | result                                                                                                                                                                                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0    | check A: six `same`, nothing created. The six texts saved, each md5-equal to production's: `docs/2026-11-09-chronicle-release-rollback/`                                                                                                                                 |
| 1–6  | applied as `20261110025141` … `20261110025520`. Check B matched after every one                                                                                                                                                                                          |
| C, D | after step 6: 26 of 26 functions `same`; nothing open                                                                                                                                                                                                                    |
| 7    | `main` had moved to `c5e4c47b` (#99, Lab frontend only) after #101's checks ran, so it was merged into `chronicle/release-1` first (`3fffe4a6`): lint, typecheck, 3,301 tests, build locally, then all five checks on #101. Merged as `487f3c88`; `deploy.yml` succeeded |
| live | evancook.dev's entry file loads `dayLink-DCLbGhZN.js`, the chunk holding `chronicle?day=`, with the same hash as a local build of `3fffe4a6`. (The string is in its own shared chunk, not the Circuit chunk this plan named)                                             |
| 8    | applied as `20261110030419`. Check B matched; check E `same`; check D still nothing open                                                                                                                                                                                 |
| 9    | seven migration files and their `applied.md5` lines; `scripts/migration-md5.mjs`: 78 match, 0 fail                                                                                                                                                                       |

Supabase's security advisor afterwards showed only the house pattern for the release's objects:
deny-all tables reported as "RLS enabled, no policy" (INFO), and member-callable SECURITY DEFINER
functions. None of the eight functions `anon` can execute is the release's.

**Not covered:** a browser signed in to production and a real phone. Those are §19f checks 1–11 in
`docs/OPEN-DECISIONS.md`, now Evan's to make on the live site.

## In one paragraph

Six SQL drafts are applied to production, in the order CI ran them. None of them changes anything
for the site that is live now. Then one pull request is merged, which deploys the whole Chronicle
frontend at once. Then the profile reader, step 3 of 17d, is applied. Every step is checked before
and after, by read-only queries whose expected values are written into them
(`docs/2026-11-09-chronicle-release-checks/`), and every step's rollback is written down.

## What production is today (read-only, 9 Nov 2026)

- **Migrations:** 365 applied. All 82 files after the baseline on `main` are among them, and nothing
  applied since the first of those is missing from `main`. The release adds no migration file of
  its own (its drafts live in `docs/`), so after it merges `main` still holds exactly those 82.
- **The six functions the drafts patch** have exactly one definition each, and their text is byte
  for byte what CI builds from `main`'s migrations. Check A, run against production on 9 Nov:
  six rows, every one `same`. Run C7 found the same six md5s in its own database. So every anchored
  text swap in the drafts meets the same text in production that it met in CI.

  | function                 | md5         | bytes  |
  | ------------------------ | ----------- | ------ |
  | `chronicle_entry_amount` | `257c45b4…` | 665    |
  | `chronicle_export`       | `f3e16bed…` | 5,917  |
  | `chronicle_goals_mine`   | `bff4311d…` | 1,073  |
  | `chronicle_import`       | `bc19f919…` | 18,377 |
  | `chronicle_tally`        | `543f0572…` | 4,820  |
  | `get_member_chronicle`   | `6f86f652…` | 5,885  |

- **Nothing the release creates exists yet:** 0 of its 20 new functions, 0 of its 4 new tables, and
  no `chronicle_notes.on_day`. `anon` can execute none of the patched functions.
- **`chronicle_notes`** holds 5 rows, all with a session, so the day-notes CHECK
  (`entry` set and `on_day` null, or the reverse) holds for every row already there.
- **Size:** 35 MB of the 500 MB free tier.

## The steps

Each SQL step is sent through `apply_migration` as the draft's **body**: everything after its
leading block of comment lines, exactly what `bodyOf` in `scripts/migration-md5.mjs` returns. The
md5 after each step is the proof that what ran is the file (check B). Each draft is one transaction
and raises if any of its anchors does not match exactly as often as it expects, so a step either
lands whole or not at all.

| #   | What                                        | §   | Body md5 (check B)                 | Check after                 |
| --- | ------------------------------------------- | --- | ---------------------------------- | --------------------------- |
| 0   | Save the six functions' current text        | —   | —                                  | check A: six `same`, 0 0 0  |
| 1   | `2026-11-08-chronicle-sets`                 | 19d | `20cc81b95cb5bb779d07d4cdd062bda0` | B                           |
| 2   | `2026-11-09-chronicle-sets-links`           | 20c | `5ded75e0a6028a4d47a1e65c0f1b2f7d` | B                           |
| 3   | `2026-11-09-circuit-grid-sessions`          | 20c | `5eb8002a18ea00f5662c061bab2edc96` | B                           |
| 4   | `2026-11-08-chronicle-weekdays`             | 19c | `7312ca68bd4f64f0df7b27bd81a43127` | B                           |
| 5   | `2026-11-08-chronicle-repeat-marks`         | 17d | `26d53226fac700aeef1928ee75574620` | B                           |
| 6   | `2026-11-08-chronicle-day-notes`            | 18a | `6ff0be4698dd786f220f0b033a6cbcdb` | B, then C (26 `same`) and D |
| 7   | Merge the release PR; it deploys            | —   | —                                  | the live site has the build |
| 8   | `2026-11-08-chronicle-repeat-marks-profile` | 17d | `a67fb66b2ba23fd3526ab10dbbc0888b` | B, E and D                  |
| 9   | Record it                                   | —   | —                                  | `npm run test` passes       |

**Step 0.** Run check A. Then save `pg_get_functiondef` of the six functions to a file, because it
is every draft's rollback. If any row is not `same`, production has moved since 9 Nov: stop, and
nothing has changed.

**Steps 1–6, the SQL, in one sitting.** The order is C7's: sets before links, links before the grid
(20c's own order), then weekdays, marks and day notes. None of the six changes what the live
frontend reads or writes: no existing function changes its arguments; the patched ones gain
behaviour only for rows that do not exist until the new frontend writes them; and every new table
is deny-all. Check C after step 6 is the whole schema at once: 26 functions, each byte for byte
what C7 produced. Check D says nothing is open that should not be.

**Step 7, the frontend.** ⚠️ Not before step 6: the room ticks repeating goals through
`chronicle_goal_mark` and saves schedules through `chronicle_goal_days_set`, and without them every
tick and every schedule would be refused. One merge, so one deploy: the release PR, opened from
`chronicle/release-1`, whose tree is exactly `integration-2`'s. That tree has had full CI. After
`deploy.yml` finishes, fetch the live site and find `chronicle?day=` in its Circuit chunk; only this
release has it.

**Step 8, the profile reader**, once the room is live, as 17d said. It changes one function, the
one a friend's view of a profile reads, and writes nothing.

**Step 9, the record**, the same day:

- each applied body becomes `supabase/migrations/<version>_<name>.sql`, as a ✅ APPLIED header over
  the body;
- its line goes into `applied.md5`, from `schema_migrations` (the regenerating query is in that
  file's header);
- each draft's header says ✅ APPLIED with its migration name;
- the stacked PRs, now in `main`, are closed as landed. `npm run test` then proves the files are the
  text that ran.

## What ships, and what does not

**Frontend:** the queue's batches 1–6, the §19g follow-ons and `main`.

- Batches 1–6 of `docs/2026-11-08-chronicle-integration-queue.md`: #51 → #67, #33 → #38,
  #41 → #43, #73 → #83, #76 → #84 and #85.
- The §19g follow-ons: #91 links, #92 grid, #98 the grid fixes and #100 the reopen reload.
- #67 brings its one workflow line: `db guards` also runs the daily flow.

**Not shipping:** the conversion (20d: nothing until a cutover date). 19e's claim check is not built.
#39 and #46 are superseded proposals.

### The one choice inside it: #93's reader

#98 and #100 are stacked on #93, the conversion proposal. #93 adds no SQL to this release; its
frontend half asks `circuit_manual_sums` for converted people. That call is refused until a
cutover applies the conversion draft, and the board reads the refusal as "nobody is converted".
Two tests in `src/circuit/supabaseAdapter.test.ts` pin that; both went red when the refusal was
made to throw.

- **(A) Recommended: ship it inert, in the tree as tested.** It costs one refused request for each
  Circuit board load and reopen, which nobody sees. When a cutover applies the draft, the switch
  needs no second deploy, which is what the reader was built for. The draft file lands in `docs/`,
  still marked ⛔ DRAFT.
- **(B) Leave #93 out.** I cut new branches that put #98's and #100's commits straight onto #92
  (cherry-picks, no history rewritten), and the release PR comes from those. That costs one more
  full CI round before step 7.

## Rollback

**The frontend:** `git revert -m 1 <the release merge>` on `main`, which redeploys the site that is
live now. It is safe at any point, because every SQL step keeps working for that site.

**The SQL**, in reverse order. Each draft's own ROLLBACK block is the detail:

- **Step 8:** re-run `get_member_chronicle`'s saved text. Nothing written is lost.
- **Steps 6, 5 and 4:** re-run the saved export and import, and the saved `chronicle_goals_mine` for
  step 4, then drop what each step created. ⚠️ This deletes what people wrote in between: day notes
  with no session, check-offs, weekday schedules. Export first, and ask.
- **Steps 3 and 2:** drop the grid functions; re-run the saved tally, entry amount, export and
  import; re-run the sets draft's function bodies; drop the links table and the `counted` column.
  ⚠️ Sets already counted into a sitting stay in its amount. The reps were done; undoing that is per
  sitting, by hand, and asked first.
- **Step 1:** drop the set functions and `chronicle_sets`. ⚠️ Those are somebody's reps: export
  first, and ask.

**A safe stop at any point:** revert the frontend and leave the SQL in place. Nothing the old
frontend does reaches any of it.

## Evidence, kept apart

- **Production, read-only, 9 Nov:**
  - the migration history;
  - check A, six `same`;
  - nothing created;
  - anon executes none of the patched functions;
  - the notes table.
- **CI's throwaway database, run C7 (42733400210):**
  - all of main's migrations, the six fingerprints equal to production's;
  - steps 1–6 and 8 in this order, with no conversion draft;
  - every suite: the standing guards (main's), the daily flow, the round trip, the marks, the day
    notes, the weekdays, the sets, the links and the grid;
  - 68 of 68 checks through real Supabase Auth and PostgREST.
- **Run C8** adds the check files themselves at their checkpoints.
- **The release tree's own CI:** lint, test, build and `db guards` on the release PR and on #94.
  Neither applies a draft; that is what C7 and C8 are for.
- **Not covered by anything here:** a browser signed in to production, a real phone. Those are the
  §19f device checks 1–11 in `docs/OPEN-DECISIONS.md`, after step 7.
