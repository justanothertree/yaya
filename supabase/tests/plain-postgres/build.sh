#!/usr/bin/env bash
# Build the guard database on a PLAIN Postgres 16 when `supabase start` is unavailable, then load
# any draft migrations and run test files against it.
#
#   PGHOST=/path/to/socket PGPORT=55432 supabase/tests/plain-postgres/build.sh \
#     [--draft supabase/drafts/x.sql]... [--test supabase/tests/y.sql]...
#
# It drops and recreates the database named by $PGDATABASE (default `yaya_test`) — never point it
# at anything but a throwaway server. 00-platform.sql says what is and is not stood in for.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
DB="${PGDATABASE:-yaya_test}"
export PGUSER="${PGUSER:-postgres}"

case "$DB" in yaya_test*) ;; *) echo "refusing: PGDATABASE must start with yaya_test" >&2; exit 2 ;; esac

drafts=()
tests=()
while [ $# -gt 0 ]; do
  case "$1" in
    --draft) drafts+=("$2"); shift 2 ;;
    --test) tests+=("$2"); shift 2 ;;
    *) echo "unknown argument $1" >&2; exit 2 ;;
  esac
done

psql -d postgres -qv ON_ERROR_STOP=1 -c "drop database if exists $DB with (force)" -c "create database $DB"
run() { PGDATABASE="$DB" psql -qX -v ON_ERROR_STOP=1 -f "$1" >/dev/null; }

# ⚠️ THE DUMP IS FROM POSTGRES 17 and grants its MAINTAIN privilege (vacuum, analyze, reindex,
# refresh) 47 times. A 16 server rejects the word. On a pre-17 server ONLY, the dump is loaded with
# that one privilege removed from its GRANT lists — it touches no row, policy or function right,
# so nothing a guard asks about moves. On 17 the dump is loaded untouched.
SERVER="$(psql -d postgres -Atc 'show server_version_num')"
DUMP="$ROOT/supabase/migrations/00000000000000_baseline.sql"
if [ "$SERVER" -lt 170000 ]; then
  TMP="$(mktemp)"
  trap 'rm -f "$TMP"' EXIT
  sed -E 's/^GRANT MAINTAIN ON .*$/-- (a MAINTAIN-only grant, skipped on a pre-17 server)/; s/,MAINTAIN,/,/; s/,MAINTAIN ON / ON /; s/GRANT MAINTAIN,/GRANT /' "$DUMP" >"$TMP"
  chmod a+r "$TMP"
  DUMP="$TMP"
  echo "server $SERVER < 17: loading the dump without MAINTAIN"
fi

run "$HERE/00-platform.sql"
# the same files, in the same order, as [db.seed] sql_paths in supabase/config.toml
run "$ROOT/supabase/baseline/00-privileges.sql"
run "$ROOT/supabase/baseline/01-extensions.sql"
run "$DUMP"
run "$ROOT/supabase/baseline/02-triggers.sql"
run "$ROOT/supabase/seed.sql"
echo "built $DB: baseline and seed"

if [ ${#drafts[@]} -gt 0 ]; then
  # a draft goes into the world it will meet: Supabase's permissive defaults, not the dump's revokes
  PGDATABASE="$DB" psql -qX -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
SQL
  for d in "${drafts[@]}"; do run "$ROOT/$d"; echo "applied draft $d"; done
fi

for t in "${tests[@]}"; do
  echo "--- $t"
  PGDATABASE="$DB" psql -X -v ON_ERROR_STOP=1 -f "$ROOT/$t"
done
