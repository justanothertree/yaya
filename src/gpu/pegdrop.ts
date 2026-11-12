/**
 * The Lab's peg drop (a plinko board): a ball dropped onto a triangle of pegs falls left or right at
 * every row and lands in a slot worth a multiple of what was dropped. Pure, so pegdrop.test.ts can
 * drop a hundred thousand balls without a page. Drawn with the 2D canvas (PegDropDemo) — a peg
 * board needs no GPU.
 *
 * ⚠️ EACH PEG IS A FAIR COIN, AND THAT IS A DECISION, NOT A SHORTCUT. A first version stepped real
 * physics — gravity, restitution, a nudge per bounce — and measured where 4,000 balls went: the
 * spread came out nearly flat, so the rare edge slots were hit one drop in eighteen and every board
 * paid back 2 to 17 times what went in. Physics that looks right gives odds nobody can state; a
 * coin per row gives the binomial exactly, so the page can print the true chance of every slot and
 * the true average return, and the animation is drawn along the path the coins chose.
 *
 * ⚠️ PLAY POINTS, NOT MONEY, AND THE RETURN IS PRINTED. Every risk level pays back 99% on average —
 * computed from the binomial in `expected`, and asserted by the test — so points drain slowly, the
 * way a peg board does, and a lucky run is still a real thing that can happen.
 */

export type V2 = [number, number]

/** rows of pegs: row r has r + 3 pegs, so there are ROWS + 1 slots */
export const ROWS = 12
export const SLOTS = ROWS + 1

/** the payout of each slot by risk: symmetric, the edges rarest and richest */
const mirror = (half: number[]) => [...half, ...half.slice(0, -1).reverse()]
export const RISKS = {
  low: mirror([11, 3, 1.6, 1.4, 1.1, 1, 0.5]),
  medium: mirror([33, 11, 4, 2, 1.1, 0.6, 0.3]),
  high: mirror([170, 24, 8.1, 2, 0.7, 0.2, 0.2]),
} as const satisfies Record<string, readonly number[]>
export type Risk = keyof typeof RISKS
export const RISK_NAMES: Record<Risk, string> = { low: 'Low', medium: 'Medium', high: 'High' }

/** n choose k */
export function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  let r = 1
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i
  return Math.round(r)
}
/** the exact chance of landing in each slot */
export const ODDS: readonly number[] = Array.from(
  { length: SLOTS },
  (_, k) => choose(ROWS, k) / 2 ** ROWS,
)
/** what one point dropped returns on average at a risk level */
export const expected = (risk: Risk) => ODDS.reduce((t, p, i) => t + p * RISKS[risk][i], 0)

/** a seeded random source, so a run of drops can be replayed exactly */
export { rng as seeded } from './bricks'

/* ---------------------------------------------------------------------------- the board */

/** the board is 1 wide; y grows downward */
export const GAP = 1 / (ROWS + 3)
export const ROW_H = GAP * 0.9
export const TOP = GAP * 1.4
export const PEG_R = GAP * 0.11
export const BALL_R = GAP * 0.27

/** peg i of row r */
export const peg = (r: number, i: number): V2 => [0.5 + (i - (r + 2) / 2) * GAP, TOP + r * ROW_H]
export function pegs(): V2[] {
  const out: V2[] = []
  for (let r = 0; r < ROWS; r++) for (let i = 0; i < r + 3; i++) out.push(peg(r, i))
  return out
}
export const FLOOR = TOP + ROWS * ROW_H
export const slotX = (k: number) => 0.5 + (k - ROWS / 2) * GAP
/** how tall the whole board is, for the canvas */
export const HEIGHT = FLOOR + GAP * 1.6

export type Drop = {
  /** true where the ball went right, one per row */
  turns: boolean[]
  slot: number
}
/** one ball's way down: a fair coin at each row, and the slot is the number of rights */
export function drop(rand: () => number): Drop {
  const turns = Array.from({ length: ROWS }, () => rand() < 0.5)
  return { turns, slot: turns.filter(Boolean).length }
}

/** seconds a ball takes from one row to the next */
export const HOP = 0.11
/** how long a whole drop takes on screen */
export const FALL = (ROWS + 1) * HOP

/**
 * Where a ball is t seconds into its drop: it rests on top of each peg it meets, then hops in an arc
 * to the top of the next one, left or right as its coin said, and finally into its slot.
 */
export function at(d: Drop, t: number): V2 {
  // the peg the ball sits on before row r: it starts above the middle peg of the top row
  const over = (r: number): V2 => {
    if (r >= ROWS) return [slotX(d.slot), FLOOR + GAP * 0.55]
    const rights = d.turns.slice(0, r).filter(Boolean).length
    const [x, y] = peg(r, rights + 1)
    return [x, y - PEG_R - BALL_R]
  }
  const start: V2 = [0.5, TOP - ROW_H]
  const k = Math.max(0, Math.min(ROWS + 1, t / HOP))
  const r = Math.floor(k)
  if (r >= ROWS + 1) return over(ROWS)
  const from = r === 0 ? start : over(r - 1)
  const to = over(r)
  const f = k - r
  /* a hop: off the side of the peg first (across eases out), then down under gravity (down eases
     in), with a little bounce up. ⚠️ ACROSS AT A STEADY RATE WENT THROUGH THE PEG IT LEFT on the
     drop into the slot, which is the longest fall — the test sweeps every frame for that. */
  const lift = r === 0 ? 0 : GAP * 0.35
  const across = 1 - (1 - f) * (1 - f)
  return [
    from[0] + (to[0] - from[0]) * across,
    from[1] + (to[1] - from[1]) * f * f - lift * 4 * f * (1 - f),
  ]
}

/* ---------------------------------------------------------------------------- what is kept */

export const PEGDROP_KEY = 'lab_pegdrop_v1'
export const START = 100
export const BETS = [1, 5, 10, 25] as const
export type Saved = {
  points: number
  /** the most points ever held */
  best: number
  drops: number
  /** the richest single landing, as a multiple */
  bigHit: number
  /** how many times the bank was topped back up after running dry */
  refills: number
  risk: Risk
  bet: number
}
export const EMPTY: Saved = {
  points: START,
  best: START,
  drops: 0,
  bigHit: 0,
  refills: 0,
  risk: 'low',
  bet: 1,
}
export function readSaved(text: string | null): Saved {
  const out = { ...EMPTY }
  let v: unknown
  try {
    v = JSON.parse(text ?? 'null')
  } catch {
    return out
  }
  if (typeof v !== 'object' || !v || Array.isArray(v)) return out
  const o = v as Record<string, unknown>
  const num = (x: unknown) =>
    typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1e9 ? x : null
  out.points = num(o.points) ?? out.points
  out.best = Math.max(out.points, num(o.best) ?? out.best)
  out.drops = Math.round(num(o.drops) ?? out.drops)
  out.bigHit = num(o.bigHit) ?? out.bigHit
  out.refills = Math.round(num(o.refills) ?? out.refills)
  if (typeof o.risk === 'string' && o.risk in RISKS) out.risk = o.risk as Risk
  if ((BETS as readonly unknown[]).includes(o.bet)) out.bet = o.bet as number
  return out
}

/** points after a ball lands: rounded to tenths, so a 0.3× on a 1 is 0.3 and not 0.30000000000000004 */
export const paid = (bet: number, risk: Risk, slot: number) =>
  Math.round(bet * RISKS[risk][slot] * 10) / 10
/** a whole number of points shows as one; anything else to one place */
export const pts = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
