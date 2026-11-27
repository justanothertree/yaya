# Lab: which toys friends can play together, and the cheapest ways to add more

Evan, 27 Nov 2026: _"the best games are ones all your friends can play together. Prefer designs
that support as many players as the game allows, and give single-player toys a same-session or
synced mode (shared seed, side-by-side scores, ghosts or races) wherever it fits. List which toys
could gain that and pick the cheapest wins first."_

It builds on 22 Nov: _"my favorite things are sharing experiences, interacting, creating and
sharing with friends. Prioritize multiplayer … a shared lobby where friends see each other as
shadow players, so touring the Lab on a call with friends feels like Mario Party."_

This file answers it for all 133 toys in `src/lab/catalog.ts`. Every toy was read on `origin/main`
at `f5887271` on 27 Nov 2026 and each idea for it was given a cost and a value. A second reader then
checked every XS and S idea against the toy's own source and moved ratings in both directions. Pure
probes ran in Node (V8, Chrome's engine) and Bun (JavaScriptCore, which is Safari and every iPhone
browser). No browser was run, and Firefox was not measured.

## 1. What counts as "together"

- **Live call table.** Friends on a call sit at one game in the call room (`src/lab/social/room.ts`:
  two seats, everyone else watches), as 22 toys do today.
- **More seats.** More people in one game than today: a friend in the computer's seat on one
  device, a hot-seat, or more than two seats online.
- **Shared seed and side-by-side scores.** Everybody plays the same board, deal or day, and the
  scores sit next to each other: a daily, or a "beat my run" link.
- **Ghost.** You play against a recording of a friend's run, or the par's, drawn beside yours.
- **Race.** Friends play their own copies of one game at the same time, and the best or first wins.
- **By turns.** A match on `lab-move`, across days, where the server rolls, deals and keeps secrets.
- **Co-create.** Friends make one thing together (a show, a tree, a set), or a friend's touch lands
  in your world.
- **Show-and-tell.** Send what you made, and a friend opens exactly that.

**How to read a cost.** XS is edits in files that exist. S is one small new module (a Beat arm, or
a call room in `lampsRoom.ts`'s shape) plus its wiring. M is a new mechanism, or a big demo to wire.
L waits on a piece that does not exist yet (more than two seats, a relay step). XL needs production
SQL and an edge-function deploy, or a relay dealer.

For scale:

- One Beat arm was 43 lines in StackDemo, plus a share of 117 lines in `beat.ts` and 121 of tests
  for two arms (`04668b1d`).
- A call room came to 257–611 lines (Dots `1ddaeca2`, Lamps `23b9b2ba`, Mancala `b2ffd083`, Putt
  `5034f46b`). The shot-toy tables of 16 Nov came to 480–678 each (#365–#370).

Every cost here is an estimate dated 27 Nov 2026. Value is high, medium or low: how much friends
would use it.

## 2. Where things stand, 27 Nov 2026

Each toy is counted once, under the most "together" thing it has today.

| Category | Toys | Live call table | By turns only | Same seed, nothing online | Share card or link | Solo only |
| -------- | ---: | --------------: | ------------: | ------------------------: | -----------------: | --------: |
| Arcade   |   30 |               5 |             1 |                         6 |                 17 |         1 |
| Board    |   31 |              16 |            15 |                         0 |                  0 |         0 |
| Puzzles  |   24 |               1 |             2 |                         9 |                 12 |         0 |
| Make     |   20 |               0 |             0 |                         0 |                  8 |        12 |
| Nature   |   14 |               0 |             0 |                         0 |                  1 |        13 |
| Patterns |    6 |               0 |             0 |                         0 |                  1 |         5 |
| Sound    |    8 |               0 |             0 |                         0 |                  1 |         7 |
| **All**  |  133 |          **22** |        **18** |                    **15** |             **40** |    **38** |

- **Live call table (22)** is `ROOM_TOYS` (`src/lab/social/tour.ts:204-227`). That is the 16
  two-sided board games with every piece in view, Artillery, Bowling, Curling, Darts, Putt and
  Lamps.
- **By turns only (18)** is the rest of `lab-move`'s 40 games (`GAMES`,
  `supabase/functions/lab-move/core.ts:118`). That is 15 board games (Rock paper scissors, Ten
  thousand, Hold'em, Sea battle, Twenty-one, Backgammon, Hearts, Dominoes, Gin, Cribbage, Liar's
  dice, Spades, Crazy eights, Yacht, Shut the box), plus Pool, Codebreaker and Shadow box.
- **Same seed (15):** Archery, Bricks, Time trial, Towers and Lander have a daily. Stackfall has
  "beat my run" links. Golf, Mines, Tile pairs, Sudoku, Pipes, Cages, Island bridges and Tents have
  today's board. Slide shows its seed on screen to pass on.
- **Beside these:** 19 toys also seat two on one screen (Gust, Night crossing, Stackfall, 15 board
  games, and Shadow box's pass and play). Friends' shadow pointers already show on a call. Six
  already listen to the call's audio (Swarm, Ferrofluid, Fireflies, Galaxy, Music, Ribbons), and
  several send their own sound down it (Harmonograph, Loom, Bubbles, Harp, Squish, Intervals, Graph
  match).

How many players each game allows, as the auditor read it (golf "any", Hearts 4, Chinese checkers
up to 6). A field like "1 (as a race: any)" is counted as the larger figure.

| Category | 1 player | 2 players | 3–4 players | 5 or more, or any |
| -------- | -------: | --------: | ----------: | ----------------: |
| Arcade   |        9 |         7 |           4 |                10 |
| Board    |        0 |        17 |           5 |                 9 |
| Puzzles  |       20 |         3 |           0 |                 1 |
| Make     |        2 |         0 |           0 |                18 |
| Nature   |        1 |         0 |           0 |                13 |
| Patterns |        0 |         0 |           0 |                 6 |
| Sound    |        0 |         0 |           0 |                 8 |
| **All**  |   **32** |    **27** |       **9** |            **65** |

**Every online seat today is one of two.** Room seats are `[a, b]` (`room.ts:48-49`), and a match
has `player_a` and `player_b`. 74 of the 133 toys allow more than two players. That includes 18 of
the 40 that play online: 7 of the 22 call-table toys and 11 of the 18 by-turns toys. So "as many
players as the game allows" is mostly blocked on one piece, more than two seats, and §6 says where
that piece is already planned.

## 3. The ranked list, cheapest wins first

This list holds every idea rated XS or S whose value is high or medium. That is 132 candidate rows,
in 121 entries: #48 is one change that covers 12 rated rows. They are sorted by cost, then value.
Where those tie, the entry needing fewest pieces first comes first, then the one reusing the most.
Entry numbers are used everywhere below.

### Fix first: Sudoku's "today" is not the same puzzle for everyone

#27 is ranked by its cost, but it is a live bug, so it should go before any batch. `make()` and
`full()` shuffle with `sort(() => rand() - 0.5)` (`sudoku.ts:103`, `:301`). The order that gives
depends on the engine's sort. Measured 27 Nov 2026: 10 of 10 daily "steady" puzzles differ between
V8 and JavaScriptCore. So a Chrome friend and an iPhone friend are handed different "today's
Sudoku" now.

`sudoku.test.ts:52` asks one engine twice, so it cannot see this. A Fisher–Yates prototype gave 15
of 15 puzzles the same in both engines. The fix changes every seed's puzzle, today's included.

### The first three batches

**Batch 1: "Beat my board", a link that carries the seed and the score.**

- **Toys:** Yacht #1, Shut the box #2, Golf #4, Slide #8, Lamps #9 (checked by replay), Mines #10,
  Tile pairs #11, Pipes #12, Cages #13, Island bridges #14 and Tents #15. Sudoku's link #83 joins
  once #27 lands.
- **Mechanism:** `src/lab/beat.ts` (`beatHash`, `readBeat`, `dealRand`), `BeatShare` and
  `useChallenge`, as Stackfall and Ten thousand use today.
- **First piece:** widen `readBeat`'s seed bound from 2^31−1 to 32 bits (`beat.ts:23`, `:49`).
  `daySeedOf` returns a full 32-bit number (`bricks.ts:102`). Measured 27 Nov 2026: 444 of 730 daily
  seeds over the next year are refused, today's Golf seed (4,279,824,600) among them. A "beat my
  board" link on a daily board would open nothing on most days.
- **A shape question:** eleven arms is the point to ask whether `beat.ts`'s hand-written union
  should become a table of arms. Two arms already took 117 lines there.

**Batch 2: challenge the friend on the call (#48).**

- **Toys:** the 18 that play by turns and have no call table. Measured 27 Nov 2026: all 40
  `lab-move` toys render `MatchChallenge`.
- **Mechanism:**
  - `MatchChallenge` (`MatchChallenge.tsx:46-55`) lists friends who are on the call first. The
    call's peer ids are user ids (`social.ts:21`).
  - One call message carries the match id (`sendParty`, `voiceSession.ts:651`), and the friend's
    Lab offers to open it.
  - After that, the existing move nudge plays it live while both have it open.
- **What it needs:** no SQL, no deploy and no relay.

**Batch 3: friends' taps land in your toy.**

- **The hook (#49, built with Pond):** `party.ts` already receives friends' toy-relative taps
  (`party.ts:434-444`), and only `PartyCursors` reads them. A small hook in `src/lab/social/` hands
  each new tap to the toy on screen. It can hold a tap as a short press for toys that act only while
  a finger is down. `party.ts` also starts sending mouse presses, which it drops today (`:301-302`).
- **Then XS each:** Aquarium #21, Bubbles #22, Lightning #23, Sand #24, Life #25 and Fireflies #26.
  Fluid, Neon, Growth, Slime, Lava lamp, Ferrofluid and Erosion ride along at XS (rated low).

**Why this order.**

1. **Batch 1 is the cheapest per toy.** It is XS each and holds three of the four XS-high entries.
   It needs no network, no server and no seat, and any number of friends can play: it is Evan's
   "shared seed, side-by-side scores" exactly. Its first piece also fixes the seed bound, which
   every daily link would otherwise hit, and it lays down the seeds that the race rooms and Item
   3's duels will use.
2. **Batch 2 reaches the most toys for one S: 18.** For the 17 that hide something or roll dice
   (all but Pool), it is the cheapest way to play live and fair, because the server already deals,
   rolls and seals. Their other live routes are a relay dealer (XL), commit-reveal (M or L), or
   dice rolled by the host, which waits on Evan's decision.
3. **Batch 3 is one S, then XS per toy.** It is the only batch with no seat limit: everyone on the
   call pokes every screen at once, on 14 toys that are solo today. It comes third because each poke
   is worth medium at most. It also adds traffic (a message per mouse click on any toy), which the
   admin meter should measure first.

**After these:**

- **Puzzle rooms:** #32–#35 and #50–#66 make a natural fourth batch. They are all in
  `lampsRoom.ts`'s shape, with integer rules whose boards were measured the same in V8 and
  JavaScriptCore, which makes them the safest live tables there are.
- **Arcade call tables:** #28 Pool goes first, because its rules exist.
- **One-device friend modes:** #36, #37 and #67–#76 can be done at any time.
- **XS with no batch:** #3, #5, #6, #7 and #16–#20 can each go alone.

### Pieces worth building once

1. **`beat.ts`'s seed bound at 32 bits** (batch 1).
2. **A call message that carries a match id** (batch 2).
3. **The pokes hook with a short hold** (batch 3).
4. **A call race board on the call channel, not `room.ts`, so it has no seat limit (M, high).**
   Ten thousand, Yacht, Shut the box and Twenty-one go first, then Stackfall. It is the first M
   worth building: the cheapest way for everyone on a call to play a game of chance at once. Until
   then, a race link pasted into the call chat does the job by hand.
5. **A call-wide daily finish strip, built with Lamps (M, high).** One party message per finish
   (`sendParty`), carrying the seed rather than "today". After it, each daily puzzle costs XS,
   Codebreaker first.
6. **A guest's own move shown before the host confirms it** (about M, once, in `room.ts` and
   `useLabRoom`). Today the host's moves land at once and a guest's wait a round trip
   (`room.ts:360-367`), which tilts every "first to finish" race toward the host.
7. **More than two seats.** That is Item 2's `chairs.ts` (step 4, 2 or 4 chairs) or wider `room.ts`
   seats; 24 "more seats" ideas rated L wait on it (§6).
8. **A relay dealer written over `Rules.hidden`, not for Spades alone** (Item 2 step 6a). That moves
   Hearts from XL to L, and serves Hold'em, Liar's dice, Gin, Dominoes, Cribbage and Crazy eights.

### XS, high value

| #   | Toy           | Mode          | What friends do                                                       | Reuses                                                            | The work                                                                                  | Blockers                                                      |
| --- | ------------- | ------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | Yacht         | seed + score  | Play Alone on the link's dice (same keeps, same dice); beat the total | `dealRand`, `BeatShare`, `useChallenge`; Ten thousand's race link | A `yacht` arm; YachtDemo.tsx:183 rolls `dealRand(seed, boxes filled, 3 − rolls)`          | None. A claim; a retry shows the dice, as Ten thousand's does |
| 2   | Shut the box  | seed + score  | The same dice roll by roll; fewest left to beat (0 is shut)           | The same                                                          | A `shut` arm; ShutDemo.tsx:190 rolls `dealRand(seed, k, 0)`, k counting this turn's rolls | None                                                          |
| 3   | Nonogram      | show-and-tell | A drawn puzzle opens straight from a link, with no code to paste      | `toCode`/`fromCode` (URL-safe), `ofCode`, Level maker's `room=`   | `&code=` read with `hashParam`, and on `hashchange`                                       | None                                                          |
| 4   | Golf patience | seed + score  | "Beat it" opens the deal the score was made on, in any time zone      | `deal(seed, wrap)`; the copy text at GolfDemo.tsx:123             | `&seed=` in the text, played as practice so `saved.today` is untouched                    | Through `beat.ts`, the seed bound must widen first (batch 1)  |

### XS, medium value

| #   | Toy            | Mode          | What friends do                                                  | Reuses                                                       | The work                                                                  | Blockers                                                              |
| --- | -------------- | ------------- | ---------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 5   | Four in a row  | show-and-tell | Its card says how often you beat friends online, as 15 others do | `onlineLine` (`shares/board.ts:129-247`)                     | One line at board.ts:157-158, and a board.test.ts case                    | None                                                                  |
| 6   | Bridge         | seed + score  | The card names the cheapest crossing per level                   | `Saved.best` (bridge.ts:430-431)                             | Rewrite the bests.ts reader                                               | None; it is this device's record                                      |
| 7   | Level maker    | seed + score  | The room link also says how many moves the sender took           | The `room=` link (LevelsDemo.tsx:172, :568)                  | `&n=` beside it, shown against par                                        | None                                                                  |
| 8   | Slide          | seed + score  | "Beat my board": difficulty, seed and pushes                     | `generate(seed, difficulty)`; `solve()` for par              | A Beat arm and `useChallenge`                                             | None; seeds 1–99,999 fit                                              |
| 9   | Lamps          | seed + score  | A checked "beat my presses" link, replayed on open               | Kept `actions` (LampsDemo.tsx:150-153), `runSolve`           | A Beat arm carrying day, size, pattern and presses                        | None. Use `runSolve`: `verifyLamps` refuses an old day                |
| 10  | Mines          | seed + score  | "Beat my time": size, seed and the first square                  | `layBoard(size, seed, start)`; the text at MinesDemo.tsx:191 | Params in the text, read in a non-today mode                              | The seed bound, if it goes through `beat.ts`                          |
| 11  | Tile pairs     | seed + score  | "Beat my time": layout and seed                                  | `deal(layout, seed)`; `shuffle` already takes a seed         | Params in TilesDemo.tsx:113's text; seed the reshuffle at :158 (one line) | None                                                                  |
| 12  | Pipes          | seed + score  | "Beat my board": seed, size, wrap, time and turns                | `make(seed, n, wrap)`                                        | A Beat arm, `useChallenge`, `BeatShare`                                   | The seed bound (batch 1)                                              |
| 13  | Cages          | seed + score  | "Beat my board" with size and seed                               | `make(n, seed)`                                              | A Beat arm and `useChallenge`                                             | The seed bound                                                        |
| 14  | Island bridges | seed + score  | "Beat my map" with size and seed                                 | `make(n, seed)`                                              | A Beat arm and `useChallenge`                                             | The seed bound                                                        |
| 15  | Tents          | seed + score  | "Beat my field" with size and seed                               | `make(n, seed)`                                              | A Beat arm and `useChallenge`                                             | The seed bound                                                        |
| 16  | Bonsai         | show-and-tell | Same seed, two gardeners: each grows a tree, then compare        | `encode(seed, [], dress)` is a valid link already (7 bytes)  | A "send this seed bare" button beside `CopyLink`                          | None                                                                  |
| 17  | Fireworks      | by turns      | Pass the show: add a few shells and send the link back           | The show link (an edit clears `fromLink`)                    | A "pass it on" line                                                       | Nothing enforces turns; a full show (643 chars) is past 500           |
| 18  | Type foundry   | by turns      | Alphabet relay: draw a few letters, pass it on                   | The font link (TypeDemo.tsx:312-336)                         | A "pass it on" line                                                       | Nothing enforces turns                                                |
| 19  | Bonsai         | by turns      | Grow a season and send the tree back                             | The tree link                                                | A "pass it on" line                                                       | A worked tree's link can reach 6,000 chars, past chat's 2,000         |
| 20  | Snowflake      | co-create     | Friends' voices down the call grow your flake too                | The call's `'peers'` tap (voiceSession.ts:914-918)           | Read `'peers'` beside `'local'` (SnowflakeDemo.tsx:125-126), own switch   | Talking counts as breath; each flake is its own                       |
| 21  | Aquarium       | co-create     | A friend's tap drops food into your tank                         | The pokes hook (#49); `feed()`                               | `feed(toTank(tx·w, ty·h, w, h))` on each poke                             | After #49; each tank's fish differ                                    |
| 22  | Bubbles        | co-create     | Friends' taps pop your bubbles                                   | The hook; `hit(list, x, y)`                                  | Call `hit` at the poke                                                    | After #49; a remote pop's note also goes down the call                |
| 23  | Lightning      | co-create     | A friend's tap plants a rod and calls a bolt down to it          | The hook; tap-to-plant (LightningDemo.tsx:216-222)           | Plant at the poke                                                         | After #49; bolts differ per screen                                    |
| 24  | Sand           | co-create     | A friend's tap pours a dab of sand into your box                 | The hook's short hold; `Dab`                                 | A few frames of `Dab` at the poke                                         | After #49; each box is its own                                        |
| 25  | Life           | co-create     | Friends' taps bring cells to life on your board                  | The hook; `toCell`, `LifeInput` (or the stamp)               | Paint at the poke                                                         | After #49; boards differ in size, so the same spot, not the same cell |
| 26  | Fireflies      | co-create     | Friends' taps flash your meadow; watch "In step" climb           | The hook; `tapAt(u, v)`                                      | Call `tapAt` at the poke                                                  | After #49; 40–150 ms of latency blurs a fast beat                     |

### S, high value

| #   | Toy             | Mode          | What friends do                                                            | Reuses                                                                      | The work                                                                                                      | Blockers                                                                       |
| --- | --------------- | ------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 27  | Sudoku          | seed + score  | Today's puzzle really is the same for a Chrome friend and an iPhone friend | The same `rng`                                                              | Fisher–Yates for the two random-comparator sorts (sudoku.ts:103, :301); pin a puzzle in a test                | Changes every seed's puzzle, today's mid-day; Firefox not measured             |
| 28  | Pool            | call table    | Eight-ball with a friend, live on the call                                 | `poolRules` (poolRoom.ts:125-159); the watched-shot playback                | `useLabRoom`, `CallTable`, seat words, `ROOM_TOYS` and its census, `onlineLine`                               | A non-Chromium watcher may snap to the host's end; 1,442 bytes after the break |
| 29  | Fireworks       | show-and-tell | Set a show off for the whole call at the same moment                       | `encode(show)`                                                              | One message, "starts in 3 s", with a checked receiver and a cap per sender                                    | None; 40–150 ms of skew is fine for watching                                   |
| 30  | Fireworks       | co-create     | Either friend adds shells, and everyone sees the same sparks               | `encode`/`decode`, `settle()`                                               | `fireworksRoom.ts`: turn `'any'`, state `encode(show)`, a move is one cue                                     | Two seats; the call watches                                                    |
| 31  | Bonsai          | co-create     | Tend one tree together: grow, cut, wire                                    | `replay(seed, ops)`, `encode`/`decode`; `apply` ignores a branch now gone   | `bonsaiRoom.ts`, `useLabRoom`, `CallTable`                                                                    | Two seats                                                                      |
| 32  | Pipes           | call table    | One board, both turning tiles at any time                                  | `make()`, `rotate()`; rotations commute, as Lamps' presses do               | `pipesRoom.ts` in `lampsRoom.ts`'s shape (cache `make`), `CallTable`, `ROOM_TOYS`                             | None                                                                           |
| 33  | Pipes           | race          | Same board, own copies; first watered wins                                 | #32's rules                                                                 | Per-seat rotation lists                                                                                       | The host's head start is about one round trip                                  |
| 34  | Slide           | race          | Own pucks on the same board; fewest pushes wins                            | `generate()`, `slide()`, cached as `startOf` does                           | A room in `lampsRoom.ts`'s shape, `CallTable`                                                                 | Pushes depend on the last: rank on pushes, not on who finished                 |
| 35  | Level maker     | race          | Race out of the same room                                                  | `encode(level)`, `move()`; `solve()` once per room                          | A room, `CallTable`                                                                                           | Rank on moves, not on who got out first                                        |
| 36  | Air hockey      | more seats    | Two friends on one screen, a paddle each                                   | `advance()` steps two paddles already; `clampToHalf`; Gust's pointer halves | Split the keys, a half per `pointerId`, `wants[1]` from the friend; friend games off the record               | None                                                                           |
| 37  | Light trails    | more seats    | Two or three on one keyboard, computers in the empty seats                 | `newArena` (4 riders); `tick()` takes a turn per rider                      | A turn queue and key map per human; speed up only when every human is out                                     | Keyboard only (a swipe steers one rider)                                       |
| 38  | Sun path        | seed + score  | Today's five places, the same for everyone, scores side by side            | `question(rand, scale, year)`, the round and best                           | `rng(daySeed(today))`, never `rng(dayNumber())`; scale `'sun'`; a fixed year; a day field                     | Friends either side of local midnight get different days                       |
| 39  | Skipping stones | call table    | A throw-off: most skips, or first past a challenge                         | `fly(throw, course)`; `dartsRoom.ts`'s shape                                | `skipRoom.ts` (a move is speed, angle, tilt), `CallTable`                                                     | The tilt is the thrower's claim; WebGPU to draw                                |
| 40  | Archery         | call table    | Alternate arrows on the same winds; the higher total wins                  | `winds(seed, round)`, `scoreAt`; `dartsRoom.ts`'s shape                     | `archeryRoom.ts` carrying where each arrow struck                                                             | Strike points are trusted; two seats                                           |
| 41  | Möbius golf     | call table    | Holes in turn, lowest total wins, or one ball between you                  | `roll()`; `puttRoom.ts`'s shape                                             | `mobiusRoom.ts` (a move is angle and power), `CallTable`                                                      | Cross-engine float unmeasured                                                  |
| 42  | Echo            | call table    | Both play back the same growing tune; the longest wins                     | `tune(seed)`, `press()`: integer, exact in every engine                     | `echoRoom.ts` in the race shape, with a cap on each press list                                                | The whole state shows the leader's presses, so the screen must not             |
| 43  | Bike trials     | call table    | Both ride the Quarry; the host replays each run, so the times are checked  | Fixed-step `trials.ts`, `startRun`/`tick`                                   | Record the input log (new), `trialsRoom.ts`, a bound on a run's length                                        | Cross-engine float (`Math.sin`/`cos`) unmeasured                               |
| 44  | Lander          | call table    | A landing contest; the host replays each flight                            | Fixed-step `step()`, `launch(rng(seed))`; `pilot()` can fill a seat         | An input log and a race-shaped room                                                                           | Cross-engine float: even the terrain goes through `Math.sin`                   |
| 45  | Pinball         | show-and-tell | Send your table; a friend plays it and posts a score on it                 | `readTable`, the table file                                                 | A compact, quantised packing in a hash param, `CopyLink`                                                      | A drawn table measured 7,081 chars; best is keyed by the table's name          |
| 46  | Ten thousand    | call table    | Two seats at a live table, with the rolls made there                       | `diceRoom.ts` `roll` and `begun`; only the host's browser applies a move    | A live-only wrapper (roll after `fresh` and `apply`), `CallTable`, a call source; fix room.ts:74-78's comment | Evan's fair-dice decision: the host's browser rolls. A joint seed would be L   |
| 47  | Backgammon      | call table    | The same, versus or together against the computer                          | `backgammonRoom.ts` `roll` and `begun`                                      | #46's wrapper, plus a call source beside the inline `useLabMatch`                                             | The same decision                                                              |

### S, medium value

**One change, many toys**

| #   | Toy                                                                                                                                                                                                                         | Mode      | What friends do                                                                                                     | Reuses                                                                | The work                                                                                                              | Blockers                                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 48  | Rock paper scissors, Ten thousand, Hold'em, Sea battle, Backgammon, Hearts, Dominoes, Gin, Cribbage, Liar's dice, Spades, Crazy eights; free for Yacht (rated low), Twenty-one, Shut the box, Pool, Codebreaker, Shadow box | by turns  | One press challenges the friend on the call; the match opens on both screens and plays live while both have it open | `MatchChallenge` (in all 18), `sendParty`, the move nudge, `lab-move` | List call friends first; one call message carrying the match id; an "Open" offer on the friend's side                 | None; the friend still accepts. The nudge alone cannot do it: it joins only an open match (nudge.ts:127) |
| 49  | Pond                                                                                                                                                                                                                        | co-create | A friend's touch makes a real ripple in your pond                                                                   | Friends' toy-relative taps already arrive (party.ts:434-444)          | The pokes hook in `src/lab/social/` with a short hold; `party.ts` sends mouse presses too (it drops them at :301-302) | A message per click on any toy, and a ring for each in `PartyCursors`                                    |

**Race and together rooms for puzzles.** All are in `lampsRoom.ts`'s shape. Whichever of a toy's
race or together room is built first pays for its rules.

| #   | Toy            | Mode       | What friends do                                 | Reuses                                     | The work                                                 | Blockers                                                       |
| --- | -------------- | ---------- | ----------------------------------------------- | ------------------------------------------ | -------------------------------------------------------- | -------------------------------------------------------------- |
| 50  | Paint mixer    | call table | One cup, both adding drops                      | `Drops` is a count vector, so adds commute | `mixRoom.ts`, adds only; Empty ordered by the host       | Colours differ in the last digits by engine: the host judges   |
| 51  | Paint mixer    | race       | Match the same target; fewest drops wins        | #50's rules                                | One cup per seat, capped at 24 drops                     | The same                                                       |
| 52  | Tile pairs     | race       | Same deal, own copies; first cleared wins       | `deal()`, the seeded `shuffle` (#11)       | Per-seat pairs and shuffles                              | A guest waits a round trip per pair                            |
| 53  | Tile pairs     | call table | Clear one layout together                       | #52's rules                                | One board, turn `'any'`                                  | None; the host refuses a pair no longer free                   |
| 54  | Cages          | race       | Same board, own grids; first correct wins       | `make(n, seed)`, cached (up to 151 ms)     | Moves are `{cell, digit}`                                | First-correct favours the host                                 |
| 55  | Cages          | call table | One grid, either of you filling                 | #54's rules                                | Last write wins on a cell                                | None                                                           |
| 56  | Island bridges | race       | Same map; first connected wins                  | `make(n, seed)`                            | Per-seat edge changes                                    | First-connected favours the host                               |
| 57  | Island bridges | call table | Both laying bridges                             | #56's rules                                | Send absolute counts, because `cycle()` is relative      | None                                                           |
| 58  | Tents          | race       | Same field; first pitched wins                  | `make(n, seed)`, `solved()`                | Per-seat marks                                           | Favours the host                                               |
| 59  | Tents          | call table | Both pitching tents                             | #58's rules; `put(i, mark)` is absolute    | One field, turn `'any'`                                  | None                                                           |
| 60  | Golf patience  | race       | Same deal; lowest score wins                    | `deal()`, `take()`, `turn()`               | Per-seat moves replayed                                  | A guest waits per move; harmless, as score ranks first         |
| 61  | Peg solitaire  | race       | Same board and hole; fewest pegs left wins      | `newGame(kind, start)`, `jump()`           | Per-seat jumps                                           | None                                                           |
| 62  | Peg solitaire  | call table | One board, taking turns to jump                 | Together's `next` in `room.ts`             | One board                                                | None                                                           |
| 63  | Shadow box     | race       | Rebuild the same puzzle; fewest blocks over par | `matches()`, `fewest()`                    | New public-clue rules (`shadowboxRoom.ts` seals the box) | Hide-and-rebuild stays by turns; finish order favours the host |
| 64  | Shadow box     | call table | Stack one build together                        | #63's rules                                | One build of absolute heights                            | None                                                           |
| 65  | Beams          | race       | Same level; fewest pieces wins                  | `trace()`, `fitPlaced`                     | One placed map per seat                                  | Rank by pieces, not by who lit first                           |
| 66  | Beams          | call table | One board, both placing and turning             | #65's rules                                | The host applies moves in arrival order                  | None                                                           |

**A friend beside you, on one device.** The computer's side takes the same aim, and friend games
stay off the per-level record. No room and no network.

| #   | Toy             | Mode       | What friends do                                 | Reuses                                                      | The work                                               | Blockers |
| --- | --------------- | ---------- | ----------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------ | -------- |
| 67  | Pool            | more seats | Eight-ball with a friend, passing the mouse     | The aim UI; side 1 is `plan()` today (PoolDemo.tsx:148-200) | Side 1's shots from the aim UI                         | None     |
| 68  | Putt            | more seats | A friend plays the computer's side of the round | "the computer has a go" (PuttDemo.tsx:250)                  | Side 1's putts from the aim UI                         | None     |
| 69  | Darts           | more seats | 501 for two on one device                       | `computerTurn` (DartsDemo.tsx:200)                          | Side 1 through the same aim and hand                   | None     |
| 70  | Bowling         | more seats | A friend bowls the computer's frames            | Modes `'bot'` and `'call'` (BowlingDemo.tsx:110)            | A `'friend'` mode through the same aim                 | None     |
| 71  | Artillery       | more seats | Hot-seat: a friend takes the other gun          | The right gun is the computer's (ArtilleryDemo.tsx:175)     | The right gun's shot from the aim UI                   | None     |
| 72  | Curling         | more seats | A friend throws the other side's stones         | Team 1 plays a precomputed slide (CurlingDemo.tsx:137)      | Team 1 through the throw and sweep UI                  | None     |
| 73  | Möbius golf     | more seats | Two to four golfers play each hole in turn      | `roll()`, `HOLES`, one ball                                 | Strokes per golfer and a turn line                     | None     |
| 74  | Archery         | more seats | Two to four archers shoot alternate ends        | `winds()`, shared by construction                           | A total per archer, a fresh sway per end               | None     |
| 75  | Pinball         | more seats | Two to four players alternate balls             | One score and three balls (pinball.ts:197, 358-359)         | A score and ball count each, handed over at each drain | None     |
| 76  | Skipping stones | more seats | Pass the phone, two to four throwers            | `judge()`, `CHALLENGES`                                     | Throws per player and a turn line                      | None     |

**Links that carry a seed, a deal or a thing**

| #   | Toy         | Mode          | What friends do                                                    | Reuses                                         | The work                                                                   | Blockers                                                                |
| --- | ----------- | ------------- | ------------------------------------------------------------------ | ---------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 77  | Seedling    | show-and-tell | A garden you made, rule and all, opens for a friend to solve       | `readLevel` validates a garden                 | base64url in `garden=`, read with `hashParam`                              | Drop the free-text name and hint, or show them as untrusted text        |
| 78  | Seedling    | seed + score  | "Beat my garden", re-checked by `grow()` on open                   | `grow(level, seeds)`                           | A Beat arm, `useChallenge`, `BeatShare`                                    | None; this link is checked, not a claim                                 |
| 79  | Fold        | show-and-tell | A folded shape opens on its folds                                  | `readFolds`                                    | Quantise the folds, re-check with `replay()`                               | Full doubles run past a comment's 500 chars                             |
| 80  | Fold        | seed + score  | "Fold this" in as few folds as the sender                          | `replay()`, `coverage()`, `match()`            | Accept a puzzle from outside `PUZZLES`                                     | Firefox not measured                                                    |
| 81  | Jigsaw      | seed + score  | "Beat my time": same picture, cut and scatter                      | `cut()` and `deal()` are seeded                | Carry picture, size, seed and aspect; ask before replacing the kept puzzle | Painted pictures only; `newSeed` can return 0, which `readBeat` refuses |
| 82  | Paint mixer | seed + score  | Mix a colour in Free and send it as a target to match              | `targetColour()`, `fewest()`                   | The recipe as five small numbers                                           | None                                                                    |
| 83  | Sudoku      | seed + score  | "Beat my time" on level and seed                                   | `make(level, seed)`                            | `&seed=&level=` in SudokuDemo.tsx:133's text                               | #27 first, or a Safari friend gets another grid                         |
| 84  | Archery     | seed + score  | "Beat my round" on a practice seed                                 | `winds()` takes any seed                       | A Beat arm: seed, bow, round, total                                        | None                                                                    |
| 85  | Echo        | seed + score  | "Beat my tune"                                                     | `newRun(seed, pads, mode, lives)`              | A Beat arm                                                                 | None                                                                    |
| 86  | Popper      | seed + score  | "Beat my game"                                                     | `newGame(colours, seed)`                       | A Beat arm                                                                 | Luck is shared at the start and diverges with play                      |
| 87  | Sun path    | seed + score  | "Beat my 412"                                                      | `question()`                                   | A `sun` arm that fixes scale `'sun'`                                       | A claim                                                                 |
| 88  | Twenty-one  | seed + score  | Ten rounds from the link's shoes, chips to beat, no sign-in needed | `playRound`, `shoeOf`, `chipsOf`, `RoundTable` | Round seeds from `dealRand`, a Beat arm, a small round loop                | A retry reveals the shoe                                                |
| 89  | Gin rummy   | seed + score  | The same deal and stock against the same computer                  | `deal(seed)` (Fisher–Yates), `play()`          | Seed `play`'s rand; a Beat arm                                             | None                                                                    |
| 90  | Hearts      | seed + score  | The same deal and computers at Fair; fewest points taken           | `deal(seeded(n))` is the same in every engine  | A keyed rand for `choosePass` and `chooseCard`; a Beat arm                 | Fair only: Easy and Hard sort differently in Chrome and Safari          |
| 91  | Spades      | seed + score  | The same deal at Easy or Fair; your team's score to beat           | `deal()` (Fisher–Yates)                        | A keyed rand for `chooseBid` and `chooseCard`; a Beat arm                  | Hard sorts differently by engine                                        |

**Dailies**

| #   | Toy            | Mode         | What friends do                                         | Reuses                                            | The work                                                               | Blockers                                                                        |
| --- | -------------- | ------------ | ------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 92  | Slide          | seed + score | A board of the day for everyone, with a dated best      | `generate()`; `daily.ts`                          | A today mode, a dated field read defensively, the reader, a button     | The day is the local date                                                       |
| 93  | Stackfall      | seed + score | Today's Stackfall, with today's best on the card        | `newGame(mode, bot, seed)`, beat links            | A Today choice, a dated best (`keepBestOf`), a line in `OWN.stack`     | A time is a claim                                                               |
| 94  | Night crossing | seed + score | A daily crossing, times compared                        | `makeCourse(…, seed, …)` rounds to three decimals | `daySeed`, a Today button, a dated best                                | Frame dt: times are claims                                                      |
| 95  | Soaring        | seed + score | A daily task with today's thermals and an automatic par | `par()`, `rng(daySeed)`                           | A task maker swept over many seeds so every day can be finished; hints | None                                                                            |
| 96  | Wallpaper      | seed + score | Today's ten patterns; scores on the card                | `question(seed)`                                  | A ten-question round with an end, seeds from `daySeed` mixed with i    | The day is the local date                                                       |
| 97  | Intervals      | seed + score | Today's ten intervals, scores out of ten                | `question(set, stats, direction, rand, last)`     | Fix the stage, direction and chain; `rng(daySeed)`; a day field        | Which stage is asked is a product choice                                        |
| 98  | Graph match    | seed + score | A daily curve; compare hints used, and time             | `parse`, `distance()`                             | A seeded target maker with hints per family, and a timer               | None                                                                            |
| 99  | Time trial     | seed + score | Today's lap on the share card                           | Today's lap, kept under `day-<seed>`              | A dated day beside the lap, a Saved change, tests                      | A decision first: date it, or let readers read the clock (bests.ts:1-5 says no) |

**Show-and-tell for makers**

| #   | Toy         | Mode          | What friends do                                           | Reuses                              | The work                                         | Blockers                                                  |
| --- | ----------- | ------------- | --------------------------------------------------------- | ----------------------------------- | ------------------------------------------------ | --------------------------------------------------------- |
| 100 | Strut       | show-and-tell | A creature and its groove by link: watch it walk, hear it | `readStrut()`                       | A hash param and `CopyLink`                      | 1,049–1,297 chars: fits chat (2,000), not a comment (500) |
| 101 | Neon        | show-and-tell | A sign by link, in its style and colour                   | Word, style, palette; `hashParam`   | Read them on open through the same letter filter | None                                                      |
| 102 | Loom        | show-and-tell | A draft by link: the friend weaves and hears your cloth   | `Draft` is small integer arrays     | A byte codec (only `packDraft` exists)           | Keep it under 500 chars                                   |
| 103 | Film studio | show-and-tell | A set by link instead of a scene file                     | `readScene` clamps untrusted scenes | A byte codec, about 200 bytes                    | Base64 JSON (about 2.5 kB) is past chat's 2,000           |
| 104 | Critters    | show-and-tell | Your creature by link instead of a file                   | `readCritter`                       | Byte-pack it, the brain's numbers exactly        | About 1–1.4 kB: chat, not a comment                       |
| 105 | Epicycles   | show-and-tell | A drawing by link; the friend watches the arms draw it    | `toKept` (128 points)               | Byte-pack it as fireworks.ts does                | One byte a coordinate to fit 500                          |
| 106 | Fractal     | show-and-tell | "Look where I am": the exact spot of a deep dive          | `View` `{cx, cy, scale}`            | Full-precision hash params                       | None                                                      |

**Other rooms, races and ghosts**

| #   | Toy          | Mode       | What friends do                                                 | Reuses                                                 | The work                                                                  | Blockers                                                  |
| --- | ------------ | ---------- | --------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------- | --------------------------------------------------------- |
| 107 | Film studio  | co-create  | Two directors on one set, each through their own camera         | `readScene` as the decode; the demo swaps whole scenes | `studioRoom.ts`: turn `'any'`, a move replaces one thing, sent on release | Keep the camera out of the shared state; two seats        |
| 108 | Type foundry | co-create  | Make one font together, a few letters each                      | `encode`/`decode`                                      | `typeRoom.ts`: a move is a glyph or a style change                        | Two seats                                                 |
| 109 | Swarm        | co-create  | Every friend's pointer pulls the swirl on your screen too       | Pointer samples at 8 Hz (party.ts:67)                  | An attractor array in swarm.ts and swarm-step.wgsl                        | Phone friends arrive as taps, not trails                  |
| 110 | Voiceprint   | co-create  | Sing together into one voiceprint, then play it back            | The call's `'peers'` tap (fftSize 1024)                | A "listen to the call" switch and a visible "recording the call" line     | It records friends: local only, never saved automatically |
| 111 | Yacht        | call table | Two seats, the rolls made at the table                          | `yachtRoom.ts` `roll` and `begun`                      | #46's wrapper and a call source                                           | The fair-dice decision                                    |
| 112 | Shut the box | call table | Two seats, each rolling in turn                                 | `shutRoom.ts` `roll` and `begun` (the probed case)     | #46's wrapper and a call source                                           | The fair-dice decision                                    |
| 113 | Orbit        | call table | A fuel race: least Δv onto the target orbit, checked by replay  | `launch`, `fly`; one (burn, steps) pair per frame      | `orbitRoom.ts` in the race shape                                          | Cross-engine float unmeasured                             |
| 114 | Soaring      | call table | Same task; the faster finish wins, checked by replay            | `launch`, `step`; (speed, circling) per step           | A race room                                                               | `Math.exp` across engines                                 |
| 115 | Popper       | call table | Same seed, scores side by side, every shot replayed by the host | `shoot(g, angle)`                                      | A race room                                                               | A near-edge snap could differ across engines              |
| 116 | Tunnel       | call table | Same tunnel, same speed, to N orbs; streaks side by side        | `orbOffset(k)` already gives everyone the same tunnel  | A room carrying each seat's claimed streak, with an end at N orbs         | Frame dt: streaks are claims; WebGPU                      |
| 117 | Bricks       | call table | Today's walls, scores side by side as you play                  | Today's walls                                          | A room with turn `'any'` carrying claimed scores                          | Claims; two seats                                         |
| 118 | Towers       | call table | Today's map, waves held side by side                            | Today's map                                            | A room carrying claimed waves                                             | Claims; two seats                                         |
| 119 | Bike trials  | ghost      | Race the ghost of your best run, or a friend's from the table   | #43's input log                                        | A ghost pose in the `Trial` struct; `bike()` takes its pose               | New WGSL                                                  |
| 120 | Soaring      | ghost      | Fly against the par glider, or your best flight                 | `par()`, `pilot(m)`                                    | A second glider in glide.wgsl                                             | New WGSL                                                  |
| 121 | Lander       | ghost      | Fly against a friend's landing                                  | The ghost craft LanderDemo already draws               | Replay a friend's input log in the autopilot's place                      | The log (about 1 kB) comes through the table or chat      |

## 4. The rest, by category

The best idea left for each toy once the ranked list is taken out: the highest value, then the
cheapest. "In the list" gives the toy's entries above.

**Arcade**

| Toy             | Today                                           | Max players        | Best idea beyond the list                                | Cost     | Blocker                                    | In the list     |
| --------------- | ----------------------------------------------- | ------------------ | -------------------------------------------------------- | -------- | ------------------------------------------ | --------------- |
| Tunnel          | Solo; share card                                | 1                  | Fly together, friends' ships drawn live                  | L        | Item 2 steps 4–5; new shader               | #116            |
| Marble maze     | Solo sandbox, no card                           | 1                  | Same maze, most marbles in 60 s                          | M (low)  | GPU count read back; no clock or finish    | —               |
| Bike trials     | Solo; share card                                | 1                  | Two bikes on the course, live                            | L        | Item 2 steps 4–5                           | #43, #119       |
| Strut           | Solo; share card; creature file                 | 1                  | Strut-off: every creature walks side by side             | M        | `Math.hypot`/`exp` on a close finish; GPU  | #100            |
| Gust            | One screen for two, or the computer; share card | 2                  | None: stays one screen (Evan)                            | —        | GPU fluid; Evan's exclusion                | —               |
| Möbius golf     | Solo; share card                                | any                | A match across days, by turns                            | XL       | Production SQL; edge deploy                | #41, #73        |
| Pinball         | Solo; share card; table file                    | 1–4                | Alternate balls at a call table, checked by replay       | M        | Flipper `Math.sin`/`cos` across engines    | #45, #75        |
| Night crossing  | Two on one keyboard; share card                 | 2 (two roles)      | Pilot and keeper on two screens (Item 2 step 9)          | M        | Item 2 steps 4–5                           | #94             |
| Orbit           | Solo; share card                                | 1                  | Fly beside the autopilot's ghost                         | S (low)  | None                                       | #113            |
| Skipping stones | Solo; share card                                | any                | Nothing beyond the list                                  | —        | —                                          | #39, #76        |
| Soaring         | Solo; share card                                | 1 (a race: any)    | Nothing beyond the list                                  | —        | —                                          | #95, #114, #120 |
| Peg drop        | Solo; share card                                | 1                  | "Same pegs" link for a set number of drops               | S (low)  | Needs an end; best is "most ever"          | —               |
| Stackfall       | Beat links; two on one keyboard; the computer   | 2 (planned 2–4)    | Two to four wells on a call, junk across (Item 2 step 7) | M        | Item 2 steps 4–5                           | #93             |
| Air hockey      | The computer only                               | 2                  | Air hockey on a call (Item 2 step 10)                    | M        | Item 2 steps 4–5                           | #36             |
| Light trails    | One to three computer rivals                    | 4                  | Up to four riders on a call (Item 2 step 8)              | M        | Item 2 steps 4–5; seeded computer steering | #37             |
| Archery         | Daily winds; share card                         | any                | Up to four archers online                                | L        | Two seats                                  | #40, #74, #84   |
| Bricks          | Daily walls; wall links; share card             | 1                  | Draw one wall together                                   | S (low)  | Two seats                                  | #117            |
| Time trial      | Daily track; your own ghost                     | 1 (ghosts: any)    | Friends' best-lap ghosts on a call (Item 4)              | M        | Frame dt; about 12 kB a lap                | #99             |
| Pool            | By turns; the computer                          | 2                  | Nothing beyond the list                                  | —        | —                                          | #28, #48, #67   |
| Towers          | Daily map; share card                           | 1                  | Co-op: two builders defend one field                     | L        | Variable dt: lockstep or a host stream     | #118            |
| Putt            | Call table; by turns; hole links                | 2 at a table (any) | Three or four golfers at one table                       | L        | Two seats                                  | #68             |
| Lander          | Daily terrain; terrain links; autopilot ghost   | 1 (ghosts: any)    | The score to beat shown on arrival                       | XS (low) | None                                       | #44, #121       |
| Darts           | Call table; by turns                            | 2 at a table (any) | Three or four at 501                                     | L        | Two seats                                  | #69             |
| Bowling         | Call table; by turns                            | 2 at a table (any) | Bowling night online: three to six bowlers               | L        | Two seats                                  | #70             |
| Artillery       | Call table; by turns                            | 2 guns             | Three or four guns on one field                          | L        | Two seats; replay trusts `Math.sin`        | #71             |
| Curling         | Call table; by turns                            | 2 sides (4 a team) | Two against two                                          | L        | Two seats                                  | #72             |
| Keepy-up        | Solo; share card                                | 1                  | "Same breeze" link                                       | S (low)  | Frame dt: claims                           | —               |
| Echo            | Solo; share card                                | 1 (in turns: any)  | Nothing beyond the list                                  | —        | —                                          | #42, #85        |
| Popper          | Solo; share card                                | 1 (versus: 2)      | Versus: a combo drops rows onto the friend's board       | M        | None                                       | #86, #115       |
| Rocks           | Solo; share card                                | 1 (two ships: 2)   | Two ships on one keyboard                                | M        | None                                       | —               |

**Board**

| Toy                    | Today                                      | Max players  | Best idea beyond the list                             | Cost    | Blocker                                                   | In the list   |
| ---------------------- | ------------------------------------------ | ------------ | ----------------------------------------------------- | ------- | --------------------------------------------------------- | ------------- |
| Rock paper scissors    | One keyboard; by turns                     | 2            | A call table, both throwing at once                   | M       | Needs commit-reveal; a new module (rpsRoom.ts is bundled) | #48           |
| Ten thousand           | Race link; one screen; by turns            | any          | Call race board: everyone on the same deal at once    | M       | Every browser knows the seed (a claim)                    | #46, #48      |
| Hold'em                | Three computers; by turns, heads up        | 2–10         | Poker night on the call, the relay dealing            | XL      | Hidden cards; relay merge window; poker.ts frozen         | #48           |
| Mancala                | Call table; by turns; one screen           | 2            | "Beat my win" link                                    | S (low) | None                                                      | —             |
| Dots and boxes         | Call table; by turns; one screen           | any (2–4)    | Three or four on one board                            | L       | Two seats; a new module (dots.ts is bundled)              | —             |
| Reversi                | Call table; by turns; one screen           | 2            | "Beat my win" link                                    | S (low) | None                                                      | —             |
| Sea battle             | The computer; by turns                     | 2            | A live battle with committed fleets                   | L (low) | Hidden fleets                                             | #48           |
| Hex                    | Call table; by turns; one screen           | 2            | Two teams of two                                      | L (low) | Two seats                                                 | —             |
| Four in a row          | Call table; by turns; one screen           | 2            | "Beat my win" link                                    | S (low) | None                                                      | #5            |
| Ultimate noughts       | Call table; by turns; one screen           | 2            | Two teams of two                                      | L (low) | Two seats                                                 | —             |
| Twenty-one             | The dealer; a duplicate duel by turns      | 1–7          | Everyone on the call plays the same ten shoes at once | M       | Every browser knows the seeds                             | #48, #88      |
| Nine men's morris      | Call table; by turns; one screen           | 2            | Two teams of two                                      | L (low) | Two seats                                                 | —             |
| Draughts               | Call table; by turns; one screen           | 2            | Two teams of two                                      | L (low) | Two seats                                                 | —             |
| Backgammon             | The computer; by turns                     | 2            | Chouette: one against a team                          | L (low) | Fair dice; two seats                                      | #47, #48      |
| Chess                  | Call table; by turns                       | 2            | Consultation chess, two against two                   | L       | Two seats                                                 | —             |
| Hearts                 | Three computers; by turns, two friends     | 4            | Four friends live, the relay dealing                  | XL      | Hidden hands; hearts.ts frozen by the bundle              | #48, #90      |
| Go 9×9                 | Call table; by turns                       | 2            | Pair Go                                               | L       | Two seats                                                 | —             |
| Dominoes               | The computer; by turns                     | 2–4          | Two to four live, the relay dealing                   | XL      | Hidden hands; relay merge window                          | #48           |
| Gin rummy              | The computer; by turns                     | 2            | Gin live on the call, the relay dealing               | XL      | Hidden hands; relay merge window                          | #48, #89      |
| Fences                 | Call table; by turns                       | 2 or 4       | Four players, one from each edge                      | L       | Two seats; a new module (fences.ts is bundled)            | —             |
| Cribbage               | The computer; by turns                     | 2–4          | "Same deal" link                                      | S (low) | None                                                      | #48           |
| Liar's dice            | Two or three computers; by turns, heads up | 2–6+         | Everyone on the call with a cup, the relay shaking    | XL      | Hidden cups; relay merge window                           | #48           |
| Breakthrough           | Call table; by turns; one screen           | 2            | "Beat my win" link                                    | S (low) | None                                                      | —             |
| Spades                 | Computer partner; by turns                 | 4            | Four friends live (Item 2 steps 4–6a)                 | XL      | The relay deals; relay merge window                       | #48, #91      |
| Chinese checkers       | Call table; by turns; one screen           | 2, 3, 4 or 6 | Four, then six, on the full star                      | L       | Two seats; `chairs.ts` plans 2 or 4                       | —             |
| Crazy eights           | One to three computers; by turns           | 2–7          | Two to four live, the relay dealing                   | XL      | Hidden hands; relay merge window                          | #48           |
| Five in a row          | Call table; by turns; one screen           | 2            | Two teams of two                                      | L (low) | Two seats                                                 | —             |
| Noughts and crosses 3D | Call table; by turns; one screen           | 2            | Two teams of two                                      | L (low) | Two seats                                                 | —             |
| Yacht                  | The computer, or alone; by turns           | any          | Call race board: same dice, own cards                 | M       | Every browser knows the seed                              | #1, #48, #111 |
| Fox and geese          | Call table; by turns; one screen           | 2 sides      | Several friends share the geese                       | L       | Two seats                                                 | —             |
| Shut the box           | The computer, or alone; by turns           | any          | Call race board: everyone's box on the same dice      | M       | Every browser knows the seed                              | #2, #48, #112 |

**Puzzles**

| Toy            | Today                                   | Max players       | Best idea beyond the list                | Cost     | Blocker                                           | In the list   |
| -------------- | --------------------------------------- | ----------------- | ---------------------------------------- | -------- | ------------------------------------------------- | ------------- |
| Waterworks     | Recorded card                           | 1                 | Send your Sandbox walls by link          | S (low)  | GPU: the shape travels, never the result          | —             |
| Seedling       | Recorded card; garden files             | 1                 | Race in the same garden on a call        | M        | None                                              | #77, #78      |
| Shadow box     | Pass and play; by turns                 | 2                 | "Beat my box" on a random box            | S (low)  | Needs a new solo mode                             | #48, #63, #64 |
| Fold           | Recorded card; fold files               | 1                 | Race to fold the same puzzle             | M (low)  | Floats; the host referees                         | #79, #80      |
| Topple         | Recorded card; table file               | 1                 | Send a painted table to push             | M        | Kilobytes: chat, not a comment                    | —             |
| Jigsaw         | Recorded card                           | 1 (a jigsaw: any) | One jigsaw together on a call            | M        | Painted pictures only; last drop wins             | #81           |
| Beams          | Recorded card                           | 1                 | Card names fewest pieces against par     | XS (low) | None                                              | #65, #66      |
| Bridge         | Recorded card                           | 1                 | Cheapest bridge that holds, on a call    | M        | Floats about 1e-11 apart by engine: host referees | #6            |
| Nonogram       | Recorded card; puzzle codes             | 1                 | Solve one picture together               | M        | A dragged line must commit as one move            | #3            |
| Logic gates    | Recorded card                           | 1                 | Build one circuit together               | M        | None                                              | —             |
| Slide          | Seed shown on screen                    | 1                 | A friend's route as a ghost puck         | M (low)  | One puck in the shader                            | #8, #34, #92  |
| Paint mixer    | Recorded card                           | 1                 | Nothing beyond the list                  | —        | —                                                 | #50, #51, #82 |
| Level maker    | Room links with par                     | 1                 | Build one room together                  | M        | None                                              | #7, #35       |
| Codebreaker    | Daily code; by turns                    | 2                 | Race the same seeded code on a call      | M        | A new call room; hide the other seat's guesses    | #48           |
| Golf patience  | Daily deal                              | 1                 | A daily duel by turns (Item 3)           | XL       | SQL; edge deploy                                  | #4, #60       |
| Mines          | Daily board                             | 1                 | Clear one board together                 | M        | A flag must be absolute, not a toggle             | #10           |
| Tile pairs     | Daily layout                            | 1                 | Nothing beyond the list                  | —        | —                                                 | #11, #52, #53 |
| Sudoku         | Daily, the same only within one engine  | 1                 | Solve one grid together                  | M        | The givens must travel, never the seed            | #27, #83      |
| Pipes          | Daily board                             | 1                 | A daily duel by turns (Item 3)           | XL       | SQL; edge deploy                                  | #12, #32, #33 |
| Peg solitaire  | Recorded card                           | 1                 | A link naming board, hole and pegs left  | XS (low) | None                                              | #61, #62      |
| Cages          | Daily board                             | 1                 | Nothing beyond the list                  | —        | —                                                 | #13, #54, #55 |
| Lamps          | Call table (race, together); daily duel | 1 (2 online)      | Everyone's finish on one call-wide strip | M        | The local date: carry the seed                    | #9            |
| Island bridges | Daily map                               | 1                 | Nothing beyond the list                  | —        | —                                                 | #14, #56, #57 |
| Tents          | Daily field                             | 1                 | Nothing beyond the list                  | —        | —                                                 | #15, #58, #59 |

**Make**

| Toy           | Today                                | Max players       | Best idea beyond the list                      | Cost             | Blocker                                         | In the list   |
| ------------- | ------------------------------------ | ----------------- | ---------------------------------------------- | ---------------- | ----------------------------------------------- | ------------- |
| Fluid         | Solo                                 | any               | Friends' taps splat colour into your fluid     | XS (low)         | After #49                                       | —             |
| Kaleidoscope  | Solo                                 | any               | Everyone draws into one kaleidoscope           | M                | Needs a stroke log                              | —             |
| Marbling      | Solo                                 | any               | One tray for the call                          | M                | Near-identical sheets; two seats                | —             |
| Neon          | Solo                                 | any               | Friends' taps knock your sign                  | XS (low)         | After #49                                       | #101          |
| Mirror        | Solo; the camera stays on the device | 1                 | Save a still as a PNG                          | S (low)          | Privacy: never sent automatically               | —             |
| Clay          | Solo                                 | any               | Sculpt one lump together                       | L                | The hit point is only on the GPU                | —             |
| Pixel sort    | Solo                                 | any               | Swipe the built-in scene together              | M (low)          | Canvas anti-aliasing differs; photos stay local | —             |
| Stained glass | Solo                                 | any               | Design one window together                     | M                | Needs a fixed lead grid                         | —             |
| Harmonograph  | Solo; its sound goes down the call   | any               | Everyone flicks one sheet                      | M                | A late joiner replays every swing               | —             |
| Rain on glass | Solo                                 | any               | Write in the mist on each other's window       | M                | Only the writing is shared                      | —             |
| Loom          | Solo; its notes go down the call     | any (a natural 2) | Two at one loom: one threads, one treadles     | M (S after #102) | None                                            | #102          |
| Film studio   | PNG and scene files                  | any               | Nothing beyond the list                        | —                | —                                               | #103, #107    |
| Critters      | Creature file                        | any               | My champion against yours on one track         | M                | `Math.sin`/`hypot` on a near-tie                | #104          |
| Print shop    | PNG and block files                  | any               | Pass the block: a print by several hands       | M                | A block can reach 1.4 MB                        | —             |
| Palette       | Copy hex or CSS                      | any               | A palette link with a built-in picture         | S (low)          | Only colours travel                             | —             |
| Wallpaper     | Recorded card (quiz); PNG            | any               | Draw on one wall together                      | M                | Strokes are metered per delivery                | #96           |
| Colour sight  | Solo                                 | 1                 | "Do these stay apart for you?" link            | S (low)          | Only colours travel                             | —             |
| Fireworks     | Show links                           | any               | Nothing beyond the list                        | —                | —                                               | #17, #29, #30 |
| Type foundry  | Font links                           | any               | Nothing beyond the list                        | —                | —                                               | #18, #108     |
| Bonsai        | Tree links                           | any               | Nothing beyond the list (a server match is XL) | —                | —                                               | #16, #19, #31 |

**Nature**

| Toy        | Today                              | Max players | Best idea beyond the list                      | Cost               | Blocker                                          | In the list |
| ---------- | ---------------------------------- | ----------- | ---------------------------------------------- | ------------------ | ------------------------------------------------ | ----------- |
| Aquarium   | Solo                               | any         | Every friend is a shark too                    | M (low)            | Phones send taps, not drags                      | #21         |
| Black hole | Solo                               | 1           | None: one hole to drag and throw               | —                  | —                                                | —           |
| Bubbles    | Solo; pops go down the call        | any         | A bubble you blow floats onto friends' screens | M                  | The owner's pop is the truth                     | #22         |
| Cloth      | Solo                               | any         | Pull one cloth from both sides                 | M (low)            | GPU tears diverge at once                        | —           |
| Erosion    | Solo                               | any         | Friends' taps rain on your land                | XS (low)           | After #49; it lands under the ring, not the hill | —           |
| Lava lamp  | Solo                               | any         | Friends' taps stir your lamp                   | XS (low)           | After #49                                        | —           |
| Light      | Solo                               | any         | One dark room for the call                     | M (S after a link) | The drift needs the shared clock                 | —           |
| Lightning  | Solo                               | any         | Nothing beyond the list                        | —                  | —                                                | #23         |
| Pond       | Solo                               | any         | Nothing beyond the list (it carries the hook)  | —                  | —                                                | #49         |
| Sand       | Solo                               | any         | One shared box, in lockstep over the relay     | L                  | Item 2 steps 4–5; a ~100 kB snapshot to join     | #24         |
| Slime      | Solo                               | any         | Friends' taps lay food                         | XS (low)           | After #49                                        | —           |
| Snowflake  | Solo; your own breath              | any         | Send the weather as a link                     | S (low)            | The same kind of flake, not the same flake       | #20         |
| Squish     | Solo; its sound goes down the call | any         | Pull one jelly picture between you             | M                  | Built-in pictures only                           | —           |
| Sun path   | Recorded card                      | any         | The closer guess takes the round, on a call    | M                  | Two seats                                        | #38, #87    |

**Patterns**

| Toy         | Today                              | Max players | Best idea beyond the list                       | Cost     | Blocker                                    | In the list |
| ----------- | ---------------------------------- | ----------- | ----------------------------------------------- | -------- | ------------------------------------------ | ----------- |
| Epicycles   | Solo                               | any         | Fourier Pictionary: guess as the arms redraw it | M        | The drawing travels, so a console can peek | #105        |
| Fractal     | Solo                               | any         | Follow my dive: the call sees the same zoom     | M        | Throttle to about 4 Hz                     | #106        |
| Graph match | Recorded card; notes down the call | any         | First curve onto the target, on a call          | M        | Two seats                                  | #98         |
| Growth      | Solo                               | any         | Friends' taps drop seeds                        | XS (low) | After #49                                  | —           |
| Life        | Solo                               | any         | One Life board for the call                     | M        | Must be Seedling's fixed 32×20 board       | #25         |
| Swarm       | Solo; listens to the call          | any         | Nothing beyond the list                         | —        | —                                          | #109        |

**Sound**

| Toy        | Today                              | Max players | Best idea beyond the list               | Cost     | Blocker                         | In the list |
| ---------- | ---------------------------------- | ----------- | --------------------------------------- | -------- | ------------------------------- | ----------- |
| Ferrofluid | Solo; listens to the call          | any         | A friend's tap is a magnet for a moment | XS (low) | After #49                       | —           |
| Fireflies  | Solo; listens to the call          | any         | Nothing beyond the list                 | —        | —                               | #26         |
| Galaxy     | Solo; listens to the call          | any         | None: it already hears the call         | —        | —                               | —           |
| Harp       | Solo; plucks go down the call      | any         | Jam on one harp                         | M        | Copy `jam.ts`'s caps per person | —           |
| Intervals  | Recorded card; notes down the call | any         | Name-that-interval race on a call       | M        | Two seats                       | #97         |
| Music      | Draws the call's audio             | any         | None                                    | —        | —                               | —           |
| Ribbons    | Solo; listens to the call          | any         | Friends' pointers lead ribbons          | S (low)  | Phones send taps, not trails    | —           |
| Voiceprint | Solo                               | any         | Nothing beyond the list                 | —        | —                               | #110        |

## 5. Toys that cannot be shared live

### One world on two screens is impossible

Most of these run their world on the GPU in floating point, often seeded from `Math.random`. Two
machines step the same inputs into different worlds, by graphics card and even run to run. The fix
is not a better sync. They would need a CPU simulation that every client steps identically, which
means rewriting the toy.

| Toy                                                                                                                         | Why not                                                                                                                                                                | Does a shared seed and score still fit?                                                                                                                       | What does fit                                                                     |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Gust                                                                                                                        | Its puck is moved by a GPU stable-fluids solver (`gustEngine.ts`) whose floats differ by card. Evan, 26 and 27 Nov: it stays out of online play and is not a tour stop | No. It takes no seed, so there is nothing to share, and the puck would differ anyway                                                                          | One screen for two, or against the computer, as now                               |
| Waterworks                                                                                                                  | GPU FLIP fluid: atomics order and float sums differ by card and run to run                                                                                             | Barely. The levels are already the same for everyone, and only "Fill the cup" spends ink, so it gives one figure (S, low): "Recorded", never checkable        | Send your Sandbox walls by link (S, low): the shape travels, the result does not  |
| Marble maze                                                                                                                 | Marbles are stepped by compute shaders, counted on the GPU, read back every 0.25 s, on frame dt                                                                        | Partly. The maze seed is real (`mazeFor` is a seeded LCG), but there is no clock or finish: a 60 s challenge is a new mode (M, low), and the count is a claim | Draw a maze and send it (M, low)                                                  |
| Fluid, Pond, Aquarium, Slime, Growth, Ferrofluid, Erosion, Cloth, Snowflake, Swarm; Lightning's bolts and Fireflies' phases | GPU float simulations; each screen keeps its own world                                                                                                                 | No: they keep no score, and the world differs                                                                                                                 | Batch 3's pokes, or the call's audio (#20): the touches are shared, not the world |
| Clay                                                                                                                        | A 64³ distance field on the GPU; the hit point is known only there                                                                                                     | No score                                                                                                                                                      | Sculpting together needs every edit's hit read back from the GPU and logged (L)   |
| Lava lamp                                                                                                                   | CPU blobs, but stirred with `Math.random`, and float maths that differ in the last bits                                                                                | No score                                                                                                                                                      | A lamp the host owns and streams to the call (M, low), or pokes                   |
| Black hole                                                                                                                  | One hole over a stateless sky                                                                                                                                          | No                                                                                                                                                            | Nothing: shadow pointers already show friends                                     |
| Mirror                                                                                                                      | The camera picture                                                                                                                                                     | No                                                                                                                                                            | A PNG the person chooses to post (S, low); camera video never travels             |

Not in this group, though they look like it:

- **Sand.** Its rule is integer Margolus, and the CPU copy matches the GPU cell for cell, so
  lockstep works. It needs a fixed grid, a shared tick and the relay (L).
- **Life.** Seedling's fixed 32×20 board with its integer step can be one board for the call (M).
- **Galaxy and Harp.** Galaxy's stars come from their index and it already hears the call. A harp
  string has no simulation, so a pluck is the whole change.

### Live, but only as a claim

Tunnel, Bricks, Towers, Keepy-up, Rocks, Night crossing and Time trial run on the CPU, but they step
on frame dt, so nobody can replay a run. A shared seed with scores side by side fits them, and
Bricks, Towers and Time trial already have a daily. But every score is a claim, as `beat.ts` says of
its own links. A ghost has to be position samples (Time trial's `packGhost`), not inputs. A live
race carries claimed scores (#116–#118) or a stream from the host.

### Hidden information on a room that shows everything

The call room sends its whole state, so the host would see everything. That rules it out for
Hold'em, Hearts, Spades, Liar's dice, Gin, Dominoes, Cribbage, Crazy eights, Sea battle,
Twenty-one's shared shoe and Rock paper scissors' sealed throw. Each is live only two ways:

- by turns while both have the match open (batch 2);
- or behind a relay dealer (XL; Spades' step 6a comes first).

A duplicate-deal link fits most of them: Hold'em until the first bust, Hearts at Fair, Spades at
Easy or Fair, Gin, Cribbage, Dominoes, Liar's dice, and Crazy eights once the Demo refills the stock
itself. Where the secret is the game, a retry reveals it and the score falls apart: Rock paper
scissors' coin, Sea battle's fleet, Twenty-one's shoe.

### Two engines, two games

`sort(() => rand() - 0.5)` leaves the order to the engine. V8's sort (Chrome) and the merge sorts
of Safari and Firefox give different orders and draw a different number of random numbers.
Measured 27 Nov 2026, with V8's sort against a merge sort: 29 draws against 27 for 13 cards, so
every later draw shifts. Sudoku's case was measured in V8 and JavaScriptCore themselves.

It is safe where one engine runs it (lab-move's server), and wrong wherever two browsers rebuild a
game from a seed:

- `sudoku.ts:103` and `:301`: today's puzzle (#27).
- `hearts.ts:143`, `:224` and `:238`: Easy and Hard.
- `spades.ts:241`, `:333` and `:346`: Hard.
- `eights.ts:97`: the stock reshuffle.
- `shadowboxRoom.ts:285`: run by the server only, so safe.

## 6. How this lines up with the build order

The order already set: Item 1, the tour on a call; Item 2, live relay games; Item 3, more daily
duels; Item 4, Lander and Time trial versus and ghost race.

**Item 2: live relay games.** These are Stackfall wells (step 7), Light trails (8), Night crossing
(9), Air hockey (10) and Spades for four (4–6a). Main has the relay's lab door (step 3, #470), and
nothing of steps 4–5.

- **None of the cheap wins is Item 2.** Its toys gain cheap modes that never touch the relay: Air
  hockey on one screen #36, Light trails on one keyboard #37, Stackfall's daily #93, Night
  crossing's daily #94 and Spades' duplicate hand #91. None of them conflicts with Item 2:
  - #36 drives `advance()`'s two wants, the same call `hockeyLive.ts` will make;
  - #37 leaves computer steering alone, which Item 2 moves to the seeded rng;
  - the dailies only add a dated best.
- **Item 2 holds the piece that matters most here.** Step 4's `chairs.ts` is the first seat model
  past two. 24 "more seats" ideas rated L wait on it:
  - Archery, Putt, Darts, Bowling, Artillery and Curling;
  - teams of two for Mancala, Reversi, Hex, Four in a row, Ultimate noughts, Morris, Draughts,
    Breakthrough, Five in a row, the cube, Chess and Go;
  - Dots, Fences, Chinese checkers, Fox and geese, Backgammon's chouette and Ten thousand's folk
    game.

  The team games' rules already work by side, so each of those becomes about XS once the seats
  exist. Dots, Fences and Chinese checkers also need new rules for more than two sides. Building
  `chairs.ts` for any game and for teams, not for Spades alone, is the largest single step toward
  "as many players as the game allows". Its plan is 2 or 4 chairs for the relay games, so Chinese
  checkers' three and six, and seating a call-table game, are each a step beyond it.

- **Step 6a's dealer** is the same lever for hidden hands (piece 8 in §3).

**Item 3: more daily duels.** A daily duel is `lampsDuel.ts`'s pattern: both play a board the server
picks, sealed until both finish.

- **None of the cheap wins is Item 3.** The audit's duels (Golf, Pipes) are XL. Each needs a
  `lab-move` `core.ts` entry, a bundle rebuild, a `lab_match_playable` replace and a redeploy: the
  production SQL and edge path that is parked.
- **Batch 1 is the no-server half of the same idea.** It gives the same board with scores side by
  side, as claims. A duel later adds "sealed and checked" on top. Lamps' link #9 already replays
  its presses on open, which is as close to a checked duel as a link gets.
- **#27 comes before any Sudoku duel,** or a server and an iPhone would build different grids from
  one seed.
- **Batch 1's wider seed bound** is the same range a duel's server-picked seed would need.

**Item 4: Lander and Time trial, versus and ghost race.**

- **Two cheap wins are Item 4's Lander half:** the landing contest at the call table, checked by
  replay (#44, S, high), and racing a friend's landing as a ghost (#121, S, medium). LanderDemo
  already steps and draws a ghost craft, so #121 swaps the autopilot's inputs for a friend's.
- **Time trial's half is not cheap.** Friends' best-lap ghosts on a call are M, because a 40 s lap
  packs to about 12 kB, past the room's "under a kilobyte". A live race is L, on the relay.
- **#99 is adjacent.** Today's lap on the share card needs one decision first.
- **The Night crossing ghost (M) belongs here.** Item 2's plan cut the crossing race because "it
  belongs with the ghost race", and Evan's 26 Nov answers left that cut standing.
- **The other ghosts could share Item 4's ghost piece:** Trials #119, Soaring #120, and the Slide,
  Lamps, Level maker and Ten thousand ghosts outside the list.

**New, in none of the items:** everything else in §3, batches 1–3 included. Batches 2 and 3 run
on the call channel that Item 1's tour uses, so they reach friends who are already together on a
call.

## Not checked

- **Cross-engine float agreement** for every room that replays physics (Pool, Möbius golf,
  Skipping stones, Trials, Lander, Orbit, Soaring, Popper, Pinball, Strut, Critters, Bridge, Fold,
  Paint mixer). Probes ran in V8 and JavaScriptCore only, and the arcade ones in V8 alone.
  "Unmeasured" in a blocker means that.
- **Firefox (SpiderMonkey).**
- **Anything in a browser.** No dev server was started and no toy was played for this file.
- **The batch costs.** They are dated estimates (27 Nov 2026), not measurements.
