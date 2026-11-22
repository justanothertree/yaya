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
# ⚠️ NOT A HOPE THAT TWO CALLS COLLIDE. The first session holds its transaction open for two
# seconds after writing, and the second does not start until the first is seen asleep in it
# (pg_stat_activity, wait_event PgSleep), so the second ALWAYS arrives while the first is
# uncommitted. That is the moment the bugs lived in:
#   0. an EMPTY page, two saves: only the profile-row lock serialises them (there are no rows to
#      lock), and without it both insert: the page comes back doubled;
#   1. the same with a page that has rows;
#   2. two versioned saves from one read: without a lock the second's version check runs before
#      the first commits, matches, and the check is no check at all;
#   3. the chronicle switch first, then a versioned save: only the row lock makes the save wait
#      for the switch and see it in the version; without it the save deletes the switch's change.
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
# block until a session is asleep inside its transaction, i.e. has written and holds its locks
asleep() {
  for _ in $(seq 1 100); do
    [ "$(q -c "select count(*) from pg_stat_activity where wait_event = 'PgSleep' and datname = current_database()")" -ge 1 ] && return 0
    sleep 0.1
  done
  fail "the first session never reached its save: $(cat "$WORK/a.out")"
  return 1
}
# one call of the chronicle switch as seedowner, held open like save_sql
switch_sql() {
  cat <<SQL
begin;
select set_config('request.jwt.claims', '{"sub":"$OWNER","role":"authenticated"}', true);
set local role authenticated;
select public.chronicle_share_timeline($1);
select pg_sleep($2);
commit;
SQL
}
count() { q -c "select count(*) from public.profile_blocks where user_id = '$OWNER'"; }
fails=0
fail() { echo "FAIL: $*"; fails=$((fails + 1)); }

# ── 0. an empty page, two old-style saves overlapping: one page, never two ──────────────────
q -c "delete from public.profile_blocks where user_id = '$OWNER'" >/dev/null
save_sql "$(three empty-a)" null 2 >"$WORK/a.sql"
save_sql "$(three empty-b)" null 0 >"$WORK/b.sql"
psql "$DB_URL" -qXAt -v ON_ERROR_STOP=1 -f "$WORK/a.sql" >"$WORK/a.out" 2>&1 &
A=$!
asleep || true
psql "$DB_URL" -qXAt -v ON_ERROR_STOP=1 -f "$WORK/b.sql" >"$WORK/b.out" 2>&1 || fail "the second save on an empty page failed: $(cat "$WORK/b.out")"
wait "$A" || fail "the first save on an empty page failed: $(cat "$WORK/a.out")"
n="$(count)"
[ "$n" = 3 ] || fail "two overlapping saves of an EMPTY page left $n blocks, not 3 (the profile-row lock)"
echo "0. overlapping saves of an empty page: $n blocks"

# ── 1. two old-style saves (no version) overlapping: one page, never two ─────────────────────
save_sql "$(three first)" null 2 >"$WORK/a.sql"
save_sql "$(three second)" null 0 >"$WORK/b.sql"
psql "$DB_URL" -qXAt -v ON_ERROR_STOP=1 -f "$WORK/a.sql" >"$WORK/a.out" 2>&1 &
A=$!
asleep || true
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
asleep || true
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

# ── 3. the chronicle switch first, then a save read before it: the save waits, sees it, refuses ──
q -c "delete from public.profile_blocks where user_id = '$OWNER';
      insert into public.profile_blocks (user_id, block_type, position, size, config, visibility)
      values ('$OWNER', 'bio', 1, 'medium', '{\"text\":\"kept\"}', 'members'),
             ('$OWNER', 'chronicle', 2, 'medium', '{\"timeline\":false}', 'friends');" >/dev/null
v="$(version)"
switch_sql true 2 >"$WORK/a.sql"
save_sql "$(three over-the-switch)" "'$v'" 0 >"$WORK/b.sql"
psql "$DB_URL" -qXAt -v ON_ERROR_STOP=1 -f "$WORK/a.sql" >"$WORK/a.out" 2>&1 &
A=$!
asleep || true
if psql "$DB_URL" -qXAt -v ON_ERROR_STOP=1 -f "$WORK/b.sql" >"$WORK/b.out" 2>&1; then
  fail "a save read before the chronicle switch went through while the switch was writing (the row lock)"
elif ! grep -q 'page changed' "$WORK/b.out"; then
  fail "the save after the switch failed, but not as page changed: $(cat "$WORK/b.out")"
fi
wait "$A" || fail "the switch failed: $(cat "$WORK/a.out")"
card="$(q -c "select config->>'timeline' from public.profile_blocks where user_id = '$OWNER' and block_type = 'chronicle'")"
n="$(count)"
[ "$card" = true ] && [ "$n" = 2 ] || fail "after the switch and the save the page holds $n blocks and timeline=$card"
echo "3. the switch first: timeline=$card, $n blocks; the save said: $(grep -o 'page changed' "$WORK/b.out" | head -1)"

if [ "$fails" -gt 0 ]; then
  echo "PROFILE PAGE RACE FAILED -- $fails check(s)"
  exit 1
fi
echo "profile page race holds"
