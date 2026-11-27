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

## Group g2: Golf patience, Mines and Tile pairs

Three arms, each one block after the `g2` markers in `beat.ts` and `beat.test.ts`, and the three
rooms wired as R1–R5 say. All three are daily toys, so each has one case where a link counts.

### What each link carries

| Toy           | Parameters after `demo`                       | The board is            | Better is     |
| ------------- | --------------------------------------------- | ----------------------- | ------------- |
| Golf patience | `seed`, `wrap` (`1`/`0`), `score` (−16 to 35) | `seed` and `wrap`       | a lower score |
| Mines         | `seed`, `size`, `start` (a square), `tenths`  | `seed`, `size`, `start` | fewer tenths  |
| Tile pairs    | `seed`, `layout`, `secs` (penalties included) | `seed` and `layout`     | fewer seconds |

- **Golf's score bounds are golf.ts's own reader bounds,** built from `COLUMNS * DEPTH`. The test
  takes them from a dealt hand instead: `left(deal(s))` is 35 and `−deal(s).stock.length` is −16.
  `-0`, `+3` and `03` are refused, so a score is written one way only.
- **Mines' `start` is part of the board.** `layBoard` keeps the first square and its neighbours
  clear, so the same seed opened from another square is another board. `start` is read up to the
  largest board's last square (479), and the arm's `check` refuses a square past its own size's
  (a small board with `start=200`). This is the first arm with a `check`, and it closes the base's
  open item: with `readBeat`'s `check` line removed, a test now goes red.
- **Tile pairs' noun is "deal", not "tiles".** The banner's lead is `A ${noun} to beat:`, and "A
  tiles to beat:" is not English. The toy's own button says "New deal".

### What a link never writes

A link's board is practice. Its finish writes none of these:

- **Golf:** `played`, `cleared`, `best`, `onPar`, `today`.
- **Mines:** `played` (a lost board included), `won`, `best[size]`, `today`.
- **Tile pairs:** `cleared`, `best[layout]`, `today`.

The one exception is a link to today's board here, which records exactly as the Today button
would. The banner then says "It is today’s board here, so it counts as your today’s." That case is:

- **Golf:** `seed` is today's and `wrap` is off.
- **Mines:** medium, opened from the middle (136), on today's seed.
- **Tile pairs:** `seed` is today's and `layout` is today's layout.

Preferences a link does write, the way the toy's own buttons write them:

- **Mines** writes `saved.size` and **Tile pairs** writes `saved.layout`, so the size or layout
  shown pressed is the one on screen.
- **Golf never writes `saved.wrap`.** That setting decides whether Today's records at all, so a
  friend's king-and-ace link would quietly stop the receiver's own Today's from counting. The
  link's rule lives on the deal (`game.wrap`), and the rule button now shows the rule in play
  rather than the saved one. Off a link the two are always the same.

### Mines: where the clock starts

The clock starts on the first square acted on, so a link has to start everyone in the same place.

- **A practice board opens unlaid,** with its start square marked: class `is-start`, a dashed
  outline and a `◎`, never colour alone. Its label adds ", the square this board opens from", the
  keyboard cursor sits on it, and it is scrolled into view. Until it is opened, a press or a flag
  anywhere else (or a flag on the mark) does nothing and says "This board opens from the marked
  square ◎ — open it to start the clock."
- **The refusal sits before `t0`.** With it moved after, a refused press started the clock
  (measured: "1 s" after a refused press, against "0 s").
- **A sender's Today's board opens already opened,** as Today's does: medium, from the middle, on
  the daily seed of yesterday, today or tomorrow here, because a friend in another time zone is on
  another day. It counts as Today's only when it is today's seed here.

### Tile pairs: the reshuffle is seeded

The k-th press of Shuffle on a deal is `shuffle(board, floor(dealRand(dealSeed, k, 0)() * 2^32))`.
A `shuffles` count is reset by each new deal and is not rewound by undo. The multiply is exact,
because the stream's numbers are whole 32-bit states over 2^32.

This applies to every deal, Today's included. **Today's reshuffles change once:** they used to come
from `Math.random`, and now the same moves give the same reshuffles for everybody. Starting deals do
not change.

### The board follows the address

- **Leaving by a control.** Every control that changes the board leaves the challenge first:
  Today's, New deal or Practice, a size or layout, and Golf's rule. Each guards on there being a
  challenge, so `dropBeat` never rewrites an address the Lab does not own.
- **Leaving any other way.** A link can also leave the address by Back or a typed address. The
  room then deals Today's rather than leaving the link's board on screen to record as practice.
  Measured in the browser: Back from a Golf link left `#lab?demo=golf` with Today's dealt.
- **Start again keeps the link.** "↻ Start this deal again" (Golf) and "↻ Start again" (Mines and
  Tile pairs, which says that instead of "New board" or "New deal" on a link) replay the link's own
  board.
- **The which-board buttons.** They show as unpressed on a link to any board but today's, for all
  three toys. The spec asked this of Golf only.

### Same board in every browser

Measured at 18:29 EST, 27 Nov 2026: 531 fingerprints were byte-identical in node v22.23.4 (V8)
and bun 1.4.4 (JavaScriptCore). The seeds were 1, 2^31 − 1, 2^31, two daily seeds, 2^32 − 1 and
12 spread across the range. They covered:

- Golf's deal under both rules;
- Mines' board for all three sizes from three squares each;
- every Tile pairs layout and its first three reshuffles.

Every generator is a Fisher–Yates over `rng`. The only `sort` on the way is in Golf's par solver,
which is display only and a stable sort.

Each toy's test pins its board as the SHA-256 of its JSON. The spec asked for md5, but `src` has
no Node types, so the pin uses `crypto.subtle` (which has no md5). The md5s were computed alongside
in both engines:

| Pinned board                               | md5                                |
| ------------------------------------------ | ---------------------------------- |
| `deal(4_279_824_600, true)`                | `73cd9e91d3894d1975c23c410e544d68` |
| Mines, large, seed 4,294,967,295, from 241 | `244c7527fd2d4c0a9d00932c3fefb6a1` |
| Twin towers, seed 3,000,000,001            | `066072675336073bcce3a67eaba18c3b` |

Each pin went red with its seed literal changed.

### Mutations

Every one of these went red, and every file was restored by md5:

- **Unit:**
  - each arm's rank sign flipped;
  - each arm's board missing a field;
  - Golf's score bounds one wider at either end;
  - `-0` accepted;
  - Mines' `check` removed, or made `<=`;
  - Mines' `start` bound typed as 255;
  - Mines' and Tiles' value lists widened;
  - the time bounds one wider at either end;
  - Tiles saying the layout's id;
  - Mines' board laid from square 0 whatever the start.
- **Browser:**
  - each toy's record guard removed: the receiver's records changed;
  - Mines' refusal moved after `t0`: the clock ran;
  - Tiles' reshuffle back to `Math.random`: two pages that took the same pair and pressed Shuffle
    no longer matched.

**One stayed green, correctly:** Mines' `start` bound typed as 479 instead of derived. It is the
same number today. Deriving it is what makes a fourth size widen it.

### Verified in the browser (Playwright, Chromium, 27 Nov 2026, 18:42–18:53 EST)

Each toy ran at 375 (touch), at 820 with the `(pointer: coarse)` rules injected, and at 1440.

- **Sender and receiver.** A sends from a practice board on a non-default rule, size or layout. B
  opens the link in a fresh context with records already kept. Through the page's own rendering, B
  reads back:
  - the same cards in every column, the stock and the waste;
  - every Mines cell's class after the start opens;
  - the same tiles, and the same tiles again after the same first pair and one Shuffle.
- **Records.** Each receiver's records were unchanged after finishing twice. The only stored
  difference was Mines' `size` and Tiles' `layout`.
- **Outcomes.** The verdicts reached were beat, not this time, and level (Golf), across B and C.
- **Replies.** B's reply carried A's board and B's score, and C's banner showed B's score.
- **Leave.** Leave wrote `#lab?demo=<toy>`, dealt Today's, and the next finish recorded.
- **Today's link.** It recorded as Today's. Golf's stored result was byte-identical to the Today
  button's.
- **Yesterday's Mines board.** It opened pre-opened, as practice.
- **Warm opens.** These worked from another toy and from the same toy.
- **Malformed links.** These opened Today's with no banner: `seed=4294967296`, a dropped
  parameter, `score=-0`, `start=81` on small, and `layout=tower`.
- **The picker.** On a link, it wrote `#lab?demo=<other>` alone.
- **Layout.**
  - No sideways scroll anywhere.
  - Leave measured 161×36 at 375 and 165×39 at 1440. The share measured 223–237 wide by 36–39.
    The marked square measured 26×26 at 375 and 30×30 above that.
  - `mobileAudit` named an injected 16×16 control, then reported nothing once it was removed.
  - At 375 the marked square scrolls to just above the bottom bar, and `elementFromPoint` hits
    it.

**Not reachable from here:** Firefox and Safari need a look.
