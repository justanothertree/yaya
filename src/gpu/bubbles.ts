/**
 * The arithmetic of the Lab's soap bubbles: how a thin film of soap colours light, how a bubble
 * grows on a finger and floats away, and how one pops.
 *
 * ⚠️ THE COLOURS ARE INTERFERENCE, NOT A PALETTE. Light reflects off both faces of the soap film,
 * and the two reflections meet out of step by however far the second one travelled through the
 * film — so each wavelength is strengthened or cancelled depending on the film's THICKNESS. A film
 * a few hundred nanometres thick throws back magenta, gold, cyan in turn as it thins; under about
 * 30nm every colour cancels and the film turns black — which is what a real bubble does just before
 * it bursts. bubbles.wgsl does this per pixel for red, green and blue; bubbles.test.ts holds this
 * file's copy to the physics.
 */

/** Hand-packed to match `struct Bubbles` — bubbles.test.ts lays the struct out from the shader. */
export const BUBBLES = {
  size: 0,
  count: 8,
  time: 12,
  bytes: 16,
} as const

/** each bubble in the buffer: x, y, radius (px), seed · film thickness (nm), popping (0..1), kind, - */
export const BUBBLE_FLOATS = 8
export const MAX_BUBBLES = 96
/** soap water's index of refraction */
export const FILM_N = 1.33
/** red, green and blue, as wavelengths in nanometres — mirrored in bubbles.wgsl */
export const WAVELENGTHS = [650, 532, 450] as const

/**
 * How much of each colour a film of `thickness` nm reflects, seen at `cosIn` (1 = straight on).
 * The two reflections differ in path by 2·n·d·cos(θ inside), and one of them is flipped (it reflects
 * off denser water), so the film is brightest where that path is an odd half-wavelength:
 * sin²(2π·n·d·cosθt / λ). Mirrored in bubbles.wgsl.
 */
export function filmColour(thickness: number, cosIn = 1): [number, number, number] {
  const sinIn2 = 1 - cosIn * cosIn
  const cosT = Math.sqrt(Math.max(0, 1 - sinIn2 / (FILM_N * FILM_N)))
  return WAVELENGTHS.map((l) => Math.sin((2 * Math.PI * FILM_N * thickness * cosT) / l) ** 2) as [
    number,
    number,
    number,
  ]
}

export type Bubble = {
  x: number
  y: number
  r: number
  vx: number
  vy: number
  /** the film's thickness at its top, in nm: it drains thinner as the bubble ages */
  film: number
  seed: number
  /** 0 while whole; counts up to 1 as it bursts */
  popping: number
  /** held on a finger, growing */
  held: boolean
}

/** how fast a held bubble grows, in px a second, and how big it may get */
export const GROW = 60
export const MAX_R = 140
export const MIN_R = 12
/**
 * Soap films drain, nanometres a second, until they are thin enough to break. ⚠️ 12nm, not 25 as
 * first written: a 25nm film still throws back a fifth of the blue light — darkening, not the black
 * a bubble goes just before it bursts. Real "black film" is 5–15nm, and at 12 every colour is under
 * 5% (bubbles.test.ts).
 */
export const DRAIN = 22
export const BREAK_AT = 12
/** how long a pop takes, seconds */
export const POP_TIME = 0.25

/** a fresh bubble on a finger */
export const blow = (x: number, y: number, seed: number): Bubble => ({
  x,
  y,
  r: MIN_R,
  vx: 0,
  vy: 0,
  film: 900 + (seed % 7) * 60,
  seed,
  popping: 0,
  held: true,
})

/**
 * One step for every bubble: held ones grow on their finger; free ones drift — buoyed gently up,
 * slowed by the air, nudged apart where they touch, bounced off the edges — and their films drain
 * until they break by themselves. Popping ones finish popping and are gone.
 */
export function stepBubbles(list: readonly Bubble[], dt: number, w: number, h: number): Bubble[] {
  const next = list.map((b) => ({ ...b }))
  for (const b of next) {
    if (b.popping > 0) {
      b.popping += dt / POP_TIME
      continue
    }
    if (b.held) {
      b.r = Math.min(MAX_R, b.r + GROW * dt)
      continue
    }
    b.film -= DRAIN * dt
    if (b.film <= BREAK_AT) b.popping = 1e-6
    // a breath of air rising, and the air's drag
    b.vy -= 18 * dt
    const drag = Math.exp(-0.9 * dt)
    b.vx *= drag
    b.vy *= drag
    b.x += b.vx * dt
    b.y += b.vy * dt
    // the walls give them back, softly
    if (b.x < b.r) {
      b.x = b.r
      b.vx = Math.abs(b.vx) * 0.6
    }
    if (b.x > w - b.r) {
      b.x = w - b.r
      b.vx = -Math.abs(b.vx) * 0.6
    }
    if (b.y < b.r) {
      b.y = b.r
      b.vy = Math.abs(b.vy) * 0.6
    }
    if (b.y > h - b.r) {
      b.y = h - b.r
      b.vy = -Math.abs(b.vy) * 0.6
    }
  }
  // bubbles that touch push gently apart, each by half the overlap
  for (let i = 0; i < next.length; i++)
    for (let j = i + 1; j < next.length; j++) {
      const a = next[i]
      const c = next[j]
      if (a.popping || c.popping || a.held || c.held) continue
      const dx = c.x - a.x
      const dy = c.y - a.y
      const d = Math.hypot(dx, dy) || 1e-6
      const over = a.r + c.r - d
      if (over <= 0) continue
      const ux = dx / d
      const uy = dy / d
      a.x -= ux * over * 0.5
      a.y -= uy * over * 0.5
      c.x += ux * over * 0.5
      c.y += uy * over * 0.5
    }
  return next.filter((b) => b.popping < 1)
}

/** the bubble a tap lands on — the smallest, as it sits in front — or -1 */
export function hit(list: readonly Bubble[], x: number, y: number): number {
  let best = -1
  for (let i = 0; i < list.length; i++) {
    const b = list[i]
    if (b.popping || Math.hypot(x - b.x, y - b.y) > b.r) continue
    if (best < 0 || b.r < list[best].r) best = i
  }
  return best
}

/** a finger's velocity from its recent positions, px a second: what a released bubble flies off with */
export function flingOf(trail: readonly { x: number; y: number; t: number }[]): [number, number] {
  if (trail.length < 2) return [0, 0]
  const a = trail[0]
  const b = trail[trail.length - 1]
  const dt = Math.max(0.016, (b.t - a.t) / 1000)
  return [((b.x - a.x) / dt) * 0.8, ((b.y - a.y) / dt) * 0.8]
}

/** the note a pop plays: big bubbles low, small ones high, on a pentatonic scale */
export function popNote(r: number): number {
  const steps = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21]
  const k = Math.round((1 - (r - MIN_R) / (MAX_R - MIN_R)) * (steps.length - 1))
  return 60 + steps[Math.max(0, Math.min(steps.length - 1, k))]
}

export function packBubbles(list: readonly Bubble[]): Float32Array<ArrayBuffer> {
  const f = new Float32Array(MAX_BUBBLES * BUBBLE_FLOATS)
  list
    .slice(0, MAX_BUBBLES)
    .forEach((b, i) =>
      f.set([b.x, b.y, b.r, b.seed, b.film, b.popping, b.held ? 1 : 0, 0], i * BUBBLE_FLOATS),
    )
  return f
}

export function packFrame(
  w: number,
  h: number,
  count: number,
  time: number,
  into = new ArrayBuffer(BUBBLES.bytes),
) {
  const u = new Uint32Array(into)
  const f = new Float32Array(into)
  u[0] = w
  u[1] = h
  u[BUBBLES.count / 4] = count
  f[BUBBLES.time / 4] = time
  return into
}
