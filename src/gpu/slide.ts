/**
 * The Lab's ice puzzle. A puck on ice slides in the direction pushed until something stops it: a
 * wall, a rock, the edge — or a patch of snow, which it stops ON. Collect every coin on the way,
 * then come to rest on the goal. Passing over the goal does not count; that is the puzzle.
 *
 * ⚠️ EVERY LEVEL IS ANSWERED BY THE SOLVER, NOT BY ITS DESIGNER. A breadth-first search over
 * (where the puck is, which coins it has) finds the fewest pushes, and that is the level's par,
 * its hint and the test that it can be done at all. The endless mode is the same search run over
 * random boards from a seed until one lands in the difficulty asked for.
 *
 * Pure, so all of it can be asked a question without a browser.
 */

export type Tile = 'ice' | 'wall' | 'snow' | 'goal'
export type Dir = 'up' | 'down' | 'left' | 'right'
export const DIRS: Record<Dir, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
}
const DIR_LIST = Object.keys(DIRS) as Dir[]

export type Board = {
  name: string
  w: number
  h: number
  tiles: Tile[]
  start: [number, number]
  coins: [number, number][]
}

export const MAX_SIDE = 14

/** a board from rows of text: '#' wall, '.' ice, ',' snow, 'G' goal, 'S' start, '*' a coin (on ice) */
export function parse(name: string, art: string): Board {
  const rows = art
    .trim()
    .split('\n')
    .map((r) => r.trim())
  const h = rows.length
  const w = rows[0].length
  const tiles: Tile[] = []
  let start: [number, number] = [0, 0]
  const coins: [number, number][] = []
  rows.forEach((r, y) => {
    if (r.length !== w) throw new Error(`${name}: row ${y + 1} is ${r.length} wide, not ${w}`)
    ;[...r].forEach((ch, x) => {
      if (ch === '#') tiles.push('wall')
      else if (ch === ',') tiles.push('snow')
      else if (ch === 'G') tiles.push('goal')
      else if ('.S*'.includes(ch)) tiles.push('ice')
      else throw new Error(`${name}: no tile called "${ch}"`)
      if (ch === 'S') start = [x, y]
      if (ch === '*') coins.push([x, y])
    })
  })
  return { name, w, h, tiles, start, coins }
}

const tileAt = (b: Board, x: number, y: number): Tile =>
  x < 0 || y < 0 || x >= b.w || y >= b.h ? 'wall' : b.tiles[y * b.w + x]

export type State = { at: [number, number]; got: number }

/**
 * One push: every cell the puck crosses, in order, ending where it stops. It stops in front of a
 * wall or the edge, or on the first snow it enters. A push straight into a wall goes nowhere —
 * `path` is then empty and the move is not counted.
 */
export function slide(b: Board, s: State, d: Dir): { to: State; path: [number, number][] } {
  const [dx, dy] = DIRS[d]
  let [x, y] = s.at
  let got = s.got
  const path: [number, number][] = []
  for (;;) {
    const nx = x + dx
    const ny = y + dy
    if (tileAt(b, nx, ny) === 'wall') break
    x = nx
    y = ny
    path.push([x, y])
    const c = b.coins.findIndex(([cx, cy]) => cx === x && cy === y)
    if (c >= 0) got |= 1 << c
    if (tileAt(b, x, y) === 'snow') break
  }
  return { to: { at: [x, y], got }, path }
}

const all = (b: Board) => (1 << b.coins.length) - 1
/** done: every coin, and at rest on the goal */
export const won = (b: Board, s: State) =>
  s.got === all(b) && tileAt(b, s.at[0], s.at[1]) === 'goal'

const key = (b: Board, s: State) => (s.got * b.h + s.at[1]) * b.w + s.at[0]

/** the fewest pushes from a state to done, and the pushes themselves; null when it cannot be done */
export function solve(b: Board, from: State = { at: b.start, got: 0 }): Dir[] | null {
  if (won(b, from)) return []
  const prev = new Map<number, { k: number; d: Dir }>()
  const start = key(b, from)
  prev.set(start, { k: -1, d: 'up' })
  let frontier: State[] = [from]
  while (frontier.length) {
    const next: State[] = []
    for (const s of frontier)
      for (const d of DIR_LIST) {
        const { to, path } = slide(b, s, d)
        if (!path.length) continue
        const k = key(b, to)
        if (prev.has(k)) continue
        prev.set(k, { k: key(b, s), d })
        if (won(b, to)) {
          const out: Dir[] = []
          for (let at = k; at !== start; at = prev.get(at)!.k) out.push(prev.get(at)!.d)
          return out.reverse()
        }
        next.push(to)
      }
    frontier = next
  }
  return null
}

/* ------------------------------------------------------------------------------- the levels */

export const LEVELS: Board[] = [
  parse(
    'First push',
    `
    #######
    #S...,#
    #.###.#
    #.#G..#
    #######`,
  ),
  parse(
    'Snow stops you',
    `
    #########
    #S......#
    #######.#
    #...G...#
    #...,####
    #########`,
  ),
  parse(
    'Island',
    `
    ##########
    #S.......#
    #..####..#
    #..#G,#..#
    #..#..#..#
    #...,....#
    ##########`,
  ),
  parse(
    'The long way',
    `
    #########
    #S.#....#
    #..#.##.#
    #.,...#.#
    ##.#....#
    #..#.#.G#
    #########`,
  ),
  parse(
    'Pocket money',
    `
    #########
    #S..*..,#
    #.#####.#
    #*..,...#
    ###.###.#
    #G..,...#
    #########`,
  ),
  parse(
    'Collector',
    `
    ##########
    #*..,...*#
    #.##..##.#
    #S..#....#
    #.##.,##.#
    #*..G...*#
    ##########`,
  ),
]

/* ---------------------------------------------------------------------- endless, from a seed */

export function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >> 17
    s ^= s << 5
    s >>>= 0
    return s / 4294967296
  }
}

export const DIFFICULTY = {
  easy: { min: 4, max: 6, size: [8, 7], coins: 1 },
  medium: { min: 7, max: 10, size: [10, 8], coins: 2 },
  hard: { min: 11, max: 16, size: [12, 9], coins: 3 },
} as const
export type Difficulty = keyof typeof DIFFICULTY

/**
 * A board from a seed whose fewest pushes fall in the difficulty's band: random walls, rocks and
 * snow, a start, a goal and some coins, kept only if the solver says so. Deterministic — the same
 * seed and difficulty always give the same board — so a seed can be passed on by word of mouth.
 * Null only if a thousand tries in a row fail, which the tests say does not happen.
 */
export function generate(seed: number, difficulty: Difficulty): Board | null {
  const rand = rng(seed)
  const { min, max, size, coins } = DIFFICULTY[difficulty]
  const [w, h] = size
  for (let attempt = 0; attempt < 1000; attempt++) {
    const tiles: Tile[] = []
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1
        const r = rand()
        tiles.push(edge || r < 0.16 ? 'wall' : r < 0.24 ? 'snow' : 'ice')
      }
    const free: [number, number][] = []
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) if (tiles[y * w + x] === 'ice') free.push([x, y])
    if (free.length < coins + 2) continue
    const pick = () => free.splice(Math.floor(rand() * free.length), 1)[0]
    const start = pick()
    const goal = pick()
    tiles[goal[1] * w + goal[0]] = 'goal'
    const cs = Array.from({ length: coins }, pick)
    const b: Board = { name: `${difficulty} #${seed}`, w, h, tiles, start, coins: cs }
    const path = solve(b)
    if (path && path.length >= min && path.length <= max) return b
  }
  return null
}

/* ------------------------------------------------------------------------------- what is kept */

export const SLIDE_KEY = 'lab_slide_v1'
export type Saved = {
  /** fewest pushes each level was done in */
  best: Record<string, number>
  /** endless boards finished, per difficulty */
  endless: Record<Difficulty, number>
}
export const EMPTY_SAVED: Saved = { best: {}, endless: { easy: 0, medium: 0, hard: 0 } }

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const count = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : null)

export function readSaved(text: string | null): Saved {
  let v: unknown
  try {
    v = JSON.parse(text ?? 'null')
  } catch {
    return { best: {}, endless: { ...EMPTY_SAVED.endless } }
  }
  const out: Saved = { best: {}, endless: { ...EMPTY_SAVED.endless } }
  if (!isRecord(v)) return out
  if (isRecord(v.best))
    for (const l of LEVELS) {
      const n = count(v.best[l.name])
      if (n !== null && n > 0) out.best[l.name] = n
    }
  if (isRecord(v.endless))
    for (const d of Object.keys(DIFFICULTY) as Difficulty[]) {
      const n = count(v.endless[d])
      if (n !== null) out.endless[d] = n
    }
  return out
}

/** three stars at par, two within two pushes of it, one for any finish */
export const stars = (par: number, moves: number) => (moves <= par ? 3 : moves <= par + 2 ? 2 : 1)

/* ------------------------------------------------------------------------------- the stage */

export function fitBoard(stage: [number, number], w: number, h: number) {
  const s = Math.min(stage[0] / (w + 0.4), stage[1] / (h + 0.4))
  return { s, ox: (stage[0] - w * s) / 2, oy: (stage[1] - h * s) / 2 }
}

/** a swipe's direction, or null for one too short to mean anything */
export function swipe(dx: number, dy: number, least: number): Dir | null {
  if (Math.hypot(dx, dy) < least) return null
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up'
}

const CODE: Record<Tile, number> = { ice: 0, wall: 1, snow: 2, goal: 3 }
/** one float a cell for the shader: the tile, plus 4 where a coin still waits */
export function packTiles(b: Board, got: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(MAX_SIDE * MAX_SIDE)
  b.tiles.forEach((t, i) => (out[i] = CODE[t]))
  b.coins.forEach(([x, y], c) => {
    if (!(got & (1 << c))) out[y * b.w + x] += 4
  })
  return out
}
