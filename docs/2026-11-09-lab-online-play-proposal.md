# Lab games against other people online — a proposal, nothing built or applied

_9 Nov 2026, on `claude/lab-round-2`. Evan's friend asked to "be able to challenge other people"
and to "fight against people" at Stackfall. What is built on this branch plays against the computer
or against someone at the same keyboard. Playing someone on another device needs one of the two
changes below, and both are outside what the Lab round was authorised to do: one changes the relay
(separately deployed infrastructure), the other adds production SQL. **Nothing here has been done.**
This is the decision, laid out._

## What the games would send

All five new games are deterministic from a seed, which keeps the traffic small. Players exchange
the seed and their decisions, never the game state.

| Game         | Live play needs                                                                                                                 | Fairness                                                                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stackfall    | shared seed; "I sent n junk rows"; "I topped out"; the other well's grid about 5×/s, so you can watch it (≈220 bytes per frame) | both wells already draw the same pieces from one seed; junk gaps come from that seed too                                                                                                     |
| RPS          | one move per round                                                                                                              | **commit-reveal**: each side sends a hash of (move + secret) first, then the move. Without this, whoever answers second can wait and win every time                                          |
| Ten thousand | rolls and keeps, turn by turn                                                                                                   | the roll seed must come from both players (each commits half before either reveals), or the roller can reroll in private                                                                     |
| Hold'em      | bets, plus the deal                                                                                                             | the hard one: somebody has to know the deck. With a host browser dealing, the host can see everyone's cards. Play-chips among friends might accept that, but it should be stated, not hidden |
| Peg drop     | nothing: it is a single-player toy                                                                                              | —                                                                                                                                                                                            |

## Option A: a generic "lab room" in the relay (recommended)

`server/ws-server.js` already does the hard parts for Snake and the park:

- rooms;
- **a Supabase-verified `auth` handshake** (the id comes from Supabase's answer, never from the
  message);
- rate and size limits;
- the stub relay (`scripts/park-stub-relay.mjs`) for two-tab testing.

A Lab room would add three message types:

- `lab-open` (game id and seed);
- `lab-join`;
- `lab-say`: an opaque, size-capped (≤1 kB), rate-limited message relayed to the other members.

The relay checks the shape and never needs to understand a game's rules. The rules stay in the
pure modules, which the tests already cover.

- **Cost:** no new service. The relay is already running.
- **Risk:** the relay is shared with Snake and the park, so the change needs its own tests in
  `server/lib/` (the pattern `settings.mjs` set) and a separate deploy of the relay.
- **Needs approval for:** editing and deploying the relay.

## Option B: Supabase Realtime broadcast with private channels

Clients join `realtime` channels named per match. Authorisation comes from RLS policies on
`realtime.messages`.

- **Cost:** no relay change, but **production SQL** (the policies), and Realtime becomes a second
  live path beside the relay. That is §5's "one home per thing" in reverse: two places a match
  could live.
- **Needs approval for:** the production policies.

## Smaller first step, no infrastructure at all

**"Beat my run" links.**

- A Stackfall survival run is fully determined by its seed and your inputs. A link carrying the
  seed (for example `#lab?demo=stack&seed=…&beat=192.4`) gives a friend the exact same pieces in
  the exact same order, and the page tells them whether they lasted longer.
- Ten thousand works the same way, with a seed for every roll.
- This is asynchronous rather than live, but it is a real head-to-head on identical luck, and it
  travels through the comments and chat that already exist.
- It changes nothing outside the Lab, so it could be built under the current authorisation if
  Evan wants it before deciding on A or B.

## Questions for Evan

1. Live play: relay (A), Realtime (B), or neither for now?
2. Hold'em with friends: accept that the host's browser deals, or wait for a dealer on the relay
   (it would deal and reveal cards only to their owners)? That is more relay work, but it is the
   only honest version.
3. Build the "beat my run" links now?
