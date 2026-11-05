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

⚠️ **THE PICKER ON A PHONE.** Measured in batch 6: at 375, `main`'s button picker fits about 2.7
buttons a row, and was 3 rows (119px) with eight. Every three toys that land before #19's dropdown
add about another row; this batch on `main` alone makes about 5, and batches 5, 6 and 7 together
would make about 10 — most of a phone's screen of buttons above the canvas. Land #19's picker
first. A third picker would only make the merge worse.

| Toy           | Interaction                                                                                                                       | GPU technique                                                                                                                                                                                                                                          | Pattern to reuse                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Marble maze   | TILT (the phone, or a drag that leaves the board tilted), and TOOLS: draw walls, dig holes, pour marbles                          | a SPATIAL HASH BY COUNTING SORT — count per cell (atomics), scan (one workgroup), scatter (atomic cursors) — and POSITION-BASED DYNAMICS with gathered, order-independent pushes; a SIGNED chamfer distance field for the walls, bevelled for drawing  | "thousands of things that touch each other" — any crowd, any granular toy                               |
| Stained glass | DRAW (lead), then TAP to fill a region — the region is whatever shape you drew — and move the SUN (drag, keys, or tilt the phone) | CONNECTED-COMPONENT LABELLING on the GPU: min-label propagation with POINTER JUMPING, a fixed number of passes a frame; a fill is every cell sharing the tapped label. The floor's light is each floor pixel's ray back to the sun, through the window | "find the regions" — flood fill, paint bucket, islands, rooms, any region a person drew                 |
| Harmonograph  | a FLICK sets the swing; RATIOS you hear as intervals; a detune that makes the figure turn; it draws itself                        | a COMPUTE RASTERISER: a thread a segment walks its own pixels and adds ink with INTEGER ATOMICS, bilinear and exactly conserved; the paper drawn from the ink's density and colour                                                                     | "draw millions of lines yourself" — plots, trails, density maps, any line art a rasteriser is wrong for |

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

### Phone checklist — batch 7

- [ ] The picker: how many rows of buttons above the canvas at 375? Moot once #19 lands.
- [ ] Marble maze — does 📱 Tilt feel like tipping a real board (and ask, on iPhone)? Smooth with a
      few thousand marbles poured? Is the board's stay-tilted drag natural with a mouse? Do the
      plinks get annoying?
- [ ] Stained glass — is drawing lead with a finger precise enough to make the panes you meant? Does
      a pane fill feel instant? Does the light on the floor read as light through a window?
- [ ] Harmonograph — does a flick feel like giving the pendulums a push? Are the intervals' notes a
      nice touch or noise? Does a figure take about the right time to draw?
