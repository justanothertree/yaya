import { afterEach, describe, expect, it, vi } from 'vitest'
import { HOLD_MS } from '../social/room'
import {
  CODE,
  PACE_MS,
  act,
  captainOf,
  chairOf,
  codeFrom,
  dueAt,
  hostOf,
  openChairs,
  present,
  readChairs,
  receive,
  seatedHumans,
  startable,
  teamOf,
  wireOf,
  type Ask,
  type Chairs,
  type Live,
  type LiveRules,
} from './chairs'

/*
 * The plan's cast, with the dev call's ids: Bo …0001 < Ann …0002 < Cy …0003 < Dee …0004 < Eve
 * …0005. Nobody sits in id order and nobody opens the toy in it, so no expectation here can pass
 * by sorting.
 */
const BO = '00000000-0000-0000-0000-000000000001'
const ANN = '00000000-0000-0000-0000-000000000002'
const CY = '00000000-0000-0000-0000-000000000003'
const DEE = '00000000-0000-0000-0000-000000000004'
const EVE = '00000000-0000-0000-0000-000000000005'

type Opts = { target: 200 | 300 | 500 }
type Result = { won: 0 | 1; score: [number, number] }
const readOpts = (x: unknown): Opts | null => {
  const o = x as Partial<Opts> | null
  return o && typeof o === 'object' && [200, 300, 500].includes(o.target as number)
    ? { target: o.target as Opts['target'] }
    : null
}
const readResult = (x: unknown): Result | null => {
  const r = x as Partial<Result> | null
  return r &&
    typeof r === 'object' &&
    (r.won === 0 || r.won === 1) &&
    Array.isArray(r.score) &&
    r.score.length === 2 &&
    r.score.every((n) => Number.isInteger(n))
    ? { won: r.won, score: [r.score[0], r.score[1]] }
    : null
}
/* a card game for four, as Spades will be: a computer in a chair, and a watcher may take a
   computer's cards over mid-hand */
const cards: LiveRules<Opts> = {
  sub: 'cards',
  n: 4,
  modes: ['versus', 'together'],
  levels: ['easy', 'fair', 'hard'],
  readOpts,
  fresh: { target: 300 },
  canStart: (c) =>
    c.chairs.filter((ch) => ch.id !== null || ch.cpu !== null).length >= 2
      ? null
      : 'Cards needs two players: take a chair, or add a computer.',
  takeMidRound: true,
  readResult,
}
/* the same table where nobody takes a chair mid-round, as Stackfall */
const race: LiveRules<Opts> = { ...cards, sub: 'race', takeMidRound: false }
/* two chairs, one side and no computer, as Night crossing */
const boat: LiveRules<Opts> = {
  ...cards,
  sub: 'boat',
  n: 2,
  modes: ['together'],
  levels: null,
  takeMidRound: false,
  canStart: (c) => (seatedHumans(c).length === 2 ? null : 'Boat needs a pilot and a keeper.'),
}

type Sent = { from: string; body: Live }

/**
 * Several people on one toy and one call, and the wire between them: room.test.ts's network, with
 * a call roster beside who is on the toy, and a clock the host's pacing reads.
 */
function table<O>(rules: LiveRules<O>, ids: string[], onCall: string[] = ids) {
  const tabs = new Map<string, Chairs<O>>()
  const wire: Sent[] = []
  /** everything anybody ever sent, in order */
  const log: Sent[] = []
  let now = 0
  let call = [...onCall]
  const send = (from: string, out: Live[]) => {
    for (const body of out) {
      wire.push({ from, body })
      log.push({ from, body })
    }
  }
  const set = (id: string, s: { table: Chairs<O>; out: Live[] }) => {
    tabs.set(id, s.table)
    send(id, s.out)
  }
  const t = {
    tabs,
    wire,
    log,
    get: (id: string) => tabs.get(id)!,
    now: () => now,
    open(id: string) {
      set(id, openChairs(rules, id))
    },
    /** who is on the call */
    call(ids: string[]) {
      call = [...ids]
    },
    /** everybody in `here` whose toy is open sees everybody in `here` on it */
    see(here: string[] = [...tabs.keys()]) {
      for (const id of here) if (tabs.has(id)) t.look(id, here)
    },
    /** one tab sees `here` on the toy */
    look(id: string, here: string[]) {
      set(id, present(t.get(id), here, call, now))
    },
    /** the clock, for everybody in `alive`: each sees who they saw */
    tick(alive: string[] = [...tabs.keys()]) {
      for (const id of alive) set(id, present(t.get(id), t.get(id).present, call, now))
    },
    /** deliver everything queued, to everyone alive but its sender, until the wire is quiet */
    flush(alive: string[] = [...tabs.keys()]) {
      for (let guard = 0; wire.length && guard < 5000; guard++) {
        const { from, body } = wire.shift()!
        for (const id of alive)
          if (id !== from && tabs.has(id)) set(id, receive(rules, t.get(id), from, body, now))
      }
    },
    /** a second on: everything delivered, anything held sent and delivered */
    settle(alive?: string[]) {
      t.flush(alive)
      now += PACE_MS
      t.tick(alive)
      t.flush(alive)
    },
    do(id: string, a: Ask<O>) {
      set(id, act(rules, t.get(id), a, now))
    },
    later(ms: number) {
      now += ms
    },
    /** every tab in `ids` holds the same table, and works out the same captain from it */
    agree(ids: string[] = [...tabs.keys()]) {
      const of = (id: string) => {
        const c = t.get(id)
        return JSON.stringify([
          c.seq,
          c.chairs,
          c.mode,
          c.opts,
          c.code,
          c.knew,
          c.round,
          captainOf(c),
        ])
      }
      return ids.every((id) => of(id) === of(ids[0]))
    },
    /** who sits where, as one tab holds it */
    who: (id: string) => t.get(id).chairs.map((ch) => ch.id),
    /** messages of one kind put on the wire since `from` (an index into the log) */
    sent: (kind: string, from = 0) => log.slice(from).filter((m) => m.body.t === kind).length,
  }
  for (const id of ids) t.open(id)
  return t
}
type Net = ReturnType<typeof table<Opts>>

/** Cy sits first, at North (2); Ann sits second, at South (0); everybody else watches */
function seated(rules: LiveRules<Opts> = cards, ids = [DEE, CY, BO, ANN]): Net {
  const t = table(rules, ids)
  t.see()
  t.settle()
  t.do(CY, { t: 'sit', chair: 2 })
  t.settle()
  t.do(ANN, { t: 'sit', chair: 0 })
  t.settle()
  return t
}

/** the last state `id` put on the wire */
const lastState = (t: Net, id: string): Sent =>
  t.log.filter((m) => m.from === id && m.body.t === 'state').at(-1)!
const RESULT = { won: 0, score: [300, 120] } as const

/** each call to crypto.getRandomValues fills its array with the next byte in `bytes` */
const random = (...bytes: number[]) =>
  vi.spyOn(crypto, 'getRandomValues').mockImplementation((a: ArrayBufferView) => {
    ;(a as Uint8Array).fill(bytes.shift() ?? 0x77)
    return a
  })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('4.1 four sit and a fifth watches', () => {
  it('every tab agrees on the seq, the chairs and the captain at every step, with messages repeated and late', () => {
    // opened out of id order, and sat in another order again
    const t = table(cards, [DEE, CY, BO, EVE, ANN])
    t.see()
    t.settle()
    let steps = 0
    const step = (
      fn: () => void,
      want: { chairs: (string | null)[]; captain: string | null; mode?: string },
    ) => {
      const at = t.log.length
      fn()
      t.settle()
      // every message of this step again, to everybody: the request (unless the host asked
      // itself, which sends none) as well as the state
      const again = t.log.slice(at)
      expect(again.map((m) => m.body.t)).toContain('state')
      t.wire.push(...again)
      t.flush()
      // and the last state from before this step, arriving late at Eve and at Dee
      const late = t.log
        .slice(0, at)
        .filter((m) => m.body.t === 'state')
        .pop()!
      t.wire.push(late)
      t.flush([EVE, DEE])
      expect(t.agree()).toBe(true)
      for (const id of t.tabs.keys()) {
        expect(t.who(id)).toEqual(want.chairs)
        expect(captainOf(t.get(id))).toBe(want.captain)
        expect(hostOf(t.get(id))).toBe(BO)
        if (want.mode) expect(t.get(id).mode).toBe(want.mode)
      }
      steps++
    }
    step(() => t.do(CY, { t: 'sit', chair: 2 }), { chairs: [null, null, CY, null], captain: CY })
    step(() => t.do(ANN, { t: 'sit', chair: 0 }), { chairs: [ANN, null, CY, null], captain: CY })
    step(() => t.do(EVE, { t: 'sit', chair: 3 }), { chairs: [ANN, null, CY, EVE], captain: CY })
    step(() => t.do(DEE, { t: 'sit', chair: 1 }), { chairs: [ANN, DEE, CY, EVE], captain: CY })
    step(() => t.do(CY, { t: 'mode', mode: 'together' }), {
      chairs: [ANN, DEE, CY, EVE],
      captain: CY,
      mode: 'together',
    })
    // the captain moves Eve across from Ann, and its repeat moves nobody back
    step(() => t.do(CY, { t: 'swap', a: 3, b: 1, id: EVE }), {
      chairs: [ANN, EVE, CY, DEE],
      captain: CY,
    })
    // the captain stands: whoever sat next is captain at once
    step(() => t.do(CY, { t: 'stand' }), { chairs: [ANN, EVE, null, DEE], captain: ANN })
    // Bo, the host, sits too: four sit and Cy watches
    step(() => t.do(BO, { t: 'sit', chair: 2 }), { chairs: [ANN, EVE, BO, DEE], captain: ANN })
    step(() => t.do(ANN, { t: 'start', n: 1 }), { chairs: [ANN, EVE, BO, DEE], captain: ANN })
    expect(steps).toBe(9)
    expect(t.get(CY).round).toMatchObject({ n: 1, phase: 'on', starters: [ANN, EVE, BO, DEE] })
  })
})

describe('sitting down', () => {
  it('two people asking for one chair at once: the first the host hears has it, and everybody agrees', () => {
    const t = seated(cards, [DEE, CY, BO, ANN, EVE])
    // Eve asks first, and her ask reaches the host first
    t.do(EVE, { t: 'sit', chair: 1 })
    t.do(DEE, { t: 'sit', chair: 1 })
    t.settle()
    expect(t.agree()).toBe(true)
    expect(t.who(ANN)).toEqual([ANN, EVE, CY, null])
  })
  it("a chair somebody holds is not taken from them, by a watcher, the host or the captain's computer", () => {
    const t = seated()
    t.do(DEE, { t: 'sit', chair: 0 })
    t.do(BO, { t: 'sit', chair: 2 })
    t.do(CY, { t: 'cpu', chair: 0, level: 1 })
    t.settle()
    expect(t.who(DEE)).toEqual([ANN, null, CY, null])
    expect(t.get(DEE).chairs.map((ch) => ch.cpu)).toEqual([null, null, null, null])
  })
  it('somebody sitting does not take a second chair', () => {
    const t = seated()
    t.do(ANN, { t: 'sit', chair: 3 })
    t.settle()
    /* the host's own copy: a reader refuses a state seating one person twice, so a watcher's
       copy stays right while the host's is wrong, and every later state is refused (review,
       26 Nov 2026) */
    expect(t.who(BO)).toEqual([ANN, null, CY, null])
    expect(t.agree()).toBe(true)
    t.do(CY, { t: 'mode', mode: 'together' })
    t.settle()
    expect(t.get(DEE).mode).toBe('together')
  })
  it("between rounds, anybody may take a computer's chair, and the computer goes", () => {
    const t = seated()
    t.do(CY, { t: 'cpu', chair: 1, level: 2 })
    t.settle()
    t.do(DEE, { t: 'sit', chair: 1 })
    t.settle()
    expect(t.get(BO).chairs[1]).toMatchObject({ id: DEE, cpu: null })
    expect(t.agree()).toBe(true)
  })
  it('a request on the wire is exactly what §3.1 names, and a hello too', () => {
    const t = seated()
    expect(act(cards, t.get(DEE), { t: 'sit', chair: 1 }, 0).out).toEqual([
      { v: 1, sub: 'cards', t: 'sit', chair: 1 },
    ])
    expect(act(cards, t.get(CY), { t: 'swap', a: 2, b: 1, id: CY }, 0).out).toEqual([
      { v: 1, sub: 'cards', t: 'swap', a: 2, b: 1, id: CY },
    ])
    expect(openChairs(cards, EVE).out).toEqual([{ v: 1, sub: 'cards', t: 'hello' }])
  })
})

/* a state every check passes: every field away from its default (the fixture of 4.8, by hand) */
const good = (): Record<string, unknown> => ({
  v: 1,
  sub: 'cards',
  t: 'state',
  seq: 41,
  by: CY,
  chairs: [
    [ANN, 17, null],
    [null, 9, 2],
    [CY, 3, null],
    [DEE, 30, null],
  ],
  mode: 'together',
  opts: { target: 500 },
  code: 'q3_Lm-8RtZ0aXcVbN2pWkA',
  knew: [CY, ANN, DEE, BO],
  round: {
    n: 3,
    phase: 'over',
    starters: [ANN, null, CY, DEE],
    result: { won: 1, score: [312, 248] },
  },
})
const roundOf = (b: Record<string, unknown>) => b.round as Record<string, unknown>
const chairsOf = (b: Record<string, unknown>) => b.chairs as unknown[][]

describe('4.2 a state off the wire: every field checked', () => {
  it('the fixture itself is read', () => {
    expect(readChairs(cards, good())).not.toBeNull()
  })
  const rows: [string, (b: Record<string, unknown>) => unknown, LiveRules<Opts>?][] = [
    ['nothing at all', () => null],
    ['a string', () => 'state'],
    ['another version', (b) => ({ ...b, v: 2 })],
    ['another toy', (b) => ({ ...b, sub: 'race' })],
    ['not a state', (b) => ({ ...b, t: 'hello' })],
    ['a seq that is not a whole number', (b) => ({ ...b, seq: 41.5 })],
    ['a seq that is a string', (b) => ({ ...b, seq: '41' })],
    ['seq 0', (b) => ({ ...b, seq: 0 })],
    [
      /* refused by the seq check alone: every since 0, and round 0 open (review, 26 Nov 2026) */
      'seq 0, with every since 0 and no round yet',
      (b) => ({
        ...b,
        seq: 0,
        chairs: chairsOf(b).map(([id, , cpu]) => [id, 0, cpu]),
        round: { n: 0, phase: 'open', starters: [null, null, null, null], result: null },
      }),
    ],
    ['no publisher', (b) => ({ ...b, by: undefined })],
    ['an empty publisher', (b) => ({ ...b, by: '' })],
    ['a publisher that is a number', (b) => ({ ...b, by: 1 })],
    ['a seq past a billion', (b) => ({ ...b, seq: 1e9 + 1 })],
    ['three chairs on a four-chair toy', (b) => ({ ...b, chairs: chairsOf(b).slice(0, 3) })],
    ['chairs that are not a list', (b) => ({ ...b, chairs: {} })],
    ['chairs that are not a list, four long', (b) => ({ ...b, chairs: { length: 4 } })],
    ['a chair of two fields', (b) => ({ ...b, chairs: [[ANN, 17], ...chairsOf(b).slice(1)] })],
    [
      'a chair of four fields',
      (b) => ({ ...b, chairs: [[ANN, 17, null, 'x'], ...chairsOf(b).slice(1)] }),
    ],
    [
      'a chair that is not a list',
      (b) => ({ ...b, chairs: [{ 0: ANN, 1: 17, 2: null }, ...chairsOf(b).slice(1)] }),
    ],
    [
      'a chair that is not a list, three long',
      (b) => ({ ...b, chairs: [{ 0: ANN, 1: 17, 2: null, length: 3 }, ...chairsOf(b).slice(1)] }),
    ],
    ['a chair that is nothing', (b) => ({ ...b, chairs: [null, ...chairsOf(b).slice(1)] })],
    ['an empty id', (b) => ({ ...b, chairs: [['', 17, null], ...chairsOf(b).slice(1)] })],
    [
      'a 65-character id',
      (b) => ({ ...b, chairs: [['x'.repeat(65), 17, null], ...chairsOf(b).slice(1)] }),
    ],
    ['an id that is a number', (b) => ({ ...b, chairs: [[7, 17, null], ...chairsOf(b).slice(1)] })],
    ['a since below 0', (b) => ({ ...b, chairs: [[ANN, -1, null], ...chairsOf(b).slice(1)] })],
    [
      'a since that is not whole',
      (b) => ({ ...b, chairs: [[ANN, 2.5, null], ...chairsOf(b).slice(1)] }),
    ],
    [
      'a since after the state itself',
      (b) => ({ ...b, chairs: [[ANN, 42, null], ...chairsOf(b).slice(1)] }),
    ],
    [
      'a computer past the last level',
      (b) => ({ ...b, chairs: [chairsOf(b)[0], [null, 9, 3], ...chairsOf(b).slice(2)] }),
    ],
    [
      'a computer on a toy without one',
      () => ({
        ...good(),
        sub: 'boat',
        chairs: [
          [ANN, 17, null],
          [null, 9, 0],
        ],
        round: { n: 3, phase: 'over', starters: [ANN, null], result: null },
      }),
      boat,
    ],
    [
      'a person and a computer in one chair',
      (b) => ({ ...b, chairs: [[ANN, 17, 1], ...chairsOf(b).slice(1)] }),
    ],
    [
      'one person in two chairs',
      (b) => ({ ...b, chairs: [...chairsOf(b).slice(0, 3), [ANN, 30, null]] }),
    ],
    ['a mode nobody has', (b) => ({ ...b, mode: 'solo' })],
    [
      "a mode this toy doesn't have",
      () => ({
        ...good(),
        sub: 'boat',
        mode: 'versus',
        chairs: [
          [ANN, 17, null],
          [CY, 3, null],
        ],
        round: { n: 3, phase: 'over', starters: [ANN, CY], result: null },
      }),
      boat,
    ],
    ["options the toy can't read", (b) => ({ ...b, opts: { target: 400 } })],
    ['no options', (b) => ({ ...b, opts: undefined })],
    ['a code of 21 characters', (b) => ({ ...b, code: 'q3_Lm-8RtZ0aXcVbN2pWk' })],
    ['a code with a +', (b) => ({ ...b, code: 'q3_Lm-8RtZ0aXcVbN2pWk+' })],
    ['a code that is a number', (b) => ({ ...b, code: 12345 })],
    ['a code that is a list of one good code', (b) => ({ ...b, code: [b.code] })],
    [
      'seventeen who knew',
      (b) => ({ ...b, knew: Array.from({ length: 17 }, (_, i) => `id-${i}`) }),
    ],
    ['knew that is not a list', (b) => ({ ...b, knew: ANN })],
    ['knew that is not a list, short', (b) => ({ ...b, knew: 'abc' })],
    ['an empty id among who knew', (b) => ({ ...b, knew: [CY, ''] })],
    /* a full knew must name sixteen people for "a full knew names somebody gone" to hold */
    ['somebody twice among who knew', (b) => ({ ...b, knew: [CY, ANN, CY] })],
    ['no round', (b) => ({ ...b, round: null })],
    ['a round below 0', (b) => ({ ...b, round: { ...roundOf(b), n: -1 } })],
    ['a round past a million', (b) => ({ ...b, round: { ...roundOf(b), n: 1e6 + 1 } })],
    ['a phase nobody has', (b) => ({ ...b, round: { ...roundOf(b), phase: 'done' } })],
    [
      'a phase nobody has, with no result',
      (b) => ({ ...b, round: { ...roundOf(b), phase: 'done', result: null } }),
    ],
    ['round 0 over', (b) => ({ ...b, round: { ...roundOf(b), n: 0 } })],
    ['round 3 open', (b) => ({ ...b, round: { ...roundOf(b), phase: 'open', result: null } })],
    [
      'three starters at four chairs',
      (b) => ({ ...b, round: { ...roundOf(b), starters: [ANN, null, CY] } }),
    ],
    [
      'starters that are not a list, four long',
      (b) => ({ ...b, round: { ...roundOf(b), starters: { length: 4 } } }),
    ],
    [
      'a starter that is a number',
      (b) => ({ ...b, round: { ...roundOf(b), starters: [ANN, null, CY, 4] } }),
    ],
    ['a result while the round is on', (b) => ({ ...b, round: { ...roundOf(b), phase: 'on' } })],
    [
      "a result the toy can't read",
      (b) => ({ ...b, round: { ...roundOf(b), result: { won: 2, score: [1, 2] } } }),
    ],
    [
      'a round over with no result field',
      (b) => {
        const round = { ...roundOf(b) }
        delete round.result
        return { ...b, round }
      },
    ],
  ]
  it.each(rows)('refuses %s', (_, bad, rules = cards) => {
    expect(readChairs(rules, bad(good()))).toBeNull()
  })
  it('and a state refused is not believed: the table stays as it was', () => {
    const t = seated()
    const c = t.get(DEE)
    /* the table as a state would set it: 'not a state' is a hello from the host, which Dee may
       answer later (owesHost), and which believes nothing */
    for (const [name, bad, rules = cards] of rows)
      if (rules === cards)
        expect(wireOf(receive(cards, c, BO, bad(good()), 0).table), name).toEqual(wireOf(c))
  })
})

describe('4.2 a request off the wire: every field checked', () => {
  /* each pair: the request well-formed, which the host takes, and with one field wrong, which it
     must not. A row marked `host` is well-formed and refused by the host's rules alone; every
     other bad request is refused twice, by the host and before it ever leaves the asker's tab */
  const rows: [string, Record<string, unknown>, Record<string, unknown>, 'host'?][] = [
    ['sit at a chair past the last', { t: 'sit', chair: 1 }, { t: 'sit', chair: 4 }],
    ['sit at chair -1', { t: 'sit', chair: 1 }, { t: 'sit', chair: -1 }],
    ['sit at a chair that is a string', { t: 'sit', chair: 1 }, { t: 'sit', chair: '1' }],
    [
      'a computer past the last level',
      { t: 'cpu', chair: 1, level: 2 },
      { t: 'cpu', chair: 1, level: 3 },
    ],
    ['a computer at no chair', { t: 'cpu', chair: 1, level: 2 }, { t: 'cpu', chair: 9, level: 2 }],
    [
      'a computer with no level',
      { t: 'cpu', chair: 1, level: 2 },
      { t: 'cpu', chair: 1, level: '2' },
    ],
    [
      'a swap of a chair with itself',
      { t: 'swap', a: 0, b: 1, id: ANN },
      { t: 'swap', a: 0, b: 0, id: ANN },
    ],
    [
      'a swap with no such chair',
      { t: 'swap', a: 0, b: 1, id: ANN },
      { t: 'swap', a: 0, b: 4, id: ANN },
    ],
    ['a swap that names nobody', { t: 'swap', a: 0, b: 1, id: ANN }, { t: 'swap', a: 0, b: 1 }],
    [
      'a swap naming an empty id',
      { t: 'swap', a: 0, b: 1, id: ANN },
      { t: 'swap', a: 0, b: 1, id: '' },
    ],
    [
      'a swap naming nobody, from an empty chair',
      { t: 'swap', a: 0, b: 1, id: ANN },
      { t: 'swap', a: 1, b: 0, id: null },
    ],
    [
      'a swap naming somebody not in that chair',
      { t: 'swap', a: 0, b: 1, id: ANN },
      { t: 'swap', a: 2, b: 1, id: ANN },
      'host',
    ],
    ['a mode nobody has', { t: 'mode', mode: 'together' }, { t: 'mode', mode: 'solo' }],
    /* a request that would change nothing is refused, so it costs the call no state */
    [
      'the mode already set',
      { t: 'mode', mode: 'together' },
      { t: 'mode', mode: 'versus' },
      'host',
    ],
    [
      'no computer to take away',
      { t: 'cpu', chair: 1, level: 2 },
      { t: 'cpu', chair: 3, level: null },
      'host',
    ],
    [
      "options the toy can't read",
      { t: 'opts', o: { target: 500 } },
      { t: 'opts', o: { target: 1 } },
    ],
    [
      'the options already set',
      { t: 'opts', o: { target: 500 } },
      { t: 'opts', o: { target: 300 } },
      'host',
    ],
    ['start round 0', { t: 'start', n: 1 }, { t: 'start', n: 0 }],
    ['start round 1.5', { t: 'start', n: 1 }, { t: 'start', n: 1.5 }],
    ['start round 2 first', { t: 'start', n: 1 }, { t: 'start', n: 2 }, 'host'],
    ['another version', { t: 'sit', chair: 1 }, { v: 2, t: 'sit', chair: 1 }, 'host'],
    ['another toy', { t: 'sit', chair: 1 }, { sub: 'race', t: 'sit', chair: 1 }, 'host'],
    ['a request nobody has', { t: 'sit', chair: 1 }, { t: 'kick', chair: 1 }],
  ]
  it.each(rows)('refuses %s', (_, ok, bad, only) => {
    /* to the host, Bo: a sit from Dee, who is watching, and the rest from Cy, the captain */
    const from = ok.t === 'sit' ? DEE : CY
    const asked = (body: Record<string, unknown>) => {
      const t = seated()
      const c = t.get(BO)
      const s = receive(cards, c, from, { v: 1, sub: 'cards', ...body }, t.now() + PACE_MS)
      return s.table.seq !== c.seq
    }
    expect(asked(ok)).toBe(true)
    expect(asked(bad)).toBe(false)
    // and what the asker's own tab sends: the request, or — malformed — nothing at all
    const sends = (body: Record<string, unknown>) =>
      act(cards, seated().get(from), body as Ask<Opts>, 0).out.length
    expect(sends(ok)).toBe(1)
    if (only !== 'host') expect(sends(bad)).toBe(0)
  })
  it('a round over: a starter, of the round that is on, with a result the toy can read', () => {
    const over = (body: Record<string, unknown>) => {
      const t = seated()
      t.do(CY, { t: 'start', n: 1 })
      t.settle()
      const c = t.get(BO)
      return receive(cards, c, ANN, { v: 1, sub: 'cards', ...body }, t.now() + PACE_MS).table.round
        .phase
    }
    expect(over({ t: 'over', n: 1, result: { won: 0, score: [300, 120] } })).toBe('over')
    expect(over({ t: 'over', n: 0, result: { won: 0, score: [300, 120] } })).toBe('on')
    expect(over({ t: 'over', n: 2, result: { won: 0, score: [300, 120] } })).toBe('on')
    expect(over({ t: 'over', n: 1, result: { won: 5, score: [300, 120] } })).toBe('on')
  })
  it('a computer asked for at the level it already has costs the call no state', () => {
    const t = seated()
    t.do(CY, { t: 'cpu', chair: 1, level: 1 })
    t.settle()
    const from = t.log.length
    t.do(CY, { t: 'cpu', chair: 1, level: 1 })
    t.settle()
    expect(t.sent('state', from)).toBe(0)
    expect(t.get(DEE).chairs[1].cpu).toBe(1)
  })
  it('only somebody on the call is listened to', () => {
    const t = seated()
    const c = t.get(BO)
    const stranger = '00000000-0000-0000-0000-0000000000ff'
    expect(receive(cards, c, stranger, { v: 1, sub: 'cards', t: 'sit', chair: 1 }, 9e9).table).toBe(
      c,
    )
    expect(receive(cards, t.get(DEE), stranger, { ...good(), seq: 900 }, 9e9).table).toBe(
      t.get(DEE),
    )
    // and the same from somebody on the call is
    expect(receive(cards, t.get(DEE), BO, { ...good(), seq: 900 }, 9e9).table.seq).toBe(900)
  })
})

describe('4.3 what only the captain may ask, and what nobody may ask mid-round', () => {
  const asks: Ask<Opts>[] = [
    { t: 'cpu', chair: 1, level: 1 },
    { t: 'swap', a: 0, b: 2, id: ANN },
    { t: 'mode', mode: 'together' },
    { t: 'opts', o: { target: 500 } },
    { t: 'start', n: 1 },
  ]
  it.each(asks)(
    '%o: refused from somebody seated and from a watcher, taken from the captain',
    (a) => {
      for (const who of [ANN, DEE]) {
        const t = seated()
        const before = t.get(BO)
        t.do(who, a)
        t.settle()
        expect(t.get(BO).seq).toBe(before.seq)
        expect(t.agree()).toBe(true)
      }
      const t = seated()
      const before = t.get(BO).seq
      t.do(CY, a)
      t.settle()
      expect(t.get(BO).seq).toBeGreaterThan(before)
      expect(t.agree()).toBe(true)
    },
  )
  /** Cy and Ann seated, a computer at West (1), and round 1 on */
  const playing = (rules: LiveRules<Opts>) => {
    const t = seated(rules)
    t.do(CY, { t: 'cpu', chair: 1, level: 0 })
    t.settle()
    t.do(CY, { t: 'start', n: 1 })
    t.settle()
    expect(t.get(DEE).round.phase).toBe('on')
    return t
  }
  const midRound: [string, Ask<Opts>][] = [
    ['the captain standing', { t: 'stand' }],
    ['a computer added', { t: 'cpu', chair: 3, level: 1 }],
    ['a swap', { t: 'swap', a: 0, b: 3, id: ANN }],
    ['the mode', { t: 'mode', mode: 'together' }],
    ['the options', { t: 'opts', o: { target: 500 } }],
    ['a second round', { t: 'start', n: 2 }],
  ]
  it.each(midRound)('mid-round, %s is refused, even from the captain', (_, a) => {
    const t = playing(cards)
    const before = t.get(BO).seq
    t.do(CY, a)
    t.settle()
    expect(t.get(BO).seq).toBe(before)
  })
  it('mid-round, a watcher may not take an empty chair, nor a player stand', () => {
    const t = playing(cards)
    t.do(DEE, { t: 'sit', chair: 3 })
    t.do(ANN, { t: 'stand' })
    t.settle()
    expect(t.who(BO)).toEqual([ANN, null, CY, null])
  })
  it("mid-round, a watcher may take a computer's chair where the toy allows it, and plays it from then on", () => {
    const t = playing(cards)
    t.do(DEE, { t: 'sit', chair: 1 })
    t.settle()
    expect(t.who(BO)).toEqual([ANN, DEE, CY, null])
    expect(t.get(BO).chairs[1].cpu).toBeNull()
    expect(t.get(BO).round.starters).toEqual([ANN, DEE, CY, null])
    // and so may report the round over
    t.do(DEE, { t: 'over', n: 1, result: { won: 1, score: [210, 300] } })
    t.settle()
    expect(t.get(ANN).round.phase).toBe('over')
  })
  it("mid-round, nobody takes a computer's chair where the toy does not allow it", () => {
    const t = playing(race)
    t.do(DEE, { t: 'sit', chair: 1 })
    t.settle()
    expect(t.who(BO)).toEqual([ANN, null, CY, null])
    expect(t.get(BO).chairs[1].cpu).toBe(0)
  })
  it('the round is over when somebody playing it says so, and the first to say so counts', () => {
    const t = playing(race)
    // a watcher cannot end it
    t.do(DEE, { t: 'over', n: 1, result: { won: 0, score: [1, 0] } })
    t.settle()
    expect(t.get(BO).round.phase).toBe('on')
    t.do(ANN, { t: 'over', n: 1, result: { won: 1, score: [0, 5] } })
    t.do(CY, { t: 'over', n: 1, result: { won: 0, score: [5, 0] } })
    t.settle()
    expect(t.agree()).toBe(true)
    expect(t.get(DEE).round).toMatchObject({
      n: 1,
      phase: 'over',
      result: { won: 1, score: [0, 5] },
    })
  })
})

describe('4.4 the captain moves people', () => {
  it('to an empty chair, two people with each other, and a person with a computer, each keeping when they sat', () => {
    const t = seated()
    t.do(CY, { t: 'cpu', chair: 3, level: 2 })
    t.settle()
    const since = (id: string) => t.get(DEE).chairs.find((ch) => ch.id === id)!.since
    const [cy, ann] = [since(CY), since(ANN)]
    expect(cy).toBeLessThan(ann)
    // Cy from North (2) to the empty West (1)
    t.do(CY, { t: 'swap', a: 2, b: 1, id: CY })
    t.settle()
    expect(t.who(DEE)).toEqual([ANN, CY, null, null])
    // Cy and Ann change places
    t.do(CY, { t: 'swap', a: 1, b: 0, id: CY })
    t.settle()
    expect(t.who(DEE)).toEqual([CY, ANN, null, null])
    // Cy and the computer at East (3) change places
    t.do(CY, { t: 'swap', a: 0, b: 3, id: CY })
    t.settle()
    expect(t.who(DEE)).toEqual([null, ANN, null, CY])
    expect(t.get(DEE).chairs[0].cpu).toBe(2)
    expect([since(CY), since(ANN)]).toEqual([cy, ann])
    // so being moved never makes anybody captain: Cy sat first, and still sets the table
    expect(t.agree()).toBe(true)
    for (const id of t.tabs.keys()) expect(captainOf(t.get(id))).toBe(CY)
  })
  it('a swap repeated moves nobody back, and one arriving after the table changed moves nobody', () => {
    const t = seated()
    t.do(CY, { t: 'swap', a: 0, b: 1, id: ANN })
    const ask = t.wire.find((m) => m.body.t === 'swap')!
    t.settle()
    expect(t.who(DEE)).toEqual([null, ANN, CY, null])
    // the same ask, delivered again
    t.wire.push(ask)
    t.settle()
    expect(t.who(DEE)).toEqual([null, ANN, CY, null])
    // Cy asks to move Ann back to South; before it lands, Ann stands and Dee sits where she was
    t.do(CY, { t: 'swap', a: 1, b: 0, id: ANN })
    const late = t.wire.splice(0)
    t.do(ANN, { t: 'stand' })
    t.settle()
    t.do(DEE, { t: 'sit', chair: 1 })
    t.settle()
    t.wire.push(...late)
    t.settle()
    expect(t.who(BO)).toEqual([null, DEE, CY, null])
    expect(t.agree()).toBe(true)
  })
  it('a swap changes the teams, which is what Move… is for', () => {
    const t = seated()
    t.do(CY, { t: 'mode', mode: 'together' })
    t.settle()
    const c = () => t.get(DEE)
    // together at four, the partners sit across from each other: South (0) with North (2)
    expect(teamOf(cards, c(), chairOf(c(), ANN)!)).toBe(teamOf(cards, c(), chairOf(c(), CY)!))
    t.do(CY, { t: 'swap', a: 2, b: 1, id: CY })
    t.settle()
    expect(teamOf(cards, c(), chairOf(c(), ANN)!)).not.toBe(teamOf(cards, c(), chairOf(c(), CY)!))
  })
})

describe('4.5 two hosts mint a code at the same moment', () => {
  it("the lower sender's state wins, so every tab ends with one code", () => {
    /* Ann's code is the lower one, so a tie broken by the code would keep hers */
    const spy = random(0x00, 0xff)
    const t = table(cards, [ANN, BO, CY])
    // Bo's `where` has reached nobody yet: Ann thinks she is host and tells Cy the table …
    t.see([ANN, CY])
    // … while Bo, seeing everybody, is host and tells everybody his
    t.see([BO, ANN, CY])
    const ann = t.log.find((m) => m.from === ANN && m.body.t === 'state')!.body as { code: string }
    const bo = t.log.find((m) => m.from === BO && m.body.t === 'state')!.body as { code: string }
    expect(ann.code < bo.code).toBe(true)
    t.settle()
    expect(spy).toHaveBeenCalledTimes(2)
    expect(t.agree()).toBe(true)
    for (const id of t.tabs.keys()) {
      expect(t.get(id).code).toBe(bo.code)
      expect(t.get(id).from).toBe(BO)
    }
  })
  it('two halves of a call holding one code, each changing it once, are one table when they meet', () => {
    const t = seated(cards, [DEE, CY, BO, ANN])
    t.later(5000)
    // {Bo, Ann} and {Cy, Dee} stop seeing each other on the toy: Bo hosts one half, Cy the other
    t.see([BO, ANN])
    t.see([CY, DEE])
    t.flush([BO, ANN])
    t.flush([CY, DEE])
    // and each changes the table once, to the same seq, with the same code
    t.do(DEE, { t: 'sit', chair: 1 })
    t.flush([CY, DEE])
    t.do(ANN, { t: 'stand' })
    t.flush([BO, ANN])
    expect(t.get(BO).seq).toBe(t.get(CY).seq)
    expect(t.get(BO).code).toBe(t.get(CY).code)
    expect(t.who(BO)).not.toEqual(t.who(CY))
    // together again: Bo hosts the whole call, and his half's table is the one everybody keeps
    t.later(PACE_MS)
    t.see()
    t.settle()
    expect(t.agree()).toBe(true)
    expect(t.who(DEE)).toEqual([null, null, CY, null])
  })
  it('a newcomer with the lowest id announces a fresh table, and it does not replace a sit the host took before its first state', () => {
    const t = table(cards, [ANN], [ANN, CY, BO])
    t.see([ANN])
    t.open(CY)
    t.see([ANN, CY])
    t.do(CY, { t: 'sit', chair: 2 })
    // Cy's sit reaches Ann before Cy's hello does, so it is the first thing the host publishes
    t.wire.reverse()
    t.settle([ANN, CY])
    expect(t.who(ANN)).toEqual([null, null, CY, null])
    // Bo arrives, holding nothing, and is host the moment he is here
    t.open(BO)
    t.see([ANN, CY, BO])
    t.settle()
    expect(t.agree()).toBe(true)
    expect(t.who(BO)).toEqual([null, null, CY, null])
    expect(hostOf(t.get(ANN))).toBe(BO)
  })
  it("a host's first state that is a change still beats a lower newcomer's fresh table", () => {
    const t = table(cards, [ANN], [ANN, BO])
    t.see([ANN])
    // alone, Ann sits: the code is minted and her chair goes out in the same breath
    t.do(ANN, { t: 'sit', chair: 0 })
    t.settle([ANN])
    t.open(BO)
    t.see([ANN, BO])
    t.settle()
    expect(t.agree()).toBe(true)
    expect(t.who(BO)).toEqual([ANN, null, null, null])
  })
})

describe('4.6 three roles, three people', () => {
  it('Bo hosts and watches, Cy sat first and sets the table, Ann sits with a lower id than Cy', () => {
    const t = table(cards, [ANN, CY, BO])
    t.see()
    t.settle()
    t.do(CY, { t: 'sit', chair: 2 })
    t.settle()
    t.do(ANN, { t: 'sit', chair: 0 })
    t.settle()
    const roles = (id: string) => {
      const c = t.get(id)
      return [hostOf(c), captainOf(c), [...seatedHumans(c)].sort()[0]]
    }
    // three roles, held by three different people, on every tab
    for (const id of t.tabs.keys()) expect(roles(id)).toEqual([BO, CY, ANN])
    expect(new Set(roles(BO)).size).toBe(3)
    // a watcher cannot start, even the host; nor can somebody seated who is not the captain
    t.do(BO, { t: 'start', n: 1 })
    t.do(ANN, { t: 'start', n: 1 })
    t.settle()
    expect(t.get(BO).round.phase).toBe('open')
    t.do(CY, { t: 'start', n: 1 })
    t.settle()
    expect(t.get(BO).round).toMatchObject({ n: 1, phase: 'on' })
    t.do(ANN, { t: 'over', n: 1, result: { won: 1, score: [120, 300] } })
    t.settle()
    // Cy's start arriving again, late, does not start the round it started
    t.do(CY, { t: 'start', n: 1 })
    t.settle()
    expect(t.get(BO).round).toMatchObject({ n: 1, phase: 'over' })
    // between rounds Cy stands, and Ann sets the table at once
    t.do(CY, { t: 'stand' })
    t.settle()
    expect(t.agree()).toBe(true)
    for (const id of t.tabs.keys()) expect(captainOf(t.get(id))).toBe(ANN)
    t.do(CY, { t: 'start', n: 2 })
    t.settle()
    expect(t.get(BO).round.phase).toBe('over')
    // and the captain's controls are hers: a computer across from her, and the second round
    t.do(ANN, { t: 'cpu', chair: 2, level: 1 })
    t.do(ANN, { t: 'start', n: 2 })
    t.settle()
    expect(t.get(CY).round).toMatchObject({ n: 2, phase: 'on', starters: [ANN, null, null, null] })
    expect(t.get(CY).chairs[2].cpu).toBe(1)
  })
  it('a captain who leaves the toy is replaced at once, on every tab, with their chair still held', () => {
    const t = seated()
    t.see([DEE, BO, ANN])
    for (const id of [DEE, BO, ANN]) {
      expect(captainOf(t.get(id))).toBe(ANN)
      expect(t.who(id)).toEqual([ANN, null, CY, null])
    }
    // and back again, Cy sat first and sets it again
    t.see([DEE, BO, ANN, CY])
    for (const id of t.tabs.keys()) expect(captainOf(t.get(id))).toBe(CY)
  })
})

describe('4.7 the code is re-minted when somebody who heard it has left the call', () => {
  /** Bo, Ann and Cy on the toy, Dee on the call; Cy and Ann seated */
  const withDee = () => {
    const t = table(cards, [BO, ANN, CY], [BO, ANN, CY, DEE])
    t.see()
    t.settle()
    t.do(CY, { t: 'sit', chair: 2 })
    t.do(ANN, { t: 'sit', chair: 0 })
    t.settle()
    expect(t.get(BO).knew).toContain(DEE)
    return t
  }
  const codes = (t: Net) => new Set([...t.tabs.keys()].map((id) => t.get(id).code))
  it('Dee leaves mid-round: the code stays for the round, and is new once it is over', () => {
    const t = withDee()
    t.do(CY, { t: 'start', n: 1 })
    t.settle()
    const code = t.get(BO).code
    t.call([BO, ANN, CY])
    t.settle()
    t.later(HOLD_MS)
    t.settle()
    expect(codes(t)).toEqual(new Set([code]))
    t.do(ANN, { t: 'over', n: 1, result: { won: 0, score: [300, 90] } })
    t.settle()
    expect(t.agree()).toBe(true)
    expect(codes(t).size).toBe(1)
    expect(t.get(BO).code).not.toBe(code)
    expect(t.get(BO).code).toMatch(CODE)
    expect([...t.get(CY).knew].sort()).toEqual([BO, ANN, CY].sort())
  })
  it('a round started straight after one ends, before any tick, starts on a new code', () => {
    const t = withDee()
    t.do(CY, { t: 'start', n: 1 })
    t.settle()
    const code = t.get(BO).code
    // Dee leaves mid-round: everybody's clock ticks, and the code stays for the round
    t.call([BO, ANN, CY])
    t.tick()
    t.flush()
    expect(codes(t)).toEqual(new Set([code]))
    t.later(PACE_MS)
    t.do(ANN, { t: 'over', n: 1, result: { won: 0, score: [300, 90] } })
    t.flush()
    t.later(PACE_MS)
    t.do(CY, { t: 'start', n: 2 })
    t.flush()
    t.later(PACE_MS)
    t.tick([BO])
    t.flush()
    expect(t.get(ANN).round).toMatchObject({ n: 2, phase: 'on' })
    expect(t.get(ANN).code).not.toBe(code)
  })
  it('Dee leaves before any round: the code is new at once', () => {
    const t = withDee()
    const code = t.get(BO).code
    t.call([BO, ANN, CY])
    t.settle()
    expect(t.agree()).toBe(true)
    expect(t.get(ANN).code).not.toBe(code)
  })
  it('nobody leaves: one code, round after round', () => {
    const t = withDee()
    const code = t.get(BO).code
    for (const n of [1, 2]) {
      t.do(CY, { t: 'start', n })
      t.settle()
      t.do(ANN, { t: 'over', n, result: { won: 1, score: [0, 300] } })
      t.settle()
    }
    expect(codes(t)).toEqual(new Set([code]))
  })
  it('Eve joins the call after the code was minted, hears it, and leaves: the next round has a new one', () => {
    const t = withDee()
    const code = t.get(BO).code
    t.call([BO, ANN, CY, DEE, EVE])
    t.do(CY, { t: 'start', n: 1 })
    t.settle()
    // the state that started the round went to Eve as well
    expect(t.get(ANN).knew).toContain(EVE)
    t.call([BO, ANN, CY, DEE])
    t.do(ANN, { t: 'over', n: 1, result: { won: 1, score: [0, 300] } })
    t.settle()
    expect(t.get(ANN).code).not.toBe(code)
  })
  it('Bo, with the lowest id, joins and is handed the code by the host before him, then hangs up at once: the code is new', () => {
    const t = table(cards, [ANN, CY, DEE])
    t.see()
    t.settle()
    t.do(CY, { t: 'sit', chair: 2 })
    t.settle()
    const code = t.get(ANN).code
    expect(t.get(ANN).knew).not.toContain(BO)
    // Bo joins the call and his `where` lands: he is host before his toy has a table
    t.call([ANN, CY, DEE, BO])
    t.see([ANN, CY, DEE, BO])
    t.flush()
    // his toy opens; Ann, who hosted before him, hands him the table, and so the code
    t.open(BO)
    t.look(BO, [ANN, CY, DEE, BO])
    t.flush()
    expect(t.get(BO).code).toBe(code)
    // and he hangs up before his clock ticks once, or anything changes
    t.tabs.delete(BO)
    t.call([ANN, CY, DEE])
    t.see([ANN, CY, DEE])
    t.settle()
    expect(t.agree()).toBe(true)
    expect(t.get(ANN).code).not.toBe(code)
    expect(t.get(DEE).knew).not.toContain(BO)
  })
  /* Cy and Ann seated, a computer at West (1), round 1 on; Eve watching; Dee on the call only */
  const playingWithDee = () => {
    const t = table(cards, [BO, ANN, CY, EVE], [BO, ANN, CY, EVE, DEE])
    t.see()
    t.settle()
    t.do(CY, { t: 'sit', chair: 2 })
    t.settle()
    t.do(ANN, { t: 'sit', chair: 0 })
    t.settle()
    t.do(CY, { t: 'cpu', chair: 1, level: 0 })
    t.settle()
    t.do(CY, { t: 'start', n: 1 })
    t.settle()
    expect(t.get(EVE).round.phase).toBe('on')
    expect(t.get(BO).knew).toContain(DEE)
    // Dee hangs up mid-round
    t.call([BO, ANN, CY, EVE])
    t.tick()
    t.flush()
    return t
  }
  it("a watcher taking a computer's chair mid-round, after somebody who heard the code has left, keeps the round's code", () => {
    /* review of 26 Nov 2026: the only re-mint test went through present(), and the guard in
       publish() that a mid-round takeover passes through had none */
    const t = playingWithDee()
    const code = t.get(BO).code
    t.later(PACE_MS)
    t.do(EVE, { t: 'sit', chair: 1 })
    t.settle()
    expect(t.who(ANN)).toEqual([ANN, EVE, CY, null])
    expect(t.get(ANN).round.phase).toBe('on')
    expect(codes(t)).toEqual(new Set([code]))
  })
  it('after somebody who heard the code has left mid-round, a quiet table sends nothing', () => {
    const t = playingWithDee()
    const from = t.log.length
    const seq = t.get(BO).seq
    for (let i = 0; i < 5; i++) t.settle()
    expect(t.sent('state', from)).toBe(0)
    expect(t.get(BO).seq).toBe(seq)
  })
  it('a start held for the pace goes out on a new code when somebody who heard the old one leaves within that second', () => {
    /* review of 26 Nov 2026: the held table already said "on", so the leaver was judged
       mid-round, and the round went out on the code they had heard */
    const t = table(cards, [BO, ANN, CY, DEE])
    t.see()
    t.settle()
    t.do(CY, { t: 'sit', chair: 2 })
    t.settle()
    t.later(5000)
    t.do(ANN, { t: 'sit', chair: 0 })
    t.flush()
    const code = t.get(BO).code
    t.later(200)
    t.do(CY, { t: 'start', n: 1 })
    t.flush()
    expect(dueAt(t.get(BO))).not.toBeNull()
    expect(t.get(ANN).round.phase).toBe('open')
    t.later(100)
    t.tabs.delete(DEE)
    t.call([BO, ANN, CY])
    t.see()
    t.flush()
    t.later(PACE_MS)
    t.tick()
    t.flush()
    expect(t.agree()).toBe(true)
    expect(t.get(ANN).round).toMatchObject({ n: 1, phase: 'on' })
    expect(t.get(ANN).code).not.toBe(code)
    expect(t.get(ANN).knew).not.toContain(DEE)
  })
  it("somebody who reaches the host's roster just after a state went out is counted as having heard it", () => {
    /* review of 26 Nov 2026: Eve was on the call before the host's roster said so, heard Cy's
       stand, and hung up before the next state, so nothing ever counted her */
    const t = table(cards, [ANN, CY])
    t.see()
    t.settle()
    t.do(CY, { t: 'sit', chair: 2 })
    t.settle()
    t.later(5000)
    const code = t.get(ANN).code
    t.do(CY, { t: 'stand' })
    t.flush()
    expect(lastState(t, ANN).body).toMatchObject({ code })
    // the host's roster catches up with Eve a moment later
    t.later(300)
    t.call([ANN, CY, EVE])
    t.tick()
    t.flush()
    expect(t.get(CY).knew).toContain(EVE)
    t.later(5000)
    t.call([ANN, CY])
    t.settle()
    expect(t.get(CY).code).not.toBe(code)
    // and somebody who reaches it long after a state has heard nothing: no state, no re-mint
    const quiet = t.get(ANN)
    t.later(10_000)
    t.call([ANN, CY, EVE])
    t.tick()
    t.flush()
    expect(t.get(ANN).knew).not.toContain(EVE)
    expect(t.get(ANN).seq).toBe(quiet.seq)
  })
  it('a host taking over mid-round counts somebody new to the call in a state the whole call takes', () => {
    /* review of 26 Nov 2026: the fold that counts a newcomer goes out from the new host one seq
       on. At the old host's seq it lost to the old host's lower id, so only the newcomer heard it */
    const t = table(cards, [BO, ANN, CY, DEE])
    t.see()
    t.settle()
    t.do(CY, { t: 'sit', chair: 2 })
    t.settle()
    t.do(DEE, { t: 'sit', chair: 0 })
    t.settle()
    t.do(CY, { t: 'start', n: 1 })
    t.settle()
    const code = t.get(CY).code
    // Bo closes the toy and stays on the call: Ann hosts the state Bo published
    t.tabs.delete(BO)
    t.see()
    t.settle()
    expect(t.get(CY).from).toBe(BO)
    // Eve joins the call and opens the toy mid-round
    t.later(10_000)
    t.call([BO, ANN, CY, DEE, EVE])
    t.open(EVE)
    t.see()
    t.settle()
    expect(t.get(EVE).code).toBe(code)
    for (const id of [ANN, CY, DEE]) expect(t.get(id).knew, id).toContain(EVE)
    // Eve hangs up mid-round, Ann closes the toy, and the round ends under Cy
    t.tabs.delete(EVE)
    t.call([BO, ANN, CY, DEE])
    t.see()
    t.settle()
    t.later(3000)
    t.tabs.delete(ANN)
    t.see()
    t.settle()
    expect(hostOf(t.get(CY))).toBe(CY)
    t.do(DEE, { t: 'over', n: 1, result: RESULT })
    t.settle()
    expect(t.get(DEE).round.phase).toBe('over')
    expect(t.get(DEE).code).not.toBe(code)
  })
  it('a newcomer with the lowest id, handed a table its relayer did not publish, takes it, and is counted', () => {
    /* review of 26 Nov 2026: Cy hosted the code Bo minted and handed it to Ann, the newcomer;
       Ann recorded it as Cy's, her own fresh table won the tie, Cy's kept Bo's, and two codes
       stood on one call until the next change. Every tab records who published a state now */
    const t = table(cards, [BO, CY], [BO, CY, DEE])
    t.see()
    t.flush()
    const k1 = t.get(CY).code
    expect(t.get(CY)).toMatchObject({ seq: 1, from: BO })
    // Bo closes the toy and stays on the call: Cy hosts Bo's table
    t.tabs.delete(BO)
    t.see()
    t.flush()
    // Ann joins the call and opens the toy: the lowest id, host at once, with a fresh table
    t.call([BO, CY, DEE, ANN])
    t.see([CY, ANN])
    t.open(ANN)
    t.look(ANN, [CY, ANN])
    t.flush()
    expect(t.agree()).toBe(true)
    expect(t.get(ANN).code).toBe(k1)
    expect(t.get(CY).knew).toContain(ANN)
    // Ann hangs up: the code she was handed is replaced
    t.tabs.delete(ANN)
    t.call([BO, CY, DEE])
    t.see()
    t.settle()
    expect(t.get(CY).code).not.toBe(k1)
  })
  it('at most 16 who knew, and the state still reads', () => {
    const crowd = Array.from({ length: 20 }, (_, i) => `00000000-0000-0000-0000-0000000001${i}`)
    const t = table(cards, [BO, ANN], [BO, ANN, ...crowd])
    t.see()
    t.settle()
    expect(t.get(ANN).knew).toHaveLength(16)
    expect(readChairs(cards, wireOf(t.get(ANN)))).not.toBeNull()
    expect(t.agree()).toBe(true)
  })
})

describe('4.8 a state round trip, every field away from its default', () => {
  /* the table good() describes, as a tab holds it: Bo's, published by Cy when Cy hosted */
  const held = (): Chairs<Opts> => ({
    sub: 'cards',
    me: BO,
    seq: 41,
    from: CY,
    present: [ANN, CY, DEE],
    missing: {},
    roster: [ANN, CY, DEE],
    chairs: [
      { id: ANN, since: 17, cpu: null },
      { id: null, since: 9, cpu: 2 },
      { id: CY, since: 3, cpu: null },
      { id: DEE, since: 30, cpu: null },
    ],
    mode: 'together',
    opts: { target: 500 },
    code: 'q3_Lm-8RtZ0aXcVbN2pWkA',
    knew: [CY, ANN, DEE, BO],
    round: {
      n: 3,
      phase: 'over',
      starters: [ANN, null, CY, DEE],
      result: { won: 1, score: [312, 248] },
    },
    sent: null,
    owed: false,
    told: 3,
    hostBehind: null,
    relayed: { code: 'q3_Lm-8RtZ0aXcVbN2pWkA', ids: [EVE] },
  })
  const fields = (c: Chairs<Opts>) => ({
    seq: c.seq,
    from: c.from,
    chairs: c.chairs,
    mode: c.mode,
    opts: c.opts,
    code: c.code,
    knew: c.knew,
    round: c.round,
  })
  it('wireOf then readChairs gives back every field', () => {
    const c = held()
    // none of them is what a fresh table holds
    const fresh = openChairs(cards, BO).table
    for (const [k, v] of Object.entries(fields(c)))
      expect(JSON.stringify(v), k).not.toBe(JSON.stringify(fresh[k as keyof Chairs<Opts>]))
    // nor, chair by chair, what an empty chair holds; and the chairs did not sit in chair order
    for (const ch of c.chairs) expect(ch).not.toEqual({ id: null, since: 0, cpu: null })
    expect(c.chairs.map((ch) => ch.since)).not.toEqual(
      [...c.chairs.map((ch) => ch.since)].sort((x, y) => x - y),
    )
    expect(readChairs(cards, wireOf(c))).toEqual(fields(c))
    // and the wire is the state 4.2 checks field by field
    expect(wireOf(c)).toEqual(good())
  })
  /** every path to a field on the wire, a chair's three included */
  const paths = (): (string | number)[][] => [
    ...Object.keys(good()).map((k) => [k]),
    ...[0, 1, 2, 3].flatMap((i) => [0, 1, 2].map((j) => ['chairs', i, j])),
    ...Object.keys(roundOf(good())).map((k) => ['round', k]),
  ]
  it.each(paths())('dropping %s refuses the state', (...path) => {
    const b = structuredClone(wireOf(held())) as unknown as Record<string | number, unknown>
    let at = b
    for (const k of path.slice(0, -1)) at = at[k] as Record<string | number, unknown>
    const last = path[path.length - 1]
    if (Array.isArray(at)) at.splice(last as number, 1)
    else delete at[last]
    expect(readChairs(cards, b)).toBeNull()
  })
})

/* what an arrival costs room.ts, counted on room.test.ts's wire on 23 Nov 2026: a higher id joining
   is 3 sends, four people filling a fresh toy lowest first is 10. A live table is the same. */
const HIGH_ID_ARRIVAL = 3
const FRESH_FOUR = 10
/* and one more than room.ts for a lower id who has just joined the call: his hello is answered by
   the host before him, and he, now host, says that he has heard the code (chairs.ts, THE CODE) */
const LOW_ID_ARRIVAL = 4

describe('4.9 what an arrival costs', () => {
  /** `x`'s `where` lands: everybody already on the toy counts them present */
  const arrives = (t: Net, x: string) => {
    t.see([...t.tabs.keys(), x])
    t.flush()
  }
  /** `x`'s toy mounts: its table opens, says hello and sees who is here */
  const opens = (t: Net, x: string, here: string[]) => {
    t.open(x)
    t.look(x, here)
    t.flush()
  }
  it('a higher id joining a table is 3 sends, as at a call table', () => {
    const t = table(cards, [BO, CY], [BO, CY, DEE])
    t.see()
    t.settle()
    t.do(BO, { t: 'sit', chair: 0 })
    t.settle()
    t.do(CY, { t: 'sit', chair: 1 })
    t.settle()
    const from = t.log.length
    arrives(t, DEE)
    opens(t, DEE, [BO, CY, DEE])
    expect(t.who(DEE)).toEqual([BO, CY, null, null])
    expect(t.agree()).toBe(true)
    expect(t.log.length - from).toBe(HIGH_ID_ARRIVAL)
    // and nobody owes anybody afterwards: a second on, nothing more
    t.settle()
    expect(t.log.length - from).toBe(HIGH_ID_ARRIVAL)
  })
  it('four people filling a fresh table, lowest first, is 10, as at a call table', () => {
    const t = table(cards, [], [BO, ANN, CY, DEE])
    const ids: string[] = []
    for (const x of [BO, ANN, CY, DEE]) {
      ids.push(x)
      arrives(t, x)
      opens(t, x, [...ids])
    }
    expect(t.agree()).toBe(true)
    expect(t.get(DEE).code).toMatch(CODE)
    expect(t.log.length).toBe(FRESH_FOUR)
    t.settle()
    expect(t.log.length).toBe(FRESH_FOUR)
  })
  it('a lower id joining the call and a table in progress is handed it, for 4 sends', () => {
    const t = table(cards, [ANN, CY])
    t.see()
    t.settle()
    t.do(CY, { t: 'sit', chair: 1 })
    t.settle()
    t.do(ANN, { t: 'sit', chair: 0 })
    t.settle()
    const from = t.log.length
    t.call([ANN, CY, BO])
    arrives(t, BO)
    opens(t, BO, [ANN, CY, BO])
    expect(t.who(BO)).toEqual([ANN, CY, null, null])
    expect(hostOf(t.get(ANN))).toBe(BO)
    expect(t.agree()).toBe(true)
    expect(t.log.length - from).toBe(LOW_ID_ARRIVAL)
    // Cy heard Bo's hello and owed him the table, and Ann's answer paid it: nothing more goes
    t.settle()
    expect(t.log.length - from).toBe(LOW_ID_ARRIVAL)
    // and the table goes on under him: Cy, who sat first, sets it
    t.do(CY, { t: 'mode', mode: 'together' })
    t.settle()
    expect(t.agree()).toBe(true)
    expect(t.get(ANN).mode).toBe('together')
  })
})

describe('a host without the table, and two hosts at once (review of 26 Nov 2026)', () => {
  /** Cy sits at North, adds a computer at West and starts round 1, with Ann hosting */
  const onUnderAnn = (onCall: string[]) => {
    const t = table(cards, [ANN, CY], onCall)
    t.see()
    t.settle()
    t.do(CY, { t: 'sit', chair: 2 })
    t.settle()
    t.do(CY, { t: 'cpu', chair: 1, level: 0 })
    t.settle()
    t.do(CY, { t: 'start', n: 1 })
    t.settle()
    expect(t.get(CY).round).toMatchObject({ n: 1, phase: 'on' })
    return t
  }
  it('a lowest id arriving whose hello the host before them never answers is handed the table at the next look', () => {
    /* Bo's where lands and his toy mounts: he is host, with a fresh table. Ann, who answersHello
       names, closes her toy before his hello reaches her; or her tab hangs, and stays listed */
    for (const gone of ['closed', 'hung']) {
      const t = onUnderAnn([ANN, CY, BO])
      const held = t.get(CY)
      t.see([ANN, CY, BO])
      t.open(BO)
      t.look(BO, [ANN, CY, BO])
      t.tabs.delete(ANN)
      t.flush()
      expect(t.get(BO).seq, gone).toBe(1)
      /* Cy owes Bo the table, due a second on: an answer reaching her in that second would pay it,
         and a look before then sends nothing */
      expect(dueAt(t.get(CY)), gone).toBe(t.now() + PACE_MS)
      const here = gone === 'closed' ? [CY, BO] : [ANN, CY, BO]
      const from = t.log.length
      t.look(CY, here)
      expect(t.log.length, gone).toBe(from)
      t.later(PACE_MS)
      t.look(CY, here)
      t.look(BO, here)
      t.flush()
      expect(t.agree(), gone).toBe(true)
      expect(t.get(BO), gone).toMatchObject({ seq: held.seq, from: ANN, round: { n: 1 } })
      // paid once: the table is quiet after it
      const paid = t.log.length
      for (let i = 0; i < 3; i++) t.settle()
      expect(t.sent('state', paid), gone).toBe(0)
      // and the round Cy is playing can end
      t.do(CY, { t: 'over', n: 1, result: RESULT })
      t.settle()
      expect(t.get(CY).round.phase, gone).toBe('over')
    }
  })
  /**
   * Ann hosts Cy and Dee playing round 1, with Bo on the call; Bo's where lands and his toy
   * mounts, and Ann closes hers before his hello reaches her. `missed` is whether Ann's last state
   * (a computer added at East) reached Dee and not Cy
   */
  const unanswered = (missed: boolean) => {
    const t = table(cards, [ANN, CY, DEE], [ANN, CY, DEE, BO])
    t.see()
    t.settle()
    t.do(CY, { t: 'sit', chair: 2 })
    t.settle()
    t.do(DEE, { t: 'sit', chair: 0 })
    t.settle()
    t.later(5000)
    t.do(CY, { t: 'cpu', chair: 3, level: 2 })
    t.flush(missed ? [ANN, DEE] : undefined)
    t.wire.length = 0
    t.see([ANN, CY, DEE, BO])
    t.open(BO)
    t.look(BO, [ANN, CY, DEE, BO])
    t.tabs.delete(ANN)
    t.flush()
    for (const id of [CY, DEE]) expect(dueAt(t.get(id)), id).not.toBeNull()
    t.later(PACE_MS)
    return t
  }
  it('what two tabs owe the host is paid once: the first to hand it over pays for both', () => {
    const t = unanswered(false)
    const from = t.log.length
    t.look(CY, [CY, DEE, BO])
    t.flush()
    t.look(DEE, [CY, DEE, BO])
    t.look(BO, [CY, DEE, BO])
    t.flush()
    expect(t.sent('state', from)).toBe(1)
    expect(t.agree()).toBe(true)
  })
  it('and a later table handed over pays a debt for an earlier one: Cy takes it, and owes nothing', () => {
    const t = unanswered(true)
    const from = t.log.length
    t.look(DEE, [CY, DEE, BO])
    t.flush()
    expect(t.get(CY).chairs[3].cpu).toBe(2)
    t.look(CY, [CY, DEE, BO])
    t.look(BO, [CY, DEE, BO])
    t.flush()
    expect(t.sent('state', from)).toBe(1)
    expect(t.agree()).toBe(true)
  })
  it('owing nothing: a newcomer’s fresh table again, a late copy of the host’s own state, anybody else’s earlier one', () => {
    /* Bo, on the call from the start, arrives with the lowest id and is handed the table by Ann;
       then three earlier states reach Cy, and none of them is a host without the table */
    const t = table(cards, [ANN, CY, DEE], [ANN, CY, DEE, BO])
    t.see()
    t.settle()
    t.do(CY, { t: 'sit', chair: 2 })
    t.settle()
    const early = lastState(t, ANN)
    t.see([ANN, CY, DEE, BO])
    t.open(BO)
    t.look(BO, [ANN, CY, DEE, BO])
    t.flush()
    const fresh = lastState(t, BO)
    expect(fresh.body).toMatchObject({ seq: 1, by: BO })
    expect(t.get(CY).from).toBe(ANN)
    // Bo's fresh table again, as his roster fills
    const quiet = () => {
      const from = t.log.length
      t.settle()
      t.settle()
      return t.sent('state', from)
    }
    t.wire.push(fresh)
    t.flush([CY])
    expect(quiet()).toBe(0)
    // a late copy of a state Bo published, to Cy holding a later one of his
    t.do(DEE, { t: 'sit', chair: 0 })
    t.settle()
    const boEarly = lastState(t, BO)
    t.do(DEE, { t: 'stand' })
    t.settle()
    expect(t.get(CY).from).toBe(BO)
    t.wire.push(boEarly)
    t.flush([CY])
    expect(quiet()).toBe(0)
    // an earlier state from Dee, who is not the host
    t.wire.push({ from: DEE, body: early.body })
    t.flush([CY])
    expect(quiet()).toBe(0)
    expect(t.agree()).toBe(true)
  })
  it('a table with nothing in it owes nobody', () => {
    /* Cy's toy has just opened and sees Ann and Bo, before anybody has told it a thing */
    const c = present(openChairs(cards, CY).table, [CY, ANN, BO], [ANN, BO], 0).table
    const s = receive(cards, c, BO, { v: 1, sub: 'cards', t: 'hello' }, 0)
    expect(present(s.table, [CY, ANN, BO], [ANN, BO], PACE_MS).out).toEqual([])
    expect(dueAt(s.table)).toBeNull()
  })
  it('owing the host and then hosting it: the announcement pays, and nothing goes out again', () => {
    const t = unanswered(false)
    // Bo closes the toy too before anybody's look: Cy hosts, and tells the table
    t.tabs.delete(BO)
    t.see([CY, DEE])
    t.flush()
    t.later(PACE_MS)
    // somebody lower's where lands: Cy is not host now, and has nothing left to send
    const from = t.log.length
    t.look(CY, [CY, DEE, '00000000-0000-0000-0000-000000000000'])
    expect(t.sent('state', from)).toBe(0)
  })
  it("the host's last state, still on its way when it hangs up, is refused by the next host and handed to it by somebody who has it", () => {
    /* Ann hosts; her start of round 1 reaches Dee and is late at Cy, who by then has her off the
       call and refuses it, and hosts from the table before it. Until now Cy's first state tied
       Ann's at one seq and lost, at Dee, for good */
    const t = table(cards, [ANN, CY, DEE])
    t.see()
    t.settle()
    t.do(CY, { t: 'sit', chair: 2 })
    t.settle()
    t.do(DEE, { t: 'sit', chair: 0 })
    t.settle()
    t.later(5000)
    const code = t.get(ANN).code
    t.do(CY, { t: 'start', n: 1 })
    t.flush([ANN])
    const start = lastState(t, ANN)
    expect(start.body).toMatchObject({ round: { n: 1, phase: 'on' } })
    t.wire.push(start)
    t.flush([DEE])
    t.tabs.delete(ANN)
    t.call([CY, DEE])
    t.see()
    t.wire.push(start)
    t.flush()
    t.settle()
    expect(t.agree()).toBe(true)
    // the round Ann started, on the code it started on: a code is never changed mid-round
    expect(t.get(CY)).toMatchObject({ from: ANN, code, round: { n: 1, phase: 'on' } })
    // and Cy, hosting a round Ann started, keeps its code to the round's end though Ann has gone
    t.settle()
    expect(t.get(CY).code).toBe(code)
    // Cy's own start of round 1 is refused, as a repeat; Dee's end of it is not
    t.do(CY, { t: 'start', n: 1 })
    t.settle()
    t.do(DEE, { t: 'over', n: 1, result: RESULT })
    t.settle()
    expect(t.get(CY).round).toMatchObject({ n: 1, phase: 'over' })
    expect(t.get(CY).code).not.toBe(code)
    const ons = t.log.filter((m) => m.body.t === 'state' && m.body.round.phase === 'on')
    expect(new Set(ons.map((m) => JSON.stringify((m.body as { round: unknown }).round)))).toEqual(
      new Set([JSON.stringify((start.body as { round: unknown }).round)]),
    )
  })
  it("the host's last state lost on its way to the next host, when it is the round's end: the next round can start", () => {
    const t = table(cards, [ANN, CY, DEE])
    t.see()
    t.settle()
    t.do(CY, { t: 'sit', chair: 2 })
    t.settle()
    t.do(DEE, { t: 'sit', chair: 0 })
    t.settle()
    t.do(CY, { t: 'start', n: 1 })
    t.settle()
    t.later(5000)
    t.do(DEE, { t: 'over', n: 1, result: RESULT })
    t.flush([ANN, DEE])
    t.wire.length = 0
    expect(t.get(DEE).round.phase).toBe('over')
    t.tabs.delete(ANN)
    t.call([CY, DEE])
    t.see()
    t.flush()
    t.settle()
    expect(t.agree()).toBe(true)
    expect(t.get(CY).round).toMatchObject({ n: 1, phase: 'over' })
    t.do(CY, { t: 'start', n: 2 })
    t.settle()
    expect(t.get(DEE).round).toMatchObject({ n: 2, phase: 'on' })
  })
  it('two hosts for a moment: a round one of them started is not undone by the other', () => {
    /* Ann's view has not caught up with Bo, so she still hosts. She takes Cy's start; Bo, the
       lowest id, takes Dee's sit; both at one seq. Until now the lower id won the tie, so Cy and
       Dee saw round 1 begin and then end without a move, and it began again */
    const t = table(cards, [ANN, CY, DEE], [ANN, CY, DEE, BO])
    t.see()
    t.settle()
    t.do(CY, { t: 'sit', chair: 2 })
    t.settle()
    t.do(CY, { t: 'cpu', chair: 1, level: 0 })
    t.settle()
    t.open(BO)
    for (const id of [BO, CY, DEE]) t.look(id, [ANN, CY, DEE, BO])
    t.flush()
    expect(t.agree()).toBe(true)
    t.later(PACE_MS)
    t.do(DEE, { t: 'sit', chair: 0 })
    t.do(CY, { t: 'start', n: 1 })
    const [sit, start] = t.wire.splice(0)
    t.wire.push(start)
    t.flush([ANN])
    const annStart = lastState(t, ANN)
    t.wire.push(annStart)
    t.flush([CY, DEE])
    const on = t.get(DEE).round
    expect(on).toMatchObject({ n: 1, phase: 'on' })
    t.wire.push(sit)
    t.flush([BO])
    expect((lastState(t, BO).body as { seq: number }).seq).toBe(t.get(DEE).seq)
    t.wire.push(lastState(t, BO))
    t.flush()
    t.look(ANN, [ANN, CY, DEE, BO])
    t.flush()
    expect(t.get(DEE).round).toEqual(on)
    t.settle()
    expect(t.agree()).toBe(true)
    expect(t.get(BO).round).toEqual(on)
    // the captain's start reaching Bo now starts nothing
    t.wire.push(start)
    t.settle()
    expect(t.get(DEE).round).toEqual(on)
  })
  it('two hosts for a moment: a start held for the pace by the one who loses the tie still starts the round', () => {
    /* Ann, captain and host in her own view, starts within a second of answering Bo's hello, so
       her start waits; Bo, the real host, seats Dee at the same seq. Until now her start went out
       after his sit, lost the tie and was gone, though she had pressed it */
    const t = table(cards, [ANN, CY, DEE], [ANN, CY, DEE, BO])
    t.see()
    t.settle()
    t.do(ANN, { t: 'sit', chair: 2 })
    t.settle()
    t.do(ANN, { t: 'cpu', chair: 1, level: 0 })
    t.settle()
    t.later(5000)
    t.open(BO)
    for (const id of [BO, CY, DEE]) t.look(id, [ANN, CY, DEE, BO])
    t.flush()
    t.do(ANN, { t: 'start', n: 1 })
    expect(dueAt(t.get(ANN))).not.toBeNull()
    t.do(DEE, { t: 'sit', chair: 0 })
    t.flush([BO, CY, DEE])
    t.look(ANN, [ANN, CY, DEE, BO])
    t.flush()
    t.settle()
    expect(t.agree()).toBe(true)
    expect(t.get(DEE).round).toMatchObject({ n: 1, phase: 'on', starters: [null, null, ANN, null] })
  })
  it("at one seq a round's end is later than its start, whoever published either", () => {
    const t = table(cards, [CY, DEE])
    t.see()
    t.settle()
    const c = t.get(DEE)
    const at = (by: string, phase: 'on' | 'over') => ({
      ...good(),
      by,
      round: { ...roundOf(good()), phase, result: phase === 'over' ? RESULT : null },
    })
    const on = receive(cards, c, CY, at(ANN, 'on'), 0).table
    expect(on.round.phase).toBe('on')
    expect(receive(cards, on, CY, at(EVE, 'over'), 0).table.round.phase).toBe('over')
    const over = receive(cards, c, CY, at(EVE, 'over'), 0).table
    expect(receive(cards, over, CY, at(ANN, 'on'), 0).table.round.phase).toBe('over')
  })
  it('the host leaves: the next host tells the table it holds, so a tab that missed a state catches up', () => {
    /* review of 26 Nov 2026: plan §5, "the next lowest on the toy carries the chairs from the last
       state it holds, as room.ts does", and nothing here drove a host leaving */
    const t = table(cards, [BO, ANN, DEE])
    t.see()
    t.settle()
    t.later(5000)
    t.do(ANN, { t: 'sit', chair: 0 })
    t.flush([BO, ANN])
    expect(t.who(DEE)).toEqual([null, null, null, null])
    t.tabs.delete(BO)
    t.see()
    t.flush()
    expect(t.who(DEE)).toEqual([ANN, null, null, null])
    expect(t.agree()).toBe(true)
  })
})

describe('what verification found (27 Nov 2026)', () => {
  it("the host's last state handed on a second late: what the next host changes in that second does not undo its round", () => {
    /* Z1. Ann's start reaches Dee as Ann hangs up, and Cy, who never had it, hosts and re-mints.
       Dee owes Cy the round, a second on. Until now anything Cy published in that second was a
       later seq, which Dee took, and round 1, which she was playing, was gone everywhere: the
       captain setting the mode, or a friend joining the call, whom Cy counts at once */
    for (const change of ['the mode', 'a friend joins the call'] as const) {
      const t = table(cards, [ANN, CY, DEE])
      t.see()
      t.settle()
      t.do(CY, { t: 'sit', chair: 2 })
      t.settle()
      t.do(DEE, { t: 'sit', chair: 0 })
      t.settle()
      t.later(5000)
      const code = t.get(ANN).code
      t.do(CY, { t: 'start', n: 1 })
      t.flush([ANN])
      t.wire.push(lastState(t, ANN))
      t.flush([DEE])
      expect(t.get(DEE).round, change).toMatchObject({ n: 1, phase: 'on' })
      t.tabs.delete(ANN)
      t.call([CY, DEE])
      t.see()
      t.flush()
      expect(t.get(CY).round.phase, change).toBe('open')
      expect(dueAt(t.get(DEE)), change).not.toBeNull()
      t.later(200)
      if (change === 'the mode') t.do(CY, { t: 'mode', mode: 'together' })
      else {
        t.call([BO, CY, DEE])
        t.look(CY, [CY, DEE])
      }
      // what Cy holds goes out a hop before Dee's debt falls due
      t.later(PACE_MS - 200)
      t.look(CY, [CY, DEE])
      t.flush()
      for (let i = 0; i < 3; i++) t.settle()
      expect(t.agree(), change).toBe(true)
      expect(t.get(CY), change).toMatchObject({ code, round: { n: 1, phase: 'on' } })
      if (change === 'a friend joins the call') expect(t.get(DEE).knew).toContain(BO)
    }
  })
  it('a lowest id handed the code, whose own count of it is lost, is counted by whoever handed it over', () => {
    /* Z2. Bo's fold was the one state saying he had heard the code, and it was lost; Ann, who
       answered his hello, recorded nothing, so when he hung up the next round began on the code
       he had heard. Ann had him on her call as she sent it, which is all `knew` is about */
    const t = table(cards, [ANN, CY, DEE])
    t.see()
    t.settle()
    t.do(CY, { t: 'sit', chair: 2 })
    t.settle()
    t.do(DEE, { t: 'sit', chair: 0 })
    t.settle()
    const code = t.get(ANN).code
    t.call([ANN, CY, DEE, BO])
    t.see([ANN, CY, DEE, BO])
    t.flush()
    t.open(BO)
    t.look(BO, [ANN, CY, DEE, BO])
    // Bo's hello and his fresh table reach everybody, and Ann answers it
    t.flush([ANN, CY, DEE])
    const answer = lastState(t, ANN)
    expect(answer.body).toMatchObject({ code })
    t.wire.push(answer)
    t.flush([BO])
    expect(t.get(BO).code).toBe(code)
    // he counts himself as having heard it, in a state lost on its way to everybody
    expect(lastState(t, BO).body).toMatchObject({ code, knew: expect.arrayContaining([BO]) })
    t.wire.length = 0
    t.tabs.delete(BO)
    t.call([ANN, CY, DEE])
    t.see([ANN, CY, DEE])
    t.settle()
    expect(t.agree()).toBe(true)
    expect(t.get(ANN).code).not.toBe(code)
    // and the round Cy starts is on the new code
    t.do(CY, { t: 'start', n: 1 })
    t.settle()
    expect(t.get(DEE)).toMatchObject({ code: t.get(ANN).code, round: { n: 1, phase: 'on' } })
  })
  it('a friend handed a code that has since been re-minted costs the new one nothing', () => {
    /* what a tab records for handing a code on is about that code: Ann answered Bo's hello on
       Dee's code, Dee left and Bo re-minted, so Dee never heard the new one */
    const t = table(cards, [ANN, CY, DEE])
    t.see()
    t.settle()
    t.do(CY, { t: 'sit', chair: 2 })
    t.settle()
    t.call([ANN, CY, DEE, BO])
    t.see([ANN, CY, DEE, BO])
    t.flush()
    t.open(BO)
    t.look(BO, [ANN, CY, DEE, BO])
    t.flush()
    const old = t.get(BO).code
    expect(t.get(ANN).knew).toContain(BO)
    // Dee hangs up, and Bo, who hosts, re-mints between rounds
    t.tabs.delete(DEE)
    t.call([ANN, CY, BO])
    t.see([ANN, CY, BO])
    t.settle()
    const code = t.get(ANN).code
    expect(code).not.toBe(old)
    // Bo closes the toy and stays on the call: Ann hosts the new code, which everybody here heard
    t.tabs.delete(BO)
    t.see([ANN, CY])
    for (let i = 0; i < 3; i++) t.settle()
    expect(t.agree()).toBe(true)
    expect(t.get(ANN).code).toBe(code)
  })
  it('two hosts each taking one start: the one held for the pace keeps the code of the round already on', () => {
    /* Z3. Ann still hosts in her own view and publishes Cy's start at once; Bo, the lowest id,
       takes the same start a second after his last state and holds it. Eve, who heard the code,
       hangs up within that second. Bo's held start counted as begun by nobody, so he re-minted
       it, and Cy and Dee, playing round 1, had its code changed under them */
    const t = table(cards, [ANN, CY, DEE], [ANN, CY, DEE, EVE])
    t.see()
    t.settle()
    t.do(CY, { t: 'sit', chair: 2 })
    t.settle()
    t.do(DEE, { t: 'sit', chair: 0 })
    t.settle()
    t.later(5000)
    expect(t.get(ANN).knew).toContain(EVE)
    // Bo, the lowest id, joins the call and opens the toy; Ann has him on her call, not her toy
    t.call([ANN, BO, CY, DEE, EVE])
    t.look(ANN, [ANN, CY, DEE])
    t.open(BO)
    // Bo sees Ann and Cy, Cy and Dee see Bo, and Ann's view of him lags: two hosts
    t.look(BO, [ANN, BO, CY])
    for (const id of [CY, DEE]) t.look(id, [ANN, BO, CY, DEE])
    t.flush()
    const code = t.get(BO).code
    expect(t.get(ANN).code).toBe(code)
    // Dee reaches Bo's view half a second on, and he tells the table: his pace starts again
    t.later(500)
    t.look(BO, [ANN, BO, CY, DEE])
    t.flush()
    t.later(700)
    t.do(CY, { t: 'start', n: 1 })
    t.flush()
    expect(t.get(DEE)).toMatchObject({ code, round: { n: 1, phase: 'on' } })
    expect(dueAt(t.get(BO))).not.toBeNull()
    // Eve hangs up, and Bo's held start falls due
    t.call([ANN, BO, CY, DEE])
    t.later(300)
    t.look(BO, [ANN, BO, CY, DEE])
    t.flush()
    t.see([ANN, BO, CY, DEE])
    t.settle()
    expect(t.agree()).toBe(true)
    expect(t.get(DEE)).toMatchObject({ code, round: { n: 1, phase: 'on' } })
    const codes = t.log.flatMap((m) =>
      m.body.t === 'state' && m.body.round.n === 1 && m.body.round.phase === 'on'
        ? [m.body.code]
        : [],
    )
    expect(new Set(codes)).toEqual(new Set([code]))
  })
  it('a host whose toy reopens before anybody sits: one code on the call at quiet', () => {
    /* Z4. Bo's first table and his second are both "seq 1 by Bo", so neither was later than the
       other: Ann kept the one she had, Bo the one he minted, and two codes stood for good */
    for (const [first, second] of [
      [0x10, 0x60],
      [0x60, 0x10],
    ]) {
      random(first, second)
      const t = table(cards, [BO, ANN])
      t.see()
      t.settle()
      const k1 = t.get(ANN).code
      expect(t.get(BO)).toMatchObject({ seq: 1, from: BO, code: k1 })
      t.tabs.delete(BO)
      t.look(ANN, [ANN])
      t.flush()
      t.later(2000)
      t.open(BO)
      t.see([BO, ANN])
      for (let i = 0; i < 5; i++) t.settle()
      expect(t.get(BO).code).not.toBe('')
      expect(t.agree(), `${first}`).toBe(true)
      // the lower of the two codes, on every tab, whichever was minted first
      const k2 = codeFrom(new Uint8Array(16).fill(second))
      expect(t.get(ANN).code).toBe(k1 < k2 ? k1 : k2)
      vi.restoreAllMocks()
    }
  })
  it('a host whose toy reopens, its hello unanswered: its first change shows it lacks the table', () => {
    /* Z5. Cy holds Bo's table, and Bo reopens the toy: his hello reaches Cy before Cy sees him
       back, and Ann, who would have answered, hangs up. Bo's new session is "by Bo" like the
       table Cy holds, so the late-copy rule read each of its states as a late copy of his own,
       and Cy owed nothing until his new seq passed hers. A different code is a different table */
    const t = table(cards, [BO, ANN, CY])
    t.see()
    t.settle()
    t.do(CY, { t: 'sit', chair: 2 })
    t.settle()
    t.do(ANN, { t: 'sit', chair: 0 })
    t.settle()
    for (const target of [200, 500, 300, 200, 300, 500] as const) {
      t.do(CY, { t: 'opts', o: { target } })
      t.settle()
    }
    const held = t.get(CY)
    expect(held).toMatchObject({ from: BO, seq: 9 })
    // Bo's toy closes; Ann hosts and tells the table as it is
    t.tabs.delete(BO)
    t.see([ANN, CY])
    t.flush()
    t.later(2000)
    // it opens again; Ann hangs up before anything reaches her, and Cy hears Bo before she sees him
    t.open(BO)
    t.look(BO, [ANN, BO, CY])
    t.tabs.delete(ANN)
    t.call([BO, CY])
    t.flush([CY])
    expect(dueAt(t.get(CY))).toBeNull()
    t.look(CY, [BO, CY])
    t.look(BO, [BO, CY])
    t.flush()
    t.settle()
    // Bo's first change: Cy owes him the table she holds, and pays it a second on
    t.do(BO, { t: 'sit', chair: 1 })
    t.flush()
    expect(dueAt(t.get(CY))).not.toBeNull()
    t.settle()
    t.settle()
    expect(t.agree()).toBe(true)
    // the table Cy held, Bo's sit in his new session lost; Ann heard its code and has gone
    expect(t.get(BO)).toMatchObject({ opts: { target: 500 }, round: held.round })
    expect(t.who(BO)).toEqual([ANN, null, CY, null])
    expect(t.get(BO).code).not.toBe(held.code)
  })
})

describe('the host sends at most one state a second, and only changes wait', () => {
  it('three changes within a second go out as one state, a second after the last one sent', () => {
    const t = table(cards, [BO, ANN, CY, DEE])
    t.see()
    t.settle()
    t.later(5000)
    const from = t.log.length
    t.do(ANN, { t: 'sit', chair: 0 })
    t.flush()
    t.later(200)
    t.do(CY, { t: 'sit', chair: 2 })
    t.flush()
    t.later(200)
    t.do(DEE, { t: 'sit', chair: 3 })
    t.flush()
    // Ann's went out at once; Cy's and Dee's are held, and the host says until when
    expect(t.sent('state', from)).toBe(1)
    expect(t.who(ANN)).toEqual([ANN, null, null, null])
    const sentAt = t.now() - 400
    expect(dueAt(t.get(BO))).toBe(sentAt + PACE_MS)
    // a tick before then sends nothing
    t.later(PACE_MS - 401)
    t.tick()
    t.flush()
    expect(t.sent('state', from)).toBe(1)
    // and at it, one state carries both
    t.later(1)
    t.tick()
    t.flush()
    expect(t.sent('state', from)).toBe(2)
    expect(dueAt(t.get(BO))).toBeNull()
    expect(t.agree()).toBe(true)
    expect(t.who(ANN)).toEqual([ANN, null, CY, DEE])
  })
  it('a hello is answered at once, with whatever change the host is holding', () => {
    const t = table(cards, [BO, ANN, CY], [BO, ANN, CY, DEE])
    t.see()
    t.settle()
    t.do(ANN, { t: 'sit', chair: 0 })
    t.flush()
    t.do(CY, { t: 'sit', chair: 2 })
    t.flush()
    expect(dueAt(t.get(BO))).not.toBeNull()
    // Dee arrives while Cy's sit is held
    t.see([BO, ANN, CY, DEE])
    t.flush()
    t.open(DEE)
    t.look(DEE, [BO, ANN, CY, DEE])
    t.flush()
    expect(t.who(DEE)).toEqual([ANN, null, CY, null])
    expect(t.agree()).toBe(true)
  })
})

describe('a chair held for somebody who has gone', () => {
  it('between rounds, held for HOLD_MS and then freed', () => {
    const t = seated()
    t.later(10_000)
    t.see([DEE, BO, ANN])
    const gone = t.now()
    t.later(HOLD_MS - 1)
    t.tick()
    t.flush()
    expect(t.who(DEE)).toEqual([ANN, null, CY, null])
    t.later(1)
    t.tick()
    t.flush()
    expect(t.now() - gone).toBe(HOLD_MS)
    expect(t.who(DEE)).toEqual([ANN, null, null, null])
    expect(t.agree([DEE, BO, ANN])).toBe(true)
  })
  it('while a round is on, held to its end however long that is, then freed', () => {
    const t = seated()
    t.do(CY, { t: 'start', n: 1 })
    t.settle()
    t.see([DEE, BO, ANN])
    t.later(HOLD_MS * 5)
    t.tick()
    t.flush()
    expect(t.who(DEE)).toEqual([ANN, null, CY, null])
    t.do(ANN, { t: 'over', n: 1, result: { won: 0, score: [300, 0] } })
    t.settle([DEE, BO, ANN])
    expect(t.get(DEE).round.phase).toBe('over')
    expect(t.who(DEE)).toEqual([ANN, null, null, null])
  })
})

describe('a chair held for somebody whose id names one of an object’s own keys', () => {
  /* review of 26 Nov 2026: `missing` was a plain object, so 'constructor' read back Object, the
     wait was NaN, and the chair was never freed: no round could start. Only a modified client can
     seat such an id, by a forged state from somebody on the call */
  const forged = (c: Chairs<Opts>, id: string) => {
    const b = wireOf(c) as unknown as Record<string, unknown>
    const seq = c.seq + 5
    const chairs = (b.chairs as unknown[][]).map((ch) => [...ch])
    chairs[1] = [id, seq, null]
    return { ...b, seq, chairs }
  }
  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    "'%s' is freed a minute on, like anybody",
    (id) => {
      const t = table(cards, [BO, ANN, CY])
      t.see()
      t.settle()
      t.do(ANN, { t: 'sit', chair: 0 })
      t.settle()
      t.wire.push({ from: CY, body: forged(t.get(BO), id) as unknown as Live })
      t.flush()
      expect(t.who(BO)[1]).toBe(id)
      t.later(1)
      t.tick()
      t.flush()
      t.later(HOLD_MS)
      t.tick()
      t.flush()
      expect(t.who(ANN)).toEqual([ANN, null, null, null])
      expect(startable(cards, t.get(BO))).toEqual({
        t: 'toy',
        words: 'Cards needs two players: take a chair, or add a computer.',
      })
      // and by a host whose first look comes after it holds the table, from openChairs' own `{}`
      const fresh = { ...openChairs(cards, BO).table, roster: [CY] }
      const held = receive(cards, fresh, CY, forged(t.get(CY), id), 0).table
      expect(held.chairs[1].id).toBe(id)
      const first = present(held, [BO], [CY], 0).table
      expect(present(first, [BO], [CY], HOLD_MS).table.chairs[1].id).toBeNull()
    },
  )
})

describe('a seated friend who leaves the call', () => {
  it('stays in their chair on the table everybody hears, to the end of the round', () => {
    const t = seated()
    t.do(CY, { t: 'start', n: 1 })
    t.settle()
    // Cy hangs up: off the toy and off the call, still in the round's chair
    t.call([DEE, BO, ANN])
    t.see([DEE, BO, ANN])
    t.flush()
    t.do(ANN, { t: 'over', n: 1, result: { won: 1, score: [40, 300] } })
    t.settle([DEE, BO, ANN])
    expect(t.agree([DEE, BO, ANN])).toBe(true)
    for (const id of [DEE, BO, ANN]) {
      expect(t.get(id).round.phase).toBe('over')
      expect(t.who(id)).toEqual([ANN, null, CY, null])
    }
  })
})

describe('the code', () => {
  it('is 16 random bytes from crypto.getRandomValues, as 22 base64url characters', () => {
    const asked: number[] = []
    const real = crypto.getRandomValues.bind(crypto)
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((a: ArrayBufferView) => {
      asked.push((a as Uint8Array).length)
      return real(a as Uint8Array)
    })
    const t = table(cards, [BO, ANN])
    t.see()
    t.settle()
    expect(asked).toEqual([16])
    expect(t.get(ANN).code).toMatch(CODE)
  })
  /* the answers are RFC 4648's base64url as Node's Buffer gives it (computed with
     `Buffer.from(bytes).toString('base64url')`, 26 Nov 2026), not codeFrom's own sum */
  it.each([
    [new Uint8Array(16), 'AAAAAAAAAAAAAAAAAAAAAA'],
    [new Uint8Array(16).fill(255), '_____________________w'],
    [Uint8Array.from({ length: 16 }, (_, i) => i * 17), 'ABEiM0RVZneImaq7zN3u_w'],
    [Uint8Array.from({ length: 16 }, (_, i) => 251 - i * 13), '--7h1Me6raCThnlsX1JFOA'],
  ])('codeFrom(%o) is %s, and every byte comes back out of it', (bytes, want) => {
    const code = codeFrom(bytes)
    expect(code).toBe(want)
    expect(code).toMatch(CODE)
    const back = atob(code.replace(/-/g, '+').replace(/_/g, '/') + '==')
    expect(Array.from(back, (ch) => ch.charCodeAt(0))).toEqual([...bytes])
  })
})

describe('teams, and what stands between the captain and a start', () => {
  it('versus, every chair is its own side; together at four, across from each other; together at two, one side', () => {
    const t = seated()
    const c = t.get(BO)
    expect([0, 1, 2, 3].map((i) => teamOf(cards, c, i))).toEqual([0, 1, 2, 3])
    const together = { ...c, mode: 'together' as const }
    expect([0, 1, 2, 3].map((i) => teamOf(cards, together, i))).toEqual([0, 1, 0, 1])
    expect(
      [0, 1].map((i) => teamOf(boat, { ...together, chairs: together.chairs.slice(0, 2) }, i)),
    ).toEqual([0, 0])
  })
  it('a toy with teams of its own reads the table: the people against the computer, as Stackfall together', () => {
    const t = seated()
    t.do(CY, { t: 'cpu', chair: 1, level: 0 })
    t.settle()
    const stack: LiveRules<Opts> = {
      ...race,
      team: (c, chair) => (c.chairs[chair].cpu !== null ? 1 : 0),
    }
    expect([0, 1, 2, 3].map((i) => teamOf(stack, t.get(BO), i))).toEqual([0, 1, 0, 0])
  })
  it('a round on, then somebody seated who is not here, then the toy’s own rule', () => {
    const t = table(cards, [BO, ANN, CY])
    t.see()
    t.settle()
    expect(startable(cards, t.get(BO))).toEqual({
      t: 'toy',
      words: 'Cards needs two players: take a chair, or add a computer.',
    })
    t.do(CY, { t: 'sit', chair: 2 })
    t.settle()
    t.do(CY, { t: 'cpu', chair: 0, level: 0 })
    t.settle()
    expect(startable(cards, t.get(BO))).toBeNull()
    // the same table asked of who is linked to the relay: Cy is not yet
    expect(startable(cards, t.get(BO), new Set([BO, ANN]))).toEqual({ t: 'waiting', id: CY })
    t.see([BO, ANN])
    expect(startable(cards, t.get(BO))).toEqual({ t: 'waiting', id: CY })
    t.do(CY, { t: 'start', n: 1 })
    t.flush([BO, ANN])
    expect(t.get(BO).round.phase).toBe('open')
    t.see([BO, ANN, CY])
    t.flush()
    t.do(CY, { t: 'start', n: 1 })
    t.settle()
    expect(startable(cards, t.get(BO))).toEqual({ t: 'playing' })
  })
})
