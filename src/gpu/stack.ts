/**
 * Stackfall: falling four-square pieces, a well ten wide, and lines that clear when full — played
 * alone for survival as it speeds up, or side by side against the computer or a friend on the same
 * keyboard, where every clear of two or more sends rows of junk up the other well. Pure, so
 * stack.test.ts can play whole games without a page; StackDemo only draws it and reads keys.
 *
 * ⚠️ THE GENRE, NOT ANY ONE GAME. Seven four-square shapes, rotation, line clears and junk rows are
 * the shared furniture of a whole family of falling-block games; the name, colours, scoring and
 * speed curve here are this Lab's own.
 *
 * ⚠️ EVERYTHING ADVANCES BY `step`, AND NOTHING READS THE CLOCK. A piece falls, locks and repeats
 * on the seconds it is handed, and the random pieces come from a seed — so the test can replay a
 * game exactly, and both wells in a race share one stream of pieces, which is what makes it fair.
 */

import { rng as seeded } from './bricks'

export const COLS = 10
export const ROWS = 20
/** rows above the top that a piece may poke into while it enters */
export const HIDDEN = 2

export type Kind = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L'
export const KINDS: Kind[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L']
/** a cell: 0 empty, 1–7 a settled piece's kind, 8 junk */
export type Cell = number
export const JUNK = 8

/** each shape's four squares in its spawn rotation, in a box of side `size` */
const SHAPES: Record<Kind, { size: number; cells: [number, number][] }> = {
  I: {
    size: 4,
    cells: [
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
    ],
  },
  O: {
    size: 2,
    cells: [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ],
  },
  T: {
    size: 3,
    cells: [
      [1, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
  },
  S: {
    size: 3,
    cells: [
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
    ],
  },
  Z: {
    size: 3,
    cells: [
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 1],
    ],
  },
  J: {
    size: 3,
    cells: [
      [0, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
  },
  L: {
    size: 3,
    cells: [
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
  },
}

/** a shape's squares after `rot` quarter turns clockwise, within its box (y grows downward) */
export function cellsOf(kind: Kind, rot: number): [number, number][] {
  const { size, cells } = SHAPES[kind]
  const r = ((rot % 4) + 4) % 4
  return cells.map(([x, y]) => {
    let [a, b] = [x, y]
    for (let i = 0; i < r; i++) [a, b] = [size - 1 - b, a]
    return [a, b]
  })
}

/** a seeded random source */
export { seeded }

/**
 * Pieces come in shuffled sets of all seven, so no shape is ever more than twelve pieces away —
 * a fair draw, and the same one for both wells in a race.
 */
export function bag(seed: number) {
  const rand = seeded(seed)
  const made: Kind[] = []
  return (i: number): Kind => {
    while (made.length <= i) {
      const set = [...KINDS]
      for (let j = set.length - 1; j > 0; j--) {
        const k = Math.floor(rand() * (j + 1))
        ;[set[j], set[k]] = [set[k], set[j]]
      }
      made.push(...set)
    }
    return made[i]
  }
}

export type Piece = { kind: Kind; rot: number; x: number; y: number }

export type Well = {
  /** rows top to bottom, HIDDEN extra rows above the visible ROWS */
  grid: Cell[][]
  piece: Piece | null
  /** index of the next piece in the shared draw */
  drawn: number
  hold: Kind | null
  /** a held piece cannot be swapped back until the next one locks */
  held: boolean
  /** seconds since the piece last fell a row */
  fall: number
  /** seconds the piece has rested on something; it locks at LOCK */
  rest: number
  /** moves made while resting: each one buys more time, up to a limit, so it cannot stall forever */
  resets: number
  lines: number
  score: number
  /** consecutive clearing pieces, for the combo bonus */
  combo: number
  /** junk rows waiting to rise, and which column each set leaves open */
  incoming: { rows: number; gap: number }[]
  /** junk sent to the other well since the last call to `sent` */
  outgoing: number
  /** rows that just cleared, for the page to flash */
  flash: number[]
  over: boolean
  /** seconds survived */
  time: number
}

export const LOCK = 0.5
export const MAX_RESETS = 15

/** seconds per row of fall: starts gentle and halves about every 75 s, never faster than 0.035 */
export function gravity(time: number): number {
  return Math.max(0.035, 0.8 * Math.pow(0.5, time / 75))
}
/** the level a person sees, which is only the speed told in whole numbers */
export const level = (time: number) => 1 + Math.floor(time / 30)

export function newWell(): Well {
  return {
    grid: Array.from({ length: ROWS + HIDDEN }, () => new Array(COLS).fill(0)),
    piece: null,
    drawn: 0,
    hold: null,
    held: false,
    fall: 0,
    rest: 0,
    resets: 0,
    lines: 0,
    score: 0,
    combo: -1,
    incoming: [],
    outgoing: 0,
    flash: [],
    over: false,
    time: 0,
  }
}

export function fits(grid: Cell[][], p: Piece): boolean {
  for (const [cx, cy] of cellsOf(p.kind, p.rot)) {
    const x = p.x + cx
    const y = p.y + cy
    if (x < 0 || x >= COLS || y >= ROWS + HIDDEN) return false
    if (y >= 0 && grid[y][x]) return false
  }
  return true
}

function spawn(w: Well, kind: Kind) {
  const size = kind === 'I' ? 4 : kind === 'O' ? 2 : 3
  const p: Piece = { kind, rot: 0, x: Math.floor((COLS - size) / 2), y: kind === 'I' ? 0 : 1 }
  w.fall = 0
  w.rest = 0
  w.resets = 0
  if (!fits(w.grid, p)) {
    w.piece = null
    w.over = true
    return
  }
  w.piece = p
}

/** the next piece from the shared draw */
export function next(w: Well, draw: (i: number) => Kind) {
  spawn(w, draw(w.drawn++))
}

/** what the piece would be dropped straight down */
export function ghost(w: Well): Piece | null {
  if (!w.piece) return null
  const p = { ...w.piece }
  while (fits(w.grid, { ...p, y: p.y + 1 })) p.y++
  return p
}

const onFloor = (w: Well) => !!w.piece && !fits(w.grid, { ...w.piece, y: w.piece.y + 1 })

/** a move while resting buys back the lock time, a limited number of times */
function touched(w: Well) {
  if (onFloor(w) && w.resets < MAX_RESETS) {
    w.rest = 0
    w.resets++
  }
}

export function shift(w: Well, dx: number): boolean {
  if (!w.piece || w.over) return false
  const p = { ...w.piece, x: w.piece.x + dx }
  if (!fits(w.grid, p)) return false
  w.piece = p
  touched(w)
  return true
}

/**
 * Turn a quarter, clockwise (1) or back (-1). Against a wall or a stack it tries a few small nudges —
 * sideways, then up — so a piece turns where a person expects it to rather than refusing.
 */
export function turn(w: Well, dir: 1 | -1): boolean {
  if (!w.piece || w.over) return false
  const rot = (w.piece.rot + dir + 4) % 4
  const reach = w.piece.kind === 'I' ? 2 : 1
  const tries: [number, number][] = [[0, 0]]
  for (let d = 1; d <= reach; d++) tries.push([-d, 0], [d, 0])
  tries.push([0, -1], [-1, -1], [1, -1])
  for (const [dx, dy] of tries) {
    const p = { ...w.piece, rot, x: w.piece.x + dx, y: w.piece.y + dy }
    if (fits(w.grid, p)) {
      w.piece = p
      touched(w)
      return true
    }
  }
  return false
}

/** what a clear of n rows scores, before the level multiplier */
export const CLEAR_POINTS = [0, 100, 300, 500, 800]
/** junk rows a clear of n sends across: a single sends nothing, four sends four */
export const SENDS = [0, 0, 1, 2, 4]

/** settle the piece, clear full rows, raise junk, and bring on the next piece */
function lock(w: Well, draw: (i: number) => Kind) {
  const p = w.piece
  if (!p) return
  let above = true
  for (const [cx, cy] of cellsOf(p.kind, p.rot)) {
    const y = p.y + cy
    if (y >= HIDDEN) above = false
    if (y >= 0) w.grid[y][p.x + cx] = KINDS.indexOf(p.kind) + 1
  }
  w.piece = null
  w.held = false
  // a piece that settles wholly above the visible well is the well overflowing
  if (above) {
    w.over = true
    return
  }
  const full: number[] = []
  for (let y = 0; y < w.grid.length; y++) if (w.grid[y].every((c) => c)) full.push(y)
  w.flash = full
  if (full.length) {
    w.grid = [
      ...full.map(() => new Array(COLS).fill(0)),
      ...w.grid.filter((_, y) => !full.includes(y)),
    ]
    w.combo++
    w.lines += full.length
    w.score += (CLEAR_POINTS[full.length] + 50 * w.combo) * level(w.time)
    let send = SENDS[full.length] + Math.min(3, Math.floor(w.combo / 2))
    // a clear cancels junk on its way in before it sends any
    while (send > 0 && w.incoming.length) {
      const take = Math.min(send, w.incoming[0].rows)
      w.incoming[0].rows -= take
      send -= take
      if (!w.incoming[0].rows) w.incoming.shift()
    }
    w.outgoing += send
  } else {
    w.combo = -1
    raise(w)
  }
  if (!w.over) next(w, draw)
}

/** junk waiting rises from the bottom, pushing the stack up; anything pushed off the top ends it */
function raise(w: Well) {
  for (const { rows, gap } of w.incoming) {
    for (let i = 0; i < rows; i++) {
      if (w.grid[0].some((c) => c)) w.over = true
      w.grid.shift()
      const row = new Array(COLS).fill(JUNK)
      row[gap] = 0
      w.grid.push(row)
    }
  }
  w.incoming = []
}

/** junk arriving from the other well, with its gap from the shared random stream */
export function receive(w: Well, rows: number, gap: number) {
  if (rows > 0) w.incoming.push({ rows, gap: Math.max(0, Math.min(COLS - 1, gap)) })
}

export function drop(w: Well, draw: (i: number) => Kind) {
  const g = ghost(w)
  if (!g || w.over) return
  w.score += 2 * (g.y - w.piece!.y)
  w.piece = g
  lock(w, draw)
}

export function swap(w: Well, draw: (i: number) => Kind) {
  if (!w.piece || w.held || w.over) return
  const was = w.hold
  w.hold = w.piece.kind
  w.held = true
  if (was) spawn(w, was)
  else next(w, draw)
}

/** advance one well by dt seconds: gravity, soft drop, and locking once it has rested long enough */
export function step(w: Well, dt: number, draw: (i: number) => Kind, soft = false) {
  if (w.over) return
  if (!w.piece) next(w, draw)
  if (w.over) return
  w.time += dt
  w.flash = []
  const per = soft ? Math.min(gravity(w.time), 0.03) : gravity(w.time)
  w.fall += dt
  while (w.fall >= per && w.piece) {
    w.fall -= per
    const p = { ...w.piece, y: w.piece.y + 1 }
    if (!fits(w.grid, p)) {
      w.fall = 0
      break
    }
    w.piece = p
    w.rest = 0
    if (soft) w.score += 1
  }
  if (onFloor(w)) {
    w.rest += dt
    if (w.rest >= LOCK) lock(w, draw)
  } else w.rest = 0
}

/** take what this well has sent since it was last asked */
export function sent(w: Well): number {
  const n = w.outgoing
  w.outgoing = 0
  return n
}

/* ---------------------------------------------------------------------------- the computer */

/**
 * Where the computer would put this piece: every rotation at every column, dropped straight, scored
 * on what the well looks like afterwards — lines cleared, the height of the stack, holes buried
 * under it, and how ragged its top is. The weights are the well-known hand-tuned ones for this kind
 * of game (holes and height bad, clears good); `care` below 1 makes it misjudge on purpose.
 */
/** how the computer weighs a landing: points per row cleared, and costs per cell of height, hole and ragged top */
export type Weights = { cleared: number; height: number; holes: number; bump: number }
/* ⚠️ `bump` TUNED BY SELF-PLAY, 10 Nov 2026: 0.18 → 0.132. Racing the old weights head to head,
   junk and all, it won 59.6% ± 2.8 of 1,200 races on seeds the search never saw. Caring a little
   less about a ragged top leaves it freer to keep a deep well open and clear several rows at once,
   which is what sends junk. A 40-round search kept nothing further. */
export const WEIGHTS: Weights = { cleared: 0.76, height: 0.51, holes: 0.36, bump: 0.132 }

export function plan(
  grid: Cell[][],
  kind: Kind,
  w: Weights = WEIGHTS,
): { rot: number; x: number; worth: number } | null {
  let best: { rot: number; x: number; worth: number } | null = null
  const turns = kind === 'O' ? 1 : kind === 'I' || kind === 'S' || kind === 'Z' ? 2 : 4
  for (let rot = 0; rot < turns; rot++) {
    for (let x = -3; x < COLS; x++) {
      let p: Piece = { kind, rot, x, y: 0 }
      if (!fits(grid, p)) continue
      while (fits(grid, { ...p, y: p.y + 1 })) p = { ...p, y: p.y + 1 }
      const worth = judge(grid, p, w)
      if (!best || worth > best.worth) best = { rot, x, worth }
    }
  }
  return best
}

export function judge(grid: Cell[][], p: Piece, w: Weights = WEIGHTS): number {
  const g = grid.map((r) => [...r])
  for (const [cx, cy] of cellsOf(p.kind, p.rot)) if (p.y + cy >= 0) g[p.y + cy][p.x + cx] = 1
  const rows = g.filter((r) => !r.every((c) => c))
  const cleared = g.length - rows.length
  const heights: number[] = []
  let holes = 0
  for (let x = 0; x < COLS; x++) {
    let top = rows.length
    for (let y = 0; y < rows.length; y++)
      if (rows[y][x]) {
        top = y
        break
      }
    heights.push(rows.length - top)
    for (let y = top + 1; y < rows.length; y++) if (!rows[y][x]) holes++
  }
  const sum = heights.reduce((a, b) => a + b, 0)
  let bump = 0
  for (let x = 1; x < COLS; x++) bump += Math.abs(heights[x] - heights[x - 1])
  return -w.height * sum + w.cleared * cleared - w.holes * holes - w.bump * bump
}

/** how hard the computer plays: moves it makes a second, and how often it picks a worse spot */
export const BOTS = {
  easy: { moves: 5, slip: 0.12 },
  medium: { moves: 8, slip: 0.04 },
  hard: { moves: 14, slip: 0 },
} as const
export type Bot = keyof typeof BOTS

/**
 * The computer's hands: it decides where the piece goes when the piece arrives, then makes the
 * moves to get there at its own pace, and drops it. It plays by the same rules as a person — a
 * piece it has not finished steering still falls.
 */
export function botHands(bot: Bot, rand: () => number, weights: Weights = WEIGHTS) {
  let target: { rot: number; x: number } | null = null
  let forPiece = -1
  let wait = 0
  return (w: Well, dt: number, draw: (i: number) => Kind) => {
    if (!w.piece || w.over) return
    if (forPiece !== w.drawn) {
      forPiece = w.drawn
      const best = plan(w.grid, w.piece.kind, weights)
      target = best
      // now and then it misjudges: a random column, one rotation off
      if (best && rand() < BOTS[bot].slip) {
        target = { rot: (best.rot + 1) % 4, x: Math.floor(rand() * COLS) - 1 }
      }
      wait = 1 / BOTS[bot].moves
    }
    wait -= dt
    while (wait <= 0 && target && w.piece) {
      wait += 1 / BOTS[bot].moves
      if (w.piece.rot !== target.rot) {
        if (!turn(w, 1)) target = { ...target, rot: w.piece.rot }
      } else if (w.piece.x !== target.x) {
        if (!shift(w, Math.sign(target.x - w.piece.x))) target = { ...target, x: w.piece.x }
      } else {
        drop(w, draw)
        break
      }
    }
  }
}

/* ---------------------------------------------------------------------------- what is kept */

export const STACK_KEY = 'lab_stack_v1'
export type Saved = {
  /** longest survival alone, in seconds */
  longest: number
  /** most lines in one game alone */
  lines: number
  /** best score alone */
  score: number
  /** wins and losses against each computer */
  wins: Record<Bot, number>
  losses: Record<Bot, number>
}
export const EMPTY: Saved = {
  longest: 0,
  lines: 0,
  score: 0,
  wins: { easy: 0, medium: 0, hard: 0 },
  losses: { easy: 0, medium: 0, hard: 0 },
}
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
  const num = (x: unknown) =>
    typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1e9 ? x : null
  out.longest = num(o.longest) ?? 0
  out.lines = Math.round(num(o.lines) ?? 0)
  out.score = Math.round(num(o.score) ?? 0)
  for (const k of ['wins', 'losses'] as const) {
    const r = o[k]
    if (typeof r !== 'object' || !r) continue
    for (const b of Object.keys(BOTS) as Bot[])
      out[k][b] = Math.round(num((r as Record<string, unknown>)[b]) ?? 0)
  }
  return out
}
