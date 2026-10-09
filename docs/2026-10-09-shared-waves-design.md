# A crowd on the wire — design, before any of it is built

Step 4 of `docs/2026-10-09-park-lobby-design.md`, and the one that document deliberately refused to
sketch: _"a shared wave needs drift correction, and that is its own piece of work with its own
design. Saying 'the scene carries a wave number' would ship the appearance of it."_

This is that design. Nothing here is built.

## The old answer was the wrong shape, and two comments say so in the same words

Two places in the code describe what a shared wave needs, and they agree with each other:

> A wave that spawns from a seed everyone has and steers by positions everyone already receives
> would keep that bargain, **but derived motion drifts and nothing here corrects it yet.**
> — `ParkRoom.tsx`

> What that still needs before it can be trusted is **a correction channel**, because floating
> point drifts and derived motion cannot be allowed to drift forever.
> — `swarm.ts`

Both assume the crowd is **derived** and ask for something to correct it. That framing survives
exactly as long as it takes to look at what would actually diverge, which is three things, and only
one of them is drift:

| what differs between two machines  | is it drift?                                |
| ---------------------------------- | ------------------------------------------- |
| `dt` — each client's frame cadence | yes, and correctable                        |
| `seek` — what the crowd is chasing | **no.** See below                           |
| who decided a minion was hit       | **no.** Each client resolves its own swings |

⚠️ **THE SECOND ROW IS FATAL AND IS NOT DRIFT.** `stepSwarm` is called with
`toHeights(you.current)` — **your own creature**. Two people in one park would not watch one crowd
diverge slowly; they would watch two different crowds, each chasing its own viewer, from the first
frame. No correction channel fixes that, because nothing is wrong: each machine is correctly
simulating a different fight.

⚠️ **AND THE THIRD IS THE SAME SHAPE.** Health hangs off each mob (`hp`, `cut`, `zapped`, `bit`),
and every client stamps its own swings onto its own copy. Two machines would disagree about which
minions are still alive, which is not a rounding error either.

So: a correction channel that fixed all three would have to carry positions and health. That is an
**echo** — and the park already has an echo, working, for one creature. "Derive and correct"
converges on "echo and smooth" the moment you count what it has to correct.

## The claim that blocked this for months, measured

Everything above rests on an echo being affordable, which is the one thing the existing notes
assert without checking:

> Fifty minions cannot each be a message.

That is **true, and it answers a question nobody asked.** Fifty minions are not fifty messages.
They are one message. Measured — `waveSize(no) = 10 + (no - 1) * 6`, straight from `ParkRoom.tsx`,
and one `walk` message is 79 characters:

| wave | mobs | naive JSON | flat ints | packed b64 | flat kB/s @15Hz | = this many walkers |
| ---: | ---: | ---------: | --------: | ---------: | --------------: | ------------------: |
|    1 |   10 |        407 |   **139** |         79 |             2.0 |                 1.8 |
|    3 |   22 |        911 |   **290** |        143 |             4.2 |                 3.7 |
|    5 |   34 |      1,407 |   **436** |        207 |             6.4 |                 5.5 |
|   10 |   64 |      2,693 |   **804** |        367 |            11.8 |                10.2 |
|   15 |   94 |      4,203 | **1,172** |        527 |            17.2 |                14.8 |
|   20 |  124 |      5,680 | **1,538** |        687 |            22.5 |                19.5 |

A wave-1 crowd costs **less than two extra people walking about**. The first several waves are
cheaper than the room already is with four friends in it.

⚠️ **MESSAGE SIZE NEVER BINDS.** `MAX_MSG_BYTES` is 32,768 — and the 12,000 figure quoted around
this codebase is `MAX_LOOK_BYTES`, which caps a _drawing_, not a message. Three comments cited it as a
general message limit and have been corrected; the conclusions they supported were right either
way. The flat form fits one
relay message up to about **2,680 mobs**, which is wave 446. Nothing about this feature is limited
by what the relay will carry.

⚠️ **AND THE BURST CEILING IS PER TYPE.** `WALK_BURST` is 45 a second, but `walk` counts into
`st.walkTimes` and `bstep` into `st.bstepTimes` — separate arrays. A crowd echo gets its own 45,
so 15Hz sits at a third of its own budget and takes nothing from the host's walk.

⚠️ **SO THE FLAT FORM WINS, AND BIT-PACKING IS PREMATURE.** Base64 packing is about 2.2× smaller
and considerably harder to read, validate and debug. Nothing binds at either size, so the simple
one is correct here — and it can be swapped later without the design changing, because the shape
on the wire is "positions and health", not "these exact bytes".

## The shape: the crowd is an echo, and all three rules already exist

Not one of these is new. Each is a rule the boss already follows, carrying forty bodies instead of
one.

**1 · One machine runs the crowd — whoever called it.** Exactly `room.boss`: the relay holds one
crowd per park, replays it to whoever joins, and drops it when the runner leaves.

⚠️ **WHOEVER CALLED IT, NOT THE ROOM'S HOST**, although the lobby just made the host the arbiter of
the scene. The host arbitrates **which map we are standing in**, because that is one fact for the
whole room and a room where everybody asserts it disagrees. A crowd is not that: it is a thing
somebody stood up, like a boss, and the boss's model is already built, already debugged, and
already understood by this file's neighbours. Two mechanisms that differ only in who runs them
would be a question at every future review.

**2 · Positions are echoed and eased.** `BossEcho` carries both `at` and `shown` for exactly this
reason — what arrives is where it is, what is drawn is eased toward it. Forty of those is the same
code forty times.

⚠️ **AND VIEWERS GET CHEAPER, WHICH IS THE OPPOSITE OF WHAT THE DERIVED PLAN DID.** `swarm.ts` is
emphatic that "drawing is culled and thinking is not" — every client steps every mob today, O(n²).
Under an echo, only the runner thinks; everybody else eases toward numbers they were handed. Four
of five machines in a five-person park stop paying for the crowd entirely.

**3 · Each hit is decided where the thing being hurt lives.** The park states this twice already,
once in each direction, and both apply unchanged:

> ⚠️ **AND WHOEVER CALLED THE BOSS DECIDES WHAT IT TAKES.** Everybody's swing is tested against the
> boss on the one machine running it, using the attacker's OWN drawing — so a friend's hit is worth
> exactly what their creature's move is worth, and **no damage number ever crosses the wire** for
> anybody to make up.

> ⚠️ **I DECIDE WHEN I AM HIT, NOT THEM.** […] Letting the swinger decide would mean being shoved
> by somebody else's picture of where you were standing.

So: **a player's swing is resolved on the runner**, out of the swing slot, position and aim that
already arrive on `walk`, against the attacker's own move table in `foeMoves` — nothing new goes
over the wire, and `cast.ts`'s opening line survives intact. **A minion's bite is resolved on the
victim's screen**, out of the position and bite flag the echo carries.

⚠️ **THIS IS THE PART WITH A KNOWN FAILURE MODE, AND IT HAS ALREADY HAPPENED ONCE.** CLAUDE.md
records "a friend's cast landing for nothing on the host's boss — a flag shared with their swing,
dead for weeks". The same `spent` flag that broke for a boss is the flag a crowd needs **per
minion**, which `ParkRoom` already knows for the local case: _"a stamp per minion rather than the
swing's own `spent` flag […] `spent` is a single flag, so against a crowd it would mean a swing
fells ONE of forty."_ A remote attacker's swing therefore needs a per-minion stamp keyed by
attacker, not one `o.spent` per peer. **That is the bug this feature will have**, and it is worth
writing down before rather than after.

## The wire

```ts
/** where the crowd is, from the one machine running it. See cstep. */
{ type: 'cstep'
  /** x,y interleaved, each 0..4095 across the world — two per mob, in spawn order */
  p: number[]
  /** health 0..15 per mob; 0 means felled, and the index is the same mob as in `p` */
  h: number[]
  /** a bitfield per 30 mobs: which of them are mid-bite. The victim decides if it landed */
  b: number[]
}
```

- `{ type: 'wave', name, art, no, seed }` stands one up, like `boss` — it carries the drawing once.
- `cstep` at `SEND_HZ`, like `bstep`.
- The relay refuses a `cstep` from anybody who is not the crowd's runner, the same line `bstep`
  already has: `if (!room.crowd || room.crowd.by !== id) break`.

⚠️ **ORDER IS THE IDENTITY, AND THAT IS WHY NOTHING IS EVER REMOVED FROM THE ARRAY.** A felled
minion stays in `p` with `h: 0`, because an index is how a viewer knows which eased position
belongs to which body. Compacting the array would silently re-point every mob after the gap at
somebody else's coordinates — forty creatures teleporting one slot left, which would read as a
physics bug and be an indexing one.

⚠️ **AND THE SEED STOPS BEING THE ANSWER.** It stays, because a reproducible ring is worth having
and `swarm.test.ts` pins it — but it is a compression of the **spawn**, not of the fight. Under an
echo a late joiner does not replay the wave from its seed; it is handed where everything is.

## What has to change in `swarm.ts`, and it is pure

`stepSwarm(mobs, seek, dt, tune)` takes **one** seek point. A crowd in a room with four people in
it has to chase somebody, and "the runner" is the wrong answer — it would make a wave a fight the
host has while everyone else watches.

So the crowd wants the **nearest** player per mob. That is a pure change to a pure module with a
unit test for every part of it already, which is where this design wants its new logic to land:

```ts
export function stepSwarm<T extends Mob>(
  mobs: T[],
  seek: Spot | Spot[], // one target, or everybody in the room
  dt: number,
  tune: Flock = FLOCK,
): T[]
```

⚠️ **NEAREST PER MOB, NOT NEAREST TO THE CROWD'S CENTRE.** A single target for the whole crowd
makes forty creatures change their minds at once when somebody crosses the midpoint — a tide that
flinches. Choosing per mob is what splits a crowd around two players standing apart, which is the
thing co-op is for.

⚠️ **AND IT MUST BE WRITTEN FROM THE WORLD'S SHAPE.** CLAUDE.md is specific about this module: the
test for "the crowd splits" asks how many mobs are closer to each player after N seconds, measured
in footprints, not in whatever `stepSwarm` happened to compute. The existing `apart()` /
`outBy()` discipline applies — a test built from the same sum as the code confirms the mistake.

## What this makes untrue

Three live comments assert the old plan and must change with it, or the next person reads a design
that was abandoned:

- `swarm.ts`'s header — _"DETERMINISTIC FROM A SEED, WHICH IS THE WHOLE MULTIPLAYER ANSWER IN
  EMBRYO"_ and the "correction channel" sentence. It is not the multiplayer answer; it is a
  reproducible spawn.
- `ParkRoom.tsx`'s _"derived motion drifts and nothing here corrects it yet"_.
- `ParkRoom.tsx`'s _"ON A DRAWN MAP ONLY, AND THAT IS A DELIBERATE CEILING"_ — the ceiling is the
  thing being lifted.

## The cap this forces, and a ceiling that is already missing

⚠️ **`waveSize` HAS NO CAP TODAY, AND THAT IS ALREADY A PROBLEM WITHOUT ANY OF THIS.**
`waveSize(no) = 10 + (no - 1) * 6` runs forever: wave 49 is **300 mobs**, and `swarm.ts` says of
its own step that O(n²) "stops being fine somewhere around three hundred". Nobody has reached wave
49, which is why nothing has caught it — but it is a single-player frame-rate cliff with no guard,
not something this feature introduces. It should be capped on its own merits, and a shared crowd
needs the cap to exist anyway.

The binding constraint is **not** the wire (2,680 mobs) and **not** the relay's burst (its own 45 a
second). It is the runner's own machine: O(n²) at around 300, and an upload of 22 kB/s at wave 20.
A cap belongs where the simulation stops being honest, which is the smaller of those.

## Order to build it, and what each step is worth alone

1. **`stepSwarm` takes a list of targets and each mob picks the nearest.** Pure, tested, and worth
   shipping on its own — it is the right behaviour in single-player too the moment a park has a
   dummy or a friend's minion standing in it.
2. **Cap `waveSize`.** Independent of everything else, fixes a latent cliff, one line and a test.
3. **`wave` + `cstep` on the wire, runner-only at the relay.** The crowd becomes visible to
   everybody. Testable with two tabs on the stub relay — the relay half is the only part that
   cannot be, and the stub forwards unknown types with `from` attached, so it rides for free.
4. **Remote swings resolved on the runner, per-minion stamps keyed by attacker.** The part with the
   known failure mode. Until it lands, a guest can see the crowd and cannot fight it — which is
   worth shipping as a step, and must be _said_ rather than left to be discovered.
5. **Minions' bites resolved on each victim's screen.** The mirror rule, and the point at which a
   wave is a fight everybody is in.

⚠️ **STEPS 1 AND 2 ARE NOT BLOCKED ON THE RELAY**, which matters because the relay deploys by hand.
A design that only pays off after a manual deploy is a design that waits.

## What this does not do

- It does not make the park authoritative about **players**. Positions stay as they are: each
  person's own body is their own message. The crowd is one more echo, not a server.
- It does not survive the runner leaving. The crowd goes when they go, like the boss and like the
  scene. A crowd that outlived its runner would need a hand-off election, which is a lot of
  machinery for eight people.
- It does not make a wave arrive on its own. A wave is still called out, for the reason already
  written down: a map you drew is also somewhere to walk about.
