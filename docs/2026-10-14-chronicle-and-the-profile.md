# Chronicle on your profile — 14 Oct 2026

Written for Evan coming back to it, following on from `2026-10-13-chronicle-where-it-got-to.md`.
The reasoning is in `2026-10-12-chronicle-design.md` §6ap–§6aw and
`2026-10-14-chronicle-profile-block.sql`; this is the page you actually need.

**12 commits since `2517454`, 981 tests, 3 migrations.** All pushed to `main`.

---

## There is one thing only you can do

**Nothing I built today is live for anybody until you add the block.** There are zero chronicle
blocks in the database, which means the production path — the real RPC, with a real session — is
the one part of this I could not exercise. Everything else was checked: the gate was proven in SQL
with simulated sessions, the card was driven in the workbench, and the save function was replaced
against a behavioural baseline. But a block on your own page is yours to add, so I did not.

**To try it:** your profile → edit → **＋ 🗓 Chronicle**. It starts at **Friends**.

If something is wrong it will say _"Couldn't load this just now."_ rather than pretending your
record is empty — that distinction is deliberate and is the one failure mode I most want you to see
if it happens.

---

## What you asked for, and what it does

> _"i will want chronicle to be tied to account and profile status if shared — plus a profile block
> for the goals or stats"_

The account half was already true. Both other halves are built.

**The block** shows your hours over a window you pick (a week, a month, three months), split by
Locked In / Free Time / Life, your top five activities with their colours, and two counts: goals
reached, goals still going.

**The live line**, if you tick it, shows what you are doing _right now_ — the activity, its colour,
how long it has been running — above the week's figures.

## The three decisions I made for you

These are the ones to overrule if you disagree. Each was a judgement call, not a technical
constraint.

**1 · The block is the switch, and there is no other one.** No chronicle block on your page means
`get_member_chronicle` answers nothing at all — not an empty answer, no answer. Taking the block
off is a complete revocation rather than a hiding.

I deliberately did **not** hang it off `activity_visibility` the way the Stats block does. That one
switch already governs your Snake score, your shared circuits and your movie count together; three
unrelated facts behind one control is already more than it can honestly mean, and a record of how
you spend your days would have been a fourth and much the most personal.

**2 · It cannot be set to "Anyone".** The server refuses it, and the editor does not offer it.
`can_see(owner, 'public')` is true for signed-out visitors, but the RPC refuses anyone not signed
in — so that tier would _read_ as "the whole internet" and _behave_ as "members". A tier whose name
overstates what it does is the one thing a privacy control must never be. Friends, Members and Only
me all mean exactly what they say.

A side effect worth knowing: `get_public_profile` only ever returns blocks at the public tier, so
refusing that tier is also what keeps chronicle off a published page — one rule, not two that have
to agree.

**3 · No goal titles, and the live line is off by default.** The card shows activity _names_ — it
has to, or "9h 24m" is a number about nothing — and the editor says so in plain words. Goal titles
are different: they are what you wrote about your own life. While testing this, your own data
printed an activity called _"talking with josh and parker"_, which made the point better than any
argument I had. If you want titles, they belong behind a tick per goal, not one tick for all of
them.

---

## The rest of today

Four bugs where the room said something untrue, all found by using it rather than reading it:

|                                              |                                                                                                                                                                                                                 |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **"100% Locked In" over "Focused 0s"**       | Two seconds after Start. Right arithmetic, four contradicting statements. A share now needs a whole logged minute before it is a share at all.                                                                  |
| **"60 / 30 done"** on a row counting minutes | A target always carried a unit; the _default_ was the bug. The room usually knows the word — minutes, or the activity's own metric — so it fills it in, and the hint in the box now previews what you will get. |
| **Putting a copy back told half the room**   | A restore filled your goals in and left the stopwatch saying "Name an activity with ＋ Activity first" over a full account, indefinitely.                                                                       |
| **Orphaned buttons on a phone**              | A log row's ✎ and ✕ wrapped onto a line of their own, floating under an empty space. Every measurement said the page was fine; it took a screenshot.                                                            |

And three outside chronicle, found by sweeping the production build as a signed-out visitor — which
had not been done in a while and earned the trip:

- **`#visualiser` went to home.** The id is spelled with a z and every word on screen says
  "Visualiser" with an s, so the only spelling anybody can read was the one the URL refused.
- **`#account` went to home too** — found by the test written for the first one. I had walked into
  it myself an hour earlier and assumed I had mistyped.
- **The Circuit's ＋ and ✓** on every leaderboard row were explained by a tooltip and nothing else,
  which does not exist on a phone.

---

## Still open, and still yours

1. **The Circuit on chronicle** — untouched, because you said you did not want chronicle muddied
   yet. Nothing I did today moves that either way.
2. **Does a goal want a category** the way an activity does? Easier to add than to remove, so it is
   still not added.
3. **The `Change` button** beside your handle in Account is 62×17px — under the 24px floor for a
   thumb. It sits inline in a line of text so it wants its hit area extended rather than a taller
   button; flagged separately rather than fixed in passing.
4. **Firefox and Safari**, as ever. The Browser pane is Chromium, so everything above is "verified
   in Chromium" and the rest is inference.
