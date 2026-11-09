/**
 * The rules of the Lab's beams puzzle: lasers on a grid, the pieces that turn, split and colour
 * them, which targets end up lit, and a solver that proves every level can be done. Pure, so
 * beams.test.ts can ask it questions without a GPU.
 *
 * A beam travels from cell centre to cell centre. A mirror turns it a quarter; a splitter lets it
 * through AND turns a copy; a filter lets through only its own colours. Colours are light, so they
 * ADD: red and green arriving at one target make yellow, and a target is lit only when exactly its
 * colour arrives — too little and it waits, too much and it is wrong.
 */

export type Dir = 0 | 1 | 2 | 3 // east, south, west, north — y grows downward
export const DX = [1, 0, -1, 0] as const
export const DY = [0, 1, 0, -1] as const

/** a colour is a set of red (1), green (2) and blue (4) */
export type Colour = number
export const RED = 1
export const GREEN = 2
export const BLUE = 4
export const COLOUR_NAMES: Record<number, string> = {
  1: 'red',
  2: 'green',
  3: 'yellow',
  4: 'blue',
  5: 'magenta',
  6: 'cyan',
  7: 'white',
}

export type Kind = 'mirror' | 'splitter' | 'filter'
/** turn 0 is "/", turn 1 is "\" — a filter has no turn */
export type Piece = { kind: Kind; turn: 0 | 1; colour?: Colour }
export type Emitter = { x: number; y: number; dir: Dir; colour: Colour }
export type Target = { x: number; y: number; colour: Colour }
export type Stock = { kind: Kind; colour?: Colour; count: number }

export type Level = {
  name: string
  hint: string
  w: number
  h: number
  walls: string[] // "x,y"
  /** pieces that are part of the level and cannot be moved */
  fixed: Record<string, Piece>
  emitters: Emitter[]
  targets: Target[]
  stock: Stock[]
}

export const key = (x: number, y: number) => `${x},${y}`

/** "/" sends east to north and north to east; "\" sends east to south */
export function turn(d: Dir, t: 0 | 1): Dir {
  if (t === 0) return ([3, 2, 1, 0] as const)[d]
  return ([1, 0, 3, 2] as const)[d]
}

export type Segment = { x0: number; y0: number; x1: number; y1: number; colour: Colour }
export type Traced = {
  segments: Segment[]
  /** what each target receives, in the order of level.targets */
  received: Colour[]
  /** every cell a beam passes through or stops in, as "x,y" — where a piece could change anything */
  lit: Set<string>
}

/**
 * Follow every beam from every emitter. A beam that comes back to a cell, heading the same way in
 * the same colour, is a loop and stops; a splitter can double beams, so there is also a hard cap.
 */
export function trace(level: Level, placed: Record<string, Piece>): Traced {
  const walls = new Set(level.walls)
  const at = new Map<string, Piece>(Object.entries({ ...level.fixed, ...placed }))
  const emitterAt = new Set(level.emitters.map((e) => key(e.x, e.y)))
  const targetAt = new Map(level.targets.map((t, i) => [key(t.x, t.y), i]))
  const received = level.targets.map(() => 0)
  const segments: Segment[] = []
  const lit = new Set<string>()
  const seen = new Set<string>()
  const rays: { x: number; y: number; dir: Dir; colour: Colour }[] = level.emitters.map((e) => ({
    ...e,
  }))
  let budget = 4000
  while (rays.length && budget-- > 0) {
    const r = rays.pop()!
    const sx = r.x + 0.5
    const sy = r.y + 0.5
    let x = r.x
    let y = r.y
    let end: [number, number] | null = null
    for (let steps = 0; steps < level.w * level.h + 2; steps++) {
      const nx = x + DX[r.dir]
      const ny = y + DY[r.dir]
      // off the board, or into a wall or an emitter: it stops at the cell's edge
      if (nx < 0 || ny < 0 || nx >= level.w || ny >= level.h) {
        end = [x + 0.5 + DX[r.dir] * 0.5, y + 0.5 + DY[r.dir] * 0.5]
        break
      }
      const k = key(nx, ny)
      if (walls.has(k) || emitterAt.has(k)) {
        end = [nx + 0.5 - DX[r.dir] * 0.5, ny + 0.5 - DY[r.dir] * 0.5]
        break
      }
      x = nx
      y = ny
      lit.add(k)
      const t = targetAt.get(k)
      if (t !== undefined) {
        received[t] |= r.colour
        end = [x + 0.5, y + 0.5]
        break
      }
      const p = at.get(k)
      if (!p) continue
      end = [x + 0.5, y + 0.5]
      const go = (dir: Dir, colour: Colour) => {
        const s = `${k},${dir},${colour}`
        if (colour && !seen.has(s)) {
          seen.add(s)
          rays.push({ x, y, dir, colour })
        }
      }
      if (p.kind === 'mirror') go(turn(r.dir, p.turn), r.colour)
      else if (p.kind === 'splitter') {
        go(r.dir, r.colour)
        go(turn(r.dir, p.turn), r.colour)
      } else go(r.dir, r.colour & (p.colour ?? 7))
      break
    }
    if (end) segments.push({ x0: sx, y0: sy, x1: end[0], y1: end[1], colour: r.colour })
  }
  return { segments, received, lit }
}

export const solved = (level: Level, t: Traced) =>
  level.targets.every((target, i) => t.received[i] === target.colour)

/** a cell a piece may go in: on the board, and nothing already there */
export function free(level: Level, placed: Record<string, Piece>, x: number, y: number) {
  const k = key(x, y)
  if (x < 0 || y < 0 || x >= level.w || y >= level.h) return false
  if (level.walls.includes(k) || k in level.fixed || k in placed) return false
  if (level.emitters.some((e) => e.x === x && e.y === y)) return false
  if (level.targets.some((t) => t.x === x && t.y === y)) return false
  return true
}

/** how many of a stock entry are on the board */
export function used(placed: Record<string, Piece>, s: Stock) {
  return Object.values(placed).filter(
    (p) => p.kind === s.kind && (s.kind !== 'filter' || p.colour === s.colour),
  ).length
}

/**
 * The fewest pieces from the level's stock that light every target, or null when it cannot be
 * done. Pieces only matter where a beam passes, so each step tries only lit cells — which is what
 * makes this quick enough to run over every level in a test.
 */
export function solve(level: Level, most = Infinity): Record<string, Piece> | null {
  const total = level.stock.reduce((n, s) => n + s.count, 0)
  for (let budget = 0; budget <= Math.min(total, most); budget++) {
    const seen = new Set<string>()
    const found = search(level, {}, budget, seen)
    if (found) return found
  }
  return null
}

function search(
  level: Level,
  placed: Record<string, Piece>,
  left: number,
  seen: Set<string>,
): Record<string, Piece> | null {
  const sig = Object.entries(placed)
    .map(([k, p]) => `${k}${p.kind[0]}${p.turn}${p.colour ?? ''}`)
    .sort()
    .join('|')
  if (seen.has(sig)) return null
  seen.add(sig)
  const t = trace(level, placed)
  if (solved(level, t)) return placed
  if (left === 0) return null
  for (const k of t.lit) {
    const [x, y] = k.split(',').map(Number)
    if (!free(level, placed, x, y)) continue
    for (const s of level.stock) {
      if (used(placed, s) >= s.count) continue
      const turns: (0 | 1)[] = s.kind === 'filter' ? [0] : [0, 1]
      for (const tn of turns) {
        const p: Piece = { kind: s.kind, turn: tn, ...(s.colour ? { colour: s.colour } : {}) }
        const r = search(level, { ...placed, [k]: p }, left - 1, seen)
        if (r) return r
      }
    }
  }
  return null
}

/* ---------------------------------------------------------------- the levels ------------------ */

/**
 * Levels drawn as text, one character a cell, so they can be read and checked by eye:
 *   .  empty      #  wall        /  \  a fixed mirror     %  &  a fixed splitter (/ and \)
 *   > v < ^  an emitter, facing that way — its colour from `light`, in reading order
 *   1..7  a target wanting that colour (1 red, 2 green, 3 yellow, 4 blue, 5 magenta, 6 cyan, 7 white)
 *   r g b  a fixed filter of that colour
 */
export function parse(
  name: string,
  hint: string,
  rows: string[],
  light: Colour[],
  stock: Stock[],
): Level {
  const level: Level = {
    name,
    hint,
    w: rows[0].length,
    h: rows.length,
    walls: [],
    fixed: {},
    emitters: [],
    targets: [],
    stock,
  }
  let e = 0
  rows.forEach((row, y) => {
    if (row.length !== level.w) throw new Error(`${name}: row ${y} is ${row.length} wide`)
    ;[...row].forEach((ch, x) => {
      const k = key(x, y)
      if (ch === '#') level.walls.push(k)
      else if (ch === '/' || ch === '\\')
        level.fixed[k] = { kind: 'mirror', turn: ch === '/' ? 0 : 1 }
      else if (ch === '%' || ch === '&')
        level.fixed[k] = { kind: 'splitter', turn: ch === '%' ? 0 : 1 }
      else if ('rgb'.includes(ch))
        level.fixed[k] = { kind: 'filter', turn: 0, colour: { r: RED, g: GREEN, b: BLUE }[ch] }
      else if ('>v<^'.includes(ch))
        level.emitters.push({ x, y, dir: '>v<^'.indexOf(ch) as Dir, colour: light[e++] })
      else if ('1234567'.includes(ch)) level.targets.push({ x, y, colour: Number(ch) })
      else if (ch !== '.') throw new Error(`${name}: what is "${ch}"?`)
    })
  })
  if (e !== light.length) throw new Error(`${name}: ${e} emitters, ${light.length} colours`)
  return level
}

const M = (count: number): Stock => ({ kind: 'mirror', count })
const S = (count: number): Stock => ({ kind: 'splitter', count })
const F = (colour: Colour, count: number): Stock => ({ kind: 'filter', colour, count })

export const LEVELS: Level[] = [
  parse(
    'First light',
    'Tap a lit square to put a mirror there; tap the mirror to turn it.',
    ['......1', '.......', '.......', '>......', '.......'],
    [RED],
    [M(1)],
  ),
  parse(
    'Round the wall',
    'One mirror turns the beam up; another turns it along.',
    ['......1', '>..#...', '...#...', '...#...', '.......'],
    [RED],
    [M(2)],
  ),
  parse(
    'Both at once',
    'A splitter lets the beam through and turns a copy of it.',
    ['...1...', '.......', '>.....1', '.......', '.......'],
    [RED],
    [S(1)],
  ),
  parse(
    'Yellow',
    'Red and green light, met in one place, make yellow. A mirror can only send one of them on.',
    ['...v...', '.......', '.......', '>.....3', '.......'],
    [GREEN, RED],
    [M(1), S(1)],
  ),
  parse(
    'Only blue',
    'White is every colour at once; a filter keeps one.',
    ['.......', '>.....4', '.......', '.......', '......1'],
    [7],
    [S(1), F(BLUE, 1), F(RED, 1), M(1)],
  ),
  parse(
    'The long way',
    'Walls everywhere. Count the corners before you start.',
    ['>.....#', '#####..', '.......', '..#####', '......4'],
    [BLUE],
    [M(4)],
  ),
  parse(
    'Crossroads',
    'Beams cross without touching — and a mirror turns whatever colour reaches it.',
    ['....v....', '.........', '>.......1', '.........', '....2....'],
    [RED, GREEN],
    [M(2)],
  ),
  parse(
    'Cyan',
    'Green and blue make cyan. Three beams meet here; which way you turn decides who gets in.',
    ['...v...', '.......', '>.....6', '.......', '...^...'],
    [GREEN, BLUE, RED],
    [S(1), M(1), F(GREEN, 1)],
  ),
  parse(
    'Fixed in place',
    'The grey pieces are part of the puzzle and cannot be moved.',
    ['.......', '>..\\...', '.......', '...&..1', '.......', '...2...'],
    [7],
    [F(RED, 1), F(GREEN, 1), F(BLUE, 1), M(1)],
  ),
  parse(
    'White',
    'All three colours into one target. A mirror would turn the others away.',
    ['....v....', '.........', '>........', '>........', '....7....'],
    [RED, GREEN, BLUE],
    [S(2), M(1)],
  ),
]

/** the fewest pieces each level can be solved with — what solve() proves, and the test holds it to */
export const PARS = [1, 2, 1, 1, 4, 4, 1, 1, 2, 2]

/* ---------------------------------------------------------------- kept in this browser -------- */

export const BEAMS_KEY = 'lab_beams_v1'

export type Saved = {
  /** the fewest pieces each level was solved with, by name */
  best: Record<string, number>
  /** the level open last, and what was on it */
  level: number
  placed: Record<string, Piece>
}

function readPiece(v: unknown): Piece | null {
  const p = v as Piece
  if (!p || typeof p !== 'object') return null
  if (p.kind !== 'mirror' && p.kind !== 'splitter' && p.kind !== 'filter') return null
  if (p.turn !== 0 && p.turn !== 1) return null
  if (p.kind === 'filter') {
    if (!Number.isInteger(p.colour) || (p.colour as number) < 1 || (p.colour as number) > 7)
      return null
    return { kind: 'filter', turn: 0, colour: p.colour }
  }
  return { kind: p.kind, turn: p.turn }
}

/** what is kept, checked against the levels themselves: a piece the level could not hold is dropped */
export function readSaved(text: string | null): Saved {
  const empty: Saved = { best: {}, level: 0, placed: {} }
  try {
    const v = JSON.parse(text ?? 'null') as Record<string, unknown> | null
    if (!v || typeof v !== 'object') return empty
    const best: Record<string, number> = {}
    for (const l of LEVELS) {
      const n = (v.best as Record<string, unknown> | undefined)?.[l.name]
      if (typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 20) best[l.name] = n
    }
    const level =
      typeof v.level === 'number' &&
      Number.isInteger(v.level) &&
      v.level >= 0 &&
      v.level < LEVELS.length
        ? v.level
        : 0
    const placed = fitPlaced(LEVELS[level], v.placed)
    return { best, level, placed }
  } catch {
    return empty
  }
}

/** the pieces that may stand on this level: free cells, and no more of a kind than its stock */
export function fitPlaced(level: Level, raw: unknown): Record<string, Piece> {
  const out: Record<string, Piece> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const m = /^(\d+),(\d+)$/.exec(k)
    const p = readPiece(v)
    if (!m || !p) continue
    if (!free(level, out, Number(m[1]), Number(m[2]))) continue
    const s = level.stock.find(
      (q) => q.kind === p.kind && (p.kind !== 'filter' || q.colour === p.colour),
    )
    if (!s || used(out, s) >= s.count) continue
    out[k] = p
  }
  return out
}

/* ---------------------------------------------------------------- for the GPU ----------------- */

/** each cell as (kind, turn or colour, colour, flags) — kind: 0 empty 1 wall 2 mirror 3 splitter
 *  4 filter 5 emitter 6 target; flags: 1 fixed, 2 lit (a target satisfied), 4 selected */
export function packCells(
  level: Level,
  placed: Record<string, Piece>,
  t: Traced,
  selected: string | null,
): Float32Array<ArrayBuffer> {
  const out = new Float32Array(level.w * level.h * 4)
  const put = (x: number, y: number, v: [number, number, number, number]) =>
    out.set(v, (y * level.w + x) * 4)
  for (const k of level.walls) {
    const [x, y] = k.split(',').map(Number)
    put(x, y, [1, 0, 0, 0])
  }
  const pieces = [
    ...Object.entries(level.fixed).map(([k, p]) => [k, p, 1] as const),
    ...Object.entries(placed).map(([k, p]) => [k, p, 0] as const),
  ]
  for (const [k, p, fixed] of pieces) {
    const [x, y] = k.split(',').map(Number)
    const kind = p.kind === 'mirror' ? 2 : p.kind === 'splitter' ? 3 : 4
    put(x, y, [kind, p.turn, p.colour ?? 0, fixed | (k === selected ? 4 : 0)])
  }
  for (const e of level.emitters) put(e.x, e.y, [5, e.dir, e.colour, 1])
  level.targets.forEach((g, i) =>
    put(g.x, g.y, [6, t.received[i], g.colour, 1 | (t.received[i] === g.colour ? 2 : 0)]),
  )
  return out
}

/** each beam segment as (x0, y0, x1, y1) then (r, g, b, 1) */
export function packSegments(
  segments: readonly Segment[],
  most: number,
): Float32Array<ArrayBuffer> {
  const out = new Float32Array(Math.min(segments.length, most) * 8)
  segments
    .slice(0, most)
    .forEach((s, i) =>
      out.set(
        [s.x0, s.y0, s.x1, s.y1, s.colour & 1, (s.colour >> 1) & 1, (s.colour >> 2) & 1, 1],
        i * 8,
      ),
    )
  return out
}

/* ---------------------------------------------------------------- the view -------------------- */

/** the board fitted into the stage with half a cell to spare round it: pixels a cell, and its corner */
export function fitBoard(stage: [number, number], w: number, h: number) {
  const s = Math.min(stage[0] / (w + 1), stage[1] / (h + 1))
  return { s, ox: (stage[0] - w * s) / 2, oy: (stage[1] - h * s) / 2 }
}

/** the cell under a stage point, or null off the board */
export function cellAt(
  f: ReturnType<typeof fitBoard>,
  w: number,
  h: number,
  p: [number, number],
): [number, number] | null {
  const x = Math.floor((p[0] - f.ox) / f.s)
  const y = Math.floor((p[1] - f.oy) / f.s)
  return x >= 0 && y >= 0 && x < w && y < h ? [x, y] : null
}

/** beams the shader is sent at most — a splitter doubles them, but every level stays far under */
export const MAX_SEGMENTS = 256
export const MAX_CELLS = 256
