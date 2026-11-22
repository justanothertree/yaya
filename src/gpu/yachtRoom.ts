import {
  CATS,
  LEVELS,
  chooseBox,
  chooseKeep,
  fill,
  hold,
  newGame,
  roll as rollDice,
  total,
  type Cat,
  type Game,
  type Level,
} from './yacht'
import type { Rules, Seat } from '../lab/social/room'

/**
 * Yacht as a match by turns (src/lab/matches), with dice the server rolls through Rules.roll, as
 * Backgammon's and Ten thousand's are. Seat 0 plays first. Together, the two friends share one
 * card and take its decisions in turn; the computer fills the other, with yacht.ts's own
 * chooseKeep and chooseBox.
 *
 * A move is one decision on the dice rolled: hold some and roll the rest (while a roll is left), or
 * score the five in an open box. The server rolls at the start of each turn and after every hold,
 * so a roll is unknown until it is made. The game travels as its log, every roll and decision in
 * order, replayed through yacht.ts's own hold and fill; twelve boxes each and it is over, the
 * higher total winning.
 */
export type YachtMove = { hold: boolean[] } | { box: Cat }
type Ev = { roll: number[] } | YachtMove
export type YachtGame = {
  g: Game
  /** a hold has been chosen and the server has yet to roll the rest */
  need: boolean
  log: Ev[]
}

const fresh = (): YachtGame => ({ g: newGame(0), need: false, log: [] })
/** the side whose decision it is, or null when the server must roll first or the game is over */
const waiting = (y: YachtGame) => y.g.rolls === 3 || y.need

/** the server's dice: the first roll of a turn, or the rest after a hold */
export function roll(y: YachtGame, rand: () => number): YachtGame {
  if (y.g.over || !waiting(y)) return y
  const g = rollDice(y.g, rand)
  return { g, need: false, log: [...y.log, { roll: g.dice }] }
}

/** the game after a decision, or null if it is not one where it stands */
function decide(y: YachtGame, m: YachtMove): YachtGame | null {
  if (y.g.over || waiting(y)) return null
  if ('hold' in m) {
    // a hold needs a roll left to roll the rest; holding all five would roll nothing
    if (y.g.rolls === 0 || m.hold.every(Boolean)) return null
    return { g: hold(y.g, m.hold), need: true, log: [...y.log, { hold: [...m.hold] }] }
  }
  if (y.g.cards[y.g.turn][m.box] !== undefined) return null
  return { g: fill(y.g, m.box), need: false, log: [...y.log, { box: m.box }] }
}

const isFace = (v: unknown) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 6

/** a decision from the wire: five marks to hold, or an open box by name; null otherwise */
export function readYachtMove(x: unknown): YachtMove | null {
  const o = x as { hold?: unknown; box?: unknown } | null
  if (!o || typeof o !== 'object') return null
  if (Array.isArray(o.hold))
    return o.hold.length === 5 && o.hold.every((h) => typeof h === 'boolean')
      ? { hold: [...(o.hold as boolean[])] }
      : null
  return typeof o.box === 'string' && (CATS as readonly string[]).includes(o.box)
    ? { box: o.box as Cat }
    : null
}

/**
 * The game this log makes, or null at the first entry that does not fit: a roll only when one is
 * due, of five faces that keep every held die where it was; a decision only on dice rolled. On the
 * wire a roll is its five faces, a hold is 0 and the five marks as 0 or 1, and a box is 9 and the
 * box's place in CATS.
 */
export function replay(x: unknown): YachtGame | null {
  const list = (x as { log?: unknown } | null)?.log
  if (!Array.isArray(list) || list.length > 200) return null
  let y = fresh()
  for (const e of list) {
    if (y.g.over || !Array.isArray(e)) return null
    if (e.length === 5) {
      if (!waiting(y) || !e.every(isFace)) return null
      if (y.g.held.some((h, i) => h && y.g.dice[i] !== e[i])) return null
      const g = { ...y.g, dice: e as number[], rolls: y.g.rolls - 1 }
      y = { g, need: false, log: [...y.log, { roll: g.dice }] }
      continue
    }
    const m: YachtMove | null =
      e[0] === 0 && e.length === 6 && e.slice(1).every((b) => b === 0 || b === 1)
        ? { hold: e.slice(1).map((b) => b === 1) }
        : e[0] === 9 && e.length === 2 && Number.isInteger(e[1]) && CATS[e[1] as number]
          ? { box: CATS[e[1] as number] }
          : null
    const next = m && decide(y, m)
    if (!next) return null
    y = next
  }
  return y
}

export const yachtRules: Rules<YachtGame, YachtMove> & {
  roll: (y: YachtGame, rand: () => number) => YachtGame
} = {
  fresh,
  turn: (y) => (y.g.over ? null : (y.g.turn as Seat)),
  legal: (y, m, by) => !y.g.over && (by === undefined || by === y.g.turn) && decide(y, m) !== null,
  apply: (y, m) => decide(y, m) ?? y,
  roll,
  encode: (y) => ({
    log: y.log.map((e) =>
      'roll' in e
        ? e.roll
        : 'hold' in e
          ? [0, ...e.hold.map((h) => (h ? 1 : 0))]
          : [9, CATS.indexOf(e.box)],
    ),
  }),
  decode: replay,
  readMove: readYachtMove,
  modes: ['versus', 'together'],
  computer: {
    side: 1,
    levels: LEVELS,
    choose: (y, level) => {
      const { dice, cards, rolls } = y.g
      const card = cards[1]
      if (rolls > 0) {
        const keep = chooseKeep(dice, card, rolls, level as Level)
        if (!keep.every(Boolean)) return { hold: keep }
      }
      return { box: chooseBox(dice, card, level as Level) }
    },
  },
  result: (y) => {
    if (!y.g.over) return null
    const [a, b] = [total(y.g.cards[0]), total(y.g.cards[1])]
    return a > b ? 0 : b > a ? 1 : 'draw'
  },
  begun: (y) => y.log.length > 1,
}
