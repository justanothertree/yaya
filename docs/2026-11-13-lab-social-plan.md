# A social Lab — a plan to review

_13 Nov 2026. A plan only. Nothing here is built, applied or deployed, and no production SQL is
part of it. It answers Evan's three asks:_

1. **Presence:** friends in a call together see which Lab toy each is on. Opening the same toy puts
   you in a shared room with them.
2. **A shared page for every toy:** everyone there sees everyone's cursor, with names. Toys that
   already have a two-player mode use the room as a lobby; the rest are shared viewing.
3. **Score comments:** you type what you like, and your real result is attached as a card the game
   recorded. You can't type the result in.

_It builds on, and partly replaces, `2026-11-09-lab-online-play-proposal.md` and the unmerged
`2026-11-10-lab-online-play-design.md` (#109). The section "Why not the relay" explains where it
departs from them._

## Decisions — Evan, 13 Nov

1. **The public-access probe:** run it read-only and report. **It could not run from the cloud
   session.** Realtime joins need a WebSocket, and that session's proxy does not carry WebSocket
   upgrades (it says so, and says to report rather than work around it). The answer is still
   unknown. The simplest way to ask is in a browser console on evancook.dev, signed out:

   ```js
   const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2')
   const sb = createClient(
     'https://lcpyatpktpkiybocyoij.supabase.co',
     '<the anon key the site already ships>',
   )
   const ch = sb.channel('voice:' + crypto.randomUUID(), { config: { private: false } })
   ch.subscribe((status) => console.log(status)) // SUBSCRIBED = still open; CHANNEL_ERROR = closed
   ```

   It joins a random room nobody is in, sends nothing and writes nothing.

2. **Friends:** only calls where everyone present is an accepted friend. Circuit groups don't count
   unless they're also friends.
3. **Real-time toys** get a card clearly marked **"Recorded"**, not checked.
4. **Cursor sharing resets each call.** The "share everything" switch is no longer remembered from
   one call to the next.
5. **Comments with a score card are friends-only.** That's part of the step 9 SQL.

Steps 1–8 are being built as small drafts, with Four in a row and Swarm as the pilots. Steps 9–11
wait on the answer to 1 and on your SQL.

---

## The short version

- **Most of 1 and 2 already exists.** A call is already a shared room, and the room already shows
  cursors and pages.
  - Each call has a private Supabase Realtime channel, `voice:<roomId>`. Membership is checked by a
    policy on `realtime.messages` through `voice_topic_member`.
  - That channel already carries the **party**:
    - `ptr`: cursors at up to 15 Hz;
    - `where`: the page you're on, as a 5 s heartbeat;
    - `gone`: you've left.
  - `PartyCursors` already draws other people's cursors, and `whereEveryone` already rings the nav
    link of the page each person is on.
  - What's missing for the Lab:
    - The party only sends the route before `?`, so every toy reads as just `lab`.
    - Picking a toy never writes the URL hash, so the toy isn't sent at all.
    - Cursors are measured against the page column, not the toy.
- **So 1 and 2 need no SQL, no new channel, no relay change and no new service.** The Lab adds a toy
  id to the party's `where`, a toy-relative cursor, and a small move protocol for the two-player
  toys. All of it rides the existing call channel.
- **3 needs a table, an RPC change and an edge function.** That's drafted in this plan as SQL in
  `docs/` for you to apply. It is never applied by me.
  - The card is honest about what it proves. **"✓ Checked"** means the server replayed the game and
    got the same result; the pilot does only this kind.
  - **"Recorded"** would mean the game sent it but nothing checked it. That's a decision for you
    (Question 3).
- **Two things must be settled before any of this ships**, because the plan inherits them:
  - Realtime's **"Allow public access"** switch. It's recorded as yours to turn off on 10 Aug, and
    nothing records that it was.
  - Who counts as **"friends"** in a call. Today a call can include people who aren't your friends.

## What exists today (measured from the code, 13 Nov)

| Piece           | Where                                                                                                                                                    | What it gives us                                                                                                                                                                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Call channel    | `src/voice/voiceSession.ts` (~1278): `sb.channel('voice:'+roomId, {private: true})`                                                                      | One private broadcast channel per call. It carries signalling (`voice`) and co-presence (`party`). It holds at most 12 people (`CALL_HARD_LIMIT`).                                                                                                     |
| Who may join it | `voice_topic_member` → `chat_room_member` / `profile_room_member` (baseline)                                                                             | A circuit group's members; **any opted-in Lounge member**; a DM's listed members; a profile room's owner, the owner's friends and invitees.                                                                                                            |
| Party           | `src/party/party.ts`                                                                                                                                     | `ptr` is throttled (15 Hz, ≥3 px, one rAF), visible tab only, never on a private route. `where` uses a 5 s heartbeat. Stale entries are swept after 6 s (cursor) and 16 s (here). Receivers validate and clamp. You see nothing unless you're sharing. |
| Drawing         | `src/party/PartyCursors.tsx`, `src/party/whereEveryone.ts`                                                                                               | Cursors are drawn only for people on your route. Nav rings show where everyone is.                                                                                                                                                                     |
| Sharing switch  | `src/party/together.ts`, button in `CallDock.tsx`                                                                                                        | Kept in `party_share_all_v1`, so it **comes back on in every new call** (see Privacy).                                                                                                                                                                 |
| Friends         | `friendships` (`accepted`), `are_friends()`, `can_see(owner, tier)`                                                                                      | The friends tier already exists and is used for profiles. **There's no block table.**                                                                                                                                                                  |
| Lab server      | `supabase/migrations/20261109030613_lab_catalog_and_feedback.sql`                                                                                        | `lab_comments` holds text only: 2–500 chars, kind `idea`, readable by `can_see(author,'members')`. Rate-limited `lab_comment_add`. House pattern: RLS on, no policies, SECURITY DEFINER RPCs.                                                          |
| Lab results     | `src/gpu/kept.ts`, `src/gpu/daily.ts`, `src/lab/bests.ts`                                                                                                | Results live only in localStorage. "🏆 My best" pastes a sentence into the comment box, so it's free text anyone can edit.                                                                                                                             |
| Two-player toys | 14 turn-based toys with a `'two'` mode (13 board games and Ten thousand), plus Stackfall's two wells, rock-paper-scissors, Gust, Shadow box and Crossing | All same-device. The board toys share one input gate, `yours = mode==='two' \|\| turn === you` (e.g. `FourRowDemo.tsx:278`). That's where "is it my seat?" goes.                                                                                       |

## 1 · Presence: which toy each friend is on

- **The URL carries the toy.** `pick()` in `GpuLab.tsx` writes `#lab?demo=<id>` with
  `history.replaceState`. `links.ts` already reads that form. This also gives back-button and share
  links for free.
- **The party carries the toy.** `where` gains an optional `sub` field, used only when the route is
  `lab`.
  - The receiver keeps it only if it's a known toy id (checked against the `DEMOS` id list, the way
    `skin` is checked today). A peer can't send arbitrary text to be shown.
  - `currentRoute()` doesn't change. A new `currentSub()` sits beside it, so no other page's
    behaviour moves.
- **What you see:**
  - In the Lab picker, a small coloured dot with initials on the button of each toy a friend is on
    ("Sam is on Lamps").
  - In the call dock, the same as a line ("🧪 Sam — Lamps").
  - Pressing either opens that toy, which puts you in the room (§2).
  - Nothing appears outside a call.
- **"Automatically":** two people in the same call with the same route and the same `sub` are in
  the same room. There's nothing to create, name or join.

## 2 · A shared page for every toy

### Cursors measured against the toy, not the page

- Today `ptr` is `{route, x: fraction of #content, y: page px}`. On a toy, two people's layouts
  differ (phone vs desktop), so a page position lands in the wrong place.
- The Lab sends `{route, sub, tx, ty}` instead, where `tx, ty` are fractions (0–1) of the
  **toy's own box**:
  - `.lab-stage` for the 94 canvas toys (68 WebGPU, 26 2D);
  - the board element for the 39 DOM toys.
- Every viewer maps that back into their own box, so a cursor over the third column of Four in a
  row is over the third column on every screen.
- **Where the layer lives:** an absolutely positioned, `pointer-events: none` layer inside
  `.lab-stage`, beside `.lab-veil` and `.lab-fps`. It must be **outside `.lab-toy`**:
  - `.lab-toy` is `display: contents` and can't position anything;
  - its focus watcher (`focusRescue.ts`) observes `style` and `class` changes, so a cursor layer
    inside it would run that check up to 15 times a second per person.
- **Updates are `transform` only**, written by the existing PartyCursors loop rather than by React
  re-renders.
- **Touch:** a phone has no hover, so a finger sends **tap pings** (a ring that fades over 600 ms),
  not a trail. That's also cheaper.

### Rooms as a lobby for the two-player toys

- **Seats:** the first two people in the room take seats. Everyone else watches, and a watcher can
  take a seat that frees up.
  - The **host** is whoever on that toy has the lowest user id, seated or not. The choice is
    deterministic, so no election messages are needed.
  - If the host leaves, the next one takes over from the last state.
- **Messages:** a new party event, `lab`, carrying `{sub, t, …}`:
  - anyone may send `hello`, `sit`, `stand`, `move` or `new`. These are requests, and only the host
    acts on them;
  - only the host sends `state`, the whole room: seats, a `seq` number and the game. For Four in a
    row that's under a kilobyte, one message per move.
  - A full snapshot rather than a move is what makes a lost or duplicated message harmless: the
    next snapshot replaces it, and an older `seq` is ignored.
- **Rules stay in the pure modules.** Each client applies a move through the same `drop()` /
  `play()` that local play uses, and refuses any move its own copy finds illegal.
- **Catching up:** a late joiner sends `hello` and the host answers with `state`.
- **Code:** the protocol is one pure module, `src/lab/social/room.ts`, tested with an in-memory transport.
  A toy opts in by giving three functions: `encode(state)`, `decode(body)` and `apply(state, move)`.
- **Order:** the 14 turn-based toys come first. Their state is plain data (Int8Array and Set
  fields need encoding). Real-time toys (Stackfall, Gust, Crossing) are a later, separate decision.
- **Not in this plan:**
  - hidden-hand card games (Hold'em, Hearts, Gin), which need a dealer nobody can peek at;
  - rock-paper-scissors online, which needs commit-reveal.

  Both are still as #109 describes, and both would need the relay.

### Everything else: shared viewing

- Every other toy gets cursors and presence only. Each person's toy runs on their own device, as it
  does today.
- No toy's simulation is synced: GPU toys aren't deterministic across devices, and syncing them
  would cost far more than it's worth.

## 3 · Score comments with a result the game recorded

**The flow (pilot: Lamps):**

1. Solving the daily board keeps a **replay**: the date, size, pattern and the list of presses.
   That's at most a few hundred small numbers, kept in localStorage beside the existing bests.
2. In the comment box, **"Attach today's result"** sends the replay to a new edge function,
   `lab-result`, with the member's JWT.
3. **The edge function checks it** by running the very same pure module the game uses:
   - It rebuilds the board with `make(n, pattern, seedFor(day, n, pattern))`. `seedFor` moves from
     `LampsDemo.tsx` into `lamps.ts` so both sides import one function.
   - It replays the presses with `press()` and requires `dark()` at the end.
   - It stores `{presses, par}` and returns a result id.

   The day is accepted only within ±1 of the server's UTC date, because the seed comes from the
   player's local date.

4. `lab_comment_add` gains an optional `p_result`. It attaches the result only if all of these hold:
   - the result belongs to `auth.uid()`;
   - it isn't attached to another comment;
   - it's under 24 hours old.
5. The comment renders as normal text, with a card under it: **"✓ Lamps 5×5 ✚, 14 presses (par 12) — 13 Nov"**. Only the server writes the card, and only the comment is typed.

**What is stored (drafted in `docs/`, not applied):**

```text
lab_results
  id          uuid primary key
  user_id     uuid not null references auth.users on delete cascade
  demo_id     text not null references lab_demos
  day         date not null
  params      jsonb not null   -- {size, pattern}, ≤ 200 bytes (check)
  metric      jsonb not null   -- {presses, par} or {seconds}, ≤ 200 bytes (check)
  checked_by  text not null    -- verifier name + version, e.g. 'lamps@1'
  created_at  timestamptz not null default now()

lab_comments
  + result_id uuid null unique references lab_results on delete set null
```

- **House pattern:**
  - RLS on, zero policies;
  - `revoke all … from public, anon, authenticated`;
  - the edge function writes through a service-role-only RPC;
  - `lab_comment_json` adds `result` when present;
  - visibility is the comment's own (`lab_can_read_comment`), so a card is never seen by anyone
    who can't see its comment.
- **The replay is not stored**, only the checked numbers. Unattached results are deleted after a
  day.
- **Draft:** `docs/2026-11-xx-lab-results.sql`, with `supabase/tests/lab-results.sql` run on the
  local stack (`supabase start`, per CLAUDE.md §2).
- **Production:** `apply_migration` and the edge-function deploy are both yours. Both deploy checks
  in CLAUDE.md apply: a diff of the deployed source, and a refusal probe.

**Which toys can be "✓ Checked":**

- any toy whose board comes from a seed and whose result is a function of discrete inputs: the five
  daily logic puzzles, Sudoku, Mines, Tiles and Codebreaker;
- the vs-computer board games, if their computer player is deterministic for a seed (to be measured
  per game);
- **not** real-time skill toys (Bricks, Stackfall, Archery). Replaying them on the server would mean
  running their physics there, and their GPU parts aren't portable. For those the honest options are
  "Recorded" (Question 3) or nothing.

## Privacy: friends and family only

1. **Turn off Realtime's "Allow public access" first.**
   - `docs/2026-08-10-realtime-auth-remaining-channels.sql` records it as yours to do. The last
     measurement (Aug) showed a client that leaves out `private: true` could subscribe with only the
     anon key.
   - While it's on, anyone who knows a call's room id could read its cursors and pages, and the toy
     ids this plan adds.
   - Step 0 below is a probe that answers this without needing an account.
2. **Who counts as a friend in a call.** The call channel admits people who aren't your friends:
   - Lounge members;
   - circuit-mates;
   - a profile owner's friends, who may not be each other's friends.

   A broadcast reaches everyone on the channel, so the only safe filter is the **sender's**. Lab
   presence and Lab cursors are sent only when **every member present in the call is an accepted
   friend of yours**. That's checked against `vp:` presence and your friends list, and checked again
   whenever someone joins.
   - **Never in a Lounge call.**
   - Circuit calls only if you say family groups count (Question 2).
   - The rule is a pure function, `labShareAllowed(roomKind, present, friends)`, with tests.

3. **Sharing stays a choice, made per call.** `together.ts` remembers the switch across calls today,
   which contradicts the party's own "off by default, not persisted" comment. The Lab switch starts
   off in every call. Fixing the party's own switch is a separate one-line decision (Question 4).
4. **No new personal data travels.** The toy id is the only new field, and it's validated against
   the toy list.
   - Comment cards hold a puzzle size and a number.
   - Nothing is stored for presence or rooms: broadcast is ephemeral.
   - Nobody outside the call learns anything.
5. **A peer's name is self-stated** (the sender stamps `from`), so a friend in the call could
   pretend to be another friend in the same call. That's acceptable among friends. It's also why
   score cards go through the RPC and never over the broadcast.

## Cost

- **Supabase Free plan figures.** These come from a web search, because supabase.com isn't reachable
  from this session; check them in the dashboard:
  - 2 million Realtime messages a month;
  - 200 peak connections;
  - 100 messages per second.
  - A message seems to be counted per client it's delivered to, plus the send.
- **Running out matters more than the bill.** Voice signalling uses the same Realtime, so a used-up
  quota could break calls, not just the Lab.
- **Presence and moves are free in practice.** One `where` per person per 5 s is already sent. A
  board game is a few dozen moves.
- **Cursors are the firehose,** as `2026-09-16-a-place-rather-than-a-call.md` warned.
  - Worst case today: four people moving at 15 Hz is 60 sends plus 180 deliveries, **240 messages a
    second**. That's above the 100/s limit and about 0.86 million an hour.
  - **The Lab sends at 8 Hz instead of 15,** and only while the pointer is over the toy (or a tap,
    on touch). The receiver smooths between points.
  - Four people moving a third of the time: about 11 sends and 32 deliveries a second, roughly
    **150,000 messages an hour**. A month's quota covers about 13 such hours.
- **So cursors get a meter before they get a launch.** Step 4 adds a local counter of party messages
  sent and received per call, shown to the admin only. One evening's real use then gives a figure
  instead of this estimate. If it's too high, cursors move to the relay (which has no per-message
  cost) and presence and moves stay on Supabase.
- **Edge function:** one call per attached result. The Free plan's invocation allowance is far
  above what eight people commenting will use.
- **Database:** a `lab_results` row is under 0.5 kB. A thousand cards is half a megabyte.

## Phone performance

- **Cursors:**
  - one DOM layer, `transform` only, outside `.lab-toy`;
  - at most 11 remote cursors (12 in a call);
  - no canvas redraws, and nothing added to the GPU toys' frame.
  - The pointer is sampled in the existing party rAF, not per event.
- **Sending:**
  - on touch, taps only;
  - nothing while the tab is hidden (the party already stops then);
  - nothing in toys where the pointer is captured for play, beyond the rate cap.
- **Moves:** applying one is the pure function the toy already runs locally. The board toys are DOM
  boards with no frame loop.
- **Checks before each step ships:**
  - a 375px `mobileAudit` with cursors present;
  - a frame-rate reading on a heavy WebGPU toy (Swarm) with three remote cursors moving, measured
    against the same toy with none.

  The pane's software GPU gives a relative number only. A real phone is yours to try.

## Failing safely when offline

- **Everything social is optional.** With no call, no channel or no network, every toy works alone
  exactly as it does today.
- **Presence and cursors:** `sendParty` already drops silently without a channel, and stale peers
  are swept after 6–16 s. A dropped friend's dot and cursor simply fade.
- **A two-player game when someone drops:**
  - after 10 s without the other seat, the game **pauses** and shows "Waiting for Sam…";
  - after 60 s it offers **"Keep playing against the computer"** from the same position;
  - when they come back, `hello` brings them up to date;
  - nothing is lost, because each client keeps its own copy.
- **Messages arrive out of order or twice:** every `state` carries a `seq`, and one older than the
  last applied is ignored. A lost one is replaced by the next, because each is the whole room.
- **Attaching a result while offline:** the replay stays in localStorage. The button says "Attach
  when you're back online", and the comment can be posted without it.
- **The edge function is down or refuses:** the comment still posts without a card. The card is
  never typed in as a fallback.
- **Old clients:** a client that doesn't know `sub` or `lab` ignores them. The party validators
  already drop unknown fields and kinds.

## Why not the relay (#109's recommendation)

#109 recommended the relay because it has no per-message cost and can deal Hold'em. Two things are
different for this ask:

- **The friends are already in a Supabase call channel with RLS checking membership.** The relay
  admits any member in good standing, with no friendship check, and rooms there would need ids,
  links and joining. The ask is "already in a call together, opening the same page". That is the
  call channel by definition.
- **This plan's traffic is presence and turn moves, which are tiny.** The firehose risk is cursors,
  and the plan meters them first, with the relay kept as the fallback for cursors alone.

Real-time versus play (Stackfall) and dealt cards remain relay work, as #109 says.

## Pilot toys

1. **Four in a row** — the lobby.
   - A move is one column number, the state is plain data (`Grid`), and `drop()` is pure.
   - A two-player mode with seats already exists.
   - It's a 2D canvas toy, so it also tests cursors over a canvas board.
2. **Lamps** — the checked score card.
   - The daily board comes from a seed, and the result (presses) is a pure replay.
   - Checking a 7×7 replay takes microseconds.
   - The board shapes were just fixed (#279).
3. **Swarm** — shared viewing on the heaviest kind of toy.
   - It's the WebGPU toy everyone lands on first.
   - It shows whether cursors cost a phone anything, and how presence reads on a toy nobody "plays".

## Steps — each a small draft, reviewable alone

| #   | Draft                          | Changes                                                                                                                                                                                | SQL / deploy              | Verified by                                                 |
| --- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------- |
| 0   | **Settle the gates**           | A read-only probe script: try a public, non-private subscribe to a random `voice:<uuid>` with the anon key and report SUBSCRIBED or refused. Plus your answers to the questions below. | none                      | The probe, run once you say so                              |
| 1   | **The toy in the URL**         | `pick()` writes `#lab?demo=`. Back button and links work.                                                                                                                              | none                      | `links` tests; back/forward in the pane                     |
| 2   | **Party learns the toy**       | `currentSub()`, `where.sub` validated against `DEMOS`, and `labShareAllowed()` with tests (friends-only, never Lounge).                                                                | none                      | Pure tests made to fail first; two-tab check                |
| 3   | **Who's where**                | Picker dots, the call-dock line, and press-to-follow.                                                                                                                                  | none                      | 375 / 820 / 1440, keyboard, two tabs                        |
| 4   | **Message meter**              | Counts party messages per call, sent and received, admin only.                                                                                                                         | none                      | A unit test; a reading from a real call                     |
| 5   | **Toy-relative cursors**       | A layer in `.lab-stage`, `tx,ty`, 8 Hz, tap pings on touch. Swarm first.                                                                                                               | none                      | Frame rate with and without cursors; `mobileAudit`          |
| 6   | **Room protocol**              | `src/lab/social/room.ts`: seats, host, `seq`, `hello`, pause and forfeit. In-memory transport.                                                                                         | none                      | Pure tests (dropouts, duplicates, gaps, host leaving)       |
| 7   | **Four in a row online**       | `encode` / `decode` / `apply`, and the seat check at the input gate.                                                                                                                   | none                      | Two tabs over a local channel stand-in, plus your real call |
| 8   | **Lamps replay**               | Keep the replay on solve; move `seedFor` into `lamps.ts`; `verifyLamps(replay)` pure, with tests.                                                                                      | none                      | Tests incl. a tampered replay going red                     |
| 9   | **Results SQL draft**          | `docs/…-lab-results.sql` plus `supabase/tests/lab-results.sql` on the local stack.                                                                                                     | **drafted, not applied**  | Local stack; RLS / grant queries from `rpc-inventory.md`    |
| 10  | **`lab-result` edge function** | Imports `verifyLamps`; JWT required; writes via the service-role RPC.                                                                                                                  | **drafted, not deployed** | Function tests; your deploy plus a diff and refusal probe   |
| 11  | **The card**                   | Attach button, card rendering, offline queue.                                                                                                                                          | needs 9 and 10 live       | 375 / 1440, offline toggle, a real attach after your deploy |

- Steps 1–8 need nothing from production and can ship one at a time.
- Steps 9–11 wait on your SQL and deploy.
- Every toy after the pilots is its own small draft.

## Questions

1. **"Allow public access":** have you turned it off? If you're not sure, may I run the read-only
   probe in step 0? It subscribes to a random, nonexistent room with the public key and writes
   nothing.
2. **Who counts as friends:**
   - Only calls where everyone present is your accepted friend (recommended)?
   - Do your circuit groups count as family?
   - Lounge calls never.
3. **Unchecked results:** should real-time toys (Bricks, Stackfall, Archery) get a **"Recorded"**
   card that's clearly marked as not checked, or no card until they can be checked?
4. **The party's own sharing switch** is remembered across calls today, against its own comment.
   Should it reset per call like the Lab's? That's a one-line change outside the Lab.
5. **Who sees a score card:** a comment, and so its card, is visible to all members today. Should
   carded comments be friends-only instead? That's a different `can_see` tier, and would be part of
   the step 9 SQL.
