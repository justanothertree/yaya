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
  behaves the same whether or not the code is in use; it never answers `room-not-found`.
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
- **The door's own deadline (40 s from the `auth` frame)** bounds such a socket instead, and ends
  in `door-unavailable`.
- **Per table:** 16 sockets (`lab-full` at hello) and 8 let in (`lab-full` at the door).
- **Live tables:** at most 6 rooms with anybody let in. A seventh gets `lab-busy`, given at the
  door, never at hello, so a full relay cannot be used to test whether a code exists. Rooms nobody
  was let into do not count, so strangers cannot fill the cap.
- **`lab` frames:** a non-empty string of at most 4,096 UTF-8 bytes (measured in bytes, not
  `.length`). A `to` must name somebody let into this room, or the whole frame is refused rather
  than sent to everybody. Windows of 50 a second per socket, 100 per room and 150 across all Lab
  rooms; anything over is dropped without a word. `from` and `uid` are written by the relay.
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

### Tests

| File                               | Asks                                                                                                                                                                                         | Runs in              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `server/lib/labDoor.test.mjs`      | every rule directly; tests 2.6–2.14, the race in 8 resolution orders                                                                                                                         | `npm run test`       |
| `scripts/relay-frames.test.mjs`    | the real relay, no Supabase: a Lab arrival hears `welcome` alone, the room hears nothing, the timer's sentence and close; `bad-room`; `list`. The Snake, park and bout goldens are unchanged | `npm run test`       |
| `scripts/relay-lab.test.mjs`       | the real relay against a loopback stand-in for Supabase: the wiring, case by case                                                                                                            | `npm run test`       |
| `scripts/park-stub-relay.test.mjs` | the stub imports the door and keeps no copy; it refuses to start unasked; `STUB_WAKE`; friends meet, one-sided lists do not                                                                  | `npm run test`       |
| `scripts/lab-door-probe.mjs`       | the real relay against a **real local Supabase**                                                                                                                                             | by hand, below       |
| `scripts/relay-smoke.mjs`          | after a deploy: a token-less knock on a fresh table                                                                                                                                          | by hand, after merge |

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

### Left

- **After merging, once Render's metrics show no live connections (Evan's rule, above):** run
  `RELAY_URL=<the relay> node scripts/relay-smoke.mjs --ref origin/main`. It now also knocks on a
  fresh table without a token: it expects `welcome` alone, no listing, then at 12 s "A Lab table is
  for friends on a call, signed in on the site." and a close. That sentence is in no older relay.
  It is skipped automatically for a ref whose `server/` has no `labDoor.mjs`.
- **Then Evan reads `/relay-config` himself (his answer, above).** If `has.SUPABASE_URL` or
  `has.SUPABASE_ANON_KEY` is false on Render, every Lab table answers `door-unavailable`, which is
  safe and useless (P2).
- **The probe runs by hand, not in CI.** It needs Docker and the local stack. The stand-in test
  (`relay-lab.test.mjs`) is the CI copy of the wiring, and it is only as faithful as its stand-in.
- **A friendship ended inside the minute** is still believed for the rest of it (the cache), and a
  friendship ended mid-game is never re-checked, as a park's vouching is not.
- **`lab-full` counts sockets, not people.** One person's eight tabs fill a table.
