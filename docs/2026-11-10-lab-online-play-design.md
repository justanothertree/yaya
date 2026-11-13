# Lab online play — a design to decide together

_10 Nov 2026. A proposal only: nothing here is built, applied or deployed. It goes further than
`2026-11-09-lab-online-play-proposal.md` (which set out the two routes) by saying what each game
would actually need, how it would fail, and what to build first. "Beat my run" links (#99) already
give asynchronous head-to-heads without any of this._

## Recommendation in one paragraph

Add a **Lab room** to the existing relay (`server/ws-server.js`), modelled on its `fight:` bouts:

- signed-in only, through the relay's existing Supabase-verified `auth` handshake;
- two to four seats;
- the relay forwards small opaque game messages and never learns a game's rules.

Ship it game by game in this order:

1. **Rock-paper-scissors**: the smallest protocol, and it proves commit-reveal.
2. **Stackfall versus**: the friend's ask.
3. **Ten thousand**.
4. **Hold'em** last, and only with the relay dealing.

No database change is needed for live play. One is needed only if you later want results or
leaderboards kept.

## What the relay already gives us

- **Rooms with caps:** `MAX_ROOMS` 500 and `MAX_CLIENTS` 400, with per-park client caps.
- **Size limits:** a 32 kB frame ceiling enforced before buffering (`maxPayload`), and per-message
  length limits.
- **Rate limits:** chat bursts (5 per 4 s) and auth attempts (5 a minute).
- **Sign-in:** the `auth` handshake. The account id comes from Supabase's answer, never from the
  message, and a check that fails stays closed.
- **Precedent:** `fight:` rooms already carry two people's moves frame for frame. A Lab room is the
  same shape with a different payload.
- **Testing:** `scripts/park-stub-relay.mjs`, a stand-in relay for two-tab testing, which is how
  co-op was verified.

## The relay change (option A)

- **Room id:** `lab:<game>:<random>`, made by the host's page and shared as a link, the same way a
  Snake room is.
- **Messages:**
  - `lab-open {game, seats}`
  - `lab-join`
  - `lab-say {payload}`: opaque, at most 1 kB, at most 30 a second per socket
  - `lab-leave`
- **Rules the relay enforces:** signed-in only, seats capped by game, a room closed 10 minutes after
  it empties, and nothing stored.
- **Where the rules live:** in the pure modules that already exist (`stack.ts`, `rps.ts`,
  `dice.ts`, `poker.ts`). The relay never parses a game.
- **Testing:** the decision logic goes in `server/lib/lab.mjs` with its own tests, the pattern
  `settings.mjs` set. The browser side gets a two-tab probe through the stub relay.
- **Deploy:** the relay is deployed separately from the site, and **that deploy is yours to
  approve**. It also carries voice calls (`/ice`) and the park, so the change has to leave those
  untouched. The tests should show it does.

## Per game: what travels, and how it could be cheated

| Game                | Messages                                                                                                 | Cheating risk, and the answer                                                                                                                                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rock-paper-scissors | `commit hash(move+nonce)`, then `reveal move+nonce`                                                      | Whoever answers second could wait and win. **Commit-reveal** means neither side sees a move before both are locked. Refusing to reveal counts as a forfeit.                                                                               |
| Stackfall versus    | a shared seed; "sent n junk rows"; "topped out"; the other well about 5 times a second (about 220 bytes) | A modified client could claim junk it never earned. Both wells draw from one seed, so a client could re-simulate the other's claims from its inputs. Recommended to start: trust friends, and cap junk per piece at what the rules allow. |
| Ten thousand        | each player commits half of the roll seed before either reveals, then turns as messages                  | The roller could re-roll in private. **Two-party seed:** a roll exists only once both halves are revealed. The `dealRand` from #99 already makes dice a pure function of the seed.                                                        |
| Hold'em             | bets; hole cards dealt privately                                                                         | Somebody has to know the deck. If the host's browser deals, **the host sees every hand**, which is not acceptable even for play chips. Options are listed below.                                                                          |

### Hold'em, specifically

1. **The relay deals.** It shuffles, sends each player only their own two cards, and reveals the
   board and the showdown. That's about 150 lines of relay code using the existing `poker.ts`
   ranking, and it is the only honest version that is also simple. **Recommended.**
2. **Mental poker** (cryptographic shuffling between browsers). This needs no trusted dealer, but
   it's complex and slow on phones. Not worth it for play chips.
3. **Host deals, labelled "friends only, host can see the cards".** Simple, but it invites exactly
   the distrust the game is meant to avoid. Not recommended.

## Option B, for comparison: Supabase Realtime

Private broadcast channels, authorised by policies on `realtime.messages`.

- **Pros:** no relay change.
- **Cons:**
  - **Production SQL** (the policies);
  - a second live path beside the relay (CLAUDE.md §5's "one home per thing");
  - no server-side dealer for Hold'em.

So it handles rock-paper-scissors, Stackfall and the dice, but not poker. Not recommended unless
the relay is off limits.

## Risks

- **The relay is shared.** A Lab-room bug could disturb Snake, the park or calls. The mitigation is
  the separate test module and the caps, and the Lab-room code never touches the other message
  types.
- **Abuse:** strangers in rooms. Signed-in only, rooms shared by link, no public lobby, and no free
  text beyond the existing chat filters.
- **Phones:** background tabs drop sockets. Each game needs an explicit pause or forfeit on
  disconnect, and Stackfall needs a grace period.
- **Testing reach:** two tabs through the stub relay cover the logic. Real latency and a real
  second device are yours to try after a deploy.

## Questions for you

1. Relay (A) or Realtime (B)? I recommend A.
2. The order: rock-paper-scissors, then Stackfall, dice, Hold'em?
3. Hold'em with the relay dealing, or leave Hold'em offline?
4. Keep results anywhere? Doing so needs a table and production SQL, so it's a separate decision.
   Otherwise live play leaves no record beyond the comments people write.
