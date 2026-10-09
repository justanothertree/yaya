# The park as a hosted lobby — design, before any of it is built

Asked for in these words: _"why cant a person just host a lobby like snake and edit/update the
settings for everyone in real time even loading maps, starting waves, ect. so when a person can
join lobby or accept invite and they get the map with its assets and stuff"_ — plus the question
that comes with it, _"how is a doorway going to work for multiplayer?"_

This is the design. Nothing here is built.

## Why this is the right shape, and what already exists

The park's relay carries presence, a look, a swing and a boss. Every one of those is a fact about
**one person's own body**, which is why the room needs no host: nobody's message can contradict
anybody else's. A map is not that. "Which map are we standing in" is one fact for the whole room,
and a room where everybody asserts it separately is a room that disagrees.

That is what a host is for. Not permission — **arbitration**.

Three pieces already exist and this builds on them rather than replacing them:

| exists                       | does                                                      |
| ---------------------------- | --------------------------------------------------------- |
| `park_rooms` (one per owner) | the room, its audience, its invites                       |
| relay room named `park:<id>` | two people in one relay room are on one map, structurally |
| `park_maps` + `park_map_get` | the map is fetchable by anyone allowed in                 |

What is missing is one thing: **nothing on the wire says what the host has decided.**

## The wire

One new message, both directions. The host sends it; the relay forwards it; everyone else obeys
it. It is deliberately one message rather than five, because the thing being described is a
single state and five messages is five chances for them to disagree.

```ts
/** what the host says the room is doing. Only the host's copy is ever believed. */
type Scene = {
  /** which map, by the id every client can fetch — never the map itself */
  map: string | null
  /** 0 when nothing is out; otherwise the wave number everyone should be seeing */
  wave: number
  /** a boss is up, and which drawing it is — the art already travels, see packLook */
  boss: string | null
  /** bumped by the host on every change, so a late or out-of-order frame is ignorable */
  at: number
}
```

- `{ type: 'scene', scene: Scene }` — host → relay → everyone.
- A client that is **not** the host never sends one. If it does, the relay drops it (below).
- On join, the relay replays the room's last `scene` to the newcomer, exactly as it already
  replays who is present.

⚠️ **The map is an id, never the document.** The relay refuses anything over 12,000 characters and
a map is up to 2MB. Everything this feature does rests on the map being _fetchable_, which is why
`park_maps` had to come first.

⚠️ **`at` is a counter, not a clock.** Two machines' clocks disagree by seconds; a counter the
host owns cannot. A client ignores any scene whose `at` is not greater than the last it accepted,
which makes reordering and duplication harmless without anybody timestamping anything.

## Who is the host, and what stops somebody else claiming it

`park_rooms.owner` already answers this, and it is answered **server-side** — the relay asks
Supabase who a socket belongs to before it will show that person to anybody (CLAUDE.md: "The real
relay refuses to show one person to another until Supabase has verified their token server-side.
That door is correct and must not be weakened").

So the rule is one line in the relay: **a `scene` from a socket whose verified user is not the
room's owner is dropped.** Not "ignored by other clients" — dropped at the relay, because a client
that can be lied to is a client that will be.

⚠️ **This is the one piece that cannot be done client-side.** Everything else in this document is
a client change. If the relay cannot be taught this rule, the honest fallback is that the host's
scene is advisory and a malicious guest can desync the room — which is acceptable among eight
friends and not acceptable as a design, so it should be the relay.

## What a client does with a scene

```
scene arrives
  → at <= lastAt ?            ignore
  → map differs from mine ?   fetch it, THEN swap the world; never swap first
  → map could not be fetched ? leave the room and say so — do not stand on the old one
  → wave/boss differ ?        follow
```

⚠️ **Fetch, then swap — never the other way round.** Swapping first leaves somebody standing on
the previous world for the length of a request, which is the exact disagreement the old blanket
refusal in `joinPark` existed to prevent. The current visit path already does it in this order and
this must not regress.

⚠️ **A fetch failure leaves the room.** The alternative is a person standing in a park everybody
else can see and they cannot, bumping into hedges that are not there. That was the original
argument for refusing drawn maps at all, and it is still right — it just has an answer now.

## Doorways

This is the question that forced the design, and the lobby answers it.

A `Door` points at a map **name**, and today walking through one swaps your world locally. In a
room that gives two bad options: everybody follows (but nothing tells them to), or whoever walks
through silently leaves the party.

In a lobby it is neither, because a door is **a request to the host**:

- Guest walks into a door → sends `{ type: 'door', to: '<name>' }`.
- Host receives it, resolves the name **against its own maps**, and if it resolves, publishes a
  new `scene` with the new map id.
- Everyone, including the guest who asked, follows the scene.

⚠️ **The name resolves against the HOST's maps, and that is not a detail.** `Door.to` is a name in
whoever drew the map's own collection — your door to "the caves" means nothing in my account. One
map's doors only ever make sense inside one person's set, so the host's set is the only one that
can be consistent for everybody at once.

⚠️ **A door the host cannot resolve does nothing, visibly.** `mapDoc.ts` already decided a door is
allowed to dangle and should say so when walked into; that stays, it is just the host answering.

### Two things only building it revealed

**The room id survives a map change, and the whole mechanism rests on it.** `open_park_room` ends
with `on conflict (owner) do update … returning id`, so pointing a room at a different map returns
the row that was already there. The relay room is named after that id — so everybody stays in the
same conversation and the scene they are already following tells them where it went. Had it minted
a new id, walking through a door would have scattered the party and left the host alone in the
destination. This is a fact about a function somebody could change, which is why it is written
down rather than relied on silently.

**An ask must be checked against the doors of the map everyone is in, and the relay cannot do it.**
The design said the host "resolves the name against its own maps", which is not enough: a name off
the wire is a name a guest chose, so resolving it only against my maps would let one guest walk the
whole room to **any map on my account** by naming it. The real rule is that the thing asked for has
to be a door **in the map everybody is currently standing in**. The relay cannot judge that — it
does not know what a map contains and must not start fetching them to find out — so the check lives
in the host's client, which is the only place that holds the map. It is one line, and it is the
security property of this feature.

⚠️ **And not the map we are already in.** Re-opening on the same map is harmless in the database and
not on screen: it republishes the scene, which bounces everybody through a leave and a rejoin.
Asked for repeatedly that is a way to keep somebody's park unusable, so an ask for the current map
is ignored.

### What a door costs, honestly

Everybody in the room leaves the relay and rejoins it, because `mapPick` is what the join effect
depends on and a map change is a re-entry by design. The room id is the same, so it is a bounce
rather than a scattering — but it is a visible bounce, and if it turns out to matter the fix is to
let the world change without the socket doing so, which that effect's own note explains is the
thing it exists to prevent. Not worth doing before anybody has felt it.

## What it replaces

The browse-and-join UI collapses. Today a guest picks a host, fetches their map and walks it;
afterwards a guest **joins a lobby** and whatever the host is running is what they get. `visiting`,
the per-map picker entries and the `room` field threaded onto `walkable` all go away — the scene
is the single source of what you are standing in.

The host's own controls stay where they are: open the park, set the door, invite. Starting a wave
and calling a boss become scene changes instead of local ones.

## Order to build it, and what each step is worth on its own

1. **Scene on the wire, map only.** Host publishes which map; guests follow. Replaces the visit
   path. Testable with two tabs on the stub relay.
2. **The relay's owner check.** The one server-side piece. Until it lands, step 1 is friends-only
   and says so.
3. ~~**Waves and boss in the scene.**~~ ⚠️ **WRONG ON BOTH HALVES — see below.**
4. **Doors.** ✅ BUILT. Needs 1 and 2 — not the old step 3, which was wrong. The payoff: a
   shared world you can walk between.
5. **Shared waves.** Needs a design that answers drift. Not started, and deliberately not
   sketched here — see below.

⚠️ **Step 1 is worth shipping alone** and steps 2–4 are not blocked on each other. A design that
only pays off when all of it is finished is a design that does not get finished.

## ⚠️ Step 3 was wrong, and the code already said so

Written as "waves and boss in the scene. Both are already host-run today; this makes everyone see
them." Neither half survives contact with what is already here.

**The boss is already shared, and putting it in the scene would be a second opinion about it.**
`callBoss` sends the art, `bstep` sends position and health at the same rate as a walk, the relay
enforces one boss at a time and replays it on the roster. That is a complete mechanism. A scene
field saying "a boss is up" would be a second place the same fact lives, free to disagree with the
first — which is the duplication this codebase keeps paying to remove.

**A shared wave is not a small step, and the reason is written in ParkRoom already:**

> A wave that spawns from a seed everyone has and steers by positions everyone already receives
> would keep that bargain, **but derived motion drifts and nothing here corrects it yet.**

The seed half is solved — `swarm.test.ts` proves the same seed is the same wave, exactly, and says
why: "Fifty minions cannot each be a message." What is unsolved is that the crowd then STEPS, and
two machines stepping the same crowd at different frame times diverge. A boss gets away with it
because one machine runs it and echoes where it is; forty minions cannot be echoed at fifteen
messages a second, which is the whole reason the seed exists.

So a shared wave needs drift correction, and that is its own piece of work with its own design.
Saying "the scene carries a wave number" would ship the appearance of it: everyone would be told a
fight is happening and only the host would be in it.

**What replaces it:** nothing, for now. Doors are step 3, and waves wait for a design that answers
drift rather than one that hides it.

## What this does not do

- It does not make the park authoritative. Positions stay as they are: each person's own body is
  their own message, and the scene says only what room everyone is in. Making the host simulate
  everybody is a different and much larger thing, and the park has never wanted it (see the boss
  note in `room.ts`: "an echo, not a simulation").
- It does not survive the host leaving. The room closes when they go, like Snake's does. A room
  that outlives its host needs a host election, which is a lot of machinery for eight people.

## What is verified, and what is not

**Verified in the Browser pane** (`#dev-park`, two local maps with a door each way): walking into
a door alone still swaps the world, the swap is caused by the walk and not by time (2.5s idle
changed nothing), and the return trip works — so the new three-way branch did not regress the one
path that does not need an account. `doorMeans` is pinned by six tests in `room.test.ts`, and both
the bug it replaces and the subtler "hosting something is hosting this" bug were reintroduced once
each and watched go red.

**Not verified, and only two signed-in accounts can do it**: a guest's ask reaching a host, the
host moving the room, and everybody following. The host branch calls `open_park_room`, which needs
a session, so the workbench cannot reach it at all — `#dev-park` grants nothing on purpose. The
stub relay forwards unknown message types with `from` attached, so `door` rides over it for free,
but the branch that would send one is unreachable without a room.

⚠️ **And the relay must be redeployed.** The site deploys on push; `server/ws-server.js` does not.
Until it is, a guest's ask is dropped by the `default` case and doors in somebody else's park do
nothing — which is the same as today, not worse.
