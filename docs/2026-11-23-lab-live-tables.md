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
newcomer. Nothing that goes on the wire changes, and the rest of this section is how that is known
rather than believed. No client, relay or edge function behaves differently.

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

- room.test.ts and roomModes.test.ts are unchanged (same md5 as 8b4d87ea) and green: 35 tests.
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
    older. `present()` is untouched here, so this is how the code behaved before too; it costs one
    message.
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

### Left

- After the Pages deploy, Evan plays one move of Four in a row on a call (the plan's §8). Nothing in
  this step reaches the relay or lab-move.

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

## Step 4: four chairs at a call table, a captain and teams

The pure half of a live table: who sits where, who sets the table and who writes it, and every
sentence the table will say. `src/lab/live/chairs.ts` is the table and `src/lab/live/liveWords.ts`
its words, each with a test file. Nothing imports either yet, so nothing goes on the wire or on
screen: step 6 wires the table to the call's `live` party kind and lays the words out. There is
nothing to see on a dev call.

### The table, as the plan has it

`chairs.ts` is built the way room.ts is, a value that every input turns into the next value and
the messages to send, so `chairs.test.ts` can play whole tables over room.test.ts's in-memory
network with a call roster beside it.

- **Three roles, never one election.** The host writes the table and is `lowest(me, present)`,
  imported from room.ts with `newer` and `answersHello`, so a two-seat room and a four-chair table
  can never pick different hosts from the same people. The host may be watching. The captain sets
  the table and starts each round, and is derived: of the seated people here, whoever sat
  earliest. That is Evan's answer above, whoever sat down first. The referee is step 5's.
- **Requests:** `sit {chair}` and `stand` from anyone; `cpu`, `swap`, `mode`, `opts` and
  `start {n}` from the captain only; `over {n, result}` from a starter of round `n`, the first
  report counting. Mid-round nothing is taken but `over` and, where the toy says so (Spades), a
  watcher sitting in a computer's chair.
- **Host rules:** a change goes out at most once a second; a hello is answered as room.ts answers
  it; the code is minted on the first state, as a state of its own; it is re-minted between rounds
  when anybody who heard it has left the call; a chair whose person has been gone `HOLD_MS` is
  freed while no round is on.
- **The code** is 16 bytes from `crypto.getRandomValues` as 22 base64url characters, checked
  against Node's own `Buffer.toString('base64url')` on four byte patterns.

### Where it differs from the plan, and why

1. **`since` is a seq, not a clock.** The captain is whoever sat first, and the host that seated
   somebody is rarely the host that compares them later. Each tab's clock starts at its own zero,
   while the seq is the one counter every host carries on from the last.
2. **`knew` is everyone who has heard the code, not who was on the call when it was minted.** The
   plan's rule lets somebody who joins the call after the mint hear the code in the next state and
   leave holding it, with no re-mint. So the host folds its call roster into `knew` whenever a
   state carrying the code goes out. The draft of this step folded only states the host itself
   sent, which left one way through: a newcomer with the lowest id is host the moment they arrive
   and is handed the table by the host before them, so the state that told them the code was not
   the host's. They now fold it on hearing it, at once rather than after the pace, because a
   newcomer who hangs up within the second would otherwise take the code with them unrecorded.
   That costs a lower-id arrival who has just joined the call one state more than room.ts (4.9).
3. **A chair's id is not checked against the reader's roster**, which §3.1 asked for. A seated
   friend who leaves the call keeps their chair for `HOLD_MS`, or to the end of a round that is on,
   and §1.2 step 13 says the table shows it. Refusing every state that names somebody off my call
   would refuse every state in exactly that window, the round's end included. Who is listened to
   is still checked: only `from` on my roster.
4. **`swap` names who is moved.** `swap {a, b}` alone is undone by its own repeat, and moves the
   wrong person when it lands after the table has changed. It carries `id`, the person the captain
   chose ("Choose who to move"), and is refused unless that person is still in chair `a`. It is
   room.ts's `at` on a move, said about the one person the request is about.
5. **`rules.team` reads the table.** Stackfall together is its people against one computer, which
   a chair number alone cannot say. `teamOf`'s default is every chair its own in versus, 0 and 2
   against 1 and 3 together at four, and one side together at two.
6. **Only changes wait for the pace.** An arrival is two states in the plan's own count (§3.6),
   the announcement and the hello's answer, and a newcomer handed nothing cannot sit.
7. **The words use "their" and "they're"** where the plan wrote "his" and "he's" about Bo. Nobody's
   pronouns are known here.
8. **A name this browser never had is "a friend"**, not busWords' "a friend who left": at a table
   it can also be somebody whose `where` has not reached this browser yet, named in a state that
   has. "A friend" is true either way.
9. **A chair's ● or ◌ is apart from its name**, so the table can hide the mark from a screen reader
   (which reads "black circle") and say "connecting" instead. **The Move button carries both
   forms** the plan gives, "Move Bo here" on its face and "Move Bo to North" for a screen reader.

Three more, from the review below:

10. **A state names who published it, `by`.** §3.1's state body gains one field, an id. A tab that
    hands a table on sends the host's state as it was, so every tab breaks a tie between two hosts
    on the same id. Who is listened to is still the sender, checked against my roster.
11. **At one seq, a state further into its rounds wins before the lower publisher does.** §2.4
    says the lower sender's state wins. It still does between two tables at the same point in
    their rounds; between a round started and the same table not started, the start wins.
12. **A tab that is not host sends a state when its host lacks the table it holds**, a second on.
    §3.1 has states sent by the host alone. This is bookkeeping, like a hello's answer.

### Measured, 26 Nov 2026

- **Tests:** `chairs.test.ts` holds 151 over room.test.ts's in-memory network with a call roster;
  `liveWords.test.ts` holds 25, each of them an exact text. Expectations come from the world's
  shape, never from the code's sums: 4.6 asserts three roles held by three different people on
  every tab; 4.8's fixture has every field away from its default (seq 41, four chairs mixed, `since`
  out of chair order, `cpu` 2, together, target 500, round 3 over with a result), checked against a
  fresh table field by field before it is used; the code is checked against Node's `Buffer`.
- **Mutations of chairs.ts and liveWords.ts, 104 in all**, each made once and put back, with both
  files' md5 checked after every one, red counted over `src/lab/live`. Every one went red. The
  plan's rows, with the mutation each names:

  | Row | Mutation                                      | Red                                                |
  | --- | --------------------------------------------- | -------------------------------------------------- |
  | 4.1 | `receive` accepts an older seq                | 3: 4.1, and 4.5's two lower-newcomer tests         |
  | 4.2 | each of readChairs' 27 checks dropped in turn | each turns its own row red (1–5 tests apiece)      |
  | 4.3 | skip the captain check                        | 6: 5 in 4.3, 1 in 4.6                              |
  | 4.4 | reset `since` on a swap                       | 1: 4.4's swaps (the captain changes)               |
  | 4.5 | compare by code                               | 2: both two-host tests in 4.5                      |
  | 4.6 | captain = `lowest` of the seated              | 44, across ten of chairs.test.ts's describe blocks |
  | 4.7 | re-mint mid-round                             | 2 in 4.7                                           |
  | 4.8 | each of wireOf's 12 fields dropped in turn    | 46 each (58 for `chairs`)                          |
  | 4.8 | each of readChairs' 13 fields defaulted       | 2 to 42 each, 4.8's round trip among them          |
  | 4.9 | every tab answers every hello                 | 4: 3 in 4.9, 1 in 4.2                              |
  | 4.9 | only the host answers a hello                 | 4: 4.5's two lower-newcomer tests, 4.7's Bo, 4.9   |

  And the mutations beyond the plan's, for the rules this file adds or the plan left untested:

  | Mutation                                                    | Red                             |
  | ----------------------------------------------------------- | ------------------------------- |
  | `swap` without who is moved                                 | 3: 4.1's repeat, 4.2, 4.4       |
  | the first mint folded into the first change                 | 1: 4.5                          |
  | `knew` only those on the call at the mint (the plan's rule) | 2 in 4.7                        |
  | no fold on hearing a state                                  | 2: 4.7's Bo and 4.9             |
  | the fold on hearing waits for the pace                      | 2: 4.7's Bo and 4.9             |
  | never re-mint                                               | 5 in 4.7                        |
  | the captain counts somebody gone from the toy               | 1: 4.6                          |
  | start from anybody seated                                   | 6: 5 in 4.3, 1 in 4.6           |
  | the captain may change the table mid-round                  | 4 in 4.3                        |
  | a player stands mid-round; anybody sits mid-round           | 2 each in 4.3                   |
  | a computer's chair taken mid-round on every toy             | 1 in 4.3                        |
  | over from anybody; over while the round is not on           | 1 each in 4.3                   |
  | wireOf writes a chair's `since` as 0                        | 25, 4.8's round trip among them |
  | the request reader, field by field (15 mutations)           | 1 to 3 each, in 4.2 (and 4.6)   |
  | no pacing; a hello waits for the pace                       | 3; 5                            |
  | a chair freed at once / mid-round / never                   | 5; 1; 2                         |
  | an 8-byte code; base64 rather than base64url                | 45; 34                          |
  | teams by chair together; a toy's own teams ignored          | 2; 1                            |
  | five changes to the words                                   | 1 each, the sentence's test     |

- **Four checks survived the first passes, and each was a gap in the fixtures, not the code.**
  Each now has a row and goes red:
  - `isId` on a swap's `id`, and `n >= 1` on a start, are also refused by the host's rules, so no
    host-side test could see them go. They are what stops this tab _sending_ a malformed request
    through `act`, and now every 4.2 request row asks that too, plus a swap naming nobody (`null`)
    from an empty chair.
  - A chair's shape (`[id, since, cpu]`): a two-field chair was already refused by the `cpu`
    check, so dropping the shape check changed nothing the fixtures held. A chair that is an
    object would make the destructuring throw, and one of four fields would be read. Both are rows
    now.
  - An unknown phase was refused only because the fixture's round carries a result, and the
    result check refused it first. A row with an unknown phase and no result now fails without
    the phase check.
- **Arrivals, counted on the test's wire:** a higher id joining is 3 sends, and four people filling
  a fresh table lowest first is 10, both as room.ts. A lower id who has just joined the call is 4,
  one more than room.ts, for the fold.
- **Gates on the final tree, 26 Nov 2026, 18:20–18:26 EST:** `npm run typecheck`, `npm run lint` and
  `npm run build` passed. `npm run test` passed 410 files, 6,356 tests, 6 skipped: step 1's 408 and
  6,180, plus these 2 files and 176 tests. `node scripts/lab-move-bundle.mjs --check` passed with no
  rebuild, and the committed bundle's md5 is unchanged (3d2b8570…). `prettier --check` passed on
  every changed file.
- **The built bundle holds nothing from `src/lab/live`.** None of the 72 chunks in `dist/assets`
  contains the code's pattern (`A-Za-z0-9_-]{22}`) or any of six sentences found only in
  liveWords.ts, while two of busWords' sentences, as a control, are found. Nothing imports either
  file yet, so both tree-shake out entirely.

### What review found, 26 Nov 2026

Review confirmed fifteen findings against this step. Seven were faults in the table, five were
gaps in the tests that let a guard be removed without anything going red, and three were small
checks. Each is fixed below, and each fix has a test that failed first. The sixteenth finding was
step 1's and is fixed in that section, in room.ts, which was merged in before this.

**Faults in the table:**

- **A host could lack the table everybody else held, and nothing ever told it.** There were two
  ways in. A lowest-id newcomer is host at once, and `answersHello` names the host before them to
  answer their hello. If that host closes the toy or hangs first, nobody answers, and the newcomer
  hosts a fresh table nobody else accepts. When Bo's seq passed Cy's, Cy took his table whole and
  lost her chair, the computer and the round she was playing. The other way is a host's last state
  still on its way when the host hangs up. Every tab whose roster has already let the host go
  refuses it, because only somebody on my call is listened to. So the next host carried on from
  the table before it. Its first state tied that one's seq and lost the tie at Dee, who then
  played round 1 alone. Cy hosted no round at all, until her next change wiped Dee's out. The fix
  is room.ts's (owes): a tab owes its host the table it holds when it hears a hello from that host
  that somebody else is to answer, or when the host shows it an earlier state. Here the debt waits
  `PACE_MS` before it goes, and `dueAt` says when. room.ts pays at the next look instead. **The
  first draft paid here at the next look too**, and the review's fuzzer caught it at seed 246 of
  its realistic config. A host here holds changes for the pace, so the tab owing was a second
  behind the old host's own held change. Its stale table reached the newcomer first, the newcomer
  started a round on it, and the real answer undid the round.
- **A state handed on was recorded as its relayer's.** Bo minted a code at seq 1 and closed the
  toy, staying on the call. Cy hosted Bo's table and handed it to Ann, a lower-id newcomer, who
  recorded it as Cy's. Her own fresh table won that tie, while Cy kept Bo's, so two codes stood on
  one call until the next change. Ann never counted herself as having heard Bo's code, and when she
  hung up it was not re-minted. States now carry `by`, as above.
- **Two hosts for a moment could undo a round both of them had shown starting.** Ann's view had
  not caught up with Bo, so she still hosted. She took Cy's start and Bo took Dee's sit, both at
  one seq. By publisher alone Bo's state won, so Cy and Dee saw round 1 begin and then end without
  a move, and begin again when the start reached Bo. A start Ann held for the pace was lost
  outright. `later` puts how far the rounds have got before the publisher: a start beats the open
  table before it, and an end beats the start.
- **A start held for the pace went out on a code somebody who had just left had heard.** The held
  table already said "on", so a leaver in that second was judged mid-round. `told` is the round of
  the last state this tab sent or took off the wire. A round on in the table but past `told` has
  begun for nobody, so it re-mints like any round between rounds (betweenRounds).
- **Somebody who reached the host's roster a hop after a state could hear the code uncounted.** A
  state goes to everybody subscribed to the call, and the host counts them only once their voice
  hello arrives. Eve heard Cy's stand before Ann's roster had her, stayed silent while the table
  was quiet, and hung up; two rounds then played on the code she had heard. Somebody who reaches
  the roster within `ROSTER_LAG_MS` (3 s) of the host's last send is folded into `knew`, in a state
  of its own that goes out at once. Later than that they cost nothing.
- **A chair held by an id naming one of Object.prototype's keys was never freed**, and with it no
  round could start: `missing` is room.ts's fix again.
- **`knew` could hold the same id sixteen times**, and then a full `knew` named nobody who had
  left. readChairs refuses a repeat, so `knew` holds sixteen different people.

**Gaps in the tests, each closed with a test that goes red without its guard:** the guard against
a re-mint mid-round in `publish` (a mid-round takeover after a leaver), and the one in `present`
(a quiet table sending a state every second); seven halves of readChairs' checks that a neighbouring
check had been covering (seq 0 with every since 0, a chair that is nothing or a list-like object, a
code that is a list holding a good code, chairs, knew and starters that are list-like objects); the
host's own copy in "somebody sitting does not take a second chair", which read a watcher's copy
while the host's had Ann twice and every later state was refused; a host leaving and the next host
announcing the table it holds; the seq bump in the fold, without which the fold lost the tie to
the old host's lower id; and the no-op refusals for a mode already set, a computer at its own level
and no computer to take away. liveWords.test.ts gets names with an apostrophe, 41 characters and
what would be markup, each passed through untouched.

**Measured, 26 Nov 2026, 20:05–20:50 EST:**

- Tests: chairs.test.ts 188 (151 before), liveWords.test.ts 26 (25 before). The tests for the
  seven faults, the new checks and what the repairs cost failed on c95544b3's chairs.ts, 24 of
  them, each for the reason its name gives. The tests that close a gap passed on it, and go red
  without their guard.
- **Mutations of chairs.ts and liveWords.ts, 84, each made once and put back with both files' md5
  checked, red counted over `src/lab/live`. Every one went red:**

  | What was taken out                                                                               | Red                   |
  | ------------------------------------------------------------------------------------------------ | --------------------- |
  | owing on an unanswered hello; owing on an earlier state from the host                            | 4; 3                  |
  | the debt never paid; paid at the next look; `dueAt` not saying when                              | 6; 1; 4               |
  | paid by the same table, by a later one, by any send                                              | 2; 1; 1               |
  | a fresh table, a late copy of the host's own, anybody's but the host's, a seq-0 table owed       | 1 each                |
  | a state recorded as its relayer's; `by` the sender; `by` unchecked                               | 2; 5; 5               |
  | a tie by publisher alone; rounds compared by number alone                                        | 3; 1                  |
  | a held start counted as begun; in `present`, in `publish`; `told` not set on a send, on adopting | 1; 1; 1; 3; 1         |
  | nobody counted for reaching the roster late; a window that never closes; no window               | 1 each                |
  | a repeat in `knew` read                                                                          | 2                     |
  | `missing` a plain object read with `??`; a plain object; no prototype read with `??`             | 4; 1; 4               |
  | re-mint mid-round in `publish`; in `present`; both (the plan's 4.7 row)                          | 1; 2; 3               |
  | a second chair; no announcement from a new host; the fold keeping its seq                        | 1; 2; 3               |
  | a mode already set taken; a computer at its own level taken                                      | 1; 2                  |
  | each of readChairs' 33 checks, a half of a line at a time                                        | 1 to 4 each           |
  | the plan's rows again: 4.1, 4.3, 4.4, 4.5, 4.6, 4.9 (every tab answers; only the host)           | 15, 6, 1, 3, 50, 7, 4 |
  | never re-mint; no fold on hearing; no pacing                                                     | 10; 3; 4              |
  | the words: an apostrophe escaped, a name cut to 20 (twice), markup escaped                       | 1 each                |

- **The review's own fuzzer** (fuzz.sim.ts, kept outside the repository and not committed: seeded
  tables of two to six people with presence lag, repeats, delays and partitions, judged at every
  step and at every quiet moment), with its adoption check reading `by` and its mid-round re-mint
  check knowing a held start. The same 300 seeds per config, c95544b3's chairs.ts against this one:

  | Config (300 seeds each)                                     | Split when quiet | Round started twice | Round gone back | Code held by a leaver |
  | ----------------------------------------------------------- | ---------------- | ------------------- | --------------- | --------------------- |
  | realistic: in order, 300 ms at most, presence 300 ms behind | 6 → 0            | 3 → 0               | 0 → 0           | 1 → 0                 |
  | out of order up to 3 s, 10% repeated, presence exact        | 13 → 5           | 26 → 21             | 37 → 23         | 0 → 0                 |
  | the same, with presence up to 1.5 s behind                  | 11 → 0           | 26 → 28             | 41 → 34         | 0 → 0                 |
  | the same, with partitions and the roster up to 1 s behind   | 15 → 3           | 38 → 29             | 42 → 35         | 0 → 0                 |
  | the same, and 8% of messages dropped                        | 40 → 40          | 42 → 25             | 42 → 25         | 2 → 0                 |

  On 600 fresh seeds (301–900) the realistic config went from 8 splits, 2 rounds started twice,
  4 rounds gone back and 1 code held by a leaver, to 1, 1, 3 and 0. The drop config went from
  97 splits to 49. What is left is the window two hosts make while presence lags, which the plan
  accepts (4.5), and the cases under Left.

- Arrivals cost what they did: 3 sends for a higher id, 10 for four filling a fresh table, 4 for a
  lower id new to the call (4.9), and a settle after each sends nothing more.
- **Gates on the final tree, 20:40–20:50 EST:** `npm run typecheck`, `npm run lint` and
  `npm run build` passed. `npm run test` passed 410 files, 6,400 tests, 6 skipped: the 6,356 before
  this, step 1's 6 and these 38. `node scripts/lab-move-bundle.mjs --check` passed with no rebuild,
  the bundle's md5 unchanged (3d2b8570…). `prettier --check` passed on every changed file. None of
  the 72 chunks in `dist/assets` holds a sentence or a name only `src/lab/live` has, while a
  busWords sentence, as a control, is found; room.ts's `owes` is there, as it should be.

### Left

- Nothing to check on a call until step 6 wires the table. The plan's §8 checks for live tables
  start there.
- **Step 6 has the hello's retry at 3 s (§3.1) to decide.** An unanswered hello is now paid for by
  whoever holds the table, so the retry is a backstop rather than the only repair.
- A debt is owed to whoever the tab sees as host when the earlier state arrives. A new host whose
  announcement lands before the receiving tab's presence has made it host is owed nothing, and
  stays behind until its next change (1 seed in 600 of the realistic fuzz).
- Two hosts each taking the same start from different tables, Bo's with a sit in it: round 1 is
  on everywhere, but its starters can change once, when Bo's state lands.
- A host whose toy reopens while states from its last session are still on their way can be
  handed one, by the publisher half of `answersHello`, older than what it published: the late-copy
  rule then reads its next announcement as late and nothing is owed. Out-of-order delivery across a
  remount; the next change heals it.
- A state the host hears, rather than sends, opens no roster-lag window: the fold on hearing counts
  the roster as it stands then.
- A debt owed to a host that stops being host before it is paid still goes: one state nobody
  needed.
