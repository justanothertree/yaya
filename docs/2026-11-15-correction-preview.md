# Previewing the correction-follows-ownership migration — 15 Nov 2026

Read-only reconnaissance run against production before applying
`2026-11-14-correction-follows-ownership.sql`, at **14:03 UTC / 09:03 Eastern**. Nothing in this
file wrote anything; every figure is a `select`.

## ⚠️ First, what this migration is, because "which rows change" has a surprising answer

It is one `create or replace function` plus a `revoke` and a `grant`. **It contains no DML. It
changes zero rows**, and it cannot move the portfolio total, the cash line, any holding or any
account's worth — not by a cent, not in either direction.

What it changes is a **decision a future correction will make**. `admin_correct_position` is the
✏️ button an admin presses to assert the true unit count after a split the broker export missed;
it inserts a zero-dollar delta and then decides how much of that delta belongs to the family. The
old text asked the symbol's `symbol_designations` flag. The new text asks
`finance.family_share_at`, which is the family's actual ownership.

So the honest form of "show me the rows that change, before and after" is: **show the decision for
every position in the book, under both texts**. That is the table below, and it is the whole book —
203 positions, not a sample.

## The decision table: all 203 positions, old gate vs new

| Bucket                                     | Positions | Held  | Verdict     |
| ------------------------------------------ | --------- | ----- | ----------- |
| A · designated family, family owns units   | 77        | 77    | unchanged   |
| B · designated family, family owns none    | 3         | 2     | unchanged   |
| C · personal, family owns none             | 118       | 22    | unchanged   |
| **D · family owns it, no designation row** | **5**     | **5** | **CHANGES** |

Bucket A is the important one for safety: those 77 already used `family_share_at` for the
arithmetic — the old flag only decided _whether_ to ask it. A symbol like WEN at 53% family
computed 53% before and computes 53% after. Bucket B is the case the flag was genuinely achieving
something for, and `family_share_at` returns 0 there anyway, because it is zero when they hold
nothing. That is why the flag had nothing left to decide.

The proposal file's header predicted this count as **5** before the query was written. It is 5.

## Bucket D, in full — the five that change

All Robinhood, all introduced by the 15 Nov 02:12 UTC import, all still unpriced because the day's
price sweep runs at 21:10–21:16 UTC and has not run since 14 Nov 21:16.

| Symbol | Whole units | Family units | Accounts | Designation | Share before | Share after  | Cost    |
| ------ | ----------- | ------------ | -------- | ----------- | ------------ | ------------ | ------- |
| GENI   | 33.000000   | 33.000000    | 33       | (no row)    | 0            | **1.000000** | $209.39 |
| SKHY   | 1.000000    | 1.000000     | 33       | (no row)    | 0            | **1.000000** | $191.58 |
| AKAM   | 1.088300    | 1.088300     | 33       | (no row)    | 0            | **1.000000** | $132.00 |
| CURI   | 33.000000   | 33.000000    | 33       | (no row)    | 0            | **1.000000** | $102.80 |
| MNRO   | 3.300000    | 3.300000     | 33       | (no row)    | 0            | **1.000000** | $46.07  |

79.956946 units, $813.84 at cost. Every one of them is **100% family-owned** — not a partial
share, the whole position — and every one of them reads 🔒 Personal to the gate. A 2-for-1 on GENI
corrected today would mint 33 units and hand the family **none** of them, taking them from 100% of
that position to 50% in one press, silently, because `familyUnits` would not change — the
denominator would.

That is the loss. It is latent rather than realised: nothing has been corrected on these five, so
no units have actually gone astray.

## The baseline, so "it changed nothing" is falsifiable rather than asserted

Taken before applying, to be re-taken after. Per §4 the payload fingerprint is the real check — it
is the md5 of all 33 `finance.account_payload()` outputs, which is what the member cards and the
Reconcile table are built from.

| Measure                         | Before applying                            |
| ------------------------------- | ------------------------------------------ |
| `account_payload` md5, 33 accts | `ad79add6983eeb9596b5a149486aef9f`         |
| executed_trades                 | 1,774 (`67197e3e…`)                        |
| allocations                     | 15,840 (`d7379a87…`)                       |
| symbol_designations             | 84 (`ee6f4285…`)                           |
| family_accounts                 | 33 (`aed8a94e…`)                           |
| price_cache                     | 182 (`43e1514c…`), newest 14 Nov 21:16 UTC |
| Fund worth                      | $12,534.59                                 |
| Fund cash                       | $0.00                                      |
| Fund contributed                | $18,104.13                                 |
| Fund held basis                 | $17,610.12                                 |
| Holding rows / unpriced         | 2,706 / 198                                |

## The brokers, and why this migration cannot close those gaps

Asked because the instruction was to confirm the totals against the two apps. They do not match,
they did not match yesterday, and **this migration has no bearing on any of it** — stated plainly
so that the two are never conflated.

| Number           | Page           | Broker app     | Gap         | Cause                                         |
| ---------------- | -------------- | -------------- | ----------- | --------------------------------------------- |
| Cash App stocks  | $13,563.93     | $13,527.00     | +36.93      | Friday close vs extended-hours last price     |
| Cash App bitcoin | $2,532.46      | $2,558.30      | −25.84      | BTC cached 17h ago; it trades round the clock |
| Robinhood stocks | $6,281.87      | $7,259.00      | −977.13     | **7 positions still unpriced, so excluded**   |
| Robinhood crypto | $32.65         | $35.00         | −2.35       | same 17h staleness, and $35 is rounded        |
| **Everything**   | **$22,410.91** | **$23,379.30** | **−968.39** | 98% is the Robinhood row                      |

Every one of these is a **price clock**, and the fix for the big one shipped in #339: the import
panel now asks for a price pass itself instead of leaving new symbols to wait for 21:10 UTC. None
of it is what `admin_correct_position` does.

## ⚠️ OUTCOME: the preview passed, and the apply was refused by the tooling

Recorded here because the two are easy to confuse and the distinction is the whole point of
running a preview. **The preview matched.** What stopped the migration was this session's
permission classifier refusing `apply_migration`, which fires before the call reaches the
database.

Production was re-measured immediately afterwards to be certain the refusal happened _before_
execution rather than part-way through it:

| Check                           | Result                                              |
| ------------------------------- | --------------------------------------------------- |
| `admin_correct_position` md5    | `b209b089d5a5da4d563f6303a7a124ba` — **unchanged**  |
| Old gate still present?         | yes — `coalesce(sd.is_family, false) into v_family` |
| `account_payload` md5, 33 accts | `ad79add6983eeb9596b5a149486aef9f` — **identical**  |
| executed_trades / allocations   | 1,774 / 15,840 — unchanged                          |
| Newest recorded migration       | `20261115002456` (main's lab migration, not this)   |

So the five positions are still exposed, and the rollback saved alongside this file is still a
description of the live function rather than of a previous one.

**What applying it needs**, when it is next attempted: the exact body is 3,235 bytes, md5
`acb9c5964b8394f87c45636f48ed53b4`, with no trailing newline and no CR — fingerprinted with the
repository's own `bodyOf()` from `scripts/migration-md5.mjs`, so the figure is what that check
will recompute rather than a separate opinion about it. After applying, `statements[1]` should
md5 to the same value; if it does not, the text drifted in transit and the difference is worth
reading before anything else. Then the file goes in `supabase/migrations/` with its line in
`applied.md5`, which is why no migration file is committed yet: §4's protocol makes a file
without a recorded hash a build failure, and the hash cannot exist before the statement runs.

## Safety checks run before applying

- **Nothing else calls it.** A `pg_get_functiondef` sweep over every function in the database for
  the string `admin_correct_position` returns no other caller. No view, no trigger, no RPC.
- **One signature only**, so `create or replace` replaces rather than overloading:
  `admin_correct_position(text,text,numeric)`.
- **The ACL is unchanged by design.** `create or replace function` preserves privileges, and the
  migration's `revoke … from public, anon` is a reaffirmation of the house pattern rather than a
  change: `anon` already held nothing. Before: `anon=false, authenticated=true,
service_role=true`. A revoke aimed at `public, anon` cannot touch `service_role`'s own explicit
  grant — which is the half of §3's revoke rule that is easy to get backwards.
- **A byte-exact rollback is saved** at `2026-11-15-correct-position-rollback.sql`, proved to be
  production's own text by md5 (`b209b089d5a5da4d563f6303a7a124ba`) rather than retyped.

## One piece deliberately not applied

The proposal file also sketches **integrity check 10**, "held by the family but the symbol is not
marked", and explains why it is a sketch: the body of `finance.integrity_checks()` is 6 kB and
copying it into a proposal is how a copy and its original drift. It remains unwritten.

The read side of that finding did ship in #339 — the positions row now names the units the family
holds while the symbol still reads Personal — so the state is visible on the screen. What it is
not yet is visible in the Reconcile banner or the attention badge, which are built on
`integrity_checks()`. Worth doing, as its own change, written against the live body rather than a
copy of it.
