# A weekly backup, and the restore that proves it — 21 Nov 2026, reworked 26 Nov

⛔ **NOT RUNNING YET.** It needs a key pair, a database role, a GitHub environment and five
secrets, all of them Evan's, and adding them is the approval. Until then the scheduled job stops
at its gate before it connects to anything. See **Turning it on** at the bottom.

⚠️ **On this project's Free plan, Supabase keeps no backups** ("We automatically back up all Pro,
Team, and Enterprise Plan projects"). So once this is switched on, **these artifacts are the only
backup there is.** Nothing else in this doc is as important as that sentence.

**What changed on 26 Nov**, from two reviews of the first version:

- The dump now **keeps its grants**. The first version passed `--no-privileges`, so a restore came
  back with every function executable by anon and no member grants on any table. Measured in the
  restore test: 273 functions anon could call where the source has 9.
- It **carries the auth user ids** that member rows point at. Without them, a restore of real data
  fails on the first of 51 foreign keys into `auth.users`.
- The restore **turns off a fresh project's default grants** first. Without that, it reopens every
  deny-all table: measured, 54 tables `TRUNCATE`-able by anon.
- **Every backup is restored and compared** with production's own account of itself before it is
  kept.
- The workflow and its test share one script, `scripts/db-backup.sh`.
- The backup's database role is one file, `scripts/db-backup/backup-role.sql`, which the test
  runs too.
- Two things that would have broken the first real run were found by an independent review and
  measured on production:
  - Column comments compared by number would have failed every week, because `circuit_people`
    has a dropped column.
  - A `grant usage on schema auth` that `postgres` is not allowed to give would have warned,
    done nothing, and failed the first dump.

## ⚠️ The thing that shapes all of it: this repository is public

`gh api repos/justanothertree/yaya --jq .visibility` → **public**.

GitHub Actions artifacts inherit the repository's read access, so **an artifact here is public,
and so is the workflow's log**. Three rules follow, and each one is enforced in code and tested:

- **The bundle is encrypted before upload**, with [age](https://age-encryption.org), to a public
  key. The private key never touches CI.
  - `seal` refuses to finish unless the file's first line is exactly `age-encryption.org/v1`.
  - It removes a half-written file.
  - The upload waits for it.
- **The weekly log names no value** (`DB_BACKUP_PUBLIC_LOG=1`):
  - no row count, no member count, no size, and no input;
  - a mismatch names the table or object, never what it holds.
  - Postgres's own error messages quote the row they choked on ("Key (user_id)=(…) is not
    present"). So in that log they go to `restore-errors.txt` **inside the sealed bundle**, and
    the log says only which object failed.
  - The scratch Postgres runs with its server log off. GitHub prints a service container's log,
    and that log carried a member id in this PR's own CI.
- **Every input is a secret of the `db-backup` environment**, which only `main` may use.
  - A GitHub _variable_ is printed in a step's log header; a _secret_ is masked.
  - So even a private key pasted where the public one belongs never reaches the page. The gate
    then refuses it by name, without repeating it.

## What a bundle holds

One `yaya-db-<run id>-<attempt>` artifact per week, kept 90 days. It is one age file holding a tar
of:

| file                 | what                                                                                                                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `yaya.dump`          | `pg_dump` of `public` and `finance`: custom format, `--no-owner`, **privileges kept**, `--strict-names`                                                                                                                      |
| `auth-user-ids.txt`  | the id of every row in `auth.users`, **and nothing else**: no email, no password hash, no token. Read before and after `pg_dump` and kept as the union, so an account deleted mid-dump cannot leave rows whose id is missing |
| `manifest.tsv`       | the source's account of itself (`scripts/db-backup/manifest.sql`): every table's rows (count and md5), and every definition and grant. `manifest.before.tsv` is the same, read before the dump                               |
| `moved.txt`          | tables whose rows changed while `pg_dump` ran, so their rows are not compared                                                                                                                                                |
| `extras.tsv`         | what the dump cannot carry, for `after-restore` to put back (next section)                                                                                                                                                   |
| `restore-errors.txt` | only if the weekly restore check failed: the database's own messages, kept here rather than in the public log                                                                                                                |

As of 26 Nov 2026 the two schemas held **82 tables, 1 view, 366 functions and 7 sequences**, the
database was **38 MB**, and there were **14 members**. Those are dated figures. Ask rather than
trust them:

```sql
select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname in ('public', 'finance') and c.relkind = 'r';
select pg_size_pretty(pg_database_size(current_database()));
```

## What it does not carry, and where each piece lives instead

| not in the bundle                                                                                            | where it is, and what a recovery does about it                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **auth accounts**: emails, password hashes, identities, sessions, MFA                                        | **Nowhere else, on the Free plan.** A restore makes an `auth.users` row per id, so member data still lines up, but nobody can sign in to those rows. `public.profiles.email` holds an address for many members, but not for all. See **Bringing members back**. |
| **pg_cron's jobs** (6 on 26 Nov)                                                                             | captured in `extras.tsv`, paused or not, if the backup role may read `cron.job`; `after-restore` prints the `cron.schedule` calls                                                                                                                               |
| **realtime publication membership** (12 tables)                                                              | captured in `extras.tsv`; `after-restore` prints the `alter publication` lines                                                                                                                                                                                  |
| **the app's policies on Supabase's own tables**: 11 on `realtime.messages`, Realtime's channel authorization | captured in `extras.tsv`; `after-restore` prints the `create policy` statements. Without them, private channels refuse everybody                                                                                                                                |
| **triggers on Supabase's own tables that call ours**                                                         | captured in `extras.tsv` (there were none on 26 Nov; a profile-on-signup trigger on `auth.users` is the usual one)                                                                                                                                              |
| **Vault**: one secret, `finnhub_api_key`                                                                     | not captured, on purpose. It is the Finnhub API key the stock-price function reads; without it, stock quotes stop, quietly. Re-create it with `select vault.create_secret('<key>', 'finnhub_api_key');`                                                         |
| **edge-function secrets** (VAPID, R2 credentials)                                                            | the Supabase dashboard. They aren't in the database                                                                                                                                                                                                             |
| **R2 objects**: pictures, chat songs                                                                         | Cloudflare R2. The rows that name them are backed up; the files are not                                                                                                                                                                                         |
| **Supabase Storage** objects                                                                                 | the `storage` schema and its bucket; not dumped                                                                                                                                                                                                                 |
| **migration history** (`supabase_migrations.schema_migrations`)                                              | the repository: `supabase/migrations/` and `applied.md5` are the record. After a restore, the new project's history is empty. Don't let that invite re-running migrations over a schema that already has them                                                   |
| **dashboard configuration**: auth URLs, SMTP, providers                                                      | the dashboard                                                                                                                                                                                                                                                   |
| **extensions** (citext, pgcrypto, pg_cron, pg_net, http, …)                                                  | available on every Supabase project, but a new project has only some of them switched on: enable them first (see **Restoring by hand**). A plain Postgres gets stand-ins for the only two the schema needs                                                      |

## The weekly run

`.github/workflows/db-backup.yml`, `dump` job, Sundays at 09:23 UTC (4:23 AM Eastern in winter).

1. **Gate** (`db-backup.sh gate`). It checks the five inputs and prints only names:
   - **None set:** a green notice, and nothing is connected to.
   - **Some set:** a red run, every week until it's finished. The first version exited 0 here,
     so a misspelt secret looked exactly like "not switched on".
   - **All set but wrong:** also red. It refuses:
     - a private key, or a whole key file;
     - the IPv6-only direct host, or any host that isn't the pooler;
     - a pooler user with no `.project_ref`, or the owner's `postgres.<ref>`;
     - a value with whitespace around it;
     - a CA certificate that isn't PEM;
     - a run anywhere but `main` that holds the secrets.
2. **Install** the Postgres 17 client and age. Every Postgres tool is called by path from
   `/usr/lib/postgresql/17/bin`. The runner image ships a newer client, and `pg_wrapper` picks a
   version from a connection string it never sees here.
3. **Dump** (`db-backup.sh dump`).
   - It connects through libpq's environment, never a URI, with `PGSSLMODE=verify-full` against
     Supabase's CA.
   - **It refuses a role that could do harm:** a superuser, a role that can create roles or
     databases, a role without `BYPASSRLS` (which would get a partial dump), or one that may write
     a single table it backs up.
   - It reads the manifest either side of `pg_dump`.
   - It refuses a dump with no tables, no data, or no ids.
4. **Restore and compare** (`prepare-plain-target`, then `restore`), in a throwaway Postgres
   started inside this step.
   - The real backup is restored and compared with production's own manifest, line for line.
   - That makes this the only place all of production's tables are ever round-tripped.
   - The plaintext never leaves the runner.
5. **Seal** (`db-backup.sh seal`): it encrypts the bundle, proves the result is ciphertext, and
   deletes the plaintext.
6. **Upload**, only after a successful seal, with `actions/upload-artifact` pinned by SHA.

If step 4 fails or times out (15 minutes), the run is red, but steps 5 and 6 still happen, and
the artifact is named `…-unverified`. A backup that didn't restore cleanly is still the newest copy
there is. The name means nobody restores it trusting it.

**⚠️ Two ways it can stop without turning red:**

- GitHub disables a public repository's scheduled workflows after **60 days with no activity in
  it**. A disabled schedule makes no run, so it sends no failure email.
- If the environment's secrets are deleted, the gate reads that as "not switched on" and goes
  green.

Either way the artifacts simply stop. The check that catches both is to look at the date of the
newest `yaya-db-*` artifact: it should never be more than a week old.

## The restore test

The `restore-test` job runs `scripts/restore-test.sh` on every pull request that touches the
backup, `supabase/`, or the workflow. It needs no secret and no production data.

**It starts with a canary:** if a `DB_BACKUP_*` secret is visible to it, the secret was saved at
repository level, where any branch can read it. That fails the job.

**The source** is built from the repository's own baseline, the seed, and the speed tidy-up's
fixtures: four members in `auth.users`, with rows pointing at them across the schema. Then
`scripts/db-backup/test-source-extras.sql` adds:

- a probe table of awkward values;
- a column dropped before a commented one, as in production's `circuit_people`;
- a service-only function and column grants;
- the things production has that the 4 Nov baseline doesn't:
  - `supabase_admin`'s default privileges;
  - a realtime publication;
  - two policies on a stand-in `realtime.messages`, one restrictive, for two roles, with
    `WITH CHECK`;
  - a trigger on `auth.users`;
  - pg_cron jobs, one of them unnamed and paused;
  - a role named only in a `FOR ROLE`.

Finally `backup-role.sql` makes the backup's role, and the source is **dumped as that role**. The
test refuses to run with fewer than 25 tables holding rows, or fewer than 20 of the foreign keys
into `auth.users` in use.

**The target is shaped like a fresh Supabase project**, with Supabase's default grants on
`public`. On an empty Postgres the trap below can't spring.

**The procedure** is the weekly job's own, through the same subcommands:

1. Dump, then seal and open with a throwaway age key.
2. Restore, once with a private log and once with the weekly job's public one.
3. Ask the grants and row counts again with `has_*_privilege()` and `count(*)`, which share no
   code with the manifest. The two different questions must give the same answer.
4. Run `after-restore`'s SQL against the copy. The policies, trigger, publication and cron jobs
   must come back identical, every cron command byte for byte.

**Then it breaks the backup on purpose, on every run.** Every check has a fault that must be
refused, for its own reason, or the run is red. The faults cover:

| part             | faults                                                                                                                                                                                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the dump         | as the owner; as the role missing one grant; inside the checkout; with a pg_dump older than the server; with a table's rows left out; from a source with no tables; from a source with no members                                                                          |
| the gate         | half configured; a private key; a whole key file; a malformed recipient; the direct host; a host that isn't the pooler; no project ref; the owner's user; a password with a newline; a certificate that isn't PEM; secrets on a branch                                     |
| the seal         | a private key or key file as the recipient (and neither printed); half a bundle; plaintext or a raw dump as the upload; opening inside the checkout                                                                                                                        |
| the target       | missing the roles the grants name; holding a database-wide default grant; already holding a `finance` schema; already holding tables (for each of the steps that change it); a real project given the stand-ins                                                            |
| the restore      | without its grants (the first version); into the default grants; without the auth ids (the first version's other gap); the same in a public log, which must name the constraint and print no member id; a dump with no `public` schema to leave out                        |
| what is compared | a row, a constraint, a grant, a default privilege, a policy, a sequence, a column default, a trigger, a type, a column comment, a function and a schema grant, each changed after a good restore and each named; and the moved-table skip, which must skip only what moved |

**What it does not prove:**

- **Restoring into a real Supabase project.** The target here is a superuser on plain Postgres
  with stand-ins; on a real project the restore runs as `postgres`, which isn't a superuser.
  - The known differences are handled and named: `supabase_admin`'s default-privilege entries and
    `CREATE SCHEMA public` are left out.
  - `auth.users` rows get the empty tokens GoTrue needs.

  The first real-project restore is still a first.

- **The newer tables.** The 4 Nov baseline has 62 of today's 82 tables. The weekly job's own
  restore covers all 82 every Sunday; this test does not.

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

**What you need:**

- `age` (on Windows: `winget install FiloSottile.age`);
- `bash` and `tar` (Git Bash has both);
- for a restore, the Postgres 17 client;
- the passphrase-protected key.

Note that `age -p`'s passphrase prompt may need `winpty age …` in Git Bash's default terminal.

**Work outside the repository**, in a directory only you can read, and delete it afterwards. A
decrypted bundle is every member's rows. `open` refuses a directory inside a checkout, and
`.gitignore` names every file of a bundle for the day somebody forgets.

```bash
umask 077
WORK="$(mktemp -d)"
gh run download <run-id> -n yaya-db-<run-id>-<attempt> -D "$WORK"
bash scripts/db-backup.sh open "$WORK/yaya-db.tar.age" /path/to/yaya-backup.key.age "$WORK/bundle"
# … whatever you came to do …
rm -rf "$WORK"
```

To check that a key opens an artifact without a checkout at all:
`age -d -i yaya-backup.key.age yaya-db.tar.age | tar -t`.

**Into a real Supabase project.** It must be a new, empty one: every step refuses a target with
tables.

1. Under Database → Extensions, enable these (the first two into schema `extensions`):
   - citext and pgcrypto;
   - pg_cron, pg_net and http.
2. Create the roles the grants name:

   ```sql
   create role yaya_backup nologin;
   ```

   `preflight` lists any that are missing, by name.

3. Point libpq at the new project's Session pooler:
   - `PGHOST`, `PGPORT=5432`, `PGDATABASE=postgres`, `PGUSER=postgres.<ref>`, `PGPASSWORD`;
   - `PGSSLMODE=verify-full`, `PGSSLROOTCERT=<the CA file>`.
4. Run:

   ```bash
   bash scripts/db-backup.sh restore "$WORK/bundle"
   ```

5. Print the SQL that puts back what no dump carries. **Read it, then run it in the SQL editor:**

   ```bash
   bash scripts/db-backup.sh after-restore "$WORK/bundle" > "$WORK/after-restore.sql"
   ```

   It covers:
   - realtime publication membership;
   - the app's policies on `realtime.messages`;
   - any trigger elsewhere that calls a function of ours;
   - pg_cron's jobs, paused ones paused, each command decoded by the database byte for byte.

   A cron command can carry a key, so this belongs at a terminal and never in a workflow.

6. Re-create the Vault secret, and run `backup-role.sql` on the new project before switching the
   weekly backup to it.

**Into a scratch Postgres 17**, to look at a backup or to check one:

```bash
bash scripts/db-backup.sh prepare-plain-target "$WORK/bundle"
bash scripts/db-backup.sh restore "$WORK/bundle"
```

**Bringing members back.** _This is untested._

The ids are restored, so every member's rows still belong to the right id. `load-auth-ids` gives
each row the empty token columns GoTrue needs to read it, because a row with NULL tokens breaks
the user list for the whole project. A row with no email can't sign in, though, and a member who
signs up again gets a new id that owns nothing.

The way back is to give the restored row its owner's email, as `postgres`.
`public.profiles.email` has it for many members:

```sql
update auth.users u
   set email = p.email, email_confirmed_at = now()
  from public.profiles p
 where p.user_id = u.id and p.email is not null and u.email is null;
```

Then each member uses "forgot password" to set a new one. That way they keep their id, and with
it everything they made. A member with no address there has to be asked.

## Turning it on — the walkthrough, 28 Nov

All of these are yours, and none has been done.

1. **A key pair, made offline**, never in CI. The plaintext key should never touch a disk:

   ```bash
   age-keygen | age -p > yaya-backup.key.age   # prints "Public key: age1…"; asks for a passphrase
   ```

   - `yaya-backup.key.age` is the private key under a passphrase.
     `age -d -i yaya-backup.key.age …` asks for the passphrase.
   - Keep **two copies**, in two places that don't sync to the cloud, with the passphrase in your
     password manager.
   - It's the only thing that can read these artifacts. Losing it loses every backup, and on this
     plan there is no other.
   - **If the key or passphrase leaks:**
     1. Delete every `yaya-db-*` artifact (`gh api -X DELETE repos/justanothertree/yaya/actions/artifacts/<id>`).
     2. Make a new pair, and replace `DB_BACKUP_AGE_RECIPIENT`.
     3. Run the workflow.
   - **When rotating on purpose:** keep the old key until the last artifact sealed to it expires
     (90 days).

2. **The backup's role**: paste `scripts/db-backup/backup-role.sql` into the SQL editor and run it
   as `postgres`. Then:

   ```sql
   alter role yaya_backup with password '<long, random>';
   ```

   - **Its last query must show every column true.** A GRANT that can't be given only warns, so
     this proof is the only reliable sign it worked.
   - Delete that query from the editor's history afterwards, since it holds the password.
   - The role can log in, sees every row, can administer nothing, and may write nothing.
   - It reads the member ids through `backup.auth_user_ids()`, a function only it may call.
     `postgres` can't grant access to schema `auth` (measured 26 Nov).
   - Default privileges cover the tables added later.

3. **The environment.** Settings → Environments → `db-backup`. It may already exist, because
   GitHub creates one the first time a run names it, with no rules. Either way:
   - **Deployment branches: selected branches → `main` only.** This, not the workflow's `if:`, is
     what keeps the secrets off other branches.
   - Check it:
     - `gh api repos/justanothertree/yaya/environments/db-backup/deployment-branch-policies --jq '.branch_policies[].name'`
       must print exactly `main`;
     - `gh secret list` (the repository's own) must show no `DB_BACKUP_*`.
4. **Five environment secrets**, in the environment and not the repository:

   | secret                    | value                                                                                                                                                             |
   | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `DB_BACKUP_PGHOST`        | the **Session pooler** host, from the project's Connect panel (`aws-0-<region>.pooler.supabase.com`). The direct host is IPv6-only, and GitHub's runners are not. |
   | `DB_BACKUP_PGUSER`        | `yaya_backup.<project-ref>`. Not the `postgres.<ref>` the Connect panel shows: the gate refuses that one                                                          |
   | `DB_BACKUP_PGPASSWORD`    | the role's password                                                                                                                                               |
   | `DB_BACKUP_AGE_RECIPIENT` | the `age1…` public key from step 1                                                                                                                                |
   | `DB_BACKUP_CA_CERT`       | the contents of the CA certificate from Database Settings → SSL Configuration                                                                                     |

5. **Merge PR #439** (mark it ready first). Run workflow only appears once the workflow is on
   `main`.
6. **Run it by hand:** Actions → **db backup** → Run workflow → `main`. Check for:
   - a green run;
   - the line `the restore matches the source in all … items`;
   - an artifact named `yaya-db-<run id>-1`, not only a green tick.
7. **Open it yourself**, as in **Restoring by hand**, at least as far as `open`. That is the one
   proof that your key reads what CI sealed.
8. **Failure emails.** A scheduled run's failure email goes to whoever last changed the `cron:`
   line, so make sure Actions notifications are on for your account. Remember the two silent
   stops above.

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
