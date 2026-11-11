/**
 * Chess against the computer. Pure — the board, every legal move (castling, en passant,
 * promotion), check, mate and the draws, move names in the usual notation, and an alpha-beta
 * computer — so chess.test.ts can count every position to a depth and compare with the published
 * figures; ChessDemo draws the board.
 *
 * Squares are 0–63, a8 first and h1 last, so a square's row is 8 − its rank. Pieces are letters:
 * PNBRQK for white, pnbrqk for black, '' for empty.
 */

export type Side = 'w' | 'b'
export type Pos = {
  sq: string[]
  turn: Side
  /** castling still allowed: any of K Q k q */
  castle: string
  /** the square a pawn may be taken en passant on, or -1 */
  ep: number
  /** half-moves since a capture or a pawn move, for the fifty-move rule */
  half: number
  full: number
}
export type Move = {
  from: number
  to: number
  piece: string
  take: string
  promo: string
  flag: '' | 'ep' | 'O-O' | 'O-O-O' | 'double'
}

export const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const FILES = 'abcdefgh'
export const sqName = (i: number) => `${FILES[i % 8]}${8 - Math.floor(i / 8)}`
export const sqOf = (name: string) => (8 - Number(name[1])) * 8 + FILES.indexOf(name[0])
const white = (p: string) => p !== '' && p === p.toUpperCase()
const sideOf = (p: string): Side | null => (p === '' ? null : white(p) ? 'w' : 'b')
const opp = (s: Side): Side => (s === 'w' ? 'b' : 'w')

export function fromFen(fen: string): Pos {
  const [board, turn, castle, ep, half, full] = fen.split(' ')
  const sq: string[] = []
  for (const ch of board) {
    if (ch === '/') continue
    if (/\d/.test(ch)) for (let k = 0; k < Number(ch); k++) sq.push('')
    else sq.push(ch)
  }
  return {
    sq,
    turn: turn as Side,
    castle: castle === '-' ? '' : castle,
    ep: ep === '-' ? -1 : sqOf(ep),
    half: Number(half ?? 0),
    full: Number(full ?? 1),
  }
}
export function toFen(p: Pos): string {
  const rows: string[] = []
  for (let r = 0; r < 8; r++) {
    let row = ''
    let gap = 0
    for (let c = 0; c < 8; c++) {
      const x = p.sq[r * 8 + c]
      if (!x) gap++
      else {
        if (gap) row += gap
        gap = 0
        row += x
      }
    }
    if (gap) row += gap
    rows.push(row)
  }
  return `${rows.join('/')} ${p.turn} ${p.castle || '-'} ${p.ep >= 0 ? sqName(p.ep) : '-'} ${p.half} ${p.full}`
}

const KNIGHT = [
  [-2, -1],
  [-2, 1],
  [-1, -2],
  [-1, 2],
  [1, -2],
  [1, 2],
  [2, -1],
  [2, 1],
]
const KING = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
]
const DIAG = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
]
const LINE = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
]
const at = (r: number, c: number) => (r < 0 || r > 7 || c < 0 || c > 7 ? -1 : r * 8 + c)

/** whether `by` attacks square `i` */
export function attacked(p: Pos, i: number, by: Side): boolean {
  const r = Math.floor(i / 8)
  const c = i % 8
  const own = (ch: string) => (by === 'w' ? ch.toUpperCase() : ch.toLowerCase())
  // pawns attack diagonally forward, so look diagonally backward from the square
  const pr = by === 'w' ? r + 1 : r - 1
  for (const dc of [-1, 1]) {
    const j = at(pr, c + dc)
    if (j >= 0 && p.sq[j] === own('p')) return true
  }
  for (const [dr, dc] of KNIGHT) {
    const j = at(r + dr, c + dc)
    if (j >= 0 && p.sq[j] === own('n')) return true
  }
  for (const [dr, dc] of KING) {
    const j = at(r + dr, c + dc)
    if (j >= 0 && p.sq[j] === own('k')) return true
  }
  for (const [dirs, kinds] of [
    [DIAG, ['b', 'q']],
    [LINE, ['r', 'q']],
  ] as [number[][], string[]][])
    for (const [dr, dc] of dirs)
      for (let k = 1; ; k++) {
        const j = at(r + dr * k, c + dc * k)
        if (j < 0) break
        const x = p.sq[j]
        if (!x) continue
        if (kinds.some((t) => x === own(t))) return true
        break
      }
  return false
}
export const kingSq = (p: Pos, s: Side) => p.sq.indexOf(s === 'w' ? 'K' : 'k')
export const inCheck = (p: Pos, s: Side = p.turn) => attacked(p, kingSq(p, s), opp(s))

function pseudo(p: Pos): Move[] {
  const out: Move[] = []
  const s = p.turn
  const add = (from: number, to: number, flag: Move['flag'] = '', promo = '') =>
    out.push({
      from,
      to,
      piece: p.sq[from],
      take: flag === 'ep' ? (s === 'w' ? 'p' : 'P') : p.sq[to],
      promo,
      flag,
    })
  for (let i = 0; i < 64; i++) {
    const x = p.sq[i]
    if (sideOf(x) !== s) continue
    const r = Math.floor(i / 8)
    const c = i % 8
    const kind = x.toLowerCase()
    if (kind === 'p') {
      const dir = s === 'w' ? -1 : 1
      const last = s === 'w' ? 0 : 7
      const pawnTo = (to: number, flag: Move['flag'] = '') => {
        if (Math.floor(to / 8) === last)
          for (const q of 'qrbn') add(i, to, flag, s === 'w' ? q.toUpperCase() : q)
        else add(i, to, flag)
      }
      const one = at(r + dir, c)
      if (one >= 0 && !p.sq[one]) {
        pawnTo(one)
        const two = at(r + 2 * dir, c)
        if (r === (s === 'w' ? 6 : 1) && !p.sq[two]) add(i, two, 'double')
      }
      for (const dc of [-1, 1]) {
        const j = at(r + dir, c + dc)
        if (j < 0) continue
        if (sideOf(p.sq[j]) === opp(s)) pawnTo(j)
        else if (j === p.ep) add(i, j, 'ep')
      }
    } else if (kind === 'n' || kind === 'k') {
      for (const [dr, dc] of kind === 'n' ? KNIGHT : KING) {
        const j = at(r + dr, c + dc)
        if (j >= 0 && sideOf(p.sq[j]) !== s) add(i, j)
      }
      if (kind === 'k') {
        // castling: rights kept, the squares between empty, and the king never passing through check
        const home = s === 'w' ? 60 : 4
        if (i === home && !attacked(p, i, opp(s))) {
          const k = s === 'w' ? 'K' : 'k'
          const q = s === 'w' ? 'Q' : 'q'
          if (p.castle.includes(k) && !p.sq[i + 1] && !p.sq[i + 2] && !attacked(p, i + 1, opp(s)))
            add(i, i + 2, 'O-O')
          if (
            p.castle.includes(q) &&
            !p.sq[i - 1] &&
            !p.sq[i - 2] &&
            !p.sq[i - 3] &&
            !attacked(p, i - 1, opp(s))
          )
            add(i, i - 2, 'O-O-O')
        }
      }
    } else {
      const dirs = kind === 'b' ? DIAG : kind === 'r' ? LINE : [...DIAG, ...LINE]
      for (const [dr, dc] of dirs)
        for (let k = 1; ; k++) {
          const j = at(r + dr * k, c + dc * k)
          if (j < 0) break
          const y = sideOf(p.sq[j])
          if (y === s) break
          add(i, j)
          if (y) break
        }
    }
  }
  return out
}

export function play(p: Pos, m: Move): Pos {
  const sq = p.sq.slice()
  const s = p.turn
  sq[m.to] = m.promo || m.piece
  sq[m.from] = ''
  if (m.flag === 'ep') sq[m.to + (s === 'w' ? 8 : -8)] = ''
  if (m.flag === 'O-O') {
    sq[m.from + 1] = sq[m.from + 3]
    sq[m.from + 3] = ''
  }
  if (m.flag === 'O-O-O') {
    sq[m.from - 1] = sq[m.from - 4]
    sq[m.from - 4] = ''
  }
  let castle = p.castle
  const lose = (i: number, rights: string) => {
    if (m.from === i || m.to === i) castle = castle.replace(new RegExp(`[${rights}]`, 'g'), '')
  }
  lose(60, 'KQ')
  lose(4, 'kq')
  lose(63, 'K')
  lose(56, 'Q')
  lose(7, 'k')
  lose(0, 'q')
  return {
    sq,
    turn: opp(s),
    castle,
    ep: m.flag === 'double' ? (m.from + m.to) / 2 : -1,
    half: m.piece.toLowerCase() === 'p' || m.take ? 0 : p.half + 1,
    full: p.full + (s === 'b' ? 1 : 0),
  }
}

/** every legal move: the pseudo-legal ones that do not leave your own king attacked */
export function moves(p: Pos): Move[] {
  return pseudo(p).filter((m) => !inCheck(play(p, m), p.turn))
}

/** counts every position reachable in `depth` moves — the standard test of a move generator */
export function perft(p: Pos, depth: number): number {
  if (depth === 0) return 1
  const list = moves(p)
  if (depth === 1) return list.length
  let n = 0
  for (const m of list) n += perft(play(p, m), depth - 1)
  return n
}

/* ---------------------------------------------------------------------------- the end */

/** the part of a position that decides repetition: pieces, side, castling and en passant */
export const posKey = (p: Pos) => toFen(p).split(' ').slice(0, 4).join(' ')
export type Outcome = {
  winner: Side | null
  why: 'checkmate' | 'stalemate' | 'fifty moves' | 'repetition' | 'too little to mate'
} | null
export function outcome(p: Pos, history: string[] = []): Outcome {
  if (!moves(p).length)
    return inCheck(p)
      ? { winner: opp(p.turn), why: 'checkmate' }
      : { winner: null, why: 'stalemate' }
  if (p.half >= 100) return { winner: null, why: 'fifty moves' }
  const k = posKey(p)
  if (history.filter((h) => h === k).length >= 3) return { winner: null, why: 'repetition' }
  const rest = p.sq.filter((x) => x && x.toLowerCase() !== 'k').map((x) => x.toLowerCase())
  if (!rest.length || (rest.length === 1 && (rest[0] === 'b' || rest[0] === 'n')))
    return { winner: null, why: 'too little to mate' }
  return null
}

/** a move's name in standard notation: Nf3, exd5, O-O, e8=Q+, Qxf7# */
export function san(p: Pos, m: Move): string {
  let s: string
  if (m.flag === 'O-O' || m.flag === 'O-O-O') s = m.flag
  else {
    const kind = m.piece.toUpperCase()
    const takes = m.take ? 'x' : ''
    if (kind === 'P')
      s = `${m.take ? sqName(m.from)[0] : ''}${takes}${sqName(m.to)}${m.promo ? `=${m.promo.toUpperCase()}` : ''}`
    else {
      // name the file, the rank or both when another piece of the kind could go there too
      const rivals = moves(p).filter(
        (o) => o.piece === m.piece && o.to === m.to && o.from !== m.from,
      )
      let which = ''
      if (rivals.length) {
        const sameFile = rivals.some((o) => o.from % 8 === m.from % 8)
        const sameRank = rivals.some((o) => Math.floor(o.from / 8) === Math.floor(m.from / 8))
        which = !sameFile ? sqName(m.from)[0] : !sameRank ? sqName(m.from)[1] : sqName(m.from)
      }
      s = `${kind}${which}${takes}${sqName(m.to)}`
    }
  }
  const after = play(p, m)
  if (inCheck(after)) s += moves(after).length ? '+' : '#'
  return s
}

/* ---------------------------------------------------------------------------- the computer */

const VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 }
/** where each piece likes to stand, from white's side; black reads the board turned over */
const PLACE: Record<string, number[]> = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5,
    10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20,
    -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10,
    0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10,
    5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0,
    -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10,
    -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
    0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0,
    0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0,
    5, 5, 0, 0, 0,
  ],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0,
    0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40,
    -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30,
    -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0,
    10, 30, 20,
  ],
}
/** the position for the side to move, in hundredths of a pawn */
export function evaluate(p: Pos): number {
  let v = 0
  for (let i = 0; i < 64; i++) {
    const x = p.sq[i]
    if (!x) continue
    const kind = x.toLowerCase()
    const w = white(x)
    v += (w ? 1 : -1) * (VALUE[kind] + PLACE[kind][w ? i : 63 - i])
  }
  return p.turn === 'w' ? v : -v
}
const order = (list: Move[]) =>
  list.sort(
    (a, b) =>
      (b.take ? VALUE[b.take.toLowerCase()] * 10 - VALUE[b.piece.toLowerCase()] : 0) +
      (b.promo ? 800 : 0) -
      ((a.take ? VALUE[a.take.toLowerCase()] * 10 - VALUE[a.piece.toLowerCase()] : 0) +
        (a.promo ? 800 : 0)),
  )

const MATE = 100000
type Budget = { n: number; cap: number }
const STOP = new Error('out of time')
/**
 * ⚠️ THE SEARCH TESTS LEGALITY ON THE WAY IN, NOT UP FRONT. `moves()` plays every move to see
 * whether it leaves the king attacked, and the search then played each one again to look at it:
 * every position paid for its moves twice, and the hard level's slowest move took 1.6 s. Here a
 * pseudo-legal move is played once, skipped if it exposes the king, and searched otherwise; and
 * the capture search asks only captures whether they are legal.
 */
function quiet(p: Pos, alpha: number, beta: number, budget: Budget): number {
  if (++budget.n > budget.cap) throw STOP
  const stand = evaluate(p)
  if (stand >= beta) return stand
  if (stand > alpha) alpha = stand
  for (const m of order(pseudo(p).filter((x) => x.take || x.promo))) {
    const next = play(p, m)
    if (inCheck(next, p.turn)) continue
    const v = -quiet(next, -beta, -alpha, budget)
    if (v >= beta) return v
    if (v > alpha) alpha = v
  }
  return alpha
}
function search(
  p: Pos,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
  budget: Budget,
): number {
  if (p.half >= 100) return 0
  if (depth <= 0) {
    // a position with no legal move is mate or stalemate, whatever the capture search would say
    if (!moves(p).length) return inCheck(p) ? -MATE + ply : 0
    return quiet(p, alpha, beta, budget)
  }
  if (++budget.n > budget.cap) throw STOP
  let legal = 0
  for (const m of order(pseudo(p))) {
    const next = play(p, m)
    if (inCheck(next, p.turn)) continue
    legal++
    const v = -search(next, depth - 1, -beta, -alpha, ply + 1, budget)
    if (v >= beta) return v
    if (v > alpha) alpha = v
  }
  if (!legal) return inCheck(p) ? -MATE + ply : 0
  return alpha
}

export const LEVELS = ['easy', 'fair', 'hard'] as const
export type Level = (typeof LEVELS)[number]
export const DEPTH: Record<Level, number> = { easy: 1, fair: 2, hard: 3 }
/**
 * Positions each level may look at for one move. Hard's slowest move at depth 3 took 829 ms on a
 * desktop, which a phone could make three seconds; so it settles depth 2 first and keeps that
 * answer whenever depth 3 runs past its allowance. Measured at about 150 positions a millisecond, so 35,000 is a quarter of a second here.
 */
export const CAP: Record<Level, number> = { easy: 1e9, fair: 1e9, hard: 35000 }

/** the computer's move: each level deepens to its depth, every capture followed to quiet; Easy also strays */
export function choose(
  p: Pos,
  level: Level,
  rand: () => number = Math.random,
  history: string[] = [],
): Move {
  const list = order(moves(p))
  if (level === 'easy' && rand() < 0.2) return list[Math.floor(rand() * list.length)]
  let settled: Move[] = [list[0]]
  const budget: Budget = { n: 0, cap: CAP[level] }
  for (let depth = 1; depth <= DEPTH[level]; depth++) {
    let best: Move[] = []
    let bv = -Infinity
    try {
      // the last depth's choice first, so a cut-off search has looked at it before anything else
      const first = [...settled, ...list.filter((m) => !settled.includes(m))]
      for (const m of first) {
        const next = play(p, m)
        // a move that repeats a position twice seen already is a draw: worth nothing either way
        const repeats = history.filter((h) => h === posKey(next)).length >= 2
        const v = repeats ? 0 : -search(next, depth - 1, -Infinity, -bv + 1, 1, budget)
        if (v > bv) {
          bv = v
          best = [m]
        } else if (v === bv) best.push(m)
      }
    } catch (e) {
      if (e !== STOP) throw e
      break
    }
    settled = best
  }
  return settled[Math.floor(rand() * settled.length)]
}

/* ---------------------------------------------------------------------------- what is kept */

export const CHESS_KEY = 'lab_chess_v1'
export const BOARDS = ['wood', 'green', 'blue'] as const
export const SETS = ['ivory', 'coral'] as const
export type Tally = { won: number; lost: number; drawn: number }
export type Saved = {
  level: Level
  board: (typeof BOARDS)[number]
  set: (typeof SETS)[number]
  /** light up where a picked piece may go */
  hints: boolean
  record: Record<Level, Tally>
}
const NONE: Tally = { won: 0, lost: 0, drawn: 0 }
export const EMPTY: Saved = {
  level: 'fair',
  board: 'wood',
  set: 'ivory',
  hints: true,
  record: { easy: NONE, fair: NONE, hard: NONE },
}
const whole = (v: unknown) =>
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
  const pick = <T>(list: readonly T[], x: unknown, d: T): T =>
    list.includes(x as T) ? (x as T) : d
  const rec = (typeof o.record === 'object' && o.record ? o.record : {}) as Record<string, unknown>
  const record = {} as Record<Level, Tally>
  for (const l of LEVELS) {
    const x = (typeof rec[l] === 'object' && rec[l] ? rec[l] : {}) as Record<string, unknown>
    record[l] = { won: whole(x.won), lost: whole(x.lost), drawn: whole(x.drawn) }
  }
  return {
    level: pick(LEVELS, o.level, EMPTY.level),
    board: pick(BOARDS, o.board, EMPTY.board),
    set: pick(SETS, o.set, EMPTY.set),
    hints: typeof o.hints === 'boolean' ? o.hints : EMPTY.hints,
    record,
  }
}
