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
piece order learned by heart. Now a link run records nothing, and "a link run" means the run was
dealt from a link: the game keeps that fact from the moment it is dealt (`fromLink`), because the
address can change mid-run (see "What the review found" below). Measured in the browser with the
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

**`mobile-audit.js` could not see a control inside the banner** while the banner was a `<p>`: the
audit's `inProse` rule skips an inline-block control inside a paragraph as a link in a sentence, so
a 16×16 button injected into the banner went unreported. The review made the banner a `<div>`
holding its sentence in an inline `<p>`, and the audit now names that button (below). Leave
measures 161×36 at 375 and 165×39 at 1440, as it did.

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
  while the toy is already up does the same, a friend's reply on the same seed included: the room
  compares the link, not its seed (fixed in the review, below).
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
  had the same gap. The review closed Stackfall's half, where it let a link run record, by keeping
  the link with the run; Ten thousand's race writes no records, so its Back still leaves the race up.
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
  keyboard cursor sits on it, and the board's own scroller brings it into view sideways; the page
  itself does not move (see the review, below). Until it is opened, a press or a flag
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
  - At 375 the marked square scrolled to just above the bottom bar, and `elementFromPoint` hit
    it — by scrolling the whole page past the banner, which the review undid (below).

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

## What the review found, 27 Nov 2026

Four verifiers checked the batch at `b2bab18f` between 20:16 and 21:00 EST. Everything below was
reproduced here before it was changed. Each fix has a check that failed first, passed with the fix,
went red again with the fix undone once, and passed once more when it was restored (md5 checked).
Browser checks: Playwright, Chromium, the dev server, 27 Nov 2026, times EST.

### 1. A Stackfall run dealt from a link recorded once the link left the address mid-run

- **Reproduced (21:06–21:07):** the record seeded at a longest run of 1 s, 1 line and a score of 1.
  A link was opened warm, Start pressed, and 3.4 s in either Back was pressed or a second link (on
  another seed) was opened. Untouched, the record stayed put. After Back it became 1.9 s and 238;
  after the second link, the same. Both runs were still on the first link's pieces.
- **Cause:** `finish()` asked `challengeRef.current`, the address at the finish, not the link the run
  was dealt from.
- **Fix:** the game keeps `fromLink`, set by `start()` from the challenge it was dealt; the record
  guard reads that. The verdict still reads the banner on screen, and only when it names the run's
  seed, so a second link on another seed gets no verdict, just as its share is a plain invitation.
- **After (21:07–21:08):** all three runs left the record unchanged, and a run after Leave recorded.
  **Undone (21:08):** Back and the second link both recorded again, 2 of 2 red.

### 2. Nothing pinned the inside edges of the links already pasted

- Five one-character changes to the Stackfall and Ten thousand arms kept all 168 tests green:
  `lines` from 0 to 1 (every pasted run that cleared no lines would stop opening), `lines` to
  99,998, `t` to 86,401, and `turns` to 2 and to 399.
- **Test:** "the oldest bounds still open at both ends" opens `t=0.1` and `t=86400.0`, `lines=0` and
  `lines=99999`, `turns=1` and `turns=400`, and refuses `t=0.0`, `t=86400.1`, `lines=100000`,
  `turns=0` and `turns=401`. Each of the five changes turns exactly that test red, 5 of 5; beat.ts
  was restored to md5 `a6fd5c9c…` each time.

### 3. A Mines link scrolled the page past its own banner

- **Reproduced (21:09–21:10):** `scrollIntoView({ block: 'nearest', inline: 'center' })` on the
  marked square scrolls every scrolling ancestor, the page included.

  | Link                    | Width | Page scrolled | Banner top             |
  | ----------------------- | ----- | ------------- | ---------------------- |
  | large, from 479         | 1440  | 1,085 px      | −316, Leave off screen |
  | large, from 333         | 1440  | 797 px        | −28, under the nav     |
  | large, from 479         | 375   | 2,846 px      | −527, Leave off screen |
  | large 241 or medium 255 | 375   | 2,454 px      | −135                   |
  | small, from 40          | 1440  | 285 px        | 484, still on screen   |

  The first Tab after a cold open at 1440 went to "Meadow", below the board, skipping the banner;
  on plain Mines it goes to "Contact".

- **Fix:** the effect moves the board's own scroller (`.mn-scroll`'s `scrollLeft`) so the ◎ is
  centred in it, and nothing else.
- **After (21:10):** the page stayed at 0 in all six cases, the banner at y 769 at 1440 where every
  other toy's link puts it, the ◎ inside the scroller at 375 (scrolled 127 of 127 for a ◎ at the
  right, 0 for one at the left), and the first Tab went to "Contact". **Undone (21:10):** all six
  scrolled again, five of them hiding the banner, and Tab went to "Meadow".
- At 1440×900 a link now lands where every toy's link does, with the banner near the bottom of the
  screen and the board, the ◎ included, below the fold.

### 4. A reply on the board already up did not deal it again

Yacht, Shut the box, Lamps and Slide, and Ten thousand, which had it before this batch. Tents and
the other g2 and g3 toys already dealt again.

- **Reproduced (21:13):** one roll, two presses or one push, then a reply link on the same board.
  Yacht kept its roll, Shut kept its roll with Roll disabled, Ten thousand kept the race going,
  Lamps kept two lamps lit, and Slide stayed at "1 push".
- **Cause:** Yacht, Shut and Ten thousand compared seeds. Lamps and Slide called `setSeed` with the
  seed already showing, which changes no state.
- **Fix:** Yacht, Shut and Ten thousand compare the link itself. `useChallenge` reads a new object
  on each `hashchange`, and the first mount compares equal, so nothing is dealt twice. Lamps and
  Slide get Tents' `round` counter in their reset effects, bumped when the link changes.
- **Lamps' Leave on a link to today's board** had the same cause: the seed did not change, so the
  presses stayed lit ("9 lamps still lit", 21:15). Leave bumps `round` now, as Tents' Leave does.
- **After (21:15):** all six dealt the board again, the first roll after the reply matched the
  first link's, and Lamps' share went. **Undone (21:20–21:21):** 6 of 6 red.
- **Back still takes the link's board with it (21:25–21:26):** Yacht came back on "Roll (3 left)",
  Shut on its opening line, Lamps on today's board and Slide on a new seed.

### 5. Lamps' verdict outlived its board

- **Reproduced (21:15):** after a finished link, then Leave, then ⟳ New board, the line still said
  "You beat the link’s 10 presses …".
- **Fix:** the reset effect puts the opening line back, as Tents' does.
- **After (21:15):** the opening line after Leave and after New board. **Undone (21:34):** the
  verdict stayed up again, and so did the presses after Leave on today's board, 2 of 2 red.

### 6. The audit could not see the banner's Leave button

- **Reproduced (21:21, 375 with touch):** a 16×16 button injected into the banner gave
  `tooSmall: 0` on Stackfall, Ten thousand, Lamps and Golf.
- **Fix:** the banner is a `<div>` holding its sentence in a `<p>` that stays inline, and the div
  takes a paragraph's font size, so nothing moves. Stackfall's and Ten thousand's own banners too.
- **After (21:23):** `tooSmall: 1`, named "16x16", and 0 with it removed. Banner and Leave boxes
  identical at 375 and 1440; screenshots pixel-identical at 375 and within 1/255 at 1440.
  **Undone (21:23):** 0 again, 4 of 4.
- A first try without the font size grew the banner 3 to 5 px at 375: the line box took the div's
  16 px while the sentence kept a paragraph's fluid size.

### 7. Lamps named its pattern by its glyph alone

- "On a 6×6 ✖ board" reads aloud as "heavy multiplication x", and a friend reading the chat has no
  button beside it.
- **Fix:** `PATTERN_NAMES` moved to lamps.ts, read by the buttons and the sentence alike: "a 6×6 ✖
  Corners board", "a 6×6 ✚ Beside board". No Lamps link has been sent yet, so no pasted sentence
  changes.
- **Test:** the g4 sentences pinned in words, red before the change, green after, and red with the
  glyph put back.

### Left open

- **g3's Back keeps the board, and its finish counts in `solvedCount`.** That was chosen on purpose
  (g3, "Opening a link") and it disagrees with the spec's g3 records rule, so it is the owner's
  decision. If the rule wins, the fix is the one Stackfall now has: keep the link with the board.
- **On a phone, a link opens 2,300 px above its banner,** under the 133-toy picker (y 2,319 at
  375). Every `#lab?demo=` address has always landed there; scrolling to the banner on open has to
  be reasoned about with App's scroll-to-top on a section change and the lazy chunks first.
- What R3's "New game" does on a link still differs between groups.
- Follow protects a link run for only 15 s, and the bus does not know about link runs.
- Lamps' `pattern` adds no evidence of its own: a solve of one pattern usually solves the other on
  the same seed. Changing that changes boards, so it needs `v=`.
- Nonogram loses progress on a link's puzzle once another link opens and is marked.
- Impossible scores open as claims: Slide's check is only its band's minimum, and Pipes accepts
  turns under par.
- A cold link open draws one frame at the saved size first, in Lamps, Tents and Pipes.
- g4's "letter x" refusal passes for the wrong reason: `x` decodes to an undo, refused as a first
  press.
- From `main`, unchanged: Stackfall can say "You beat the link’s 0:01!" when both times floor to
  the same second, and `#lab?demo=__proto__` stays in the address.
- Fireworks, Type, Levels and Bonsai still put their buttons inside a `<p class="beat-banner">`.

**Gates:** `npm run typecheck`, `npm run lint`, `npm run test` (419 files, 6,945 passed, 6
skipped), `npm run build` and `prettier --check`. The browser checks were run once more on the
finished tree, 21:30–21:32, with the same results. Firefox and Safari need a look.
