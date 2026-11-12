/**
 * Putt: mini golf on holes laid out in tiles, against a computer that plays each hole after you.
 * Grass rolls, sand drags, water costs a stroke and puts you back where you played from, and walls
 * bounce. Fewest strokes over the round wins. Holes are ten tiles wide and fifteen tall — the
 * shape of a phone held upright — and you can draw your own and send them by link.
 *
 * Pure, so putt.test.ts can sink a few thousand putts without a page. Lengths are in tiles and
 * times in seconds.
 */

import { whole } from './kept'
export const W = 10
export const H = 15
/** the ball's radius, and the cup's: a ball whose centre is over the cup and is slow enough drops */
export const BALL = 0.16
export const CUP = 0.27
/** fastest a ball can be going and still drop rather than run over the cup */
export const SINK_SPEED = 6.5
/** fastest a putt can be struck, in tiles a second */
export const MAX_SPEED = 13
const STEP = 1 / 120
const BOUNCE = 0.72

export type Tile = 'x' | 'g' | 's' | 'w'
export type Pt = { x: number; y: number }
export type Hole = { name: string; tiles: Tile[]; tee: Pt; cup: Pt }
export const at = (h: Hole, tx: number, ty: number): Tile =>
  tx < 0 || ty < 0 || tx >= W || ty >= H ? 'x' : h.tiles[ty * W + tx]
export const tileOf = (h: Hole, p: Pt) => at(h, Math.floor(p.x), Math.floor(p.y))

/* --------------------------------------------------------------------------- holes as text */

/**
 * A hole as fifteen rows of ten: x wall, g grass, s sand, w water, t the tee, o the cup (both on
 * grass). Run-length packed for links — `x13g4…` — so a hole fits in an address.
 */
export function readHole(text: string, name = 'Your hole'): Hole | null {
  const flat = /^[xgswto]{150}$/.test(text) ? text : unpack(text)
  if (!flat || flat.length !== W * H || !/^[xgswto]+$/.test(flat)) return null
  const tees = [...flat.matchAll(/t/g)].map((m) => m.index!)
  const cups = [...flat.matchAll(/o/g)].map((m) => m.index!)
  if (tees.length !== 1 || cups.length !== 1) return null
  const centre = (i: number) => ({ x: (i % W) + 0.5, y: Math.floor(i / W) + 0.5 })
  const tiles = [...flat].map((c) => (c === 't' || c === 'o' ? 'g' : c)) as Tile[]
  const h: Hole = { name, tiles, tee: centre(tees[0]), cup: centre(cups[0]) }
  return Number.isFinite(field(h).at(h.tee)) ? h : null
}
export function writeHole(h: Hole): string {
  const t = Math.floor(h.tee.y) * W + Math.floor(h.tee.x)
  const o = Math.floor(h.cup.y) * W + Math.floor(h.cup.x)
  return h.tiles.map((c, i) => (i === t ? 't' : i === o ? 'o' : c)).join('')
}
export function pack(flat: string): string {
  let out = ''
  for (let i = 0; i < flat.length; ) {
    let j = i
    while (j < flat.length && flat[j] === flat[i]) j++
    out += flat[i] + (j - i > 1 ? String(j - i) : '')
    i = j
  }
  return out
}
function unpack(s: string): string | null {
  if (!/^([xgswto]\d*)+$/.test(s)) return null
  let out = ''
  for (const m of s.matchAll(/([xgswto])(\d*)/g)) {
    const n = m[2] ? Number(m[2]) : 1
    if (n < 1 || out.length + n > W * H) return null
    out += m[1].repeat(n)
  }
  return out
}
/** the built-in holes, drawn as they look: # wall, . grass, s sand, w water, T tee, O cup */
const art = (name: string, rows: string[]) =>
  readHole(
    rows.join('').replace(/#/g, 'x').replace(/\./g, 'g').replace(/T/g, 't').replace(/O/g, 'o'),
    name,
  )!
export const COURSE: Hole[] = [
  art('The straight', [
    '##########',
    '###....###',
    '###..O.###',
    '###....###',
    '###....###',
    '###....###',
    '###....###',
    '###....###',
    '###....###',
    '###....###',
    '###....###',
    '###....###',
    '###..T.###',
    '###....###',
    '##########',
  ]),
  art('Dogleg', [
    '##########',
    '#.....####',
    '#..O..####',
    '#.....####',
    '#.....####',
    '###...####',
    '###...####',
    '###...####',
    '###......#',
    '###......#',
    '###......#',
    '######...#',
    '######.T.#',
    '######...#',
    '##########',
  ]),
  art('Bunkers', [
    '##########',
    '##......##',
    '##..O...##',
    '##......##',
    '##ssss..##',
    '##ssss..##',
    '##......##',
    '##......##',
    '##..ssss##',
    '##..ssss##',
    '##......##',
    '##......##',
    '##...T..##',
    '##......##',
    '##########',
  ]),
  art('The pond', [
    '##########',
    '#........#',
    '#...O....#',
    '#........#',
    '#wwwwww..#',
    '#wwwwww..#',
    '#wwwwww..#',
    '#........#',
    '#........#',
    '#..wwwwww#',
    '#..wwwwww#',
    '#........#',
    '#....T...#',
    '#........#',
    '##########',
  ]),
  art('Pinball', [
    '##########',
    '#........#',
    '#...O....#',
    '#..#..#..#',
    '#........#',
    '#.#.##.#.#',
    '#........#',
    '#..#..#..#',
    '#........#',
    '#.#.##.#.#',
    '#........#',
    '#..#..#..#',
    '#........#',
    '#....T...#',
    '##########',
  ]),
  art('Switchback', [
    '##########',
    '#.......O#',
    '#........#',
    '#######..#',
    '#........#',
    '#........#',
    '#..#######',
    '#........#',
    '#........#',
    '#######..#',
    '#........#',
    '#........#',
    '#T.......#',
    '#........#',
    '##########',
  ]),
]

/* --------------------------------------------------------------------------- rolling */

export type Roll = {
  /** where the ball came to rest, or where it was played from again after water */
  end: Pt
  sunk: boolean
  wet: boolean
  /** positions every frame (1/60 s), when asked for */
  frames: number[]
}
const DRAG = { g: 2.1, s: 9, x: 0, w: 0 } as const

/** play a putt from `from`: an angle in radians (0 points right, down the screen is positive) */
export function roll(h: Hole, from: Pt, angle: number, power: number, keep = false): Roll {
  const p = Math.max(0, Math.min(1, power))
  let x = from.x
  let y = from.y
  let vx = Math.cos(angle) * p * MAX_SPEED
  let vy = Math.sin(angle) * p * MAX_SPEED
  const frames: number[] = keep ? [x, y] : []
  for (let i = 1; i <= 12 / STEP; i++) {
    const t = tileOf(h, { x, y })
    const speed = Math.hypot(vx, vy)
    // rolling resistance, plus a little that grows with speed so a hard putt does not run for ever
    const slow = (DRAG[t] + 0.22 * speed) * STEP
    if (speed <= slow) {
      vx = 0
      vy = 0
    } else {
      vx -= (vx / speed) * slow
      vy -= (vy / speed) * slow
    }
    x += vx * STEP
    y += vy * STEP
    // walls: push the ball out of any wall tile it overlaps and send it back off the face it met
    for (let ty = Math.floor(y - BALL); ty <= Math.floor(y + BALL); ty++)
      for (let tx = Math.floor(x - BALL); tx <= Math.floor(x + BALL); tx++) {
        if (at(h, tx, ty) !== 'x') continue
        const qx = Math.max(tx, Math.min(tx + 1, x))
        const qy = Math.max(ty, Math.min(ty + 1, y))
        const dx = x - qx
        const dy = y - qy
        const d = Math.hypot(dx, dy)
        if (d >= BALL || d === 0) continue
        const nx = dx / d
        const ny = dy / d
        x = qx + nx * BALL
        y = qy + ny * BALL
        const vn = vx * nx + vy * ny
        if (vn < 0) {
          vx -= (1 + BOUNCE) * vn * nx
          vy -= (1 + BOUNCE) * vn * ny
        }
      }
    if (keep && i % 2 === 0) frames.push(x, y)
    const s = Math.hypot(vx, vy)
    if (Math.hypot(x - h.cup.x, y - h.cup.y) < CUP && s < SINK_SPEED) {
      if (keep) frames.push(h.cup.x, h.cup.y)
      return { end: { ...h.cup }, sunk: true, wet: false, frames }
    }
    if (tileOf(h, { x, y }) === 'w') {
      if (keep) frames.push(x, y)
      return { end: { ...from }, sunk: false, wet: true, frames }
    }
    if (s === 0) break
  }
  if (keep) frames.push(x, y)
  return { end: { x, y }, sunk: false, wet: false, frames }
}

/* --------------------------------------------------------------------------- the computer */

/**
 * How far a point is from the cup the way a ball has to go: a shortest path over tile centres,
 * eight ways but never cutting a wall's corner, with sand counting double and a half. Water and
 * walls are not crossed at all. Inside the cup's own tile it is the straight distance.
 */
export function field(h: Hole) {
  const d = new Float64Array(W * H).fill(Infinity)
  const start = Math.floor(h.cup.y) * W + Math.floor(h.cup.x)
  d[start] = 0
  const done = new Uint8Array(W * H)
  for (;;) {
    let k = -1
    for (let i = 0; i < W * H; i++) if (!done[i] && d[i] < Infinity && (k < 0 || d[i] < d[k])) k = i
    if (k < 0) break
    done[k] = 1
    const kx = k % W
    const ky = (k / W) | 0
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const t = at(h, kx + dx, ky + dy)
        if (t === 'x' || t === 'w') continue
        if (dx && dy && (at(h, kx + dx, ky) !== 'g' || at(h, kx, ky + dy) !== 'g')) continue
        const step = (dx && dy ? Math.SQRT2 : 1) * (t === 's' ? 2.5 : 1)
        const j = (ky + dy) * W + kx + dx
        if (d[k] + step < d[j]) d[j] = d[k] + step
      }
  }
  return {
    at(p: Pt): number {
      const tx = Math.floor(p.x)
      const ty = Math.floor(p.y)
      const base = at(h, tx, ty) === 'x' ? Infinity : d[ty * W + tx]
      // within a tile, nearer the cup's side counts a little closer
      return base + Math.hypot(p.x - h.cup.x, p.y - h.cup.y) * 0.05
    },
  }
}

export const LEVELS = ['easy', 'fair', 'hard'] as const
export type Level = (typeof LEVELS)[number]
/**
 * How each level plays: how many directions and strengths it tries, and how steady its hand is —
 * the spread of its aim in radians and of its strength as a fraction. All three judge a putt the
 * same way; Hard also tries again at finer steps around its best.
 */
const HANDS: Record<Level, { angles: number; powers: number; aim: number; push: number }> = {
  easy: { angles: 24, powers: 5, aim: 0.09, push: 0.16 },
  fair: { angles: 48, powers: 8, aim: 0.035, push: 0.07 },
  hard: { angles: 96, powers: 12, aim: 0.012, push: 0.025 },
}
/** how good a putt's result is: lower is better, and in the cup is best of all */
function worth(h: Hole, f: ReturnType<typeof field>, from: Pt, r: Roll): number {
  if (r.sunk) return -100
  // a stroke lost, and the same distance again
  if (r.wet) return f.at(from) + 3
  return f.at(r.end) + (tileOf(h, r.end) === 's' ? 1.5 : 0)
}
/**
 * The putt the computer means to play, before its hand wobbles. It tries every direction and
 * strength on its grid, then takes its few best and asks how each comes off under its OWN
 * wobble — nine putts at one spread either side of aim and strength — and plays the one that is
 * best on average. Without that, the best single putt is nearly always the gentlest one that just
 * drops, and any wobble leaves it short: measured, Hard took 1.83 strokes a hole on a straight
 * corridor it should hole in one.
 */
export function plan(h: Hole, from: Pt, level: Level): { angle: number; power: number } {
  const { angles, powers, aim, push } = HANDS[level]
  const f = field(h)
  const once = (angle: number, power: number) =>
    worth(h, f, from, roll(h, from, angle, power)) + power * 0.01
  const tried: { angle: number; power: number; v: number }[] = []
  for (let a = 0; a < angles; a++)
    for (let p = 1; p <= powers; p++) {
      const angle = (a / angles) * Math.PI * 2
      const power = p / powers
      tried.push({ angle, power, v: once(angle, power) })
    }
  if (level === 'hard') {
    tried.sort((x, y) => x.v - y.v)
    const { angle, power } = tried[0]
    for (let da = -4; da <= 4; da++)
      for (let dp = -3; dp <= 3; dp++) {
        const a2 = angle + (da * Math.PI) / (angles * 4)
        const p2 = Math.max(0.02, Math.min(1, power + dp / (powers * 4)))
        tried.push({ angle: a2, power: p2, v: once(a2, p2) })
      }
  }
  tried.sort((x, y) => x.v - y.v)
  let best = tried[0]
  let bv = Infinity
  for (const c of tried.slice(0, 10)) {
    let sum = 0
    for (const da of [-1, 0, 1])
      for (const dp of [-1, 0, 1])
        sum += once(c.angle + da * aim, Math.min(1, c.power * (1 + dp * push)))
    if (sum / 9 < bv) {
      bv = sum / 9
      best = c
    }
  }
  return { angle: best.angle, power: best.power }
}
/** the putt the computer actually plays: its plan, with its own hand's wobble */
export function stroke(h: Hole, from: Pt, level: Level, rand: () => number = Math.random) {
  const { angle, power } = plan(h, from, level)
  const { aim, push } = HANDS[level]
  const wobble = () => (rand() + rand() + rand() - 1.5) / 1.5
  return {
    angle: angle + wobble() * aim,
    power: Math.max(0.03, Math.min(1, power * (1 + wobble() * push))),
  }
}
/** most strokes on a hole before the ball is picked up and the hole scored at that */
export const PICK_UP = 8
/** play a whole hole for the computer: every putt, in order, and the strokes it took */
export function playHole(h: Hole, level: Level, rand: () => number = Math.random) {
  let at: Pt = { ...h.tee }
  const putts: { from: Pt; angle: number; power: number; roll: Roll }[] = []
  let strokes = 0
  while (strokes < PICK_UP) {
    const s = stroke(h, at, level, rand)
    const r = roll(h, at, s.angle, s.power)
    putts.push({ from: at, ...s, roll: r })
    strokes += r.wet ? 2 : 1
    if (r.sunk) break
    at = r.end
  }
  return { putts, strokes: Math.min(strokes, PICK_UP) }
}
/* --------------------------------------------------------------------------- what is kept */

export const PUTT_KEY = 'lab_putt_v1'
export const THEMES = ['links', 'night', 'candy'] as const
export const MAX_HOLES = 9
export type Tally = { won: number; lost: number; tied: number; best: number }
export type Saved = {
  level: Level
  theme: (typeof THEMES)[number]
  /** show where a putt would first go, as a dotted line to its first bounce */
  guide: boolean
  /** holes you have drawn, as text */
  holes: string[]
  /** per level: rounds won, lost and tied, and your fewest strokes for the built-in course */
  record: Record<Level, Tally>
}
const NONE: Tally = { won: 0, lost: 0, tied: 0, best: 0 }
export const EMPTY: Saved = {
  level: 'fair',
  theme: 'links',
  guide: true,
  holes: [],
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
    record[l] = { won: whole(x.won), lost: whole(x.lost), tied: whole(x.tied), best: whole(x.best) }
  }
  const holes = Array.isArray(o.holes)
    ? o.holes.filter((s): s is string => typeof s === 'string' && readHole(s) !== null)
    : []
  return {
    level: pick(LEVELS, o.level, EMPTY.level),
    theme: pick(THEMES, o.theme, EMPTY.theme),
    guide: typeof o.guide === 'boolean' ? o.guide : EMPTY.guide,
    holes: holes.slice(0, MAX_HOLES),
    record,
  }
}
