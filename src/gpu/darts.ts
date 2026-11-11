/**
 * Darts: 501, double out, against the computer. Each turn is three darts; take your score from
 * 501 and finish exactly on nought with a double (the bull's eye counts as double 25). Go below
 * nought, to one, or to nought without a double and the turn is bust: the score goes back to what
 * it was. First to win two legs takes the match.
 *
 * Pure, so darts.test.ts can throw a few hundred thousand darts without a page. Positions on the
 * board are millimetres from the middle, x right and y UP, as the board is measured.
 */

/** the board's numbers, clockwise from the top */
export const ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5]
/** radii in millimetres: bull, outer bull, treble ring, double ring, edge of scoring */
export const R = {
  bull: 6.35,
  outer: 15.9,
  trebleIn: 99,
  trebleOut: 107,
  doubleIn: 162,
  doubleOut: 170,
} as const

export type Hit = { n: number; mult: 0 | 1 | 2 | 3 }
export const points = (h: Hit) => h.n * h.mult
/** how a hit is said: T20, D16, 5, bull, 25, or a miss */
export const say = (h: Hit) =>
  h.mult === 0
    ? 'a miss'
    : h.n === 25
      ? h.mult === 2
        ? 'the bull'
        : '25'
      : `${h.mult === 3 ? 'T' : h.mult === 2 ? 'D' : ''}${h.n}`

/** what a dart landing at (x, y) scores */
export function hitAt(x: number, y: number): Hit {
  const r = Math.hypot(x, y)
  if (r <= R.bull) return { n: 25, mult: 2 }
  if (r <= R.outer) return { n: 25, mult: 1 }
  if (r > R.doubleOut) return { n: 0, mult: 0 }
  // the angle clockwise from straight up, and the twentieth of the board it falls in
  const a = (Math.atan2(x, y) + Math.PI * 2) % (Math.PI * 2)
  const n = ORDER[Math.floor(((a + Math.PI / 20) % (Math.PI * 2)) / (Math.PI / 10))]
  const mult = r >= R.doubleIn ? 2 : r >= R.trebleIn && r <= R.trebleOut ? 3 : 1
  return { n, mult }
}
/** the middle of a target: the place to aim to hit it */
export function centreOf(t: Hit): { x: number; y: number } {
  if (t.n === 25) return { x: 0, y: t.mult === 2 ? 0 : (R.bull + R.outer) / 2 }
  const i = ORDER.indexOf(t.n)
  const a = (i * Math.PI) / 10
  const r =
    t.mult === 3
      ? (R.trebleIn + R.trebleOut) / 2
      : t.mult === 2
        ? (R.doubleIn + R.doubleOut) / 2
        : // a single: the fat part, between the treble and the double rings
          (R.trebleOut + R.doubleIn) / 2
  return { x: Math.sin(a) * r, y: Math.cos(a) * r }
}

/** a throw: where it lands, scattered round the aim by a hand with spread `sigma` mm */
export function land(aim: { x: number; y: number }, sigma: number, rand: () => number) {
  // Box–Muller: two normal deviates from two uniform ones
  const u = Math.max(1e-12, rand())
  const v = rand()
  const m = Math.sqrt(-2 * Math.log(u)) * sigma
  return { x: aim.x + m * Math.cos(2 * Math.PI * v), y: aim.y + m * Math.sin(2 * Math.PI * v) }
}

/* --------------------------------------------------------------------------- finishing */

const SINGLES: Hit[] = [...ORDER.map((n) => ({ n, mult: 1 as const })), { n: 25, mult: 1 }]
const DOUBLES: Hit[] = [...ORDER.map((n) => ({ n, mult: 2 as const })), { n: 25, mult: 2 }]
const TREBLES: Hit[] = ORDER.map((n) => ({ n, mult: 3 as const }))
const ANY = [...TREBLES, ...SINGLES, ...DOUBLES]
/** the doubles players like to finish on, best first: ones that halve into more doubles */
const LIKED = [20, 16, 8, 12, 10, 18, 4, 6, 2, 14, 25, 9, 7, 3, 5, 11, 13, 15, 17, 19, 1]
const doubleRank = (h: Hit) => LIKED.indexOf(h.n === 25 ? 25 : h.n)
/** how good a set-up dart is: big trebles, then the bull, then anything */
const setupRank = (h: Hit) => (h.mult === 3 ? 100 - h.n : h.mult === 1 ? 200 - h.n : 300 - h.n)

/**
 * The way out from every score that can be finished in three darts: fewest darts, then the
 * friendliest double, then the biggest set-up darts. 170 is T20 T20 bull; 2 is D1. The scores no
 * three darts can finish — 169, 168, 166, 165, 163, 162 and 159 — have no route.
 */
export const ROUTES: Map<number, Hit[]> = (() => {
  const out = new Map<number, Hit[]>()
  const better = (a: Hit[], b: Hit[] | undefined) => {
    if (!b) return true
    if (a.length !== b.length) return a.length < b.length
    const da = doubleRank(a[a.length - 1])
    const db = doubleRank(b[b.length - 1])
    if (da !== db) return da < db
    for (let i = 0; i < a.length - 1; i++) {
      const d = setupRank(a[i]) - setupRank(b[i])
      if (d) return d < 0
    }
    return false
  }
  for (const d of DOUBLES) {
    const s = points(d)
    if (better([d], out.get(s))) out.set(s, [d])
    for (const a of ANY) {
      const s2 = points(a) + s
      if (better([a, d], out.get(s2))) out.set(s2, [a, d])
      for (const b of ANY) {
        const s3 = points(a) + points(b) + s
        if (s3 <= 170 && better([a, b, d], out.get(s3))) out.set(s3, [a, b, d])
      }
    }
  }
  return out
})()

/* --------------------------------------------------------------------------- a match */

export type Who = 0 | 1
export type Leg = {
  scores: [number, number]
  turn: Who
  /** the darts thrown so far this turn, and the score the turn began on */
  darts: Hit[]
  from: number
  /** every turn so far, for the page: who, the darts, the total, and whether it was bust */
  history: { who: Who; darts: Hit[]; total: number; bust: boolean }[]
  winner: Who | null
}
export const START = 501
export function newLeg(first: Who, start = START): Leg {
  return { scores: [start, start], turn: first, darts: [], from: start, history: [], winner: null }
}

/** one dart for whoever's turn it is: scored, finished, bust, or the turn handed on after three */
export function dart(g: Leg, h: Hit): Leg {
  if (g.winner !== null) return g
  const w = g.turn
  const left = g.scores[w] - points(h)
  const darts = [...g.darts, h]
  const end = (scores: [number, number], bust: boolean, winner: Who | null): Leg => ({
    ...g,
    scores,
    turn: winner === null ? (w === 0 ? 1 : 0) : w,
    darts: [],
    from: winner === null ? scores[w === 0 ? 1 : 0] : scores[w],
    history: [...g.history, { who: w, darts, total: bust ? 0 : g.from - scores[w], bust }],
    winner,
  })
  const scores = [...g.scores] as [number, number]
  if (left < 0 || left === 1 || (left === 0 && h.mult !== 2)) {
    scores[w] = g.from
    return end(scores, true, null)
  }
  scores[w] = left
  if (left === 0) return end(scores, false, w)
  if (darts.length === 3) return end(scores, false, null)
  return { ...g, scores, darts }
}

/* --------------------------------------------------------------------------- the computer */

export const LEVELS = ['easy', 'fair', 'hard'] as const
export type Level = (typeof LEVELS)[number]
/** each level's throwing hand: the spread of its darts in millimetres */
export const SPREAD: Record<Level, number> = { easy: 34, fair: 22, hard: 13 }

/**
 * What aiming at a point is worth on average to a hand with this spread, by sampling: so the
 * computer knows when the treble 20 is a fool's target and the 19s or the bull are better.
 */
function expected(aim: { x: number; y: number }, sigma: number, samples = 300) {
  let t = 0
  // a fixed sequence, so the same question gets the same answer
  let s = 12345
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < samples; i++) {
    const p = land(aim, sigma, rand)
    t += points(hitAt(p.x, p.y))
  }
  return t / samples
}
const scoringTargets = new Map<Level, { x: number; y: number; label: string }>()
/** where a level aims when it is only scoring: the treble whose neighbourhood pays best for its hand */
export function scoringAim(level: Level) {
  const known = scoringTargets.get(level)
  if (known) return known
  let best = { ...centreOf({ n: 20, mult: 3 }), label: 'T20' }
  let bv = -Infinity
  for (const t of [...TREBLES, { n: 25, mult: 2 as const }]) {
    const v = expected(centreOf(t), SPREAD[level])
    if (v > bv) {
      bv = v
      best = { ...centreOf(t), label: say(t) }
    }
  }
  scoringTargets.set(level, best)
  return best
}
/**
 * Where the computer aims its next dart: down a checkout route when the score has one (a route
 * for the darts left in the turn), otherwise at its best scoring treble — and when it is close to
 * a finish with too few darts, at a single that leaves a liked double.
 */
export function aimFor(g: Leg, level: Level): { x: number; y: number; label: string } {
  const left = g.scores[g.turn]
  const dartsLeft = 3 - g.darts.length
  const route = ROUTES.get(left)
  if (route && route.length <= dartsLeft) return { ...centreOf(route[0]), label: say(route[0]) }
  if (left <= 60 || (route && route.length > dartsLeft)) {
    // set up: the single that leaves the best double
    let best: Hit = { n: 20, mult: 1 }
    let bv = Infinity
    for (const s of SINGLES) {
      const rest = left - points(s)
      const r = ROUTES.get(rest)
      if (rest < 2 || !r || r.length !== 1) continue
      const v = doubleRank(r[0])
      if (v < bv) {
        bv = v
        best = s
      }
    }
    if (bv < Infinity) return { ...centreOf(best), label: say(best) }
  }
  return scoringAim(level)
}
/** a whole leg between two levels, for the tests: who won, and how many darts each threw */
export function playLeg(a: Level, b: Level, first: Who, rand: () => number) {
  let g = newLeg(first)
  const lv: [Level, Level] = [a, b]
  const thrown: [number, number] = [0, 0]
  while (g.winner === null && thrown[0] + thrown[1] < 600) {
    const w = g.turn
    const aim = aimFor(g, lv[w])
    const p = land(aim, SPREAD[lv[w]], rand)
    thrown[w]++
    g = dart(g, hitAt(p.x, p.y))
  }
  return { winner: g.winner, thrown }
}

/* --------------------------------------------------------------------------- your hand */

/**
 * How steady your hand is while you hold to throw: it starts loose, tightens to its best over the
 * first second as you settle, and loosens again if you hold on too long. Released at the best
 * moment it is a little steadier than the computer's Fair; snatched, it is like its Easy.
 */
export const BREATH = 1.1
export function yourSpread(held: number): number {
  const best = 16
  const loose = 38
  if (held <= 0) return loose
  if (held <= BREATH) return loose - (loose - best) * Math.sin((held / BREATH) * (Math.PI / 2))
  return Math.min(loose * 1.3, best + (held - BREATH) * 30)
}

/* --------------------------------------------------------------------------- what is kept */

export const DARTS_KEY = 'lab_darts_v1'
export const BOARDS = ['classic', 'neon', 'pub'] as const
export type Tally = { won: number; lost: number; best: number; fewest: number; tons: number }
export type Saved = {
  level: Level
  board: (typeof BOARDS)[number]
  /** show the way out when your score can be finished */
  hints: boolean
  /** per level: matches won and lost, best checkout, fewest darts in a leg won, and 180s */
  record: Record<Level, Tally>
}
const NONE: Tally = { won: 0, lost: 0, best: 0, fewest: 0, tons: 0 }
export const EMPTY: Saved = {
  level: 'fair',
  board: 'classic',
  hints: true,
  record: { easy: NONE, fair: NONE, hard: NONE },
}
const whole = (v: unknown) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e6 ? v : 0
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
  const rec = (typeof o.record === 'object' && o.record ? o.record : {}) as Record<string, unknown>
  const record = {} as Record<Level, Tally>
  for (const l of LEVELS) {
    const x = (typeof rec[l] === 'object' && rec[l] ? rec[l] : {}) as Record<string, unknown>
    record[l] = {
      won: whole(x.won),
      lost: whole(x.lost),
      best: Math.min(170, whole(x.best)),
      fewest: whole(x.fewest),
      tons: whole(x.tons),
    }
  }
  return {
    level: pick(LEVELS, o.level, EMPTY.level),
    board: pick(BOARDS, o.board, EMPTY.board),
    hints: typeof o.hints === 'boolean' ? o.hints : EMPTY.hints,
    record,
  }
}
