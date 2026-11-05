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

## Batch 6 — more mixes

Its own draft PR, branch `claude/lab-toys-6`, from `main`. Not live. Every toy is chosen to
differ from the seven live ones, from #19 (Marbling, Growth, Aquarium, Tunnel, Cloth, Ribbons),
#20 (Fractal, Light, Harp, Neon, Sand, Pond) and #21 (Slime, Mirror, Bubbles, Clay, Fireflies,
Black hole), in both how you play it and what the GPU does.

⚠️ **No picker was cherry-picked, and none was invented.** As in batch 5, each toy is one entry in
`main`'s `DEMOS` list plus one render line; each entry also carries its component (`Demo:`), which
`main`'s list ignores and #19's registry reads. Merged after #19, the conflicts in `GpuLab.tsx` are
all "both sides added": keep both, keep one closing `]`, and delete this batch's `demo === …`
render lines. This section sits at the end of the file for the same reason.

⚠️ **THE PICKER ON A PHONE.** `main`'s picker is a row of buttons that wraps. Measured at 375
on this branch with one toy added: 8 buttons in **3 rows, 119px** of buttons above the canvas,
about 2.7 to a row (one row at 820 and 1440). So every three toys that land before #19's dropdown
add roughly another row at 375: this batch's six on `main` would be about 5 rows, and batches 5
and 6 together about 8. That is a reason to land #19 (or at least its picker commit) first, not a
reason for a third picker — the dropdown already exists, and two dropdowns would be the conflict
nobody can resolve by keeping both sides.

`wgslLayout.ts` gained one line, `mat4x4f` (four `vec4f` columns: size 64, align 16), because
Erosion's uniform carries a camera matrix. It is additive; if another branch has added a type to
the same table, keep both lines.

| Toy        | Interaction                                                                                                                 | GPU technique                                                                                                                                                                                                                                                                                                   | Pattern to reuse                                                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Erosion    | TOOLS on a 3D world: rain on it, raise land, dig channels — then watch water find its way; two fingers orbit and pinch      | SHALLOW WATER through VIRTUAL PIPES (Mei et al.): four flows per cell, scaled so a cell never sends more than it has, so water is conserved by construction; sediment picked up and dropped by capacity; slumping; drawn as a lit HEIGHTFIELD MESH pulled straight from the simulation's buffer                 | "a world that changes shape" — any terrain, any 2.5D surface you can sculpt and simulate                                                                         |
| Snowflake  | BREATH: blow on the microphone (or hold a finger to breathe on one spot) and it grows faster; the weather chooses its shape | A CELLULAR AUTOMATON ON A HEXAGONAL LATTICE (Reiter's snow model) in axial coordinates, two passes a step (mark the ice's edge, then diffuse vapour into it); drawn by interpolating across the lattice's triangles, lit from the field's own gradient                                                          | "a hex grid on the GPU" — neighbours, rotation, drawing it smooth; and a sim whose look comes from one diffusion-limited rule                                    |
| Pixel sort | YOUR PHOTO, and GESTURES AS COMMANDS: the direction you swipe is the direction it sorts; a tap drips                        | A BITONIC SORTING NETWORK, a stage per dispatch (k and j by dynamic uniform offset), over COMPOSITE KEYS — span, level, place — whose spans come from a PREFIX SCAN in workgroup memory; the picture is a GATHER through the sorted keys                                                                        | "sort millions of things on the GPU, stably, in segments" — any ranking, any per-row ordering; and the dynamic-offset trick for many small passes in one encoder |
| Squish     | MANY FINGERS AT ONCE as handles on a picture, PINS that hold it, and a jelly WOBBLE (with a boing) when you let go          | MOVING-LEAST-SQUARES DEFORMATION: every vertex of a mesh solves its own small weighted fit (a rotation, or an affine map) from the handles in a compute pass; the picture rides the mesh. Inverse by Newton on the CPU, so a finger takes hold of what is under it                                              | "bend an image by its points" — warping, puppeteering, any handle-driven deformation                                                                             |
| Lightning  | TAP TO SUMMON, PLANT RODS it seeks out, a STORM that strikes by itself — and THUNDER synthesised for each strike            | DIELECTRIC BREAKDOWN: Laplace relaxed by Jacobi between growth steps, and the next cell chosen by an EXPONENTIAL RACE — every candidate draws −ln(u)/w, atomicMin over the float's bits finds the earliest, a second pass lets the earliest claim the win; one thread grows the channel and walks the path home | "choose one of many in proportion to a weight, on the GPU, exactly" — weighted sampling without a prefix sum; and growth driven by a solved field                |

- **Erosion** — a landscape that rain carves. Rain on it with a finger (🌧) and the water gathers
  into streams, cuts valleys into the slopes and spreads fans of sand where it slows (they are
  coloured: sand where ground was laid down, raw earth where it was cut); ⛰ Raise a ridge across a
  river and it pools into a lake until it spills; ⛏ Dig a channel and it follows it. ⛈ Storm rains
  everywhere; 🌊 Drains to the sea lets water off the edges, and without it the land fills like a
  basin. Three lands — Hills, Ridge, Mesa (whose cliffs slump and gully) — each new every press.
  Two fingers (or 🔄 Turn, or the wheel) look round it. Keys: R, U, D, T tools, S storm, E edges,
  1–3 new land, arrows turn, + − zoom.
  Technique: a 256² grid of cells holding ground, water, sediment and the ground it started as.
  Each step is five compute passes, each mirrored by a function in `erosion.ts`: paint (rain, and
  the finger), flux (each cell's four pipe flows, pushed by the difference in water SURFACE height
  and scaled so it never sends more than it holds), water (in less out, and the velocity that
  makes), erode (water that could carry more than it does picks ground up; carrying more than it
  could, it puts some down — ground plus sediment unchanged), settle (sediment carried
  semi-Lagrangian along the flow; ground steeper than a talus slope slides, each pair of
  neighbours trading exactly what the other loses). The finger's ray is met with the land ON THE
  GPU, as Clay does, and the paint pass reads the hit. Drawn as a 255²-quad mesh whose vertices
  are read straight from the simulation buffer, plus a see-through water surface over it.
  ⚠️ Four things were wrong first:
  1. **Water never came to rest.** The pipe model as published keeps every flow's momentum, so a
     heap of water on flat ground sloshed as a standing wave for good — max − min depth 0.38
     against a mean of 0.31 after a minute. Pipes have friction now.
  2. **Erosion was five times too fast.** A storm carved 20 cells deep in 24 seconds and the land
     was finished before anybody had watched it; now a river takes a minute or two to cut.
  3. **Rain as drops pocked the land with spikes** — every drop dug its own pit. A storm falls
     evenly now (with a little unevenness so streams have somewhere to start); the finger is the
     downpour.
  4. **Hills started as a flat green table** (its peaks were 24–37 against Ridge's 76).
     Measured on the GPU over 60 steps from the same land and water: it matches `erosion.ts` to
     5.7×10⁻⁶ in ground, 3.8×10⁻⁵ in water and 1.1×10⁻⁵ in sediment; 40 steps of storm put down
     4,092.597 of water against 4,092.599 from the same hash; the finger's ray meets the land within
     0.15 of a cell of a CPU march, and finds nothing past the edge on both. The tests hold the CPU
     copy to the physics: water conserved exactly in a closed basin, a still lake stays still, a heap
     spreads flat, water runs downhill and off an open edge, slumping conserves ground and brings a
     cliff under the talus slope, rain on a ramp carves its top and lays sand at its foot, a long
     storm stays finite. In the page, at 1024 and on an emulated phone: Raise adds ground and moves
     the start-height with it (so it is not coloured as sand), Dig takes it, Rain adds water and the
     ground under it starts to wear; Turn moves the eye and paints nothing; the wheel zooms without
     scrolling the page; two fingers orbit and pinch; Storm, edges, lands and keys all reach the
     shader; no sideways scroll, nothing undersized or clipped.

- **Snowflake** — a speck of ice in cold, damp air, growing six feathered arms. 🎤 Breathe opens
  the microphone (the site's own `localMic`, which analyses and never records) and blowing on it
  makes the air damper, so it grows faster and wilder; hold a finger on it to breathe on one spot —
  with ❄ Six-fold on (the default) the breath lands six ways round, as still air round a real
  crystal does; turn it off and one breath makes it lopsided. Four weathers grow four different
  crystals: Fern (long arms with side branches), Star, Sector (broad arms) and Feather (thick with
  branches). Calm, Brisk and Blizzard set the speed; ↺ New flake starts again. Leaving the toy
  turns the microphone off. Keys: N, M breathe, X six-fold, 1–4 weather.
  Technique: Clifford Reiter's model (2005) on a 401-wide lattice of hexagons held as axial
  coordinates — six neighbours at (±1, 0), (0, ±1), (1, −1), (−1, 1). A cell that is ice (holds
  ≥ 1 of water) or touches ice is RECEPTIVE: it keeps its water and gains γ; everybody's free vapour
  diffuses (a receptive cell's counting as none, so vapour drawn into the ice stays there). The tips
  reach furthest into the damp, get the most, grow fastest, and branch. Two compute passes a step:
  mark the receptive cells, then grow. Drawn by reading the lattice linearly across the triangle of
  the three nearest cell centres, so the ice's edge is smooth where the value crosses 1, and lit
  from the field's own gradient, so older, thicker ice catches the light.
  ⚠️ Three things were wrong first:
  1. **Every weather grew a plain hexagonal plate.** I had left receptive cells out of the
     diffusion; with nothing drawing vapour into the ice, nothing was starved of it and no tip
     could outrun a face. With the inflow back the same weathers branch — fill of the hexagon their
     tips span went from about 1.0 to 0.2–0.55.
  2. **The speeds were a fixed number of steps a frame**, and the weathers grow ten times apart:
     Feather filled the whole disc in a quarter of a second at "Brisk". Each weather has its own
     pace now, and all take about forty seconds.
  3. **I wrote a test claiming every crystal starts as a little plate**, as real ones do. In this
     model at these weathers it does not — Star is already branching four cells out — so the claim
     came out rather than being tuned until it passed.
     Weathers were chosen by a sweep on the CPU (201-wide lattice, crystals grown 80 cells out): at
     β 0.35 γ 0.0001 a fern, 0.4/0.001 a star, 0.3/0.003 broad sectors, 0.65/0.001 feathers,
     0.5/0.01 a fat star, 0.8/0.002 long blades. Measured on the GPU over 120 steps of the full
     lattice: matches `stepFlake` to 1.1×10⁻⁶ with the same 673 cells of ice; its own crystal is
     six-fold to 4×10⁻⁷; a finger's breath lands equally at all six turned places with Six-fold on
     and at one with it off. The tests hold the CPU copy to the lattice (six neighbours one cell
     apart at 60° steps, six turns come home) and the model (still air stays still, vapour is moved
     but never made, ice never melts, growth is six-fold, damper air grows faster, and the tips
     outgrow the faces). In the page, at 1024 and on an emulated phone: a press maps to the cell the
     shader draws there, Chromium's fake microphone reads as breath on the meter, the microphone's
     track has ended after leaving the toy, every weather, speed, toggle and key reaches the shader.

- **Pixel sort** — the glitch-art effect, done properly. Swipe across the picture and every run
  of pixels under your finger is sorted the way you swiped, brightest last, so it melts into
  streaks; a tap drips downwards; ✨ Melt it all sorts the whole picture down. Sort by Brightness,
  Hue or Warmth; Gentle, Glitch (the default) or Everything decides which pixels join a sorted run.
  🖼 Your photo loads one from the device (fitted so its longer side is 1,024 pixels; it never
  leaves the device), ↺ Start again puts it back unsorted. The built-in picture — a sunset over a
  city and the sea — is painted in code, and painted upright on a phone held upright. Keys: arrows
  melt it all that way, 1–3 sort by, S which pixels, O start again.
  Technique: pixel sorting sorts RUNS, not rows — only pixels in the stroke and in the chosen
  range join a run, and the rest stay put, which is what keeps the picture recognisable. A sorting
  network cannot stop at a run's edge, so the run goes in the key: `run · 2²⁰ + level · 2¹⁰ +
place`. Sorting a whole line by that key sorts every run within itself, never moves a pixel out
  of its run, and is stable, and the low bits say where each pixel came from — the picture is a
  GATHER through the sorted keys. Each line's runs are numbered by a prefix scan in workgroup
  memory (one workgroup a line, 256 threads, 1,024 places). The sort is a bitonic network: 55
  stages for 1,024 keys, each pairing every key with exactly one other, run two a frame so the
  pixels can be seen streaming, each stage's k and j a 256-byte slot of one uniform buffer chosen
  by dynamic offset — all the stages in one encoder. When it finishes the gather is baked into the
  photo, so swipes build on each other.
  ⚠️ Four things were wrong first:
  1. **Half-way through, half of every column was upside down.** The textbook bitonic network
     sorts alternate blocks downwards until the very last merge, and drawn live that flickered in
     flipped bands. The variant whose first stage of each merge compares MIRRORED pairs leaves every
     block sorted the same way after every level: the picture melts in runs of two, then four, then
     whole lines.
  2. **On the frame a sort finished, the picture was sorted twice**: the uniform had already said
     "draw through the keys" when the photo became the sorted one. Whether a frame bakes is decided
     before the uniform is written now.
  3. **The first built-in picture did nothing when melted** — its sky was dark at the top and bright
     at the horizon, already in order going down. It has lit clouds and a city of windows now, and
     the spans were chosen by sorting it every way with every range (Gentle barely moves the
     clouds, Glitch is the classic look, Everything leaves stripes).
  4. **A span preset called "Melt" sat beside "✨ Melt it all"**, and the probe clicking one hit the
     other — so would a person. It is called Everything.
     Measured on the GPU, sorting a 300×200 picture of noise and stripes the whole way in each
     direction and comparing every pixel with the same sort done on the CPU (keys, network, gather):
     right, left and down by brightness or warmth agree on all 60,000 pixels; up by hue differs on 40
     — computing the hue in single precision on the CPU brings that to 7, the rest within WGSL's
     2.5-ulp division, so it is rounding at level boundaries and not the sort. One dab of radius 20
     marks 1,264 pixels against π·20² = 1,257. The tests hold the network to an ordinary sort (ties
     included, 1,024 keys), every stage to pairing each key with exactly one other, every finished
     level to blocks sorted the same way round, the keys to never moving a pixel out of its run and to
     agreeing with a plain stable sort of each run on a long random line. In the page, at 1024 and on
     an emulated phone: a swipe left sorts rows the other way, a tap drips down, a swipe down on a
     touch screen sorts columns, Melt it all, sort-by, spans and keys reach the shader, a chosen photo
     is fitted and sorted, and Start again restores it unsorted.

- **Squish** — a picture made of jelly: a cheerful green face on a checked cloth (painted in code,
  upright on an upright phone), or 🖼 your own photo. Grab it anywhere and pull; two fingers stretch
  and turn it between them; more, and it bends to all of them at once. 📌 Pin holds a spot still
  (tap a pin again to take it out) so one cheek can be pulled while the other stays put. Let go and
  it springs back, wobbling, with a marimba boing — low for a big stretch, high for a small one
  (🔊 Sound on/off). Rigid bends it like rubber and never shears; Stretchy smears it like dough.
  Keys: P pin, M bend, U unpin all, B boing.
  Technique: moving-least-squares image deformation (Schaefer, McPhail & Warren, 2006). The
  handles are pairs — where a point of the picture was, and where it is held. A compute pass gives
  each vertex of a 97×65 mesh its own best transformation from them, weighting each handle by
  1/distance²: the best ROTATION (Rigid, a closed form from Σw(p̂·q̂, p̂×q̂)) or the best linear map
  (Stretchy, a 2×2 solve). The picture is drawn on the bent mesh. A let-go handle springs home on
  the EXACT solution of a damped spring, so a slow frame cannot add energy to the wobble. A finger
  landing on jelly that is already bent takes hold of the point of the picture under it, found by
  inverting the bend with Newton's method on the CPU's copy of the same sum.
  ⚠️ Two things were wrong first:
  1. **A finger on bent jelly grabbed the wrong place.** The inverse was a plain fixed-point
     iteration, which only converges while the bend is nearly a slide; with a twist in it the
     tests found it 15 pixels out. Newton with the bend's own Jacobian is within half a pixel.
  2. **`struct Squish` is 40 bytes, not the 48 I typed beside it** — it ends at 36 and rounds to its
     8-byte alignment. The layout test caught the table before anything packed it.
     Measured on the GPU with two pins and two pulled handles: every vertex of the mesh lands where
     the CPU's `deform` puts it, to 1.5×10⁻⁴ px in Rigid and 2.3×10⁻⁴ in Stretchy. The tests hold
     the method to its promises: nothing moved leaves the picture alone; every handle moved by one
     rigid motion moves the whole picture by it, exactly, in both modes; a point under a handle goes
     exactly where it is held; Rigid's local move is always a rotation (unit, orthogonal, determinant
  1) while Stretchy's stretches; the spring overshoots and settles, and one long step equals many
     short ones. In the page, at 1024 and on an emulated phone: a held mouse makes a handle that
     follows it and wobbles home on release, with one boing (none with sound off); pins go in and come
     out; two fingers make two handles from their own points of the picture; Stretchy, Unpin all, a
     photo and the keys all reach the shader.

- **Lightning** — a night sky that strikes. Tap anywhere to plant a lightning rod there (a mast
  down to the ground) and call a bolt: the stepped leader feels its way down from the cloud,
  branching; when a branch touches the ground or a rod the path it took blazes — the return
  stroke, flickering with a re-strike — and thunder follows, made on the spot (a crack of filtered
  noise and a rolling rumble, at the instrument channel's volume). ⚡ Strike calls one; ⛈ Storm
  strikes by itself every few seconds; Wild, Forked and Straight are η of 1, 2 and 3.5. Keys: Space
  strikes, S storm, C clear rods, 1–3 shape.
  Technique: the dielectric breakdown model (Niemeyer, Pietronero & Wiesmann). φ is 0 on the
  cloud and the channel, 1 on the ground and the rods, and relaxed by Jacobi between them — 12
  passes after every new cell, warm-started, so the field near the tip is always fresh. The next
  cell to break down is chosen among the air touching the channel with probability ∝ φ^η, by an
  EXPONENTIAL RACE: every candidate draws a time −ln(u)/w and the earliest wins, which is exactly
  weighted sampling with no running total. On the GPU the earliest is an `atomicMin` over the
  float's bits (positive floats sort as their bits do), and a second pass lets the candidate whose
  time equals the minimum claim the win by index. One thread then grows the channel, remembers
  which channel cell it grew from, and when it has arrived walks those links back to the cloud,
  marking the path that flashes. The step counter lives in a storage buffer, so every growth step
  of a frame runs in one compute pass with no uniform written between them.
  ⚠️ Two things were wrong first:
  1. **The shapes grew at one rate**, and a Wild bolt needs 2,334 cells to reach the ground against
     Forked's 586 and Straight's 300 — six and a half seconds at six a frame. Each shape has its own
     rate now and all take a couple of seconds.
  2. **`struct Bolt` is 40 bytes, not 36** (the same rounding as Squish's) — caught by the layout
     test again.
     Measured on the GPU: grown 60 cells from the same sky, the GPU breaks down exactly the same
     cells in exactly the same order as the CPU's copy, all 60. Whole bolts at each η reach the ground
     with a path from cloud to ground that has no gaps; a bolt with a rod at (150, 70) makes contact
     at (149, 78), on the mast. The tests hold the CPU copy to the physics: relaxing an empty sky
     gives the straight line Laplace says it must, a rod raises the field round it, the race wins in
     proportion to the weights (40,000 draws), a whole bolt reaches the ground, branches more at
     smaller η, and goes to a rod. In the page, at 1024 and on an emulated phone (where the grid
     turns upright): the first bolt arrives, flashes and thunders once; a tap plants a rod and strikes;
     shapes, Clear rods, the thunder switch (no thunder when off), Storm and the keys all work.

### Phone checklist — batch 6

- [ ] The picker: how many rows of buttons sit above the canvas at 375? If #19 has landed, this is
      moot.
- [ ] Erosion — smooth on a phone (four steps of a 256² simulation a frame, and a 130,000-triangle
      mesh)? Does rain from a finger feel like it lands where you touch? Is a minute or two to cut
      a valley the right pace, or too slow to notice? Two fingers to turn — natural?
- [ ] Snowflake — does blowing on the phone's microphone feel like it does something (it is
      breath, but any loud sound counts)? Is forty seconds to grow a crystal the right wait? Does a
      finger's breath read as breath? Does the browser ask for the microphone, and does its
      recording light go off when you leave the toy?
- [ ] Pixel sort — does a swipe feel like it pushes the pixels the way you swiped? Try your own
      photo (does the picker open the camera roll?). Is the melt quick enough, or should it run
      faster than two stages a frame? Is Glitch the right default?
- [ ] Squish — does it feel like jelly? Three or four fingers at once? Is the wobble too much or
      too little, and is the boing charming? Try it on your own photo — a face is the obvious test.
- [ ] Lightning — is the thunder satisfying through phone speakers, or just noise? Too loud? Does a
      bolt take about the right time to come down? On a big screen the grid's cells show as dots in
      the side branches — charming pixel-lightning, or worth a finer grid?
