# RPC inventory — public schema

**There is no table in this file any more, and that is the point.**

The previous version opened by explaining that `supabase-rpcs.sql` had documented 17 functions of
which 11 no longer existed, out of a schema of 116 — 5% coverage, two thirds of it wrong — and
that a hand-maintained list of a surface this size would drift again. Then it listed 116 rows by
hand.

It drifted. Checked 2026-09-15 during a security sweep, four weeks after it was written:

- it claimed seven functions may be executed by `anon`. Two of those (`complete_member_signup`,
  `finalize_round_rpc`) had been revoked on 2026-09-04 by a migration in this same folder.
- three more had been added since (`get_demo_profile`, `get_public_profile`,
  `get_public_activity`) and were not in it.
- the schema had grown from 116 functions to 152.

So the list was wrong in both directions — naming functions anon cannot call, and missing ones it
can. A standing check that is wrong is worse than no standing check, because somebody trusts it.

**What replaces it: the questions, and how to ask them.** Every heading below is a rule that should
hold, with the query that proves it. Run them; do not trust a copy of their output, including the
dated one at the bottom of this file.

---

## Who may execute what

```sql
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as definer,
       has_function_privilege('anon', p.oid, 'execute')          as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as member
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
order by anon desc, p.proname;
```

## Rule 1 — the anon surface is small and every entry is deliberate

```sql
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
  and has_function_privilege('anon', p.oid, 'execute')
order by 1;
```

Each one exists because somebody who is not signed in genuinely needs it:

| function                 | why anon                                                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `circuit_public`         | the public board. Filtered to `visibility = 'public'` inside the function.                                                               |
| `get_demo_profile`       | one profile anybody may look at. Takes no argument, so nothing can be pointed at.                                                        |
| `get_public_profile`     | a page its owner published. Requires `public_page` on that row.                                                                          |
| `get_public_activity`    | the same, for activity. Requires `public_page` **and** `activity_visibility = 'public'`.                                                 |
| `get_invite_by_token`    | you read an invite before you have an account. Needs the uuid already.                                                                   |
| `submit_score`           | a stranger finishes a game of Snake. Bounded and rate limited.                                                                           |
| `submit_contact_message` | a visitor uses the contact form. Validated and rate limited.                                                                             |
| `is_admin`               | called inside policies, so anon needs execute for `public`-tier rows to resolve. Returns **false** for a stranger — verified 2026-09-15. |

⚠️ **The standing rule is "don't grant what cannot be used."** Four functions were revoked on
2026-09-04 that already refused anon on their own first line, precisely so this list stays short
enough to read in one go. Two more were revoked on 2026-09-15 (`set_my_public_page`,
`get_my_public_page`) for the same reason.

⚠️ **`revoke ... from public` is NOT enough in this project.** It was assumed that `anon` inherits
through `PUBLIC`; it does not — `anon` holds execute directly, so a revoke aimed at `PUBLIC` leaves
it untouched. This was found by probing the live site, not by reading the SQL, which had looked
correct. Always `revoke all ... from public, anon` and then verify with the query above.

## Rule 2 — no SECURITY DEFINER resolves names through the caller's path

Expect zero rows. A definer without a pinned `search_path` is the classic privilege-escalation
shape.

```sql
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and not exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c
                  where c like 'search_path=%')
order by 1;
```

## Rule 3 — nothing named for your own row takes a target

Expect zero rows. These are safe because they read `auth.uid()` and accept no target; this is the
check that notices the day one grows a parameter.

```sql
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (p.proname like 'set_my_%' or p.proname like 'update_my_%' or p.proname like 'get_my_%')
  and pg_get_function_identity_arguments(p.oid) ilike '%user%'
order by 1;
```

## Rule 4 — no table is readable without RLS

Expect zero rows. RLS **on** with zero policies is deny-all and is the deliberate shape for tables
reached only through definer RPCs (`profile_blocks`, `profile_notes`, `member_library`). RLS
**off** with a grant is the hole.

```sql
select n.nspname, c.relname,
       has_table_privilege('anon', c.oid, 'select')          as anon,
       has_table_privilege('authenticated', c.oid, 'select') as member
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r' and n.nspname in ('public','finance')
  and not c.relrowsecurity
  and (has_table_privilege('anon', c.oid, 'select')
    or has_table_privilege('authenticated', c.oid, 'select'));
```

## Rule 5 — one member cannot read another

The full version is `docs/2026-09-15-member-to-member-sweep.sql`, which simulates a session. The
short form: as a signed-in member, `public.profiles` returns **exactly one row — your own**.
Members never read each other's rows directly; every cross-member read goes through a definer RPC
that consults `can_see`.

---

## Notes worth carrying

- **`snake_display_name(p_user uuid)` takes a raw uuid and applies no visibility check.** Fine as
  used, but it is what turns a leaked `user_id` into a member's name — which is why
  `player_registry.user_id` is excluded from that table's SELECT grant, and why no anon payload
  contains a user id. Checked on `get_public_profile` 2026-09-15: it returns none.
- **`get_allocations` / `get_executed_trades` are called through a VARIABLE**
  (`sb.rpc(fn, { uid })`) with paging past PostgREST's 1000-row cap. A grep for
  `rpc('get_allocations')` finds nothing and they look dead. They are not.
- `insert_allocation` exists in two overloads; both are `invoker`, so RLS applies normally.
- **`admin_tax_status()`** reads `finance.holding_periods()`, which is revoked from `anon` AND
  `authenticated` — reachable only through this definer wrapper, and only after `is_admin()`.
- **`get_member_activity` no longer raises on a null session** (2026-09-15). That line was
  redundant rather than load-bearing — the GRANT is the gate, and `can_see` returns true for
  exactly one tier when nobody is signed in. It lets `get_public_activity` delegate instead of
  duplicating sixty lines of points arithmetic.

---

## Snapshot, 2026-09-15

Counts only, deliberately — a list would rot the way the last one did.

|                                         |     |
| --------------------------------------- | --- |
| functions in `public`                   | 152 |
| `SECURITY DEFINER`                      | 144 |
| executable by `authenticated`           | 142 |
| executable by `anon`                    | 8   |
| definers without a pinned `search_path` | 0   |
| tables readable with RLS off            | 0   |
| `set_my_*` / `get_my_*` taking a target | 0   |
