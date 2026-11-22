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

## ✅ OUTCOME: applied 16 Nov 2026 02:08:28 UTC

Applied as `20261116020828_correction_follows_ownership` after Evan's go-ahead. The first attempt,
on 15 Nov, was refused by this session's permission classifier before the call reached the
database — recorded here because that refusal and a failed migration look identical from outside,
and the distinction is the whole point of keeping a preview. Production was re-measured after the
refusal and was byte-identical, so nothing was ever half-done.

| Measure                                  | Before (02:05 UTC)                 | After (02:09 UTC)                      |
| ---------------------------------------- | ---------------------------------- | -------------------------------------- |
| `admin_correct_position` functiondef md5 | `b209b089d5a5da4d563f6303a7a124ba` | **`5f10f7e40e747bc4294b3c634a95ea57`** |
| Old gate `coalesce(sd.is_family…)`       | present                            | **gone**                               |
| New gate `v_share := family_share_at`    | absent                             | **present**                            |
| Signatures                               | 1                                  | 1 (replaced, not overloaded)           |
| `account_payload` md5, 33 accts          | `4cdb5581d2c9b9c722461c375c82cbef` | `4cdb5581d2c9b9c722461c375c82cbef`     |
| executed_trades / allocations            | 1,774 / 15,840                     | 1,774 / 15,840                         |
| ACL anon / authed / service_role         | false / true / true                | false / true / true                    |

`statements[1]` md5s to `acb9c5964b8394f87c45636f48ed53b4` at **3,235 bytes** — byte for byte the
runnable portion of the proposal file through the repository's own `bodyOf()`. That is the only
check that proves the deployed text is the reviewed text: `apply_migration` takes the SQL inline
and shows no diff, so a dropped character would otherwise reach production unseen. The migration
file and its `applied.md5` line were written from the same figure, and `scripts/migration-md5.mjs`
was made to **fail once** against it — one byte changed in the body, and it named the file and both
hashes — before its pass was believed.

### ⚠️ And the baseline above is not the one this document recorded

`ad79add6983eeb9596b5a149486aef9f` was the payload fingerprint at 14:03 UTC. By 02:05 the next
morning it was `4cdb5581…`, and a literal reading of "stop if anything differs" would have stopped
there. The cause was found before anything was applied, and it is a cron job this very document
predicted: the **15 Nov 21:10–21:16 UTC price sweep** ran, taking `price_cache` from 182 rows to
189 and pricing the seven positions the audit found unpriced.

Everything else the payload reads was unchanged — trades, allocations, designations, accounts,
contributions, overrides, each asked separately so the answer named a cause instead of leaving
"something moved". And `finance.family_share_at` is **units-only**, so no price can reach the
decision under test: the whole-book table re-ran to the same **77 / 3 / 118 / 5**, and bucket D was
the same five symbols at the same units.

One figure did move for a reason that was mine rather than production's: bucket C's _held_ count
read 21 against the preview's 22. The preview counted `abs(units) > DUST_UNITS` and the re-run
counted `units > DUST_UNITS`, and exactly one position can tell those apart — **LCID at −0.003975**,
the documented symbol-change residue, in the bucket this migration does not touch. Named rather
than reasoned about, because a one-off discrepancy in a safety check is the last place to accept an
argument instead of a row.

**The rule worth keeping**: a recorded fingerprint is a measured claim with a date on it, and a
daily cron is what spends it. The before/after pair that means anything is taken **back to back,
minutes apart**, with the cron calendar checked first — all four price jobs run 21:10–21:16 UTC, so
02:05 was ~19 hours of quiet either side. Comparing against yesterday's figure would have rolled
back a correct migration.

### Re-measured 17 Nov 2026, before releasing this record

Both figures above were asked of production again on the way to the merge, because a hash in a
document is a measured claim with a date on it and this document is the claim.
`integrity_checks` is `8decb4325a8c0a54fa6af4e06dc0b2aa` at 9,188 bytes and
`admin_correct_position` is `5f10f7e40e747bc4294b3c634a95ea57` at 3,046 bytes, both unchanged,
with `anon` still refused. **The two rows are measured different ways** — `prosrc` for the
first and `pg_get_functiondef` for the second — which is recorded in the reasoning file now,
because re-measuring the second the first's way gives a different hash about an identical
function.

One thing that came out of asking: **`prosrc ~ 'coalesce\(sd\.is_family'` is still true, and the
match is inside the comment the migration added.** The comment explains the gate that was
removed, so a substring sweep for the old code finds the sentence describing its removal and
reports the old code present. The executable gate is one line
(`v_share := finance.family_share_at(...)`) and there is no other. A sweep for removed code has
to ask whether the match is in a statement, not in the file — the same shape as
`grep dist/` finding a constant in a comment.

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

## The piece that was deliberately not applied — now written, and applied

The proposal file sketched **integrity check 10**, "held by the family but the symbol is not
marked", and explained why it was only a sketch: the body of `finance.integrity_checks()` is 6 kB
and copying it into a proposal is how a copy and its original drift.

It is written as `docs/2026-11-16-integrity-check-10.sql` and ✅ **applied 16 Nov 2026 03:16:37
UTC** as `20261116031637`, after a read-only preview and Evan's go-ahead. Reconcile is ten checks,
the badge went 2 → 3, check 10 reads 5, and the payload fingerprint was unchanged either side. The
way around the copying problem was not a more careful copy: the new body is two anchored string
replacements applied by script to the repository's own committed text, which throws if either
anchor is missing, so the nine existing checks are identical by construction. `diff` against the
committed body is exactly **two hunks, one line removed**.

Writing it properly found two things the sketch could not, and both would have shipped:

- **`order by c->>'ord'` is a text sort.** Nine checks could never expose it; a tenth does, and
  check 10 would have appeared second in the list with nothing on screen to say so. Measured, not
  reasoned about: `order by v` over 1..10 gives `1, 10, 2, 3, …`.
- **The sketch's `meaning` was already false.** It named the correction handing the family none of
  it — which the migration at the top of this document fixed an hour earlier. Two pieces of live
  copy in `Investments.tsx` said the same thing and were corrected in the same sitting.

The read side of that finding did ship in #339 — the positions row now names the units the family
holds while the symbol still reads Personal — so the state is visible on the screen. What it is
not yet is visible in the Reconcile banner or the attention badge, which are built on
`integrity_checks()`. Worth doing, as its own change, written against the live body rather than a
copy of it.
