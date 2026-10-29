# ⚠️ This is NOT a complete schema history. Do not `db reset` from it.

The live database has **295 applied migrations** (15 Jun 2026 → 29 Oct 2026, 973 kB of SQL). This
directory holds **9** — only the ones captured since the practice of committing them started, on
27 Oct 2026. That gap is the whole warning.

⚠️ Both figures are measured and both rot. Ask rather than trust them:

```sql
select count(*), min(version), max(version) from supabase_migrations.schema_migrations;
```

Running `supabase db reset` or `supabase db push` against this directory would build a database
missing most of the schema — and it would look like it had worked. That is the one thing to know
before using anything in here.

## ✅ The four drafts are applied — 29 Oct 2026

There are no `.DRAFT.sql` files any more. The four that sat here from Yaxa's 28 Oct review went in
on 29 Oct, as **seven** migrations: two of the drafts were prose sketches rather than runnable SQL,
and the picture one had to be split in two so there was never a window where uploads were broken.

`docs/2026-10-29-the-four-drafts-applied.md` has the mapping, the measurements and the standing
queries. Each migration's own header has its own.

⚠️ **They were deleted rather than renamed, which is a departure from the instruction below.**
Every one of those headers began "⛔ DRAFT — NOT APPLIED. Nothing in this file has run." Renaming
the suffix would have left that sentence sitting at the top of an applied migration, which is worse
than no file: the reasoning in them is carried into the applied versions — corrected where it was
wrong, and two of them were — and git still has the originals.

⚠️ **The reason the suffix was never a guard is still worth knowing.** The Supabase CLI matches
`<timestamp>_<name>.sql`, and `*.DRAFT.sql` matches that too — so a `db push` would have tried to
apply them. The suffix was a sign for a person, not a safety. If a draft is ever parked here again,
that is the thing to remember about it.

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
