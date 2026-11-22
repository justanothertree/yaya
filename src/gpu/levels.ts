/**
 * Level maker: build a room tile by tile — walls, keys and doors, crates and holes, spikes, ice,
 * plates and gates, coins and an exit — then play it, and send it to somebody as a link. Pure, so
 * levels.test.ts can play and solve rooms without a page; LevelsDemo draws it on a 2D canvas.
 *
 * ⚠️ A ROOM IS SHARED ONLY ONCE IT IS PROVEN. `solve` searches every state the room can reach —
 * where you stand, where the crates are, which keys you hold, what is opened, filled or picked up,
 * and whether the spikes are up — breadth first, so the first way out it finds is the shortest.
 * That is the par a friend is told to beat, and a room nobody can leave never becomes a link.
 *
 * The rules, each in one place in `move`:
 *   walls stop you; a crate is pushed one step if the square beyond is free (into a hole it fills it,
 *   onto ice it slides); you cannot step into a hole; ice slides you until something stops you;
 *   a key opens the first door of its colour you walk into; plates hold their gates open while
 *   something stands on them; spikes are up after every odd move, and ending a move on them is the
 *   end of the attempt; the exit opens when every coin is taken.
 */

export const COLS = 12
export const ROWS = 9

export const TILES = [
  'floor',
  'wall',
  'start',
  'exit',
  'crate',
  'hole',
  'ice',
  'spikes',
  'coin',
  'plate',
  'gate',
  'keyR',
  'keyB',
  'keyG',
  'doorR',
  'doorB',
] as const
export type Tile = (typeof TILES)[number]
export const TILE_NAMES: Record<Tile, string> = {
  floor: 'Floor',
  wall: 'Wall',
  start: 'Start',
  exit: 'Exit',
  crate: 'Crate',
  hole: 'Hole',
  ice: 'Ice',
  spikes: 'Spikes',
  coin: 'Coin',
  plate: 'Plate',
  gate: 'Gate',
  keyR: 'Red key',
  keyB: 'Blue key',
  keyG: 'Gold key',
  doorR: 'Red door',
  doorB: 'Blue door',
}
/** which key opens which door: a gold key opens either colour, once */
export const DOOR_KEYS: Record<'doorR' | 'doorB', ('keyR' | 'keyB' | 'keyG')[]> = {
  doorR: ['keyR', 'keyG'],
  doorB: ['keyB', 'keyG'],
}

export type Level = { name: string; grid: Tile[]; theme: Theme }
export const THEMES = ['dungeon', 'garden', 'space'] as const
export type Theme = (typeof THEMES)[number]

export const at = (x: number, y: number) => y * COLS + x
export const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < COLS && y < ROWS

/** up, right, down, left — and 4, waiting a turn where you stand */
export type Dir = 0 | 1 | 2 | 3 | 4
export const WAIT: Dir = 4
/** up, right, down, left */
export const DIRS: [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
]

/* ---------------------------------------------------------------------------- a game in progress */

/** a crate resting on a plate, on ice or on spikes is remembered with what it covers */
export type Covered = 'crateOnPlate' | 'crateOnIce' | 'crateOnSpikes'
export type Square = Tile | Covered

export type State = {
  /** where you stand */
  p: number
  /** every square now: crates move, keys and coins are taken, doors open, holes fill */
  grid: Square[]
  keys: { keyR: number; keyB: number; keyG: number }
  moves: number
  coinsLeft: number
  /** how it ended, if it has */
  over: null | 'won' | 'spiked'
}

export function begin(level: Level): State | null {
  const p = level.grid.indexOf('start')
  if (p < 0) return null
  const grid: Square[] = [...level.grid]
  grid[p] = 'floor'
  return {
    p,
    grid,
    keys: { keyR: 0, keyB: 0, keyG: 0 },
    moves: 0,
    coinsLeft: grid.filter((t) => t === 'coin').length,
    over: null,
  }
}

/** spikes are up after an odd number of moves */
export const spikesUp = (moves: number) => moves % 2 === 1

const under: Record<Covered, Tile> = {
  crateOnPlate: 'plate',
  crateOnIce: 'ice',
  crateOnSpikes: 'spikes',
}
const crateOn = (t: Square): Square | null =>
  t === 'floor'
    ? 'crate'
    : t === 'plate'
      ? 'crateOnPlate'
      : t === 'ice'
        ? 'crateOnIce'
        : t === 'spikes'
          ? 'crateOnSpikes'
          : null
export const isCrate = (t: Square) => t === 'crate' || t in under
/** what a square is once its crate leaves */
const bare = (t: Square): Tile =>
  t === 'crate' ? 'floor' : t in under ? under[t as Covered] : (t as Tile)

/**
 * One move. Returns the next state, or the same state (by identity) when the move goes nowhere —
 * a wall, a hole, a locked door or a crate that will not budge cost nothing.
 */
export function move(s: State, d: Dir, plates: readonly number[]): State {
  if (s.over) return s
  if (d === WAIT) {
    /* ⚠️ WAITING IS WHAT MAKES SPIKES A PUZZLE. The grid is a chessboard: every step changes the
       colour of square you stand on, so without a wait (or ice) you always reach a given square
       on the same parity of move — every spike would be either always down or always up when you
       got there, a floor or a wall. A turn spent standing still is the one way to shift that. */
    const moves = s.moves + 1
    return { ...s, moves, over: s.grid[s.p] === 'spikes' && spikesUp(moves) ? 'spiked' : null }
  }
  const [dx, dy] = DIRS[d]
  const grid = [...s.grid]
  const keys = { ...s.keys }
  let coinsLeft = s.coinsLeft
  let p = s.p
  /** a gate is open while something stands on any plate: you (where you are now) or a crate */
  const open = (you: number) => plates.some((i) => i === you || grid[i] === 'crateOnPlate')
  /** can you step onto square q (from p), and what happens to it if you do */
  const enter = (q: number, nx: number, ny: number): boolean => {
    const t = grid[q]
    if (t === 'wall' || t === 'hole') return false
    if (t === 'gate' && !open(p)) return false
    if (t === 'doorR' || t === 'doorB') {
      const k = DOOR_KEYS[t].find((k) => keys[k] > 0)
      if (!k) return false
      keys[k]--
      grid[q] = 'floor'
    }
    if (isCrate(t)) {
      const bx = nx + dx
      const by = ny + dy
      if (!inside(bx, by)) return false
      let b = at(bx, by)
      const tb = grid[b]
      if (tb === 'hole') {
        grid[b] = 'floor'
        grid[q] = bare(t)
        return true
      }
      let lands = crateOn(tb)
      if (!lands) return false
      // a crate pushed onto ice slides on until something stops it
      while (lands === 'crateOnIce') {
        const cx = (b % COLS) + dx
        const cy = Math.floor(b / COLS) + dy
        if (!inside(cx, cy)) break
        const c = at(cx, cy)
        if (grid[c] === 'hole') {
          grid[q] = bare(t)
          grid[c] = 'floor'
          return true
        }
        const next = crateOn(grid[c])
        if (!next) break
        b = c
        lands = next
      }
      grid[q] = bare(t)
      grid[b] = lands
    }
    return true
  }
  let x = p % COLS
  let y = Math.floor(p / COLS)
  let moved = false
  for (;;) {
    const nx = x + dx
    const ny = y + dy
    if (!inside(nx, ny)) break
    const q = at(nx, ny)
    if (!enter(q, nx, ny)) break
    moved = true
    p = q
    x = nx
    y = ny
    const t = grid[q]
    if (t === 'keyR' || t === 'keyB' || t === 'keyG') {
      keys[t]++
      grid[q] = 'floor'
    } else if (t === 'coin') {
      coinsLeft--
      grid[q] = 'floor'
    }
    // ice keeps you going the same way
    if (grid[q] !== 'ice') break
  }
  if (!moved) return s
  const moves = s.moves + 1
  let over: State['over'] = null
  if (grid[p] === 'exit' && coinsLeft === 0) over = 'won'
  else if (grid[p] === 'spikes' && spikesUp(moves)) over = 'spiked'
  return { p, grid, keys, moves, coinsLeft, over }
}

/** where the plates are, which never changes during a game */
export const platesOf = (level: Level) => level.grid.flatMap((t, i) => (t === 'plate' ? [i] : []))

/* ---------------------------------------------------------------------------- the solver */

export type Solution =
  | { par: number; path: Dir[] }
  | { par: null; reason: 'stuck' | 'too big' | 'no start' | 'no exit' }

/**
 * The shortest way out, by breadth-first search over every state the room can reach. The state is
 * what can change: where you stand, the whole grid (crates, keys, doors, coins, holes), the keys in
 * hand and whether the spikes are up. Capped at `limit` states so a vast room answers "too big"
 * rather than freezing the page.
 */
export function solve(level: Level, limit = 200_000): Solution {
  const s0 = begin(level)
  if (!s0) return { par: null, reason: 'no start' }
  if (!level.grid.includes('exit')) return { par: null, reason: 'no exit' }
  const plates = platesOf(level)
  const key = (s: State) =>
    `${s.p}|${s.moves % 2}|${s.keys.keyR}${s.keys.keyB}${s.keys.keyG}|${s.grid.join(',')}`
  const seen = new Map<string, { from: string | null; d: Dir | null }>()
  seen.set(key(s0), { from: null, d: null })
  let frontier: State[] = [s0]
  while (frontier.length) {
    const next: State[] = []
    for (const s of frontier) {
      for (const d of [0, 1, 2, 3, 4] as Dir[]) {
        const t = move(s, d, plates)
        if (t === s || t.over === 'spiked') continue
        const k = key(t)
        if (seen.has(k)) continue
        seen.set(k, { from: key(s), d })
        if (t.over === 'won') {
          const path: Dir[] = []
          let cur: string | null = k
          while (cur) {
            const e: { from: string | null; d: Dir | null } = seen.get(cur)!
            if (e.d === null) break
            path.unshift(e.d)
            cur = e.from
          }
          return { par: path.length, path }
        }
        if (seen.size > limit) return { par: null, reason: 'too big' }
        next.push(t)
      }
    }
    frontier = next
  }
  return { par: null, reason: 'stuck' }
}

/* ---------------------------------------------------------------------------- sharing */

/**
 * A room as a short string: a version, the theme, the name's length and letters, then the 108
 * squares two to a byte (sixteen tiles fit four bits). ~80 characters for a whole room.
 */
export function encode(level: Level): string {
  const name = new TextEncoder().encode(level.name.slice(0, 24))
  const bytes = new Uint8Array(3 + name.length + (COLS * ROWS) / 2)
  bytes[0] = 1
  bytes[1] = THEMES.indexOf(level.theme)
  bytes[2] = name.length
  bytes.set(name, 3)
  const o = 3 + name.length
  for (let i = 0; i < COLS * ROWS; i += 2)
    bytes[o + i / 2] = (TILES.indexOf(level.grid[i]) << 4) | TILES.indexOf(level.grid[i + 1])
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decode(text: string): Level | null {
  if (!/^[A-Za-z0-9_-]{60,200}$/.test(text)) return null
  let bin: string
  try {
    bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  } catch {
    return null
  }
  const b = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  if (b[0] !== 1 || b[1] >= THEMES.length || b[2] > 72) return null
  const o = 3 + b[2]
  if (b.length !== o + (COLS * ROWS) / 2) return null
  let name: string
  try {
    name = new TextDecoder('utf-8', { fatal: true }).decode(b.slice(3, o))
  } catch {
    return null
  }
  const grid: Tile[] = []
  for (let i = 0; i < (COLS * ROWS) / 2; i++) grid.push(TILES[b[o + i] >> 4], TILES[b[o + i] & 15])
  if (grid.filter((t) => t === 'start').length !== 1) return null
  return {
    name: [...name]
      .filter((c) => c.charCodeAt(0) >= 32)
      .join('')
      .slice(0, 24),
    grid,
    theme: THEMES[b[1]],
  }
}

/* ---------------------------------------------------------------------------- rooms to start from */

/** a room drawn as text: # wall, . floor, S start, E exit, C crate, O hole, I ice, ^ spikes, $ coin,
 *  P plate, G gate, r b g keys, R B doors — one row a line, twelve to a row */
export function fromText(name: string, rows: string[], theme: Theme = 'dungeon'): Level {
  const map: Record<string, Tile> = {
    '#': 'wall',
    '.': 'floor',
    S: 'start',
    E: 'exit',
    C: 'crate',
    O: 'hole',
    I: 'ice',
    '^': 'spikes',
    $: 'coin',
    P: 'plate',
    G: 'gate',
    r: 'keyR',
    b: 'keyB',
    g: 'keyG',
    R: 'doorR',
    B: 'doorB',
  }
  const grid = rows
    .join('')
    .split('')
    .map((c) => map[c] ?? 'floor')
  if (grid.length !== COLS * ROWS) throw new Error(`${name}: ${grid.length} squares`)
  return { name, grid, theme }
}

export const ROOMS: Level[] = [
  fromText('First steps', [
    '############',
    '#S....#...E#',
    '#.###.#.##.#',
    '#.#$..#..#.#',
    '#.#.###..#.#',
    '#.#......#.#',
    '#.######.#.#',
    '#..........#',
    '############',
  ]),
  fromText(
    'Keys and doors',
    [
      '############',
      '#S..#r....##',
      '#.#.#.###..#',
      '#.#...#b#..#',
      '#.#####R#.##',
      '#....$#.#..#',
      '####.##B##.#',
      '#E.........#',
      '############',
    ],
    'garden',
  ),
  fromText('Fill the holes', [
    '############',
    '#S.........#',
    '#..C...C...#',
    '#..........#',
    '#####OO#####',
    '#..........#',
    '#....$.....#',
    '#.........E#',
    '############',
  ]),
  fromText(
    'Thin ice',
    [
      '############',
      '#S..IIIII..#',
      '#...IIIII..#',
      '#.#.IIIII#.#',
      '#...IIIII..#',
      '#$..IIIII.$#',
      '#...I#III..#',
      '#...IIIII.E#',
      '############',
    ],
    'space',
  ),
  fromText('Plates and spikes', [
    '############',
    '#S.........#',
    '#..C....P..#',
    '#..........#',
    '######G#####',
    '#^^^^^.^^^^#',
    '#.$...^....#',
    '#^^^^^^^^.E#',
    '############',
  ]),
]

/* ---------------------------------------------------------------------------- what is kept */

export const LEVELS_KEY = 'lab_levels_v1'
export const HERO_COLOURS = [
  '#ff6b6b',
  '#ffb347',
  '#ffd93d',
  '#6bcb77',
  '#4d96ff',
  '#9b5de5',
  '#f15bb5',
  '#e0e0e0',
] as const
export const HATS = ['none', 'crown', 'cap', 'bow', 'antenna'] as const
export type Hat = (typeof HATS)[number]
export type Saved = {
  /** the room being built */
  draft: string
  /** rooms kept, as links' text */
  kept: string[]
  /** fewest moves out of each room solved, by its encoding */
  best: Record<string, number>
  hero: { colour: number; hat: Hat }
}
export const MAX_KEPT = 20
export const EMPTY: Saved = { draft: '', kept: [], best: {}, hero: { colour: 4, hat: 'none' } }
export function readSaved(text: string | null): Saved {
  const out: Saved = structuredClone(EMPTY)
  let v: unknown
  try {
    v = JSON.parse(text ?? 'null')
  } catch {
    return out
  }
  if (typeof v !== 'object' || !v || Array.isArray(v)) return out
  const o = v as Record<string, unknown>
  if (typeof o.draft === 'string' && decode(o.draft)) out.draft = o.draft
  if (Array.isArray(o.kept))
    out.kept = o.kept
      .filter((x): x is string => typeof x === 'string' && decode(x) !== null)
      .slice(0, MAX_KEPT)
  if (o.best && typeof o.best === 'object' && !Array.isArray(o.best))
    for (const [k, n] of Object.entries(o.best as Record<string, unknown>))
      if (typeof n === 'number' && Number.isInteger(n) && n > 0 && n < 1e6 && decode(k))
        out.best[k] = n
  const h = o.hero as Record<string, unknown> | undefined
  if (h && typeof h === 'object') {
    if (
      typeof h.colour === 'number' &&
      Number.isInteger(h.colour) &&
      h.colour >= 0 &&
      h.colour < HERO_COLOURS.length
    )
      out.hero.colour = h.colour
    if (HATS.includes(h.hat as Hat)) out.hero.hat = h.hat as Hat
  }
  return out
}
