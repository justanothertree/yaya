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
# ⚠️ DB_BACKUP_PUBLIC_LOG=1 is set by the weekly job, whose log anyone can read. With it, no count
# or size is printed, and the database's own error messages — which quote rows: "Key (user_id)=(…)
# is not present", "Failing row contains (…)" — go to restore-errors.txt inside the bundle, sealed
# with it, while the log says only which object failed.
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
#   db-backup.sh after-restore DIR             print the SQL that puts back what no dump carries
#   db-backup.sh preflight [DIR] | neutralise-defaults | load-auth-ids DIR | pg-restore DIR | verify DIR
#                                              the same steps one at a time
set -euo pipefail
umask 077
# byte order for every sort and comm, so two machines sort a manifest the same way
export LC_ALL=C
# libpq's own default database is the user's NAME, which through the pooler is `role.project_ref`
export PGDATABASE="${PGDATABASE:-postgres}"

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
public_log() { [ "${DB_BACKUP_PUBLIC_LOG:-}" = 1 ]; }
# a number for a private log, nothing for a public one
count() { public_log || printf '%s ' "$1"; }
# lines of a tab-separated file whose first field is KIND (awk rather than grep -P, which Git
# Bash's grep refuses)
kind_count() { awk -F'\t' -v k="$1" '$1 == k' "$2" | wc -l | tr -d ' '; }

# ⚠️ IN A PUBLIC LOG, THE DATABASE DOES NOT GET TO SPEAK. Its error text quotes the row it choked
# on — the ERROR line itself can ("invalid input syntax for type uuid: …"), and DETAIL and CONTEXT
# do. So the command's stderr goes to restore-errors.txt in the bundle, which is sealed after this
# so the detail is kept for whoever holds the key, and the log gets only pg_restore's "Command
# was:" — DDL, or the header of a COPY, which are the schema and never a row.
quietly() {
  local dir="$1"
  shift
  if ! public_log; then
    "$@"
    return
  fi
  local status=0 at
  "$@" 2>>"$dir/restore-errors.txt" || status=$?
  if [ "$status" != 0 ]; then
    at="$(awk '/^Command was: / { c = substr($0, 14); if ((getline n) > 0 && n ~ /^    /) c = c " " substr(n, 5); last = c }
               END { print last }' "$dir/restore-errors.txt" | cut -c1-240)"
    echo "!!! failed${at:+ at: $at}. The database's own message quotes rows, so it is not printed here: it is in restore-errors.txt, inside the sealed bundle." >&2
  fi
  return "$status"
}

# Every table in public and finance — the two schemas this backs up.
OURS="n.nspname in ('public', 'finance')"

empty_dir() {
  local dir="$1"
  mkdir -p "$dir"
  [ -z "$(ls -A "$dir")" ] || die "$dir is not empty; a bundle goes into an empty directory"
  # ⚠️ never inside a checkout: an opened bundle is every member's rows, and this repository is
  # public — one `git add -A` from the wrong directory would publish it
  if command -v git >/dev/null && [ "$(git -C "$dir" rev-parse --is-inside-work-tree 2>/dev/null)" = true ]; then
    die "$dir is inside a git checkout; put a bundle somewhere outside the repository"
  fi
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
  # the secrets belong to an environment only main may use; a run anywhere else holding them
  # means they have been put where any branch can read them
  if [ "${GITHUB_ACTIONS:-}" = true ] && [ "${GITHUB_REF:-}" != refs/heads/main ]; then
    echo "::error title=Backup secrets off main::The backup's secrets reached a run on ${GITHUB_REF:-an unknown ref}. They belong to the db-backup environment, limited to main."
    return 1
  fi

  local bad=()
  case "$DB_BACKUP_AGE_RECIPIENT" in
    *AGE-SECRET-KEY-*)
      echo "::error title=That is a PRIVATE key::DB_BACKUP_AGE_RECIPIENT holds an age private key. It belongs offline: delete the secret, generate a new key pair, and keep only the public half (age1…) here."
      return 1
      ;;
  esac
  # a pasted value with a newline on the end is the commonest way a right credential fails
  for name in "${names[@]}"; do
    [ "$name" = DB_BACKUP_CA_CERT ] && continue
    [[ "${!name}" =~ ^[[:space:]]|[[:space:]]$ ]] && bad+=("$name has surrounding whitespace, probably from a paste")
  done
  [[ "$DB_BACKUP_AGE_RECIPIENT" =~ ^age1[02-9ac-hj-np-z]{58}$ ]] || bad+=("DB_BACKUP_AGE_RECIPIENT is not an age public key (age1 and 58 more characters)")
  # ⚠️ THE DIRECT HOST IS IPv6-ONLY and GitHub's runners have no IPv6, so it fails to connect —
  # the Session pooler (port 5432) is the one that works from here.
  case "$DB_BACKUP_PGHOST" in
    *.pooler.supabase.com) ;;
    db.*.supabase.co) bad+=("DB_BACKUP_PGHOST is the direct host, which is IPv6-only; use the Session pooler host (*.pooler.supabase.com)") ;;
    *) bad+=("DB_BACKUP_PGHOST is not a Supabase pooler host (*.pooler.supabase.com)") ;;
  esac
  # through the pooler a role is named role.project_ref — and it must not be the owner's
  case "$DB_BACKUP_PGUSER" in
    postgres.* | supabase_admin.*) bad+=("DB_BACKUP_PGUSER is the project's owner role; the backup connects as its own read-only role, yaya_backup") ;;
    *.*) ;;
    *) bad+=("DB_BACKUP_PGUSER has no .project_ref, which the pooler needs") ;;
  esac
  [[ "$DB_BACKUP_CA_CERT" == "-----BEGIN CERTIFICATE-----"* ]] || bad+=("DB_BACKUP_CA_CERT is not a PEM certificate")
  if [ ${#bad[@]} -gt 0 ]; then
    local b
    for b in "${bad[@]}"; do echo "::error title=Backup input refused::$b"; done
    return 1
  fi
  echo "ready=yes" >>"$out"
  echo "all five inputs are set and well formed"
}

# ── the client, and who it is ──────────────────────────────────────────────────────────────────
check_client() {
  local client server
  client="$(pgtool pg_dump --version | grep -oE '[0-9]+' | head -1)"
  server="$(one 'show server_version_num')"
  server=$((server / 10000))
  echo "    pg_dump $client, server $server"
  [ "$client" -ge "$server" ] || die "pg_dump $client cannot dump a Postgres $server server"
}

# ⚠️ THE BACKUP READS AS A ROLE THAT CAN ONLY READ. Not the owner, not anything that can create a
# role or a database, and nothing that may write to a single table it backs up — measured here
# rather than trusted, because the dashboard's own connection string is the owner's, and pasting
# it would work, go green, and leave the most powerful credential in CI every week. BYPASSRLS is
# required, not merely allowed: a role subject to RLS gets a partial dump that looks whole.
check_role() {
  local flags writes
  flags="$(one "select concat_ws(',', case when rolsuper then 'superuser' end, case when rolcreaterole then 'createrole' end,
                                     case when rolcreatedb then 'createdb' end, case when not rolbypassrls then 'no bypassrls' end)
                  from pg_roles where rolname = current_user")"
  writes="$(one "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where $OURS and c.relkind in ('r', 'p')
                   and (has_table_privilege(c.oid, 'INSERT') or has_table_privilege(c.oid, 'UPDATE')
                        or has_table_privilege(c.oid, 'DELETE') or has_table_privilege(c.oid, 'TRUNCATE'))")"
  [ -z "$flags" ] || die "the backup must connect as its own read-only role, and this one is: $flags"
  [ "$writes" = 0 ] || die "the backup must connect as its own read-only role, and this one may write to $writes tables"
  echo "    reading as a role that can only read"
}

# through the one function scripts/db-backup/backup-role.sql makes for it: the backup's role
# cannot be given USAGE on schema auth by anybody it can be created by
auth_ids() {
  [ "$(one "select to_regprocedure('backup.auth_user_ids()') is not null")" = t ] ||
    die "this database has no backup.auth_user_ids(); run scripts/db-backup/backup-role.sql on it first"
  q -At -c 'copy (select * from backup.auth_user_ids()) to stdout'
}

# ── dump ───────────────────────────────────────────────────────────────────────────────────────
dump() {
  local dir="${1:?dump DIR}"
  empty_dir "$dir"
  say "checking the client and the role"
  check_client
  check_role

  # ⚠️ THE MANIFEST IS TAKEN EITHER SIDE OF THE DUMP. It is the source's own account of itself —
  # every table's rows and every object's definition and grants — and a restore is checked
  # against it. The database is live, so a row can change while pg_dump runs; a table whose
  # account moved between the two readings is named in moved.txt and its rows are not compared,
  # rather than failing a good backup or, worse, comparing against the wrong moment.
  say "reading the source's account of itself"
  q -At -F $'\t' -f "$SQL/manifest.sql" >"$dir/manifest.before.tsv"
  # ⚠️ A DUMP THAT IS NOT EMPTY, asked first. A role that can connect but see nothing writes a
  # valid, tiny dump of nothing, and that would encrypt and upload and look exactly like a backup.
  [ "$(awk -F'\t' '$1 == "rows" && $2 == "table"' "$dir/manifest.before.tsv" | wc -l)" -gt 0 ] ||
    die "the manifest names no tables, so there is nothing here to back up"

  # ⚠️ auth IS NOT DUMPED, BUT ITS IDS ARE — read BEFORE and AFTER pg_dump, and kept as the union.
  # Fifty-one foreign keys point from member rows into auth.users, and every one is re-checked when
  # the restore adds it back, so a member row whose id is missing fails the whole restore. pg_dump
  # reads its rows from a snapshot taken as it starts; an account deleted while it runs is in that
  # snapshot and gone from a later read. Any id that existed at the snapshot existed before it.
  # Only the id travels: no email, no password hash, no token. Who a member is, is in profiles.
  say "keeping the auth user ids the member rows point at"
  auth_ids >"$dir/auth-user-ids.before.txt"

  # ⚠️ PRIVILEGES ARE KEPT. The first version passed --no-privileges, which drops every GRANT and
  # REVOKE: functions restore executable by PUBLIC (and so by anon) and tables restore with no
  # member grants at all — wide open and unusable at once. `--no-owner` stays, because the
  # target's roles own what is restored.
  say "dumping public and finance"
  pgtool pg_dump --schema=public --schema=finance --strict-names \
    --no-owner --format=custom --compress=9 --file="$dir/yaya.dump"

  auth_ids | sort -u - "$dir/auth-user-ids.before.txt" >"$dir/auth-user-ids.txt"
  rm -f "$dir/auth-user-ids.before.txt"

  say "reading the source's account of itself again"
  q -At -F $'\t' -f "$SQL/manifest.sql" >"$dir/manifest.tsv"
  q -At -F $'\t' -f "$SQL/extras.sql" >"$dir/extras.tsv"
  comm -13 <(awk -F'\t' '$1 == "rows"' "$dir/manifest.before.tsv" | sort) \
    <(awk -F'\t' '$1 == "rows"' "$dir/manifest.tsv" | sort) | cut -f3 | sort -u >"$dir/moved.txt"

  local tables entries ids
  tables="$(awk -F'\t' '$1 == "rows" && $2 == "table"' "$dir/manifest.tsv" | wc -l | tr -d ' ')"
  entries="$(pgtool pg_restore --list "$dir/yaya.dump" | grep -c ' TABLE DATA ' || true)"
  ids="$(grep -c . "$dir/auth-user-ids.txt" || true)"
  [ "$entries" = "$tables" ] || die "the dump carries data for $entries tables and the source has $tables"
  [ "$ids" -gt 0 ] || die "no auth user ids were read, so member rows could not be restored"
  if public_log; then
    echo "    $tables tables, member ids kept"
  else
    echo "    $tables tables, $(wc -c <"$dir/yaya.dump") bytes, $ids member ids, $(grep -c . "$dir/moved.txt" || true) moved during the dump"
  fi
}

# ── seal and open ──────────────────────────────────────────────────────────────────────────────
check_ciphertext() {
  local file="${1:?check-ciphertext FILE}"
  # ⚠️ EXACT, NOT A SUBSTRING: an age file's first line is exactly this header. A tar of the
  # plaintext begins with a file name and a raw custom-format dump with PGDMP, and neither is it.
  [ "$(head -n 1 "$file")" = "age-encryption.org/v1" ] || {
    echo "::error title=Refusing to upload::$file does not begin with the age header, so it is not ciphertext." >&2
    return 1
  }
}

seal() {
  local dir="${1:?seal DIR RECIPIENT OUT}" recipient="${2:?seal DIR RECIPIENT OUT}" out="${3:?seal DIR RECIPIENT OUT}"
  case "$recipient" in *AGE-SECRET-KEY-*) die "that is an age PRIVATE key, not a recipient; it is not repeated here" ;; esac
  [[ "$recipient" =~ ^age1[02-9ac-hj-np-z]{58}$ ]] || die "the recipient is not an age public key (age1 and 58 more characters)"
  local f
  for f in yaya.dump auth-user-ids.txt manifest.tsv extras.tsv moved.txt; do
    [ -f "$dir/$f" ] || die "$dir has no $f, so it is not a whole bundle"
  done
  say "encrypting the bundle to the recipient"
  # ⚠️ a failure part way leaves a truncated file that still begins with the age header: removed,
  # so there is nothing at that path for an upload step to find
  if ! tar -C "$dir" -cf - . | age --encrypt --recipient "$recipient" --output "$out"; then
    rm -f "$out"
    die "encrypting the bundle failed"
  fi
  check_ciphertext "$out" || {
    rm -f "$out"
    return 1
  }
  public_log || echo "    $(wc -c <"$out") bytes of ciphertext"
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
real_project() { [ "$(one "select count(*) from pg_attribute where attrelid = to_regclass('auth.users') and attname = 'is_sso_user'")" != "0" ]; }

prepare_plain_target() {
  local dir="${1:-}" r
  # ⚠️ NEVER ON A REAL PROJECT: GoTrue's auth.users has is_sso_user, the stand-in does not
  real_project && die "this target already has Supabase's own auth.users; it is a real project and needs no stand-ins"
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
# is one of them, since it is granted SELECT on every table it reads. Two passes, because one sed
# run with two expressions rewrites the line in the first and the second never sees FOR ROLE.
dump_roles() {
  local dir="${1:?dump_roles DIR}" acl sql
  acl="$(mktemp)"
  sql="$(mktemp)"
  pgtool pg_restore --list "$dir/yaya.dump" | grep -E '^[0-9]+; [0-9]+ [0-9]+ (DEFAULT )?ACL ' >"$acl" || true
  if [ -s "$acl" ]; then
    pgtool pg_restore --file="$sql" --use-list="$acl" "$dir/yaya.dump"
    {
      sed -nE 's/^(GRANT|REVOKE|ALTER DEFAULT PRIVILEGES) .* (TO|FROM) ("[^"]+"|[^ ;]+)( WITH GRANT OPTION)?;$/\3/p' "$sql"
      sed -nE 's/^ALTER DEFAULT PRIVILEGES FOR ROLE ("[^"]+"|[^ ]+) .*/\1/p' "$sql"
    } | sed -E 's/^"(.*)"$/\1/' | grep -vx 'PUBLIC' | sort -u || true
  fi
  rm -f "$acl" "$sql"
}

# ⚠️ AN EMPTY TARGET OR NOTHING — the guard against restoring over production, asked by every
# step that changes the target, not only by the one that runs them all
require_empty_target() {
  local n
  n="$(one "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where $OURS and c.relkind in ('r', 'p')")"
  [ "$n" = "0" ] || die "the target already has $n tables in public or finance; a restore goes into an empty database"
  [ "$(one "select to_regnamespace('finance') is null")" = "t" ] || die "the target already has a finance schema"
}

preflight() {
  local dir="${1:-}" r need
  require_empty_target
  for need in "to_regclass('auth.users')" "to_regprocedure('auth.uid()')" \
    "to_regtype('extensions.citext')" "to_regprocedure('extensions.gen_random_bytes(integer)')" \
    "to_regrole('anon')" "to_regrole('authenticated')" "to_regrole('service_role')"; do
    [ "$(one "select $need is not null")" = "t" ] ||
      die "the target has no $need. On a real project, enable citext and pgcrypto in schema extensions (Database → Extensions); on a plain Postgres, run prepare-plain-target first"
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
  require_empty_target
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

# ⚠️ A ROW GoTrue CAN READ. Its token columns have no default, and it reads them into strings that
# cannot be NULL — a bare (id) row breaks the user list for the whole project and the password
# reset for that member. So every such column this auth.users has is given '', and the row the
# fields a confirmed email user has. On the stand-in most of these columns do not exist.
load_auth_ids() {
  local dir="${1:?load-auth-ids DIR}" before after cols vals
  require_empty_target
  read -r cols vals < <(one "select coalesce(string_agg(quote_ident(attname), ',' order by attname), ''),
                                    coalesce(string_agg(case attname
                                        when 'aud' then '''authenticated'''
                                        when 'role' then '''authenticated'''
                                        when 'instance_id' then '''00000000-0000-0000-0000-000000000000'''
                                        when 'raw_app_meta_data' then '''{\"provider\": \"email\", \"providers\": [\"email\"]}'''
                                        else '''''' end, ',' order by attname), '')
                               from pg_attribute where attrelid = 'auth.users'::regclass and not attisdropped
                                and attname in ('aud', 'role', 'instance_id', 'raw_app_meta_data', 'confirmation_token',
                                                'recovery_token', 'email_change_token_new', 'email_change_token_current',
                                                'email_change', 'phone_change', 'phone_change_token', 'reauthentication_token')" | tr '|' ' ')
  before="$(one 'select count(*) from auth.users')"
  {
    echo 'create temp table restore_ids (id uuid primary key) on commit drop;'
    echo 'copy restore_ids from stdin;'
    cat "$dir/auth-user-ids.txt"
    echo '\.'
    echo "insert into auth.users (id${cols:+,$cols}) select id${vals:+,$vals} from restore_ids on conflict (id) do nothing;"
  } | quietly "$dir" q -1
  after="$(one 'select count(*) from auth.users')"
  if public_log; then
    echo "    member ids loaded"
  else
    echo "    $((after - before)) auth user ids added, $before were already there"
  fi
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
  local schema_lines admin_lines admin_left
  schema_lines="$(grep -cE '^[0-9]+; [0-9]+ [0-9]+ SCHEMA - public ' "$toc" || true)"
  admin_lines="$(grep -cE ' DEFAULT ACL [^ ]+ DEFAULT PRIVILEGES FOR [A-Z ]+ supabase_admin$' "$toc" || true)"
  # exactly one, or the filter is not doing what it says: 0 means the pattern stopped matching and
  # the restore is about to fail the old way
  [ "$schema_lines" = "1" ] || die "expected exactly 1 CREATE SCHEMA public entry, found $schema_lines"
  # and asked a second way, by field rather than by pattern: nothing of supabase_admin's is left
  admin_left="$(awk '$4 == "DEFAULT" && $5 == "ACL" && $NF == "supabase_admin"' "$keep" | wc -l | tr -d ' ')"
  [ "$admin_left" = 0 ] || die "$admin_left supabase_admin default-privilege entries survived the filter"
  echo "    left out CREATE SCHEMA public and $admin_lines supabase_admin default-privilege entries"
  # --single-transaction: a failure leaves an empty target, not half a database
  quietly "$dir" pgtool pg_restore --dbname="$PGDATABASE" --no-owner --exit-on-error \
    --single-transaction --use-list="$keep" "$dir/yaya.dump"
  rm -f "$toc" "$keep"
}

# ── verify ─────────────────────────────────────────────────────────────────────────────────────
# The target's account of itself, read by the same manifest.sql that read the source, line for
# line. ⚠️ IT PRINTS NAMES, NOT VALUES: the weekly job runs this against production's own rows
# and its log is public, so a mismatch says WHICH table or object, never what it holds.
# DB_BACKUP_SHOW_DIFF=1 prints the lines themselves, for the synthetic data in the restore test.
verify() {
  local dir="${1:?verify DIR}" mine want got
  mine="$(mktemp)"
  want="$(mktemp)"
  got="$(mktemp)"
  q -At -F $'\t' -f "$SQL/manifest.sql" >"$mine"
  # rows of a table that moved during the dump are not compared; everything else is
  # (FILENAME, not NR == FNR: with an empty moved.txt that idiom reads every manifest line as a name)
  local skip='FILENAME == ARGV[1] { moved[$1] = 1; next } !($1 == "rows" && ($3 in moved))'
  awk -F'\t' "$skip" "$dir/moved.txt" "$dir/manifest.tsv" | sort >"$want"
  awk -F'\t' "$skip" "$dir/moved.txt" "$mine" | sort >"$got"
  local differ items tables skipped
  differ="$(comm -3 "$want" "$got" | sed 's/^\t//' | cut -f1-3 | sort -u)"
  items="$(grep -c . "$want" || true)"
  tables="$(awk -F'\t' '$1 == "rows" && $2 == "table"' "$want" | wc -l | tr -d ' ')"
  skipped="$(grep -c . "$dir/moved.txt" || true)"
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
  local note=""
  [ "$skipped" = 0 ] || note=" ($skipped moved during the dump, their rows not compared)"
  echo "    the restore matches the source in all $items items: rows of $tables tables, and every definition and grant$note"
  # what a dump of two schemas cannot carry, said every time so nobody has to remember it — as
  # counts: the statements themselves come from after-restore, which this log never prints
  echo "    not in any dump of public and finance, and kept beside it: $(kind_count publication "$dir/extras.tsv") realtime publication entries, $(kind_count policy "$dir/extras.tsv") policies on Supabase's own tables, $(kind_count trigger "$dir/extras.tsv") triggers elsewhere, $(kind_count cron "$dir/extras.tsv") cron jobs"
  echo "    on a real project, run what \`db-backup.sh after-restore DIR\` prints, after the restore"
}

# The SQL that puts back what a dump of public and finance cannot: realtime publication
# membership, the app's policies on Supabase's own tables, triggers elsewhere that call into
# ours, and pg_cron's jobs. PRINTED, NOT RUN — it goes to a real project after a restore, and a
# person should read a cron command before scheduling it. ⚠️ It can contain whatever a cron
# command contains, so run it at a terminal, never in a workflow whose log is public.
after_restore() {
  local dir="${1:?after-restore DIR}" kind f2 f3 f4 f5 name call
  # base64, decoded BY THE DATABASE: a cron command comes back byte for byte — a trailing newline,
  # quotes, anything — with nothing to escape. base64's alphabet has no quote in it.
  dec() { printf "convert_from(decode('%s', 'base64'), 'UTF8')" "$1"; }
  echo "-- after restoring $dir into a real project; read it before running it"
  # every field in extras.tsv is non-empty (see extras.sql), so a tab-split read cannot drop one
  while IFS=$'\t' read -r kind f2 f3 f4 f5; do
    case "$kind" in
      publication) printf 'alter publication %s add table %s;\n' "$f2" "$f3" ;;
      policy | trigger)
        printf -- '-- %s %s\n' "$kind" "$f2"
        printf '%s\n' "$(printf '%s' "$f3" | base64 -d)"
        ;;
      cron)
        if [ "$f2" = "-" ]; then name="(unnamed)"; else name="$(printf '%s' "$f2" | base64 -d)"; fi
        # the readable copy, as comments, for the person who has to read it before running it
        printf -- '-- cron job %s, %s%s:\n' "$name" "$(printf '%s' "$f3" | base64 -d)" "$([ "$f5" = paused ] && echo ', PAUSED')"
        printf '%s' "$f4" | base64 -d | sed 's/^/--   /'
        echo
        if [ "$f2" = "-" ]; then call="cron.schedule($(dec "$f3"), $(dec "$f4"))"; else call="cron.schedule($(dec "$f2"), $(dec "$f3"), $(dec "$f4"))"; fi
        # a paused job comes back paused
        if [ "$f5" = paused ]; then
          printf 'select cron.alter_job(%s, active := false);\n' "$call"
        else
          printf 'select %s;\n' "$call"
        fi
        ;;
      cron-not-captured) echo "-- pg_cron's jobs were not captured: the backup role could not read cron.job" ;;
    esac
  done <"$dir/extras.tsv"
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
  after-restore) after_restore "$@" ;;
  restore) restore "$@" ;;
  *)
    sed -n '2,/^set -euo/p' "$0" | sed '$d' >&2
    exit 2
    ;;
esac
