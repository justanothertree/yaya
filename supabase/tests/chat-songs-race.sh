#!/usr/bin/env bash
# Two claims of one account at once, with real sessions — what chat-songs.sql, being one
# transaction, cannot ask: does the 25 MB ceiling hold when both read the total before either
# inserts?
#
#   supabase/tests/chat-songs-race.sh "$DB_URL"
#
# Needs a THROWAWAY database with docs/2026-11-22-chat-songs.DRAFT.sql loaded. db-guards.yml runs
# it on the stack it builds and throws away. It commits — a race needs committed rows — and removes
# what it made at the end, pass or fail.
#
# ⚠️ NOT A HOPE THAT TWO CALLS COLLIDE. The first claim holds its transaction open for two seconds
# after claiming, and the second does not start until the first is seen asleep in it
# (pg_stat_activity, wait_event PgSleep). Without `chat_song_claim`'s advisory lock, the second
# reads the total as it was before the first, and both fit.
set -euo pipefail
DB_URL="${1:?usage: chat-songs-race.sh <database url>}"
case "$DB_URL" in *127.0.0.1*|*localhost*) ;; *) echo "refusing: not a local database" >&2; exit 2 ;; esac
OWNER='00000000-0000-4000-a000-000000000001'
FRIEND='00000000-0000-4000-a000-000000000002'
q() { psql "$DB_URL" -qXAt -v ON_ERROR_STOP=1 "$@"; }
WORK="$(mktemp -d)"
fails=0
fail() { echo "FAIL: $*"; fails=$((fails + 1)); }

# a DM between the two, and 20,000,000 bytes already held by the owner: 4 MB more fits under
# 26,214,400 once, and not twice
ROOM="$(q -c "insert into public.chat_rooms (kind) values ('dm') returning id")"
cleanup() {
  q -c "delete from public.chat_song_files where owner = '$OWNER' and room_id = '$ROOM';
        delete from public.chat_room_members where room_id = '$ROOM';
        delete from public.chat_rooms where id = '$ROOM';" >/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT
q -c "insert into public.chat_room_members (room_id, user_id) values ('$ROOM', '$OWNER'), ('$ROOM', '$FRIEND');
      insert into public.chat_song_files (id, owner, key, mime, bytes, seconds, name, room_id)
      select g, '$OWNER', 'songs/' || g || '.m4a', 'audio/mp4', 5000000, 60, 'held', '$ROOM'
        from (select gen_random_uuid() as g from generate_series(1, 4)) s;" >/dev/null

held() { q -c "select coalesce(sum(bytes), 0) from public.chat_song_files where owner = '$OWNER' and deleted_at is null"; }
claim_sql() {
  cat <<SQL
begin;
select set_config('request.jwt.claims', '{"sub":"$OWNER","role":"authenticated"}', true);
set local role authenticated;
select id from public.chat_song_claim('$ROOM', 'audio/mp4', 4000000, 10, '$1');
select pg_sleep($2);
commit;
SQL
}
asleep() {
  for _ in $(seq 1 100); do
    [ "$(q -c "select count(*) from pg_stat_activity where wait_event = 'PgSleep' and datname = current_database()")" -ge 1 ] && return 0
    sleep 0.1
  done
  fail "the first claim never reached its sleep: $(cat "$WORK/a.out")"
  return 1
}

before="$(held)"
[ "$before" = 20000000 ] || fail "fixture: the owner holds $before bytes, not 20000000"

claim_sql "race a" 2 >"$WORK/a.sql"
claim_sql "race b" 0 >"$WORK/b.sql"
psql "$DB_URL" -qXAt -v ON_ERROR_STOP=1 -f "$WORK/a.sql" >"$WORK/a.out" 2>&1 &
A=$!
asleep || true
if psql "$DB_URL" -qXAt -v ON_ERROR_STOP=1 -f "$WORK/b.sql" >"$WORK/b.out" 2>&1; then
  fail "a second claim went through while the first was still uncommitted (the claim's lock)"
elif ! grep -q 'come to 25 MB' "$WORK/b.out"; then
  fail "the second claim failed, but not on the ceiling: $(cat "$WORK/b.out")"
fi
wait "$A" || fail "the first claim failed: $(cat "$WORK/a.out")"
after="$(held)"
[ "$after" = 24000000 ] || fail "after two claims at once the owner holds $after bytes, not 24000000"
echo "two claims at once: the owner holds $after bytes; the second said: $(grep -o 'come to 25 MB' "$WORK/b.out" | head -1)"

if [ "$fails" -gt 0 ]; then
  echo "CHAT SONGS RACE FAILED -- $fails check(s)"
  exit 1
fi
echo "chat songs race holds"
