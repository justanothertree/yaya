# Lab handoff — 6 Nov 2026

The state of `#lab`, the WebGPU room. The commits carry the reasoning; this is the map.

evancook.dev deploys from `main`. Batches 1 and 2 are already live there. Batches 3–7 are
integrated together for a real-device pass and stay off the live site until that integration is
merged. None of those thirty toys has been tried on a phone or a real GPU. Frame times below are
SwiftShader, a CPU stand-in, and say nothing about a handset.

The room is one `DEMOS` list. The phone dropdown and ‹ › steppers from batch 3 mount
`current.Demo`, so a toy is in the picker exactly once. Batches 5–7 also carried hand-written
`demo === …` renders for `main`'s old list; those lines are not in this tree.

- **Batch 1 — #17, merged and live**: the room, Swarm, Life, Fluid and Music, and the round that
  made them playful.
- **Batch 2 — #18, merged and live**: Kaleidoscope, Lava lamp, Galaxy.
- **Batch 3 — #19**: Marbling, Growth, Aquarium, Tunnel, Cloth, Ribbons, and the shared picker.
- **Batch 4 — #20**: Fractal, Light, Harp, Neon, Sand, Pond.
- **Batch 5 — #21**: Slime, Mirror, Bubbles, Clay, Fireflies, Black hole.
- **Batch 6 — #22**: Erosion, Snowflake, Pixel sort, Squish, Lightning, Voiceprint.
- **Batch 7 — #23**: Marble maze, Stained glass, Harmonograph, Rain on glass, Loom, Ferrofluid.
- **Batch 8 — draft #25, `claude/lab-toys-8`**: games and builders — Bike trials, Waterworks, Film
  studio, Critters. See its own section at the end.
- **Batch 9 — draft, `claude/lab-toys-9`, STACKED ON BATCH 8**: remixes and new things to make —
  see its own section at the very end.

That is 7 live toys plus 30 integrated ones, 37 in the picker on `main`; batch 8 makes 41. Each batch section below is that batch's
own note, including what it measured and what it had not.

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
| Voiceprint | SING INTO IT (the microphone is the brush), PAINT on the picture, and PLAY it back as sound                                 | a FAST FOURIER TRANSFORM in workgroup memory (1,024 points, ten stages of butterflies, two per thread) every frame; and ADDITIVE SYNTHESIS on the GPU — a sine per row, per sample, written into a buffer that comes back as audio                                                                              | "the GPU as an audio engine" — spectra, filters, resynthesis; and the precision traps of long phases in f32                                                      |

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

- **Voiceprint** — a picture of sound: pitch up the side (rows spaced evenly in pitch, 80 Hz to
  8 kHz, a faint line every octave), time along the bottom (512 columns, a sixtieth of a second
  each), loudness as colour. ▶ Play turns the picture back into sound — a level stroke is a note, a
  slanting one a glide; it starts with a little tune written in (an arpeggio, a glide, a chord).
  🖌 Paint and 🧽 Erase with a finger. 🎤 Listen writes the microphone in, column by column, as you
  sing or whistle, and played back it comes out as a ghost of itself. ♪ The tune puts the tune
  back; ✕ Clear empties it. Leaving the toy stops the sound and turns the microphone off. Keys:
  Space plays, L listens, 1–2 tool, T the tune, C clear.
  Technique: listening, a compute pass of one workgroup takes the newest 1,024 samples, windows
  them (Hann), puts each where its bits reversed say, and runs a radix-2 FFT in workgroup memory —
  ten stages of 512 butterflies, two per thread, a barrier between — then each thread reads one
  row's loudness off the spectrum at that row's pitch. Playing, a pass with a thread per output
  sample sums a sine for every row at the loudness the picture gives it there, eased between
  columns, its phase a function of the time alone so nothing clicks from column to column; 8.5
  seconds come back in one readback and play as an AudioBuffer, normalised and at the instrument
  channel's volume.
  ⚠️ What was wrong first:
  1. **Late in the picture the GPU's sound drifted from the CPU's**, 1.8×10⁻³ on a peak of 0.5. Two
     guesses were tried and measured before the cause was found, and both stayed in because both are
     right: the phase is split so no f32 product is large (pitch × time reaches tens of thousands of
     turns), and the sine is read on −π..π, the only range WGSL holds it to. Neither moved the error
     much. The cause was WGSL's `pow` — the shader computed each row's pitch with it, and pow is held
     only loosely; a pitch a millionth out drifts the phase over seconds. Pitches are worked out once
     on the CPU now, which took the late error to 2.5×10⁻⁴ (and removed 10⁸ pows a play).
  2. **A quick stroke left gaps**: the brush takes 64 dabs a frame and threw the rest away. They wait
     for the next frame now; the same swipe paints 483 where it painted 191.
  3. **WGSL reserves `from`** — a field of the uniform was called it, and was renamed `first`.
     Measured on the GPU: its transform puts the loudest row of a 440 Hz tone, a two-note chord and
     noise on the same row as the CPU's (values within 0.007, 5×10⁻⁵ for noise); its synthesis of the
     tune matches the CPU's sample for sample to 1×10⁻⁴, and 2.5×10⁻⁴ five seconds in; a brush dab
     paints 0.75 where it lands and nothing ten columns away. The tests hold the CPU copy to the maths:
     the FFT is the Fourier sum and keeps every bit of energy (Parseval); a tuning fork lands on its
     own row at about full loudness; rows are even in pitch, an octave the same height everywhere; a
     level stroke plays its row's pitch (counted by zero crossings); rendering a stretch alone gives the
     same samples as rendering the whole; a dark picture is silent. In the page, at 1024 and on an
     emulated phone: Play renders 8.53 seconds and the playhead moves, Stop stops, Clear, Paint and
     Erase change the picture, Listen with Chromium's fake microphone writes columns, the keys work,
     and the microphone's track has ended after leaving the toy.

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
- [ ] Voiceprint — sing or whistle with 🎤 Listen on: does your voice show up where you would expect?
      Played back, is it recognisably you, or just eerie (both are fine)? Is the starting tune
      pleasant? Is the playback loud enough through phone speakers?

## Batch 7 — the toolbox, again

Its own draft PR, branch `claude/lab-toys-7`, from `main`. Not live. Every toy is chosen to differ
from the seven live ones and from #19 (Marbling, Growth, Aquarium, Tunnel, Cloth, Ribbons), #20
(Fractal, Light, Harp, Neon, Sand, Pond), #21 (Slime, Mirror, Bubbles, Clay, Fireflies, Black hole)
and #22 (Erosion, Snowflake, Pixel sort, Squish, Lightning, Voiceprint), in both how you play it and
what the GPU does.

⚠️ **No picker was cherry-picked, and none was invented.** As in batches 5 and 6, each toy is one
entry in `main`'s `DEMOS` list plus one render line, and each entry carries its component (`Demo:`)
for #19's registry. Merged after #19, the conflicts in `GpuLab.tsx` are all "both sides added": keep
both, one closing `]`, and delete this batch's `demo === …` render lines.

Trial-merged on 5 Nov in order — `main`, #19, #20, #21, #22, then this — every conflict was "both
added" (`GpuLab.tsx`, this file, and `lab.css` between #19 and #20). One shape needs care: where
two batches each append an entry inside the same shared `{ … }`, one side stops mid-entry and the
other starts one, so a `},` and a `{` have to go between them. Merged that way: typecheck and lint
clean, and the 441 tests in `src/gpu` green with 37 toys registered.

⚠️ **THE PICKER ON A PHONE.** Measured in batch 6: at 375, `main`'s button picker fits about 2.7
buttons a row, and was 3 rows (119px) with eight. Every three toys that land before #19's dropdown
add about another row. Measured on this branch (all six toys, iPhone 13 emulation, 390 wide):
**13 buttons in 5 rows, 202px** above the canvas. Batches 5, 6 and 7 together would be about ten
rows — most of a phone's screen of buttons. Land #19's picker first. A third picker would only
make the merge worse.

| Toy           | Interaction                                                                                                                                                                      | GPU technique                                                                                                                                                                                                                                                                                | Pattern to reuse                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Marble maze   | TILT (the phone, or a drag that leaves the board tilted), and TOOLS: draw walls, dig holes, pour marbles                                                                         | a SPATIAL HASH BY COUNTING SORT — count per cell (atomics), scan (one workgroup), scatter (atomic cursors) — and POSITION-BASED DYNAMICS with gathered, order-independent pushes; a SIGNED chamfer distance field for the walls, bevelled for drawing                                        | "thousands of things that touch each other" — any crowd, any granular toy                                                         |
| Stained glass | DRAW (lead), then TAP to fill a region — the region is whatever shape you drew — and move the SUN (drag, keys, or tilt the phone)                                                | CONNECTED-COMPONENT LABELLING on the GPU: min-label propagation with POINTER JUMPING, a fixed number of passes a frame; a fill is every cell sharing the tapped label. The floor's light is each floor pixel's ray back to the sun, through the window                                       | "find the regions" — flood fill, paint bucket, islands, rooms, any region a person drew                                           |
| Harmonograph  | a FLICK sets the swing; RATIOS you hear as intervals; a detune that makes the figure turn; it draws itself                                                                       | a COMPUTE RASTERISER: a thread a segment walks its own pixels and adds ink with INTEGER ATOMICS, bilinear and exactly conserved; the paper drawn from the ink's density and colour                                                                                                           | "draw millions of lines yourself" — plots, trails, density maps, any line art a rasteriser is wrong for                           |
| Rain on glass | TOUCH (write in the mist), BREATH — the MIC's loudness, or a held button — fogs it back, and TILT turns which way the water runs                                                 | SCREEN-SPACE METABALLS: drops splatted as instanced quads with ADDITIVE BLENDING into a float field, thresholded and REFRACTED through the slope; a PERSISTENT MIST in two textures that take turns, cleared by fingers and water                                                            | "blobs that join" and "a surface that remembers" — paint that dries, frost, condensation, any metaballs                           |
| Loom          | TOOLS on a draft — draw the threading and treadling, tap the tie-up — or TAP THE CLOTH and a whole family of crossings flips; it WEAVES ITSELF pick by pick, each treadle a note | PROCEDURAL MATERIAL from a bit-packed draft: every pixel looks up its crossing (a bit of the tie-up), its neighbours' (to bend each thread where it dives), and optionally walks its float, then lights the thread as a twisted cylinder — no geometry, no textures                          | "a rule-built pattern drawn as a real material" — knitting, tiles, brickwork, basketry, any grid of crossings                     |
| Ferrofluid    | PRESS AND HOLD — a magnet gathers while held, so time is the control — with MULTI-TOUCH (a magnet a finger), and AUDIO: the bass of whatever plays drives a magnet               | A SPECTRAL PDE SOLVER: Swift–Hohenberg, its stiff part solved exactly in Fourier space, with a GPU FFT done a row (then a column) per WORKGROUP IN SHARED MEMORY, twiddles from a table, direction an OVERRIDE CONSTANT; the pattern (hexagonal spikes) is chosen by the equation, not drawn | "solve it in Fourier space" — blur and sharpen at any radius, diffusion with big steps, wave equations, convolution, any spectrum |

- **Marble maze** — a wooden maze full of coloured marbles. 🖐 Tilt: drag and the board tips the way
  you drag and stays there (⚖️ Level puts it flat); on a phone, 📱 Tilt tips it as you tip the phone.
  ✏️ Wall draws walls, 🕳 Hole digs holes, 🧽 Erase rubs either out, ⚪ Pour streams marbles from a
  finger (up to 4,096). A count says how many are in the holes, with a marimba plink for each one
  that drops. ↺ New maze carves another. Keys: arrows tilt, L level, N new maze, 1–5 tool.
  Technique: each step, every marble guesses where gravity takes it and is pushed out of the walls
  along the distance field; then the marbles are SORTED INTO CELLS a marble across — count with
  `atomicAdd`, prefix-sum the counts in one workgroup's memory, scatter into each cell's run — so a
  marble only reads the nine cells round it, not all 4,095 others; each gathers half of every
  overlap from its neighbours (gathered, so no thread's order matters); the velocity is the move.
  The walls' field is a chamfer distance worked out from both sides, so it is negative inside a
  wall and its slope always points out.
  ⚠️ Four things were wrong first:
  1. **The pipeline layout was refused**: one layout for every pass used 10 storage buffers, and a
     stage may use 8 — WebGPU's default, and what phones have. The board's passes and the marbles'
     now have a layout each (4 and 8).
  2. **Marbles left the board.** Started crowded, they were pushed into the walls, and the field was
     0 inside a wall — no slope to climb out on — so the probe watched them leave altogether, on the
     CPU copy as well as the GPU. The field is signed now; pushes are capped at a radius a step and
     speeds at 250 cells a second (slower than a radius a step, so nothing tunnels); and a marble is
     clamped inside the board whatever the crowd does — a board can be poured fuller than it holds.
  3. **One of my own tests packed 200 marbles into a box that holds about 180** — a fixture that
     could not pass, rather than a bug. 100, and a separate over-packed test for the clamp.
  4. **Holes were drawn cell by cell**, a staircase; their edge is read between cells now.
     Measured on the GPU, from the same 300 marbles: one step matches the CPU's to 8×10⁻⁵ cells with the
     same marbles alive. Twenty steps of a crowd do not match, and should not — collisions amplify the
     10⁻⁷ differences in summing order the way any chaotic crowd does — so the long check is one marble
     alone, rolled off walls for 60 frames: 8.6×10⁻⁵. The GPU's sort holds every live marble exactly
     once, with starts in order. The tests hold the CPU copy to the counting sort (every marble once,
     grouped by cell), the field (within 9% of Euclid, negative inside a wall, pointing out), the
     physics (two marbles end just touching, momentum even; none ever left in a wall or off the board,
     however crowded; they roll downhill and come to rest; holes swallow them) and the maze (every open
     place reachable from the start). In the page, at 1024 and on an emulated phone: a drag tilts, keys
     and Level work, a stroke draws walls and Erase takes them out, a click digs a hole, Pour streams
     marbles, New maze resets, and synthetic orientation tips the phone's board by sin of the angle.

- **Stained glass** — a stained-glass window you make, and the light it throws. ✏️ Lead draws lead
  lines; 🎨 Fill and a colour (Ruby, Amber, Gold, Emerald, Cobalt, Violet, Sky, Clear) glaze the
  pane you tap — the whole pane, whatever shape the lead made it, and nothing past it; 🧽 Erase
  lifts lead, and a gap joins two panes into one. ☀️ Sun (or the arrow keys, or 📱 Tilt the sun on a
  phone) moves the sun, and the window's colours slide across the stone floor below it. ✿ Rose
  window starts from a glazed rose; ▢ Empty frame from nothing. Keys: arrows sun, 1–4 tool,
  C colour, R rose, N empty.
  Technique: CONNECTED-COMPONENT LABELLING. Every cell of glass starts with its own index as its
  label; each pass every cell takes the smallest label among itself and its four glass neighbours —
  lead stops it — and then JUMPS, taking the label its new label has. Thirty-two passes a frame for
  eight frames after the lead moves; a tap that comes sooner finishes the labelling first. A fill
  colours every cell whose label is the tapped cell's — all on the GPU, no readback. The floor is
  drawn by sending each of its pixels back along the sun's ray to the window plane and taking the
  glass's colour there.
  ⚠️ What was wrong first: 24 passes a frame was the guess; the rose window needs 28 (measured), so
  it is 32, and the engine keeps going for eight frames — a 1,740-cell spiral corridor needs 115
  passes, where a label crossing one cell a pass would need 1,740. Two of the probe's taps first
  landed on lead (the middle of a rose window is a spoke) and filled nothing, correctly.
  Measured on the GPU: its labels equal the CPU's on all 58,240 cells of a rose window (38 panes);
  a tap fills all 893 cells of its pane and none outside; after a lead line is drawn across that
  pane, a tap above it fills only the 173 cells above. The tests hold the CPU copy to a plain flood
  fill (a rose window and five scribbles) and count the passes. In the page, at 1024 and on an
  emulated phone: a line drawn across the empty frame splits it so Ruby fills one side; erasing a
  gap joins them so Cobalt fills the whole window; the swatches choose and switch to Fill; the sun
  follows a drag, the keys and synthetic phone tilt.

- **Harmonograph** — the Victorian drawing machine. Flick the paper and the pendulums swing — the
  flick's strength the swing, its direction the phase between them, which is the shape — and the
  pen draws their figure as they slow, each drawing in a new ink over the last. Five ratios, each
  sounded as an interval when it starts (1:1, 1:2 an octave, 2:3 a fifth, 3:4 a fourth, 3:5 a major
  sixth); Detune puts each axis's second pendulum a little off its first, and the figure turns as
  it fades; Steady or Quick; ✕ Clean paper; sound on or off. Keys: Space swings, 1–5 ratio, S
  speed, C clean.
  Technique: the pen's path is analytic — two pendulums across, two up and down, each a decaying
  sine — and the GPU draws it without its rasteriser: each frame thousands of segments get a thread
  each, which walks its own pixels (a step a pixel of its longer side) and adds each step's ink
  into the four pixels round it with `atomicAdd`, in integers, so the order threads add in changes
  nothing and the ink is exactly conserved (the four shares always add to a whole step). Four
  channels a pixel — red, green and blue ink and the total — and the paper pass draws coverage from
  the total and colour from the mix.
  ⚠️ Two things were wrong first:
  1. **Every figure was a squashed spiral.** Each axis had a share of both frequencies, so x and y
     moved almost together. A lateral harmonograph swings one frequency across and the other up and
     down, with a smaller, detuned partner on each — and then the figures are harmonographs.
  2. **I wrapped the angle before `sin`, expecting it to close the GPU's gap to the CPU, and it did
     not** (worst pixel 59 → 61 units). Measured instead: the gap is SwiftShader's sin moving the pen
     ~0.005 px, a unit of ink a step, over the dozens of steps that cross a pixel — 3.3%, now 1.9%,
     and invisible. The wrap stayed, because WGSL only promises sin on −π..π.
     Measured on the GPU, a whole figure of 40,000 segments: 10,979,840 units of ink against the CPU's
     10,980,608 (the difference is 3 steps, a segment's step count rounding the other way at a whole
     pixel); every well-inked pixel within 1.9%. The tests hold the pen to the machine (a whole ratio
     without damping closes its figure; with damping it spirals in at the decay's rate) and the ink to
     its promises (exactly INK a step however the pen lands, no pixel skipped, two halves of a line
     ink what the whole line does, the colour split in whole units). In the page, at 1024 and on an
     emulated phone: a flick starts a new drawing in the next ink with two notes; the ratios and the
     detune reach the pendulums; Quick draws faster; Clean paper wipes the ink; the keys work.

- **Rain on glass** — a misted window at dusk with a city blurred behind it. Rain lands and clings;
  a drop grows as rain joins it until it is heavy enough to run, runs in fits and starts, leaves a
  clean trail through the mist and a line of droplets, and swallows whatever it meets. ☝️ Wipe
  writes in the mist, which fogs slowly back; 🌬 Hold to breathe — or 🎤 Blow into the mic — mists
  it over low in the middle, where a face would be; 💧 Drip adds your own water (a tap a drop, a
  drag a line of it that gathers and runs); ↻ Tilt turns the glass (on a phone, 📱 Tilt) and the
  water runs the new way. A Rain slider from none to a downpour; Fog it; Dry it. Keys: ← → turn,
  ↓ straight, − + rain, F fog, C dry, 1–3 tool, Space pause.
  Technique: a few hundred drops live on the CPU (their physics is the testable part); the picture
  is three passes. **Splat**: every drop is an instanced quad, and its fragment ADDS a smooth bump to
  an `rg16float` field — the bump, and the bump times the radius, so a pixel knows how big the water
  over it is. A running drop's quad stretches back along the fall into a tail that thins as it goes.
  Where two bumps overlap they sum past the threshold between them, so touching drops are one shape
  with a neck: screen-space metaballs, with blending doing the summing instead of a loop over every
  drop in every pixel. **Fog**: an `r8unorm` mist that remembers — two textures taking turns — fogs
  back unevenly a little each frame, faster under a breath, and is cleared under a finger (a capsule
  per stroke segment) and under the water. **Show**: the street sharp through clean glass, blurred
  and pale through the mist, and through water bent by the surface the field's slope gives: the drop
  looks back past its own middle, so the street in it is small and upside down. One more pattern
  worth reusing: the three passes use `layout: 'auto'`, because the field is drawn into by one pass
  and read by the next two, and a single shared layout would bind it as a texture in the very pass
  rendering to it — a usage conflict WebGPU refuses.
  ⚠️ What was wrong first:
  1. **Every trail droplet was swallowed straight back up.** It was left where the drop had been a
     frame earlier, a few px behind and well inside merging reach, so a running drop left nothing.
     They are left a body-length behind now, on an odometer rather than a guess.
  2. **A still drop's back half was thinner than its front.** The tail's taper was applied to
     everything behind the centre, tail or not; the probe's comparison of one drop against the
     formula went from 2×10⁻⁴ to 0.3 and caught it. The taper scales with how much tail there is.
  3. **The first storm was columns**: 15% of new raindrops were heavy enough to run at once, and the
     tails were full-width capsules. Fewer big drops, and tails that thin and shallow.
  4. **A stroke made while paused did nothing, and there was no way to unpause by sight.** The redraw
     asked `running` from inside `make`, which runs once, so it was always the value at the start —
     measured: 0 frames drawn while paused and the mist untouched, against 7 frames and a cleared
     stroke with it read from a ref. And with reduced motion the Lab starts paused, so a rain toy
     with no ▶ Run button could only be started from a key; it has one now.
     Measured on the GPU: one drop's field matches the formula to 2.4×10⁻⁴ across 10,000 pixels (1,264
     pixels inside it against πr² = 1,257); two drops 2px apart join (0.585 at the neck against
     0.586 wanted) and 10px apart do not; a running drop's tail is behind it whichever way down is; the
     mist is 0.85 where fogged, 0 under water and under a stroke and its ends, softened at the edge; a
     second of regrowth adds 0.0996 against 0.1; a breath fogs the middle 0.498 (0.5 wanted) and the
     corner 0.035; a paused frame changes no mist at all. The tests hold the drops to keeping the water
     — a merge and a trail neither make nor lose any, through 200 steps of a storm — and to clinging,
     running downhill whichever way down is, merging at the water's middle, running off the glass, the
     cap, a finger taking exactly the drops it touches, and a breath that rises slowly and is not
     fooled by a knock. Each was made to fail once (ten perturbations, every one caught). In the page,
     at 1024 and on an emulated phone (touch): a stroke clears the mist under it and not beside it;
     Fog it and Dry it; a tap drips one drop and a drag a line that runs; a Tilt drag turns the fall;
     holding 🌬 breathes 0.89 and letting go falls back; the keys turn, rain and dry; the mic button
     opens the (fake) mic. Audit clean at both.

- **Loom** — a weaver's draft on squared paper beside the cloth it makes. The squares along the top
  are the THREADING (which of eight shafts each warp end goes through — drag across them to
  rethread), the corner is the TIE-UP (which shafts each treadle lifts — tap to tie or untie), and
  the column on the right is the TREADLING (which treadle each pick presses — drag down it). Tap the
  cloth itself and the one tie-up bit that crossing reads flips, so every crossing that shares its
  shaft and its treadle flips with it, all through the cloth. ▶ Weave runs the loom: pick by pick the
  shuttle crosses (left to right, then back), the cloth scrolls up, and each treadle plays its note —
  a pentatonic run on the kalimba, so the treadling is a tune. Six drafts (Log cabin, Houndstooth,
  Herringbone, Rosepath, Satin, Tartan), 🎨 four colourways, 🔍 Long floats marks every float longer
  than three threads in red hatching (the hint gives the longest), ↺ Weave again starts from bare
  warp, Speed, Size, sound. Keys: Space weave, 1–6 draft, C colours, F floats, U weave again, − +
  size, M sound.
  Technique: there is no geometry and no texture. The draft is 264 u32s in one storage buffer — each
  part repeated out to 64, so the shader has one modulus — and every pixel finds which part of the
  draft it is on, then for the cloth: its crossing (bit `threading[end]` of `tieup[treadling[pick]]`),
  its neighbours' along each thread, to bend a thread on top down where it dives under, and, with
  floats marked, the run of its float (a walk of up to 16 each way). The thread on top is lit as a
  twisted cylinder — normal from across its width, tilted where it dives, ply ridges slanting along
  it, a sheen that drifts as the light moves; the one beneath is shadowed. Unwoven picks show bare
  warp over the loom's dark, and the pick being woven has weft only as far as the shuttle has got.
  ⚠️ What was wrong first:
  1. **The pack test was green with the tie-up packer stopped at four treadles**, because the twill
     it was fed ties only four — a fixture sitting on its defaults, exactly CLAUDE.md's warning. It
     also checks the satin now, whose eight treadles are all tied.
  2. **Choosing a draft unwove the cloth**, leaving bare warp for ten seconds — a button that seemed
     to do nothing. A draft shows on the cloth at once now, and only ↺ Weave again starts bare.
  3. **`woven` started at 10⁹** to mean "already woven", and the shader gets it as an f32, where a
     pick's fraction is below precision: the shuttle could never move. It starts at 400.
  4. A `select(x < f, …)` parsed as a template list (the known WGSL trap), and the 375 audit caught
     a slider's value clipped ("medium", "3 a second") — shorter words now.
     Measured on the GPU: the cloth's colour at every cell centre (589 cells) says warp or weft exactly
     as the CPU's drawdown does, for a twill, the satin and rosepath, and scrolled by five picks; every
     square of the threading, tie-up and treadling (464) is inked exactly where the draft says; the
     shuttle's pick has weft on the left only and the unwoven ones none; long floats are marked on
     exactly the 515 cells of 589 the CPU says (satin, over 6) and none in plain weave. The tests hold
     the drawdown to what weavers know (plain is a checkerboard, a 2/2 twill a diagonal, herringbone
     turns with a clean break, satin crosses once a row never beside the last, rosepath mirrors about
     its point), floats (1, 2 and 7), a tap flipping exactly its shaft-and-treadle family, the layout,
     and the packing. Ten perturbations each fail a test. In the page, at 1024 and on an emulated phone:
     it weaves (~3 picks a second), the tie-up ties by click and by touch, a drag rethreads and
     retreadles (with a note a pick), a cloth tap flips one tie-up bit, the drafts, colourways, floats,
     size and keys all reach the GPU. Audit clean at both.

- **Ferrofluid** — a dish of black magnetic liquid. Press and hold on it and a magnet gathers
  underneath (about a second to full strength, so the spikes come up as you hold rather than
  appearing); the pool bristles into a hexagonal field of glossy spikes; drag and they follow; let
  go and they sink flat. Several fingers are several magnets (four at most). Magnet sets how strong
  a full magnet is: at the low end hexagons of spikes, at the top mazes, as real ferrofluid does in
  a strong field. 🎵 Dance to the music puts a magnet under the middle that pulses with the bass of
  whatever is playing anywhere on the site (🎤 Mic for the room). Settle it flattens the pool. Keys:
  hold Space for a magnet, arrows move it, D dance, C settle, P pause.
  Technique: the surface is the Swift–Hohenberg equation, `∂u/∂t = r(x)u − ((k₀²+∇²)/k₀²)²u + gu² − u³`,
  the textbook model of a surface that must choose a pattern: flat where `r < 0`, patterned at
  wavelength 2π/k₀ where `r > 0`, and with `g > 0` upward spikes on hexagons. `r` is the magnets'
  field. Each step (three a frame): the growth, quadratic and cubic terms in real space; a forward 2D
  FFT; every mode multiplied by its exact damping; an inverse FFT. The FFT is 256 points a line, one
  workgroup of 128 threads a row, then a column, with the line in workgroup memory — bit-reversed
  load, eight butterfly stages with a barrier each, twiddles read from a table rather than computed —
  and its direction is a pipeline OVERRIDE constant, so two entry points make four pipelines. The
  liquid is drawn top-down: height from the pool's heap and the spikes, normal from its slope, and a
  studio reflected in it with a Fresnel term, so the steep sides of the spikes catch the softboxes.
  ⚠️ What was wrong first:
  1. **The whole pool rose as one lump.** With spikes 11 cells apart (k₀ ≈ 0.57) the textbook
     operator `(k₀² + ∇²)²` damps the flat mode by k₀⁴ ≈ 0.1, weaker than the field's growth. It is
     scaled by k₀² now, so the flat mode is damped by 1 and only k₀ is free; the test that the
     pattern's spectrum peaks at k₀ caught it.
  2. **"Spikes" were stripes.** Hexagons need a modest growth: measured on a 64² grid, r = 0.2
     settles into spikes (peaks twice as far up as troughs go down, skew 0.8), r = 0.5 into stripes
     (skew 0.05). A full magnet gives r = 0.25 now; the Magnet slider goes past it into mazes on
     purpose.
  3. **A magnet's patch was four spikes wide** (REACH 34); it is 60 cells, about ten spikes across.
  4. A flat pool reflected nothing (the studio's lights were all off to the sides of straight up);
     it has a soft light overhead now.
     Measured on the GPU: the shared-memory FFT of 65,536 random complex values matches the CPU's to
     2.5×10⁻⁷ of the largest; forward and back returns the input to 3.3×10⁻⁷; a pure tone lands in
     exactly its two bins (32,768 each, the rest under 0.0011); one whole step of the surface — noise,
     growth, both FFTs, damping — matches the CPU doing the same arithmetic to 3.6×10⁻⁸; under a held
     magnet the spikes' spacing (the spectrum's peak) is 10.94 cells against 11 designed, the dry dish
     stays exactly 0, and released it settles to 0.0007. The tests hold the FFT to the DFT term by term
     and to Parseval, the damping to leaving k₀ alone, the surface to going flat with no field and
     rising at its own wavelength with one, spikes up rather than pits (and symmetric with g = 0), and
     stability at a large step; and the magnets, the pool, the ramp, the bass. Twelve perturbations
     each fail a test. In the page, at 1024 and on an emulated phone: a held mouse gathers a magnet to
     full and raises spikes (rms 0.18, peaks 1.47), a drag moves it, letting go removes it and the
     surface goes flat; held Space and the arrows make and move one; two touches are two magnets;
     Settle it flattens; a strong Magnet makes mazes; the mic's (fake) sound drives the speaker magnet.
     Audit clean at both.

### Phone checklist — batch 7

- [ ] The picker: how many rows of buttons above the canvas at 375? Moot once #19 lands.
- [ ] Marble maze — does 📱 Tilt feel like tipping a real board (and ask, on iPhone)? Smooth with a
      few thousand marbles poured? Is the board's stay-tilted drag natural with a mouse? Do the
      plinks get annoying?
- [ ] Stained glass — is drawing lead with a finger precise enough to make the panes you meant? Does
      a pane fill feel instant? Does the light on the floor read as light through a window?
- [ ] Harmonograph — does a flick feel like giving the pendulums a push? Are the intervals' notes a
      nice touch or noise? Does a figure take about the right time to draw?
- [ ] Rain on glass — does writing in the mist feel like a finger on a cold window? Does blowing into
      the mic fog it (and does the mic prompt feel worth it)? Do drops cling, gather and run like
      rain, and do their little upside-down streets read? Smooth in a downpour?
- [ ] Loom — at 375 the draft's squares are about 11px: can a finger thread, tie and treadle them,
      or does it need a bigger Size? Is tapping the cloth to flip a family delightful or baffling?
      Is the woven cloth convincing as cloth? Does the treadling-as-a-tune earn its sound?
- [ ] Ferrofluid — does holding feel like a magnet gathering (is a second too slow)? Smooth on a
      phone — three FFT round trips of 256² a frame? Do two fingers make two clean fields? Does
      it dance to music convincingly, and does it look like glossy black liquid?

## Batch 8 — games and builders

Its own draft PR, branch `claude/lab-toys-8`, from `main` after #24 (all 37 toys on one
registry). Evan played the 37 on a desktop; none has been on a phone. This batch leans away from
"another effect" toward things to DO: games with a goal and a restart, and builders that keep what
you make. Each is one entry appended to `DEMOS`, so it merges as an addition.

⚠️ **MEASURED HERE vs ASSUMED.** Every number below marked _measured_ came from headless Chromium
on SwiftShader (a CPU stand-in for a GPU) or from the unit tests. "Emulated phone" means
Playwright's iPhone 13 profile with CDP touch events — it checks layout and that touches reach the
controls, and says NOTHING about a real phone's speed, feel, thumbs or permission prompts. Those
are in the checklist at the end of this section as questions.

| Toy         | What you do                                                                                                                                                                          | GPU technique                                                                                                                                                                                                                                                                                   | Pattern to reuse                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Bike trials | A GAME: throttle, brake and lean a dirt bike over a course against the clock; checkpoints, crashes, a best time                                                                      | a SIGNED DISTANCE FIELD BAKED ONCE from the course's polygons (brute force per texel: nearest edge, sign by crossing count), then reused three ways — drawing the ground's layers and grass, lighting nothing extra, and colliding the mud particles the tyres throw                            | "bake the level once, ask it every frame" — any 2D level's collision and look from one field                                         |
| Waterworks  | A PUZZLE: four levels and a sandbox — get the water into the cup by drawing walls, freezing it into a bridge, boiling it over a wall, melting ice gently                             | a FLIP FLUID: particles → staggered grid with fixed-point `atomicAdd`, a pressure solve by warm-started Jacobi, the change back to the particles; each drop carries its own temperature and state (water, ice, steam) and ice becomes solid for the liquid                                      | "particles with a grid" — any liquid that has to fill, pour and splash; per-particle state machines driven by a field                |
| Film studio | A BUILDER with a result to keep: place and pose actors, props and lamps, frame with a lens, aperture and focus, then shoot and save a PNG; scenes save to this browser and to a file | a PROGRESSIVE PATH TRACER in a compute shader — analytic spheres, turned boxes and capsules (an actor is a dozen), direct lamp sampling at each diffuse bounce, a thin lens for depth of field, a running sum that settles; the same intersection maths on the CPU picks what is under a finger | "render the real thing, slowly, and keep it" — any offline-quality picture a toy can make, and picking that agrees with the renderer |
| Critters    | A BUILDER and a race: make a creature of joints, bones and muscles on a grid, then race 256 copies whose brains evolve, generation by generation                                     | A WORKGROUP PER CREATURE: joints in workgroup shared memory through many substeps of position-based dynamics, Jacobi constraint passes gathered per joint from an adjacency list; instanced drawing of every copy                                                                               | "many small independent simulations at once" — populations, ensembles, a workgroup each, shared memory as the scratch pad            |

- **Bike trials** — a trials bike in a quarry. Gas and Brake drive the back wheel; Lean back lifts
  the front (over the block, onto the log, for landing a jump), Lean forward keeps the nose down on
  a climb. Hit your head and it is a crash: ↺ Back to the flag puts you on the bike at the last
  checkpoint passed (the clock keeps going), ⏮ Start again starts the run over. One course, the
  Quarry: bumps, a block, a log, a gap to jump, a long hill, a staircase, a pit, a run to the
  chequered flag; four checkpoint flags that turn green as you pass. The clock counts whole 60ths;
  the best time is kept in this browser (`lab_trials_best_v1`, read back only if it is a whole
  number of frames between a second and an hour). On screen: four hold buttons (two leans, Brake,
  Gas) that keep a finger captured until it lifts, so a thumb sliding off Gas mid-jump keeps the
  throttle open; two thumbs at once work. Keys: ↑/W gas, ↓/S brake, ←/A lean back, →/D lean
  forward, R back to the flag, N start again, P pause.
  Physics (CPU, `trials.ts`, fixed 600 Hz, nothing random): a chassis and two wheels; each wheel
  hangs on a FORK — soft along the frame's up (the suspension), stiff across it; ground contact is a
  stiff penalty spring with regularised Coulomb friction, and the tyre's spin enters the friction
  so the engine's torque on the back wheel becomes traction; half the engine's torque kicks back on
  the frame. The GPU never decides anything about a run, so a ride is the same on every machine.
  GPU (`trials.wgsl`): `bake` writes every texel's signed distance (8 texels a metre, 248,064 of them
  for the Quarry) — the nearest edge of the ground, negative inside by counting crossings, exactly
  as the CPU's `inGround` does; `fly` moves up to 4,096 mud particles with gravity and drag and,
  where the field says they are in the ground, pushes them out along its slope and takes most of
  their speed; `show` draws the sky, two parallax hill ranges, the ground from the field (depth gives
  it layers and stones, the edge grass), the flags and the bike and rider from a dozen shapes posed
  from the physics; `mud` draws the particles.
  ⚠️ What was wrong first, each found by the tests or a probe:
  1. **The bike backflipped on the throttle.** All of the engine's torque reacted on a light frame;
     half of a smaller torque does now, so a wheelie needs a lean.
  2. **Square steps were walls.** A wheel meets a square step with an upward normal of (R − h)/R —
     0.17 at h = 0.3 — and bounced straight back off it forty times running. Every step up leans now.
  3. **The kicker threw the bike flat into the gap**, two metres short: a smooth hill levels off at
     its top. It is straight to the lip.
  4. **The suspension was one isotropic spring**, so a wheel that hit the block's face swung back
     on it like a pendulum (0.21 m across the fork; 0.06 with the fork). A test now holds that.
  5. **A wheel landing just past the gap's lip was thrown down into it at 26 m/s.** The ground's
     inside was decided by which side of a segment's LINE a point was — past the end of a wall the
     line runs on through the air. Inside is a crossing count now, in the physics and the bake alike.
     _Measured_: the scripted rider in the tests (throttle, and lean to match the slope a metre ahead)
     finishes the Quarry in 18.8 s with no crash, which is the claim that the course can be finished;
     the same inputs give the same ride twice. The bake matches the CPU's signed distance to 3×10⁻⁶ m
     at 3,000 random texels, with no sign wrong among the 2,340 texels within 20 cm of the surface;
     300 mud particles dropped on flat ground all come to rest on it, none in it; 100 thrown hard at
     the start wall all bounce back, none through. In the page, at 1024 and on the emulated iPhone: the
     keys drive (20 m in a second of ↑), lean, brake, crash (by leaning back on the throttle until the
     head hits), R puts the bike at the checkpoint, N restarts; the pad's Gas held with a mouse drives
     and stays held after the pointer slides off; on emulated touch, Gas plus Lean back together pull a
     wheelie (0.43 rad); a corrupt stored best is ignored. The 375 audit is clean.
     Not measured: frame rate on any real GPU or phone, how the controls FEEL, and whether the course is fun or too hard. Twelve deliberate breaks of the physics
     and the packing each fail a test.

- **Waterworks** — get the water into the cup, to the red line. Five levels, one at a time:
  1. **Fill the cup** — the tap pours onto the floor and past the cup. ✏️ Wall draws (300 cells
     of ink), 🧽 Erase takes walls back and refunds the ink: draw a chute.
  2. **Ice bridge** — the stream runs off a ledge and down a shaft. Hold ❄️ Cool just inside the
     top of the shaft and the falling water freezes into a bridge level with the ledges; let go and
     the water runs over it to the cup. Ice frozen too high dams the stream: 🔥 Heat melts it.
  3. **Up and over** — a wall between the pool and the cup. Hold 🔥 Heat on the pool: it boils,
     the steam spreads under the ceiling and over the wall, the cool plate on the far side turns it
     back to rain, and the rain falls into the cup.
  4. **Gently** — a block of ice in a freezer hopper over the cup. Short bursts of 🔥 Heat melt it
     and it drains into the cup; hold the heat too long and it boils away instead.
  5. **Sandbox** — every tool and 2,000 cells of ink.
     A level shows ✓ once solved; solved levels are kept (`lab_waterworks_v1`, a list read back only
     as known level ids). ↺ Restart; Next appears when the cup is full. Keys: 1–4 tool, R restart, N
     next level, Space pause.
     Technique (`waterworks.wgsl`): FLIP on a 160×100 staggered (MAC) grid, two 120th-of-a-second
     substeps a frame. `clear`; `p2g` — each water drop adds its velocity to the four nearest u-faces
     and v-faces with bilinear weights, in fixed point by `atomicAdd`, and counts itself into its cell
     (water, ice and steam in ten bits each); `faces` — sums become velocities, a copy is kept, gravity,
     faces touching rock or ice are zero; `diverge`; 40 `jacobi` passes for the pressure, never below
     zero; `project`; `g2p` — each drop takes back the CHANGE in the grid's velocity (95% FLIP, 5%
     PIC), moves an axis at a time stopping at rock, warms or cools toward its cell's plate or the
     finger's tool, and changes state at the thresholds (freeze < −1, melt > 2, boil > 100, condense
     < 92 — gaps, so a drop at a line does not flicker). Ice does not move and is solid to the water;
     steam rises, wanders, and is pushed from crowded cells to empty ones. Then `count_cup` counts the
     water in the cup on the GPU, read back a few times a second. `waterworks-draw.wgsl` splats every
     drop into a float texture (water, ice, steam in three channels) and reads it back as a surface.
     ⚠️ What was wrong first — each found by measuring:
  6. **Every drop's vertical velocity landed on one face of the grid.** The v accumulators were
     indexed as if v came after u in one buffer, which is how `vel` is laid out but not them; the
     out-of-range writes were clamped onto the last element. Nothing moved.
  7. **A still pool sank to 17% of its volume in six seconds** (2,736 wet cells to 468): 40 Jacobi
     passes from zero never reach the bottom of a pool. Starting each solve from the last one's
     pressure keeps it within 2% and level to half a cell. A push apart for crowded cells (the
     usual FLIP volume fix) was tried and only ever pushed: the same pool swelled 11%.
  8. **Steam rose in a column and never crossed the wall**; now it spreads from crowded cells.
  9. **Steam cooled on its way and rained back over the kettle**, and the cold plate at −40 froze
     what reached it into ice hanging from the ceiling — 44 drops in the cup in 23 s. Steam keeps
     its heat unless something cold is near (a GAME RULE, not physics, and said so in the code), and
     the plate is a cool 5 °C.
  10. **Water hung from the ceiling** — suction. Pressure is clamped at zero: water pushes and cannot
      pull.
  11. **Level 2 was impossible as first drawn** (a pit needing 13,000 drops of ice to fill) and
      **level 4 solved itself** (the room thawed the ice in ten seconds); both redesigned on what the
      probe showed. And the cup's red line was drawn at the rim, so a full cup looked a quarter full.
      _Measured_ (SwiftShader): a still pool stays still (rms 0.66 cells/s), level (to 0.5 cells) and
      keeps its volume to 1.6% over six seconds; a dam break settles with every drop accounted for, none
      in rock, none NaN; the GPU's cup count equals the CPU's (300 = 300, 569 = 569); heating a pool
      turns 3,398 of 4,032 drops to steam that rises from y ≈ 89 to y ≈ 30, and cooling freezes ice
      that does not move at all. **Every puzzle was played by a script on the GPU, both ways**:
      untouched, each cup stays at 0 for the whole run; solved — a chute (255 ink), the cold held just
      inside the shaft, the pool boiled, the ice melted in short bursts — they reach 1,222, 1,821, 725
      and 2,090 against 400. Held heat on level 4 got only 271: "gently" is real. In the page at 1024,
      level 1 was solved by drawing the chute with the mouse, its ✓ stored, Next taken; erase refunded
      ink; the cool tool reaches the shader only while held; keys work; on the emulated iPhone a touch
      stroke draws the wall. Audit clean at both. Twelve deliberate breaks of the rules each fail a test.
      Not measured: real-GPU frame rate (SwiftShader takes ~120 ms a frame with 7,200 drops, which says
      little), and whether the puzzles are fun, too hard or too fiddly with a finger.

- **Film studio** — a small set on a studio floor, in front of a back wall. Tap an actor, a prop or
  a lamp to choose it and drag it about (a lamp moves at its own height); drag the empty set to walk
  the camera round. Add 🧍 Actor, ⬛ Box, ⚪ Ball, 💡 Lamp (12 things and 3 lamps at most). A chosen
  actor has a Pose (stand, wave, cheer, walk, sit, point, think); anything has a Finish (matte,
  gloss, metal, glow), eight colours, Turn and Size, 🎯 Focus on it and 🗑 Remove; a lamp has a
  colour, Power and Height. The camera has a Lens (18–135 mm on a full-frame sensor), an Aperture
  (f/1.4–16 — wide blurs what is not in focus) and Distance. The preview settles at 48 paths a
  pixel; 🎬 Shoot takes it to 512, and ⬇ Save picture downloads it as a PNG. The scene is kept in
  this browser as you go (`lab_studio_scene_v1`), and ⬇ Save scene file / ⬆ Open scene file… move
  it as JSON. Keys: arrows walk the camera, − + distance, S shoot, Delete removes, Esc lets go.
  Technique (`studio.wgsl`): every frame each pixel traces two more paths and adds them to a running
  sum, so the picture starts grainy and settles; any change starts the sum again. A path: a thin
  lens (an aperture of focal length / f-stop / 2, aimed at the plane in focus), up to four bounces,
  each lamp sampled directly at every diffuse bounce by sampling the cone it subtends, gloss as a
  Fresnel-weighted clear coat, metal as a blurred tinted mirror, glow as light. Intersections are
  closed forms — sphere, a box in its turned frame, Inigo Quilez's capsule — and studio.ts carries the
  same maths for picking. On its first pass each pixel also writes the id of what its centre sees,
  which is how the probe checks that picking and the picture agree. The developed picture is the sum
  over its count through an ACES curve; Save picture renders that into an `rgba8unorm` texture,
  reads it back and encodes a PNG.
  ⚠️ What was wrong first:
  1. **A dragged actor was flung across the set.** The drag followed where the finger's ray met the
     FLOOR, and a finger on an actor's chest points at floor metres behind it — measured, 1.9 m for
     a move worth 1 m (and 1.8 for 0.7 on the emulated phone). It drags on the level plane at the
     height the finger met the thing now: 1.0 for 1.0, 0.64 for 0.7.
  2. **Importing let junk use up the slots.** A file's list was cut to its limit BEFORE non-objects
     were dropped, so a scene padded with nonsense could arrive with one lamp instead of three. A
     deliberate break (lifting the cap) passed the first version of the test, which is how it was
     found: the fixture had too few lamps to reach the cap.
  3. Bone lengths changed when the thinking pose leaned, feet floated or sank, and the figure was
     1.93 m: the tests that every pose keeps every bone, and that soles rest on the floor, fixed them.
     _Measured_ (SwiftShader): what each pixel's centre sees on the GPU agrees with the CPU picker on
     10,232 of 10,240 pixels (the rest on edges); light under a lamp falls 3.89× when the lamp is twice
     as high (inverse square says 4); the error against a 256-path reference falls 4.36× from 4 paths to
     64 (1/√n says 4); a box casts its shadow under a lamp straight above it. The tests hold every
     intersection to sphere tracing of the shape's own distance field — maths shared with nothing — over
     600 random rays; the camera to a 33.4° view at 40 mm; poses to their bones; and a scene file to a
     round trip in which every field is something other than its default, and hostile input to clamps
     (a file setting an actor at x = 99 with a material of `<img onerror>` arrives at x = 8, matte;
     a `__proto__` key pollutes nothing; a non-scene is refused with a sentence). In the page at 1024:
     choose by click, drag, pose, colour, add, orbit, a lamp's power, the aperture, Shoot, a 926×469
     PNG downloaded, the scene file downloaded and opened back, the hostile file and a non-scene file,
     Start over; on the emulated iPhone, touch chooses and drags. Audit clean at both. Twelve deliberate
     breaks each fail a test.
     Not measured: how long a clean shot takes on a real GPU (SwiftShader manages a few paths a second
     at 926×469), and whether the controls are too many for a phone.

- **Critters** — build a creature, then race 256 copies of it and watch them learn to walk.
  Building, on a 10 cm grid: ● Joint taps joints; ⎯ Bone drags from one joint to another; 💪 Muscle
  taps a bone to make it a muscle (red) that pulses; ✋ Move drags a joint; 🧽 Erase taps a joint or
  a bone away. Or start from a Hopper, an Inchworm or a Walker. The line under the stage says what
  is missing (two joints, a muscle, everything joined up) — and warns about the one shape that can
  never walk: a body that is its own mirror image with a single muscle. ▶ Race 256 of them: every
  copy has its own brain (each muscle's timing and strength, and the beat they share); after eight
  seconds the 64 that got furthest breed the next 256 (kept as they are, the rest their children,
  a small change each). The bright one leads; the score shows the generation, the leader and the
  record, with a sparkline of each generation's best. ×1/×4/×16 speed; 👑 Watch the champion
  replays the best brain alone; ↺ New race; ✏️ Change the body. The body and its champion are kept
  in this browser (`lab_critter_v1`) and can be saved to a file and opened again — read only as
  numbers, and only if the body passes the same check a hand-built one does. Keys: Space pause,
  1–5 tool or 1–3 speed, E edit, R new race.
  Technique (`critters.wgsl`): A WORKGROUP IS A CREATURE and a thread is one of its joints. The
  joints live in workgroup memory for the whole call, which runs many 240th-of-a-second substeps:
  drag, gravity, a guess; six Jacobi passes over the bones and muscles as distance constraints, each
  joint gathering only what its own bones ask of it (an adjacency list per joint, so no two threads
  ever write the same joint and the order they run in cannot matter); the ground, where most of a
  joint's slide is taken back (friction, which is what a foot pushes against); the velocity from the
  move. One dispatch a frame runs all 256. Drawing is instanced: every bone a capsule, every joint a
  dot, the leader last and opaque. `simulate` in critters.ts is the shader line for line, and
  breeding is ordinary seeded game logic on the CPU.
  ⚠️ What was wrong first:
  1. **The winners flew.** With muscles reaching 35% of their length at up to three beats a second,
     the "best walkers" were the ones that flung themselves into the air — a 0.8 m Hopper 5.8 m
     along in one second. Reach 20%, at most 1.5 beats a second, and a little air drag: now no joint
     of sixteen random Walkers gets above 2 m, and the record still climbs every generation.
  2. **A hand-built triangle raced for exactly 0.00 m** through four generations — not a bug: a body
     that is its own mirror with one muscle cannot choose a direction. The builder says so now.
  3. The champion kept by the first version could be read from a stale render (the frame loop is
     built once); the race keeps its own state in a ref.
     _Measured_: on SwiftShader, all 256 GPU creatures against the CPU copy for each preset — after 4
     substeps the median joint differs by 8×10⁻⁶ m, after 96 by 8×10⁻⁵ m (the gap grows the way any
     contact-rich system's does, f32 against f64), and the GPU and CPU pick the same leader of 256.
     On the CPU, six generations of 64: the Hopper's best went 1.33 → 1.80 m in 8 s, the Inchworm's
     1.07 → 1.88, the Walker's 2.46 → 5.21. The tests hold the physics to settling, friction, moving
     only by muscles, and determinism, and evolution to never losing ground: with the best kept unchanged
     and the race the same, the best never walks less from one generation to the next. In the page at
     1024: a triangle built by mouse (the hints along the way), a joint moved, the stuck warning shown,
     four generations of the Hopper raced at ×16 with the record 0.3 → 0.9 m, the champion watched, a
     critter file saved and opened back, a hostile file refused; on the emulated iPhone, touch erases a
     joint. Audit clean at both. Twelve deliberate breaks each fail a test.
     Not measured: how the race reads on a phone (256 faint copies over each other), and how long
     generations take on a real GPU (one dispatch of 256 workgroups, up to 64 substeps each a frame).

**Batch 8 in one place.** Four additions, each a thing to DO: a game against the clock (Bike
trials), a puzzle with levels and saved progress (Waterworks), a builder with a picture to keep
(Film studio), and a builder with a race that learns (Critters). Each was played end to end in the
page by a script (desktop mouse and keys, emulated-iPhone touch) and boots without errors in the
production bundle (built with placeholder env values and served by `vite preview` — its canvas
pixels were not read there). Every puzzle in Waterworks was solved, and left unsolved, by a script
on the GPU; the trials course was finished by a scripted rider. Things a real device must answer
are in the checklist; none of it has been on a phone.

Try first, on a desktop: **Bike trials** (arrows; can you beat the scripted rider's 18.8 s?), then
**Waterworks** level 3 (hold 🔥 Heat on the pool and watch the rain), then **Film studio** (pose the
actors, open the aperture, 🎯 focus, 🎬 Shoot, ⬇ Save picture), then **Critters** (Walker, race ×16
for a minute, 👑 watch the champion).

### Real-device checklist — batch 8

- [ ] Bike trials (desktop first) — is the bike fun to ride: does lean feel strong enough in the
      air and not twitchy on the ground? Is the Quarry too easy, too hard, or right for a first
      course? Is a crash fair (does the head hit when you expect)? Does the best time survive a
      reload?
- [ ] Bike trials (phone) — can two thumbs hold Gas and a lean at once on a real screen? Is
      anything selected or zoomed by a long press? Is 11 m across enough to see what is coming?
- [ ] Waterworks (desktop) — do the puzzles read without the hint? Is the ice bridge findable (hold
      cold just INSIDE the shaft top)? Does Up and over take too long? Is "Gently" fair?
- [ ] Waterworks (phone) — is a 3-cell wall pen too thin or too fat under a finger? Is the fluid
      smooth (12,000 drops, 80 Jacobi passes a frame)? Do the level and tool buttons crowd the page?
- [ ] Film studio (desktop) — how many seconds to a clean 512-path shot? Do the shots look good
      enough to keep? Is dragging an actor predictable? Does a saved scene file open on another
      browser?
- [ ] Film studio (phone) — is tapping a small actor to choose it reliable? Are the panels below
      the stage too long to scroll? Does Save picture download on iOS Safari (Blob downloads differ)?
- [ ] Critters (desktop) — is building with five tools clear without reading the hint? Does a
      race of 256 read (the leader bright, the rest faint), and do the critters visibly get better
      within a few generations? Is ×16 smooth?
- [ ] Critters (phone) — can a finger place joints on a 10 cm grid and drag bones between them, or
      are the joints too close together at this scale?

## Batch 9 — remixes and things to make

⚠️ **STACKED ON BATCH 8.** Branch `claude/lab-toys-9` was cut from `claude/lab-toys-8` at
`7211b3e` while #25 was still an unmerged draft, because one of these toys (Strut) builds directly
on Critters' bodies, checks and physics. Its draft PR targets the batch-8 branch, so its diff is
only batch 9. Merge #25 first; then this PR can be retargeted to `main` unchanged. Nothing here
edits a batch-8 file except the shared `DEMOS` list (appended to) and `lab.css` (appended to) and
this document.

Same rules of evidence as batch 8: _measured_ means unit tests or headless Chromium on SwiftShader
(a CPU stand-in for a GPU); "emulated phone" is Playwright's iPhone 13 profile with CDP touch, which
checks layout and touch routing only. Nobody has played these on a real device.

| Toy   | What you do                                                                                                                                                                                          | GPU technique                                                                                                                                                                                                                                           | Pattern to reuse                                                                             |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Strut | A REMIX of Critters: a creature whose 16-step sequencer is both its gait and its song — find a groove that walks it to the flag; its feet drum, and the walk leaves a watercolour score you can keep | a WET-ON-WET PAINTING in world space: every note and footfall splats pigment into a float texture, which bleeds into its neighbours while wet and then dries for good (two textures taking turns); subtractive pigment, so colours mix like watercolour | "a sim whose events paint a keepable picture" — any game that should leave an artwork behind |

- **Strut** — a creature whose step sequencer is both its gait and its song. Each row of the grid
  under the stage is a muscle, and plays that muscle's note: the muscles sorted longest first climb a
  pentatonic scale from the key, so a long muscle is low and a short one high (muscles of the same
  length take neighbouring notes). Light a step and that muscle pulls in on it and sounds; its feet
  drum where they land (kick and snare for the feet, left to right; toms if it stumbles onto a
  joint). So a groove either walks or falls over: the goal is a groove that gets it to the
  chequered flag 24 m away (the score shows metres, then the bars it took). As it walks, every note
  is laid as a blot of watercolour as high up the paper as the note is up the scale, every footfall
  a grey stamp on the floor and every few frames a faint dot under each joint, so the floor behind
  it becomes a painted score of the walk; ⬇ Save painting keeps the whole 32 m strip as a PNG, 🧻
  Fresh paper starts a new one. Tempo, Voice (marimba, kalimba, vibes, pluck, bell, steel pan) and
  Key change the song; ✏️ Body opens Critters' builder (joint, bone, muscle, move, erase — the same
  rules), and changing the body changes both how it walks and what it plays. Two presets: the
  Stomper and the Inchworm. The creation is kept in this browser (`lab_strut_v1`) and in a file
  (⬇ Save strut / ⬆ Open strut…). Keys: Space play, R from the start, E body, M sound, 1–5 tool.
  Technique: the body's physics is Critters' (the same constants, run on the CPU for one creature at
  240 Hz) with the muscles driven by the grid instead of a brain — a lit step pulls a muscle to 72%
  of its rest, an unlit one lets it out to 108%, easing over 50 ms. Events come out of the physics in
  order: a note when a lit step starts, a foot when a joint lands from the air faster than 0.35 m/s.
  The GPU paints them: `blot_*` splats each event's pigment (the colour it takes OUT of the paper)
  and wetness into an `rgba16float` sheet in world space, 48 px a metre; `bleed` lets wet paper share
  pigment with its neighbours and dries it a little each frame; `show` lights the paper through the
  pigment (`exp(−absorb)`), samples it between pixels, and draws the creature over it with each muscle
  in its note's colour, brighter while it pulls; `develop` prints the whole sheet for the PNG.
  ⚠️ What was wrong first:
  1. **The first hand-made patterns tumbled or walked backwards** (the Stomper's top joint reached
     2.75 m; the Inchworm went −1.1 m). The presets' patterns came from searching 400 grooves for the
     furthest that stays upright: 14.5 m and 5.5 m in 8 bars.
  2. **A preset edit silently did not apply** — a text replacement missed a reformatted block — and
     the test that walks the presets forward is what caught it.
  3. **A symmetric creature played one note**: muscles of equal length shared a pitch. They take
     neighbouring notes now.
  4. **The painting turned to mud**: notes laid where their muscles were stacked every colour on a
     slow walker's spot until it dried black. Notes go up the paper by pitch now, a score.
     _Measured_: the tests hold the music (longer is lower, pentatonic from the key, every muscle its
     own note; the feet's drums), the sequencer (every lit step sounds once as it starts, from the first;
     a lit muscle reaches 72% and an unlit 108%; nothing lit stands still and silent), the presets
     (walk forward ≥ 10 m and ≥ 4 m in 8 bars without rising more than 0.4 m above their own height,
     drumming as they go), the painting's arithmetic, and a saved strut (a round trip with every field
     non-default; wrong row counts, non-boolean cells, too many muscles and broken bodies refused). On
     SwiftShader a blot keeps 99% of its pigment while it blooms, is dry in about eight seconds and then
     never changes; the printed painting is 1,536 × 192 and red where a red note was laid. In the page at
     1024: it plays and walks with notes sounding, a cell toggles and is stored, a preset swaps the grid,
     Save painting downloads the PNG, a file saves and reopens, a hostile file is refused, Voice and Tempo
     are kept, mute stops the notes; on the emulated iPhone the grid scrolls sideways inside itself and a
     touch toggles a cell. Audit clean at both.
     Not measured: whether finding a walking groove is fun or frustrating, how in time the notes feel
     (they sound on the frame the physics reaches the step, up to a frame late), and phone speed.

### Real-device checklist — batch 9

- [ ] Strut — can you find a groove that walks without the presets? Do notes land in time with the
      grid? Is the painting worth keeping? On a phone, is a 28 px grid cell easy to tap, and is
      scrolling the grid sideways natural?
