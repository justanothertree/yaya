# The four drafts, applied — 29 Oct 2026

✅ All applied. **Eight migrations**, because two of the four drafts were prose sketches rather
than SQL, one needed splitting so there was never a window where uploads were broken, and one
needed a follow-up to fix its own copy.

| migration                             | was                   | what it does                                                                                                                          |
| ------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `picture_ready_as_service`            | A8 (new)              | `picture_pending` also returns the owner; a 2-arg `picture_ready(uuid, uuid)` granted to `service_role` only                          |
| `picture_ready_revoke`                | `20261028190000`      | takes `picture_ready(uuid)` away from `authenticated`                                                                                 |
| `close_insert_allocation`             | `20261028120000`      | `is_admin()` gate, trade ownership, over-allocation bound; SECURITY DEFINER                                                           |
| `family_fund_safety`                  | `20261028120100` §1–2 | member write policies and grants off the three finance tables; two RESTRICT foreign keys; `admin_delete_member` counts accounts first |
| `admin_delete_member_counts_accounts` | follow-up             | the wording of that refusal: "1 fund account(s)" is admin-facing copy                                                                 |
| `finance_reads_respect_suspension`    | §3, was a sketch      | suspension + feature switch on `get_my_portfolio` / `get_my_timeline`                                                                 |
| `even_split_counts_eligible`          | §4, was a sketch      | the divisor and the counter in `admin_even_split_trades`                                                                              |
| `ktos_pep_are_family`                 | `20261028120200`      | the two designation rows, through the admin RPC                                                                                       |

Each migration's own header carries its measurements. This file is for the things that are about
more than one of them.

⚠️ **THE DIRECTORY AND THE DATABASE DRIFTED THE SAME DAY, AND THIS NOTE USED TO DESCRIBE THE
DRIFT RATHER THAN FIX IT.** It read "seven files, eight rows in `schema_migrations`" and explained
that the correction to `admin_delete_member` had been folded back into the family_fund_safety FILE
while the database kept both migrations — as though documenting that were enough. It was not: a
file no longer matched the migration of its own name, and the file NAMES were invented when the
files were written (0900–0924) rather than taken from the versions the server assigned
(152157–155118), so the two lists could not be read against each other at all.

Both are fixed. Every migration applied on 29 Oct now has a file named for its applied version,
including the two from an earlier session that had never been captured
(`picture_pending_for_size_check`, `positions_carry_allocation_row_count`) — ten files, ten rows.
Those two are byte-identical to the SQL that ran, recovered from `schema_migrations.statements`.

And the stronger property is checked rather than asserted: for each applied migration, every
`create or replace function` span was md5'd on both sides. **All ten match.** The standing query is
in `supabase/migrations/README.md`. The rule it encodes is worth keeping — a file's HEADER comments
are its own, but a comment INSIDE a function body is part of the stored definition, so a file that
differs there builds a different function on replay.

It took somebody counting two lists against each other to notice, which is exactly the kind of
check that happens once.

---

## The finding that changed the shape: two of the drafts broke each other

`close_insert_allocation` kept the guard **inside** `insert_allocation` so the admin UI's existing
call site would not have to change. `family_fund_safety` §1 revokes `INSERT` on
`finance.allocations` from `authenticated`. `insert_allocation` was SECURITY **INVOKER**, so its
insert ran as the caller — and applied in either order, the two drafts together would have left the
**admin** unable to hand-assign units, with no warning and nothing in either file to suggest it.

Measured, both halves, in rolled-back transactions:

```
as the admin, today                           inserted 1 unit
same call with §1's revoke applied first      ERROR 42501 permission denied for table allocations
                                              CONTEXT: insert_allocation(jsonb) line 28
```

The fix was not a third migration but a correction to the first: `insert_allocation` becomes
SECURITY DEFINER, which is what the `is_admin()` gate makes safe and what the house pattern wants
anyway — a deny-all table reached through a function that checks who is asking.

**The question that found it is worth keeping.** Not "what does this file change" but _which write
paths does it close, and which of them run as the caller_:

```sql
select n.nspname, p.proname, p.prosecdef as security_definer,
       has_function_privilege('authenticated', p.oid, 'execute') as authed_can_call
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public','finance') and p.prokind = 'f'
  and pg_get_functiondef(p.oid) ~*
      '(insert into|update|delete from)\s+finance\.(allocations|executed_trades|family_accounts)'
order by p.prosecdef, p.proname;
```

Ten functions. **Nine were already SECURITY DEFINER**; exactly one was not, and it was the one the
other draft was about. That ratio is the useful part: a revoke on a table in this project is almost
always inert, which is precisely why the one case that is not would have gone unnoticed.

## Before designating a symbol, ask about the whole sweep

`admin_set_symbol_designation` delegates to `admin_even_split_trades(v_uid, true)`, which picks up
**every** unallocated family-designated trade for that user — not the symbol on the button. So the
question before pressing it is never about the symbol:

```sql
select et.asset_symbol, et.platform, count(*) as unallocated,
       min(et.execution_time)::date as earliest,
       count(*) filter (where et.execution_time::date >=
         (select min(start_date) from finance.family_accounts)) as on_or_after_fund_start
from finance.executed_trades et
where et.user_id = (select user_id from public.admin_users limit 1)
  and not exists (select 1 from finance.allocations al where al.executed_trade_id = et.id)
  and coalesce((select sd.is_family from finance.symbol_designations sd
                where sd.asset_symbol = et.asset_symbol and sd.platform = et.platform), false)
group by 1, 2 order by 3 desc;
```

On 29 Oct: **159 unallocated designated trades across 39 symbol/platform pairs** — 97 SPCE, 12 BTC,
3 FHTX, the rest ones and twos — and **every one dated before the fund's start of 2025-12-10**, so
the sweep could allocate none of them. That zero is what made the designation safe, and it is a
figure with a date on it: an import is exactly the thing that would change it.

## What the fund's own numbers were, so a later reading has something to disagree with

Measured 29 Oct 2026: 33 family accounts, **1 owner**, 1 distinct `start_date` (2025-12-10), **0
with a NULL one**, 33 active, 14,223 allocations (363 of them negative), 1,721 trades (328 sells),
0 orphan allocations, 74 symbols in the chart's cost basis before KTOS and PEP and 76 after.

The single-owner figure is what bounds the urgency of the whole family-fund set: there is no second
member to protect anyone from yet. Everything in `family_fund_safety` becomes live on the first
handover.

⚠️ **`count(distinct start_date)` was the wrong question and gave the right answer by luck.** It
ignores NULLs, so an account with no start date would not have shown up in it — and `start_date` is
nullable, `admin_create_family_account` accepts a null, and `>= fa.start_date` is NULL for such a
row, which silently excludes it from every allocation while still counting it in the old divisor.
Asked properly (`count(*) - count(start_date)`) there are none. The even-split fix closes that door
for free by counting with the insert's own predicate instead of a second one that has to be kept in
agreement — which is the real lesson: **two predicates that must agree are a bug waiting for a
reason**.

## What is still open after today

- **One picture upload on evancook.dev.** Everything checkable here is checked — the deployed module
  is byte-identical to the repo (md5 `4f070d96d1edf024f474934d60eb2ed7`, v15), it answers an echo probe,
  the 2-arg RPC works as `service_role` and is refused to `authenticated`, and the live bundle
  contains no `picture_ready` call in any of its 42 chunks. What cannot be driven from a tool
  session is a real member JWT plus a real R2 PUT. If it fails, the undo is one line:
  `grant execute on function public.picture_ready(uuid) to authenticated;`
- **One Family/Personal toggle press in Investments → Trades**, which still needs an admin session
  in a browser. The wording, the CSS and the SQL are all checked; the wired component is not.
- **`allocations.executed_trade_id` still has no foreign key**, named rather than closed. Nothing
  deletes trades today — checked across every function in `public` and `finance` — so there is no
  path to the orphan. It becomes real the day a "remove an imported trade" control is added.
- **`admin_get_portfolios` and `admin_get_timeline` are unguarded** for suspension, unlike their
  member equivalents. The case is a suspended admin, which cannot currently exist.
- **Firefox and Safari**, as always.
