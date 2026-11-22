import {
  CELLS,
  N,
  TALL,
  at,
  blocks,
  emptyBuild,
  fewest,
  matches,
  shadowsOf,
  type Build,
  type Shadows,
  type Show,
} from './shadowbox'
import type { Mode, Rules, Seat } from '../lab/social/room'

/**
 * Shadow box as a match by turns (src/lab/matches): rounds of hide and rebuild. Each round, each
 * side hides a box — a build, and which of its three shadows the lamps throw — and rebuilds the
 * other's from those shadows alone. A rebuild must throw the same shadows, so it always matches;
 * what it is scored on is how many blocks it takes OVER PAR, par being the toy's own `fewest`.
 *
 * ⚠️ SCORED OVER PAR, NOT IN BLOCKS. Each side rebuilds the OTHER's boxes, so counting blocks would
 * hand the match to whoever hides the bigger box. Over par, a box is worth hiding for being hard to
 * rebuild cheaply, which is the toy's whole puzzle, and finding par is the guesser's skill.
 *
 * A move is a rebuild of the other side's waiting box, with the mover's next box when one is due —
 * the friend's first box comes with their yes, the challenger's with their first move. Turns
 * alternate, the challenger first; the side that moves last brings no box. The boxes are kept back
 * (Rules.hidden), as Sea battle's fleets are, until the match is over: the state carries only the
 * shadows each box throws, worked out on the server, and they are checked against the boxes.
 * Together, the friends hide one box between them and take the team's moves in turn, and the
 * computer hides its own and rebuilds theirs.
 */
export type Box = { build: Build; show: Show }
export type Clue = { show: Show; shadows: Shadows }
export type BoxMove = { rebuild: Build; box?: Box }
export type BoxGame = {
  rounds: number
  /** each side's hidden boxes, round by round: null in a browser until the match is over */
  boxes: [(Box | null)[], (Box | null)[]]
  /** the shadows each side's boxes throw, round by round — what the other side rebuilds from */
  clues: [Clue[], Clue[]]
  /** each side's rebuilds of the other's boxes, round by round */
  rebuilds: [Build[], Build[]]
}

export const ROUNDS = [1, 3, 5] as const

/** the match's rules from its settings, its defaults when none are named; null for anything else */
export function readBoxSettings(s: Record<string, unknown>): { rounds: number } | null {
  const rounds = s.rounds ?? 3
  return (ROUNDS as readonly unknown[]).includes(rounds) ? { rounds: rounds as number } : null
}

const other = (s: Seat): Seat => (s === 0 ? 1 : 0)
const isBuild = (x: unknown): x is Build =>
  Array.isArray(x) &&
  x.length === CELLS &&
  x.every((h) => Number.isInteger(h) && (h as number) >= 0 && (h as number) <= TALL)
const readShow = (x: unknown): Show | null => {
  const o = x as Record<string, unknown> | null
  if (!o || typeof o !== 'object') return null
  const { front, side, top } = o
  if (typeof front !== 'boolean' || typeof side !== 'boolean' || typeof top !== 'boolean')
    return null
  return front || side || top ? { front, side, top } : null
}
/** a box from the wire: a build of at least one block, at least one lamp on; null otherwise */
export function readBox(x: unknown): Box | null {
  const o = x as { build?: unknown; show?: unknown } | null
  if (!o || typeof o !== 'object' || !isBuild(o.build) || blocks(o.build) === 0) return null
  const show = readShow(o.show)
  return show ? { build: [...o.build], show } : null
}

export const clueOf = (b: Box): Clue => ({ show: { ...b.show }, shadows: shadowsOf(b.build) })
/** what a rebuild of this clue scores: its blocks over the toy's par */
export const overPar = (rebuild: Build, c: Clue) =>
  blocks(rebuild) - blocks(fewest(c.shadows, c.show))
/** a build that throws a clue's shadows, for the GPU to cast them by: par itself */
export const standIn = (c: Clue) => fewest(c.shadows, c.show)

/** whose move it is, or null when every round is rebuilt both ways */
export function whoseMove(g: BoxGame): Seat | null {
  const k = g.rebuilds[0].length + g.rebuilds[1].length
  return k >= 2 * g.rounds ? null : k % 2 === 0 ? 0 : 1
}
/** the box a side must rebuild next, if the other side has hidden it */
export const waiting = (g: BoxGame, s: Seat): Clue | null =>
  g.clues[other(s)][g.rebuilds[s].length] ?? null
/** whether a side's move must bring its next box: the one the other side rebuilds next */
export const owesBox = (g: BoxGame, s: Seat) =>
  g.clues[s].length === g.rebuilds[other(s)].length && g.rebuilds[other(s)].length < g.rounds

/** each side's total over par so far */
export const totals = (g: BoxGame): [number, number] =>
  [0, 1].map((s) =>
    g.rebuilds[s].reduce((a, b, i) => a + overPar(b, g.clues[other(s as Seat)][i]), 0),
  ) as [number, number]

const fresh = (rounds: number): BoxGame => ({
  rounds,
  boxes: [[], []],
  clues: [[], []],
  rebuilds: [[], []],
})

function readMove(x: unknown): BoxMove | null {
  const o = x as { rebuild?: unknown; box?: unknown } | null
  if (!o || typeof o !== 'object' || !isBuild(o.rebuild)) return null
  if (o.box === undefined) return { rebuild: [...o.rebuild] }
  const box = readBox(o.box)
  return box ? { rebuild: [...o.rebuild], box } : null
}

/** a side's box placed: kept back, and its shadows worked out for everybody */
function placed(g: BoxGame, s: Seat, box: Box | null, clue: Clue): BoxGame {
  const boxes: BoxGame['boxes'] = [[...g.boxes[0]], [...g.boxes[1]]]
  const clues: BoxGame['clues'] = [[...g.clues[0]], [...g.clues[1]]]
  boxes[s].push(box)
  clues[s].push(clue)
  return { ...g, boxes, clues }
}

/** a move, or null if it is not one: a rebuild throwing the waiting shadows, a box when one is owed */
function moved(g: BoxGame, m: BoxMove, s: Seat): BoxGame | null {
  const c = waiting(g, s)
  if (!c || !matches(m.rebuild, c.shadows, c.show)) return null
  if (owesBox(g, s) !== (m.box !== undefined)) return null
  const rebuilds: BoxGame['rebuilds'] = [[...g.rebuilds[0]], [...g.rebuilds[1]]]
  rebuilds[s].push([...m.rebuild])
  const cur = { ...g, rebuilds }
  return m.box ? placed(cur, s, m.box, clueOf(m.box)) : cur
}

/* ---------------------------------------------------------------- the wire ------------------ */

const showBits = (s: Show) => (s.front ? 1 : 0) | (s.side ? 2 : 0) | (s.top ? 4 : 0)
const bitsShow = (n: number): Show => ({ front: !!(n & 1), side: !!(n & 2), top: !!(n & 4) })
const digits = (b: Build) => b.join('')
const undigit = (x: unknown): Build | null =>
  typeof x === 'string' && x.length === CELLS && /^[0-4]+$/.test(x) ? [...x].map(Number) : null

/** a clue on the wire: which lamps, and only the shadows they throw */
function writeClue(c: Clue) {
  return {
    show: showBits(c.show),
    ...(c.show.front ? { front: c.shadows.front } : {}),
    ...(c.show.side ? { side: c.shadows.side } : {}),
    ...(c.show.top ? { top: c.shadows.top.map((t) => (t ? 1 : 0)).join('') } : {}),
  }
}
const isLine = (x: unknown) =>
  Array.isArray(x) &&
  x.length === N &&
  x.every((h) => Number.isInteger(h) && (h as number) >= 0 && (h as number) <= TALL)
/** a clue from the wire; what its lamps do not throw is left empty, and is never asked of it */
function readClue(x: unknown): Clue | null {
  const o = x as { show?: unknown; front?: unknown; side?: unknown; top?: unknown } | null
  if (!o || typeof o !== 'object' || !Number.isInteger(o.show)) return null
  const bits = o.show as number
  if (bits < 1 || bits > 7) return null
  const show = bitsShow(bits)
  const keys = Object.keys(o).filter((k) => k !== 'show')
  const want = (['front', 'side', 'top'] as const).filter((k) => show[k])
  if (keys.length !== want.length || !want.every((k) => k in o)) return null
  if (show.front && !isLine(o.front)) return null
  if (show.side && !isLine(o.side)) return null
  if (show.top && !(typeof o.top === 'string' && /^[01]{25}$/.test(o.top))) return null
  const shadows: Shadows = {
    front: show.front ? [...(o.front as number[])] : new Array<number>(N).fill(0),
    side: show.side ? [...(o.side as number[])] : new Array<number>(N).fill(0),
    top: show.top ? [...(o.top as string)].map((c) => c === '1') : new Array(CELLS).fill(false),
  }
  // shadows some build could throw: the walls agree on the tallest stack, the floor has blocks
  if (show.front && show.side && Math.max(...shadows.front) !== Math.max(...shadows.side))
    return null
  if (show.front && Math.max(...shadows.front) === 0) return null
  if (show.side && Math.max(...shadows.side) === 0) return null
  if (show.top && !shadows.top.some(Boolean)) return null
  return { show, shadows }
}
/** the shadows a clue shows, and only those, for comparing two */
const same = (a: Clue, b: Clue) => JSON.stringify(writeClue(a)) === JSON.stringify(writeClue(b))

/**
 * The match anybody in it may see, or null if it is not one: clues and rebuilds in the order the
 * turns make them, every rebuild throwing the shadows it answers, and — once it is over — both
 * sides' boxes, which must throw the shadows the clues say.
 */
export function replayPublic(rounds: number, x: unknown): BoxGame | null {
  const o = x as { clues?: unknown; rebuilds?: unknown; boxes?: unknown } | null
  if (!o || typeof o !== 'object' || !Array.isArray(o.clues) || !Array.isArray(o.rebuilds))
    return null
  if (o.clues.length !== 2 || o.rebuilds.length !== 2) return null
  const clues = (o.clues as unknown[]).map((l) =>
    Array.isArray(l) && l.length <= rounds ? l.map(readClue) : null,
  )
  const rebuilds = (o.rebuilds as unknown[]).map((l) =>
    Array.isArray(l) && l.length <= rounds ? l.map(undigit) : null,
  )
  if (clues.some((l) => !l || l.some((c) => !c))) return null
  if (rebuilds.some((l) => !l || l.some((b) => !b))) return null
  const C = clues as Clue[][]
  const B = rebuilds as Build[][]
  // the friend's first box came with the yes; then each move, in turn, as the rules make them
  let g = fresh(rounds)
  if (C[1].length) g = placed(g, 1, null, C[1][0])
  for (;;) {
    const s = whoseMove(g)
    if (s === null || g.rebuilds[s].length >= B[s].length) break
    const box = owesBox(g, s) ? C[s][g.clues[s].length] : undefined
    if (owesBox(g, s) && !box) return null
    const c = waiting(g, s)
    if (!c || !matches(B[s][g.rebuilds[s].length], c.shadows, c.show)) return null
    const rb: BoxGame['rebuilds'] = [[...g.rebuilds[0]], [...g.rebuilds[1]]]
    rb[s].push(B[s][g.rebuilds[s].length])
    g = { ...g, rebuilds: rb }
    if (box) g = placed(g, s, null, box)
  }
  // nothing left over that the turns did not reach
  for (const s of [0, 1] as Seat[])
    if (g.rebuilds[s].length !== B[s].length || g.clues[s].length !== C[s].length) return null
  if (o.boxes !== undefined) {
    const boxes = o.boxes as unknown[]
    if (whoseMove(g) !== null || !Array.isArray(boxes) || boxes.length !== 2) return null
    const read = boxes.map((l) => (Array.isArray(l) ? l.map(readBox) : null))
    if (read.some((l) => !l || l.some((b) => !b))) return null
    const joined = rejoin(g, read as Box[][])
    if (!joined) return null
    g = joined
  }
  return g
}

/** the match with its boxes put back; null unless each box throws the shadows its clue says */
function rejoin(g: BoxGame, boxes: (Box | null)[][]): BoxGame | null {
  for (const s of [0, 1] as Seat[]) {
    if (boxes[s].length !== g.clues[s].length) return null
    for (let i = 0; i < boxes[s].length; i++) {
      const b = boxes[s][i]
      if (!b || !same(clueOf(b), g.clues[s][i])) return null
    }
  }
  return { ...g, boxes: [[...boxes[0]], [...boxes[1]]] }
}

/* ---------------------------------------------------------------- the computer -------------- */

/** a box for the computer to hide: a few stacks, with the walls or all three lamps on */
export function randomBox(rand: () => number): Box {
  const build = emptyBuild()
  const stacks = 3 + Math.floor(rand() * 5)
  for (let k = 0; k < stacks; k++) build[Math.floor(rand() * CELLS)] = 1 + Math.floor(rand() * TALL)
  const top = rand() < 0.5
  return { build, show: { front: true, side: true, top } }
}

/** the tallest each cell may stand and still throw a clue's shadows: the fullest rebuild */
export function fullest(c: Clue): Build {
  const b = emptyBuild()
  for (let z = 0; z < N; z++)
    for (let x = 0; x < N; x++) {
      if (c.show.top && !c.shadows.top[at(x, z)]) continue
      b[at(x, z)] = Math.min(
        c.show.front ? c.shadows.front[x] : TALL,
        c.show.side ? c.shadows.side[z] : TALL,
      )
    }
  return b
}

/**
 * The computer's rebuild at each level. Hard builds par. Easy builds the fullest stack every cell
 * may hold. Fair starts from the fullest and takes away whatever it can, a cell at a time in a
 * random order, so it ends where nothing more can go — a rebuild with no block to spare that is
 * not always the fewest.
 */
export function rebuildFor(c: Clue, level: string, rand: () => number): Build {
  if (level === 'hard') return fewest(c.shadows, c.show)
  const full = fullest(c)
  if (level === 'easy') return full
  let b = full
  const order = [...Array(CELLS).keys()].sort(() => rand() - 0.5)
  for (const i of order)
    for (let h = 0; h < b[i]; h++) {
      const t = b.slice()
      t[i] = h
      if (matches(t, c.shadows, c.show)) {
        b = t
        break
      }
    }
  return b
}

export function boxRules(rounds: number): Rules<BoxGame, BoxMove> {
  return {
    fresh: () => fresh(rounds),
    turn: whoseMove,
    legal: (g, m, by) => {
      const s = whoseMove(g)
      if (s === null || (by !== undefined && by !== s)) return false
      return moved(g, m, s) !== null
    },
    apply: (g, m) => {
      const s = whoseMove(g)
      return s === null ? g : (moved(g, m, s) ?? g)
    },
    encode: (g) => ({
      clues: g.clues.map((l) => l.map(writeClue)),
      rebuilds: g.rebuilds.map((l) => l.map(digits)),
      // once it is over every box is shown; before, none is ever here
      ...(whoseMove(g) === null && g.boxes.every((l) => l.every(Boolean))
        ? { boxes: g.boxes }
        : {}),
    }),
    decode: (x) => replayPublic(rounds, x),
    readMove,
    modes: ['versus', 'together'],
    computer: {
      side: 1,
      levels: ['easy', 'fair', 'hard'],
      choose: (g, level) => {
        const c = waiting(g, 1)
        const rebuild = c ? rebuildFor(c, level, Math.random) : emptyBuild()
        return owesBox(g, 1) ? { rebuild, box: randomBox(Math.random) } : { rebuild }
      },
    },
    result: (g) => {
      if (whoseMove(g) !== null) return null
      const [a, b] = totals(g)
      return a < b ? 0 : b < a ? 1 : 'draw'
    },
    begun: (g) => g.rebuilds[0].length > 0,
    hidden: {
      secret: (g) => ({ boxes: g.boxes }),
      join: (g, secret) => {
        const boxes = (secret as { boxes?: unknown } | null)?.boxes
        if (!Array.isArray(boxes) || boxes.length !== 2) return null
        const read = boxes.map((l) => (Array.isArray(l) ? l.map(readBox) : null))
        if (read.some((l) => !l || l.some((b) => !b))) return null
        return rejoin(g, read as Box[][])
      },
      mine: (g, side) => g.boxes[side],
      logged: (m) => ({ rebuild: m.rebuild }),
      accept: (g, brought, mode: Mode) => {
        // together, the computer's first box is chosen here; versus, the friend brings theirs
        const box = mode === 'together' ? randomBox(Math.random) : readBox(brought)
        return box ? placed(g, 1, box, clueOf(box)) : null
      },
    },
  }
}
