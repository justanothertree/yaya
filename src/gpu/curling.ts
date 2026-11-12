/**
 * Curling: you and a computer skip take turns sliding stones down a sheet of ice at the house, the
 * rings at the far end. A stone curls the way it turns, more as it slows; sweeping in front of it
 * carries it further and straighter. When every stone of an end is thrown, whoever has the stone
 * nearest the button scores one for each of theirs nearer than the other side's best.
 *
 * Pure, so curling.test.ts can throw a few hundred thousand stones without a page. Metres and
 * seconds. The sheet is shorter than a real one, so a stone takes seconds rather than half a
 * minute, but the house and the stones are their real size. x is across the sheet (positive to the
 * right as you look down it), y along it from where the stone is let go.
 */
import { rng } from './bricks'
import { whole } from './kept'

export const HALF_W = 2.375
export const HOG = 8
export const TEE = 14
export const HOUSE_R = 1.83
export const BACK = TEE + HOUSE_R
export const STONE_R = 0.145
/** how fast the ice slows a stone, metres a second each second; and how much sweeping takes off */
export const MU = 0.7
export const SWEPT = 0.8
/** how hard a turning stone is pushed sideways: more the slower it goes; sweeping halves it */
export const CURL = 0.22
const CURL_SOFT = 0.35
const SWEPT_CURL = 0.5
export const STEP = 1 / 120
export const STONES_EACH = 4

export type Team = 0 | 1
export type Stone = {
  x: number
  y: number
  vx: number
  vy: number
  /** +1 turns clockwise, seen from above, and curls to the right; -1 the other way; 0 not at all */
  spin: number
  team: Team
}
/** a throw: a line in radians off straight down the sheet (positive aims right), a speed, a turn */
export type Shot = { angle: number; speed: number; spin: 1 | -1 }

/** the stones after one step of the ice: friction, curl, knocks, and anything out of play gone */
export function step(
  stones: Stone[],
  sweep: Stone | null,
  dt = STEP,
  knocked?: Set<Stone>,
): Stone[] {
  for (const s of stones) {
    const v = Math.hypot(s.vx, s.vy)
    if (v === 0) continue
    const swept = s === sweep
    const slow = Math.min(v, MU * (swept ? SWEPT : 1) * dt)
    let vx = s.vx - (s.vx / v) * slow
    let vy = s.vy - (s.vy / v) * slow
    if (s.spin && v > slow) {
      // the curl: sideways to the way it is going, to the right for a clockwise stone
      const push = (s.spin * CURL * (swept ? SWEPT_CURL : 1) * dt) / (v + CURL_SOFT)
      const ux = vx / v
      const uy = vy / v
      vx += uy * push
      vy -= ux * push
      const nv = Math.hypot(vx, vy)
      // the curl turns a stone and never speeds it up
      const keep = (v - slow) / nv
      vx *= keep
      vy *= keep
    }
    s.vx = vx
    s.vy = vy
    s.x += s.vx * dt
    s.y += s.vy * dt
  }
  for (let a = 0; a < stones.length; a++)
    for (let b = a + 1; b < stones.length; b++)
      if (knock(stones[a], stones[b])) {
        knocked?.add(stones[a])
        knocked?.add(stones[b])
      }
  return stones.filter(inPlay)
}
const inPlay = (s: Stone) => Math.abs(s.x) < HALF_W - STONE_R && s.y < BACK + STONE_R && s.y > -1
/** two stones meeting: granite on granite, nearly elastic, along the line between them */
function knock(p: Stone, q: Stone): boolean {
  const dx = q.x - p.x
  const dy = q.y - p.y
  const d = Math.hypot(dx, dy)
  if (d >= STONE_R * 2 || d === 0) return false
  const nx = dx / d
  const ny = dy / d
  const rel = (p.vx - q.vx) * nx + (p.vy - q.vy) * ny
  const over = (STONE_R * 2 - d) / 2
  p.x -= nx * over
  p.y -= ny * over
  q.x += nx * over
  q.y += ny * over
  if (rel <= 0) return true
  // the one that was struck is not turning any more, near enough
  if (Math.hypot(p.vx, p.vy) < Math.hypot(q.vx, q.vy)) p.spin = 0
  else q.spin = 0
  const j = (rel * (1 + 0.9)) / 2
  p.vx -= j * nx
  p.vy -= j * ny
  q.vx += j * nx
  q.vy += j * ny
  return true
}
export const moving = (stones: readonly Stone[]) => stones.some((s) => s.vx !== 0 || s.vy !== 0)

/** put a stone on the ice with a throw */
export function deliver(stones: readonly Stone[], shot: Shot, team: Team): Stone[] {
  const thrown: Stone = {
    x: 0,
    y: 0,
    vx: Math.sin(shot.angle) * shot.speed,
    vy: Math.cos(shot.angle) * shot.speed,
    spin: shot.spin,
    team,
  }
  return [...stones.map((s) => ({ ...s })), thrown]
}
/**
 * After a throw comes to rest: a stone that stopped short of the far hog line is taken off,
 * unless it touched another on the way — the hog rule.
 */
export function settle(stones: Stone[], thrown: Stone | undefined, touched: boolean): Stone[] {
  return stones.filter((s) => s !== thrown || touched || s.y >= HOG)
}

/** who decides whether to sweep, step by step, while a stone slides */
export type Sweeper = (s: Stone) => boolean
/** throw a stone and let everything come to rest, for the tests and the computer */
export function slide(
  stones: readonly Stone[],
  shot: Shot,
  team: Team,
  sweeper: Sweeper | null = null,
  keep = false,
): { stones: Stone[]; frames: Stone[][] } {
  let now = deliver(stones, shot, team)
  const thrown = now[now.length - 1]
  const knocked = new Set<Stone>()
  const frames: Stone[][] = []
  for (let i = 0; i < 40 / STEP && moving(now); i++) {
    const sweep = sweeper && now.includes(thrown) && sweeper(thrown) ? thrown : null
    now = step(now, sweep, STEP, knocked)
    if (keep && i % 2 === 0) frames.push(now.map((s) => ({ ...s })))
  }
  for (const s of now) {
    s.vx = 0
    s.vy = 0
  }
  const done = settle(now, thrown, knocked.has(thrown))
  if (keep) frames.push(done.map((s) => ({ ...s })))
  return { stones: done, frames }
}

/* --------------------------------------------------------------------------- scoring */

export const fromButton = (s: { x: number; y: number }) => Math.hypot(s.x, s.y - TEE)
export const inHouse = (s: { x: number; y: number }) => fromButton(s) < HOUSE_R + STONE_R
/** the end's score as the stones lie: who scores, and how many */
export function count(stones: readonly Stone[]): { team: Team | null; points: number } {
  const ranked = stones.filter(inHouse).sort((a, b) => fromButton(a) - fromButton(b))
  if (!ranked.length) return { team: null, points: 0 }
  const team = ranked[0].team
  let points = 0
  for (const s of ranked) {
    if (s.team !== team) break
    points++
  }
  return { team, points }
}

/* --------------------------------------------------------------------------- reading the ice */

/**
 * The ice is the same in every direction, so a throw turned by an angle slides along the same path
 * turned by that angle. One straight-down slide at each speed is all the computer needs to know
 * where any throw on an empty sheet comes to rest — and so is the aiming line you are shown.
 */
const tables = new Map<string, { x: number; y: number }[]>()
export function pathOf(speed: number, spin: 1 | -1, swept = false): { x: number; y: number }[] {
  const key = `${speed.toFixed(4)}|${spin}|${swept}`
  const hit = tables.get(key)
  if (hit) return hit
  let s: Stone[] = [{ x: 0, y: 0, vx: 0, vy: speed, spin, team: 0 }]
  const pts = [{ x: 0, y: 0 }]
  for (let i = 0; i < 40 / STEP && moving(s); i++) {
    s = step(s, swept ? s[0] : null)
    if (!s.length) break
    pts.push({ x: s[0].x, y: s[0].y })
  }
  if (tables.size > 400) tables.clear()
  tables.set(key, pts)
  return pts
}
const turnBy = (p: { x: number; y: number }, a: number) => ({
  x: p.x * Math.cos(a) + p.y * Math.sin(a),
  y: -p.x * Math.sin(a) + p.y * Math.cos(a),
})
/** where a throw comes to rest on an empty sheet, and the path it takes there */
export function restOf(shot: Shot): { x: number; y: number } {
  const p = pathOf(shot.speed, shot.spin)
  return turnBy(p[p.length - 1], shot.angle)
}
export function lineOf(shot: Shot, every = 6): { x: number; y: number }[] {
  return pathOf(shot.speed, shot.spin)
    .filter((_, i, a) => i % every === 0 || i === a.length - 1)
    .map((p) => turnBy(p, shot.angle))
}
/** the throw that comes to rest on a spot, with a given turn, on an empty sheet */
export function drawTo(at: { x: number; y: number }, spin: 1 | -1): Shot {
  const want = Math.hypot(at.x, at.y)
  let lo = 0.5
  let hi = 9
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2
    const p = pathOf(mid, spin)
    const end = p[p.length - 1]
    if (Math.hypot(end.x, end.y) < want) lo = mid
    else hi = mid
  }
  const speed = Math.round(((lo + hi) / 2) * 10000) / 10000
  const p = pathOf(speed, spin)
  const end = p[p.length - 1]
  return { speed, spin, angle: Math.atan2(at.x, at.y) - Math.atan2(end.x, end.y) }
}
/** a throw at a speed that passes through a spot: for hitting a stone that is there */
export function hitAt(at: { x: number; y: number }, spin: 1 | -1, speed: number): Shot {
  const want = Math.hypot(at.x, at.y)
  const p = pathOf(speed, spin)
  const through = p.find((q) => Math.hypot(q.x, q.y) >= want) ?? p[p.length - 1]
  return { speed, spin, angle: Math.atan2(at.x, at.y) - Math.atan2(through.x, through.y) }
}

/* --------------------------------------------------------------------------- the computer */

export const LEVELS = ['easy', 'fair', 'hard'] as const
export type Level = (typeof LEVELS)[number]
/**
 * Each skip's hand — how far the line and the weight stray from what it means — and its sweepers:
 * Easy's do not sweep. Fair and Hard sweep a stone that is going to stop short of where it was
 * meant to, which mends a light throw and can do nothing for a heavy one. The hands are what
 * separate the levels: over held-out games Fair beats Easy 130 in 150 and Hard beats Fair 223 in
 * 300. With Fair's hand as steady as Hard's nearly is, Hard won only 57%, and a steadier Hard
 * than this changed nothing — between two good skips, the hammer decides most ends.
 *
 * Hard once also chose the shot that did best when its own hand wobbled, as Putt and Bowling do.
 * Here it made no difference worth its cost: over 300 held-out games against a Fair as steady as
 * Fair once was, it won 183 with that and 172 without, inside the noise, so it was taken out. A curling stone's misses are gentle
 * — a draw a little long is still in the house — where a putt's are not.
 */
export const HANDS: Record<Level, { angle: number; speed: number; sweeps: boolean }> = {
  easy: { angle: 0.012, speed: 0.05, sweeps: false },
  fair: { angle: 0.009, speed: 0.04, sweeps: true },
  hard: { angle: 0.003, speed: 0.016, sweeps: true },
}
export type Plan = { shot: Shot; kind: 'draw' | 'guard' | 'hit'; target: { x: number; y: number } }
/** sweep while the stone would stop short of the spot it was thrown at */
export const sweepTo =
  (target: { x: number; y: number }): Sweeper =>
  (s) => {
    const v = Math.hypot(s.vx, s.vy)
    const goes = (v * v) / (2 * MU)
    return goes < Math.hypot(target.x - s.x, target.y - s.y) - 0.03
  }

/** how the stones lie for a team, a little more finely than the score */
export function value(stones: readonly Stone[], team: Team, last: boolean): number {
  const c = count(stones)
  let v = c.team === null ? 0 : c.team === team ? c.points : -c.points
  if (last) return v
  for (const s of stones) {
    const sign = s.team === team ? 1 : -1
    if (inHouse(s)) v += sign * 0.25 * (1 - fromButton(s) / (HOUSE_R + STONE_R))
    // a guard in front of the house is worth something while there are stones to come
    else if (s.y > HOG && s.y < TEE - HOUSE_R && Math.abs(s.x) < 1) v += sign * 0.12
  }
  return v
}
/** the shots worth looking at with the stones as they lie */
export function candidates(stones: readonly Stone[], team: Team, level: Level): Plan[] {
  const out: Plan[] = []
  const spins = [1, -1] as const
  const spots: { x: number; y: number; kind: Plan['kind'] }[] = []
  for (const x of [-1.2, -0.6, 0, 0.6, 1.2])
    for (const dy of [-1.2, -0.6, 0, 0.6]) spots.push({ x, y: TEE + dy, kind: 'draw' })
  if (level !== 'easy')
    for (const x of [-0.6, 0, 0.6])
      for (const y of [TEE - 3, TEE - 2.4]) spots.push({ x, y, kind: 'guard' })
  for (const t of spots)
    for (const spin of spins)
      out.push({ shot: drawTo(t, spin), kind: t.kind, target: { x: t.x, y: t.y } })
  for (const s of stones) {
    if (s.team === team) continue
    for (const spin of spins)
      for (const speed of level === 'easy' ? [6.5] : [5.6, 7])
        for (const off of level === 'easy' ? [0] : [-0.09, 0, 0.09])
          out.push({
            shot: hitAt({ x: s.x + off, y: s.y }, spin, speed),
            kind: 'hit',
            target: { x: s.x, y: s.y },
          })
  }
  return out
}
const normal = (rand: () => number) => (rand() + rand() + rand() + rand() - 2) / 0.577
export function wobble(shot: Shot, level: Level, rand: () => number): Shot {
  const h = HANDS[level]
  return {
    angle: shot.angle + normal(rand) * h.angle,
    speed: shot.speed * (1 + normal(rand) * h.speed),
    spin: shot.spin,
  }
}
/** the computer throws a plan with its own hand, and its sweepers sweep if they sweep */
export function throwPlan(
  stones: readonly Stone[],
  plan: Plan,
  team: Team,
  level: Level,
  rand: () => number,
  keep = false,
) {
  const sweeper = HANDS[level].sweeps && plan.kind !== 'hit' ? sweepTo(plan.target) : null
  return slide(stones, wobble(plan.shot, level, rand), team, sweeper, keep)
}
/** the computer's choice of shot: the best as thrown; Easy takes one of the best three */
export function choose(
  stones: readonly Stone[],
  team: Team,
  level: Level,
  /** whether this is the end's very last stone, when only the score matters */
  last: boolean,
  rand: () => number,
): Plan {
  const scored = candidates(stones, team, level).map((p) => ({
    p,
    v: value(slide(stones, p.shot, team, null).stones, team, last),
  }))
  scored.sort((a, b) => b.v - a.v)
  if (level === 'easy') return scored[Math.floor(rand() * Math.min(3, scored.length))].p
  return scored[0].p
}

/* --------------------------------------------------------------------------- a game */

export type Game = {
  ends: number
  /** the score after each end played: [yours, the computer's] */
  scores: [number, number][]
  /** who throws last in the end being played */
  hammer: Team
  stones: Stone[]
  /** stones thrown this end */
  thrown: number
  over: boolean
}
export const newGame = (ends: number, hammer: Team = 0): Game => ({
  ends,
  scores: [],
  hammer,
  stones: [],
  thrown: 0,
  over: false,
})
/** whose throw it is: the side without the hammer throws first, and they alternate */
export const toThrow = (g: Game): Team => (g.thrown % 2 === 0 ? 1 - g.hammer : g.hammer) as Team
/** stones a team has still to throw this end */
export const left = (g: Game, team: Team) => {
  const first = (1 - g.hammer) as Team
  const thrownBy = team === first ? Math.ceil(g.thrown / 2) : Math.floor(g.thrown / 2)
  return STONES_EACH - thrownBy
}
export const totals = (g: Game): [number, number] =>
  g.scores.reduce<[number, number]>((t, s) => [t[0] + s[0], t[1] + s[1]], [0, 0])
/**
 * After a stone comes to rest: the next throw, or the end scored. The side that scores gives the
 * hammer to the other; a blank end keeps it where it was. Level after the last end, one extra end
 * is played, and level after that is a draw.
 */
export function after(
  g: Game,
  stones: Stone[],
): { game: Game; ended: ReturnType<typeof count> | null } {
  const thrown = g.thrown + 1
  if (thrown < STONES_EACH * 2) return { game: { ...g, stones, thrown }, ended: null }
  const c = count(stones)
  const pts: [number, number] = [0, 0]
  if (c.team !== null) pts[c.team] = c.points
  const scores = [...g.scores, pts]
  const hammer: Team = c.team === null ? g.hammer : c.team === 0 ? 1 : 0
  const t = scores.reduce((a, s) => [a[0] + s[0], a[1] + s[1]], [0, 0])
  const over = scores.length >= g.ends + 1 || (scores.length >= g.ends && t[0] !== t[1])
  return { game: { ...g, scores, hammer, stones: [], thrown: 0, over }, ended: c }
}
export function winner(g: Game): Team | 'draw' | null {
  if (!g.over) return null
  const [a, b] = totals(g)
  return a === b ? 'draw' : a > b ? 0 : 1
}
/** a whole game between two levels, for the tests */
export function match(a: Level, b: Level, seed: number, ends = 4) {
  const rand = rng(seed)
  let g = newGame(ends, (seed & 1) as Team)
  const lv: [Level, Level] = [a, b]
  while (!g.over) {
    const team = toThrow(g)
    const plan = choose(g.stones, team, lv[team], g.thrown === STONES_EACH * 2 - 1, rand)
    g = after(g, throwPlan(g.stones, plan, team, lv[team], rand).stones).game
  }
  return { winner: winner(g), totals: totals(g) }
}

/* --------------------------------------------------------------------------- what is kept */

export const CURLING_KEY = 'lab_curling_v1'
export const ICES = ['arena', 'pond', 'night'] as const
export const END_COUNTS = [4, 6] as const
export type Tally = { won: number; lost: number; drawn: number; bestEnd: number }
export type Saved = {
  level: Level
  ice: (typeof ICES)[number]
  ends: (typeof END_COUNTS)[number]
  /** show where your throw would come to rest on an empty sheet */
  line: boolean
  record: Record<Level, Tally>
}
const NONE: Tally = { won: 0, lost: 0, drawn: 0, bestEnd: 0 }
export const EMPTY: Saved = {
  level: 'fair',
  ice: 'arena',
  ends: 4,
  line: true,
  record: { easy: NONE, fair: NONE, hard: NONE },
}
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
      drawn: whole(x.drawn),
      bestEnd: Math.min(STONES_EACH, whole(x.bestEnd)),
    }
  }
  return {
    level: pick(LEVELS, o.level, EMPTY.level),
    ice: pick(ICES, o.ice, EMPTY.ice),
    ends: pick(END_COUNTS, o.ends, EMPTY.ends),
    line: typeof o.line === 'boolean' ? o.line : EMPTY.line,
    record,
  }
}
