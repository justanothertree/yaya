# Lab matches by turns: play now, they move later

_14 Nov 2026. A plan only: no migration, no SQL run anywhere, no source change. Everything marked
"draft" below is for Evan to apply. It builds on the live call play (#297, #319, #324) and the
verified-result design (steps 9–11 of `2026-11-13-lab-social-plan.md`), and replaces neither._

**Status, 15 Nov:** steps 0–5 are live for Reversi and Chess, apart from the profile's Challenge
button. See `2026-11-15-lab-matches-live.md` for what shipped, how it was checked, and what is next.

## Decisions — Evan, 14 Nov

1. **Timeouts:** 7 days without a move, then the waiting player may **Claim the win**. Nothing ends a
   match on its own.
2. **The Feed:** a finished match names the opponent only to viewers who are friends with both
   players; everybody else reads "beat a friend".
3. **Telling you it's your move:** the bell, the badge and the Lab's Your games list only. No email
   and no push for now.
4. **`lab_results`:** drafted together with the match tables, as one SQL draft.
5. **Order:** Reversi and Chess first, then Five in a row, Draughts, Dots and boxes and Four in a
   row. Dice and card games later.

The plan below already said each of these; it stands as written. The steps that need no SQL (0 and

1. go ahead as their own drafts, and the SQL is prepared as `DRAFT.sql`, `ROLLBACK.sql` and a
   read-only `checks.sql`, tested on a throwaway database and not applied.

## Decisions — Evan, 14 Nov, second round

6. **Every match has its own link**, in the shape Snake's lobby link has: it opens straight into
   the match, it works from a bookmark and from the bell, and it works only for the two players.
   See [Each match has its own link](#each-match-has-its-own-link).
7. **The goal is every Lab toy with a second side**, whether that side is a friend or the
   computer, playable with friends: live in a call, by turns, or both. The audit of the whole
   catalog is in
   [Every toy with a second side](#every-toy-with-a-second-side-calls-turns-or-both).
8. **Pool goes by turns, with the server replaying each shot**, straight after Reversi and Chess.
   It is step 7 below, and the board games that were step 7 are now step 8.
9. **The computer opponents stay.** Nothing here replaces a toy's own "against the computer". A
   match adds friends to it, and where a table needs more seats than there are friends, the
   computer fills them.

Block A of `2026-11-14-lab-matches.checks.sql` was run on production the same day, read-only:
nothing the draft creates exists yet, `is_suspended` and `lab_demo_open` are as tested,
`friendships` and `lab_demos` have the columns the draft was tested against, and `reversi` and
`chess` are both in `lab_demos`, neither hidden. `pool` is there too.

## The short version

- **A match is a game saved on the server between two friends.** You take your turn. Your friend
  takes theirs whenever they like: an hour later, or on Thursday. Then you check back and take
  yours, like Words With Friends.
- **The server decides, not the browser.**
  - Every move goes through an edge function, `lab-move`. It replays the game with the toy's own
    rules module, the same `Rules` the call rooms use today. It accepts the move only if it's your
    turn, the move is legal, and nobody has moved since you looked.
  - A move or a result can't be invented through the API, because the API never accepts a board,
    only a move.
- **Because the server holds the game, two kinds of game that can't work in a call can work here.**
  It can roll the dice and deal the cards itself, and keep a hand or a fleet hidden from the other
  player.
- **A finished match is a checked result.** It's written to `lab_results` (the step 9 table) by
  the server, so its card says **"✓ Checked"**, not "Recorded".
- **You find out it's your move in four places:**
  - a **Your games** list at the top of the Lab;
  - the bell;
  - the nav badge count;
  - one **Feed** post when a match _finishes_. Moves never reach the Feed.
- **Nothing new to run:**
  - no cron (timeouts are worked out when someone looks);
  - no push service;
  - no relay change;
  - two tables, a handful of RPCs and one edge function.

## Which toys can go by turns

The test: two players, discrete turns, rules in a pure module, and a whole game that's small on the
wire.

| Group                    | Toys                                                                                                                                                                                                                                                                                | Why                                                                                                                                                            | When      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **First**                | Reversi, Chess                                                                                                                                                                                                                                                                      | Perfect information, no dice, and a `Rules` object that already replays a move list (`reversiRoom.ts`, `chessRoom.ts`)                                         | Steps 3–6 |
| **Second**               | Pool                                                                                                                                                                                                                                                                                | A shot is a turn. The shot is the move, and the server plays it through with `pool.ts`, so its end position is the board. See [Pool by turns](#pool-by-turns). | Step 7    |
| **Then**                 | Five in a row, Draughts, Dots and boxes, Four in a row                                                                                                                                                                                                                              | The same as the first two, with `Rules` objects already written (`gomokuRoom.ts`, `draughtsRoom.ts`, `dotsRoom.ts`, `fourrowRoom.ts`)                          | Step 8    |
| **Daily duel**           | Lamps, and the other daily puzzles later                                                                                                                                                                                                                                            | Not turns: both of you solve the same day's board, and the fewest presses wins. `verifyLamps` already checks a solve.                                          | Step 9    |
| **Next, rules to write** | Mancala, Nine men's morris, Hex, Ultimate noughts, Breakthrough, Fences, Chinese checkers, Go 9×9, Fox and geese, Noughts and crosses in a cube; Artillery, Bowling, Curling, Putt, Darts (shots, as Pool)                                                                          | Perfect information and pure modules, but no `Rules` object yet. Each is about a day, as #320–#322 were.                                                       | Step 10   |
| **Only by turns**        | Backgammon, Yacht, Ten thousand, Shut the box (dice); Sea battle, Codebreaker, Shadow box, Rock paper scissors (something hidden); Gin rummy, Cribbage, Dominoes (hidden hands); Hearts, Spades, Crazy eights, Liar's dice, Hold'em (hidden hands, the computer in the other seats) | In a call, whoever hosts sees everything. A server that rolls, deals and holds the hidden half, and shows each player only their own, makes them fair.         | Step 11   |
| **Not by turns**         | Air hockey, Gust, Stackfall, Light trails, Night crossing; Lamps _together_                                                                                                                                                                                                         | Real time has no turns to save. They belong in calls, and wait for the relay.                                                                                  | —         |

## Every toy with a second side: calls, turns, or both

The whole catalog was read on 14 Nov: 133 toys in `DEMOS` (`src/sections/labDemos.tsx`). **47 of
them have a second side**, a friend or the computer. The other 86 are made for one person:
making tools, sims, puzzles and score runs. Each of the 46 is below.

- **Live** means in a call, on `room.ts`, as Reversi is today.
- **By turns** means a match, on `lab-move`.
- **Both** means the same `Rules` object serves both, which is the point of step 1.

**Already live in calls; by turns next**

| Toy            | Second side today                   | With friends | Status                                                           |
| -------------- | ----------------------------------- | ------------ | ---------------------------------------------------------------- |
| Reversi        | computer, 3 levels                  | **Both**     | live since #319; by turns steps 3–6                              |
| Chess          | computer, 3 levels                  | **Both**     | live since #319; by turns steps 3–6                              |
| Four in a row  | computer, 3 levels                  | **Both**     | live since #297; by turns step 8                                 |
| Five in a row  | computer, or a friend on one screen | **Both**     | live since #324; by turns step 8                                 |
| Draughts       | computer, or a friend on one screen | **Both**     | live since #324; by turns step 8                                 |
| Dots and boxes | computer, or a friend on one screen | **Both**     | live since #324; by turns step 8                                 |
| Lamps          | the day's par                       | **Both**     | together and race live since #319; a daily duel by turns, step 9 |

**Board games with every piece in view: a `Rules` object each, then both**

| Toy                           | Second side today     | With friends | Note                                                                                                                                                                         |
| ----------------------------- | --------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mancala                       | computer, or a friend | **Both**     |                                                                                                                                                                              |
| Nine men's morris             | computer, or a friend | **Both**     |                                                                                                                                                                              |
| Hex                           | computer              | **Both**     | Its hardest computer grows thousands of games a move. Together by turns offers it only if it fits the server's time per call; see [The computer stays](#the-computer-stays). |
| Ultimate noughts              | computer              | **Both**     | The same caution as Hex for its hard levels                                                                                                                                  |
| Breakthrough                  | computer, or a friend | **Both**     |                                                                                                                                                                              |
| Fences                        | computer              | **Both**     |                                                                                                                                                                              |
| Chinese checkers              | computer, or a friend | **Both**     | Two points of the star, as the toy plays now                                                                                                                                 |
| Go 9×9                        | computer              | **Both**     | The same caution as Hex                                                                                                                                                      |
| Fox and geese                 | computer, or a friend | **Both**     | Asymmetric: the challenger picks a side, and a rematch swaps                                                                                                                 |
| Noughts and crosses in a cube | computer, or a friend | **Both**     |                                                                                                                                                                              |

**Shots: the move is a shot, and the server plays it through**

| Toy       | Second side today | With friends       | Note                                                                                                                                                                                                                                                               |
| --------- | ----------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pool      | computer          | **Both**           | Step 7, [Pool by turns](#pool-by-turns). Live: one message a shot, and the host's end position wins (#310).                                                                                                                                                        |
| Artillery | computer          | **Both**           | The wind comes from the game's own seed, so both sides know it and neither chooses it. That's fair in a call too.                                                                                                                                                  |
| Bowling   | computer bowler   | **Both**           | A frame is a turn. Stance, line, hook, speed and the release are the move.                                                                                                                                                                                         |
| Curling   | computer skip     | **Both**           | Sweeping happens while the stone runs, so the move carries when Sweep was held, and the server replays the throw with it.                                                                                                                                          |
| Putt      | computer          | **Both**           | A stroke is a turn. A hole of your own travels in the settings, as `&hole=` does today.                                                                                                                                                                            |
| Darts     | computer          | **Both**, recorded | The steadiness of a throw (the ring tightening while you hold your breath) happens in the thrower's browser. The server can check the scoring and the double out, but must take where each dart landed on trust. So a darts match card says Recorded, not Checked. |

**Only by turns: dice, or something one side mustn't see**

A call room sends the whole game to everyone, and the host decides. So whoever hosts could
choose the dice or look at the other hand. The server can roll, deal and keep the hidden half.

| Toy                   | Second side today                         | With friends | What the server holds                                                                        |
| --------------------- | ----------------------------------------- | ------------ | -------------------------------------------------------------------------------------------- |
| Backgammon            | computer                                  | **By turns** | the dice                                                                                     |
| Ten thousand          | computer, or a friend                     | **By turns** | the dice                                                                                     |
| Yacht                 | computer                                  | **By turns** | the dice                                                                                     |
| Shut the box          | computer                                  | **By turns** | the dice                                                                                     |
| Sea battle            | computer                                  | **By turns** | each fleet; a shot is answered hit or miss and nothing more                                  |
| Codebreaker           | the computer cracks yours                 | **By turns** | the code: one hides it, the other cracks it                                                  |
| Shadow box            | a friend, pass and play                   | **By turns** | the hidden stack: one hides, one rebuilds                                                    |
| Rock, paper, scissors | the mind-reader, or a friend              | **By turns** | the first throw, until the second is in. In a call the host would see yours before choosing. |
| Gin rummy             | computer                                  | **By turns** | the deck and each hand                                                                       |
| Cribbage              | computer                                  | **By turns** | the deck, each hand and the crib                                                             |
| Dominoes              | computer                                  | **By turns** | the boneyard and each hand                                                                   |
| Hearts                | three computers                           | **By turns** | the deck and each hand. Two friends and two computers, so you only wait on one person.       |
| Spades                | a computer partner, two computers against | **By turns** | the same. You and a friend as partners against two computers: co-op by turns.                |
| Crazy eights          | one to three computers                    | **By turns** | the same, with computers in any empty seat                                                   |
| Liar's dice           | two or three computers                    | **By turns** | every cup, with computers in the empty seats                                                 |
| Hold'em               | three computers                           | **By turns** | the deck and each hand. Play chips only, as now.                                             |

Calls could have the dice games later, if both sides commit to a seed before either sees it.
That isn't planned while turns cover them.

**Only live in calls: real time**

| Toy            | Second side today                                       | With friends | Why                                                                                                                                                                           |
| -------------- | ------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Air hockey     | computer, 3 levels                                      | **Live**     | Real time has no turns. It waits for the relay: on Supabase Realtime an hour of play costs about 290,000 messages (#310).                                                     |
| Gust           | computer, or a friend on one keyboard                   | **Live**     | The same                                                                                                                                                                      |
| Light trails   | one to three computer rivals                            | **Live**     | The same. Friends take rivals' places and the computer drives the rest.                                                                                                       |
| Night crossing | a friend on one keyboard: one steers, one aims the lamp | **Live**     | The same. Co-op only.                                                                                                                                                         |
| Stackfall      | computer, or a friend on one keyboard                   | **Live**     | The cheapest real-time one: junk is an event, and each well needs sending only a few times a second. It may fit on Realtime before the relay; the admin meter can measure it. |

**Not with friends, and why**

| Toy        | Second side today                       | Why not                                                                                                                                                                             |
| ---------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Twenty-one | the dealer                              | The dealer has no choices, so a friend would play beside you, not against you. "The same shoe for both, most chips wins" is a daily duel, not a match. It's a candidate for step 9. |
| Lander     | an autopilot ghost                      | The ghost is a par. The same terrain for both, best landing wins, is a daily duel (step 9), recorded because the flying happens in the browser.                                     |
| Time trial | a computer driver's lap sets the medals | The same: a daily duel on the day's track, recorded.                                                                                                                                |

### The computer stays

- **Every toy keeps its own "Against the computer".** A match adds friends; it takes nothing away.
- **Together by turns is two friends against the computer**, as Together is in a call today. The
  server plays the computer's move with the toy's own AI, in the same `lab-move` call as the
  friend's move before it. Its reply is stored beside the move it answered, `{m, then}`, and is
  in the game's own move list, so replaying the match checks it like any other move. Nothing about
  the computer has to be reproducible for that.
- **Computers fill empty seats** at the tables for three or four (Hearts, Spades, Crazy eights,
  Liar's dice, Hold'em, Light trails). A match never waits on a computer.
- ⚠️ **A computer that thinks hard has to fit in one server call.** An edge function has a CPU
  limit per request. The search computers (Hex, Go, Ultimate noughts, Pool's planner, Spades and
  Hearts on Hard) are measured in step 3's harness before Together by turns offers them. The first
  two are measured: over whole games on the throwaway stack, the slowest move with the hardest
  computer replying took 193 ms round trip for Chess and 162 ms for Reversi 10×10, database
  included. Any level
  that doesn't fit is left off by turns, and stays available against the computer and in calls.

## Starting a match

- **From a friend's profile:** a **🎲 Challenge** button opens a short picker: the toy (first-wave
  toys only), Versus or Together, and the size or level where the toy has one.
  - Members can open profiles (they have visibility tiers), so the button appears only when the
    two of you are accepted friends. The page already loads `list_friends`. The server checks
    `are_friends` again on the challenge itself.
- **From the Lab:** on a first-wave toy, **Challenge a friend** sits beside "Against the computer"
  and "With the call", and lists your friends.
- **From a finished call game:** CallTable's result line gains **Rematch by turns**.
  - It challenges the other seat to the same toy, with sides swapped.
  - "Continue this game later" is left out on purpose. The server would have to trust a board it
    didn't see played. Replaying the move list could make it safe for the move-list toys, but it's
    not worth it yet.
- **An invitation is a match in `invited` state.** It appears in the friend's Your games and bell
  as "Ann challenged you to Chess", with Accept or Decline.
  - Accepting makes it `active`, and the first move is the challenger's (white, or black in
    Reversi).
  - An invitation expires after 7 days.
  - Challenging the same friend to the same toy while one is open opens the existing match instead.

## Each match has its own link

Like `#snake?room=…`, which `challenge.ts` has been posting into chat for months, a match is an
address: **`#lab?demo=chess&match=<id>`**.

- **It opens straight into the match.** The Lab reads `match` the way it already reads `demo`
  (`hashParam` in `src/lab/links.ts`), opens the toy, and loads the match with `lab_match_get`.
  - `toyHash` already keeps the rest of the address when the toy named is the one showing, so the
    `match` survives the Lab settling on the toy.
  - Picking a different toy drops it, as it drops a putt hole today.
  - Leaving the match (Back to the computer, or another toy) takes `match` out of the address, so
    a reload doesn't throw you back in.
- **Everything that points at a match uses that one address:** the rows in Your games, the bell's
  "Your move in Chess with Bo", the invitation, the finished match, and **Copy link** in match
  mode. One address means a bookmark, the bell and a pasted link can never open different things.
- **It works from a bookmark.** The id is the match's own `uuid` and never changes, from
  invitation to finish. A finished match opens read-only with its result and **Rematch**.
  - Signed out, the Lab shows "Sign in to open this match", and the sign-in keeps the address, as
    a Snake room link does.
- **It works only for the two players**, and the link is not what keeps it so:
  - The id is unguessable, but **the gate is `lab_match_get`**, which answers only a player in the
    match who is still friends with the other one. A link is not a key, so forwarding it gives
    nothing away.
  - Anyone else, a member or not, gets **"There's no match here for you"**, word for word the
    answer for an id that never existed. The draft's tests already check that a stranger probing an
    id learns nothing (`supabase/tests/lab-matches.sql`).
  - Unfriending ends the match on the next touch, and after that the link answers the same way
    for both.
- **No spectators by link.** Watching a friend's match is a later question. It would need its own
  rule about who may watch, and the both-friends Feed rule (decision 2) is the obvious one.
- **No new SQL.** `lab_match_get(match)` is in the draft already, and the address is client-only.

## What is stored (draft, for Evan to apply)

House pattern, as `profile_blocks` and `member_library` (CLAUDE.md §3):

- RLS on, **zero policies, no grants**;
- `revoke all … from public, anon, authenticated`;
- reached only through `SECURITY DEFINER` RPCs that check `auth.uid()`;
- the one write that changes a game is service-role only, called by the edge function.

"Only friends in the match can read or move" is enforced in exactly one place, a function every
RPC calls first:

```text
lab_match_may(p_match uuid) → boolean
  = auth.uid() is one of the match's two players
    and are_friends(player_a, player_b)       -- still friends, checked every time
```

```text
lab_matches
  id            uuid primary key default gen_random_uuid()
  demo_id       text not null references lab_demos     -- check: in the async list
  mode          text not null check (mode in ('versus','together'))
  player_a      uuid not null references auth.users on delete cascade  -- seat 0, challenger
  player_b      uuid not null references auth.users on delete cascade  -- seat 1
  status        text not null check (status in
                  ('invited','active','finished','declined','expired','ended'))
  settings      jsonb not null      -- {size, level, …}; ≤ 200 bytes (check)
  state         jsonb not null      -- the game as the toy's Rules.encode gives it; ≤ 16 kB (check)
  secret        jsonb               -- dice seed, deck, fleets; never returned by any RPC
  seq           int  not null default 0   -- moves applied; a move names the seq it was made at
  turn          smallint            -- seat to move; null unless active
  turn_since    timestamptz         -- for "their move since Tue" and timeouts
  result        jsonb               -- {winner: 0|1|'draw', how: 'played'|'resigned'|'timeout', score}
  rematch_of    uuid references lab_matches on delete set null
  created_at, updated_at, finished_at timestamptz
  check (player_a <> player_b)

lab_match_moves      -- the history: what makes a finished match replayable and checkable
  match_id   uuid references lab_matches on delete cascade
  seq        int
  by_seat    smallint
  move       jsonb not null        -- ≤ 200 bytes (check)
  at         timestamptz not null default now()
  primary key (match_id, seq)
```

**The RPCs** (all `SECURITY DEFINER`, all calling `lab_match_may` or checking the friendship first):

| RPC                                                              | Who                   | Does                                                                                                                                                                                                                 |
| ---------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lab_match_challenge(friend, demo, mode, settings)`              | a player              | Checks `are_friends`, the open-match caps, and the toy's place in the async list. Inserts `invited`.                                                                                                                 |
| `lab_match_answer(match, accept)`                                | the invited player    | Sets `active` (with the toy's fresh state, written by the edge function) or `declined`.                                                                                                                              |
| `lab_match_list()`                                               | anybody signed in     | Your matches, newest first: toy, opponent, status, whose turn and since when. **No `state`.**                                                                                                                        |
| `lab_match_get(match)`                                           | a player              | The match with `state` as **this viewer** may see it: `secret` never, and a hidden-information toy returns only the viewer's half.                                                                                   |
| `lab_match_resign(match)`                                        | a player              | Finishes the match, the other seat winning, `how: 'resigned'`.                                                                                                                                                       |
| `lab_match_claim(match)`                                         | the waiting player    | Only once `turn_since` is past the timeout: finishes it, `how: 'timeout'`.                                                                                                                                           |
| `lab_my_turns()`                                                 | anybody signed in     | `{your_move, invites}` counts and the top few rows, for the bell and badge.                                                                                                                                          |
| `lab_match_commit(match, at_seq, by, move, state, turn, result)` | **service role only** | The single write that moves a game: `update … where id = $1 and seq = at_seq and status = 'active'`, with the history row in the same transaction. A second move made against the same board finds no row and fails. |

## A move, end to end

1. The player makes the move on the board. Nothing is sent yet: an async move should be confirmed,
   so a **Send move** button appears, with **Undo** beside it until it's pressed.
2. The client calls `lab-move` with `{match, at: seq, move}` and the member's JWT (`verify_jwt` on).
3. The edge function:
   - reads the match through a service-role RPC;
   - requires the caller to be the seat whose turn it is, still friends with the other player, and
     `seq === at`;
   - decodes `state` with the toy's own `Rules.decode`, which **replays the stored move list**, so
     a damaged row is refused rather than built on;
   - requires `Rules.legal(game, move, seat)`;
   - applies the move, rolling the dice or dealing from `secret` for the step-10 toys;
   - calls `lab_match_commit`.
4. On a finish, it also writes the `lab_results` row for each player (`checked_by: 'match:chess@1'`)
   and the Feed event (below), in the same transaction as the commit.
5. The answer is the new `lab_match_get` view, and the board redraws from it.

**Why an edge function rather than SQL:** the rules already exist as tested TypeScript, used by the
call rooms and the toys themselves. Writing chess legality in PL/pgSQL would be a second copy of the
rules, and CLAUDE.md §2 is clear about what a second copy of the rules turns into.

**One preparation:** `chess.ts`, `gomoku.ts`, `lamps.ts`, `bricks.ts`, `fences.ts`, `halma.ts`,
`breakthrough.ts` and `backgammon.ts` import `whole` from `kept.ts`, which imports React. That
blocks running them in Deno. Step 0 moves the pure helpers out, with a test that no rules module
reaches React.

**Reusing the verified-result path:** `lab_results` is the step 9 table. A match result is the
first kind of result the server has checked by playing the game itself. The step 9 migration and
this one should be drafted together, so the result row and its RLS are written once.

## How you know it's your move

- **Your games** sits at the top of the Lab, above the picker, shown only when you have a match.
  - Each row has the toy's icon, the friend's name and a state: "**Your move** · 2 h", "Bo's move ·
    since Tue", or "Bo challenged you · Accept / Decline".
  - Your-move rows sort first.
  - Pressing a row opens the toy in match mode.
- **The bell** gains a `lab` kind, from `lab_my_turns()`, gathered with the others in
  `useNotifications.ts`:
  - "Your move in Chess with Bo";
  - "Ann challenged you to Reversi";
  - "Bo resigned. You win at Draughts".
- **The badge** is the nav's existing total plus your-move matches and invitations. It's a number,
  not a dot, so "3" means three games waiting on you.
- **The Feed gets meaningful moments only:** a match **finishing**, as a `get_member_activity`
  event of kind `lab_match`, which `feed_recent` already merges.
  - Every move, every invitation and every decline stays out.
  - The event goes through `feed_may_show` (the sharing switch) like everything else.
- ⚠️ **The opponent's name is shown only to someone who can see both players.** "Ann beat Bo at
  Chess" in Ann's friends' Feed would tell Ann's friends what Bo did, and Bo may not be their
  friend. Viewers who are friends with both see the name; everybody else sees "Ann beat a friend at
  Chess".
- **While both are online, a move shows up without a reload.** A notify-only private broadcast on
  `labmatch:<id>` carries `{seq}` and nothing else, authorized the way `voice:<roomId>` is (a
  policy on `realtime.messages` through `lab_match_member`), and the client re-fetches. Without it,
  the page re-fetches on focus and on visibility change. It's optional and costs two messages a
  move.

## Timeouts, resigning, rematches, limits, unfriending

- **Timeouts are lazy, with no cron.**
  - `turn_since` is compared with `now()` whenever anybody lists or opens the match.
  - After **7 days** without a move, the waiting player sees "Bo hasn't moved in 7 days" with
    **Claim the win** and **Keep waiting**.
  - Claiming finishes the match `how: 'timeout'`. Nothing ends a match on its own.
  - An unanswered invitation shows as expired after 7 days.
- **Resigning** is a button in match mode, confirmed in the page (not `window.confirm`, which the
  pane can't answer and some browsers suppress). It finishes the match for the other player. The
  Feed event says "won by resignation".
- **Rematch** on a finished match challenges the same friend to the same toy and settings, with
  sides swapped and `rematch_of` set. It's one press, and it's an invitation like any other.
- **Limits**, checked in `lab_match_challenge` and stated in the refusal:
  - **10 open matches per player** (invited plus active);
  - **one open match per friend per toy**;
  - **60 moves a minute per player**, against a script rather than a person.
  - Worst case at eight members: 8 × 10 matches × 16 kB is about **1.3 MB**, well inside the free
    tier. Revisit with the `member_library` numbers in CLAUDE.md §5.
- **Leaving the friends list:**
  - Every RPC checks `are_friends` on every call, so the moment either player removes the other,
    the match can't be read or moved. It vanishes from both lists.
  - On the next touch, open matches between them become `ended` (no winner, no Feed event, no
    result).
  - Results already written to `lab_results` belong to each player and stay, without the
    opponent's name.
  - There's no block table today. When one arrives, a block ends matches the same way.

## Phone and desktop

- **Phone (375):**
  - Your games is a single-column list of full-width rows at least 44 px tall. Up to three show,
    then "All games (7)".
  - Match mode is the toy's own board, with a header line ("Chess with Bo · your move") and a
    sticky bottom bar holding **Send move** and **Undo**, within thumb reach and above the call
    dock's space.
  - Resign and rematch sit in the toy's controls row, not the bottom bar, so a thumb can't hit
    them.
- **Tablet (~820) and desktop (1440):**
  - Your games is a strip of compact cards across the top of the Lab, two to four across.
  - In match mode the move list or history sits beside the board where the toy already has a side
    column (Chess, Draughts), and under it where it doesn't.
- **Keyboard:**
  - Every row is a button.
  - Match mode reuses each toy's existing board keys; Send is the next tab stop after the board.
  - The status line is a polite live region, as CallTable's is.
- **Reduced motion:** the opponent's move is shown placed, not animated in.
- **Offline:** Send is disabled with "You're offline — your move will be ready to send". The move
  stays on the board locally and is never sent behind your back.

## Pool by turns

Step 7, straight after Reversi and Chess. It's the iPhone 8-ball shape: you take your shot, and
your friend watches it and takes theirs whenever they like.

- **The move is the shot:** `{angle, power}`, plus `{x, y}` when the cue ball is in hand. The
  edge function refuses anything else:
  - an angle that isn't a finite number;
  - a power outside 0 to 1;
  - a placement when the cue ball isn't in hand, or one `canPlace` refuses.
- **The server plays the shot through.** It runs `pool.ts`'s own `shoot`, the same function the
  toy and its computer use. The end position it gets is the board, and the turn, fouls, groups and
  the black follow from it, by the toy's own rules.
- **The state is the table, not a list of shots.** It holds every ball's position, the groups,
  whose turn it is, ball in hand, and whether the table is broken: well under 2 kB.
  - Chess replays its move list, but replaying every shot from the rack would repeat the toy's
    most expensive function once per shot already played, on every move, and buy nothing.
  - Only the service role ever writes the state. `decode` still refuses a damaged one: 16 balls
    numbered 0 to 15 once each, each on the cloth or down, and no two on the cloth overlapping.
  - The shots go in `lab_match_moves`, which is how the other player watches them.
- **Watching the other player's shot:**
  - The client plays the stored shot through itself, from the position before it, to animate it.
  - Then it lays the balls exactly where the server says. The server's position is always the one
    the game goes on from.
  - Chrome, Edge and Deno run the same engine, so the two should agree exactly. That's a claim to
    measure, not assume. Step 7 fixes the end positions of a few hundred seeded shots in a test
    file and asks the same of Deno.
  - Firefox and Safari can differ in the last bits of `Math.cos` and `Math.sin`, and a long shot
    can grow that into a visible jump when the balls are laid down. That's cosmetic, since the
    board is the server's, but it's untested here. It's reported as "needs a look in Firefox and
    Safari".
  - Under reduced motion, the balls are simply shown where they ended.
- **Cost:** a shot is many small steps, so the CPU time of one shot is measured in Deno before
  step 7 ships.
  - Versus comes first.
  - Together (two friends against the computer) comes only if the computer's planner, which plays
    every shot through before choosing, fits one call.
- **In calls too:** a `poolRoom.ts` serves both, as `chessRoom.ts` does. In a call, one message is
  sent per shot, every client plays it through, and the host's end position wins (#310).
- **The result is ✓ Checked:** the server played every shot.
- **SQL:** `lab_match_playable` names the toys, so adding `'pool'` is a one-line
  `create or replace`, applied with step 7's deploy. Step 8's four toys are added the same way.

## Fitting with the call rooms, without a second copy

- **The rules are shared, not copied.** `room.ts` is peer-to-peer and host-decided over a call;
  `lab-move` is server-decided over Supabase. Both take the same `Rules<G, M>`, so a toy that plays
  in calls is already most of the way to playing by turns.
- **The table is shared:**
  - Step 1 lifts what CallTable needs into a small interface: seats, whose turn, names, act,
    result.
  - `useLabRoom` (calls) and a new `useLabMatch(id)` (by turns) both provide it, so the status
    line, seats, result words and Share wiring are written once.
  - `callWords.ts` becomes `tableWords.ts`.
- **They don't mix at run time.**
  - A toy is in one of: against the computer, with the call, or a match.
  - Opening a match while in a call doesn't touch the call's room, and the call's room never writes
    a match.
- **`lab_online_v1`** (the browser-kept call record) stays as the call record. Match results live
  on the server and are shown from there, so the two never double-count.

## Build order, each step shippable alone

| #   | Step                                                                                                                                                      | SQL / deploy                                            | Ships                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 0   | Pure helpers out of `kept.ts`; a test that no rules module reaches React                                                                                  | none                                                    | Invisible; makes Deno possible                                                      |
| 1   | The shared table interface; CallTable and its words move onto it                                                                                          | none                                                    | No visible change; the call probes must pass unchanged                              |
| 2   | **SQL draft** (with step 9's `lab_results`): tables, `lab_match_may`, RPCs, caps, lazy timeouts, plus `supabase/tests/lab-matches.sql` on the local stack | **drafted, not applied**                                | Nothing until applied                                                               |
| 3   | **`lab-move` edge function draft** for Reversi and Chess, with handler tests in vitest beside the pure rules                                              | **drafted, not deployed**                               | Nothing until deployed; then the CLAUDE.md deploy checks (diff and a refusal probe) |
| 4   | Client: Your games, Challenge from the toy, Accept / Decline, match mode with Send / Undo, Resign, Rematch, for Reversi and Chess                         | needs 2 and 3 live                                      | Async Reversi and Chess                                                             |
| 5   | Bell kind, badge count, profile Challenge button                                                                                                          | needs 2 live                                            | Notices                                                                             |
| 6   | Feed `lab_match` event with the both-friends naming rule, and the "✓ Checked" card                                                                        | needs 2 live                                            | Finished matches in the Feed                                                        |
| 7   | **Pool by turns**, versus first: `poolRoom.ts`, shots played through on the server, the other player's shot replayed for watching                         | `lab_match_playable` replace, and a `lab-move` redeploy | Async Pool                                                                          |
| 8   | Five in a row, Draughts, Dots and boxes, Four in a row                                                                                                    | `lab_match_playable` replace, and a redeploy            | Four more toys                                                                      |
| 9   | Lamps daily duel (`verifyLamps`)                                                                                                                          | `lab_match_playable` replace, and a redeploy            | Puzzles by turns                                                                    |
| 10  | Each "next" toy as its own small draft: a `Rules` object, then a redeploy                                                                                 | a `lab_match_playable` replace and a redeploy each      | One toy at a time                                                                   |
| 11  | Dice and hidden information: `secret`, per-viewer `lab_match_get`, Backgammon first, then Sea battle                                                      | SQL already in 2; redeploy                              | Games that only work by turns                                                       |
| 12  | Rematch by turns from a finished call game; the optional `labmatch:<id>` nudge                                                                            | the nudge needs a `realtime.messages` policy            | Small extras                                                                        |

Each SQL draft and deploy is Evan's to apply, with the checks CLAUDE.md §2 and §3 ask for:

- the `anon` and grant queries from `rpc-inventory.md`;
- a simulated session per player;
- a non-friend refused;
- a diff of the deployed function, and a refusal probe.
