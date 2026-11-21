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

# ⚠️ A FRESH POSTGRES IS NOT AN EMPTY ONE, AND THE TWO FIXES FOR THAT FIGHT EACH OTHER.
# A new server already has a `public` schema, and `pg_dump --schema=public` emits
# `CREATE SCHEMA public` -- so the restore dies on "schema public already exists". The obvious
# answer, dropping `public` first, then breaks the NEXT step: `00-platform.sql` creates its
# stand-in objects in `public`, so against a server without one it dies on "schema public does
# not exist". Both of those were real CI failures, in that order.
#
# So `public` is left alone and the one conflicting entry is filtered out of the restore instead,
# with pg_restore's own table of contents. That is more precise than `--clean --if-exists`, which
# issues a DROP for every object in the dump and silences every error those raise -- including a
# real one.
# ⚠️ THE TARGET NEEDS THE SAME PLATFORM PREREQUISITES THE SOURCE DOES, and the list is not a
# guess: a `public` + `finance` dump refers OUTWARD, and the baseline names exactly five schemas
# it does not carry --
#
#     auth 483   extensions 6   vault 1   net 1   cron 1
#
# `00-platform.sql` provides auth, cron, net and vault; `01-extensions.sql` provides extensions
# (plus citext and pgcrypto inside it, which is where `extensions.gen_random_bytes` lives).
# Loading only the first is how this failed on run three and then again on run four, one schema
# at a time -- so both go on, and the count above is here so the next person enumerates instead
# of discovering.
say "giving the target the platform schemas the dump refers outward to"
psql "$DST" -v ON_ERROR_STOP=1 -q -f supabase/tests/plain-postgres/00-platform.sql
psql "$DST" -v ON_ERROR_STOP=1 -q -f supabase/baseline/01-extensions.sql

say "filtering CREATE SCHEMA public out of the restore's table of contents"
pg_restore --list "$WORK/probe.dump" > "$WORK/toc"
grep -vE '[0-9]+; [0-9]+ [0-9]+ SCHEMA - public ' "$WORK/toc" > "$WORK/toc.keep"
REMOVED=$(( $(wc -l < "$WORK/toc") - $(wc -l < "$WORK/toc.keep") ))
echo "    dropped $REMOVED entry/entries from the toc"
# ⚠️ exactly one, or the filter is not doing what it says -- 0 means the pattern stopped
# matching and the restore is about to fail the way it did before, and 2+ means it is eating
# something else
[ "$REMOVED" = "1" ] || { echo "!!! expected to drop exactly 1 toc entry, dropped $REMOVED" >&2; exit 1; }

say "restoring into the target"
# --exit-on-error so a half-restore is a failure rather than a warning nobody reads
pg_restore --dbname="$DST" --no-owner --no-privileges --exit-on-error   --use-list="$WORK/toc.keep" "$WORK/probe.dump"

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
