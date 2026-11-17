import { readFileSync, readdirSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bundle, OUT } from '../../../scripts/lab-move-bundle.mjs'
import { chessRules, replay } from '../../../src/gpu/chessRoom'
import { count, moves } from '../../../src/gpu/reversi'
import { readReversiGame, reversiRules } from '../../../src/gpu/reversiRoom'
import * as built from './core.bundle.js'
import {
  GAMES,
  HISTORY_BYTES,
  decide,
  historyRow,
  jsonbBytes,
  readAsk,
  type Ask,
  type Plan,
  type Row,
} from './core'
import { poolRules, readPoolGame } from '../../../src/gpu/poolRoom'
import {
  choose as gomokuChoose,
  newGame as gomokuGame,
  place as gomokuPlace,
} from '../../../src/gpu/gomoku'
import { gomokuRules } from '../../../src/gpu/gomokuRoom'
import {
  choose as draughtsChoose,
  moves as draughtsMoves,
  newGame as draughtsGame,
  owner,
} from '../../../src/gpu/draughts'
import { draughtsRules, replay as draughtsReplay } from '../../../src/gpu/draughtsRoom'
import { choose as dotsChoose, lineCount } from '../../../src/gpu/dots'
import { replay as dotsReplay } from '../../../src/gpu/dotsRoom'
import { choose as fourChoose, type Who } from '../../../src/gpu/fourrow'
import { fourRowMatchRules, fourRowRules, readFourGame } from '../../../src/gpu/fourrowRoom'
import {
  choose as mancalaChoose,
  legal as mancalaLegal,
  score as stores,
  storeOf,
  total,
} from '../../../src/gpu/mancala'
import { mancalaRules, replay as mancalaReplay } from '../../../src/gpu/mancalaRoom'
import {
  count as menOf,
  moves as morrisMoves,
  type Move as MorrisMove,
} from '../../../src/gpu/morris'
import { replay as morrisReplay } from '../../../src/gpu/morrisRoom'
import { chain as hexChain } from '../../../src/gpu/hex'
import { SWAP, replay as hexReplay } from '../../../src/gpu/hexRoom'
import { LINES as ULT_LINES, moves as ultMoves } from '../../../src/gpu/ultimate'
import { replay as ultReplay } from '../../../src/gpu/ultimateRoom'
import {
  choose as halmaChoose,
  DRAW_AFTER as HALMA_DRAW,
  moves as halmaMoves,
  won as halmaWon,
} from '../../../src/gpu/halma'
import { replay as halmaReplay } from '../../../src/gpu/halmaRoom'
import { KOMI, legal as goLegal, N as GO_N, PASS } from '../../../src/gpu/goboard'
import { MAX_MOVES as GO_MAX, replay as goReplay } from '../../../src/gpu/goRoom'
import {
  choose as foxChoose,
  foxMoves,
  gooseMoves,
  IDLE_LIMIT,
  movesFor as foxMovesFor,
  START_GEESE,
  TAKE_TO_WIN,
} from '../../../src/gpu/fox'
import { replay as foxReplay } from '../../../src/gpu/foxRoom'
import { cubeRules } from '../../../src/gpu/cubeRoom'
import { gunner, LIFE } from '../../../src/gpu/artillery'
import { replay as artReplay } from '../../../src/gpu/artilleryRoom'
import { LANE_HALF, plan as bowlPlan, wobble as bowlWobble } from '../../../src/gpu/bowling'
import { inside as bowlInside, replay as bowlReplay } from '../../../src/gpu/bowlingRoom'
import { HOUSE_R, STONE_R, TEE } from '../../../src/gpu/curling'
import {
  fewerSpans,
  matchThrow,
  MATCH_SPANS,
  MAX_THROWS as MAX_CURL_THROWS,
  pack as curlPack,
  replay as curlReplay,
} from '../../../src/gpu/curlingRoom'
import { COURSE, PICK_UP, stroke as puttStroke } from '../../../src/gpu/putt'
import { replay as puttReplay } from '../../../src/gpu/puttRoom'
import { aimFor, hitAt, land, SPREAD } from '../../../src/gpu/darts'
import { dartsMatchRules, MAX_DARTS, tidy } from '../../../src/gpu/dartsRoom'
import { plays as bgPlays } from '../../../src/gpu/backgammon'
import { MAX_TURNS as BG_MAX_TURNS, replay as bgReplay } from '../../../src/gpu/backgammonRoom'
import { FLEETS, randomFleet } from '../../../src/gpu/seabattle'
import { chooseKeep, scoreOf as tenScore } from '../../../src/gpu/dice'
import { replay as tenReplay } from '../../../src/gpu/diceRoom'
import {
  CATS as YACHT_CATS,
  chooseBox as yachtBox,
  chooseKeep as yachtKeep,
} from '../../../src/gpu/yacht'
import { replay as yachtReplay } from '../../../src/gpu/yachtRoom'
import { chooseDice as shutDice, chooseWay as shutWay } from '../../../src/gpu/shut'
import { replay as shutReplay } from '../../../src/gpu/shutRoom'
import { moves as btMoves } from '../../../src/gpu/breakthrough'
import { replay as btReplay } from '../../../src/gpu/breakthroughRoom'
import { choose as fencesChoose, dist as fencesDist, goalRow } from '../../../src/gpu/fences'
import { packMove as packFence, replay as fencesReplay } from '../../../src/gpu/fencesRoom'

/**
 * ⚠️ THE EDGE FUNCTION CANNOT BE ASKED ANYTHING FROM HERE, as `pictures` says of itself: it needs a
 * runtime, a member's token and the matches tables. So what it decides is in core.ts, and this is
 * where that is checked, against the toys' own rules. The plumbing in index.ts was driven against
 * a throwaway Supabase stack with Deno (see the PR); these are the answers it relies on.
 */

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const STRANGER = '00000000-0000-4000-8000-00000000000c'
const MATCH = '11111111-2222-4333-8444-555555555555'

/** a seeded stand-in for Math.random, so a computer's choice is the same on every run */
function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
beforeEach(() => {
  vi.spyOn(Math, 'random').mockImplementation(seeded(20261114))
})
afterEach(() => vi.restoreAllMocks())

/** an invitation, every field unlike its default */
const invite = (over: Partial<Row> = {}): Row => ({
  id: MATCH,
  demo_id: 'reversi',
  mode: 'versus',
  player_a: A,
  player_b: B,
  status: 'invited',
  settings: { size: 6 },
  state: null,
  seq: 0,
  turn: null,
  ...over,
})

/**
 * The match after `plan`, as lab_match_begin or lab_match_commit would leave it — the secret in
 * their own words: begin sets `secret = p_secret`, commit `secret = coalesce(p_secret, secret)`.
 */
function after(row: Row, plan: Plan): Row {
  if (plan.kind === 'begin')
    return {
      ...row,
      status: 'active',
      state: plan.state,
      turn: plan.turn,
      secret: plan.secret ?? null,
    }
  if (plan.kind === 'commit')
    return {
      ...row,
      seq: row.seq + 1,
      state: plan.state,
      turn: plan.turn,
      status: plan.result ? 'finished' : 'active',
      secret: plan.secret ?? row.secret ?? null,
    }
  throw new Error(`refused: ${plan.status} ${plan.error}`)
}

const status = (p: Plan) => (p.kind === 'refuse' ? p.status : p.kind)
const move = (at: number, m: unknown): Ask => ({ op: 'move', at, move: m })

describe('reading a request', () => {
  it('takes an accept or a move, and nothing else', () => {
    expect(readAsk({ op: 'accept', match: MATCH })).toEqual({ match: MATCH, ask: { op: 'accept' } })
    // an accept may bring the friend's side of what a toy keeps hidden; a player may ask for theirs
    expect(readAsk({ op: 'accept', match: MATCH, brought: [[1, 2]] })).toEqual({
      match: MATCH,
      ask: { op: 'accept', brought: [[1, 2]] },
    })
    expect(readAsk({ op: 'mine', match: MATCH })).toEqual({ match: MATCH, ask: { op: 'mine' } })
    expect(readAsk({ op: 'move', match: MATCH, at: 3, move: 'e2e4' })).toEqual({
      match: MATCH,
      ask: { op: 'move', at: 3, move: 'e2e4' },
    })
    for (const bad of [
      null,
      'accept',
      { op: 'accept' },
      { op: 'accept', match: 'not-a-uuid' },
      { op: 'move', match: MATCH, move: 'e2e4' },
      { op: 'move', match: MATCH, at: -1, move: 'e2e4' },
      { op: 'move', match: MATCH, at: 1.5, move: 'e2e4' },
      { op: 'move', match: MATCH, at: 0 },
      { op: 'resign', match: MATCH },
      { op: 'mine' },
      { op: 'mine', match: 'not-a-uuid' },
      { op: 'commit', match: MATCH, at: 0, move: 1, state: {} },
    ])
      expect(readAsk(bad)).toBeNull()
  })
})

describe('who may ask', () => {
  it('answers a stranger exactly as it answers a match that does not exist', () => {
    const row = after(invite(), decide(invite(), B, { op: 'accept' }))
    const missing = decide(null, A, move(0, 14))
    expect(missing).toEqual({ kind: 'refuse', status: 404, error: 'no such match' })
    expect(decide(row, STRANGER, move(0, 14))).toEqual(missing)
    expect(decide(invite(), STRANGER, { op: 'accept' })).toEqual(missing)
  })

  it('lets only the challenged friend accept, and only while it is an invitation', () => {
    expect(status(decide(invite(), A, { op: 'accept' }))).toBe(403)
    const begun = after(invite(), decide(invite(), B, { op: 'accept' }))
    expect(status(decide(begun, B, { op: 'accept' }))).toBe(409)
    for (const s of ['declined', 'ended', 'finished'])
      expect(status(decide(invite({ status: s }), B, { op: 'accept' }))).toBe(409)
  })

  it('refuses a toy, a mode or settings it cannot play, before anything is written', () => {
    expect(status(decide(invite({ demo_id: 'hockey' }), B, { op: 'accept' }))).toBe(422)
    expect(status(decide(invite({ demo_id: 'toString' }), B, { op: 'accept' }))).toBe(422)
    expect(status(decide(invite({ settings: { size: 7 } }), B, { op: 'accept' }))).toBe(422)
    expect(status(decide(invite({ settings: { size: '8' } }), B, { op: 'accept' }))).toBe(422)
    const together = invite({ mode: 'together', settings: { size: 6, level: 'impossible' } })
    expect(status(decide(together, B, { op: 'accept' }))).toBe(422)
    expect(status(decide(invite({ mode: 'race' as never }), B, { op: 'accept' }))).toBe(422)
  })
})

describe('a game begins', () => {
  it('with the toy’s own fresh board, and the challenger to move', () => {
    const p = decide(invite({ settings: { size: 10 } }), B, { op: 'accept' })
    expect(p).toEqual({
      kind: 'begin',
      state: reversiRules(10).encode(reversiRules(10).fresh()),
      turn: 0,
    })
    const c = decide(invite({ demo_id: 'chess', settings: {} }), B, { op: 'accept' })
    expect(c).toEqual({ kind: 'begin', state: { moves: [] }, turn: 0 })
  })

  it('at size 8 when the challenge named none', () => {
    const p = decide(invite({ settings: {} }), B, { op: 'accept' })
    expect(p.kind === 'begin' && (p.state as { n: number }).n).toBe(8)
  })
})

describe('a move', () => {
  const going = () => after(invite(), decide(invite(), B, { op: 'accept' }))

  it('is refused out of turn, against an old board, or when it is not a move', () => {
    const row = going()
    const legal = moves(readReversiGame(row.state)!.b, 1)[0]
    expect(status(decide(row, B, move(0, legal)))).toBe(409) // B is light; dark moves first
    expect(status(decide(row, A, move(1, legal)))).toBe(409) // seq 0 is the board A saw
    expect(status(decide(row, A, move(0, 'e2e4')))).toBe(400)
    expect(status(decide(row, A, move(0, 0)))).toBe(400) // a corner: not a move at the start
    expect(status(decide(row, A, move(0, legal)))).toBe('commit')
  })

  it('is refused on a match that is not going', () => {
    for (const s of ['invited', 'finished', 'declined', 'ended'])
      expect(status(decide({ ...going(), status: s }, A, move(0, 14)))).toBe(409)
  })

  it('is refused on a stored board no game could have made, rather than built on', () => {
    const row = going()
    const s = row.state as { cells: number[] }
    const damaged = { ...row, state: { ...s, cells: s.cells.map(() => 0) } }
    expect(decide(damaged, A, move(0, 14))).toEqual({
      kind: 'refuse',
      status: 500,
      error: 'this match’s board cannot be read',
    })
    // a chess game that is not a game: the second move is white's again
    const chess = { ...going(), demo_id: 'chess', settings: {}, state: { moves: ['e2e4', 'd2d4'] } }
    expect(status(decide(chess, A, move(0, 'e7e5')))).toBe(500)
  })

  it('records the move, the board after it and the other player to move', () => {
    const row = going()
    const legal = moves(readReversiGame(row.state)!.b, 1)[0]
    const p = decide(row, A, move(0, legal))
    expect(p.kind).toBe('commit')
    if (p.kind !== 'commit') return
    expect(p.at).toBe(0)
    expect(p.move).toEqual({ m: legal })
    expect(p.turn).toBe(1)
    expect(p.result).toBeNull()
    const g = readReversiGame(p.state)!
    expect(count(g.b)).toEqual([4, 1])
  })
})

/** play a whole match from invitation to finish, each player choosing with `pick` */
function playOut(start: Row, pick: (row: Row, who: string) => unknown, limit = 400) {
  let row = after(start, decide(start, B, { op: 'accept' }))
  const plans: Plan[] = []
  for (let i = 0; i < limit && row.status === 'active'; i++) {
    const who = row.turn === 0 ? A : B
    const p = decide(row, who, move(row.seq, pick(row, who)))
    plans.push(p)
    row = after(row, p)
  }
  return { row, plans }
}

describe('a versus match played to its end', () => {
  it('finishes in Reversi with the winner the board says, and the count as its score', () => {
    let passes = 0
    for (let seed = 1; seed <= 30; seed++) {
      const rnd = seeded(seed)
      const { row, plans } = playOut(invite(), (r) => {
        const g = readReversiGame(r.state)!
        const list = moves(g.b, g.turn!)
        return list[Math.floor(rnd() * list.length)]
      })
      expect(row.status).toBe('finished')
      const last = plans[plans.length - 1]
      expect(last.kind).toBe('commit')
      if (last.kind !== 'commit') return
      const [d, l] = count(readReversiGame(last.state)!.b)
      expect(last.result).toEqual({ winner: d > l ? 0 : l > d ? 1 : 'draw', score: `${d}–${l}` })
      expect(last.turn).toBeNull()
      // a pass is a turn that stays with the same player
      const turns = plans.map((p) => (p.kind === 'commit' ? p.turn : null))
      if (turns.slice(1).some((t, i) => t !== null && t === turns[i])) passes++
    }
    // thirty random games and not one pass would mean passes were never asked about
    expect(passes).toBeGreaterThan(0)
  })

  it('finishes in Chess on a mate, black winning, with no score', () => {
    const fools = ['f2f3', 'e7e5', 'g2g4', 'd8h4']
    const { row, plans } = playOut(invite({ demo_id: 'chess', settings: {} }), (r) => fools[r.seq])
    expect(row.status).toBe('finished')
    expect(plans.at(-1)).toMatchObject({ kind: 'commit', turn: null, result: { winner: 1 } })
    expect((plans.at(-1) as { result: object }).result).not.toHaveProperty('score')
    expect(replay((row.state as { moves: string[] }).moves)?.over).toBeTruthy()
  })
})

describe('together: two friends against the computer', () => {
  const together = (demo: string, settings: Record<string, unknown>) =>
    invite({ demo_id: demo, mode: 'together', settings })

  it('the computer answers in the same move, and the other friend moves next', () => {
    const row = after(
      together('chess', { level: 'easy' }),
      decide(together('chess', { level: 'easy' }), B, { op: 'accept' }),
    )
    const p = decide(row, A, move(0, 'e2e4'))
    expect(p.kind).toBe('commit')
    if (p.kind !== 'commit') return
    expect(p.move.m).toBe('e2e4')
    expect(p.move.then).toHaveLength(1)
    expect(p.turn).toBe(1) // B, not A again
    const list = (p.state as { moves: string[] }).moves
    expect(list).toEqual(['e2e4', p.move.then![0]])
    expect(replay(list)).not.toBeNull()
    // and A cannot take B's turn
    expect(status(decide(after(row, p), A, move(1, 'd2d4')))).toBe(409)
    expect(status(decide(after(row, p), B, move(1, 'd2d4')))).toBe('commit')
  })

  it('plays Reversi to the end at every level, every stored board a board the rules accept', () => {
    for (const level of ['easy', 'fair', 'hard']) {
      const rnd = seeded(level.length)
      const { row, plans } = playOut(together('reversi', { size: 6, level }), (r) => {
        const g = readReversiGame(r.state)!
        const list = moves(g.b, 1)
        return list[Math.floor(rnd() * list.length)]
      })
      expect(row.status).toBe('finished')
      for (const p of plans) {
        expect(p.kind).toBe('commit')
        if (p.kind !== 'commit') continue
        expect(readReversiGame(p.state)).not.toBeNull()
        // the team never waits on the computer: a stored turn is always a friend's
        expect([0, 1, null]).toContain(p.turn)
      }
      // the friends alternate, whatever the computer did in between
      const turns = plans.map((p) => (p.kind === 'commit' ? p.turn : -1)).filter((t) => t !== null)
      turns.forEach((t, i) => expect(t).toBe(i % 2 === 0 ? 1 : 0))
      const last = plans.at(-1)!
      if (last.kind === 'commit') expect(['0', '1', 'draw']).toContain(String(last.result!.winner))
    }
  })
})

describe('the list of toys', () => {
  /**
   * ⚠️ THE NEWEST DEFINITION, WHEREVER IT IS. `lab_match_playable` is replaced each time a toy
   * joins, so the list lives in the latest file that defines it: an applied migration, or the
   * draft waiting to be applied beside the code that needs it. Dated by the name: a migration's
   * timestamp, a doc's day (a doc counts as the end of its day, because the draft for a change is
   * written before the migration that applies it).
   */
  it('is the same as the newest lab_match_playable in the SQL', () => {
    const root = new URL('../../../', import.meta.url)
    const files = [
      ...readdirSync(new URL('supabase/migrations/', root)).map((f) => ({
        at: f.slice(0, 14),
        url: new URL(`supabase/migrations/${f}`, root),
      })),
      ...readdirSync(new URL('docs/', root))
        .filter((f) => f.endsWith('.sql') && !f.includes('ROLLBACK'))
        .map((f) => ({
          at: f.slice(0, 10).replace(/-/g, '') + '999999',
          url: new URL(`docs/${f}`, root),
        })),
    ]
    let newest: { at: string; list: string[] } | null = null
    /* ⚠️ SEVERAL DRAFTS CAN SHARE A DAY, and a tie used to go to whichever file the directory
       listed first: on 16 Nov four drafts each added one toy, and the scan read Dots' list as the
       newest while Four in a row's sat beside it. Each draft extends the one before, so of two
       on one day the newer is the one whose list holds the other's; two that do not nest are a
       question for whoever wrote them, and say so. */
    const holds = (a: string[], b: string[]) => b.every((x) => a.includes(x))
    for (const f of files) {
      const body = /lab_match_playable\(p_demo text\)[\s\S]*?select p_demo in \(([^)]*)\)/.exec(
        readFileSync(f.url, 'utf8'),
      )
      if (!body) continue
      const list = body[1].split(',').map((x) => x.trim().replace(/'/g, ''))
      if (!newest || f.at > newest.at) newest = { at: f.at, list }
      else if (f.at === newest.at && list.join() !== newest.list.join()) {
        if (holds(list, newest.list)) newest = { at: f.at, list }
        else if (!holds(newest.list, list))
          throw new Error(`two lab_match_playable lists on ${f.at.slice(0, 8)} that do not nest`)
      }
    }
    expect(newest).not.toBeNull()
    expect(newest!.list.sort()).toEqual(Object.keys(GAMES).sort())
  })

  it('names each toy’s own rules, not a copy', () => {
    expect(GAMES.chess({})!.rules).toBe(chessRules)
  })
})

describe('the bundle the server runs', () => {
  it('is exactly what the build makes of the source today', async () => {
    expect(readFileSync(OUT, 'utf8')).toBe(await bundle())
  }, 20_000)

  it('gives the same answers as the source', () => {
    const asks: [Row, string, Ask][] = []
    const r0 = invite({ demo_id: 'chess', mode: 'together', settings: { level: 'fair' } })
    asks.push([r0, B, { op: 'accept' }], [r0, A, { op: 'accept' }], [null as never, A, move(0, 1)])
    const r1 = after(r0, decide(r0, B, { op: 'accept' }))
    asks.push([r1, A, move(0, 'e2e4')], [r1, A, move(0, 'e2e5')], [r1, B, move(0, 'e2e4')])
    for (const [row, who, ask] of asks) {
      vi.spyOn(Math, 'random').mockImplementation(seeded(1))
      const a = decide(row, who, ask)
      vi.spyOn(Math, 'random').mockImplementation(seeded(1))
      const b = built.decide(row, who, ask)
      expect(b).toEqual(a)
    }
    expect(built.readAsk({ op: 'move', match: MATCH, at: 2, move: 5 })).toEqual(
      readAsk({ op: 'move', match: MATCH, at: 2, move: 5 }),
    )
  })
})

describe('pool by turns: the shot is the move, and the server plays it', () => {
  const pool = (over: Partial<Row> = {}) => invite({ demo_id: 'pool', settings: {}, ...over })
  /** each side's shot, as the toy's own computer would choose it */
  const shotFor = (row: Row) => poolRules.computer!.choose(readPoolGame(row.state)!, 'fair')

  it('plays a versus match to the end, every stored table one the rules accept', () => {
    for (let k = 0; k < 6; k++) {
      const { row, plans } = playOut(pool(), shotFor, 300)
      expect(row.status).toBe('finished')
      for (const p of plans) {
        expect(p.kind).toBe('commit')
        if (p.kind !== 'commit') continue
        expect(readPoolGame(p.state)).not.toBeNull()
        expect(jsonbBytes(p.move)).toBeLessThanOrEqual(HISTORY_BYTES)
      }
      const last = plans.at(-1)
      expect(last?.kind === 'commit' && [0, 1]).toContain(
        last?.kind === 'commit' && last.result?.winner,
      )
    }
  })

  it('together: the computer shoots on in the same call, and the history still fits its column', () => {
    for (const level of ['easy', 'fair', 'hard']) {
      const start = pool({ mode: 'together', settings: { level } })
      const { row, plans } = playOut(start, shotFor, 300)
      expect(row.status).toBe('finished')
      for (const p of plans)
        if (p.kind === 'commit') expect(jsonbBytes(p.move)).toBeLessThanOrEqual(HISTORY_BYTES)
    }
  })

  it('refuses a shot that is not one, and a spot for a cue ball that is not in hand', () => {
    const row = after(pool(), decide(pool(), B, { op: 'accept' }))
    for (const bad of [
      { a: 0, p: 0 },
      { a: 0, p: 1.5 },
      { a: 'x', p: 0.5 },
      { a: 0 },
      { a: 0, p: 0.5, x: 1 },
    ])
      expect(status(decide(row, A, move(0, bad)))).toBe(400)
    // the cue ball is not in hand at the break, so it cannot be put anywhere
    expect(status(decide(row, A, move(0, { a: 0, p: 0.5, x: 0.5, y: 0.5 })))).toBe(400)
    expect(status(decide(row, A, move(0, { a: Math.PI, p: 0.9 })))).toBe('commit')
  })

  it('refuses a stored table no game could be in, rather than playing on it', () => {
    const row = after(pool(), decide(pool(), B, { op: 'accept' }))
    const s = row.state as { balls: number[][] }
    const stacked = { ...s, balls: s.balls.map((b) => [b[0], 1, 0.5, 0]) }
    expect(status(decide({ ...row, state: stacked }, A, move(0, { a: 0, p: 0.5 })))).toBe(500)
    const twice = { ...s, balls: s.balls.map((b, i) => (i === 3 ? [2, b[1], b[2], b[3]] : b)) }
    expect(status(decide({ ...row, state: twice }, A, move(0, { a: 0, p: 0.5 })))).toBe(500)
  })

  it('keeps a long run of replies as a count rather than overflowing the column', () => {
    const shot = { a: 1.2345678901234567, p: 0.8765432109876543 }
    expect(historyRow(shot, [shot])).toEqual({ m: shot, then: [shot] })
    expect(historyRow(shot, [shot, shot, shot, shot])).toEqual({ m: shot, replies: 4 })
  })
})

describe('five in a row by turns', () => {
  const five = (over: Partial<Row> = {}) =>
    invite({ demo_id: 'gomoku', settings: { size: 11 }, ...over })
  /** the board a stored state stands for, replayed by the toy itself rather than by decode */
  const board = (state: unknown) => {
    const o = state as { n: number; moves: number[] }
    return o.moves.reduce(gomokuPlace, gomokuGame(o.n))
  }

  it('plays versus to the end, the winner being whoever owns the five on the board', () => {
    let white = 0
    for (let seed = 1; seed <= 24; seed++) {
      const rnd = seeded(seed)
      const level = (['easy', 'fair', 'hard'] as const)[seed % 3]
      const { row, plans } = playOut(five({ settings: { size: seed % 2 ? 11 : 13 } }), (r) =>
        gomokuChoose(board(r.state), level, rnd),
      )
      expect(row.status).toBe('finished')
      const last = plans.at(-1)!
      expect(last.kind).toBe('commit')
      if (last.kind !== 'commit') continue
      const g = board(last.state)
      if (g.winner === 0) {
        expect(last.result!.winner).toBe('draw')
        continue
      }
      // the stones in the line say who won; black is the challenger's, seat 0
      const colour = g.cells[g.line[0]]
      expect(g.line.length).toBeGreaterThanOrEqual(5)
      expect(g.line.every((i) => g.cells[i] === colour)).toBe(true)
      expect(last.result!.winner).toBe(colour === 1 ? 0 : 1)
      if (colour === 2) white++
      expect(last.turn).toBeNull()
    }
    // twenty-four games won only by black would mean the second seat was never asked about
    expect(white).toBeGreaterThan(0)
  })

  it('together: the computer answers each stone in the same call, at every level', () => {
    for (const level of ['easy', 'fair', 'hard']) {
      const rnd = seeded(level.length + 7)
      const { row, plans } = playOut(
        five({ mode: 'together', settings: { size: 13, level } }),
        (r) => gomokuChoose(board(r.state), 'easy', rnd),
      )
      expect(row.status).toBe('finished')
      for (const p of plans.slice(0, -1)) {
        expect(p.kind).toBe('commit')
        if (p.kind === 'commit') expect(p.move.then).toHaveLength(1)
      }
      const turns = plans.map((p) => (p.kind === 'commit' ? p.turn : -1)).filter((t) => t !== null)
      turns.forEach((t, i) => expect(t).toBe(i % 2 === 0 ? 1 : 0))
    }
  })

  it('refuses a size the toy does not offer, a taken point and a point off the board', () => {
    expect(status(decide(five({ settings: { size: 12 } }), B, { op: 'accept' }))).toBe(422)
    expect(status(decide(five({ settings: { size: '13' } }), B, { op: 'accept' }))).toBe(422)
    const begun = decide(five({ settings: {} }), B, { op: 'accept' })
    // a challenge that named no size is played on the toy's own 13
    expect(begun.kind === 'begin' && (begun.state as { n: number }).n).toBe(13)
    const row = after(five(), decide(five(), B, { op: 'accept' }))
    const one = after(row, decide(row, A, move(0, 60)))
    expect(status(decide(one, B, move(1, 60)))).toBe(400) // black is already there
    expect(status(decide(one, B, move(1, 121)))).toBe(400) // 11 × 11 ends at 120
    expect(status(decide(one, B, move(1, 61)))).toBe('commit')
  })

  it('refuses a stored game no board could have come from', () => {
    const row = after(five(), decide(five(), B, { op: 'accept' }))
    for (const state of [
      { n: 11, moves: [60, 60] },
      { n: 12, moves: [] },
      { n: 11, moves: [0, 11, 1, 12, 2, 13, 3, 14, 4, 15] }, // a stone after black's five
    ])
      expect(status(decide({ ...row, state }, A, move(0, 5)))).toBe(500)
  })

  it("is the toy's own rules, at the toy's own sizes", () => {
    expect(GAMES.gomoku({ size: 11 })!.rules.fresh('versus')).toEqual(
      gomokuRules(11).fresh('versus'),
    )
    expect(GAMES.gomoku({ size: 9 })).toBeNull()
  })
})

describe('draughts by turns: a move is the whole path its piece takes', () => {
  const dr = (over: Partial<Row> = {}) => invite({ demo_id: 'draughts', settings: {}, ...over })
  const game = (state: unknown) => draughtsReplay((state as { moves: number[][] }).moves)!

  it('plays versus to the end: the loser is the side to move with no move left, or it is a draw', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 16; seed++) {
      const rnd = seeded(seed)
      const { row, plans } = playOut(
        dr(),
        (r) => draughtsChoose(game(r.state).g, seed % 2 ? 'fair' : 'easy', rnd).path,
        600,
      )
      expect(row.status).toBe('finished')
      const last = plans.at(-1)!
      if (last.kind !== 'commit') throw new Error('refused')
      const g = game(last.state).g
      const winner = last.result!.winner
      seen.add(String(winner))
      if (winner === 'draw') continue
      // asked of the board, not of the result: the side to move cannot, and it is the loser
      expect(draughtsMoves(g)).toHaveLength(0)
      expect(winner).toBe(g.turn === 1 ? 1 : 0)
      expect(last.turn).toBeNull()
    }
    // sixteen games won only by one seat would mean the other was never asked about
    expect(seen.has('0') && seen.has('1')).toBe(true)
  })

  it('refuses a step when a take is there, and half of a jump that goes on', () => {
    // play the toy against itself until a take is forced, with a man that could otherwise step
    const rnd = seeded(3)
    let row = after(dr(), decide(dr(), B, { op: 'accept' }))
    let checked = 0
    for (let k = 0; k < 200 && row.status === 'active' && checked < 2; k++) {
      const g = game(row.state).g
      const list = draughtsMoves(g)
      const who = row.turn === 0 ? A : B
      if (list[0]?.taken.length) {
        // a plain step of one of the mover's own pieces into an empty square next to it
        const step = draughtsMoves({
          ...g,
          board: g.board.map((p, i) => (list.some((m) => m.taken.includes(i)) ? 0 : p)),
        }).find((m) => !m.taken.length && owner(g.board[m.path[0]]) === g.turn)
        if (step) {
          expect(status(decide(row, who, move(row.seq, step.path)))).toBe(400)
          checked++
        }
        const long = list.find((m) => m.path.length > 2)
        if (long) expect(status(decide(row, who, move(row.seq, long.path.slice(0, 2))))).toBe(400)
      }
      row = after(row, decide(row, who, move(row.seq, draughtsChoose(g, 'easy', rnd).path)))
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('together: the computer answers in the same call, at every level', () => {
    for (const level of ['easy', 'fair', 'hard']) {
      const rnd = seeded(level.length + 3)
      let row = after(
        dr({ mode: 'together', settings: { level } }),
        decide(dr({ mode: 'together', settings: { level } }), B, { op: 'accept' }),
      )
      for (let k = 0; k < 6 && row.status === 'active'; k++) {
        const p = decide(
          row,
          row.turn === 0 ? A : B,
          move(row.seq, draughtsChoose(game(row.state).g, 'easy', rnd).path),
        )
        expect(p.kind).toBe('commit')
        if (p.kind !== 'commit') break
        if (p.turn !== null) expect(p.move.then).toHaveLength(1)
        row = after(row, p)
      }
    }
  })

  it('refuses a stored game no board could have come from', () => {
    const row = after(dr(), decide(dr(), B, { op: 'accept' }))
    const first = draughtsMoves(draughtsGame())[0].path
    for (const state of [{ moves: [[0, 4]] }, { moves: [first, first] }, { moves: 'none' }])
      expect(status(decide({ ...row, state }, A, move(0, first)))).toBe(500)
    expect(GAMES.draughts({})!.rules).toBe(draughtsRules)
  })
})

describe('dots and boxes by turns: a closed box keeps the turn', () => {
  const db = (over: Partial<Row> = {}) =>
    invite({ demo_id: 'dots', settings: { size: 4 }, ...over })
  const game = (state: unknown) => {
    const o = state as { n: number; lines: number[] }
    return dotsReplay(o.n, o.lines)!
  }

  it('plays versus to the end, the winner whoever owns more boxes on the board', () => {
    const seen = new Set<string>()
    let kept = 0
    for (let seed = 1; seed <= 20; seed++) {
      const rnd = seeded(seed)
      const size = 3 + (seed % 4)
      const { row, plans } = playOut(db({ settings: { size } }), (r) =>
        dotsChoose(game(r.state).g, seed % 2 ? 'fair' : 'easy', rnd),
      )
      expect(row.status).toBe('finished')
      // a line that closes a box leaves the turn with whoever drew it
      let before = after(
        db({ settings: { size } }),
        decide(db({ settings: { size } }), B, { op: 'accept' }),
      )
      for (const p of plans) {
        if (p.kind !== 'commit') throw new Error('refused')
        const boxes = (st: unknown) => game(st).g.owner.filter((o) => o !== -1).length
        if (p.turn !== null && boxes(p.state) > boxes(before.state)) {
          expect(p.turn).toBe(before.turn)
          kept++
        }
        before = after(before, p)
      }
      const last = plans.at(-1)!
      if (last.kind !== 'commit') continue
      // asked of the boxes themselves, not of the running score
      const owned = [0, 1].map((w) => game(last.state).g.owner.filter((o) => o === w).length)
      expect(owned[0] + owned[1]).toBe(size * size)
      const winner = owned[0] > owned[1] ? 0 : owned[1] > owned[0] ? 1 : 'draw'
      expect(last.result).toEqual({ winner, score: `${owned[0]}–${owned[1]}` })
      seen.add(String(winner))
    }
    expect(kept).toBeGreaterThan(0)
    expect(seen.has('0') && seen.has('1')).toBe(true)
  })

  it('together: the computer draws its whole run in the same call, and a friend moves next', () => {
    for (const level of ['easy', 'fair', 'hard']) {
      const rnd = seeded(level.length + 11)
      const start = db({ mode: 'together', settings: { size: 5, level } })
      const { row, plans } = playOut(start, (r) => dotsChoose(game(r.state).g, 'easy', rnd))
      expect(row.status).toBe('finished')
      let longest = 0
      for (const p of plans) {
        if (p.kind !== 'commit') throw new Error('refused')
        expect([0, 1, null]).toContain(p.turn)
        longest = Math.max(longest, p.move.then?.length ?? p.move.replies ?? 0)
      }
      // a run longer than one line is what makes this toy different from the others
      expect(longest).toBeGreaterThan(1)
    }
  })

  it('refuses a size the toy does not offer, a line drawn twice and a line off the board', () => {
    expect(status(decide(db({ settings: { size: 7 } }), B, { op: 'accept' }))).toBe(422)
    expect(status(decide(db({ settings: { size: '4' } }), B, { op: 'accept' }))).toBe(422)
    const begun = decide(db({ settings: {} }), B, { op: 'accept' })
    expect(begun.kind === 'begin' && (begun.state as { n: number }).n).toBe(4)
    const row = after(db(), decide(db(), B, { op: 'accept' }))
    const one = after(row, decide(row, A, move(0, 0)))
    const who = one.turn === 0 ? A : B
    expect(status(decide(one, who, move(1, 0)))).toBe(400)
    expect(status(decide(one, who, move(1, lineCount(game(one.state).g.b))))).toBe(400)
    expect(status(decide(one, who, move(1, 1)))).toBe('commit')
  })

  it('refuses a stored game no board could have come from', () => {
    const row = after(db(), decide(db(), B, { op: 'accept' }))
    for (const state of [
      { n: 4, lines: [3, 3] },
      { n: 7, lines: [] },
      { n: 4, lines: [999] },
    ])
      expect(status(decide({ ...row, state }, A, move(0, 5)))).toBe(500)
  })
})

describe('four in a row by turns', () => {
  const four = (over: Partial<Row> = {}) =>
    invite({ demo_id: 'fourrow', settings: { size: 'classic', need: 4 }, ...over })
  const grid = (state: unknown) => readFourGame(state)!

  it('plays versus to the end on every board, the winner whoever owns the line', () => {
    const seen = new Set<string>()
    const boards = [
      ['small', 4],
      ['classic', 4],
      ['wide', 4],
      ['wide', 5],
    ] as const
    for (let seed = 1; seed <= 24; seed++) {
      const rnd = seeded(seed)
      const [size, need] = boards[seed % 4]
      const { row, plans } = playOut(four({ settings: { size, need } }), (r) => {
        const s = grid(r.state)
        return fourChoose(s.g, s.turn as Who, seed % 3 ? 'easy' : 'fair', rnd)
      })
      expect(row.status).toBe('finished')
      const last = plans.at(-1)!
      if (last.kind !== 'commit') throw new Error('refused')
      const s = grid(last.state)
      if (!s.line) {
        // no line: the grid is full, and that is a draw — not a win stored as one
        expect(s.g.heights.every((h) => h === s.g.rows)).toBe(true)
        expect(last.result!.winner).toBe('draw')
        seen.add('draw')
        continue
      }
      // asked of the discs in the line, never of the stored winner
      const colour = s.g.cells[s.line[0]]
      expect(s.line.length).toBeGreaterThanOrEqual(need)
      expect(s.line.every((i) => s.g.cells[i] === colour)).toBe(true)
      expect(last.result!.winner).toBe(colour === 1 ? 0 : 1)
      seen.add(String(last.result!.winner))
    }
    expect(seen.has('0') && seen.has('1')).toBe(true)
  })

  it('together: the computer drops its disc in the same call, at every level', () => {
    for (const level of ['easy', 'fair', 'hard']) {
      const rnd = seeded(level.length + 5)
      const start = four({ mode: 'together', settings: { size: 'wide', need: 4, level } })
      let row = after(start, decide(start, B, { op: 'accept' }))
      for (let k = 0; k < 6 && row.status === 'active'; k++) {
        const s = grid(row.state)
        const p = decide(
          row,
          row.turn === 0 ? A : B,
          move(row.seq, fourChoose(s.g, 1, 'easy', rnd)),
        )
        expect(p.kind).toBe('commit')
        if (p.kind !== 'commit') break
        if (p.turn !== null) {
          expect(p.move.then).toHaveLength(1)
          expect(p.turn).toBe(row.turn === 0 ? 1 : 0)
        }
        row = after(row, p)
      }
    }
  })

  it('reads the toy’s boards and only those, classic and four when none is named', () => {
    for (const settings of [
      { size: 'small', need: 5 },
      { size: 'huge' },
      { need: 3 },
      { size: 7 },
      { size: 'toString' },
    ])
      expect(status(decide(four({ settings }), B, { op: 'accept' }))).toBe(422)
    const begun = decide(four({ settings: {} }), B, { op: 'accept' })
    expect(begun.kind === 'begin' && grid(begun.state).g.cols).toBe(7)
    expect(begun.kind === 'begin' && grid(begun.state).g.need).toBe(4)
  })

  it('refuses a full column and one off the grid', () => {
    let row = after(
      four({ settings: { size: 'small' } }),
      decide(four({ settings: { size: 'small' } }), B, { op: 'accept' }),
    )
    // five discs in column 0 of a five-row grid, alternating so nobody makes a line
    for (const c of [0, 0, 0, 0, 0])
      row = after(row, decide(row, row.turn === 0 ? A : B, move(row.seq, c)))
    const who = row.turn === 0 ? A : B
    expect(status(decide(row, who, move(row.seq, 0)))).toBe(400)
    expect(status(decide(row, who, move(row.seq, 6)))).toBe(400)
    expect(status(decide(row, who, move(row.seq, 1)))).toBe('commit')
  })

  it('refuses a stored grid that could not have been played', () => {
    const row = after(four(), decide(four(), B, { op: 'accept' }))
    const s = row.state as Record<string, unknown>
    const cells = (s.cells as number[]).slice()
    cells[7] = 1 // a disc floating over an empty square
    expect(status(decide({ ...row, state: { ...s, cells, moves: 1 } }, A, move(0, 3)))).toBe(500)
  })

  it('leaves the call’s room as it was: versus only, as the toy’s call table was written for', () => {
    expect(fourRowRules('classic', 4).modes).toBeUndefined()
    expect(fourRowMatchRules('classic', 4).modes).toEqual(['versus', 'together'])
  })
})

describe('mancala by turns: sowing into your own store keeps the turn', () => {
  const mancala = (over: Partial<Row> = {}) => invite({ demo_id: 'mancala', settings: {}, ...over })
  /** the game a stored state makes, read the toy's own way, never through the room's decode */
  const game = (state: unknown) => {
    const o = state as { pits: number; seeds: number; captures: boolean; sown: number[] }
    return mancalaReplay({ pits: o.pits, seeds: o.seeds, captures: o.captures }, o.sown)!
  }

  it('plays versus to the end on every board, the winner whoever has the fuller store', () => {
    const seen = new Set<string>()
    const boards = [{}, { pits: 4, seeds: 3 }, { pits: 5, seeds: 6, captures: false }] as const
    for (let seed = 1; seed <= 18; seed++) {
      const rnd = seeded(seed)
      const settings = boards[seed % 3]
      const { row, plans } = playOut(mancala({ settings }), (r) => {
        const g = game(r.state)
        const list = mancalaLegal(g.b, g.turn!)
        return list[Math.floor(rnd() * list.length)]
      })
      expect(row.status).toBe('finished')
      const last = plans.at(-1)!
      if (last.kind !== 'commit') throw new Error('refused')
      const b = game(last.state).b
      // asked of the seeds in the two stores, which hold every seed once the game is over
      const [a, c] = [b[storeOf(b, 0)], b[storeOf(b, 1)]]
      expect(a + c).toBe(total(b))
      expect(last.result!.winner).toBe(a > c ? 0 : c > a ? 1 : 'draw')
      expect(last.result!.score).toBe(stores(b).join('–'))
      seen.add(String(last.result!.winner))
    }
    expect(seen.has('0') && seen.has('1')).toBe(true)
  })

  it('keeps the turn after a sowing that ends in your own store', () => {
    let row = after(mancala(), decide(mancala(), B, { op: 'accept' }))
    // six pits of four: pit 2 drops its last seed in seat 0's store (pit 6), so it goes again
    const p = decide(row, A, move(row.seq, 2))
    expect(p.kind === 'commit' && p.turn).toBe(0)
    row = after(row, p)
    expect(status(decide(row, B, move(row.seq, 7)))).toBe(409)
    expect(status(decide(row, A, move(row.seq, 0)))).toBe('commit')
  })

  it('together: the computer sows in the same call, every go-again of it, at every level', () => {
    for (const level of ['easy', 'fair', 'hard']) {
      const rnd = seeded(level.length + 11)
      const start = mancala({ mode: 'together', settings: { level } })
      let row = after(start, decide(start, B, { op: 'accept' }))
      let replies = 0
      for (let k = 0; k < 8 && row.status === 'active'; k++) {
        const g = game(row.state)
        const list = mancalaLegal(g.b, 0)
        const p = decide(
          row,
          row.turn === 0 ? A : B,
          move(row.seq, list[Math.floor(rnd() * list.length)]),
        )
        expect(p.kind).toBe('commit')
        if (p.kind !== 'commit') break
        replies += p.move.then?.length ?? 0
        if (p.turn !== null) expect(game(p.state).turn).toBe(0)
        row = after(row, p)
      }
      expect(replies).toBeGreaterThan(0)
    }
  })

  it('reads the toy’s pits, seeds and captures and only those, its defaults when none are named', () => {
    for (const settings of [
      { pits: 7 },
      { pits: '6' },
      { seeds: 2 },
      { captures: 'yes' },
      { seeds: 7 },
    ])
      expect(status(decide(mancala({ settings }), B, { op: 'accept' }))).toBe(422)
    const begun = decide(mancala({ settings: {} }), B, { op: 'accept' })
    expect(begun.kind === 'begin' && begun.state).toEqual({
      pits: 6,
      seeds: 4,
      captures: true,
      sown: [],
    })
  })

  it('refuses an empty pit, the other side’s pit, and a pit off the board', () => {
    let row = after(mancala(), decide(mancala(), B, { op: 'accept' }))
    row = after(row, decide(row, A, move(row.seq, 0)))
    // seat 0 sowed pit 0, so it is empty; it is seat 1's turn now
    const who = row.turn === 0 ? A : B
    expect(row.turn).toBe(1)
    expect(status(decide(row, who, move(row.seq, 0)))).toBe(400)
    expect(status(decide(row, who, move(row.seq, 3)))).toBe(400)
    expect(status(decide(row, who, move(row.seq, 14)))).toBe(400)
    expect(status(decide(row, who, move(row.seq, 9)))).toBe('commit')
  })

  it('refuses a stored game that could not have been sown', () => {
    const row = after(mancala(), decide(mancala(), B, { op: 'accept' }))
    expect(
      status(
        decide({ ...row, state: { pits: 6, seeds: 4, captures: true, sown: [8] } }, A, move(0, 0)),
      ),
    ).toBe(500)
    expect(
      status(
        decide({ ...row, state: { pits: 9, seeds: 4, captures: true, sown: [] } }, A, move(0, 0)),
      ),
    ).toBe(500)
  })

  it('plays the same rules the call room and the toy do', () => {
    expect(mancalaRules({ pits: 6, seeds: 4, captures: true }).modes).toEqual([
      'versus',
      'together',
    ])
    expect(typeof mancalaChoose).toBe('function')
  })
})

describe('nine men’s morris by turns: a mill must take', () => {
  const morris = (over: Partial<Row> = {}) => invite({ demo_id: 'morris', settings: {}, ...over })
  /** the game a stored state makes, replayed the toy's own way */
  const game = (state: unknown) => morrisReplay((state as { moves: unknown[] }).moves)!.g
  const wire = (m: MorrisMove) => [m.from, m.to, m.take]

  it('plays versus to the end, the winner whoever left the other two men or no move', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 12; seed++) {
      const rnd = seeded(seed)
      const { row, plans } = playOut(
        morris(),
        (r) => {
          const list = morrisMoves(game(r.state))
          return wire(list[Math.floor(rnd() * list.length)])
        },
        1000,
      )
      expect(row.status).toBe('finished')
      const last = plans.at(-1)!
      if (last.kind !== 'commit') throw new Error('refused')
      const g = game(last.state)
      if (last.result!.winner === 'draw') {
        expect(g.winner).toBe(3)
        seen.add('draw')
        continue
      }
      // asked of the board: the loser is down to two men, or has no move where it stands
      const loser = last.result!.winner === 0 ? 2 : 1
      const stuck = menOf(g, loser) < 3 || !morrisMoves({ ...g, turn: loser, winner: 0 }).length
      expect(stuck).toBe(true)
      seen.add(String(last.result!.winner))
    }
    expect(seen.size).toBeGreaterThan(1)
  })

  it('refuses a mill that does not take, and a man taken from a mill while another is free', () => {
    let row = after(morris(), decide(morris(), B, { op: 'accept' }))
    // the first colour places 0, 1 and then 2 for a mill along the top; the second places away
    for (const [who, to] of [
      [A, 0],
      [B, 9],
      [A, 1],
      [B, 21],
    ] as const)
      row = after(row, decide(row, who, move(row.seq, [-1, to, -1])))
    expect(status(decide(row, A, move(row.seq, [-1, 2, -1])))).toBe(400)
    expect(status(decide(row, A, move(row.seq, [-1, 2, 9])))).toBe('commit')
  })

  it('together: the computer answers in the same call, at every level', () => {
    for (const level of ['easy', 'fair', 'hard']) {
      const rnd = seeded(level.length + 3)
      const start = morris({ mode: 'together', settings: { level } })
      let row = after(start, decide(start, B, { op: 'accept' }))
      for (let k = 0; k < 6 && row.status === 'active'; k++) {
        const list = morrisMoves(game(row.state))
        const p = decide(
          row,
          row.turn === 0 ? A : B,
          move(row.seq, wire(list[Math.floor(rnd() * list.length)])),
        )
        expect(p.kind).toBe('commit')
        if (p.kind !== 'commit') break
        if (p.turn !== null) expect(p.move.then).toHaveLength(1)
        row = after(row, p)
      }
    }
  })

  it('refuses a move off the board, onto a man, and a stored game no moves could have made', () => {
    let row = after(morris(), decide(morris(), B, { op: 'accept' }))
    row = after(row, decide(row, A, move(row.seq, [-1, 4, -1])))
    expect(status(decide(row, B, move(row.seq, [-1, 4, -1])))).toBe(400)
    expect(status(decide(row, B, move(row.seq, [-1, 24, -1])))).toBe(400)
    expect(status(decide(row, B, move(row.seq, { from: -1, to: 5, take: -1 })))).toBe('commit')
    expect(
      status(
        decide(
          {
            ...row,
            state: {
              moves: [
                [-1, 4, -1],
                [-1, 4, -1],
              ],
            },
          },
          B,
          move(row.seq, [-1, 6, -1]),
        ),
      ),
    ).toBe(500)
  })
})

describe('hex by turns: a stone a turn, and the swap rule when asked for', () => {
  const hex = (over: Partial<Row> = {}) => invite({ demo_id: 'hex', settings: {}, ...over })
  const game = (state: unknown) => {
    const o = state as { n: number; swap: boolean; moves: unknown[] }
    return hexReplay(o.n, o.swap, o.moves)!
  }

  it('plays versus to the end on every board, the winner whoever joins their two sides', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 12; seed++) {
      const rnd = seeded(seed)
      const size = [7, 9, 11][seed % 3]
      const { row, plans } = playOut(hex({ settings: { size } }), (r) => {
        const b = game(r.state).b
        const open = b.cells.flatMap((c, i) => (c ? [] : [i]))
        return open[Math.floor(rnd() * open.length)]
      })
      expect(row.status).toBe('finished')
      const last = plans.at(-1)!
      if (last.kind !== 'commit') throw new Error('refused')
      const b = game(last.state).b
      expect(b.n).toBe(size)
      // asked of the stones: red joins top to bottom, blue left to right; Hex has no draw
      const red = hexChain(b.cells, b.n, 1)
      const blue = hexChain(b.cells, b.n, 2)
      expect(!!red !== !!blue).toBe(true)
      expect(last.result!.winner).toBe(red ? 0 : 1)
      seen.add(String(last.result!.winner))
    }
    expect(seen.has('0') && seen.has('1')).toBe(true)
  })

  it('takes the swap as the second move only, and only when the match asked for the rule', () => {
    const on = hex({ settings: { swap: true } })
    let row = after(on, decide(on, B, { op: 'accept' }))
    row = after(row, decide(row, A, move(row.seq, 40)))
    expect(status(decide(row, B, move(row.seq, SWAP)))).toBe('commit')
    row = after(row, decide(row, B, move(row.seq, SWAP)))
    expect(status(decide(row, A, move(row.seq, SWAP)))).toBe(400)
    const off = hex()
    let r2 = after(off, decide(off, B, { op: 'accept' }))
    r2 = after(r2, decide(r2, A, move(r2.seq, 40)))
    expect(status(decide(r2, B, move(r2.seq, SWAP)))).toBe(400)
  })

  it('together: the computer answers in the same call, at every level', () => {
    for (const level of ['easy', 'fair', 'hard']) {
      const start = hex({ mode: 'together', settings: { size: 11, level } })
      let row = after(start, decide(start, B, { op: 'accept' }))
      for (let k = 0; k < 3 && row.status === 'active'; k++) {
        const b = game(row.state).b
        const p = decide(row, row.turn === 0 ? A : B, move(row.seq, b.cells.indexOf(0)))
        expect(p.kind).toBe('commit')
        if (p.kind !== 'commit') break
        expect(p.move.then).toHaveLength(1)
        row = after(row, p)
      }
    }
  }, 30000)

  it('reads the toy’s sizes and the swap rule and only those, 9 without it when none is named', () => {
    for (const settings of [{ size: 8 }, { size: '9' }, { swap: 'yes' }, { size: 13 }])
      expect(status(decide(hex({ settings }), B, { op: 'accept' }))).toBe(422)
    const begun = decide(hex({ settings: {} }), B, { op: 'accept' })
    expect(begun.kind === 'begin' && begun.state).toEqual({ n: 9, swap: false, moves: [] })
  })

  it('refuses a taken cell, a cell off the board, and a stored game no stones could have made', () => {
    let row = after(
      hex({ settings: { size: 7 } }),
      decide(hex({ settings: { size: 7 } }), B, { op: 'accept' }),
    )
    row = after(row, decide(row, A, move(row.seq, 10)))
    expect(status(decide(row, B, move(row.seq, 10)))).toBe(400)
    expect(status(decide(row, B, move(row.seq, 49)))).toBe(400)
    expect(status(decide(row, B, move(row.seq, 11)))).toBe('commit')
    expect(
      status(
        decide({ ...row, state: { n: 7, swap: false, moves: [10, 10] } }, B, move(row.seq, 12)),
      ),
    ).toBe(500)
  })
})

describe('ultimate noughts by turns: your square sends them to its board', () => {
  const ult = (over: Partial<Row> = {}) => invite({ demo_id: 'ultimate', settings: {}, ...over })
  const game = (state: unknown) => ultReplay((state as { moves: unknown[] }).moves)!.g

  it('plays versus to the end, the winner whoever holds three small boards in a line', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 16; seed++) {
      const rnd = seeded(seed)
      const { row, plans } = playOut(ult(), (r) => {
        const list = ultMoves(game(r.state))
        return list[Math.floor(rnd() * list.length)]
      })
      expect(row.status).toBe('finished')
      const last = plans.at(-1)!
      if (last.kind !== 'commit') throw new Error('refused')
      const g = game(last.state)
      // asked of the small boards: a line of them held by one mark, or none and a draw
      const held = (w: number) => ULT_LINES.some((l) => l.every((b) => g.boards[b] === w))
      if (last.result!.winner === 'draw') {
        expect(held(1) || held(2)).toBe(false)
        seen.add('draw')
        continue
      }
      expect(held(last.result!.winner === 0 ? 1 : 2)).toBe(true)
      seen.add(String(last.result!.winner))
    }
    expect(seen.has('0') && seen.has('1')).toBe(true)
  })

  it('sends the next player to the board that matches the square', () => {
    let row = after(ult(), decide(ult(), B, { op: 'accept' }))
    // the middle square of the top-left board sends the second mark to the middle board (4)
    row = after(row, decide(row, A, move(row.seq, 4)))
    expect(status(decide(row, B, move(row.seq, 0)))).toBe(400)
    expect(status(decide(row, B, move(row.seq, 36)))).toBe('commit')
  })

  it('together: the computer answers in the same call, at every level', () => {
    for (const level of ['easy', 'fair', 'hard']) {
      const start = ult({ mode: 'together', settings: { level } })
      let row = after(start, decide(start, B, { op: 'accept' }))
      for (let k = 0; k < 3 && row.status === 'active'; k++) {
        const p = decide(row, row.turn === 0 ? A : B, move(row.seq, ultMoves(game(row.state))[0]))
        expect(p.kind).toBe('commit')
        if (p.kind !== 'commit') break
        expect(p.move.then).toHaveLength(1)
        row = after(row, p)
      }
    }
  }, 30000)

  it('refuses a taken square, one off the board, and a stored game no squares could have made', () => {
    let row = after(ult(), decide(ult(), B, { op: 'accept' }))
    row = after(row, decide(row, A, move(row.seq, 40)))
    expect(status(decide(row, B, move(row.seq, 40)))).toBe(400)
    expect(status(decide(row, B, move(row.seq, 81)))).toBe(400)
    expect(status(decide({ ...row, state: { moves: [40, 40] } }, B, move(row.seq, 36)))).toBe(500)
  })
})

describe('breakthrough by turns: first through to the far row', () => {
  const bt = (over: Partial<Row> = {}) => invite({ demo_id: 'breakthrough', settings: {}, ...over })
  const game = (state: unknown) => {
    const o = state as { n: number; moves: unknown[] }
    return btReplay(o.n, o.moves)!.g
  }

  it('plays versus to the end on both boards, the winner whoever broke through or took every man', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 12; seed++) {
      const rnd = seeded(seed)
      const size = seed % 2 ? 6 : 8
      const { row, plans } = playOut(bt({ settings: { size } }), (r) => {
        const list = btMoves(game(r.state))
        const m = list[Math.floor(rnd() * list.length)]
        return [m.from, m.to]
      })
      expect(row.status).toBe('finished')
      const last = plans.at(-1)!
      if (last.kind !== 'commit') throw new Error('refused')
      const { board } = game(last.state)
      expect(board.n).toBe(size)
      // asked of the board: the first side (1) heads for row 0, the second (2) for the last row
      const n = board.n
      const at = (side: number) =>
        Array.from(board.cells).flatMap((c, i) => (c === side ? [i] : []))
      const through = (side: number) =>
        at(side).some((i) => (side === 1 ? i < n : i >= n * (n - 1))) ||
        at(side === 1 ? 2 : 1).length === 0
      const w = last.result!.winner
      expect(through(w === 0 ? 1 : 2)).toBe(true)
      expect(through(w === 0 ? 2 : 1)).toBe(false)
      seen.add(String(w))
    }
    expect(seen.has('0') && seen.has('1')).toBe(true)
  })

  it('together: the computer answers in the same call, at every level', () => {
    for (const level of ['easy', 'fair', 'hard']) {
      const start = bt({ mode: 'together', settings: { level } })
      let row = after(start, decide(start, B, { op: 'accept' }))
      for (let k = 0; k < 3 && row.status === 'active'; k++) {
        const m = btMoves(game(row.state))[0]
        const p = decide(row, row.turn === 0 ? A : B, move(row.seq, [m.from, m.to]))
        expect(p.kind).toBe('commit')
        if (p.kind !== 'commit') break
        expect(p.move.then).toHaveLength(1)
        row = after(row, p)
      }
    }
  }, 30000)

  it('reads the toy’s boards and only those, 8 when none is named', () => {
    for (const settings of [{ size: 7 }, { size: '8' }, { size: 10 }])
      expect(status(decide(bt({ settings }), B, { op: 'accept' }))).toBe(422)
    const begun = decide(bt(), B, { op: 'accept' })
    expect(begun.kind === 'begin' && begun.state).toEqual({ n: 8, moves: [] })
  })

  it('refuses a man moved backwards, onto its own side, and a stored game no moves could make', () => {
    const row = after(
      bt({ settings: { size: 6 } }),
      decide(bt({ settings: { size: 6 } }), B, { op: 'accept' }),
    )
    const g = game(row.state)
    const mine = Array.from(g.board.cells).findIndex((c, i) => c === 1 && i < 30 && i >= 24)
    // a man of the first side on the near row: straight back off the board, and onto its fellow
    expect(status(decide(row, A, move(row.seq, [mine, mine + 6])))).toBe(400)
    expect(status(decide(row, A, move(row.seq, [mine, mine + 1])))).toBe(400)
    const ok = btMoves(g)[0]
    expect(status(decide(row, A, move(row.seq, [ok.from, ok.to])))).toBe('commit')
    expect(
      status(
        decide({ ...row, state: { n: 6, moves: [[0, 0]] } }, A, move(row.seq, [ok.from, ok.to])),
      ),
    ).toBe(500)
  })
})

describe('fences by turns: a step or a fence, and no fence that shuts a side in', () => {
  const fences = (over: Partial<Row> = {}) => invite({ demo_id: 'fences', settings: {}, ...over })
  const game = (state: unknown) => {
    const o = state as { n: number; moves: unknown[] }
    return fencesReplay(o.n, o.moves)!.g
  }

  it('plays versus to the end on both boards, the winner whoever reached their far row', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 10; seed++) {
      const rnd = seeded(seed)
      const size = seed % 2 ? 7 : 9
      const { row, plans } = playOut(fences({ settings: { size } }), (r) =>
        packFence(fencesChoose(game(r.state), seed % 3 ? 'easy' : 'fair', rnd)),
      )
      expect(row.status).toBe('finished')
      const last = plans.at(-1)!
      if (last.kind !== 'commit') throw new Error('refused')
      const g = game(last.state)
      expect(g.n).toBe(size)
      // asked of where the two stand: the winner on its goal row, the other not
      const w = last.result!.winner as 0 | 1
      expect(g.pos[w][0]).toBe(goalRow(g, w))
      expect(g.pos[w === 0 ? 1 : 0][0]).not.toBe(goalRow(g, w === 0 ? 1 : 0))
      seen.add(String(w))
    }
    expect(seen.has('0') && seen.has('1')).toBe(true)
  })

  it('refuses a fence across another, and keeps every side a way through', () => {
    let row = after(
      fences({ settings: { size: 7 } }),
      decide(fences({ settings: { size: 7 } }), B, { op: 'accept' }),
    )
    row = after(row, decide(row, A, move(row.seq, ['h', 2, 2])))
    // the same groove crossing, standing: two fences cannot cross
    expect(status(decide(row, B, move(row.seq, ['v', 2, 2])))).toBe(400)
    expect(status(decide(row, B, move(row.seq, ['h', 2, 2])))).toBe(400)
    const p = decide(row, B, move(row.seq, ['h', 4, 0]))
    expect(p.kind).toBe('commit')
    if (p.kind === 'commit') {
      const g = game(p.state)
      expect(Number.isFinite(fencesDist(g, 0)) && Number.isFinite(fencesDist(g, 1))).toBe(true)
    }
  })

  it('together: the computer answers in the same call, at every level', () => {
    for (const level of ['easy', 'fair', 'hard']) {
      const start = fences({ mode: 'together', settings: { level } })
      let row = after(start, decide(start, B, { op: 'accept' }))
      for (let k = 0; k < 3 && row.status === 'active'; k++) {
        const m = packFence(fencesChoose(game(row.state), 'easy', seeded(k + 1)))
        const p = decide(row, row.turn === 0 ? A : B, move(row.seq, m))
        expect(p.kind).toBe('commit')
        if (p.kind !== 'commit') break
        expect(p.move.then).toHaveLength(1)
        row = after(row, p)
      }
    }
  }, 30000)

  it('reads the toy’s boards and only those, 9 when none is named', () => {
    for (const settings of [{ size: 8 }, { size: '9' }, { size: 11 }])
      expect(status(decide(fences({ settings }), B, { op: 'accept' }))).toBe(422)
    const begun = decide(fences(), B, { op: 'accept' })
    expect(begun.kind === 'begin' && begun.state).toEqual({ n: 9, moves: [] })
  })

  it('refuses a step of two squares, one off the board, and a stored game no moves could make', () => {
    const row = after(fences(), decide(fences(), B, { op: 'accept' }))
    const g = game(row.state)
    const [r, c] = g.pos[0]
    expect(status(decide(row, A, move(row.seq, ['s', r - 2, c])))).toBe(400)
    expect(status(decide(row, A, move(row.seq, ['s', r, 9])))).toBe(400)
    expect(status(decide(row, A, move(row.seq, ['s', r - 1, c])))).toBe('commit')
    expect(
      status(
        decide(
          { ...row, state: { n: 9, moves: [['s', 0, 0]] } },
          A,
          move(row.seq, ['s', r - 1, c]),
        ),
      ),
    ).toBe(500)
  })
})

describe('chinese checkers by turns: a peg and where it lands', () => {
  const hm = (over: Partial<Row> = {}) => invite({ demo_id: 'halma', settings: {}, ...over })
  const game = (state: unknown) => halmaReplay((state as { moves: unknown[] }).moves)!.g

  it('plays versus to the end, the winner whoever filled the far point, or a draw at the cap', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 8; seed++) {
      const rnd = seeded(seed)
      // mostly sensible moves so a game ends, with enough chance in it that no two are alike;
      // the last seed wanders at random, which is the game the cap is there for
      const wander = seed === 8
      const { row, plans } = playOut(
        hm(),
        (r) => {
          const g = game(r.state)
          const list = halmaMoves(g)
          const m =
            !wander && rnd() < 0.85
              ? halmaChoose(g, 'fair', rnd)
              : list[Math.floor(rnd() * list.length)]
          return [m.from, m.to]
        },
        HALMA_DRAW + 1,
      )
      expect(row.status).toBe('finished')
      const last = plans.at(-1)!
      if (last.kind !== 'commit') throw new Error('refused')
      const g = game(last.state)
      // asked of the board: the winner's pegs fill the far point, and the loser's do not
      if (last.result!.winner === 'draw') {
        expect(halmaWon(g.cells, 1) || halmaWon(g.cells, 2)).toBe(false)
        expect(plans.length).toBe(HALMA_DRAW)
        seen.add('draw')
        continue
      }
      const side = last.result!.winner === 0 ? 1 : 2
      expect(halmaWon(g.cells, side)).toBe(true)
      expect(halmaWon(g.cells, side === 1 ? 2 : 1)).toBe(false)
      seen.add(String(last.result!.winner))
    }
    expect(seen.has('0') && seen.has('1') && seen.has('draw')).toBe(true)
  }, 60000)

  it('takes a chain of hops as one move, named by where it lands', () => {
    let row = after(hm(), decide(hm(), B, { op: 'accept' }))
    // 115 hops over 111's row to 102: a jump, not a step, and the board knows the way
    row = after(row, decide(row, A, move(row.seq, [115, 102])))
    expect(game(row.state).cells[102]).toBe(1)
    expect(game(row.state).cells[115]).toBe(0)
  })

  it('together: the computer answers in the same call, at every level', () => {
    for (const level of ['easy', 'fair', 'hard']) {
      const start = hm({ mode: 'together', settings: { level } })
      let row = after(start, decide(start, B, { op: 'accept' }))
      for (let k = 0; k < 3 && row.status === 'active'; k++) {
        const m = halmaMoves(game(row.state))[0]
        const p = decide(row, row.turn === 0 ? A : B, move(row.seq, [m.from, m.to]))
        expect(p.kind).toBe('commit')
        if (p.kind !== 'commit') break
        expect(p.move.then).toHaveLength(1)
        row = after(row, p)
      }
    }
  }, 30000)

  it('refuses a landing no step or hop reaches, one off the board, an empty hole and the other side’s peg', () => {
    const row = after(hm(), decide(hm(), B, { op: 'accept' }))
    expect(status(decide(row, A, move(row.seq, [111, 93])))).toBe(400)
    expect(status(decide(row, A, move(row.seq, [111, 121])))).toBe(400)
    expect(status(decide(row, A, move(row.seq, [102, 93])))).toBe(400)
    expect(status(decide(row, A, move(row.seq, [0, 10])))).toBe(400)
    expect(
      status(decide({ ...row, state: { moves: [[111, 93]] } }, A, move(row.seq, [111, 102]))),
    ).toBe(500)
  })
})

describe('go by turns: a point or a pass, two passes end it', () => {
  const go = (over: Partial<Row> = {}) => invite({ demo_id: 'go', settings: {}, ...over })
  const game = (state: unknown) => goReplay((state as { moves: unknown[] }).moves)!.g
  /**
   * Area by colour, counted here rather than by goboard.ts's own score: a stone is its colour's,
   * and an empty point is whoever's stones are all that an empty walk from it ever meets.
   */
  const area = (board: readonly number[]) => {
    const got = [0, 0, 0]
    for (let i = 0; i < board.length; i++) {
      if (board[i]) {
        got[board[i]]++
        continue
      }
      const meets = new Set<number>()
      const seen = new Set([i])
      const todo = [i]
      while (todo.length) {
        const p = todo.pop()!
        const [r, c] = [Math.floor(p / GO_N), p % GO_N]
        for (const [dr, dc] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const [rr, cc] = [r + dr, c + dc]
          if (rr < 0 || cc < 0 || rr >= GO_N || cc >= GO_N) continue
          const q = rr * GO_N + cc
          if (board[q]) meets.add(board[q])
          else if (!seen.has(q)) {
            seen.add(q)
            todo.push(q)
          }
        }
      }
      if (meets.size === 1) got[[...meets][0]]++
    }
    return { black: got[1], white: got[2] + KOMI }
  }

  it('plays versus to the end, the winner whoever holds more of the board after komi', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 10; seed++) {
      const rnd = seeded(seed)
      const { row, plans } = playOut(
        go(),
        (r) => {
          const g = game(r.state)
          const list = goLegal(g)
          return !list.length || rnd() < 0.08 ? PASS : list[Math.floor(rnd() * list.length)]
        },
        GO_MAX + 1,
      )
      expect(row.status).toBe('finished')
      const last = plans.at(-1)!
      if (last.kind !== 'commit') throw new Error('refused')
      const g = game(last.state)
      const a = area(g.board)
      expect(last.result!.winner).toBe(a.black > a.white ? 0 : 1)
      expect(last.result!.score).toBe(`${a.black}–${a.white}`)
      seen.add(String(last.result!.winner))
    }
    expect(seen.has('0') && seen.has('1')).toBe(true)
  }, 60000)

  it('ends at two passes in a row, and an empty board is white’s by its komi', () => {
    let row = after(go(), decide(go(), B, { op: 'accept' }))
    row = after(row, decide(row, A, move(row.seq, PASS)))
    expect(row.status).toBe('active')
    const p = decide(row, B, move(row.seq, PASS))
    if (p.kind !== 'commit') throw new Error('refused')
    expect(after(row, p).status).toBe('finished')
    expect(p.result).toEqual({ winner: 1, score: `0–${KOMI}` })
  })

  it('together: the computer answers in the same call, at every level', () => {
    for (const level of ['easy', 'fair', 'hard']) {
      const start = go({ mode: 'together', settings: { level } })
      let row = after(start, decide(start, B, { op: 'accept' }))
      for (const at of [40, 20, 60]) {
        if (row.status !== 'active') break
        const g = game(row.state)
        const p = decide(
          row,
          row.turn === 0 ? A : B,
          move(row.seq, g.board[at] ? goLegal(g)[0] : at),
        )
        expect(p.kind).toBe('commit')
        if (p.kind !== 'commit') break
        expect(p.move.then).toHaveLength(1)
        row = after(row, p)
      }
    }
  }, 30000)

  it('refuses a taken point, one off the board, a move that is not a point, and a stored game no moves could make', () => {
    let row = after(go(), decide(go(), B, { op: 'accept' }))
    row = after(row, decide(row, A, move(row.seq, 40)))
    expect(status(decide(row, B, move(row.seq, 40)))).toBe(400)
    expect(status(decide(row, B, move(row.seq, 81)))).toBe(400)
    expect(status(decide(row, B, move(row.seq, -2)))).toBe(400)
    expect(status(decide(row, B, move(row.seq, 4.5)))).toBe(400)
    expect(status(decide({ ...row, state: { moves: [40, 40] } }, B, move(row.seq, 41)))).toBe(500)
  })
})

describe('fox and geese by turns: the challenger picks a side, the geese unless they say', () => {
  const fx = (over: Partial<Row> = {}) => invite({ demo_id: 'fox', settings: {}, ...over })
  const game = (state: unknown) => foxReplay((state as { moves: unknown[] }).moves)!.g

  it('plays versus to the end, the fox winning on six geese gone or the geese stuck, the geese on a trapped fox', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 12; seed++) {
      const rnd = seeded(seed)
      // geese that mostly think and a fox that mostly wanders, so both sides win some
      const { row, plans } = playOut(fx(), (r) => {
        const g = game(r.state)
        const list = foxMovesFor(g)
        const think = g.turn === 'geese' ? rnd() < 0.9 : rnd() < 0.2
        return (think ? foxChoose(g, 'fair', rnd) : list[Math.floor(rnd() * list.length)]).path
      })
      expect(row.status).toBe('finished')
      const last = plans.at(-1)!
      if (last.kind !== 'commit') throw new Error('refused')
      const g = game(last.state)
      if (last.result!.winner === 'draw') {
        seen.add('draw')
        continue
      }
      // asked of the board: geese counted on it, and who can still move
      const gone = START_GEESE.length - g.geese.size
      if (last.result!.winner === 1)
        expect(gone >= TAKE_TO_WIN || g.idle >= IDLE_LIMIT || gooseMoves(g).length === 0).toBe(true)
      else {
        expect(gone).toBeLessThan(TAKE_TO_WIN)
        expect(foxMoves(g)).toHaveLength(0)
      }
      seen.add(String(last.result!.winner))
    }
    expect(seen.has('0') && seen.has('1')).toBe(true)
  }, 60000)

  it('takes a fox’s run of jumps as one move, every goose it passes over gone', () => {
    let row = after(fx(), decide(fx(), B, { op: 'accept' }))
    // two geese step into line with the fox, which runs 32 over 24 to 16, then over 23 to 30
    for (const [who, path] of [
      [A, [16, 23]],
      [B, [24, 32]],
      [A, [17, 24]],
    ] as const)
      row = after(row, decide(row, who, move(row.seq, path)))
    const before = game(row.state).geese.size
    const p = decide(row, B, move(row.seq, [32, 16, 30]))
    expect(p.kind).toBe('commit')
    row = after(row, p)
    const g = game(row.state)
    expect(g.geese.size).toBe(before - 2)
    expect(g.geese.has(24) || g.geese.has(23)).toBe(false)
    expect(g.fox).toBe(30)
    // stopping halfway is a move of its own, and a different one: the path names the run
    expect(
      game({
        moves: [
          [16, 23],
          [24, 32],
          [17, 24],
          [32, 16],
        ],
      }).geese.has(23),
    ).toBe(true)
  })

  it('together: the computer is the fox, answering in the same call, at every level', () => {
    for (const level of ['easy', 'fair', 'hard']) {
      const start = fx({ mode: 'together', settings: { level } })
      let row = after(start, decide(start, B, { op: 'accept' }))
      for (let k = 0; k < 3 && row.status === 'active'; k++) {
        const g = game(row.state)
        expect(g.turn).toBe('geese')
        const p = decide(row, row.turn === 0 ? A : B, move(row.seq, foxMovesFor(g)[0].path))
        expect(p.kind).toBe('commit')
        if (p.kind !== 'commit') break
        expect(p.move.then).toHaveLength(1)
        row = after(row, p)
      }
    }
  }, 30000)

  it('a challenger who picks the fox: the friend herds the geese and moves first, and wins and losses go to the seat that played them', () => {
    const start = fx({ settings: { side: 'fox' } })
    const begun = decide(start, B, { op: 'accept' })
    // the board is the same fresh game; only who moves on it first changes
    expect(begun).toEqual({ kind: 'begin', state: { moves: [] }, turn: 1 })
    let row = after(start, begun)
    expect(status(decide(row, A, move(row.seq, [24, 23])))).toBe(409)
    // the friend moves a goose; the challenger cannot move one, only the fox
    row = after(row, decide(row, B, move(row.seq, [22, 29])))
    expect(row.turn).toBe(0)
    expect(status(decide(row, A, move(row.seq, [16, 23])))).toBe(400)
    expect(decide(row, A, move(row.seq, [24, 23])).kind).toBe('commit')

    const seen = new Set<string>()
    for (let seed = 1; seed <= 12; seed++) {
      const rnd = seeded(seed)
      const { row: end, plans } = playOut(fx({ settings: { side: 'fox' } }), (r, who) => {
        const g = game(r.state)
        // asked of the board, never of the seat: whoever moves must be playing the side to move
        expect(who === A ? 'fox' : 'geese').toBe(g.turn)
        const list = foxMovesFor(g)
        const think = g.turn === 'geese' ? rnd() < 0.9 : rnd() < 0.2
        return (think ? foxChoose(g, 'fair', rnd) : list[Math.floor(rnd() * list.length)]).path
      })
      expect(end.status).toBe('finished')
      const last = plans.at(-1)!
      if (last.kind !== 'commit') throw new Error('refused')
      const winner = last.result!.winner
      seen.add(String(winner))
      if (winner === 'draw') continue
      // the fox is seat 0 here: a fox with nowhere to go is the challenger's loss
      expect(foxMoves(game(last.state)).length === 0).toBe(winner === 1)
    }
    expect(seen.has('0') && seen.has('1')).toBe(true)
  }, 60000)

  it('reads the side from the settings and nothing else: the geese by default, the fox when asked, versus only', () => {
    for (const side of [undefined, 'geese'])
      expect(decide(fx({ settings: side ? { side } : {} }), B, { op: 'accept' })).toEqual({
        kind: 'begin',
        state: { moves: [] },
        turn: 0,
      })
    for (const side of ['goose', 'Fox', 1, true, ''])
      expect(status(decide(fx({ settings: { side } }), B, { op: 'accept' }))).toBe(422)
    // together the two friends herd the geese: there is no side for the challenger to take
    expect(
      status(decide(fx({ mode: 'together', settings: { side: 'fox' } }), B, { op: 'accept' })),
    ).toBe(422)
    expect(
      decide(fx({ mode: 'together', settings: { side: 'geese', level: 'easy' } }), B, {
        op: 'accept',
      }).kind,
    ).toBe('begin')
  })

  it('refuses a goose stepping back, the fox leaping where there is no goose, the other side’s piece, and a stored game no moves could make', () => {
    let row = after(fx(), decide(fx(), B, { op: 'accept' }))
    expect(status(decide(row, A, move(row.seq, [24, 23])))).toBe(400)
    row = after(row, decide(row, A, move(row.seq, [22, 29])))
    expect(status(decide(row, B, move(row.seq, [24, 38])))).toBe(400)
    row = after(row, decide(row, B, move(row.seq, [24, 23])))
    expect(status(decide(row, A, move(row.seq, [29, 22])))).toBe(400)
    expect(
      status(decide({ ...row, state: { moves: [[29, 22]] } }, A, move(row.seq, [16, 23]))),
    ).toBe(500)
  })
})

describe('noughts and crosses in a cube by turns: four in a line, any way through', () => {
  const cb = (over: Partial<Row> = {}) => invite({ demo_id: 'cube', settings: {}, ...over })
  const game = (state: unknown) => cubeRules.decode(state)!
  /**
   * Every line of four through the cube, found here rather than taken from cube.ts: each of the
   * thirteen directions (a vector and its opposite are one), from every cell where four steps fit.
   */
  const LINES4 = (() => {
    const out: number[][] = []
    const dirs: number[][] = []
    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++)
        for (let z = -1; z <= 1; z++) {
          const first = [x, y, z].find((v) => v !== 0)
          if (first === 1) dirs.push([x, y, z])
        }
    const at = (x: number, y: number, z: number) => z * 16 + y * 4 + x
    for (const [dx, dy, dz] of dirs)
      for (let x = 0; x < 4; x++)
        for (let y = 0; y < 4; y++)
          for (let z = 0; z < 4; z++) {
            const end = [x + 3 * dx, y + 3 * dy, z + 3 * dz]
            if (end.some((v) => v < 0 || v > 3)) continue
            out.push([0, 1, 2, 3].map((k) => at(x + k * dx, y + k * dy, z + k * dz)))
          }
    return out
  })()
  const hasLine = (cells: ArrayLike<number>, side: number) =>
    LINES4.some((l) => l.every((i) => cells[i] === side))

  it('counts the 76 lines a 4×4×4 cube has, none twice', () => {
    expect(LINES4).toHaveLength(76)
    expect(new Set(LINES4.map((l) => [...l].sort((x, y) => x - y).join())).size).toBe(76)
  })

  it('plays versus to the end, the winner whoever has four in a line', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 16; seed++) {
      const rnd = seeded(seed)
      const { row, plans } = playOut(cb(), (r) => {
        const g = game(r.state)
        const free = [...g.cells.keys()].filter((i) => !g.cells[i])
        return free[Math.floor(rnd() * free.length)]
      })
      expect(row.status).toBe('finished')
      const last = plans.at(-1)!
      if (last.kind !== 'commit') throw new Error('refused')
      const g = game(last.state)
      if (last.result!.winner === 'draw') {
        expect(g.cells.every((c) => c !== 0)).toBe(true)
        expect(hasLine(g.cells, 1) || hasLine(g.cells, 2)).toBe(false)
        seen.add('draw')
        continue
      }
      const side = last.result!.winner === 0 ? 1 : 2
      expect(hasLine(g.cells, side)).toBe(true)
      expect(hasLine(g.cells, side === 1 ? 2 : 1)).toBe(false)
      seen.add(String(last.result!.winner))
    }
    expect(seen.has('0') && seen.has('1')).toBe(true)
  })

  it('ends on a line straight through the middle, corner to corner', () => {
    let row = after(cb(), decide(cb(), B, { op: 'accept' }))
    for (const [who, i] of [
      [A, 0],
      [B, 1],
      [A, 21],
      [B, 2],
      [A, 42],
      [B, 3],
    ] as const)
      row = after(row, decide(row, who, move(row.seq, i)))
    expect(row.status).toBe('active')
    const p = decide(row, A, move(row.seq, 63))
    if (p.kind !== 'commit') throw new Error('refused')
    expect(p.result).toEqual({ winner: 0 })
    expect(after(row, p).status).toBe('finished')
  })

  it('together: the computer answers in the same call, at every level', () => {
    for (const level of ['easy', 'fair', 'hard']) {
      const start = cb({ mode: 'together', settings: { level } })
      let row = after(start, decide(start, B, { op: 'accept' }))
      for (let k = 0; k < 3 && row.status === 'active'; k++) {
        const g = game(row.state)
        const free = [...g.cells.keys()].filter((i) => !g.cells[i])
        const p = decide(row, row.turn === 0 ? A : B, move(row.seq, free[0]))
        expect(p.kind).toBe('commit')
        if (p.kind !== 'commit') break
        expect(p.move.then).toHaveLength(1)
        row = after(row, p)
      }
    }
  })

  it('refuses a taken cell, one off the cube, a move that is not a cell, and a stored game no moves could make', () => {
    let row = after(cb(), decide(cb(), B, { op: 'accept' }))
    row = after(row, decide(row, A, move(row.seq, 21)))
    expect(status(decide(row, B, move(row.seq, 21)))).toBe(400)
    expect(status(decide(row, B, move(row.seq, 64)))).toBe(400)
    expect(status(decide(row, B, move(row.seq, -1)))).toBe(400)
    expect(status(decide(row, B, move(row.seq, 1.5)))).toBe(400)
    expect(status(decide({ ...row, state: { moves: [5, 5] } }, B, move(row.seq, 6)))).toBe(500)
  })
})

describe('artillery by turns: the server fires the shot, the seed and the shots are the game', () => {
  const ar = (over: Partial<Row> = {}) => invite({ demo_id: 'artillery', settings: {}, ...over })
  const game = (state: unknown) => {
    const o = state as { seed: number; shots: unknown[] }
    return artReplay(o.seed, o.shots)!
  }

  it('deals a field of its own on accept, from a seed the server chose', () => {
    const p = decide(ar(), B, { op: 'accept' })
    if (p.kind !== 'begin') throw new Error('refused')
    const st = p.state as { seed: number; shots: unknown[] }
    expect(Number.isInteger(st.seed) && st.seed >= 0 && st.seed < 2 ** 31).toBe(true)
    expect(st.shots).toEqual([])
  })

  it('plays versus to the end, the winner the gun still standing, the score what each has left', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 10; seed++) {
      const rnd = seeded(seed)
      const { row, plans } = playOut(ar(), (r) => {
        const g = game(r.state)
        // steady hands both sides, with a wild shot now and then
        const s = gunner(g.f, 'fair', rnd)
        return rnd() < 0.15 ? [5 + rnd() * 80, 0.1 + rnd() * 0.9] : [s.angle, s.charge]
      })
      expect(row.status).toBe('finished')
      const last = plans.at(-1)!
      if (last.kind !== 'commit') throw new Error('refused')
      const g = game(last.state)
      const life = g.f.guns.map((x) => x.life)
      expect(last.result!.score).toBe(`${life[0]}–${life[1]}`)
      if (last.result!.winner === 'draw') {
        seen.add('draw')
        continue
      }
      const w = last.result!.winner as 0 | 1
      // asked of the guns: the loser's is out of action and the winner's is not
      expect(life[1 - w]).toBeLessThanOrEqual(0)
      expect(life[w]).toBeGreaterThan(0)
      expect(life[w]).toBeLessThanOrEqual(LIFE)
      seen.add(String(w))
    }
    expect(seen.has('0') && seen.has('1')).toBe(true)
  }, 60000)

  it('stores each shot exactly as sent, and the field it leaves is what the seed and the shots make', () => {
    let row = after(ar(), decide(ar(), B, { op: 'accept' }))
    row = after(row, decide(row, A, move(row.seq, { angle: 47.25, charge: 0.73 })))
    row = after(row, decide(row, B, move(row.seq, [33, 0.5])))
    const st = row.state as { seed: number; shots: unknown[] }
    expect(st.shots).toEqual([
      [47.25, 0.73],
      [33, 0.5],
    ])
    // the same shots on another field land somewhere else: the seed is part of the game
    const here = game(st).f.ground.join()
    const there = artReplay((st.seed + 1) % 2 ** 31, st.shots)!.f.ground.join()
    expect(here).not.toBe(there)
  })

  it('together: the computer’s gun answers in the same call, at every level', () => {
    for (const level of ['easy', 'fair', 'hard']) {
      const start = ar({ mode: 'together', settings: { level } })
      let row = after(start, decide(start, B, { op: 'accept' }))
      for (let k = 0; k < 3 && row.status === 'active'; k++) {
        const p = decide(row, row.turn === 0 ? A : B, move(row.seq, [45, 0.5]))
        expect(p.kind).toBe('commit')
        if (p.kind !== 'commit') break
        expect(p.move.then).toHaveLength(1)
        row = after(row, p)
      }
    }
  })

  it('refuses a barrel or a charge past the toy’s own limits, a shot that is not numbers, and a stored game no seed could make', () => {
    const row = after(ar(), decide(ar(), B, { op: 'accept' }))
    for (const bad of [[4, 0.5], [86, 0.5], [45, 0], [45, 1.01], ['45', 0.5], { angle: 45 }])
      expect(status(decide(row, A, move(row.seq, bad)))).toBe(400)
    const st = row.state as { seed: number }
    expect(
      status(decide({ ...row, state: { seed: -1, shots: [] } }, A, move(row.seq, [45, 0.5]))),
    ).toBe(500)
    expect(
      status(
        decide(
          { ...row, state: { seed: st.seed, shots: [[90, 0.5]] } },
          A,
          move(row.seq, [45, 0.5]),
        ),
      ),
    ).toBe(500)
  })
})

describe('bowling by turns: a frame each, the server bowls every ball', () => {
  const bw = (over: Partial<Row> = {}) => invite({ demo_id: 'bowling', settings: {}, ...over })
  const game = (state: unknown) => bowlReplay((state as { balls: unknown[] }).balls)!
  /**
   * A scorecard added up here rather than by bowling.ts: ten frames, a strike counting the next
   * two balls and a spare the next one, and the balls a tenth frame's bonus earns, no more.
   */
  const tenPin = (r: readonly number[]) => {
    let total = 0
    let i = 0
    for (let f = 0; f < 9; f++) {
      if (r[i] === 10) {
        total += 10 + r[i + 1] + r[i + 2]
        i += 1
      } else {
        total += r[i] + r[i + 1] + (r[i] + r[i + 1] === 10 ? r[i + 2] : 0)
        i += 2
      }
    }
    // the tenth: its own balls, three of them after a strike or a spare and two otherwise
    const third = r[i] === 10 || r[i] + r[i + 1] === 10
    total += r[i] + r[i + 1] + (third ? r[i + 2] : 0)
    return { total, balls: i + (third ? 3 : 2) }
  }
  /* ⚠️ THE TEST'S OWN AIM WAS NINE TENTHS OF ITS TIME: the toy's planner bowls two to four hundred
     balls to choose one, and measured on 17 Nov 2026 it took 5.5–7.7s of each 6–8.6s game, so eight
     games sat on the 60s limit and failed on a slower machine. What it plans depends only on the pins
     standing, so it is planned once per set of pins; the hand's wobble still varies every ball. */
  const planned = new Map<string, ReturnType<typeof bowlPlan>>()
  const aim = (standing: number[], rnd: () => number) => {
    const key = standing.join()
    let p = planned.get(key)
    if (!p) planned.set(key, (p = bowlPlan(standing, 'fair', rnd)))
    return bowlInside(bowlWobble(p, 'fair', rnd))
  }

  it('plays versus to the end, the winner the higher scorecard, every ball accounted for', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 8; seed++) {
      const rnd = seeded(seed)
      const { row, plans } = playOut(bw(), (r) => {
        const s = aim(game(r.state).standing, rnd)
        return [s.x, s.angle, s.speed, s.hook]
      })
      expect(row.status).toBe('finished')
      const last = plans.at(-1)!
      if (last.kind !== 'commit') throw new Error('refused')
      const g = game(last.state)
      const [a, b] = g.rolls.map((r) => tenPin(r).total)
      // each card is exactly ten frames and the bonus they earned
      for (const r of g.rolls) expect(r.length).toBe(tenPin(r).balls)
      expect(last.result!.score).toBe(`${a}–${b}`)
      expect(last.result!.winner).toBe(a > b ? 0 : b > a ? 1 : 'draw')
      seen.add(String(last.result!.winner))
    }
    expect(seen.has('0') && seen.has('1')).toBe(true)
  }, 60000)

  it('keeps the turn with a bowler between the balls of a frame, and passes it on a strike', () => {
    let row = after(bw(), decide(bw(), B, { op: 'accept' }))
    // off the edge of the lane at a crawl: a gutter ball, so the frame goes on
    row = after(row, decide(row, A, move(row.seq, [LANE_HALF, 0.1, 5, 1])))
    expect(game(row.state).rolls[0]).toEqual([0])
    expect(row.turn).toBe(0)
    expect(status(decide(row, B, move(row.seq, [0, 0, 8, 0])))).toBe(409)
    row = after(row, decide(row, A, move(row.seq, [LANE_HALF, 0.1, 5, 1])))
    expect(row.turn).toBe(1)
  })

  it('together: the computer bowls its whole frame in the same call, at every level', () => {
    for (const level of ['easy', 'fair', 'hard']) {
      const start = bw({ mode: 'together', settings: { level } })
      let row = after(start, decide(start, B, { op: 'accept' }))
      let frames = 0
      for (let k = 0; k < 8 && row.status === 'active' && frames < 2; k++) {
        const before = game(row.state).rolls[1].length
        const p = decide(row, row.turn === 0 ? A : B, move(row.seq, [0.05, 0, 8, 0]))
        expect(p.kind).toBe('commit')
        if (p.kind !== 'commit') break
        row = after(row, p)
        const g = game(row.state)
        // the replies are kept when they fit the history row and counted when they do not
        const h = p.move as { then?: unknown[]; replies?: number }
        const replies = h.then?.length ?? h.replies ?? 0
        if (replies) {
          // a frame is one ball on a strike and two otherwise, and it is the team's turn again
          const n = g.rolls[1].length - before
          expect(replies).toBe(n)
          if (n === 1) expect(g.rolls[1].at(-1)).toBe(10)
          else expect(n).toBe(2)
          expect(g.up).toBe(0)
          frames++
        }
      }
      expect(frames).toBe(2)
    }
  }, 30000)

  it('refuses a ball off the lane, too fast, too slow, too much hook, not numbers, and a stored game no balls could make', () => {
    const row = after(bw(), decide(bw(), B, { op: 'accept' }))
    for (const bad of [
      [LANE_HALF + 0.01, 0, 8, 0],
      [0, 0.11, 8, 0],
      [0, 0, 4.9, 0],
      [0, 0, 10.1, 0],
      [0, 0, 8, 1.1],
      [0, 0, '8', 0],
      [0, 0, 8],
    ])
      expect(status(decide(row, A, move(row.seq, bad)))).toBe(400)
    expect(
      status(decide({ ...row, state: { balls: [[0, 0, 11, 0]] } }, A, move(row.seq, [0, 0, 8, 0]))),
    ).toBe(500)
    expect(
      status(
        decide(
          { ...row, state: { balls: Array(43).fill([0, 0, 8, 0]) } },
          A,
          move(row.seq, [0, 0, 8, 0]),
        ),
      ),
    ).toBe(500)
  })
})

describe('history rows: a move too big for its row', () => {
  it('is noted without itself, so the insert cannot fail the whole move', () => {
    const big = { sweeps: Array.from({ length: 30 }, (_, i) => [i * 10, i * 10 + 5]) }
    expect(jsonbBytes({ m: big })).toBeGreaterThan(HISTORY_BYTES)
    expect(historyRow(big, [])).toEqual({ m: null })
    expect(historyRow(big, [1, 2])).toEqual({ m: null, replies: 2 })
    expect(jsonbBytes(historyRow(big, [1, 2]))).toBeLessThanOrEqual(HISTORY_BYTES)
  })
})

describe('curling by turns: a throw and its sweep, kept small enough to keep', () => {
  const cu = (over: Partial<Row> = {}) => invite({ demo_id: 'curling', settings: {}, ...over })
  const game = (state: unknown) => curlReplay((state as { throws: unknown[] }).throws)!
  /** an end's points recounted from where the stones lie: the button at (0, TEE) */
  const recount = (stones: readonly { x: number; y: number; team: number }[]) => {
    const near = stones
      .map((s) => ({ d: Math.hypot(s.x, s.y - TEE), team: s.team }))
      .filter((s) => s.d < HOUSE_R + STONE_R)
      .sort((a, b) => a.d - b.d)
    let n = 0
    while (n < near.length && near[n].team === near[0]?.team) n++
    return near.length ? { team: near[0].team, points: n } : { team: null, points: 0 }
  }

  it('cuts a sweep down by joining its closest spans, and never sweeps a step it did not', () => {
    const spans: [number, number][] = [
      [0, 10],
      [12, 20],
      [40, 41],
      [41, 50],
      [90, 95],
      [300, 310],
    ]
    const out = fewerSpans(spans, 3)
    expect(out).toHaveLength(3)
    // every step swept before is swept after, and the joins are the shortest gaps: 0, 2, then 20
    for (const [a, b] of spans)
      for (let i = a; i < b; i++) expect(out.some(([x, y]) => i >= x && i < y)).toBe(true)
    expect(out).toEqual([
      [0, 50],
      [90, 95],
      [300, 310],
    ])
  })

  it('keeps the longest game a match can hold inside its 16 KB column, every throw at its widest', () => {
    // five ends of eight stones, each with the most sweeps a match keeps, at four-digit steps
    const widest = [
      -0.5999,
      9.9999,
      -1,
      Array.from({ length: MATCH_SPANS }, (_, i) => [4000 + i * 100, 4050 + i * 100]),
    ]
    const state = { throws: Array.from({ length: MAX_CURL_THROWS }, () => widest) }
    expect(MAX_CURL_THROWS).toBe(40)
    expect(jsonbBytes(state)).toBeLessThanOrEqual(16384)
  })

  it('plays versus to the end, each end scored as the stones lay, every throw small enough to keep', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 6; seed++) {
      const rnd = seeded(seed)
      const { row, plans } = playOut(cu(), (r) => curlPack(matchThrow(game(r.state), 'fair', rnd)))
      expect(row.status).toBe('finished')
      const ends: [number, number][] = []
      for (const p of plans) {
        if (p.kind !== 'commit') throw new Error('refused')
        expect(jsonbBytes(p.move)).toBeLessThanOrEqual(HISTORY_BYTES)
        expect(jsonbBytes(p.state)).toBeLessThanOrEqual(16384)
        const last = game(p.state).last!
        if (last.ended) {
          const c = recount(last.stones)
          expect([last.ended.team, last.ended.points]).toEqual([c.team, c.points])
          ends.push(c.team === null ? [0, 0] : c.team === 0 ? [c.points, 0] : [0, c.points])
        }
      }
      const last = plans.at(-1)!
      if (last.kind !== 'commit') throw new Error('refused')
      const [a, b] = ends.reduce((t, e) => [t[0] + e[0], t[1] + e[1]], [0, 0])
      expect(last.result!.score).toBe(`${a}–${b}`)
      expect(last.result!.winner).toBe(a > b ? 0 : b > a ? 1 : 'draw')
      seen.add(String(last.result!.winner))
    }
    expect(seen.size).toBeGreaterThan(1)
  }, 60000)

  it('together: the computer throws in the same call at every level, its sweep cut to fit', () => {
    for (const level of ['easy', 'fair', 'hard']) {
      const start = cu({ mode: 'together', settings: { level } })
      let row = after(start, decide(start, B, { op: 'accept' }))
      const rnd = seeded(7)
      for (let k = 0; k < 4 && row.status === 'active'; k++) {
        const t = matchThrow(game(row.state), 'fair', rnd)
        const p = decide(row, row.turn === 0 ? A : B, move(row.seq, curlPack(t)))
        expect(p.kind).toBe('commit')
        if (p.kind !== 'commit') break
        expect(jsonbBytes(p.move)).toBeLessThanOrEqual(HISTORY_BYTES)
        row = after(row, p)
        for (const th of game(row.state).throws)
          expect(th.sweeps.length).toBeLessThanOrEqual(MATCH_SPANS)
      }
    }
  }, 30000)

  it('refuses a throw with more sweeps than a match keeps, or numbers past four places, and what the room refuses', () => {
    const row = after(cu(), decide(cu(), B, { op: 'accept' }))
    const nine = Array.from({ length: MATCH_SPANS + 1 }, (_, i) => [i * 10, i * 10 + 5])
    expect(status(decide(row, A, move(row.seq, [0.01, 2.5, 1, nine.slice(0, MATCH_SPANS)])))).toBe(
      'commit',
    )
    expect(status(decide(row, A, move(row.seq, [0.01, 2.5, 1, nine])))).toBe(400)
    expect(status(decide(row, A, move(row.seq, [0.012345, 2.5, 1, []])))).toBe(400)
    expect(status(decide(row, A, move(row.seq, [0.01, 2.50001, 1, []])))).toBe(400)
    expect(status(decide(row, A, move(row.seq, [0.7, 2.5, 1, []])))).toBe(400)
    expect(status(decide(row, A, move(row.seq, [0.01, 2.5, 0, []])))).toBe(400)
    expect(status(decide(row, A, move(row.seq, [0.01, 2.5, 1, [[5, 3]]])))).toBe(400)
    expect(
      status(
        decide(
          { ...row, state: { throws: [[0.01, 99, 1, []]] } },
          A,
          move(row.seq, [0.01, 2.5, 1, []]),
        ),
      ),
    ).toBe(500)
  })
})

describe('putt by turns: each ball putts its hole out, the server rolls every putt', () => {
  const pt = (over: Partial<Row> = {}) => invite({ demo_id: 'putt', settings: {}, ...over })
  const game = (state: unknown) => puttReplay((state as { putts: unknown[] }).putts)!

  it('plays versus to the end, the lower round winning, every hole holed out or picked up', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 8; seed++) {
      const rnd = seeded(seed)
      const { row, plans } = playOut(pt(), (r) => {
        const g = game(r.state)
        const p = puttStroke(COURSE[g.hole], g.at, rnd() < 0.5 ? 'easy' : 'fair', rnd)
        return [p.angle, p.power]
      })
      expect(row.status).toBe('finished')
      const last = plans.at(-1)!
      if (last.kind !== 'commit') throw new Error('refused')
      const g = game(last.state)
      // every hole has both balls' strokes, each between one and the pick-up
      for (const c of g.card)
        for (const n of c) expect(n !== null && n >= 1 && n <= PICK_UP).toBe(true)
      // and every putt is one of them: a ball's putts on a hole are no more than its strokes there
      const putts = new Map<string, number>()
      let walk = game({ putts: [] })
      for (const x of (last.state as { putts: unknown[] }).putts) {
        const key = `${walk.hole}:${walk.up}`
        putts.set(key, (putts.get(key) ?? 0) + 1)
        walk = puttReplay([...walk.putts.map((q) => [q.angle, q.power]), x])!
      }
      for (const [key, n] of putts) {
        const [h, side] = key.split(':').map(Number)
        expect(n).toBeLessThanOrEqual(g.card[h][side]!)
      }
      const [a, b] = g.card.reduce((t, c) => [t[0] + c[0]!, t[1] + c[1]!], [0, 0])
      expect(last.result!.score).toBe(`${a}–${b}`)
      expect(last.result!.winner).toBe(a < b ? 0 : b < a ? 1 : 'draw')
      seen.add(String(last.result!.winner))
    }
    expect(seen.size).toBeGreaterThan(1)
  }, 60000)

  it('keeps the turn with a ball until it holes out, then hands the hole to the other', () => {
    let row = after(pt(), decide(pt(), B, { op: 'accept' }))
    // a putt barely struck stays out, and the same ball plays again
    row = after(row, decide(row, A, move(row.seq, [0, 0.02])))
    expect(row.turn).toBe(0)
    expect(status(decide(row, B, move(row.seq, [0, 0.5])))).toBe(409)
    expect(game(row.state).strokes).toBe(1)
  })

  it('together: the computer putts its ball out in the same call, at every level', () => {
    for (const level of ['easy', 'fair', 'hard']) {
      const start = pt({ mode: 'together', settings: { level } })
      let row = after(start, decide(start, B, { op: 'accept' }))
      const rnd = seeded(3)
      let holes = 0
      for (let k = 0; k < 30 && row.status === 'active' && holes < 2; k++) {
        const g0 = game(row.state)
        const p = puttStroke(COURSE[g0.hole], g0.at, 'hard', rnd)
        const plan = decide(row, row.turn === 0 ? A : B, move(row.seq, [p.angle, p.power]))
        expect(plan.kind).toBe('commit')
        if (plan.kind !== 'commit') break
        row = after(row, plan)
        const h = plan.move as { then?: unknown[]; replies?: number }
        if (h.then || h.replies) {
          // the computer's whole hole came back: both balls have a score there, and it is the team's
          const g = game(row.state)
          expect(g.card[g0.hole][1]).not.toBeNull()
          expect(g.up === 0 || g.up === null).toBe(true)
          holes++
        }
      }
      expect(holes).toBe(2)
    }
  }, 30000)

  it('refuses a putt aimed past the toy’s limits, with no strength or too much, not numbers, and a stored round no putts could make', () => {
    const row = after(pt(), decide(pt(), B, { op: 'accept' }))
    for (const bad of [[10.1, 0.5], [0, 0], [0, 1.01], ['0', 0.5], [0], { angle: 0 }])
      expect(status(decide(row, A, move(row.seq, bad)))).toBe(400)
    expect(status(decide({ ...row, state: { putts: [[0, 2]] } }, A, move(row.seq, [0, 0.5])))).toBe(
      500,
    )
    expect(
      status(
        decide({ ...row, state: { putts: Array(97).fill([0, 0.02]) } }, A, move(row.seq, [0, 0.5])),
      ),
    ).toBe(500)
  })
})

describe('darts by turns: 501, double out, first to two legs; a dart is where it went in', () => {
  const dt = (over: Partial<Row> = {}) => invite({ demo_id: 'darts', settings: {}, ...over })
  const dartsOf = (state: unknown) => (state as { darts: [number, number][] }).darts
  /**
   * The match these darts make, counted here rather than by darts.ts: a leg is 501 down to
   * exactly nothing on a double; a turn is three darts unless it busts (below nothing, one left,
   * or nothing on anything but a double), which puts the score back to where the turn began; the
   * first throw of each leg goes to each side in turn. Only the board — what a landing hits — is
   * the toy's.
   */
  const count = (darts: readonly [number, number][]) => {
    const legs = [0, 0]
    let legNo = 0
    let left = [501, 501]
    let up = 0
    let from = 501
    let inTurn = 0
    for (const [x, y] of darts) {
      const h = hitAt(x, y)
      const after = left[up] - h.n * h.mult
      inTurn++
      const pass = () => {
        up = 1 - up
        from = left[up]
        inTurn = 0
      }
      if (after < 0 || after === 1 || (after === 0 && h.mult !== 2)) {
        left[up] = from
        pass()
      } else if (after === 0) {
        legs[up]++
        if (Math.max(...legs) >= 2) break
        legNo++
        left = [501, 501]
        up = legNo % 2
        from = 501
        inTurn = 0
      } else {
        left[up] = after
        if (inTurn === 3) pass()
      }
    }
    return legs
  }
  const throwFor = (state: unknown, rnd: () => number) => {
    const g = dartsMatchGame(state)
    const p = tidy(land(aimFor(g.leg, 'fair'), SPREAD.fair, rnd))
    return [p.x, p.y]
  }
  const dartsMatchGame = (state: unknown) => dartsMatchRules.decode(state)!

  it('keeps the longest match a match can hold inside its 16 KB column, every dart at its widest', () => {
    const state = { darts: Array.from({ length: MAX_DARTS }, () => [-299.9, -299.9]) }
    expect(jsonbBytes(state)).toBeLessThanOrEqual(16384)
  })

  it('plays versus to the end, the legs what a 501 counted in the test makes of the darts', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 8; seed++) {
      const rnd = seeded(seed)
      const { row, plans } = playOut(dt(), (r) => throwFor(r.state, rnd), 1000)
      expect(row.status).toBe('finished')
      const last = plans.at(-1)!
      if (last.kind !== 'commit') throw new Error('refused')
      const legs = count(dartsOf(last.state))
      expect(Math.max(...legs)).toBe(2)
      expect(last.result!.score).toBe(`${legs[0]}–${legs[1]}`)
      expect(last.result!.winner).toBe(legs[0] > legs[1] ? 0 : 1)
      seen.add(String(last.result!.winner))
    }
    expect(seen.has('0') && seen.has('1')).toBe(true)
  }, 60000)

  it('keeps the turn for three darts, then hands it on', () => {
    let row = after(dt(), decide(dt(), B, { op: 'accept' }))
    // three singles, well clear of a bust
    for (let k = 0; k < 3; k++) {
      expect(row.turn).toBe(0)
      row = after(row, decide(row, A, move(row.seq, [0, 120])))
    }
    expect(row.turn).toBe(1)
  })

  it('together: the computer throws its turn in the same call, at every level', () => {
    for (const level of ['easy', 'fair', 'hard']) {
      const start = dt({ mode: 'together', settings: { level } })
      let row = after(start, decide(start, B, { op: 'accept' }))
      let turns = 0
      for (let k = 0; k < 9 && row.status === 'active' && turns < 2; k++) {
        const p = decide(row, row.turn === 0 ? A : B, move(row.seq, [0, 120]))
        expect(p.kind).toBe('commit')
        if (p.kind !== 'commit') break
        row = after(row, p)
        const h = p.move as { then?: unknown[]; replies?: number }
        const n = h.then?.length ?? h.replies ?? 0
        if (n) {
          // a turn is three darts unless it busts or wins
          expect(n).toBeGreaterThanOrEqual(1)
          expect(n).toBeLessThanOrEqual(3)
          turns++
        }
      }
      expect(turns).toBe(2)
    }
  })

  it('refuses a dart past the board’s neighbourhood, one not to a tenth of a millimetre, not numbers, and a stored match no darts could make', () => {
    const row = after(dt(), decide(dt(), B, { op: 'accept' }))
    for (const bad of [[0, 300.2], [0.05, 120], [0, 120.123], ['0', 120], [0], { x: 0 }])
      expect(status(decide(row, A, move(row.seq, bad)))).toBe(400)
    expect(status(decide(row, A, move(row.seq, [-12.3, 99.9])))).toBe('commit')
    expect(
      status(decide({ ...row, state: { darts: [[0, 999]] } }, A, move(row.seq, [0, 120]))),
    ).toBe(500)
    expect(
      status(
        decide(
          { ...row, state: { darts: Array(MAX_DARTS + 1).fill([0, 120]) } },
          A,
          move(row.seq, [0, 120]),
        ),
      ),
    ).toBe(500)
  })
})

describe('backgammon by turns: the server rolls every die', () => {
  const bg = (over: Partial<Row> = {}) => invite({ demo_id: 'backgammon', settings: {}, ...over })
  const game = (state: unknown) => bgReplay(state)!
  /** the server's dice, as a test means them to come up */
  const dice = (...faces: number[]) => {
    let k = 0
    return vi
      .spyOn(Math, 'random')
      .mockImplementation(() => (faces[k++ % faces.length] - 1) / 6 + 0.01)
  }
  afterEach(() => vi.restoreAllMocks())
  const turnFor = (state: unknown, rnd: () => number) => {
    const g = game(state)
    const list = bgPlays(g.pos, g.turn!, g.dice!)
    return list[Math.floor(rnd() * list.length)].steps.map((s) => [s.from, s.to])
  }

  it('keeps the longest game a match can hold inside its 16 KB column, every turn at its widest', () => {
    // a double played four times, each step two two-digit points, for every turn there can be
    const widest = [6, 6, 23, 17, 17, 11, 11, 15, 15, 24]
    const state = {
      open: [6, 5],
      turns: Array.from({ length: BG_MAX_TURNS }, () => widest),
      dice: [6, 6],
    }
    expect(BG_MAX_TURNS).toBe(300)
    expect(jsonbBytes(state)).toBeLessThanOrEqual(16384)
  })

  it('lets the opening roll say who starts: the higher die, playing both', () => {
    dice(2, 5)
    const p = decide(bg(), B, { op: 'accept' })
    if (p.kind !== 'begin') throw new Error('refused')
    // side 1 (the challenger's) rolled 2, side 2 rolled 5: the friend starts, with 5–2
    expect(p.turn).toBe(1)
    expect(p.state).toEqual({ open: [2, 5], turns: [], dice: [5, 2] })
  })

  it('together: a computer that wins the opening plays at once, and the challenger moves next', () => {
    dice(1, 6, 3, 2, 5, 4)
    const p = decide(bg({ mode: 'together', settings: { level: 'fair' } }), B, { op: 'accept' })
    if (p.kind !== 'begin') throw new Error('refused')
    const g = game(p.state)
    expect(p.turn).toBe(0)
    expect(g.turns).toHaveLength(1)
    expect(g.turns[0].by).toBe(2)
    expect(g.turns[0].dice).toEqual([6, 1])
    // and the team holds the next roll (the computer's choice draws on the same dice, so which)
    expect(g.turn).toBe(1)
    expect(g.dice!.every((d) => d >= 1 && d <= 6)).toBe(true)
  })

  it('plays versus to the end, the winner whoever bore all fifteen off, the score what it was worth', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 8; seed++) {
      vi.spyOn(Math, 'random').mockImplementation(seeded(seed * 7))
      const rnd = seeded(seed)
      const { row, plans } = playOut(bg(), (r) => turnFor(r.state, rnd), 400)
      vi.restoreAllMocks()
      expect(row.status).toBe('finished')
      for (const p of plans)
        if (p.kind === 'commit') expect(jsonbBytes(p.move)).toBeLessThanOrEqual(HISTORY_BYTES)
      const last = plans.at(-1)!
      if (last.kind !== 'commit') throw new Error('refused')
      const g = game(last.state)
      // asked of the board: fifteen off for the winner; the loser's off, bar and home say the worth
      const w = g.pos.off[1] === 15 ? 1 : 2
      const l = w === 1 ? 2 : 1
      expect(g.pos.off[w]).toBe(15)
      expect(last.result!.winner).toBe(w === 1 ? 0 : 1)
      const home = (i: number) => (w === 1 ? i <= 5 : i >= 18)
      const stuck =
        g.pos.bar[l] > 0 || g.pos.board.some((c, i) => (l === 1 ? c > 0 : c < 0) && home(i))
      expect(last.result!.score).toBe(
        g.pos.off[l] > 0 ? '1 point' : stuck ? 'a backgammon, 3 points' : 'a gammon, 2 points',
      )
      seen.add(String(last.result!.winner))
    }
    expect(seen.has('0') && seen.has('1')).toBe(true)
  }, 60000)

  it('together: the computer rolls and plays its turn in the same call, at every level', () => {
    for (const level of ['easy', 'fair', 'hard']) {
      vi.spyOn(Math, 'random').mockImplementation(seeded(11))
      const start = bg({ mode: 'together', settings: { level } })
      let row = after(start, decide(start, B, { op: 'accept' }))
      const rnd = seeded(2)
      for (let k = 0; k < 4 && row.status === 'active'; k++) {
        const before = game(row.state).turns.length
        const p = decide(row, row.turn === 0 ? A : B, move(row.seq, turnFor(row.state, rnd)))
        expect(p.kind).toBe('commit')
        if (p.kind !== 'commit') break
        row = after(row, p)
        const g = game(row.state)
        // the team's turn, then the computer's (and a pass, if a roll gave anybody nothing)
        expect(g.turns.length).toBeGreaterThanOrEqual(before + 2)
        expect(g.turn).toBe(1)
        expect(g.dice).not.toBeNull()
      }
      vi.restoreAllMocks()
    }
  }, 30000)

  it('refuses a turn the dice do not allow, out of turn, and a stored game no rolls could make', () => {
    dice(6, 1)
    const row = after(bg(), decide(bg(), B, { op: 'accept' }))
    vi.restoreAllMocks()
    expect(row.turn).toBe(0)
    expect(status(decide(row, A, move(row.seq, [[12, 6]])))).toBe(400)
    expect(
      status(
        decide(
          row,
          A,
          move(row.seq, [
            [12, 7],
            [7, 6],
          ]),
        ),
      ),
    ).toBe(400)
    expect(
      status(
        decide(
          row,
          A,
          move(row.seq, [
            [3, 2],
            [3, 2],
            [3, 2],
            [3, 2],
            [3, 2],
          ]),
        ),
      ),
    ).toBe(400)
    expect(
      status(
        decide(
          row,
          B,
          move(row.seq, [
            [0, 6],
            [11, 12],
          ]),
        ),
      ),
    ).toBe(409)
    expect(
      status(
        decide(
          row,
          A,
          move(row.seq, [
            [12, 6],
            [7, 6],
          ]),
        ),
      ),
    ).toBe('commit')
    expect(
      status(
        decide(
          { ...row, state: { open: [4, 4], turns: [], dice: [4, 4] } },
          A,
          move(row.seq, [
            [12, 6],
            [7, 6],
          ]),
        ),
      ),
    ).toBe(500)
  })
})

describe('sea battle by turns: each fleet hidden, each player shown only their own', () => {
  const settings = { size: 8, fleet: 'quick', apart: true, again: false }
  const sb = (over: Partial<Row> = {}) => invite({ demo_id: 'seabattle', settings, ...over })
  const fleetOf = (seed: number) =>
    randomFleet(8, FLEETS.quick, true, seeded(seed)).map((sh) => sh.cells)
  /** every cell of a fleet, for asking whether any of it reached somewhere it must not */
  const cellsOf = (f: number[][]) => f.flat()
  const mine = (row: Row, who: string) => {
    const p = decide(row, who, { op: 'mine' })
    if (p.kind !== 'mine') throw new Error(`refused: ${JSON.stringify(p)}`)
    return p.data as number[][] | null
  }
  const begun = (bo = fleetOf(1)) => after(sb(), decide(sb(), B, { op: 'accept', brought: bo }))

  it('takes the friend’s fleet with their yes, and keeps it out of the state', () => {
    expect(status(decide(sb(), B, { op: 'accept' }))).toBe(400)
    // two ships touching when they must be apart, a ship of the wrong length, cells off the sea
    const bad = fleetOf(1)
    expect(
      status(decide(sb(), B, { op: 'accept', brought: [bad[0], bad[0], ...bad.slice(2)] })),
    ).toBe(400)
    expect(
      status(decide(sb(), B, { op: 'accept', brought: [bad[0].slice(1), ...bad.slice(1)] })),
    ).toBe(400)
    expect(
      status(decide(sb(), B, { op: 'accept', brought: bad.map((c) => c.map((x) => x + 64)) })),
    ).toBe(400)
    const p = decide(sb(), B, { op: 'accept', brought: bad })
    if (p.kind !== 'begin') throw new Error('refused')
    expect(p.state).toEqual({ placed: [false, true], shots: [] })
    expect(p.secret).toEqual({ fleets: [null, bad.map((c) => [...c].sort((x, y) => x - y))] })
  })

  it('shows each player their own fleet and nothing of the other’s', () => {
    const bo = fleetOf(1)
    const an = fleetOf(2)
    let row = begun(bo)
    expect(mine(sb(), A)).toBeNull()
    expect(cellsOf(mine(row, B)!).sort()).toEqual(cellsOf(bo).sort())
    expect(mine(row, A)).toBeNull()
    expect(status(decide(row, 'stranger', { op: 'mine' }))).toBe(404)
    // the challenger's fleet comes with their first shot, and the history keeps only the shot
    expect(status(decide(row, A, move(row.seq, { at: 0 })))).toBe(400)
    const p = decide(row, A, move(row.seq, { at: 0, fleet: an }))
    if (p.kind !== 'commit') throw new Error('refused')
    expect(p.move).toEqual({ m: { at: 0 } })
    row = after(row, p)
    expect(cellsOf(mine(row, A)!).sort()).toEqual(cellsOf(an).sort())
    expect(cellsOf(mine(row, B)!).sort()).toEqual(cellsOf(bo).sort())
    // and neither fleet is in the state: only the shot, what it did, and who has set out
    const st = row.state as { placed: boolean[]; shots: number[][] }
    expect(Object.keys(st).sort()).toEqual(['placed', 'shots'])
    expect(st.placed).toEqual([true, true])
    expect(st.shots).toEqual([[0, bo.flat().includes(0) ? 2 : 1]])
  })

  it('takes a fleet only once, and only the challenger’s with their first shot', () => {
    let row = begun()
    row = after(row, decide(row, A, move(row.seq, { at: 0, fleet: fleetOf(2) })))
    // the friend's was set out with their yes
    expect(status(decide(row, B, move(row.seq, { at: 0, fleet: fleetOf(3) })))).toBe(400)
    expect(status(decide(row, B, move(row.seq, { at: 0 })))).toBe('commit')
  })

  it('plays versus to the end, the winner whoever sank every ship, asked of the fleets themselves', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 10; seed++) {
      const rnd = seeded(seed)
      const fleets = [fleetOf(seed * 2), fleetOf(seed * 2 + 1)]
      let row = begun(fleets[1])
      const shot: Set<number>[] = [new Set(), new Set()]
      for (let k = 0; k < 200 && row.status === 'active'; k++) {
        const who = row.turn as 0 | 1
        const free = Array.from({ length: 64 }, (_, i) => i).filter((i) => !shot[who].has(i))
        const at = free[Math.floor(rnd() * free.length)]
        shot[who].add(at)
        const m = who === 0 && k === 0 ? { at, fleet: fleets[0] } : { at }
        const p = decide(row, who === 0 ? A : B, move(row.seq, m))
        expect(p.kind).toBe('commit')
        if (p.kind !== 'commit') break
        expect(JSON.stringify(p.move)).not.toContain('fleet')
        row = after(row, p)
        if (p.result) {
          const w = p.result.winner as 0 | 1
          // the winner's shots covered every cell of the other fleet; the loser's did not
          expect(cellsOf(fleets[1 - w]).every((c) => shot[w].has(c))).toBe(true)
          expect(cellsOf(fleets[w]).every((c) => shot[1 - w].has(c))).toBe(false)
          // with no second shots, shots alternate from the challenger: an index says who fired
          const sunkBy = [0, 1].map(
            (who) =>
              (row.state as { shots: number[][] }).shots.filter(
                (x, n) => n % 2 === who && x[1] === 3,
              ).length,
          )
          expect(sunkBy[w]).toBe(FLEETS.quick.length)
          expect(p.result.score).toBe(`${sunkBy[0]}–${sunkBy[1]}`)
          seen.add(String(w))
        }
      }
      expect(row.status).toBe('finished')
    }
    expect(seen.has('0') && seen.has('1')).toBe(true)
  })

  it('refuses a stored match whose fleets and shots disagree, or a fleet where none was set out', () => {
    let row = begun()
    row = after(row, decide(row, A, move(row.seq, { at: 0, fleet: fleetOf(2) })))
    const st = row.state as { placed: boolean[]; shots: number[][] }
    // the shot's result flipped: the fleets say otherwise
    const flipped = { ...st, shots: [[0, st.shots[0][1] === 1 ? 2 : 1]] }
    const up = row.turn === 0 ? A : B
    expect(status(decide({ ...row, state: flipped }, up, move(row.seq, { at: 5 })))).toBe(500)
    // a fleet kept back for a side that never set one out
    const sec = row.secret as { fleets: unknown[] }
    expect(
      status(
        decide(
          { ...row, state: { ...st, placed: [false, true], shots: [] }, secret: sec },
          up,
          move(row.seq, { at: 5 }),
        ),
      ),
    ).toBe(500)
    // no secret at all
    expect(status(decide({ ...row, secret: null }, up, move(row.seq, { at: 5 })))).toBe(500)
  })

  it('together: the computer’s fleet is dealt on the server, and it fires back in the same call', () => {
    for (const level of ['easy', 'fair', 'hard']) {
      const start = sb({ mode: 'together', settings: { ...settings, again: true, level } })
      const p0 = decide(start, B, { op: 'accept' })
      if (p0.kind !== 'begin') throw new Error('refused')
      const cpu = (p0.secret as { fleets: (number[][] | null)[] }).fleets[1]!
      expect(cpu).toHaveLength(FLEETS.quick.length)
      let row = after(start, p0)
      // neither friend is shown the computer's fleet; theirs is the team's, once set out
      expect(mine(row, A)).toBeNull()
      expect(mine(row, B)).toBeNull()
      const team = fleetOf(9)
      const p = decide(row, A, move(row.seq, { at: 0, fleet: team }))
      if (p.kind !== 'commit') throw new Error('refused')
      row = after(row, p)
      expect(cellsOf(mine(row, B)!).sort()).toEqual(cellsOf(team).sort())
      const shots = (row.state as { shots: number[][] }).shots
      // the team's shot, then the computer's: one, or more while it keeps hitting (again is on)
      expect(shots.length).toBeGreaterThanOrEqual(cpu.flat().includes(0) ? 1 : 2)
      expect(row.turn).toBe(1)
    }
  })
})

describe('ten thousand by turns: the server rolls, a turn is a run of decisions', () => {
  const tk = (over: Partial<Row> = {}) => invite({ demo_id: 'dice', settings: {}, ...over })
  const game = (state: unknown) => tenReplay(state)!
  /** a decision on the table: the computer's keep, banking at 350 unless the dice are hot */
  const decisionFor = (state: unknown) => {
    const g = game(state)
    const keep = chooseKeep(g.table!)
    const made = g.points + tenScore(keep.map((i) => g.table![i]))!
    return { keep, bank: made >= 350 && g.free - keep.length > 0 }
  }
  /**
   * Each side's banked total, counted here from the log: a roll that leaves nothing to keep is
   * followed by the next side's roll and banks nothing; a decision adds what its dice score to the
   * turn, and a bank puts the turn on its side's total and passes the dice.
   */
  const banked = (log: number[][]) => {
    const total = [0, 0]
    let side = 0
    let turn = 0
    let table: number[] | null = null
    for (const e of log) {
      if (e[0] !== 0) {
        if (table) {
          // the roll before scored nothing: a bust, nothing banked, the other side's roll
          side = 1 - side
          turn = 0
        }
        table = e
        continue
      }
      const keep = e.slice(2)
      turn += tenScore(keep.map((i) => table![i]))!
      table = null
      if (e[1] === 1) {
        total[side] += turn
        turn = 0
        side = 1 - side
      }
    }
    return total
  }

  it('begins with the challenger’s first roll on the table, rolled by the server', () => {
    const p = decide(tk(), B, { op: 'accept' })
    if (p.kind !== 'begin') throw new Error('refused')
    const g = game(p.state)
    expect(p.turn).toBe(g.turn)
    expect(g.table).not.toBeNull()
  })

  it('plays versus to the end, the winner first to bank ten thousand, the totals what the log banked', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 8; seed++) {
      vi.spyOn(Math, 'random').mockImplementation(seeded(seed * 13))
      const { row, plans } = playOut(tk(), (r) => decisionFor(r.state), 4000)
      vi.restoreAllMocks()
      expect(row.status).toBe('finished')
      const last = plans.at(-1)!
      if (last.kind !== 'commit') throw new Error('refused')
      const log = (last.state as { log: number[][] }).log
      const t = banked(log)
      const w = last.result!.winner as 0 | 1
      expect(t[w]).toBeGreaterThanOrEqual(10_000)
      expect(t[1 - w]).toBeLessThan(10_000)
      expect(game(last.state).scores).toEqual(t)
      for (const p of plans)
        if (p.kind === 'commit') expect(jsonbBytes(p.state)).toBeLessThanOrEqual(16384)
      seen.add(String(w))
    }
    expect(seen.has('0') && seen.has('1')).toBe(true)
  }, 60000)

  it('together: the computer plays its whole turn in the same call, and the dice come back rolled', () => {
    vi.spyOn(Math, 'random').mockImplementation(seeded(5))
    const start = tk({ mode: 'together', settings: { level: 'fair' } })
    let row = after(start, decide(start, B, { op: 'accept' }))
    let replied = 0
    for (let k = 0; k < 40 && row.status === 'active' && replied < 2; k++) {
      const p = decide(row, row.turn === 0 ? A : B, move(row.seq, decisionFor(row.state)))
      expect(p.kind).toBe('commit')
      if (p.kind !== 'commit') break
      row = after(row, p)
      const h = p.move as { then?: unknown[]; replies?: number }
      if (h.then || h.replies) replied++
      // whoever is to move has dice on the table: the server rolled after the computer too
      if (row.status === 'active') expect(game(row.state).table).not.toBeNull()
    }
    expect(replied).toBe(2)
  })

  it('refuses a keep that does not score, a position off the table, out of turn, and a stored log no rolls could make', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => 0.01)
    // all ones: 1 1 1 1 1 1 on the table
    const row = after(tk(), decide(tk(), B, { op: 'accept' }))
    vi.restoreAllMocks()
    expect(game(row.state).table).toEqual([1, 1, 1, 1, 1, 1])
    expect(status(decide(row, A, move(row.seq, { keep: [], bank: true })))).toBe(400)
    expect(status(decide(row, A, move(row.seq, { keep: [6], bank: true })))).toBe(400)
    expect(status(decide(row, B, move(row.seq, { keep: [0], bank: true })))).toBe(409)
    expect(status(decide(row, A, move(row.seq, { keep: [0, 1, 2, 3, 4, 5], bank: true })))).toBe(
      'commit',
    )
    expect(
      status(
        decide(
          { ...row, state: { log: [[7, 1, 1, 1, 1, 1]] } },
          A,
          move(row.seq, { keep: [0], bank: true }),
        ),
      ),
    ).toBe(500)
  })
})

describe('yacht by turns: the server rolls, twelve boxes each', () => {
  const yt = (over: Partial<Row> = {}) => invite({ demo_id: 'yacht', settings: {}, ...over })
  const game = (state: unknown) => yachtReplay(state)!
  const decisionFor = (state: unknown) => {
    const { dice, cards, rolls, turn } = game(state).g
    const keep = rolls > 0 ? yachtKeep(dice, cards[turn], rolls, 'fair') : null
    return keep && !keep.every(Boolean)
      ? { hold: keep }
      : { box: yachtBox(dice, cards[turn], 'fair') }
  }
  /** what five dice score in a box, by the classic rules, written here rather than taken from yacht.ts */
  const boxScore = (d: number[], box: string) => {
    const c = [1, 2, 3, 4, 5, 6].map((f) => d.filter((x) => x === f).length)
    const sum = d.reduce((a, b) => a + b, 0)
    const faces = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes']
    if (faces.includes(box)) return (faces.indexOf(box) + 1) * c[faces.indexOf(box)]
    const sorted = [...d].sort().join('')
    if (box === 'full') return c.includes(3) && c.includes(2) ? sum : 0
    if (box === 'four') {
      const f = c.findIndex((n) => n >= 4)
      return f < 0 ? 0 : (f + 1) * 4
    }
    if (box === 'little') return sorted === '12345' ? 30 : 0
    if (box === 'big') return sorted === '23456' ? 30 : 0
    if (box === 'choice') return sum
    return c.includes(5) ? 50 : 0
  }
  /** each side's total, from the log: the dice as they lay when a box was chosen, scored above */
  const totals = (log: number[][]) => {
    const t = [0, 0]
    let side = 0
    let dice: number[] = []
    const filled = [0, 0]
    for (const e of log) {
      if (e.length === 5) dice = e
      else if (e[0] === 9) {
        t[side] += boxScore(dice, YACHT_CATS[e[1]])
        filled[side]++
        side = filled[1 - side] < 12 ? 1 - side : side
      }
    }
    return t
  }

  it('plays versus to the end, the winner the higher card, every box what its dice score', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 8; seed++) {
      vi.spyOn(Math, 'random').mockImplementation(seeded(seed * 17))
      const { row, plans } = playOut(yt(), (r) => decisionFor(r.state), 400)
      vi.restoreAllMocks()
      expect(row.status).toBe('finished')
      const last = plans.at(-1)!
      if (last.kind !== 'commit') throw new Error('refused')
      const [a, b] = totals((last.state as { log: number[][] }).log)
      expect(last.result!.score).toBe(`${a}–${b}`)
      expect(last.result!.winner).toBe(a > b ? 0 : b > a ? 1 : 'draw')
      seen.add(String(last.result!.winner))
    }
    expect(seen.size).toBeGreaterThan(1)
  }, 60000)

  it('together: the computer plays its whole turn in the same call, and the team’s dice come back rolled', () => {
    for (const level of ['easy', 'fair', 'hard']) {
      vi.spyOn(Math, 'random').mockImplementation(seeded(3))
      const start = yt({ mode: 'together', settings: { level } })
      let row = after(start, decide(start, B, { op: 'accept' }))
      let replied = 0
      for (let k = 0; k < 12 && replied < 2; k++) {
        const p = decide(row, row.turn === 0 ? A : B, move(row.seq, decisionFor(row.state)))
        expect(p.kind).toBe('commit')
        if (p.kind !== 'commit') break
        row = after(row, p)
        const h = p.move as { then?: unknown[]; replies?: number }
        if (h.then || h.replies) {
          replied++
          const g = game(row.state).g
          expect(g.turn).toBe(0)
          expect(g.rolls).toBe(2)
          expect(Object.keys(g.cards[1])).toHaveLength(replied)
        }
      }
      vi.restoreAllMocks()
      expect(replied).toBe(2)
    }
  })

  it('refuses a box filled, a hold with no roll to come, out of turn, and a stored log no rolls could make', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => 0.99)
    const row = after(yt(), decide(yt(), B, { op: 'accept' }))
    vi.restoreAllMocks()
    // five sixes on the table
    expect(game(row.state).g.dice).toEqual([6, 6, 6, 6, 6])
    expect(status(decide(row, A, move(row.seq, { hold: [true, true, true, true, true] })))).toBe(
      400,
    )
    expect(status(decide(row, A, move(row.seq, { box: 'bonus' })))).toBe(400)
    expect(status(decide(row, B, move(row.seq, { box: 'yacht' })))).toBe(409)
    expect(status(decide(row, A, move(row.seq, { box: 'yacht' })))).toBe('commit')
    expect(
      status(
        decide({ ...row, state: { log: [[7, 6, 6, 6, 6]] } }, A, move(row.seq, { box: 'yacht' })),
      ),
    ).toBe(500)
  })
})

describe('shut the box by turns: one box each, the fewer left up wins', () => {
  const sb2 = (over: Partial<Row> = {}) => invite({ demo_id: 'shut', settings: {}, ...over })
  const game = (state: unknown) => shutReplay(state)!
  const decisionFor = (state: unknown) => {
    const g = game(state)
    const up = g.up[g.turn!]
    return g.due === 'dice'
      ? { dice: shutDice(up, 'fair') }
      : {
          shut: shutWay(
            up,
            g.dice.reduce((a, d) => a + d, 0),
            'fair',
            Math.random,
          ),
        }
  }
  /** what each box left up, counted here: every tile shut taken off its side, 45 to start */
  const left = (log: number[][]) => {
    const t = [45, 45]
    let side = 0
    let up = 0b111111111
    for (const e of log) {
      if (e[0] === 0) {
        for (let k = 1; k <= 9; k++) if (e[1] & (1 << (k - 1))) t[side] -= k
        up &= ~e[1]
        if (up === 0) {
          side = 1
          up = 0b111111111
        }
      } else if (e[0] !== 9) {
        // a roll: if the tiles up cannot make it, that box is over
        const total = e.reduce((a, d) => a + d, 0)
        let can = false
        for (let s = up; s > 0; s = (s - 1) & up) {
          let n = 0
          for (let k = 1; k <= 9; k++) if (s & (1 << (k - 1))) n += k
          if (n === total) can = true
        }
        if (!can) {
          side = 1
          up = 0b111111111
        }
      }
    }
    return t
  }

  it('plays versus to the end, the winner the box with less left up', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 10; seed++) {
      vi.spyOn(Math, 'random').mockImplementation(seeded(seed * 19))
      const { row, plans } = playOut(sb2(), (r) => decisionFor(r.state), 200)
      vi.restoreAllMocks()
      expect(row.status).toBe('finished')
      const last = plans.at(-1)!
      if (last.kind !== 'commit') throw new Error('refused')
      const [a, b] = left((last.state as { log: number[][] }).log)
      expect(last.result!.score).toBe(`${a}–${b}`)
      expect(last.result!.winner).toBe(a < b ? 0 : b < a ? 1 : 'draw')
      seen.add(String(last.result!.winner))
    }
    expect(seen.size).toBeGreaterThan(1)
  })

  it('together: once the team’s box is done, the computer plays its whole box in the same call', () => {
    for (const level of ['easy', 'fair', 'hard']) {
      vi.spyOn(Math, 'random').mockImplementation(seeded(4))
      const start = sb2({ mode: 'together', settings: { level } })
      let row = after(start, decide(start, B, { op: 'accept' }))
      for (let k = 0; k < 40 && row.status === 'active'; k++) {
        const p = decide(row, row.turn === 0 ? A : B, move(row.seq, decisionFor(row.state)))
        expect(p.kind).toBe('commit')
        if (p.kind !== 'commit') break
        row = after(row, p)
      }
      vi.restoreAllMocks()
      // the computer never waits on anybody: the match ends as the team's box does
      expect(row.status).toBe('finished')
      expect(game(row.state).turn).toBeNull()
    }
  })

  it('refuses tiles that do not make the roll, one die while the 9 is up, out of turn, and a stored log no rolls could make', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => 0.6)
    const row = after(sb2(), decide(sb2(), B, { op: 'accept' }))
    vi.restoreAllMocks()
    // 4 + 4 = 8 on the table
    expect(game(row.state).dice).toEqual([4, 4])
    expect(status(decide(row, A, move(row.seq, { shut: 1 << 8 })))).toBe(400)
    expect(status(decide(row, A, move(row.seq, { dice: 1 })))).toBe(400)
    expect(status(decide(row, B, move(row.seq, { shut: 1 << 7 })))).toBe(409)
    expect(status(decide(row, A, move(row.seq, { shut: 1 << 7 })))).toBe('commit')
    expect(
      status(
        decide(
          {
            ...row,
            state: {
              log: [
                [4, 4],
                [0, 1 << 8],
              ],
            },
          },
          A,
          move(row.seq, { shut: 1 << 7 }),
        ),
      ),
    ).toBe(500)
  })
})

describe('codebreaker by turns: a race to crack each other’s hidden code', () => {
  const settings = { length: 4, colours: 6, repeats: true, tries: 10 }
  const cb2 = (over: Partial<Row> = {}) => invite({ demo_id: 'codebreaker', settings, ...over })
  /** a code's marks, counted here: pegs in place, then the colours both share less those */
  const marks = (code: number[], guess: number[]) => {
    const exact = code.filter((c, i) => guess[i] === c).length
    let shared = 0
    for (let c = 0; c < 6; c++)
      shared += Math.min(code.filter((x) => x === c).length, guess.filter((x) => x === c).length)
    return [exact, shared - exact]
  }
  const mine = (row: Row, who: string) => {
    const p = decide(row, who, { op: 'mine' })
    if (p.kind !== 'mine') throw new Error('refused')
    return p.data
  }
  const BO = [1, 2, 3, 4]
  const AN = [5, 5, 0, 1]
  const begun = () => after(cb2(), decide(cb2(), B, { op: 'accept', brought: BO }))

  it('takes the friend’s code with their yes and the challenger’s with the first guess, and shows each only their own', () => {
    expect(status(decide(cb2(), B, { op: 'accept' }))).toBe(400)
    expect(status(decide(cb2(), B, { op: 'accept', brought: [1, 2, 3] }))).toBe(400)
    expect(status(decide(cb2(), B, { op: 'accept', brought: [1, 2, 3, 6] }))).toBe(400)
    let row = begun()
    expect(row.state).toEqual({ placed: [false, true], guesses: [] })
    expect(mine(row, B)).toEqual(BO)
    expect(mine(row, A)).toBeNull()
    expect(status(decide(row, A, move(row.seq, { guess: [0, 0, 0, 0] })))).toBe(400)
    const p = decide(row, A, move(row.seq, { guess: [1, 2, 0, 0], code: AN }))
    if (p.kind !== 'commit') throw new Error('refused')
    expect(p.move).toEqual({ m: { guess: [1, 2, 0, 0] } })
    row = after(row, p)
    // marked against Bo's code, and Ann's kept back: no code in the state
    expect(row.state).toEqual({
      placed: [true, true],
      guesses: [[1, 2, 0, 0, ...marks(BO, [1, 2, 0, 0])]],
    })
    expect(mine(row, A)).toEqual(AN)
    expect(mine(row, B)).toEqual(BO)
  })

  it('gives the second guesser as many guesses as the first took, then shows both codes', () => {
    let row = begun()
    // Ann cracks it at once; Bo still gets his one guess, and misses
    row = after(row, decide(row, A, move(row.seq, { guess: BO, code: AN })))
    expect(row.status).toBe('active')
    expect(row.turn).toBe(1)
    const p = decide(row, B, move(row.seq, { guess: [0, 0, 0, 0] }))
    if (p.kind !== 'commit') throw new Error('refused')
    expect(p.result).toEqual({ winner: 0, score: '1–uncracked' })
    row = after(row, p)
    expect((row.state as { codes?: unknown }).codes).toEqual([AN, BO])
    // and had he matched it in as many, it would be a draw
    let tie = begun()
    tie = after(tie, decide(tie, A, move(tie.seq, { guess: BO, code: AN })))
    const q = decide(tie, B, move(tie.seq, { guess: AN }))
    if (q.kind !== 'commit') throw new Error('refused')
    expect(q.result).toEqual({ winner: 'draw', score: '1–1' })
  })

  it('races versus to the end, the winner whoever cracked it in fewer, every mark what the codes give', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 10; seed++) {
      const rnd = seeded(seed)
      const code = () => Array.from({ length: 4 }, () => Math.floor(rnd() * 6))
      const codes = [code(), code()]
      let row = after(cb2(), decide(cb2(), B, { op: 'accept', brought: codes[1] }))
      const first = { done: false }
      for (let k = 0; k < 40 && row.status === 'active'; k++) {
        const who = row.turn as 0 | 1
        // a guess a little better than random: now and then the code itself
        const guess = rnd() < 0.12 ? codes[1 - who] : code()
        const m = who === 0 && !first.done ? { guess, code: codes[0] } : { guess }
        first.done ||= who === 0
        const p = decide(row, who === 0 ? A : B, move(row.seq, m))
        expect(p.kind).toBe('commit')
        if (p.kind !== 'commit') break
        row = after(row, p)
      }
      expect(row.status).toBe('finished')
      const st = row.state as { guesses: number[][]; codes: number[][] }
      expect(st.codes).toEqual(codes)
      // who guessed each, by the race's rule, and every mark what the codes give
      const n = [0, 0]
      const took: (number | null)[] = [null, null]
      for (const g of st.guesses) {
        const by =
          n[0] > n[1] && took[1] === null
            ? 1
            : took[0] !== null
              ? 1
              : took[1] !== null
                ? 0
                : n[1] < n[0]
                  ? 1
                  : 0
        n[by]++
        expect(g.slice(4)).toEqual(marks(codes[1 - by], g.slice(0, 4)))
        if (g[4] === 4 && took[by] === null) took[by] = n[by]
      }
      const [a, b] = took
      const winner =
        a === null && b === null
          ? 'draw'
          : b === null || (a !== null && a < b)
            ? 0
            : a === null || b < a
              ? 1
              : 'draw'
      expect(row.status === 'finished' && winner).toBe(winner)
      seen.add(String(winner))
    }
    expect(seen.size).toBeGreaterThan(1)
  })

  it('refuses a stored race whose marks the codes do not give', () => {
    let row = begun()
    row = after(row, decide(row, A, move(row.seq, { guess: [1, 2, 0, 0], code: AN })))
    const st = row.state as { placed: boolean[]; guesses: number[][] }
    const wrong = { ...st, guesses: [[1, 2, 0, 0, 0, 0]] }
    expect(
      status(decide({ ...row, state: wrong }, B, move(row.seq, { guess: [0, 0, 0, 0] }))),
    ).toBe(500)
    // nor will a browser believe codes shown before the race is over
    expect(
      status(
        decide(
          { ...row, state: { ...st, codes: [AN, BO] } },
          B,
          move(row.seq, { guess: [0, 0, 0, 0] }),
        ),
      ),
    ).toBe(500)
  })

  it('together: the computer’s code is chosen on the server, and it cracks the team’s in the same call, at every level', () => {
    for (const level of ['easy', 'fair', 'hard']) {
      const start = cb2({ mode: 'together', settings: { ...settings, level } })
      const p0 = decide(start, B, { op: 'accept' })
      if (p0.kind !== 'begin') throw new Error('refused')
      const cpu = (p0.secret as { codes: (number[] | null)[] }).codes[1]
      expect(cpu).toHaveLength(4)
      let row = after(start, p0)
      expect(mine(row, A)).toBeNull()
      const p = decide(row, A, move(row.seq, { guess: [0, 1, 2, 3], code: AN }))
      if (p.kind !== 'commit') throw new Error('refused')
      row = after(row, p)
      const st = row.state as { guesses: number[][] }
      // the team's guess, then the computer's at the team's code
      expect(st.guesses).toHaveLength(2)
      expect(st.guesses[1].slice(4)).toEqual(marks(AN, st.guesses[1].slice(0, 4)))
    }
  })
})

describe('shadow box by turns: each rebuilds the other’s hidden box, scored over par', () => {
  const sb2 = (over: Partial<Row> = {}, rounds = 1) =>
    invite({ demo_id: 'shadowbox', settings: { rounds }, ...over })
  const WALLS = { front: true, side: true, top: false }
  const build = (cells: [number, number, number][]) => {
    const b = Array(25).fill(0)
    for (const [x, z, h] of cells) b[z * 5 + x] = h
    return b
  }
  // Bo's: a 3 and a 2 in different columns and rows (par 5); Ann's: two 2s (par 4)
  const BO = {
    build: build([
      [1, 1, 3],
      [3, 2, 2],
    ]),
    show: WALLS,
  }
  const AN = {
    build: build([
      [0, 0, 2],
      [2, 2, 2],
    ]),
    show: WALLS,
  }
  const mine = (row: Row, who: string) => {
    const p = decide(row, who, { op: 'mine' })
    if (p.kind !== 'mine') throw new Error('refused')
    return p.data
  }
  const begun = (rounds = 1) =>
    after(sb2({}, rounds), decide(sb2({}, rounds), B, { op: 'accept', brought: BO }))

  it('takes the friend’s box with the yes and the challenger’s with the first move, and shows each only theirs', () => {
    expect(status(decide(sb2(), B, { op: 'accept' }))).toBe(400)
    expect(
      status(
        decide(sb2(), B, { op: 'accept', brought: { build: Array(25).fill(0), show: WALLS } }),
      ),
    ).toBe(400)
    let row = begun()
    expect(JSON.stringify(row.state)).not.toContain('"build"')
    expect(mine(row, B)).toEqual([BO])
    expect(mine(row, A)).toEqual([])
    // a rebuild that is Bo's own box is fine — it throws its shadows — but the box must come too
    expect(status(decide(row, A, move(row.seq, { rebuild: BO.build })))).toBe(400)
    const p = decide(row, A, move(row.seq, { rebuild: BO.build, box: AN }))
    if (p.kind !== 'commit') throw new Error('refused')
    expect(p.move).toEqual({ m: { rebuild: BO.build } })
    row = after(row, p)
    expect(JSON.stringify(row.state)).not.toContain('"build"')
    expect(mine(row, A)).toEqual([AN])
    expect(mine(row, B)).toEqual([BO])
  })

  it('ends when both have rebuilt, the fewer over par winning, and shows the boxes', () => {
    let row = begun()
    // Ann rebuilds Bo's at par (5); Bo rebuilds Ann's with a block to spare, inside both shadows
    const extra = build([
      [0, 0, 2],
      [2, 2, 2],
      [0, 2, 1],
    ])
    row = after(row, decide(row, A, move(row.seq, { rebuild: BO.build, box: AN })))
    expect(status(decide(row, B, move(row.seq, { rebuild: extra, box: BO })))).toBe(400)
    const p = decide(row, B, move(row.seq, { rebuild: extra }))
    if (p.kind !== 'commit') throw new Error('refused')
    expect(p.result).toEqual({ winner: 0, score: '0–1' })
    row = after(row, p)
    expect((row.state as { boxes?: unknown }).boxes).toEqual([[AN], [BO]])
    // at par both ways it is a draw
    let tie = begun()
    tie = after(tie, decide(tie, A, move(tie.seq, { rebuild: BO.build, box: AN })))
    const q = decide(tie, B, move(tie.seq, { rebuild: AN.build }))
    if (q.kind !== 'commit') throw new Error('refused')
    expect(q.result).toEqual({ winner: 'draw', score: '0–0' })
  })

  it('refuses a stored match whose shadows its boxes do not throw, or boxes shown early', () => {
    let row = begun(3)
    row = after(row, decide(row, A, move(row.seq, { rebuild: BO.build, box: AN })))
    const st = row.state as { clues: { front: number[] }[][]; rebuilds: string[][] }
    const lied = { ...st, clues: [[{ ...st.clues[0][0], front: [3, 0, 0, 0, 0] }], st.clues[1]] }
    const sideLied = {
      ...lied,
      clues: [[{ ...lied.clues[0][0], side: [3, 0, 0, 0, 0] }], st.clues[1]],
    }
    expect(
      status(
        decide(
          { ...row, state: sideLied },
          B,
          move(row.seq, { rebuild: build([[0, 0, 3]]), box: BO }),
        ),
      ),
    ).toBe(500)
    expect(
      status(
        decide(
          { ...row, state: { ...st, boxes: [[AN], [BO]] } },
          B,
          move(row.seq, { rebuild: AN.build, box: BO }),
        ),
      ),
    ).toBe(500)
  })

  it('together: the computer’s box is chosen on the server, and it rebuilds the team’s with its next box in the same call', () => {
    for (const level of ['easy', 'fair', 'hard']) {
      const start = invite({
        demo_id: 'shadowbox',
        mode: 'together',
        settings: { rounds: 3, level },
      })
      const p0 = decide(start, B, { op: 'accept' })
      if (p0.kind !== 'begin') throw new Error('refused')
      const cpu = (p0.secret as { boxes: { build: number[] }[][] }).boxes[1][0]
      expect(cpu.build).toHaveLength(25)
      let row = after(start, p0)
      const st0 = row.state as { clues: { front: number[] }[][] }
      // the team rebuilds the computer's box from its shadows alone, with the fullest stacks
      const c = st0.clues[1][0] as unknown as { front: number[]; side: number[]; top?: string }
      const full = Array.from({ length: 25 }, (_, i) =>
        c.top && c.top[i] === '0' ? 0 : Math.min(c.front[i % 5], c.side[Math.floor(i / 5)]),
      )
      const p = decide(row, A, move(row.seq, { rebuild: full, box: AN }))
      if (p.kind !== 'commit') throw new Error(`refused at ${level}`)
      row = after(row, p)
      const st = row.state as { rebuilds: string[][]; clues: unknown[][] }
      // the computer's rebuild of Ann's box, and its second box, in the same call
      expect(st.rebuilds[1]).toHaveLength(1)
      expect(st.clues[1]).toHaveLength(2)
      expect(st.rebuilds[1][0].replace(/0/g, '').length).toBeGreaterThan(0)
      expect(String(row.turn)).toBe('1')
    }
  })
})

describe('rock, paper, scissors by turns: the first move of each round sealed', () => {
  const rp = (over: Partial<Row> = {}) => invite({ demo_id: 'rps', settings: {}, ...over })
  const mine = (row: Row, who: string) => {
    const p = decide(row, who, { op: 'mine' })
    if (p.kind !== 'mine') throw new Error('refused')
    return p.data
  }
  const begun = () => after(rp(), decide(rp(), B, { op: 'accept' }))

  it('keeps the challenger’s move from the state and the history, and shows it only to them', () => {
    let row = begun()
    expect(row.state).toEqual({ rounds: [], sealed: false })
    const p = decide(row, A, move(row.seq, { play: 1 }))
    if (p.kind !== 'commit') throw new Error('refused')
    expect(p.move).toEqual({ m: {} })
    row = after(row, p)
    expect(row.state).toEqual({ rounds: [], sealed: true })
    expect(row.turn).toBe(1)
    expect(mine(row, A)).toBe(1)
    expect(mine(row, B)).toBeNull()
    // Bo answers: the round is shown whole
    row = after(row, decide(row, B, move(row.seq, { play: 0 })))
    expect(row.state).toEqual({ rounds: [[1, 0]], sealed: false })
    expect(row.turn).toBe(0)
  })

  it('ends at the first to three, the score the rounds won', () => {
    let row = begun()
    // Ann: paper, paper, rock, paper; Bo: rock, scissors, scissors, rock
    for (const [a, b] of [
      [1, 0],
      [1, 2],
      [0, 2],
    ]) {
      row = after(row, decide(row, A, move(row.seq, { play: a })))
      row = after(row, decide(row, B, move(row.seq, { play: b })))
    }
    expect(row.status).toBe('active')
    row = after(row, decide(row, A, move(row.seq, { play: 1 })))
    const p = decide(row, B, move(row.seq, { play: 0 }))
    if (p.kind !== 'commit') throw new Error('refused')
    expect(p.result).toEqual({ winner: 0, score: '3–1' })
  })

  it('refuses a stored match whose sealed move and state disagree', () => {
    let row = begun()
    row = after(row, decide(row, A, move(row.seq, { play: 1 })))
    expect(
      status(decide({ ...row, secret: { pending: null } }, B, move(row.seq, { play: 0 }))),
    ).toBe(500)
    expect(
      status(
        decide({ ...row, state: { rounds: [], sealed: false } }, B, move(row.seq, { play: 0 })),
      ),
    ).toBe(500)
  })

  it('together: the computer answers the team in the same call, at every level, the round shown whole', () => {
    for (const level of ['easy', 'fair', 'hard']) {
      const start = rp({ mode: 'together', settings: { level } })
      let row = after(start, decide(start, B, { op: 'accept' }))
      const p = decide(row, A, move(row.seq, { play: 2 }))
      if (p.kind !== 'commit') throw new Error('refused')
      expect(p.move).toEqual({ m: {}, then: [{}] })
      row = after(row, p)
      const st = row.state as { rounds: number[][]; sealed: boolean }
      expect(st.sealed).toBe(false)
      expect(st.rounds).toHaveLength(1)
      expect(st.rounds[0][0]).toBe(2)
      expect(row.turn).toBe(1)
    }
  })
})

describe('gin rummy by turns: the hands kept back, dealt by the server', () => {
  const gn = (over: Partial<Row> = {}) => invite({ demo_id: 'gin', settings: {}, ...over })
  const mine = (row: Row, who: string) => {
    const p = decide(row, who, { op: 'mine' })
    if (p.kind !== 'mine') throw new Error('refused')
    return p.data as number[]
  }
  type Sec = { hands: number[][]; stock: number[] }

  it('deals with the yes, and shows each player their own hand and nobody the other’s', () => {
    const p0 = decide(gn(), B, { op: 'accept' })
    if (p0.kind !== 'begin') throw new Error('refused')
    const sec = p0.secret as Sec
    expect(sec.hands[0]).toHaveLength(10)
    expect(sec.hands[1]).toHaveLength(10)
    expect(JSON.stringify(p0.state)).not.toMatch(/hands|"stock"/)
    const row = after(gn(), p0)
    expect(mine(row, A)).toEqual(sec.hands[0])
    expect(mine(row, B)).toEqual(sec.hands[1])
  })

  it('takes a draw and then a discard from the same player, the stock’s card seen only by them', () => {
    let row = after(gn(), decide(gn(), B, { op: 'accept' }))
    const before = row.secret as Sec
    const p = decide(row, A, move(row.seq, { draw: 'stock' }))
    if (p.kind !== 'commit') throw new Error('refused')
    expect(p.move).toEqual({ m: { draw: 'stock' } })
    row = after(row, p)
    expect(row.turn).toBe(0)
    const drawn = before.stock[0]
    expect(mine(row, A)).toContain(drawn)
    expect(JSON.stringify(row.state)).not.toContain(`${drawn},`)
    // a card Ann does not hold, or a knock she cannot make, is refused
    expect(
      status(decide(row, A, move(row.seq, { discard: before.hands[1][0], knock: false }))),
    ).toBe(400)
    const q = decide(row, A, move(row.seq, { discard: drawn, knock: false }))
    if (q.kind !== 'commit') throw new Error('refused')
    row = after(row, q)
    expect(row.turn).toBe(1)
    expect((row.state as { pile: number[] }).pile.at(-1)).toBe(drawn)
  })

  it('refuses a stored hand that is not one deck with the table', () => {
    const row = after(gn(), decide(gn(), B, { op: 'accept' }))
    const sec = row.secret as Sec
    const twice = { ...sec, stock: [...sec.stock.slice(1), sec.hands[1][0]] }
    expect(status(decide({ ...row, secret: twice }, A, move(row.seq, { draw: 'stock' })))).toBe(500)
  })

  it('together: the friends take the team’s half-turns in turn, and the computer its whole turn in the same call', () => {
    for (const level of ['easy', 'fair', 'hard']) {
      const start = gn({ mode: 'together', settings: { level } })
      let row = after(start, decide(start, B, { op: 'accept' }))
      row = after(row, decide(row, A, move(row.seq, { draw: 'stock' })))
      // Bo throws: the team's second half-turn is his
      expect(row.turn).toBe(1)
      const hand = mine(row, B)
      const st = row.state as { took: number | null }
      const p = decide(
        row,
        B,
        move(row.seq, { discard: hand.find((c) => c !== st.took)!, knock: false }),
      )
      if (p.kind !== 'commit') throw new Error(`refused at ${level}`)
      // the computer's draw and discard came back with it, unless its draw ended the hand
      const replies = (p.move as { then?: unknown[] }).then ?? []
      expect(replies.length).toBeGreaterThanOrEqual(2)
      row = after(row, p)
      expect(row.turn).toBe(0)
    }
  })
})

describe('cribbage by turns: hands and crib kept back until the show', () => {
  const cb = (over: Partial<Row> = {}) => invite({ demo_id: 'cribbage', settings: {}, ...over })
  type Mine = { hand: number[]; kept: number[] | null; thrown: number[] | null }
  const mine = (row: Row, who: string) => {
    const p = decide(row, who, { op: 'mine' })
    if (p.kind !== 'mine') throw new Error('refused')
    return p.data as Mine
  }

  it('deals six each with the yes, seals a throw until both are in, and logs no throw', () => {
    let row = after(cb(), decide(cb(), B, { op: 'accept' }))
    const a = mine(row, A).hand
    const b = mine(row, B).hand
    expect(a).toHaveLength(6)
    expect(b.some((c) => a.includes(c))).toBe(false)
    expect((row.state as { starter: unknown }).starter).toBeNull()
    expect(status(decide(row, A, move(row.seq, { throw: [b[0], b[1]] })))).toBe(400)
    const p = decide(row, A, move(row.seq, { throw: [a[0], a[1]] }))
    if (p.kind !== 'commit') throw new Error('refused')
    expect(p.move).toEqual({ m: { throw: 'face down' } })
    row = after(row, p)
    expect(row.turn).toBe(1)
    expect(mine(row, A).thrown).toEqual([a[0], a[1]])
    expect(mine(row, B).thrown).toBeNull()
    expect(JSON.stringify(row.state)).not.toContain(`[${a[0]},${a[1]}]`)
    row = after(row, decide(row, B, move(row.seq, { throw: [b[0], b[1]] })))
    // both in: the starter is cut, and the challenger leads
    const st = row.state as { starter: number; phase: string }
    expect(st.phase).toBe('peg')
    expect(typeof st.starter).toBe('number')
    expect(row.turn).toBe(0)
    expect(mine(row, A).kept).toEqual(a.slice(2))
  })

  it('refuses a stored hand whose pegs its cards did not make', () => {
    let row = after(cb(), decide(cb(), B, { op: 'accept' }))
    const a = mine(row, A).hand
    const b = mine(row, B).hand
    row = after(row, decide(row, A, move(row.seq, { throw: [a[0], a[1]] })))
    row = after(row, decide(row, B, move(row.seq, { throw: [b[0], b[1]] })))
    const st = row.state as { scores: number[] }
    const lied = { ...st, scores: [st.scores[0] + 2, st.scores[1]] }
    expect(status(decide({ ...row, state: lied }, A, move(row.seq, { peg: a[2] })))).toBe(500)
  })

  it('together: the computer throws and pegs in the same call, at every level', () => {
    for (const level of ['easy', 'fair', 'hard']) {
      const start = cb({ mode: 'together', settings: { level } })
      let row = after(start, decide(start, B, { op: 'accept' }))
      const a = mine(row, A).hand
      const p = decide(row, A, move(row.seq, { throw: [a[0], a[1]] }))
      if (p.kind !== 'commit') throw new Error(`refused at ${level}`)
      // the computer deals the first hand: it throws, the starter is cut, and the team leads
      expect((p.move as { then?: unknown[] }).then).toEqual([{ throw: 'face down' }])
      row = after(row, p)
      expect((row.state as { phase: string }).phase).toBe('peg')
      // Bo leads for the team, and the computer answers with a card
      const hand = mine(row, B).hand
      const q = decide(row, B, move(row.seq, { peg: hand[0] }))
      if (q.kind !== 'commit') throw new Error(`refused at ${level}`)
      expect(((q.move as { then?: unknown[] }).then ?? []).length).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('dominoes by turns: the hands and boneyard kept back', () => {
  const dm = (over: Partial<Row> = {}) => invite({ demo_id: 'dominoes', settings: {}, ...over })
  const mine = (row: Row, who: string) => {
    const p = decide(row, who, { op: 'mine' })
    if (p.kind !== 'mine') throw new Error('refused')
    return p.data as number[][]
  }
  type Sec = { hands: number[][][]; yard: number[][] }

  it('deals with the yes, and shows each player their own hand only', () => {
    const p0 = decide(dm(), B, { op: 'accept' })
    if (p0.kind !== 'begin') throw new Error('refused')
    const sec = p0.secret as Sec
    expect(JSON.stringify(p0.state)).not.toMatch(/hands|"yard"/)
    const row = after(dm(), p0)
    expect(mine(row, A)).toEqual(sec.hands[0])
    expect(mine(row, B)).toEqual(sec.hands[1])
  })

  it('takes a lay of a tile Ann holds, and refuses one she does not', () => {
    let row = after(dm(), decide(dm(), B, { op: 'accept' }))
    const sec = row.secret as Sec
    expect(status(decide(row, A, move(row.seq, { lay: sec.hands[1][0], side: 'right' })))).toBe(400)
    const p = decide(row, A, move(row.seq, { lay: sec.hands[0][0], side: 'right' }))
    if (p.kind !== 'commit') throw new Error('refused')
    expect(p.move).toEqual({ m: { lay: sec.hands[0][0], side: 'right' } })
    row = after(row, p)
    expect(row.turn).toBe(1)
    expect((row.state as { sizes: number[] }).sizes).toEqual([6, 7])
  })

  it('refuses a stored round that is not one set with the line', () => {
    const row = after(dm(), decide(dm(), B, { op: 'accept' }))
    const sec = row.secret as Sec
    const twice = { ...sec, yard: [...sec.yard.slice(1), sec.hands[1][0]] }
    expect(
      status(
        decide(
          { ...row, secret: twice },
          A,
          move(row.seq, { lay: sec.hands[0][0], side: 'right' }),
        ),
      ),
    ).toBe(500)
  })

  it('together: the computer answers in the same call, at every level', () => {
    for (const level of ['easy', 'fair', 'hard']) {
      const start = dm({ mode: 'together', settings: { level } })
      let row = after(start, decide(start, B, { op: 'accept' }))
      const hand = mine(row, A)
      const p = decide(row, A, move(row.seq, { lay: hand[0], side: 'right' }))
      if (p.kind !== 'commit') throw new Error(`refused at ${level}`)
      expect(((p.move as { then?: unknown[] }).then ?? []).length).toBeGreaterThanOrEqual(1)
      row = after(row, p)
      expect(row.turn).toBe(1)
      expect((row.state as { line: unknown[] }).line.length).toBeGreaterThanOrEqual(1)
    }
  })
})
