# A weekly backup, and the restore that proves it — 21 Nov 2026

⛔ **NOT RUNNING YET. It needs two things from Evan, and adding them is the approval.** No secret
was created, nothing was pointed at production, and the scheduled job is a no-op until both
exist. See "Turning it on" at the bottom.

## ⚠️ The thing that shapes all of it: this repository is public

`gh api repos/justanothertree/yaya --jq .visibility` → **public**.

GitHub Actions artifacts inherit the repository's read access, and read access to a public repo
is everybody. So the obvious build of this — `pg_dump`, `upload-artifact`, done — **would publish
every member's rows to the internet**: chat messages, profile notes, the finance tables, the lot.
There is no "private artifact" setting that rescues it; privacy comes from the repository, and
this one is a portfolio.

So the dump is **encrypted before it is uploaded**, with [age](https://age-encryption.org), and
the artifact is ciphertext. The recipient's public key goes in a repository **variable**, because
a public key is not a secret and publishing it costs nothing. The private key never touches CI.
Anybody can download the artifact; what they get is 36 MB of noise.

The workflow refuses to upload anything that is not ciphertext — it checks the file begins with
`age-encryption.org/v1` and does not begin with `PGDMP`, and fails the run otherwise. That check
is there because "the previous step worked" is exactly the assumption that would publish the
database.

## What is dumped, and what is not

`--schema=public --schema=finance`, custom format, `--no-owner --no-privileges`.

|                             |                                                            |
| --------------------------- | ---------------------------------------------------------- |
| database size today         | **36 MB**                                                  |
| tables in those two schemas | **74**                                                     |
| retention                   | 90 days (≈13 weekly copies)                                |
| schedule                    | `23 9 * * 0` — 09:23 UTC Sunday, 4:23 AM Eastern in winter |

**`auth` is not dumped.** It is Supabase's schema, the dumping role does not necessarily own it,
and it holds password hashes and refresh tokens — the one part of this database where a stolen
copy is worse than a lost one. A restore therefore brings back _data_, not _accounts_: rows in
`profiles` and everything keyed to a `user_id` survive, and the ability to sign in as those users
does not. That is a deliberate trade and the reason this is a second copy rather than a disaster
plan. Supabase's own backups remain the first line.

**`--no-owner --no-privileges`** because the roles on a restore target are not these roles, and
the ACLs are not something to recover from a dump anyway: §3's deny-all pattern is rebuilt from
`supabase/baseline/00-privileges.sql`, which is in version control and reviewed. A dump that
carried its own grants would quietly reintroduce whatever was wrong on the day it was taken.

## The restore test

`scripts/restore-test.sh`, run by the `restore-test` job on **every** run of the workflow,
including on a pull request — because it uses **no production data and no secret**.

It builds a source database from the repository's own baseline (the same `sql_paths` files
`supabase/config.toml` names), puts one deliberately awkward row in it, dumps it exactly as the
weekly job does, restores into a second empty Postgres 17, and then compares:

- table count across `public` and `finance`
- function count across both
- an md5 of the probe row, which carries a `⚠️`, an embedded `'quote'`, a `timestamptz` and
  nested `jsonb` — so the comparison is about data surviving, not only DDL
- and it asks the target to **refuse** a duplicate primary key, because a restore that silently
  drops a constraint leaves the same tables and the same rows and goes wrong months later

It refuses to report success if the source has fewer than 40 tables, so a broken build of the
source reads as a failure rather than as a clean run over nothing.

**What it does not prove:** that the _live_ dump is complete. That depends on the connection
string and on what the dumping role is allowed to read, and it is checked by hand once, the first
time, per the checklist below.

## ⚠️ A restore needs `auth` to exist first, and that is not obvious

The dump is `public` + `finance`. Objects in those schemas **refer outward**:
`finance.cost_basis_overrides.updated_by` is `DEFAULT auth.uid()`, and the baseline contains
**475** calls to `auth.uid()` or `auth.jwt()`. So restoring into a plain Postgres fails on the
first such column:

```
pg_restore: error: could not execute query: ERROR:  schema "auth" does not exist
```

**This was found by the restore test, on its second run, and it is the reason the test exists.**
The procedure below would otherwise have said "restore it into an empty server", which is wrong
in exactly this way, and nobody would have discovered that until the day they needed the backup.

Two restore targets, and they differ:

| restoring into                                   | what you need first                                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| a real Supabase project                          | nothing — `auth` is already there                                                                                               |
| a plain Postgres (a scratch check, a local look) | `psql -f supabase/tests/plain-postgres/00-platform.sql` first, the repository's existing stand-in for those roles and functions |

`scripts/restore-test.sh` does the second, which is why it can run on a bare `postgres:17`
service container with no Supabase anywhere.

### And the two obvious fixes fight each other

A fresh server already has a `public` schema, and `pg_dump --schema=public` emits
`CREATE SCHEMA public` — so the restore dies on **"schema public already exists"**. The obvious
answer, dropping `public` first, then breaks the step above: `00-platform.sql` creates its
stand-in objects _in_ `public`, so against a server without one it dies on **"schema public does
not exist"**. Both were real CI failures, in that order.

So `public` is left alone and the one conflicting entry is filtered out of the restore with
`pg_restore`'s own table of contents:

```bash
pg_restore --list yaya.dump > toc
grep -vE '[0-9]+; [0-9]+ [0-9]+ SCHEMA - public ' toc > toc.keep
pg_restore --use-list=toc.keep --exit-on-error --no-owner --no-privileges -d "$TARGET" yaya.dump
```

The script asserts that filter removed **exactly one** entry — 0 means the pattern has stopped
matching and the restore is about to fail the old way, 2+ means it is eating something else.

`pg_restore --clean --if-exists` is deliberately _not_ used: it issues a DROP for every object in
the dump, which against a target holding none of them is a wall of errors `--if-exists` silences
— and it would silence a real one just as happily.

## Turning it on

Two things, both yours, and I have deliberately not done either:

1. **Generate a key pair** somewhere that is not this machine and not CI:
   `age-keygen -o yaya-backup.key` — keep `yaya-backup.key` somewhere safe and offline; it is the
   only thing that can read these artifacts.
2. **Add the public half** as a repository _variable_ named `AGE_RECIPIENT` (Settings →
   Secrets and variables → Actions → Variables). It looks like `age1…` and is safe in public.
3. **Add the connection string** as a repository _secret_ named `SUPABASE_DB_URL`. Supabase
   Dashboard → Project Settings → Database → Connection string → URI. ⚠️ Use a role with the
   least that works; the service role's string is not required for a read-only dump.

Until all three exist the job logs a notice and exits 0 without connecting to anything.

### The first real run, by hand

Once it has produced one artifact, before trusting it:

```bash
gh run download <run-id> -n yaya-db-<run-id>          # the ciphertext
age --decrypt -i yaya-backup.key -o yaya.dump yaya.dump.age
pg_restore --list yaya.dump | head -40                 # does it name the tables you expect?
pg_restore --list yaya.dump | grep -c 'TABLE DATA'     # 74-ish, not 0
```

and then restore it into a scratch server and run the same comparisons `restore-test.sh` makes.
A dump that restores into an empty database is the only evidence that matters; everything above
is arrangements.

## Cost

Artifact storage on a public repository is free. 36 MB compressed is a few MB an upload, 13
copies at a time. Nothing here needs a new service — §5's "prefer an existing capability".
