/**
 * The arithmetic of the Lab's rainy window: drops that cling to the glass until they are heavy
 * enough to run, run in fits and starts, leave a trail of droplets, and swallow the drops they meet.
 *
 * ⚠️ THE DROPS ARE A FEW HUNDRED, SO THEY LIVE HERE; WHAT THEY DO TO THE PICTURE IS THE GPU'S. Each
 * frame the drops are drawn into a HEIGHT MAP — each a little dome of water — and every pixel of the
 * window rebuilds the water's surface from that map, bends its view of the street behind through it
 * (screen-space refraction: a drop shows a sharp, upside-down-ish piece of the blurred view), and
 * keeps or wipes the MIST, a texture that remembers where a finger or a running drop has cleared it
 * and fogs back over slowly. `stepDrops` is the drops' physics, which rain.test.ts holds to keeping
 * the water: a merge or a trail never makes or loses any.
 */

/** Hand-packed to match `struct Pane` — rain.test.ts lays the struct out from the shader. */
export const PANE = {
  size: 0,
  fall: 8,
  drops: 16,
  wipes: 20,
  dt: 24,
  regrow: 28,
  breath: 32,
  brush: 36,
  bytes: 40,
} as const

export type Drop = {
  x: number
  y: number
  r: number
  vx: number
  vy: number
  /** px run since it last left a droplet */
  run: number
  id: number
}

/** a drop smaller than this (px) clings, whatever the tilt */
export const CLING = 7
/** the most drops there may be */
export const MAX_DROPS = 600
/** px a running drop moves for each droplet it leaves behind */
export const TRAIL_EVERY = 9
/** how big those droplets are, as a fraction of the drop that left them */
export const TRAIL_SIZE = 0.22

/** water: a drop's area stands for its volume, and is what merges and trails keep */
export const water = (drops: readonly Drop[]) => drops.reduce((s, d) => s + d.r * d.r, 0)

/**
 * One step: drops heavy enough slide along gravity, slowed by the glass and caught now and then
 * (`rand` decides when); a running drop leaves droplets behind it, paid for out of its own water;
 * drops that overlap become one, keeping their water; drops off the glass are gone. `g` in px a
 * second², `rand` 0..1.
 */
export function stepDrops(
  drops: Drop[],
  g: readonly [number, number],
  dt: number,
  w: number,
  h: number,
  rand: () => number,
  nextId: () => number,
): Drop[] {
  const out: Drop[] = []
  const gl = Math.hypot(g[0], g[1])
  for (const d of drops) {
    const next = { ...d }
    if (d.r > CLING && gl > 0) {
      // the heavier, the more of gravity gets past the glass's grip; and sometimes it catches
      const pull = (1 - CLING / d.r) * (rand() < 0.08 ? 0.1 : 1)
      next.vx = (d.vx + g[0] * pull * dt) * Math.exp(-3 * dt)
      next.vy = (d.vy + g[1] * pull * dt) * Math.exp(-3 * dt)
    } else {
      next.vx = 0
      next.vy = 0
    }
    next.x += next.vx * dt
    next.y += next.vy * dt
    out.push(next)
    /* a trail: a droplet every TRAIL_EVERY px it runs, its water taken from the drop, left just
       behind it — far enough back that the drop does not swallow it straight back up */
    const speed = Math.hypot(next.vx, next.vy)
    next.run = d.run + speed * dt
    while (next.run >= TRAIL_EVERY && next.r > CLING) {
      next.run -= TRAIL_EVERY
      const r = next.r * TRAIL_SIZE
      next.r = Math.sqrt(next.r * next.r - r * r)
      const back = ((next.r + r) * 0.85) / speed
      out.push({
        x: next.x - next.vx * back,
        y: next.y - next.vy * back,
        r,
        vx: 0,
        vy: 0,
        run: 0,
        id: nextId(),
      })
    }
  }
  // merging: any two that overlap become one, the bigger swallowing the smaller
  out.sort((a, b) => b.r - a.r)
  const alive = out.map(() => true)
  for (let i = 0; i < out.length; i++) {
    if (!alive[i]) continue
    const a = out[i]
    for (let j = i + 1; j < out.length; j++) {
      if (!alive[j]) continue
      const b = out[j]
      const reach = (a.r + b.r) * 0.8
      if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 > reach * reach) continue
      const wa = a.r * a.r
      const wb = b.r * b.r
      a.x = (a.x * wa + b.x * wb) / (wa + wb)
      a.y = (a.y * wa + b.y * wb) / (wa + wb)
      a.vx = (a.vx * wa + b.vx * wb) / (wa + wb)
      a.vy = (a.vy * wa + b.vy * wb) / (wa + wb)
      a.r = Math.sqrt(wa + wb)
      alive[j] = false
    }
  }
  return out
    .filter((d, i) => alive[i] && d.x > -d.r && d.x < w + d.r && d.y > -d.r && d.y < h + d.r)
    .slice(0, MAX_DROPS)
}

/** rain: a new drop somewhere, mostly small, now and then a big one */
export function raindrop(w: number, h: number, rand: () => number, id: number): Drop {
  const r = 1.2 + rand() ** 4 * 8.5
  return { x: rand() * w, y: rand() * h, r, vx: 0, vy: 0, run: 0, id }
}

/** px a second at which a running drop has its whole tail */
export const STREAK = 160

/**
 * The drops for the shader, in the canvas's pixels (`scale` of them to a CSS px): where, how big,
 * and how far its tail trails behind it, 0..1 of the way to a full one.
 */
export function packDrops(drops: readonly Drop[], scale = 1): Float32Array<ArrayBuffer> {
  const f = new Float32Array(MAX_DROPS * 4)
  drops
    .slice(0, MAX_DROPS)
    .forEach((d, i) =>
      f.set(
        [d.x * scale, d.y * scale, d.r * scale, Math.min(1, Math.hypot(d.vx, d.vy) / STREAK)],
        i * 4,
      ),
    )
  return f
}

export type PaneParams = {
  w: number
  h: number
  /** which way is down, a unit vector, for the drops' tails */
  fall: readonly [number, number]
  drops: number
  wipes: number
  dt: number
  /** how much of the glass fogs back over in a second */
  regrow: number
  /** 0..1, how hard somebody is breathing on it */
  breath: number
  /** a finger's half-width, in canvas px */
  brush: number
}

export function packPane(p: PaneParams, into = new ArrayBuffer(PANE.bytes)) {
  const u = new Uint32Array(into)
  const f = new Float32Array(into)
  u[0] = p.w
  u[1] = p.h
  f.set(p.fall, PANE.fall / 4)
  u[PANE.drops / 4] = p.drops
  u[PANE.wipes / 4] = p.wipes
  f[PANE.dt / 4] = p.dt
  f[PANE.regrow / 4] = p.regrow
  f[PANE.breath / 4] = p.breath
  f[PANE.brush / 4] = p.brush
  return into
}

/** distance from p to the segment a–b */
export function toSegment(
  p: readonly [number, number],
  a: readonly [number, number],
  b: readonly [number, number],
) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const l = dx * dx + dy * dy
  const t = l > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}

export type Wipe = readonly [number, number, number, number]

/** a finger across the glass takes every drop it touches with it */
export function wipeDrops(drops: readonly Drop[], wipes: readonly Wipe[], brush: number): Drop[] {
  return drops.filter(
    (d) =>
      !wipes.some((w) => toSegment([d.x, d.y], [w[0], w[1]], [w[2], w[3]]) < brush + d.r * 0.5),
  )
}

/**
 * How hard somebody is breathing on the glass, from the mic's loudness: a breath is a long, steady
 * rush rather than a click, so it rises slowly (a tap on the table does not fog the window) and
 * falls a little faster. Below `floor` is the room, not a breath.
 */
export function breathFrom(level: number, was: number, dt: number, floor = 0.12): number {
  const want = Math.max(0, Math.min(1, ((level - floor) / (1 - floor)) * 2.5))
  const rate = want > was ? 2.2 : 4
  return was + (want - was) * (1 - Math.exp(-rate * dt))
}

/**
 * The street behind the glass, painted in code: a city at dusk, its windows and street lights the
 * points of light the rain makes into blurred discs.
 */
export function paintStreet(w: number, h: number): OffscreenCanvas {
  const c = new OffscreenCanvas(w, h)
  const g = c.getContext('2d')
  if (!g) return c
  const sky = g.createLinearGradient(0, 0, 0, h)
  sky.addColorStop(0, '#1c2140')
  sky.addColorStop(0.55, '#5a3b5e')
  sky.addColorStop(0.75, '#c7735a')
  sky.addColorStop(1, '#2a2230')
  g.fillStyle = sky
  g.fillRect(0, 0, w, h)
  let s = 11
  const rand = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296
  /* windows and lamps are sized by the picture's height, so a bigger canvas is the same street */
  const u = h / 400
  // buildings, far then near, with lit windows
  for (const [base, tone, scale] of [
    [0.72, '#2b2438', 0.6],
    [0.86, '#15121e', 1],
  ] as const) {
    let x = 0
    while (x < w) {
      const bw = (0.05 + rand() * 0.07) * w * scale
      const bh = (0.15 + rand() * 0.35) * h * scale
      g.fillStyle = tone
      g.fillRect(x, h * base - bh, bw, bh + h)
      for (let wy = h * base - bh + 6 * u; wy < h * base - 4 * u; wy += 9 * u * scale)
        for (let wx = x + 4 * u; wx < x + bw - 6 * u; wx += 8 * u * scale)
          if (rand() < 0.45) {
            g.fillStyle = rand() < 0.8 ? '#ffd27a' : '#9fd8ff'
            g.fillRect(wx, wy, 3 * u * scale, 4 * u * scale)
          }
      x += bw + 2 * u
    }
  }
  // street lights and car lights along the bottom
  for (let k = 0; k < 18; k++) {
    const x = rand() * w
    const y = h * (0.88 + rand() * 0.1)
    const r = 14 * u
    const glow = g.createRadialGradient(x, y, 0, x, y, r)
    const warm = rand() < 0.6
    glow.addColorStop(0, warm ? 'rgba(255,200,120,1)' : 'rgba(255,60,60,1)')
    glow.addColorStop(1, 'rgba(255,160,80,0)')
    g.fillStyle = glow
    g.fillRect(x - r, y - r, 2 * r, 2 * r)
  }
  return c
}

/** the same street out of focus, as mist and distance make it */
export function blurStreet(sharp: OffscreenCanvas, px: number): OffscreenCanvas {
  const c = new OffscreenCanvas(sharp.width, sharp.height)
  const g = c.getContext('2d')
  if (!g) return c
  g.filter = `blur(${px}px)`
  g.drawImage(sharp, 0, 0)
  return c
}
