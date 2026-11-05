# ⚠️ This is a RECORD of what ran, not a script that rebuilds it.

The live database has **362 applied migrations** (15 Jun 2026 → 4 Nov 2026). This
directory holds **81 files**: a schema baseline, and the **80** applied migrations captured since
the practice of committing them started on 27 Oct 2026. That gap is the whole warning. Every
migration applied ON or AFTER 29 Oct has a file here; the 283 before it do not, and nor do two
from 27 Oct (20261027002305, 20261027003416) — which is what the baseline is for.

⚠️ Every figure in that paragraph is measured and all of them rot. Ask rather than trust them —
the first for the database, the second for this directory, and they are not meant to agree:

```sql
select count(*), min(version), max(version) from supabase_migrations.schema_migrations;
```

```bash
ls supabase/migrations/*.sql | wc -l       # files, baseline included
node scripts/migration-md5.mjs             # how many of them production has a record of
```

⚠️ **AND THE CLI NO LONGER APPLIES THEM AT ALL.** `[db.migrations] enabled = false` in
`supabase/config.toml`, and the schema is built by `[db.seed] sql_paths` instead, in this order:

| file                                     | what it is                                                                               |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `baseline/00-privileges.sql`             | the default-privilege revokes a restore cannot reproduce                                 |
| `baseline/01-extensions.sql`             | citext and pgcrypto, which the dump's own column types need and the dump does not create |
| `migrations/00000000000000_baseline.sql` | the schema-only dump of production, **exactly as the dump tool produced it**             |
| `baseline/02-triggers.sql`               | the 24 triggers the dump turned out not to contain                                       |
| `seed.sql`                               | the fixtures the guards need                                                             |

⚠️ **THE DUMP IS NOT THE SCHEMA, and `supabase/baseline/README.md` is the regeneration note.**
Re-running the dump command replaces the dump and nothing else: a fresh one has no extensions,
no privilege revokes, and — produced the way this one was — no triggers. That is survivable only
because the three hand-written files sit BESIDE the dump rather than inside it, so a regeneration
cannot silently delete them. What it can still miss is a trigger added to production since the
dump was taken, which is why that README's step 3 exists.

`supabase db push` is skipped by the same switch, and that config block has the whole reasoning
with the measurement behind it. `scripts/baseline.test.mjs` asserts the four still fit together.

The short version: **these files cannot replay, and that is a property of how they are written
rather than a fault in any of them.** Most are surgery on function bodies that assert the state
they expect to find and refuse to run against anything else; on top of a dump taken afterwards
they raise, because the state they are looking for has already gone. One of them simulates an
admin session and asserts a row count of the live fund. Editing them so they replay is what
CLAUDE.md §4 forbids outright — a migration is the record of an event.

Before the baseline existed, a `db reset` here built a database missing most of the schema and
looked like it had worked. That was the one thing to know about this directory; now it is the
sentence above.

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

## ✅ The md5 check is no longer something a person remembers to run — 4 Nov 2026

**Never edit a migration production has already applied.** Put the fix in a new timestamped
migration. A migration file is not source code that can be corrected; it is the record of an
event, and the database it describes has already moved on.

`supabase/migrations/applied.md5` holds, per file, the md5 of the statement production actually
ran, and `scripts/migration-md5.mjs` compares every file against it. It runs on `npm run test`,
so it runs on pre-push and in `.github/workflows/test.yml` — the edit is refused on the machine
that made it. The manifest's own header has the body rule, the regenerating query and what the
columns mean.

⚠️ **ELEVEN FILES DIVERGE, NOT THE TWO THIS SECTION USED TO NAME, and the extra nine are the
reason a check beats a paragraph.** The first run of it measured:

- **68** are byte for byte the statement that ran.
- **3** are `re-run-guard`: they gained `drop … if exists` or `if not exists … add constraint`
  after being applied, so the file can replay. `20261029153952`, `20261030032833` and
  `20261103200333` — and only the last of the three says so in its own header.
- **7** are `comments`: identical SQL once comments and whitespace are normalised away, from
  before the body-md5 protocol had been worked out.
- **1** is `rebuilt`: `20261027004612`, written back out of the database with
  `pg_get_functiondef` rather than from what was sent, so it carries that function's own casing
  and is missing one `do $$ … end $$` assertion that did run.

The distinction worth holding onto is unchanged: a file may diverge in what makes it
**re-runnable**, never in what it **does**. What changed is that the list is now machine-checked
and pinned — a divergence records the exact text that is allowed, so a SECOND edit to a diverging
file fails like any other. A twelfth file joining the list without a reason beside it is drift,
and the check says the word `unexplained` out loud rather than letting it pass.

⚠️ **AND A FILE WITH NO LINE IN THE MANIFEST FAILS TOO — 4 Nov, the day after the check landed.**
It was reported at first, which left `npm run test` stricter than the script: the suite asserted
every file had a line while the gate that runs in CI only mentioned it. A migration applied
without its hash recorded is this same gap seen from the other side, so it stops the build. The
schema baseline is the one exception, and it is named in the script rather than inferred — it is a
`db dump`, not a statement anybody ran, so the record will never hold a row for it.

⚠️ **AND THE HEADER IS NOT PINNED, WHICH IS THE ONE EDIT THAT IS ALWAYS SAFE.** The body rule
strips the contiguous `--` lines at the top, so a note can be added above any applied migration
without touching its md5. That is how to annotate one — not by correcting the SQL under it.

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
