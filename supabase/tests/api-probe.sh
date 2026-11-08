#!/usr/bin/env bash
# ⛔ SCRATCH BRANCH chronicle/ci-probe-flow ONLY — never to be merged.
#
# The daily flow and the per-window marks through REAL Supabase Auth (GoTrue) and REAL PostgREST,
# in the `db guards` job's throwaway local stack. Two accounts are signed up through /auth/v1 with
# passwords generated here and never written down; every Chronicle call then goes over
# /rest/v1/rpc carrying that account's own access token, exactly as the browser's supabase-js does.
# The only thing done behind the API's back is giving the two accounts a profile row — the app's
# own sign-up flow does that through screens this cannot drive.
#
# Results go into public.api_probe for the SQL harness to judge, because psql's \! does not pass
# an exit code back.
set -u
eval "$(supabase status -o env | sed -e 's/^/export /')"
OUT=$(mktemp)
clean() { printf '%s' "$1" | tr '\t\\\n' '   ' | head -c 400; }
pass() { printf 't\t%s\n' "$(clean "$1")" >> "$OUT"; }
fail() { printf 'f\t%s\n' "$(clean "$1")" >> "$OUT"; }
check() { if [ "$1" = "$2" ]; then pass "$3"; else fail "$3 — got [$1], wanted [$2]"; fi; }
claim() {
  local p
  p=$(printf '%s' "$1" | cut -d. -f2 | tr '_-' '/+')
  while [ $(( ${#p} % 4 )) -ne 0 ]; do p="$p="; done
  printf '%s' "$p" | base64 -d 2>/dev/null | jq -r ".$2" 2>/dev/null
}

# one RPC: name, token, json body → sets CODE and BODY
rpc() {
  BODY=$(curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$1" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $2" -H 'Content-Type: application/json' -d "$3")
  CODE=$(printf '%s' "$BODY" | tail -n1)
  BODY=$(printf '%s' "$BODY" | sed '$d')
}
ok2xx() { case "$CODE" in 2*) pass "$1 ($CODE)" ;; *) fail "$1 — HTTP $CODE: $BODY" ;; esac; }
refused() {
  case "$CODE" in
    4*) pass "$1: refused (HTTP $CODE: $(printf '%s' "$BODY" | jq -r '.message // .code // .' 2>/dev/null))" ;;
    *) fail "$1 — was NOT refused: HTTP $CODE $BODY" ;;
  esac
}

signup() {
  curl -sS -X POST "$API_URL/auth/v1/signup" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$(openssl rand -hex 16)\"}"
}

A=$(signup "api-probe-a-$RANDOM@example.test")
B=$(signup "api-probe-b-$RANDOM@example.test")
TA=$(printf '%s' "$A" | jq -r '.access_token // empty')
TB=$(printf '%s' "$B" | jq -r '.access_token // empty')
UA=$(printf '%s' "$A" | jq -r '.user.id // empty')
UB=$(printf '%s' "$B" | jq -r '.user.id // empty')
if [ -z "$TA" ] || [ -z "$TB" ]; then
  fail "sign-up through /auth/v1 gave no session: $(printf '%s' "$A" | head -c 300)"
else
  pass "two accounts signed up through Supabase Auth, each with its own access token"
fi
check "$(claim "$TA" role)" "authenticated" "the token's role claim"
check "$(claim "$TA" sub)" "$UA" "the token's subject is the account that signed up"

psql "$DB_URL" -qX -v ON_ERROR_STOP=1 <<SQL
insert into public.player_registry (player_name) values ('apiprobea'), ('apiprobeb') on conflict do nothing;
insert into public.profiles (user_id, username, first_name, age_band, public_page, activity_visibility)
values ('$UA', 'apiprobea', 'Probe A', 'adult', false, 'members'),
       ('$UB', 'apiprobeb', 'Probe B', 'adult', false, 'members');
SQL

TODAY=$(date -u +%F); NEXT=$(date -u -d tomorrow +%F); AFTER=$(date -u -d '+2 days' +%F)
FROM="${TODAY}T00:00:00Z"; TO="${NEXT}T00:00:00Z"

# ── the daily flow, as A ──
rpc chronicle_activity_save "$TA" '{"p_id":null,"p_name":"API probe","p_cat":"free","p_colour":null,"p_metric":"reps","p_session":null,"p_shared":null}'
ok2xx "A saves an activity"; ACT=$(printf '%s' "$BODY" | jq -r '.')
rpc chronicle_start "$TA" "{\"p_activity\":\"$ACT\"}"
ok2xx "A starts it"; E1=$(printf '%s' "$BODY" | jq -r '.')
rpc chronicle_note_add "$TA" "{\"p_entry\":\"$E1\",\"p_body\":\"written through PostgREST\"}"
ok2xx "A writes a note on the running sitting"
rpc chronicle_entry_amount "$TA" "{\"p_id\":\"$E1\",\"p_amount\":9}"; ok2xx "A sets the count to 9"
rpc chronicle_entry_amount "$TA" "{\"p_id\":\"$E1\",\"p_amount\":9}"; ok2xx "A sets it to 9 again"

# ── B, on A's things ──
rpc chronicle_entry_amount "$TB" "{\"p_id\":\"$E1\",\"p_amount\":1}"; refused "B changing A's count"
rpc chronicle_note_add "$TB" "{\"p_entry\":\"$E1\",\"p_body\":\"not mine\"}"; refused "B writing on A's sitting"
rpc chronicle_entries_between "$TB" "{\"p_from\":\"$FROM\",\"p_to\":\"$TO\"}"
check "$(printf '%s' "$BODY" | jq -r --arg e "$E1" '[.[] | select(.id == $e)] | length')" "0" "B reading the day sees none of A's sittings"

# ── anon, with the publishable key and no session ──
rpc chronicle_start "$ANON_KEY" "{\"p_activity\":\"$ACT\"}"; refused "anon starting a timer"
rpc chronicle_entries_between "$ANON_KEY" "{\"p_from\":\"$FROM\",\"p_to\":\"$TO\"}"; refused "anon reading a day"

# ── what A reads back after a refresh ──
rpc chronicle_entries_between "$TA" "{\"p_from\":\"$FROM\",\"p_to\":\"$TO\"}"
ONE=$(printf '%s' "$BODY" | jq -c --arg e "$E1" '.[] | select(.id == $e)')
check "$(printf '%s' "$ONE" | jq -r '.amount')" "9" "A's count reads back as 9, after B's refused write"
check "$(printf '%s' "$ONE" | jq -r '.notes | length')" "1" "A's sitting carries exactly one note"
check "$(printf '%s' "$ONE" | jq -r '.end')" "null" "A's sitting reads back as running"

sleep 1.2
rpc chronicle_stop "$TA" '{"p_note":null}'; ok2xx "A stops"
rpc chronicle_entries_between "$TA" "{\"p_from\":\"$FROM\",\"p_to\":\"$TO\"}"
ONE=$(printf '%s' "$BODY" | jq -c --arg e "$E1" '.[] | select(.id == $e)')
if [ "$(printf '%s' "$ONE" | jq -r '.end')" != "null" ]; then pass "stop closed the sitting"; else fail "stop did not close the sitting: $ONE"; fi
check "$(printf '%s' "$ONE" | jq -r '.amount')" "9" "stop kept the count"

# ── the per-window marks (the drafts are applied earlier in this run) ──
rpc chronicle_goal_save "$TA" '{"p_id":null,"p_title":"Floss","p_scope":"day","p_anchor":null,"p_repeat":1,"p_target":null,"p_unit":null,"p_note":null,"p_sort":null,"p_activity":null,"p_cat":null,"p_counts":"minutes","p_est":null,"p_priority":0}'
ok2xx "A makes a repeating tick-box"; G=$(printf '%s' "$BODY" | jq -r '.')
rpc chronicle_goal_mark "$TA" "{\"p_goal\":\"$G\",\"p_from\":\"$TODAY\",\"p_starts\":\"$FROM\",\"p_ends\":\"$TO\",\"p_progress\":null,\"p_done\":true}"
ok2xx "A ticks it for today"
rpc chronicle_goal_mark "$TA" "{\"p_goal\":\"$G\",\"p_from\":\"$NEXT\",\"p_starts\":\"$TO\",\"p_ends\":\"${AFTER}T00:00:00Z\",\"p_progress\":null,\"p_done\":true}"
if [ "$(date -u +%H)" -lt 23 ]; then refused "A ticking tomorrow"; else pass "A ticking tomorrow: not asked, inside the hour's slack before midnight"; fi
rpc chronicle_goal_mark "$TB" "{\"p_goal\":\"$G\",\"p_from\":\"$TODAY\",\"p_starts\":\"$FROM\",\"p_ends\":\"$TO\",\"p_progress\":null,\"p_done\":false}"
refused "B unticking A's goal"
rpc chronicle_goal_mark "$ANON_KEY" "{\"p_goal\":\"$G\",\"p_from\":\"$TODAY\",\"p_starts\":\"$FROM\",\"p_ends\":\"$TO\",\"p_progress\":null,\"p_done\":false}"
refused "anon unticking A's goal"
ASK="{\"p_asks\":[{\"id\":\"$G\",\"from\":\"$TODAY\"},{\"id\":\"$G\",\"from\":\"$NEXT\"}]}"
rpc chronicle_goal_marks_for "$TA" "$ASK"
check "$(printf '%s' "$BODY" | jq -c --arg k "$G@$TODAY" '.marks[$k]')" '{"done":true,"progress":0}' "A reads today's tick back, after B's and anon's refused unticks"
check "$(printf '%s' "$BODY" | jq -r --arg k "$G@$NEXT" '.marks | has($k)')" "false" "tomorrow stays untouched"
rpc chronicle_goal_marks_for "$TB" "$ASK"
check "$(printf '%s' "$BODY" | jq -c '.marks')" '{}' "B asking for A's marks gets nothing"
rpc chronicle_goal_marks_for "$ANON_KEY" "$ASK"; refused "anon reading marks"

# ── the weekday schedules (the weekday draft is applied earlier in this run) ──
THREE_AGO=$(date -u -d '-3 days' +%F)
rpc chronicle_goal_days_set "$TA" "{\"p_goal\":\"$G\",\"p_days\":4,\"p_from\":\"$TODAY\"}"
ok2xx "A sets its tick-box for Tuesdays, from today"
rpc chronicle_goal_days_set "$TA" "{\"p_goal\":\"$G\",\"p_days\":4,\"p_from\":\"$THREE_AGO\"}"
refused "A backdating a schedule three days"
rpc chronicle_goal_days_set "$TB" "{\"p_goal\":\"$G\",\"p_days\":127,\"p_from\":\"$TODAY\"}"
refused "B scheduling A's goal"
rpc chronicle_goal_days_set "$ANON_KEY" "{\"p_goal\":\"$G\",\"p_days\":127,\"p_from\":\"$TODAY\"}"
refused "anon scheduling A's goal"
rpc chronicle_goals_mine "$TA" '{}'
check "$(printf '%s' "$BODY" | jq -cS --arg g "$G" '.[] | select(.id == $g) | .days')" "[{\"days\":4,\"from\":\"$TODAY\"}]" "A reads its schedule back, after B's and anon's refused writes"
check "$(printf '%s' "$BODY" | jq -r --arg g "$G" '.[] | select(.id == $g) | (.made | type)')" "number" "A's goal says when it was made"
rpc chronicle_goals_mine "$TB" '{}'
check "$(printf '%s' "$BODY" | jq -r --arg g "$G" '[.[] | select(.id == $g)] | length')" "0" "B's goals do not include A's"

# ── the sets (the sets draft is applied earlier in this run) ──
psql "$DB_URL" -qX -v ON_ERROR_STOP=1 <<SQL
insert into public.circuit_people (id, name, exercises, owner_user_id)
values ('api-probe-a', 'Probe A', '[{"id":"ex-quad","name":"Quad Curl","unit":"reps","mult":1,"col":0,"row":0}]', '$UA');
SQL
YDAY=$(date -u -d yesterday +%F)
rpc chronicle_set_add "$TA" "{\"p_person\":\"api-probe-a\",\"p_exercise\":\"ex-quad\",\"p_value\":20,\"p_day\":\"$TODAY\",\"p_entry\":null}"
ok2xx "A adds a set to its own person's exercise"
rpc chronicle_set_add "$TB" "{\"p_person\":\"api-probe-a\",\"p_exercise\":\"ex-quad\",\"p_value\":5,\"p_day\":\"$TODAY\",\"p_entry\":null}"
refused "B adding a set to A's person"
rpc chronicle_set_add "$ANON_KEY" "{\"p_person\":\"api-probe-a\",\"p_exercise\":\"ex-quad\",\"p_value\":5,\"p_day\":\"$TODAY\",\"p_entry\":null}"
refused "anon adding a set"
rpc chronicle_set_add "$TA" "{\"p_person\":\"api-probe-a\",\"p_exercise\":\"ex-quad\",\"p_value\":12,\"p_day\":\"$TODAY\",\"p_entry\":\"$E1\"}"
ok2xx "A adds a set during its sitting"
SETS="{\"p_from\":\"$YDAY\",\"p_to\":\"$AFTER\"}"
rpc chronicle_sets_between "$TA" "$SETS"
check "$(printf '%s' "$BODY" | jq -c '[.[] | .value] | sort')" '[12,20]' "A reads its two sets back, after B's and anon's refused writes"
rpc chronicle_sets_between "$TB" "$SETS"
check "$(printf '%s' "$BODY" | jq -c '.')" '[]' "B reading sets sees none of A's"
rpc chronicle_sets_between "$ANON_KEY" "$SETS"; refused "anon reading sets"
rpc chronicle_entries_between "$TA" "{\"p_from\":\"$FROM\",\"p_to\":\"$TO\"}"
ONE=$(printf '%s' "$BODY" | jq -c --arg e "$E1" '.[] | select(.id == $e)')
norm() { printf '%s' "$1" | jq -R -r 'sub("\\.[0-9]+";"") | sub("\\+00:00$";"Z") | fromdateiso8601 - 86400 | todateiso8601'; }
S0=$(norm "$(printf '%s' "$ONE" | jq -r '.start')"); S1=$(norm "$(printf '%s' "$ONE" | jq -r '.end')")
MOVE="{\"p_id\":\"$E1\",\"p_from\":\"$S0\",\"p_to\":\"$S1\",\"p_activity\":null,\"p_day\":\"$YDAY\"}"
rpc chronicle_entry_edit_day "$TB" "$MOVE"; refused "B moving A's sitting"
rpc chronicle_entry_edit_day "$ANON_KEY" "$MOVE"; refused "anon moving A's sitting"
rpc chronicle_entry_edit_day "$TA" "$MOVE"; ok2xx "A moves its sitting a day back, with its sets"
rpc chronicle_sets_between "$TA" "$SETS"
check "$(printf '%s' "$BODY" | jq -r --arg e "$E1" '[.[] | select(.entry == $e) | .on] | join(",")')" "$YDAY" "the sitting's set moved to the day before, once"

# ── links and the grid (the links and grid drafts are applied earlier in this run) ──
rpc chronicle_exercise_link "$TA" "{\"p_person\":\"api-probe-a\",\"p_exercise\":\"ex-quad\",\"p_activity\":\"$ACT\"}"
ok2xx "A links its Quad Curl to its activity, both in reps"
rpc chronicle_exercise_link "$TB" "{\"p_person\":\"api-probe-a\",\"p_exercise\":\"ex-quad\",\"p_activity\":null}"
refused "B unlinking A's exercise"
rpc chronicle_exercise_link "$ANON_KEY" "{\"p_person\":\"api-probe-a\",\"p_exercise\":\"ex-quad\",\"p_activity\":null}"
refused "anon unlinking A's exercise"
rpc chronicle_my_exercises "$TA" '{}'
check "$(printf '%s' "$BODY" | jq -c --arg a "$ACT" '[.[] | select(.exercise == "ex-quad") | [.canon, .activity == $a, .ok]]')" '[["reps",true,true]]' "A's exercises say Quad Curl is reps and linked"
rpc chronicle_set_add "$TA" "{\"p_person\":\"api-probe-a\",\"p_exercise\":\"ex-quad\",\"p_value\":7,\"p_day\":\"$YDAY\",\"p_entry\":\"$E1\"}"
ok2xx "A counts a linked set during its sitting"
rpc chronicle_entries_between "$TA" "{\"p_from\":\"${YDAY}T00:00:00Z\",\"p_to\":\"$TO\"}"
check "$(printf '%s' "$BODY" | jq -r --arg e "$E1" '.[] | select(.id == $e) | .amount')" "16" "the linked set is in the sitting's count, once (9 counted + 7)"
CELL="{\"p_person\":\"api-probe-a\",\"p_exercise\":\"ex-quad\",\"p_day\":\"$YDAY\",\"p_total\":25,\"p_seen_sessions\":19,\"p_seen_manual\":0}"
rpc circuit_cell_set "$TB" "$CELL"; refused "B typing into A's cell"
rpc circuit_cell_set "$ANON_KEY" "$CELL"; refused "anon typing into A's cell"
rpc circuit_cell_set "$TA" "$CELL"
check "$(printf '%s' "$BODY" | jq -c '[.total, .sessions, .manual]')" '[25,19,6]' "A types 25 over 19 from sessions, and 6 is what is stored"
rpc circuit_cell_set "$TA" "$CELL"; refused "A saving again from the stale screen"
SUMS="{\"p_from\":\"$THREE_AGO\",\"p_to\":\"$NEXT\"}"
rpc circuit_session_sums "$TA" "$SUMS"
check "$(printf '%s' "$BODY" | jq -c '[.[] | select(.person == "api-probe-a") | .value]')" '[19]' "A sees its own sessions in its cell"
rpc circuit_session_sums "$TB" "$SUMS"
check "$(printf '%s' "$BODY" | jq -c '[.[] | select(.person == "api-probe-a")]')" '[]' "B, in no circuit with A, sees none of A's sessions"

# ── the tables themselves, straight through the REST surface ──
# ⚠️ A REFUSAL OR AN EMPTY LIST, and which one is printed. A table can hold everything out by
# having no grants (refused) or by RLS with no policies (200 and []); the difference is worth
# seeing rather than asserting one of them.
table() {
  BODY=$(curl -sS -w '\n%{http_code}' "$API_URL/rest/v1/$2?select=*" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $3")
  CODE=$(printf '%s' "$BODY" | tail -n1); BODY=$(printf '%s' "$BODY" | sed '$d')
  case "$CODE" in
    4*) pass "$1 reading $2 directly: refused (HTTP $CODE)" ;;
    200) if [ "$BODY" = "[]" ]; then pass "$1 reading $2 directly: an empty list (RLS)"; else fail "$1 reading $2 directly got rows: $BODY"; fi ;;
    *) fail "$1 reading $2 directly — HTTP $CODE $BODY" ;;
  esac
}
for t in chronicle_goal_marks chronicle_entries chronicle_goal_days chronicle_sets chronicle_exercise_links; do
  table A "$t" "$TA"
  table anon "$t" "$ANON_KEY"
done

# hand the verdicts to the SQL harness
psql "$DB_URL" -qX -v ON_ERROR_STOP=1 -c "\copy public.api_probe(ok, detail) from '$OUT' with (format text)"
cat "$OUT"
