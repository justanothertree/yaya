# db-guards went green, and what it took — 5 Nov 2026

`supabase/tests/visibility-guards.sql` had never run anywhere but by hand against production.
It runs on every push now: **run 41957399407, `all visibility guards hold | 0 failures`**, against
a throwaway database built from a dump of production and thrown away with the job.

The parked copies under `docs/ci/` are deleted with this note. They were byte for byte identical
to the live `.github/workflows/db-guards.yml` and `deploy.yml`, which Evan moved into place on
4 Nov — a second copy of a live file is a thing that can disagree with it.

## Four runs, four different failures, none of them in the guards

| run         | died at                  | why                                                                                  |
| ----------- | ------------------------ | ------------------------------------------------------------------------------------ |
| 41951750375 | baseline statement 673   | `type "extensions.citext" does not exist`                                            |
| 41953140628 | the 12th migration       | `not authenticated` — a data migration simulating an admin session                   |
| 41954680315 | the guards, ~40 findings | the dump has no triggers, and the restore out-granted production                     |
| 41956008931 | the guards, 9 findings   | TRUNCATE, which the config flag's revoke leaves behind — and one illegal fixture row |

Each cause is written up where the fix lives: `supabase/baseline/00-privileges.sql`,
`01-extensions.sql`, `02-triggers.sql`, the `[db.migrations]` and `[api]` blocks in
`supabase/config.toml`, and the commits themselves. Three things are worth keeping here because
they are about more than this job.

**A dump is not the database it came from, and the differences are all in the permissive
direction.** pg*dump describes an ACL by what it holds and never by what it lacks: a function
production revoked from `anon` has no anon entry to dump, so nothing in the restore takes the
local default grant away. Everything that followed from that read as a real finding —
`picture_ready` anon-callable when a migration called `picture_ready_as_service` had made it
service-role-only, `visibility_circle*\*` callable by anon, tier columns writable. **An artefact
that makes a restore more permissive than production is indistinguishable from a regression.**

**`CREATE TRIGGER` appeared zero times in a dump whose every other object kind matched production
exactly** — 62 tables, 271 functions, 88 policies, 62 RLS-enabled tables, 85 foreign keys, 1 view,
1 enum, and 24 triggers against 0. All 24 trigger FUNCTIONS were there, so the schema read
complete and enforced nothing. The guards named it precisely (five tables whose tier column is
writable with no clamp trigger), and the finding looked like a product bug for as long as it took
to count. **Count a dump by object kind before trusting it.**

**A fixture that violates an invariant is worse than a thin one.** `supabase/seed.sql` planted a
profile block stored above its owner's ceiling, with a comment calling it "the row Phase 2 exists
to clamp" — true when it was written, because guard block J was a report then. J became a failure
on 3 Nov, and the setters clamp now, so that row is a state the product can no longer reach. The
two files were written days apart and nothing had ever run them together.

## What the job proves, and what it does not

It proves: the schema production has today, built from scratch, with fixtures in it, satisfies
every check in `visibility-guards.sql` — the ceiling helpers are unreachable, the deny-all tables
are deny-all per privilege, no stored tier sits above its owner's ceiling, a minor's things stay
out of both feed tabs until their guardian opts in, and the rest.

It does not prove the migrations replay. They cannot, and that is a property of how they are
written rather than a fault in any of them: most are surgery on function bodies that assert the
state they expect to find and refuse to run against anything else. `[db.migrations] enabled =
false` says so, with the measurement.

**So the job is only as current as the dump.** A migration applied after 4 Nov is not in CI's
schema until somebody regenerates `00000000000000_baseline.sql` — and a regeneration is four
steps rather than one, written down in `supabase/baseline/README.md`, because the dump alone is
not the schema. That failure is loud rather than silent for anything a guard asks about — a guard
written for a new rule fails against the old schema — and the first instance is already here:
`20261105023835_one_unique_index_on_the_snake_registry` dropped a duplicate index that CI's copy
still has. The one quiet case is a trigger added after the dump: it would be in neither the dump
nor `02-triggers.sql`, which is step 3 of that README.

## Left for Evan, because this session's token has no `workflow` scope

`.github/workflows/db-guards.yml` and `deploy.yml` still carry the headers they had while they
were parked, and the db-guards one now describes an arrangement that has changed. Nothing is
broken by it — comments only — but three blocks in `db-guards.yml` say things that are no longer
true, and they are the first thing anybody reads when the job fails:

1. The whole opening block, down to `name: db guards`, explains that the file is parked in
   `docs/ci` and must be moved by hand. It is in place and running.
2. `⚠️ THE REPOSITORY CANNOT CURRENTLY BUILD ITS OWN SCHEMA FROM SCRATCH`, above the
   "Check the migrations can build the schema" step, with the `db dump` command to run once. The
   baseline exists; that step passes; and the paragraph below it about what then happens to the
   migrations already here is the thing that turned out to be wrong — they are not replayed at
   all now. ⚠️ That block also prints the dump command on its own, which is the naive
   regeneration: whatever replaces it should point at `supabase/baseline/README.md` instead.
3. `# applies every migration in order, then supabase/seed.sql`, above the `db reset` step. It
   applies `[db.seed] sql_paths`: the privileges, the extensions, the dump, the triggers, then
   the seed.

`deploy.yml` needs only its parked header removed; everything under it is accurate.

The authoritative version of all of this lives where the code is — `supabase/config.toml`,
`supabase/baseline/*.sql`, `supabase/migrations/README.md` — so the workflow comments can simply
be cut rather than rewritten.
