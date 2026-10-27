# ⚠️ This is NOT a complete schema history. Do not `db reset` from it.

The live database has **285 applied migrations** (15 Jun 2026 → today). This directory holds only
the ones captured since the practice of committing them started, on 27 Oct 2026.

Running `supabase db reset` or `supabase db push` against this directory would build a database
missing most of the schema — and it would look like it had worked. That is the one thing to know
before using anything in here.

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
