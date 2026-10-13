# Chronicle, where it got to — 13 Oct 2026

Written for Evan coming back to it. The long version is `2026-10-12-chronicle-design.md` §6g–§6u,
which is about twenty pages of reasoning; this is the page you actually need.

**17 commits, 6,290 lines, 845 tests, 10 migrations.** All pushed to `main`.

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
