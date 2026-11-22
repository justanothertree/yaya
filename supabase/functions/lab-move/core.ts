/**
 * What `lab-move` decides, with nothing in it that needs a network, a database or Deno.
 *
 * ⚠️ THE EDGE FUNCTION IS PLUMBING AROUND THIS. index.ts reads the match with the service key,
 * hands it here with the caller's id and what they asked, and writes back whatever this returns,
 * through `lab_match_begin` or `lab_match_commit`. Every rule of the GAME is decided here, by the
 * toy's own `Rules` (the same objects the call rooms play on). Every rule of the MATCH that needs
 * the database (friends, suspension, two moves racing, the move limit) is decided again in SQL,
 * atomically, so nothing here has to be right about those for them to hold. This refuses early so
 * the answer names the problem; the SQL is what makes it true.
 *
 * ⚠️ AND IT REACHES THE SERVER AS A BUNDLE. The rules modules import each other without file
 * extensions, as Vite expects, and Deno does not resolve those. So `scripts/lab-move-bundle.mjs`
 * builds this file and everything it imports into `core.bundle.js` beside it, which is what
 * index.ts imports and what a deploy sends. `core.test.ts` asks the same questions of both, and
 * fails if the bundle is not exactly what the build makes from the source today.
 */
import { chessRules } from '../../../src/gpu/chessRoom'
import { SIZES, count } from '../../../src/gpu/reversi'
import { reversiRules } from '../../../src/gpu/reversiRoom'
import { SIZES as GOMOKU_SIZES } from '../../../src/gpu/gomoku'
import { gomokuRules } from '../../../src/gpu/gomokuRoom'
import { draughtsRules } from '../../../src/gpu/draughtsRoom'
import { SIZES as DOTS_SIZES } from '../../../src/gpu/dots'
import { dotsRules, type DotsGame } from '../../../src/gpu/dotsRoom'
import { fourRowMatchRules, readFourSettings } from '../../../src/gpu/fourrowRoom'
import { poolRules } from '../../../src/gpu/poolRoom'
import { score as mancalaScore } from '../../../src/gpu/mancala'
import { mancalaRules, readMancalaSettings, type MancalaGame } from '../../../src/gpu/mancalaRoom'
import { morrisRules } from '../../../src/gpu/morrisRoom'
import { hexRules, readHexSettings } from '../../../src/gpu/hexRoom'
import { ultimateRules } from '../../../src/gpu/ultimateRoom'
import { breakthroughRules, readBreakthroughSize } from '../../../src/gpu/breakthroughRoom'
import { fencesRules, readFencesSize } from '../../../src/gpu/fencesRoom'
import type { Mode, Rules, Seat } from '../../../src/lab/social/room'

/** a toy's rules for one match's settings, and how its finished game reads as a short score */
export type Game = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rules: Rules<any, any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  score?: (g: any) => string
}

/**
 * The toys `lab-move` can play, each from a match's settings, or null for settings it cannot.
 * ⚠️ THE SAME LIST AS `lab_match_playable` in the matches SQL. A toy there and not here can be
 * challenged and never accepted; here and not there, it can never be challenged. core.test.ts
 * reads the SQL draft and compares.
 */
export const GAMES: Record<string, (settings: Record<string, unknown>) => Game | null> = {
  reversi: (s) => {
    const size = s.size ?? 8
    if (!(SIZES as readonly unknown[]).includes(size)) return null
    return {
      rules: reversiRules(size as number),
      score: (g: { b: Parameters<typeof count>[0] }) => count(g.b).join('–'),
    }
  },
  chess: () => ({ rules: chessRules }),
  pool: () => ({ rules: poolRules }),
  gomoku: (s) => {
    const size = s.size ?? 13
    return (GOMOKU_SIZES as readonly unknown[]).includes(size)
      ? { rules: gomokuRules(size as number) }
      : null
  },
  draughts: () => ({ rules: draughtsRules }),
  dots: (s) => {
    const size = s.size ?? 4
    if (!(DOTS_SIZES as readonly unknown[]).includes(size)) return null
    return { rules: dotsRules(size as number), score: (d: DotsGame) => d.g.score.join('–') }
  },
  fourrow: (s) => {
    const read = readFourSettings(s)
    return read ? { rules: fourRowMatchRules(...read) } : null
  },
  mancala: (s) => {
    const read = readMancalaSettings(s)
    if (!read) return null
    return {
      rules: mancalaRules(read),
      score: (g: MancalaGame) => mancalaScore(g.b).join('–'),
    }
  },
  morris: () => ({ rules: morrisRules }),
  hex: (s) => {
    const read = readHexSettings(s)
    return read ? { rules: hexRules(...read) } : null
  },
  ultimate: () => ({ rules: ultimateRules }),
  breakthrough: (s) => {
    const size = readBreakthroughSize(s)
    return size === null ? null : { rules: breakthroughRules(size) }
  },
  fences: (s) => {
    const size = readFencesSize(s)
    return size === null ? null : { rules: fencesRules(size) }
  },
}

/** a match as `lab_match_load` returns it: the row, `secret` included */
export type Row = {
  id: string
  demo_id: string
  mode: Mode
  player_a: string
  player_b: string
  status: string
  settings: Record<string, unknown> | null
  state: unknown
  seq: number
  turn: Seat | null
}

/** what the caller asked: to accept an invitation, or to make a move against the board at `at` */
export type Ask = { op: 'accept' } | { op: 'move'; at: number; move: unknown }

export type Plan =
  | { kind: 'begin'; state: unknown; turn: Seat }
  | {
      kind: 'commit'
      at: number
      /** the history row: the move, and the computer's replies to it, together */
      move: { m: unknown; then?: unknown[]; replies?: number }
      state: unknown
      turn: Seat | null
      result: { winner: Seat | 'draw'; score?: string } | null
    }
  | { kind: 'refuse'; status: number; error: string }

const refuse = (status: number, error: string): Plan => ({ kind: 'refuse', status, error })

/** the request body as something `decide` can be asked, or null */
export function readAsk(body: unknown): { match: string; ask: Ask } | null {
  const o = body as Record<string, unknown> | null
  if (!o || typeof o !== 'object') return null
  const match = o.match
  if (typeof match !== 'string' || !/^[0-9a-f-]{36}$/i.test(match)) return null
  if (o.op === 'accept') return { match, ask: { op: 'accept' } }
  if (o.op === 'move' && Number.isInteger(o.at) && (o.at as number) >= 0 && 'move' in o)
    return { match, ask: { op: 'move', at: o.at as number, move: o.move } }
  return null
}

/** the computer's level for a together match: the one asked for, or the easiest */
function levelOf(game: Game, settings: Record<string, unknown>): string | null {
  const levels = game.rules.computer?.levels
  if (!levels) return null
  const asked = settings.level ?? levels[0]
  return typeof asked === 'string' && levels.includes(asked) ? asked : null
}

/**
 * The history row for a move: the move, and the computer's replies to it.
 *
 * ⚠️ `lab_match_moves.move` HOLDS AT MOST 200 BYTES (a CHECK on the table), and a pool shot is
 * four floating-point numbers. One shot is about 70 bytes; a computer's run of pots in Together
 * is several, and the insert would fail the whole move. So the replies are kept when they fit and
 * counted when they do not. The STATE is the record of the game, and it is whole either way.
 * jsonb's own text adds a space after every colon and comma, so the budget leaves room for those.
 */
export const HISTORY_BYTES = 180
/** the bytes Postgres counts in `octet_length(move::text)`: jsonb's text spaces every : and , */
export const jsonbBytes = (x: unknown) =>
  new TextEncoder().encode(JSON.stringify(x).replace(/([,:])/g, '$1 ')).length
export function historyRow(m: unknown, then: unknown[]) {
  if (!then.length) return { m }
  const whole = { m, then }
  return jsonbBytes(whole) <= HISTORY_BYTES ? whole : { m, replies: then.length }
}

/** the most moves the computer makes in a row before the team moves again: passes, in Reversi */
const MAX_REPLIES = 64

/**
 * What to do about `ask`, from `me`, on the match `row` as stored. Pure: the same three things in
 * give the same plan out, except for the computer's choice where a toy's computer rolls dice.
 */
export function decide(row: Row | null, me: string, ask: Ask, games: typeof GAMES = GAMES): Plan {
  // ⚠️ the same answer for a match that does not exist and one that is not yours, as
  // lab_match_get gives, so an id cannot be probed through this door either
  const seat: Seat | null = !row ? null : me === row.player_a ? 0 : me === row.player_b ? 1 : null
  if (!row || seat === null) return refuse(404, 'no such match')
  const make = Object.hasOwn(games, row.demo_id) ? games[row.demo_id] : undefined
  const settings = row.settings ?? {}
  const game = make?.(settings) ?? null
  if (!game) return refuse(422, 'this match is on a toy or settings that cannot be played by turns')
  const { rules } = game
  if (row.mode !== 'versus' && row.mode !== 'together')
    return refuse(422, 'a match is versus or together')
  if (!(rules.modes ?? ['versus']).includes(row.mode))
    return refuse(422, `this toy has no ${row.mode} game`)
  const level = row.mode === 'together' ? levelOf(game, settings) : null
  if (row.mode === 'together' && level === null)
    return refuse(422, 'this match asks for a computer level the toy does not have')

  if (ask.op === 'accept') {
    if (row.status !== 'invited') return refuse(409, 'that invitation is no longer open')
    if (seat !== 1) return refuse(403, 'only the friend who was challenged can accept')
    const g = rules.fresh(row.mode)
    // the challenger moves first, both in versus and as the first of the team
    return { kind: 'begin', state: rules.encode(g), turn: 0 }
  }

  if (row.status !== 'active') return refuse(409, 'that match is not going')
  if (row.turn !== seat) return refuse(409, 'it is not your turn')
  if (ask.at !== row.seq) return refuse(409, 'the match has moved on')
  const g0 = rules.decode(row.state)
  // a stored game no rules could have made is damage, and nothing is built on it
  if (g0 === null) return refuse(500, 'this match’s board cannot be read')
  const move = rules.readMove(ask.move)
  if (move === null) return refuse(400, 'that is not a move in this toy')
  // the side moving: the mover's own in versus, the team's (side 0) together
  const side: Seat = row.mode === 'together' ? 0 : seat
  if (rules.turn(g0) !== side) return refuse(500, 'this match’s turn and board disagree')
  if (!rules.legal(g0, move, side)) return refuse(400, 'that move is not allowed there')
  let g = rules.apply(g0, move, side)

  // together: the computer answers now, as many times as the game gives it the move
  const then: unknown[] = []
  if (row.mode === 'together') {
    const cpu = rules.computer!
    while (rules.turn(g) === cpu.side && then.length < MAX_REPLIES) {
      const reply = cpu.choose(g, level!)
      if (!rules.legal(g, reply, cpu.side)) return refuse(500, 'the computer could not move')
      g = rules.apply(g, reply, cpu.side)
      then.push(reply)
    }
  }

  const over = rules.turn(g) === null
  const winner = over ? (rules.result?.(g) ?? 'draw') : null
  return {
    kind: 'commit',
    at: row.seq,
    move: historyRow(move, then),
    state: rules.encode(g),
    // versus: whoever the board says; together: the other friend takes the team's next move
    turn: over ? null : row.mode === 'together' ? ((1 - seat) as Seat) : (rules.turn(g) as Seat),
    result:
      winner === null
        ? null
        : { winner, ...(game.score ? { score: game.score(g).slice(0, 40) } : {}) },
  }
}
