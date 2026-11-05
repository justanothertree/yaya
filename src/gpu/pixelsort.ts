/**
 * The arithmetic of the Lab's pixel sorter: a photo whose pixels you sort by brightness along a
 * direction you swipe, so it melts into streaks — the glitch-art effect, done by a real sorting
 * network on the GPU.
 *
 * ⚠️ IT SORTS ONLY WITHIN SPANS, AND THE SPANS ARE IN THE KEY. Classic pixel sorting does not sort
 * a whole row: it sorts each run of pixels that are bright enough (and inside the stroke), leaving
 * the rest where they are — which is what keeps the picture recognisable. A sorting network cannot
 * stop at span edges, so each pixel's key carries its span in the top bits:
 *   key = span · 2²⁰ + brightness · 2¹⁰ + where it was
 * Sorting whole rows by that key sorts every span within itself and never moves a pixel out of its
 * span (a lower span always sorts first). A pixel outside every span is a span of one, and stays
 * put. The low bits make every key different, so the sort is stable and says where each pixel came
 * from — the output is a GATHER: pixel i shows whichever pixel's key ended up at i.
 *
 * ⚠️ AND THE SORT IS A BITONIC NETWORK, RUN A STAGE AT A TIME. For a row of 2ᵏ keys it is a fixed
 * list of k(k+1)/2 compare-and-swap stages (see `compareExchange` for which bitonic network),
 * each one pairing every key with exactly one partner —
 * so a stage is one dispatch with no two threads touching the same key. The page runs a few
 * stages a frame, and the pixels can be seen streaming into place. `stages` and `compareExchange`
 * are the network as the shader runs it; pixelsort.test.ts sorts with them and checks the answer
 * against an ordinary sort.
 */

/** Hand-packed to match `struct Sort` — pixelsort.test.ts lays the struct out from the shader. */
export const SORT = {
  size: 0,
  image: 8,
  lineLen: 16,
  lines: 20,
  axis: 24,
  flip: 28,
  lo: 32,
  hi: 36,
  by: 40,
  dabs: 44,
  show: 48,
  bytes: 56,
} as const

/** every line is padded to this many keys: the longest side the photo is fitted to */
export const LINE = 1024
export const IDX_BITS = 10
export const KEY_BITS = 10
/** a padding key: sorts after every real one, and is never shown */
export const PAD = 0xffffffff

export const BY = { light: 'Brightness', hue: 'Hue', warmth: 'Warmth' } as const
export type By = keyof typeof BY
export const BY_ID: Record<By, number> = { light: 0, hue: 1, warmth: 2 }

/** what a pixel is sorted by, 0..1 — mirrored in pixelsort.wgsl */
export function measure(r: number, g: number, b: number, by: By): number {
  if (by === 'light') return 0.2126 * r + 0.7152 * g + 0.0722 * b
  if (by === 'warmth') return Math.min(1, Math.max(0, 0.5 + (r - b) * 0.5))
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max === min) return 0
  const d = max - min
  const h =
    max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return h / 6
}

/** the 10-bit level a measure is sorted at */
export const level = (m: number) => Math.min(1023, Math.max(0, Math.floor(m * 1024)))

/**
 * The keys of one line: `values` its pixels' measures (0..1) in order along the sort, `inside`
 * whether each is in the stroke. A pixel joins a span when it is inside and its measure is in
 * lo..hi; any other pixel ends the span it interrupts and is a span of its own.
 */
export function keysOf(
  values: ArrayLike<number>,
  inside: ArrayLike<boolean>,
  lo: number,
  hi: number,
  length = LINE,
): Uint32Array {
  const keys = new Uint32Array(length).fill(PAD)
  let span = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    const joins = inside[i] && v >= lo && v <= hi
    const joinedBefore = i > 0 && inside[i - 1] && values[i - 1] >= lo && values[i - 1] <= hi
    // a new span begins at every pixel that cannot continue the one before it
    if (i > 0 && !(joins && joinedBefore)) span++
    keys[i] = ((span << (KEY_BITS + IDX_BITS)) | (level(v) << IDX_BITS) | i) >>> 0
  }
  return keys
}

/** the stages of a bitonic sort of n keys, as (k, j) pairs, in the order they run */
export function stages(n: number): [number, number][] {
  const out: [number, number][] = []
  for (let k = 2; k <= n; k *= 2) for (let j = k / 2; j >= 1; j /= 2) out.push([k, j])
  return out
}

/**
 * One stage over one line — mirrored in pixelsort.wgsl. ⚠️ The textbook bitonic network sorts
 * alternate blocks DOWNWARDS until the last merge, so half-way through, half of every column of the
 * picture was upside down and it flickered in flipped bands rather than melting. This is the
 * variant whose first stage of each merge compares MIRRORED pairs (i with the key as far from the
 * block's other end), which leaves every block sorted the same way after every level: the picture
 * is first sorted in runs of two, then four, … then whole lines — a melt you can watch.
 */
export function compareExchange(keys: Uint32Array, k: number, j: number) {
  for (let i = 0; i < keys.length; i++) {
    const p = j === k / 2 ? i ^ (k - 1) : i ^ j
    if (p <= i) continue
    if (keys[i] > keys[p]) {
      const t = keys[i]
      keys[i] = keys[p]
      keys[p] = t
    }
  }
}

/** where the pixel shown at each place came from */
export const sourceOf = (key: number) => key & ((1 << IDX_BITS) - 1)

export const DIRECTIONS = { right: '→', left: '←', down: '↓', up: '↑' } as const
export type Direction = keyof typeof DIRECTIONS

/** the direction a swipe means: whichever way it went furthest, if it went far enough */
export function directionOf(dx: number, dy: number, least = 20): Direction | null {
  if (Math.hypot(dx, dy) < least) return null
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left'
  return dy > 0 ? 'down' : 'up'
}

/** how a direction is sorted: along rows (axis 0) or columns (1), and reversed or not */
export const AXIS: Record<Direction, { axis: number; flip: boolean }> = {
  right: { axis: 0, flip: false },
  left: { axis: 0, flip: true },
  down: { axis: 1, flip: false },
  up: { axis: 1, flip: true },
}

/**
 * Which pixels are sorted: those whose measure is in this range (and inside the stroke). Chosen by
 * sorting the starting picture every way with each (the sweep is in docs/LAB-HANDOFF.md): Gentle
 * only moves the bright clouds a little; Glitch is the classic pixel-sort look, the sky breaking
 * into streaks while the dark city holds its shape; Everything sorts every pixel and leaves
 * stripes. (Not called Melt: it sat beside ✨ Melt it all, and the two read as one button.)
 */
export const SPANS = {
  gentle: { name: 'Gentle', range: [0.45, 1] },
  glitch: { name: 'Glitch', range: [0.2, 0.85] },
  everything: { name: 'Everything', range: [0, 1] },
} as const satisfies Record<string, { name: string; range: readonly [number, number] }>
export type Spans = keyof typeof SPANS

/**
 * The picture it starts with: a sunset over the sea behind mountains, painted rather than loaded,
 * so the toy works with no photo and no network. Lots of runs of bright pixels against dark ones,
 * which is what sorting makes something of.
 */
export function paintScene(w: number, h: number): OffscreenCanvas {
  const c = new OffscreenCanvas(w, h)
  const g = c.getContext('2d')
  if (!g) return c
  const horizon = h * 0.62
  const sky = g.createLinearGradient(0, 0, 0, horizon)
  sky.addColorStop(0, '#1b1446')
  sky.addColorStop(0.45, '#7b2d6b')
  sky.addColorStop(0.8, '#f0743e')
  sky.addColorStop(1, '#ffd36e')
  g.fillStyle = sky
  g.fillRect(0, 0, w, horizon)
  // the sun, and its glow
  const sun = g.createRadialGradient(
    w * 0.62,
    horizon - h * 0.05,
    0,
    w * 0.62,
    horizon - h * 0.05,
    h * 0.3,
  )
  sun.addColorStop(0, 'rgba(255,250,215,1)')
  sun.addColorStop(0.18, 'rgba(255,230,150,0.95)')
  sun.addColorStop(0.19, 'rgba(255,190,110,0.5)')
  sun.addColorStop(1, 'rgba(255,140,90,0)')
  g.fillStyle = sun
  g.fillRect(0, 0, w, horizon)
  // a few stars in the dark top
  for (let i = 0; i < 70; i++) {
    const x = ((i * 7919) % 1000) / 1000
    const y = ((i * 104729) % 1000) / 1000
    g.fillStyle = `rgba(255,255,240,${0.3 + 0.7 * (((i * 31) % 10) / 10)})`
    g.fillRect(x * w, y * h * 0.3, 2, 2)
  }
  // clouds lit from below by the sun: bright undersides with dark gaps between, which is what a
  // sort turns into streaks
  for (let i = 0; i < 26; i++) {
    const x = (((i * 7919) % 997) / 997) * w
    const y = h * (0.12 + 0.32 * (((i * 104729) % 991) / 991))
    const cw = w * (0.08 + 0.12 * (((i * 31) % 17) / 17))
    const lit = g.createLinearGradient(0, y - h * 0.03, 0, y + h * 0.02)
    lit.addColorStop(0, 'rgba(60,30,80,0.9)')
    lit.addColorStop(0.7, 'rgba(255,150,120,0.95)')
    lit.addColorStop(1, 'rgba(255,215,150,1)')
    g.fillStyle = lit
    g.beginPath()
    g.ellipse(x, y, cw, h * 0.022, 0, 0, Math.PI * 2)
    g.fill()
  }
  // mountains, three ridges, darker as they come nearer
  const ridges: [string, number, number][] = [
    ['#5a2d5e', 0.5, 3.1],
    ['#3a1f48', 0.56, 5.3],
    ['#1c1230', 0.6, 8.7],
  ]
  for (const [colour, base, f] of ridges) {
    g.fillStyle = colour
    g.beginPath()
    g.moveTo(0, horizon)
    for (let x = 0; x <= w; x += 4) {
      const t = x / w
      const y =
        h * (base - 0.08 * Math.abs(Math.sin(t * f + base * 9)) - 0.04 * Math.sin(t * f * 3.7))
      g.lineTo(x, y)
    }
    g.lineTo(w, horizon)
    g.closePath()
    g.fill()
  }
  // the sea, with the sun's road on it in broken bright stripes
  const sea = g.createLinearGradient(0, horizon, 0, h)
  sea.addColorStop(0, '#2b1f4e')
  sea.addColorStop(1, '#0b0a1c')
  g.fillStyle = sea
  g.fillRect(0, horizon, w, h - horizon)
  for (let y = horizon + 2; y < h; y += 5) {
    const d = (y - horizon) / (h - horizon)
    const half = w * (0.03 + 0.18 * d)
    for (let k = 0; k < 6; k++) {
      const x = w * 0.62 + (Math.sin(y * 0.37 + k * 2.1) * 0.9 - 0.45) * half * 1.4
      g.fillStyle = `rgba(255,${200 - d * 60},${120 - d * 50},${0.85 - d * 0.5})`
      g.fillRect(x, y, half * (0.2 + 0.15 * Math.sin(k + y)), 2)
    }
  }
  // a city on the near shore, its windows lit, and their lights on the water
  let x = 0
  let n = 0
  while (x < w * 0.42) {
    const bw = w * (0.025 + 0.03 * (((n * 37) % 11) / 11))
    const bh = h * (0.06 + 0.16 * (((n * 53) % 13) / 13))
    const top = horizon - bh
    g.fillStyle = '#0d0a1a'
    g.fillRect(x, top, bw, bh)
    for (let wy = top + 4; wy < horizon - 4; wy += 7)
      for (let wx = x + 3; wx < x + bw - 4; wx += 6)
        if (((wx * 13 + wy * 7 + n) | 0) % 3 !== 0) {
          g.fillStyle = ((wx + wy) | 0) % 5 === 0 ? '#8fd3ff' : '#ffcf6b'
          g.fillRect(wx, wy, 3, 4)
          g.fillStyle = 'rgba(255,200,110,0.35)'
          g.fillRect(wx, horizon + (horizon - wy) * 0.35, 3, 2)
        }
    x += bw + 2
    n++
  }
  return c
}
