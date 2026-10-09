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
3. **Waves and boss in the scene.** Both are already host-run today; this makes everyone see them.
4. **Doors.** Needs 1 and 3, and is the payoff: a shared world you can walk between.

⚠️ **Step 1 is worth shipping alone** and steps 2–4 are not blocked on each other. A design that
only pays off when all of it is finished is a design that does not get finished.

## What this does not do

- It does not make the park authoritative. Positions stay as they are: each person's own body is
  their own message, and the scene says only what room everyone is in. Making the host simulate
  everybody is a different and much larger thing, and the park has never wanted it (see the boss
  note in `room.ts`: "an echo, not a simulation").
- It does not survive the host leaving. The room closes when they go, like Snake's does. A room
  that outlives its host needs a host election, which is a lot of machinery for eight people.
