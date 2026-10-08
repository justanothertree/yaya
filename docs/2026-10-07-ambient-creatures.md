# Ambient creatures — what is built, and the one decision left

Asked for as: _"mobs in park that you can agro and farm and they are like swarm minions but not
as wave that hunts you but exists"_ — and, from the same list, _"if i stamp a minion or boss on
the map editor it spawns there"_. Those turned out to be one feature: a creature standing in the
world that is not a wave.

## Done

**`feat(park): stamp a boss on a map and it is standing there when you walk in`**
Format, editor and room. `Piece.life` is a seventh packed number written only when there is one,
so every map already saved packs to exactly the six it always did. `placesOf` filters the living
out of the terrain; `livesOf` hands the room drawings rather than palette indices. Verified in
`#dev-park`: minimap dot at (0.693, 0.595) against a stamp at (0.70, 0.60).

**`feat(park): creatures that live somewhere, notice you, and go home`**
`src/park/wild.ts` — the pure core, 15 tests. Noticing, the shout that spreads from the creature
that saw you (not from the player), the give-up countdown, the leash, and ranges ordered
`leash < notice < chase` so a creature cannot wake for something it will not follow.

## Not done: the room cannot draw them yet

The wave bakes **one** sprite shared by every mob in it (`mobKit`), so two different stamped
creatures would both be drawn as the first. That is why the minion row is not offered in the map
editor — `Piece.life` reads and writes `'minion'` already, so maps made later need no migration.

The wiring is **additive**: a second array with its own per-frame block and its own blit pass,
reusing `inSwipe` / `inPatch` / `toWorld`. The wave's ~200-line block stays untouched, because
refactoring it to carry a list of kits is the one change that could break a fight that works.

```ts
const wildKits = useRef<Array<{ kind: Minion; baked: Baked | null; wide: number }>>([])
const wilds = useRef<Wild[]>([])
```

Built on arrival from `drawn.lives().filter((l) => l.as === 'minion')`, grouped by drawing —
`livesOf` returns `doc.palette[p.art]`, so the same palette entry is the same object and grouping
is by reference.

## The decision to make first

**Which space `wilds` live in.** There are three in play and they are not interchangeable:

| space          | what it is                                                             | who wants it                                  |
| -------------- | ---------------------------------------------------------------------- | --------------------------------------------- |
| world          | `0..1` across the park, two different scales                           | `Piece.at`, `livesOf`, drawing via `onScreen` |
| screen-heights | `toHeights()` — isotropic, `x * PARK.across * ASPECT`, `y * PARK.down` | `stepSwarm` and every number in `Flock`       |
| pet-heights    | screen-heights ÷ `PARK_TALL`                                           | every threshold in `WILD`, and `apart`        |

`wild.ts` is written and tested in **world in, pet-heights out**: `apart` divides by `outBy(1)`
and `downBy(1)`, which is the shape `outBy` exists to give. `stepSwarm` wants screen-heights.

So one of these, deliberately:

1. **Keep wilds in world, convert at the `stepSwarm` call.** `wild.ts` stays correct as tested.
   Cost: a `toHeights`/`toWorld` sandwich per frame, and `Flock`'s `apart`/`reach`/`speed` are in
   screen-heights while everything around them is not — a mixing point, which is where this
   module's bugs have always been.
2. **Keep wilds in screen-heights like `mobs`.** `stepSwarm` and the blit work unchanged. Cost:
   `apart` and the `wild.ts` tests are wrong as written and must be redone in that space.
3. **Do not use `stepSwarm` for wilds.** Ambient creatures are few and hand-placed, and their
   locomotion is simple — amble to `restSpot`, or walk at you. Write it in `wild.ts` in
   pet-heights with its own tests. The "second opinion" rule this repo keeps paying for is about
   HIT TESTS and reach, not about walking, and combat would still go through `inSwipe`/`inPatch`.

⚠️ **Do not decide this by writing a conversion at the call site and seeing if it looks right.**
`across()` and `down()` take screen-heights while nearly everything here is written in
pet-heights, and the missing `PARK_TALL` has gone astray three times already — a dodge that
crossed most of the field, and a boss's mark and wave landing past the edge of the world. The
measurement that settles it must share no arithmetic with the thing being measured: the field's
own width, a pixel rectangle, or a readback of painted pixels.

Leaning towards **3**. It is the only one with a single unit end to end, `WILD` is already written
in that unit, and the thing it gives up — shared separation between wilds and wave minions — is
not something a hand-placed creature needs.

## Then

- Combat: `Wild` gains `cut` and `zapped` stamps, same one-hit-per-swing rule the crowd uses.
  `struck()` already wakes the neighbours, which is what stops picking a group off from range.
- Death and respawn, which is what makes it farming rather than clearing.
- Re-offer the minion row in `MapMaker`'s `DOES` table, and delete the note saying why it is not
  there.
