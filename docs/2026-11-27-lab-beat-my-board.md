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

## Group g1: Yacht and Shut the box

Both toys already had a game alone, scored and recorded, and both rolled it with `Math.random`. A
game alone is now dealt from a seed, so any finished one can be sent, and a link opens the toy alone
on the sender's seed.

### What a link carries

| Toy          | Link                                   | Wins             | Says                                 |
| ------------ | -------------------------------------- | ---------------- | ------------------------------------ |
| Yacht        | `#lab?demo=yacht&seed=…&points=0..297` | more points      | "212 points"                         |
| Shut the box | `#lab?demo=shut&seed=…&left=0..45`     | fewer tiles left | "7 left", or "0 left — the box shut" |

- The seed is beat.ts's `SEED`, 1 to 2^32 − 1. A score is a claim, as everywhere in this file.
- 297 is the most twelve boxes can hold. beat.test.ts works it out from every throw of five dice,
  and the room's own "of 297 possible" is asserted against the same figure.
- 45 is every tile up. beat.test.ts adds up the box's own tiles.
- A box shut, 0 left, can only be levelled.

### The luck

- **Yacht:** roll k of turn t comes from `dealRand(seed, t, k)`, where t is how many boxes are
  filled. The dice not kept draw in position order, so the same keeps get the same dice, and keeping
  one die more takes the first values of the same draw. yacht.test.ts checks that for every one of
  the 31 ways to keep dice, in every turn and both re-rolls, on two seeds (1,488 cases).
- **Shut the box:** the k-th roll of a turn alone comes from `dealRand(seed, k, 0)`. A one-die roll
  is the first die of the same two, so choosing one die never shifts the dice. A `rollNo` ref counts
  the rolls and `fresh` resets it.
- Against the computer, both toys keep `Math.random`, the computer's rolls included. There is no
  link for those games.

### The room

- A link opens the toy **Alone** on the link's seed, with the banner at the top. A link clicked
  while the toy is already up does the same.
- **"↻ New game" (Yacht) and "↻ New turn" (Shut) replay the link's seed while a link is up.** That
  is a retry, as Ten thousand's race and Stackfall's "Play again" already do. It departs from R3,
  which lists New board among the controls that leave; the Yacht spec asked for the replay, and
  Shut follows it so the two dice toys behave alike.
- "Against the computer" leaves the link first. Leave deals a new game alone on a `newSeed()`.
- **Back also takes the link's game with it.** A link clicked in the site's chat while the Lab is
  open pushes a history entry. Before this, Back to `#lab?demo=yacht` cleared the challenge but left
  the game running on the link's seed, so finishing it would have recorded a best on a board the
  reader may have learned by heart. Now, when the challenge leaves the address some other way than
  Leave, a game on its seed is replaced, exactly as Leave replaces it. Stackfall and Ten thousand
  have the same gap; they are the base's, so it is noted here rather than changed.
- A match (`lm.id`) ignores the link, and neither the banner nor the share appears in one.

### What a link game may write

Nothing. Neither toy has a daily, so a link game is always practice.

- **Yacht:** `saved.best` is not written, and the "Best alone" figure no longer shows a link game's
  total as a best.
- **Shut the box:** `turns`, `shut` and `best` are not written.

The result line gets the verdict instead of "your best": "All twelve boxes filled: 56 points. You
beat the link's 41 points!"

### Tests

- **beat.test.ts:** two FIXTURE rows, `{ seed: 4_279_824_600, points: 212 }` and
  `{ seed: 3_000_000_001, left: 7 }`, which run every generic test. Six g1 cases add each bound at
  lo − 1, lo, hi and hi + 1, outcome better, level and worse, and the banner, the invitation and a
  reply pinned verbatim for each toy.
- **yacht.test.ts and shut.test.ts:** a scripted game with a fixed way of choosing, pinned. Yacht's
  36 rolls are pinned by SHA-256 of their JSON; Shut's six rolls are pinned verbatim. The pins were
  computed in node v22.23.4 and bun 1.4.4 and agree, for seven seeds from 1 to 4,294,967,295 on both
  sides of 2^31 (18:28 EST). The link's seed deals the sender's game, the same choices played twice
  get the same dice, and another seed gets other dice.
- The pins use SHA-256 rather than md5 because the tests are browser-typed: WebCrypto is typed
  there and has no md5, and `node:crypto` is not typed there.
- **Failing once:** 16 of 16 mutations turned at least one test red. They were each bound one past
  the toy's figure, each rank's sign flipped, each field dropped from an arm, Yacht's board emptied,
  Shut's box-shut wording, Yacht's seed bound back to 2^31 − 1, each pin's literal changed, Yacht's
  `roll` drawing for kept dice too, Shut's one die taken from the second draw, and `dealRand`'s mix.
- **Failing once in the browser:** with Shut's `rollNo` left unreset, B's replay no longer matched
  A's dice. With the record guard inverted, both toys' records changed (Yacht's best went 5 to 94;
  Shut's turns went 31 to 34). With the Back guard removed, the dice stayed on screen after Back.

### Browser, 27 Nov 2026 (Playwright, Chromium)

A sent a game alone. B opened it in a fresh context with records already kept, then played it
three ways. C opened B's reply.

- **Same board:** B's first roll matched A's, and B's replay with A's own choices matched all of A's
  rolls (36 for Yacht).
- **Verdicts:** beat, level and "not this time" were all reached in both toys (Shut's "not this
  time" at 375).
- **Records:** B's stored records were unchanged after three link games. After Leave, the next game
  recorded: at 1440, Yacht's best went 5 to 32 and Shut's best went 44 to 34.
- **Replies:** B's reply carried A's seed and B's score, and C's banner showed B's score.
- **Leave:** the address became `#lab?demo=yacht` or `#lab?demo=shut`, the banner went, and the new
  game's first roll differed from A's.
- **Warm opens:** from another toy, and from the same toy against the computer, a link switched to
  Alone with the banner. On the same toy, the first roll matched A's.
- **Back:** after a warm open, Back gave `#lab?demo=<toy>`, no banner, and a fresh game.
- **Malformed:** `seed=4294967296`, a missing score, `points=298` and `left=46` opened the toy
  against the computer with no banner.
- **Tour:** picking another toy from the picker wrote `#lab?demo=<other>` with no beat parameters.
- **Layout:** no sideways scroll at 375, 820 or 1440; `mobileAudit` clean with the banner and share
  up, after naming an injected 16×16 control in the share. Leave measured 161×36 at 375, 162×37 at
  820 with the 41 `(pointer: coarse)` blocks applied, and 165×39 at 1440. The share buttons measured
  222 to 235 wide by the same heights.
- Yacht at 1440, 18:38 EST; Yacht at 375, 18:39; Shut at 1440, 18:40; Shut at 375, 18:40 and
  18:41; 820, 18:43. The three browser mutations ran 18:41 to 18:43.

**Not reachable from here:** Firefox and Safari need a look. Both toys' dice are integer maths
over `seeded`.

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

## Group g3: Pipes, Cages, Island bridges and Tents

Four daily puzzles, each with a size, a Today's board and a ⟳ New board, solved against the clock.
A finished board of any size, Today's or random, can now be sent as a link carrying the seed, the
size and the time. Whoever opens it is dealt the same board.

### What a link carries

| Toy            | Link                                                           | Wins                     | Says                                        |
| -------------- | -------------------------------------------------------------- | ------------------------ | ------------------------------------------- |
| Pipes          | `#lab?demo=pipes&seed=…&size=5\|7\|9&wrap=0\|1&secs=…&turns=…` | faster, then fewer turns | "1:35 and 61 turns on a 9×9 wrapping board" |
| Cages          | `#lab?demo=cages&seed=…&size=4\|5\|6&secs=…`                   | faster; hints add time   | "2:20 on a 6×6 board"                       |
| Island bridges | `#lab?demo=bridges&seed=…&size=7\|9\|11&secs=…`                | faster; hints add time   | "2:20 on an 11×11 map"                      |
| Tents          | `#lab?demo=tents&seed=…&size=6\|8\|10&secs=…`                  | faster; hints add time   | "2:20 on a 10×10 field"                     |

- The seed is beat.ts's `SEED`, 1 to 2^32 − 1. A daily board's seed is a full 32-bit number here
  too (`daySeed ^ size·7919`, and for Pipes the wrap mask), so Today's boards can be sent.
- The sizes are each toy's own `SIZES`, imported, never retyped. Anything else is no challenge.
- `secs` is 1 to 86,400 (a day) and is the toy's own finishing time, every hint's 30 s included,
  exactly as the toy's `Math.max(1, …)` computes it. Pipes has no hints. `turns` is 1 to 99,999.
- Pipes ranks by `[secs, turns]`, the order its own `keepBest` ranks a day's finishes in.
  beat.test.ts asks each toy's `keepBest` directly, across a sweep, rather than restating it.
- Every score is a claim, worded as "this link says".

**One change from the spec's wording:** the spec wrote `on a ${n}×${n} map`, which says "a 11×11
map" and "a 8×8 field" at sizes these toys have. The arms say "an" before a size whose word starts
with a vowel; beat.test.ts checks every size of every toy against the spelled-out number.

### Opening a link

- The link writes `saved.size`, and Pipes' `saved.wrap`, exactly as the size and wrap buttons do,
  then sets the seed. So `daily` is the toy's own question (`seed === seedFor(size)`), and a best
  kept from a link's board is filed under the board's own size. The size (and Pipes' wrap) is a
  practice preference, and it is the only thing a link writes.
- When the link's board is Today's board here, the banner says it counts as today's, and the
  finish records exactly as the Today's button's would.
- A link clicked while the toy is up, even one on the board already showing (a friend's reply on the
  same board), starts the board over. A `round` counter joins the reset effect's dependencies for
  that, and Leave bumps it too, so leaving a link to Today's board deals Today's fresh. Without it,
  a reply on a board already finished left the board locked under the new banner, with no way to
  play it but a reload.
- Cages, Island bridges and Tents keep the result line in state, and it was never reset with the
  board: after ⟳ New board, "🏆 Solved in 2:20." stayed up over an empty grid. With a verdict in
  it, that line would have named a link that was no longer up, so the reset now puts the opening
  line back. Pipes works its line out on each render and had no such gap.
- Every control that changes the board leaves the link first: the size buttons, Pipes' "Edges
  wrap round", Today's and ⟳ New board (New map, New field). The looks, "Show clashes", "Grass
  round tents", Pipes' 🔒 and "↺ Start this board again" do not change the board, so the link
  stays.
- Leave writes `#lab?demo=<toy>` and deals Today's board at the link's size.
- **Back keeps the board on screen.** A link clicked in the site's chat pushes a history entry, and
  Back clears the challenge while the board stays. That is safe in these four toys, unlike Yacht and
  Shut the box: their bests are kept only for Today's board, which a link to it counts as anyway, so
  there is no best to build on a board learned by heart. A finish after Back adds one to the boards
  finished, as any other board would. Half a solved puzzle is not thrown away.
- ⟳ New board now uses beat.ts `newSeed()` instead of `(Math.random() * 2 ** 31) >>> 0`, which
  could be 0.

### What a link run may write

Nothing of the toy's records, unless it is Today's board here:

- `solvedCount` and `bests` are untouched by a link board that is not Today's.
- On Today's board, both are written as Today's button would write them, and the line may say "your
  best on today's board", because it is.
- The result line ends with the verdict, and BeatShare appears under it with the reply sentence.

### The same board in every browser

- The four generators use `rng` from bricks.ts, integer comparisons and numeric sorts on distinct
  integers only. The grep over pipes.ts, cages.ts, bridges.ts and tents.ts finds no `sort(() =>`,
  no `rand() - 0.5`, no `Math.random` and no float maths beyond `rand() * k`.
- **Measured at 18:56 EST on 27 Nov 2026:** 240 boards (16 seeds from 1 to 4,294,967,295, both sides
  of 2^31, every size, both wraps) are byte-identical in node v22.23.4 and bun 1.4.4. The control, a
  seeded comparator shuffle, diverges between them at 81 and 100 elements, so the probe can see an
  engine difference.
- **The batch's earlier probe could not see half of a Tents field.** It fingerprinted
  `JSON.stringify(make(n, seed))`, and JSON writes a `Set` as `{}`, so Tents' trees and tents were
  never compared, only its row and column counts. The probe here and tents.test.ts's pin write the
  sets as sorted lists. A pin with the trees emptied goes red.
- No board changes for anyone. Firefox (SpiderMonkey) was not measured.

### Tests

- **beat.test.ts:** four FIXTURE rows, every field away from its default, which run every generic
  test. The g3 cases add, for each toy: every size opens and every other number from one below the
  smallest to one above the largest is refused; `secs` at 0, 1, 86,400 and 86,401; beat, level and
  short; another seed or size is no comparison; the article at every size. Pipes adds `turns` at its
  edges, `wrap`, the tie on time going to fewer turns, and "1 turn". A sweep checks `outcome`
  against each toy's own `keepBest`. The banner, the invitation and a reply are pinned verbatim for
  every toy, and a time past a day is not offered.
- **pipes, cages, bridges and tents.test.ts:** one seed's boards at every size (and both wraps) are
  pinned by SHA-256 of their JSON, as g1 does: node:crypto is not typed for these tests, and
  WebCrypto has no md5. A readable slice is pinned beside each hash. The seed, size and wrap a link
  carries, read back through `readBeat(beatHash(…))`, make the board `make()` makes from the
  literals, and another seed or size makes another board.

### Mutations, each made to fail once

- **Unit (beat.test.ts and the four toy tests):** 21 of 21 went red. In beat.ts: Pipes' rank
  without the turns tie-break (3 tests) and with its sign flipped (4); a size outside the toy's
  list accepted (Pipes' 6, and Cages' size read as any whole number 3 to 7); `secs` one past a day
  and from 0; `turns` one past 99,999; Pipes' `wrap` and `turns` each dropped from its fields (5
  each); Cages' size and Pipes' wrap each dropped from `board`; "a" always, "turns" for one turn,
  and "board" for a field.
  In the toy tests: each pin's literal seed moved by one, Tents' pin with its trees emptied, Pipes'
  link test reading the wrap the wrong way, and `SEED_MAX` back to 2^31 − 1 (all four link tests).
- **Browser** (the dev server, a receiver with records kept, the link opened and finished once):
  - Cages' record guard switched off: `solvedCount` changed (it must not).
  - Tents' link not writing the size: an 8×8 field of 64 cells instead of the link's 10×10, no
    verdict, and `solvedCount` written, because the board on screen was no longer the link's.
  - Cages' `round` left out of the reset: a reply link on the board already finished left the
    number pad disabled, so the friend's board could not be played.
  - Each was restored from a copy and its md5 checked.

### Browser

Playwright, Chromium, on the dev server, 27 Nov 2026 (EST). Each toy at 1440 (19:05–19:09) and at
375 with touch (19:09–19:11), and all four at 820 with the 41 `(pointer: coarse)` blocks applied
(19:11–19:12). Cages, Island bridges and Tents ran again at 1440 after the result line was made to
reset (19:16–19:19), and passed every step. Times were set with Playwright's clock, so every score
was exact.

- **Sender (A):** a non-default size (9×9 with wrapping, 6×6, 11×11, 10×10) and a ⟳ New board,
  finished with the toy's own buttons from a solution worked out in node from the toy's module.
  The copied sentence read "🏁 Beat my board at Pipes: 2:20 and 110 turns on a 9×9 wrapping
  board. Same board:" and so on.
- **Receiver (B), with records kept already** (a count of 7, yesterday's best at the link's size and
  a best of today's at another size):
  - The banner said what the link says, the same thing, and how to win.
  - Every cell's words, and Tents' and Cages' numbers, matched A's page, at both widths.
  - B beat it, fell short and levelled, all three reached, each saying so in the result line.
  - The records were unchanged afterwards except `size` (and Pipes' `wrap`).
  - B's reply read "🏆 I beat the link at …", carrying A's seed and size and B's time.
- **Reply (C):** B's link showed B's score on A's board.
- **Leave:** the address became `#lab?demo=<toy>`, the banner went, Today's was dealt at the link's
  size, and its finish recorded (`solvedCount` 7 → 8, a best for today at that size).
- **Warm opens (1440):** from another toy and from the same toy, the banner showed and the link's
  board was dealt fresh.
- **Today's board as a link (1440):** the banner added "It is today’s board here, so it counts as
  your today’s." and the finish wrote `solvedCount` and today's best exactly as Today's would.
- **Malformed:** `seed=4294967296`, no `size` or no `secs` opened the toy with no banner.
- **Tour:** picking another toy from the picker wrote `#lab?demo=<other>` with no beat parameters.
- **Same board, new link:** a reply opened on the board just finished put the opening line back,
  hid the old share, and the next finish gave the verdict against the new link (Cages and Pipes).
- **UI:** no sideways scroll at 375, 820 or 1440. Leave measured 161×36 at 375, 162×37 at 820
  and 165×39 at 1440; the share button 224–234×36, 225–235×37 and 228–237×39. Both are labelled
  in words. `mobileAudit` at 375 named an injected 16×16 control in the share row (`tooSmall`), and
  reported nothing with it removed, for all four toys.
- **Not reachable from here:** Firefox and Safari need a look.

### Left as they are

- The base's `bannerText` says "It is today’s board here" for every arm, so Island bridges and
  Tents say "board" there rather than "map" or "field". That line is the base's.
- Pipes' "↺ Start this board again" keeps a link up: it does not change the board, so it is a
  retry on the same link.
