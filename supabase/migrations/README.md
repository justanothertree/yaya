# ⚠️ This is NOT a complete schema history. Do not `db reset` from it.

The live database has **300 applied migrations** (15 Jun 2026 → 29 Oct 2026). This
directory holds **17** — only the ones captured since the practice of committing them started, on
27 Oct 2026. That gap is the whole warning. Every migration applied ON or AFTER 29 Oct has a file
here; the 283 before it do not.

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

## Two counts that have to agree, and a query that checks them

⚠️ **THE DIRECTORY AND THE DATABASE DRIFTED WITHIN HOURS OF BEING WRITTEN, and nothing downstream
would ever have said so.** On 29 Oct this held seven files against eight applied versions: a
correction to `admin_delete_member` had been folded back into the family_fund_safety FILE while the
database kept both migrations, so a file no longer matched the migration of its own name. The
numbering had drifted too — files named 0900–0924 against applied versions 152157–155118, because
the names were invented when the files were written rather than taken from what the server
assigned. Both were caught by a person counting the two lists against each other, which is exactly
the kind of check that does not happen twice.

So ask instead. Names and versions:

```sql
select version, name from supabase_migrations.schema_migrations
where version >= '20261029' order by version;
```

And the stronger one — **does each file actually reproduce the function the migration created?**
`statements` holds the SQL as it ran, so every `create or replace` can be compared span by span:

```sql
select s.version,
       substring(m[1] from 'function public\.([a-z_]+)') as fn,
       md5(m[1]) as fn_md5
from supabase_migrations.schema_migrations s,
     lateral regexp_matches(array_to_string(s.statements, E'\n'),
       '(create or replace function.*?\$function\$;)', 'gs') as m
where s.version like '20261029%' order by s.version, 2;
```

Run the same regex over the files and compare the md5s. All of 29 Oct's matched — fifteen
migrations, seventeen files counting the two from 27 Oct. A file's HEADER
comments are its own and need not match — but a comment INSIDE a function body is part of the
stored definition, so it does: `pg_get_functiondef` returns it, and a file that differs there
builds a different function on replay.

⚠️ **TWO FILES NOW DIVERGE ON PURPOSE, AND THE EXCEPTION IS NAMED SO IT CANNOT BE MISTAKEN FOR
DRIFT.** `20261029153952_family_fund_safety.sql` and
`20261030032833_suspension_reaches_the_social_tables.sql` were edited after they were applied, to
add guards — a `do $$ … if not exists … $$` around one `add constraint`, and `drop policy if
exists` above two `create policy` statements. Nothing they do to the database changed; what
changed is that they can now run a SECOND time without failing, which is what lets this directory
rebuild the schema from a baseline (see `docs/ci/db-guards.yml`). Three statements, in two files,
each noted in its own header.

The distinction worth holding onto: a file may diverge in what makes it **re-runnable**, never in
what it **does**. The first is a property of the repository; the second is the thing the md5 check
exists to protect. A third file appearing in this list without a header note is drift.

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
