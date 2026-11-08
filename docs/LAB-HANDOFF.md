# Lab handoff — 6 Nov 2026

The state of `#lab`, the WebGPU room. The commits carry the reasoning; this is the map.

**Status, checked 7 Nov 2026: all 49 are on `main` and deployed.** The batch 8–11 integration
merged as #29 (`bd40884`, 6 Nov 22:51 UTC) — a non-squash merge of `claude/lab-toys-11` at
`103c93d`, so the commits of #25 → #26 → #27 → #28 are on `main` as they were written. The
**Deploy to GitHub Pages** run for `bd40884` finished successfully at 22:53 UTC (Actions run
42307857946), alongside green Build, Lint, Test and db guards runs on the same commit. That is the
evidence: the live site itself could not be fetched from the session that wrote this, so "live" here
means the deploy job for that commit succeeded, not that a page was loaded. #25 shows as merged (its
head reached `main`); #26–#28 are still open drafts on GitHub even though everything in them is on
`main` — they can be closed. New Lab work branches from `main` (batch 12 onward is not stacked).

Evan played the original 37 on a desktop only. None of those 37, and none of the twelve added here,
has been played on a phone or confirmed on a real GPU. Numbers below marked measured are unit tests
or headless Chromium on SwiftShader, a CPU stand-in, plus an emulated iPhone for layout and touch
routing. That is not a handset, not an ear, and not a verdict that any of it is fun. Known roughness
stays: a ball wedged in pinball bumpers still needs 🔄 New game; Fold is not fully keyboard
playable; Ferro's Space-release and Tunnel's two-keys-one-direction bugs are older and unchanged.

evancook.dev deploys from `main`. Batches 1 and 2 are already live there. Batches 3–7 are in the
37 on `main` as of `caaba4f`. Frame times below are SwiftShader and say nothing about a handset.

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
- **Batch 8 — #25, live via #29**: games and builders — Bike trials, Waterworks, Film studio,
  Critters.
- **Batch 9 — #26, live via #29**: Strut, Gust, Seedling.
- **Batch 10 — #27, live via #29**: Möbius golf, Pinball workshop, Night crossing.
- **Batch 11 — #28, live via #29**: two review fixes to batch 10 (and Bike trials), then Shadow
  box and Fold.
- **Batch 12 — draft, `claude/lab-toys-12`, from `main` at `bd40884`**: Topple, Print shop. Not
  stacked: it branches from `main` with batches 8–11 already there; the picker on this branch is 51.

The source PRs were stacked (#25 → #26 → #27 → #28); they reached `main` together through #29, so
none of #25–#27 went live ahead of the batch 11 fixes.

That was 7 live toys plus 30 on `main`, 37 in the picker; the integration added 12 and the picker
on `main` is now 49 (counted from the `DEMOS` list: trials, waterworks, studio, critters, strut,
gust, seedling, mobius, pinball, crossing, shadowbox, fold). Each batch section below is that
batch's own note, including what it measured and what it had not.

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

| Toy      | What you do                                                                                                                                                                                                                                                                   | GPU technique                                                                                                                                                                                                                                           | Pattern to reuse                                                                                                                                                                                     |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strut    | A REMIX of Critters: a creature whose 16-step sequencer is both its gait and its song — find a groove that walks it to the flag; its feet drum, and the walk leaves a watercolour score you can keep                                                                          | a WET-ON-WET PAINTING in world space: every note and footfall splats pigment into a float texture, which bleeds into its neighbours while wet and then dries for good (two textures taking turns); subtractive pigment, so colours mix like watercolour | "a sim whose events paint a keepable picture" — any game that should leave an artwork behind                                                                                                         |
| Gust     | NEW: air hockey with no mallets — steer a fan round your half and blow; real wind carries the puck past four posts into the other goal. Against the computer (three speeds) or a friend on one device, first to 5                                                             | a STABLE-FLUIDS solver on a 160×90 grid (advect, red-black Gauss-Seidel pressure, project) with the posts, walls and open goal mouths as boundaries; the puck is stepped ON THE GPU by the air round it and read back each frame for the score          | "the GPU owns the physics, the CPU owns the rules": a one-thread pass that is a pure CPU function line for line, read back with a serial so a stale read is never counted                            |
| Seedling | A REMIX of Life: Life as a puzzle — plant a few seed cells in a patch so what grows lights every lamp before time runs out; six gardens (gliders, a wall with a gap, the Seeds and Maze rules, a methuselah), then MAKE your own garden, rule included, and keep it as a file | Life with the RULE AS TWO MASKS in the uniform (any B/S rule), bounded edges, stones that never live; the step also lights lamps and leaves a fading glow, all in one compute pass; the garden drawn per pixel and stood upright on a tall stage        | "the GPU steps, the CPU judges": a twin of the step decides the puzzle and is compared to the GPU cell for cell; every level ships with a solution the tests replay, and is proven to fail untouched |

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

- **Gust** — air hockey with no mallets. Each player has a fan they move round their own half of
  the rink; it blows straight at the puck while held, and the wind — a real fluid, swirling round
  four posts and round the puck itself — is what moves the puck. So where you stand is your aim:
  get behind the puck to send it at the other goal, get in front of it to stop a shot. A fan's
  breath (the arc round it) empties in 2.2 s of blowing and refills in 3.5 s, so it is played in
  bursts. Blue's and Orange's wind dye the ice their colours, so you can see the air you made.
  Against the computer (🤖, Gentle / Keen / Sharp — how fast its fan moves) or 👥 two players on
  one device: each player's finger on their half of the ice steers and blows their fan, and two
  thumbs at once work. On a tall stage (a phone held upright) the rink stands up, Blue's goal at the
  bottom. First to 5; a goal rings a bell and play waits 1.5 s with the puck nudged toward who
  conceded. Keys: Blue WASD + F to blow, Orange arrows + / or Enter, P or Space pause, N new match.
  Technique: `force` adds each blowing fan's jet (6 cells wide, fading over 20, aimed at the puck)
  and dye; `advect` carries air and dye back along themselves; `walls` stops air at the walls
  (but not at the goal mouths), in the posts, and sets the air inside the puck to the puck's speed;
  `diverge`, then 24 red-black Gauss-Seidel sweeps warm-started from the last frame's pressure, then
  `project` make it incompressible, with zero pressure outside the goal mouths so air can leave
  through them; `step_puck` — one thread — averages the air in a ring just outside the puck and does
  exactly what `stepPuck` in gust.ts does: drag toward that air, move, bounce off walls and posts,
  and the last 8 cells of a goal mouth tip toward the line. The CPU reads the puck back each frame
  for the score and the computer's eyes; every time it puts the puck back it bumps a serial the GPU
  carries, and a reading from before that is thrown away, so a goal is never counted twice.
  ⚠️ What was wrong first:
  1. **Shots crawled**: a fan pushed only the air round itself, so the push faded as the puck left
     and a 2-second blow carried it 75 cells at 33 cells/s, curling away from the goal. The wind is
     a jet toward the puck now, fading over 20 cells: the same blow scores in 1.9 s at 71 cells/s.
  2. **A slow puck sat in the goal mouth for ever**: with the wall open there and the air still, it
     could stop 3 cells short of the line. That was also why the computer, against nobody, scored
     nothing in 30 s. The last 8 cells of a mouth tip toward the goal now.
  3. **The computer gave up at the centre line**: it guarded its goal whenever the puck was in the
     other half, even a puck an arm's length over the line. It shoots at anything within its jet's
     reach now, from its own side. Against an idle player it wins 5–0 in 16 s at Keen.
  4. **A landscape rink on an upright phone was small** (about 470 × 265 device pixels); standing
     it up gives it 45% more area, and the shader and the finger share one fit (`rinkFit`).
     _Measured_: the tests hold the uniform layout and the shader's copies of every constant, the puck
     (still in still air, dragged to the air's speed, bounces off walls and posts losing speed, through
     the goal mouth but not beside it, a crept-up puck drops in and one beside the mouth does not —
     this test was made to fail by taking the tip out), breath (empties in 2.2 s, refills in 3.5 s, no
     blowing on empty), fans held in their half at their speed, the computer (stands in line behind
     the puck from the goal it attacks, blows only once there and with breath, guards a far puck,
     shoots across the line within reach), the match (scorer, kickoff, winner at 5), and the rink's fit
     (centred, upright on a tall stage, turned not mirrored). On SwiftShader: untouched, the puck does
     not move in 2 s; the GPU puck matches its CPU twin to 0.0000 cells per step over a whole shot;
     600 frames of random blowing never put the puck outside the walls or inside a post. In the page at
     1024: the computer scores against an idle player and a bell sounds; WASD moves Blue and F blows it
     and empties its breath, letting go stops it; a held mouse brings Blue to it, blowing; in two-player
     mode the arrows and Enter move and blow Orange and a mouse on the right half steers Orange while
     Blue stays put. On the emulated iPhone, two simultaneous CDP touches, one on each half, each
     steered and blew its own fan, lifting stopped both, and the drawn blue ring was centred within
     1 px of the thumb on the upright rink. Audit clean at both.
     Not measured: whether it is fun — the fan speed, jet strength and breath were tuned by numbers,
     not by playing; real two-thumb play on a real phone (the multi-touch was synthetic); and speed on
     a phone GPU (24 sweeps × 2 on 14,400 cells a substep is small, but untested).

- **Seedling** — Life as a puzzle. Each garden (32 × 20) has a green planting patch, a few lamps,
  maybe some stones, a rule and a number of generations. You get so many seed cells to plant in the
  patch: tap a cell to plant it (tap again to take it up), or switch to 🛩 Glider and tap to stamp a
  whole glider (↻ turns it; a stamp is planted whole or not at all). ▶ Grow runs the rule; a lamp
  lights when a live cell stands on it, and the garden is solved when every lamp has been lit at
  least once before the generations run out. Stones never come alive, so they cut whatever grows
  into them. Six gardens, easiest first: **First light** (one glider), **Both ways** (two gliders,
  opposite directions), **Through the gap** (a glider lined up with a gap in a wall), **Seeds** (a
  different rule — B2/S, where every cell dies at once — three seeds for four corners), **Wake the
  garden** (six lamps all round; the right five cells grow for hundreds of generations — 12 of the
  4,368 ways to plant five work, and nothing with four or fewer), **Maze** (B3/S12345, corridors
  that stay). 💡 Show a way plants a stored solution (a garden solved that way earns no ✓); your
  best for each (fewest seeds, then soonest) is kept and the list ticks it. 🛠 Make: 🪨 stones (drag
  to draw), 💡 lamps, 🌱 drag out the patch, 🧽 erase; a name, a rule (Life, HighLife, Seeds, Day &
  Night, Maze, or any B/S you type — B0 is refused, it would fill the empty garden), seeds and
  generations; ▶ Try it plays it. The garden you make, your bests and where you were are kept in
  this browser (`lab_seedling_v1`); ⬇ Save garden / ⬆ Open garden… keep it as a file. Keys (Play):
  Space grow/pause, R replant, C clear, G glider, T turn; (Make) 1–4 tools.
  Technique: one compute pass, `grow`, is `step` in seedling.ts line for line — the eight
  neighbours counted with the edge as dead ground, born or staying by bit n of the rule's two
  masks, never on a stone — and also sets a lamp's lit bit when a live cell is on it and keeps a
  glow that fades by 18% a generation where life has been. Two boards take turns. `show` draws the
  garden per pixel: uneven soil, the patch (gently pulsing while you plant), stones, lamps waiting
  or lit, sprouts that swell in as each generation starts, and the glow; on a tall stage the
  garden stands upright (`gardenFit`, shared with the finger). The CPU runs its own copy of the
  step as the judge, and that is what decides solved or out of time.
  ⚠️ What was wrong first:
  1. **A solved level came out unsolved on the GPU.** `grow` reads the garden's size from the
     uniform, and only drawing a picture wrote it, so any generation run before the first frame saw
     a 0 × 0 garden and did nothing. The page happened to draw first; the probe, which grows before
     drawing, did not. The size is written when the engine is made now.
  2. **A glider stamped at the patch's edge planted half a glider**, which is no glider. A stamp
     plants whole or not at all, and says why.
  3. **The first wall had a 3-cell gap**, which no glider can pass: its 3 × 3 box moves a cell down
     for every cell across. The gap is 5 now, and the lamp is on the lane through it.
  4. **Show a way earned a ✓**, and a "too many seeds" note outlived the try that caused it.
     _Measured_: the tests hold the rule notation, Conway's classics (a block stays, a blinker turns,
     a glider walks a cell diagonally in four generations, and a turned glider the turned way), the
     edge as dead ground (no wrap), stones (never alive; they cut a blinker — made to fail by letting a
     stone live), Seeds' rule, planting (patch only, once each, the budget), every garden failing
     untouched and solved by its stored solution within its budget, patch and time, the gap mattering
     (the same glider two cells left is cut by the wall; with no wall it gets there), half of Both ways
     not being a solution, a garden file (every field non-default round trip; too big, not JSON, a B0
     rule, a 10-bit mask, zero or fractional generations, a big budget, a patch or stone off the board,
     no lamps, 41 lamps, a lamp off the board, in the patch or on a stone — each refused, saying why),
     tapping (plant, unplant, a whole glider that solves First light, a stamp that does not fit, a
     stamp over budget), making (stones as runs along a row, a stone puts a lamp out, none in the
     patch, lamps toggle, a patch dragged either way clears what is under it and stops at the edge, a
     fresh garden is valid and unsolved), the uniform layout and the shader's mark bits, and the fit.
     On SwiftShader, all six gardens untouched and solved: the GPU's board equals the judge's every
     ten generations (0 differing cells in 120 comparisons) and its lit lamps equal the judge's. In
     the page at 1024: untouched runs out; a mouse-stamped glider solves First light at generation 51
     and is kept as a best with a ✓; an over-budget tap is refused saying so; Show a way solves Wake the
     garden at 116 and earns no best; in Make, a dragged line of stones, a lamp, a dragged patch and a
     typed rule are kept (B0 is marked invalid and not taken), the garden saves and reopens, a hostile
     file is refused with its reason, Try it plays it, and all of it is there after a reload. On the
     emulated iPhone the garden stands upright and a finger-tapped glider solves First light. Audit
     clean at both.
     Not measured: whether the gardens are the right difficulty and in the right order (designed by
     search, not by watching somebody play); whether ~18 px cells on an upright phone are easy to tap
     (under the 24 px a lone control should have — a board of cells, like the piano's keys, is
     excused, and the glider stamp is the bigger target); real-device speed (640 cells, so trivial).

### Real-device checklist — batch 9

- [ ] Strut — can you find a groove that walks without the presets? Do notes land in time with the
      grid? Is the painting worth keeping? On a phone, is a 28 px grid cell easy to tap, and is
      scrolling the grid sideways natural?
- [ ] Gust — play the computer on Keen: can you win, and is Sharp too sharp? Two people on one
      phone held upright: do both thumbs work at once, and does the puck feel pushed by wind rather
      than steered? Does it hold 60 fps on the phone?
- [ ] Seedling — play all six gardens without 💡: which was too hard or too easy? On a phone held
      upright, can you plant the cell you meant? Make a garden and have somebody else solve it.

## Batch 10 — new territory

⚠️ **STACKED ON BATCH 9, WHICH IS STACKED ON BATCH 8.** Branch `claude/lab-toys-10` was cut from
`claude/lab-toys-9` at `5978898` while both #25 (batch 8) and #26 (batch 9) were unmerged drafts.
Its draft PR targets the batch-9 branch, so its diff is only batch 10. **Merge order: #25, then #26
(retargeted to `main`), then this one (retargeted to `main`).** Nothing here edits a file of either
earlier batch except the shared `DEMOS` list, `lab.css` (appended to) and this document. When it was
cut, `main` had moved on by Instrument commits only, and the whole stack still merged into it cleanly
(`git merge-tree`).

The brief was different ground from everything before — no creature, no fluid routing, no cellular
puzzle — favouring unusual things to do with your hands. Same rules of evidence as batches 8 and 9:
_measured_ means unit tests or headless Chromium on SwiftShader (a CPU stand-in for a GPU); the
"emulated phone" is Playwright's iPhone 13 profile with CDP touch, which checks layout and touch
routing only. Automated play proves the rules hold, not that anything is fun; nobody has played
these on a real device.

| Toy              | What you do                                                                                                                                                                                                                                                                                                                                           | GPU technique                                                                                                                                                                                                                                                                                                                      | Pattern to reuse                                                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Möbius golf      | Golf on a square whose edges you glue: a room, a cylinder, a Möbius band, a torus or a Klein bottle. Choosing the space is half of every hole; a shot out of one edge comes back in at its partner, upside down across a twist. Six holes with par, aces and bests                                                                                    | the COVER drawn per pixel: every pixel is a point of the plane tiled with copies of the course, folded back into the course (flipped across a twist, nothing beyond a wall edge) — so the ball's path, which bends at every edge, is seen running straight on through the copies; the edges carry the arrows topology books use    | "a pure fold function the shader repeats line for line, checked pixel by pixel against the CPU's" — any toy whose world is a quotient of the plane |
| Pinball workshop | Draw your own pinball table — walls with a finger, bumpers that kick, targets that light (all lit pays a bonus) — then play it: plunger, two flippers, three balls, a best score per table; tables kept here and as files                                                                                                                             | the table BAKED INTO A DISTANCE FIELD on the GPU whenever it changes (walls, bumpers and targets a channel each), which every frame's neon glow is read from — so a table of 160 segments costs the per-pixel shader one texture read, not 160 distances                                                                           | "bake what changes rarely, draw from the bake": a compute pass on edit, a texture read per frame; checked through the picture, not only the field  |
| Night crossing   | A co-op for two with DIFFERENT jobs: the pilot steers a boat through a rocky channel at night; the keeper aims its searchlight and chooses narrow-and-far or wide-and-near. Only what the beam lights can be seen; rocks throw shadows and are remembered for a moment. Ring the buoys, get home, three knocks and you sink. One person can play both | a MEMORY MAP of the channel in world space: a compute pass lights each texel near the boat (in range, in the beam, no rock in the way — rock shadows by a ray test against every nearby rock) and keeps the brightest of that and its fading past; the night is drawn from the map, so per pixel it is a lookup, not a shadow test | "light into a fading world-space map, draw from the map" — fog of war, sonar, anything seen and then forgotten                                     |

- **Möbius golf** — golf where the shape of the space is yours to choose. Each hole names the spaces
  it may be played in: **Room** (walls all round), **Cylinder** (left edge glued to right), **Möbius
  band** (left glued to right with a twist: out at the top of one side, in at the bottom of the
  other), **Torus** (both pairs glued straight) and **Klein bottle** (sides twisted, top and bottom
  straight). Pick one — that starts the hole from the tee in it — then pull back anywhere on the
  stage and let go to shoot, harder the further you pull; a dotted guide shows the first 3.5 m of
  the shot, through the edges. The stage draws the course and a ring of its copies (🔭 Wider for
  more): where an edge is glued you see the copy it leads to, mirrored and tinted cooler across a
  twist, with arrows on the glued edges (one on the left/right pair, two on the top/bottom, pointing
  opposite ways across a twist); beyond a wall edge, sky. The flag leans one way and the ball has two
  spots, so a mirrored copy, and a ball that has been through a twist, are visibly mirror images.
  Six holes: **Round the back** (a wall right across: a cylinder takes you round), **Upside down**
  (four rooms; only the Möbius band joins the bottom-left to the top-right), **Two doors** (only the
  torus, through two edges), **The bottle** (the Möbius band cannot, the Klein bottle can), **Lanes**
  (three spaces will do; which is easiest?) and **Pocket** (every space open; the cup's pocket faces
  the edge, so the question is where a ball can arrive from). Par, strokes, an ace called out with a
  chime, and your best (and the space you did it in) kept and ticked in the list; 💡 Show the ace
  aims the stored ace for you, and a hole played that way is not kept. Keys: ←/→ aim (Shift for
  10°), ↑/↓ strength, Space or Enter shoot, R from the tee, W wider, 1–5 the hole's spaces.
  Technique: the physics is CPU and deterministic at 240 Hz — a rolling ball slowing at 2.2 m/s²,
  capsule walls, wall edges it banks off, glued edges it `cross`es (a twist mirrors its height and
  its vertical speed and flips its handedness), and a cup it drops into below 5.5 m/s. The GPU draws
  the cover in one pass: `fold` (the same as in mobius.ts) maps each pixel's point of the plane to a
  copy and a point of the course, and the course is drawn there — mown stripes, edge marks, walls,
  cup and flag, the ball, the aim arrow and the path (the trail, or while aiming the dotted guide).
  ⚠️ What was wrong first:
  1. **A random search for a hard hole found nothing** — sixty courses of random posts and a pocket,
     and none had an ace in exactly one space. The last two holes were designed by hand and then
     counted instead.
  2. **A tap fired the keyboard's aimed shot**: letting go of a press that never pulled back shot
     whatever the arrow keys had last set. Only a press that pulled back shoots now.
  3. **The "stars" beyond a wall edge drew as grey squares** a cell wide.
     _Measured_: the tests hold the gluings (a wrap is the same way up; a twist mirrors height and
     speed and flips the ball, and twice round a band is the right way up again; the Klein bottle's top
     and bottom are straight; a wall edge is banked off, never crossed), the cover (a ball rolled
     straight through the copies of the torus and the Klein bottle and the same ball crossing the
     course's edges agree to 10⁻⁶ m and on handedness at every step of 2,000 — made to fail by dropping
     the twist from `fold`; no copies beyond a wall edge), the ball (stops at v²/2a, drops in when slow
     and runs over when fast, banks off a wall), the course (every hole aced by its stored shot in a
     space it offers; for the first four, a sweep of 2,760 shots in the other space it offers finds no
     ace at all — the space is the puzzle), the uniform's layout and the shader's copies of the sizes.
     The design sweeps, on a finer grid of 16,560 shots: Pocket has 483 aces in the torus, 467 in the
     Klein bottle, 25 in the Möbius band, and 2 in the room and 1 in the cylinder (bank shots nobody
     will find on purpose). On SwiftShader, the shader's fold agrees with the CPU's on every sampled
     pixel in all five spaces — 103,182 pixels classed as sky, cup or green, 0 disagreements. In the
     page at 1024: the ace's shot in the room banks back and leaves stroke 2; the same shot on the
     cylinder is an ace, chimes and is kept with a ✓; a mouse pull-back aces Upside down on the Möbius
     band; a tap shoots nothing; a shown ace is played but not kept; the hole and bests are there after
     a reload. On the emulated iPhone a touch pull-back aces the first hole. Audit clean at both.
     Not measured: whether it is fun, and whether six holes is the right length; whether a beginner
     reads the copies and the edge arrows without being told (the hints do the telling); whether
     pulling back on a phone is precise enough for the tight holes — the arrow keys are the fine
     control, and a phone has none. Seen in the phone screenshot: the site's own "You're playing"
     pill (from any toy that plays the synth) floats over the controls until dragged away; that pill
     belongs to the Instrument and is left alone.

- **Pinball workshop** — make a pinball table, then play it. **🛠 Build**: ✏️ draw walls with a
  finger or the mouse (a stroke is kept as a wall, thinned to a point every half unit), ● tap to
  place bumpers, ◆ targets, 🧽 tap a part to erase it; name the table; ↺ back to the workshop
  table, 🧹 an empty one, ⬇ Save table / ⬆ Open table… as a file. The frame stays put — the outer
  walls, the plunger lane and the orbit at its top, the slopes down to the flippers and the drain —
  and parts may not go in the lane, the orbit or down by the flippers (the toy says so). **🎮 Play**:
  hold 🚀 (or Space, or any finger on the stage while the ball waits) to pull the plunger and let go
  to launch — a weak pull falls back for another go — then the flippers: Z / ← / left Shift and M /
  → / right Shift, the ◀ and ▶ pads, or a finger on the left or right of the stage (two thumbs at
  once work). Bumpers kick the ball away and score 100, a target lights for 250, lighting every
  target pays 2,000 and puts them out. Three balls; the best score for each table name is kept.
  Sound: bumpers on the marimba, targets on the bell, a drain low. N new game.
  Technique: the physics is CPU and deterministic at 960 Hz — gravity down the table, capsule walls,
  a speed limit so no step crosses a wall, flippers as capsules swinging at 28 rad/s up and 18 down
  whose surface speed (ω × r) is what strikes the ball, bumpers that set the ball's outward speed
  to 13, and a plunger that catches a ball falling back down its lane. The GPU's `bake` runs only
  when the table changes: a 160 × 288 `rgba16float` field holding, at every texel, the distance to
  the nearest wall, bumper and target (`distanceAt`, a channel each). `show` reads it once a pixel
  for the neon — a bright core and a soft halo — and draws what moves analytically: bumpers' rings
  (flashing when struck), lit targets, the flippers, the ball and its trail, the plunger's pull.
  While you draw, the stroke is baked in each frame so it glows as you go.
  ⚠️ What was wrong first:
  1. **The plunger could not get a ball into the table**: a ball shot straight up the lane passed
     the top of the lane's wall and fell back down it. A straight deflector bounced it back too; the
     top right is now a quarter-circle orbit the ball runs round into the table.
  2. **A weak pull bounced in the lane for four seconds** before it could be plunged again. The
     plunger catches a ball falling back now, as a real one does.
  3. **Everything read from the baked field was drawn upside down**: the bake writes the table's
     bottom into row 0 and the shader sampled it flipped. The check of the field against the CPU
     passed — it read the texture with the bake's own mapping — and the picture did not: the bumper
     discs sat below their own rings. A second check now goes through the rendered pixels.
  4. **The outer walls glowed outward** past the edge of the field, where a sample clamps to the edge
     texel: 798 of 6,439 bright wall pixels were off any wall. Past the edge the shader reads the
     nearest point inside and adds the way out, and it is 0 of 4,502.
  5. **The drawn table's segments were rebuilt 960 times a second**; they are worked out once per
     table now.
     _Measured_: the tests hold the flippers (swing up at 28, fall at 18, stop at their ends; mirror
     images; a drain gap wider than a ball), a resting ball fired up the table by a flip (made to fail
     by taking the flipper's own surface speed out of the collision), an untouched ball draining and
     the third drain ending the game, the ball never leaving the table when fired at top speed in 24
     directions through the workshop table with the flippers going, a full plunge going round the
     orbit and a feeble one coming back to the plunger, bumpers (kick at their own speed, score, flash),
     targets (light once, the last pays the bonus and puts them out), playing beating not playing (a
     scripted flipper keeps the first ball over four times as long as doing nothing), building (where
     parts may go, strokes thinned and clipped, the limits said, erase nearest), a table file (round
     trip, refusals for each way one can be bad), the uniform layout, the item list, the fit and the
     field's distances. In the simulator: idle games end in 12–25 s at a full-enough pull and nothing
     ever stuck; over 90 s the scripted flipper scores about 5,500 on the workshop table. On
     SwiftShader: the baked field equals `distanceAt` to a relative 5 × 10⁻⁴ (half floats) at 966
     texels; through the picture, every bright wall pixel is on a wall by the CPU's measure and every
     bumper's centre is pink. In the page at 1024: the plunger pad pulls to full and launches round the
     orbit, Z and M each raise their own flipper, an idle game ends, a drawn wall / bumper / target are
     kept and a bumper in the lane is refused saying why, erase, save, a hostile file refused, reopen,
     and it all survives a reload. On the emulated iPhone: the three pads are 109 × 56, the plunger pad
     held and let go launches the ball, and two simultaneous touches on the stage, one each side, raise
     both flippers and lifting drops them. Audit clean at both.
     Not measured: whether it plays well — the flipper strength, gravity and bumper kick are tuned by
     numbers (a perfect scripted flipper never loses a ball, which no person is); whether the pads,
     which sit below the stage on a phone, are needed at all with the stage's halves doing the same;
     real-phone frame rate (the bake is cheap and only on edit; the per-frame shader is a texture read
     plus a few dozen analytic shapes).

- **Night crossing** — a game for two with different jobs, or one person with two hands. A small
  boat crosses a channel full of rocks at night. The **pilot** steers (←/→ or A/D, ↑/W full ahead,
  ↓/S slow — or the four helm buttons) and the boat cruises when left alone. The **keeper** aims the
  boat's searchlight — with the mouse, a finger on the water (the beam follows it, and keeps that
  angle off the bow when lifted), or J/L — and sets it between narrow-and-far and wide-and-near (I/K,
  or the slider). Nothing can be seen but what the beam lights: rocks show as it touches them, throw
  shadows behind them, and stay dimly remembered for a few seconds after. The buoys carry their own
  small lights and mark the safe water; ringing them (passing close) turns them gold. Three knocks on
  the rocks and the boat is lost; reach the harbour lamps at the far end to get home, timed, with the
  best time for each crossing kept. Three crossings: **Calm harbour** (60 units, 40 rocks), **The
  reef** (90, 90) and **Long night** (130, 150). Space casts off or heaves to, R starts again. Two
  people on one keyboard split it (WASD/arrows and IJKL), or one on the keys and one on the mouse; on
  a phone one thumb on the helm buttons and another on the water.
  Technique: each crossing is generated from a seed — a corridor that wanders across the channel,
  rocks scattered everywhere except within 1.3 units of its line, a buoy every 14 units along it —
  and the boat, the knocks, the bells and the harbour are CPU and deterministic. The GPU's
  `remember` pass keeps a memory map of the whole channel, 6 texels a unit, but runs only on the
  rows within 22 units of the boat: each texel becomes the larger of the beam's light on it now
  (`light`, the same as `lightAt` — in range, inside the beam's angle, and no rock between it and the
  lamp, tested against every rock near the boat) and what it held before times a fade (0.55 a
  second). `show` draws the night from that map — black water with swell the light picks out, the
  shore, rocks lit only as much as the map says, white water round them, the buoys' blinking lights,
  the harbour's lamps and the boat (red while shaken from a knock). So the shadow test is done once
  a texel near the boat, not once a pixel of the screen.
  ⚠️ What was wrong first: the shader's first rock was faintly visible unlit — enough ambient light to
  steer by, which is the whole game given away; unlit rock is now nearly black. And two probe faults
  worth knowing: a fixed-length key hold is not a fixed pull at an unknown frame rate, and a button
  below the fold receives no synthetic touch.
  _Measured_: the tests hold the courses (the same from the same seed; the corridor clear of rock
  within 1.3 units at every tenth of a unit of all three; a pilot following the corridor gets home
  untouched and rings every buoy at cruise and at full speed; a boat left to sail straight on is
  wrecked on every crossing), the boat (cruises, comes up to full and down to slow, turns at its
  rate, a rock costs one point however long it scrapes and puts the boat outside it, the banks turn
  it back), the light (narrow reaches further, wide sees wider, brightest on the axis and nothing
  behind, a rock shadows what is behind it and lights its own face — made to fail by letting light
  through rocks), the uniform's layout and the shader's copies of the beam and map, the rocks and
  rows sent to the GPU (every rock the beam could reach is in the list) and the camera. On
  SwiftShader the memory map equals `lightAt` to 1.3 × 10⁻⁴ over 56,160 texels in three poses —
  2,258 of them lit and 146 dark only because a rock is in the way — and fades by exactly the
  factor asked (to 5 × 10⁻⁸). In the page at 1024: the beam points at the mouse, the keeper's K
  widens it, a boat left alone is wrecked, and a pilot driven through the arrow keys only — steering
  for the corridor from the boat's position as the page draws it — gets home in 14.6 s untouched
  with all four bells, and the best is kept and ticked after a reload. On the emulated iPhone the
  four helm buttons are 79 × 56, a finger on the water swings the beam to it and the beam keeps
  that aim when lifted, and Full ahead casts off. Audit clean at both.
  Not measured: whether it is fun, and above all whether it is fun for TWO — whether the keeper has
  enough to do on the calm crossing, and whether the pilot can trust what they are shown; whether
  the crossings are too easy with one person on both (the buoys alone may be enough to steer by);
  whether the stair-stepped edges of the shadows (the map's 6 texels a unit) matter on a real
  screen; phone speed (the remember pass is ~25,000 texels × up to 96 rocks a frame).

### Real-device checklist — batch 10

- [ ] Möbius golf — play the six holes without 💡: do the copies round the course make the spaces
      make sense, or do you need the hints? Is pulling back on a phone precise enough for Lanes and
      Pocket? Can you find an ace on Pocket in a space other than the torus?
- [ ] Pinball workshop — does the workshop table play well, and do flips feel like flips? Build a
      table of your own and play it: is drawing walls precise enough on a phone? On a phone, do you
      use the pads under the stage or the stage itself?
- [ ] Night crossing — play it with somebody: one steering, one on the light. Does the keeper have
      enough to do? Is the reef fair? Then alone, keys and mouse: too easy, too hard? On a phone, is
      a thumb on the water and a thumb on the helm workable for one person, or is it a two-person
      phone game?

## Batch 11 — review fixes, then things to rebuild and fold

⚠️ **STACKED ON BATCH 10** (`claude/lab-toys-11` from `claude/lab-toys-10` at `5e530dd`; #25, #26
and #27 all unmerged drafts when it was cut). Its draft PR, #28, targets the batch-10 branch. When it
was cut, `main` had moved on by Instrument and takes commits only and the whole stack still merged
into it cleanly. Same rules of evidence as before: _measured_ means unit tests or headless Chromium
on SwiftShader; the emulated phone is Playwright's iPhone 13 with CDP touch, layout and touch
routing only. Automated play shows the rules hold, never that anything is fun.

### The review fixes (committed on their own, before anything new)

- **A held control stays held until the last thing holding it lets go** (`ca72159`). Reproduced in
  the page first, eleven cases:
  - _A key let go after focus moved was ignored._ Pinball and Night crossing dropped every key
    event not aimed at the toy's own box, releases included: hold Z, click 🔔 Sound, let go — the
    flipper stayed up for good; hold A, click the beam slider, let go — the boat turned in circles.
    A release now counts wherever focus is; a press on a button or slider is still the control's
    (Space presses the button, the slider's arrows move it — both checked).
  - _Letting go of one input let go of the action._ One boolean an action, cleared by any release:
    hold Z and tap the ◀ pad, and the flipper dropped with Z still down; the same for Z and ←, Z and
    a finger on the stage, A and ← or the Port pad in Night crossing — and Bike trials' keys and
    pads. `holds.ts` names every holder (`key:z`, `pad:7`, `stage:12`) and an action is held while
    any of them is; Pinball's plunger fires when the last one lets go.
  - _Checked_: `holds.test.ts`, and a page probe whose eleven cases all fail on the code before the
    change and all pass after it.
  - _Same shape elsewhere, NOT changed_ (older toys, on `main`, outside the reviewed stack): Ferro
    ignores a Space release that arrives from a focused button, and Tunnel lets one of its two keys
    for a direction cancel the other. Both would take the same few lines.
- **A pinball bumper pays for a hit, not for every step a ball cannot get away** (`f6fc455`).
  Reproduced first: three bumpers in a tight triangle (Build lets them go anywhere) wedged a ball and
  scored on every physics step — 8,640 hits and 864,000 points in three seconds; four in a cage
  23,400. A bumper still kicks on every contact (the physics is untouched) but pays — score and
  sound — only once the ball has got clear of where that bumper last paid by the ball's own width.
  _Checked_: the triangle now scores 300 in all and the cages 400 and 600; a ball bouncing off a
  bumper and back, and a ball kicked between two bumpers one above the other, are paid on every
  arrival (counted independently of the scoring); scripted play on the workshop table scores exactly
  what it did before, 5,562.5 a 90 s game and 350 idle. _Not fixed_: the wedged ball itself stays
  wedged until 🔄 New game — scoring was the finding, and freeing it means changing the physics.

### New

| Toy        | What you do                                                                                                                                                                                                                                                 | GPU technique                                                                                                                                                                                                                                                                                                                                                                  | Pattern to reuse                                                                                                                 |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Shadow box | Rebuild a hidden stack of blocks from the shadows it throws on the walls and floor. Six puzzles with a par (the fewest blocks that can do it), or pass and play: one builds and hides it behind a curtain, the other rebuilds it from the shadows           | a VOXEL RAY TRACER per pixel: each ray walks the floor's columns to the first block face, else the walls and floor; each wall's shadow is found by walking from the lit point toward its lamp through the columns. The hidden build's shadows and the player's are drawn over each other — blue where they agree, red where the player's throws shadow the hidden one does not | "the clue is drawn by the same light the answer casts": a hidden state shown only through a projection, judged on the projection |
| Fold       | Fold a square of two-coloured paper by picking up a point and laying it down: the crease is half way between, and the picked-up side turns over on top. Seven shapes to fold within a limit, or fold freely and keep the shape as a picture or as its folds | the LAYERS DRAWN PER PIXEL: each layer a convex polygon and an affine map back to the flat sheet; at each pixel the topmost layer is found, the point mapped back onto the sheet and drawn there — front colour or cream back, fibres, the creases already in it — with the target as a ghost under it. Redrawn only when something changed                                    | "a stack of mapped flat pieces": anything folded, mirrored or tiled out of one flat source keeps one map per piece               |

- **Shadow box** — a 5 × 5 box, stacks up to 4 blocks tall, and three lamps square to the walls: one
  in front throws the blocks' outline onto the back wall, one on the right onto the left wall, one
  overhead marks the floor they stand on. The job is always to build something that throws the
  given shadows — not necessarily the same blocks, since many builds throw one set of shadows. Your
  own shadows fall over the given ones: blue where they agree, red where yours throws shadow it
  should not; on the floor, a block standing where nothing should is tinted red too. **🧩 Puzzles**:
  six, from _A step_ to _Skyline_; some show the floor and some only the walls, and each has a par —
  the fewest blocks that throw its shadows, which on _Stairs_ is 10 though the hidden build used 20.
  Solving keeps your best (fewest blocks) and ticks the list; 💡 Show an answer builds a par answer
  and is not kept. **👥 Pass and play**: the builder stacks blocks and chooses which lamps are on —
  those are the only shadows the guesser will get — then 🙈 Hide it: a curtain is all the GPU draws
  and the grid goes. The guesser presses 👀 and rebuilds from the shadows; ✔ Check says how many of
  the shadows are still wrong; when they all match, or on 🏳 Give up, the hidden box is shown. ⬇ Save
  box keeps a build as a file; ⬆ Open a box to solve… takes one straight behind the curtain, so a
  box made earlier (or on another device, by file) can be solved without its opener seeing it.
  Building: tap the box (on a stack adds a block on top, on the floor starts one; ➖ makes a tap
  take one away), or the grid under it (a tap cycles a stack 0 → 4 → 0), or the keys (arrows move,
  0–4 set, + and − nudge). Drag the box sideways to turn it.
  Technique: a build is 25 heights. Square lamps make each shadow a profile — the tallest stack in
  each column (back wall), in each row (left wall), and which cells are built on (floor) —
  `shadowsOf`, and the judge compares profiles. Par comes from `fewest`: for walls only, one stack
  does for a column and a row that need the same height, so each height needs as many stacks as
  the larger of its columns and its rows (exact); with the floor, every marked cell needs a block and
  the same matching is done greedily. The GPU traces the box per pixel: an orthographic camera,
  mirrored so x runs left to right as it does on the grid; a 2-D walk over the columns finds the
  first block face; the back wall, left wall and floor behind; each wall point's shadow found by
  walking toward its lamp through the columns, once for the hidden build and once for yours. A tap
  on the box is the same trace on the CPU (`traceBlocks`, `pickCell`).
  ⚠️ What was wrong first:
  1. **The whole floor read as shadowed**: the floor's shadow test lowered the point half a unit,
     so an empty cell (height 0) counted as built on. The GPU-against-CPU check of every wall pixel
     disagreed on a third of them; it agrees on all now.
  2. **The left wall's shadows missed the column against the wall**: the walk toward the right-hand
     lamp started one column in.
  3. **The view was a mirror of the grid**: in a right-handed world seen from the front, +x is on
     the left, so the box's left wall was drawn on the right. The camera's horizontal axis is
     mirrored, in the shader and its CPU copy alike.
  4. **On a phone the grid sat below the stage**, so you could not see the shadows while building;
     tapping the box itself builds now.
     _Measured_: the tests hold the shadows (profiles; different builds matching one clue, but not once
     the floor is shown; a shadow not shown is not judged), the puzzles (none solved by an empty box,
     each hidden build matches its own clue, par is a valid build and the fewest — against a full
     search where the floor is shown and the exact count where it is not — made to fail by taking the
     matching step out of `fewest`), a box as a file (round trip; refusals), the uniform layout, the
     camera (its centre ray through the middle; x left to right), the shadow test, and picking (a tap on
     a stack's top or side or on the floor picks the right cell, checked through a projection worked
     out independently of the ray). On SwiftShader every sampled wall and floor pixel's shadow equals
     the CPU's (12,652 of 12,652 in each of three puzzles) and every pixel's block-or-not equals
     `traceBlocks` (79,338 pixels, three puzzles at three angles, 0 disagreements). In the page at 1024:
     a puzzle solved by grid taps at par and kept; a wrong block un-matches it; keys set stacks; a shown
     answer is not kept; drag turns the box; pass and play from build to curtain (the grid gone, the GPU
     told to draw only the curtain) to guess (empty grid, only the two lamps chosen) — a wrong check
     says two shadows are wrong, a different build with the same shadows is accepted, the box is
     revealed, roles swap; a hostile file is refused and a saved box opens behind the curtain; bests
     survive a reload. On the emulated iPhone: the 44 px grid, a puzzle solved by taps, and the box
     itself built on by touch (a floor cell, the top of the new stack, ➖ taking one away). Audit clean.
     Not measured: whether the puzzles are the right difficulty; whether a guesser can read the
     shadows from the default angle without turning the box; whether pass and play holds its secret
     well enough at a real table (the curtain is drawn, but the builder's phone is still in their hand).

- **Fold** — a square of paper, coloured on the front and cream on the back, on a cutting mat. Press
  on the paper (anywhere on it, or a hair off its edge), drag, and let go: the point you picked up
  is laid where you let go, the crease is the line half way between, square to the move, and
  everything on the picked-up side turns over and lands on top — so the other colour shows. The
  fold is shown as you drag; the point you pick up and the point you lay it on are pulled to the
  sheet's corners as it lies, and gently to a grid of twelfths. **🧩 Puzzles**: seven shapes, from
  _Half_ and _Triangle_ to _Envelope_ (four corners to the middle) and _Arrow_, each drawn as a pale
  ghost with a dashed outline and a number of folds allowed; the score says how like it the paper is
  (shared area over either), and 97% within the limit solves it — any way of getting there counts.
  Your best (fewest folds) is kept and ticked; 💡 Show how folds it for you and is not kept. **✋ Free
  fold**: up to eight folds, a choice of eight paper colours, ⬇ Save picture (a 1024 px PNG), ⬇ Save
  folds / ⬆ Open folds… (the moves as numbers, replayed). ↶ Undo or U, 🔄 Unfold or R.
  Technique: a folded sheet is a stack of flat layers, bottom to top, each a convex polygon where it
  lies now, the affine map back to where it was on the flat sheet, and which side is up. `fold` cuts
  every layer by the crease; the parts on the picked-up side are reflected (and so is their map back,
  a reflection being its own inverse), their side flipped, their order reversed and laid on top; the
  crease is recorded on the flat sheet wherever a layer was cut. Paper is neither made nor lost
  (every fold keeps the area at exactly 1), and past 64 layers the paper is "too thick to fold
  again". The match is measured on a 240 × 240 grid. The GPU draws it per pixel: every layer's
  polygon tested (a convex polygon's signed distance is the largest of its edges'), the topmost one
  that covers the pixel mapped back onto the sheet and coloured from there, the creases drawn on the
  sheet so they fold with it, each top edge drawn as a fine line and a soft shadow on the mat; and
  only when the sheet, the colour or the size changed, since testing up to 64 layers a pixel for an
  unchanged picture would be waste.
  ⚠️ What was wrong first:
  1. **The grid swallowed every point**: twelfths are 0.083 apart and pulled from 0.04, so nothing
     could be placed between them. The grid's pull is 0.016 now; the corners' is still 0.04.
  2. **Picking the paper up by its edge did nothing** when the press landed a hair outside it — the
     first fold the desktop probe tried. A press within 0.04 of any layer's edge counts now.
  3. **The score lagged a fold behind**: the folded sheet was worked out in an effect, after the
     render that showed the score. It is worked out as the folds change now.
     _Measured_: the tests hold the geometry (a reflection is its own inverse and keeps distances; the
     crease is the perpendicular bisector; cutting keeps area), folding (the picked-up point lands on
     the target point, back up; paper area exactly 1 and every layer counter-clockwise across four
     arbitrary folds; the turned-over part on top in reverse order — made to fail by not reversing it —
     and the crease on the flat sheet; refusals for no move, a fold that misses, turning the whole sheet
     over, and folding past 64 layers), the puzzles (each folds within its limit, the flat sheet matches
     none, no two targets pass for each other, a different way to the same shape counts), picking up,
     snapping, folds as a file (round trip; refusals including folds that do not fold), the uniform
     layout, the layer packing and the view. On SwiftShader every classified pixel's table, front or
     back equals the CPU's topmost layer — 85,640 pixels over three folded sheets, 0 disagreements. In
     the page at 1024: Half, House and Triangle folded by mouse drags and kept as bests; a second fold
     on Triangle over the limit is said so and U undoes it; Show how folds Envelope and is not kept;
     three free folds, a colour, a 1024 × 1024 PNG, the folds saved, a hostile file refused, the saved
     folds reopened to the same sheet; bests survive a reload. On the emulated iPhone a touch drag folds
     Half. Audit clean at both.
     Not measured: whether the puzzles are interesting past the first few (they are shapes reachable by
     a known sequence, not designed for an "aha"); how precisely a finger can lay a point on a phone
     (snapping helps; there is no zoom); speed on a phone with many layers (the picture is redrawn only
     on change, but a drag redraws it every move). There is no way to fold from the keyboard alone.

### Real-device checklist — batch 11

- [ ] Pinball and Night crossing — hold a key, click or tap a button, let go: does the control let go?
      Hold a key and a pad together, let go of one: does the control stay held?
- [ ] Shadow box — the puzzles without 💡: can you reach par? Pass and play with somebody: is the
      curtain enough, and are three lamps the right number of clues? Is tapping the box precise
      enough on a phone, or do you reach for the grid?
- [ ] Fold — fold the seven shapes without 💡; is dragging a point precise enough on a phone? Make a
      shape of your own and keep it.

## Batch 12 — things to knock down and to print

Branch `claude/lab-toys-12`, cut from `main` at `bd40884` (all 49 already there and deployed; see the
status at the top). Not stacked on anything. Same rules of evidence: _measured_ means unit tests or
headless Chromium on SwiftShader; the emulated phone is Playwright's iPhone 13 with CDP touch, for
layout and touch routing only. Automated play shows the rules hold, never that anything is fun.

| Toy        | What you do                                                                                                                                                                                                                                | GPU technique                                                                                                                                                                                                                                                                                                               | Pattern to reuse                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Topple     | Draw lines of dominoes, paint their faces, push one: the run falls and a picture appears, because a domino's colour only shows as it tips. Five puzzles ring bells from one push — a fork, a duet that must ring together, chimes in order | every domino an INSTANCED BOX tipped in the vertex shader about its base edge by π/2·(Δt/FALL)², from its own start time and resting angle; a soft shadow quad under each that stretches as it falls; the floor (wood, walls, bells, the push arrow, the line being drawn) per pixel under them                             | "the CPU decides WHEN, the GPU animates HOW": an event-ordered cascade hands each instance a start time, and the shader replays any moment of it                     |
| Print shop | Carve a lino block with three gouges and pull prints from it, colour over colour: a reduction linocut, where each colour is printed from what is left of the same block. The print is the block turned over                                | a COMPUTE pass carves each cut into a 480×360 height field over the cut's own box only (one dispatch a cut, the minimum over its segments); a second inks every texel of the paper from the MIRRORED block texel, broken by an integer-hash paper grain; a fragment pass lights the block by its own slope beside the print | "replay the steps, never store the pixels": the work is its cuts and pulls, so Undo, a file and a reload all rebuild the GPU state exactly from a list a few KB long |

- **Topple** — a wooden table, and dominoes. ✏️ **Line**: draw, and dominoes stand along what you drew,
  0.6 apart, each facing along the line where it stands (a drawn corner is rounded off, because a
  domino turned more than about 63° from the one hitting it is struck side-on and stands — a sharp
  corner stops a run, which is true of real dominoes too). 🎨 **Paint** colours their faces (eight
  colours), 🧽 **Erase** removes, 👉 **Push** knocks the one you tap away from your finger; ▶ Push (or
  Space) pushes the puzzle's arrow, or in free play the first domino. A domino's face colour shows
  only as it tips — so a field of plain ivory tiles turns into a picture as it goes down. ⏮ Stand them
  up (R), ↶ Undo (U, thirty steps), 🧹 Clear, ⏩ 1× / 3× / 6×, 🔔 sound (a tick as they go, a bell as one
  rings). **🧩 Puzzles**: _First run_, _Round the wall_, _Fork_ (two bells, one push: two dominoes
  side by side in front of one are both knocked), _Duet_ (two bells within an eighth of a second, so
  the short run has to wander — two straight branches ring 0.38 s apart), _Chimes_ (left, middle,
  right in order, and the push goes the wrong way); each has a budget of dominoes, a failed run says
  what happened ("rang 1.41 s apart", "2 of 3 rang"), your best (fewest dominoes) is kept, 💡 Show a
  way builds one and is not kept. **🎨 Free table**: up to 600; 🌀 _A picture to knock down_ stands a
  325-domino spiral with a heart on its faces; ⬇ Save table / ⬆ Open table… as a file; the free table
  is kept in this browser too.
  Technique: the cascade is CPU and exact — a priority queue of knocks in time order: a falling
  domino strikes every standing one in the strip it sweeps (ahead of it by less than its height,
  overlapping across), at the time it has tipped far enough to reach it (`tipTime`: angle grows as
  the square of time, so FALL·√(angle/(π/2))); a hit square enough to the struck domino's axis knocks
  it away from the striker, a side-on one leaves the striker leaning on it; bells ring when a falling
  top sweeps over them. The GPU draws three passes into one depth buffer: the floor per pixel, a
  shadow quad per domino, and every domino as an instanced box whose vertex shader tips it by the
  same curve from its own start time and stops it at its resting angle.
  ⚠️ What was wrong first:
  1. **Every bent run stopped at its corner**: dominoes faced along the segment they stood on, so a
     corner turned one domino all at once and it stood side-on. Lines are rounded off and each domino
     faces along the curve where it stands now.
  2. **A line could end up to a spacing short of where it was drawn to** — 3.0 ÷ 0.6 lands just short
     in floating point and the last domino went, leaving a gap the run could not cross.
  3. **Two of the first puzzle answers were impossible** — a hairpin no run survives, and a branch
     leaving the trunk side-on. The Duet answer is now solved for (its meander's length found by
     bisection, the bells 0.05 s apart) and Chimes is a U-turn.
  4. **Undo restored the change instead of undoing it**: the old table was read inside a state
     updater, which React runs after the next line had already replaced it.
  5. **The run was judged by the first puzzle's rules** — the frame loop held the first render's
     judge, so Duet reported "(allowed 30)" and the free spiral was judged as a puzzle.
     _Measured_: the tests hold standing (spacing, facing, the line's own end, rounded corners turning
     under 0.6 rad a domino, nothing where one stands, in a wall, off the table or past 600), the cascade
     (a run carries at `tipTime` a domino; a gap wider than a domino stops it; pushed the other way it
     falls the other way; a side-on domino stops it and the striker leans — made to fail by letting
     side-on hits knock; a fork; a domino out of reach across stays up), the puzzles (none solved by an
     empty table; each solved by its stored way within budget; the straight Duet not solved; Chimes in
     the wrong order not solved), the spiral (all 325 fall from one push), a table file (round trip;
     refusals), the uniform, the shader's copies of the sizes, the packing and the floor mapping. On
     SwiftShader, with every domino painted blue: before the push no blue pixel anywhere; after it,
     every one of 45 dominoes shows blue where the CPU says it lies; mid-run 16 of the 17 that should be
     down do (the 17th's spot is hidden behind a standing domino at the fork). In the page at 1024: First
     run drawn by mouse and solved by Space, kept as a best; a straight Duet says how far apart the bells
     rang; Undo; Show a way at 6× solves Duet and is not kept; the spiral at 6× — 325 of 325 down; a line,
     painted, a domino erased and Undo bringing it back; a table saved, a hostile file refused, reopened,
     and the free table there after a reload. On the emulated iPhone, First run drawn by touch and solved
     with ▶ Push. Audit clean at both.
     Not measured: whether drawing a run is precise enough on a phone (a corner too sharp stops it, and a
     finger draws sharp corners); how a 600-domino table runs on a phone GPU (one instanced draw, but 600
     × 36 vertices and a shadow each); whether the puzzles are the right difficulty.

- **Print shop** — a block of lino on a bench beside a sheet of paper. Drag on the block to carve it
  with ✒️ **V gouge** (a fine line), 🥄 **U gouge** (a medium one) or 🪣 **Scoop** (clears a broad
  band); pick an ink (eight, Lemon to Black, light to dark as a reduction print goes) and a pressure,
  and 🖨 **Print it** (P). What you carved away stays the paper's colour; what still stands takes the
  ink. Then carve away what should KEEP that colour and print a darker ink over the lot — the same
  block every time, which is what a reduction print is: planned light to dark, and the block is used
  up as it goes. ↶ Undo (U) takes back the cuts since the last print and no further — a printed cut is
  in the block for good, as on a real one, and pressing Undo then says so rather than going dead.
  🔄 New block starts again (and Undo brings the old one back). Light pressure lets the paper's grain
  show through; the block keeps a film of the last ink on what still stands. The print is the block
  mirrored, so words are carved backwards. ⬇ Save picture (the print as a 480×360 PNG), ⬇ Save block /
  ⬆ Open block… (the work as a file); the work is also kept in this browser and rebuilt on a reload.
  Technique: the work is a list of steps — cuts (a gouge and up to 96 points) and pulls (an ink, a
  pressure and the seed of that pull's grain) — and the block and the paper are always that list
  replayed. `carve` is dispatched over a cut's box (`cutBox`) and takes each texel to the lowest any
  segment of the cut reaches (`carveStroke`); because carving is a minimum, a cut carved piece by piece
  while it is dragged is exactly the cut replayed from its saved points, which is what lets a file or
  a reload print the block that was on screen. `press` reads the mirrored block texel, lets it take
  ink by how far it stands above the surface line, breaks that by an integer hash of the texel and the
  pull's seed (the same bits in TypeScript and WGSL), and lays the ink over the paper as a
  transparent multiply. `show` samples both bilinearly, so a thin cut neither steps nor beads at a
  phone's fractional scale.
  ⚠️ What was wrong first:
  1. **Carving one segment per submit would have made a long file thousands of submits to open.**
     One dispatch per cut, over its box, with the cut's points in a storage buffer.
  2. **Undo went dead after a print** with nothing to say why; it stays enabled and explains.
  3. **A thin V cut looked beaded on the phone** — nearest-texel display at about 1.4 device pixels a
     texel. The print itself was clean (checked in the exported PNG); `show` now interpolates.
  4. **The pressure slider was 16px tall**, under the 24px floor; it uses the Lab's `lab-flow` rule.
     _Measured_: the tests hold each gouge to the width of line it prints (V 2–3 texels, U 8–10, scoop
     22+), a cut only ever lowering the block, a V's sloped wall and a scoop's flat floor, a stroke the
     same in one piece and segment by segment in either order, every texel a cut changes inside the box
     the GPU is dispatched over, a cut carved as it is dragged equal to its saved points replayed (made
     to fail by carving the wrong piece), ink taken by height from the surface line, light pressure
     leaving more of the grain, the grain repeatable and different a pull, the mirror, inks layering
     darker, only cuts since the last print undoable, a file round trip with every field off its
     default, seventeen refusals (including unknown fields dropped and a `script` step refused), the largest
     possible block fitting under the file limit, the uniform, the shader's copies of the sizes and the
     layout. On SwiftShader, against the CPU twin over the whole 480×360: after eleven cuts every texel
     of the block within 8·10⁻⁵ (none past 10⁻⁴); after a Lemon pull at pressure 0.7 and an Ultramarine
     one at 1 every texel of the paper within 10⁻⁴; the scoop disc at block x≈100 is paper at print x≈379
     and inked at x≈100; replaying the steps gives a bit-identical block and paper. In the page at 1024:
     carve, Undo to an uncut block, carve, print, Undo after it explains and changes nothing, a second
     ink by the P key, a long drag kept as four cuts, the picture and the block saved, New block and back
     with Undo (block and paper read back identical), a reload (identical), a hostile file refused, the
     saved file reopened (identical). On the emulated iPhone the same by touch — the touch cut carves
     exactly the 6,176 texels the mouse one did. Audit clean at both.
     Not measured: how carving feels with a finger (the finger covers the cut; there is no zoom), how
     the 2.7 MB paper buffer and the bilinear `show` run on a phone GPU, whether a reduction print is
     something people work out from the hint alone.

### Real-device checklist — batch 12

- [ ] Topple — draw First run with a finger and push it. Paint a picture of your own and knock it
      down. Can you do Duet without 💡?
- [ ] Print shop — carve something, print Lemon, carve more, print Ultramarine over it. Is the
      mirror a surprise? Does a finger carve where you meant, and does the picture save?

## Catalog and feedback — not a toy batch (7 Nov 2026)

Branch `claude/lab-catalog-1` from `main` at `3d073b6` (51 experiments, batch 12 merged as #30).
No new toys. `docs/2026-11-07-lab-catalog-and-feedback.md` is the full record — permission
review, release order, rollback and what each test is; `docs/OPEN-DECISIONS.md` §14 the policy
calls.

- **For everyone, no backend needed:** 🔎 Browse, search & favourites — search, a kind filter,
  ★ favourites (this browser only), 🆕 New and 👍 Highly rated with their rule printed beside
  them. Browsing unmounts the running experiment, so no card ever mounts a GPU device; choosing one
  mounts it fresh, the same as the picker.
- **For signed-in members, once the draft is applied:** 👍 / 👎 under each experiment — every
  member's vote counts, and members see the actual totals at once, zeros included — and a Notes fold for
  ideas, requests and bugs, read by the same rules as a profile. Guests can still play everything.
- **For the admin:** Owner controls under each experiment — ⭐ Featured, 🧪 Rough edges,
  🙈 Hidden — and the queue of reported and removed notes. The admin reads notes like any member; a
  note shared only with friends reaches them only when somebody reports it. A hidden experiment
  leaves the picker for everybody else and keeps its id, saved work, votes and notes.
- **Stable ids:** nothing in `DEMOS` changed. A new toy needs a line in `src/lab/catalog.ts`'s
  `META` (a kind and a date; `catalog.test.ts` fails without it) and is registered in the database
  by the admin's next visit.

### Follow-on: `claude/lab-next-1`, stacked on #31 (8 Nov 2026)

**Base:** `claude/lab-catalog-1` at `73506ac` (PR #31). It needs that PR's frontend and changes no
SQL, so #31's release boundary is untouched: its draft stays unapplied.

- **One toolbar at every width.** The 51-button wall above the toy is gone. Every width now gets
  what phones already had: ‹ previous, a dropdown of all toys, next › — plus 🔎 Browse all 51 and
  ★ Favourite on the same line, directly above the toy. The step buttons name their neighbour
  ("Next experiment: Neon"). The toy starts about 210px higher on a desktop.
- **Catalog:** the search box takes focus when the catalog opens (with a mouse only — on a phone it
  would throw the keyboard over the list). Launching a card from far down the grid scrolls the
  toolbar back to the top of the screen once the toy has rendered. The current toy's card says
  "Last open", not "Playing": the catalog unmounts it.
- **🕘 Recent** (branch `claude/lab-recent-1`, stacked on this one): a catalog view of the last
  twelve experiments opened in this browser, most recent first — the first visit's included, and
  whether it was opened from a card, the dropdown or ‹ ›. Labelled "remembered in this browser
  only"; nothing is sent. Unlike favourites it forgets the oldest, which is safe only because no
  other store mirrors it. It does not try to say which toys hold your work: several write a
  default on first open, so "has saved data" would really mean "opened once".
- **🎲 Surprise me** (branch `claude/lab-surprise-1`, stacked on the Recent branch): launches one
  at random from whatever the catalog is showing — so choosing a Kind first means "surprise me with
  a puzzle" — and never one in your Recent list while there are others to pick.
- **Finding things faster** (branch `claude/lab-find-1`, stacked on Surprise me): the Kind dropdown
  says how many each kind holds ("🎮 Games & puzzles (13)"), and **/** anywhere in the Lab opens the
  catalog with the cursor in search — except shift+/ (the site's own help), while typing, and while
  a toy has the keyboard (Pinball's right flipper is "/").
- **Back where you left it** (branch `claude/lab-return-1`, stacked on Finding things faster): the
  catalog's search, list and Kind used to live inside the catalog, which is unmounted while a toy
  plays — so every ▶ Back to browsing started again at All with the search empty, at the top of
  the grid. The Lab holds them now (for this visit, not in storage). Returning from a toy launched
  from a card scrolls that card back into view and focuses its ▶, so Tab and Enter carry on from
  there; arriving any other way (‹ ›, the dropdown) still puts the cursor in search. Since a
  narrowed list now persists, **✕ Show everything** appears whenever it is narrowed, and moves
  focus to search (mouse) or Kind (touch) rather than dropping it on the page. To try on a phone,
  with the queue's phone test below: after launching from a search, ▶ Back to browsing — is the
  search still in the box, with that card in view? (Kept out of the queue's own lines so this
  branch and the toy branches never edit the same lines.)
- **🆕 New to you** (branch `claude/lab-unseen-1`, stacked on Back where you left it): toys keep
  arriving, and a returning visitor had no way to see which. The Browse button now says
  "🔎 Browse all 59 · 2 new", the catalog says how many were added since you first came, and those
  cards carry a 🆕 badge until opened — or until ✓ Mark as seen. ⚠️ A first visit meets everything
  (with no record, every toy there is is written down as seen), so the badge means "added since you
  started coming here" rather than fifty-nine badges on a first look. In this browser only
  (`lab_seen_v1`, known ids only, so bounded by the registry); never sent. A damaged record is
  read as a first visit.
- **Your vote, in words:** "You voted 👍 Like", with a Remove my vote button; the catalog card shows
  "You: 👍".

## Questions and tests for Evan — a short queue, most useful first

1. **Taste — the desktop picker.** The row of 51 name buttons is replaced by the dropdown and
   🔎 Browse at every width. Better, or do you miss seeing every name at once?
2. **Real device — a phone.** Open the Lab, 🔎 Browse, search "puzzle", launch one from the bottom
   of the list: does it land with the toy on screen? Is the dropdown easy with a thumb?
3. **Real device — once #31's SQL is applied.** Vote on a toy, change it, remove it; does the
   "You voted …" line read clearly?
