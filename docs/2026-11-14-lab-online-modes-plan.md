# Online versus and co-op in Lab call rooms: which toys first, and how

_14 Nov 2026. A plan, plus the first three builds as separate drafts. No SQL, no relay change, no
deploy. Steps 9–11 of `2026-11-13-lab-social-plan.md` (checked cards) stay on hold._

## What already exists, and what stays the same

- **The room.** #297 shipped `src/lab/social/room.ts`: a two-seat room, carried by the call itself
  (the party's `lab` messages on the call's private channel).
  - The lowest user id on the toy is the host. It alone changes the room, sending it whole with a
    sequence number.
  - A move is checked by the toy's own pure rules.
  - A seated player who leaves pauses the game. Their seat is held for 60 s, then freed.
  - Four in a row plays versus on it today.
- **The gate.** Unchanged: friends only, never the Lounge, failing closed (`gate.ts`). A stranger
  joining the call ends the room at once, and a player left alone is offered "carry on against the
  computer".
- **What this adds:**
  - a lobby on the same room, with a mode (versus or co-op) chosen by a seated player;
  - a computer seat that the host plays, for "the two of you against the computer";
  - a record of online results, so a finished match offers **Share your score** with a Recorded
    card, like every other result.

## Cost decides turn-based first

Everything rides Supabase Realtime, the same quota as voice signalling:

- 2 million messages a month on the Free plan;
- about 100 a second;
- each message counted per client it reaches.

How the two kinds of game compare:

- **A turn-based move** is one send plus one delivery per person. A whole chess game is a few
  hundred messages.
- **A real-time game** is a different animal. Hockey at 20 updates a second with two players and
  one spectator is about 20 sends and 60 deliveries a second: roughly **290,000 an hour**, near
  the per-second ceiling. A month's quota would be gone in seven hours of play.

So real-time toys wait for the relay, which has no per-message cost (Option A of
`2026-11-09-lab-online-play-proposal.md`). The admin meter from #297 will show the real figure
for the turn-based ones.

## The picks

| Toy                                                                                 | Versus                                            | Co-op                                                           | Sync                                                                       | First wave?                                                  |
| ----------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Reversi**                                                                         | seat vs seat                                      | the two of you vs the computer, taking the team's moves in turn | turns, whole board                                                         | ✅ build 1                                                   |
| **Chess**                                                                           | seat vs seat                                      | team vs the computer, alternating                               | turns, move list replayed                                                  | ✅ build 2                                                   |
| **Lamps**                                                                           | race: same daily board, one each, first dark wins | one board, both press, no turns                                 | presses                                                                    | ✅ build 3                                                   |
| Four in a row                                                                       | already online                                    | team vs computer, the same pattern as reversi                   | turns                                                                      | next: a few lines once build 1 lands                         |
| Draughts, gomoku, dots, ultimate, mancala, morris, halma, hex, breakthrough, fences | seat vs seat                                      | team vs computer                                                | turns                                                                      | next wave: each is `Rules` plus a lobby                      |
| Pool                                                                                | shot by shot                                      | —                                                               | one message per shot; every client simulates, the host's end position wins | after: needs a deterministic replay of a shot                |
| Sea battle                                                                          | —                                                 | —                                                               | **hidden ships**                                                           | needs commit-reveal: the whole state would show your fleet   |
| Backgammon, yacht, dice games                                                       | —                                                 | —                                                               | **dice**                                                                   | needs a jointly committed seed, or the host chooses the dice |
| Hockey, gust, bricks                                                                | —                                                 | —                                                               | real-time                                                                  | wait for the relay (cost, above)                             |

**Why these three first:**

- **Reversi and chess** both have a computer opponent at three levels, which Together needs. Each
  gets both modes from one change, and they test the two ways of sending a game: a small board
  sent whole, and a move list replayed.
- **Lamps** is the natural co-op. Pressing a lamp commutes, so two people pressing at once can
  never conflict: the board is the same whatever order the presses arrive in. It already has a
  replayable, verifiable solve (`verifyLamps`, from #297's step 8).

## The lobby

- Opening a toy that is online-ready, while in an allowed call, shows **Play with your call**
  beside the toy's own modes. Choosing it puts you in the room.
  - Two seats, then everybody else watches.
  - A seated player picks **⚔️ Versus** or **🤝 Together**. For the board games, Together is the
    two of you against the computer, at a level the picker chooses.
  - The pick, like a new game, is the host's to apply. It is refused while a game is under way, so
    nobody can change the game under someone else's move.
- **Spectators** see the board, the seats, whose turn it is, and the result. They can take a free
  seat. They can't move, pick a mode or start a new game.
- **The room's state** gains `mode` and, for co-op, `level`, with the same rules as everything else
  in it:
  - sent whole;
  - checked on arrival;
  - a newer `seq` wins.

## Turns, the computer, and disconnects

- **Versus:** seat 0 is the side that moves first, as in Four in a row.
- **Together vs the computer:**
  - Both seats play one side and take that side's moves in turn: A, computer, B, computer. Neither
    can play twice running, so it is a team rather than a race to click.
  - **The host plays the computer.** When it is the computer's turn, the host's browser chooses
    with the toy's own AI, after a short pause so the move can be seen. It then publishes the move
    like any other.
  - If the host changes mid-game, the new host carries on: the computer is a seat, not a person.
- **Lamps:**
  - Together: either seated player presses at any time, and the host applies presses in the order
    they arrive.
  - Race: each seat has its own copy of the same board, and the first to put theirs out wins.
- **Disconnects:**
  - **Versus, or a team's turn:** the game pauses with "Waiting for Bo…". The seat is held 60 s,
    then freed, and anybody can take it.
  - **A teammate gone longer than that:** the one left takes every team move.
  - **Lamps Together:** never waits. The other player simply carries on.
  - **The call or the gate going away:** as in #297. The room ends, and a seated player left alone
    is offered to carry on against the computer, or alone, from that board.
- **Wire safety:** every board or move list arriving from another client is decoded by the toy's
  own rules and refused if no game could reach it.
  - **Chess** sends its move list and replays it from the start, so an illegal position can't even
    be described.
  - **Lamps** replays its presses through `press`.

## Share your score

- A finished online match is recorded in this browser under one key, `lab_online_v1`, per toy:
  - versus: won, lost, drawn;
  - together: won and lost.
- The toy's existing share reader adds a phrase, e.g. "Reversi: …, beat friends online in 3 of 5
  games". The comment flow then offers **🏆 Share your score** as it already does for a new result.
- A spectator records nothing. Only the two seats do, each for themselves.
- The card stays **Recorded**, not checked. A verifiable online result would need the room's
  move list stored server-side, which belongs with steps 9–11.

## What each build is checked with

- `room.test.ts`'s in-memory network, extended to:
  - the lobby;
  - the computer seat;
  - a host leaving mid co-op;
  - commuting Lamps presses.
- **Two `#dev-call` tabs in one browser,** standing in for two players:
  - pick a mode, play to the end, and see Share offered;
  - a spectator tab;
  - a tab closed mid-game.
- **Then on phone and desktop:**
  - the layout audit;
  - keyboard only;
  - reduced motion;
  - nothing left listening or ticking after leaving the toy.
