# Lab handoff — 5 Nov 2026

The state of `#lab`, the WebGPU room, at the end of the autonomous demo loop. The commits carry
the reasoning; this is the map.

Three batches. evancook.dev deploys from `main`.

- **Batch 1 — #17, merged and live**: the room, Swarm, Life, Fluid and Music, and the round that
  made them playful.
- **Batch 2 — #18, merged and live**: Kaleidoscope, Lava lamp, Galaxy.
- **Batch 3 — its own draft PR**, branch `claude/lab-toys-3`, from `main`: new toys chosen to be
  different from the seven above in what they do, how you touch them and how the GPU draws them.
  Not live. See "Batch 3 — a toolbox" below.

## What shipped

| Demo  | Commit    | One line on the page                                                                        |
| ----- | --------- | ------------------------------------------------------------------------------------------- |
| Swarm | `94ad2d7` | Up to two million particles in a swirling current — a compute pass moves every one.         |
| Life  | `a3d48a5` | Conway's Game of Life — every cell's next generation worked out at once, on the GPU.        |
| Fluid | `091175d` | Fluid painting — drag to stir colour into a simulated fluid that swirls, spreads and fades. |
| Music | `2b4cbfa` | Music visual — your mic, a file or the instrument as bars or a ring, drawn into a trail.    |

Swarm was already live from #16; `a3d48a5` moved it into its own component without changing it.

A picker sits at the top of the room and remembers the last demo (`localStorage.lab_demo_v1`):
a row of buttons where there is room, and below 640px a native dropdown with ‹ › to step through.
Every demo is one entry in `DEMOS` in `GpuLab.tsx` — id, name, line and component.
Every demo opens still under reduced motion and moves when Run is pressed.

### How each is played

- **Swarm** — press and drag to pull particles in (or Push them away). Counts 32K / 128K / 512K /
  2M; touch-only devices stop at 512K.
  Colour by Speed, Rainbow (hue follows each particle's heading, so every stream is one colour)
  or Fire. 🎵 Listen makes it move to whatever the site is playing: the current swells with the
  loudness and every kick drum bursts the swarm out from the middle (a finger on the field always
  wins). Under a steady kick the middle stays more hollow than full — worth a look on the phone.
- **Life** — drag to draw living cells, or switch to Erase, or pick a pattern and tap to drop it:
  Glider, Spaceship, Pulsar, Glider gun, Acorn (each tested to do what it is famous for — the gun
  fires a glider every 30 generations, on the GPU too). Speed 1–60 generations a second, three cell
  sizes. Keys with the board focused: Space run/pause, N step, R scatter, C clear, E draw/erase,
  1–5 pick a pattern.
- **Fluid** — drag through it; the pointer's speed is the push. Tap for a blossom of colour.
  Several fingers stir at once on a touch screen, each its own stroke. Splash, Clear, four palettes, Swirl
  and Fade. Keys: Space, S splash, C clear, 1–4 palette.
- **Music** — 🎤 Mic or 🎵 Play a file… (the file never leaves the device), or play the Instrument
  and come back. Bars or Ring. With 🥁 Beat on (the default), every kick drum flashes the
  picture and punches the trail outward. Drag to steer the trail: across turns it, up and down grows it. Keys:
  Space, M bars/ring, 0 hold still, B beat on/off. Leaving releases the mic and leaves music playing, as the
  Visualiser does.

## Batch 2 — new toys

| Toy          | One line on the page                                                                     |
| ------------ | ---------------------------------------------------------------------------------------- |
| Kaleidoscope | Kaleidoscope — draw, and every stroke repeats and mirrors round the middle as you go.    |
| Lava lamp    | Lava lamp — wax heated by the bulb rises, cools at the top and sinks. Reach in and stir. |
| Galaxy       | Galaxy — a spiral of stars that breathes with the music. Drag to turn it and tilt it.    |

- **Kaleidoscope** — draw anywhere and it repeats 4, 6, 8 or 12 ways round the middle, with
  Mirror reflecting each wedge too. Tap for a dot; ✨ Doodle draws a rose curve by itself (and
  opens the toy, so it is never an empty black box). Each finger is its own pen. The palettes are
  Fluid's, now shared in `palettes.ts`; Fine / Medium / Bold brushes; Fade from keep-everything
  to quick. Keys: Space, S symmetry, M mirror, D doodle, C clear, 1–4 colour. The painting is kept
  as drawn and the SCREEN samples it at every turn — so a stroke across a wedge's edge just works,
  because nothing was folded.
- **Lava lamp** — the bulb heats wax at the bottom; warm wax rises, cools at the top and sinks
  (tested as exactly that: a lone blob makes four round trips a minute). Tap a blob to warm it,
  grab one and fling it, 🫨 Shake, Heat from off to double, Little / Some / Lots of wax, and four
  colours. Keys: Space, K shake, 1–4 colour. The physics is a dozen blobs on the CPU; the GPU
  draws them as metaballs, so two blobs that meet grow a neck and merge — every pixel asks every
  blob, which is the expensive part.
- **Galaxy** — a spiral of up to 256K stars (128K on a touch screen). Drag across to turn it, up
  and down to tilt it; Face on; Spin; Arms (how tightly they wind — 0 shows the bar they come
  from). With 🎵 Listen on (the default — it only reads what the site is already playing, it never
  asks for the mic) the galaxy breathes with the loudness and every kick flares the stars, through
  the same `ear.ts` as Music and the Swarm. Keys: Space, arrows, 0 face on, L listen. Each star is
  worked out in the vertex shader from its own index — there are no buffers at all — and the arms
  are a density wave: every star follows an ellipse turned a little further the further out it is,
  so the arms hold their shape while every star moves through them.

## Batch 3 — a toolbox

Each toy here is chosen to be different from the seven above, and from each other, in three ways:
what it does, how you touch it, and how the GPU draws it — so the batch reads as a set of
interactions and GPU patterns that can be lifted into the rest of the site.

| Toy      | Interaction                                                                                  | GPU technique                                                                                                                                   | Reusable pattern                                                                      |
| -------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Marbling | tap and HOLD to spread ink; drag a tool through it; many fingers at once                     | exact inverse warps of a texture, one pass per action, one uniform slot per action via dynamic offsets                                          | "every action is a warp of the whole image" — any number of edits per frame, in order |
| Growth   | seed by drawing, then watch it grow by itself; tap the parameter map to pick a pattern       | a continuous PDE (Gray–Scott) on a grid, 2–48 compute steps a frame, ping-pong storage buffers; the draw lights the result off its own gradient | "a simulation the user steers by its parameters" — the map is the UI                  |
| Aquarium | tap to feed, drag to BE something in the world (the shark) — the toy reacts, you don't paint | boids: all-pairs neighbour search tiled through workgroup shared memory; creatures drawn by vertex pulling, 9 vertices each, no instancing      | "agents that look at each other" — flocking, crowds, anything with neighbours         |

- **Marbling** — paper marbling after Jaffer's _Mathematical Marbling_. Tap to float a drop of ink
  in the next colour of the set; hold, and it keeps spreading, pushing everything round it outward.
  Stylus and Comb drag the ink into feathers and chevrons; the comb's tines reach right across the
  tray, as a real one does. ✨ Marble plays the classic recipe — rows of drops, a rake one way, a
  comb back, a stylus wave — in front of you; four ink sets. Keys: D, S, C tools, M marble, X
  clean sheet, 1–4 inks.
  Technique: every action is an exact, area-preserving warp of the whole tray, written INVERTED —
  for each pixel, where did the ink here come from — so nothing tears. A drop's inverse is
  `a + (q − a)·√(1 − r²/|q − a|²)`; a tine shears along its stroke by `|b − a|·λ/(dist + λ)`.
  Actions queue into a list, each gets its own 256-byte uniform slot (a dynamic offset), and a
  frame applies up to 32 of them in order, ping-ponging two textures — which is also why many
  fingers just work. Beyond the tray's edge is clean paper, not the edge's colour (clamping smeared
  the last column of ink inward as a solid block).
  Measured on the real shader: a red drop covers 3,217 px of ink against πr² = 3,217; a blue drop
  beside it pushes it aside and leaves it at 3,206; a stylus and a comb keep about 90% — what is
  lost is ink stretched thinner than a pixel and ink pushed past the tray's edge.

- **Growth** — reaction–diffusion: two chemicals on a grid, A fed in everywhere, B eating A to
  make more of itself and slowly dying. Drag to seed B (or Erase to wipe it), and depending on how
  fast A is fed and B dies it grows into Coral, dividing cells (Mitosis), Worms, a Maze or Spots.
  🗺 Map sweeps feed across the screen and kill down it, so every pattern grows somewhere at once
  (Pearson's map, live) — and a tap on the map picks the rates under the finger and grows that
  pattern on its own. Speed 2–48 steps a frame, four colourings, Reseed. Keys: Space, 1–5
  patterns, M map, E erase, R reseed.
  Technique: a compute pass per step over a grid of `vec2f` (A, B) ping-ponging between two
  storage buffers, with a nine-point Laplacian; a brush is a list of dabs applied as the first
  step of a frame writes, so the step never overwrites it. The draw reads B between cells
  (bilinear, by hand from the storage buffer) and lights it off its own slope, so it reads as
  something grown rather than printed. Measured: the real shader matches a CPU copy of the
  equations to 1.3×10⁻⁶ over 60 steps of a 61×37 grid, and every preset grows from its seeds.

- **Aquarium** — a tank of fish in three colours, and each schools only with its own kind. Tap
  to drop a pellet of food — it sinks and fades, and every fish that notices it heads for it, so a
  tap makes a ball of fish; drag through the water and you are the shark, and the schools split
  round you. 512 / 1.5K / 4K fish (touch-only devices stop at 1.5K), 🐟 Restock. Keys: Space, F
  feed, R restock.
  Technique: boids, the three rules of separation, alignment and cohesion, with every fish
  looking at every other one each frame. The neighbours arrive 64 at a time through
  `var<workgroup>` memory — each workgroup loads one tile together, waits at a barrier, and every
  fish reads the tile from there — which is the same arithmetic with a sixty-fourth of the trips
  to memory. Separation is felt across kinds (fish do not swim through each other), alignment and
  cohesion only within one. The fish are drawn by vertex pulling: nine vertices each, read
  straight out of the storage buffer the compute pass wrote, with a tail that wiggles faster the
  faster it swims. The water is one full-screen pass with caustics and the pellets as specks.
  Measured on the real shader (SwiftShader, 1,536 fish, ten simulated seconds): a fish's
  neighbours swimming its way went from 0.01 to 0.78, the share of its near neighbours that are
  its own kind from 33% (chance) to 93%; with a shark parked in the middle the fish within a
  quarter of it went 69 → 0, and with a pellet down the fish near it went 31 → 647. One step of
  1,536 fish costs about 32 ms in SwiftShader, which is a CPU pretending; a phone's GPU is the
  question.

### How the room is built

- `src/gpu/LabStage.tsx` owns everything that is not a demo: the adapter and device, a sentence for
  each way of failing (no WebGPU, no adapter, setup error, lost device with Try again), sizing the
  canvas in device pixels capped at 2×, the loop, the fps badge, and teardown. **One device per
  demo** — switching costs a new device, and in exchange one demo's lost device or stray error
  cannot land on the next.
- Each demo is `<Name>Demo.tsx` (controls, input, keys) over a `<name>Engine.ts` (pipelines,
  buffers, one `frame(dt, input)`), with its arithmetic in a pure `<name>.ts` and its shaders in
  `<name>*.wgsl`. Every engine takes `Pick<GPUCanvasContext, 'getCurrentTexture'>`, which is what
  lets it draw into a plain texture for testing.
- Every uniform is packed by hand, and every one is checked by `wgslLayout.ts`, which reads the
  struct out of the shader source and lays it out by WGSL's own rules. Reordering a field in a
  shader turns that demo's test red.

## Perf notes

**Every number below is from SwiftShader** — Chromium's CPU stand-in for a GPU, on a 4-core
container — at 480×270. That is the only adapter I had. Read them as **relative** costs; a real
GPU will be one to two orders of magnitude faster, and I have not measured one.

| Frame                          | SwiftShader ms |
| ------------------------------ | -------------: |
| Swarm, 32K particles           |           25.5 |
| Swarm, 128K particles          |          100.4 |
| Life, one generation, 5K cells |            2.2 |
| Fluid, whole pipeline          |           51.8 |
| Music                          |           11.8 |
| Kaleidoscope, 8-fold           |           21.2 |
| Kaleidoscope, 12-fold mirrored |           38.2 |
| Lava lamp, 16 blobs            |           11.8 |
| Galaxy, 64K stars              |           51.6 |
| Galaxy, 128K stars             |          107.1 |

- **Swarm scales with count, as expected**, and its draw dominates. The draw is deliberately NOT
  instanced: 32K four-vertex instances took 870 ms where one plain draw of 6 × count vertices took
  66 ms. Tiny instances are a known weak spot on real hardware too, so this is likely to hold.
- **Fluid is ~30 passes a frame** (splat ×2, curl, vorticity, divergence, 20 pressure sweeps,
  project, two advections, show), and the pressure sweeps are most of it. Twenty sweeps from cold
  only remove about a quarter of the divergence on a 64² grid (measured: 550 → 414; 200 sweeps →
  118), but pressure is kept between frames so the sweeps accumulate. If it looks springy on a real
  device, raising `PRESSURE_SWEEPS` in `fluidEngine.ts` is the knob.
- **Life is cheap.** A million cells is the cap (`MAX_CELLS`); the smallest cell size (3 px) on a
  1440-wide screen is about 81K cells (a ~1312×560 stage).
- **Music is mostly the trail.** It is a full-resolution `rgba16float` texture pair; halving its
  size would halve its cost if a weak device needs it.

### Device limits

Every demo requests a device **with default limits** and checks what it needs against
`device.limits`, not the adapter's (the adapter says what it could grant; the device is what is
enforced). The defaults are enough for all four: Swarm's largest buffer is 32 MiB of a 128 MiB
default binding, and its largest dispatch is 32,768 of 65,535 workgroups. Life's boards are at most
4 MiB each. Fluid and Music use `rgba16float` render targets, which every core device supports.

The "What your GPU reports" fold on the page shows the visitor's own adapter, limits and features.

## What was and was not verified

**Verified here**, in headless Chromium with a SwiftShader WebGPU adapter:

- each engine drawn into an offscreen texture and read back pixel by pixel
- Life's real shader against a CPU copy of the rule: 0 mismatches over 50 generations of a
  61×47 board
- Fluid's real projection passes against divergence measured on the CPU (curl untouched)
- Life's Erase, drawn offscreen: wiping the left half of a stroke leaves 48% of it
- Music fed by Chromium's fake mic and a generated 440 Hz WAV through the real file picker; the
  loudest band was 411–438 Hz
- every demo in the app with only the canvas presentation stubbed, plus `mobileAudit` at 1440 and
  375

**Not verified, and only a real device can:**

- **the final present to a real canvas on a real GPU** — headless Chromium here cannot present a
  WebGPU canvas at all (even a bare clear loses the device), so nobody has yet seen these on
  screen through the normal path
- Safari and Firefox
- real-GPU frame rates (the fps badge on the page will say)
- multi-touch beyond Fluid: Swarm, Life and Music follow one pointer

## Phone checklist

Nobody has seen any of this on a real screen: headless Chromium cannot present a WebGPU canvas.

Batch 1 (#17):

- [ ] every demo appears at all
- [ ] Swarm — fps at 128K and 512K; Rainbow reads as coloured streams; with 🎵 Listen on and a
      song playing, does a steady kick leave the middle too hollow?
- [ ] Life — tap Glider gun and gliders stream out; patterns land under the finger
- [ ] Fluid — two or three fingers stir at once; a tap blossoms; the page still scrolls when a
      swipe starts off the canvas
- [ ] Music — 🎤 Mic asks, the bars move, and the mic light goes off on leaving the Lab; with a
      song playing, kicks flash in time and Stop music works
- [ ] the AudioDock's ⏸ and ⏹ are comfortable under a thumb

Batch 2:

- [ ] Kaleidoscope — the opening doodle draws itself; two fingers draw two patterns; 12-fold with
      Mirror on stays smooth (it samples the painting 24 times a pixel)
- [ ] Lava lamp — does it look like wax rather than fog? Grab a blob and fling it; tap one and
      watch it rise
- [ ] Galaxy — do the arms read as arms on a phone at 128K? Drag to tilt it nearly edge on; play
      a song in Music and come back to watch it flare on the beat
      Batch 3:

- [ ] Marbling — does a held drop feel like ink spreading? Comb across a marbled sheet; two
      fingers with the stylus; does the paper stay crisp, or soften too fast after many strokes?
- [ ] Growth — does it keep up on a phone (136×164 cells, 16 steps a frame)? Turn the map on and
      tap around it; does coral read as coral?
- [ ] the picker on a phone: a dropdown with ‹ › either side (batch 3) — measured at 375 it lets
      328 of the canvas's 412 px show on the first screen, where seven buttons in two rows let 275
- [ ] Aquarium — do the three kinds read as separate schools? Tap to feed and watch a ball form;
      drag through a school — does it scatter like fish from a shark, or just part? Try 1.5K for
      smoothness

## What to try next

Roughly in order of how much they would teach:

1. **Measure on real hardware.** `timestamp-query` is an optional feature (it was present on the
   SwiftShader adapter); a per-pass GPU timer in LabStage would replace every number above.
2. **Boids** — the swarm with neighbours. It needs a spatial grid built on the GPU each frame
   (count, prefix-sum, scatter), which is the first demo here that would use workgroup shared
   memory and atomics.
3. **Reaction–diffusion** (Gray–Scott) — the same ping-pong as Life with floats, and paintable the
   same way. Small, and very pretty.
4. **Audio-reactive swarm** — feed Music's bands into the Swarm's current. Both halves exist.
5. **A ray-marched SDF scene** — one fragment shader, no buffers, the opposite end of what the GPU
   is good at to everything above.
6. **Multi-touch** for Life and the Swarm — Fluid has it now (`pointerId`-keyed strokes taking turns
   at the one-splat uniform); the same shape would work for Life's brush.

## Loose ends

- **The AudioDock's controls were all under 24px** — found by the audit while Music played a
  file, and worse on a phone (21×19) than at 1440, which the first note here had the wrong way
  round. Fixed in `fac6325`: 28px with a mouse, 44px under a finger.
- The Lab's own wording ("Experiments with WebGPU…") is in `App.tsx` beside the room's heading,
  not in `GpuLab.tsx`.
