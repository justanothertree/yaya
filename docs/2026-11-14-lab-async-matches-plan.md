# Lab matches by turns: play now, they move later

_14 Nov 2026. A plan only: no migration, no SQL run anywhere, no source change. Everything marked
"draft" below is for Evan to apply. It builds on the live call play (#297, #319, #324) and the
verified-result design (steps 9–11 of `2026-11-13-lab-social-plan.md`), and replaces neither._

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

| Group                    | Toys                                                                                                                                             | Why                                                                                                                                                                                                                                      | When         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **First**                | Reversi, Chess, Five in a row, Draughts, Dots and boxes, Four in a row                                                                           | Perfect information, no dice, and a `Rules` object that already replays a move list (`reversiRoom.ts`, `chessRoom.ts`, `gomokuRoom.ts`, `draughtsRoom.ts`, `dotsRoom.ts`, `fourrowRoom.ts`)                                              | Steps 3–6    |
| **Daily duel**           | Lamps, and the other daily puzzles later                                                                                                         | Not turns: both of you solve the same day's board, and the fewest presses wins. `verifyLamps` already checks a solve.                                                                                                                    | Step 8       |
| **Next, rules to write** | Mancala, Nine men's morris, Hex, Ultimate noughts, Breakthrough, Fences, Chinese checkers, Go 9×9, Fox and geese, Noughts and crosses in a cube  | Perfect information and pure modules, but no `Rules` object yet. Each is about a day, as #320–#322 were.                                                                                                                                 | Step 9       |
| **Only by turns**        | Backgammon, Yacht, Ten thousand, Shut the box (dice); Sea battle (hidden fleets); Gin rummy, Cribbage, Crazy eights, Dominoes (hidden hands)     | In a call, whoever deals can see everything. A server that rolls and deals, and shows each player only their own hand, makes them fair.                                                                                                  | Step 10      |
| **Not by turns**         | Hockey, Gust, Bricks and the other real-time toys; Hearts, Spades, Liar's dice (three or four seats); Twenty-one (no opponent); Lamps _together_ | Real time has no turns to save. Four-seat games by turns would mean waiting on three people, so they stay in calls.                                                                                                                      | —            |
| **Later, with care**     | Pool                                                                                                                                             | It's the iPhone 8-ball model: a shot is a turn, and the shot (angle, power, spin) is sent and simulated on the server. That needs `pool.ts`'s physics to give the same answer in Deno as in every browser, which must be measured first. | Its own plan |

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

| #   | Step                                                                                                                                                      | SQL / deploy                                 | Ships                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------- |
| 0   | Pure helpers out of `kept.ts`; a test that no rules module reaches React                                                                                  | none                                         | Invisible; makes Deno possible                                                      |
| 1   | The shared table interface; CallTable and its words move onto it                                                                                          | none                                         | No visible change; the call probes must pass unchanged                              |
| 2   | **SQL draft** (with step 9's `lab_results`): tables, `lab_match_may`, RPCs, caps, lazy timeouts, plus `supabase/tests/lab-matches.sql` on the local stack | **drafted, not applied**                     | Nothing until applied                                                               |
| 3   | **`lab-move` edge function draft** for Reversi and Chess, with handler tests in vitest beside the pure rules                                              | **drafted, not deployed**                    | Nothing until deployed; then the CLAUDE.md deploy checks (diff and a refusal probe) |
| 4   | Client: Your games, Challenge from the toy, Accept / Decline, match mode with Send / Undo, Resign, Rematch, for Reversi and Chess                         | needs 2 and 3 live                           | Async Reversi and Chess                                                             |
| 5   | Bell kind, badge count, profile Challenge button                                                                                                          | needs 2 live                                 | Notices                                                                             |
| 6   | Feed `lab_match` event with the both-friends naming rule, and the "✓ Checked" card                                                                        | needs 2 live                                 | Finished matches in the Feed                                                        |
| 7   | Five in a row, Draughts, Dots and boxes, Four in a row                                                                                                    | a `lab-move` redeploy                        | Four more toys                                                                      |
| 8   | Lamps daily duel (`verifyLamps`)                                                                                                                          | a redeploy                                   | Puzzles by turns                                                                    |
| 9   | Each "next" toy as its own small draft: a `Rules` object, then a redeploy                                                                                 | redeploys                                    | One toy at a time                                                                   |
| 10  | Dice and hidden information: `secret`, per-viewer `lab_match_get`, Backgammon first, then Sea battle                                                      | SQL already in 2; redeploy                   | Games that only work by turns                                                       |
| 11  | Rematch by turns from a finished call game; the optional `labmatch:<id>` nudge                                                                            | the nudge needs a `realtime.messages` policy | Small extras                                                                        |

Each SQL draft and deploy is Evan's to apply, with the checks CLAUDE.md §2 and §3 ask for:

- the `anon` and grant queries from `rpc-inventory.md`;
- a simulated session per player;
- a non-friend refused;
- a diff of the deployed function, and a refusal probe.
