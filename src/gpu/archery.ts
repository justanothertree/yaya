/**
 * Archery: a round of ends at longer and longer distances, three arrows an end. You aim through a
 * sight that sways; the arrow drops on the way and the wind pushes it sideways, both more the
 * further the target is. Pure — the flight, the wind, the sway and the scoring — so archery.test.ts
 * can shoot whole rounds without a page; ArcheryDemo draws the range and reads your aim.
 *
 * Everything on the target face is in metres from its centre, x right and y up. The face is 1.22 m
 * across, ten rings of 6.1 cm, gold in the middle.
 */

export const FACE_R = 0.61
export const RING = FACE_R / 10
const G = 9.81

export const BOWS = {
  recurve: { speed: 62, sway: 0.11, label: 'Recurve' },
  compound: { speed: 88, sway: 0.06, label: 'Compound' },
  longbow: { speed: 50, sway: 0.15, label: 'Longbow' },
} as const
export type Bow = keyof typeof BOWS

export const ROUNDS = {
  short: [18, 18, 25, 25],
  standard: [30, 50, 70, 90],
  long: [50, 70, 90, 110],
} as const
export type RoundName = keyof typeof ROUNDS
export const ARROWS_PER_END = 3

/** the distance the sight is set for: at it, an arrow aimed at the gold drops into the gold */
export const SIGHT_SET = 50

/**
 * How far below the aim an arrow lands, and how far the wind carries it sideways, at a target `d`
 * metres off. ⚠️ THE DROP IS WHAT THE SIGHT DOES NOT ALREADY ALLOW FOR. A real arrow falls metres
 * over 90 m; an archer sets the sight for the distance and the fall is taken care of. Here the
 * sight is set once, for 50 m, so the drop is the difference from that: a few centimetres high at
 * short range, a few tens of centimetres low at long range — something to judge, on the face.
 * The wind's push grows with the time in the air, which grows with the distance.
 */
export function flight(
  bow: Bow,
  d: number,
  wind: number,
): { drop: number; drift: number; time: number } {
  const t = d / BOWS[bow].speed
  const tSet = SIGHT_SET / BOWS[bow].speed
  return { drop: 0.5 * G * (t * t - tSet * tSet) * 0.04, drift: wind * t * 0.05, time: t }
}

/** where an arrow aimed at (x, y) on the face lands */
export function land(aim: { x: number; y: number }, bow: Bow, d: number, wind: number) {
  const f = flight(bow, d, wind)
  return { x: aim.x + f.drift, y: aim.y - f.drop }
}

/** the ring an arrow at (x, y) scores: 10 in the gold's middle down to 1 at the edge, 0 a miss; X is the inner ten */
export function scoreAt(x: number, y: number): { ring: number; x: boolean } {
  const r = Math.hypot(x, y)
  if (r > FACE_R) return { ring: 0, x: false }
  return { ring: Math.max(1, 10 - Math.floor(r / RING)), x: r <= RING / 2 }
}

/** the sight's sway at time `t` seconds into holding, in metres on the face at `d` metres */
export function sway(
  t: number,
  bow: Bow,
  d: number,
  steady: boolean,
  phase: number,
): { x: number; y: number } {
  // it settles over the first second, then the arm tires and it grows again
  const tire = t < 1 ? 1 - 0.45 * t : 0.55 + 0.25 * (t - 1)
  const a = BOWS[bow].sway * Math.min(2, tire) * (d / 50) * (steady ? 0.35 : 1)
  return {
    x: a * (Math.sin(t * 1.7 + phase) * 0.6 + Math.sin(t * 4.1 + phase * 2) * 0.4),
    y: a * (Math.sin(t * 1.3 + phase * 3) * 0.6 + Math.cos(t * 3.3 + phase) * 0.4),
  }
}

export function seeded(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 2 ** 32
  }
}
/** the wind for every arrow of a round, from a seed: steady within an end, shifting between them */
export function winds(seed: number, round: RoundName): number[] {
  const rand = seeded(seed)
  const out: number[] = []
  for (let e = 0; e < ROUNDS[round].length; e++) {
    const base = (rand() - 0.5) * 2 * (1.5 + e * 1.2)
    for (let k = 0; k < ARROWS_PER_END; k++)
      out.push(Math.round((base + (rand() - 0.5) * 1.2) * 10) / 10)
  }
  return out
}
export const dailySeed = (d: Date) => {
  const key = `archery-${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193)
  return h >>> 0
}
export const maxScore = (round: RoundName) => ROUNDS[round].length * ARROWS_PER_END * 10

/* ---------------------------------------------------------------------------- what is kept */

export const ARCHERY_KEY = 'lab_archery_v1'
export const FACES = ['target', 'field', 'bullseye'] as const
export const FLETCHES = ['#e63946', '#f4c430', '#1d7bd8', '#2a9d58', '#8d5cf6', '#ffffff'] as const
export type Saved = {
  bow: Bow
  round: RoundName
  face: (typeof FACES)[number]
  fletch: number
  /** show where the arrow will drop to, though not the wind */
  sightPin: boolean
  /** best total per bow and round, as "bow/round" */
  best: Record<string, number>
  daily: { day: string; total: number } | null
}
export const EMPTY: Saved = {
  bow: 'recurve',
  round: 'standard',
  face: 'target',
  fletch: 0,
  sightPin: true,
  best: {},
  daily: null,
}
export const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`

export function readSaved(text: string | null): Saved {
  let v: unknown
  try {
    v = JSON.parse(text ?? 'null')
  } catch {
    return EMPTY
  }
  if (typeof v !== 'object' || !v || Array.isArray(v)) return EMPTY
  const o = v as Record<string, unknown>
  const pick = <T>(list: readonly T[], x: unknown, d: T): T =>
    list.includes(x as T) ? (x as T) : d
  const best: Record<string, number> = {}
  if (o.best && typeof o.best === 'object' && !Array.isArray(o.best))
    for (const [k, n] of Object.entries(o.best as Record<string, unknown>)) {
      const [b, r] = k.split('/')
      if (
        b in BOWS &&
        r in ROUNDS &&
        typeof n === 'number' &&
        Number.isInteger(n) &&
        n >= 0 &&
        n <= maxScore(r as RoundName)
      )
        best[k] = n
    }
  const d = o.daily as Record<string, unknown> | null
  const daily =
    d &&
    typeof d === 'object' &&
    typeof d.day === 'string' &&
    /^\d{4}-\d{1,2}-\d{1,2}$/.test(d.day) &&
    typeof d.total === 'number' &&
    Number.isInteger(d.total) &&
    d.total >= 0 &&
    d.total <= maxScore('standard')
      ? { day: d.day, total: d.total }
      : null
  return {
    bow: pick(Object.keys(BOWS) as Bow[], o.bow, EMPTY.bow),
    round: pick(Object.keys(ROUNDS) as RoundName[], o.round, EMPTY.round),
    face: pick(FACES, o.face, EMPTY.face),
    fletch:
      typeof o.fletch === 'number' &&
      Number.isInteger(o.fletch) &&
      o.fletch >= 0 &&
      o.fletch < FLETCHES.length
        ? o.fletch
        : EMPTY.fletch,
    sightPin: typeof o.sightPin === 'boolean' ? o.sightPin : EMPTY.sightPin,
    best,
    daily,
  }
}
