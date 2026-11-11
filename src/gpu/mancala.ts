/**
 * Mancala, the sowing game, played the Kalah way: pick up every seed in one of your pits and sow
 * them one at a time anticlockwise, into your own store but never your opponent's. End in your
 * store and you go again; end in an empty pit of your own, opposite seeds of theirs, and you take
 * both. When either side runs dry the game is over and each side keeps what is left on it.
 * Pure, so mancala.test.ts can play whole games and pit computer against computer without a page.
 *
 * ⚠️ THE BOARD IS ONE ARRAY, AND THE STORES ARE IN IT. With n pits a side, your pits are 0…n-1,
 * your store is n, theirs are n+1…2n and their store is 2n+1 — so sowing is just "the next index,
 * skipping their store", and the pit opposite i is always 2n − i. Every rule below is that sum.
 */

export type Side = 0 | 1
export type Board = number[]
export type Rules = { pits: number; seeds: number; captures: boolean }
export const DEFAULT_RULES: Rules = { pits: 6, seeds: 4, captures: true }
export const PIT_CHOICES = [4, 5, 6] as const
export const SEED_CHOICES = [3, 4, 5, 6] as const

export const pitsOf = (b: Board) => (b.length - 2) / 2
export const storeOf = (b: Board, side: Side) => (side === 0 ? pitsOf(b) : 2 * pitsOf(b) + 1)
export const opposite = (b: Board, i: number) => 2 * pitsOf(b) - i
/** the indices of one side's pits, in sowing order */
export const pitsFor = (b: Board, side: Side) => {
  const n = pitsOf(b)
  return Array.from({ length: n }, (_, k) => (side === 0 ? k : n + 1 + k))
}
export const owner = (b: Board, i: number): Side | null =>
  i === storeOf(b, 0) || i === storeOf(b, 1) ? null : i < pitsOf(b) ? 0 : 1

export function start(rules: Rules): Board {
  const b = Array<number>(2 * rules.pits + 2).fill(rules.seeds)
  b[rules.pits] = 0
  b[2 * rules.pits + 1] = 0
  return b
}

export const legal = (b: Board, side: Side) => pitsFor(b, side).filter((i) => b[i] > 0)

export type Sown = {
  board: Board
  /** every place a seed was dropped, in order — what the page animates */
  path: number[]
  /** the side to move next: the same side after ending in its own store */
  next: Side
  /** seeds taken by a capture, and from where */
  captured: { from: number; seeds: number } | null
  /** the game is over, and the leftovers have gone to their owners' stores */
  over: boolean
}

export function sow(b: Board, pit: number, side: Side, rules: Pick<Rules, 'captures'>): Sown {
  if (owner(b, pit) !== side || b[pit] === 0) throw new Error(`side ${side} cannot sow from ${pit}`)
  const board = [...b]
  const skip = storeOf(b, side === 0 ? 1 : 0)
  let hand = board[pit]
  board[pit] = 0
  let at = pit
  const path: number[] = []
  while (hand > 0) {
    at = (at + 1) % board.length
    if (at === skip) continue
    board[at]++
    path.push(at)
    hand--
  }
  let captured: Sown['captured'] = null
  const mine = storeOf(b, side)
  if (rules.captures && owner(board, at) === side && board[at] === 1) {
    const opp = opposite(board, at)
    if (board[opp] > 0) {
      captured = { from: opp, seeds: board[opp] + 1 }
      board[mine] += board[opp] + 1
      board[opp] = 0
      board[at] = 0
    }
  }
  let next: Side = at === mine ? side : side === 0 ? 1 : 0
  const over = legal(board, 0).length === 0 || legal(board, 1).length === 0
  if (over) {
    for (const s of [0, 1] as const)
      for (const i of pitsFor(board, s)) {
        board[storeOf(board, s)] += board[i]
        board[i] = 0
      }
    next = side
  }
  return { board, path, next, captured, over }
}

/** where the last seed from a pit would land — the page's hint */
export function landing(b: Board, pit: number, side: Side): number {
  const skip = storeOf(b, side === 0 ? 1 : 0)
  let hand = b[pit]
  let at = pit
  while (hand > 0) {
    at = (at + 1) % b.length
    if (at !== skip) hand--
  }
  return at
}

export const score = (b: Board): [number, number] => [b[storeOf(b, 0)], b[storeOf(b, 1)]]
export const total = (b: Board) => b.reduce((s, x) => s + x, 0)

/* ---------------------------------------------------------------------------- the computer */

export const LEVELS = ['easy', 'fair', 'hard'] as const
export type Level = (typeof LEVELS)[number]
/** how far ahead each level looks, in moves (a go-again counts as a move) */
export const DEPTH: Record<Level, number> = { easy: 1, fair: 4, hard: 9 }

/** the store difference, from the point of view of `side`; a finished game counts ten times over */
function value(b: Board, side: Side): number {
  const [a, c] = score(b)
  const me = side === 0 ? a - c : c - a
  return me * 100
}

function search(
  b: Board,
  side: Side,
  me: Side,
  depth: number,
  alpha: number,
  beta: number,
  rules: Rules,
): number {
  const moves = legal(b, side)
  if (depth === 0 || moves.length === 0) return value(b, me)
  // go-agains first: they are usually best, and they make the cut-offs come early
  const ordered = moves
    .map((m) => ({ m, s: sow(b, m, side, rules) }))
    .sort((x, y) => Number(y.s.next === side) - Number(x.s.next === side))
  if (side === me) {
    let best = -Infinity
    for (const { s } of ordered) {
      const v = s.over
        ? value(s.board, me) * 10
        : search(s.board, s.next, me, depth - 1, alpha, beta, rules)
      best = Math.max(best, v)
      alpha = Math.max(alpha, v)
      if (alpha >= beta) break
    }
    return best
  }
  let best = Infinity
  for (const { s } of ordered) {
    const v = s.over
      ? value(s.board, me) * 10
      : search(s.board, s.next, me, depth - 1, alpha, beta, rules)
    best = Math.min(best, v)
    beta = Math.min(beta, v)
    if (alpha >= beta) break
  }
  return best
}

/**
 * The computer's move. Easy looks one move ahead and is wrong a third of the time on purpose;
 * fair and hard search deeper. Ties between equally good pits are broken by `rand`, so it does not
 * play the same game every time.
 */
export function choose(
  b: Board,
  side: Side,
  level: Level,
  rules: Rules,
  rand: () => number = Math.random,
): number {
  const moves = legal(b, side)
  if (moves.length === 1) return moves[0]
  if (level === 'easy' && rand() < 0.35) return moves[Math.floor(rand() * moves.length)]
  let best: number[] = []
  let bv = -Infinity
  for (const m of moves) {
    const s = sow(b, m, side, rules)
    const v = s.over
      ? value(s.board, side) * 10
      : search(s.board, s.next, side, DEPTH[level] - 1, -Infinity, Infinity, rules)
    if (v > bv) {
      bv = v
      best = [m]
    } else if (v === bv) best.push(m)
  }
  return best[Math.floor(rand() * best.length)]
}

/* ---------------------------------------------------------------------------- what is kept */

export const MANCALA_KEY = 'lab_mancala_v1'
export const LOOKS = ['wood', 'stone', 'sea'] as const
export const SEED_LOOKS = ['beads', 'pebbles', 'gems'] as const
export type Tally = { won: number; lost: number; drawn: number; best: number }
export type Saved = {
  rules: Rules
  level: Level
  look: (typeof LOOKS)[number]
  seedLook: (typeof SEED_LOOKS)[number]
  hints: boolean
  /** results per level; `best` is the widest winning margin */
  record: Record<Level, Tally>
}
const NONE: Tally = { won: 0, lost: 0, drawn: 0, best: 0 }
export const EMPTY: Saved = {
  rules: DEFAULT_RULES,
  level: 'fair',
  look: 'wood',
  seedLook: 'beads',
  hints: false,
  record: { easy: NONE, fair: NONE, hard: NONE },
}

const count = (v: unknown) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e6 ? v : 0
export function readSaved(text: string | null): Saved {
  let v: unknown
  try {
    v = JSON.parse(text ?? 'null')
  } catch {
    return EMPTY
  }
  if (typeof v !== 'object' || !v || Array.isArray(v)) return EMPTY
  const o = v as Record<string, unknown>
  const r = (typeof o.rules === 'object' && o.rules ? o.rules : {}) as Record<string, unknown>
  const pick = <T>(list: readonly T[], x: unknown, d: T): T =>
    list.includes(x as T) ? (x as T) : d
  const rec = (typeof o.record === 'object' && o.record ? o.record : {}) as Record<string, unknown>
  const record = {} as Record<Level, Tally>
  for (const l of LEVELS) {
    const x = (typeof rec[l] === 'object' && rec[l] ? rec[l] : {}) as Record<string, unknown>
    record[l] = {
      won: count(x.won),
      lost: count(x.lost),
      drawn: count(x.drawn),
      best: count(x.best),
    }
  }
  return {
    rules: {
      pits: pick(PIT_CHOICES, r.pits, DEFAULT_RULES.pits),
      seeds: pick(SEED_CHOICES, r.seeds, DEFAULT_RULES.seeds),
      captures: typeof r.captures === 'boolean' ? r.captures : DEFAULT_RULES.captures,
    },
    level: pick(LEVELS, o.level, EMPTY.level),
    look: pick(LOOKS, o.look, EMPTY.look),
    seedLook: pick(SEED_LOOKS, o.seedLook, EMPTY.seedLook),
    hints: typeof o.hints === 'boolean' ? o.hints : EMPTY.hints,
    record,
  }
}
