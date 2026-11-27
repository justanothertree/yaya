# Beat my board: a link carrying the seed and the score, for more toys

Batch 1 of the play-together audit (Evan, 27 Nov 2026: "the best games are ones all your friends
can play together"). Stackfall and Ten thousand already send a "beat my run" link (`04668b1d`): the
seed and the score travel in the address, whoever opens it plays the same luck, and the page says
whether they did better. This batch gives eleven more toys the same link. This file records the
base those toys are built on. Each group of toys adds its own section below when it lands.

## The base, 27 Nov 2026

### A table of arms, not a hand-written union

`src/lab/beat.ts` was a union of two shapes, and every arm had to be kept in step in four places:
the type, `beatHash`, `readBeat` and `beatMessage`. Two arms took 117 lines. Eleven more would make
that four hand-written hunks per toy, written by four builders at once. The shape also had a trap:
`beatHash` wrote anything that was not Stackfall as dice parameters (its `else`), so a new arm
forgotten there would have minted a Ten thousand link.

So `ARMS` is now a table. Each arm declares its fields once, as codecs in URL order, plus:

- which of those fields make the board;
- a `rank`, where smaller is better, compared figure by figure;
- `says`, the score in words;
- the toy's name, the noun for one game, what is the same, and how to win.

`beatHash`, `readBeat`, the reply sentence, the banner, `outcome` and `shareable` all read the
table, so a new toy is one block. A prototype of all 13 arms came to 221 lines.

The codecs are the only ways a value can enter from a link:

| Codec     | What it accepts                                                   |
| --------- | ----------------------------------------------------------------- |
| `whole`   | A bounded whole number                                            |
| `signed`  | A bounded whole number that may be negative, written only one way |
| `tenths`  | Stackfall's seconds to a tenth                                    |
| `oneOf`   | A value from a list the toy exports                               |
| `flag`    | `1` or `0`                                                        |
| `presses` | A run of lamp presses, which the arm's `check` replays            |

A link still carries no name. Anything malformed, out of range or failing an arm's `check` is no
challenge at all.

### The seed bound

`readBeat` refused any seed above 2^31 − 1. Daily boards are dealt from `daySeedOf`, a full 32-bit
FNV hash, so most daily seeds could never have been sent.

**Measured at 06:20 EST on 27 Nov 2026, in bun 1.4.4 and node v22.23.4, which agree:**

- 430 of the 730 daily seeds from 27 Nov 2026 to 25 Nov 2028 are above 2^31 − 1.
- 222 of the next 365 are above it.
- That day's own seed, `daySeedOf(2026, 11, 27)`, is 4,279,824,600.

The audit doc's 444 is wrong; the count is 430. The fix is the same either way.

There are now two bounds:

- **`SEED_MAX` = 2^32 − 1** is the read bound. It covers every seed `daySeedOf` or `>>> 0` can
  produce.
- **`MINT_MAX` = 2^31 − 1** is what `newSeed` mints from, unchanged. A tab still running the old
  bundle refuses seeds past 2^31 − 1, so every link this build mints still opens there.

### Backward compatibility: a link already pasted opens as before

Stackfall and Ten thousand links already sit in people's chats. They must read to the same Beat and
deal the same luck. `beat.test.ts` pins this verbatim:

- the two link shapes, both ways;
- parameter order, a leading zero (`seed=05` reads as 5), and a repeated parameter (the first wins);
- two dice deals: `roll(6, dealRand(42, 0, 0))` is `[3, 3, 1, 4, 6, 5]`;
- both sentences.

**Old against new, measured at 06:41 EST** (`main`'s `beat.ts` against this base, in bun and node):

- Of 20,000 links, built the way the two toys build them plus hostile ones:
  - 16,199 read identically;
  - 3,801 open now that did not before, every one with a seed from 2^31 to 2^32 − 1;
  - 0 differ in any other way.
- 3,000 links written by the old code read back byte-identical here, with identical sentences.
- A control with the seed's lower bound moved to 0 reports 1,687 differences, so the sweep can
  speak.

The rule for every arm that follows: **an old seed stays valid when a bound widens, and a link's
parameters, their order and their sentence never change once one has been sent.** A deliberate
change to a generator needs a `v=` parameter. Each toy's board pin exists so that such a change goes
red.

### What a link run may write

**Playing a link never writes the toy's own records**, unless the toy's rules say the link is
today's board on today's date. In that case the arm says so in its banner (`bannerText(b, true)`).

This base changes Stackfall's behaviour. Until now, a link run updated the longest run, most lines
and best score. "Play again" replays the link's seed every time, so a record could be built on a
piece order learned by heart. Now a link run records nothing. Measured in the browser with the
record seeded at a longest run of 0.1 s and a score of 1:

- after two link runs (1.5 s, 212 points) the record was unchanged;
- after Leave, the next run recorded normally (0.7 s, 242).

Ten thousand's race never wrote records, so it is unchanged.

### Leaving puts the address on the toy, not on a bare `#lab`

`dropBeat(game)` writes `#lab?demo=<game>` with `replaceState`, keeping `history.state`. A bare
`#lab` names no toy (`currentToy` is null), so friends on a call saw "on the Lab" and Follow lost
you. `dropBeat` fires no `TOY_EVENT`, because the toy has not changed.

### Replies

Whoever finishes a link can send their own result on the same board. The sentence depends on how
the result stands against the link:

- **Beat:** "🏆 I beat the link at …: 3:20 with 50 lines — it said 3:12 with 45 lines. Same pieces,
  same order, your go:"
- **Level or short:** "🏁 My go at … — the link I was sent said …"

The reply link carries the sender's board and the replier's score. It never carries a name or a
"versus" parameter, so any number of friends can each answer.

**One change from the spec:** a result from a different board goes out as a plain invitation, not
as a reply. Opening a second link while the last run's share is still on screen made that
reachable, and the sentence would have compared two boards that were never the same.

### How a group adds an arm

Marked blocks, one line each. Insert directly after your own marker, keep your lines together, and
edit no other line:

| File                   | Markers                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lab/beat.ts`      | `/* ── gN imports ── */` after the imports. `/* ── gN arms ── */` inside `ARMS`                                                       |
| `src/lab/beat.test.ts` | `/* ── gN imports ── */` after the imports. `/* ── gN fixtures ── */` inside `FIXTURE`. `/* ── gN cases ── */` at the end of the file |

`FIXTURE` is typed `{ [G in Game]: Extract<Beat, { game: G }> }`, so an arm with no row fails
`npm run typecheck`. Every field in a row must be away from its default:

- not the toy's EMPTY setting;
- not a codec's lower bound;
- not the first value of a `oneOf` list;
- flags true;
- seeds above 2^31, except Slide's.

Each row then runs the generic tests:

- a round trip both ways;
- `shareable`;
- every parameter, `demo` included, deleted, set to `x` and set to `''` reads as no challenge;
- `currentToy`, `toyHash` and `hashParam('match')` answer correctly, so the tour and Follow are
  unaffected;
- the invitation's opening and closing;
- the arm is level with itself;
- its parameter keys are unique and none is `demo`;
- its board is made of its own fields;
- it is a toy in `labDemos.tsx`.

**Two things the base cannot make fail, because neither existing arm has them:**

- `check`: removing the call in `readBeat` keeps all 48 base tests green.
- The `checked` wording in `bannerText`.

So the first arm with a `check` (Mines, Slide or Lamps) must show its refusals going red with the
check removed. Lamps must pin its "checked here" banner.

**`mobile-audit.js` cannot see a control inside the banner.** The banner is a `<p>`, and the
audit's `inProse` rule skips an inline-block control inside a paragraph as a link in a sentence. A
16×16 button injected into the banner went unreported. The same button in `.beat-share` was named
at once. Measure the Leave button directly. It was 161×36 at 375 and 165×39 at 1440.

### Verified

- **Gates:** `npm run typecheck`, `lint`, `test` and `build`.
- **Unit tests:** `beat.test.ts` has 48 tests. Of 30 deliberate mutations, 29 turned at least one
  test red. The one that did not is removing `check`, as noted above.
- **Browser** (Playwright, Chromium, 1440 and 375):
  - A sends a link; B opens it with records already kept and beats it, and the records are
    unchanged.
  - B's reply carries A's seed and B's time, and C sees B's score on the banner.
  - Leave writes `#lab?demo=stack`, and the next run records.
  - Both pinned links open with their old banners, and Ten thousand opens the race.
  - A daily-sized seed (4,279,824,600) now opens; `seed=4294967296` and a link missing a parameter
    open the toy with no banner.
  - A warm open works from another toy and from the same toy.
  - Picking another toy writes `#lab?demo=dice` with no beat parameters.
  - No sideways scroll at 375 or 1440.
- **Not reachable from here:** Firefox and Safari. They need a look.
