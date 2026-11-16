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
import { halmaRules } from '../../../src/gpu/halmaRoom'
import { score as goScore } from '../../../src/gpu/goboard'
import { goRules, type GoGame } from '../../../src/gpu/goRoom'
import { foxRules } from '../../../src/gpu/foxRoom'
import { cubeRules } from '../../../src/gpu/cubeRoom'
import { artilleryRules, type ArtilleryGame } from '../../../src/gpu/artilleryRoom'
import { score as bowlingScore } from '../../../src/gpu/bowling'
import { bowlingRules, type BowlingGame } from '../../../src/gpu/bowlingRoom'
import { totals as curlingTotals } from '../../../src/gpu/curling'
import { curlingMatchRules, type CurlingGame } from '../../../src/gpu/curlingRoom'
import { puttRules, totals as puttTotals, type PuttGame } from '../../../src/gpu/puttRoom'
import { dartsMatchRules, type DartsGame } from '../../../src/gpu/dartsRoom'
import { backgammonRules, worth, type BackgammonGame } from '../../../src/gpu/backgammonRoom'
import { readSeaSettings, seaRules, type SeaGame } from '../../../src/gpu/seabattleRoom'
import { diceRules, type DiceGame } from '../../../src/gpu/diceRoom'
import { total as yachtTotal } from '../../../src/gpu/yacht'
import { yachtRules, type YachtGame } from '../../../src/gpu/yachtRoom'
import { sum as shutSum } from '../../../src/gpu/shut'
import { shutRules, type ShutGame } from '../../../src/gpu/shutRoom'
import {
  codeRules,
  crackedIn,
  readCodeSettings,
  type CodeGame,
} from '../../../src/gpu/codebreakerRoom'
import { boxRules, readBoxSettings, totals, type BoxGame } from '../../../src/gpu/shadowboxRoom'
import { readRpsSettings, rpsRules, wins, type RpsGame } from '../../../src/gpu/rpsRoom'
import {
  ginRules,
  readGinSettings,
  totals as ginTotals,
  type GinGame,
} from '../../../src/gpu/ginRoom'
import { cribRules, type CribGame } from '../../../src/gpu/cribbageRoom'
import {
  dominoRules,
  readDominoSettings,
  totals as dominoTotals,
  type DominoGame,
} from '../../../src/gpu/dominoesRoom'
import {
  heartsRules,
  readHeartsSettings,
  totals as heartsTotals,
  type HeartsGame,
} from '../../../src/gpu/heartsRoom'
import {
  readSpadesSettings,
  spadesRules,
  teams as spadesTeams,
  type SpadesGame,
} from '../../../src/gpu/spadesRoom'
import {
  eightsRules,
  readEightsSettings,
  totals as eightsTotals,
  type EightsGame,
} from '../../../src/gpu/eightsRoom'
import { liarsRules, readLiarsSettings, type LiarsGame } from '../../../src/gpu/liarsRoom'
import { holdemRules, type HoldemGame } from '../../../src/gpu/holdemRoom'
import { duelRules, pressesBoth, readDuelSettings, type DuelGame } from '../../../src/gpu/lampsDuel'
import {
  chipsOf as twentyOneChips,
  readTwentyOneSettings,
  twentyOneRules,
  type TwentyOneGame,
} from '../../../src/gpu/twentyoneDuel'
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
  halma: () => ({ rules: halmaRules }),
  go: () => ({
    rules: goRules,
    // area by colour, white's with its komi: the count the toy shows at the end
    score: (d: GoGame) => {
      const s = goScore(d.g.board)
      return `${s.black}–${s.white}`
    },
  }),
  fox: () => ({ rules: foxRules }),
  cube: () => ({ rules: cubeRules }),
  artillery: () => ({
    rules: artilleryRules,
    // what each gun has left, left gun first
    score: (g: ArtilleryGame) => `${g.f.guns[0].life}–${g.f.guns[1].life}`,
  }),
  bowling: () => ({
    rules: bowlingRules,
    // the two scorecards' totals, the first bowler's first
    score: (g: BowlingGame) => `${bowlingScore(g.rolls[0])}–${bowlingScore(g.rolls[1])}`,
  }),
  curling: () => ({
    rules: curlingMatchRules,
    // the ends' points added up, yellow's first
    score: (cg: CurlingGame) => curlingTotals(cg.g).join('–'),
  }),
  putt: () => ({
    rules: puttRules,
    // strokes over the round, the first ball's first: the lower wins
    score: (g: PuttGame) => puttTotals(g).join('–'),
  }),
  darts: () => ({
    rules: dartsMatchRules,
    // legs won, the first thrower's first
    score: (g: DartsGame) => g.legs.join('–'),
  }),
  backgammon: () => ({
    rules: backgammonRules,
    // what the game was worth: a single game, a gammon or a backgammon
    score: (g: BackgammonGame) => worth(g) ?? '',
  }),
  seabattle: (s) => {
    const set = readSeaSettings(s)
    return set === null
      ? null
      : {
          rules: seaRules(set),
          // ships each side sank, the challenger's first
          score: (g: SeaGame) => `${g.seen[0].sunk.length}–${g.seen[1].sunk.length}`,
        }
  },
  dice: () => ({
    rules: diceRules,
    // the two scores banked, the challenger's first
    score: (g: DiceGame) => g.scores.map((n) => n.toLocaleString('en-GB')).join('–'),
  }),
  yacht: () => ({
    rules: yachtRules,
    // the two cards' totals, the challenger's first
    score: (y: YachtGame) => `${yachtTotal(y.g.cards[0])}–${yachtTotal(y.g.cards[1])}`,
  }),
  shut: () => ({
    rules: shutRules,
    // what each box left up, the challenger's first: the lower wins
    score: (g: ShutGame) => `${shutSum(g.up[0])}–${shutSum(g.up[1])}`,
  }),
  codebreaker: (s) => {
    const rules = readCodeSettings(s)
    if (rules === null) return null
    // the guesses each side took to crack the other's code, the challenger's first
    const took = (g: CodeGame, side: 0 | 1) => crackedIn(g, side) ?? 'uncracked'
    return { rules: codeRules(rules), score: (g: CodeGame) => `${took(g, 0)}–${took(g, 1)}` }
  },
  shadowbox: (s) => {
    const set = readBoxSettings(s)
    if (set === null) return null
    // each side's blocks over par, the challenger's first
    return { rules: boxRules(set.rounds), score: (g: BoxGame) => totals(g).join('–') }
  },
  rps: (s) => {
    const set = readRpsSettings(s)
    if (set === null) return null
    // rounds won, the challenger's first
    return { rules: rpsRules(set.firstTo), score: (g: RpsGame) => wins(g).join('–') }
  },
  gin: (s) => {
    const set = readGinSettings(s)
    if (set === null) return null
    // each side's points over the hands, the challenger's first
    return { rules: ginRules(set.target), score: (g: GinGame) => ginTotals(g).join('–') }
  },
  cribbage: () => ({
    rules: cribRules,
    // each side's pegs, the challenger's first
    score: (g: CribGame) => g.r.scores.join('–'),
  }),
  dominoes: (s) => {
    const set = readDominoSettings(s)
    if (set === null) return null
    // each side's points over the rounds, the challenger's first
    return { rules: dominoRules(set.target), score: (g: DominoGame) => dominoTotals(g).join('–') }
  },
  hearts: (s) => {
    const set = readHeartsSettings(s)
    if (set === null) return null
    // versus, the two friends' points; together, the pairs' — the friends' first; lower wins
    const score = (g: HeartsGame) => {
      const t = heartsTotals(g)
      return (g.together ? [t[0] + t[2], t[1] + t[3]] : [t[0], t[2]]).join('–')
    }
    return { rules: heartsRules(set.end, set.level), score }
  },
  spades: (s) => {
    const set = readSpadesSettings(s)
    if (set === null) return null
    // the partnerships' scores, the challenger's first
    const score = (g: SpadesGame) =>
      spadesTeams(g)
        .map((t) => t.score)
        .join('–')
    return { rules: spadesRules(set.target, set.level), score }
  },
  eights: (s) => {
    const set = readEightsSettings(s)
    if (set === null) return null
    // each side's points over the hands, the challenger's first
    return { rules: eightsRules(set.target), score: (g: EightsGame) => eightsTotals(g).join('–') }
  },
  liars: (s) => {
    const set = readLiarsSettings(s)
    if (set === null) return null
    // the dice each side has left, the challenger's first
    return { rules: liarsRules(set.wild), score: (x: LiarsGame) => x.g.left.join('–') }
  },
  poker: () => ({
    rules: holdemRules,
    // each seat's chips at the end, the challenger's first
    score: (g: HoldemGame) => g.t.seats.map((s) => s.chips).join('–'),
  }),
  lamps: (s) => {
    const set = readDuelSettings(s)
    if (set === null) return null
    // each side's presses, the challenger's first: fewer wins
    return {
      rules: duelRules(set.size, set.pattern),
      score: (g: DuelGame) => pressesBoth(g)?.join('–') ?? '',
    }
  },
  twentyone: (s) => {
    const set = readTwentyOneSettings(s)
    if (set === null) return null
    // each side's chips at the end, the challenger's first
    return {
      rules: twentyOneRules(set.rounds),
      score: (g: TwentyOneGame) =>
        g.shown ? (twentyOneChips(g.shown.seeds, g.shown.acts) ?? []).join('–') : '',
    }
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
  /** what a toy keeps back from both players (Rules.hidden): never sent to a browser whole */
  secret?: unknown
  seq: number
  turn: Seat | null
}

/**
 * What the caller asked: to accept an invitation (bringing what a toy with something hidden needs
 * from the friend, their fleet), to make a move against the board at `at`, or to see their own
 * side of what the toy keeps hidden.
 */
export type Ask =
  | { op: 'accept'; brought?: unknown }
  | { op: 'move'; at: number; move: unknown }
  | { op: 'mine' }

export type Plan =
  | { kind: 'begin'; state: unknown; turn: Seat; secret?: unknown }
  | {
      kind: 'commit'
      at: number
      /** the history row: the move, and the computer's replies to it, together */
      move: { m: unknown; then?: unknown[]; replies?: number }
      state: unknown
      turn: Seat | null
      result: { winner: Seat | 'draw'; score?: string } | null
      /** the hidden part as it now is, for a toy that keeps one */
      secret?: unknown
    }
  /** a player's own side of what a toy keeps hidden, and nothing of the other's */
  | { kind: 'mine'; data: unknown }
  | { kind: 'refuse'; status: number; error: string }

const refuse = (status: number, error: string): Plan => ({ kind: 'refuse', status, error })

/** the request body as something `decide` can be asked, or null */
export function readAsk(body: unknown): { match: string; ask: Ask } | null {
  const o = body as Record<string, unknown> | null
  if (!o || typeof o !== 'object') return null
  const match = o.match
  if (typeof match !== 'string' || !/^[0-9a-f-]{36}$/i.test(match)) return null
  if (o.op === 'accept')
    return { match, ask: 'brought' in o ? { op: 'accept', brought: o.brought } : { op: 'accept' } }
  if (o.op === 'mine') return { match, ask: { op: 'mine' } }
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
  // the fullest row that fits: the replies kept, then counted, then the move itself only noted,
  // so a move too big for its own row can never fail the insert and with it the whole move
  const rows = then.length
    ? [
        { m, then },
        { m, replies: then.length },
        { m: null, replies: then.length },
      ]
    : [{ m }, { m: null }]
  return rows.find((r) => jsonbBytes(r) <= HISTORY_BYTES) ?? rows[rows.length - 1]
}

/** the most moves the computer makes in a row before the team moves again: passes, in Reversi */
const MAX_REPLIES = 64

/**
 * What to do about `ask`, from `me`, on the match `row` as stored. Pure: the same three things in
 * give the same plan out, except for the computer's choice where a toy's computer rolls dice, and
 * a toy's own dice, which the server rolls here (`Rules.roll`) and nowhere else.
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
  /** the dice for whoever moves next, for a toy that has them */
  const roll = (g: unknown) => (rules.roll ? rules.roll(g, Math.random) : g)
  /** together: the computer answers now, as many times as the game gives it the move */
  const answer = (g0: unknown): { g: unknown; then: unknown[] } | null => {
    let g = g0
    const then: unknown[] = []
    if (row.mode !== 'together') return { g, then }
    const cpu = rules.computer!
    while (rules.turn(g) === cpu.side && then.length < MAX_REPLIES) {
      const reply = cpu.choose(g, level!)
      if (!rules.legal(g, reply, cpu.side)) return null
      g = roll(rules.apply(g, reply, cpu.side))
      then.push(reply)
    }
    return { g, then }
  }

  const { hidden } = rules
  /** the game as the server knows it: the state anybody may see, and what is kept back */
  const whole = (r: Row) => {
    const g = rules.decode(r.state)
    return g === null || !hidden ? g : hidden.join(g, r.secret)
  }

  if (ask.op === 'mine') {
    if (!hidden) return refuse(422, 'this toy keeps nothing hidden')
    // before the friend has answered there is nothing kept yet, for either side
    if (row.status === 'invited') return { kind: 'mine', data: null }
    const g = whole(row)
    if (g === null) return refuse(500, 'this match’s board cannot be read')
    return { kind: 'mine', data: hidden.mine(g, row.mode === 'together' ? 0 : seat, seat) }
  }

  if (ask.op === 'accept') {
    if (row.status !== 'invited') return refuse(409, 'that invitation is no longer open')
    if (seat !== 1) return refuse(403, 'only the friend who was challenged can accept')
    let g = rules.fresh(row.mode)
    if (hidden) {
      // the friend's own hidden part (their fleet) comes with their yes, and is kept back
      const h = hidden.accept(g, ask.brought, row.mode)
      if (h === null) return refuse(400, 'accepting this match needs your side set out first')
      g = h
      const t = rules.turn(g)
      return {
        kind: 'begin',
        state: rules.encode(g),
        turn:
          row.mode === 'together'
            ? (rules.friendTurn?.(g) ?? 0)
            : t === null || t === 'any'
              ? 0
              : t,
        secret: hidden.secret(g),
      }
    }
    // the challenger moves first, both in versus and as the first of the team
    if (!rules.roll) return { kind: 'begin', state: rules.encode(g), turn: 0 }
    // ⚠️ a toy with dice: its opening roll says who starts, and together the computer may, so it
    // plays at once; the team's first move is the challenger's whoever opened
    const opened = answer(rules.roll(g, Math.random))
    if (!opened) return refuse(500, 'the computer could not move')
    const t = rules.turn(opened.g)
    return {
      kind: 'begin',
      state: rules.encode(opened.g),
      turn:
        row.mode === 'together'
          ? (rules.friendTurn?.(opened.g) ?? 0)
          : t === null || t === 'any'
            ? 0
            : t,
    }
  }

  if (row.status !== 'active') return refuse(409, 'that match is not going')
  if (row.turn !== seat) return refuse(409, 'it is not your turn')
  if (ask.at !== row.seq) return refuse(409, 'the match has moved on')
  const g0 = whole(row)
  // a stored game no rules could have made is damage, and nothing is built on it
  if (g0 === null) return refuse(500, 'this match’s board cannot be read')
  const move = rules.readMove(ask.move)
  if (move === null) return refuse(400, 'that is not a move in this toy')
  // the side moving: the mover's own in versus, the team's (side 0) together
  const side: Seat = row.mode === 'together' ? 0 : seat
  if (rules.turn(g0) !== side) return refuse(500, 'this match’s turn and board disagree')
  if (!rules.legal(g0, move, side)) return refuse(400, 'that move is not allowed there')
  const answered = answer(roll(rules.apply(g0, move, side)))
  if (!answered) return refuse(500, 'the computer could not move')
  const { g, then } = answered

  const over = rules.turn(g) === null
  const winner = over ? (rules.result?.(g) ?? 'draw') : null
  return {
    kind: 'commit',
    at: row.seq,
    // anything hidden in a move (the challenger's fleet, with their first shot) is not history
    move: hidden
      ? historyRow(hidden.logged(move), then.map(hidden.logged))
      : historyRow(move, then),
    state: rules.encode(g),
    ...(hidden ? { secret: hidden.secret(g) } : {}),
    // versus: whoever the board says; together: the other friend takes the team's next move,
    // unless the toy seats the friends apart and says which of them it is (Hearts, Spades)
    turn: over
      ? null
      : row.mode === 'together'
        ? (rules.friendTurn?.(g) ?? ((1 - seat) as Seat))
        : (rules.turn(g) as Seat),
    result:
      winner === null
        ? null
        : { winner, ...(game.score ? { score: game.score(g).slice(0, 40) } : {}) },
  }
}
