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
