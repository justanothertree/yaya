# Chronicle, where it got to — 13 Oct 2026

Written for Evan coming back to it. The long version is `2026-10-12-chronicle-design.md` §6g–§6u,
which is about twenty pages of reasoning; this is the page you actually need.

**17 commits, 6,290 lines, 845 tests, 10 migrations.** All pushed to `main`.

> ⚠️ **That was the state at `ba11193`. Eleven more commits landed after it** — see "After this page
> was written" at the bottom, which is the part you have not seen. Current totals: **913 tests, 15
> chronicle migrations, 31 chronicle functions.**

---

## The headline

**The parity list is closed.** Everything in the HTML app's store table is now built, deliberately
left out with a reason, or answered differently and said so. That happened at
`20f5adc`, and the steps after it are depth rather than breadth.

## What the room has that it didn't

|                                           |                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Plans**                                 | A span you _intend_ to spend, against what you actually did. Its own table, never counted as work done. |
| **An estimate and a priority** on a goal  | The to-do half of what you asked for. Priority is the list's order.                                     |
| **A rating** on a session                 | 1–5, and a month reads back as "1h 20m good · 50m fine · 42m rough · 50m unrated".                      |
| **A target per sitting**                  | "When I draw, draw at least 30 minutes" — different from a goal, which counts a window.                 |
| **Streaks, and the month behind them**    | The `🔥 4` chip, plus a row of marks showing _which_ four.                                              |
| **This week vs the same point last week** | Not vs the whole of last week — see below.                                                              |
| **The shape of a day**                    | Two lanes: what you meant, what happened.                                                               |

## Try these first

1. **Open Chronicle on your phone, add a goal with a number, point it at an activity.** The whole
   room hangs off that one gesture and it is the thing I most want you to find clumsy.
2. **Plan tomorrow.** Step the day forward with `›`, open **Planned**, press ＋ Plan a span. Then
   look at the strip: `meant` on top, `did` beneath.
3. **Rate a session** with ✎ on a log row, then open **This week** and see where the hours went.
4. **Give an activity a sitting length** (＋ Activity, or ✎ in the Activities fold) and then stop a
   timer early — it says so afterwards rather than nagging you beforehand.

## Three things I'd want your opinion on

1. **Is `quarter` worth a tab?** The design doc has asked this since step 1 and nobody has
   answered it. It costs a tab's width on a phone. Removing the view is one line; narrowing the
   constraint behind it would not be, which is why the view came first.
2. **Should the Circuit sit on chronicle now?** Decision 3 back in §2 said "after chronicle has
   earned it, not before". It now has goals with targets, windows, repeats, streaks and priorities,
   and your 100 points is expressible in them — there is a test asserting exactly that. This is a
   real question rather than a rhetorical one; the Circuit works and has 707 logs in it.
3. **A streak chip appears at two in a row.** Below that there is a row of marks with no number
   above it. I left it rather than put a line of text under every goal — the goal rows already
   carry up to five chips, a meter and two buttons. If it reads as unexplained to you, it is.

## What is not finished, honestly

- **The streak batch costs 617ms** for ten repeating goals over a year of history. It was 2,750ms;
  it is one index probe per window and bounding it further needs a ceiling on session length that
  nothing currently imposes. No write waits on it, so you should not feel it.
- **Nothing has been exercised with a real session.** Everything server-side is proven by SQL
  against the real database, and everything on screen by a dev-only stand-in — but the two have
  never been run end to end by an actual signed-in person. That is you.
- **Firefox and Safari are untested**, as always (§6). Nothing here touches audio or canvas, so the
  risk is low, but it is not zero and it is not verified.
- **`profile_blocks` and `profile_notes` hold `authenticated` grants they cannot use** — noticed in
  passing, not chronicle's, not touched. **Not a hole**: both have RLS on with zero policies, so a
  signed-in member running a `select` gets back zero rows and an `insert` is refused outright
  (checked both ways round — and note that RLS makes a `select` return _empty_ rather than error,
  which my own first check misread as a leak). `anon` has nothing on either. It is the "don't grant
  what cannot be used" smell from §3 — an entry somebody must reason about at every review.

## The two things worth stealing for other rooms

- **`greatest()` and `least()` ignore NULLs.** On a LEFT JOIN the no-match row does not collapse to
  nothing — it computed a whole day where the answer was zero. Cost two wrong rewrites.
- **A clean number is not a clean room.** Three times a layout change measured perfectly and had
  destroyed the page — crushed titles, 39px bars, a collapsed strip. Screenshot before believing a
  layout fix, and ask the container rather than the page. Both are in CLAUDE.md §2 and §6 now.

---

# After this page was written

Eleven commits, `ba11193..6b4df26`. The first was performance; everything after it was found by
**using** the room rather than by reading it, which is the short version of why this section is
mostly bugs.

## Two things it can now do

**Take your record out, and put it back.** Chronicle was the only store on this site with no local
copy — which was the right call (one copy, the server's, so a phone and a laptop agree) and left it
the only thing here you could not get out. The Account page has promised for months that "a file is
the copy that survives losing the account" about songs, drawings, looks and minions. Now chronicle
keeps that promise too: **⬇ Save a copy** and **⬆ Put one back** at the foot of the room.

Both go through one RPC returning or taking one document, rather than five calls over five lists —
a list comes back through PostgREST, which can cap rows, and a download quietly missing a year looks
exactly like one that is not. Putting a file back **adds, never replaces**, which is also why a file
edited by somebody else cannot reach your rows: an id that exists is skipped rather than written to.
Three years of entries export in 45ms and restore in 454ms.

**Correct a session you got wrong.** Pressing Start on the wrong activity is the likeliest mistake a
stopwatch allows, and the only remedy used to be deleting the session and typing it in again. A
finished session can now be moved to the activity you meant, keeping its amount, its rating and the
day it was recorded — and the one you are **in the middle of** can be moved too, or have its start
wound back to when you actually began, without pressing Stop.

## Four bugs, three of them data loss

| what                                                                                | who could hit it        |
| ----------------------------------------------------------------------------------- | ----------------------- |
| Opening a session's editor and pressing **Save** destroyed the note you had written | anyone who wrote one    |
| Renaming an activity deleted its **colour**                                         | anyone restoring a file |
| Editing a goal deleted its **note**                                                 | anyone restoring a file |
| The room sent messages nobody could see — it had no `<Toast/>` mounted at all       | everyone                |

All four are the same shape, and it is now a rule in `CLAUDE.md` §8: **a save that writes every
column deletes the ones the caller forgot.** An optional field, a caller that does not mention it,
and a function that reads that silence as erasure. Null means "I am not talking about this" now,
across every save path in the module; clearing is asked for with an empty string.

Two of them were **dormant until I shipped the import** — nothing in the room can set an activity's
colour or a goal's note, so there was nothing to lose until a restored file could put something
there. My own feature made two old bugs reachable, which took two more days to notice.

The toast one is worth its own line: `<Toast/>` is mounted per room, and chronicle never mounted
one, so every message it sent went nowhere — _including the export's own failure messages_. Nothing
noticed while the room had nothing to say.

## And the first screen

Read cold, as a new member meets it: signed in, nothing recorded. The explainer is still true. But
**three controls are dead on a fresh account and a phone was told nothing about any of them** —
Start, Fill a gap and Plan a span. The explanations were a `cursor: not-allowed`, which no touch
screen has, and a tooltip on one of the three. There is a sentence there now, in the same shape as
the one the Planned section already used.

## Where it stands

- **913 tests**, up from 845. The preview double is pinned against its server counterparts by 54 of
  them, and every new test in this stretch was made to fail once before being kept.
- **31 chronicle functions**: none reachable by `anon`, all `SECURITY DEFINER`, all with
  `search_path` pinned. That is the standing check, not a remembered fact — the query is at the
  bottom of each `docs/2026-10-13-chronicle-*.sql`.
- **The streak batch is finished**: 2.75s → 617ms → **9ms** at three years of data. The last step
  bounded each goal's scan by the span of its own windows instead of re-reading every entry ever
  written, for all 190 of them.

## Still yours to decide

1. The three questions above this section, unchanged.
2. **An activity's colour and a goal's note exist in the table, the type, the save path, the export
   and the import — and nothing on screen writes or shows either.** A colour per activity would read
   instantly in a list of bars; a goal's note is the obvious home for "why this matters". Both are
   one input away. I did not invent them, because what they should look like is a decision about
   the room.
3. **The Account page's backup card does not mention chronicle.** Its wording is accurate — it names
   its four things — but somebody looking for "save my data" would look there first.

## One thing found in another room, not fixed

`src/game/manager.tsx` — in a connected versus game, **five settings controls are disabled for
anyone who is not the host and explained only by a `title`** (lines 3959, 3987, 4045, 4074, 4111:
speed, map size and three more). A tooltip does not exist on a phone, so a guest sees a panel of
dead buttons with no reason. The same room already does it right one panel over: "Waiting for the
host to start the next round…" is ordinary visible text.

The fix is one line — a visible "Only the host changes these" when that condition holds — and I
have not shipped it, because reaching that state needs two connected players with me as the guest.
I could not verify it, and an unverified change to a crowded panel is the thing §2 of `CLAUDE.md`
exists to stop.
