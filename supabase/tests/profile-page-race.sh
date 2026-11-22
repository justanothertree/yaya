#!/usr/bin/env bash
# Two saves of one profile page at once, with real sessions — what profile-page-version.sql, being
# one transaction, cannot ask.
#
#   supabase/tests/profile-page-race.sh "$DB_URL"
#
# Needs a THROWAWAY database with docs/2026-11-22-profile-page-version.DRAFT.sql (or its migration)
# loaded. db-guards.yml runs it on the stack it builds and throws away. It commits — a race needs
# committed rows — and puts seedowner's page back as it found it at the end, pass or fail.
#
# ⚠️ NOT A HOPE THAT TWO CALLS COLLIDE. The first save holds its transaction open for two seconds
# after saving, and the second starts half a second in, so the second ALWAYS arrives while the
# first is uncommitted. That is the moment both bugs lived in:
#   1. without a lock, the second save's delete cannot see the first one's new rows, deletes
#      nothing, and inserts its own beside them: the page comes back doubled;
#   2. without a lock, the second save's version check runs before the first commits, matches, and
#      the check is no check at all.
set -euo pipefail
DB_URL="${1:?usage: profile-page-race.sh <database url>}"
case "$DB_URL" in *127.0.0.1*|*localhost*) ;; *) echo "refusing: not a local database" >&2; exit 2 ;; esac
OWNER='00000000-0000-4000-a000-000000000001'
q() { psql "$DB_URL" -qXAt -v ON_ERROR_STOP=1 "$@"; }
WORK="$(mktemp -d)"

# the page as found, restored at the end whatever happens
q -c "create table if not exists public._race_keep as select * from public.profile_blocks where false;
      delete from public._race_keep;
      insert into public._race_keep select * from public.profile_blocks where user_id = '$OWNER';"
restore() {
  q -c "delete from public.profile_blocks where user_id = '$OWNER';
        insert into public.profile_blocks select * from public._race_keep;
        drop table public._race_keep;" >/dev/null || true
  rm -rf "$WORK"
}
trap restore EXIT

# one save as seedowner, inside its own transaction; $1 = blocks, $2 = expected version or null,
# $3 = seconds to hold the transaction open after saving
save_sql() {
  cat <<SQL
begin;
select set_config('request.jwt.claims', '{"sub":"$OWNER","role":"authenticated"}', true);
set local role authenticated;
select jsonb_array_length(public.save_my_profile_blocks(p_blocks => '$1'::jsonb, p_expected_page => $2));
select pg_sleep($3);
commit;
SQL
}
three() {
  printf '[{"block_type":"bio","size":"medium","config":{"text":"%s 1"},"visibility":"members"},' "$1"
  printf '{"block_type":"bio","size":"medium","config":{"text":"%s 2"},"visibility":"members"},' "$1"
  printf '{"block_type":"bio","size":"medium","config":{"text":"%s 3"},"visibility":"members"}]' "$1"
}
version() { q -c "select public.profile_page_version('$OWNER')"; }
count() { q -c "select count(*) from public.profile_blocks where user_id = '$OWNER'"; }
fails=0
fail() { echo "FAIL: $*"; fails=$((fails + 1)); }

# ── 1. two old-style saves (no version) overlapping: one page, never two ─────────────────────
save_sql "$(three first)" null 2 >"$WORK/a.sql"
save_sql "$(three second)" null 0 >"$WORK/b.sql"
psql "$DB_URL" -qXAt -v ON_ERROR_STOP=1 -f "$WORK/a.sql" >"$WORK/a.out" 2>&1 &
A=$!
sleep 0.5
psql "$DB_URL" -qXAt -v ON_ERROR_STOP=1 -f "$WORK/b.sql" >"$WORK/b.out" 2>&1 || fail "the second old-style save failed: $(cat "$WORK/b.out")"
wait "$A" || fail "the first old-style save failed: $(cat "$WORK/a.out")"
n="$(count)"
[ "$n" = 3 ] || fail "two overlapping saves left $n blocks, not 3 (the page was doubled)"
last="$(q -c "select string_agg(config->>'text', ',' order by position) from public.profile_blocks where user_id = '$OWNER'")"
[ "$last" = "second 1,second 2,second 3" ] || fail "the later save is not what the page holds: $last"
echo "1. overlapping old-style saves: $n blocks, holding: $last"

# ── 2. two versioned saves from the same read: exactly one lands ────────────────────────────
v="$(version)"
save_sql "$(three device-a)" "'$v'" 2 >"$WORK/a.sql"
save_sql "$(three device-b)" "'$v'" 0 >"$WORK/b.sql"
psql "$DB_URL" -qXAt -v ON_ERROR_STOP=1 -f "$WORK/a.sql" >"$WORK/a.out" 2>&1 &
A=$!
sleep 0.5
if psql "$DB_URL" -qXAt -v ON_ERROR_STOP=1 -f "$WORK/b.sql" >"$WORK/b.out" 2>&1; then
  fail "a save carrying a version that a save in flight was about to change went through"
elif ! grep -q 'page changed' "$WORK/b.out"; then
  fail "the second save failed, but not as page changed: $(cat "$WORK/b.out")"
fi
wait "$A" || fail "the first versioned save failed: $(cat "$WORK/a.out")"
n="$(count)"
last="$(q -c "select string_agg(config->>'text', ',' order by position) from public.profile_blocks where user_id = '$OWNER'")"
[ "$n" = 3 ] && [ "$last" = "device-a 1,device-a 2,device-a 3" ] || fail "after the versioned race the page holds $n blocks: $last"
echo "2. versioned saves from one read: the page holds $last; the second said: $(grep -o 'page changed' "$WORK/b.out" | head -1)"

if [ "$fails" -gt 0 ]; then
  echo "PROFILE PAGE RACE FAILED -- $fails check(s)"
  exit 1
fi
echo "profile page race holds"
