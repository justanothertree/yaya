import { describe, expect, it } from 'vitest'
import {
  KNOBS,
  ask,
  canStart,
  consentAfter,
  holdOn,
  hopPlan,
  knobs,
  leads,
  listen,
  nextGuide,
  receive,
  rideStep,
  rollFaces,
  startTour,
  stateOf,
  tick,
  type Bus,
  type Consent,
  type Ctx,
  type Knobs,
  type Leaves,
  type Msg,
  type Press,
  type Step,
} from './bus'
import { ROOM_TOYS, sendsFor } from './tour'

/* toys to roll: every call-table toy, and plain ones; nobody starts on any of them */
const PLAIN = ['swarm', 'paint', 'aurora', 'tides', 'boids', 'mandala', 'orbit', 'ripple']
const TOYS = [...ROOM_TOYS, ...PLAIN]
const START = 'sand'

/** a seeded stream, so a tour is the same tour every run */
function seeded(seed = 7) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

type Client = {
  id: string
  bus: Bus
  /** the toy on this client's screen */
  sub: string | null
  consent: Consent
  moved: Set<string>
  planned: Set<string>
  hop: { at: number; key: string; toy: string; n: number } | null
  late: string[]
  /** the toy this client holds a seat at, in a game still going (held.ts) */
  seat: string | null
  listening: boolean
  /** who this client sees on the Lab, when it is not everybody */
  view: Set<string> | null
}

/**
 * Several browsers on one call, and the wire between them — room.test.ts's `party`, with a clock,
 * who is on the Lab, each browser's own consent, and its hops. Every message crosses the wire as
 * JSON, so nothing shared by reference can pass for agreement.
 */
function party(ids: string[], o: { k?: Knobs; people?: number } = {}) {
  const k = o.k ?? KNOBS
  let now = 0
  let tours = 0
  const cs = new Map<string, Client>()
  /** on the Lab and live */
  const here = new Set(ids)
  const roster = new Set(ids)
  const wire: { from: string; m: Msg }[] = []
  const log: { at: number; from: string; m: Msg }[] = []
  const landings: { at: number; id: string; toy: string }[] = []
  for (const id of ids)
    cs.set(id, {
      id,
      bus: listen(id, 0),
      sub: START,
      consent: null,
      moved: new Set(),
      planned: new Set(),
      hop: null,
      late: [],
      seat: null,
      listening: true,
      view: null,
    })
  const people = () => o.people ?? roster.size
  const ctx = (id: string): Ctx => {
    const c = cs.get(id)!
    const seen = c.view ?? here
    return {
      now,
      present: seen,
      roster,
      meLive: here.has(id) && seen.has(id),
      subOf: (x) => (seen.has(x) ? (cs.get(x)?.sub ?? null) : null),
      people: people(),
      k,
    }
  }
  const send = (from: string, out: Step['out']) => {
    for (const o of out) {
      const m: Msg = o.t === 'state' ? stateOf(cs.get(from)!.bus, now) : o
      const copy = JSON.parse(JSON.stringify(m)) as Msg
      wire.push({ from, m: copy })
      log.push({ at: now, from, m: copy })
    }
  }
  /** a departure seen for the first time: when do I hop, if at all */
  const plan = (c: Client) => {
    const b = c.bus
    const n = b.stops.length
    const key = `${b.tour}:${n}`
    if (!n || c.planned.has(key)) return
    c.planned.add(key)
    const p = hopPlan(b, now, c.consent, people(), c.moved)
    if (p?.do === 'hop') c.hop = { at: p.at, key, toy: b.stops[n - 1].toy, n }
    if (p?.do === 'late') c.late.push(key)
  }
  const apply = (c: Client, s: Step) => {
    c.bus = s.bus
    send(c.id, s.out)
    plan(c)
  }
  const net = {
    k,
    here,
    roster,
    wire,
    log,
    landings,
    get now() {
      return now
    },
    get: (id: string) => cs.get(id)!,
    bus: (id: string) => cs.get(id)!.bus,
    ctx,
    clients: () => [...cs.values()],
    /** deliver everything queued, to everybody listening but its sender, until the wire is quiet */
    flush() {
      for (let guard = 0; wire.length && guard < 20_000; guard++) {
        const { from, m } = wire.shift()!
        for (const c of cs.values())
          if (c.id !== from && c.listening) apply(c, receive(c.bus, ctx(c.id), from, m))
      }
    },
    tickAll() {
      for (const c of cs.values()) if (c.listening) apply(c, tick(c.bus, ctx(c.id)))
    },
    /** hops that are due: each browser's own rideStep, against its own consent */
    hops() {
      for (const c of cs.values()) {
        const h = c.hop
        if (!h || now < h.at) continue
        c.hop = null
        const r = rideStep({
          consent: c.consent,
          tour: c.bus.tour,
          n: h.n,
          toy: h.toy,
          myToy: c.sub,
          openable: true,
          gateOpen: true,
          sharing: true,
          visible: here.has(c.id),
          onLab: true,
          heldSeat: c.seat,
          inMatch: false,
          moved: c.moved,
        })
        if (r.do !== 'go') continue
        c.sub = r.toy
        c.moved.add(h.key)
        /* when the browser's own timer fires, not when this loop next looks */
        landings.push({ at: h.at, id: c.id, toy: r.toy })
      }
    },
    /** the clock moves on in steps; every browser ticks, the wire drains, hops land */
    run(ms: number, step = 100) {
      const end = now + ms
      while (now < end) {
        now = Math.min(end, now + step)
        net.tickAll()
        net.flush()
        net.hops()
        net.flush()
      }
    },
    runUntil(done: () => boolean, max = 700_000, step = 100) {
      const end = now + max
      while (!done() && now < end) net.run(step, step)
      return done()
    },
    at(ms: number) {
      now = ms
    },
    /** a button pressed in `id`'s browser: its consent first, as useBus will, then the press */
    press(id: string, p: Press, leaves: Leaves = null) {
      const c = cs.get(id)!
      c.consent = consentAfter(c.consent, c.bus, p, leaves)
      apply(c, ask(c.bus, ctx(id), p))
      if (p.t === 'ready' && c.consent?.come) {
        const plan2 = hopPlan(c.bus, now, c.consent, people(), c.moved)
        if (plan2?.do === 'hop')
          c.hop = { at: plan2.at, key: plan2.key, toy: c.consent.toy, n: c.consent.n }
      }
    },
    start(id: string) {
      const c = cs.get(id)!
      tours += 1
      apply(c, startTour(c.bus, ctx(id), `tour${String(tours).padStart(4, '0')}`))
    },
    /** whoever leads now, as they themselves reckon it */
    host: () => [...cs.values()].find((c) => c.listening && leads(c.bus, ctx(c.id)))?.id ?? null,
    /** everybody listening holds the same bus: seq, phase, stops, riders, the guide */
    agree(only?: string[]) {
      const shape = (b: Bus) =>
        JSON.stringify([
          b.tour,
          b.seq,
          b.phase,
          b.guide,
          b.toy,
          b.faces,
          b.riders.map((r) => [r.id, r.on]),
          b.stops.map((s) => s.toy),
        ])
      const who = only ?? [...cs.values()].filter((c) => c.listening).map((c) => c.id)
      const first = shape(cs.get(who[0])!.bus)
      return who.every((id) => shape(cs.get(id)!.bus) === first)
    },
    states: (from?: string) =>
      log.filter((e) => e.m.t === 'state' && (from === undefined || e.from === from)),
  }
  return net
}
type Net = ReturnType<typeof party>

/** ids that sort p01 < p02 < …, boarding in an order that is not that one */
const named = (n: number) =>
  Array.from({ length: n }, (_, i) => `p${String(i + 1).padStart(2, '0')}`)
const boardingOf = (ids: string[]) => ids.map((_, i) => ids[(i * 5 + 2) % ids.length])

/** the guide rolls when the roll opens, and picks the SECOND face, so face 1 is never assumed */
function rollAndPick(net: Net, rand: () => number, pickFace = 1) {
  const h = net.host()!
  net.runUntil(() => net.now >= net.bus(h).openAt)
  const b = net.bus(h)
  const guide = b.riders[b.guide].id
  const faces = rollFaces(TOYS, b, net.get(guide).sub, () => undefined, 'all', rand)!
  net.press(guide, { t: 'roll', faces })
  net.flush()
  net.press(guide, { t: 'pick', toy: faces[pickFace] })
  net.flush()
  return { guide, toy: faces[pickFace] }
}

/** a tour started by `boarding[0]`, everybody else on board in boarding order at the first stop */
function boarded(n: number, o: { k?: Knobs; people?: number } = {}) {
  const ids = named(n)
  const boarding = boardingOf(ids)
  const net = party(ids, o)
  net.run(2000)
  net.start(boarding[0])
  net.flush()
  return { net, ids, boarding }
}

describe('a whole tour (3.1)', () => {
  for (const n of [3, 12])
    it(`${n} riders: five stops, everybody agreeing at every phase, a stale state repeated`, () => {
      const { net, boarding } = boarded(n)
      const rand = seeded(n)
      expect(net.agree()).toBe(true)
      let stale: Msg | null = null
      let staleFrom = ''
      const went: string[] = []
      for (let s = 0; s < 5; s++) {
        const { guide, toy } = rollAndPick(net, rand)
        expect(net.agree()).toBe(true)
        expect(net.bus(guide).phase).toBe('ready')
        if (s === 0) {
          /* everybody boards, one at a time, in an order that is not the ids' */
          for (const id of boarding.slice(1)) {
            net.press(id, { t: 'ready', on: true })
            net.flush()
            expect(net.agree()).toBe(true)
          }
          expect(net.bus(guide).riders.map((r) => r.id)).toEqual(boarding)
          const ready = net.log.filter((e) => e.m.t === 'state' && e.m.phase === 'ready')
          stale = ready[ready.length - 1].m
          staleFrom = ready[ready.length - 1].from
        } else
          for (const id of boarding)
            if (id !== guide) {
              net.press(id, { t: 'ready', on: true })
              net.flush()
            }
        expect(net.agree()).toBe(true)
        net.runUntil(() => net.bus(guide).stops.length === s + 1)
        expect(net.agree()).toBe(true)
        expect(net.bus(guide).phase).toBe('pick')
        went.push(toy)
        if (s === 2) {
          /* the first stop's ready state, arriving again two stops later */
          net.wire.push({ from: staleFrom, m: stale! })
          net.flush()
          expect(net.agree()).toBe(true)
          expect(net.bus(boarding[0]).stops.length).toBe(3)
        }
      }
      /* the turn comes round to whoever is next, who opens the finale */
      const h = net.host()!
      net.runUntil(() => net.now >= net.bus(h).openAt)
      const fin = net.bus(h).riders[net.bus(h).guide].id
      net.press(fin, { t: 'fin' })
      net.flush()
      expect(net.agree()).toBe(true)
      for (const c of net.clients()) {
        expect(c.bus.phase).toBe('end')
        expect(c.bus.stops.map((x) => x.toy)).toEqual(went)
      }
      /* and everybody who said yes rode: every rider, the guide too, landed on every stop */
      expect(net.landings.length).toBe(5 * n)
    })
})

/**
 * Three riders boarded at a call-table stop, the bus gone and landed. Ids sort p01 < p02 < p03 and
 * they boarded p03, p02, p01 — so the host (p01, the lowest) is the LAST to board, and the turn
 * passes p03 → p02 → p01, the opposite of id order.
 */
function atTable(extra: string[] = []) {
  const ids = ['p01', 'p02', 'p03', ...extra]
  const net = party(ids)
  net.run(2000)
  net.start('p03')
  net.flush()
  net.press('p03', { t: 'roll', faces: ['chess', 'fourrow', 'swarm'] })
  net.flush()
  net.press('p03', { t: 'pick', toy: 'fourrow' })
  net.flush()
  for (const id of ['p02', 'p01']) {
    net.press(id, { t: 'ready', on: true })
    net.flush()
  }
  net.runUntil(() => net.bus('p01').stops.length === 1)
  net.runUntil(() => net.landings.length === 3)
  return net
}
const phase = (net: Net) => net.bus('p01').phase

describe('the turn to roll (3.2)', () => {
  /* boarded cy, ann, dee, bo: ids sort ann < bo < cy < dee */
  const riders = ['cy', 'ann', 'dee', 'bo'].map((id) => ({
    id,
    on: true,
    stars: 0,
    played: 0,
  }))
  const all = new Set(['cy', 'ann', 'dee', 'bo'])
  it('passes in boarding order, wrapping round, skipping anybody away or off the bus', () => {
    expect(nextGuide({ riders, guide: 0 }, all)).toBe(1)
    expect(nextGuide({ riders, guide: 1 }, all)).toBe(2)
    expect(nextGuide({ riders, guide: 3 }, all)).toBe(0)
    expect(nextGuide({ riders, guide: 0 }, new Set(['cy', 'dee', 'bo']))).toBe(2)
    const off = riders.map((r) => (r.id === 'ann' ? { ...r, on: false } : r))
    expect(nextGuide({ riders: off, guide: 0 }, all)).toBe(2)
    /* nobody else here: the guide keeps it */
    expect(nextGuide({ riders, guide: 2 }, new Set(['dee']))).toBe(2)
  })
  it('on the bus: p03 → p02 → p01; an idle guide here keeps it; one away loses it after 20 s', () => {
    const net = atTable()
    expect(net.bus('p01').guide).toBe(1) // p02, boarded second
    /* p02 sits idle far past the point anybody may roll for them, and is never skipped */
    net.run(net.k.IDLE_MS + net.k.GUIDE_GONE_MS + 30_000, 500)
    expect(net.bus('p01').guide).toBe(1)
    /* p02's tab goes away: the turn waits GUIDE_GONE_MS, then passes on in boarding order */
    net.here.delete('p02')
    net.run(net.k.GUIDE_GONE_MS - 200)
    expect(net.bus('p01').guide).toBe(1)
    net.run(400)
    expect(net.bus('p01').guide).toBe(2) // p01, boarded third
    expect(net.agree(['p01', 'p03'])).toBe(true)
  })
})

describe('the dwell and the idle guide (3.3)', () => {
  it('nobody rolls before everybody has had a moment; anybody may once the guide idles', () => {
    const net = atTable()
    const b = net.bus('p01')
    const faces = rollFaces(TOYS, b, 'fourrow', () => undefined, 'all', seeded())!
    /* p02 is guide: refused until the dwell ends */
    net.at(b.openAt - 200)
    net.press('p02', { t: 'roll', faces })
    net.flush()
    expect(phase(net)).toBe('pick')
    /* p03 is not: refused after the dwell, until freeAt */
    net.at(b.openAt + 100)
    net.press('p03', { t: 'roll', faces })
    net.flush()
    expect(phase(net)).toBe('pick')
    net.at(b.freeAt + 100)
    net.press('p03', { t: 'roll', faces })
    net.flush()
    expect(phase(net)).toBe('choose')
    expect(net.agree()).toBe(true)
  })
  it('the guide rolls the moment the dwell ends', () => {
    const net = atTable()
    const b = net.bus('p01')
    net.at(b.openAt)
    net.press('p02', { t: 'roll', faces: ['go', 'hex', 'paint'] })
    net.flush()
    expect(phase(net)).toBe('choose')
  })
})

describe('the hold: the bus waits for a game in progress (3.4)', () => {
  const seated = () => {
    const net = atTable()
    /* p03 sits down at Four in a row and makes a move: their seat is held */
    net.get('p03').seat = 'fourrow'
    net.press('p03', { t: 'sit', on: true })
    net.flush()
    net.at(net.bus('p01').openAt + 100)
    return net
  }
  const faces = ['go', 'hex', 'paint'] as [string, string, string]
  it('holds the guide’s roll while somebody here is playing, and Roll anyway goes', () => {
    const net = seated()
    expect(net.bus('p01').busy).toEqual([0])
    net.press('p02', { t: 'roll', faces })
    net.flush()
    expect(phase(net)).toBe('pick')
    net.press('p02', { t: 'roll', faces, anyway: true })
    net.flush()
    expect(phase(net)).toBe('choose')
  })
  it('lets go when they stand up', () => {
    const net = seated()
    net.press('p03', { t: 'sit', on: false })
    net.flush()
    net.press('p02', { t: 'roll', faces })
    net.flush()
    expect(phase(net)).toBe('choose')
  })
  it('lets go when they are not here', () => {
    const net = seated()
    net.here.delete('p03')
    net.press('p02', { t: 'roll', faces })
    net.flush()
    expect(phase(net)).toBe('choose')
  })
  it('lets go after HOLD_MAX_MS, however long the game', () => {
    const net = seated()
    const until = net.bus('p01').holdUntil
    net.at(until - 100)
    net.press('p02', { t: 'roll', faces })
    net.flush()
    expect(phase(net)).toBe('pick')
    net.at(until)
    net.press('p02', { t: 'roll', faces })
    net.flush()
    expect(phase(net)).toBe('choose')
  })
  it('lets go once the stop has given every star it has', () => {
    const net = seated()
    const b = net.bus('p01')
    const ctx = net.ctx('p01')
    expect(holdOn(b, ctx)).toBe(true)
    const stop = b.stops[0]
    const full = { ...b, stops: [{ ...stop, games: [[4, 0, 2]] as [number, number, number][] }] }
    expect(stop.cap).toBe(2) // three went: ceil(3 / 2)
    expect(holdOn(full, ctx)).toBe(true)
    const capped = {
      ...b,
      stops: [
        {
          ...stop,
          games: [
            [4, 0, 2],
            [9, 1, 2],
          ] as [number, number, number][],
        },
      ],
    }
    expect(holdOn(capped, ctx)).toBe(false)
  })
  it('anybody but the guide asking to roll anyway is refused, even once the roll is free', () => {
    const net = seated()
    net.at(net.bus('p01').holdUntil + net.k.IDLE_MS + 100)
    net.press('p01', { t: 'roll', faces, anyway: true })
    net.flush()
    expect(phase(net)).toBe('pick')
    net.press('p01', { t: 'roll', faces })
    net.flush()
    expect(phase(net)).toBe('choose')
  })
})

describe('the dice choose (3.5)', () => {
  it('face 1, and nobody has said yes — not even the guide', () => {
    const net = atTable()
    net.at(net.bus('p01').openAt)
    net.press('p02', { t: 'roll', faces: ['go', 'hex', 'paint'] })
    net.flush()
    net.run(net.k.CHOOSE_MS + 200)
    const b = net.bus('p03')
    expect(b.phase).toBe('ready')
    expect(b.toy).toBe('go')
    expect(b.ready).toEqual([])
    expect(net.agree()).toBe(true)
    /* and so, with nobody pressing, nobody goes: the turn passes and nobody moves */
    const landed = net.landings.length
    net.run(net.k.READY_MS + 5000)
    expect(net.bus('p01').stops.length).toBe(1)
    expect(net.landings.length).toBe(landed)
  })
})

describe('leaving early (3.6)', () => {
  /* p04 is on the Lab and has never pressed anything; p05 is a tab on an older build, the same */
  const withWatchers = () => {
    const net = atTable(['p04', 'p05'])
    net.at(net.bus('p01').openAt)
    net.press('p02', { t: 'roll', faces: ['go', 'hex', 'paint'] })
    net.flush()
    net.press('p02', { t: 'pick', toy: 'hex' })
    net.flush()
    return { net, readyAt: net.bus('p01').readyAt }
  }
  const leftAt = (net: Net) => {
    net.runUntil(() => net.bus('p01').stops.length === 2, 30_000)
    return net.now
  }
  it('once every rider here has answered and READY_MIN_MS has passed, and not before', () => {
    const { net, readyAt } = withWatchers()
    net.press('p03', { t: 'ready', on: true })
    net.press('p01', { t: 'ready', on: false })
    net.flush()
    expect(leftAt(net) - readyAt).toBe(net.k.READY_MIN_MS)
    expect(
      net
        .bus('p04')
        .went.map((i) => net.bus('p04').riders[i].id)
        .sort(),
    ).toEqual(['p02', 'p03'])
  })
  it('a rider who has not answered keeps it open for the whole window', () => {
    const { net, readyAt } = withWatchers()
    net.press('p03', { t: 'ready', on: true })
    net.flush()
    expect(leftAt(net) - readyAt).toBe(net.k.READY_MS)
  })
  it('Go now is the guide’s, and not before READY_MIN_MS', () => {
    const { net, readyAt } = withWatchers()
    net.press('p01', { t: 'go' })
    net.flush()
    net.at(readyAt + net.k.READY_MIN_MS - 100)
    net.press('p02', { t: 'go' })
    net.flush()
    expect(net.bus('p01').stops.length).toBe(1)
    net.at(readyAt + net.k.READY_MIN_MS)
    net.press('p01', { t: 'go' })
    net.flush()
    expect(net.bus('p01').stops.length).toBe(1)
    net.press('p02', { t: 'go' })
    net.flush()
    expect(net.bus('p01').stops.length).toBe(2)
  })
  it('everybody says no: no departure, and the turn passes on at once', () => {
    const { net, readyAt } = withWatchers()
    net.press('p02', { t: 'ready', on: false })
    net.press('p03', { t: 'ready', on: false })
    net.press('p01', { t: 'ready', on: false })
    net.flush()
    net.runUntil(() => phase(net) === 'pick', 30_000)
    const b = net.bus('p01')
    expect(net.now - readyAt).toBe(net.k.READY_MIN_MS)
    expect(b.stops.length).toBe(1)
    expect(b.guide).toBe(2) // p02 → p01, in boarding order
    expect(b.openAt).toBe(net.now)
  })
})

describe('the host leaves while the bus is boarding (3.7)', () => {
  it('the next host leaves when the first would have, not a whole window later', () => {
    const net = atTable()
    net.at(net.bus('p01').openAt)
    net.press('p02', { t: 'roll', faces: ['go', 'hex', 'paint'] })
    net.flush()
    net.press('p02', { t: 'pick', toy: 'hex' })
    net.flush()
    /* p01 (host) says yes; p03 never answers, so nothing closes early */
    net.press('p01', { t: 'ready', on: true })
    net.flush()
    const due = net.bus('p01').due
    net.run(7000)
    net.here.delete('p01')
    net.get('p01').listening = false
    net.runUntil(() => net.bus('p02').stops.length === 2, 30_000)
    expect(Math.abs(net.now - due)).toBeLessThanOrEqual(100)
    expect(net.host()).toBe('p02')
  })
})

describe('the cap on ready requests (3.12)', () => {
  it('the fourth press stays here, and the host refuses a fourth sent anyway', () => {
    const net = atTable()
    net.at(net.bus('p01').openAt)
    net.press('p02', { t: 'roll', faces: ['go', 'hex', 'paint'] })
    net.flush()
    net.press('p02', { t: 'pick', toy: 'hex' })
    net.flush()
    const sent = () => net.log.filter((e) => e.from === 'p03' && e.m.t === 'ready').length
    for (const on of [true, false, true, false]) {
      net.press('p03', { t: 'ready', on })
      net.flush()
    }
    expect(sent()).toBe(3)
    /* p03's own consent is the fourth press's: no */
    expect(net.get('p03').consent).toBeNull()
    const host = net.bus('p01')
    expect(host.ready).toContain(0)
    /* a fourth, straight onto the wire */
    net.wire.push({ from: 'p03', m: { v: 1, t: 'ready', tour: host.tour, n: 2, on: false } })
    net.flush()
    expect(net.bus('p01')).toBe(net.bus('p01'))
    expect(net.bus('p01').seq).toBe(host.seq)
    expect(net.bus('p01').ready).toContain(0)
    /* and when the bus goes, p03 — listed as going — stays where they are */
    net.runUntil(() => net.bus('p01').stops.length === 2, 30_000)
    net.run(10_000)
    expect(net.get('p03').sub).toBe('fourrow')
    expect(net.get('p02').sub).toBe('hex')
  })
})

describe('consent (3.13, 3.14)', () => {
  it('a hop never goes without a press for that departure and that toy, nor out of a seat or match it did not name', () => {
    const tour = 'abcd1234'
    const n = 3
    const toy = 'hex'
    const key = `${tour}:${n}`
    const consents: Consent[] = []
    const leavesAll: Leaves[] = [null, { seat: 'chess' }, { seat: 'go' }, { match: true }]
    for (const leaves of leavesAll)
      for (const c of [
        { tour, n, toy },
        { tour: 'zzzz9999', n, toy },
        { tour, n: n - 1, toy },
        { tour, n, toy: 'go' },
      ])
        consents.push({ ...c, leaves })
    consents.push(null)
    let went = 0
    let cases = 0
    const bools = [true, false]
    for (const consent of consents)
      for (const myToy of [toy, 'chess', 'go', null])
        for (const heldSeat of [null, 'chess', 'go'])
          for (const inMatch of bools)
            for (const openable of bools)
              for (const gateOpen of bools)
                for (const sharing of bools)
                  for (const visible of bools)
                    for (const onLab of bools)
                      for (const moved of [new Set<string>(), new Set([key])]) {
                        cases++
                        const r = rideStep({
                          consent,
                          tour,
                          n,
                          toy,
                          myToy,
                          openable,
                          gateOpen,
                          sharing,
                          visible,
                          onLab,
                          heldSeat,
                          inMatch,
                          moved,
                        })
                        /* the world's rule, said once from scratch: a press for exactly this
                           departure and toy, somewhere to go, able to go, and nothing left behind
                           that the press did not name */
                        const pressed =
                          !!consent &&
                          consent.tour === tour &&
                          consent.n === n &&
                          consent.toy === toy
                        const named = consent?.leaves ?? null
                        const leavesSeat =
                          heldSeat === null ||
                          heldSeat !== myToy ||
                          (named !== null && 'seat' in named && named.seat === myToy)
                        const leavesMatch = !inMatch || (named !== null && 'match' in named)
                        const may =
                          pressed &&
                          myToy !== toy &&
                          openable &&
                          gateOpen &&
                          sharing &&
                          visible &&
                          onLab &&
                          leavesSeat &&
                          leavesMatch &&
                          !moved.has(key)
                        expect(r.do === 'go').toBe(may)
                        if (r.do === 'go') {
                          went++
                          expect(r.toy).toBe(toy)
                        }
                      }
    expect(cases).toBe(17 * 4 * 3 * 2 ** 6 * 2)
    expect(went).toBeGreaterThan(0)
  })
  it('a forged departure naming me schedules nothing without my own press for it', () => {
    const net = atTable(['p04'])
    const b = net.bus('p01')
    const forged = stateOf(
      {
        ...b,
        seq: b.seq + 5,
        riders: [...b.riders, { id: 'p04', on: true, stars: 0, played: 0 }],
        stops: [...b.stops, { toy: 'hex', cap: 2, games: [], won: [] }],
        ready: [],
        went: [0, 1, 2, 3],
        leaveAt: net.now + 3000,
      },
      net.now,
    )
    net.wire.push({ from: 'p01', m: forged })
    net.flush()
    const d = net.get('p04')
    expect(d.bus.stops.length).toBe(2)
    expect(hopPlan(d.bus, net.now, null, 4, new Set())).toBeNull()
    /* nor with a press for a different toy */
    const elsewhere: Consent = { tour: b.tour, n: 2, toy: 'go', leaves: null }
    expect(hopPlan(d.bus, net.now, elsewhere, 4, new Set())).toBeNull()
    net.run(10_000)
    expect(d.sub).toBe(START)
    expect(net.landings.filter((l) => l.id === 'p04')).toEqual([])
  })
})

describe('the landing (3.15)', () => {
  it('twelve on a call onto a table: lowest id first, each hop far enough apart, a lost request and Come too after', () => {
    const ids = named(12)
    const net = party(ids)
    net.run(2000)
    const boarding = boardingOf(ids)
    const [starter, ...rest] = boarding
    const riders = rest.slice(0, 8)
    const [lost, late, quiet] = rest.slice(8)
    net.start(starter)
    net.flush()
    net.press(starter, { t: 'roll', faces: ['chess', 'fourrow', 'swarm'] })
    net.flush()
    net.press(starter, { t: 'pick', toy: 'fourrow' })
    net.flush()
    for (const id of riders) {
      net.press(id, { t: 'ready', on: true })
      net.flush()
    }
    /* `lost` presses, and the request never arrives */
    net.press(lost, { t: 'ready', on: true })
    net.wire.length = 0
    net.runUntil(() => net.bus(starter).stops.length === 1, 30_000)
    const leaveAt = net.bus(starter).leaveAt
    net.run(1500)
    /* `late` presses Come too while the bus is landing */
    net.press(late, { t: 'ready', on: true })
    net.flush()
    net.runUntil(() => net.landings.length === 11, 30_000)
    net.run(2000)
    const order = net.landings.map((l) => l.id)
    const went = [starter, ...riders].sort()
    expect(order).toEqual([...went, lost, late])
    expect(order).not.toContain(quiet)
    expect(net.landings[0].at).toBe(leaveAt)
    /* a hop onto a table is four sends (a where, a hello, two states: tour.ts measured it), each
       metered once per person on the call; Realtime's budget is about a hundred a second */
    const perHop = 4 * 12
    for (let i = 1; i < net.landings.length; i++)
      expect(net.landings[i].at - net.landings[i - 1].at).toBeGreaterThanOrEqual(
        (perHop / 100) * 1000,
      )
  })
})

describe('silence (3.17)', () => {
  it('a thousand ticks with nothing due send nothing, with a tour and without one', () => {
    const net = atTable()
    const t = net.now
    for (const c of net.clients())
      for (let i = 0; i < 1000; i++) {
        const s = tick(c.bus, { ...net.ctx(c.id), now: t + i })
        expect(s.out).toEqual([])
        c.bus = s.bus
      }
    let alone = listen('p09', 0)
    const ctx = { ...net.ctx('p01'), present: new Set(['p09']) }
    for (let i = 0; i < 1000; i++) {
      const s = tick(alone, { ...ctx, now: i * 10 })
      expect(s.out).toEqual([])
      alone = s.bus
    }
  })
})

describe('a tour nobody is on, and one nobody asks anything of (3.21)', () => {
  it('nobody on the bus here for ABANDON_MS: Start is offered again, and replaces it', () => {
    const net = atTable(['p04'])
    for (const id of ['p01', 'p02', 'p03']) net.here.delete(id)
    net.run(net.k.ABANDON_MS - 200)
    expect(canStart(net.bus('p04'), net.ctx('p04'))).toBe(false)
    net.run(300)
    expect(canStart(net.bus('p04'), net.ctx('p04'))).toBe(true)
    const old = net.bus('p04').tour
    net.start('p04')
    expect(net.bus('p04').tour).not.toBe(old)
    expect(net.bus('p04').riders.map((r) => r.id)).toEqual(['p04'])
  })
  it('ten minutes between stops with nothing asked: the host ends it, with one state', () => {
    const net = atTable()
    const from = net.now
    net.run(net.k.TOUR_IDLE_MS + 2000, 500)
    const sent = net.states().filter((e) => e.at > from)
    expect(sent.length).toBe(1)
    expect(sent[0].m.t === 'state' && sent[0].m.phase).toBe('end')
    expect(net.agree()).toBe(true)
  })
})

describe('the knobs', () => {
  it('a dev pace speeds every † timer and nothing else, and never slows the bus', () => {
    const k = knobs(0.25)
    expect(k.READY_MS).toBe(3750)
    expect(k.TOUR_IDLE_MS).toBe(150_000)
    expect(k.STATE_GAP_MS).toBe(KNOBS.STATE_GAP_MS)
    expect(k.SYNC_MS).toBe(KNOBS.SYNC_MS)
    expect(k.READY_SENDS).toBe(KNOBS.READY_SENDS)
    expect(knobs(4)).toEqual(KNOBS)
    expect(knobs(Number.NaN)).toEqual(KNOBS)
  })
})

describe('the dice (rollFaces)', () => {
  it('draws only from what may be rolled, never a stop or the toy on screen, a table first', () => {
    const bus = { stops: [{ toy: 'chess', cap: 1 as const, games: [], won: [] }] }
    const rollable = ['chess', 'fourrow', 'hex', 'swarm', 'paint']
    for (let seed = 1; seed < 60; seed++) {
      const f = rollFaces(rollable, bus, 'swarm', () => undefined, 'all', seeded(seed))!
      expect(new Set(f).size).toBe(3)
      for (const x of f) expect(['fourrow', 'hex', 'paint']).toContain(x)
      expect(ROOM_TOYS.has(f[0])).toBe(true)
    }
    expect(
      rollFaces(['chess', 'swarm', 'paint'], bus, 'swarm', () => undefined, 'all', seeded()),
    ).toBeNull()
    /* the kind brought forward, when it has three */
    const kind = (id: string) => (['hex', 'paint', 'tides'].includes(id) ? 'pretty' : 'other')
    const f = rollFaces([...rollable, 'tides'], bus, null, kind, 'pretty', seeded(3))!
    expect([...f].sort()).toEqual(['hex', 'paint', 'tides'])
    expect(f[0]).toBe('hex')
  })
})

/* sendsFor is the cost per hop the landing rule is built on; keep the import honest */
void sendsFor
