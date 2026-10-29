# ⚠️ This is NOT a complete schema history. Do not `db reset` from it.

The live database has **285 applied migrations** (15 Jun 2026 → today). This directory holds only
the ones captured since the practice of committing them started, on 27 Oct 2026.

Running `supabase db reset` or `supabase db push` against this directory would build a database
missing most of the schema — and it would look like it had worked. That is the one thing to know
before using anything in here.

## ⛔ Files ending `.DRAFT.sql` have NOT been applied

Four of them, all waiting on Evan:

- `20261028120000_close_insert_allocation.DRAFT.sql`
- `20261028120100_family_fund_safety.DRAFT.sql`
- `20261028120200_ktos_pep_are_family.DRAFT.sql` — two lines, and the admin UI can do it instead
- `20261028190000_picture_ready_revoke.DRAFT.sql` — ⚠️ **breaks every picture upload if applied on
  its own.** The rest of that change is already live (`picture_pending`, `pictures` v13); this last
  line needs the edge function to make one call as `service_role` first, which needs a secret this
  session could not verify. Its header has the order to do it in.

The first three are from Yaxa's 28 Oct review; the fourth is from Part A8 of it.

They are here because the review asked for its SQL to land in this directory for review. The
`.DRAFT.sql` suffix is deliberate: the Supabase CLI matches `<timestamp>_<name>.sql`, and these
still match it, so **a `db push` would try to apply them**. The suffix is a sign for a person, not
a guard against tooling. Read them before running anything in this directory.

Each one carries, in its own header, the read-only queries whose answers justify it — and what
bounds its urgency. Both are about the first time a fund account is handed to somebody other than
Evan; measured today, there are 33 accounts, **1 owner** and **1 distinct start date**, so neither
problem can currently be reached.

Rename the suffix away once applied, and move the "verified" header notes into `docs/` the way
every other change here records its reasoning.

## Why the rest are not here

Every migration until now was applied directly against the project and its reasoning written to
`docs/YYYY-MM-DD-*.sql`, which is what `CLAUDE.md` §11 describes: those files are the memory of
_why_, marked ✅ APPLIED with the migration name. They were never also kept as replayable SQL.

The statements do still exist, in `supabase_migrations.schema_migrations` on the project —
285 rows, about 949 kB of SQL. Completing this directory is a `supabase db pull` away, which
needs the database password and so is Evan's to run, not something to do from a tool session.

## Two things to know if you add to this directory

**A patch script is not a migration.** Several changes in this project are applied by reading a
function's current definition with `pg_get_functiondef`, string-replacing an anchor, and executing
the result — with an assertion that raises if the anchor is missing, so a drifted definition rolls
the whole thing back instead of applying a silent no-op. That technique is right for changing a
live function safely and **wrong as a committed migration**, because it derives its output from a
database that already has the old version. On a fresh database it has nothing to patch.

So what is committed here is the **resulting definition**, read back out of the live database with
`pg_get_functiondef` after applying — not the script that produced it. A file in here should be
replayable against an empty database, or it is not pulling its weight.

**Verify against live, do not transcribe.** Every statement in these files was read back from the
database it was applied to, rather than copied from whatever was sent. That is the only version
that is true by construction.
