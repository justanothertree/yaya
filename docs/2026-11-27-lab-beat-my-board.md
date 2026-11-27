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
