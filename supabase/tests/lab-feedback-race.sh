#!/usr/bin/env bash
# Races the Lab's vote and note functions with real concurrent sessions, which one transaction in
# lab-feedback.sql cannot: every session sleeps until the same instant, then calls at once.
#
#   PGHOST=… PGPORT=… PGDATABASE=yaya_test supabase/tests/lab-feedback-race.sh
#
# Needs a THROWAWAY database with supabase/migrations/20261109030613_lab_catalog_and_feedback.sql applied (build.sh
# makes one). It commits its fixtures — that is the point, a race needs committed rows — and
# deletes them again at the end, pass or fail.
#
# What it asks:
#   1. one account, 24 simultaneous votes of mixed sign on one experiment → exactly one row, and
#      its value is one of the values sent
#   2. 30 accounts, one +1 each, simultaneously → the total is 30 (no counter to lose updates)
#   3. one account, 12 simultaneous notes → exactly 5 land: the ten-minute limit holds under a race
set -euo pipefail
export PGUSER="${PGUSER:-postgres}"
DB="${PGDATABASE:-yaya_test}"
case "$DB" in yaya_test*) ;; *) echo "refusing: PGDATABASE must start with yaya_test" >&2; exit 2 ;; esac
export PGDATABASE="$DB"
q() { psql -qXAt -v ON_ERROR_STOP=1 "$@"; }

N_RACERS=30
uid() { printf '00000000-0000-4000-b000-%012d' "$1"; }

cleanup() {
  q -c "delete from public.lab_comments where user_id::text like '00000000-0000-4000-b000-%';
        delete from public.lab_votes where user_id::text like '00000000-0000-4000-b000-%';
        delete from public.profiles where user_id::text like '00000000-0000-4000-b000-%';
        delete from public.player_registry where player_name like 'racer%';
        delete from auth.users where id::text like '00000000-0000-4000-b000-%';" >/dev/null
}
trap cleanup EXIT
cleanup

for i in $(seq 1 $N_RACERS); do
  q -c "insert into auth.users (id, email) values ('$(uid "$i")', 'racer$i@example.test');
        insert into public.player_registry (player_name) values ('racer$i');
        insert into public.profiles (user_id, username, age_band) values ('$(uid "$i")', 'racer$i', 'adult');" >/dev/null
done

# a session that waits for the shared instant, then makes one call as `who`
as() { # as <uid> <sql>
  q -c "begin;
        select set_config('request.jwt.claims', json_build_object('sub', '$1', 'role', 'authenticated')::text, true);
        set local role authenticated;
        select pg_sleep_until('$AT'::timestamptz);
        $2;
        commit;" >/dev/null 2>&1 || true
}

fail=0

# 1. one account, many votes at once
AT="$(q -c "select (now() + interval '2 seconds')::text")"
for k in $(seq 1 24); do
  as "$(uid 1)" "select public.lab_vote('swarm', $(( k % 2 == 0 ? 1 : -1 )))" &
done
wait
got="$(q -c "select count(*) || ':' || coalesce(min(value)::text, '') from public.lab_votes where user_id = '$(uid 1)' and demo_id = 'swarm'")"
case "$got" in 1:1 | 1:-1) echo "ok   1: 24 simultaneous votes from one account left one row ($got)" ;;
  *) echo "FAIL 1: 24 simultaneous votes from one account left $got"; fail=1 ;; esac

# 2. many accounts, one vote each, at once
AT="$(q -c "select (now() + interval '2 seconds')::text")"
for i in $(seq 1 $N_RACERS); do
  as "$(uid "$i")" "select public.lab_vote('life', 1)" &
done
wait
got="$(q -c "select count(*) filter (where value = 1) from public.lab_votes where demo_id = 'life' and user_id::text like '00000000-0000-4000-b000-%'")"
total="$(q -c "begin; select set_config('request.jwt.claims', json_build_object('sub', '$(uid 2)', 'role', 'authenticated')::text, true); set local role authenticated;
               select e ->> 'up' from jsonb_array_elements(public.lab_catalog()) e where e ->> 'id' = 'life'; commit;" | tail -1)"
if [ "$got" = "$N_RACERS" ] && [ "$total" = "$N_RACERS" ]; then
  echo "ok   2: $N_RACERS simultaneous voters, $got rows, total shown $total"
else
  echo "FAIL 2: $N_RACERS simultaneous voters, $got rows, total shown $total"; fail=1
fi

# 3. one account, many notes at once: the ten-minute limit is five
AT="$(q -c "select (now() + interval '2 seconds')::text")"
for k in $(seq 1 12); do
  as "$(uid 3)" "select public.lab_comment_add('swarm', 'idea', 'racing note number $k')" &
done
wait
got="$(q -c "select count(*) from public.lab_comments where user_id = '$(uid 3)'")"
if [ "$got" = "5" ]; then
  echo "ok   3: 12 simultaneous notes from one account, 5 landed"
else
  echo "FAIL 3: 12 simultaneous notes from one account, $got landed (the limit is 5)"; fail=1
fi

exit $fail
