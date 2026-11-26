#!/usr/bin/env bash
# Prove that a backup of this schema, holding member data, restores into a fresh project with its
# rows, its definitions and its grants exactly as they were — and that every check saying so can
# fail.
#
# ⚠️ IT USES NO PRODUCTION DATA AND NEEDS NO SECRET, WHICH IS WHY IT CAN RUN ON EVERY PULL
# REQUEST. The source is built from the repository's own baseline, the seed, and the speed
# tidy-up's fixtures: four members in auth.users and rows that point at them across the schema,
# plus scripts/db-backup/test-source-extras.sql — a probe of awkward values, a dropped column
# before a commented one, and the things production has that the 4 Nov baseline does not. Then
# scripts/db-backup/backup-role.sql, the SAME file Evan runs, makes the backup's role, and the
# source is dumped AS THAT ROLE — sealed and opened with a throwaway age key, and restored, by
# scripts/db-backup.sh: the subcommands the weekly job runs.
#
# ⚠️ THE TARGET IS SHAPED LIKE A FRESH SUPABASE PROJECT, NOT LIKE AN EMPTY POSTGRES. That is the
# difference that matters: a real project's default privileges grant every new object in public
# to anon and members, and a restore into one creates every object. Restored into a bare server
# that trap cannot spring, and the restore would pass while a real one opened every deny-all
# table.
#
# AND THEN IT BREAKS THINGS, ON EVERY RUN. A check that has never been seen to fail is a check
# reporting that it ran. Every check the scripts make has a fault here that must be REFUSED, for
# its own reason, or the run is red — the dump's role and content, the client, the gate, the
# seal, the target, every step of the restore, every kind of thing verify compares, the moved-
# table skip, and the public log's silence.
#
# Run it against two throwaway Postgres 17 servers (CI starts them as service containers):
#   SOURCE_PORT=55441 TARGET_PORT=55442 PGPASSWORD=postgres bash scripts/restore-test.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT"
BK="$ROOT/scripts/db-backup.sh"

if [ -z "${PG_BIN:-}" ] && [ -x /usr/lib/postgresql/17/bin/psql ]; then
  export PG_BIN=/usr/lib/postgresql/17/bin
fi
PSQL="${PG_BIN:+$PG_BIN/}psql"
PGRESTORE="${PG_BIN:+$PG_BIN/}pg_restore"
PGDUMP="${PG_BIN:+$PG_BIN/}pg_dump"

export PGHOST="${RESTORE_TEST_HOST:-127.0.0.1}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
export PGSSLMODE=disable
SRC_PORT="${SOURCE_PORT:?SOURCE_PORT is required}"
DST_PORT="${TARGET_PORT:?TARGET_PORT is required}"
# ⚠️ throwaway servers on this machine only: this script creates and drops databases
case "$PGHOST" in 127.0.0.1 | localhost) ;; *) echo "refusing: $PGHOST is not this machine" >&2 && exit 2 ;; esac
BACKUP_PASSWORD=restore-test-only

say() { echo "=== $*"; }
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
failures=()
fail() {
  echo "!!! $*" >&2
  failures+=("$*")
}

src() { PGPORT="$SRC_PORT" PGDATABASE=postgres "$@"; }
# as the backup's own role, the way the weekly job connects
as_backup() {
  local db="$1"
  shift
  PGPORT="$SRC_PORT" PGDATABASE="$db" PGUSER=yaya_backup PGPASSWORD="$BACKUP_PASSWORD" "$@"
}
dst() {
  local db="$1"
  shift
  PGPORT="$DST_PORT" PGDATABASE="$db" "$@"
}
sq() { src "$PSQL" -X -q -v ON_ERROR_STOP=1 "$@"; }
sqd() {
  local db="$1"
  shift
  PGPORT="$SRC_PORT" PGDATABASE="$db" "$PSQL" -X -q -v ON_ERROR_STOP=1 "$@"
}
dq() {
  local db="$1"
  shift
  dst "$db" "$PSQL" -X -q -v ON_ERROR_STOP=1 "$@"
}

refused() {
  # refused NAME PATTERN -- command...   the command must FAIL, and say PATTERN while doing it
  local name="$1" pattern="$2"
  shift 3
  if "$@" >"$WORK/fault.log" 2>&1; then
    fail "fault '$name' was NOT refused"
  elif ! grep -qP "$pattern" "$WORK/fault.log"; then
    fail "fault '$name' failed, but not for the reason it is there for (no /$pattern/):"
    sed 's/^/      /' "$WORK/fault.log" | tail -8 >&2
  else
    echo "    refused, as it must be: $name"
  fi
}

# ── the source ─────────────────────────────────────────────────────────────────────────────────
say "building the source: the baseline, the seed, the fixtures and the probe"
# the same files, in the same order, as [db.seed] sql_paths in supabase/config.toml, on the
# stand-in for the platform a plain server lacks
sq -f supabase/tests/plain-postgres/00-platform.sql
sq -f supabase/baseline/00-privileges.sql
sq -f supabase/baseline/01-extensions.sql
sq -f supabase/migrations/00000000000000_baseline.sql
sq -f supabase/baseline/02-triggers.sql
sq -f supabase/seed.sql >/dev/null
# the fixtures were written against this migration, exactly as db-guards loads them
sq -1 -f supabase/migrations/20261122234003_circuit_creator_staple.sql
sq -f supabase/tests/db-speed-tidy-fixtures.sql >/dev/null
sq -f scripts/db-backup/test-source-extras.sql

say "making the backup's role from the file the walkthrough uses"
proof="$(sq -At -f scripts/db-backup/backup-role.sql | tail -1)"
sq -c "alter role yaya_backup with password '$BACKUP_PASSWORD'"
echo "    the role file's own proof: $proof"
[ "$proof" = "t|t|t|t|t|t|t|t" ] || fail "backup-role.sql's proof is not all true: $proof"

# ⚠️ A FLOOR UNDER THE DATA, said as numbers. A restore of an empty database restores perfectly,
# and so does one whose only member rows point at nobody.
sq <<'SQL'
do $$
declare
  t regclass;
  k record;
  n bigint;
  with_rows int := 0;
  tables int := 0;
  fks_used int := 0;
  fks int := 0;
begin
  for t in select c.oid from pg_class c join pg_namespace s on s.oid = c.relnamespace
            where s.nspname in ('public', 'finance') and c.relkind = 'r' loop
    tables := tables + 1;
    execute format('select count(*) from %s', t) into n;
    if n > 0 then with_rows := with_rows + 1; end if;
  end loop;
  for k in select c.conrelid::regclass as tbl, a.attname
             from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
            where c.contype = 'f' and c.confrelid = 'auth.users'::regclass loop
    fks := fks + 1;
    execute format('select count(*) from %s where %I is not null', k.tbl, k.attname) into n;
    if n > 0 then fks_used := fks_used + 1; end if;
  end loop;
  raise notice 'restore test source: % of % tables hold rows; % of % foreign keys into auth.users are used',
    with_rows, tables, fks_used, fks;
  if with_rows < 25 or fks_used < 20 then
    raise exception 'the source is too thin to prove a restore: % tables with rows, % auth foreign keys used', with_rows, fks_used;
  end if;
end $$;
SQL

# ── back it up, seal it, open it ───────────────────────────────────────────────────────────────
say "backing up the source as the backup's own role, with the weekly job's own steps"
as_backup postgres bash "$BK" dump "$WORK/bundle"
[ ! -s "$WORK/bundle/moved.txt" ] || fail "nothing writes to the source, yet these moved during the dump: $(tr '\n' ' ' <"$WORK/bundle/moved.txt")"
kinds="$(cut -f1 "$WORK/bundle/extras.tsv" | sort | uniq -c | awk '{ printf "%s=%s ", $2, $1 }')"
echo "    kept beside the dump: $kinds"
[ "$kinds" = "cron=2 policy=2 publication=2 trigger=1 " ] || fail "extras.tsv did not capture 2 cron jobs, 2 policies, 2 publication entries and 1 trigger: $kinds"
[ "$(grep -c . "$WORK/bundle/auth-user-ids.txt")" = 4 ] || fail "the bundle does not carry the source's four member ids"

age-keygen -o "$WORK/throwaway.key" 2>/dev/null
RECIPIENT="$(age-keygen -y "$WORK/throwaway.key")"
bash "$BK" seal "$WORK/bundle" "$RECIPIENT" "$WORK/yaya-db.tar.age"
bash "$BK" open "$WORK/yaya-db.tar.age" "$WORK/throwaway.key" "$WORK/opened"
diff -r "$WORK/bundle" "$WORK/opened" >/dev/null || fail "the bundle that came out of the ciphertext is not the one that went in"
# a copy for each run that writes into its bundle (the public log keeps its errors there)
copy_bundle() {
  rm -rf "$WORK/$1"
  cp -r "$WORK/opened" "$WORK/$1"
}

# ── the dump's own refusals ────────────────────────────────────────────────────────────────────
say "breaking the dump on purpose"
refused "a dump as the owner, not the backup's role" 'read-only role, and this one is: superuser' -- src bash "$BK" dump "$WORK/as-owner"
sq -c "revoke execute on function backup.auth_user_ids() from yaya_backup"
refused "a backup role missing one of its grants" 'permission denied for function auth_user_ids' -- as_backup postgres bash "$BK" dump "$WORK/no-grant"
sq -c "grant execute on function backup.auth_user_ids() to yaya_backup"
refused "a dump into a directory inside the checkout" 'inside a git checkout' -- as_backup postgres bash "$BK" dump "$ROOT/.restore-test-bundle"
rmdir "$ROOT/.restore-test-bundle" 2>/dev/null || true

# pg_dump stand-ins, to make the client and content checks speak: one that says it is too old,
# one that leaves a table's rows out
real_bin="${PG_BIN:-$(dirname "$(command -v pg_dump)")}"
for fake in old-client no-data; do
  mkdir -p "$WORK/$fake"
  ln -sf "$real_bin/psql" "$WORK/$fake/psql"
  ln -sf "$real_bin/pg_restore" "$WORK/$fake/pg_restore"
done
printf '#!/usr/bin/env bash\n[ "${1:-}" = --version ] && { echo "pg_dump (PostgreSQL) 16.4"; exit 0; }\nexec "%s/pg_dump" "$@"\n' "$real_bin" >"$WORK/old-client/pg_dump"
printf '#!/usr/bin/env bash\n[ "${1:-}" = --version ] && exec "%s/pg_dump" --version\nexec "%s/pg_dump" --exclude-table-data=public.zz_restore_probe "$@"\n' "$real_bin" "$real_bin" >"$WORK/no-data/pg_dump"
chmod +x "$WORK/old-client/pg_dump" "$WORK/no-data/pg_dump"
refused "a pg_dump older than the server" 'pg_dump 16 cannot dump a Postgres 17 server' -- as_backup postgres env PG_BIN="$WORK/old-client" bash "$BK" dump "$WORK/old"
refused "a dump missing a table's rows" 'the dump carries data for [0-9]+ tables and the source has [0-9]+' -- as_backup postgres env PG_BIN="$WORK/no-data" bash "$BK" dump "$WORK/short"

# two thin sources on the same server: one with no tables at all, one with no members
sq -c "drop database if exists thin_empty with (force)" -c "create database thin_empty"
refused "a source with no tables" 'names no tables' -- as_backup thin_empty bash "$BK" dump "$WORK/thin-empty"
sq -c "drop database if exists thin_noids with (force)" -c "create database thin_noids"
sqd thin_noids -f supabase/tests/plain-postgres/00-platform.sql
sqd thin_noids -c "create schema finance" -c "create table public.t (id int primary key)" -c "insert into public.t values (1)"
sqd thin_noids -f scripts/db-backup/backup-role.sql >/dev/null
refused "a source with no member ids" 'no auth user ids were read' -- as_backup thin_noids bash "$BK" dump "$WORK/thin-noids"

# ── the gate, with made-up values: none of these connects to anything ──────────────────────────
say "breaking the gate on purpose"
gate() { env -i PATH="$PATH" GITHUB_OUTPUT="$WORK/gate.out" "$@" bash "$BK" gate; }
good=(DB_BACKUP_PGHOST=aws-0-us-east-1.pooler.supabase.com DB_BACKUP_PGUSER=yaya_backup.abcdefghijklmnopqrst
  DB_BACKUP_PGPASSWORD=not-a-real-password "DB_BACKUP_AGE_RECIPIENT=$RECIPIENT"
  "DB_BACKUP_CA_CERT=-----BEGIN CERTIFICATE-----")
SECRET="$(grep -m1 '^AGE-SECRET-KEY-' "$WORK/throwaway.key")"
KEYFILE="$(cat "$WORK/throwaway.key")"
: >"$WORK/gate.out"
gate >/dev/null && grep -q '^ready=no$' "$WORK/gate.out" || fail "the gate did not stand down quietly with nothing set"
: >"$WORK/gate.out"
gate "${good[@]}" >/dev/null && grep -q '^ready=yes$' "$WORK/gate.out" || fail "the gate refused a complete, well-formed setup"
refused "the gate, half configured" 'Missing: DB_BACKUP_PGPASSWORD' -- gate "${good[@]:0:2}" "${good[@]:3}"
refused "the gate, given a private key" 'PRIVATE key' -- gate "${good[@]:0:3}" "DB_BACKUP_AGE_RECIPIENT=$SECRET" "${good[@]:4}"
grep -qF "$SECRET" "$WORK/fault.log" && fail "the gate printed the private key it refused"
refused "the gate, given the whole key file" 'PRIVATE key' -- gate "${good[@]:0:3}" "DB_BACKUP_AGE_RECIPIENT=$KEYFILE" "${good[@]:4}"
grep -qF "$SECRET" "$WORK/fault.log" && fail "the gate printed the key file it refused"
refused "the gate, given a malformed recipient" 'not an age public key' -- gate "${good[@]:0:3}" DB_BACKUP_AGE_RECIPIENT=age1short "${good[@]:4}"
refused "the gate, given the direct IPv6-only host" 'IPv6-only' -- gate DB_BACKUP_PGHOST=db.abcdefghijklmnopqrst.supabase.co "${good[@]:1}"
refused "the gate, given a host that is not Supabase's pooler" 'not a Supabase pooler host' -- gate DB_BACKUP_PGHOST=db.example.com "${good[@]:1}"
refused "the gate, given a pooler user with no project ref" 'project_ref' -- gate "${good[0]}" DB_BACKUP_PGUSER=yaya_backup "${good[@]:2}"
refused "the gate, given the owner's user" "owner role" -- gate "${good[0]}" DB_BACKUP_PGUSER=postgres.abcdefghijklmnopqrst "${good[@]:2}"
refused "the gate, given a password with a newline on the end" 'DB_BACKUP_PGPASSWORD has surrounding whitespace' -- gate "${good[@]:0:2}" "DB_BACKUP_PGPASSWORD=not-a-real-password
" "${good[@]:3}"
refused "the gate, given a certificate that is not PEM" 'not a PEM certificate' -- gate "${good[@]:0:4}" "DB_BACKUP_CA_CERT=MIIB-not-pem"
refused "the gate, holding its secrets on a branch" 'reached a run on refs/heads/feature' -- gate GITHUB_ACTIONS=true GITHUB_REF=refs/heads/feature "${good[@]}"

# ── the seal ───────────────────────────────────────────────────────────────────────────────────
say "breaking the seal on purpose"
refused "a private key where the recipient belongs" 'PRIVATE key' -- bash "$BK" seal "$WORK/bundle" "$SECRET" "$WORK/never.age"
grep -qF "$SECRET" "$WORK/fault.log" && fail "the private key was printed while it was refused"
refused "the whole key file where the recipient belongs" 'PRIVATE key' -- bash "$BK" seal "$WORK/bundle" "$KEYFILE" "$WORK/never.age"
grep -qF "$SECRET" "$WORK/fault.log" && fail "the key file was printed while it was refused"
mkdir -p "$WORK/half-bundle" && cp "$WORK/bundle/yaya.dump" "$WORK/half-bundle/"
refused "half a bundle presented for sealing" 'is not a whole bundle' -- bash "$BK" seal "$WORK/half-bundle" "$RECIPIENT" "$WORK/never.age"
[ ! -e "$WORK/never.age" ] || fail "a refused seal left a file behind for an upload step to find"
tar -C "$WORK/bundle" -cf "$WORK/plain.tar" .
refused "a plaintext tar presented as the upload" 'not ciphertext' -- bash "$BK" check-ciphertext "$WORK/plain.tar"
refused "a raw dump presented as the upload" 'not ciphertext' -- bash "$BK" check-ciphertext "$WORK/bundle/yaya.dump"
refused "a bundle opened inside the checkout" 'inside a git checkout' -- bash "$BK" open "$WORK/yaya-db.tar.age" "$WORK/throwaway.key" "$ROOT/.restore-test-opened"
rmdir "$ROOT/.restore-test-opened" 2>/dev/null || true

# a target shaped like a fresh Supabase project: the stand-ins, and Supabase's default grants;
# given the bundle, also every role its grants name
fresh_project() {
  local db="$1" bundle="${2:-}"
  dq postgres -c "drop database if exists $db with (force)" -c "create database $db"
  dst "$db" bash "$BK" prepare-plain-target ${bundle:+"$bundle"} >/dev/null
  dq "$db" -c "alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role" \
    -c "alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role" \
    -c "alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role"
}

# ⚠️ FIRST, BECAUSE ROLES BELONG TO THE SERVER AND NOT TO A DATABASE: once any database here has
# been given the bundle's roles, every database has them. The source grants SELECT on every table
# to yaya_backup, as production will once the backup's role exists, and names zz_restore_owner
# only in a default-privilege line's FOR ROLE; a target without them must be told so by name.
say "a target without the roles the grants name"
fresh_project no_roles
refused "a target missing roles the bundle grants to" 'roles this target does not have: .*yaya_backup.*zz_restore_owner' -- dst no_roles bash "$BK" preflight "$WORK/opened"

# ── the restore, done right ────────────────────────────────────────────────────────────────────
say "restoring into a fresh project"
fresh_project restored "$WORK/opened"
DB_BACKUP_SHOW_DIFF=1 dst restored bash "$BK" restore "$WORK/opened" | tee "$WORK/restore.log" || fail "the restore itself failed"
grep -q 'left out CREATE SCHEMA public and 3 supabase_admin default-privilege entries' "$WORK/restore.log" ||
  fail "the restore did not leave out exactly the three supabase_admin default-privilege entries the source has"
grep -q 'kept beside it: 2 realtime publication entries, 2 policies on Supabase.s own tables, 1 triggers elsewhere, 2 cron jobs' "$WORK/restore.log" ||
  fail "the restore did not count what the bundle keeps beside the dump"
grep -q 'alter publication' "$WORK/restore.log" && fail "the restore printed after-restore's statements into its own log"

# ⚠️ AND RESTORED BY A ROLE THAT IS NOT `postgres`, as a scratch Postgres from Homebrew or
# Postgres.app would be (its superuser is named after whoever installed it). Everything restored
# with --no-owner belongs to that role, so a manifest that compared the owner by name would fail a
# perfect restore hundreds of times over; the owner is compared as OWNER, whoever it is.
# (A plain scratch target, as that server would be — not a fresh Supabase project, whose default
# grants belong to postgres, the role a real project's restore always runs as.)
say "restoring as a superuser that is not postgres, into a plain scratch server"
dq postgres -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname = 'zz_restorer') then create role zz_restorer superuser login password 'restore-test-only'; end if; end \$\$"
dq postgres -c "drop database if exists restored_other with (force)" -c "create database restored_other"
dst restored_other bash "$BK" prepare-plain-target "$WORK/opened" >/dev/null
PGUSER=zz_restorer PGPASSWORD=restore-test-only dst restored_other bash "$BK" restore "$WORK/opened" >"$WORK/other.log" 2>&1 || {
  sed 's/^/      /' "$WORK/other.log" | tail -12 >&2
  fail "a restore run by a role other than postgres did not match its source"
}

# ⚠️ AND THE SAME RESTORE WITH THE WEEKLY JOB'S PUBLIC LOG: no count of anything, and it still
# succeeds. (The moved-table checks below reuse this copy.)
say "restoring again, as the weekly job's public log does"
copy_bundle public-bundle
fresh_project restored_public "$WORK/public-bundle"
DB_BACKUP_PUBLIC_LOG=1 dst restored_public bash "$BK" restore "$WORK/public-bundle" >"$WORK/public.log" 2>&1 || {
  cat "$WORK/public.log" >&2
  fail "the restore with a public log failed"
}
grep -qE '[0-9]+ (auth user ids|member ids|bytes)' "$WORK/public.log" && fail "the public log printed a count: $(grep -E '[0-9]+ (auth user ids|member ids|bytes)' "$WORK/public.log")"
grep -q 'member ids loaded' "$WORK/public.log" || fail "the public log did not say the member ids were loaded"

# ⚠️ AND AGAIN THROUGH A PATH THAT SHARES NO CODE WITH THE MANIFEST. verify compares aclexplode()
# text; this asks has_*_privilege() of every table, sequence, function and schema, for every API
# role and PUBLIC, and counts rows with plain count(*). If both agree, two different questions got
# the same answer.
read -r -d '' ASK <<'SQL' || true
select md5(string_agg(line, E'\n' order by line collate "C")), count(*),
       count(*) filter (where line like 'f|%|anon|true'), count(*) filter (where line like 'r|%|anon|TRUNCATE|true')
  from (
    select 'r|' || c.oid::regclass || '|' || r || '|' || p || '|' || has_table_privilege(r, c.oid, p) as line
      from pg_class c join pg_namespace n on n.oid = c.relnamespace,
           unnest(array['anon', 'authenticated', 'service_role', 'public']) r,
           unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
     where n.nspname in ('public', 'finance') and c.relkind in ('r', 'v')
    union all
    select 's|' || c.oid::regclass || '|' || r || '|' || p || '|' || has_sequence_privilege(r, c.oid, p)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace,
           unnest(array['anon', 'authenticated', 'service_role', 'public']) r, unnest(array['USAGE', 'SELECT', 'UPDATE']) p
     where n.nspname in ('public', 'finance') and c.relkind = 'S'
    union all
    select 'f|' || p.oid::regprocedure || '|' || r || '|' || has_function_privilege(r, p.oid, 'EXECUTE')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
           unnest(array['anon', 'authenticated', 'service_role', 'public']) r
     where n.nspname in ('public', 'finance')
    union all
    select 'n|' || n.nspname || '|' || r || '|' || p || '|' || has_schema_privilege(r, n.oid, p)
      from pg_namespace n, unnest(array['anon', 'authenticated', 'service_role', 'public']) r, unnest(array['USAGE', 'CREATE']) p
     where n.nspname in ('public', 'finance')
    union all
    select 'rows|' || c.oid::regclass || '|' ||
           (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %s', c.oid::regclass), false, true, '')))[1]::text
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public', 'finance') and c.relkind = 'r'
  ) answers
SQL
asked_src="$(src "$PSQL" -X -At -c "$ASK")"
asked_dst="$(dst restored "$PSQL" -X -At -c "$ASK")"
echo "    privileges and row counts, asked directly: source $asked_src"
echo "                                               restored $asked_dst"
[ "$asked_src" = "$asked_dst" ] || fail "asked directly, the restore's privileges or row counts differ from the source's"
[ "$(dst restored "$PSQL" -X -At -c "select has_function_privilege('anon', 'public.zz_restore_probe_count()', 'execute')")" = f ] ||
  fail "anon can call a service-only function after the restore"
[ "$(dst restored "$PSQL" -X -At -c "select has_table_privilege('anon', 'public.profile_blocks', 'TRUNCATE')")" = f ] ||
  fail "anon can TRUNCATE a deny-all table after the restore"
ids_file="$(grep -c . "$WORK/opened/auth-user-ids.txt")"
ids_db="$(dst restored "$PSQL" -X -At -c 'select count(*) from auth.users')"
[ "$ids_file" = "$ids_db" ] || fail "auth.users holds $ids_db ids after the restore and the bundle carries $ids_file"

# ── what no dump carries, put back ─────────────────────────────────────────────────────────────
# after-restore's SQL is RUN against the restored target here, with stand-ins for Realtime's table
# and pg_cron's functions, and the result is compared with the source in full: each policy's name,
# command, kind, roles, USING and WITH CHECK; the trigger; the publication's tables; and each cron
# job's name, schedule, command (md5, byte for byte) and whether it is paused. The source's second
# policy, its unnamed paused job and its command ending in a newline are there for exactly this.
say "putting back what no dump carries"
bash "$BK" after-restore "$WORK/opened" >"$WORK/after.sql"
dq restored <<'SQL'
create schema if not exists realtime;
create table realtime.messages (id bigserial primary key, topic text not null, private boolean not null default true);
alter table realtime.messages enable row level security;
create publication supabase_realtime;
create table cron.job (jobid bigserial primary key, schedule text not null, command text not null, jobname text,
                       active boolean not null default true);
create function cron.schedule(job_name text, schedule text, command text) returns bigint
language sql as $$ insert into cron.job (jobname, schedule, command) values ($1, $2, $3) returning jobid $$;
create function cron.schedule(schedule text, command text) returns bigint
language sql as $$ insert into cron.job (schedule, command) values ($1, $2) returning jobid $$;
create function cron.alter_job(job_id bigint, schedule text default null, command text default null,
                               database text default null, username text default null, active boolean default null)
returns void language sql as $$ update cron.job set active = coalesce($6, active) where jobid = $1 $$;
SQL
dq restored -1 -f "$WORK/after.sql" >/dev/null || fail "after-restore's SQL did not run"
read -r -d '' ELSEWHERE <<'SQL' || true
select count(*) || '|' || md5(string_agg(x, E'\n' order by x collate "C")) from (
  select concat_ws('|', 'policy', polname, polcmd::text, polpermissive::text,
                   (select string_agg(case when r = 0 then 'public' else pg_get_userbyid(r)::text end, ',' order by case when r = 0 then 'public' else pg_get_userbyid(r)::text end)
                      from unnest(polroles) r),
                   coalesce(pg_get_expr(polqual, polrelid), '-'), coalesce(pg_get_expr(polwithcheck, polrelid), '-'))
    from pg_policy where polrelid = 'realtime.messages'::regclass
  union all
  select 'trigger|' || pg_get_triggerdef(oid) from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal
  union all
  select 'publication|' || pubname || '|' || schemaname || '.' || tablename from pg_publication_tables
  union all
  select concat_ws('|', 'cron', coalesce(jobname, '-'), schedule, md5(command), active::text) from cron.job) s(x)
SQL
put_back_src="$(src "$PSQL" -X -At -c "$ELSEWHERE")"
put_back_dst="$(dst restored "$PSQL" -X -At -c "$ELSEWHERE")"
echo "    what no dump carries, source $put_back_src, restored $put_back_dst"
if [ "$put_back_src" != "$put_back_dst" ]; then
  fail "after-restore did not put back exactly what the source had"
  # the rows themselves, which are the test's own invented ones: say which thing differs
  ROWS="select x from (${ELSEWHERE#*from (}"
  ROWS="${ROWS%) s(x)*}) s(x) order by 1"
  diff <(src "$PSQL" -X -At -c "$ROWS") <(dst restored "$PSQL" -X -At -c "$ROWS") | sed 's/^/      /' >&2 || true
fi
[ "${put_back_src%%|*}" = 7 ] || fail "expected 2 policies, a trigger, 2 publication entries and 2 cron jobs, found ${put_back_src%%|*}"

# ── the restores that must fail ────────────────────────────────────────────────────────────────
say "breaking the restore on purpose"

fresh_project no_grants
dst no_grants bash "$BK" preflight >/dev/null
dst no_grants bash "$BK" neutralise-defaults >/dev/null
dst no_grants bash "$BK" load-auth-ids "$WORK/opened" >/dev/null
"$PGRESTORE" --list "$WORK/opened/yaya.dump" |
  grep -vE '^[0-9]+; [0-9]+ [0-9]+ SCHEMA - public ' |
  grep -vE ' DEFAULT ACL [^ ]+ DEFAULT PRIVILEGES FOR [A-Z ]+ supabase_admin$' >"$WORK/toc.keep"
dst no_grants "$PGRESTORE" --dbname=no_grants --no-owner --no-privileges --exit-on-error \
  --single-transaction --use-list="$WORK/toc.keep" "$WORK/opened/yaya.dump"
refused "restored with --no-privileges" 'catalog\t(relation|function)\tpublic\.zz_restore_probe' -- dst no_grants bash "$BK" verify "$WORK/opened"
grep -qP 'catalog\tdefault-acl\t' "$WORK/fault.log" || fail "a restore without its grants did not show its default privileges missing"
# and the independent question has to see it too, or it is not so much independent as idle
nogrants="$(dst no_grants "$PSQL" -X -At -c "$ASK")"
[ "$nogrants" != "$asked_src" ] || fail "asked directly, a restore without its grants looks the same as the source"
echo "    asked directly, the restore without its grants: $nogrants"

fresh_project kept_defaults
dst kept_defaults bash "$BK" preflight >/dev/null
dst kept_defaults bash "$BK" load-auth-ids "$WORK/opened" >/dev/null
dst kept_defaults bash "$BK" pg-restore "$WORK/opened" >/dev/null
refused "restored into a project's default grants" 'catalog\trelation\tpublic\.zz_restore_probe|catalog\tfunction\tpublic\.zz_restore_probe_count' -- dst kept_defaults bash "$BK" verify "$WORK/opened"
kept="$(dst kept_defaults "$PSQL" -X -At -c "$ASK")"
[ "$kept" != "$asked_src" ] || fail "asked directly, a restore into the default grants looks the same as the source"
echo "    asked directly, the restore into the default grants: $kept"

fresh_project no_ids
dst no_ids bash "$BK" preflight >/dev/null
dst no_ids bash "$BK" neutralise-defaults >/dev/null
refused "restored without the auth ids" 'violates foreign key constraint' -- dst no_ids bash "$BK" pg-restore "$WORK/opened"

# ⚠️ the same failure with the weekly job's public log: it must name the object, keep the
# database's message (which quotes a member's id) inside the bundle, and print no id at all
fresh_project no_ids_public
dst no_ids_public bash "$BK" preflight >/dev/null
dst no_ids_public bash "$BK" neutralise-defaults >/dev/null
copy_bundle quiet-bundle
refused "restored without the auth ids, in a public log" 'failed at: ALTER TABLE ONLY [^ ]+ ADD CONSTRAINT [^ ]+ FOREIGN KEY.*restore-errors.txt' -- dst no_ids_public env DB_BACKUP_PUBLIC_LOG=1 bash "$BK" pg-restore "$WORK/quiet-bundle"
while read -r id; do
  grep -qF "$id" "$WORK/fault.log" && fail "the public log printed a member id: the database's own message got through"
done <"$WORK/opened/auth-user-ids.txt"
grep -q 'DETAIL' "$WORK/fault.log" && fail "the public log printed the database's DETAIL line"
grep -q 'is not present in table' "$WORK/quiet-bundle/restore-errors.txt" 2>/dev/null ||
  fail "the database's own message was not kept in restore-errors.txt inside the bundle"

fresh_project global_default
dq global_default -c "alter default privileges for role postgres grant select on tables to anon"
refused "a target with a database-wide default grant" 'remain in public, finance or database-wide' -- dst global_default bash "$BK" neutralise-defaults

fresh_project finance_already
dq finance_already -c "create schema finance"
refused "a target that already has a finance schema" 'already has a finance schema' -- dst finance_already bash "$BK" preflight

mkdir -p "$WORK/finance-only"
src "$PGDUMP" --schema=finance --no-owner --format=custom --file="$WORK/finance-only/yaya.dump"
fresh_project finance_only
refused "a dump with no CREATE SCHEMA public to leave out" 'expected exactly 1 CREATE SCHEMA public entry, found 0' -- dst finance_only bash "$BK" pg-restore "$WORK/finance-only"

refused "a restore aimed at a database that already has tables" 'already has [0-9]+ tables' -- dst restored bash "$BK" preflight
refused "neutralise-defaults aimed at a database that already has tables" 'already has [0-9]+ tables' -- dst restored bash "$BK" neutralise-defaults
refused "load-auth-ids aimed at a database that already has tables" 'already has [0-9]+ tables' -- dst restored bash "$BK" load-auth-ids "$WORK/opened"

dq postgres -c "drop database if exists real_project with (force)" -c "create database real_project"
dq real_project -c "create schema auth" -c "create table auth.users (id uuid primary key, is_sso_user boolean not null default false)"
refused "stand-ins loaded into a real project" 'real project' -- dst real_project bash "$BK" prepare-plain-target

# ── the moved-table skip, made to speak both ways ──────────────────────────────────────────────
# A table named in moved.txt has its rows left uncompared — and ONLY its rows: a change to it is
# allowed, and a change anywhere else is still caught. (On production this path runs most Sundays.)
say "the moved-table skip"
dq restored_public -c "delete from public.zz_restore_probe where note = 'the far future'"
refused "a row missing, with nothing moved" 'rows\ttable\tpublic\.zz_restore_probe' -- dst restored_public bash "$BK" verify "$WORK/public-bundle"
copy_bundle moved-bundle
echo 'public.zz_restore_probe' >"$WORK/moved-bundle/moved.txt"
dst restored_public bash "$BK" verify "$WORK/moved-bundle" >"$WORK/moved.log" 2>&1 || {
  cat "$WORK/moved.log" >&2
  fail "a row missing from a table that moved during the dump was still counted against the restore"
}
grep -q '(1 moved during the dump, their rows not compared)' "$WORK/moved.log" || fail "verify did not say one table's rows were not compared"
dq restored_public -c "delete from public.circuit_log_reactions where ctid in (select ctid from public.circuit_log_reactions limit 1)"
refused "a row missing from a table that did not move" 'rows\ttable\tpublic\.circuit_log_reactions' -- dst restored_public bash "$BK" verify "$WORK/moved-bundle"
grep -q 'zz_restore_probe' "$WORK/fault.log" && fail "the moved table was compared after all"

# ── every kind of thing verify compares, changed one at a time ─────────────────────────────────
say "changing the restore, one kind of thing at a time"
changed() {
  # changed NAME PATTERN SQL   — make the change on the good restore, and verify must name it
  dq restored -c "$3" >/dev/null
  refused "$1" "$2" -- dst restored bash "$BK" verify "$WORK/opened"
}
changed "a row missing" 'rows\ttable\tpublic\.zz_restore_probe' "delete from public.zz_restore_probe where note = 'the far future'"
changed "a constraint missing" 'catalog\tconstraints\tpublic\.zz_restore_probe' "alter table public.zz_restore_probe drop constraint zz_restore_probe_note_check"
changed "a grant widened" 'catalog\trelation\tpublic\.profile_blocks' "grant select on public.profile_blocks to anon"
changed "a default privilege widened" 'catalog\tdefault-acl\tpostgres:finance:r' "alter default privileges for role postgres in schema finance grant select on tables to anon"
changed "a policy missing" 'catalog\tpolicies\tpublic\.zz_restore_probe' "drop policy zz_restore_probe_own on public.zz_restore_probe"
changed "a sequence moved" 'rows\tsequence\tpublic\.zz_restore_probe_id_seq' "select setval('public.zz_restore_probe_id_seq', 999)"
changed "a column default changed" 'catalog\tcolumns\tpublic\.zz_restore_probe' "alter table public.zz_restore_probe alter column note set default 'changed'"
changed "a trigger added" 'catalog\ttriggers\tpublic\.zz_restore_probe' "create trigger zz_extra before update on public.zz_restore_probe for each row execute function public.zz_restore_probe_noticed()"
changed "a type changed" 'catalog\ttype\tpublic\.visibility_tier' "alter type public.visibility_tier add value 'zz_new'"
changed "a column comment changed" 'catalog\tcomment\tpublic\.zz_restore_probe\.note' "comment on column public.zz_restore_probe.note is 'changed'"
changed "a function changed" 'catalog\tfunction\tpublic\.zz_restore_probe_count\(\)' "create or replace function public.zz_restore_probe_count() returns bigint language sql security definer set search_path = '' as 'select 0::bigint'"
changed "a schema grant widened" 'catalog\tschema\tpublic' "grant create on schema public to anon"

if [ ${#failures[@]} -gt 0 ]; then
  say "FAILED: ${#failures[@]} problem(s)"
  printf '  - %s\n' "${failures[@]}" >&2
  exit 1
fi
say "restore verified: rows, definitions and grants, with member data and its auth ids; and every fault refused"
