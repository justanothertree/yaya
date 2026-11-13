/**
 * Towers: creatures walk a winding path across a field and you build towers beside it to stop
 * them. Each wave is bigger and tougher; every creature that reaches the far side costs a life,
 * and the score is how many waves you hold. Pure — the maps, the walking, the towers, the money
 * and the waves — so towers.test.ts can play whole games at any speed without a page.
 *
 * The field is a grid of cells, 1 unit each; the path is a list of cells from the left edge to
 * the right edge, and a creature's place on it is a distance along it.
 */
import { rng } from './bricks'
import { whole } from './kept'

export const COLS = 12
export const ROWS = 8
export type Cell = { c: number; r: number }
export type GameMap = { id: string; name: string; path: Cell[] }

/** a path through the given turning cells, filled in cell by cell */
function walk(turns: Cell[]): Cell[] {
  const out: Cell[] = [turns[0]]
  for (let k = 1; k < turns.length; k++) {
    let { c, r } = out[out.length - 1]
    const t = turns[k]
    while (c !== t.c || r !== t.r) {
      if (c !== t.c) c += Math.sign(t.c - c)
      else r += Math.sign(t.r - r)
      out.push({ c, r })
    }
  }
  return out
}
export const MAPS: GameMap[] = [
  {
    id: 'meadow',
    name: 'Meadow',
    path: walk([
      { c: 0, r: 1 },
      { c: 4, r: 1 },
      { c: 4, r: 6 },
      { c: 8, r: 6 },
      { c: 8, r: 2 },
      { c: 11, r: 2 },
    ]),
  },
  {
    id: 'zigzag',
    name: 'Zigzag',
    path: walk([
      { c: 0, r: 6 },
      { c: 2, r: 6 },
      { c: 2, r: 1 },
      { c: 5, r: 1 },
      { c: 5, r: 6 },
      { c: 8, r: 6 },
      { c: 8, r: 1 },
      { c: 11, r: 1 },
    ]),
  },
  {
    id: 'river',
    name: 'River',
    path: walk([
      { c: 0, r: 3 },
      { c: 3, r: 3 },
      { c: 3, r: 0 },
      { c: 6, r: 0 },
      { c: 6, r: 4 },
      { c: 9, r: 4 },
      { c: 9, r: 7 },
      { c: 11, r: 7 },
    ]),
  },
]

/** a path for a day: a walk from the left edge to the right that never touches itself */
export function dailyMap(seed: number): GameMap {
  const rand = rng(seed)
  for (let tries = 0; ; tries++) {
    const turns: Cell[] = [{ c: 0, r: 1 + Math.floor(rand() * (ROWS - 2)) }]
    let c = 0
    while (c < COLS - 1) {
      // across a few cells, then up or down a few, never back
      c = Math.min(COLS - 1, c + 2 + Math.floor(rand() * 3))
      turns.push({ c, r: turns[turns.length - 1].r })
      if (c < COLS - 1) {
        const r = Math.floor(rand() * ROWS)
        turns.push({ c, r })
      }
    }
    const path = walk(turns)
    const seen = new Set(path.map((p) => `${p.c},${p.r}`))
    if ((seen.size === path.length && path.length >= 18) || tries > 100)
      return { id: `day-${seed}`, name: "Today's field", path }
  }
}

/* ---------------------------------------------------------------------------- the pieces */

export type Kind = 'dart' | 'cannon' | 'frost'
export const KINDS: Kind[] = ['dart', 'cannon', 'frost']
/** a tower's numbers at each of its three levels: cost to build or raise, reach, shots a second, damage */
export const SPEC: Record<
  Kind,
  {
    cost: number[]
    range: number[]
    rate: number[]
    damage: number[]
    splash: number
    slow: number
  }
> = {
  dart: {
    cost: [50, 60, 110],
    range: [2.4, 2.7, 3.0],
    rate: [2.2, 2.8, 3.6],
    damage: [4, 6, 10],
    splash: 0,
    slow: 0,
  },
  cannon: {
    cost: [90, 90, 160],
    range: [2.1, 2.3, 2.6],
    rate: [0.7, 0.8, 0.95],
    damage: [10, 16, 28],
    splash: 0.9,
    slow: 0,
  },
  frost: {
    cost: [70, 70, 120],
    range: [2.0, 2.3, 2.6],
    rate: [1.2, 1.4, 1.7],
    damage: [1, 2, 3],
    splash: 0.8,
    slow: 0.45,
  },
}
export type Tower = { kind: Kind; c: number; r: number; level: number; wait: number; spent: number }
export type Foe = {
  id: number
  kind: 'walker' | 'runner' | 'brute'
  d: number
  life: number
  full: number
  speed: number
  chill: number
  bounty: number
}
export type Shot = { from: Cell; to: { x: number; y: number }; kind: Kind; age: number }
export type Game = {
  map: GameMap
  towers: Tower[]
  foes: Foe[]
  coins: number
  lives: number
  wave: number
  /** creatures still to come in this wave, and the time until the next */
  queue: Foe['kind'][]
  gap: number
  /** between waves, seconds until the next starts on its own */
  rest: number
  next: number
  kills: number
  over: boolean
  shots: Shot[]
}
export const START_COINS = 160
export const LIVES = 20
export function newGame(map: GameMap): Game {
  return {
    map,
    towers: [],
    foes: [],
    coins: START_COINS,
    lives: LIVES,
    wave: 0,
    queue: [],
    gap: 0,
    rest: 8,
    next: 1,
    kills: 0,
    over: false,
    shots: [],
  }
}

/** where a distance along the path is, in field units (cell centres at half-integers) */
export function at(map: GameMap, d: number): { x: number; y: number } {
  const p = map.path
  const i = Math.max(0, Math.min(p.length - 1, Math.floor(d)))
  const j = Math.min(p.length - 1, i + 1)
  const u = Math.max(0, Math.min(1, d - i))
  return { x: p[i].c + 0.5 + (p[j].c - p[i].c) * u, y: p[i].r + 0.5 + (p[j].r - p[i].r) * u }
}
export const onPath = (map: GameMap, c: number, r: number) =>
  map.path.some((p) => p.c === c && p.r === r)

/** what a wave holds: more creatures each time, runners from the third, brutes from the fifth */
export function waveOf(n: number): Foe['kind'][] {
  const out: Foe['kind'][] = []
  const count = 6 + n * 2
  for (let k = 0; k < count; k++) {
    if (n >= 5 && k % 5 === 4) out.push('brute')
    else if (n >= 3 && k % 3 === 2) out.push('runner')
    else out.push('walker')
  }
  return out
}
/** creatures get tougher each wave, so towers that only just held the last one will not hold this */
const FOE = {
  walker: { life: 12, speed: 1.1, bounty: 6 },
  runner: { life: 8, speed: 2.0, bounty: 7 },
  brute: { life: 60, speed: 0.7, bounty: 20 },
}
const toughness = (wave: number) => 1.18 ** (wave - 1)

/* ---------------------------------------------------------------------------- building */

export function canBuild(g: Game, c: number, r: number, kind: Kind): boolean {
  return (
    c >= 0 &&
    c < COLS &&
    r >= 0 &&
    r < ROWS &&
    !onPath(g.map, c, r) &&
    !g.towers.some((t) => t.c === c && t.r === r) &&
    g.coins >= SPEC[kind].cost[0] &&
    !g.over
  )
}
export function build(g: Game, c: number, r: number, kind: Kind): Game {
  if (!canBuild(g, c, r, kind)) return g
  const cost = SPEC[kind].cost[0]
  return {
    ...g,
    coins: g.coins - cost,
    towers: [...g.towers, { kind, c, r, level: 0, wait: 0, spent: cost }],
  }
}
export function upgrade(g: Game, c: number, r: number): Game {
  const t = g.towers.find((x) => x.c === c && x.r === r)
  if (!t || t.level >= 2 || g.over) return g
  const cost = SPEC[t.kind].cost[t.level + 1]
  if (g.coins < cost) return g
  return {
    ...g,
    coins: g.coins - cost,
    towers: g.towers.map((x) =>
      x === t ? { ...x, level: x.level + 1, spent: x.spent + cost } : x,
    ),
  }
}
/** selling gives back two thirds of what went into a tower */
export function sell(g: Game, c: number, r: number): Game {
  const t = g.towers.find((x) => x.c === c && x.r === r)
  if (!t || g.over) return g
  return {
    ...g,
    coins: g.coins + Math.floor((t.spent * 2) / 3),
    towers: g.towers.filter((x) => x !== t),
  }
}

/* ---------------------------------------------------------------------------- the clock */

export type Event = { kind: 'leak' | 'kill' | 'wave' | 'cleared' | 'over'; n?: number }
/** start the next wave now rather than waiting for the rest to run out, for a few coins */
export function callWave(g: Game): Game {
  if (g.queue.length || g.foes.length || g.over) return g
  return { ...g, rest: 0, coins: g.coins + Math.ceil(g.rest * 2) }
}

/** move everything on by `dt` seconds */
export function step(g: Game, dt: number): { game: Game; events: Event[] } {
  if (g.over) return { game: g, events: [] }
  dt = Math.min(dt, 0.1)
  const ev: Event[] = []
  let { coins, lives, wave, queue, gap, rest, next, kills } = g
  let foes = g.foes.map((f) => ({ ...f }))
  // a wave starts when the rest runs out; its creatures come out one at a time
  if (!queue.length && !foes.length) {
    rest -= dt
    if (rest <= 0) {
      wave++
      queue = waveOf(wave)
      gap = 0
      ev.push({ kind: 'wave', n: wave })
    }
  }
  if (queue.length) {
    gap -= dt
    if (gap <= 0) {
      const kind = queue[0]
      queue = queue.slice(1)
      const s = FOE[kind]
      const life = Math.round(s.life * toughness(wave))
      foes.push({
        id: next++,
        kind,
        d: 0,
        life,
        full: life,
        speed: s.speed,
        chill: 0,
        bounty: s.bounty,
      })
      gap = kind === 'brute' ? 1.4 : kind === 'runner' ? 0.55 : 0.8
    }
  }
  // walk, more slowly while chilled; the end of the path costs a life
  const end = g.map.path.length - 0.5
  for (const f of foes) {
    f.chill = Math.max(0, f.chill - dt)
    f.d += f.speed * (f.chill > 0 ? 1 - SPEC.frost.slow : 1) * dt
  }
  const leaked = foes.filter((f) => f.d >= end)
  if (leaked.length) {
    lives -= leaked.reduce((a, f) => a + (f.kind === 'brute' ? 3 : 1), 0)
    ev.push({ kind: 'leak', n: leaked.length })
    foes = foes.filter((f) => f.d < end)
  }
  // towers: the creature furthest along within reach, at each tower's own rate
  const shots = g.shots.map((s) => ({ ...s, age: s.age + dt })).filter((s) => s.age < 0.15)
  const towers = g.towers.map((t) => {
    const s = SPEC[t.kind]
    let wait = t.wait - dt
    if (wait > 0) return { ...t, wait }
    const range = s.range[t.level]
    const tx = t.c + 0.5
    const ty = t.r + 0.5
    let target: Foe | null = null
    for (const f of foes) {
      if (f.life <= 0) continue
      const p = at(g.map, f.d)
      if (Math.hypot(p.x - tx, p.y - ty) <= range && (!target || f.d > target.d)) target = f
    }
    if (!target) return { ...t, wait: 0 }
    const hit = at(g.map, target.d)
    const struck = s.splash
      ? foes.filter(
          (f) =>
            f.life > 0 &&
            Math.hypot(at(g.map, f.d).x - hit.x, at(g.map, f.d).y - hit.y) <= s.splash,
        )
      : [target]
    for (const f of struck) {
      f.life -= s.damage[t.level]
      if (s.slow) f.chill = 1.6
    }
    shots.push({ from: { c: t.c, r: t.r }, to: hit, kind: t.kind, age: 0 })
    wait = 1 / s.rate[t.level]
    return { ...t, wait }
  })
  const dead = foes.filter((f) => f.life <= 0)
  if (dead.length) {
    coins += dead.reduce((a, f) => a + f.bounty, 0)
    kills += dead.length
    ev.push({ kind: 'kill', n: dead.length })
    foes = foes.filter((f) => f.life > 0)
  }
  if (wave > 0 && !queue.length && !foes.length && rest <= 0) {
    // a wave held: a bonus, and a breather before the next
    coins += 20 + wave * 5
    rest = 10
    ev.push({ kind: 'cleared', n: wave })
  }
  const over = lives <= 0
  if (over) ev.push({ kind: 'over' })
  return {
    game: {
      ...g,
      towers,
      foes,
      coins,
      lives: Math.max(0, lives),
      wave,
      queue,
      gap,
      rest,
      next,
      kills,
      over,
      shots,
    },
    events: ev,
  }
}
/** waves held: the score */
export const held = (g: Game) =>
  Math.max(0, g.over ? g.wave - 1 : g.wave - (g.queue.length || g.foes.length ? 1 : 0))

/* ---------------------------------------------------------------------------- what is kept */

export const TOWERS_KEY = 'lab_towers_v1'
export const THEMES = ['meadow', 'desert', 'snow'] as const
export type Saved = {
  map: string
  theme: (typeof THEMES)[number]
  /** the game runs twice as fast */
  fast: boolean
  /** most waves held per map, and today's best */
  best: Record<string, number>
  today: { day: number; waves: number } | null
}
export const EMPTY: Saved = { map: 'meadow', theme: 'meadow', fast: false, best: {}, today: null }
export function readSaved(text: string | null): Saved {
  let v: unknown
  try {
    v = JSON.parse(text ?? 'null')
  } catch {
    return EMPTY
  }
  if (typeof v !== 'object' || !v || Array.isArray(v)) return EMPTY
  const o = v as Record<string, unknown>
  const ids = MAPS.map((m) => m.id)
  const best: Record<string, number> = {}
  const b = (typeof o.best === 'object' && o.best ? o.best : {}) as Record<string, unknown>
  for (const id of ids) if (whole(b[id], 1e5)) best[id] = whole(b[id], 1e5)
  const t = (typeof o.today === 'object' && o.today ? o.today : null) as Record<
    string,
    unknown
  > | null
  return {
    map: ids.includes(o.map as string) || o.map === 'today' ? (o.map as string) : EMPTY.map,
    theme: THEMES.includes(o.theme as Saved['theme']) ? (o.theme as Saved['theme']) : EMPTY.theme,
    fast: typeof o.fast === 'boolean' ? o.fast : EMPTY.fast,
    best,
    today:
      t && whole(t.day, 2 ** 32) && whole(t.waves, 1e5)
        ? { day: whole(t.day, 2 ** 32), waves: whole(t.waves, 1e5) }
        : null,
  }
}
