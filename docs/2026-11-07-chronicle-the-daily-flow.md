# Chronicle, the daily flow — 7 Nov 2026

Asked for as: _"Make Chronicle useful enough that I open it every day, especially on my phone. It
already has substantial functionality, but I don't know what exists or where to find it."_

So the first half of this is an **inventory** rather than a change, and the second half is one
bounded slice. The headline is that almost nothing in the wish list was missing — the pieces were
on two different screens.

---

## 1 · What already works

|                                          |                                                                                                                                                                                                                              |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Activities**                           | named, categorised Locked In / Free Time / Life, with a colour, a metric ("pages", "reps"), a per-sitting target and an archive switch                                                                                       |
| **A stopwatch that survives everything** | the open sitting is a row on the server, so closing the tab, reloading or switching device does not lose it; `chronicle_start` closes the old sitting and opens the next in one call, and deletes a mis-press under a second |
| **One-tap switching**                    | the SWITCH TO tiles on the Day half, ranked by what you have actually done today (`tilesFor`)                                                                                                                                |
| **A sitting's record**                   | minutes, an amount in the activity's own metric, a 1–5 rating, a photograph, and a **journal** of as many written entries as you like                                                                                        |
| **Goals at five cadences**               | day, week, month, year, life — repeating or anchored to one window; a tick-box or a target with a unit; an estimate, a priority and a note                                                                                   |
| **Goals the record answers for**         | point a goal at an activity (or a whole category) and it counts your minutes, or the activity's own metric, with no ticking                                                                                                  |
| **Due / done / missed, honestly**        | the horizon strip counts unfinished work per window; a goal whose window has closed drops into **From before** carrying `was for Fri, Nov 6`. Nothing is marked missed while its window is still open                        |
| **Streaks**                              | `🔥 4` from two in a row, over a 31-window mark row                                                                                                                                                                          |
| **Routines**                             | ordered steps, each an activity and a number of minutes, each with its own ▶                                                                                                                                                |
| **Plans**                                | a span you _intend_, drawn against what you did, in two lanes                                                                                                                                                                |
| **Looking back**                         | a day log, a week grid, a month calendar, a lifetime total, and a rail with today's shape                                                                                                                                    |
| **Take it out and put it back**          | ⬇ Save a copy / ⬆ Put one back, one document, add-never-replace                                                                                                                                                            |
| **A profile block**                      | opt-in twice — the block has to ask for goals AND the goal has to be ticked — capped at `friends`, with the friends timeline behind three separate switches                                                                  |

Two of these answer wish-list items that read as missing and are not:

- **Big phone-friendly +/− for reps.** The running header already carries `+1 / +5 / +10` and a
  `−1`, with the unit spelled out ("24 reps"), for any activity that names a metric. The finish
  is Stop, which opens a dialog for the rating and the journal.
- **A private daily / weekly / monthly progress view.** Looking back, the week grid, the month
  calendar and the lifetime panel are all there and all private by default.

## 2 · What exists but is hard to find

1. **The room opens on Day, and Day never mentions what is due.** "What's due" lives on the Aims
   half, one tap away, with nothing on screen suggesting the tap. ← _fixed below_
2. **A goal that names an activity could not start it.** "Work out 20 minutes a day" said
   `FROM GYM` and offered ✎ ◉ ✕ — to actually spend the twenty minutes you left Aims, found Gym
   among the tiles on Day, and pressed it there. ← _fixed below_
3. **The journal is inside the ✎ dialog of a log row.** It works on the sitting you are in the
   middle of, which is the useful case, and nothing on the surface says so.
4. **Routines and Activities are closed `<details>` folds** at the foot of the Day half.
5. **An amount is set from the running header or the sitting's editor**, and only for an activity
   that has been given a metric — which is itself in the activity editor.

## 3 · What is actually missing

|                                  |                                                                                                                                                                                                                                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Selected weekdays**            | "Swim on Tuesdays" is not expressible. `repeat_every` is `1..52` in the table and **only 1 is honoured** — there is no phase and no weekday mask, which `repeats()` in goal.ts has said since step 1. See §5a                                                          |
| **A dated note with no sitting** | every journal entry hangs off a `chronicle_entries` row. Writing something down therefore needs a sitting to exist, which is exactly what "writing a note must not require starting a timer" rules out. See §5b                                                        |
| **A workout _session_**          | the Circuit has `Exercise` (name, unit, multiplier, grid position) and `DayLog`/`LogEntry` per person, and logs them through a typed number grid. There is no timer, no current exercise and no session. Chronicle has the timer, the counter and the history. See §5c |

---

## 4 · What changed — "Today, connected"

Three changes, all in the Chronicle room, all reversible, **no schema**.

### 4a. What is due, on the button that leads to it

The Aims half button carries the Today tab's own count. It is the same `counts` memo the horizon
strip draws from — never a second sum — so the badge and the tab cannot disagree.

It is **absent at zero rather than reading 0**, which CLAUDE.md §2 is otherwise suspicious of: a
figure that vanishes hides work instead of reporting it. It is right here because the number
counts UNFINISHED things, so nothing due and everything done are the same news, and the tab is
still there to say which.

The badge is announced as "Aims 3 not finished today" — without the `sr-only` noun a reader hears
"Aims 3", which is a number with nothing on it.

### 4b. ▶ on a goal that counts an activity

`startFor(goal, acts, runningActivity)` in `goal.ts`, with the same three refusals as `tilesFor`
and for the same reasons:

- **no activity** (a tick-box, or a goal counting a whole category) — nothing single to start;
- **archived** — `chronicle_start` refuses it, so the button's only possible answer is an error,
  which is the lesson the archived routine step taught, and the row already says "archived";
- **`auto`** — the site writes those itself.

And one of its own: **the activity you are already in gets a `running` chip instead of a ▶.**
Pressing Start on what is running closes that sitting and opens a new one — splitting what you
are doing in two with nothing on screen to say it happened. The chip is the useful half of that
fact anyway; it is the only thing on the Aims half tying the clock at the top to the goal it is
filling.

Starting goes through `chronicle_start` like every other way in, so **switching is the same call
as starting** and the record stays continuous.

### 4c. The tooltip and the name agree

`aria-label` beats `title` as a control's name, so the first version said "Start Dishes" to a
screen reader about a button whose own tooltip read "Switch to Dishes". Switching is the half
that needs saying, because something else is about to stop.

---

## 5 · Proposed and NOT applied

Nothing in this section has been run against any database. Each names what it would take, the
isolated permission test, and how to undo it.

### 5a. Selected weekdays

**The shape.** A repeating `day` goal gains a mask of the weekdays it is for. A `smallint` bitmask
(Sunday = bit 0, to match this project's Sunday-start week in `week.ts` and `Feed.tsx`) rather
than an array, because it is seven booleans and the only queries over it are membership tests.

```sql
alter table public.chronicle_goals
  add column days smallint
  check (days is null or (days between 1 and 127));

-- a mask only means anything on a repeating day goal; null everywhere else
alter table public.chronicle_goals
  add constraint chronicle_goal_days_are_daily check (
    days is null or (scope = 'day' and repeat_every is not null)
  );
```

**Why the table is the small half.** `days` has to be read by `inScope`, `goalWindow`,
`tallyAsks`, `streakAsks`, `marksOf` and `weight` on the client, by `chronicle_tally` and
`chronicle_tally_one_pass` on the server (a window the goal is not for must not count as a missed
one, or every streak in the room breaks on a Wednesday), and carried by `chronicle_goal_save`,
`chronicle_export`, `chronicle_import` and `get_member_chronicle`. That is the redesign this pass
was told not to start, so it is written down rather than begun.

**The one semantic trap, named now.** A goal that is for Tuesdays is **not missed on a Monday**.
`late()` and `pastIn()` currently read "the window has closed and it is not finished"; with a mask
the window has to close _and have been one of yours_. Getting that wrong turns "Swim on Tuesdays"
into six overdue rows a week, and — worse — rewrites the streak history of a goal somebody has
been keeping, which is the thing the brief says must not happen silently.

**Isolated permission test**, in a rolled-back transaction, as `authenticated` impersonating two
members:

```sql
-- the table is unreachable except through the functions, before and after
select has_table_privilege('authenticated', 'public.chronicle_goals', 'select');  -- expect false
-- the new column changes no grant
select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f' and p.proname like 'chronicle_%';   -- expect no rows
-- a member cannot set days on somebody else's goal, and cannot read it back
```

**Release and rollback.** The column is nullable with no default, so applying it alone changes
nothing: every existing goal reads `days = null`, which every reader must treat as "every day",
and that is the behaviour today. The client half ships behind that reading, so the migration can
go first and sit inert. Undo is `alter table public.chronicle_goals drop column days` plus
dropping the constraint — and it loses only masks nobody had yet.

### 5b. A note with no sitting

**Why it cannot be done without a schema change.** `chronicle_notes` rows hang off an entry, and
`chronicle_note_add` checks the entry's owner on its own first line — that check IS the security
model for the table, which is deny-all with zero policies. A note with no sitting has no entry to
be owned by.

The honest shapes are a nullable `entry` plus an `owner` and a `day` on `chronicle_notes`, or a
second table. Both are small. **Neither is a decision I should take**, which is why it is in
OPEN-DECISIONS §14b rather than here: a dated note with no activity is a new KIND of thing in a
room whose every other row is a span, and three existing readers would have to be told what to do
with it — the day log, the export, and `chronicle_friends_log`, which today carries no note at all
because the profile card promises as much.

### 5c. The workout model

Left alone deliberately. The Circuit's exercises are a shared, scored, social grid — 707 logs,
other people's columns, a points multiplier — and Chronicle's activities are one person's private
record with a stopwatch on them. Putting a session flow on top of Circuit exercises means
deciding which of the two owns "what I did today", which is the question the design doc has been
holding open since §2 decision 3 ("should the Circuit sit on chronicle now?"). It is in
OPEN-DECISIONS §14c with what each answer costs.

What exists today, and is enough for a workout without touching either model: an activity named
Gym with `reps` as its metric and a 20-minute session target, started from its goal's ▶, counted
with +1/+5/+10, finished with Stop.

---

## 6 · What was actually checked

Driven in the Browser pane against `#chronicle` with the preview member, at 375 and 1440.

- **`startFor`** — 8 tests in `goal.test.ts`. Six of the eight were made to fail once, each by a
  separate perturbation of the function: dropping the archived guard, dropping the `auto` guard,
  pinning `running` to false, letting a category goal fall back to the first activity in it (red
  on the category test), and letting a goal with no source fall back to the first live activity
  (red on both the tick-box and the category tests).
- **The switch, end to end** — Drawing running, pressed ▶ on "Wash up every evening": the header
  read `Dishes`, the `running` chip moved to that row, and the Drawing goal grew a ▶ of its own.
- **The badge tracks the record** — ticked "Ring the dentist": 3 → 2. Unticked it: 2 → 3.
- **Leaving and coming back** — `#circuit` and back: the sitting started from Aims was still
  running at 1:43, and the badge was on the Day half the moment it mounted.
- **375** — `mobileAudit` clean on both halves: `sideways 0, tooSmall 0, offEdge 0, clipped 0,
insideOut 0, spills 0, wordless 0`, having examined **51 controls / 40 in-room** on Aims and
  **37 / 26** on Day. The checker was made to speak first: a 16×16 button gave
  `tooSmall: [{4x16}]` and a 600px child in a 120px box gave `spills: 3, offEdge: 14,
sideways: 262`, all back to zero when removed.
- **The four-button row** — the control group measures 206px against 151px with three, inside a
  327px row, and the title keeps 175px against its 150px floor. It costs **no height**: a row
  with four buttons and a row with three both measure 156px, because such a row already wrapped
  the group onto its own line.
- **1440** — clean, 63 controls, and the half buttons are still 52px tall with the badge on them.

**Not checked, and not checkable from here:** a real signed-in session. Everything above is the
preview double, whose `pvStart` is pinned against `chronicle_start` by the double's own tests but
is not the server. Firefox and Safari, as always.
