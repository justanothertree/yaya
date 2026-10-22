# "Most used today first" was most used, full stop

✅ APPLIED — no migration. Client-side only; the record was never wrong.

## The claim and the code

`tilesFor` decides the order of the Now room's buttons, and its own heading says:

> ⚠️ MOST USED TODAY FIRST, BY NAME WHEN LEVEL. The order is the whole ergonomics of the room:
> the two or three things somebody actually does should be under the thumb without reading.

It had no concept of today. It summed `to - from` for every sitting it was handed:

```ts
const to = e.end ? Date.parse(e.end) : nowMs
mins.set(e.activity, (mins.get(e.activity) ?? 0) + Math.max(0, to - from))
```

That is minutes-today only while the caller's log holds exactly today — and `entriesBetween`
deliberately does **not**. Its window test is `s < to && t > from`, so a sitting that straddles
midnight comes back for both days. `record.ts` is explicit about what that means:

> A session from 23:00 to 01:00 is two hours long and belongs to two days — one hour each.
> Attributing it to both in full would count it twice and make eight hours of logging report
> sixteen.

Both hours were counted here, against today.

## Measured

A night shift of 23:00 → 07:00 holds **seven hours of today**. A 09:00 → 16:30 sitting holds
**seven and a half**. So the second belongs first:

```
order today should be  : Daytime, Night shift
tilesFor said          : Night shift, Daytime
```

Because eight is more than seven and a half.

And on screen, in the workbench, where the seed happens to carry exactly this shape — `pv-e20` is
a Writing sitting from 23:00 yesterday to 00:30 today, ninety minutes long and thirty of them
today:

```
fixed      Gym, Drawing, Dishes, Writing, …     ← 45, ~42, 32, 30 real minutes of today
bug back   Writing, Gym, Drawing, Dishes, …     ← Writing on 90, mostly yesterday's
```

The first tile under a thumb was the wrong one.

## The fix

`tilesFor` takes the window and borrows `overlapMs`:

```ts
export function tilesFor(acts, log, fromMs, toMs, nowMs): Activity[]
...
const ms = overlapMs(e, fromMs, toMs, nowMs)
if (ms > 0) mins.set(e.activity, (mins.get(e.activity) ?? 0) + ms)
```

Same argument `lane`, `against` and `coveredMs` are all built on: the day strip, the grids, the
totals and this list must not be able to disagree about what a sitting is worth in a window, and
the only way to guarantee that is for them to be the same arithmetic asked again. It also drops
the hand-rolled `Number.isFinite` guards, because `overlapMs` already owns them.

`Now.tsx` works the day out inside the memo rather than holding it:

```ts
const tiles = useMemo(() => {
  const day = dayBounds(todayISO())
  return tilesFor(acts ?? [], log, day.fromMs, day.toMs, Date.now())
}, [acts, log, beat])
```

`todayISO()` captured in a value with a fixed dependency list is right until midnight and then
quietly is not — and this is the room somebody leaves open.

## Made to fail, and the perturbation that found a hole in the tests

Three perturbations, from a scratchpad copy:

| perturbation                                  | first run    | after |
| --------------------------------------------- | ------------ | ----- |
| the whole length of every sitting (the bug)   | 2 red        | 3 red |
| clamp the START to the window, leave the end  | **0 red** ⚠️ | 1 red |
| let an open sitting run to the end of the day | 1 red        | 1 red |

**The middle one passed all thirteen tests.** Clamping only the start looks like the whole fix,
and nothing in the suite had a sitting whose **end** falls outside the window, so the missing
clamp had nothing to bite on. The suite read as a wide one and was not.

The case that closes it decides an order rather than a total: a sitting from 22:00 running four
hours into tomorrow holds two hours of today, which is less than a three-hour afternoon — but
four is more than three. With it, all three go red and the restored code is green at 14.

This is CLAUDE.md §2's "perturb before believing a sweep", and the useful part is that the
perturbation was not confirming a test, it was finding the one that was missing.

## A fixture of mine that proved nothing, caught before it was reported

The first measurement had a second case: a night shift still **running** from 22:00 yesterday,
read at 09:00, against an 8h30 sitting. The console line called it a second instance of the bug.
It is not one — a sitting still running from yesterday has, by definition, the _maximal_ share of
today (midnight to now), so no sitting wholly inside today can beat it on the true figure and be
beaten on the wrong one. The two orderings cannot disagree there.

Dropped rather than kept. It is the same shape as the fixture trap in §2: a case that looks like
coverage and holds the thing under test still.

## What this does not change

Only the ORDER of the buttons. No number on any screen moves, no record is touched, and an
activity with nothing against it in the window is still offered — it is a button, not a total.

Gate: typecheck 0, lint 0 errors, 1,117 tests, build ok.
