# A weekly backup, and the restore that proves it — 21 Nov 2026, reworked 26 Nov

⛔ **NOT RUNNING YET.** It needs a key pair, a database role, a GitHub environment and five
secrets, all of them Evan's, and adding them is the approval. Until then the scheduled job stops
at its gate before it connects to anything. See **Turning it on** at the bottom.

**What changed on 26 Nov**, from a review of the first version:

- The dump now **keeps its grants**. The first version passed `--no-privileges`, so a restore came
  back with every function executable by anon and no member grants on any table.
- It **carries the auth user ids** that member rows point at. Without them, a restore of real data
  fails on the first of 51 foreign keys into `auth.users`.
- The restore **turns off a fresh project's default grants** first. Without that, it would reopen
  every deny-all table (see below).
- Every backup is **restored and compared** before it's kept.

The workflow and its test now share one script, `scripts/db-backup.sh`.

## ⚠️ The thing that shapes all of it: this repository is public

`gh api repos/justanothertree/yaya --jq .visibility` → **public**.

GitHub Actions artifacts inherit the repository's read access, so **an artifact here is public,
and so is the workflow's log**. Three rules follow, and each one is enforced in code:

- **The bundle is encrypted before upload**, with [age](https://age-encryption.org), to a public
  key. The private key never touches CI. `seal` refuses to finish unless the file's first line is
  exactly `age-encryption.org/v1`.
- **Nothing printed names a value.**
  - Not a row count, and not a hash of anybody's rows.
  - Not an input.
  - A mismatch names the table or object, never what it holds.
- **Every input is a secret of the `db-backup` environment.**
  - A GitHub _variable_ is printed in a step's log header; a _secret_ is masked.
  - So even a private key pasted where the public one belongs never reaches the page. The gate
    then refuses it by name, without repeating it.

## What a bundle holds

One `yaya-db-<run id>` artifact per week, kept 90 days. It is one age file holding a tar of:

| file                | what                                                                                                                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `yaya.dump`         | `pg_dump` of `public` and `finance`: custom format, `--no-owner`, **privileges kept**, `--strict-names`                                                                                        |
| `auth-user-ids.txt` | the id of every row in `auth.users`, **and nothing else**: no email, no password hash, no token                                                                                                |
| `manifest.tsv`      | the source's account of itself (`scripts/db-backup/manifest.sql`): every table's rows (count and md5), and every definition and grant. `manifest.before.tsv` is the same, read before the dump |
| `moved.txt`         | tables whose rows changed while `pg_dump` ran, so their rows are not compared                                                                                                                  |
| `extras.tsv`        | what the dump cannot carry: realtime publication membership, and pg_cron's jobs (if the role may read them)                                                                                    |

As of 26 Nov 2026 the two schemas held **82 tables, 1 view, 366 functions and 7 sequences**, and
the database was **38 MB**. Those are dated figures. Ask rather than trust them:

```sql
select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname in ('public', 'finance') and c.relkind = 'r';
select pg_size_pretty(pg_database_size(current_database()));
```

## What it does not carry, and where each piece lives instead

| not in the bundle                                                     | where it is, and what a recovery does about it                                                                                                                                    |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **auth accounts**: emails, password hashes, identities, sessions, MFA | Supabase's own backups. A restore makes a bare `auth.users` row per id, so member data still lines up, but nobody can sign in to those rows. See **Bringing members back** below. |
| **pg_cron's jobs** (6 on 26 Nov)                                      | captured in `extras.tsv` (base64) if the backup role may read `cron.job`. Their commands are also in this repository's migrations.                                                |
| **realtime publication membership** (12 tables)                       | captured in `extras.tsv`; `restore` prints the `alter publication … add table` lines to run                                                                                       |
| **Vault** (1 secret)                                                  | not captured, on purpose. Regenerate it from where it came from.                                                                                                                  |
| **edge-function secrets** (VAPID, R2 credentials)                     | the Supabase dashboard. They aren't in the database.                                                                                                                              |
| **R2 objects**: pictures, chat songs                                  | Cloudflare R2. The rows that name them are backed up; the files are not.                                                                                                          |
| **Supabase Storage** objects                                          | the `storage` schema and its bucket; not dumped                                                                                                                                   |
| **dashboard configuration**: auth URLs, SMTP, providers               | the dashboard                                                                                                                                                                     |
| **extensions** (pg_net, http, pg_cron, citext, pgcrypto, …)           | present on every Supabase project. A plain Postgres gets stand-ins for the only two the schema depends on.                                                                        |

## The weekly run

`.github/workflows/db-backup.yml`, `dump` job, Sundays at 09:23 UTC (4:23 AM Eastern in winter).

1. **Gate** (`db-backup.sh gate`). It checks the five inputs and prints only names:
   - **None set:** a green notice, and nothing is connected to.
   - **Some set:** a red run, every week until it's finished. The first version exited 0 here,
     so a misspelt secret looked exactly like "not switched on".
   - **All set but wrong:** also red. It refuses:
     - a private key;
     - the IPv6-only direct host;
     - a pooler user with no `.project_ref`;
     - a CA certificate that isn't PEM.
2. **Install** the Postgres 17 client and age. Every Postgres tool is called by path from
   `/usr/lib/postgresql/17/bin`. The runner image ships a newer client, and `pg_wrapper` picks a
   version from a connection string it never sees here.
3. **Dump** (`db-backup.sh dump`).
   - It connects through libpq's environment, never a URI, with `PGSSLMODE=verify-full` against
     Supabase's CA.
   - It reads the manifest either side of `pg_dump`.
   - It refuses a dump with no data or no ids.
4. **Restore and compare** (`prepare-plain-target`, then `restore`). This happens in a throwaway
   Postgres inside the same job.
   - The real backup is restored and compared with production's own manifest, line for line,
     before it's allowed to become the artifact.
   - That makes this the only place all of production's tables are ever round-tripped.
   - The plaintext never leaves the runner.
5. **Seal** (`db-backup.sh seal`): it encrypts the bundle, proves the result is ciphertext, and
   deletes the plaintext.
6. **Upload**, with `actions/upload-artifact` pinned by SHA.

## The restore test

The `restore-test` job runs `scripts/restore-test.sh` on every pull request that touches the
backup, `supabase/`, or the workflow. It needs no secret and no production data.

**The source** is built from the repository's own baseline, the seed, and the speed tidy-up's
fixtures:

- four members in `auth.users`, with rows pointing at them across the schema;
- `scripts/db-backup/test-source-extras.sql`:
  - a probe table of awkward values;
  - a service-only function and column grants;
  - the three things production has that the 4 Nov baseline doesn't: `supabase_admin`'s default
    privileges, a realtime publication, and pg_cron jobs;
  - the backup role's grants.
- It refuses to run with fewer than 25 tables holding rows, or fewer than 20 of the foreign keys
  into `auth.users` in use.

**The target is shaped like a fresh Supabase project**, with Supabase's default grants on
`public`. On an empty Postgres the trap below can't spring.

**The procedure** is the weekly job's own, through the same subcommands: dump, seal and open
with a throwaway age key, then restore. The grants and row counts are then asked again with
`has_*_privilege()` and `count(*)`, which share no code with the manifest. Two different
questions must give the same answer.

**Then it breaks the backup on purpose, on every run.** Each fault must be refused, for its own
reason, or the run is red:

| fault                                                                      | refused by                                               |
| -------------------------------------------------------------------------- | -------------------------------------------------------- |
| a target missing a role the grants name                                    | `preflight`, naming the role                             |
| restored with `--no-privileges` (the first version)                        | `verify`: functions and relations differ                 |
| restored into a project's default grants without turning them off          | `verify`: the probe's grants differ                      |
| restored without the auth ids (the first version's other gap)              | `pg_restore`: a foreign key                              |
| a restore aimed at a database that already has tables                      | `preflight`: the guard against restoring over production |
| a row missing, a constraint missing, a grant widened, after a good restore | `verify`, naming each                                    |
| the stand-ins loaded into a real project                                   | `prepare-plain-target`                                   |
| an age private key given as the recipient                                  | `seal`, which must not print it either                   |
| a plaintext tar, or a raw dump, as the upload                              | `check-ciphertext`                                       |
| the gate: half configured, a private key, the direct host, no project ref  | `gate`                                                   |

**What it does not prove:**

- **Restoring into a real Supabase project.** The target here is a superuser on plain Postgres
  with stand-ins; on a real project the restore runs as `postgres`, which isn't a superuser.
  The two known differences are handled and named:
  - `supabase_admin`'s default-privilege entries are left out of the restore;
  - `CREATE SCHEMA public` is left out.

  The first real-project restore is still a first.

- **The newer tables.** The 4 Nov baseline has 62 of today's 82 tables. The weekly job's own
  restore covers the other 20 every Sunday; this test does not.

## ⚠️ The trap a real project sets: default grants

Supabase's default privileges hand every new table, sequence and function in `public` to `anon`,
`authenticated` and `service_role`. Production's are:

- tables: `arwdm` to anon and members;
- functions: `EXECUTE` to all three.

A restore **creates** every object, so each one is born with those grants. A dump's GRANT and
REVOKE lines are written against Postgres's _built-in_ defaults, not the target's, so nothing in
the dump takes them back. Restored as-is:

- every deny-all table would be granted to `anon`, and `TRUNCATE` is the one privilege RLS
  never checks;
- every service-only `SECURITY DEFINER` function would be executable by `anon`.

So `restore` revokes the restoring role's defaults first, exactly as
`supabase/baseline/00-privileges.sql` does. The dump's own `ALTER DEFAULT PRIVILEGES` lines then
put production's defaults back at the end. The restore test's `kept default grants` fault is
this trap, sprung on purpose.

## Restoring by hand

**Work outside the repository**, in a directory only you can read. A decrypted bundle is every
member's rows. `.gitignore` covers `*.dump`, `*.age` and `*.key` for the day somebody forgets.

```bash
umask 077
WORK="$(mktemp -d)"
gh run download <run-id> -n yaya-db-<run-id> -D "$WORK"
bash scripts/db-backup.sh open "$WORK/yaya-db.tar.age" /path/to/yaya-backup.key.age "$WORK/bundle"
```

**Into a real Supabase project.** It must be a new, empty one: `preflight` refuses a target with
tables.

1. Create the backup's role on it first (`create role yaya_backup nologin`), because the grants
   name it.
2. Point libpq at the new project's Session pooler:
   - `PGHOST`, `PGPORT=5432`, `PGUSER=postgres.<ref>`, `PGPASSWORD`;
   - `PGSSLMODE=verify-full`, `PGSSLROOTCERT=<the CA file>`.
3. Run:

   ```bash
   bash scripts/db-backup.sh restore "$WORK/bundle"
   ```

   It prints the `alter publication` lines to run afterwards.

4. Re-create the cron jobs from `extras.tsv` (each command is base64).

**Into a scratch Postgres 17**, to look at a backup or to check one:

```bash
bash scripts/db-backup.sh prepare-plain-target "$WORK/bundle"
bash scripts/db-backup.sh restore "$WORK/bundle"
```

**Bringing members back.** _This is untested._ The ids are restored, so every member's rows still
belong to the right id. A row with no email can't sign in, though, and a member who signs up
again gets a new id that owns nothing. The way back is to give the restored row its owner's
email, as `postgres`:

```sql
update auth.users
   set email = 'their@address', aud = 'authenticated', role = 'authenticated',
       instance_id = '00000000-0000-0000-0000-000000000000'
 where id = '<their id>';
```

Then the member uses "forgot password" to set a new one. That way they keep their id, and with
it everything they made.

## Turning it on — the walkthrough, 28 Nov

All of these are yours, and none has been done.

1. **A key pair, made offline**, never on this machine or in CI:

   ```bash
   age-keygen -o yaya-backup.key        # prints the public key, age1…
   age -p -o yaya-backup.key.age yaya-backup.key && rm yaya-backup.key
   ```

   - `yaya-backup.key.age` is the private key under a passphrase. `age -d -i yaya-backup.key.age`
     asks for the passphrase.
   - Keep **two copies** offline, in two places, with the passphrase in your password manager.
   - It's the only thing that can read these artifacts. Losing it loses every backup.

2. **The backup's role**, in the SQL editor as `postgres`:

   ```sql
   create role yaya_backup with login bypassrls password '<long, random>';
   grant usage on schema public, finance to yaya_backup;
   grant select on all tables in schema public, finance to yaya_backup;
   grant select on all sequences in schema public, finance to yaya_backup;
   alter default privileges for role postgres in schema public grant select on tables to yaya_backup;
   alter default privileges for role postgres in schema public grant select on sequences to yaya_backup;
   alter default privileges for role postgres in schema finance grant select on tables to yaya_backup;
   alter default privileges for role postgres in schema finance grant select on sequences to yaya_backup;
   -- the member ids, and nothing else in auth
   grant usage on schema auth to yaya_backup;
   grant select (id) on auth.users to yaya_backup;
   -- optional: keeps pg_cron's job definitions inside the ciphertext
   grant usage on schema cron to yaya_backup;
   grant select on cron.job to yaya_backup;
   ```

   - **`BYPASSRLS`** because `pg_dump` must see every row. A role subject to RLS gets an error,
     not a partial dump.
   - **No write privilege anywhere, and nothing in `vault`.** Measured on 26 Nov: `postgres` holds
     `bypassrls` and `createrole`, and may grant `select (id)` on `auth.users`, so this runs as
     written.
   - **The default privileges** are so a table added later is readable without anybody
     remembering. Without them, the next new table turns the backup red.

3. **The environment**:
   - Settings → Environments → **New environment** → `db-backup`.
   - **Deployment branches: selected branches → `main` only.** This, not the workflow's `if:`, is
     what keeps the secrets off pull-request code.
4. **Five environment secrets:**

   | secret                    | value                                                                                                                                                             |
   | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `DB_BACKUP_PGHOST`        | the **Session pooler** host, from the project's Connect panel (`aws-0-<region>.pooler.supabase.com`). The direct host is IPv6-only, and GitHub's runners are not. |
   | `DB_BACKUP_PGUSER`        | `yaya_backup.<project-ref>`                                                                                                                                       |
   | `DB_BACKUP_PGPASSWORD`    | the role's password                                                                                                                                               |
   | `DB_BACKUP_AGE_RECIPIENT` | the `age1…` public key from step 1                                                                                                                                |
   | `DB_BACKUP_CA_CERT`       | the contents of the CA certificate from Database Settings → SSL Configuration                                                                                     |

5. **Run it by hand:** Actions → **db backup** → Run workflow → `main`. Check for:
   - a green run;
   - the line `the restore matches the source in all … items`;
   - an artifact named `yaya-db-<run id>`, not only a green tick.
6. **Open one yourself**, as in **Restoring by hand**, at least as far as `open`.
7. **Failure emails.** A scheduled run's failure email goes to whoever last changed the `cron:`
   line, so make sure Actions notifications are on for your account.

The first scheduled run after a merge on Sat 28 Nov would be **Sun 29 Nov, 4:23 AM EST**.

## Cost

- Artifact storage and runner minutes are free on a public repository.
- A compressed bundle is a few MB, and 13 are kept at a time.
- The weekly read of a 38 MB database is noise against the free tier's egress.
- Nothing here needs a new service (§5's "prefer an existing capability").

## How the restore test learned what a target needs

**A `public` + `finance` dump refers outward**, and restoring into a plain Postgres failed one
schema at a time on the first version's runs two to four. Measured on production with
`pg_depend` on 26 Nov, the hard dependencies are exactly four:

- `auth.users`: 51 foreign keys;
- `auth.uid()`: 77 defaults and policies;
- `extensions.citext`;
- `extensions.gen_random_bytes`.

`supabase/tests/plain-postgres/00-platform.sql` and `supabase/baseline/01-extensions.sql`
provide them, and `prepare-plain-target` loads both. Function bodies that name `net`, `vault` or
`cron` aren't checked when a dump is restored (`check_function_bodies = false`), so those
schemas need only exist.

**And the two obvious fixes for a non-empty `public` fight each other.**

- A fresh server already has a `public` schema, and `pg_dump --schema=public` emits
  `CREATE SCHEMA public`, so the restore dies on "schema public already exists".
- Dropping `public` first breaks the stand-ins, which are loaded into it.

So that one entry is filtered out of the restore with `pg_restore`'s own table of contents, and
the script asserts it removed exactly one. `--clean --if-exists` would issue a DROP for every
object and silence every error those raise, a real one included.
