#!/usr/bin/env bash
# Prove that a dump of this schema can be restored into an empty server, and that what comes out
# the other side is what went in.
#
# ⚠️ IT USES NO PRODUCTION DATA AND NEEDS NO SECRET, WHICH IS WHY IT CAN RUN ON EVERY PULL
# REQUEST. The source database is built from the repository's own baseline and seed, so it has
# the real SHAPE -- every table, function, constraint and trigger the live one has -- and none of
# the rows. What that proves is the half that actually breaks: that `pg_dump --format=custom`
# of THIS schema restores cleanly into an empty Postgres 17 with `pg_restore`, including the
# order of the objects and the extensions they need. A backup nobody has restored is a hope.
#
# What it does NOT prove: that the live dump is complete, which depends on the connection string
# and the grants the dumping role has. That is checked by hand the first time, per
# docs/2026-11-21-database-backup-and-restore.md.
#
# Run it locally with two scratch servers:
#   SOURCE_URL=postgresql://... TARGET_URL=postgresql://... bash scripts/restore-test.sh
set -euo pipefail

SRC="${SOURCE_URL:?SOURCE_URL is required}"
DST="${TARGET_URL:?TARGET_URL is required}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

say() { echo "--- $*"; }

say "building the source from the repository's own baseline"
# the same files, in the same order, that supabase/config.toml's [db.seed] sql_paths names, minus
# the platform pieces a plain server has no roles for -- see 00-platform.sql for that stand-in
psql "$SRC" -v ON_ERROR_STOP=1 -q -f supabase/tests/plain-postgres/00-platform.sql
psql "$SRC" -v ON_ERROR_STOP=1 -q -f supabase/baseline/00-privileges.sql
psql "$SRC" -v ON_ERROR_STOP=1 -q -f supabase/baseline/01-extensions.sql
psql "$SRC" -v ON_ERROR_STOP=1 -q -f supabase/migrations/00000000000000_baseline.sql
psql "$SRC" -v ON_ERROR_STOP=1 -q -f supabase/baseline/02-triggers.sql

# ⚠️ A ROW IN EVERY SHAPE THAT MATTERS, because a dump of an EMPTY database restores perfectly
# and proves nothing about data. One row with a non-default value in it is the difference.
say "putting a row in, so the comparison is about data and not only about DDL"
psql "$SRC" -v ON_ERROR_STOP=1 -q <<'SQL'
create table if not exists public.zz_restore_probe (
  id bigint primary key,
  note text not null,
  made timestamptz not null default now(),
  payload jsonb not null
);
insert into public.zz_restore_probe (id, note, made, payload)
values (1, 'a line with a ⚠️ and a ''quote''', '2026-11-21T12:34:56Z', '{"a":[1,2,{"b":null}]}'::jsonb)
on conflict (id) do nothing;
SQL

say "counting the source"
SRC_TABLES=$(psql "$SRC" -tAc "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','finance') and c.relkind='r'")
SRC_FUNCS=$(psql "$SRC" -tAc "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','finance') and p.prokind='f'")
SRC_PROBE=$(psql "$SRC" -tAc "select md5(string_agg(id || note || made || payload::text, '|' order by id)) from public.zz_restore_probe")
echo "    tables=$SRC_TABLES functions=$SRC_FUNCS probe=$SRC_PROBE"

if [ "$SRC_TABLES" -lt 40 ]; then
  echo "!!! the source has only $SRC_TABLES tables, so this run would prove almost nothing" >&2
  exit 1
fi

say "dumping, the way the weekly job dumps"
pg_dump "$SRC" --schema=public --schema=finance --no-owner --no-privileges \
  --format=custom --compress=9 --file="$WORK/probe.dump"
ls -l "$WORK/probe.dump"

# ⚠️ A FRESH POSTGRES IS NOT AN EMPTY ONE: it ships with a `public` schema, and `pg_dump
# --schema=public` emits `CREATE SCHEMA public`, so the restore dies on "schema public already
# exists". Measured in CI on the first run of this file -- the source built fine (63 tables, 271
# functions) and the restore fell over on its first statement.
#
# Dropping it here rather than reaching for `pg_restore --clean` on purpose: `--clean` issues a
# DROP for every object in the dump, and against a target that has none of them that is a wall of
# errors `--if-exists` only silences -- which would also silence a real one. One DROP of the one
# thing that genuinely pre-exists keeps `--exit-on-error` meaning what it says.
say "clearing the target's default public schema, which a fresh server already has"
psql "$DST" -v ON_ERROR_STOP=1 -q -c 'drop schema if exists public cascade'

# ⚠️ AND THE TARGET NEEDS `auth` BEFORE THE RESTORE, WHICH IS A FACT ABOUT THE REAL BACKUP AND
# NOT A QUIRK OF THIS TEST. The dump is `public` + `finance`, and objects in those schemas REFER
# OUTWARD: `finance.cost_basis_overrides.updated_by` is `DEFAULT auth.uid()`, and 475 function
# bodies call `auth.uid()` or `auth.jwt()`. Restoring into a plain Postgres fails on the first
# such column with `schema "auth" does not exist`.
#
# Found by this test on its second run, which is the point of having written it: the documented
# procedure would have said "restore it into an empty server" and been wrong in exactly this way,
# and nobody would have found out until the day they needed the backup.
#
# `00-platform.sql` is the repository's existing stand-in for those API roles and functions -- the
# same file `supabase/tests/plain-postgres/build.sh` uses -- so the target gets it first. A
# restore into a real Supabase project needs nothing here, because `auth` is already there.
say "giving the target the auth stand-in the dump refers outward to"
psql "$DST" -v ON_ERROR_STOP=1 -q -f supabase/tests/plain-postgres/00-platform.sql

say "restoring into the empty target"
# --exit-on-error so a half-restore is a failure rather than a warning nobody reads
pg_restore --dbname="$DST" --no-owner --no-privileges --exit-on-error "$WORK/probe.dump"

say "counting the target"
DST_TABLES=$(psql "$DST" -tAc "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','finance') and c.relkind='r'")
DST_FUNCS=$(psql "$DST" -tAc "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','finance') and p.prokind='f'")
DST_PROBE=$(psql "$DST" -tAc "select md5(string_agg(id || note || made || payload::text, '|' order by id)) from public.zz_restore_probe")
echo "    tables=$DST_TABLES functions=$DST_FUNCS probe=$DST_PROBE"

fail=0
[ "$SRC_TABLES" = "$DST_TABLES" ] || { echo "!!! tables $SRC_TABLES -> $DST_TABLES" >&2; fail=1; }
[ "$SRC_FUNCS" = "$DST_FUNCS" ]   || { echo "!!! functions $SRC_FUNCS -> $DST_FUNCS" >&2; fail=1; }
[ "$SRC_PROBE" = "$DST_PROBE" ]   || { echo "!!! the probe row did not survive: $SRC_PROBE -> $DST_PROBE" >&2; fail=1; }

# ⚠️ AND A CONSTRAINT, NOT ONLY A COUNT. A restore that drops a CHECK leaves the same number of
# tables and the same rows, and the first thing anybody notices is bad data months later.
say "asking the target to refuse something the source refuses"
if psql "$DST" -v ON_ERROR_STOP=1 -qc "insert into public.zz_restore_probe (id, note, payload) values (1, 'dup', '{}'::jsonb)" 2>/dev/null; then
  echo "!!! the primary key did not come across: a duplicate id was accepted" >&2
  fail=1
else
  echo "    duplicate id refused, as it is on the source"
fi

[ "$fail" = 0 ] && say "restore verified: shape, data and at least one constraint" || exit 1
