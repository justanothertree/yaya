/**
 * Fireworks: design shells — the shape of the burst, two colours, size, height, a trail, a crackle —
 * then set them off over a skyline in a show of your own, and send the show to somebody as a link.
 * Pure, so fireworks.test.ts can ask what a burst looks like and round-trip a show without a page;
 * FireworksDemo draws it on a 2D canvas, so it works on any device that has a browser.
 *
 * ⚠️ A SHOW REPLAYS THE SAME EVERY TIME. Each cue carries its own seed, and every spark of its
 * burst comes from that seed — so the show you made is the show your friend sees, spark for spark,
 * and the test can count a burst's sparks and measure its spread.
 */

import { rng as seeded } from './bricks'

export const PATTERNS = [
  'peony',
  'ring',
  'willow',
  'palm',
  'crossette',
  'heart',
  'spiral',
  'strobe',
] as const
export type Pattern = (typeof PATTERNS)[number]
export const PATTERN_NAMES: Record<Pattern, string> = {
  peony: 'Peony',
  ring: 'Ring',
  willow: 'Willow',
  palm: 'Palm',
  crossette: 'Crossette',
  heart: 'Heart',
  spiral: 'Spiral',
  strobe: 'Strobe',
}

/** twelve colours a shell can be; the last is every colour at once */
export const COLOURS = [
  { name: 'Red', rgb: [255, 70, 70] },
  { name: 'Orange', rgb: [255, 150, 50] },
  { name: 'Gold', rgb: [255, 205, 90] },
  { name: 'Lime', rgb: [170, 255, 80] },
  { name: 'Green', rgb: [60, 230, 120] },
  { name: 'Cyan', rgb: [80, 230, 255] },
  { name: 'Blue', rgb: [90, 130, 255] },
  { name: 'Violet', rgb: [190, 110, 255] },
  { name: 'Pink', rgb: [255, 120, 210] },
  { name: 'White', rgb: [255, 255, 255] },
  { name: 'Silver', rgb: [200, 210, 230] },
  { name: 'Rainbow', rgb: [255, 255, 255] },
] as const
export const RAINBOW = COLOURS.length - 1

export type Shell = {
  pattern: Pattern
  /** two colours: the burst is the first, the tips or the second wave the other */
  colours: [number, number]
  /** 0 small, 1 medium, 2 large */
  size: 0 | 1 | 2
  /** how high it bursts, 0 the lowest and 1 the highest */
  height: number
  trail: boolean
  crackle: boolean
}

export type Cue = { at: number; x: number; shell: Shell; seed: number }
export type Show = { cues: Cue[]; scene: Scene }
export const SCENES = ['city', 'hills', 'lake'] as const
export type Scene = (typeof SCENES)[number]

export const MAX_CUES = 80
export const MAX_SECONDS = 90

export const DEFAULT_SHELL: Shell = {
  pattern: 'peony',
  colours: [0, 2],
  size: 1,
  height: 0.7,
  trail: true,
  crackle: false,
}

/** a seeded random source */
export { seeded }

/* ---------------------------------------------------------------------------- flight and burst */

/** the sky is 1 wide and 1 tall, y up from the ground; a shell rises for this long */
export const RISE = 1.1
export const G = 0.32
/** where a shell bursts */
export const apex = (s: Shell) => 0.38 + s.height * 0.45
/** how far its stars fly, in sky widths, by size */
export const SPREAD = [0.11, 0.17, 0.24]

export type Spark = {
  /** start position and velocity at the burst, in sky units and sky units a second */
  x: number
  y: number
  vx: number
  vy: number
  /** seconds it lives */
  life: number
  /** how fast the air slows it */
  drag: number
  colour: number
  /** blinks on and off */
  strobe: boolean
  /** splits into four at 60% of its life (crossette) */
  splits: boolean
  /** leaves a long glowing tail (willow, palm) */
  tail: number
}

/** a random direction on a sphere, seen from the side: the burst looks round, denser at the edge */
function sphere(rand: () => number): [number, number] {
  const z = rand() * 2 - 1
  const a = rand() * Math.PI * 2
  const r = Math.sqrt(1 - z * z)
  return [r * Math.cos(a), r * Math.sin(a)]
}

/** every spark a shell bursts into, at (x, y): the same for the same seed */
export function burst(shell: Shell, x: number, y: number, seed: number): Spark[] {
  const rand = seeded(seed)
  const spread = SPREAD[shell.size]
  const n = [70, 110, 160][shell.size]
  const out: Spark[] = []
  const add = (dx: number, dy: number, speed: number, i: number, extra: Partial<Spark> = {}) =>
    out.push({
      x,
      y,
      vx: dx * speed,
      vy: dy * speed,
      life: 1.6 + rand() * 0.5,
      drag: 1.6,
      colour: shell.colours[i % 7 === 0 ? 1 : 0],
      strobe: false,
      splits: false,
      tail: shell.trail ? 0.35 : 0,
      ...extra,
    })
  // with drag k a star coasts v / k before the air stops it, so v = spread × k puts a peony's
  // stars at `spread` from the centre
  const v = spread * 1.6
  switch (shell.pattern) {
    case 'peony':
    case 'strobe':
      for (let i = 0; i < n; i++) {
        const [dx, dy] = sphere(rand)
        add(dx, dy, v * (0.92 + rand() * 0.16), i, { strobe: shell.pattern === 'strobe' })
      }
      break
    case 'ring': {
      // a ring in a tilted plane: an ellipse, turned
      const tilt = 0.25 + rand() * 0.75
      const turn = rand() * Math.PI
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2
        const ex = Math.cos(a)
        const ey = Math.sin(a) * tilt
        add(
          ex * Math.cos(turn) - ey * Math.sin(turn),
          ex * Math.sin(turn) + ey * Math.cos(turn),
          v,
          i,
        )
      }
      break
    }
    case 'willow':
      for (let i = 0; i < n; i++) {
        const [dx, dy] = sphere(rand)
        add(dx, dy, v * 0.8, i, { life: 3.4 + rand() * 0.8, drag: 2.6, tail: 0.9 })
      }
      break
    case 'palm': {
      const arms = 7
      for (let i = 0; i < n; i++) {
        const k = i % arms
        const a = (k / arms) * Math.PI * 2 + 0.3
        const s = 0.6 + (Math.floor(i / arms) / Math.ceil(n / arms)) * 0.5
        add(Math.cos(a), Math.sin(a) * 0.85 + 0.15, v * s * (0.9 + rand() * 0.2), i, {
          life: 2.2 + rand() * 0.5,
          drag: 1.3,
          tail: 0.75,
        })
      }
      break
    }
    case 'crossette':
      {
        const turn = rand() * Math.PI
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2 + turn
          add(Math.cos(a), Math.sin(a), v * 0.75, i, {
            splits: true,
            life: 1.3 + rand() * 0.2,
            tail: 0.5,
          })
        }
      }
      break
    case 'heart':
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2
        const hx = 16 * Math.sin(t) ** 3
        const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
        add(hx / 17, hy / 17, v, i)
      }
      break
    case 'spiral':
      for (let i = 0; i < n; i++) {
        const arm = i % 2
        const f = Math.floor(i / 2) / (n / 2)
        const a = f * Math.PI * 3 + arm * Math.PI
        add(Math.cos(a), Math.sin(a), v * (0.3 + f * 0.75), i)
      }
      break
  }
  if (shell.crackle) for (const s of out) s.life += 0.4
  return out
}

/** where a spark is t seconds after its burst: drag slows it, gravity pulls it down */
export function sparkAt(s: Spark, t: number): [number, number] {
  // with linear drag k, distance flown is v (1 - e^-kt) / k; gravity sags it as it slows
  const k = s.drag
  const e = Math.exp(-k * t)
  const flown = (1 - e) / k
  const sag = (G / k) * (t - flown)
  return [s.x + s.vx * flown, s.y + s.vy * flown - sag]
}

/** the stars a crossette spark splits into */
export function splitOf(s: Spark, seed: number): Spark[] {
  const rand = seeded(seed)
  const at = s.life * 0.6
  const [x, y] = sparkAt(s, at)
  const out: Spark[] = []
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + rand() * 0.6
    out.push({
      ...s,
      x,
      y,
      vx: Math.cos(a) * 0.12,
      vy: Math.sin(a) * 0.12,
      life: 0.9,
      splits: false,
    })
  }
  return out
}

/** where a rising shell is t seconds after launch from x, until it bursts at RISE */
export function riseAt(cue: Cue, t: number): [number, number] {
  const f = Math.min(1, t / RISE)
  // eases out as it slows towards the top, with a small wobble
  const y = apex(cue.shell) * (1 - (1 - f) * (1 - f))
  return [cue.x + Math.sin(t * 14 + cue.seed) * 0.003, y]
}

/** how long a show runs: its last burst, and time for the sky to clear */
export const lengthOf = (show: Show) =>
  show.cues.length ? Math.max(...show.cues.map((c) => c.at)) + RISE + 4 : 0

/* ---------------------------------------------------------------------------- sharing */

/**
 * A show as a short string for a link: a version letter, the scene, then six bytes a cue —
 * time in tenths of a second (2), x (1), pattern and size (1), both colours (1), height and the
 * two switches (1). Seeds are not sent: each is made from the cue's own bytes and position, so a
 * show encodes to the same text every time and decodes to the same sparks.
 */
export function encode(show: Show): string {
  const cues = [...show.cues].sort((a, b) => a.at - b.at).slice(0, MAX_CUES)
  const bytes = new Uint8Array(2 + cues.length * 6)
  bytes[0] = 1
  bytes[1] = SCENES.indexOf(show.scene)
  cues.forEach((c, i) => {
    const o = 2 + i * 6
    const t = Math.round(Math.min(MAX_SECONDS, Math.max(0, c.at)) * 10)
    bytes[o] = t >> 8
    bytes[o + 1] = t & 255
    bytes[o + 2] = Math.round(Math.min(1, Math.max(0, c.x)) * 255)
    bytes[o + 3] = (PATTERNS.indexOf(c.shell.pattern) << 2) | c.shell.size
    bytes[o + 4] = (c.shell.colours[0] << 4) | c.shell.colours[1]
    bytes[o + 5] =
      (Math.round(Math.min(1, Math.max(0, c.shell.height)) * 63) << 2) |
      (c.shell.trail ? 2 : 0) |
      (c.shell.crackle ? 1 : 0)
  })
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** the seed a cue gets from what it is, so the same show always bursts the same */
export const seedOf = (i: number, bytes: number[]) =>
  bytes.reduce((h, b) => Math.imul(h ^ b, 0x01000193) >>> 0, 0x811c9dc5 ^ i) || 1

/** a show from a link's text, or null — anything malformed is no show at all */
export function decode(text: string): Show | null {
  if (!/^[A-Za-z0-9_-]{4,1000}$/.test(text)) return null
  let bin: string
  try {
    bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  } catch {
    return null
  }
  const b = [...bin].map((c) => c.charCodeAt(0))
  if (b[0] !== 1 || b[1] >= SCENES.length || (b.length - 2) % 6 !== 0) return null
  const n = (b.length - 2) / 6
  if (n > MAX_CUES) return null
  const cues: Cue[] = []
  for (let i = 0; i < n; i++) {
    const o = 2 + i * 6
    const at = ((b[o] << 8) | b[o + 1]) / 10
    const pattern = PATTERNS[b[o + 3] >> 2]
    const size = b[o + 3] & 3
    const c0 = b[o + 4] >> 4
    const c1 = b[o + 4] & 15
    if (at > MAX_SECONDS || !pattern || size > 2 || c0 >= COLOURS.length || c1 >= COLOURS.length)
      return null
    cues.push({
      at,
      x: b[o + 2] / 255,
      seed: seedOf(i, b.slice(o, o + 6)),
      shell: {
        pattern,
        size: size as 0 | 1 | 2,
        colours: [c0, c1],
        height: (b[o + 5] >> 2) / 63,
        trail: (b[o + 5] & 2) !== 0,
        crackle: (b[o + 5] & 1) !== 0,
      },
    })
  }
  return { cues, scene: SCENES[b[1]] }
}

/** a show made fresh, with every cue's seed set the way a decoded one would have it */
export function settle(show: Show): Show {
  return decode(encode(show)) ?? { cues: [], scene: show.scene }
}

/* ---------------------------------------------------------------------------- shows to start from */

const cue = (at: number, x: number, shell: Partial<Shell>): Cue => ({
  at,
  x,
  seed: 1,
  shell: { ...DEFAULT_SHELL, ...shell },
})
const RAW_PRESETS: { name: string; show: Show }[] = [
  {
    name: 'Opening night',
    show: {
      scene: 'city',
      cues: [
        cue(0, 0.3, { pattern: 'peony', colours: [0, 9] }),
        cue(0.8, 0.7, { pattern: 'peony', colours: [6, 9] }),
        cue(1.8, 0.5, { pattern: 'ring', colours: [2, 2], size: 2 }),
        cue(3, 0.25, { pattern: 'palm', colours: [2, 1], height: 0.5 }),
        cue(3, 0.75, { pattern: 'palm', colours: [2, 1], height: 0.5 }),
        cue(4.4, 0.5, { pattern: 'willow', colours: [2, 2], size: 2, height: 0.95 }),
      ],
    },
  },
  {
    name: 'Lake in gold',
    show: {
      scene: 'lake',
      cues: [0, 1, 2, 3, 4, 5].map((i) =>
        cue(i * 0.9, 0.2 + (i % 3) * 0.3, {
          pattern: i % 2 ? 'willow' : 'crossette',
          colours: [2, 9],
          size: 1,
          crackle: i % 2 === 0,
        }),
      ),
    },
  },
  {
    name: 'Grand finale',
    show: {
      scene: 'hills',
      cues: Array.from({ length: 24 }, (_, i) =>
        cue(i < 16 ? i * 0.35 : 5.6 + (i - 16) * 0.12, ((i * 7) % 11) / 10 + 0.05, {
          pattern: PATTERNS[i % PATTERNS.length],
          colours: [i % RAINBOW, (i * 5) % COLOURS.length],
          size: (i % 3) as 0 | 1 | 2,
          height: 0.4 + ((i * 3) % 7) / 10,
          crackle: i >= 16,
        }),
      ),
    },
  },
]
export const PRESETS = RAW_PRESETS.map((p) => ({ ...p, show: settle(p.show) }))

/* ---------------------------------------------------------------------------- what is kept */

export const FIREWORKS_KEY = 'lab_fireworks_v1'
export type Saved = { shell: Shell; show: string; shows: { name: string; show: string }[] }
export const EMPTY: Saved = { shell: DEFAULT_SHELL, show: '', shows: [] }
export const MAX_SAVED = 12
export function readSaved(text: string | null): Saved {
  let v: unknown
  try {
    v = JSON.parse(text ?? 'null')
  } catch {
    return structuredClone(EMPTY)
  }
  const out: Saved = structuredClone(EMPTY)
  if (typeof v !== 'object' || !v || Array.isArray(v)) return out
  const o = v as Record<string, unknown>
  const s = o.shell as Record<string, unknown> | undefined
  if (s && typeof s === 'object') {
    const pattern = PATTERNS.includes(s.pattern as Pattern)
      ? (s.pattern as Pattern)
      : DEFAULT_SHELL.pattern
    const col = (x: unknown, d: number) =>
      typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < COLOURS.length ? x : d
    const colours = Array.isArray(s.colours) ? s.colours : []
    out.shell = {
      pattern,
      colours: [
        col(colours[0], DEFAULT_SHELL.colours[0]),
        col(colours[1], DEFAULT_SHELL.colours[1]),
      ],
      size: s.size === 0 || s.size === 1 || s.size === 2 ? s.size : DEFAULT_SHELL.size,
      height:
        typeof s.height === 'number' && s.height >= 0 && s.height <= 1
          ? s.height
          : DEFAULT_SHELL.height,
      trail: typeof s.trail === 'boolean' ? s.trail : DEFAULT_SHELL.trail,
      crackle: typeof s.crackle === 'boolean' ? s.crackle : DEFAULT_SHELL.crackle,
    }
  }
  if (typeof o.show === 'string' && (o.show === '' || decode(o.show))) out.show = o.show
  if (Array.isArray(o.shows))
    out.shows = o.shows
      .filter(
        (x): x is { name: string; show: string } =>
          !!x &&
          typeof x === 'object' &&
          typeof (x as { name?: unknown }).name === 'string' &&
          typeof (x as { show?: unknown }).show === 'string' &&
          decode((x as { show: string }).show) !== null,
      )
      .map((x) => ({ name: x.name.slice(0, 40), show: x.show }))
      .slice(0, MAX_SAVED)
  return out
}
