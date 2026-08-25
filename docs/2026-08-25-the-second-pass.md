# The rest of the review — 2026-08-25

Follow-up to the same day's sweep. Everything here was proposed by the audit and left as "your
call"; this is what actually got done.

## Family fund (worth) was $461.87 of Evan's own money

The Trades tab summed the **whole** market value of every family-**designated** position:

```tsx
const familyValue = positions.reduce((sum, p) => sum + (p.isFamily ? (p.value ?? 0) : 0), 0)
```

Designation is a decision about a symbol; ownership is the allocations. SPCE is designated family
and 1.2% Evan's, WEN is 46.7% his, and OLOX and FHTX carry pre-fund history that was correctly
never allocated.

|                      |             |
| -------------------- | ----------- |
| what the stat said   | $14,054.46  |
| what the family owns | $13,592.59  |
| overstated by        | **$461.87** |

`admin_list_positions` now returns `familyUnits` and `familyValue` from the allocations — the
addition `docs/2026-08-23-integrity-sweep.sql` suggested ("Worth ADDING the family's share beside
it one day"). The figure now agrees with `accountReserved()`, `portfolioTotals().value`,
ReconcilePanel's family total and the Tax view, which are four routes that previously produced
three answers.

Second bug in the same two lines: `?? 0` booked an unpriced position as worth **zero** inside a
1.6rem hero stat. Both figures now sum only what is priced and say how many were left out —
ReconcilePanel has done this correctly all along. The `Math.max(0, …)` on "Still yours" went too:
a negative there means the allocations claim more than you hold, which integrity check 7 exists
to catch, and clamping it just hid the sign.

## Two integrity checks that could not see their own blind spots

**#8 — small over-credits that add up.** #7 tests each symbol against a dollar, which is right for
the failure it names. It is structurally blind to the opposite shape. Measured: #7 read `0` while
**23 symbols** were over-credited by a total of **$0.56** — the 2025-12-01 broker unit-corrections
predate the fund start, so they were correctly left unallocated and nobody reduced the family's
share to match. Both checks now read one shared body, `finance.position_overcredit()`.

**#9 — marked family, but nothing can be allocated.** A symbol whose every trade predates the fund
can never be allocated (the `start_date` rule, correctly) and is invisible to
`trades_needing_review` for the same reason, so `admin_attention` never counted it either. **AEON
and NFLX** have sat like that since 2025-12-05 and 2025-12-08 — $115.77 at cost, designated
theirs, belonging to nobody. The check now reads **2**, on the Reconcile screen, with a sentence
saying what to do about it.

## A field called `cost` that was not a cost

`account_payload` published `sum(units_allocated / units_acquired * dollar_amount)` per holding as
`cost`. That is net cash — buys minus sells — and summed across the fund it gives $13,444.86
against a true basis of $13,422.09. `portfolio.ts` already says so, in the note over the two
exports deleted on 2026-08-24 _for summing it_: "a loaded gun sitting beside the right answer".
The functions went; the field kept the name that invited the mistake. It is `netCash` now, top to
bottom.

## The Circuit store stopped swallowing failed writes

State was applied optimistically and never rolled back, the rejection went to the console, and the
promise resolved successfully — so logging a workout offline showed the entry, advanced the undo
stack, raised no error, and was gone on the next reload. Same shape as the `mark_activity_seen`
bug already fixed in `useNotifications` ("do not let the bell claim it cleared"). A failure now
says so and reloads, so what is on screen is what exists.

## One promised-to-date, one timezone

`promisedToDate` parsed the start at **local** midnight and measured to `Date.now()`;
`buildDailySeries` parses at **UTC** midnight against UTC day buckets. For a viewer west of UTC in
the evening they differed by a day — 33 accounts at $1/day is **$33** between the chart's
"Promised" line and the card's behind-the-promise figure. One `daysOnPlan()` now, UTC on both
sides, matching the server's `current_date`.

## The relay grew a heartbeat

TCP does not always report a vanished peer — a closed lid, a dropped mobile connection, a NAT
timeout — so `close` never fires and the client stays in `room.clients` forever, which means
`clients.size` never reaches 0 and the room is never deleted. Same end state as the room leak
fixed earlier, arrived at with nobody doing anything wrong. Standard ws ping/pong sweep;
`terminate()` runs the normal close handler so the room is freed properly. Verified: a live socket
survives repeated sweeps, its room stays listed, and the room is freed when it leaves.

## The Finnhub key came out of the URL

`refresh-prices` put the token in a query string, and Deno's fetch rejects with a message
embedding the full URL — which the catch stringified into `summary.errors`, which is spread into
the 200 response body and the logs. Header now, and the catch records `e.name` rather than the
error.

## Answered, no change needed

**Cash App fees are not double-counted.** 12 trades carry a fee totalling $97.32, and no database
function reads the `fee` column at all — `admin_import_trades` writes it and nothing else touches
it. So there is no double count. ⚠️ The flip side is that fees are part of a cost basis for tax
purposes and are currently ignored entirely, which understates basis by up to $97.32. Left alone
deliberately: changing basis math moves figures already verified against the brokers, and that
should be a decision rather than a side effect.
