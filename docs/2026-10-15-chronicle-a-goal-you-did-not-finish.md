# A goal you did not finish was in no list at all

**Status:** ✅ shipped — client only, no migration.

## The bug

`inScope` asks that a one-off goal's anchor sit inside the window being viewed. Every view's day is
a fixed function of now — `todayISO` or `tomorrowISO` — and there is no stepper anywhere on the
goals half of the room. So the moment a window passed, an unfinished goal in it fell out of **every
list**, with no navigation anywhere that could go back and fetch it.

It was not merely hard to find. Nothing could reach it.

Measured in the workbench, by importing two goals the seed cannot produce:

| goal                  | scope  | anchor     | shown under                |
| --------------------- | ------ | ---------- | -------------------------- |
| Ring the plumber      | `day`  | 2026-10-14 | — nothing, in all six tabs |
| Finish the tax return | `week` | 2026-10-06 | — nothing, in all six tabs |

An empty result can mean "it never imported" rather than "it is invisible", so the store was asked
separately: **⬇ Save a copy returned 13 goals including both, each with `done: null`.** They were in
the account, unfinished, and on no screen.

## Why it is a bug and not a decision

`homeFor`'s own comment already names this defect class, from the time a quarter goal went
invisible: _"The design doc worried about exactly this — a goal somebody can create and never see
again."_ That was accepted as a bug and fixed.

This is the same defect through a second door, and a worse one. The quarter case needed a scope the
room no longer offers; this one needs **nothing but not finishing something**, which time does for
you. And the asymmetry is sharp: a goal anchored to tomorrow is visible under Tomorrow. You could
see tomorrow and not yesterday.

## Unfinished is not failed

The streak rule already draws this line — _"the window you are in cannot break a streak; today is
unfinished, not failed"_ — and a window that has **closed** is the other side of it. For a one-off
that splits in two, and both halves still have to be reachable:

- **a goal you tick** is still open. A plumber you meant to ring on Tuesday is ringable on
  Wednesday; the date was a plan, not a deadline that voids the task. The tick must work.
- **a derived goal** is settled. `share` measures over the anchor's window, and no future minute
  can land in a week that has ended — so it is listed in order to be **seen and cleared**, not
  finished.

Both now appear under a **From before** heading in the view for their own cadence, each saying what
it was for. The window's own work stays first on the screen; a thing you failed to do last Tuesday
is not mixed into the list that answers "what is today for".

## Where it is listed, and why not Tomorrow

`pastIn` matches `homeFor(scope)` **and** requires the view's own window to contain today. Today,
This week, This month and This year pass that; **Tomorrow does not** — both are scope `day`, so
matching on scope alone would list one goal twice, and Tomorrow is the one list where a thing you
did not do yesterday has no business being, since that view's whole claim is that it was decided in
advance.

`pastIn` and `inScope` are disjoint by construction: one wants the anchor's window closed, the other
wants it to contain the day being viewed. So this gives a list to goals that had none, rather than a
second list to goals that had one.

## ⚠️ The fix had the same bug in it, one layer down

The first version folded "and not finished" into one predicate. In the room, that meant **ticking a
late goal deleted the only row that could untick it**: a done goal anchored to a closed window fails
`inScope` for being outside the window and fails `late` for being done. Measured — the row vanished
under the cursor, the badge fell 2 → 1, nothing was said, and there was no longer anywhere to change
your mind.

My own invariant test missed it for the same reason the original bug survived: **every shape in it
had `done: false`.** A test that never varies a dimension cannot see a bug that lives in it.

So the predicate is split — `windowPast` (has the window closed) from `late` (closed **and**
unfinished) — and the room keeps a ticked late goal on screen, struck through, for as long as you
are on that view. That is what every other goal in the room already does. Leaving the tab is when
finished work from a closed window rolls off, which is what a dated goal is supposed to do once it
is done.

The badge counts `lateIn`, which keeps the "and not finished" — a badge is a claim about what is
**left to do**, and one that counted a struck-through row would be sending you back to something you
had just finished.

## ⚠️ And the chip named a day the goal was never about

`wasFor` first said **"the week of Mon, Oct 5"** for a goal anchored 5 Oct — while its window, the
one `share` measures over, is Sun 4 Oct to Sat 10 Oct. An anchor is a day _inside_ a window, not the
window's start. A goal created in the room always anchors to `windowOf(...).from`, so the two agree
and the mistake is invisible; **an imported one can carry any day in its window**, and then the chip
reports something the goal never asked for. Same shape as a unit written in a comment instead of
computed.

It names the window's own first day now, and the words follow the cadence: a month goal was not
about the 1st and a year goal was not about January 1st, so neither gets a weekday.

## What was checked

- **83 tests** in `goal.test.ts`, up from 80. Perturbed five ways, each caught by the test named for
  it: the closed-window boundary (`<` → `<=`), the view-looking-at-now test removed, the finished
  check removed, and the `windowPast`/`late` split folded back into the bug above.
- The invariant is now stated as what is actually true: **an unfinished one-off is findable in
  exactly one view**. A repeat is the deliberate exception — a daily goal is in Today _and_ Tomorrow,
  which is the whole of what a repeat means. A finished dated goal rolling off is asserted separately
  as the lifecycle, not a defect.
- In the room, all six views: one **From before** heading exactly where there are late goals and
  nowhere else, no duplication into Tomorrow, and the derived one reading **216 / 600 minutes** over
  its own past window while the current week's goal sat at 305 / 300 two rows above — two windows,
  two numbers, one screen.
- The whole tick cycle: ticked → stays, struck through, badge 2 → 1; unticked → back, badge → 2;
  left the tab and returned → rolled off, heading gone.
- **375px**: `sideways 0, tooSmall 0, offEdge 0, clipped 0, insideOut 0, spills 0, wordless 0` on
  both affected views, chip 141px sitting 12px inside its row. The seed's 66-character title forced
  onto a late row wraps to four lines with **zero** overflow at row, list, card and document — and a
  screenshot was taken, because the numbers have read zero here before while the titles had been
  crushed to a 3px column.
- `npm run typecheck`, `npm run lint` (0 errors), `npm run test` (1044), `npm run build`, and the
  built bundle grepped for the new seed strings: **not present**.

## ⚠️ And then the line under the tabs disagreed with the tabs

Shipping a cause and its consequence in one sitting, exactly as the standard says. The badge was
taught to count late goals; `weight` — the "what this still asks of you" line, which sits inches
below the tab strip — was not. Measured in the room immediately after:

| view      | badge | weight line         | unfinished rows |
| --------- | ----- | ------------------- | --------------- |
| Today     | 2     | **"1 left"**        | 2               |
| This week | 1     | **absent entirely** | 1               |

Three figures about the same tab, and two of them wrong. The This week case is the worse one: with
`left` at 0 the line suppresses itself on purpose — "0 left under a heading only ever states the
obvious" — so a tab with work in it said nothing about that work at all.

`weight` counts what the view LISTS now, which is both of its lists. Ten minutes you meant to spend
yesterday still come out of today.

⚠️ **It needed a `today` of its own, separate from `on`.** Tomorrow is the only view whose `on` is
not today, and the only view that lists no late goals — so reusing `on` for both would have put
yesterday's unfinished work into tomorrow's weight. That shortcut is the one I would have taken to
avoid changing the signature; it is now a perturbation the tests catch.

**The server was right all along.** `get_member_chronicle` selects shared goals filtered by nothing
but `shared` — deliberately, because "a goal's window comes from `goalWindow` and the server has no
copy of it" — and its `open` count is `done_at is null` across every goal the member has. So the
profile block has been counting late goals as open since it was written. This change brings the
room into line with what the account was already telling other people.

## The seed could not produce this state, which is why nothing caught it

Every dated goal in `chroniclePreview` was anchored to today or to tomorrow — `at(-1, …)` is
_tomorrow_ in that file's convention. For six features the workbench had no goal whose window had
closed. Two now exist, one of each kind, and the week one is deliberately anchored **mid-window**,
because that is what caught the chip naming the wrong day.

## Named, not fixed

**A one-off anchored beyond tomorrow is still in no list.** The ＋ form cannot make one — it takes
its anchor from the window you are looking at — but ⬆ Put one back can. "Not yet" is a different
claim from "late" and wants a different answer, so it is not folded in here. There is a test
asserting the current behaviour, so it is a decision rather than an accident.
