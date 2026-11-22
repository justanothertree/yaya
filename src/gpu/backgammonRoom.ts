import {
  BAR,
  LEVELS,
  OFF,
  apply,
  choose,
  other,
  plays,
  result,
  startPos,
  type Level,
  type Pos,
  type Step,
  type Who,
} from './backgammon'
import type { Rules, Seat } from '../lab/social/room'

/**
 * Backgammon as a match by turns (src/lab/matches), the first toy with dice. Seat 0 is side 1
 * (the toy's own colour), seat 1 is side 2. Together, the two seats play side 1 between them and
 * the computer plays side 2, with backgammon.ts's own `choose`.
 *
 * ⚠️ THE SERVER ROLLS. The dice are why this toy is only played by turns: in a call whoever hosts
 * rolls. Here `roll` is called by lab-move — when the match begins, after every turn, and before
 * the computer chooses — so a roll is unknown to everybody until the server has made it, and from
 * then on it is part of the game anybody may see. Nothing is held back, so nothing needs a secret.
 * Nothing in the browser ever rolls: a turn played there shows the board waiting for the dice.
 *
 * The opening is the toy's: each side rolls one die, the higher starts and plays both numbers. A
 * roll that allows no move at all is played for the side as a pass, so nobody sends an empty turn.
 *
 * A move is a whole turn, the points each checker moves from and to; the room looks it up among
 * backgammon.ts's own `plays` for the roll, so a turn the dice do not allow — fewer dice used than
 * could be, the smaller die when the larger fits — cannot be sent. The game travels as its opening
 * roll, its turns (each turn's dice and steps) and the dice the side to move has; a game is replayed
 * from them, so the board can only be one those turns made.
 */
export type Turn = { by: Who; dice: [number, number]; steps: Step[] }
export type BackgammonGame = {
  pos: Pos
  /** the side to move, or null once the game is over */
  turn: Who | null
  /** the roll the side to move plays: null until the server rolls it */
  dice: [number, number] | null
  /** the opening roll, side 1's die then side 2's, or null before the server has rolled it */
  opening: [number, number] | null
  turns: Turn[]
  /** set once a game has reached MAX_TURNS without a winner */
  drawn: boolean
}
/** a turn on the wire: the steps' points, from and to, in the order played */
export type Move = [number, number][]

/** far more turns than a game takes (60 or 70; 179 at most in 60 games measured, random ones too) */
export const MAX_TURNS = 300

const seatOf = (w: Who): Seat => (w === 1 ? 0 : 1)
const die = (rand: () => number) => 1 + Math.floor(rand() * 6)
const over = (g: BackgammonGame) => g.drawn || result(g.pos) !== null

const fresh = (): BackgammonGame => ({
  pos: startPos(),
  turn: null,
  dice: null,
  opening: null,
  turns: [],
  drawn: false,
})

/** the legal whole turn these steps make with this roll, or null */
function find(p: Pos, w: Who, dice: [number, number], m: Move): Step[] | null {
  const pl = plays(p, w, dice, true).find(
    (x) =>
      x.steps.length === m.length &&
      x.steps.every((s, k) => s.from === m[k][0] && s.to === m[k][1]),
  )
  return pl ? pl.steps : null
}

/** a turn played: the board after it, the other side to move, and no dice until the server rolls */
function after(g: BackgammonGame, w: Who, dice: [number, number], steps: Step[]): BackgammonGame {
  let pos = g.pos
  for (const s of steps) pos = apply(pos, w, s)
  const turns = [...g.turns, { by: w, dice, steps }]
  const done = result(pos) !== null
  const drawn = !done && turns.length >= MAX_TURNS
  return { ...g, pos, turns, turn: done || drawn ? null : other(w), dice: null, drawn }
}

/**
 * The server's roll: the opening if there has been none, else the dice for the side to move. A roll
 * with no move in it is played as a pass and the other side rolls, as often as that happens.
 */
export function roll(g: BackgammonGame, rand: () => number): BackgammonGame {
  let cur = g
  if (!cur.opening) {
    let [a, b] = [die(rand), die(rand)]
    while (a === b) [a, b] = [die(rand), die(rand)]
    const w: Who = a > b ? 1 : 2
    cur = { ...cur, opening: [a, b], turn: w, dice: w === 1 ? [a, b] : [b, a] }
  }
  for (let k = 0; k < MAX_TURNS && cur.turn !== null; k++) {
    const w = cur.turn
    const dice = cur.dice ?? ([die(rand), die(rand)] as [number, number])
    if (plays(cur.pos, w, dice)[0].steps.length) return { ...cur, dice }
    cur = after(cur, w, dice, [])
  }
  return cur
}

const isDie = (v: unknown) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 6
const isPoint = (v: unknown) => Number.isInteger(v) && (v as number) >= BAR && (v as number) <= OFF

/** a turn from the wire: up to four steps, each two points on or off the board; null otherwise */
export function readMove(x: unknown): Move | null {
  const list = Array.isArray(x) ? x : (x as { steps?: unknown } | null)?.steps
  if (!Array.isArray(list) || list.length > 4) return null
  const out: Move = []
  for (const s of list) {
    const [from, to] = Array.isArray(s) ? s : [(s as Step)?.from, (s as Step)?.to]
    if (!isPoint(from) || !isPoint(to) || from === OFF || to === BAR) return null
    out.push([from as number, to as number])
  }
  return out
}

/**
 * The game these rolls and turns make, or null at the first that is not one: the opening two
 * different dice, the first turn the higher side's with both of them, every turn a legal play of
 * its own dice (empty only when the dice allow nothing), and the sides taking turns.
 */
export function replay(x: unknown): BackgammonGame | null {
  const o = x as { open?: unknown; turns?: unknown; dice?: unknown } | null
  if (!o || typeof o !== 'object') return null
  let g = fresh()
  if (o.open === null || o.open === undefined) {
    // not yet rolled: only a game that has had nothing at all
    return Array.isArray(o.turns) && !o.turns.length && o.dice == null ? g : null
  }
  const op = o.open as unknown[]
  if (!Array.isArray(op) || op.length !== 2 || !isDie(op[0]) || !isDie(op[1]) || op[0] === op[1])
    return null
  const [a, b] = op as [number, number]
  const first: Who = a > b ? 1 : 2
  g = { ...g, opening: [a, b], turn: first }
  if (!Array.isArray(o.turns) || o.turns.length > MAX_TURNS) return null
  for (let k = 0; k < o.turns.length; k++) {
    const t = o.turns[k] as unknown[]
    if (g.turn === null || !Array.isArray(t) || t.length < 2 || t.length % 2) return null
    if (!isDie(t[0]) || !isDie(t[1])) return null
    const dice: [number, number] = [t[0] as number, t[1] as number]
    if (k === 0 && (dice[0] !== Math.max(a, b) || dice[1] !== Math.min(a, b))) return null
    const pairs: Move = []
    for (let i = 2; i < t.length; i += 2) pairs.push([t[i] as number, t[i + 1] as number])
    const m = readMove(pairs)
    if (!m) return null
    const steps = find(g.pos, g.turn, dice, m)
    if (!steps) return null
    g = after(g, g.turn, dice, steps)
  }
  if (o.dice != null) {
    const d = o.dice as unknown[]
    if (g.turn === null || !Array.isArray(d) || d.length !== 2 || !isDie(d[0]) || !isDie(d[1]))
      return null
    // the very first roll is the opening's, played by the higher side
    if (!g.turns.length && (d[0] !== Math.max(a, b) || d[1] !== Math.min(a, b))) return null
    g = { ...g, dice: [d[0] as number, d[1] as number] }
  } else if (!g.turns.length) g = { ...g, dice: first === 1 ? [a, b] : [b, a] }
  return g
}

export const backgammonRules: Rules<BackgammonGame, Move> & {
  roll: (g: BackgammonGame, rand: () => number) => BackgammonGame
} = {
  fresh,
  turn: (g) => (over(g) || g.turn === null ? null : seatOf(g.turn)),
  legal: (g, m, by) =>
    !over(g) &&
    g.turn !== null &&
    g.dice !== null &&
    (by === undefined || by === seatOf(g.turn)) &&
    find(g.pos, g.turn, g.dice, m) !== null,
  apply: (g, m) => {
    if (g.turn === null || g.dice === null) return g
    const steps = find(g.pos, g.turn, g.dice, m)
    return steps ? after(g, g.turn, g.dice, steps) : g
  },
  roll,
  encode: (g) => ({
    open: g.opening,
    turns: g.turns.map((t) => [...t.dice, ...t.steps.flatMap((s) => [s.from, s.to])]),
    dice: g.dice,
  }),
  decode: replay,
  readMove,
  modes: ['versus', 'together'],
  computer: {
    side: 1,
    levels: LEVELS,
    choose: (g, level) =>
      g.turn === null || g.dice === null
        ? []
        : choose(g.pos, g.turn, g.dice, level as Level).steps.map((s) => [s.from, s.to]),
  },
  result: (g) => {
    if (!over(g)) return null
    const r = result(g.pos)
    return r ? seatOf(r.winner) : 'draw'
  },
  begun: (g) => g.turns.length > 0,
}

/** what a finished game was worth: a single game, a gammon or a backgammon */
export function worth(g: BackgammonGame): string | undefined {
  const r = result(g.pos)
  if (!r) return undefined
  return r.points === 3
    ? 'a backgammon, 3 points'
    : r.points === 2
      ? 'a gammon, 2 points'
      : '1 point'
}
