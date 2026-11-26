#!/usr/bin/env bash
# Prove that a backup of this schema, holding member data, restores into a fresh project with its
# rows, its definitions and its grants exactly as they were — and that every check saying so can
# fail.
#
# ⚠️ IT USES NO PRODUCTION DATA AND NEEDS NO SECRET, WHICH IS WHY IT CAN RUN ON EVERY PULL
# REQUEST. The source is built from the repository's own baseline, the seed, and the speed
# tidy-up's fixtures: four members in auth.users and rows that point at them in 25 tables, plus a
# probe table of awkward values (scripts/db-backup/test-source-extras.sql). It is backed up,
# sealed and opened with a throwaway age key, and restored, by scripts/db-backup.sh — the SAME
# subcommands the weekly job runs, so a step that works here is the step that runs on Sunday.
#
# ⚠️ THE TARGET IS SHAPED LIKE A FRESH SUPABASE PROJECT, NOT LIKE AN EMPTY POSTGRES. That is the
# difference that matters: a real project's default privileges grant every new object in public
# to anon and members, and a restore into one creates every object. Restored into a bare server
# that trap cannot spring, and the restore would pass while a real one opened every deny-all
# table.
#
# AND THEN IT BREAKS THINGS, ON EVERY RUN. A check that has never been seen to fail is a check
# reporting that it ran. Each fault below is a way this backup has gone wrong or could, and each
# must be REFUSED, or the run is red:
#   - restored without its grants (the first version's --no-privileges)
#   - restored into a project's default grants without turning them off first
#   - restored without the auth ids the member rows point at (the first version's other gap)
#   - a row missing, a constraint missing, a grant widened, after a good restore
#   - a restore aimed at a database that already holds tables (the guard against production)
#   - an age private key where the recipient belongs, refused without being printed
#   - a plaintext bundle presented for upload
#   - the weekly gate: nothing set, some set, a direct host, a pooler user with no project ref
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

export PGHOST="${RESTORE_TEST_HOST:-127.0.0.1}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
export PGSSLMODE=disable
SRC_PORT="${SOURCE_PORT:?SOURCE_PORT is required}"
DST_PORT="${TARGET_PORT:?TARGET_PORT is required}"
# ⚠️ throwaway servers on this machine only: this script creates and drops databases
case "$PGHOST" in 127.0.0.1 | localhost) ;; *) echo "refusing: $PGHOST is not this machine" >&2 && exit 2 ;; esac

say() { echo "=== $*"; }
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
failures=()
fail() {
  echo "!!! $*" >&2
  failures+=("$*")
}

src() { PGPORT="$SRC_PORT" PGDATABASE=postgres "$@"; }
dst() {
  local db="$1"
  shift
  PGPORT="$DST_PORT" PGDATABASE="$db" "$@"
}
sq() { src "$PSQL" -X -q -v ON_ERROR_STOP=1 "$@"; }
dq() {
  local db="$1"
  shift
  dst "$db" "$PSQL" -X -q -v ON_ERROR_STOP=1 "$@"
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
say "backing up the source with the weekly job's own steps"
src bash "$BK" dump "$WORK/bundle"
[ ! -s "$WORK/bundle/moved.txt" ] || fail "nothing writes to the source, yet these moved during the dump: $(tr '\n' ' ' <"$WORK/bundle/moved.txt")"
grep -qP '^cron\tcron-log-trim\t' "$WORK/bundle/extras.tsv" || fail "the cron job was not captured"
[ "$(grep -cP '^publication\t' "$WORK/bundle/extras.tsv" || true)" = 2 ] || fail "the realtime publication was not captured"

age-keygen -o "$WORK/throwaway.key" 2>/dev/null
RECIPIENT="$(age-keygen -y "$WORK/throwaway.key")"
bash "$BK" seal "$WORK/bundle" "$RECIPIENT" "$WORK/yaya-db.tar.age"
bash "$BK" open "$WORK/yaya-db.tar.age" "$WORK/throwaway.key" "$WORK/opened"
diff -r "$WORK/bundle" "$WORK/opened" >/dev/null || fail "the bundle that came out of the ciphertext is not the one that went in"

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

# ⚠️ FIRST, BECAUSE ROLES BELONG TO THE SERVER AND NOT TO A DATABASE: once any database here has
# been given the bundle's roles, every database has them. The source grants SELECT on every table
# to yaya_backup, as production will once the backup's role exists, and a target without it must
# be told so by name rather than failing at the first GRANT.
say "a target without a role the grants name"
fresh_project no_roles
refused "a target missing a role the bundle grants to" 'roles this target does not have: .*yaya_backup' -- dst no_roles bash "$BK" preflight "$WORK/opened"

# ── the restore, done right ────────────────────────────────────────────────────────────────────
say "restoring into a fresh project"
fresh_project restored "$WORK/opened"
DB_BACKUP_SHOW_DIFF=1 dst restored bash "$BK" restore "$WORK/opened" | tee "$WORK/restore.log" || fail "the restore itself failed"
grep -q 'left out CREATE SCHEMA public and 3 supabase_admin default-privilege entries' "$WORK/restore.log" ||
  fail "the restore did not leave out exactly the three supabase_admin default-privilege entries the source has"
grep -q 'kept beside it: 2 realtime publication entries, 1 policies on Supabase.s own tables, 1 triggers elsewhere, 1 cron jobs' "$WORK/restore.log" ||
  fail "the restore did not count what the bundle keeps beside the dump"
grep -q 'alter publication' "$WORK/restore.log" && fail "the restore printed after-restore's statements into its own log"

# ⚠️ AND AGAIN THROUGH A PATH THAT SHARES NO CODE WITH THE MANIFEST. verify compares aclexplode()
# text; this asks has_*_privilege() of every table, column-less, sequence and function, for every
# API role and PUBLIC, and counts rows with plain count(*). If both agree, two different questions
# got the same answer.
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
# after-restore's SQL is RUN against the restored target here, with the same stand-ins for
# Realtime's table and pg_cron a plain server needs, and the result is compared with the source:
# the policy, the trigger, the publication's tables and every cron command byte for byte (the
# probe's command has a newline and a quoted string in it, which is the point).
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
language sql as $$ insert into cron.job (jobname, schedule, command) values (job_name, schedule, command) returning jobid $$;
SQL
dq restored -1 -f "$WORK/after.sql" >/dev/null || fail "after-restore's SQL did not run"
read -r -d '' ELSEWHERE <<'SQL' || true
select count(*) || '|' || md5(string_agg(x, E'\n' order by x collate "C")) from (
  select 'policy|' || polname || '|' || polcmd || '|' || pg_get_expr(polqual, polrelid) from pg_policy
   where polrelid = 'realtime.messages'::regclass
  union all
  select 'trigger|' || pg_get_triggerdef(oid) from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal
  union all
  select 'publication|' || pubname || '|' || schemaname || '.' || tablename from pg_publication_tables
  union all
  select 'cron|' || jobname || '|' || schedule || '|' || md5(command) from cron.job) s(x)
SQL
put_back_src="$(src "$PSQL" -X -At -c "$ELSEWHERE")"
put_back_dst="$(dst restored "$PSQL" -X -At -c "$ELSEWHERE")"
echo "    what no dump carries, source $put_back_src, restored $put_back_dst"
[ "$put_back_src" = "$put_back_dst" ] || fail "after-restore did not put back exactly what the source had"
[ "${put_back_src%%|*}" = 5 ] || fail "expected a policy, a trigger, two publication entries and a cron job, found ${put_back_src%%|*}"

# ── the faults: every one must be refused ──────────────────────────────────────────────────────

say "breaking it on purpose"

fresh_project no_grants
dst no_grants bash "$BK" preflight >/dev/null
dst no_grants bash "$BK" neutralise-defaults >/dev/null
dst no_grants bash "$BK" load-auth-ids "$WORK/opened" >/dev/null
"$PGRESTORE" --list "$WORK/opened/yaya.dump" |
  grep -vE '^[0-9]+; [0-9]+ [0-9]+ SCHEMA - public ' |
  grep -vE ' DEFAULT ACL [^ ]+ DEFAULT PRIVILEGES FOR [A-Z ]+ supabase_admin$' >"$WORK/toc.keep"
dst no_grants "$PGRESTORE" --dbname=no_grants --no-owner --no-privileges --exit-on-error \
  --single-transaction --use-list="$WORK/toc.keep" "$WORK/opened/yaya.dump"
refused "restored with --no-privileges" 'relation|function|schema' -- dst no_grants bash "$BK" verify "$WORK/opened"
# and the independent question has to see it too, or it is not so much independent as idle
nogrants="$(dst no_grants "$PSQL" -X -At -c "$ASK")"
[ "$nogrants" != "$asked_src" ] || fail "asked directly, a restore without its grants looks the same as the source"
echo "    asked directly, the restore without its grants: $nogrants"

fresh_project kept_defaults
dst kept_defaults bash "$BK" preflight >/dev/null
dst kept_defaults bash "$BK" load-auth-ids "$WORK/opened" >/dev/null
dst kept_defaults bash "$BK" pg-restore "$WORK/opened" >/dev/null
refused "restored into a project's default grants" 'relation\tpublic\.zz_restore_probe|function\tpublic\.zz_restore_probe_count' -- dst kept_defaults bash "$BK" verify "$WORK/opened"
kept="$(dst kept_defaults "$PSQL" -X -At -c "$ASK")"
[ "$kept" != "$asked_src" ] || fail "asked directly, a restore into the default grants looks the same as the source"
echo "    asked directly, the restore into the default grants: $kept"

fresh_project no_ids
dst no_ids bash "$BK" preflight >/dev/null
dst no_ids bash "$BK" neutralise-defaults >/dev/null
refused "restored without the auth ids" 'foreign key' -- dst no_ids bash "$BK" pg-restore "$WORK/opened"

refused "a restore aimed at a database that already has tables" 'already has [0-9]+ tables' -- dst restored bash "$BK" preflight

dq restored -c "delete from public.zz_restore_probe where note = 'the far future'"
refused "a row missing after the restore" 'rows\ttable\tpublic\.zz_restore_probe' -- dst restored bash "$BK" verify "$WORK/opened"

dq restored -c "alter table public.zz_restore_probe drop constraint zz_restore_probe_note_check"
refused "a constraint missing after the restore" 'catalog\tconstraints\tpublic\.zz_restore_probe' -- dst restored bash "$BK" verify "$WORK/opened"

dq restored -c "grant select on public.profile_blocks to anon"
refused "a grant widened after the restore" 'catalog\trelation\tpublic\.profile_blocks' -- dst restored bash "$BK" verify "$WORK/opened"

dq postgres -c "drop database if exists real_project with (force)" -c "create database real_project"
dq real_project -c "create schema auth" -c "create table auth.users (id uuid primary key, is_sso_user boolean not null default false)"
refused "stand-ins loaded into a real project" 'real project' -- dst real_project bash "$BK" prepare-plain-target

# ⚠️ the private key must be refused AND must not appear anywhere in what was printed
SECRET="$(grep -m1 '^AGE-SECRET-KEY-' "$WORK/throwaway.key")"
refused "a private key where the recipient belongs" 'PRIVATE key' -- bash "$BK" seal "$WORK/bundle" "$SECRET" "$WORK/never.age"
grep -qF "$SECRET" "$WORK/fault.log" && fail "the private key was printed while it was refused"
tar -C "$WORK/bundle" -cf "$WORK/plain.tar" .
refused "a plaintext tar presented as the upload" 'not ciphertext' -- bash "$BK" check-ciphertext "$WORK/plain.tar"
refused "a raw dump presented as the upload" 'not ciphertext' -- bash "$BK" check-ciphertext "$WORK/bundle/yaya.dump"

# the gate, with made-up values: none of these connects to anything
gate() { env -i PATH="$PATH" GITHUB_OUTPUT="$WORK/gate.out" "$@" bash "$BK" gate; }
good=(DB_BACKUP_PGHOST=aws-0-us-east-1.pooler.supabase.com DB_BACKUP_PGUSER=yaya_backup.abcdefghijklmnopqrst
  DB_BACKUP_PGPASSWORD=not-a-real-password "DB_BACKUP_AGE_RECIPIENT=$RECIPIENT"
  "DB_BACKUP_CA_CERT=-----BEGIN CERTIFICATE-----")
: >"$WORK/gate.out"
gate >/dev/null && grep -q '^ready=no$' "$WORK/gate.out" || fail "the gate did not stand down quietly with nothing set"
: >"$WORK/gate.out"
gate "${good[@]}" >/dev/null && grep -q '^ready=yes$' "$WORK/gate.out" || fail "the gate refused a complete, well-formed setup"
refused "the gate, half configured" 'Missing: DB_BACKUP_PGPASSWORD' -- gate "${good[@]:0:2}" "${good[@]:3}"
refused "the gate, given a private key" 'PRIVATE key' -- gate "${good[@]:0:3}" "DB_BACKUP_AGE_RECIPIENT=$SECRET" "${good[@]:4}"
grep -qF "$SECRET" "$WORK/fault.log" && fail "the gate printed the private key it refused"
refused "the gate, given the direct IPv6-only host" 'IPv6-only' -- gate DB_BACKUP_PGHOST=db.abcdefghijklmnopqrst.supabase.co "${good[@]:1}"
refused "the gate, given a pooler user with no project ref" 'project_ref' -- gate "${good[0]}" DB_BACKUP_PGUSER=postgres "${good[@]:2}"

if [ ${#failures[@]} -gt 0 ]; then
  say "FAILED: ${#failures[@]} problem(s)"
  printf '  - %s\n' "${failures[@]}" >&2
  exit 1
fi
say "restore verified: rows, definitions and grants, with member data and its auth ids; and every fault refused"
