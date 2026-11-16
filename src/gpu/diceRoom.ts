import {
  TARGET,
  chooseKeep,
  options,
  roll as rollDice,
  scoreOf,
  scores,
  setAside,
  wantsBank,
  type Face,
} from './dice'
import type { Rules, Seat } from '../lab/social/room'

/**
 * Ten thousand as a match by turns (src/lab/matches), with dice: the server rolls them, through
 * Rules.roll, as Backgammon's are. Seat 0 rolls first. Together, the two friends share one score
 * and take its decisions in turn; the computer plays the other, with dice.ts's own `chooseKeep`
 * and `wantsBank`.
 *
 * A move is one decision on the dice on the table: which of them to set aside — they must all
 * score, by dice.ts's own `setAside` — and then whether to bank the turn or roll the rest. The
 * server rolls whenever the side to move has no dice on the table: at the start of a turn, after
 * "roll on", and with all six again after hot dice. A roll that scores nothing ends the turn with
 * nothing banked, and is played as that by the server, so nobody sends a bust.
 *
 * THE GAME TRAVELS AS ITS LOG: every roll the server made and every decision, in order, replayed
 * from the start, so the scores can only be what those rolls and choices made. The first to bank
 * TARGET wins; a game is bounded at MAX_TURNS as a draw.
 */
export type Decision = { keep: number[]; bank: boolean }
type Ev = { roll: Face[] } | Decision
export type DiceGame = {
  scores: [number, number]
  turn: Seat | null
  /** the dice on the table (null until the server rolls), what this turn has set aside, dice left */
  table: Face[] | null
  points: number
  free: number
  log: Ev[]
  /** turns finished, banked or bust, for bounding a game */
  turns: number
  winner: Seat | 'draw' | null
}

/** far more turns than a game to 10,000 takes (twenty or thirty each) */
export const MAX_TURNS = 400

const other = (s: Seat): Seat => (s === 0 ? 1 : 0)

const fresh = (): DiceGame => ({
  scores: [0, 0],
  turn: 0,
  table: null,
  points: 0,
  free: 6,
  log: [],
  turns: 0,
  winner: null,
})

/** a turn over: what it banked added, the dice passed on, the game won or bounded */
function pass(g: DiceGame, banked: number): DiceGame {
  const side = g.turn!
  const sc: [number, number] = [...g.scores]
  sc[side] += banked
  const turns = g.turns + 1
  const won = sc[side] >= TARGET
  const drawn = !won && turns >= MAX_TURNS
  return {
    ...g,
    scores: sc,
    turns,
    table: null,
    points: 0,
    free: 6,
    turn: won || drawn ? null : other(side),
    winner: won ? side : drawn ? 'draw' : null,
  }
}

/** a roll landing on the table; a roll that scores nothing ends the turn with nothing banked */
function landed(g: DiceGame, r: Face[]): DiceGame {
  const cur = { ...g, log: [...g.log, { roll: r }] }
  return scores(r) ? { ...cur, table: r } : pass(cur, 0)
}

/** one decision on the dice on the table, or null if it is not one */
function decide(g: DiceGame, d: Decision): DiceGame | null {
  if (g.turn === null || !g.table) return null
  const t = setAside({ roll: g.table, points: g.points, free: g.free, bust: false }, d.keep)
  if (!t) return null
  const cur = { ...g, log: [...g.log, { keep: [...d.keep], bank: d.bank }] }
  if (d.bank) return pass(cur, t.points)
  return { ...cur, table: null, points: t.points, free: t.free }
}

/** the server's dice, for whoever has none on the table, through any busts */
export function roll(g: DiceGame, rand: () => number): DiceGame {
  let cur = g
  for (let k = 0; k < MAX_TURNS && cur.turn !== null && cur.table === null; k++)
    cur = landed(cur, rollDice(cur.free, rand))
  return cur
}

const isFace = (v: unknown) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 6

/** a decision from the wire: distinct positions on the table, and bank or not; null otherwise */
export function readDecision(x: unknown): Decision | null {
  const o = x as { keep?: unknown; bank?: unknown } | null
  if (!o || typeof o !== 'object' || !Array.isArray(o.keep) || typeof o.bank !== 'boolean')
    return null
  const keep = o.keep
  if (!keep.length || keep.length > 6) return null
  if (!keep.every((i) => Number.isInteger(i) && i >= 0 && i < 6)) return null
  if (new Set(keep).size !== keep.length) return null
  return { keep: [...(keep as number[])].sort((a, b) => a - b), bank: o.bank }
}

/**
 * The game this log makes, or null at the first entry that does not fit: a roll only when the
 * table is empty and of as many dice as are free, a decision only on dice on the table and one
 * that scores. On the wire a roll is its faces and a decision is 0, then 1 to bank or 0 to roll
 * on, then the positions kept — 0 is never a face, so the two cannot be mistaken.
 */
export function replay(x: unknown): DiceGame | null {
  const list = (x as { log?: unknown } | null)?.log
  if (!Array.isArray(list) || list.length > MAX_TURNS * 20) return null
  let g = fresh()
  for (const e of list) {
    if (g.turn === null || !Array.isArray(e) || !e.length) return null
    if (e[0] === 0) {
      const d = readDecision({ keep: e.slice(2), bank: e[1] === 1 })
      if (!d || (e[1] !== 0 && e[1] !== 1)) return null
      const next = decide(g, d)
      if (!next) return null
      g = next
    } else {
      if (g.table !== null || e.length !== g.free || !e.every(isFace)) return null
      g = landed(g, e as Face[])
    }
  }
  return g
}

/**
 * The computer's three levels. The toy's own computer (dice.ts) is Hard: it keeps what is worth
 * most counting the dice it leaves, and banks by how many it would roll next. Banking thresholds
 * tuned either way did not beat it — 43 to 51% over 8,000 games each — so the levels are made
 * below it rather than above. Fair keeps every die that scores, which leaves fewer to roll, and
 * banks as Hard does; Easy keeps every die that scores and banks at 300. Measured on 16 Nov 2026
 * over 8,000 games each: Easy wins 24% against Hard, Fair 39% against Hard and 65% against Easy.
 */
export const LEVELS = ['easy', 'fair', 'hard'] as const
export type Level = (typeof LEVELS)[number]
export function choose(g: DiceGame, level: Level): Decision {
  const table = g.table ?? []
  const side = g.turn ?? 1
  const keep =
    level === 'hard'
      ? chooseKeep(table)
      : (options(table).sort((a, b) => b.keep.length - a.keep.length || b.points - a.points)[0]
          ?.keep ?? [])
  const t = setAside({ roll: table, points: g.points, free: g.free, bust: false }, keep)
  if (!t) return { keep, bank: true }
  const mine = g.scores[side]
  const bank =
    mine + t.points >= TARGET ||
    (level === 'easy' ? t.points >= 300 : wantsBank(t, mine, g.scores[side === 0 ? 1 : 0]))
  return { keep, bank }
}

export const diceRules: Rules<DiceGame, Decision> & {
  roll: (g: DiceGame, rand: () => number) => DiceGame
} = {
  fresh,
  turn: (g) => g.turn,
  legal: (g, d, by) =>
    g.turn !== null && (by === undefined || by === g.turn) && decide(g, d) !== null,
  apply: (g, d) => decide(g, d) ?? g,
  roll,
  encode: (g) => ({
    log: g.log.map((e) => ('roll' in e ? e.roll : [0, e.bank ? 1 : 0, ...e.keep])),
  }),
  decode: replay,
  readMove: readDecision,
  modes: ['versus', 'together'],
  computer: {
    side: 1,
    levels: LEVELS,
    choose: (g, level) => choose(g, level as Level),
  },
  result: (g) => g.winner,
  begun: (g) => g.log.length > 1,
}

/** what a set of dice on the table would score if kept, for the page; null if it does not */
export const worth = (table: readonly number[], keep: readonly number[]) =>
  scoreOf(keep.map((i) => table[i]))
