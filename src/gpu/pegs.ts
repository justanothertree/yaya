/**
 * Peg solitaire: a board of holes, every one with a peg in it but one. Jump a peg over its
 * neighbour into an empty hole beyond, and the peg jumped over comes off. Finish with a single peg,
 * and with it in the hole that started empty for a perfect game.
 *
 * Pure, so pegs.test.ts can play and solve boards without a page. Holes are numbered in reading
 * order; every legal jump on a board is listed once, as the hole it starts from, the hole it jumps,
 * and the hole it lands in.
 */

/**
 * The 33-hole cross and the 15-hole triangle. The 37-hole European board was tried and left out: its
 * solver ran past five million positions without an answer, so it could give no hints at all.
 */
export const BOARDS = ['english', 'triangle'] as const
export type BoardKind = (typeof BOARDS)[number]
export type Layout = {
  kind: BoardKind
  /** where each hole is drawn, in rows and columns (a triangle's rows are offset when drawn) */
  holes: { r: number; c: number }[]
  /** every jump, as [from, over, to] */
  jumps: [number, number, number][]
  /** the hole left empty at the start, unless another is chosen */
  start: number
  rows: number
  cols: number
  /** the board's own symmetries, each as where every hole goes; the first is no change at all */
  syms: number[][]
}

function grid(kind: BoardKind): { r: number; c: number }[] {
  const out: { r: number; c: number }[] = []
  if (kind === 'triangle') {
    for (let r = 0; r < 5; r++) for (let c = 0; c <= r; c++) out.push({ r, c })
    return out
  }
  for (let r = 0; r < 7; r++)
    for (let c = 0; c < 7; c++) if ((r >= 2 && r <= 4) || (c >= 2 && c <= 4)) out.push({ r, c })
  return out
}

const cache = new Map<BoardKind, Layout>()
export function layout(kind: BoardKind): Layout {
  const hit = cache.get(kind)
  if (hit) return hit
  const holes = grid(kind)
  const at = new Map(holes.map((h, i) => [`${h.r},${h.c}`, i]))
  const dirs =
    kind === 'triangle'
      ? [
          [0, 1],
          [0, -1],
          [1, 0],
          [-1, 0],
          [1, 1],
          [-1, -1],
        ]
      : [
          [0, 1],
          [0, -1],
          [1, 0],
          [-1, 0],
        ]
  const jumps: [number, number, number][] = []
  holes.forEach((h, i) => {
    for (const [dr, dc] of dirs) {
      const over = at.get(`${h.r + dr},${h.c + dc}`)
      const to = at.get(`${h.r + 2 * dr},${h.c + 2 * dc}`)
      if (over !== undefined && to !== undefined) jumps.push([i, over, to])
    }
  })
  // the cross starts with its centre empty, the triangle with its top
  const start = kind === 'english' ? at.get('3,3')! : at.get('0,0')!
  // the square boards turn and flip eight ways; the triangle six, permuting its three corners
  const maps: ((r: number, c: number) => [number, number])[] =
    kind === 'triangle'
      ? [
          (r, c) => [r, c],
          (r, c) => [r, r - c],
          (r, c) => [4 - c, r - c],
          (r, c) => [4 - c, 4 - r],
          (r, c) => [4 - r + c, c],
          (r, c) => [4 - r + c, 4 - r],
        ]
      : [
          (r, c) => [r, c],
          (r, c) => [c, 6 - r],
          (r, c) => [6 - r, 6 - c],
          (r, c) => [6 - c, r],
          (r, c) => [r, 6 - c],
          (r, c) => [6 - r, c],
          (r, c) => [c, r],
          (r, c) => [6 - c, 6 - r],
        ]
  const syms = maps.map((f) =>
    holes.map((h) => {
      const [r, c] = f(h.r, h.c)
      return at.get(`${r},${c}`) ?? -1
    }),
  )
  const L: Layout = {
    kind,
    holes,
    jumps,
    start,
    rows: kind === 'triangle' ? 5 : 7,
    cols: kind === 'triangle' ? 5 : 7,
    syms: syms.filter((m) => m.every((x) => x >= 0)),
  }
  cache.set(kind, L)
  return L
}

export type Game = {
  kind: BoardKind
  pegs: boolean[]
  history: [number, number, number][]
  /** the hole that started empty, where a perfect game ends */
  start: number
}
export function newGame(kind: BoardKind, start?: number): Game {
  const L = layout(kind)
  const s = start ?? L.start
  return { kind, pegs: L.holes.map((_, i) => i !== s), history: [], start: s }
}
export const left = (g: Game) => g.pegs.filter(Boolean).length
/** every jump that can be made now */
export const moves = (g: Game) =>
  layout(g.kind).jumps.filter(([f, o, t]) => g.pegs[f] && g.pegs[o] && !g.pegs[t])
export function jump(g: Game, m: [number, number, number]): Game {
  const [f, o, t] = m
  if (!g.pegs[f] || !g.pegs[o] || g.pegs[t]) return g
  const pegs = g.pegs.slice()
  pegs[f] = false
  pegs[o] = false
  pegs[t] = true
  return { ...g, pegs, history: [...g.history, m] }
}
export function undo(g: Game): Game {
  const m = g.history[g.history.length - 1]
  if (!m) return g
  const pegs = g.pegs.slice()
  pegs[m[0]] = true
  pegs[m[1]] = true
  pegs[m[2]] = false
  return { ...g, pegs, history: g.history.slice(0, -1) }
}
export const over = (g: Game) => moves(g).length === 0
/** one peg left, and in the hole that started empty */
export const perfect = (g: Game) => left(g) === 1 && g.pegs[g.start]

/* --------------------------------------------------------------------------- the solver */

export type Solved = { moves: [number, number, number][] } | 'none' | 'unsure'
/**
 * The jumps from here to a single peg — in the hole that started empty, if `home` is asked for — or
 * 'none' when there is no way at all, or 'unsure' when the look ran past `budget` positions. A
 * depth-first search that remembers every position it has found to be a dead end, together with
 * every turn and reflection of it.
 */
export function solve(g: Game, home = false, budget = 400_000): Solved {
  const L = layout(g.kind)
  const pegs = g.pegs.slice()
  const n = pegs.length
  const pow = Array.from({ length: n }, (_, i) => 2 ** i)
  let key = pegs.reduce((k, p, i) => k + (p ? pow[i] : 0), 0)
  let count = pegs.filter(Boolean).length
  const dead = new Set<number>()
  const path: [number, number, number][] = []
  let looked = 0
  // a dead end turned or flipped is a dead end too — though when the last peg must finish in one
  // hole, only the turns that leave that hole where it is
  const syms = home ? L.syms.filter((m) => m[g.start] === g.start) : L.syms
  const canon = () => {
    let best = key
    for (let s = 1; s < syms.length; s++) {
      let k = 0
      for (let i = 0; i < n; i++) if (pegs[i]) k += pow[syms[s][i]]
      if (k < best) best = k
    }
    return best
  }
  const go = (): boolean | null => {
    if (count === 1) return !home || pegs[g.start]
    const ck = canon()
    if (dead.has(ck)) return false
    if (++looked > budget) return null
    for (const m of L.jumps) {
      const [f, o, t] = m
      if (!pegs[f] || !pegs[o] || pegs[t]) continue
      pegs[f] = false
      pegs[o] = false
      pegs[t] = true
      key += pow[t] - pow[f] - pow[o]
      count--
      path.push(m)
      const r = go()
      if (r) return true
      path.pop()
      count++
      key -= pow[t] - pow[f] - pow[o]
      pegs[f] = true
      pegs[o] = true
      pegs[t] = false
      if (r === null) return null
    }
    dead.add(ck)
    return false
  }
  const r = go()
  return r === null ? 'unsure' : r ? { moves: path.slice() } : 'none'
}

/* --------------------------------------------------------------------------- what is kept */

export const PEGS_KEY = 'lab_pegs_v1'
export const LOOKS = ['marble', 'wood', 'glow'] as const
export type Saved = {
  board: BoardKind
  look: (typeof LOOKS)[number]
  /** the fewest pegs you have finished with on each board, 0 for never finished */
  best: Record<BoardKind, number>
  /** finishes with one peg in the centre */
  perfects: Record<BoardKind, number>
}
export const EMPTY: Saved = {
  board: 'english',
  look: 'marble',
  best: { english: 0, triangle: 0 },
  perfects: { english: 0, triangle: 0 },
}
const small = (v: unknown, hi: number) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= hi ? v : 0
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
  const p = (typeof o.perfects === 'object' && o.perfects ? o.perfects : {}) as Record<
    string,
    unknown
  >
  const best = {} as Saved['best']
  const perfects = {} as Saved['perfects']
  for (const k of BOARDS) {
    best[k] = small(b[k], 33)
    perfects[k] = small(p[k], 1e6)
  }
  return {
    board: pick(BOARDS, o.board, EMPTY.board),
    look: pick(LOOKS, o.look, EMPTY.look),
    best,
    perfects,
  }
}
