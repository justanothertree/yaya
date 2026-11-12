/**
 * Popper: coloured bubbles hang from the ceiling in rows packed like oranges, each row set half a
 * bubble across from the next. Fire one from the bottom; it flies straight, bounces off the side
 * walls, and sticks where it touches. Three or more of one colour touching pop, and anything left
 * hanging from nothing falls. Shots bring new rows down from the ceiling — sooner the more of them
 * pop nothing, and sooner as the game goes on — and a bubble past the line ends the game.
 *
 * Pure, so popper.test.ts can fire thousands of shots without a page. Lengths are in bubble radii:
 * a bubble is 2 across, the field 22 wide.
 */

import { rngStep as roll } from './bricks'
import { whole } from './kept'

export const COLS = 11
/** rows above the line; one more row below it holds a bubble only long enough to lose */
export const ROWS = 13
export const ROW_H = Math.sqrt(3)
export const WIDTH = COLS * 2
export const LINE_Y = 1 + (ROWS - 0.5) * ROW_H
export const GUN = { x: WIDTH / 2, y: LINE_Y + 3.2 }
export const HEIGHT = GUN.y + 2
/** the steepest a shot may be aimed from flat: anything lower would only rattle along the walls */
export const MIN_AIM = (8 * Math.PI) / 180
/**
 * How full the count must be for a new row: a shot that pops nothing adds two, one that pops adds
 * one, and the bar starts at eight and drops by one every thirty shots, down to two. Measured on
 * held-out games: aiming at random lasts about 17 shots with five colours, and a player who tries
 * all sixty-one aims and takes the best lasts about 180. The first rule tried — a row only after
 * five shots that popped nothing — let that player go past 600 shots with no end in sight
 */
export const rowAt = (shots: number) => Math.max(2, 8 - Math.floor(shots / 30))
/** rows on a fresh board */
const START_ROWS = 6

export type Pt = { x: number; y: number }
export type Game = {
  /** row by row, COLS to a row; 0 is empty, 1 and up a colour. Rows ROWS + 1 deep */
  cells: Int8Array
  /** whether row 0 is the one set half a bubble across */
  shift: boolean
  colours: number
  now: number
  next: number
  score: number
  shots: number
  /** the count towards the next row: two for a shot that popped nothing, one for one that did */
  misses: number
  /** boards cleared */
  cleared: number
  over: boolean
  /** the random state, so a game is the same from the same seed */
  luck: number
}

/* --------------------------------------------------------------------------- the grid */

export const offset = (shift: boolean, r: number) => (r % 2 === 1) !== shift
export const width = (shift: boolean, r: number) => (offset(shift, r) ? COLS - 1 : COLS)
export const valid = (shift: boolean, r: number, c: number) =>
  r >= 0 && r <= ROWS && c >= 0 && c < width(shift, r)
export const centre = (shift: boolean, r: number, c: number): Pt => ({
  x: 1 + 2 * c + (offset(shift, r) ? 1 : 0),
  y: 1 + r * ROW_H,
})
/** the six cells around one: two in its row, two above and two below */
export function neighbours(shift: boolean, r: number, c: number): [number, number][] {
  const side = offset(shift, r) ? [c, c + 1] : [c - 1, c]
  const out: [number, number][] = [
    [r, c - 1],
    [r, c + 1],
    [r - 1, side[0]],
    [r - 1, side[1]],
    [r + 1, side[0]],
    [r + 1, side[1]],
  ]
  return out.filter(([a, b]) => valid(shift, a, b))
}
const at = (g: Game, r: number, c: number) => g.cells[r * COLS + c]

/* --------------------------------------------------------------------------- luck */

/** the colours still on the board */
export function present(g: Pick<Game, 'cells'>): number[] {
  return [...new Set([...g.cells].filter(Boolean))].sort((a, b) => a - b)
}
/** a colour for the next bubble: one still on the board, so no shot is dead from the start */
function pickColour(g: Game): [number, number] {
  const on = present(g)
  const [luck, v] = roll(g.luck)
  const from = on.length ? on : Array.from({ length: g.colours }, (_, i) => i + 1)
  return [luck, from[Math.floor(v * from.length)]]
}
/**
 * A row of colours: each bubble now and then the colour of the one beside it or above it, so a
 * board has groups to aim at rather than confetti.
 */
function fillRow(g: Game, r: number) {
  for (let c = 0; c < width(g.shift, r); c++) {
    let v: number
    ;[g.luck, v] = roll(g.luck)
    const near = neighbours(g.shift, r, c)
      .filter(([a, b]) => (a < r || (a === r && b < c)) && at(g, a, b))
      .map(([a, b]) => at(g, a, b))
    let colour: number
    if (near.length && v < 0.45) colour = near[Math.floor((v / 0.45) * near.length)]
    else {
      ;[g.luck, v] = roll(g.luck)
      colour = 1 + Math.floor(v * g.colours)
    }
    g.cells[r * COLS + c] = colour
  }
}

export function newGame(colours: number, seed: number): Game {
  const g: Game = {
    cells: new Int8Array((ROWS + 1) * COLS),
    shift: false,
    colours,
    now: 1,
    next: 1,
    score: 0,
    shots: 0,
    misses: 0,
    cleared: 0,
    over: false,
    luck: seed >>> 0 || 1,
  }
  for (let i = 0; i < 6; i++) g.luck = roll(g.luck)[0]
  for (let r = 0; r < START_ROWS; r++) fillRow(g, r)
  ;[g.luck, g.now] = pickColour(g)
  ;[g.luck, g.next] = pickColour(g)
  return g
}

/* --------------------------------------------------------------------------- a shot */

/** the empty cell a bubble at `p` settles in: the nearest one touching the ceiling or a bubble */
export function snap(g: Game, p: Pt): [number, number] | null {
  let best: [number, number] | null = null
  let bd = Infinity
  for (let r = 0; r <= ROWS; r++)
    for (let c = 0; c < width(g.shift, r); c++) {
      if (at(g, r, c)) continue
      if (r > 0 && !neighbours(g.shift, r, c).some(([a, b]) => at(g, a, b))) continue
      const q = centre(g.shift, r, c)
      const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2
      if (d < bd) {
        bd = d
        best = [r, c]
      }
    }
  return best
}

/**
 * Where a shot at `angle` (radians from flat, to the right) goes: the points it turns at, ending at
 * the centre of the cell it settles in. It moves in small steps, bounces off the walls, and stops
 * against the ceiling or on coming within a little less than a bubble's width of one — a little
 * less, so a shot can slip through a gap a hair narrower than itself, as one sent by eye expects.
 */
export function flight(g: Game, angle: number): { path: Pt[]; cell: [number, number] | null } {
  const a = Math.min(Math.PI - MIN_AIM, Math.max(MIN_AIM, angle))
  let dx = Math.cos(a)
  const dy = -Math.sin(a)
  const p = { ...GUN }
  const path: Pt[] = [{ ...GUN }]
  const STEP = 0.05
  const touch = 1.8 ** 2
  for (let k = 0; k < 20000; k++) {
    p.x += dx * STEP
    p.y += dy * STEP
    if (p.x < 1) {
      p.x = 2 - p.x
      dx = -dx
      path.push({ x: 1, y: p.y })
    } else if (p.x > WIDTH - 1) {
      p.x = 2 * (WIDTH - 1) - p.x
      dx = -dx
      path.push({ x: WIDTH - 1, y: p.y })
    }
    let hit = p.y <= 1
    if (!hit) {
      const r0 = Math.round((p.y - 1) / ROW_H)
      for (let r = Math.max(0, r0 - 1); r <= Math.min(ROWS, r0 + 1) && !hit; r++)
        for (let c = 0; c < width(g.shift, r) && !hit; c++) {
          if (!at(g, r, c)) continue
          const q = centre(g.shift, r, c)
          if ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 < touch) hit = true
        }
    }
    if (hit) {
      const cell = snap(g, p)
      if (cell) path.push(centre(g.shift, cell[0], cell[1]))
      return { path, cell }
    }
  }
  return { path, cell: null }
}

/** the cells of one colour joined to a cell, itself included */
export function group(g: Game, r: number, c: number): [number, number][] {
  const colour = at(g, r, c)
  const seen = new Set([r * COLS + c])
  const out: [number, number][] = [[r, c]]
  for (let i = 0; i < out.length; i++)
    for (const [a, b] of neighbours(g.shift, out[i][0], out[i][1]))
      if (at(g, a, b) === colour && !seen.has(a * COLS + b)) {
        seen.add(a * COLS + b)
        out.push([a, b])
      }
  return out
}
/** bubbles joined to nothing that holds on to the ceiling */
export function hanging(g: Game): [number, number][] {
  const held = new Set<number>()
  const todo: [number, number][] = []
  for (let c = 0; c < width(g.shift, 0); c++)
    if (at(g, 0, c)) {
      held.add(c)
      todo.push([0, c])
    }
  while (todo.length) {
    const [r, c] = todo.pop()!
    for (const [a, b] of neighbours(g.shift, r, c))
      if (at(g, a, b) && !held.has(a * COLS + b)) {
        held.add(a * COLS + b)
        todo.push([a, b])
      }
  }
  const out: [number, number][] = []
  for (let r = 0; r <= ROWS; r++)
    for (let c = 0; c < width(g.shift, r); c++)
      if (at(g, r, c) && !held.has(r * COLS + c)) out.push([r, c])
  return out
}

/**
 * Points for a shot: ten for each bubble popped, and for the ones that fall, twenty each, doubled
 * for every five up to eight times. Measured without the limit, over ninety games aimed at random:
 * the biggest single shot brought down 25 and was worth 16,330 — about what a whole game of the best
 * aim averages with five colours, from one shot nobody aimed
 */
export const POP = 10
export const fallPoints = (n: number) => n * 20 * Math.min(8, 2 ** Math.floor(n / 5))
/** for a board cleared, by how many have been */
export const clearPoints = (cleared: number) => 500 * cleared

/** a new row from the ceiling: everything moves down one, and the rows swap which is set across */
function pushRow(g: Game) {
  g.cells.copyWithin(COLS, 0, ROWS * COLS)
  g.cells.fill(0, 0, COLS)
  g.shift = !g.shift
  fillRow(g, 0)
}

export type Landing = {
  game: Game
  cell: [number, number] | null
  popped: [number, number][]
  fell: [number, number][]
  /** where the popped and fallen bubbles were, and their colours, for drawing them going */
  gone: { at: Pt; colour: number; fell: boolean }[]
  gained: number
  newRow: boolean
}
/** fire the bubble ready to go at `angle`, and settle everything that follows */
export function shoot(g0: Game, angle: number): Landing {
  const g: Game = { ...g0, cells: g0.cells.slice() }
  const none: Landing = {
    game: g0,
    cell: null,
    popped: [],
    fell: [],
    gone: [],
    gained: 0,
    newRow: false,
  }
  if (g.over) return none
  const { cell } = flight(g, angle)
  if (!cell) return none
  const [r, c] = cell
  g.cells[r * COLS + c] = g.now
  g.shots++
  let popped: [number, number][] = []
  let fell: [number, number][] = []
  const gone: Landing['gone'] = []
  const same = group(g, r, c)
  if (same.length >= 3) {
    popped = same
    for (const [a, b] of popped) {
      gone.push({ at: centre(g.shift, a, b), colour: at(g, a, b), fell: false })
      g.cells[a * COLS + b] = 0
    }
    fell = hanging(g)
    for (const [a, b] of fell) {
      gone.push({ at: centre(g.shift, a, b), colour: at(g, a, b), fell: true })
      g.cells[a * COLS + b] = 0
    }
  }
  let gained = popped.length * POP + fallPoints(fell.length)
  let newRow = false
  g.misses += popped.length ? 1 : 2
  if (g.misses >= rowAt(g.shots)) {
    g.misses = 0
    pushRow(g)
    newRow = true
  }
  if (!present(g).length) {
    // the board cleared: points, and a fresh one
    g.cleared++
    gained += clearPoints(g.cleared)
    g.misses = 0
    for (let k = 0; k < START_ROWS; k++) fillRow(g, k)
  }
  g.score += gained
  // a bubble past the line ends the game
  for (let k = 0; k < width(g.shift, ROWS); k++) if (at(g, ROWS, k)) g.over = true
  g.now = g.next
  ;[g.luck, g.next] = pickColour(g)
  // the one ready to go is never a colour no longer on the board
  if (!present(g).includes(g.now)) [g.luck, g.now] = pickColour(g)
  return { game: g, cell, popped, fell, gone, gained, newRow }
}
/** swap the bubble ready to go with the next one */
export const swap = (g: Game): Game => (g.over ? g : { ...g, now: g.next, next: g.now })

/* --------------------------------------------------------------------------- what is kept */

export const POPPER_KEY = 'lab_popper_v1'
export const LOOKS = ['candy', 'gems', 'night'] as const
export const COLOUR_COUNTS = [4, 5, 6] as const
export type Saved = {
  colours: (typeof COLOUR_COUNTS)[number]
  look: (typeof LOOKS)[number]
  /** draw the shot's path, bounces and all */
  guide: boolean
  /** best score for each number of colours */
  best: Record<(typeof COLOUR_COUNTS)[number], number>
  games: number
}
export const EMPTY: Saved = {
  colours: 5,
  look: 'candy',
  guide: true,
  best: { 4: 0, 5: 0, 6: 0 },
  games: 0,
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
  const b = (typeof o.best === 'object' && o.best ? o.best : {}) as Record<string, unknown>
  return {
    colours: pick(COLOUR_COUNTS, o.colours, EMPTY.colours),
    look: pick(LOOKS, o.look, EMPTY.look),
    guide: typeof o.guide === 'boolean' ? o.guide : EMPTY.guide,
    best: { 4: whole(b[4], 1e9), 5: whole(b[5], 1e9), 6: whole(b[6], 1e9) },
    games: whole(o.games, 1e9),
  }
}
