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

/** the match after `plan`, as lab_match_begin or lab_match_commit would leave it */
function after(row: Row, plan: Plan): Row {
  if (plan.kind === 'begin') return { ...row, status: 'active', state: plan.state, turn: plan.turn }
  if (plan.kind === 'commit')
    return {
      ...row,
      seq: row.seq + 1,
      state: plan.state,
      turn: plan.turn,
      status: plan.result ? 'finished' : 'active',
    }
  throw new Error(`refused: ${plan.status} ${plan.error}`)
}

const status = (p: Plan) => (p.kind === 'refuse' ? p.status : p.kind)
const move = (at: number, m: unknown): Ask => ({ op: 'move', at, move: m })

describe('reading a request', () => {
  it('takes an accept or a move, and nothing else', () => {
    expect(readAsk({ op: 'accept', match: MATCH })).toEqual({ match: MATCH, ask: { op: 'accept' } })
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
    for (const f of files) {
      const body = /lab_match_playable\(p_demo text\)[\s\S]*?select p_demo in \(([^)]*)\)/.exec(
        readFileSync(f.url, 'utf8'),
      )
      if (body && (!newest || f.at > newest.at))
        newest = { at: f.at, list: body[1].split(',').map((x) => x.trim().replace(/'/g, '')) }
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
