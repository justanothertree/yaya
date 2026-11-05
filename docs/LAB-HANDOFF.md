# Lab handoff — 5 Nov 2026

The state of `#lab`, the WebGPU room, at the end of the autonomous demo loop. The commits carry
the reasoning; this is the map.

**Nothing here is live until it is merged**, and evancook.dev deploys from `main`. There are two
batches:

- **Batch 1 — PR #17**, branch `claude/relaxed-archimedes-oqxxq0`: the room, Swarm, Life, Fluid
  and Music, and the round that made them playful. Being tried on a phone.
- **Batch 2 — its own draft PR**, branch `claude/lab-toys-2`: new toys, below. It starts from
  `main` and merges #17's branch in, so it shows #17's commits too until #17 lands.

## What shipped

| Demo  | Commit    | One line on the page                                                                        |
| ----- | --------- | ------------------------------------------------------------------------------------------- |
| Swarm | `94ad2d7` | Up to two million particles in a swirling current — a compute pass moves every one.         |
| Life  | `a3d48a5` | Conway's Game of Life — every cell's next generation worked out at once, on the GPU.        |
| Fluid | `091175d` | Fluid painting — drag to stir colour into a simulated fluid that swirls, spreads and fades. |
| Music | `2b4cbfa` | Music visual — your mic, a file or the instrument as bars or a ring, drawn into a trail.    |

Swarm was already live from #16; `a3d48a5` moved it into its own component without changing it.

A picker sits at the top of the room and remembers the last demo (`localStorage.lab_demo_v1`).
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
- [ ] with seven demos the picker is two rows on a phone, and on a first load at 375 only 275 of the
      canvas's 412 px (two thirds) shows above the bottom bar — is that enough, or should the
      picker become a select?

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

## Batch 5 — new mixes

Its own draft PR, branch `claude/lab-toys-5`, from `main`. Not live. Every toy is chosen to differ
from the seven live ones, from #19 (Marbling, Growth, Aquarium, Tunnel, Cloth, Ribbons) and from
#20 (Fractal, Light, Harp, Neon, Sand, Pond), in both how you play it and what the GPU does.

⚠️ **No picker was cherry-picked.** This branch adds its toys to `main`'s own list, one entry and
one render line each — and each entry also carries its component (`Demo:`), which `main`'s list
does not read but #19's registry does. Merged after #19 or #20, the conflicts in `GpuLab.tsx`
are all "both sides added": keep both, and delete this batch's `demo === …` render lines, since
the registry renders every entry by itself. This section is at the end of the file for the same
reason.

| Toy     | Interaction                                                                                 | GPU technique                                                                                                                                                                                                                   | Pattern to reuse                                                               |
| ------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Slime   | TOOLS on a living thing: lay food, draw walls, erase, blow spores — then watch              | STIGMERGY: tens of thousands of agents sense a shared field and write back into it with `atomicAdd`; the field diffuses and decays                                                                                              | "many writers, one grid" — any scatter where several threads land on one cell  |
| Mirror  | the CAMERA, and a brush that paints TIME onto it: slow a part of the picture, bring it back | a RING OF PAST FRAMES in a `texture_2d_array` (the newest over the oldest, nothing moved) and a per-pixel delay map choosing which moment each pixel shows, blended between frames                                              | "time as a texture" — slit-scan, echoes, any effect that needs the recent past |
| Bubbles | HOLD to blow (the longer, the bigger), let go to THROW, TAP to pop — and each pop sounds    | PHYSICAL THIN-FILM INTERFERENCE per pixel on sphere impostors (no geometry): for red, green and blue, whether the film's two reflections strengthen or cancel at its thickness; reflection ADDED through premultiplied blending | "colour from physics" — oil slicks, beetles, anything iridescent               |

- **Slime** — a slime mould, after Jeff Jones's physarum model. Lay food (🍯) and it grows a
  glowing network to it, joining the pieces up the way a real one solves a maze; draw walls and it
  routes round them; erase; blow ✨ spores to start it somewhere new. Three starts (Cities — a
  scatter of towns it links up —, Maze, Wild), three habits (Veins, Web, Coral — classic parameter
  sets), three colours. Keys: F, W, E, S tools, H habit, 1–3 start again.
  Technique: each agent smells the trail ahead and to either side, turns towards the strongest,
  steps, and adds 1 to its cell. Many land on one cell in a step, so the add is ATOMIC — a plain
  read-add-write loses all but one, and the probe measures it: a step's deposits always total
  exactly the number of agents with `atomicAdd` (300,000 of 300,000), while the same step with a
  plain load and store counted 59,979 and 59,996 of 60,000 on two runs. Then the trail moves part
  of the way to its 3×3 mean, decays, and food feeds it.
  ⚠️ Three things were wrong first, all found by looking: agents starting in an inward ring all
  arrived at the middle together and the mould was one blob that never broke out (they start
  scattered now); a full 3×3 blur each step settled the network into a few thick smooth loops (it
  moves only part of the way — `diffuse` — and keeps fine veins); and food that could only be
  smelled on the spot was passed by — the network formed beautifully beside the towns. Food now
  feeds the trail like any scent and the mould finds it from afar: trail near food went from 1.2–1.5×
  elsewhere to 5–6× on Cities, and 10–11× along the way through the Maze.
  Measured: the trail step on the GPU matches a CPU copy to 1.5×10⁻⁵ (on a peak of 140) over 50
  steps, food and walls included. In the page, at 1024 and on an emulated phone: food is laid under
  a mouse (158 cells) and under two fingers at once, a wall drawn (87 cells) and partly erased (to
  59), spores reach the shader, and frames read back from the page show the network linking the
  food that was laid.

- **Mirror** — your camera, with time you can paint. Brush over the picture with 🐢 Slow time and
  that part falls up to two seconds behind; ⚡ Bring back returns it; several fingers at once.
  Start from Falling (the classic slit-scan: the past pours down the picture), Ripple, Split or
  Now; 🎨 Show time tints what you have painted. Until the camera is turned on — or if it is
  refused, or there is none — a stand-in scene of drifting circles and a sweeping hand shows the
  same trick. The camera stays on the device; the picture is mirrored, as a mirror is; and leaving
  the toy stops every track, so the light goes off (checked). Keys: C camera, S, N brushes, T show
  time, 1–4 start from.
  Technique: the last 64 frames are layers of one `texture_2d_array`, written as a ring — each new
  frame over the oldest, a `head` saying which is newest, nothing ever copied along. A per-pixel
  delay map (0..1) says how far back each pixel looks, and the display blends the two frames
  either side of that moment, so a smooth map is a smooth smear rather than steps. The brush is a
  compute pass easing the map towards the past or now. The history is shaped like the canvas (about
  49,000 texels whatever the shape), so a phone held upright is not stretched.
  ⚠️ One bug the linter led to: the drawing loop is built once, with the device, so it was reading
  the camera state from the first render — off, for ever — and would never have shown the camera.
  It reads a ref now.
  Measured, with a stand-in where frame n is a flat red of n so a pixel's red says which moment it
  shows: a delay of ½ everywhere shows 118 against 117.5 expected (31.5 frames back, blended); the
  Falling map shows each row the frame its height says, within half a frame; the GPU brush matches a
  CPU copy to 1.3×10⁻⁷. In the page, with Chromium's fake camera: it goes live, the brush paints
  under a mouse and under two fingers, and leaving the toy ends the camera's track.

- **Bubbles** — soap bubbles at dusk. Hold a finger down and a bubble grows on it; let go and it
  sails off the way you were moving; tap one and it pops with a note (kalimba, through the site's
  synth — small bubbles high, big ones low). Several fingers blow several at once. Free bubbles
  rise gently, nudge each other apart, and their films DRAIN: the colours sweep through as they
  thin, and just before bursting by themselves they turn dark and clear, as real ones do. ✨ Blow
  some, 💥 Pop them all, a sound switch. Keys: B, P, S.
  Technique: no geometry — each bubble is a quad whose fragment shader rebuilds the sphere's
  surface, and the colour is THIN-FILM INTERFERENCE: light reflects off both faces of the film, the
  two meet out of step by the extra path 2·n·d·cosθ, one is flipped, so each wavelength reflects
  sin²(2π·n·d·cosθ/λ) of itself. Done for 650, 532 and 450nm, over a thickness that is thinner at
  the top (the soap drains down) and swirls. Fresnel brightens the rim; a glint from the sun.
  ⚠️ Two things were wrong first. The reflection was multiplied by the film's tiny opacity, so a
  reflection of 0.4 reached the screen as 0.05 and the bubbles were grey ghosts; it is ADDED now —
  premultiplied blending lets colour exceed alpha, and alpha is only what the film takes away from
  behind. And films burst at 25nm, where blue still reflects a fifth — darkening, not black; the
  black-film stage is 5–15nm, and at 12 every colour is under 5%.
  Measured: the centre pixel of a bubble on the GPU matches the same sums done in the probe, at five
  thicknesses from 20 to 1,100nm, to within 0.005; the tests hold the film to the physics (black when
  thin, a quarter-wave film fully reflects its colour, the pattern repeats every half-wave). In the
  page: six bubbles open in the air, pop all sounds six notes, a held bubble grows from 35 to 84px,
  a thrown one flies the way the hand went, a tap pops and sounds once, Sound off sounds none, and
  two fingers blow two at once.

### Phone checklist — batch 5

- [ ] Slime — does the network read as alive? Lay food in a few places and watch it link them; draw
      a wall across a vein and watch it reroute. Smooth on a phone (two steps a frame, a cell every
      2 CSS px)? On `main`'s picker this batch's toys make a third row on a phone — #19's dropdown
      fixes that when it lands.
- [ ] Mirror — does the camera ask, and does the picture look like a mirror (moving left moves
      left)? Paint 🐢 over your face and turn your head. Does the camera light go off when you
      leave the toy? Smooth on a phone (a 64-frame history)?
- [ ] Bubbles — do they read as soap rather than glass? Blow a big one slowly; throw one; pop a
      few. Is the pop sound charming, and quiet enough? Do the colours drift nicely as they age?
