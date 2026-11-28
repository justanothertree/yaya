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
