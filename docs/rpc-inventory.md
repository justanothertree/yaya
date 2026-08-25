# RPC inventory — public schema

Generated from the live database **2026-08-21**. Every function in `public`, with whether it runs
as `definer` (bypasses RLS) and the widest role that may execute it.

## Why this file replaced the old one

`supabase-rpcs.sql` called itself "authoritative definitions of public RPC functions". Checked
against the database on 2026-08-21 it documented **17 functions, of which 11 no longer exist** —
and the schema has **116**. So it described 5% of the surface, and two thirds of what it did
describe was gone. It had not been touched since 2026-06-07, and it also claimed to be "source of
truth for development & Copilot context", which means it was actively feeding wrong information
to anyone — human or assistant — who trusted it.

A hand-maintained list of a surface this size will drift again. Treat this file as a **dated
snapshot**, not a contract. The real source of truth is the database:

```sql
select p.proname, pg_get_function_identity_arguments(p.oid),
       p.prosecdef as definer,
       has_function_privilege('anon', p.oid, 'execute')          as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
order by p.proname;
```

Function **bodies** live in the Supabase migrations, not here. `docs/*.sql` dated files record
the reasoning behind individual changes.

## The standing rule this table exists to check

Only these seven may be executed by `anon`:

`circuit_public`, `get_invite_by_token`, `complete_member_signup`, `submit_score`,
`finalize_round_rpc`, `is_admin`, `submit_contact_message`

⚠️ `submit_contact_message` was added 2026-08-24 (the contact form has to work for a stranger)
and this list was not updated with it, so the audit below returned one row from that day on. A
standing check that always reports a finding is a standing check nobody reads. Re-verified
2026-08-25: with it added, the query returns zero rows.

Anything else showing `anon+auth` below is a finding. After any migration, re-run the standing
audit — it must return zero rows:

```sql
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
  and p.proname not in ('circuit_public','get_invite_by_token','complete_member_signup',
                        'submit_score','finalize_round_rpc','is_admin',
                        'submit_contact_message');
```

⚠️ `finalize_round_rpc` shows `service_role` below, not `anon` — it was tightened on 2026-08-20.
The allowlist above is the historical one; it is deliberately wider than reality.

## Inventory

| function                                                                                                                                                                                      | security | executable by |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------- |
| `_circuit_add_self(p_group uuid)`                                                                                                                                                             | definer  | service_role  |
| `_fund_timeline(p_uid uuid, p_all boolean)`                                                                                                                                                   | definer  | service_role  |
| `add_self_to_circuit(p_group uuid, p_name text, p_color text)`                                                                                                                                | definer  | authenticated |
| `admin_add_contribution(p_amount numeric, p_on date, p_note text)`                                                                                                                            | definer  | authenticated |
| `admin_correct_position(p_symbol text, p_platform text, p_true_units numeric)`                                                                                                                | definer  | authenticated |
| `admin_create_family_account(p_owner uuid, p_name text, p_dollar_per_day numeric, p_start_date date)`                                                                                         | definer  | authenticated |
| `admin_delete_contribution(p_id uuid)`                                                                                                                                                        | definer  | authenticated |
| `admin_delete_family_account(p_account uuid)`                                                                                                                                                 | definer  | authenticated |
| `admin_delete_member(p_user_id uuid)`                                                                                                                                                         | definer  | authenticated |
| `admin_even_split_trades(p_user_id uuid, p_only_active boolean)`                                                                                                                              | definer  | authenticated |
| `admin_fund_status()`                                                                                                                                                                         | definer  | authenticated |
| `admin_get_member(p_user_id uuid)`                                                                                                                                                            | definer  | authenticated |
| `admin_get_portfolios()`                                                                                                                                                                      | definer  | authenticated |
| `admin_get_timeline()`                                                                                                                                                                        | definer  | authenticated |
| `admin_import_trades(p_user_id uuid, p_trades jsonb)`                                                                                                                                         | definer  | authenticated |
| `admin_link_snake_handle(p_registry_id bigint, p_user_id uuid)`                                                                                                                               | definer  | authenticated |
| `admin_list_contributions()`                                                                                                                                                                  | definer  | authenticated |
| `admin_list_positions()`                                                                                                                                                                      | definer  | authenticated |
| `admin_list_snake_handles()`                                                                                                                                                                  | definer  | authenticated |
| `admin_member_features(p_user_id uuid)`                                                                                                                                                       | definer  | authenticated |
| `admin_reassign_family_account(p_account uuid, p_new_owner uuid)`                                                                                                                             | definer  | authenticated |
| `admin_set_feature(p_user_id uuid, p_feature text, p_enabled boolean)`                                                                                                                        | definer  | authenticated |
| `admin_set_price(p_symbol text, p_price numeric)`                                                                                                                                             | definer  | authenticated |
| `admin_set_suspended(p_user_id uuid, p_suspended boolean)`                                                                                                                                    | definer  | authenticated |
| `admin_set_symbol_designation(p_symbol text, p_platform text, p_family boolean)`                                                                                                              | definer  | authenticated |
| `admin_tax_status()`                                                                                                                                                                          | definer  | authenticated |
| `admin_update_family_account(p_account uuid, p_name text, p_dollar_per_day numeric, p_start_date date)`                                                                                       | definer  | authenticated |
| `admin_update_member(p_user_id uuid, p_first_name text, p_email text, p_role text)`                                                                                                           | definer  | authenticated |
| `are_friends(u1 uuid, u2 uuid)`                                                                                                                                                               | definer  | authenticated |
| `can_see(p_owner uuid, p_tier visibility_tier)`                                                                                                                                               | definer  | authenticated |
| `chat_messages_author_guard()`                                                                                                                                                                | definer  | service_role  |
| `chat_room_for_new_group()`                                                                                                                                                                   | definer  | service_role  |
| `chat_room_member(p_room uuid)`                                                                                                                                                               | definer  | authenticated |
| `chat_topic_member(p_topic text)`                                                                                                                                                             | definer  | authenticated |
| `circuit_can_edit_person(p_person text)`                                                                                                                                                      | definer  | authenticated |
| `circuit_can_see_log(p_log text)`                                                                                                                                                             | definer  | authenticated |
| `circuit_can_see_person(p_person text)`                                                                                                                                                       | definer  | authenticated |
| `circuit_default_group()`                                                                                                                                                                     | definer  | service_role  |
| `circuit_is_member(p_group uuid)`                                                                                                                                                             | definer  | authenticated |
| `circuit_public()`                                                                                                                                                                            | definer  | **anon+auth** |
| `claim_my_reserved_snake_name()`                                                                                                                                                              | definer  | authenticated |
| `claim_person(p_person_id text)`                                                                                                                                                              | definer  | authenticated |
| `claim_snake_name(p_name text)`                                                                                                                                                               | definer  | authenticated |
| `complete_member_signup(p_token uuid, p_username text, p_display_name text, p_contact_email text)`                                                                                            | definer  | **anon+auth** |
| `create_circuit(p_name text)`                                                                                                                                                                 | definer  | authenticated |
| `create_invite(p_class text, p_label text)`                                                                                                                                                   | definer  | authenticated |
| `delete_circuit(p_group uuid)`                                                                                                                                                                | definer  | authenticated |
| `delete_invite(p_id uuid)`                                                                                                                                                                    | definer  | authenticated |
| `delete_profile_note(p_id uuid)`                                                                                                                                                              | definer  | authenticated |
| `display_name(p_user uuid, p_group uuid)`                                                                                                                                                     | definer  | authenticated |
| `enforce_best_score()`                                                                                                                                                                        | invoker  | service_role  |
| `enforce_best_score(p_player_id integer, p_game_mode text)`                                                                                                                                   | invoker  | authenticated |
| `finalize_round_rpc(p_room_id text, p_round_id text, p_game_mode text, p_items jsonb, p_players jsonb)`                                                                                       | definer  | service_role  |
| `find_member_by_username(p_username text)`                                                                                                                                                    | definer  | authenticated |
| `get_allocations(uid uuid)`                                                                                                                                                                   | invoker  | authenticated |
| `get_executed_trades(uid uuid)`                                                                                                                                                               | invoker  | authenticated |
| `get_invite_by_token(p_token uuid)`                                                                                                                                                           | definer  | **anon+auth** |
| `get_member_activity(p_username text, p_limit integer)`                                                                                                                                       | definer  | authenticated |
| `get_member_profile(p_username text)`                                                                                                                                                         | definer  | authenticated |
| `get_my_portfolio()`                                                                                                                                                                          | definer  | authenticated |
| `get_my_profile()`                                                                                                                                                                            | definer  | authenticated |
| `get_my_timeline()`                                                                                                                                                                           | definer  | authenticated |
| `get_profile_blocks(p_username text)`                                                                                                                                                         | definer  | authenticated |
| `get_usernames_for_users(p_user_ids uuid[])`                                                                                                                                                  | definer  | authenticated |
| `guestbook_open_to(p_owner uuid)`                                                                                                                                                             | definer  | authenticated |
| `insert_allocation(payload jsonb)`                                                                                                                                                            | invoker  | authenticated |
| `insert_allocation(uid uuid, payload jsonb)`                                                                                                                                                  | invoker  | authenticated |
| `is_admin()`                                                                                                                                                                                  | invoker  | **anon+auth** |
| `is_suspended(p_user_id uuid)`                                                                                                                                                                | definer  | authenticated |
| `join_circuit(p_code text)`                                                                                                                                                                   | definer  | authenticated |
| `leaderboard_no_score_drop()`                                                                                                                                                                 | invoker  | service_role  |
| `leave_circuit(p_group uuid)`                                                                                                                                                                 | definer  | authenticated |
| `link_snake_names_to_accounts()`                                                                                                                                                              | definer  | authenticated |
| `list_activity_notices()`                                                                                                                                                                     | definer  | authenticated |
| `list_chat_overview()`                                                                                                                                                                        | definer  | authenticated |
| `list_friends()`                                                                                                                                                                              | definer  | authenticated |
| `list_fund_symbols()`                                                                                                                                                                         | definer  | authenticated |
| `list_invites()`                                                                                                                                                                              | definer  | authenticated |
| `list_member_directory()`                                                                                                                                                                     | definer  | authenticated |
| `list_members()`                                                                                                                                                                              | definer  | authenticated |
| `list_profile_notes(p_username text, p_limit integer)`                                                                                                                                        | definer  | authenticated |
| `list_room_messages(p_room uuid, p_limit integer)`                                                                                                                                            | definer  | authenticated |
| `mark_activity_seen()`                                                                                                                                                                        | definer  | authenticated |
| `mark_room_read(p_room uuid)`                                                                                                                                                                 | definer  | authenticated |
| `my_account()`                                                                                                                                                                                | definer  | authenticated |
| `my_circuits()`                                                                                                                                                                               | definer  | authenticated |
| `my_features()`                                                                                                                                                                               | definer  | authenticated |
| `my_fund_status()`                                                                                                                                                                            | definer  | authenticated |
| `my_lounge_display_name()`                                                                                                                                                                    | definer  | authenticated |
| `my_lounge_opt_in()`                                                                                                                                                                          | definer  | authenticated |
| `my_snake_handles()`                                                                                                                                                                          | definer  | authenticated |
| `open_dm(p_username text)`                                                                                                                                                                    | definer  | authenticated |
| `player_registry_default_reveal()`                                                                                                                                                            | definer  | service_role  |
| `post_profile_note(p_username text, p_body text)`                                                                                                                                             | definer  | authenticated |
| `presence_audience_ok(p_owner uuid)`                                                                                                                                                          | definer  | authenticated |
| `presence_topic_member(p_topic text)`                                                                                                                                                         | definer  | authenticated |
| `remove_friend(p_username text)`                                                                                                                                                              | definer  | authenticated |
| `rename_circuit(p_group uuid, p_name text)`                                                                                                                                                   | definer  | authenticated |
| `request_friend(p_username text)`                                                                                                                                                             | definer  | authenticated |
| `respond_friend(p_username text, p_accept boolean)`                                                                                                                                           | definer  | authenticated |
| `save_my_profile_blocks(p_blocks jsonb)`                                                                                                                                                      | definer  | authenticated |
| `send_chat_message(p_room uuid, p_body text)`                                                                                                                                                 | definer  | authenticated |
| `set_lounge_display_name(p_name text)`                                                                                                                                                        | definer  | authenticated |
| `set_lounge_opt_in(p_on boolean)`                                                                                                                                                             | definer  | authenticated |
| `set_my_activity_visibility(p_tier visibility_tier)`                                                                                                                                          | definer  | authenticated |
| `set_my_circuit_nickname(p_group uuid, p_nickname text)`                                                                                                                                      | definer  | authenticated |
| `set_my_nicknames(p_nickname text, p_circuit_nickname text, p_snake_nickname text)`                                                                                                           | definer  | authenticated |
| `set_my_profile_look(p_theme text, p_palette jsonb, p_flair text)`                                                                                                                            | definer  | authenticated |
| `set_my_snake_visibility(p_tier visibility_tier)`                                                                                                                                             | definer  | authenticated |
| `set_person_visibility(p_person_id text, p_tier visibility_tier)`                                                                                                                             | definer  | authenticated |
| `snake_display_name(p_user uuid)`                                                                                                                                                             | definer  | authenticated |
| `snake_friend_names()`                                                                                                                                                                        | definer  | authenticated |
| `submit_score(p_name text, p_score integer, p_game_mode text, p_apples integer, p_time integer, p_created_at timestamptz)`                                                                    | definer  | **anon+auth** |
| `uid_for_username(p_username text)`                                                                                                                                                           | definer  | authenticated |
| `update_my_profile(p_first_name text, p_middle_name text, p_last_name text, p_contact_email text, p_phone text, p_birthday text, p_address text, p_venmo text, p_cashapp text, p_zelle text)` | definer  | authenticated |
| `upsert_prices(p_prices jsonb)`                                                                                                                                                               | definer  | authenticated |
| `voice_topic_member(p_topic text)`                                                                                                                                                            | definer  | authenticated |

## Notes worth carrying

- **`snake_display_name(p_user uuid)` takes a raw uuid and applies no visibility check.** It is
  fine as used, but it is what turns a leaked `user_id` into a member's name — which is why
  `player_registry.user_id` is excluded from that table's SELECT grant.
- **`get_allocations` / `get_executed_trades` are called through a VARIABLE**
  (`sb.rpc(fn, { uid })`) with paging past PostgREST's 1000-row cap. A grep for
  `rpc('get_allocations')` finds nothing and they look dead. They are not.
- `insert_allocation` exists in two overloads; both are `invoker`, so RLS applies normally.
- **`admin_tax_status()` (added 2026-08-25)** reads `finance.holding_periods()`, which is revoked
  from `anon` AND `authenticated` — it is reachable only through this definer wrapper, and only
  after `is_admin()`. Verified: a signed-in non-admin gets "admin only".
