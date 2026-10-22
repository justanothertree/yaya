# Four rows stopped hiding two thirds of an activity's name — and one kept doing it on purpose

✅ APPLIED — no migration. CSS only.

Follows `2026-10-21-now-name-it-and-be-doing-it.sql`, which fixed the same thing in the Now room.
This is the rest of the room, and the decision about the one place where the same fix would be
wrong.

## The problem, measured at 375

`chronicle_activities` carries `UNIQUE (owner, name)` and allows **60 characters**. Names are
unique; their truncations are not. Every one of these drew one ellipsed line:

| rule               | box   | showed       |
| ------------------ | ----- | ------------ |
| `.chron-bar-label` | 46px  | **11** of 55 |
| `.chron-ent-name`  | 108px | **15** of 55 |
| `.chron-vs-name`   | 122px | **17** of 55 |
| `.chron-plan-name` | 189px | **27** of 55 |

So "Reading — The Brothers Karamazov, Dostoyevsky, part two" and "… part three" — two different
activities the table keeps apart — both drew as **"Reading — The B"** in the day log. Nothing on
these rows carries a `title`, and §6 says a title does not exist on a phone anyway.

## Not one decision — four yes and one no

The rule that separates them is **whether the row's height is already free**:

- `.chron-ent` is a wrapping flex container of four groups (dot, name, facts, buttons).
- `.chron-vs` and `.chron-draft li` are flex rows with a `min-height`, not a height.
- `.chron-plan` wraps by design, with its own note saying why.

All four grow when their name does, and push nothing off the end. They now drop
`white-space: nowrap` and `text-overflow: ellipsis` and take `overflow-wrap: anywhere`, so a
single unbroken 60-character word breaks instead of widening the row.

**`.chron-bar-label` keeps its ellipsis, and it is the worst of the five.** It is the one name
that is not in a list row: it sits in `.chron-bar-name`, a `flex: 0 0 9rem` column whose fixed
width is exactly what makes the bars beside it start at the same place and therefore be
comparable at a glance. A wrapping label would give the chart's rows ragged heights and its own
kind of lie. Fixing it is a layout **decision** — a wider label column at the cost of shorter
bars, or the name above its bar so every row is two lines — and either changes how the chart
reads. Named here rather than guessed at.

This is §6's own rule about the mobile audit applied to a fix instead of a check: each exclusion
is a rule, never a skip list.

## Floors, because `min-width: 0` is "let it vanish"

`.chron-vs-name` and `.chron-draft-name` were `flex: 1; min-width: 0`. With the text now wrapping,
that is the exact shape §6 measured being crushed to a 3px column reading ":" — whatever in the
row is rigid wins and the one flexible thing pays the whole bill. Both gained `flex: 1 1 110px;
min-width: 110px`, in pixels because the root font-size here is fluid so `rem` is not a length.

`.chron-ent-name` already had a 130px floor, and `.chron-ent-name` was **declared twice** — once
for the flex, once for the truncation. Merged.

## What was checked

At 375 with the `mobile` preset, which is the only one that emulates touch:

```
Today       sideways 0, tooSmall 0, offEdge 0, clipped 0, insideOut 0, spills 0, wordless 0
This week   the same
```

And with a 55-character name put into a log row — the case the whole change is about:

```
row height          38px → 92px        five lines at 11 characters, 14px type
whole name shown    yes
✎ and ✕             47x39 and 45x39, sitting 88px and 36px INSIDE the right edge
```

That last line is the one that mattered: §6 records **three** separate repairs to this row for
buttons orphaned onto their own line or hanging past the card. They stay on the row.

Plus a screenshot, because §6 also records a layout fix whose numbers all read zero while every
title had been crushed to a 3px column. It shows the name wrapping as
"…Brothers / Karamazov, / Dostoyevsky, / part two" beside the dot and "35m good".

> ⚠️ **The pane's screenshot was cropping and briefly looked like a real fault.** Content appeared
> cut off at the right edge while the audit reported `offEdge: 0`. The DOM settled it:
> `document.documentElement.scrollWidth` was **375**, exactly the viewport, and a sweep of every
> element in the day header found nothing past the edge. The pane was showing a crop of its own
> render, not a layout that overflows. Measurement beat the picture here, which is the opposite of
> the usual lesson and worth knowing in both directions.

## The cost, stated plainly

A row holding a 55-character name is 92px instead of 38px. Every name up to about 11 characters
costs nothing at all, and most are shorter than that. The alternative was two activities that
cannot be told apart.

## Still open

- `.chron-bar-label`, above — a layout decision about the chart.
- `.chron-routine-top > strong` carries the same `nowrap` + `ellipsis` on a routine's name. Same
  bug class, different entity, and not measured this pass.
- The case clash is still not closed at the database: "gym" and "Gym" remain two activities as far
  as `UNIQUE (owner, name)` is concerned.

Gate: typecheck 0, lint 0 errors, 1,117 tests, build ok.
