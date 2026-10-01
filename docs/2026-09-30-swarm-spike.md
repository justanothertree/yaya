# Can the park hold a swarm? — 30 Sept 2026

A spike, run to answer one question before any of the vampire-survivors work is designed:
**how many drawn creatures can be on the field at once**, and what decides the limit.

The answer turned out to be emphatic, and it changes what the rest of it should look like.

## What was measured

A real hand-drawn creature from the gallery, read back through `readDrawing`, at the size the
park draws one (54px tall — `PARK_TALL` of a 614px field). Two paths, both drawing into the same
on-page 1280×800 canvas:

- **live** — `paintPet` per creature per frame, which is what the park does today (one `PetView`
  canvas each, animated from the rig).
- **baked** — `paintPet` run once into an 8-frame sheet, then one `drawImage` per creature per
  frame.

Two creatures, to find out whether the drawing's complexity matters:

|           | strokes | points |
| --------- | ------- | ------ |
| Spindle   | 11      | 125    |
| Elaborate | 120     | 9600   |

## The numbers

Milliseconds per frame, measured as **cadence** — frames actually completed over a wall-clock
window — with the empty loop (4.73ms, the `setTimeout` clamp) subtracted. A 60fps budget is
16.7ms for _everything_, rendering and simulation together.

**Spindle (11 strokes)**

| creatures | live | baked |
| --------: | ---: | ----: |
|        50 |  1.5 |   0.7 |
|       100 |  4.9 |     — |
|       200 | 11.3 |   0.4 |
|       800 |    — |   0.8 |
|      2000 |    — |   3.1 |

**Elaborate (120 strokes)**

| creatures |  live | baked |
| --------: | ----: | ----: |
|        10 |  42.0 |     — |
|        25 |  79.1 |     — |
|        50 | 241.2 |     — |
|       200 |     — |   0.4 |
|       800 |     — |   0.7 |

Baking cost, once per creature: **4.5ms** for Spindle, **110ms** for Elaborate.

## What it means

**1. Baking is not an optimisation, it is the feature.** Ten of a detailed creature on the live
path is 42ms — two and a half frames gone, for ten enemies and no game logic. The same drawing
baked gives 800 for less than a millisecond. There is no tuning that closes a gap of that size.

**2. Baked cost does not care how complex the drawing is.** 800 Elaborates cost the same as 800
Spindles. On the live path the detail is a per-frame tax; baked, it is paid once. This is the
finding that matters most for what Evan actually wants — "all of my custom drawn assets" — because
it means **detail stops being a performance budget**. It remains a storage and wire budget, which
is a different ceiling with different rules (see `ACCOUNT_ITEM_BYTES`).

**3. Bake up front, never at spawn.** 110ms is a visible hitch, and it would land exactly when a
wave arrives. The roster has to be known and baked before the fight starts.

**4. The next bottleneck is not drawing.** 800 creatures render in under a millisecond, so the
limit on a swarm is the simulation — hit tests, steering, and, if minions are shared in co-op, the
wire. That is where the design effort belongs, and it is a much better problem to have.

## What this does not say

- Measured in the Browser pane, which is Chromium, with `requestAnimationFrame` stood in by a
  `setTimeout` loop. Cadence is therefore un-vsynced throughput rather than real frame pacing — it
  reads the WORK honestly and says nothing about compositing, and nothing at all about Firefox or
  Safari.
- Two instrumented attempts before this one gave nonsense — a flat ~10ms for the baked path at
  every count from 25 to 800 — because `getImageData` behaves differently for vector work and for
  blits, so the readback was the measurement. `performance.now()` cannot see canvas work; counting
  completed frames can. The same trap is written up in CLAUDE.md and it caught this twice in a row.
- One machine, one creature size. The shape of the result is not in doubt; the exact numbers are.

## Recommended next step

A `minion` role whose picture is a baked sheet rather than a live rig, baked when the roster is
known. Rendering will not be what stops it.
