// How the park's movement feels, in units a hand understands.
//
//   node scripts/park-feel.mjs        (after: node scripts/build-park-feel.mjs — see below)
//
// ⚠️ THE NUMBERS IN TUNE MEAN NOTHING TO A PERSON. They are screenfuls a second and
// screenfuls a second squared, and "accel 3.4" does not tell you whether a creature feels
// like a sprite or like a thing with mass. What does: how long it takes to get going, how
// long to stop, and how far it slides in BODY-LENGTHS. At 3.4/6.5 the answer was 0.058s and
// 0.09 body-lengths — a full stop inside a tenth of its own length, which is why it read as
// weightless however smooth the frame rate was.
//
// ⚠️ IT IS A PURE-FUNCTION HARNESS BECAUSE THE BROWSER CANNOT ANSWER THIS. The Browser pane
// has no rAF, and the setTimeout stand-in is throttled, so the same creature covered 0, 0.48,
// 0.88, 1.35 and 2.42 percent of the world on five identical runs. stepWalker asked directly
// gives the same answer every time.
//
// This reads ./walk.mjs, an esbuild bundle of src/park/walk.ts — see the build note in the
// session scratchpad, or bundle it with:
//   npx esbuild src/park/walk.ts --bundle --format=esm --outfile=walk.mjs
// How the park's movement actually behaves, in units a person can feel.
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
const { stepWalker, restingWalker, TUNE, VIEW } = await import('./walk.mjs')
const PET_TALL = 0.22,
  PARK_TALL = PET_TALL * 0.8 // strike.ts
const ASPECT = 16 / 10

const RIGHT = { left: false, right: true, up: false, down: false }
const STOP = { left: false, right: false, up: false, down: false }

const sim = (accel, drag, speed) => {
  const old = { ...TUNE }
  TUNE.accel = accel
  TUNE.drag = drag
  TUNE.speed = speed
  let w = restingWalker(0.1, 0.5)
  // time to reach 95% of top speed
  const top = speed * VIEW.w
  let toTop = 0
  for (let t = 0; t < 2; t += 1 / 240) {
    w = stepWalker(w, RIGHT, 1 / 240)
    if (!toTop && Math.abs(w.vx) >= top * 0.95) toTop = t
  }
  // and how far it slides after you let go
  const atRelease = w.x
  let stopT = 0
  for (let t = 0; t < 2; t += 1 / 240) {
    w = stepWalker(w, STOP, 1 / 240)
    if (!stopT && Math.abs(w.vx) < 1e-9) stopT = t
  }
  const slide = w.x - atRelease
  Object.assign(TUNE, old)
  // a creature is PARK_TALL of a screen HEIGHT; a screen width is ASPECT of that
  const bodyInScreenWidths = PARK_TALL / ASPECT
  return {
    toTop: toTop.toFixed(3) + 's',
    stopIn: stopT.toFixed(3) + 's',
    slide: (slide / bodyInScreenWidths / VIEW.w).toFixed(2) + ' body-lengths',
    pace: (speed / bodyInScreenWidths).toFixed(2) + ' body-lengths/s',
  }
}

console.log('NOW      ', sim(TUNE.accel, TUNE.drag, TUNE.speed))
console.log('with weight (accel 1.9, drag 2.6)', sim(1.9, 2.6, TUNE.speed))
console.log('weight + a touch slower (speed 0.32)', sim(1.9, 2.6, 0.32))
console.log('\na creature stands', (PARK_TALL * 100).toFixed(1) + '% of the screen height tall')
