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

## Group g4: Lamps, Slide and Nonogram, 27 Nov 2026

### What each link carries

| Toy      | Link                                                                         | Who wins                                   |
| -------- | ---------------------------------------------------------------------------- | ------------------------------------------ |
| Lamps    | `#lab?demo=lamps&seed=…&size=4…7&pattern=plus\|cross&presses=…`              | Fewer presses, an undo counted as one      |
| Slide    | `#lab?demo=slide&seed=1…99999&difficulty=easy\|medium\|hard&pushes=…`        | Fewer pushes                               |
| Nonogram | `#lab?demo=nonogram&code=10x10.…` — not a beat link, the code is the picture | Nobody: it is a puzzle somebody drew, sent |

**Lamps is the one link that is checked, not claimed.** Its `presses` are one letter per press
(`A`–`Z`, `a`–`w` for lamps 0 to 48, `_` for an undo). Reading the link replays them on
`make(size, pattern, seed)` with `runSolve`, the toy's own rule for a finish: dark at the end and not
before, an undo counted. Anything that does not switch that board off is no challenge, so the banner
says "checked here — … They were replayed on this page and do switch it off; hints are not in the
link." It never calls `verifyLamps`, which refuses any day but yesterday, today and tomorrow: a link
carries the seed, so a random board or an old day's board can be sent too. Measured: making the
board and replaying a solve took at most 3.5 ms in node and 5.5 ms in bun over 480 boards, a solve
included (19:06 EST).

**Every real Lamps run has an even number of presses.** A board is lit by an even number of presses
(6, 10, 14 or 20), and every set of presses that changes nothing is even too: the press matrix's
null space has basis weights 8,8,8,8 and 6,4,4,6 on 4×4, 16,12 and 8,8,8,8 on 5×5, and is empty on
6×6 and 7×7, both patterns (computed 19:40 EST). A press and its undo, or a lamp pressed twice, add
two. So the first real run past the 400-press bound is 402, and the tests pad a real solve to 400
and 402 rather than 401.

**The same presses can switch off the other pattern's board from the same seed** when `make` kept
its first scatter for both, as it did for the fixture. That is a true replay, not a gap: the pattern
is part of the board, so a result on it is never compared with the link's.

**Slide keeps its own seeds.** `slide.ts` exports `SEEDS = 99_999`, what the toy mints and what a
link may carry. Every seed from 1 to 99,999 at every difficulty was generated in node (19:07 EST):
299,997 boards, none null, so `generate(...) ?? LEVELS[0]` never shows level 1 for a link. A link's
`pushes` must be at least its difficulty's fewest (`DIFFICULTY[d].min`), which every board's par is.

### What a link run may write

- **Lamps:** `solvedCount` and `bests` are untouched unless the link's board is today's board here
  (`seed === seedFor(size, pattern)` for today). Then the finish records exactly as the Today's
  button would: in the browser, the same presses through a link and through Today's left the two
  stores byte-identical. The link writes `size` and `pattern` the way their buttons do, as a
  preference, so every record keyed on the size is the board's own. It waits while "With the call"
  has the board, because the call's room is ruled by that size and pattern, and a duel ignores it.
- **Slide:** `endless[difficulty]` is untouched. A link only ever opens an endless board in component
  state; nothing is saved for it.
- **Nonogram:** `progress[code]` and `solved[code]` are written exactly as "Open a code" writes them;
  in the browser the two stores had the same keys and the same marks.

**Back takes a link's board with it** (the same rule as g1). A link clicked in a chat pushes a
history entry, and Back cleared the challenge while its board stayed up, to record as your own on
the next finish. Now a link that leaves the address any way but Leave deals what Leave deals: Lamps'
today's board at the current size, Slide's a new endless board.

### Nonogram: a drawn picture opens from a link

- The toy opens on `ofCode('A picture from a link', code)` when the address names `demo=nonogram`
  and a code `fromCode` accepts; anything it refuses opens the toy as it would have opened.
- A link clicked while the Lab is open is heard on `hashchange`, and opens unless that picture is on
  screen already.
- **Any other puzzle takes `&code=` out of the address** (`replaceState`, no `TOY_EVENT`). Left in,
  a second click on the same link changed nothing, because an identical hash fires no hashchange;
  with the rule removed, the browser check timed out waiting for exactly that.
- "🔗 Copy a link" sits beside "📋 Copy code" in the maker, and on a made picture in play mode.
  Built-in levels get none: a code carries no colours. The maker's sentence about sharing now says
  "by its code, or as a link that opens it".
- A reload after opening a level opens the toy's own first unsolved puzzle, as a reload always
  has, not the link's picture.

### Engine and pins

- Lamps' boards and solves for 12 seeds from 1 to 4,294,967,295 at every size and pattern (96
  fingerprints), and Slide's boards and solves for 8 seeds at every difficulty (24), are
  byte-identical in node v22.23.4 and bun 1.4.4 (19:06 EST). Both are integer xorshift with
  divisions by 2^32; neither sorts.
- `lamps.test.ts` pins every size and pattern at seed 3,000,000,001 and `slide.test.ts` every
  difficulty at seed 99,998, as SHA-256 through WebCrypto (the g1 convention: `node:crypto` is not
  typed for `src/`). Both figures agree in node and bun.

### Corrections to the spec

- **Day 20784 is 27 Nov 2026 itself**, not 30 days ago. The test takes today as 20,784 (and checks
  that against `dayNumber`) and sends the board of day 20,754.
- **The Slide share sits just above the result paragraph**, not inside it: `BeatShare` renders a
  `<div>`, which cannot sit in the `<p>` that holds "Another ›".
- **The fixture with its pattern changed is not refused**, as the spec's list implied — see above.

### Tests and mutations

`beat.test.ts` gained two FIXTURE rows (12 generic tests) and 13 g4 cases: golden links, bounds at
lo − 1, lo, hi and hi + 1 from `SIZES`, `MAX_ACTIONS`, `SEEDS` and `DIFFICULTY`, the forged-presses
refusals, outcome better, level and worse, and the banner, invitation and reply sentences. The toy
tests pin the boards and build the sender's board from the link with the generator called directly.

24 mutations were run against the tests and 23 went red, among them every one the spec named:
Lamps' `check` removed, Slide's minimum removed, the presses alphabet widened to `x`. The one that
stayed green raises the presses codec's bound past `MAX_ACTIONS`: `runSolve` refuses past
`MAX_ACTIONS` itself, so nothing can observe it. Lowering it goes red. In the browser, removing
either toy's records guard changed the records, and removing Lamps' Back guard left the link's
board up after Back.

### Browser, 27 Nov 2026 (Playwright Chromium, 375, 820 with the `(pointer: coarse)` rules, 1440)

Lamps 19:23–19:24, Slide 19:28–19:30, Nonogram 19:31–19:34 EST.

- **Lamps and Slide:** A sent a non-default board (6×6 corners on ⟳ New board; hard on 🎲 New
  board). B opened it in a fresh context with records already kept and saw A's board (every lamp's
  state; the seed, the difficulty and a par equal to the solver's in node). B finished better, level
  and worse, its records unchanged but for Lamps' size and pattern, and sent a reply carrying A's
  board and B's score. C's banner showed B's score. Leave wrote `#lab?demo=<toy>`, dealt today's
  board or a new endless one, and the next finish recorded. At 1440: warm opens from another toy and
  from the same toy, Back took the link's board with it, the picker wrote `#lab?demo=<other>`, and
  malformed links (a parameter dropped, `seed=4294967296`, doctored presses, another size,
  `seed=100000`, pushes under the minimum, an unknown difficulty) opened the toy with no banner. A
  link to today's Lamps board said so in its banner, and finishing it left the store byte-identical
  to the same presses on Today's.
- **Nonogram:** A drew a 10×10 picture from the keyboard and copied a link. B, with records kept,
  read the same clue numbers from the stage as A's page showed for A's own picture, solved it, and
  had the same keys and marks written as "Open a code" writes. B's own "🔗 Copy a link" carried the
  same code. Opening a level dropped the code from the address, the same link opened again, and a
  reload opened the toy's first unsolved puzzle. At 1440: warm opens from another toy and the same
  toy; four spoiled codes opened Heart with the address put back on `#lab?demo=nonogram`; the picker
  wrote `#lab?demo=lamps`.
- **Every toy, every width:** no sideways scroll. Leave measured 161×36, 162×37 and 165×39, the share
  234–237 wide by 36–39, Nonogram's "🔗 Copy a link" 119–122×36. `mobileAudit` named an injected
  16×16 control each time and was clean without it.

Headless swiftshader loses a WebGPU device now and then when another context closes; the scripts
press the stage's own "Try again", which is the toy's way back from a lost device. Firefox and
Safari are not reachable from here and need a look.
