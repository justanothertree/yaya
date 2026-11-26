#!/usr/bin/env bash
# The database backup, its restore, and the check that a restore holds what was backed up.
#
# ONE SCRIPT, THREE CALLERS: the weekly job (.github/workflows/db-backup.yml), the restore test
# that runs on every pull request (scripts/restore-test.sh), and a person restoring by hand
# (docs/2026-11-21-database-backup-and-restore.md). The first version of this had the weekly
# job's steps written into the workflow and a separate test that shared none of them, so five of
# the seven steps that would run against production had never run anywhere. Every step the job
# takes is a subcommand here, and the test calls the same subcommands.
#
# ⚠️ CONNECTIONS COME FROM libpq's OWN ENVIRONMENT, NEVER AN ARGUMENT. PGHOST, PGPORT, PGDATABASE,
# PGUSER, PGPASSWORD, PGSSLMODE, PGSSLROOTCERT. No subcommand takes a connection string, so a
# password cannot end up in `ps`, in `set -x` output, or in a libpq parse error that quotes the
# URI it could not read.
#
#   db-backup.sh gate                          are the weekly job's inputs all there, and sane?
#   db-backup.sh dump DIR                      dump the source into an empty DIR
#   db-backup.sh seal DIR RECIPIENT OUT        tar DIR and encrypt it to an age recipient
#   db-backup.sh check-ciphertext FILE         refuse FILE unless it is age ciphertext
#   db-backup.sh open IN IDENTITY DIR          decrypt and unpack a bundle into an empty DIR
#   db-backup.sh prepare-plain-target [DIR]    give a PLAIN Postgres what a Supabase project has,
#                                              and every role the bundle in DIR grants to
#   db-backup.sh restore DIR                   preflight, neutralise-defaults, load-auth-ids,
#                                              pg-restore and verify, in that order
#   db-backup.sh preflight [DIR] | neutralise-defaults | load-auth-ids DIR | pg-restore DIR | verify DIR
#                                              the same steps one at a time
set -euo pipefail
umask 077
# byte order for every sort and comm, so two machines sort a manifest the same way
export LC_ALL=C

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
SQL="$HERE/db-backup"

# ⚠️ THE CLIENT IS FOUND BY PATH, NOT BY `pg_wrapper`. The runner image ships a newer Postgres
# client than the one this installs, and the wrapper picks a version from the server it is
# pointed at, which it cannot tell from libpq environment variables. A dump written by one
# pg_dump major must be read by a pg_restore of the same major or newer, so every tool here comes
# from one directory. PG_BIN overrides it; on a machine with only one client, PATH is used.
if [ -z "${PG_BIN:-}" ] && [ -x /usr/lib/postgresql/17/bin/pg_dump ]; then
  PG_BIN=/usr/lib/postgresql/17/bin
fi
pgtool() {
  local tool="$1"
  shift
  if [ -n "${PG_BIN:-}" ]; then "$PG_BIN/$tool" "$@"; else "$tool" "$@"; fi
}
q() { pgtool psql -X -q -v ON_ERROR_STOP=1 "$@"; }
one() { q -At -c "$1"; }

say() { echo "--- $*"; }
die() {
  echo "!!! $*" >&2
  exit 1
}

# Every table in public and finance — the two schemas this backs up.
OURS="n.nspname in ('public', 'finance')"

empty_dir() {
  local dir="$1"
  mkdir -p "$dir"
  [ -z "$(ls -A "$dir")" ] || die "$dir is not empty; a bundle goes into an empty directory"
}

# ── the weekly job's gate ───────────────────────────────────────────────────────────────────────
# ⚠️ NOTHING HERE PRINTS A VALUE. Only the NAMES of missing or malformed inputs. A GitHub
# variable is printed in a step's log header and a secret is masked, which is why all five
# inputs are secrets, even the public ones — and why a private key pasted where the public one
# belongs is refused by name, without being repeated.
gate() {
  local names=(DB_BACKUP_PGHOST DB_BACKUP_PGUSER DB_BACKUP_PGPASSWORD DB_BACKUP_AGE_RECIPIENT DB_BACKUP_CA_CERT)
  local have=() missing=() name
  for name in "${names[@]}"; do
    if [ -n "${!name:-}" ]; then have+=("$name"); else missing+=("$name"); fi
  done
  local out="${GITHUB_OUTPUT:-/dev/null}"

  # none: not switched on yet, which is a state and not a failure
  if [ ${#have[@]} -eq 0 ]; then
    echo "::notice title=Not configured yet::No backup inputs are set, so nothing was connected to. See docs/2026-11-21-database-backup-and-restore.md."
    echo "ready=no" >>"$out"
    return 0
  fi
  # ⚠️ SOME: a half-finished setup is a FAILURE, red, every week until it is finished. The first
  # version exited 0 here too, so one misspelt secret name read exactly like "not switched on".
  if [ ${#missing[@]} -gt 0 ]; then
    echo "::error title=Backup half configured::Set but incomplete. Missing: ${missing[*]}"
    return 1
  fi

  local bad=()
  case "$DB_BACKUP_AGE_RECIPIENT" in
    AGE-SECRET-KEY-*)
      echo "::error title=That is a PRIVATE key::DB_BACKUP_AGE_RECIPIENT holds an age private key. It belongs offline: delete the secret, generate a new key pair, and keep only the public half (age1…) here."
      return 1
      ;;
  esac
  [[ "$DB_BACKUP_AGE_RECIPIENT" =~ ^age1[02-9ac-hj-np-z]{58}$ ]] || bad+=("DB_BACKUP_AGE_RECIPIENT is not an age public key (age1 and 58 more characters)")
  # ⚠️ THE DIRECT HOST IS IPv6-ONLY and GitHub's runners have no IPv6, so it fails to connect —
  # the Session pooler (port 5432) is the one that works from here.
  case "$DB_BACKUP_PGHOST" in
    *.pooler.supabase.com) ;;
    db.*.supabase.co) bad+=("DB_BACKUP_PGHOST is the direct host, which is IPv6-only; use the Session pooler host (*.pooler.supabase.com)") ;;
    *) bad+=("DB_BACKUP_PGHOST is not a Supabase pooler host (*.pooler.supabase.com)") ;;
  esac
  # through the pooler a role is named role.project_ref
  [[ "$DB_BACKUP_PGUSER" == *.* ]] || bad+=("DB_BACKUP_PGUSER has no .project_ref, which the pooler needs")
  [[ "$DB_BACKUP_CA_CERT" == "-----BEGIN CERTIFICATE-----"* ]] || bad+=("DB_BACKUP_CA_CERT is not a PEM certificate")
  if [ ${#bad[@]} -gt 0 ]; then
    local b
    for b in "${bad[@]}"; do echo "::error title=Backup input refused::$b"; done
    return 1
  fi
  echo "ready=yes" >>"$out"
  echo "all five inputs are set and well formed"
}

# ── the client ─────────────────────────────────────────────────────────────────────────────────
check_client() {
  local client server
  client="$(pgtool pg_dump --version | grep -oE '[0-9]+' | head -1)"
  server="$(one 'show server_version_num')"
  server=$((server / 10000))
  echo "    pg_dump $client, server $server"
  [ "$client" -ge "$server" ] || die "pg_dump $client cannot dump a Postgres $server server"
}

# ── dump ───────────────────────────────────────────────────────────────────────────────────────
dump() {
  local dir="${1:?dump DIR}"
  empty_dir "$dir"
  say "checking the client against the server"
  check_client

  # ⚠️ THE MANIFEST IS TAKEN EITHER SIDE OF THE DUMP. It is the source's own account of itself —
  # every table's rows and every object's definition and grants — and a restore is checked
  # against it. The database is live, so a row can change while pg_dump runs; a table whose
  # account moved between the two readings is named in moved.txt and its rows are not compared,
  # rather than failing a good backup or, worse, comparing against the wrong moment.
  say "reading the source's account of itself"
  q -At -F $'\t' -f "$SQL/manifest.sql" >"$dir/manifest.before.tsv"

  # ⚠️ PRIVILEGES ARE KEPT. The first version passed --no-privileges, which drops every GRANT and
  # REVOKE: functions restore executable by PUBLIC (and so by anon) and tables restore with no
  # member grants at all — wide open and unusable at once. `--no-owner` stays, because the
  # target's roles own what is restored.
  say "dumping public and finance"
  pgtool pg_dump --schema=public --schema=finance --strict-names \
    --no-owner --format=custom --compress=9 --file="$dir/yaya.dump"

  # ⚠️ auth IS NOT DUMPED, BUT ITS IDS ARE. Fifty-one foreign keys point from member rows into
  # auth.users, and every one of them is re-checked when the restore adds it back — so without
  # the ids a restore of real data fails on the first one. Only the id travels: no email, no
  # password hash, no token. Who a member is, is in public.profiles.
  say "keeping the auth user ids the member rows point at"
  q -At -c 'copy (select id from auth.users order by id) to stdout' >"$dir/auth-user-ids.txt"

  say "reading the source's account of itself again"
  q -At -F $'\t' -f "$SQL/manifest.sql" >"$dir/manifest.tsv"
  q -At -F $'\t' -f "$SQL/extras.sql" >"$dir/extras.tsv"
  comm -13 <(grep -P '^rows\t' "$dir/manifest.before.tsv" | sort) \
    <(grep -P '^rows\t' "$dir/manifest.tsv" | sort) | cut -f3 | sort -u >"$dir/moved.txt"

  # ⚠️ AND A DUMP THAT IS NOT EMPTY. A role that can connect but read nothing writes a valid,
  # tiny dump of nothing, and that would encrypt and upload and look exactly like a backup.
  local tables entries ids
  tables="$(grep -cP '^rows\ttable\t' "$dir/manifest.tsv" || true)"
  entries="$(pgtool pg_restore --list "$dir/yaya.dump" | grep -c ' TABLE DATA ' || true)"
  ids="$(grep -c . "$dir/auth-user-ids.txt" || true)"
  [ "$tables" -gt 0 ] || die "the manifest names no tables"
  [ "$entries" = "$tables" ] || die "the dump carries data for $entries tables and the source has $tables"
  [ "$ids" -gt 0 ] || die "no auth user ids were read, so member rows could not be restored"
  echo "    $tables tables, $(wc -c <"$dir/yaya.dump") bytes, member ids kept, $(grep -c . "$dir/moved.txt" || true) moved during the dump"
}

# ── seal and open ──────────────────────────────────────────────────────────────────────────────
check_ciphertext() {
  local file="${1:?check-ciphertext FILE}"
  # ⚠️ EXACT, NOT A SUBSTRING. An age file's first line is exactly this header; a tar of the
  # plaintext begins with a file name, and a raw custom-format dump begins with PGDMP.
  [ "$(head -n 1 "$file")" = "age-encryption.org/v1" ] || {
    echo "::error title=Refusing to upload::$file does not begin with the age header, so it is not ciphertext." >&2
    return 1
  }
  [ "$(head -c 5 "$file")" != "PGDMP" ] || return 1
  [ "$(dd if="$file" bs=1 skip=257 count=5 2>/dev/null)" != "ustar" ] || return 1
}

seal() {
  local dir="${1:?seal DIR RECIPIENT OUT}" recipient="${2:?seal DIR RECIPIENT OUT}" out="${3:?seal DIR RECIPIENT OUT}"
  case "$recipient" in AGE-SECRET-KEY-*) die "that is an age PRIVATE key, not a recipient; it is not repeated here" ;; esac
  [[ "$recipient" =~ ^age1[02-9ac-hj-np-z]{58}$ ]] || die "the recipient is not an age public key (age1 and 58 more characters)"
  local f
  for f in yaya.dump auth-user-ids.txt manifest.tsv extras.tsv moved.txt; do
    [ -f "$dir/$f" ] || die "$dir has no $f, so it is not a whole bundle"
  done
  say "encrypting the bundle to the recipient"
  tar -C "$dir" -cf - . | age --encrypt --recipient "$recipient" --output "$out"
  check_ciphertext "$out"
  echo "    $(wc -c <"$out") bytes of ciphertext"
}

open_bundle() {
  local in="${1:?open IN IDENTITY DIR}" identity="${2:?open IN IDENTITY DIR}" dir="${3:?open IN IDENTITY DIR}"
  empty_dir "$dir"
  age --decrypt --identity "$identity" "$in" | tar -C "$dir" -xf -
  [ -f "$dir/yaya.dump" ] || die "the bundle held no yaya.dump"
}

# ── a target ───────────────────────────────────────────────────────────────────────────────────
# A Supabase project already has auth, the API roles and the extensions schema. A PLAIN Postgres
# (a scratch check, CI, the weekly job's own verification) has none of them, and the dump refers
# outward to exactly four things — measured on production 26 Nov 2026 with pg_depend: auth.users
# (51 foreign keys), auth.uid() (77 defaults and policies), and citext and gen_random_bytes from
# the extensions schema. The stand-ins below provide those and nothing else.
prepare_plain_target() {
  local dir="${1:-}" r
  # ⚠️ NEVER ON A REAL PROJECT: GoTrue's auth.users has is_sso_user, the stand-in does not
  if [ "$(one "select count(*) from pg_attribute where attrelid = to_regclass('auth.users') and attname = 'is_sso_user'")" != "0" ]; then
    die "this target already has Supabase's own auth.users; it is a real project and needs no stand-ins"
  fi
  q -f "$ROOT/supabase/tests/plain-postgres/00-platform.sql"
  q -f "$ROOT/supabase/baseline/01-extensions.sql"
  # and, given a bundle, every role its grants name — as NOLOGIN, because here a role only has to
  # exist for a GRANT to it to succeed
  if [ -n "$dir" ]; then
    while read -r r; do
      [ -n "$r" ] || continue
      printf '%s\n' "select format('create role %I nologin', :'r') where not exists (select 1 from pg_roles where rolname = :'r') \\gexec" |
        q -v r="$r"
    done < <(dump_roles "$dir")
  fi
  echo "    a plain target, given auth, the API roles and the extensions schema"
}

# The roles a bundle's GRANT, REVOKE and DEFAULT PRIVILEGES lines name, one per line. Each must
# exist on the target or the restore stops at the first grant to it — and the backup's own role
# is one of them, since it is granted SELECT on every table it reads.
dump_roles() {
  local dir="${1:?dump_roles DIR}" acl
  acl="$(mktemp)"
  pgtool pg_restore --list "$dir/yaya.dump" | grep -E '^[0-9]+; [0-9]+ [0-9]+ (DEFAULT )?ACL ' >"$acl" || true
  if [ -s "$acl" ]; then
    pgtool pg_restore --file=- --use-list="$acl" "$dir/yaya.dump" |
      sed -nE -e 's/^(GRANT|REVOKE|ALTER DEFAULT PRIVILEGES) .* (TO|FROM) ("[^"]+"|[^ ;]+)( WITH GRANT OPTION)?;$/\3/p' \
        -e 's/^ALTER DEFAULT PRIVILEGES FOR ROLE ("[^"]+"|[^ ]+) .*/\1/p' |
      sed -E 's/^"(.*)"$/\1/' | grep -vx 'PUBLIC' | sort -u || true
  fi
  rm -f "$acl"
}

preflight() {
  local dir="${1:-}" n r
  n="$(one "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where $OURS and c.relkind in ('r', 'p')")"
  # ⚠️ AN EMPTY TARGET OR NOTHING. This is also the guard against restoring over production.
  [ "$n" = "0" ] || die "the target already has $n tables in public or finance; a restore goes into an empty database"
  [ "$(one "select to_regnamespace('finance') is null")" = "t" ] || die "the target already has a finance schema"
  local need
  for need in "to_regclass('auth.users')" "to_regprocedure('auth.uid()')" \
    "to_regtype('extensions.citext')" "to_regprocedure('extensions.gen_random_bytes(integer)')" \
    "to_regrole('anon')" "to_regrole('authenticated')" "to_regrole('service_role')"; do
    [ "$(one "select $need is not null")" = "t" ] || die "the target has no $need; on a plain Postgres run prepare-plain-target first"
  done
  if [ -n "$dir" ]; then
    local missing=()
    while read -r r; do
      [ -n "$r" ] || continue
      [ "$(printf '%s\n' "select exists (select 1 from pg_roles where rolname = :'r')" | q -At -v r="$r")" = t ] || missing+=("$r")
    done < <(dump_roles "$dir")
    [ ${#missing[@]} -eq 0 ] || die "the bundle grants to roles this target does not have: ${missing[*]}. Create each (create role NAME nologin) first; on a plain Postgres, prepare-plain-target DIR does it"
  fi
  echo "    the target is empty and has what the dump refers to"
}

# ⚠️ THE TRAP A REAL PROJECT SETS, AND THE REASON THIS STEP EXISTS. Supabase's default
# privileges hand every new table, sequence and function in public to anon, authenticated and
# service_role. A restore CREATES every object, so each one is born with those grants — and a
# dump's GRANT and REVOKE lines are written against Postgres's built-in defaults, not the
# target's, so nothing in the dump takes them back. Restored as-is, every deny-all table is
# granted to anon (and TRUNCATE is one privilege RLS never checks), and every service-only
# function is executable by anon. So the restoring role's defaults are revoked first, exactly as
# supabase/baseline/00-privileges.sql does for the schema baseline; the dump's own ALTER DEFAULT
# PRIVILEGES lines put production's defaults back at the end of the restore.
neutralise_defaults() {
  q -c "alter default privileges in schema public revoke all on tables from anon, authenticated, service_role" \
    -c "alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role" \
    -c "alter default privileges in schema public revoke all on functions from anon, authenticated, service_role"
  local left
  # what is left may grant nothing to anybody but this role itself — in the two schemas, or across
  # the whole database, since a global default reaches public too. A global one is not revoked
  # here: that is a decision about the target, not a step of a restore.
  left="$(one "select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) x
               where d.defaclrole = (select oid from pg_roles where rolname = current_user)
                 and (d.defaclnamespace = 0
                      or d.defaclnamespace in (select oid from pg_namespace where nspname in ('public', 'finance')))
                 and x.grantee <> d.defaclrole and x.grantee <> 0")"
  [ "$left" = "0" ] || die "after revoking them, $left default grants from this role to another remain in public, finance or database-wide"
  echo "    this role's default grants to the API roles are off for the length of the restore"
}

load_auth_ids() {
  local dir="${1:?load-auth-ids DIR}" before after
  before="$(one 'select count(*) from auth.users')"
  {
    echo 'create temp table restore_ids (id uuid primary key) on commit drop;'
    echo 'copy restore_ids from stdin;'
    cat "$dir/auth-user-ids.txt"
    echo '\.'
    echo 'insert into auth.users (id) select id from restore_ids on conflict (id) do nothing;'
  } | q -1
  after="$(one 'select count(*) from auth.users')"
  local missing
  missing="$({
    echo 'create temp table restore_ids (id uuid primary key) on commit drop;'
    echo 'copy restore_ids from stdin;'
    cat "$dir/auth-user-ids.txt"
    echo '\.'
    echo 'select count(*) from restore_ids r where not exists (select 1 from auth.users u where u.id = r.id);'
  } | q -1 -At)"
  [ "$missing" = "0" ] || die "$missing member ids are still not in auth.users"
  echo "    $((after - before)) auth user ids added, $before were already there"
}

pg_restore_step() {
  local dir="${1:?pg-restore DIR}" toc keep
  toc="$(mktemp)"
  keep="$(mktemp)"
  pgtool pg_restore --list "$dir/yaya.dump" >"$toc"
  # ⚠️ TWO KINDS OF ENTRY ARE LEFT OUT, AND EACH IS COUNTED.
  #  - CREATE SCHEMA public: every Postgres already has one, and the restore dies on it.
  #  - DEFAULT PRIVILEGES belonging to supabase_admin: Supabase sets and manages those on every
  #    project, and the postgres role a restore runs as is not allowed to change them.
  grep -vE '^[0-9]+; [0-9]+ [0-9]+ SCHEMA - public ' "$toc" |
    grep -vE ' DEFAULT ACL [^ ]+ DEFAULT PRIVILEGES FOR [A-Z ]+ supabase_admin$' >"$keep" || true
  local schema_lines admin_lines
  schema_lines="$(grep -cE '^[0-9]+; [0-9]+ [0-9]+ SCHEMA - public ' "$toc" || true)"
  admin_lines="$(grep -cE ' DEFAULT ACL [^ ]+ DEFAULT PRIVILEGES FOR [A-Z ]+ supabase_admin$' "$toc" || true)"
  # exactly one, or the filter is not doing what it says: 0 means the pattern stopped matching and
  # the restore is about to fail the old way
  [ "$schema_lines" = "1" ] || die "expected exactly 1 CREATE SCHEMA public entry, found $schema_lines"
  echo "    left out CREATE SCHEMA public and $admin_lines supabase_admin default-privilege entries"
  # --single-transaction: a failure leaves an empty target, not half a database
  pgtool pg_restore --dbname="${PGDATABASE:-postgres}" --no-owner --exit-on-error \
    --single-transaction --use-list="$keep" "$dir/yaya.dump"
  rm -f "$toc" "$keep"
}

# ── verify ─────────────────────────────────────────────────────────────────────────────────────
# The target's account of itself, read by the same manifest.sql that read the source, line for
# line. ⚠️ IT PRINTS NAMES, NOT VALUES: the weekly job runs this against production's own rows
# and its log is public, so a mismatch says WHICH table or object, never what it holds.
# DB_BACKUP_SHOW_DIFF=1 prints the lines themselves, for the synthetic data in the restore test.
verify() {
  local dir="${1:?verify DIR}" mine
  mine="$(mktemp)"
  q -At -F $'\t' -f "$SQL/manifest.sql" >"$mine"
  local want got
  want="$(mktemp)"
  got="$(mktemp)"
  # rows of a table that moved during the dump are not compared; everything else is
  # (FILENAME, not NR == FNR: with an empty moved.txt that idiom reads every manifest line as a name)
  local skip='FILENAME == ARGV[1] { moved[$1] = 1; next } !($1 == "rows" && ($3 in moved))'
  awk -F'\t' "$skip" "$dir/moved.txt" "$dir/manifest.tsv" | sort >"$want"
  awk -F'\t' "$skip" "$dir/moved.txt" "$mine" | sort >"$got"
  local differ
  differ="$(comm -3 "$want" "$got" | sed 's/^\t//' | cut -f1-3 | sort -u)"
  local items tables
  items="$(grep -c . "$want" || true)"
  tables="$(grep -cP '^rows\ttable\t' "$want" || true)"
  if [ -n "$differ" ]; then
    echo "!!! the restore differs from the source in:" >&2
    echo "$differ" | sed 's/^/      /' >&2
    if [ "${DB_BACKUP_SHOW_DIFF:-}" = 1 ]; then
      echo "    source / restored:" >&2
      diff "$want" "$got" | grep '^[<>]' | head -40 >&2 || true
    fi
    rm -f "$mine" "$want" "$got"
    return 1
  fi
  rm -f "$mine" "$want" "$got"
  echo "    the restore matches the source in all $items items: rows of $tables tables, and every definition and grant"
  # what a dump of two schemas cannot carry, said every time so nobody has to remember it
  if grep -qP '^publication\t' "$dir/extras.tsv"; then
    echo "    on a real project, put these tables back in their realtime publications:"
    grep -P '^publication\t' "$dir/extras.tsv" | awk -F'\t' '{ printf "      alter publication %s add table %s;\n", $2, $3 }'
  fi
}

restore() {
  local dir="${1:?restore DIR}"
  say "checking the target"
  preflight "$dir"
  say "turning off the target's default grants"
  neutralise_defaults
  say "loading the auth user ids"
  load_auth_ids "$dir"
  say "restoring"
  pg_restore_step "$dir"
  say "comparing the restore with the source's account of itself"
  verify "$dir"
}

cmd="${1:-}"
[ $# -gt 0 ] && shift
case "$cmd" in
  gate) gate "$@" ;;
  dump) dump "$@" ;;
  seal) seal "$@" ;;
  check-ciphertext) check_ciphertext "$@" ;;
  open) open_bundle "$@" ;;
  prepare-plain-target) prepare_plain_target "$@" ;;
  preflight) preflight "$@" ;;
  neutralise-defaults) neutralise_defaults "$@" ;;
  load-auth-ids) load_auth_ids "$@" ;;
  pg-restore) pg_restore_step "$@" ;;
  verify) verify "$@" ;;
  restore) restore "$@" ;;
  *)
    sed -n '2,/^set -euo/p' "$0" | sed '$d' >&2
    exit 2
    ;;
esac
