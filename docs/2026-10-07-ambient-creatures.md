# Ambient creatures — stamp a creature on a map and it lives there

Asked for as: _"mobs in park that you can agro and farm and they are like swarm minions but not
as wave that hunts you but exists"_, and _"if i stamp a minion or boss on the map editor it
spawns there"_. Those were one feature: a creature standing in the world that is not a wave.

✅ **DONE.** Format, editor and room, for both roles.

## The shape of it

| piece                                              | where                           |
| -------------------------------------------------- | ------------------------------- |
| `Piece.life` — a stamp is alive, and as what       | `src/park/mapDoc.ts`            |
| noticing, the shout, giving up, the leash, walking | `src/park/wild.ts` (+ 21 tests) |
| the two rows in the stamp picker                   | `src/park/MapMaker.tsx`         |
| kits, stepping, combat, the blit                   | `src/park/ParkRoom.tsx`         |

A boss is standing where you put it when you walk in. A minion stands about near where you put
it, notices you if you come close, shouts to the ones beside it, follows, gives up if you run,
and goes home. Clear a corner, walk out, walk back, and it is populated again — which is the
whole of "farm", and it costs nothing because these are a property of the map rather than of the
session.

## The decision that was open, and how it went

Three spaces were in play and they are not interchangeable: **world** (`0..1` across the park,
two different scales), **screen-heights** (`toHeights()`, which is what `stepSwarm` and every
`Flock` number use) and **pet-heights** (screen-heights ÷ `PARK_TALL`, which is what every
threshold in `WILD` uses).

Settled on **one unit end to end**: `wild.ts` does its own walking in pet-heights, positions stay
in world, and the conversion happens once per step through `outBy`/`downBy` — the shape
`stepFrom` already uses in strike.ts. `stepSwarm` is not used for wilds. What that gives up is
shared separation between wilds and wave minions, which a few hand-placed creatures do not need;
what it buys is that no number in the module is ever multiplied by an aspect ratio somebody had
to remember.

⚠️ **AND THE TRAP CAUGHT ME ANYWAY, AT THE FIRST CALL SITE.** This document's previous version
warned that `across()` and `down()` take screen-heights while the park is written in pet-heights,
and that a missing `PARK_TALL` between them had already produced a dodge that crossed most of the
field and a boss's attacks landing past the edge of the world. The tune handed to `stepWilds` was
then written as:

```ts
speed: TUNE.speed / outBy(1),              // right: world a second -> creatures a second
apart: pressedTo(fattest, fattest) / outBy(1),      // WRONG
reach: pressedTo(myWide, fattest, 0, 1) / outBy(1), // WRONG
```

`pressedTo` returns **screen-heights** — its own note says so — so those two needed `/ PARK_TALL`.
Two of the three conversions were right, which is exactly how the third hides. The standoff came
out so wide that the creatures stood outside the reach of every swing in the game: **ten swings
into a huddle of five felled nothing** (creature ink 8710 → 8477, and that difference was them
walking). With `/ PARK_TALL`, ten swings cleared all five (7220 → 0).

The lesson is not "be careful". It is that **a unit error here does not look like an error** — it
looks like a creature that will not die, which reads as a broken hit test. The thing that found
it was a readback of painted pixels, which shares no arithmetic with the spawn or the hit test.

## How it was verified

In `#dev-park`, against maps written into `park_maps_v1` and walked into, with `requestAnimationFrame`
stood in by a `setTimeout` so the loop runs:

- **two different drawings, drawn differently** — red centre at (0.507, 0.452) and blue at
  (0.481, 0.516) on the swarm canvas, matching which was stamped right of and below the other.
  This is the thing that blocked the feature: the wave bakes one sprite for the whole crowd.
- **they are awake and held at arm's length** — 546 ring pixels, and they converge on the player
  without ending up inside them.
- **they can be cleared** — 7220 → 0 across ten swings.
- **and the corner refills** — walk out, walk back, 7253.

## Left for later

- A boss on a map is yours alone: a drawn map refuses the relay by design, so none of this is
  shared. That is the same for the Call button and is not a regression.
- The wave's block still bakes one sprite. It did not need changing and was not touched.
