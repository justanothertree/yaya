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

| Toy      | Interaction                                                                                                                              | GPU technique                                                                                                                                                                                                 | Reusable pattern                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Marbling | tap and HOLD to spread ink; drag a tool through it; many fingers at once                                                                 | exact inverse warps of a texture, one pass per action, one uniform slot per action via dynamic offsets                                                                                                        | "every action is a warp of the whole image" — any number of edits per frame, in order      |
| Growth   | seed by drawing, then watch it grow by itself; tap the parameter map to pick a pattern                                                   | a continuous PDE (Gray–Scott) on a grid, 2–48 compute steps a frame, ping-pong storage buffers; the draw lights the result off its own gradient                                                               | "a simulation the user steers by its parameters" — the map is the UI                       |
| Aquarium | tap to feed, drag to BE something in the world (the shark) — the toy reacts, you don't paint                                             | boids: all-pairs neighbour search tiled through workgroup shared memory; creatures drawn by vertex pulling, 9 vertices each, no instancing                                                                    | "agents that look at each other" — flocking, crowds, anything with neighbours              |
| Tunnel   | a STICK: press and drag, and the distance from where you pressed is how hard you turn; or tilt the phone; a little game (catch the orbs) | sphere tracing: no geometry, one full-screen pass, every pixel marches a ray through two distance functions; domain repetition for the orbs                                                                   | "a world that is only a function" — any SDF scene, and a camera somebody steers            |
| Cloth    | HANDLE an object: grab with several fingers, pull, tear, throw; a scissors tool cuts along a stroke                                      | position-based dynamics: Verlet integration and distance constraints in compute, GRAPH-COLOURED into 8 phases so no two threads write one particle; the mesh is built in the vertex shader from the particles | "a soft body you can hold" — ropes, jelly, flags, anything that stretches                  |
| Ribbons  | WATCH: it plays by itself; press to lead it, 🎵 Listen to let the music move it                                                          | a ring-buffer trail written by compute (one point a frame, nothing ever shifted); ribbon geometry built in the vertex shader, camera-facing and twisting; additive glow                                       | "a trail" — any comet, cursor trail or swoosh: one write a frame, and the geometry is free |

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

- **Tunnel** — fly down an endless, winding tunnel and catch the orbs that hang in it. Press and
  drag to steer like a stick — the further from where you pressed, the harder you turn — and the
  view banks into the turn and looks a little where you are going. On a phone, 📱 Tilt to steer
  takes the phone's tilt instead, measured from however it was held when tilt went on. Cruise,
  Fast and Warp (the view widens as you speed up), four colourings, a score with a streak, Start
  over. Keys: arrows or WASD, Space, 1–3 speed, C colours, R start over.
  Technique: sphere tracing. There are no triangles; one full-screen pass casts a ray per pixel
  and steps it along by the distance to the nearest surface, which can never step through
  anything. The wall is `radius − distance from the centreline`, rippled, and scaled by 0.7
  because a bending tube's distance is overstated on the outside of a turn. The orbs are DOMAIN
  REPETITION: each hangs in its own 6-unit slice, so a point only ever asks about the orb in its
  slice; their places come from an integer hash written identically in TypeScript and WGSL, so
  the CPU decides what you caught and the GPU draws the same orbs. Light gathered on the way past
  an orb is the glow. The path repeats exactly every 240 units, which lets the camera's z be
  wrapped and keeps the shader's sines on small numbers however far you fly.
  Measured on the real shader: an orb is drawn at exactly the pixel the CPU camera projects it to,
  vanishes when caught, and is still found 37 laps in (orb 1,488). A perfect pilot catches every
  orb at Cruise and Fast and not at Warp, which is the point of Warp (a test). In the page, a drag
  right-and-up moved the craft right and up and banked the view; the left key moved it back; a
  synthetic tilt steered.
  ⚠️ Tilt has three answers, not two: Chromium answers `requestPermission()` with `'prompt'`
  where it has nobody to ask, and a device can say yes and then send nothing — so only `'denied'`
  counts as no, and two seconds without an event says "No tilt is arriving". Calling
  `requestPermission` lifted off the class throws Illegal invocation, which looked exactly like
  the phone refusing; it is called on the class.

- **Cloth** — a curtain gathered on its rail, or a cloth pegged on a line. Grab it anywhere
  (several fingers at once on a touch screen) and pull; pull hard enough and it tears, let go
  mid-swing and it flies. ✂️ Cut slices along your stroke, and a piece cut free falls and crumples
  on the floor. A breeze (on by default), four fabrics — Gingham, Silk, Stripes, Denim — and
  🧵 New cloth. Keys: G grab, X cut, H hang it the other way, N new cloth, W breeze, 1–4 fabric.
  Technique: position-based dynamics (Jakobsen's Hitman cloth; Müller et al.). Each step, every
  particle moves on by its own velocity, gravity and the wind (Verlet), then every edge — across,
  down and both diagonals — is pulled back towards its length, ten passes over. The GPU part is
  the COLOURING: the edges are split into eight phases by kind and by the parity of one
  coordinate, so no two edges in a phase share a particle and every edge in a phase can be its own
  thread with no two threads writing the same particle. That also makes the parallel solve exactly
  the sequential one in the same order — so a CPU copy checks it: 6.6×10⁻⁷ apart after 120 steps,
  against 1.1×10⁻² with the CPU's phases reversed. A finger takes hold of every particle within
  reach on the frame it goes down, and a held particle follows it spread over the frame's steps,
  so letting go leaves it with the finger's velocity — which is the throw. Tearing is an edge past
  2.4× its length; a hole is a square with a torn side, not drawn. The mesh is built in the vertex
  shader from the particle buffer (six vertices a square), lit from both sides.
  ⚠️ There is no "two corners", and it was tried: ten passes move a correction about ten
  particles, so the middle of a 64-wide sheet held at two points never learns it is held — it
  falls, and the pinned edges stretch 1.01 → 3.05 of their length in 30 steps and tear, untouched.
  Pegs every 9 columns keep every particle within reach of something holding it.
  ⚠️ The floor is a constraint inside the solver, not only a clamp after it: clamping just the
  next position turned relaxation pushing particles under the floor into an upward kick, and a
  piece cut loose tore 128 more edges landing. Now it tears none.
  Measured: untouched in a strong breeze for ten seconds, nothing tears in either hanging (worst
  stretch 1.2× curtain, 1.33× pegs); a stroke across cuts exactly the 190 edges it crosses; in the
  page, one frame carries a press, two touch fingers hold at once, and the real rendered frames
  show a pull, a tear and a cut piece on the floor.

- **Ribbons** — ribbons of light that dance by themselves through space while the camera drifts
  round them: Loops (Lissajous), Rose (three-petalled) or Wander. Press and they swoop to your
  finger and circle it; let go and they swoop back into their dance. 🎵 Listen moves them to
  whatever the site is playing — louder dances faster and wider, every kick flares. 6 / 12 / 24
  ribbons, four colourings (the shared palettes). Keys: Space, D next dance, L listen, 1–4.
  Technique: each ribbon's trail is a RING BUFFER of 160 points in a storage buffer. A compute
  pass writes one new point per ribbon over the oldest each frame and moves nothing else, and
  `head` says where the newest is — so a trail costs one write a frame, not 160. The vertex shader
  then builds the ribbon straight from it: two vertices across each point, spread square to the
  path and the line of sight and then TWISTED slowly along it, so the strip turns edge-on and back
  and reads as silk rather than tape; brightness follows how squarely it faces you; additive
  blending makes crossings glow. Width follows the head's real speed, measured between slots.
  ⚠️ A head is not a spring, and two were tried: a spring chasing the dance trailed it by up to
  1.38, more than the figure is wide, so Rose never drew a petal (five times stiffer still left
  0.53); a sprung displacement towards the finger lagged the same way, because the dance it is
  measured from keeps moving. Any follower lags a moving target. A head is now its dance blended
  towards its place round the finger by the lead's eased strength — both ends exact, and the
  easing is the swoop.
  Measured: the GPU's newest trail point matches the CPU's `headAt` to 3.3×10⁻⁴ (one frame out of
  step would be 3.8×10⁻²), and the point 30 frames back is where the head was 30 frames ago. The
  camera's own unprojection lands a point back under the finger to a millionth of a pixel. In the
  page, holding a finger leads them there and letting go eases the lead to nothing.

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
- [ ] Tunnel — is it smooth on a phone (every pixel marches a ray; it renders at 1× there)? Does
      drag-as-a-stick feel right, or would "the craft follows your finger" be better? Turn on
      📱 Tilt: does it ask (iPhone), does tilting steer the way you expect — and in landscape,
      which is the one direction nobody has tried?
- [ ] Cloth — does it tear too easily? (A brisk drag across a curtain tears where it is held;
      TEAR is 2.4× an edge's length.) Two fingers pulling apart; cut across and watch the piece
      fall; is it smooth on a phone (44 columns, up to 3 steps × 80 constraint passes a frame)?
- [ ] Ribbons — do they read as silk in space, or as tangled lines? Hold a finger down and move
      it about; play a song in Music and come back with 🎵 Listen on. Is 24 ribbons smooth?

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

## Batch 4 — a bigger toolbox

Its own draft PR, branch `claude/lab-toys-4`, from `main`. Not live. Every toy is chosen to be
different from the seven live ones and from batch 3's six (#19: Marbling, Growth, Aquarium,
Tunnel, Cloth, Ribbons) in what it does, how you touch it and how the GPU draws it.

⚠️ **This branch carries batch 3's picker commit** (`72444ac`, cherry-picked unchanged as
`69b3f03`) because the old button row does not hold twenty demos on a phone. The patch is
identical, so it merges cleanly whichever PR lands first. This section sits at the END of the file
for the same reason: #19 adds its own section further up, and the two should not touch.

| Toy     | Interaction                                                                                                                          | GPU technique                                                                                                                                                                                                               | Reusable pattern                                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Fractal | a CAMERA you pinch: two-finger zoom, drag to pan, wheel, double-tap; or ✨ Dive auto-plays                                           | PERTURBATION: a reference orbit in f64 on the CPU, each pixel's tiny difference from it in f32 on the GPU, rebasing when it strays; expensive pass only on a new view, cheap colouring every frame; 2×2 blocks while moving | "more precision than the GPU has" — and "compute once, look up every frame" for anything heavy                                     |
| Light   | ARRANGE a scene: drag lamps, pillars and walls; tap for a lamp; turn a wall with a second finger or the wheel; 🌀 Drift              | 2D global illumination: the scene's distance field BAKED into a texture once per change, then Monte Carlo rays sphere-traced through it from every texel, averaged over frames                                              | "light that works itself out" — soft shadows, glows and colour bleeding from one loop; and "bake the scene, then query it cheaply" |
| Harp    | PLAY an instrument: strum with any number of fingers, tap a string, keys; ✨ Play by itself; it makes SOUND through the site's synth | analytic motion: each point of each string is the sum of its standing waves since its last pluck, worked out in the vertex shader — no simulation state                                                                     | "motion with an exact answer needs no simulation" — anything that rings, wobbles or decays                                         |
| Neon    | TYPE: a real text box (a phone brings up its keyboard); tap the sign to knock it; letters stutter on and one is faulty               | the JUMP FLOOD: a distance field in log₂(size) passes, each texel learning its nearest seed and carrying that seed's payload (which letter) with it                                                                         | "distance to anything, fast" — glows, outlines, Voronoi, soft shapes from a mask                                                   |
| Sand    | POUR with any number of fingers; wall it in; TURN THE BOX (⟲ ⟳, arrows) or tilt the phone and gravity follows                        | a MARGOLUS block automaton: 2×2 blocks, shifted every other step, each rearranged by one thread — no races, and grains conserved by construction; integer rules a CPU copy matches cell for cell                            | "particles that never collide on the GPU" — falling sand, crowds, anything that must not double up                                 |
| Pond    | TOUCH the water: tap, drag for a wake, many fingers; 🌧 Rain plays by itself                                                         | the wave equation on a height field, and CAUSTICS: a mesh refracted onto the floor, each pixel lit by the surface area that lands on it (screen-space derivatives) — light moved, never made                                | "light through anything that ripples" — water, glass, heat haze; and "conserve it, then test the conservation"                     |

- **Fractal** — the Mandelbrot set. Drag to move, pinch (or scroll) to zoom, double-tap to zoom
  in. ✨ Dive picks its own way down: every 0.8 s it samples the view in f64 on the CPU and steers
  for the point that escapes LATEST, which is the one nearest the set's edge, so it never lands
  somewhere flat and needs no coordinates written down. ◎ Julia from here switches to the Julia
  set of the point in the middle (one map read two ways), and 〰 Morph walks its `c` round a small
  circle. Four colourings that keep turning. Keys: arrows, + −, D dive, J Julia, M morph, H all of
  it, 1–4.
  Technique: f32 runs out at a view about 10⁻⁵ wide (neighbouring pixels become the same number —
  measured: 3 distinct columns of 256 at 10⁻⁸, 1 at 10⁻¹¹). So one point, the centre, is iterated
  in f64 on the CPU, and every pixel iterates only its DIFFERENCE from that orbit on the GPU,
  δ ← 2Zδ + δ² + δc — tiny, but f32 keeps its exponent, so precise. When a pixel strays nearer the
  reference's start than to where the reference has got to, it REBASES (Zhuoran's method), which
  is what keeps it free of the glitches older perturbation renderers patched by hand. The limit is
  the centre's own f64: about 10⁻¹³. The iteration writes a smooth count per pixel into a buffer
  ONLY when the view changes; a cheap pass colours it every frame, so the colours flow with no
  iteration redone. While the view moves it works out one pixel in four (2×2 blocks, about a third
  of the time), and in full once it comes to rest.
  ⚠️ Two things were wrong first. A Julia rebase measured from zero rather than from the
  reference's start — the same for Mandelbrot, whose orbit starts at 0, and off by 0.12 in every
  pixel's count for Julia. And a √n palette turned every jump of hundreds of steps between
  neighbouring pixels at the edge into a new colour — speckle; a logarithm spaces a colour band
  per doubling.
  Measured against plain f64 escape-time, on pixels where f64 itself is stable (a hundredth of a
  pixel either way gives the same count — at the edge, roughly half the pixels are not, and there
  is no right answer to compare with): 100% within 2% at every depth from the whole set to
  10⁻¹¹, along a real dive. In the page: a 100px drag moves the plane 100px, a pinch from 80 to
  240px apart zooms exactly 3×, a wheel zooms without scrolling the page, a double-click doubles,
  and a dive goes 2× deeper every 0.7 s.

- **Light** — a dark room lit by coloured lamps. Drag the lamps, pillars and walls about; tap an
  empty spot for a new lamp (up to six); double-tap anything to take it away. A second finger
  swung round a held wall turns it (the wheel or Q/E with a mouse). Three rooms: Pillars, Mixing
  (red, green and blue round one pillar — where two shadows overlap the third colour remains) and
  Window (beams through slits). 🌀 Drift lets the lamps wander. Keys: L lamp, W wall, Q/E turn,
  D drift, 1–3 rooms.
  Technique: nothing draws the shadows. Once per change, a bake pass writes every texel's distance
  to the nearest surface (and that surface's light, if it is a lamp) into an rgba16float texture —
  the room's whole geometry, one fetch away. Then every texel, at half the canvas's resolution,
  casts 16 rays a frame at angles spread evenly round it and turned by a random amount each
  frame, and sphere-traces each through the baked field until it lands on a lamp (bringing its
  light back) or anything else (bringing nothing). Each frame's answer is blended into the
  picture so far: an exact running average while the room is still, so the grain falls as 1/√n,
  and a short memory (at least a fifth) while anything moves, so a moving lamp's light does not
  smear across everywhere it has been. A still room stops tracing once its picture has settled
  (600 frames), and a paused one gathers 24 frames at once on every change, so it is never left
  grainy — including when it opens paused under reduced motion.
  Measured on the real shaders: the bake matches the CPU's distances to 4.6×10⁻⁴ (f16); behind a
  pillar is fully dark (0) where the same distance in the open is 0.15; light falls off as
  1/distance, as 2D light should (twice as far: 2.00× dimmer, against 2.01 from the angle the lamp
  covers); and the grain halves for every 4× more frames (2.01, 1.97). One test went green when it
  should not have: a wall turned a quarter looks the same either way round, so it could not tell
  which way walls turn — an eighth can, and does.

- **Harp** — strings of light that sound. Strum across them with as many fingers as you like, or
  tap one; a stroke sounds each string it crosses in the order it crossed them, spaced by how far
  into the stroke each was, as a hand spaces them. How fast you strum is how hard, and which way
  is which way the string swings. ✨ Play by itself rolls chords and runs. Harp, Koto, Pluck or
  Kalimba; Pentatonic, Minor or Hirajoshi tunings (any strum sounds good). It plays through the
  site's own synth (`noteOn`), so it is on the Instrument's volume and heard by Music, Ribbons'
  Listen and the visualiser like anything else played. Keys: Z… and A… play the strings, P plays
  by itself, 1–3 tunings.
  Technique: no simulation. A plucked string's motion is the sum of its modes — mode n starts at
  2·sin(nπp)/(n²π²p(1−p)) for a pluck at p, swings n times as fast as the first, and dies n times
  as fast — so the vertex shader works out every point of every string from the time since its
  last pluck, 16 modes, 96 segments a string, drawn as a glowing ribbon added onto the dark.
  Plucked in the middle the even modes vanish (round); near the end the high ones are strong
  (bright) — and you can see it. A string is SEEN to swing a few times a second, an octave faster
  for every two octaves up, since 220Hz drawn at 220Hz is a blur.
  Measured: summed far enough, the modes rebuild the exact triangle the finger pulled the string
  into (the Fourier series, checked against the shape at four points) — and with the 16 drawn, the
  pluck's corner still reaches 0.9 of its height. In the page: two fingers strumming opposite ways
  across all twelve strings at once sound exactly 24 notes; a stroke across five strings plucks
  those five, in order. One bug first: a stroke starting 8px beside a string pressed it AND
  crossed it, sounding it twice — the press still sounds at once (an instrument cannot wait to see
  whether a press becomes a stroke), and the finger skips that string the first time it leaves it.

- **Neon** — type a word and it becomes a neon sign on a brick wall. Each new letter stutters on
  as real neon does; the letters already there stay lit; one letter is always a little faulty and
  buzzes off now and then; a tap on the sign knocks it and everything flickers. Tube (glass bent
  along the letters' outlines) or Solid; Pink, Ice, Gold or Mixed. Keys, with the sign focused:
  K knock, S style, 1–4 colours — and typing in the box never triggers them (checked: an "s"
  typed there is just an "s").
  Technique: the text is drawn into a mask with each letter in its own red, and the JUMP FLOOD
  (Rong & Tan) finds every texel's nearest seed — the outline's texels for a tube, all of the
  glyph for a solid sign — in one pass per halving step plus one more at step 1: nine passes for
  this field, rather than every texel asking every seed. Each seed carries which letter it is, so
  every texel knows both how far it is from the nearest tube and whose tube that is, and each
  letter flickers on its own. The display turns that into a white-hot core, a coloured near glow,
  and the whole sign's light on the wall. All of it runs once per change of text; a frame only
  reads it.
  ⚠️ Two things were wrong first. Letters drawn 1 apart in red (1, 2, 3…) came back as the wrong
  letter on 18% of texels: a canvas keeps colour premultiplied by alpha, so at an antialiased edge
  a red of 1 reads back as 2. Spaced 15 apart, a rounding error cannot cross. And the wide glow
  was taken from each pixel's nearest letter, which carved the wall into one region per letter — a
  dark column behind an unlit one; the far glow is now the whole sign's.
  Measured: the GPU's flood equals a CPU copy of the same flood on every texel, and that flood is
  exact on all but 2 of 122,880 texels of scattered seeds (worst 0.36px) — 34 (worst 0.92px)
  without the extra pass at step 1, which is the test that holds the pass to its job. In the page,
  typing "NEON LAB" over "NEON" leaves the first four letters steady while the new ones stutter.

- **Sand** — a box of sand and water. Hold a finger down to pour (several at once); draw walls;
  erase. Turn the box with ⟲ and ⟳ (or the arrow keys) and everything falls the new way; on a
  phone, 📱 Tilt makes down wherever the phone says it is. Three boxes: an Hourglass (turn it over
  and it pours back through the neck), Shelves, and an empty one. Keys: arrows, S/W/B/E tools, 1–3
  boxes.
  Technique: falling sand written the usual way — every grain looks below itself and moves — is a
  race on a GPU, since two grains can see the same empty cell and both move in. A MARGOLUS
  neighbourhood avoids it: each step the grid is cut into 2×2 blocks (shifted one cell on
  alternate steps) and one thread owns a whole block, reading its four cells and writing the same
  four, only ever swapping them. So nothing races, and no grain can be lost or doubled. Gravity's
  four directions are the same rule read through a turned block. The rules are integers and a
  hash, so a CPU copy matches the GPU exactly.
  ⚠️ Water first spread by stepping left or right at random — a random walk, spreading as the
  square root of time: a block left 1,500 steps still sloped 29 cells deep to 1. Now each drop
  remembers which way it is going (one bit of its shade) and turns round when stopped, so it
  spreads in a line, one cell a step thanks to the shifting blocks; it levels in a few thousand
  steps (six a frame). There is no pressure in a cellular automaton, so it is slightly thick
  water, and that is the honest limit.
  And a comment was wrong: it said sand toppling only three times in four is what makes a pile
  stand at a slope. Forced to always, the pile test still passed — the slope (about 45°) comes
  from grains moving one across for one down; the odds only make the face grainy.
  Measured: after 300 steps with gravity turned through all four directions, the GPU and the CPU
  copy differ in 0 cells, and grains, water and walls are all exactly conserved. An hourglass
  drains at about 65 grains a second and pours back when turned over; a poured pile stands at a
  slope of 1.24. In the page, a mouse pours, two touch fingers pour at once (507 grains), ⟲ from
  down gives right as a clock face says it should, every grain survives the turns, and a tilt onto
  the phone's right edge sends everything right.

- **Pond** — a pond seen from above, over a pool's tiles, pebbles or rippled sand. Tap it for a
  drop; drag through it and it leaves a wake; several fingers at once. 🌧 Rain lets it rain by
  itself, 💦 Splash drops a handful; Shallow or Deep (deep water focuses the light more sharply).
  It opens with a few drops already spreading. Keys: R rain, X splash, D depth, 1–3 floors.
  Technique: the water is a height field, each cell pulled towards its neighbours' average (the
  wave equation) and keeping a little less of its speed each step. The floor is seen through it:
  each pixel's line of sight is bent by the surface (Snell, 1.33) and lands somewhere a little off.
  The CAUSTICS are the clever part, after Evan Wallace's WebGL Water: a mesh as fine as the water
  is laid on it, and every vertex moved to where light through that point reaches the floor.
  Where the mesh is squeezed light is gathered, where stretched it is thinned — so a pixel's
  brightness is the area of surface that lands on it, measured with the fragment shader's own
  screen-space derivatives, and folds add up. Light is only moved, never made.
  ⚠️ Rings came out as rounded squares: four neighbours carry short ripples 11.5% further along
  the diagonals. Nine, edges weighted 4 and corners 1, make them round to 1%. The first test of it
  passed WITH the bug, because it measured a big drop's height — round either way — rather than a
  small drop's slope, which is what the eye sees; it now goes red without the fix.
  ⚠️ And the opening splash vanished: the first frame takes no step, and was emptying the queue of
  drops anyway. Drops now wait for a step to land on (found by counting them in the page).
  Measured: flat water lights the floor at exactly 1.000 everywhere; rippled, the light ranges
  0.81–1.37 and still averages 1.0026 — conserved to a quarter of a percent; the GPU's waves match
  the CPU's to 1.4×10⁻⁶ after 200 steps. In the page: a tap is a drop, a drag leaves 41, two
  fingers make two, the rain is about seven a second.

### Phone checklist — batch 4

- [ ] Fractal — does a pinch feel stuck to the fingers? Let ✨ Dive run for a minute: does it keep
      finding detail, and does it stay smooth (it recomputes every frame while diving, at a
      quarter of the pixels)? Is 〰 Morph worth having?
- [ ] Light — does the grain settle quickly enough to read as light rather than noise? Drag a lamp
      behind a pillar and watch the shadow swing; turn a wall with two fingers; is 🌀 Drift too
      grainy (it never settles while lamps move)? Is it smooth on a phone (16 rays a texel a frame)?
- [ ] Harp — is the sound in time with the finger, or does it lag? (The synth's own latency, which
      the Instrument already tuned.) Strum with several fingers; try Koto and Hirajoshi together;
      does ✨ Play by itself sound musical or random? Is it loud enough next to everything else?
- [ ] Neon — does the phone's keyboard cover the sign while you type (it should scroll)? Does the
      stutter-on read as neon? Is the faulty letter charming or annoying? Try a long word.
- [ ] Sand — 📱 Tilt: does it ask, and does the sand fall to the edge that is lowest — in
      landscape too? Does the water feel too thick? Is the hourglass satisfying to turn?
- [ ] Pond — do the caustics read as light on a floor? Drag a finger for a wake; try Deep with
      rain. Smooth on a phone (two wave steps and a caustic mesh a frame)?
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

| Toy        | Interaction                                                                                                                  | GPU technique                                                                                                                                                                                                                                           | Pattern to reuse                                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Slime      | TOOLS on a living thing: lay food, draw walls, erase, blow spores — then watch                                               | STIGMERGY: tens of thousands of agents sense a shared field and write back into it with `atomicAdd`; the field diffuses and decays                                                                                                                      | "many writers, one grid" — any scatter where several threads land on one cell                                            |
| Mirror     | the CAMERA, and a brush that paints TIME onto it: slow a part of the picture, bring it back                                  | a RING OF PAST FRAMES in a `texture_2d_array` (the newest over the oldest, nothing moved) and a per-pixel delay map choosing which moment each pixel shows, blended between frames                                                                      | "time as a texture" — slit-scan, echoes, any effect that needs the recent past                                           |
| Bubbles    | HOLD to blow (the longer, the bigger), let go to THROW, TAP to pop — and each pop sounds                                     | PHYSICAL THIN-FILM INTERFERENCE per pixel on sphere impostors (no geometry): for red, green and blue, whether the film's two reflections strengthen or cancel at its thickness; reflection ADDED through premultiplied blending                         | "colour from physics" — oil slicks, beetles, anything iridescent                                                         |
| Clay       | SCULPT in 3D: add, carve, smooth with a finger; Turn, two fingers or the wheel to look round; mirror symmetry                | a signed-distance field in a 64³ `texture_3d`, edited by smooth unions in compute and RAY-MARCHED to draw; GPU-side PICKING — a one-thread pass finds where the finger's ray meets the clay and the edit reads it, no round trip                        | "a solid you can change" — any editable 3D shape; and "let the GPU tell itself where you touched"                        |
| Fireflies  | TAP A RHYTHM, or let the MUSIC lead (🎵 Listen); how much they follow each other; then watch them fall into step             | COUPLED OSCILLATORS (Kuramoto) with each firefly feeling its patch and the patches beside it, the patches' sums gathered by a REDUCTION in FIXED-POINT INTEGER ATOMICS (WGSL has no float atomics), and read back each 0.4s to say how in step they are | "sum many floats from many threads, exactly" — any per-cell average, histogram or centre of mass                         |
| Black hole | DRAG and THROW it (it glides and bounces), PINCH or scroll for its mass, TILT THE PHONE to look along the disk or down on it | PER-PIXEL GEODESIC INTEGRATION: every pixel steps its own ray of light through Schwarzschild spacetime (velocity Verlet, adaptive steps) to the sky, the disk or the hole — an ODE solved per fragment, not a shape marched                             | "solve a small ODE per pixel" — any bent, refracted or curved-space ray; and DeviceOrientation with its permission dance |

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

- **Clay** — a lump of glazed clay on a turning wheel. Hold a finger on it and it grows there
  (➕ Add), hollows (➖ Carve) or smooths (〰); 🪞 Mirror makes every stroke on both sides at once
  (on by default — faces come easily); three brush sizes, three glazes, 🏺 the wheel turning it
  slowly, ↺ a new lump. On a phone two fingers turn it and pinch to come closer; with a mouse,
  🔄 Turn and the wheel. Keys: A, C, S, T tools, [ ] brush, M mirror, W wheel, R new lump, 1–3.
  Technique: the clay is a signed distance field in a 64³ `rgba16float` 3D texture — every voxel
  how far it is from the surface. It is drawn by RAY-MARCHING: every pixel steps through the
  volume by the distance it samples until it reaches the surface, lit off the field's own gradient,
  with shadow in the creases from how much clay sits just outside. A stroke folds a sphere in with
  a SMOOTH union or subtraction (Quilez's polynomial smooth minimum), so edges blend rather than
  seam, at 30% a frame so a held stroke builds rather than slaps. And where the finger meets the
  clay is found ON THE GPU: the CPU never holds the clay, so a one-thread pass marches the finger's
  ray through the volume and writes the hit into a small buffer, and the edit in the same
  submission reads it — no readback, no frame of lag.
  ⚠️ One bug, and one wrong diagnosis of it first. The starting lump read back as all zeros, while
  a reset later worked; the first theory was lazy texture clearing, and the fix written for it
  (zeros written in first) changed nothing. The cause was the uniform: `start` skips every voxel
  past its size, and before the first frame the size was 0. It is written before the first
  reset now, and the wrong fix came out.
  Measured: the starting lump matches the CPU's to 4.9×10⁻⁴ (f16); the GPU's pick lands 0.0018
  from the true surface — a seventeenth of a voxel; adding grows the clay with nothing 0.6 away
  touched; carving takes it back; a mirrored stroke grows both sides by exactly 583 voxels each. In
  the page: a held mouse sculpts (the hit buffer reports a hit), Turn turns, the wheel comes closer
  without scrolling the page, and on an emulated phone two fingers turn and pinch with no sculpting
  while they do.

- **Fireflies** — a night meadow of fireflies, each flashing on its own clock, and each nudging its
  clock towards the flashes it sees nearby — until, past a certain pull, the meadow falls into
  flashing together by itself, as real fireflies in Southeast Asia do. Tap and the ones round your
  finger flash with you; tap a steady rhythm and the whole meadow takes up its pace; 🎵 Listen and
  they take up the beat of whatever the site is playing. Shy, Social and Crowd set how much they
  follow each other; 1K, 4K, 12K fireflies (12K not offered to touch). The readout says how in
  step they are nearby and across the meadow, and whose beat they are following. Keys: Space,
  Enter or B taps, S scatters, L listens, 1–3 mood.
  Technique: the Kuramoto model, dθ/dt = ω + K·R·sin(ψ − θ), but LOCAL — the meadow is cut into
  16×10 patches and each firefly is pulled by its own and the eight beside it. Every frame a pass
  clears each patch's three sums, a pass has every firefly ADD its cos θ, sin θ and 1 to its patch,
  and a pass turns every clock. Many fireflies share a patch, so the adds are atomic — and WGSL has
  no float atomics, so they are FIXED POINT: round(cos θ · 1024) into an `i32`. That makes the sums
  exact as well as safe, because integer addition does not care about order: the same crowd sums
  to the same bits every time (checked, three times), which floats added by many threads would not.
  The sums are read back every 0.4s (`mapAsync`, one read in flight) for the readout.
  ⚠️ Three things were wrong first, all found by measuring rather than looking:
  1. **The music led nobody.** A beat pulled every clock towards flashing now, and a simulation
     (then the page, with a 120/min kick track) showed it changed nothing — beats with the crowd
     flashing on them came out no better than with no kicks at all. Two reasons: at 70/min the
     fireflies' own pace drifts off a beat faster than a kick can pull it back; and at 120/min, two
     beats to a flash, the off-beat kick finds every clock half way round and pulls it exactly as
     hard the other way. So a beat now SETS THEIR PACE (folded into a pace they can keep, and
     followed 95%), only the beats the folding kept kick them, and each pull aims a little ahead
     because it goes on pulling while they move. A Shy meadow, which would never find itself, now
     locks onto the beat in 2–4s from 55 to 175/min and flashes within 5% of a turn of it.
  2. **One "in step" figure called a perfect wave 44% in step.** Each firefly only sees its
     neighbours, so a Crowd can lock into a wave sweeping the meadow — every patch flashing
     together, each a little after the one beside it — and stay that way. Over eight crowds every
     patch was 99–100% in step while the whole meadow read 44–99%. The readout gives both now.
  3. **And the per-patch figure read a scattered meadow as 25% in step**, because a few clocks at
     random still add up to about √n of them. It takes away what chance alone gives —
     (|Σ|² − n) / (n(n − 1)), averaged before the square root — and reads under 12% for scattered
     patches of six or of twenty-five.
     Measured on the GPU (4K fireflies): each patch's count is exact and the cos/sin sums agree with a
     CPU's to rounding (220 units off in 8,192 terms, each at most one, as SwiftShader's own cos is
     within 0.19 of a unit); a plain read-add-write instead of `atomicAdd` loses 65–102 of 4,096
     fireflies a frame. Shy stays scattered (0.02 across, 20s), Social reaches 0.80 and Crowd 0.92
     across; a tap brings its neighbourhood to 0.69 in step against 0.03 elsewhere; a 120/min beat
     holds a Shy meadow 100% in step, flashing 0.007 of a turn from the beat. In the page, at 1024 and
     on an emulated phone: taps land where pressed, at full strength on their first frame; five taps
     600ms apart read "following your beat, 98/min" and set that pace, which is let go 5s after the
     last tap; with a 120/min track playing, 🎵 Listen kicks on every other beat (4 in 4s) and reads
     "100% … following the music's beat, 121/min"; mood and count buttons and every key reach the
     shader; no sideways scroll, nothing undersized or clipped.

- **Black hole** — a black hole you can pick up. Drag it across a starry sky and the stars behind
  it bend round it; throw it and it glides, slows and comes softly back off the edges; pinch (or
  scroll) to make it heavier. Its glowing accretion disk shows the famous shape: the far side lifted
  over the top by gravity and seen again underneath, the side coming towards you brighter and bluer.
  📱 Tilt (on phones) looks along the disk or down on it as you tilt the phone, and rolls it as you
  lean — measured from however you were holding it; View does the same everywhere. Skies: Stars,
  Grid (which shows the bending plainly — Einstein rings, nested), Nebula; 💫 Disk on and off. Keys:
  Space, ↑ ↓ view, + − mass, D disk, C centre, 1–3 sky.
  Technique: nothing is drawn and warped. Every pixel starts a ray at the eye and steps it through
  curved space — Schwarzschild's bending, written as ray tracers write it, a pull of
  −(3/2)·rs·h²·p/|p|⁵ with h = |p × v| kept all the way — until it falls in (black), escapes (the
  sky it ends up pointing at) or crosses the disk (its glow: a thin disk's temperature profile,
  shifted by the gas's orbit and by gravity, so the approaching side shines). Velocity Verlet,
  with steps in proportion to the distance far out and shrinking as its square near the hole. About
  90 steps a pixel on average, up to ~300; the canvas is held to 1 device pixel per CSS pixel.
  `blackhole.ts` has the same stepping in TypeScript, so the tests hold it to numbers that share no
  arithmetic with it: the exact deflection integral, and the shadow's size.
  ⚠️ What the tests caught, in my own physics and code:
  1. **The step was too coarse for the light that matters most.** 0.06·r all the way in is a third
     of a percent off for most rays but drifts for the ones grazing the shadow — 0.12 of a radian at
     1% outside its edge, 0.89 at 0.1%, against the exact integral. Those rays draw the photon ring.
     Shrinking the step as r² inside r = 4 brings them to 0.001 and 0.03 for about a dozen more
     steps on a ray that comes close.
  2. **The disk's redshift counted the orbit's slow clock twice.** √(1 − 3M/r) already is gravity
     and time dilation together for light leaving an orbit sideways; I had divided by γ as well.
  3. **A throw took its speed from the hole, not the finger.** The hole eases after the finger, so a
     hole still catching up was flung on release even when the finger had stopped, and lifting one
     finger of a pinch threw it at the other. It is the finger's last 100ms now, nothing if it had
     rested 80ms, and a pinch latches until both fingers are up.
  4. **Chromium now has `DeviceOrientationEvent.requestPermission`** — only iOS used to — and,
     undecided, it answers `'prompt'`. The first version read anything but `'granted'` as a no and
     hid the button for good; it stays now, with a line saying View does the same.
     Measured: the stepping agrees with the exact integral to 0.1% from just outside the shadow
     (b = 2.65) to b = 20, to the weak-field series at b = 50 and 100, captures every ray inside
     3√3/2 rs and frees every one outside; on the GPU, sampled across a 512×320 frame, all 1,632 rays
     have the same fate as the TypeScript stepping and leave in the same direction to 0.005 (the
     8-bit colour they are read back in), and the shadow's radius in pixels is 25.08, 42.04 and 86.4
     against 25.03, 41.98 and 86.4 from the formula, at three masses; the approaching side of the
     disk is 3.6× brighter than the receding. In the page, at 1024 and on an emulated phone: drag,
     throw (it glides to the edge and back), wheel (no page scroll), pinch (mass 1 → 2.5, the hole
     not moving), Tilt (undecided: unpressed with the note; granted: 30° of tilt and 20° of lean read
     as a 38° view and 12° of roll, the slider disabled meanwhile; off: roll back to 0), every
     button, the slider and every key; no sideways scroll, nothing undersized or clipped.

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
- [ ] Clay — does sculpting feel like clay (fast enough, not too fast)? Is it smooth on a phone (it
      ray-marches a 3D texture per pixel)? Is Mirror on by default the right call? Two fingers to
      turn — natural?
- [ ] Fireflies — does it feel like a meadow at night, and is the flash bright enough to see on a
      phone in daylight? Tap a slow rhythm — does it feel like they answer? Put a song on in Music,
      come back and 🎵 Listen — do they flash on the beat? Are the waves a Crowd falls into lovely
      or confusing — and does "nearby / across" explain them?
- [ ] Black hole — is it smooth on a phone? This is the heaviest toy in the batch: ~90 light-ray
      steps per pixel, at 1× pixel density. If it stutters, the cheapest lever is the step count or a
      lower pixel density, not the physics. Does 📱 Tilt ask (iOS) and feel natural? Does throwing it
      feel good? Is the Grid sky interesting or just busy?
