/**
 * Light trails: every rider moves one square a tick and leaves a wall behind; touch a wall, a
 * trail or the arena's edge and you are out. The last one riding wins the round. Pure, so
 * trails.test.ts can run whole rounds between computers without a page; TrailsDemo draws it.
 *
 * ⚠️ EVERYONE MOVES AT ONCE. A tick works out every rider's next square first and only then
 * decides who crashed, so two riders turning into the same square both go out, and nobody wins a
 * race to a square by being earlier in a list. A rider going out leaves its trail where it is.
 */

import { rng } from './bricks'

export type Dir = 0 | 1 | 2 | 3 // up, right, down, left
export const DX = [0, 1, 0, -1] as const
export const DY = [-1, 0, 1, 0] as const
export type Rider = { x: number; y: number; dir: Dir; alive: boolean }
/** 0 empty, 1 a block, 2 + k a square rider k has ridden over */
export type Arena = { w: number; h: number; cells: Uint8Array; riders: Rider[]; ticks: number }

export const ARENAS = { small: [32, 24], medium: [44, 32], large: [56, 40] } as const
export type ArenaSize = keyof typeof ARENAS
export const LAYOUTS = ['open', 'pillars', 'scatter'] as const
export type Layout = (typeof LAYOUTS)[number]

/** the riders start spread round the arena, facing in; up to four of them */
export function newArena(size: ArenaSize, riders: number, layout: Layout, seed = 1): Arena {
  const [w, h] = ARENAS[size]
  const cells = new Uint8Array(w * h)
  const starts: Rider[] = [
    { x: Math.floor(w / 2), y: h - 4, dir: 0, alive: true },
    { x: Math.floor(w / 2), y: 3, dir: 2, alive: true },
    { x: 3, y: Math.floor(h / 2), dir: 1, alive: true },
    { x: w - 4, y: Math.floor(h / 2), dir: 3, alive: true },
  ].slice(0, riders) as Rider[]
  const clearOfStarts = (x: number, y: number) =>
    starts.every((r) => Math.abs(r.x - x) > 4 || Math.abs(r.y - y) > 6)
  if (layout === 'pillars') {
    for (const [fx, fy] of [
      [0.25, 0.3],
      [0.75, 0.3],
      [0.25, 0.7],
      [0.75, 0.7],
      [0.5, 0.5],
    ]) {
      const cx = Math.floor(w * fx)
      const cy = Math.floor(h * fy)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (clearOfStarts(cx + dx, cy + dy)) cells[(cy + dy) * w + cx + dx] = 1
    }
  } else if (layout === 'scatter') {
    const rand = rng(seed)
    for (let k = 0; k < Math.floor((w * h) / 60); k++) {
      const x = 2 + Math.floor(rand() * (w - 4))
      const y = 2 + Math.floor(rand() * (h - 4))
      if (clearOfStarts(x, y)) cells[y * w + x] = 1
    }
  }
  starts.forEach((r, k) => (cells[r.y * w + r.x] = 2 + k))
  return { w, h, cells, riders: starts.map((r) => ({ ...r })), ticks: 0 }
}

export const free = (a: Arena, x: number, y: number) =>
  x >= 0 && y >= 0 && x < a.w && y < a.h && a.cells[y * a.w + x] === 0
/** a rider may turn left or right, never straight back into its own trail */
export const turnable = (from: Dir, to: Dir) => (from + 2) % 4 !== to

/** one tick: each living rider takes its chosen direction and moves one square */
export function tick(a: Arena, dirs: (Dir | null)[]): number[] {
  const next = a.riders.map((r, k) => {
    if (!r.alive) return null
    const d = dirs[k]
    if (d !== null && d !== undefined && turnable(r.dir, d)) r.dir = d
    return { x: r.x + DX[r.dir], y: r.y + DY[r.dir] }
  })
  const out: number[] = []
  next.forEach((p, k) => {
    if (!p) return
    const crash =
      !free(a, p.x, p.y) || next.some((q, j) => j !== k && q && q.x === p.x && q.y === p.y)
    if (crash) out.push(k)
  })
  next.forEach((p, k) => {
    if (!p) return
    if (out.includes(k)) {
      a.riders[k].alive = false
      return
    }
    a.riders[k].x = p.x
    a.riders[k].y = p.y
    a.cells[p.y * a.w + p.x] = 2 + k
  })
  a.ticks++
  return out
}
export const living = (a: Arena) => a.riders.filter((r) => r.alive).length

/* ---------------------------------------------------------------------------- the computer */

export const LEVELS = ['easy', 'fair', 'hard'] as const
export type Level = (typeof LEVELS)[number]

/** how many empty squares can be reached from (x, y), counting no further than `cap` */
export function room(a: Arena, x: number, y: number, cap = 4000, blocked?: Set<number>): number {
  if (!free(a, x, y) || blocked?.has(y * a.w + x)) return 0
  const seen = new Uint8Array(a.w * a.h)
  const queue = [y * a.w + x]
  seen[queue[0]] = 1
  let n = 0
  while (queue.length && n < cap) {
    const c = queue.pop()!
    n++
    const cx = c % a.w
    const cy = (c - cx) / a.w
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d]
      const ny = cy + DY[d]
      if (!free(a, nx, ny)) continue
      const k = ny * a.w + nx
      if (seen[k] || blocked?.has(k)) continue
      seen[k] = 1
      queue.push(k)
    }
  }
  return n
}

/**
 * The squares each rider would reach first, riding outward from every head at once: a measure of
 * whose territory the arena is. Returns how many of them are rider `me`'s, less its best rival's.
 */
function territory(a: Arena, me: number, from: { x: number; y: number }): number {
  const owner = new Int8Array(a.w * a.h).fill(-1)
  const dist = new Int32Array(a.w * a.h).fill(-1)
  const counts = new Array(a.riders.length).fill(0)
  let frontier: number[] = []
  a.riders.forEach((r, k) => {
    if (!r.alive && k !== me) return
    const p = k === me ? from : r
    const c = p.y * a.w + p.x
    owner[c] = owner[c] === -1 ? k : -2
    dist[c] = 0
    frontier.push(c)
  })
  for (let layer = 0; frontier.length; layer++) {
    const next: number[] = []
    for (const c of frontier) {
      const k = owner[c]
      if (k < 0) continue
      const cx = c % a.w
      const cy = (c - cx) / a.w
      for (let d = 0; d < 4; d++) {
        const nx = cx + DX[d]
        const ny = cy + DY[d]
        if (!free(a, nx, ny)) continue
        const n = ny * a.w + nx
        if (dist[n] === -1) {
          dist[n] = layer + 1
          owner[n] = k
          counts[k]++
          next.push(n)
        } else if (dist[n] === layer + 1 && owner[n] !== k && owner[n] >= 0) {
          // reached by two riders at the same moment: nobody's
          counts[owner[n]]--
          owner[n] = -2
        }
      }
    }
    frontier = next
  }
  let rival = 0
  counts.forEach((v, k) => {
    if (k !== me && a.riders[k].alive) rival = Math.max(rival, v)
  })
  return counts[me] - rival
}

/**
 * A computer rider's direction. Easy only avoids hitting something next tick, and turns at random
 * now and then. Fair goes where it has the most room, so it does not ride into a pocket. Hard
 * weighs room and then territory — how much of the arena it would reach before anyone else —
 * which makes it cut across in front of you.
 */
export function steer(a: Arena, k: number, level: Level, rand: () => number): Dir {
  const r = a.riders[k]
  const options = ([0, 1, 2, 3] as Dir[]).filter((d) => turnable(r.dir, d))
  const safe = options.filter((d) => free(a, r.x + DX[d], r.y + DY[d]))
  if (!safe.length) return r.dir
  if (level === 'easy') {
    if (safe.includes(r.dir) && rand() > 0.08) return r.dir
    return safe[Math.floor(rand() * safe.length)]
  }
  // squares any rival could move into next tick are risky to share
  const contested = new Set<number>()
  a.riders.forEach((o, j) => {
    if (j === k || !o.alive) return
    for (let d = 0; d < 4; d++) contested.add((o.y + DY[d]) * a.w + o.x + DX[d])
  })
  let best: Dir[] = []
  let bv = -Infinity
  for (const d of safe) {
    const x = r.x + DX[d]
    const y = r.y + DY[d]
    let v = room(a, x, y, 2000) * 10
    if (contested.has(y * a.w + x)) v -= 5000
    if (level === 'hard' && v > 0) v += territory(a, k, { x, y }) * 3
    if (d === r.dir) v += 1
    if (v > bv) {
      bv = v
      best = [d]
    } else if (v === bv) best.push(d)
  }
  return best[Math.floor(rand() * best.length)]
}

/* ---------------------------------------------------------------------------- what is kept */

export const TRAILS_KEY = 'lab_trails_v1'
export const SPEEDS = { steady: 9, quick: 13, frantic: 18 } as const
export type Speed = keyof typeof SPEEDS
export const COLOURS = ['#21d4fd', '#ff3d7f', '#ffd23f', '#3ddc97', '#b28dff', '#ff8c42'] as const
export type Tally = { won: number; lost: number; rounds: number; longest: number }
export type Saved = {
  level: Level
  size: ArenaSize
  layout: Layout
  rivals: 1 | 2 | 3
  speed: Speed
  colour: number
  glow: boolean
  record: Record<Level, Tally>
}
const NONE: Tally = { won: 0, lost: 0, rounds: 0, longest: 0 }
export const EMPTY: Saved = {
  level: 'fair',
  size: 'medium',
  layout: 'open',
  rivals: 1,
  speed: 'quick',
  colour: 0,
  glow: true,
  record: { easy: NONE, fair: NONE, hard: NONE },
}
/** a round is over: `ticks` is how long you lasted in it */
export function recordRound(r: Tally, won: boolean, ticks: number): Tally {
  return {
    won: r.won + (won ? 1 : 0),
    lost: r.lost + (won ? 0 : 1),
    rounds: r.rounds + 1,
    longest: Math.max(r.longest, ticks),
  }
}
const count = (v: unknown) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e7 ? v : 0
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
      won: count(x.won),
      lost: count(x.lost),
      rounds: count(x.rounds),
      longest: count(x.longest),
    }
  }
  return {
    level: pick(LEVELS, o.level, EMPTY.level),
    size: pick(Object.keys(ARENAS) as ArenaSize[], o.size, EMPTY.size),
    layout: pick(LAYOUTS, o.layout, EMPTY.layout),
    rivals: pick([1, 2, 3] as const, o.rivals, EMPTY.rivals),
    speed: pick(Object.keys(SPEEDS) as Speed[], o.speed, EMPTY.speed),
    colour:
      typeof o.colour === 'number' &&
      Number.isInteger(o.colour) &&
      o.colour >= 0 &&
      o.colour < COLOURS.length
        ? o.colour
        : EMPTY.colour,
    glow: typeof o.glow === 'boolean' ? o.glow : EMPTY.glow,
    record,
  }
}
