# "% of the day" was the sum of the sessions, not the union of them

✅ APPLIED — no migration. Client-side only; the record itself was never wrong.

## What was wrong

Three figures on the site answer the question _how much of this day is accounted for_:

| where           | what it says                                   |
| --------------- | ---------------------------------------------- |
| `Rail.tsx`      | "10% of the day", with a bar                   |
| `WeekGrid.tsx`  | "Tuesday, 13 October — 8% of the day recorded" |
| `MonthGrid.tsx` | a cell's fill height, and "2h 19m recorded"    |

All three were computed the same way — add up the sessions and clamp the total to 100:

```ts
covered: Math.min(
  100,
  blocks.reduce((n, b) => n + b.width, 0),
)
```

That is the answer to a **different question**. Sessions may overlap: none of the ten functions
that write to `chronicle_entries` tests for it, deliberately, because a podcast while washing up is
two activities over the same minutes. Adding their lengths up counts every shared minute twice.

Measured, on an ordinary day — nine-to-five, a one-hour call inside it, music over the whole lot:

```
wall-clock covered     33.3%   = 8h of a 24h day
week column covered    70.8%
month cell  covered    70.8%
rail score  covered    70.8%
month cell says mins   1020 min recorded     ← a day that held 480
```

**And the clamp was the worst part, not the saving grace.** It was there on purpose, and the
reasoning written beside it is right about the symptom:

> "103% of your day" is a number that reads as a bug while "100%" reads as a full day.

What it does is turn a visibly broken figure into a confidently wrong one. Four overlapping morning
sittings:

```
four 8h sittings all over 00:00–08:00 — truly 33.3% of the day
  week  100.0%   month  100.0%
  month cell says  1440 min recorded
```

A day reported **100% recorded**, with a full **1,440 minutes**, whose entire afternoon and evening
are blank. Nothing on screen could have given that away.

## A second thing, found on the way

`score.ts` divided by a constant:

```ts
export const DAY_MINS = 24 * 60
covered: Math.min(100, (logged / DAY_MINS) * 100)
```

A day is not always 1440 minutes, and `dayBounds` already knew that — measured in New York,
`dayBounds('2026-03-08')` is **1380** and `dayBounds('2026-11-01')` is **1500**. So a fully recorded
spring-forward day read 95.8% and could never reach 100, and a fall-back day could exceed it, which
the clamp then hid. The denominator is the window's own width now.

## What was NOT changed, and why

**Overlap is still allowed, on every path.** The tempting fix is a constraint, and it would be the
tidy-looking rule that locks the room — the same shape as the span-length CHECK that CLAUDE.md §4
talks `chronicle_entries` out of. Two activities at once is a real thing people do. The record was
right; the sentence read off it was wrong.

**The sums are still sums.** "Written down 2h 44m" on a day covering 2h 17m is honest — that is how
much attention the day took. `Focused`, `Written down` and the `% Locked In` share all stay as they
were. Only the figure with _"of the day"_ after it is a union. Both now appear on the rail together
and say different things on purpose.

## The shape of the fix

`clip()` in `record.ts` is new and private: the stretch a span occupies inside a window, or null.
`overlapMs` asks it how LONG, `coveredMs` asks it WHERE. They were two copies of the same five
lines — the midnight rule, the open-entry rule, the backwards-span rule and the two clamps — and
now they cannot disagree about what a session is worth.

```ts
export function coveredMs(spans, fromMs, toMs, nowMs): number // the union, in ms
export function coveredPct(spans, fromMs, toMs, nowMs): number // over the window's own width
```

`Cell` in `month.ts` gained `mins`, because the grid was getting its label by multiplying the
percentage back out over a hard-coded 1440 — exact only while the denominator was also 1440. A
label measured in minutes is handed minutes.

`scoreOf(rows, covered)` takes the figure rather than computing it: a `{cat, mins}` row has no
times in it, so it cannot answer a union. The parameter is **required** rather than optional with a
fallback — a default would be a second answer to the same question, taken silently by whichever
caller forgot. `Rail.tsx` adds `entriesBetween` to the `Promise.all` it already had, so it costs no
round trip.

## What was checked

**The independent path.** `byTheMinute` in `record.test.ts` walks the window a minute at a time and
asks each minute whether any span is over it — no sorting, no merging, no subtraction. `coveredMs`
answers by clipping, sorting and merging. They share the clock and nothing else. 400 random days,
1–7 sessions each, some starting before the window and ending after it, a tenth of them still
running: exact agreement.

> The first run disagreed by **20,609 ms** — under a minute. That was the walk's own limit, not the
> function's: it counts a minute if something is over the middle of it, so a session ending twenty
> seconds in cannot be measured by it. The data is snapped to the minute so the cross-check can stay
> exact, rather than the comparison being loosened to a tolerance — a tolerance of one minute per
> boundary would have hidden a real error of the same size. A second sweep of 400 unsnapped days
> checks the bounds, which need no second opinion.

**Made to fail, three ways** (perturbed from a scratchpad copy, never `git checkout`):

| perturbation                                    | what went red                       |
| ----------------------------------------------- | ----------------------------------- |
| no merge — add the clipped lengths up (the bug) | 8 tests, incl. the independent walk |
| `else if (b > hi)` → unconditional              | 6 tests                             |
| `coveredPct` over a constant 24h                | 1 — exactly the DST test            |

**Two pre-existing tests could not tell a union from a clamp.** `never claims more than a whole day`
(week) and `never claims a day was more than full` (month) both have a 0–24 session in the fixture,
so they read 100 either way — they passed unchanged through the whole of the clamp's life and would
pass again if it came back. Each gained a sibling whose sessions all finish before lunch, where no
cap is involved at all: the sum is 79.2% / 50% of the day and the day holds 29.2% / 33.3%. Both new
tests fail under the old sum.

**The seed had no overlapping sittings**, which is why the workbench never showed any of this — a
seed with no overlap gives the sum and the union the same answer. `pv-e21` now sits wholly inside
`pv-e1` (the shape that tests the merge's own guard) and `pv-e22` overlaps `pv-e11`.

**On screen**, with that seed, reading the rail:

```
Written down   2h 44m      ← 164 min, the sum
10% of the day             ← 137 min, the union; bar painted 22px of 227 = 9.51%
```

164 − 137 = 27, which is exactly the two overlaps (15 min + 12 min). The bar's width was measured in
pixels rather than read off the percentage. The week grid agrees at 10% for the same day, and the
month cell says "2h 19m recorded" where the sum would have said 2h 46m.

Gate: typecheck 0, lint 0 errors, **1,112 tests**, build ok. `grep dist/assets/*.js` for a string
only the new fixture contains finds nothing — the seed does not ship.

## Still open, named not fixed

- A day can still hold more logged minutes than it has, and that is correct. Nothing on screen
  currently says "you recorded 34 hours today", but if a figure like that is ever added it wants the
  sum, not this.
- `Looking.tsx` and `Lifetime.tsx` draw bars from `mins / widest`, which is a share of the biggest
  activity rather than of a day — a sum is the right question there, and they were left alone.
