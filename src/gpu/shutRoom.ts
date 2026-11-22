import { ALL, LEVELS, chooseDice, chooseWay, oneDieAllowed, sum, ways, type Level } from './shut'
import type { Rules, Seat } from '../lab/social/room'

/**
 * Shut the box as a match by turns (src/lab/matches): each side plays one box, seat 0 first, and
 * the fewer left up wins, as against the computer. The dice are the server's, rolled through
 * Rules.roll as Backgammon's are. Together, the two friends play one box between them, taking its
 * decisions in turn, and the computer plays the other with shut.ts's own chooseDice and chooseWay.
 *
 * A move is one decision: the tiles to shut for the roll (they must add up to it, by shut.ts's own
 * `ways`), or — once the 7, 8 and 9 are down — whether to roll one die or two. The server rolls
 * whenever a roll is due, and a roll no tiles left can make ends that side's box, played as that by
 * the server. The game travels as its log, replayed from the start.
 */
export type ShutMove = { shut: number } | { dice: 1 | 2 }
type Ev = { roll: number[] } | ShutMove
export type ShutGame = {
  /** the tiles still up on each side's box */
  up: [number, number]
  /** whose box is being played, or null once both are done */
  turn: Seat | null
  /** what is due: the dice to choose, the server's roll (of `n` dice), or tiles to shut */
  due: 'dice' | 'roll' | 'shut'
  n: 1 | 2
  /** the dice showing for tiles to be shut against */
  dice: number[]
  log: Ev[]
}

const fresh = (): ShutGame => ({
  up: [ALL, ALL],
  turn: 0,
  due: 'roll',
  n: 2,
  dice: [],
  log: [],
})

/** a box finished: the other side's turn if it has yet to play, else the game over */
function done(g: ShutGame): ShutGame {
  const next = g.turn === 0 ? 1 : null
  return { ...g, turn: next, due: 'roll', n: 2, dice: [] }
}
/** what is due after tiles have been shut */
function after(g: ShutGame, up: [number, number]): ShutGame {
  const side = g.turn!
  if (up[side] === 0) return done({ ...g, up })
  const one = oneDieAllowed(up[side])
  return { ...g, up, dice: [], due: one ? 'dice' : 'roll', n: 2 }
}

function landed(g: ShutGame, dice: number[]): ShutGame {
  const cur = { ...g, log: [...g.log, { roll: dice }] }
  const total = dice.reduce((s, d) => s + d, 0)
  // a roll no tiles left can make ends the box, with what is still up as its score
  return ways(g.up[g.turn!], total).length ? { ...cur, dice, due: 'shut' } : done(cur)
}

/** the server's dice, whenever a roll is due, through any box a roll ends */
export function roll(g: ShutGame, rand: () => number): ShutGame {
  let cur = g
  for (let k = 0; k < 4 && cur.turn !== null && cur.due === 'roll'; k++) {
    const dice = Array.from({ length: cur.n }, () => 1 + Math.floor(rand() * 6))
    cur = landed(cur, dice)
  }
  return cur
}

/** the game after a decision, or null if it is not one where it stands */
function decide(g: ShutGame, m: ShutMove): ShutGame | null {
  if (g.turn === null) return null
  const side = g.turn
  if ('dice' in m) {
    if (g.due !== 'dice' || (m.dice !== 1 && m.dice !== 2)) return null
    return { ...g, due: 'roll', n: m.dice, log: [...g.log, { dice: m.dice }] }
  }
  if (g.due !== 'shut') return null
  const total = g.dice.reduce((s, d) => s + d, 0)
  if ((m.shut & g.up[side]) !== m.shut || m.shut === 0 || sum(m.shut) !== total) return null
  const up: [number, number] = [...g.up]
  up[side] &= ~m.shut
  return after({ ...g, log: [...g.log, { shut: m.shut }] }, up)
}

/** a decision from the wire: tiles as a number with a bit for each, or one die or two */
export function readShutMove(x: unknown): ShutMove | null {
  const o = x as { shut?: unknown; dice?: unknown } | null
  if (!o || typeof o !== 'object') return null
  if (o.dice === 1 || o.dice === 2) return { dice: o.dice }
  return Number.isInteger(o.shut) && (o.shut as number) > 0 && (o.shut as number) <= ALL
    ? { shut: o.shut as number }
    : null
}

const isFace = (v: unknown) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 6

/**
 * The game this log makes, or null at the first entry that does not fit: a roll only when one is
 * due and of as many dice as were chosen, a decision only when it is due and one the rules allow.
 * On the wire a roll is its faces, tiles shut are 0 and the bits, and the dice chosen 9 and 1 or 2.
 */
export function replay(x: unknown): ShutGame | null {
  const list = (x as { log?: unknown } | null)?.log
  if (!Array.isArray(list) || list.length > 120) return null
  let g = fresh()
  for (const e of list) {
    if (g.turn === null || !Array.isArray(e) || !e.length) return null
    if (e[0] === 0 || e[0] === 9) {
      const m = e.length === 2 ? readShutMove(e[0] === 0 ? { shut: e[1] } : { dice: e[1] }) : null
      const next = m && decide(g, m)
      if (!next) return null
      g = next
      continue
    }
    if (g.due !== 'roll' || e.length !== g.n || !e.every(isFace)) return null
    g = landed(g, e as number[])
  }
  return g
}

export const shutRules: Rules<ShutGame, ShutMove> & {
  roll: (g: ShutGame, rand: () => number) => ShutGame
} = {
  fresh,
  turn: (g) => g.turn,
  legal: (g, m, by) =>
    g.turn !== null && (by === undefined || by === g.turn) && decide(g, m) !== null,
  apply: (g, m) => decide(g, m) ?? g,
  roll,
  encode: (g) => ({
    log: g.log.map((e) => ('roll' in e ? e.roll : 'shut' in e ? [0, e.shut] : [9, e.dice])),
  }),
  decode: replay,
  readMove: readShutMove,
  modes: ['versus', 'together'],
  computer: {
    side: 1,
    levels: LEVELS,
    choose: (g, level) =>
      g.due === 'dice'
        ? { dice: chooseDice(g.up[1], level as Level) }
        : {
            shut: chooseWay(
              g.up[1],
              g.dice.reduce((s, d) => s + d, 0),
              level as Level,
              Math.random,
            ),
          },
  },
  result: (g) => {
    if (g.turn !== null) return null
    const [a, b] = [sum(g.up[0]), sum(g.up[1])]
    return a < b ? 0 : b < a ? 1 : 'draw'
  },
  begun: (g) => g.log.length > 1,
}
