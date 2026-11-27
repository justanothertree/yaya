# Live tables: friends' real-time games over the relay

Item 2 of Evan's 22 Nov list: friends on a call playing Spades for four, Stackfall, Light trails,
Night crossing and Air hockey together, live. The call channel carries who sits where; play goes
over the relay (`server/ws-server.js`) in a friends-only room, and a seated friend's browser
referees each round. It is built in steps, each one commit and releasable alone, and each adds its
section here: the reasons, and what was measured, with the date.

## Evan's answers, 26 Nov 2026

The build plan put six questions to Evan that only he could answer. His answers, which every step
below and after follows:

| Question                                           | Answer                                                                                                                 | What it changes                                                                                                                                                                                                                     |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who holds the Spades hands at a live table?        | **B: the relay deals and plays the computers.**                                                                        | No browser ever holds another seat's cards, which keeps the written rule that hidden hands need a dealer nobody can peek at. Spades gets a relay step of its own (6a): a relay deploy, and a relay restart redeals the hand in play |
| Who is "the challenger" at a live table?           | **Whoever sat down first.** If they leave, the next person to sit takes over                                           | The challenger sets the mode and the teams and presses Start. It is derived from who sat when, never elected, so a table with anyone seated always has one                                                                          |
| When may a relay change merge?                     | **Only when Render's metrics show no live connections**                                                                | Every relay merge (steps 2, 3 and 6a) waits for that reading, because a relay deploy ends every live park, bout and table                                                                                                           |
| Does the relay have its Supabase URL and anon key? | **Evan checks it himself**, on `/relay-config` as admin, along with Supabase Realtime's public access and the 👥 meter | Nothing here reads production. If either key is missing, every table answers `door-unavailable`, and setting it on Render is his change                                                                                             |
| Gust online?                                       | **No: Gust stays out of online play**                                                                                  | It stays one keyboard, or against the computer. Its puck lives on the GPU and its fluid differs by graphics card, so two machines would each see a different game                                                                   |
| Four-player Spades by turns, across days?          | **Parked:** no production SQL and no `lab-move` redeploy                                                               | The exact ask is in docs/OPEN-DECISIONS.md §25. Four friends playing together live on a call does not wait on it                                                                                                                    |

The question about Gust also named two smaller cuts: air hockey two against two (there are only
two paddles) and the Night crossing race (it belongs with the ghost race). The answer named Gust
alone, so those two stay as the plan has them, cut. Two answers in the same message are about the
party bus, not live tables, and are not recorded here.

## Step 1: who hosts a table is a question about ids

The four-chair table of step 4 needs the same answer as a call's two-seat room to "who hosts", and
the plan's rule is that it imports that answer from `src/lab/social/room.ts` rather than copying it.
room.ts asked it twice, with a sort each time: `hostOf` as `[room.me, ...room.present].sort()[0]`,
which takes a whole room, and the host-before half of `answersHello` again, of plain values. Now
`lowest(me, present)` answers it once, from ids alone, and both read it: `hostOf` is
`lowest(room.me, room.present)` and `answersHello` asks whether I am `lowest` among everybody but the
newcomer. The refactor itself (d0546785) changes nothing that goes on the wire, and the golden and
the measurements below are how that is known rather than believed.

⚠️ **The fixes that follow it DO change what clients send** (58e46345, from review, and the commit
after it, from verification). A tab now hands its host the room it holds when the host shows it
lacks it, and a host shown a move made against a board newer than its own says `hello` again. Both
are in room.ts, which every live call game runs on (Four in a row, Reversi, Chess, Lamps and the
rest of `src/gpu/*Room.ts`), so both reach production when this branch merges. Neither reaches the
relay or lab-move.

### The golden, recorded before the change

`src/lab/social/roomWire.test.ts` plays one Four in a row game in a call over room.test.ts's
in-memory network, with fourrow.ts's own rules on the classic board and the dev call's ids (Bo
…0001, Ann …0002, Cy …0003). Ann and Cy join and sit, and three discs drop. Bo arrives to watch and,
as the lowest id, becomes host mid-game. Three more discs drop, decided by Bo. Bo leaves and Ann
hosts again; Bo comes back; Cy leaves, and a minute later the host frees Cy's seat. Every body the
rooms hand to `sendParty('lab', …)` is captured with its step and sender, along with who each tab
believes is host at the end of each step. The capture is
`src/lab/social/__fixtures__/fourrow-wire.json`: 25 messages and 9 step headings, one to a line,
36 lines and 8,370 bytes. It was written from 8b4d87ea's room.ts, before `lowest` existed. The test
compares the file byte for byte, line by line first, so a failure names the messages that changed.

- **The fixture is in `.prettierignore`.** lint-staged runs `prettier --write` on every committed
  `.json`, and prettier re-flows the 42 numbers of each `cells` array, so the bytes compared would
  have been the formatter's rather than the wire's. Measured: without the entry `prettier --check`
  flags the file, and with it `prettier --write` leaves the file's md5 unchanged.
- **Bo comes back because his first arrival cannot tell answersHello's two halves apart.** The first
  recording, with one arrival, stayed green when the hello rule was changed to count the newcomer,
  which is the old "am I host" rule that broke games in progress. Ann was both the host before Bo
  and the publisher of the room everybody held, so she answered either way, and only room.test.ts
  went red. When Bo comes back, Ann hosts a room Bo himself published, so only the host-before half
  answers him. The recording was taken again, on the unchanged room.ts, with that step in it.
- A second test reads the recording itself, so that a fixture of a game where nothing happened
  cannot pass. It checks that six discs landed, three decided by Ann and three by Bo. It checks the
  host Ann's tab saw at each step (Ann four times, Bo twice, Ann, Bo twice) and that every tab agreed
  at the end of every step. It checks that the last state is Bo freeing Cy's seat.

`src/lab/social/roomLowest.test.ts` asks `lowest` itself, from the shape of a Supabase id rather
than from a sort. Each id is a uuid built from a BigInt, and the expected host is the smallest
BigInt, so the expectation shares no arithmetic with the string comparison in the code. The test
sweeps every group of seven ids, with each member as `me` and the others in three orders: 1,344
questions. It checks that `me` counts and that an absent id is ignored however low it is. It checks
that every member of a group works out the same host from their own seat and exactly one of them is
it. The ids differ in the first digit, the last and the middle, and use the letters.

### Measured, 26 Nov 2026

- Mutations of room.ts, each made once and put back (room.ts's md5 back to the same value each
  time), counted over `src/lab/social`:

  | Mutation                                                     | Red                                                                                                                                        |
  | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
  | `lowest` sorted descending                                   | 16: the golden (28 of its lines gone, 27 new: Cy hosts), all 4 `lowest` tests, 5 in room.test.ts, 5 in roomModes.test.ts, 1 in bus.test.ts |
  | `lowest` leaving me out                                      | 28: the golden, 3 of the 4 `lowest` tests (the absent-id case rightly passes), 15 in room.test.ts, 9 in roomModes.test.ts                  |
  | ids compared by their first group only (`parseInt(id, 16)`)  | 4: the golden, 2 `lowest` tests, 1 in bus.test.ts. room.test.ts stays green: its ids `ann`, `bo` and `cy` parse in the right order too     |
  | the hello counting the newcomer, against the first recording | room.test.ts alone, 1                                                                                                                      |
  | the hello counting the newcomer, against the recording kept  | 2: the golden (2 lines gone: Ann's answer and Bo's freeing of the seat) and room.test.ts                                                   |

- At d0546785, room.test.ts and roomModes.test.ts were unchanged (same md5 as 8b4d87ea) and green:
  35 tests. The fixes below add to room.test.ts and pass the clock to every `receive`.
- Every one of the 39 `src/gpu/*Room.ts` files and lab-move's `core.ts` imports room.ts with
  `import type` only, checked by parsing every import of it.
  `node scripts/lab-move-bundle.mjs --check` passed without a rebuild, the committed bundle's md5 is
  unchanged, and the bundle names neither `hostOf` nor `answersHello`.
- The full suite: 408 files, 6,180 tests passed, 6 skipped, with the two new files' 6 tests in it.
- **The dev call**, 12:47–12:55 EST: Playwright's headless Chromium against the dev server on :5400,
  with placeholder Supabase values, one browser with a tab each for Bo, Cy and Ann. Readings came
  from the DOM (the status line, the seat cards and the canvas's own label) and from the colour
  painted at every cell's centre on each tab. A page outside the call, listening on the dev call's
  channel, read the wire. rAF fired in every tab (17–31 frames in 500 ms across the runs), so the
  canvases were painting.
  - Bo sat first and Cy second, and they played seven discs to Bo's four across the bottom. Bo
    played by keyboard. Cy played by mouse presses, and once by a synthetic pointer with
    `pointerId: 1`. Both tabs read "🏆 You win!" and "🏆 Bo wins!", with the same painted board,
    cell for cell. Every state of the game was published by Bo.
  - Ann arrived and was handed the finished board: 7 discs, "🏆 Bo wins!", the same pixels, and Bo
    first and Cy second on her cards. Bo alone answered her hello.
  - Cy asked for a new game and Bo and Cy dropped a disc each. All of it landed on all three tabs,
    in the same colours as the first game. Every state after Ann's arrival (seq 10–12) was Bo's, so
    the host was who it had been. 21 of 21 checks, three runs.
  - The same dev call with `lowest` sorted descending passed 16 of 21. Every tab still showed the
    same board, because the host was consistently the wrong person (Cy); only the wire said so.
  - **Seen in one run of three:** when Cy's presence reaches Ann before Bo's, Ann is for a moment the
    lowest id she can see, and announces the empty room she holds, at seq 0. Every tab ignores it as
    older. The refactor left `present()` untouched, so this is how the code behaved before too; it
    costs one message, and the fixes below leave it as it was.
  - **The first run read "Cy's drops do nothing", and the probe was wrong.** At 1280 × 900 the
    canvas's centre sits under the fixed call dock, so a press there lands on the dock. The probe
    now scrolls the grid into view and refuses to press unless the canvas is what is under the point.

### What review found, 26 Nov 2026

Two faults in room.ts, both older than this step, which the refactor kept exactly as they were (the
golden says so). They are fixed here because chairs.ts imports the same hello rule, and a fix made
once in room.ts keeps the two kinds of table from drifting apart.

- **A newcomer whose hello nobody answers led from an empty board for good.** Bo hosts a game with
  Cy, and Ann, a lower id, arrives: she is host at once, and `answersHello` names Bo, the host before
  her, to hand her the room. If Bo closes the toy, or his tab hangs, before her hello reaches him,
  Cy does not answer either, because Bo was still the host before Ann when the hello landed at Cy.
  Ann's empty room was older than everybody's and ignored, every move was asked of her and refused,
  and Bo's seat was never freed. So now a tab that hears **a hello from its new host that somebody
  else is to answer** owes that host its room, and so does a tab whose host **shows it a room older
  than the one it holds**: a host carrying on from a room that missed the last state before the old
  host left. The owed room goes at the tab's next `present`, every five seconds on where.ts's roster
  and whenever somebody comes or goes, unless that room or a newer one reaches it first from
  anybody. The wait keeps an arrival at its cost, because the answer the rule names arrives within
  the same hop and pays what everybody else owed.
  - **The first draft owed on the newcomer's empty room (seq 0) as well, and a dev call caught it
    costing a room.** A newcomer announces its empty room each time its roster grows, so the second
    announcement landed at Cy after Bo's answer and set the debt again, and Cy sent the game at her
    next tick for nothing. An empty room is now never a debt; the hello it follows is.
  - A late copy of the host's own earlier room, to a tab holding a newer room the host published,
    says only that it was late, and costs nothing.
- **A seat whose player's id names one of Object.prototype's keys was held for ever.** `missing`
  was a plain object, so `'constructor'` read back `Object`, `now - Object` is NaN, and NaN is never
  past `HOLD_MS`. Only a modified client can be called that. `missing` is built with no prototype
  and read with `Object.hasOwn`, because a room handed to a newcomer before their first `present`
  still holds openRoom's plain `{}`.

Measured, 26 Nov 2026, 19:30–20:05 EST:

- Every test was red first: the newcomer test (the board stayed at seq 0, two cases: Bo closing
  the toy, and Bo's tab hanging with his presence still listed), the host-behind test (Ann and Cy
  on two boards for good), and the prototype test (the seat still held after `HOLD_MS`).
- **Mutations of room.ts, 14, each made once and put back with its md5 checked, red counted over
  `src/lab/social`.** Every one went red. Never owing on a hello, 2; never owing on an older room,
  1; never sending what is owed, 3; sending it at once rather than at the next tick, 3, the golden
  among them (the answer the rule names would cost a room every time); an equal or newer room not
  paying, 2; adopting a newer room not paying, 1; an empty room counted as a debt, 1; a late copy of
  the host's own room counted, 1; owing anybody rather than the host, 1; owing with nothing to give
  (seq 0), 4 in roomModes.test.ts; a new host keeping its debt, 1; and the three ways of getting
  `missing` wrong (a plain object read with `??`, with `hasOwn`, and no prototype read with `??`),
  1 each.
- **roomWire.test.ts's recording is byte for byte unchanged**, and room.test.ts's arrival counts
  hold: 3 sends for a higher id joining, 10 for a fresh toy filling.
- **The dev call** (Playwright's headless Chromium, the dev server on :5400 with placeholder
  Supabase values, ids Al …0001, Bo …0002, Cy …0003). Bo and Cy dropped three discs, then Al
  arrived. With Bo there: Al was handed the board by Bo alone, Cy sent nothing in the seven seconds
  after, past where.ts's tick, and Cy's next disc landed on all three tabs, published by Al. With
  Bo's `lab` messages stopped at his tab, so that he stayed present and said nothing: Al was handed
  the board by Cy, once, 10.9 s after his tab opened. With the hello's debt taken out of room.ts on
  disk, the same run left Al at "Take a seat to play" with no discs after 17 s.

### What verification found, 27 Nov 2026

An independent verification of the review's fixes confirmed two faults that 58e46345 brought in,
an older stall that its new comment said it covered, and this section's own lead saying nothing on
the wire changes. Each fault has a test that failed first.

- **A roster tick between a newcomer's hello and its answer sent a whole room nobody needed.** The
  hello leaves every tab that is not to answer it owing the new host, and the answer, a hop behind,
  pays that. Paid "at the next `present`", a tick falling inside that hop sent the room first.
  Nothing was lost and every tab ended on the same room, but it happened on every live game. What
  is owed now waits `OWE_MS` (a second) from when it was owed, so `receive` takes the clock as
  `present` does (useLabRoom passes `performance.now()` to both), and `hostBehind` is that time
  rather than a flag.
- **What was owed could reach every player but a watching host, and then the table stopped.** Al
  hosts and watches. The room Bo's move made reaches Cy and is lost on its way to Bo; Al's toy
  remounts, and Bo, the host before him, answers from the room before it. Cy owes Al hers and pays
  it once, and that is lost on its way to Al alone. Both players were then ahead of their host, and
  nobody owed anybody: Cy's room said Al published it, so the late-copy rule read him as late. A
  quiet host says nothing, so every move was refused as made against a board that had changed.
  Before 58e46345 there was no repair to lose, and the first loss alone left Bo and Al on one board,
  so the game went on from it. **What shows a host it is behind is a move made against a board newer
  than its own:** the host refuses it, as before, and says `hello` again, which everybody answers as
  they would a newcomer's. A move against an older board is the ordinary race, a mover a state
  behind, and is still refused quietly.
- **The header said that should a newcomer's answer never come, whoever holds the room hands it
  on.** That is true of an answer that never went out. An answer that went out and was lost on its
  way to the newcomer alone left Cy, who heard it, owing nothing, and Bo, who sent it, with nothing
  more to do, so the newcomer hosted an empty board and refused every move. That stall is older
  than these branches: 8b4d87ea and origin/main stall the same way. The rule above covers it too,
  from the first move made against it, and the header now says which repair covers which case.
- **This section's lead said nothing on the wire changes**, and so did the 35-test line and the
  `present()` line. All three were true of d0546785 alone, and now say so; Left names the change.

Measured, 27 Nov 2026, 05:34–06:01 EST:

- **Red first.** On 58e46345's room.ts, 5 tests: the tick test (Cy's tick sent the game 0, 200 and
  999 ms after the hello), the lost-repair test (seqs 4, 5 and 5 after Cy's move, for good), the
  lost-answer test (Al still at seq 0), the move test in "somebody else's message" (no hello for a
  move at a newer seq), and "a host carrying on from a room that missed the last state", which now
  also asks that a look within `OWE_MS` of the debt sends nothing (it sent at once).
- **Mutations of room.ts, each made once and put back with its md5 checked, red counted over
  `src/lab/social`.** Every one went red. What is owed going at the next look again, 2; a move
  against a newer board refused quietly again, 3; a hello for every stale move, older ones too, 1;
  what is owed never paid, 4; a hello's debt timed from 0 rather than from when it was owed, 1; an
  older room's debt timed from 0, 1.
- **roomWire.test.ts's recording is byte for byte unchanged**, and room.test.ts's arrival counts
  hold: 3 sends for a higher id joining, 10 for a fresh toy filling.
- **The verification's own timed model**, 4,000 sessions a case: each link in order with a random
  hop, every tab's 5 s tick at a random phase, and the newcomer's `where` landing up to half a
  second either side of their toy mounting. Sessions that sent one room more than three:

  | Case                                    | 58e46345 | This fix | One relay, 58e46345 | One relay, this fix |
  | --------------------------------------- | -------- | -------- | ------------------- | ------------------- |
  | Bo joins Ann and Cy, hops 100–300 ms    | 228      | 59       | 162                 | 0                   |
  | the same, hops 30–80 ms                 | 86       | 34       | 47                  | 0                   |
  | with Dee watching too, hops 100–300 ms  | 452      | 137      | 320                 | 0                   |
  | Bo, the host, remounts, hops 100–300 ms | 244      | 83       | 165                 | 0                   |

  Every session left on the fix is the answer overtaking the hello at the tab that owes, which that
  model allows because every link has its own hop. "One relay" sends everything up to one server
  and down again in that server's order, over one ordered connection a tab, which is the shape of
  the call's Supabase broadcast: there the answer can overtake the hello only between two of
  Supabase's own servers. No session diverged in any column.

- **The dev call** (Playwright's headless Chromium, the dev server on :5401 with placeholder
  Supabase values, ids Al …0001, Bo …0002, Cy …0003; Bo and Cy dropped three discs, then Al
  arrived), 05:50–05:54 EST. The two runs of 26 Nov, 8 of 8: with Bo there, Bo alone handed Al the
  board, Cy sent nothing, and Cy's next disc landed on all three, published by Al; with Bo's `lab`
  messages stopped at his tab, Cy handed Al the board once, 8.9 s after his tab opened. And a third,
  for the lost answer: Al's tab dropped Bo's answer to his hello, and 7 s later Al still showed
  "Take a seat to play" with no discs. Cy pressed a column; Al said `hello` again, Bo answered, and
  Al showed the three discs. Cy's next disc landed on all three tabs, published by Al. 5 of 5. With
  the host's second hello taken out of room.ts on disk, Al stayed at no discs through both of Cy's
  presses, 3 of 5. Put back, md5 the same.
- **Gates on this tree, 05:55–06:01 EST:** `npm run typecheck`, `npm run lint` and `npm run build`
  passed. `npm run test` passed 408 files, 6,190 tests, 6 skipped: 58e46345's 6,186 and these 4.
  `node scripts/lab-move-bundle.mjs --check` passed with no rebuild, the bundle's md5 unchanged
  (3d2b8570…), because room.ts reaches lab-move as types only. `prettier --check` passed on every
  changed file. The built GpuLab chunk holds `hostBehind`, which 8b4d87ea's room.ts does not have.

### Left

- After the Pages deploy, Evan plays one move of Four in a row on a call (the plan's §8). That
  reaches the refactor and nothing the fixes change.
- ⚠️ **The fixes change what every live call game's clients send, and a call with everybody present
  never reaches the change.** One check by hand comes close: the friend with the lowest id on the
  call reloads the toy mid-game, and the next move lands on every tab. The others owe that friend
  the room from their hello until somebody's answer pays it, so nothing more should be sent. The
  room handed on for a debt, and the host's second hello, need a message lost on its way to one
  tab, which nobody can arrange on a real call. They were checked on the dev calls above and in
  room.test.ts. Nothing in this step reaches the relay or lab-move.
- **Older than these branches, in production now, and not fixed here:**
  - A host's state lost on its way to every player leaves the host ahead of everybody, and every
    move is refused as made against an older board. It mends at the next change only the host can
    make: a sit, a stand, a new game, or somebody arriving.
  - A host whose toy reopens and is handed an older room than the one it published is read as late
    by every tab holding the room it published, because the late-copy rule cannot tell a new
    session from a late copy. A sit, stand or new game it decides on the older room says nothing
    to them. A move made against the newer room now makes it ask again (the lost-repair test is
    this case).

## Step 2: a Supabase outage is not a refusal, and /health says which build is running

The relay changes coming next (a `lab:` room with a friends-only door) need three things that the
relay did not have. This step adds them. No client sends or reads anything new; the one thing a
member could notice is no longer being refused for a minute after a Supabase error.

### 1. "No" and "could not ask" are different answers

`verifyToken` cached every non-2xx from `/auth/v1/user` as a refusal for 60 s (`if (!r.ok)`). For an
expired token that is right: asking again cannot change the answer. For a 503 it is wrong: a
second of Supabase trouble refused that token for the next minute, to someone who had done nothing
wrong. A friends-only door built on that could not tell "these two are not friends" from "the
database did not answer", so one day it would tell two friends they are not friends.

`server/lib/supabaseAnswer.mjs` holds the decision by itself: `sureOf(status | error)` is `'yes'`
for a 2xx, `'no'` for a 401 or 403, and `'unsure'` for everything else (5xx, 429, any other status,
a network error, a timeout, no config). `'no'` is narrow on purpose: a 404 from an RPC is a function
that is not deployed, and a 400 is a request the relay built wrongly. Neither is a fact about the
person.

In ws-server.js, `tokenAnswer` and `standingAnswer` return that three-way answer, and
`verifyToken` and `inGoodStanding` are thin wrappers that every existing caller reads exactly as
before. The one behaviour change: **only a sure answer is cached.** Standing still caches only a 2xx,
because its cache is keyed by user and a 401 there is about the token in hand.

### 2. A deploy can be checked against the commit

Render keeps serving the previous build until a new one passes its health check, and from outside
the two look the same. `server/lib/buildStamp.mjs` hashes `ws-server.js` and every
`lib/*.mjs` that is not a test (12 hex characters of sha256, in name order). The relay computes it
once at start and `/health` now returns `{ ok: true, build }`. `scripts/relay-smoke.mjs --stamp`
computes the same thing from the working tree, or from a revision with `--ref`, through the same
functions; a test fails if the smoke or the relay ever grows its own hash.

`RELAY_URL=… node scripts/relay-smoke.mjs` waits up to 90 s (`--wait`) for `/health` to report that
stamp, saying what it sees meanwhile, then sends a park hello on a fresh `park:smoke-<random>` room
and expects `welcome, host, presence, settings` and nothing else. The stamp proves the code
answering is the merged code; the hello proves that code still boots into a working relay.

Not in the stamp: dependencies. `npm install` on Render may rewrite a lockfile in place, which would
make a correct deploy look wrong, so a dependency bump alone does not change the stamp.

`/relay-config` (admin only, as before) gains `rooms: { snake, park, bout }`: counts of open rooms,
never an id. A relay deploy ends every one of them, so this is the reading to take before merging a
relay change.

### 3. The frames of today's rooms, pinned

The next step restructures `hello` and `close`, which every Snake lobby, park and bout runs on.
`scripts/relay-frames.test.mjs` starts the real relay (no Supabase, `PORT=0`, a long heartbeat) and
records exactly what each socket hears when three people join a Snake room and a park, two join a
bout and a third is refused, and a guest and then the host leave. The recording was taken on
c37cc877. Some of it is odd and is pinned anyway (the creator hears `host` and `presence` twice; a
park is told Snake's board settings; an unvouched park socket hears `host`, `presence` and `over`):
changing any of that is a decision about live clients, not a side effect.

`scripts/relay-answers.test.mjs` runs the real relay against a loopback stand-in that answers only
the relay's three questions (`/auth/v1/user`, `is_suspended`, `is_admin`). It shows a 503 followed
by a retry letting the same token in, a 401 still kept for the minute (Supabase asked once),
`/health`'s build equal to the files' stamp, and `/relay-config` counting rooms, not sockets, and
refusing anyone who is not an admin.

`scripts/relay-harness.mjs` starts the relay for both. It passes only `PATH` through, so a shell's
`SUPABASE_URL` cannot leak in, and it ends the relay when its stdin closes, so a test runner that dies
without `afterAll` leaves nothing behind.

Also fixed: two comments said a "message limiter" counted frames per socket. There is no such
thing. There is a size cap on every frame and a window for each of chat, walk, boss, bstep and step.

### 4. A frame is refused at the size of the largest real message (added 26 Nov 2026)

The relay already gave `ws` a `maxPayload`, which refuses a frame on its declared length before
buffering it and closes that socket with 1009. It was `MAX_MSG_BYTES`, 32,768. What nobody had
asked is whether every frame a real client sends fits under it, so every sender was read: Snake
(`src/game/manager.tsx` through `src/game/net.ts`), the park (`src/park/room.ts`), a bout
(`src/pets/boutRoom.ts`), and the Lab frames of the next step (`lab {d, to}`, with `d` at most
4,096 UTF-8 bytes, so even a `d` made entirely of control characters, each escaped to six bytes, is
under 25 kB on the wire). The largest by far is Snake's `preview`, sent every tick: the whole board,
one `{x, y}` per snake cell and per apple. The apples box goes up to every free cell, so a full
board carries a point for every cell.

**At 32 KiB a real frame did not fit.** On the Huge board (48 × 48) with the apples box at its own
maximum, the first preview is over the cap, and the relay closed that player's socket with 1009 on
it. The player drops out of the room, and the most the client says is "Lobby offline — continuing
solo", which is not the reason. At the largest grid `sanitizeSettings` keeps (60), which every
honest client in a room plays once the host's settings say so, the preview is about 55 KiB.

**The cap is 64 KiB now**, in `server/lib/frameCap.mjs`, imported by the relay and by the stub,
with the derivation in its header. The length check inside `handleMessage` uses the same number and
so can never fire while `maxPayload` is set; it stays as the rule written where the message is read.
Every other kind is far smaller: a park creature or boss is held under `MAX_LOOK_BYTES` (12,000),
and a chat line under 300 characters.

**The stub's pipe is as wide as the real one.** It had no `maxPayload` (so `ws`'s 100 MiB default)
and no `error` listener on its sockets. With a cap and no listener, one oversized frame ended the
whole stub, because `ws` reports a frame past the cap as an `error` on that socket and nothing in
the stub caught it. It has both now.

**Every door that asks Supabase fails closed, and a test says so.**
`scripts/relay-fail-closed.test.mjs` runs two real relays, one against a loopback stand-in that
answers 5xx or never answers, and one with no Supabase configured. The park and bout door (token,
then standing), `/ice`'s TURN relay (token) and the admin gate (`is_admin`, as `/relay-config` asks
it) are each asked while Supabase cannot answer, three ways, and each refuses. A refused park socket
hears no roster, is told `members-only` when the window closes, and nothing it says reaches the
member who was let in. Each case also shows it asked the question it is about: a standing case
passes the token first, and a timeout case shows the stand-in heard the relay hang up. The same
stand-in lets a good token, a member in good standing and an admin through, so the refusals are not
a door that refuses everybody. `OUTBOUND_TIMEOUT_MS` and `PARK_VOUCH_MS` can be shortened by the
environment for that test and never lengthened: a shorter wait can only turn an answer into a
refusal.

`scripts/relay-frame-cap.test.mjs` builds the largest preview with the real engine at the largest
grid the relay keeps, sends it through the real relay, and then sends a frame of exactly the cap
and one byte more: the cap is read, one past it closes that socket with 1009, and the two left in
the room go on talking through a relay whose `/health` still answers.

Found, not fixed: `hostOfParkRoom` caches a failed lookup of a hosted park's owner as "no owner"
for the life of the process (`parkHosts` never expires), and its service client has no timeout. That
fails closed, since a scene from anyone but the owner is dropped, but one Supabase blip on a hosted
park's first scene leaves its real host unable to set the scene until the relay restarts. It is the
same mistake this step fixed for tokens, on a path the Lab does not use.

Measured, 26 Nov 2026:

- From the real engine with the apples box at its maximum, the first preview over five seeds was
  35,213–35,443 bytes at 48 × 48 and 55,449–55,639 at 60 × 60. A board with a point on every cell
  is 36,127 bytes at 48 and 56,743 at 60, with a 64-character name of three-byte characters. 64 KiB
  is 15% above the last.
- The stub on this tree, probed by hand: a frame of exactly the cap was forwarded; one past it
  closed that socket with 1009, the other socket stayed and a new one could open. With the new
  `error` listener taken out, the same frame ended the stub (exit 1) and dropped the other socket
  (1006).
- Mutations, each made once and put back:

  | Mutation                                                        | Red                                           |
  | --------------------------------------------------------------- | --------------------------------------------- |
  | the cap back to 32,768                                          | the largest-frame case                        |
  | `maxPayload` one byte short of the cap                          | the exact-cap case                            |
  | the handler's check as `>=`                                     | the exact-cap case                            |
  | no `maxPayload`                                                 | the one-past case                             |
  | no `error` listener on the relay's sockets                      | nothing: the process-wide backstop holds      |
  | no process-wide `uncaughtException` backstop                    | nothing: the socket's listener holds          |
  | both of the above                                               | the one-past case (the relay went down)       |
  | an unanswered token check let in as a provisional user          | 7 fail-closed cases (park, bout, /ice)        |
  | an unanswered standing check read as good standing (`!== 'no'`) | the 4 standing cases                          |
  | both of the above                                               | 13, the unconfigured park and bout among them |
  | the admin gate refusing only a definite no                      | the 3 admin cases                             |
  | the token check with no timeout                                 | the 3 token-timeout cases                     |
  | good standing never granted                                     | the whole file (the witness is never let in)  |
  | `is_admin` never true; `/ice` never giving the relay            | the admin control; the /ice control           |

### Measured, 23 Nov 2026

- A local relay on this commit's `server/` answered `curl :8080/health` with
  `{"ok":true,"build":"8c74a7df8917"}`, and `node scripts/relay-smoke.mjs --stamp` printed
  `8c74a7df8917`. The smoke against it (`RELAY_URL=ws://127.0.0.1:8080`) said ok, and the park
  hello heard `welcome, host, presence, settings`.
- The smoke failed, as it should, in three cases:
  - a newline appended to `lib/r2ops.mjs` with the relay not restarted: "build 8c74a7df8917, not
    this one yet";
  - c37cc877's relay: "an answer with no build in it";
  - nothing listening: "unreachable".
- The full suite passed: 400 files, 5,882 tests, 7 skipped. Both relay-process tests passed five
  runs in a row, and a vitest killed with SIGKILL mid-run left no relay behind.
- Mutations, each made once and put back:

  | Mutation                                               | Red                                         |
  | ------------------------------------------------------ | ------------------------------------------- |
  | an extra field on `welcome`                            | all 3 relay-frames cases                    |
  | a second `settings` frame on hello                     | all 3 relay-frames cases                    |
  | caching an `'unsure'` token answer (the old behaviour) | the 503 case                                |
  | never caching                                          | the 401 case                                |
  | parks counted as Snake                                 | the room-count case                         |
  | `/health` without `build`                              | the /health case                            |
  | the admin gate open                                    | the room-count case (200 where 403 was due) |
  | the stamp without its sort                             | the order case                              |
  | names and texts plainly concatenated                   | the name/text case                          |
  | only ws-server.js stamped                              | 4 buildStamp cases                          |
  | test files stamped                                     | the test-file case                          |
  | a copied hash in the smoke                             | the one-module check                        |
  | the smoke stamping other files                         | the smoke's run-and-compare                 |
  | a 5xx read as `'no'`                                   | the outage case                             |
  | every non-2xx read as `'no'` (the old `!r.ok`)         | 2 supabaseAnswer cases                      |

### Left

- **After merging, once Render's metrics show no live connections (Evan's rule, above):** run
  `RELAY_URL=<the relay> node scripts/relay-smoke.mjs --ref origin/main`. Nothing in this step
  touched the deployed relay.
- **Then Evan reads `/relay-config` once, as admin.** It shows whether `has.SUPABASE_URL` and
  `has.SUPABASE_ANON_KEY` are true. Its new `rooms` counts show whether anybody is mid-game before
  the next relay merge.

## Step 3: a Lab table room — friends only, opaque, and silent to anyone not let in

The relay gains one kind of room, `lab:` and 22 base64url characters: a random code that only the
people on one call are sent. Friends at a live table will send their game's messages through it.
**It ships dark.** No client opens one yet, so nothing a member does changes.

### The door, in one file

Every decision about a Lab room is in `server/lib/labDoor.mjs`, which is pure: what an id looks
like, which frames a room takes, how big and how fast they may be, what the door answers, and what
anyone hears. `ws-server.js` does the wiring, and so does the stub relay. Neither keeps a copy of
any rule.

The door asks three questions in order: is the token good, is the account in good standing, and is
the joiner friends with every account already let in. Each answer is `'yes'`, `'no'` or `'unsure'`
(step 2's `sureOf`). The verdict:

- a refused token, or a suspended account: `members-only` (never "suspended": the check exists to
  keep a suspended account out, not to announce a suspension to whoever holds the code);
- a definite `false` from `are_friends` with anybody present: `not-friends`;
- anything Supabase did not answer (a 5xx, a timeout, a NULL, a 401 on the friends call, no
  config): `door-unavailable`. The client will retry that one. It is the only way the door can
  avoid telling two friends they are not friends.

`are_friends` is asked pair by pair, as the joiner, with the joiner's own token, in parallel, for
every account let in except their own. `are_friends(me, me)` is false, so a person's second tab
would otherwise be refused from their own table. Definite answers are cached for a minute, keyed by
the pair.

### Two strangers arriving together

"A friend of everyone already in" can let in two people who are not friends with each other, if
both are checked against a room that does not yet hold the other. Two locks:

1. **A chain per room.** Admissions in one room run one at a time, so the second arrival is checked
   against a room the first is already in.
2. **The room is read when the answers arrive.** Anybody let in while the questions were on their
   way is asked about too, and the admission happens in the same turn as that last read.

Either lock alone keeps the race safe. Each has its own test that goes red without it, and the race
itself goes red only when both are removed.

### Silence

- An arrival hears `welcome {id}` and nothing else. The room hears nothing about it. A hello
  behaves the same whether or not the code is in use: it never answers `room-not-found` or
  `lab-full`, and nothing at a knock counts who is at the table (second review, below). The one
  exception is a relay already holding its 500 rooms, which answers a new code `too-many-rooms`
  and a used one `welcome` (Left, below).
- A Lab room accepts `auth` and `lab` and drops everything else before the relay's switch, every
  case of which broadcasts without asking who is listening (Snake's chat, `name`, `preview`…).
- Let in: the newcomer gets `labin {who: [{from, uid}]}` and the others get `lab-here {from, uid}`.
  Leaving: `lab-gone {from}`, to those let in, and only if the leaver had been let in. Account ids go
  only to people let in, who already see them on the call.
- A refusal is `error {code, message}` and a close. The socket is taken out of the room at once,
  not when the close completes.
- `list` never shows a Lab room. The debug log never prints one, and nothing logs an account id.
- A malformed `lab:` id is `bad-room` and becomes no room at all. Before this, it would have become
  a Snake room, listed in the lobby.

### Timers and limits

- **The silent-socket timer (12 s)** closes only a socket that never sent `auth`. A socket whose
  check is running, or queued behind somebody else's, is never closed by it: Supabase can be slow,
  and the chain means a friend can still be waiting when the timer fires.
- **One table per socket, for life.** The timer runs from a socket's one Lab hello. Any later
  hello to anywhere else is `one-table` and a close, so no hop can start the timer again (added 26
  Nov, below). **And only as its first room:** a socket that has been in a park, a bout or a Snake
  room is `one-table` at any `lab:` id, because it carries that room's timer and auth slot with it
  (second review, below).
- **The door's own deadline (40 s from the `auth` frame)** bounds such a socket instead, and ends
  in `door-unavailable`.
- **Per table:** 8 let in (`lab-full`, at the door, after the token and the standing). Nothing
  counts sockets at the hello and nothing makes way: a socket that never signs in is bounded by
  the 12 s timer, which nothing restarts, and the connection gate (second review, below).
- **Live tables:** at most 6 rooms with two different people let in. A seventh, opening or
  becoming live, gets `lab-busy`, given at the door, never at hello, so a full relay cannot be used
  to test whether a code exists. Rooms nobody was let into do not count, and nor do rooms holding
  one person, so neither strangers nor a member alone can fill the cap.
- **Per account:** 2 tables and 4 sockets at most, across the relay (`too-many-places`), counting
  every socket let in and every one still waiting at a door, from the moment it joins a room's
  chain. One past that is refused at once, never in its turn (added 26 Nov, below). A tab moving
  tables while its old link closes, and a phone beside a laptop, fit with room to spare.
- **`lab` frames:** a non-empty string of at most 4,096 UTF-8 bytes (measured in bytes, not
  `.length`). A `to` must name somebody let into this room, or the whole frame is refused rather
  than sent to everybody. Windows of 50 a second per socket, 50 per account wherever it sends
  from, 100 per room and 150 across all Lab rooms; anything over is dropped without a word. An
  account's window is kept until its last second is over, so closing and reopening does not reset
  it. A frame that would reach nobody but the sender's own tabs goes nowhere, and is dropped
  before any window is charged. `from` and `uid` are written by the relay.
- `LAB_VOUCH_MS` and `LAB_DOOR_MS` can shorten the two timers for a test, never lengthen them.

`/relay-config` (admin only) gains `rooms.lab` and `rooms.labLive`: counts, never an id.

### The stub

`scripts/park-stub-relay.mjs` gains Lab rooms that import `labDoor.mjs` and stub only Supabase's
three answers. A dev tab sends `stub-who {uid, friends}` in place of the session it has no token
for. Token and standing are then yes, and two people are friends only when each one's list names
the other. The real relay never hears `stub-who`: `kindAllowed` refuses it. `STUB_WAKE=ms` holds
every socket opened that long after start, as a free relay asleep does. `STUB_KILL_AT=ms` exits once,
as a deploy does. The stale comment about scenes is corrected: the real relay does drop a scene
from anybody but the park's owner.

`STUB_ASK=ms` makes every friends answer take that long, as a round trip to Supabase does (added 26
Nov, third review, below). At 0 every answer is ready in the turn it is asked, so a door there
never has two checks waiting: its queue cannot be seen at all, and nor can the bound on what one
account may have in it. The stub counts an account's waiting arrivals across tables the relay's way,
through the same `held`.

**A known difference: a Lab hello after a hello the relay refuses.** The first-room rule is
`helloAgain`'s third argument, "this socket is in another room". The stub passes `roomId !== null`
and the relay `!!joinedRoomId`, and each is true exactly when that server has welcomed the socket
into a room that is not a Lab table. They part because the stub welcomes every non-Lab hello, while
the relay refuses some and leaves the socket where it was: `room-not-found` without `create`,
`room-full`, `bout-full`, `too-many-rooms`. After one of those, the relay welcomes a Lab hello and
the stub says `one-table`, because by its own state the socket really is in a park. So no one-line
change to the argument is faithful; only teaching the stub the relay's refusals would be, and that
is outside the Lab door. It is older than this step: on main the stub already welcomes the hellos
the relay refuses. Measured with the confirmer's probe on b8d0f537 and on this commit's tree
(18:40–18:41 EST): a fresh socket and a socket in a room made with `create` agree; after
`room-not-found`, `room-full` and `bout-full` the relay said `welcome` and the stub `one-table`; at
`too-many-rooms` the relay refused the Lab hello as well, for its own reason.

### Tests

| File                               | Asks                                                                                                                                                                                                                                                                                                                                                                | Runs in              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `server/lib/labDoor.test.mjs`      | every rule directly; tests 2.6–2.14, the race in 8 resolution orders                                                                                                                                                                                                                                                                                                | `npm run test`       |
| `scripts/relay-frames.test.mjs`    | the real relay, no Supabase: a Lab arrival hears `welcome` alone, the room hears nothing, the timer's sentence and close; `bad-room`; `list`. The Snake, park and bout goldens are unchanged. A park's timer stays in the park when its socket moves (a relay of its own, `PARK_VOUCH_MS` 600)                                                                      | `npm run test`       |
| `scripts/relay-lab.test.mjs`       | the real relay against a loopback stand-in for Supabase: the wiring, case by case                                                                                                                                                                                                                                                                                   | `npm run test`       |
| `scripts/park-stub-relay.test.mjs` | the stub imports the door and keeps no copy; it refuses to start unasked; `STUB_WAKE`; friends meet, one-sided lists do not; silent sockets push nobody out; own tabs are no audience; a window outlives a reconnect; a park socket is `one-table` at a Lab id and its park hears `over`; with `STUB_ASK`, one account's knocks past its places are refused at once | `npm run test`       |
| `scripts/lab-door-probe.mjs`       | the real relay against a **real local Supabase**                                                                                                                                                                                                                                                                                                                    | by hand, below       |
| `scripts/relay-smoke.mjs`          | after a deploy: a token-less knock on a fresh table                                                                                                                                                                                                                                                                                                                 | by hand, after merge |

### The real door without production, 23 Nov 2026

`dockerd`, then the pinned CLI (2.122.0) on a scratch copy of `supabase/` with storage, realtime,
studio, analytics and edge_runtime disabled. GoTrue issued every session and PostgREST ran
`is_suspended` and `are_friends`. The cast: Ann–Bo and Ann–Cy friends, Bo–Cy not, Dee suspended,
Eve nobody's friend. The relay was this commit's, run with the local URL and anon key.

`scripts/lab-door-probe.mjs --then-stopped`: **28 of 28**. This commit's `server/` stamped as
`1bfe5ce9dd58` then; a local relay on it answered `/health` with that build, and `relay-smoke.mjs`
against it said ok, the Lab knock included (welcome alone, not listed, the sentence and a close at
12 s). Rebased on 26 Nov onto the frame cap (step 2's section 4), it stamps as `e880fa06a1e7`, and
the same smoke against a local relay on it said ok, the Lab knock included.

- Bo and Cy sent together against Ann alone: exactly one let in, the other `not-friends`.
- Ann and Bo met, each told of the other by account id, and each got the other's `lab`.
- Cy was refused `not-friends` while Bo was in, and Ann and Bo heard nothing.
- Second tabs for Ann and Bo, each on a second session, were let in.
- `to: Bo` reached both of Bo's sockets and neither of Ann's.
- Dee got `members-only` and never the word "suspended".
- A silent socket was closed at 12.0 s. A socket whose token and standing were each held 7 s by a
  forwarding proxy was not closed at 12 s, and was let in at 14.1 s. A friends call could not be
  held past 12 s, because the relay gives up on any fetch at 8 s. So the plan's "15 s delay on the
  friends call" became a hold on the two questions before it.
- With the stack stopped (`supabase stop`), Eve, who is not Ann's friend, joined Ann's table 1–2 s
  after her token and standing were checked, so the question that failed was the friends one. She
  was told `door-unavailable`. A session the relay had never seen got the same. Ann heard nothing.

Made red:

- With the friends check removed, 4 of 22 failed, the race letting both in ("in, in").
- With the friends call's failure read as a no, Eve was told `not-friends` with Supabase down (27 of
  28).

### Mutations, each made once and put back

| Mutation                                                            | Red                                                               |
| ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `isLabId` without anchors                                           | 1 (2.6)                                                           |
| `readLab` measuring `d.length`                                      | 1 (2.7)                                                           |
| the windows off by one (`<=`)                                       | 3 (2.8)                                                           |
| `unsure` read as a refusal of the person                            | 3 (2.10)                                                          |
| the timer closing every unvouched socket                            | 1 (2.11)                                                          |
| asking `are_friends(me, me)`                                        | 2 (2.12)                                                          |
| every Lab room counted toward the cap                               | 1 (2.13)                                                          |
| `chat` allowed                                                      | 1 (2.14)                                                          |
| no chain                                                            | 1, the chain's test                                               |
| the room read once, before the answers                              | 1, the re-read's test                                             |
| both of those                                                       | 10, the 8 race orders among them                                  |
| Lab hellos routed through today's path (the plan's mutation)        | 4 relay-frames cases                                              |
| `chat` let through to the shared switch                             | 1 relay-frames case                                               |
| relay: the timer closing a socket being checked                     | 2 relay-lab cases                                                 |
| relay: `to` ignored                                                 | 1                                                                 |
| relay: a 401 on `are_friends` read as no                            | 1                                                                 |
| relay: an unsure friends answer cached                              | 1                                                                 |
| relay: liveRoomsFull given nothing to count                         | 1                                                                 |
| relay: no 16-socket cap                                             | 1                                                                 |
| relay: no windows                                                   | 1                                                                 |
| relay: no deadline                                                  | 1                                                                 |
| relay: `pairsToAsk` keeping the joiner (asks `are_friends(me, me)`) | 4: every case with a second tab                                   |
| relay: a door (chain) per socket instead of per room                | 1, the race                                                       |
| relay: `from` taken from the frame                                  | 1                                                                 |
| relay: a socket not let in forwarding                               | 1                                                                 |
| stub: its own copy of the id rule                                   | 1                                                                 |
| stub: friends always yes / a one-sided list as friends              | 1 each                                                            |
| stub: `STUB_WAKE` ignored                                           | 1                                                                 |
| stub: no `PARK_STUB_RELAY` guard                                    | 1                                                                 |
| smoke: a relay without the Lab hello                                | exit 1, "heard welcome, host, host, presence, presence, settings" |

### The review's findings, each with a test that failed first (26 Nov 2026)

A security review of this step found three ways round the door's limits. Each was reproduced on
the step's tip (7bea327a) by a new case in `scripts/relay-lab.test.mjs`, against the real relay and
the stand-in, before anything was changed. All seven new cases were red there.

**1. A socket that never signed in could stay at a table forever.** Each hello made a new entry and
a new 12 s timer, and leaving cleared the old one. So a socket that hopped to any other id and back
inside the timer was never closed, and sixteen of them kept a table's friends out with `lab-full`.
On the tip the hopping socket was still open after three times the timer, and a friend knocking on
a table full of silent sockets was refused.

- A socket that has knocked on a Lab table goes nowhere else (`helloAgain`): the same id again is
  ignored, and anything else is `one-table` and a close. The timer belongs to the entry, and a
  socket has only one entry.
- At 16 sockets, a knock takes the place of the longest-silent socket (`crowdedOut`), so sockets
  nobody has let in can never shut out the people the table is for. A socket being checked never
  makes way: a slow Supabase must not turn into a refusal. **Withdrawn the same day:** "longest"
  is only longest among the silent, and the second review below pushed a friend out with it.

**2. One member with no friends could take the relay-wide limits.** A member alone at a table had
nobody to be checked against, so the friends question was trivially yes, and a room with anybody
let in counted as live. Six lone tables made every new table on the relay `lab-busy`. A frame was
charged to every window before the relay looked for anyone to send it to, so three lone members
sending to nobody filled the relay's 150 a second. On the tip, six lone members read as six live
tables, a third lone table was let in, and a real table's other player heard 0 of 20 moves
during the flood (1 of 20 when one account flooded from four tabs).

- A room is live only with two different people in it (`isLive`). The cap is asked when a room
  opens and again when it would become live.
- One account is let into 2 tables and 4 sockets at most (`placesFull`), asked before any friends
  question and again just before letting in, since other tables' doors do not queue behind this
  one's.
- A frame that reaches nobody is dropped before it is charged. One account has its own window of
  50 a second, a third of the relay's, wherever it sends from (`charge`). The second review below
  found both still open: a frame to the sender's own second tab reached somebody, and the window
  was forgotten with the account's last socket.

**3. A door check could finish for an entry that no longer existed.** Ann's check was running when
she hopped away and back. The check still found the same socket in the same room, so it let in her
OLD entry: the room was told `lab-here` about somebody who could neither send nor receive, the new
entry's timer was cleared, and when she left, nobody was told. Every await in the check now also
asks whether the room's entry is still the one it is answering for. The one-table rule stops the
hop as well, so either lock alone holds.

The reviewer's own scripts, re-run on the fixed relay with the production 12 s timer: 0 of 16
hopping sockets were still open after 40 s (it had been 16 of 16), and a friend at that table
heard `welcome` (it had been `lab-full`). The ghost was refused `one-table`, and the room heard
nothing. A lone member's third table was refused. During a flood the real table heard 20 of 20
moves (it had been 4 of 20), and a new table opened (it had been `lab-busy`).

Mutations, each made once and put back:

| Mutation                                           | Red                                                  |
| -------------------------------------------------- | ---------------------------------------------------- |
| a hello elsewhere allowed again                    | 1, the hop case                                      |
| no making way: a full table is `lab-full`          | 1, the silent-table case                             |
| a socket being checked may make way                | 2: the checking-table case and the pure rule         |
| the newest silent makes way, not the oldest        | 1, the pure rule                                     |
| a lone room counts as live                         | 6: the lone-tables case, the six-tables case, 4 pure |
| no per-account limit                               | 5: relay, stub, 3 pure                               |
| the table limit one too loose                      | 4: relay, stub, 2 pure                               |
| a frame to nobody charged                          | 1, the lone-flood case                               |
| no per-account window                              | 1, the one-account flood case                        |
| a refused frame charged anyway                     | 2: the one-account flood case and the pure rule      |
| no same-entry check                                | nothing: the one-table rule holds                    |
| no same-entry check, and a hello elsewhere allowed | 2: the hop case and the ghost case                   |

The real door (`dockerd`, the pinned CLI on the scratch copy, as above) gained three checks: a lone
member let in at two tables and told `too-many-places` at a third, and a socket that knocks on
another table while its token is held is told `one-table`, with its answers, when they arrive,
letting nobody in. `lab-door-probe.mjs --then-stopped`: **31 of 31**. With the one-table rule, the
same-entry check and the per-account limit all taken out, 22 of 25, the three new checks red: no
`too-many-places`, two welcomes where `one-table` was due, and Ann hearing `lab-here` twice.

### A second review's findings, each with a test that failed first (26 Nov 2026)

An independent review of the fixed step (8c97511d) made nine findings, and a verifier reproduced
each against the real relay with the production timers. They are seven holes: one report was T1
and T2 together, and SEC-5 was half of T3. Every one now has a case that
was red on 8c97511d: **16 of 99** across the pure file, `relay-lab`, the stub's and `relay-frames`.
All 99 pass after. **No new error code:** the client still words the same eight.

**1. Making way was itself the hole (SEC-1, SEC-2).** At 16 sockets a knock pushed out the socket
silent longest, and that is only longest among the silent. A stranger with the code and no account
kept a table at sixteen with sockets that never spoke. When a friend knocked, one of them was pushed
out, which told the stranger somebody had arrived. Fifteen hellos that landed before the friend's
`auth` made the friend the oldest silent socket, so he was told `lab-full` ("eight people
connected", with two there) on every attempt. The same rule counted heads: twenty knocks at a code
nobody used pushed out 4 of the stranger's own sockets, and 7 at a table with three sockets let in.

- The hello counts nothing and nothing makes way. `crowdedOut` and the 16-socket cap are gone.
  The door's eight, after the token and the standing, is the only count at a table, so only the
  door says `lab-full`. The cap bounded nothing the relay pays for: a code costs nothing to mint,
  so those sockets go to another table. A socket that never signs in is bounded by the 12 s
  timer, which nothing restarts, and by the connection gate (30 a minute per address, 240 in all).
  **That was not so** (third review, below): the cap also held a room's chain of door checks to
  about fourteen, and without it one account queued 390 at one table.
- The review suggested a floor instead: only a socket silent for 6 s may make way, and otherwise
  the knock is refused. Tried as a mutation, it turned the same four cases red, and in the burst
  case it was the friend's own knock that got no welcome. Sixteen fresh silent sockets, renewed
  every 6 s, would turn every friend away, which is the hole the first review closed.
- The cases: a friend's welcome, then fifteen knocks, then his `auth`: he is let in and nobody is
  told `lab-full`; on 8c97511d he was pushed out. Twenty fresh silent sockets and a friend: let in,
  and nobody makes way. A stranger's twenty knocks hear the same at a used code and an unused one.
  Beside sixteen sockets being checked, a seventeenth is welcomed. The stub has the silent-table
  case too.

**2. One person's own tabs were an audience (SEC-3).** A frame that reached only the sender's second
tab had reached somebody, so it was charged. Three members, each alone at a table with two tabs,
filled the relay's 150 a second between their own tabs. On 8c97511d the real table's other player
heard 2 of 20 moves (0 of 20 on the first run).

- A frame goes nowhere and costs nothing unless it reaches somebody else (`reachesAnother`). One
  that does reach somebody still goes to the sender's other tabs too.
- The case "one account cannot take the relay's window" flooded only between one account's own
  tabs, so this fix would have left it testing nothing. The verifier showed it staying green with
  the per-account window removed. It now floods to two friends at two live tables, and goes red
  without the window.
- This closes the route, not what it led to. Three accounts that each reach somebody else are
  charged, as they should be, and still fill the 150. The verification below measured it, and it
  stays open (Left).

**3. An account's window was forgotten while it was still full (SEC-4).** It went with the account's
last socket. So fifty frames, a close, a new socket (let in at once, from the caches) and fifty
more inside the same second got 100 frames to the peer. A window is now forgotten only once its
last second is over (`forgetSpent`, on a leave and on the heartbeat), and the peer hears 50.

**4. A park's state followed its socket into a Lab table (T1, T2).** Two pieces of it:

- The park's members-only timer belongs to the connection, and leaving a room never cleared it.
  A socket let in at a Lab table was told "The park is for people with an account on the site"
  12 s after its park hello, and stayed in.
- The socket's one auth slot also belongs to the connection. A Lab `auth` sent while a park `auth`
  was still on its way was dropped unasked, and the silent-socket timer closed a good token as
  `members-only`.

The fixes:

- A Lab table is now a socket's first room as well as its only one. From any other room, a
  `lab:` id is `one-table` and a close (`helloAgain`'s third argument). An honest client opens a
  link per table visit (`NetClient.connect`), so it never meets this.
- Leaving a room clears the park's timer. That half is older than the Lab: on main, a socket that
  walked from a park into a Snake room was told the park's sentence there, and one that walked
  into the next park was told it twice. No shipped client moves a socket between rooms, so nobody
  has seen it.

**5. The stub kept a park socket in its park (SEC-5, T3).** A park socket that knocked on a Lab
table kept hearing the park's `walk` and `look` at the table. A refused one was never taken out of
the park: no `over`, and every later roster still named it. The stub now has the first-room rule
through the same `helloAgain`. Its `labRefuse` forgets only a Lab room, so the close tells the park
`over` and `presence`, as the relay's does.

Mutations, each made once and put back by checksum:

| Mutation                                                      | Red (of 99)                                                |
| ------------------------------------------------------------- | ---------------------------------------------------------- |
| 8c97511d's 16-socket cap and making way, put back             | 4: fresh fill, the burst, the head count, the checked ones |
| the review's floor in its place (silent half the timer first) | the same 4, with the friend's own knock never welcomed     |
| leaving a room keeps the park's timer                         | 1, the relay-frames hop                                    |
| relay: the hello not told the socket is in another room       | 2, both relay-lab hop cases                                |
| stub: the same                                                | 1, the stub's hop                                          |
| `helloAgain` ignoring it                                      | 4: relay 2, stub 1, pure 1                                 |
| stub: `labRefuse` forgetting the park                         | 1, the stub's hop (no `over`)                              |
| relay: a frame to one's own tabs charged and sent             | 1, the lone-tabs flood                                     |
| stub: the same                                                | 1                                                          |
| `reachesAnother` true for anybody at all                      | 3: relay, stub, pure                                       |
| relay: the window forgotten with the account's last socket    | 1, the reconnect case                                      |
| stub: the same                                                | 1                                                          |
| `forgetSpent` forgetting every window                         | 3: relay, stub, pure                                       |
| relay: no per-account window                                  | 2: the one-account flood, the reconnect case               |
| stub: the 16-socket cap and making way, put back              | 1, the stub's silent table                                 |

The real door, run as above (`dockerd`, then the pinned CLI 2.122.0 on the scratch copy):
`lab-door-probe.mjs --then-stopped` gave **31 of 31** on this tree. The stack was stopped at its
prompt and its volume kept. The probe sends only Lab hellos, and none of these fixes changes what
it asks, so it shows that nothing else moved. The new cases are the stand-in's. This tree's
`server/` stamps as `84892a068aac`; 8c97511d's was `fa9497ce5d8d`.

**What the verification of this fix found (26 Nov 2026).** An independent verification of this fix
on 96a85568 (main merged into 4c7904b4; the merge left `server/` alone) confirmed one defect. It is
minor, and it is not new: it is the Left item "150 a second across the relay is three accounts'
worth". `reachesAnother` closes the own-tabs route. An account that reaches a friend let in at its
table, silent or not, is charged honestly, so three such accounts fill the window as before. The
verifier's probe, copied and run again here on 96a85568's `server/` at 17:59–18:00 EST, agrees:

| While this floods, Ann sends Bo 20 moves at another live table    | Bo heard                |
| ----------------------------------------------------------------- | ----------------------- |
| nothing                                                           | 20                      |
| one account, then two, each with a silent friend at its own table | 20, 20                  |
| three such accounts, three again, and four                        | 1, 1, 1                 |
| three accounts friends with each other, at two live tables        | 1                       |
| SEC-3's own shape: three lone accounts, two tabs each             | 20, none of theirs sent |
| three accounts with silent friends, at an honest 40 a second      | 20                      |
| four honest players at 40 a second, at two live tables            | 16                      |

Bo heard all 20 again within 1.2 s of every flood stopping. The verifier also found a Snake room's
chat untouched during a three-account flood (5 of 5), since only `labForward` charges this window,
and 8c97511d giving the same 1 of 20: the fix made nothing worse.

**No code is changed for it, because everything that closes it is a choice about cost.** Three
copies of the relay, identical but for `LAB.globalHz`, run side by side at 17:58–17:59 EST:

| Bo heard, of Ann's 20, while…                              | 150 (now) | 300 | 600 (`rooms × roomHz`) |
| ---------------------------------------------------------- | --------- | --- | ---------------------- |
| three accounts flood, each with a silent friend            | 1         | 20  | 20                     |
| four such accounts                                         | 1         | 20  | 20                     |
| three accounts friends with each other, at two tables      | 1         | 20  | 20                     |
| two tables of two friends both flooding (four accounts)    | 1         | 20  | 20                     |
| three such tables (six accounts)                           | 1         | 1   | 20                     |
| five such tables (ten accounts: with Ann's, the relay's 6) | 0         | 1   | 20                     |
| four honest players at 40 a second, at two tables          | 16        | 20  | 20                     |
| ten honest players at 40 a second, at five tables          | 4         | 13  | 20                     |

Raising it to 300 only raises how many accounts it takes. At `rooms × roomHz` it never binds
before a room's own window does, so no table's moves depend on another's (the five flooding tables
got 469 a second through, and Ann's table all of hers), and the relay may forward four times what
it may now. Sharing the same 150 out more fairly was reasoned through, not built: a relay that drops
rather than queues can keep a quiet table's moves only by holding room back for them before they
arrive, which is room a busy honest table could otherwise have had. And four accounts at the
client's own forty a second look exactly like the four honest players above. Waiting costs nobody
anything: no client opens a Lab table until step 5, and step 5's client is the first thing that
sends at real rates, which is what the number should be set against. The comment beside
`globalHz` says this now, so the 150 is no longer unexplained. That comment is the commit's only
change to `server/`, which now stamps as `10b53e746d25` (it was `84892a068aac`).

### A third review's finding: one account could keep a friend at the door (26 Nov 2026)

An independent review of b8d0f537 found, and a second agent reproduced with its own probe, that one
member's account could hold a friend at the door until the door gave up on him. Every socket that
sends `auth` waits its turn in the room's chain, and `placesFull` counted only sockets already let
in, so nothing bounded how many checks one account had waiting. A check costs a Supabase round trip
whenever its friends answer is unsure, and an unsure is never cached. One way to make every answer
unsure: the relay kept a token's yes for its minute whatever the token's own `exp`, so a token said
yes to in its last minute, and then expired, made every `are_friends` a 401. The 16-socket cap the
second review removed had held the chain to about fourteen checks, which is what the cap bounded
after all.

Reproduced first, with copies of both agents' probes run against the real relay (PORT=0, a
loopback stand-in for Supabase, the production 12 s and 40 s timers): b8d0f537 at 18:22–18:39 EST,
this commit's tree at 18:36–18:40 EST. 390 sockets of one account knock at Ann and Bo's table, all
at once, and then their friend Cy does; every `are_friends` takes 120 ms.

| Probe                                      | b8d0f537: Cy                    | calls | This commit: Cy                 | calls | The 390, now                                |
| ------------------------------------------ | ------------------------------- | ----- | ------------------------------- | ----- | ------------------------------------------- |
| the reporter's, a token cached, then dead  | `door-unavailable` at 40,053 ms | 647   | let in at 515 ms                | 9     | 387 `too-many-places`, 3 `door-unavailable` |
| the reporter's, a good token (control)     | let in at 1,250 ms              | 5     | let in at 883 ms                | 5     | 386 `too-many-places`, 4 `not-friends`      |
| the confirmer's, a token cached, then dead | `door-unavailable` at 40,056 ms | 642   | let in at 617 ms                | 10    | 386 `too-many-places`, 4 `door-unavailable` |
| the confirmer's, a good token (control)    | let in at 331 ms                | 4     | let in at 248 ms                | 4     | 386 `too-many-places`, 4 `not-friends`      |
| the reporter's, with a JWT whose exp ends  | `door-unavailable` at 40,059 ms | 641   | let in at 615 ms                | 3     | 390 `members-only`                          |
| 390 accounts, one socket each              | `door-unavailable` at 40,420 ms | 634   | `door-unavailable` at 40,218 ms | 634   | unchanged, and why is in Left               |

"calls" is `are_friends` calls during the attack. The JWT row is the reporter's probe copied with
the token made a JWT, since the reporter's own `tok-M~<ms>` has no `exp` that anything could read.

**1. A socket waiting at the door is one of its account's places.** `doorFor` counts an arrival as
it joins the chain, against the account's 4 sockets and 2 tables across the relay: its `held` is
the sockets let in plus every arrival queued or being checked, and `heldElsewhere` reads every
other room's. Past them the arrival is told `too-many-places` at once, never in its turn. That is
the existing code and sentence, so the client has nothing new to word, and a refusal is the same
two frames as before: the sentence, then a close.

- An arrival gives its place back in the same turn as it is let in, refused, or found gone, so no
  socket is ever counted twice. One that has gone holds nothing even before its turn comes, so a
  tab reloaded while the door is slow is not refused for the socket it replaced.
- The count starts at the chain, not at the token: the token and standing questions are asked side
  by side, and only the chain makes anybody wait for anybody else.
- Per account, not per table, because a cap on a table's queue is a count somebody else can fill,
  which is the second review's making-way hole again. An account is the one thing here that a
  stranger cannot make more of.
- An honest member never meets it: four tabs at two tables, all knocking while the door is slow,
  are all let in, and so is a tab reloaded while it waited. What changes is when an account over
  its places hears so: a non-friend's sockets past four used to hear `not-friends` in turn, and now
  hear `too-many-places` at once, which is also true.
- A knock that will fail still holds its place while its answer is out, so for the length of one
  check an account can be refused a place b8d0f537 would have given. Measured by the independent
  verify (19:23 EST, Eve's answer held 800 ms): Ann with three tabs let in at one table and a
  fourth knocking at a table where Eve is no friend had a fifth tab refused at once, where
  b8d0f537 let it in; the same with one tab let in and a knock at a second table, for a third
  table. Each time Ann was over 4 sockets or 2 tables counting the knock, and the refusal lasts
  only until that knock is answered.
- Cy's wait is now bounded by the places of the accounts ahead of him: at most five checks each,
  the four an account may hold plus one already in its round trip whose socket was closed to free
  a place (the independent verify, 19:12 EST: with 1 s answers Cy waited 5,862 ms, 5.9 round
  trips, behind one account's 5 checks). Thirty-two accounts with one socket each, as many places
  as eight members have between them, held him 4,214 ms (18:40 EST).

**2. A token's yes is kept no longer than the token lives.** `keepYes`
(`server/lib/supabaseAnswer.mjs`, pure) is the minute, or `exp` minus now if the token carries a
readable `exp` that comes sooner. A refusal is still kept the minute, and what `verifyToken` and
`tokenAnswer` return is unchanged. The `exp` is read, never believed: it can only make the relay
forget sooner. Each fix closes the dead-token route alone. Two copies of this commit's relay, each
with one fix taken out, at 18:39–18:40 EST: with only the bound, Cy was let in at 524 ms (the
reporter's token) and 530 ms (the JWT); with only the cap, at 531 ms with the JWT, and
`door-unavailable` at 40,060 ms with the reporter's token, which has no `exp` to read. A real
session is a JWT, but `are_friends` can be unsure for other reasons, so the bound is the fix and the
cap is the second lock.

**3. The stub** passes `heldElsewhere` and gains `STUB_ASK` (its section, above). The confirmed nit
about its first-room rule is recorded there as a known difference: no faithful one-line change
exists.

Fourteen new cases. Thirteen were red on b8d0f537 before any code changed: five in
`labDoor.test.mjs` (the honest member's among them only because `held` did not exist yet), four for
`keepYes` in `supabaseAnswer.test.mjs`, three in `relay-lab` and the stub's. The relay-lab three are the attack at test scale (twenty knocks, 450 ms an answer, a 2 s
door: "Cy let in, not door-unavailable"), the same across three tables, and a token outliving its
`exp`. The fourteenth, the honest member at the relay, guards against too tight a bound and passed
on b8d0f537, which had none. On this tree, 109 of 109 pass across the four Lab files and 9 of 9 in
`supabaseAnswer.test.mjs`.

Mutations, each made once and put back by checksum:

| Mutation (of 118 across the five files)                   | Red                                                     |
| --------------------------------------------------------- | ------------------------------------------------------- |
| no count at the door                                      | 5: relay's attack and across tables, the stub's, 2 pure |
| relay: no `heldElsewhere`                                 | 2: the relay's attack and across tables                 |
| stub: no `heldElsewhere`                                  | 1, the stub's                                           |
| an arrival that has gone still holds its place            | 2: the relay's reloaded tab, the pure rule              |
| the place given back a turn late, on the returned promise | 2: the pure same-turn rule, and the chain's race test   |
| relay: a yes kept the minute whatever its `exp`           | 1, the token case                                       |
| `keepYes` ignoring `exp`                                  | 3: the token case and 2 pure                            |
| relay: a yes never kept                                   | 1, the token case (its second tab asked again)          |

This commit's `server/` stamps as `95b64098f20b` (b8d0f537's was `10b53e746d25`). The tree measured
above differed from it only by a comment; the first four probes, re-run on it at 18:51 EST, let Cy
in at 555, 876, 621 and 250 ms, with the same outcomes for the 390.

### Left

- **After merging, once Render's metrics show no live connections (Evan's rule, above):** run
  `RELAY_URL=<the relay> node scripts/relay-smoke.mjs --ref origin/main`. It now also knocks on a
  fresh table without a token: it expects `welcome` alone, no listing, then at 12 s "A Lab table is
  for friends on a call, signed in on the site." and a close. That sentence is in no older relay.
  It is skipped automatically for a ref whose `server/` has no `labDoor.mjs`.
  **27 Nov:** the first live run heard the sentence on time and never the close — Render's proxy
  drops the relay's close frame (the socket ended 1006 at 32 s). Behind Render (told by the
  `x-render-origin-server` header on `/health`) a missing close is now a WARN; a local run still
  requires the 1008, and the sentence must land within 1 s early / 4 s late of the timer, measured
  from the `welcome`. The rules are in `scripts/relay-smoke-lab.mjs`, with tests.
- **Then Evan reads `/relay-config` himself (his answer, above).** If `has.SUPABASE_URL` or
  `has.SUPABASE_ANON_KEY` is false on Render, every Lab table answers `door-unavailable`, which is
  safe and useless (P2).
- **The probe runs by hand, not in CI.** It needs Docker and the local stack. The stand-in test
  (`relay-lab.test.mjs`) is the CI copy of the wiring, and it is only as faithful as its stand-in.
- **A friendship ended inside the minute** is still believed for the rest of it (the cache), and a
  friendship ended mid-game is never re-checked, as a park's vouching is not.
- **The client (step 5) has two more codes to word:** `too-many-places`, and `one-table`, which an
  honest client never meets because it opens a link per table visit. The second review adds none:
  `one-table` now also answers a socket that has been in another room, and only the door says
  `lab-full`, at eight let in.
- **No per-address cap.** Sockets that never sign in are bounded by the connection gate (30 a
  minute per address) and a clock nothing can restart. A signed-in person is bounded by their
  account: 4 sockets, let in or waiting at a door, across the relay. Until 26 Nov only sockets let
  in were counted, and that was not a bound: one account queued 390 checks at one table and a
  friend behind them waited the door's full 40 s; counting the waiting ones, the same 390 held him
  515 ms (third review, above). An address is shared by a household, and a cap on it would refuse
  the people at one house on one call while bounding nothing the account's limits do not.
- **The bound is per account, so it is no bound on accounts.** 390 accounts with one socket each
  still hold a friend past the 40 s, on this tree (40,218 ms) as on b8d0f537 (40,420 ms). Sign-up
  is invite-only and there are about eight members; thirty-two one-socket accounts held him
  4,214 ms. Without the chain there would be no queue at all, since the re-read alone keeps the
  race safe, but the chain is one of the door's two locks and is kept on purpose. If members ever
  number in the hundreds, that is the question to reopen.
- **A second hello to the park a socket is already in leaves a second park timer running.**
  `leavePrevious` returns at once for the room the socket is in, so the timer it clears is never
  cleared, and the new hello sets another beside it. It is older than this branch: on main the
  same hello skipped the same step and no leaving cleared the timer at all. No client sends a
  second hello to a room it is in, and park behaviour is not changed here.
- **150 a second across the relay is three accounts' worth, and it is still open.** Any three
  accounts that each reach somebody else at a live table fill it, and so do four honest players
  near the forty a second the client's outbox stays under. A table none of them is at loses its
  moves while they do: 0 to 2 of 20 heard against three accounts, and 4 to 7 of 20 lost to four
  honest players, in every run so far. The second review's verification (above) has the
  measurements, with what 300 and 600 change, and why splitting the same 150 more fairly only moves
  the loss. What the relay may cost is Evan's call, best asked with step 5's client, the first thing
  that sends at real rates. Nothing is at stake before then, because no client opens a Lab table.
- **At the relay's 500 rooms, a hello is an existence test.** A new code gets `too-many-rooms`
  and a used one gets `welcome` (measured with `MAX_ROOMS=3`). Getting there means holding 500
  rooms open, which locks Snake and the park out as well. This is older than the Lab and is not
  changed here.
- **The stub's park-to-park hop** still leaves a ghost in the first park, as it does on main, where
  the relay's `leavePrevious` removes it. No client moves a socket between rooms, and it is outside
  the Lab door.
