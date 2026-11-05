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
- [ ] the picker on a phone: a dropdown with ‹ › either side (batch 3) — measured at 375 it lets
      328 of the canvas's 412 px show on the first screen, where seven buttons in two rows let 275

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
