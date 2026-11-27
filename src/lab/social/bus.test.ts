import { describe, expect, it } from 'vitest'
import {
  KNOBS,
  MAX_BODY_BYTES,
  ask,
  askAgain,
  canStart,
  closeOf,
  closedFor,
  consentAfter,
  holdOn,
  holds,
  hopPlan,
  hostOf,
  knobs,
  leads,
  listen,
  meant,
  mergeKnown,
  nextGuide,
  outbox,
  readBus,
  receive,
  rideStep,
  rollFaces,
  startTour,
  tick,
  windowGone,
  wireOf,
  keepAside,
  keptFor,
  sitNow,
  type Answer,
  type Asked,
  type Bus,
  type Consent,
  type Ctx,
  type Knobs,
  type Leaves,
  type Msg,
  type Out,
  type Outbox,
  type Press,
  type Sat,
  type State,
  type Step,
} from './bus'
import { STALLED, phaseLine, type BusButton, type View } from './busWords'
import { ROOM_TOYS } from './tour'

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
  /** `asked`: when the hop was asked for — the departure's arrival, or Come too's press */
  hop: { at: number; key: string; toy: string; n: number; asked: number } | null
  late: string[]
  /** the toy this client holds a seat at, in a game still going (held.ts) */
  seat: string | null
  listening: boolean
  /** who this client sees on the Lab, when it is not everybody */
  view: Set<string> | null
  /** what it sends goes through this, when the party is paced */
  box: Outbox
}

/**
 * Several browsers on one call, and the wire between them — room.test.ts's `party`, with a clock,
 * who is on the Lab, each browser's own consent, and its hops. Every message crosses the wire as
 * JSON and is read back by readBus, so nothing shared by reference can pass for agreement, and a
 * message this code wrote that readBus refuses fails the test outright. `paced` sends everything
 * through each browser's own Outbox, as useBus will; otherwise a send goes the moment it is made.
 */
function party(
  ids: string[],
  opt: {
    k?: Knobs
    people?: number
    paced?: boolean
    /** each link's delay in ms, from → to; a message then arrives in order on its link */
    lat?: (from: string, to: string) => number
  } = {},
) {
  const k = opt.k ?? KNOBS
  let now = 0
  let tours = 0
  const cs = new Map<string, Client>()
  /** with `lat`: each delivery in flight, to one page — never to a page that has since reloaded */
  let flights: { at: number; n: number; to: string; gen: number; from: string; m: Msg }[] = []
  let flown = 0
  const linkAt = new Map<string, number>()
  const gens = new Map<string, number>()
  /** on the Lab and live */
  const here = new Set(ids)
  const roster = new Set(ids)
  const wire: { from: string; m: Msg }[] = []
  const log: { at: number; from: string; m: Msg }[] = []
  const landings: { at: number; id: string; toy: string }[] = []
  /** messages lost on the way, asked of each delivery */
  let drops: ((to: string, from: string, m: Msg) => boolean)[] = []
  const join = (id: string) => {
    gens.set(id, (gens.get(id) ?? 0) + 1)
    cs.set(id, {
      id,
      bus: listen(id, now),
      sub: START,
      consent: null,
      moved: new Set(),
      planned: new Set(),
      hop: null,
      late: [],
      seat: null,
      listening: true,
      view: null,
      box: outbox(k),
    })
  }
  for (const id of ids) join(id)
  const people = () => opt.people ?? roster.size
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
  /** onto the wire: a state is serialised now, as its sender sees who is here */
  const post = (from: string, o: Out) => {
    const m: Msg = o.t === 'state' ? wireOf(cs.get(from)!.bus, ctx(from).present, now) : o
    const copy = JSON.parse(JSON.stringify(m)) as Msg
    wire.push({ from, m: copy })
    log.push({ at: now, from, m: copy })
  }
  /** a departure seen for the first time: when do I hop, if at all */
  const plan = (c: Client) => {
    const b = c.bus
    const n = b.stops.length
    const key = `${b.tour}:${n}`
    /* a Come too still waiting takes the slot each state gives it */
    if (c.hop?.key === key && c.consent?.come) {
      const again = hopPlan(b, c.hop.asked, c.consent, people(), c.moved)
      if (again?.do === 'hop') c.hop = { ...c.hop, at: again.at }
    }
    if (!n || c.planned.has(key)) return
    c.planned.add(key)
    const p = hopPlan(b, now, c.consent, people(), c.moved)
    if (p?.do === 'hop') c.hop = { at: p.at, key, toy: b.stops[n - 1].toy, n, asked: now }
    if (p?.do === 'late') c.late.push(key)
  }
  const apply = (c: Client, s: Step) => {
    const prev = c.bus
    c.bus = s.bus
    /* a yes goes with its window, as useBus's apply lets it go */
    if (prev !== c.bus && windowGone(prev, c.bus, c.consent)) c.consent = null
    for (const o of s.out)
      if (opt.paced) c.box.push(o)
      else post(c.id, o)
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
    join(id: string) {
      roster.add(id)
      here.add(id)
      join(id)
    },
    clients: () => [...cs.values()],
    /** lose every message `pred` picks, until `lift()` */
    drop(pred: (to: string, from: string, m: Msg) => boolean) {
      drops = [...drops, pred]
      return () => (drops = drops.filter((d) => d !== pred))
    },
    /** what each Outbox lets go now; nothing leaves a browser that is not live */
    pump() {
      for (const c of cs.values())
        if (c.listening && ctx(c.id).meLive) for (const o of c.box.take(now)) post(c.id, o)
    },
    /** deliver everything queued, to everybody listening but its sender, until the wire is quiet */
    flush() {
      if (opt.lat) return late(opt.lat)
      for (let guard = 0; guard < 20_000; guard++) {
        net.pump()
        if (!wire.length) return
        const { from, m } = wire.shift()!
        const read = readBus(m)
        if (!read) throw new Error(`readBus refused ${JSON.stringify(m)}`)
        for (const c of cs.values())
          if (c.id !== from && c.listening && !drops.some((d) => d(c.id, from, read)))
            apply(c, receive(c.bus, ctx(c.id), from, read))
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
    /** the clock moves on in steps — and to each arrival, with `lat`; every browser ticks, the wire
        drains, hops land */
    run(ms: number, step = 100) {
      const end = now + ms
      while (now < end) {
        let next = Math.min(end, now + step)
        for (const f of flights) if (f.at > now && f.at < next) next = f.at
        now = next
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
      c.consent = consentAfter(c.consent, c.bus, ctx(id), p, leaves)
      apply(c, ask(c.bus, ctx(id), p))
      if (p.t === 'ready' && c.consent?.come) {
        const plan2 = hopPlan(c.bus, now, c.consent, people(), c.moved)
        if (plan2?.do === 'hop')
          c.hop = { at: plan2.at, key: plan2.key, toy: c.consent.toy, n: c.consent.n, asked: now }
      }
    },
    /** Take me there (or Come too) and Stay here, as drawn from the bus `id` holds this moment */
    ready(id: string, on: boolean, leaves: Leaves = null) {
      net.press(id, answerOn(cs.get(id)!.bus, on), leaves)
    },
    start(id: string) {
      const c = cs.get(id)!
      tours += 1
      apply(c, startTour(c.bus, ctx(id), `tour${String(tours).padStart(4, '0')}`))
    },
    /** whoever leads now, as they themselves reckon it */
    host: () => net.leaders()[0] ?? null,
    leaders: () =>
      [...cs.values()].filter((c) => c.listening && leads(c.bus, ctx(c.id))).map((c) => c.id),
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
  /** the wire with latency: what is sent is in flight to each page listening then, on its link */
  function late(lat: (from: string, to: string) => number) {
    for (let guard = 0; guard < 20_000; guard++) {
      net.pump()
      for (const { from, m } of wire.splice(0)) {
        const read = readBus(m)
        if (!read) throw new Error(`readBus refused ${JSON.stringify(m)}`)
        for (const c of cs.values()) {
          if (c.id === from || !c.listening) continue
          const link = `${from}>${c.id}`
          const at = Math.max(linkAt.get(link) ?? -Infinity, now + lat(from, c.id))
          linkAt.set(link, at)
          flights.push({ at, n: flown++, to: c.id, gen: gens.get(c.id)!, from, m: read })
        }
      }
      let f: (typeof flights)[number] | null = null
      for (const x of flights)
        if (x.at <= now && (!f || x.at < f.at || (x.at === f.at && x.n < f.n))) f = x
      if (!f) return
      flights = flights.filter((x) => x !== f)
      const c = cs.get(f.to)!
      if (c.listening && gens.get(c.id) === f.gen && !drops.some((d) => d(c.id, f.from, f.m)))
        apply(c, receive(c.bus, ctx(c.id), f.from, f.m))
    }
  }
  return net
}
type Net = ReturnType<typeof party>

/**
 * What an answer's button carries when it is drawn from `b` (busWords stamps the same two numbers
 * on it): the window's departure and toy while boarding, the stop just left's after it.
 */
function answerOn(b: Bus, on: boolean): Answer {
  const last = b.stops.length
  return b.phase === 'ready'
    ? { t: 'ready', on, n: last + 1, toy: b.toy! }
    : { t: 'ready', on, n: last, toy: b.stops[last - 1]?.toy ?? '' }
}

/** ids that sort p01 < p02 < …, boarding in an order that is not that one */
const named = (n: number) =>
  Array.from({ length: n }, (_, i) => `p${String(i + 1).padStart(2, '0')}`)
function boardingOf(ids: string[]) {
  /* the ids reversed and turned by one: neither id order nor its reverse, for any size */
  const back = [...ids].reverse()
  const order = [...back.slice(1), back[0]]
  if (new Set(order).size !== ids.length) throw new Error('not a boarding order')
  return order
}

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

/**
 * A tour started by `boarding[0]`, its only rider so far: everybody else holds it and has pressed
 * nothing, so they board (or not) at the first stop, in whatever order the test presses them.
 */
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
            net.ready(id, true)
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
              net.ready(id, true)
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
    net.ready(id, true)
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
  it('a guide away while the host changes still loses the turn GUIDE_GONE_MS after going', () => {
    const net = atTable()
    expect(net.bus('p01').guide).toBe(1) // p02
    const gone = net.now
    net.here.delete('p02')
    net.run(15_000)
    expect(net.bus('p03').guide).toBe(1)
    /* the host goes too: p03 leads now, and the clock it kept since p02 went goes on */
    net.here.delete('p01')
    net.get('p01').listening = false
    net.runUntil(() => net.bus('p03').guide !== 1, 60_000)
    expect(net.now - gone).toBeLessThanOrEqual(net.k.GUIDE_GONE_MS + 200)
    expect(net.bus('p03').riders[net.bus('p03').guide].id).toBe('p03')
  })
  it('the clock is about one guide: the turn passing to somebody else away here starts it again', () => {
    /* p04 holds a tour p01 hosts; riders boarded p02, p03, p04, p01 and p02 has the turn */
    const roster = new Set(['p01', 'p02', 'p03', 'p04'])
    const at = (now: number, here: string[]): Ctx => ({
      now,
      present: new Set(here),
      roster,
      meLive: true,
      subOf: () => null,
      people: 4,
      k: KNOBS,
    })
    const tourOf = (guide: number, seq: number): Bus => ({
      ...listen('p01', 0),
      seq,
      tour: TOUR,
      len: 5,
      riders: ['p02', 'p03', 'p04', 'p01'].map((id) => ({ id, on: true, stars: 0, played: 0 })),
      guide,
      phase: 'pick',
      stops: [{ toy: 'fourrow', cap: 2, games: [], won: [] }],
      openAt: 0,
      freeAt: KNOBS.IDLE_MS,
      holdUntil: KNOBS.HOLD_MAX_MS,
      due: KNOBS.TOUR_IDLE_MS,
    })
    const everyone = new Set(roster)
    const heard = (b: Bus, now: number, here: string[]) =>
      receive(listen('p04', 0), at(now, here), 'p01', wireOf(b, everyone, now)).bus
    /* p02 goes at 1 s; at 21 s the host passes the turn to p03, whom p04 does not see here */
    let x = heard(tourOf(0, 5), 0, ['p01', 'p02', 'p03', 'p04'])
    x = tick(x, at(1000, ['p01', 'p03', 'p04'])).bus
    const passed = wireOf(tourOf(1, 6), everyone, 21_000)
    x = receive(x, at(21_000, ['p01', 'p04']), 'p01', passed).bus
    x = tick(x, at(21_100, ['p01', 'p04'])).bus
    /* the host leaves, and p04 leads: p03 has been away from p04's view for a moment, not 20 s */
    x = tick(x, at(21_300, ['p04'])).bus
    expect(leads(x, at(21_300, ['p04']))).toBe(true)
    expect(x.guide).toBe(1)
    x = tick(x, at(21_100 + KNOBS.GUIDE_GONE_MS, ['p04'])).bus
    expect(x.guide).toBe(2)
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
  it('a game that ends during the roll or the ready check stops holding, and a skip keeps that', () => {
    const net = seated()
    expect(net.bus('p01').busy).toEqual([0])
    /* the guide rolls anyway and picks Hex; p03's game ends while the bus is boarding */
    net.press('p02', { t: 'roll', faces, anyway: true })
    net.flush()
    net.press('p02', { t: 'pick', toy: 'hex' })
    net.flush()
    net.get('p03').seat = null
    net.press('p03', { t: 'sit', on: false })
    net.flush()
    expect(net.bus('p01').busy).toEqual([])
    /* nobody goes: the window is skipped, the turn passes to p01, and nothing holds its roll */
    for (const id of ['p02', 'p01', 'p03']) net.ready(id, false)
    net.flush()
    net.runUntil(() => phase(net) === 'pick', 30_000)
    const b = net.bus('p01')
    expect([b.stops.length, b.busy, b.riders[b.guide].id]).toEqual([1, [], 'p01'])
    net.press('p01', { t: 'roll', faces: ['go', 'aurora', 'paint'] })
    net.flush()
    expect(phase(net)).toBe('choose')
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
    net.ready('p03', true)
    net.ready('p01', false)
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
    net.ready('p03', true)
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
    net.ready('p02', false)
    net.ready('p03', false)
    net.ready('p01', false)
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
    net.ready('p01', true)
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
      net.ready('p03', on)
      net.flush()
    }
    expect(sent()).toBe(3)
    /* p03's own consent is the fourth press's: no */
    expect(net.get('p03').consent).toBeNull()
    const host = net.bus('p01')
    expect(host.ready).toContain(0)
    /* a fourth, straight onto the wire */
    net.wire.push({
      from: 'p03',
      m: { v: 1, t: 'ready', tour: host.tour, n: 2, toy: 'hex', on: false },
    })
    net.flush()
    /* refused, so the host's bus is the very one it held: nothing about it was replaced */
    expect(net.bus('p01')).toBe(host)
    expect(net.bus('p01').seq).toBe(host.seq)
    expect(net.bus('p01').ready).toContain(0)
    /* and when the bus goes, p03 — listed as going — stays where they are */
    net.runUntil(() => net.bus('p01').stops.length === 2, 30_000)
    net.run(10_000)
    expect(net.get('p03').sub).toBe('fourrow')
    expect(net.get('p02').sub).toBe('hex')
  })
  it('a window that was skipped leaves the next its own three, though the departure is the same', () => {
    const net = atTable()
    net.at(net.bus('p01').openAt)
    net.press('p02', { t: 'roll', faces: ['go', 'hex', 'paint'] })
    net.flush()
    net.press('p02', { t: 'pick', toy: 'hex' })
    net.flush()
    const sent = () => net.log.filter((e) => e.from === 'p03' && e.m.t === 'ready').length
    for (const on of [false, true, false]) {
      net.ready('p03', on)
      net.flush()
    }
    for (const id of ['p02', 'p01']) net.ready(id, false)
    net.flush()
    net.runUntil(() => phase(net) === 'pick', 30_000)
    expect([net.bus('p01').stops.length, sent()]).toEqual([1, 3])
    /* the turn passed to p01, who rolls, picks Aurora and stays here; p03's first yes to it */
    net.press('p01', { t: 'roll', faces: ['go', 'aurora', 'paint'] })
    net.flush()
    net.press('p01', { t: 'pick', toy: 'aurora' })
    net.flush()
    net.ready('p01', false)
    net.flush()
    net.ready('p03', true)
    net.flush()
    expect(sent()).toBe(4)
    expect(net.bus('p01').ready).toEqual([0])
    net.runUntil(() => net.bus('p01').stops.length === 2, 30_000)
    net.run(10_000)
    expect(net.bus('p01').stops.map((x) => x.toy)).toEqual(['fourrow', 'aurora'])
    expect(net.get('p03').sub).toBe('aurora')
  })
})

describe('the cap on sits', () => {
  it('a third sit on the wire is refused by the host', () => {
    const net = atTable()
    const tour = net.bus('p01').tour
    for (const on of [true, false, true]) {
      net.wire.push({ from: 'p03', m: { v: 1, t: 'sit', tour, n: 1, on } })
      net.flush()
    }
    expect(net.bus('p01').busy).toEqual([])
  })
  it('a third press stays in this browser', () => {
    const net = atTable()
    const from = net.log.length
    for (const on of [true, false, true]) {
      net.press('p02', { t: 'sit', on })
      net.flush()
    }
    expect(net.log.slice(from).filter((e) => e.from === 'p02' && e.m.t === 'sit').length).toBe(2)
    expect(net.bus('p01').busy).toEqual([])
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
    const forged = wireOf(
      {
        ...b,
        seq: b.seq + 5,
        riders: [...b.riders, { id: 'p04', on: true, stars: 0, played: 0 }],
        stops: [...b.stops, { toy: 'hex', cap: 2, games: [], won: [] }],
        ready: [],
        went: [0, 1, 2, 3],
        leaveAt: net.now + 3000,
      },
      net.here,
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

describe('an answer means what its button said, or nothing', () => {
  /*
   * p04 is on the Lab and has never ridden. The bus is at Four in a row; p02 rolls and picks Hex,
   * and p04's line reads "Next stop: Hex … Take me there" — its button drawn for departure 2, Hex.
   * Every rider says no, so the window is skipped. p04's press is handled after that.
   */
  const skipped = () => {
    const net = atTable(['p04'])
    net.at(net.bus('p01').openAt + 100)
    net.press('p02', { t: 'roll', faces: ['go', 'hex', 'paint'] })
    net.flush()
    net.press('p02', { t: 'pick', toy: 'hex' })
    net.flush()
    const take = answerOn(net.bus('p04'), true)
    expect([take.n, take.toy]).toEqual([2, 'hex'])
    for (const id of ['p02', 'p01', 'p03']) net.ready(id, false)
    net.flush()
    net.runUntil(() => net.bus('p04').phase === 'pick', 30_000)
    expect(net.bus('p04').stops.map((x) => x.toy)).toEqual(['fourrow'])
    return { net, take }
  }
  const nothingFrom = (net: Net, id: string, from: number) =>
    expect(net.log.slice(from).filter((e) => e.from === id)).toEqual([])
  it('a Take me there for Hex handled after Hex was skipped is not Come too to the stop before', () => {
    const { net, take } = skipped()
    const from = net.log.length
    net.press('p04', take)
    net.flush()
    expect(net.get('p04').consent).toBeNull()
    expect(net.get('p04').hop).toBeNull()
    nothingFrom(net, 'p04', from)
    net.run(10_000)
    expect(net.get('p04').sub).toBe(START)
    expect(net.landings.filter((l) => l.id === 'p04')).toEqual([])
  })
  it('nor a yes to the next window, for another toy at the same departure', () => {
    const { net, take } = skipped()
    /* the turn passed to p01, who rolls and picks Aurora: departure 2 again, another toy */
    net.press('p01', { t: 'roll', faces: ['go', 'aurora', 'paint'] })
    net.flush()
    net.press('p01', { t: 'pick', toy: 'aurora' })
    net.flush()
    expect([net.bus('p04').phase, net.bus('p04').toy]).toEqual(['ready', 'aurora'])
    const from = net.log.length
    net.press('p04', take)
    net.flush()
    expect(net.get('p04').consent).toBeNull()
    nothingFrom(net, 'p04', from)
    expect(net.bus('p01').riders.map((r) => r.id)).not.toContain('p04')
  })
  it('a Come too long after the landing does nothing, here or on the wire', () => {
    const net = atTable(['p04'])
    net.run(60_000)
    const from = net.log.length
    net.ready('p04', true)
    net.flush()
    expect(net.get('p04').consent).toBeNull()
    expect(net.get('p04').hop).toBeNull()
    nothingFrom(net, 'p04', from)
  })
  it('an answer naming another departure or toy than the bus is on means nothing', () => {
    /* the bus has just left for Hex, its second stop, and its riders are landing */
    const net = atTable(['p04'])
    net.at(net.bus('p01').openAt + 100)
    net.press('p02', { t: 'roll', faces: ['go', 'hex', 'paint'] })
    net.flush()
    net.press('p02', { t: 'pick', toy: 'hex' })
    net.flush()
    net.ready('p03', true)
    net.flush()
    net.runUntil(() => net.bus('p04').stops.length === 2, 30_000)
    const b = net.bus('p04')
    const ctx = net.ctx('p04')
    const come = (n: number, toy: string): Answer => ({ t: 'ready', on: true, n, toy })
    expect(meant(b, ctx, come(2, 'hex'))).toBe('come')
    for (const [n, toy] of [
      [1, 'fourrow'],
      [1, 'hex'],
      [3, 'hex'],
      [2, 'fourrow'],
    ] as const) {
      expect([n, toy, meant(b, ctx, come(n, toy))]).toEqual([n, toy, null])
      expect(consentAfter(null, b, ctx, come(n, toy))).toBeNull()
    }
    /* and in a window: only its own departure and toy */
    const w: Bus = { ...b, phase: 'ready', toy: 'aurora', stops: b.stops, readyAt: net.now }
    expect(meant(w, ctx, come(3, 'aurora'))).toBe('window')
    expect(meant(w, ctx, come(2, 'aurora'))).toBeNull()
    expect(meant(w, ctx, come(3, 'paint'))).toBeNull()
  })
  it('a consent saying Come too, for a press after the landing, is Catch up and never a hop', () => {
    const net = atTable(['p04'])
    const b = net.bus('p04')
    const consent: Consent = { tour: b.tour, n: 1, toy: 'fourrow', leaves: null, come: true }
    /* pressed as the first rider landed: the hop is after the last */
    expect(hopPlan(b, net.landings[0].at, consent, 4, new Set())?.do).toBe('hop')
    expect(hopPlan(b, net.now + 10_000, consent, 4, new Set())).toEqual({
      do: 'late',
      key: `${b.tour}:1`,
    })
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
      net.ready(id, true)
      net.flush()
    }
    /* `lost` presses, and the request never arrives */
    net.ready(lost, true)
    net.wire.length = 0
    net.runUntil(() => net.bus(starter).stops.length === 1, 30_000)
    const leaveAt = net.bus(starter).leaveAt
    net.run(1500)
    /* `late` presses Come too while the bus is landing */
    net.ready(late, true)
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

describe('a count that has run out stays run out', () => {
  it('a state after the landing leaves it landed: no Come too here, and none from a new host', () => {
    const net = atTable(['p04'])
    const leaveAt = net.bus('p04').leaveAt
    net.run(12_000)
    /* p03 sits down: a state saying `leave: 0`, which is not "the count ends now" */
    net.get('p03').seat = 'fourrow'
    net.press('p03', { t: 'sit', on: true })
    net.flush()
    for (const id of ['p02', 'p03', 'p04']) expect([id, net.bus(id).leaveAt]).toEqual([id, leaveAt])
    net.ready('p04', true)
    net.flush()
    expect(net.get('p04').consent).toBeNull()
    /* the host goes; the next one refuses a Come too sent anyway, as the first one would have */
    net.here.delete('p01')
    net.get('p01').listening = false
    net.run(200)
    expect(net.host()).toBe('p02')
    const tour = net.bus('p02').tour
    net.wire.push({ from: 'p04', m: { v: 1, t: 'ready', tour, n: 1, toy: 'fourrow', on: true } })
    net.flush()
    expect(net.bus('p02').riders.map((r) => r.id)).toEqual(['p03', 'p02', 'p01'])
  })
  it('a departure first heard after its count reads as landed', () => {
    const net = atTable()
    net.run(12_000)
    net.join('p05')
    net.run(200)
    expect(net.bus('p05').stops.map((x) => x.toy)).toEqual(['fourrow'])
    net.ready('p05', true)
    net.flush()
    expect(net.get('p05').consent).toBeNull()
    net.run(5000)
    expect(net.get('p05').sub).toBe(START)
  })
})

describe('silence (3.17), and the one heartbeat', () => {
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
  it('a live tour nobody moves: one state every BEAT_MS, from its decider alone, the same bus one count on', () => {
    const net = atTable()
    const host = net.host()!
    const before = net.bus(host)
    const from = net.now
    const last = net.states().at(-1)!.at
    net.run(60_000, 100)
    const sent = net.states().filter((e) => e.at > from)
    expect(new Set(sent.map((e) => e.from))).toEqual(new Set([host]))
    /* each BEAT_MS after the one before it, to within a tick: no more, and no less */
    const gaps = [sent[0].at - last, ...sent.slice(1).map((e, i) => e.at - sent[i].at)]
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(KNOBS.BEAT_MS)
    for (const g of gaps) expect(g).toBeLessThanOrEqual(KNOBS.BEAT_MS + 100)
    expect(sent.length).toBe(Math.floor((net.now - last) / KNOBS.BEAT_MS))
    /* and nothing about the tour changed but its count: everybody holds the same bus */
    const b = net.bus('p01')
    expect([b.tour, b.phase, b.stops, b.riders, b.guide]).toEqual([
      before.tour,
      before.phase,
      before.stops,
      before.riders,
      before.guide,
    ])
    expect(b.seq).toBe(before.seq + sent.length)
    expect(net.agree()).toBe(true)
  })
  it('a tour that is over beats nothing: an hour of ticks after the end sends nothing', () => {
    const net = atTable()
    net.run(net.k.TOUR_IDLE_MS + 2000, 1000)
    expect(net.bus('p01').phase).toBe('end')
    const from = net.log.length
    net.run(3_600_000, 1000)
    expect(net.log.slice(from)).toEqual([])
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
  it('ten minutes between stops with nothing asked: the host ends it, saying nothing else but its beat', () => {
    const net = atTable()
    const from = net.now
    net.run(net.k.TOUR_IDLE_MS + 2000, 500)
    const sent = net.states().filter((e) => e.at > from)
    const host = net.host() ?? sent[0].from
    expect(new Set(sent.map((e) => e.from))).toEqual(new Set([host]))
    const last = sent.at(-1)!.m
    expect(last.t === 'state' && last.phase).toBe('end')
    /* every state before the end was the beat: the same phase, at most one each BEAT_MS */
    expect(sent.slice(0, -1).every((e) => e.m.t === 'state' && e.m.phase === 'pick')).toBe(true)
    expect(sent.length - 1).toBeLessThanOrEqual(Math.ceil(net.k.TOUR_IDLE_MS / net.k.BEAT_MS))
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
  it('at any dev pace a window outlasts the wait for its state, so nobody misses the bus', () => {
    for (const pace of [1, 0.5, 0.25, 0.1, 0.01]) {
      const k = knobs(pace)
      for (const w of [k.CHOOSE_MS, k.READY_MS, k.READY_MIN_MS, k.COUNT_MS])
        expect(w).toBeGreaterThanOrEqual(2 * k.STATE_GAP_MS)
      /* the window reaches the others up to a second after it opened, behind the roll's state:
         they still have time to board before it may close without them */
      const ids = ['p01', 'p03', 'p02']
      const net = party(ids, { k, paced: true })
      net.run(2000)
      net.start('p02')
      net.run(1500)
      const { toy } = rollAndPick(net, seeded(3))
      net.runUntil(() => ['p01', 'p03'].every((id) => net.bus(id).phase === 'ready'), 5000, 20)
      net.ready('p01', true)
      net.ready('p03', true)
      net.runUntil(() => net.landings.length === 3, 20_000, 20)
      expect([pace, net.landings.map((l) => l.id).sort()]).toEqual([pace, [...ids].sort()])
      expect(new Set(net.landings.map((l) => l.toy))).toEqual(new Set([toy]))
    }
  })
  it("at the dev call's pace, the last yes closing the window still lands everybody", () => {
    /* found on the dev call at pace 0.25: the last rider's yes is published at once, the bus
       leaves in the same moment, and its departure waits out the host's one state a second — a
       750 ms count had run out by then, and every rider but the host got Catch up, not a hop */
    const k = knobs(0.25)
    const ids = ['p01', 'p03', 'p02']
    const net = party(ids, { k, paced: true })
    net.run(2000)
    net.start('p02')
    net.run(1500)
    rollAndPick(net, seeded(3))
    net.runUntil(() => ['p01', 'p03'].every((id) => net.bus(id).phase === 'ready'), 5000, 20)
    for (const id of ['p01', 'p03']) net.ready(id, true)
    net.runUntil(() => net.landings.length === 3, 20_000, 20)
    /* the second stop: both riders now, so the bus waits for them, and they answer late */
    const { toy } = rollAndPick(net, seeded(4))
    const readyAt = net.bus(net.host()!).readyAt
    net.runUntil(() => net.now >= readyAt + k.READY_MIN_MS + 100, 9000, 20)
    const riders = ids.filter((id) => net.bus(id).phase === 'ready' && !yesFrom(net, id))
    for (const id of riders) net.ready(id, true)
    net.runUntil(() => net.landings.length === 6, 20_000, 20)
    expect(net.clients().flatMap((c) => c.late)).toEqual([])
    expect(
      net.landings
        .slice(3)
        .map((l) => [l.id, l.toy])
        .sort(),
    ).toEqual(ids.map((id) => [id, toy]).sort())
  })
})

/** whether this browser has said yes to the window it holds */
const yesFrom = (net: Net, id: string) => {
  const c = net.get(id).consent
  const b = net.bus(id)
  return !!c && c.n === b.stops.length + 1 && c.toy === b.toy
}

describe('a yes stands until a host has heard it (askAgain)', () => {
  it('the host leaves with a yes it never published: the new host decides its own yes', () => {
    /* measured on the dev call: the guide hosting the window closed its tab a moment after Ann's
       yes reached it; Ann, host now, held a bus that had never heard her, and skipped the window */
    const ids = ['p01', 'p02']
    const net = party(ids, { paced: true })
    const asked = new Map<string, Asked>()
    /* what useBus does on every tick: ask again, once of each new host */
    const again = () => {
      for (const id of ids) {
        const c = net.get(id)
        if (!c.listening) continue
        const a = askAgain(c.bus, net.ctx(id), c.consent, asked.get(id) ?? null)
        if (!a || !c.consent) continue
        asked.set(id, a)
        net.press(id, { t: 'ready', on: true, n: c.consent.n, toy: c.consent.toy })
      }
    }
    net.run(2000)
    net.start('p01')
    net.run(1500)
    /* stops 1 and 2: p02 boards, then rolls; stop 3 is p01's turn again */
    for (let s = 0; s < 2; s++) {
      const { guide } = rollAndPick(net, seeded(s + 1))
      const other = guide === 'p01' ? 'p02' : 'p01'
      net.runUntil(() => net.bus(other).phase === 'ready', 5000, 20)
      net.ready(other, true)
      net.runUntil(() => net.bus('p01').stops.length === s + 1, 20_000, 20)
      net.run(4000)
    }
    const { guide, toy } = rollAndPick(net, seeded(9))
    expect(guide).toBe('p01')
    net.runUntil(() => net.bus('p02').phase === 'ready', 5000, 20)
    net.ready('p02', true)
    net.flush()
    /* p01 heard the yes, and closes its tab before its next state could say so */
    expect(net.bus('p01').ready.length).toBe(2)
    expect(net.bus('p02').ready.map((i) => net.bus('p02').riders[i].id)).toEqual(['p01'])
    net.here.delete('p01')
    net.roster.delete('p01')
    net.get('p01').listening = false
    for (let t = 0; t < 400 && net.bus('p02').stops.length < 3; t++) {
      net.run(50, 50)
      again()
    }
    expect(net.bus('p02').stops.map((x) => x.toy)[2]).toBe(toy)
    net.run(3000)
    expect(net.get('p02').sub).toBe(toy)
    /* once each new host: asked of p02 itself, and not again while it holds the yes */
    expect(asked.get('p02')?.host).toBe('p02')
  })
  it('asks nothing while the host it asked has yet to answer, nor for a window gone by', () => {
    const net = boarded(3).net
    const { guide } = rollAndPick(net, seeded(2))
    const id = net.clients().find((c) => c.id !== guide && c.bus.phase === 'ready')!.id
    net.ready(id, true)
    const c = net.get(id)
    const first = askAgain(c.bus, net.ctx(id), c.consent, null)
    /* before the host's state lists the yes, the host it was asked of is the host now */
    expect(first?.host).toBe(net.host())
    expect(askAgain(c.bus, net.ctx(id), c.consent, first)).toBe(null)
    expect(askAgain(c.bus, net.ctx(id), null, null)).toBe(null)
    net.flush()
    expect(askAgain(net.bus(id), net.ctx(id), net.get(id).consent, null)).toBe(null)
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

/* ── step 4: newcomers, hosts coming back, two tours, the wire and its rate ─────────────────── */

/**
 * p01 — the host, the lowest id — goes away and hears nothing while the others carry on: the
 * guide rolls, picks Hex, and the bus leaves. `during` says where p01's own bus is left: in
 * `choose`, with its dice deadline long past (so leading from it would publish at once), or in
 * `pick` with nothing due (so leading from it is silent).
 */
function hostAway(during: 'choose' | 'pick') {
  const net = atTable()
  net.runUntil(() => net.now >= net.bus('p01').openAt)
  if (during === 'choose') {
    net.press('p02', { t: 'roll', faces: ['go', 'hex', 'paint'] })
    net.flush()
  }
  /* a hidden tab keeps listening (party.ts); what it misses is what is lost on the way */
  net.here.delete('p01')
  const deaf = net.drop((to) => to === 'p01')
  if (during === 'pick') {
    net.press('p02', { t: 'roll', faces: ['go', 'hex', 'paint'] })
    net.flush()
  }
  net.press('p02', { t: 'pick', toy: 'hex' })
  net.flush()
  net.ready('p03', true)
  net.flush()
  net.runUntil(() => net.bus('p02').stops.length === 2, 30_000)
  net.run(net.k.CHOOSE_MS + 5000)
  const held = net.bus('p02').seq
  expect(net.bus('p01').seq).toBeLessThan(held)
  /* every state p01 sends from here on, and whether any of it is the old bus */
  const from = net.log.length
  const stale = () =>
    net.log.slice(from).filter((e) => e.from === 'p01' && e.m.t === 'state' && e.m.seq <= held)
      .length
  return { net, held, stale, from, back: deaf }
}
const hellos = (net: Net, id: string, from = 0) =>
  net.log.slice(from).filter((e) => e.from === id && e.m.t === 'hello').length

describe('a host coming back (3.8)', () => {
  it('hello first: it asks, is handed the bus, and only then leads', () => {
    const { net, stale, back } = hostAway('choose')
    /* p01's `where` has not reached the others yet */
    for (const id of ['p02', 'p03']) net.get(id).view = new Set(['p02', 'p03'])
    back()
    net.here.add('p01')
    net.run(100)
    expect(net.bus('p01').seq).toBe(net.bus('p02').seq)
    for (const id of ['p02', 'p03']) net.get(id).view = null
    net.run(3000)
    expect(stale()).toBe(0)
    expect(net.agree()).toBe(true)
    expect(net.leaders()).toContain('p01')
  })
  it('where first: the others already count it host, and the one who was answers', () => {
    const { net, stale, back } = hostAway('choose')
    /* everybody else sees p01 on the Lab before p01's own tab has noticed it is back */
    net.get('p01').view = new Set(['p02', 'p03'])
    net.here.add('p01')
    back()
    net.run(300)
    /* nobody is left leaderless: p02 published the bus we hold, and goes on deciding */
    expect(net.leaders()).toEqual(['p02'])
    net.get('p01').view = null
    net.run(100)
    expect(net.bus('p01').seq).toBe(net.bus('p02').seq)
    net.run(3000)
    expect(stale()).toBe(0)
    expect(net.agree()).toBe(true)
    expect(net.leaders()).toContain('p01')
    /* and the first change p01 publishes hands it the bus outright */
    net.press('p03', { t: 'sit', on: true })
    net.flush()
    expect(net.leaders()).toEqual(['p01'])
    expect(net.agree()).toBe(true)
  })
  it('the answer lost: it asks once more, and is handed the bus then', () => {
    const { net, stale, from, back } = hostAway('pick')
    back()
    /* every state lost on its way to p01 until just before its retry: the answer, and the beat of
       the one deciding while it was away, which would otherwise have handed it the bus first */
    const lift = net.drop((to, _from, m) => to === 'p01' && m.t === 'state')
    net.here.add('p01')
    const held = net.bus('p02').seq
    net.run(net.k.HELLO_RETRY_MS - 100)
    lift()
    expect(net.bus('p01').seq).toBeLessThan(net.bus('p02').seq)
    net.run(net.k.HELLO_RETRY_MS)
    expect(hellos(net, 'p01', from)).toBe(2)
    /* ⚠️ ITS OLD BUS WAS SAID ONCE, AND MOVED NOBODY: past SYNC_MS with nothing heard it leads what
       it has, and its beat goes at once — at a count everybody else is past, so refused, and the
       deputy's answer to it is what would have handed it the bus had that not been lost too */
    expect(stale()).toBeLessThanOrEqual(1)
    expect(
      net.states().filter((e) => e.from === 'p01' && e.m.t === 'state' && e.m.seq > held),
    ).toEqual([])
    expect(net.agree()).toBe(true)
    net.run(10_000)
    expect(hellos(net, 'p01', from)).toBe(2)
  })
  it('leading from a stale bus anyway: the deputy hands it the real one', () => {
    const { net, back } = hostAway('pick')
    back()
    const lift = net.drop((to, _from, m) => to === 'p01' && m.t === 'state')
    net.here.add('p01')
    net.run(net.k.HELLO_RETRY_MS + 500)
    lift()
    expect(net.bus('p01').heard).toBe(true)
    expect(net.bus('p01').stops.length).toBe(1)
    /* a request p01's old bus can take: p03 sits at the first stop's table */
    const tour = net.bus('p01').tour
    net.wire.push({ from: 'p03', m: { v: 1, t: 'sit', tour, n: 1, on: true } })
    net.flush()
    /* ⚠️ ITS BEAT WENT FIRST: leading from what it last had, p01 said that bus at once (tick), and
       the deputy's answer to it was lost with the rest — so the sit's stale state waits out
       HELLO_REPAIR_MS for its answer, and the next stale beat gets it */
    net.run(net.k.HELLO_REPAIR_MS + net.k.BEAT_MS)
    expect(net.agree()).toBe(true)
    expect(net.bus('p01').stops.length).toBe(2)
  })
})

describe('two tours at once (3.9)', () => {
  const fresh = () => {
    const net = party(['p01', 'p02', 'p03', 'p04'])
    net.run(2000)
    return net
  }
  it('two Starts in the same moment, in either order: everybody ends on the lower starter’s', () => {
    for (const order of [
      ['p02', 'p04'],
      ['p04', 'p02'],
    ]) {
      const net = fresh()
      for (const id of order) net.start(id)
      net.flush()
      expect(net.agree()).toBe(true)
      expect(net.bus('p03').riders.map((r) => r.id)).toEqual(['p02'])
    }
  })
  /* ⚠️ each tour that gives way here would win on riders, stops and starter alike (beats), so
     only being ended — or abandoned — can be what makes it give way */
  it('an ended tour gives way to a new one, though it ended with more riders on it', () => {
    const net = atTable(['p04'])
    net.runUntil(() => net.bus('p01').phase === 'end', 700_000, 1000)
    for (const id of ['p01', 'p02', 'p03', 'p04']) expect(net.bus(id).phase).toBe('end')
    expect(net.bus('p01').riders.filter((r) => r.on).length).toBe(3)
    net.start('p04')
    net.flush()
    expect(net.agree()).toBe(true)
    expect(net.bus('p01').riders.map((r) => r.id)).toEqual(['p04'])
  })
  it('a tour nobody on it has been here for gives way, though a lower id started it', () => {
    const net = fresh()
    net.start('p02')
    net.flush()
    expect(net.bus('p01').riders.map((r) => r.id)).toEqual(['p02'])
    net.here.delete('p02')
    net.run(net.k.ABANDON_MS + 200)
    net.start('p04')
    net.flush()
    expect(net.agree(['p01', 'p03', 'p04'])).toBe(true)
    expect(net.bus('p01').riders.map((r) => r.id)).toEqual(['p04'])
  })
  it('a fresh tour never replaces a live one with as many riders, whatever its id', () => {
    const net = atTable(['p00'])
    /* everybody but p01 hops off: one rider, one stop made */
    for (const id of ['p02', 'p03']) {
      net.press(id, { t: 'off' })
      net.flush()
    }
    const live = net.bus('p01')
    expect(live.riders.filter((r) => r.on).length).toBe(1)
    /* a tour started by a lower id, with a lower tour id: one rider, no stops */
    const other: Bus = {
      ...listen('p00', net.now),
      seq: 1,
      tour: 'aaaa0000',
      len: 5,
      riders: [{ id: 'p00', on: true, stars: 0, played: 0 }],
      phase: 'pick',
      openAt: net.now,
      due: net.now + net.k.TOUR_IDLE_MS,
    }
    net.wire.push({ from: 'p00', m: wireOf(other, net.here, net.now) })
    net.flush()
    for (const id of ['p01', 'p02', 'p03']) expect(net.bus(id).tour).toBe(live.tour)
    /* nor does an ended one, with more riders */
    const ended = {
      ...other,
      riders: ['p00', 'p05', 'p06'].map((id) => ({ id, on: true, stars: 0, played: 0 })),
      phase: 'end' as const,
    }
    net.roster.add('p05')
    net.wire.push({ from: 'p00', m: wireOf(ended, net.here, net.now) })
    net.flush()
    for (const id of ['p01', 'p02', 'p03']) expect(net.bus(id).tour).toBe(live.tour)
  })
})

/* a body of every kind, each valid, so every row below differs from a valid one in one field */
const TOUR = 'k3x9q2m7'
const VALID: Record<string, Record<string, unknown>> = {
  hello: { v: 1, t: 'hello' },
  roll: { v: 1, t: 'roll', tour: TOUR, n: 2, faces: ['go', 'hex', 'paint'], anyway: true },
  pick: { v: 1, t: 'pick', tour: TOUR, n: 2, toy: 'hex' },
  ready: { v: 1, t: 'ready', tour: TOUR, n: 2, toy: 'hex', on: false },
  go: { v: 1, t: 'go', tour: TOUR, n: 2 },
  off: { v: 1, t: 'off', tour: TOUR },
  fin: { v: 1, t: 'fin', tour: TOUR, anyway: true },
  sit: { v: 1, t: 'sit', tour: TOUR, n: 1, on: true },
  game: {
    v: 1,
    t: 'game',
    tour: TOUR,
    n: 1,
    sub: 'fourrow',
    g: 41,
    seats: ['p02', 'p01'],
    how: 'win',
    won: ['p01'],
  },
  state: {
    v: 1,
    t: 'state',
    seq: 41,
    tour: TOUR,
    len: 7,
    riders: [
      ['p03', 1, 2, 3],
      ['p01', 0, null, 1],
      ['p02', 1, 0, null],
    ],
    guide: 2,
    phase: 'choose',
    faces: ['go', 'hex', 'paint'],
    toy: null,
    ready: [2],
    no: [0],
    went: [0, 2],
    busy: [2],
    stops: [
      { toy: 'fourrow', cap: 2, games: [[17, 0, 2]], won: [0] },
      { toy: 'swarm', cap: 1, games: [], won: [] },
    ],
    left: 12_000,
    open: 1,
    free: 45_000,
    hold: 300_000,
    leave: 0,
  },
}
const st = VALID.state
const rider = (i: number, r: unknown[]) =>
  (st.riders as unknown[][]).map((x, j) => (j === i ? r : x))
const stopWith = (s: Record<string, unknown>) => [
  { ...(st.stops as Record<string, unknown>[])[0], ...s },
  (st.stops as unknown[])[1],
]
/** [what is wrong, the body] */
const MALFORMED: [string, unknown][] = [
  ['not an object', 'state'],
  ['an array', [1]],
  ['version 2', { ...VALID.hello, v: 2 }],
  ['an unknown kind', { v: 1, t: 'dance' }],
  ['too big', { ...VALID.off, pad: 'x'.repeat(MAX_BODY_BYTES) }],
  ['tour in capitals', { ...VALID.off, tour: 'K3X9Q2M7' }],
  ['tour too short', { ...VALID.go, tour: 'k3x9' }],
  ['tour missing', { v: 1, t: 'off' }],
  ['n nought', { ...VALID.go, n: 0 }],
  ['n nine', { ...VALID.pick, n: 9 }],
  ['n a fraction', { ...VALID.ready, n: 1.5 }],
  ['n missing', { v: 1, t: 'go', tour: TOUR }],
  ['two faces', { ...VALID.roll, faces: ['go', 'hex'] }],
  ['a face twice', { ...VALID.roll, faces: ['go', 'go', 'hex'] }],
  ['a face not a toy id', { ...VALID.roll, faces: ['go', 'Hex!', 'paint'] }],
  ['anyway not true', { ...VALID.roll, anyway: 'yes' }],
  ['fin anyway a number', { ...VALID.fin, anyway: 1 }],
  ['pick toy not a toy id', { ...VALID.pick, toy: '../x' }],
  ['ready on a string', { ...VALID.ready, on: 'true' }],
  ['ready toy not a toy id', { ...VALID.ready, toy: 'Hex!' }],
  ['ready toy missing', { v: 1, t: 'ready', tour: TOUR, n: 2, on: false }],
  ['sit on missing', { v: 1, t: 'sit', tour: TOUR, n: 1 }],
  ['game sub not a toy id', { ...VALID.game, sub: 'Four in a row' }],
  ['game g nought', { ...VALID.game, g: 0 }],
  ['game g too big', { ...VALID.game, g: 1_000_001 }],
  ['game seats one', { ...VALID.game, seats: ['p02'] }],
  ['game how unknown', { ...VALID.game, how: 'lose' }],
  ['game how unknown, naming nobody', { ...VALID.game, how: 'lose', won: [] }],
  ['game won not seated', { ...VALID.game, won: ['p09'] }],
  ['game won nobody', { ...VALID.game, won: [] }],
  ['game won three', { ...VALID.game, seats: ['p01', 'p02'], won: ['p01', 'p02', 'p03'] }],
  ['game won twice', { ...VALID.game, won: ['p01', 'p01'] }],
  ['game draw naming somebody', { ...VALID.game, how: 'draw' }],
  /* readSeats allows an empty seat, so this is the one a string check on `won` alone refuses */
  ['game won an empty seat', { ...VALID.game, seats: ['p01', null], won: [null] }],
  ['state seq nought', { ...st, seq: 0 }],
  ['state seq a fraction', { ...st, seq: 1.5 }],
  ['state seq too big', { ...st, seq: 1e9 + 1 }],
  ['state tour bad', { ...st, tour: 'nope' }],
  ['state len nought', { ...st, len: 0 }],
  ['state len nine', { ...st, len: 9 }],
  ['state no riders', { ...st, riders: [], guide: 0 }],
  [
    'state seventeen riders',
    { ...st, riders: Array.from({ length: 17 }, (_, i) => [`r${i}`, 1, 0, 0]) },
  ],
  ['a rider id empty', { ...st, riders: rider(0, ['', 1, 2, 3]) }],
  ['a rider id a number', { ...st, riders: rider(0, [7, 1, 2, 3]) }],
  ['a rider id too long', { ...st, riders: rider(0, ['x'.repeat(65), 1, 2, 3]) }],
  ['a rider twice', { ...st, riders: rider(1, ['p03', 0, null, 1]) }],
  ['a rider on 2', { ...st, riders: rider(0, ['p03', 2, 2, 3]) }],
  ['a rider of three fields', { ...st, riders: rider(0, ['p03', 1, 2]) }],
  ['a rider of five fields', { ...st, riders: rider(0, ['p03', 1, 2, 3, 'more']) }],
  ['stars below nought', { ...st, riders: rider(2, ['p02', 1, -1, null]) }],
  ['stars past three a stop', { ...st, riders: rider(0, ['p03', 1, 22, 3]) }],
  ['played a fraction', { ...st, riders: rider(0, ['p03', 1, 2, 1.5]) }],
  ['guide past the riders', { ...st, guide: 3 }],
  ['guide below nought', { ...st, guide: -1 }],
  ['phase unknown', { ...st, phase: 'drive' }],
  ['phase unknown, with nothing else wrong', { ...st, phase: 'drive', faces: null }],
  ['faces outside choose', { ...st, phase: 'pick' }],
  ['no faces in choose', { ...st, faces: null }],
  ['a face already a stop', { ...st, faces: ['go', 'hex', 'swarm'] }],
  ['state choose with two faces', { ...st, faces: ['go', 'hex'] }],
  ['state a face not a toy id', { ...st, faces: ['go', 'Hex!', 'paint'] }],
  ['a toy outside ready', { ...st, toy: 'hex' }],
  ['no toy in ready', { ...st, phase: 'ready', faces: null }],
  ['a toy already a stop', { ...st, phase: 'ready', faces: null, toy: 'swarm' }],
  ['a ready toy not a toy id', { ...st, phase: 'ready', faces: null, toy: 'Four in a row' }],
  ['ready twice', { ...st, ready: [2, 2] }],
  ['ready past the riders', { ...st, ready: [3] }],
  ['ready and no at once', { ...st, no: [0, 2] }],
  ['no past the riders', { ...st, no: [9] }],
  ['went a fraction', { ...st, went: [0.5] }],
  ['busy not a list', { ...st, busy: 2 }],
  ['busy past the riders', { ...st, busy: [3] }],
  ['more stops than len', { ...st, len: 1 }],
  ['a stop twice', { ...st, stops: stopWith({ toy: 'swarm' }) }],
  ['a stop toy not a toy id', { ...st, stops: stopWith({ toy: '../x' }) }],
  ['a stop cap nought', { ...st, stops: stopWith({ cap: 0 }) }],
  ['a stop cap four', { ...st, stops: stopWith({ cap: 4 }) }],
  [
    'more games than cap',
    {
      ...st,
      stops: stopWith({
        cap: 1,
        games: [
          [1, 0, 2],
          [2, 0, 2],
        ],
      }),
    },
  ],
  ['a game g nought', { ...st, stops: stopWith({ games: [[0, 0, 2]] }) }],
  ['a game of four fields', { ...st, stops: stopWith({ games: [[17, 0, 2, 9]] }) }],
  ['a game seat past the riders', { ...st, stops: stopWith({ games: [[17, 0, 3]] }) }],
  ['won past the riders', { ...st, stops: stopWith({ won: [5] }) }],
  ['won more than twice cap', { ...st, stops: stopWith({ cap: 1, won: [0, 1, 2] }) }],
  ['a timer below nought', { ...st, left: -1 }],
  ['a timer past ten minutes', { ...st, hold: 600_001 }],
  ['a timer a fraction', { ...st, open: 0.5 }],
  ['more stars than games', { ...st, riders: rider(2, ['p02', 1, 1, null]) }],
]

describe('nothing malformed is believed (3.10)', () => {
  it('every valid body is read back as it was', () => {
    for (const [t, body] of Object.entries(VALID)) expect([t, readBus(body)]).toEqual([t, body])
  })
  for (const [what, body] of MALFORMED)
    it(`refuses ${what}`, () => {
      expect(readBus(body)).toBeNull()
    })
  it('every field of a state is required', () => {
    for (const key of Object.keys(st)) {
      const less = { ...st }
      delete less[key]
      expect([key, readBus(less)]).toEqual([key, null])
    }
  })
})

describe('who may ask what (3.11)', () => {
  it('nobody off the call’s roster is believed, about anything', () => {
    const net = atTable(['zed'])
    net.roster.delete('zed')
    const b = net.bus('p01')
    const forged = wireOf({ ...b, seq: b.seq + 9, phase: 'end' }, net.here, net.now)
    net.wire.push({ from: 'zed', m: forged })
    /* p03 has left the call, and an `off` in its name arrives */
    net.roster.delete('p03')
    net.wire.push({ from: 'p03', m: { v: 1, t: 'off', tour: b.tour } })
    net.flush()
    expect(net.bus('p01').seq).toBe(b.seq)
    expect(net.bus('p02').phase).toBe('pick')
    expect(net.bus('p01').riders[0].on).toBe(true)
  })
  it('somebody not on the Lab cannot board or sit, and nobody takes another’s turn', () => {
    const net = atTable(['p04'])
    net.here.delete('p04')
    const tour = net.bus('p01').tour
    net.wire.push({ from: 'p04', m: { v: 1, t: 'sit', tour, n: 1, on: true } })
    net.runUntil(() => net.now >= net.bus('p01').openAt)
    /* from here no tick runs, so no beat: every count the bus moves on is a request taken */
    const b = net.bus('p01')
    expect(b.busy).toEqual([])
    /* p03 is not the guide: no roll before freeAt, no pick, no go; p04 is no rider at all */
    net.wire.push({
      from: 'p03',
      m: { v: 1, t: 'roll', tour, n: 2, faces: ['go', 'hex', 'paint'] },
    })
    net.flush()
    expect(net.bus('p01').phase).toBe('pick')
    net.press('p02', { t: 'roll', faces: ['go', 'hex', 'paint'] })
    net.flush()
    net.wire.push({ from: 'p03', m: { v: 1, t: 'pick', tour, n: 2, toy: 'hex' } })
    net.flush()
    expect(net.bus('p01').phase).toBe('choose')
    net.press('p02', { t: 'pick', toy: 'hex' })
    net.flush()
    net.wire.push({ from: 'p04', m: { v: 1, t: 'ready', tour, n: 2, toy: 'hex', on: true } })
    net.wire.push({ from: 'p04', m: { v: 1, t: 'off', tour } })
    net.flush()
    expect(net.bus('p01').riders.map((r) => r.id)).toEqual(['p03', 'p02', 'p01'])
    net.at(net.now + net.k.READY_MIN_MS)
    net.wire.push({ from: 'p03', m: { v: 1, t: 'go', tour, n: 2 } })
    net.flush()
    expect(net.bus('p01').stops.length).toBe(1)
    expect(net.bus('p01').seq).toBe(b.seq + 2)
  })
  /* p03 IS a rider, so only its being away can refuse it; each with the same ask from p03 here */
  it('a rider not on the Lab cannot sit', () => {
    for (const away of [true, false]) {
      const net = atTable()
      if (away) net.here.delete('p03')
      net.wire.push({
        from: 'p03',
        m: { v: 1, t: 'sit', tour: net.bus('p01').tour, n: 1, on: true },
      })
      net.flush()
      expect([away, net.bus('p01').busy]).toEqual([away, away ? [] : [0]])
    }
  })
  it('a rider not on the Lab cannot roll for the guide, even once it is free', () => {
    for (const away of [true, false]) {
      const net = atTable()
      const b = net.bus('p01')
      if (away) net.here.delete('p03')
      net.at(b.freeAt + 100)
      const faces: [string, string, string] = ['go', 'hex', 'paint']
      net.wire.push({ from: 'p03', m: { v: 1, t: 'roll', tour: b.tour, n: 2, faces } })
      net.flush()
      expect([away, phase(net)]).toEqual([away, away ? 'pick' : 'choose'])
    }
  })
})

describe('what the host checks of every request (§2.4)', () => {
  const rolled = () => {
    const net = atTable()
    net.at(net.bus('p01').openAt)
    net.press('p02', { t: 'roll', faces: ['go', 'hex', 'paint'] })
    net.flush()
    return { net, tour: net.bus('p01').tour }
  }
  it('the guide picks one of the faces rolled, and nothing else', () => {
    const { net, tour } = rolled()
    net.wire.push({ from: 'p02', m: { v: 1, t: 'pick', tour, n: 2, toy: 'chess' } })
    net.flush()
    expect(phase(net)).toBe('choose')
    net.wire.push({ from: 'p02', m: { v: 1, t: 'pick', tour, n: 2, toy: 'paint' } })
    net.flush()
    expect([phase(net), net.bus('p01').toy]).toEqual(['ready', 'paint'])
  })
  it('the finale opens only after the last stop', () => {
    const net = atTable()
    net.at(net.bus('p01').openAt)
    net.wire.push({ from: 'p02', m: { v: 1, t: 'fin', tour: net.bus('p01').tour } })
    net.flush()
    expect(phase(net)).toBe('pick')
  })
  it('each request names the departure it is about, or is refused', () => {
    const net = atTable()
    const tour = net.bus('p01').tour
    net.at(net.bus('p01').openAt)
    /* a roll for the departure already made; a sit at a stop not yet reached */
    const faces: [string, string, string] = ['go', 'hex', 'paint']
    net.wire.push({ from: 'p02', m: { v: 1, t: 'roll', tour, n: 1, faces } })
    net.wire.push({ from: 'p03', m: { v: 1, t: 'sit', tour, n: 2, on: true } })
    net.flush()
    expect([phase(net), net.bus('p01').busy]).toEqual(['pick', []])
    net.wire.push({ from: 'p02', m: { v: 1, t: 'roll', tour, n: 2, faces } })
    net.flush()
    net.wire.push({ from: 'p02', m: { v: 1, t: 'pick', tour, n: 2, toy: 'hex' } })
    net.flush()
    expect(phase(net)).toBe('ready')
    /* a yes under another departure's number, or for another toy: refused, and no fresh count */
    const ready = (n: number, on: boolean, toy = 'hex') =>
      net.wire.push({ from: 'p03', m: { v: 1, t: 'ready', tour, n, toy, on } })
    ready(3, true)
    ready(2, true, 'paint')
    net.flush()
    expect(net.bus('p01').ready).not.toContain(0)
    for (const on of [true, false, true]) ready(2, on)
    net.flush()
    expect(net.bus('p01').ready).toContain(0)
    ready(3, false)
    net.flush()
    expect(net.bus('p01').ready).toContain(0)
  })
  it('Come too after the last rider has landed is refused, and the sender stays off the bus', () => {
    const net = atTable(['p04'])
    net.run(10_000)
    const tour = net.bus('p01').tour
    net.wire.push({ from: 'p04', m: { v: 1, t: 'ready', tour, n: 1, toy: 'fourrow', on: true } })
    net.flush()
    expect(net.bus('p01').riders.map((r) => r.id)).toEqual(['p03', 'p02', 'p01'])
  })
  it('Come too names the stop the bus left for, or is refused', () => {
    const net = party(['p01', 'p02', 'p03'])
    net.run(2000)
    net.start('p01')
    net.flush()
    net.press('p01', { t: 'roll', faces: ['chess', 'fourrow', 'swarm'] })
    net.flush()
    net.press('p01', { t: 'pick', toy: 'fourrow' })
    net.flush()
    net.runUntil(() => net.bus('p01').stops.length === 1, 30_000)
    const tour = net.bus('p01').tour
    const come = (toy: string) =>
      net.wire.push({ from: 'p03', m: { v: 1, t: 'ready', tour, n: 1, toy, on: true } })
    come('chess')
    net.flush()
    expect(net.bus('p01').riders.map((r) => r.id)).toEqual(['p01'])
    come('fourrow')
    net.flush()
    expect(net.bus('p01').riders.map((r) => r.id)).toEqual(['p01', 'p03'])
  })
  it('a request accepted between stops gives the quiet tour another TOUR_IDLE_MS', () => {
    const net = atTable()
    net.run(net.k.TOUR_IDLE_MS - 60_000, 500)
    const tour = net.bus('p01').tour
    net.wire.push({ from: 'p02', m: { v: 1, t: 'sit', tour, n: 1, on: true } })
    net.flush()
    const asked = net.now
    expect(net.bus('p01').busy).toEqual([1])
    net.runUntil(() => phase(net) === 'end', 700_000, 500)
    expect(Math.abs(net.now - asked - net.k.TOUR_IDLE_MS)).toBeLessThanOrEqual(500)
  })
})

describe('a repair hello (§2.5.4)', () => {
  /* three on the Lab, none holding a tour; their arrival hellos long done */
  const quiet = () => {
    const net = party(['p01', 'p02', 'p03'])
    net.run(10_000)
    return { net, from: net.log.length }
  }
  const other = { v: 1 as const, t: 'sit' as const, tour: 'zzzz9999', n: 1, on: true }
  it('traffic for a tour I do not hold asks for it, at most once every HELLO_REPAIR_MS', () => {
    const { net, from } = quiet()
    net.wire.push({ from: 'p02', m: other })
    net.flush()
    expect(hellos(net, 'p03', from)).toBe(1)
    net.run(net.k.HELLO_REPAIR_MS - 200)
    net.wire.push({ from: 'p02', m: other })
    net.flush()
    expect(hellos(net, 'p03', from)).toBe(1)
    net.run(300)
    net.wire.push({ from: 'p02', m: other })
    net.flush()
    expect(hellos(net, 'p03', from)).toBe(2)
  })
  it('not while holding a live tour, whose own states settle which tour wins', () => {
    const { net, from } = quiet()
    net.start('p01')
    net.flush()
    net.wire.push({ from: 'p02', m: other })
    net.flush()
    expect(hellos(net, 'p03', from)).toBe(0)
  })
  it('not from a browser that is not live', () => {
    const { net, from } = quiet()
    net.here.delete('p02')
    net.wire.push({ from: 'p03', m: other })
    net.flush()
    expect([hellos(net, 'p01', from), hellos(net, 'p02', from)]).toEqual([1, 0])
  })
})

describe('what the bus costs (3.16)', () => {
  it('the outbox: the first at once, the rest a second later, the latest of each kind', () => {
    const box = outbox(KNOBS)
    expect(box.dueAt()).toBeNull()
    box.push({ t: 'state' })
    expect(box.take(0)).toEqual([{ t: 'state' }])
    box.push({ t: 'state' })
    box.push({ t: 'state' })
    expect(box.dueAt()).toBe(1000)
    expect(box.take(999)).toEqual([])
    expect(box.take(1000)).toEqual([{ t: 'state' }])
    const ready = (on: boolean) => ({
      v: 1 as const,
      t: 'ready' as const,
      tour: TOUR,
      n: 2,
      toy: 'hex',
      on,
    })
    box.push(ready(true))
    box.push({ v: 1, t: 'sit', tour: TOUR, n: 1, on: true })
    box.push(ready(false))
    box.push(ready(true))
    expect(box.take(1000)).toEqual([ready(true)])
    expect(box.take(1500)).toEqual([])
    expect(box.take(2000)).toEqual([{ v: 1, t: 'sit', tour: TOUR, n: 1, on: true }])
    expect(box.dueAt()).toBeNull()
  })
  it('two to twelve people, everybody pressing everything every stop: within N + 1 sends a second', () => {
    const peaks: string[] = []
    for (let N = 2; N <= 12; N++) {
      const ids = named(N)
      const net = party(ids, { paced: true })
      const boarding = boardingOf(ids)
      const rand = seeded(N)
      net.run(2000)
      net.start(boarding[0])
      net.flush()
      const started = net.now
      const departures: number[] = []
      for (let s = 0; s < 5; s++) {
        const h = net.host()!
        net.runUntil(() => net.now >= net.bus(h).openAt)
        const b = net.bus(h)
        const guide = b.riders[b.guide].id
        const faces = rollFaces(TOYS, b, net.get(guide).sub, () => undefined, 'all', rand)!
        /* each press once every browser shows what it answers, as a person's would be */
        const all = (phase: Bus['phase']) => () => ids.every((id) => net.bus(id).phase === phase)
        net.press(guide, { t: 'roll', faces })
        expect(net.runUntil(all('choose'), 5000)).toBe(true)
        /* face 1 is a call-table toy: the costliest landing there is */
        net.press(guide, { t: 'pick', toy: faces[0] })
        expect(net.runUntil(all('ready'), 5000)).toBe(true)
        /* everybody else, in one breath: yes, no, yes */
        for (const id of boarding)
          if (id !== guide) for (const on of [true, false, true]) net.ready(id, on)
        net.flush()
        const n = s + 1
        expect(net.runUntil(() => net.bus(h).stops.length === n, 30_000)).toBe(true)
        departures.push(net.now)
        /* everybody went: the whole call is on the bus, and every one of them lands */
        expect(net.bus(h).went.length).toBe(N)
        const landed = () => net.landings.filter((l) => l.toy === faces[0]).length === N
        expect(net.runUntil(landed, 30_000)).toBe(true)
        /* everybody sits down and stands up again, in one breath */
        for (const id of boarding) {
          net.press(id, { t: 'sit', on: true })
          net.press(id, { t: 'sit', on: false })
        }
        net.flush()
      }
      /* every bus send, each metered once per person on the call */
      const sends = net.log.map((e) => e.at)
      const most = (xs: number[], w = 1000) => {
        let best = 0
        for (let i = 0, j = 0; i < xs.length; i++) {
          while (xs[i] - xs[j] >= w) j++
          best = Math.max(best, i - j + 1)
        }
        return best
      }
      const peak = most(sends)
      expect([N, peak]).toEqual([N, Math.min(peak, N + 1)])
      expect(peak * N).toBeLessThanOrEqual((N + 1) * N)
      /* and it is not a bound about nothing: the tour itself, start-up hellos aside, has a
         second as busy as the yes-no-yes burst makes it */
      expect(most(sends.filter((at) => at >= started))).toBeGreaterThan(N / 2)
      for (let i = 1; i < departures.length; i++)
        expect(departures[i] - departures[i - 1]).toBeGreaterThanOrEqual(28_000)
      /* each landing: a hop onto a table is four sends (tour.ts measured a where, a hello and two
         states), metered once per person — and Realtime's budget is about a hundred a second */
      for (const toy of new Set(net.landings.map((l) => l.toy))) {
        const at = net.landings.filter((l) => l.toy === toy).map((l) => l.at)
        const cost = 4 * N
        const span = at[at.length - 1] - at[0]
        const gap = at.length > 1 ? span / (at.length - 1) : Infinity
        /* sustained: the landing as a whole, each hop owning the gap after it */
        const sustained = (at.length * cost * 1000) / (span + Math.min(gap, 1000))
        expect([N, toy, sustained]).toEqual([N, toy, Math.min(sustained, 110)])
        /* the busiest second can catch one hop more than that: never two */
        const second = most(at) * cost
        expect(second).toBeLessThanOrEqual(110 + cost)
        if (toy === [...new Set(net.landings.map((l) => l.toy))][0])
          peaks.push(`N=${N}: ${second}/s peak, ${Math.round(sustained)}/s sustained`)
      }
    }
    expect(peaks.length).toBe(11)
  })
})

describe('hello (3.18)', () => {
  it('twelve riders on the bus answer a newcomer once, not once each', () => {
    const { net, boarding } = boarded(12)
    const { guide } = rollAndPick(net, seeded(12))
    for (const id of boarding.slice(1)) {
      net.ready(id, true)
      net.flush()
    }
    net.runUntil(() => net.bus(guide).stops.length === 1, 30_000)
    net.run(5000)
    expect(net.bus('p01').riders.filter((r) => r.on).length).toBe(12)
    const from = net.log.length
    net.join('p13')
    net.run(500)
    const answers = net.log.slice(from).filter((e) => e.m.t === 'state')
    expect(answers.map((e) => e.from)).toEqual(['p01'])
    expect(net.bus('p13').tour).toBe(net.bus('p01').tour)
  })
  it('twelve holding the tour answer a newcomer once', () => {
    const { net } = boarded(12)
    net.run(5000)
    const from = net.log.length
    net.join('p13')
    net.run(500)
    const answers = net.log.slice(from).filter((e) => e.m.t === 'state')
    expect(hellos(net, 'p13', from)).toBe(1)
    expect(answers.length).toBe(1)
    expect(net.bus('p13').tour).toBe(net.bus('p01').tour)
    net.run(10_000)
    expect(hellos(net, 'p13', from)).toBe(1)
  })
  it('nobody holding a tour: nobody answers, and the newcomer asks twice and stops', () => {
    const net = party(['p01', 'p02', 'p03'])
    net.run(10_000)
    const from = net.log.length
    net.join('p04')
    net.run(20_000)
    expect(hellos(net, 'p04', from)).toBe(2)
    expect(net.log.slice(from).filter((e) => e.m.t === 'state')).toEqual([])
    expect(net.log.length - from).toBe(2)
  })
  it('nobody else on the Lab: nothing is said at all', () => {
    const net = party(['p01', 'p02', 'p03'])
    net.here.clear()
    net.join('p04')
    net.run(20_000)
    expect(net.log).toEqual([])
  })
})

/* riders boarded p03, p01, p02, p04 — ids out of order — each with something to tell */
const FULL: Bus = {
  ...listen('p03', 0),
  seq: 41,
  from: 'p03',
  tour: TOUR,
  len: 7,
  riders: [
    { id: 'p03', on: true, stars: 2, played: 3 },
    { id: 'p01', on: false, stars: 1, played: 1 },
    { id: 'p02', on: true, stars: 0, played: 4 },
    { id: 'p04', on: true, stars: 1, played: 2 },
  ],
  guide: 2,
  phase: 'choose',
  faces: ['go', 'hex', 'paint'],
  ready: [2, 3],
  no: [1],
  went: [1, 0, 3],
  busy: [3, 1],
  stops: [
    {
      toy: 'fourrow',
      cap: 2,
      games: [
        [17, 0, 3],
        [23, 1, 0],
      ],
      won: [3, 1, 0],
    },
    { toy: 'swarm', cap: 1, games: [], won: [] },
  ],
  due: 12_345,
  openAt: 1_001,
  freeAt: 45_678,
  holdUntil: 299_999,
  leaveAt: 2_222,
}

describe('what a person’s facts reach (3.19)', () => {
  it('a rider not live in the sender’s view is left out of everything said about people', () => {
    const w = wireOf(FULL, new Set(['p03', 'p02']), 0)
    expect(w.ready).toEqual([2])
    expect(w.no).toEqual([])
    expect(w.went).toEqual([0])
    expect(w.busy).toEqual([])
    expect(w.riders).toEqual([
      ['p03', 1, 2, 3],
      ['p01', 0, null, null],
      ['p02', 1, 0, 4],
      ['p04', 1, null, null],
    ])
    expect(w.stops[0].won).toEqual([0])
    /* who sat in each counted game, by rider: a seat of somebody not live is not said */
    expect(w.stops[0].games).toEqual([
      [17, 0, -1],
      [23, -1, 0],
    ])
    /* the tour's own facts are all there */
    expect([w.guide, w.faces, w.stops.map((s) => s.toy)]).toEqual([
      2,
      ['go', 'hex', 'paint'],
      ['fourrow', 'swarm'],
    ])
  })
  it('somebody who knew keeps it; somebody who did not never learns it', () => {
    const told = wireOf(FULL, new Set(['p03', 'p02']), 0)
    const knew = mergeKnown(FULL, {
      ...FULL,
      seq: 42,
      riders: told.riders.map(([id, on, s, p]) => ({ id, on: on === 1, stars: s, played: p })),
      stops: told.stops,
    })
    expect(knew.riders.map((r) => [r.stars, r.played])).toEqual([
      [2, 3],
      [1, 1],
      [0, 4],
      [1, 2],
    ])
    expect(knew.stops[0].won.sort()).toEqual([0, 1, 3])
    expect(knew.stops[0].games).toEqual([
      [17, 0, 3],
      [23, 1, 0],
    ])
    /* never down: a lower count is an older one */
    const lower = mergeKnown(FULL, {
      ...FULL,
      riders: FULL.riders.map((r) => ({ ...r, stars: 0 })),
    })
    expect(lower.riders.map((r) => r.stars)).toEqual([2, 1, 0, 1])
    /* a newcomer who held nothing of this tour learns only what was said */
    const net = party(['p05', 'p03'])
    net.run(2000)
    net.wire.push({ from: 'p03', m: told })
    net.flush()
    expect(net.bus('p05').riders.map((r) => r.stars)).toEqual([2, null, 0, null])
    expect(net.bus('p05').stops[0].games).toEqual([
      [17, 0, -1],
      [23, -1, 0],
    ])
  })
})

describe('the state, there and back (3.20)', () => {
  const asSent = (b: Bus) =>
    JSON.stringify([
      b.seq,
      b.tour,
      b.len,
      b.riders,
      b.guide,
      b.phase,
      b.faces,
      b.toy,
      b.ready,
      b.no,
      b.went,
      b.busy,
      b.stops,
      b.due,
      b.openAt,
      b.freeAt,
      b.holdUntil,
      b.leaveAt,
    ])
  for (const [what, bus] of [
    ['choosing', FULL],
    ['boarding', { ...FULL, phase: 'ready' as const, faces: null, toy: 'hex' }],
  ] as const)
    it(`every field off its default comes back as it went, ${what}`, () => {
      const everyone = new Set(FULL.riders.map((r) => r.id))
      const wire = JSON.parse(JSON.stringify(wireOf(bus, everyone, 0))) as State
      const read = readBus(wire)
      expect(read).not.toBeNull()
      const ctx: Ctx = {
        now: 0,
        present: everyone,
        roster: everyone,
        meLive: true,
        subOf: () => null,
        people: 4,
        k: KNOBS,
      }
      /* a watcher, whom the state says nothing about personally */
      const got = receive(listen('p05', 0), ctx, 'p03', read!).bus
      expect(asSent(got)).toBe(asSent(bus))
      if (bus.phase === 'ready') expect(got.readyAt).toBe(bus.due - KNOBS.READY_MS)
      /* a rider whose page is new to the tour: all of it, but the yes an older page of theirs
         gave (adopt) — p04 does not host, so it is held and not said */
      const p04 = receive(listen('p04', 0), ctx, 'p03', read!)
      expect([asSent(p04.bus), p04.out]).toEqual([asSent({ ...bus, ready: [2] }), []])
    })
})

describe('boarding all at once', () => {
  it('everybody who says yes in one breath is on the bus, though a lower id boards first', () => {
    const ids = named(6)
    const net = party(ids, { paced: true })
    net.run(2000)
    /* p06 starts: every other id is lower, so each yes the host takes makes a new host */
    net.start('p06')
    net.flush()
    net.press('p06', { t: 'roll', faces: ['chess', 'fourrow', 'swarm'] })
    net.runUntil(() => ids.every((id) => net.bus(id).phase === 'choose'), 5000)
    net.press('p06', { t: 'pick', toy: 'fourrow' })
    net.runUntil(() => ids.every((id) => net.bus(id).phase === 'ready'), 5000)
    for (const id of ['p01', 'p02', 'p03', 'p04', 'p05']) net.ready(id, true)
    net.runUntil(() => net.bus('p01').stops.length === 1, 30_000)
    expect(net.agree()).toBe(true)
    const b = net.bus('p01')
    expect(b.went.map((i) => b.riders[i].id).sort()).toEqual(ids)
    net.run(10_000)
    expect(net.landings.map((l) => l.id)).toEqual(ids)
  })
})

describe('the host never publishes a bus it could not read back', () => {
  it('seventeen say yes: sixteen ride, and every state stays readable', () => {
    const { net, boarding } = boarded(17)
    const { guide } = rollAndPick(net, seeded(3))
    for (const id of boarding.slice(1)) {
      net.ready(id, true)
      net.flush()
    }
    expect(net.bus(guide).riders.length).toBe(16)
    expect(net.agree()).toBe(true)
  })
  it('a roll naming a toy already a stop is refused; one that fits goes', () => {
    const net = atTable()
    net.at(net.bus('p01').openAt)
    expect(net.bus('p01').stops.map((x) => x.toy)).toEqual(['fourrow'])
    net.press('p02', { t: 'roll', faces: ['fourrow', 'hex', 'paint'] })
    net.flush()
    expect([phase(net), net.bus('p02').phase]).toEqual(['pick', 'pick'])
    net.press('p02', { t: 'roll', faces: ['chess', 'hex', 'paint'] })
    net.flush()
    expect(phase(net)).toBe('choose')
  })
})

describe('Gust is never a stop, whatever the wire says (Evan, 27 Nov 2026)', () => {
  /* tour.test.ts sweeps the draws; these are the two places a forged or foreign roll could get in */
  it('the host refuses a roll with Gust on any face, and takes the same roll without it', () => {
    for (let i = 0; i < 3; i++) {
      const net = atTable()
      net.at(net.bus('p01').openAt)
      const faces: [string, string, string] = ['chess', 'hex', 'paint']
      faces[i] = 'gust'
      net.press('p02', { t: 'roll', faces })
      net.flush()
      expect([faces, phase(net), net.bus('p03').phase]).toEqual([faces, 'pick', 'pick'])
      net.press('p02', { t: 'roll', faces: ['chess', 'hex', 'paint'] })
      net.flush()
      expect([faces, phase(net)]).toEqual([faces, 'choose'])
    }
  })
  it('a state naming Gust as a face, the next stop or a stop made is refused by everybody', () => {
    expect(readBus({ ...st, faces: ['go', 'gust', 'paint'] })).toBeNull()
    expect(readBus({ ...st, phase: 'ready', faces: null, toy: 'gust' })).toBeNull()
    expect(readBus({ ...st, stops: stopWith({ toy: 'gust' }) })).toBeNull()
    /* the same three with an arcade toy that may be a stop, so the refusal is about Gust */
    expect(readBus({ ...st, faces: ['go', 'hockey', 'paint'] })).not.toBeNull()
    expect(readBus({ ...st, phase: 'ready', faces: null, toy: 'hockey' })).not.toBeNull()
    expect(readBus({ ...st, stops: stopWith({ toy: 'hockey' }) })).not.toBeNull()
  })
})

describe('Come too, twice at once', () => {
  it('two friends pressing it together land one after the other, not on top of each other', () => {
    const net = party(['p01', 'p02', 'p03', 'p04'])
    net.run(2000)
    net.start('p01')
    net.flush()
    net.press('p01', { t: 'roll', faces: ['chess', 'fourrow', 'swarm'] })
    net.flush()
    net.press('p01', { t: 'pick', toy: 'fourrow' })
    net.flush()
    net.ready('p02', true)
    net.flush()
    net.runUntil(() => net.bus('p01').stops.length === 1, 30_000)
    net.run(1000)
    for (const id of ['p04', 'p03']) net.ready(id, true)
    net.flush()
    net.runUntil(() => net.landings.length === 4, 10_000)
    const at = net.landings.map((l) => l.at)
    expect(net.landings.map((l) => l.id).slice(0, 2)).toEqual(['p01', 'p02'])
    /* a hop onto a table is four sends, each to four people: 16 against ~100 a second */
    for (let i = 1; i < at.length; i++)
      expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(Math.max(250, (16 / 100) * 1000))
  })
})

/* ── the step-5 review, 26 Nov 2026: each of these failed on 3b058b71 ─────────────────────────── */

/** what useBus's chores does for a yes, on every run: ask again, of each new host or publisher */
function askingAgain(net: Net) {
  const asked = new Map<string, Asked>()
  return () => {
    for (const c of net.clients()) {
      if (!c.listening) continue
      const a = askAgain(c.bus, net.ctx(c.id), c.consent, asked.get(c.id) ?? null)
      if (!a || !c.consent) continue
      asked.set(c.id, a)
      net.press(c.id, { t: 'ready', on: true, n: c.consent.n, toy: c.consent.toy })
    }
  }
}

describe('a yes goes with its window', () => {
  /* the stop after atTable's: p02's turn, Hex picked and p02 itself staying, p03 saying yes and
     switching tabs, p01 saying no — so nobody here is going, and the window is skipped */
  function skipped(net: Net) {
    net.at(net.bus('p01').openAt)
    net.press('p02', { t: 'roll', faces: ['go', 'hex', 'paint'] })
    net.flush()
    net.press('p02', { t: 'pick', toy: 'hex' })
    net.flush()
    net.ready('p02', false)
    net.flush()
  }
  it('a skipped window, then the same toy rolled again at the same departure: nothing pressed, nobody moved', () => {
    const net = atTable()
    const again = askingAgain(net)
    skipped(net)
    net.ready('p03', true)
    net.flush()
    expect(net.get('p03').consent?.toy).toBe('hex')
    net.here.delete('p03')
    net.ready('p01', false)
    net.flush()
    net.runUntil(() => phase(net) === 'pick', 30_000)
    expect(net.bus('p01').stops.length).toBe(1)
    net.here.add('p03')
    net.flush()
    /* the yes went with the window it answered, though the departure's number did not move */
    expect(net.get('p03').consent).toBeNull()
    /* the turn passed to p01, whose dice land on Hex again: p01 picks it */
    const b0 = net.bus('p01')
    expect(b0.riders[b0.guide].id).toBe('p01')
    net.press('p01', { t: 'roll', faces: ['hex', 'go', 'paint'] })
    net.flush()
    net.press('p01', { t: 'pick', toy: 'hex' })
    net.flush()
    expect([net.bus('p03').phase, net.bus('p03').toy]).toEqual(['ready', 'hex'])
    const from = net.log.length
    for (let t = 0; t < 600 && net.bus('p01').stops.length < 2; t++) {
      net.run(50, 50)
      again()
    }
    expect(net.bus('p01').stops.map((x) => x.toy)).toEqual(['fourrow', 'hex'])
    net.run(10_000)
    /* p03 pressed nothing for this window: no request, not among those who went, not moved */
    expect(net.log.slice(from).filter((e) => e.from === 'p03' && e.m.t === 'ready')).toEqual([])
    const b = net.bus('p01')
    expect(b.went.map((i) => b.riders[i].id)).toEqual(['p01'])
    expect([net.get('p01').sub, net.get('p03').sub]).toEqual(['hex', 'fourrow'])
  })
  it('and the same toy rolled again has three requests of its own, as another toy does', () => {
    const net = atTable()
    skipped(net)
    const sent = () => net.log.filter((e) => e.from === 'p03' && e.m.t === 'ready').length
    for (const on of [false, true, false]) {
      net.ready('p03', on)
      net.flush()
    }
    expect(sent()).toBe(3)
    net.ready('p01', false)
    net.flush()
    net.runUntil(() => phase(net) === 'pick', 30_000)
    net.press('p01', { t: 'roll', faces: ['hex', 'go', 'paint'] })
    net.flush()
    net.press('p01', { t: 'pick', toy: 'hex' })
    net.flush()
    net.ready('p03', true)
    net.flush()
    expect(sent()).toBe(4)
    expect(net.bus('p01').ready).toEqual([2, 0])
    net.runUntil(() => net.bus('p01').stops.length === 2, 30_000)
    expect(net.bus('p01').went).toEqual([2, 0])
  })
  it('windowGone: a departure keeps it, a skip or another roll ends it, the guide’s own pick in flight does not', () => {
    const at = { ...listen('p02', 0), tour: TOUR, riders: FULL.riders, stops: [FULL.stops[0]] }
    const c: Consent = { tour: TOUR, n: 2, toy: 'hex', leaves: null }
    const ready = { ...at, phase: 'ready' as const, toy: 'hex' }
    const choose = { ...at, phase: 'choose' as const }
    const faces: [string, string, string] = ['go', 'hex', 'paint']
    const pick = { ...at, phase: 'pick' as const }
    const left = { ...pick, stops: [FULL.stops[0], { ...FULL.stops[1], toy: 'hex' }] }
    expect(windowGone(ready, { ...ready, seq: 9 }, c)).toBe(false)
    expect(windowGone(ready, left, c)).toBe(false)
    expect(windowGone(ready, pick, c)).toBe(true)
    expect(windowGone(ready, { ...choose, faces }, c)).toBe(true)
    expect(windowGone(ready, { ...ready, toy: 'go' }, c)).toBe(true)
    expect(windowGone(ready, { ...ready, phase: 'end', toy: null }, c)).toBe(true)
    expect(windowGone(ready, { ...ready, tour: 'zzzz9999' }, c)).toBe(true)
    /* the guide picked Hex, and a state of the same roll came before the host had decided it */
    expect(windowGone({ ...choose, faces }, { ...choose, faces, seq: 9 }, c)).toBe(false)
    expect(windowGone({ ...choose, faces }, ready, c)).toBe(false)
    /* the dice chose another face before the pick arrived */
    expect(windowGone({ ...choose, faces }, { ...ready, toy: 'go' }, c)).toBe(true)
    /* Come too is about the stop, never a window */
    expect(windowGone(ready, pick, { ...c, n: 1, toy: 'fourrow', come: true })).toBe(false)
    expect(windowGone(ready, pick, null)).toBe(false)
  })
})

describe('whose roll it was', () => {
  it('the host knows who sent it; anybody else, only from a state sent while freeAt was ahead', () => {
    const net = atTable()
    const ids = ['p01', 'p02', 'p03']
    /* p02's own roll, inside its turn: everybody knows it was p02's */
    net.at(net.bus('p01').openAt)
    net.press('p02', { t: 'roll', faces: ['go', 'hex', 'paint'] })
    net.flush()
    expect(ids.map((id) => net.bus(id).guideRolled)).toEqual([true, true, true])
    /* nobody picks; the dice choose; the window is skipped and the turn passes to p01, who idles
       past freeAt — and p03 rolls for p01 */
    net.runUntil(() => phase(net) === 'pick', 60_000)
    net.runUntil(() => net.now >= net.bus('p01').freeAt, 120_000)
    net.run(1000)
    const b = net.bus('p03')
    expect(b.riders[b.guide].id).toBe('p01')
    net.press('p03', { t: 'roll', faces: ['go', 'hex', 'paint'] })
    net.flush()
    expect(phase(net)).toBe('choose')
    expect(ids.map((id) => net.bus(id).guideRolled)).toEqual([false, false, false])
    /* and the guide's own roll after idling is not known to be theirs by anybody but the host */
    const late = atTable()
    late.at(late.bus('p01').freeAt + 1000)
    late.press('p02', { t: 'roll', faces: ['go', 'hex', 'paint'] })
    late.flush()
    expect(ids.map((id) => late.bus(id).guideRolled)).toEqual([true, false, false])
  })
})

describe('a host gone silent in a window', () => {
  it('the next host takes the overdue window over, hears every yes again, and leaves with them', () => {
    const net = atTable()
    const again = askingAgain(net)
    net.at(net.bus('p01').openAt)
    /* p02 rolls and does not choose, so the dice choose and nobody has said yes */
    net.press('p02', { t: 'roll', faces: ['hex', 'go', 'paint'] })
    net.flush()
    net.runUntil(() => phase(net) === 'ready', 60_000)
    expect([net.bus('p02').phase, net.bus('p02').ready]).toEqual(['ready', []])
    const due = net.bus('p01').due
    /* p01, the host, goes silent: still on everybody's Lab until the party's sweep, and nothing it
       says arrives — so the two yeses below reach only a host that will never publish them */
    net.drop((_to, from) => from === 'p01')
    net.ready('p02', true)
    net.ready('p03', true)
    net.flush()
    expect(net.bus('p01').ready.length).toBe(2)
    for (let t = 0; t < 400 && net.now < due + 2000; t++) {
      net.run(50, 50)
      again()
    }
    /* p02's sweep drops p01 first; p03's, three seconds later */
    net.get('p02').view = new Set(['p02', 'p03'])
    for (let t = 0; t < 60; t++) {
      net.run(50, 50)
      again()
    }
    net.get('p01').listening = false
    net.here.delete('p01')
    net.get('p02').view = null
    for (let t = 0; t < 400 && net.bus('p02').stops.length < 2; t++) {
      net.run(50, 50)
      again()
    }
    const b = net.bus('p02')
    expect(b.stops.map((x) => x.toy)).toEqual(['fourrow', 'hex'])
    expect(b.went.map((i) => b.riders[i].id).sort()).toEqual(['p02', 'p03'])
    net.run(10_000)
    expect([net.get('p02').sub, net.get('p03').sub]).toEqual(['hex', 'hex'])
  })
  it('a yes that reaches the new host before its first tick takes the window over too', () => {
    /* p02 holds p01's window, two seconds past its end, and p01 is gone from its Lab */
    const now = 50_000
    const held: Bus = {
      ...listen('p02', 0),
      seq: 12,
      from: 'p01',
      tour: TOUR,
      len: 5,
      riders: [
        { id: 'p01', on: true, stars: 0, played: 0 },
        { id: 'p02', on: true, stars: 0, played: 0 },
        { id: 'p03', on: true, stars: 0, played: 0 },
      ],
      phase: 'ready',
      toy: 'hex',
      stops: [{ toy: 'fourrow', cap: 2, games: [], won: [] }],
      readyAt: now - 17_000,
      due: now - 2000,
      heard: true,
      live: true,
    }
    const ctx: Ctx = {
      now,
      present: new Set(['p02', 'p03']),
      roster: new Set(['p01', 'p02', 'p03']),
      meLive: true,
      subOf: () => 'fourrow',
      people: 3,
      k: KNOBS,
    }
    const req: Msg = { v: 1, t: 'ready', tour: TOUR, n: 2, toy: 'hex', on: true }
    const s = receive(held, ctx, 'p03', req)
    expect(s.out).toEqual([{ t: 'state' }])
    expect([s.bus.from, s.bus.ready, s.bus.due]).toEqual(['p02', [2], now + 2 * KNOBS.STATE_GAP_MS])
    /* and its own first tick does not close the window it has just claimed */
    expect(tick(s.bus, ctx).bus.phase).toBe('ready')
    /* a refused request claims it all the same: the claim is what everybody is to hear */
    const refused = receive(held, ctx, 'p03', { ...req, toy: 'go' })
    expect([refused.out, refused.bus.from]).toEqual([[{ t: 'state' }], 'p02'])
  })
})

describe('a rider who reloads during a window', () => {
  it('leaves the window with the page: not counted as going, though back before it closes', () => {
    const net = atTable()
    net.at(net.bus('p01').openAt)
    net.press('p02', { t: 'roll', faces: ['go', 'hex', 'paint'] })
    net.flush()
    net.press('p02', { t: 'pick', toy: 'hex' })
    net.flush()
    net.ready('p03', true)
    net.flush()
    expect(net.bus('p01').ready).toEqual([1, 0])
    /* p03 reloads: a bye, a page holding nothing, and back on the call a moment later */
    net.roster.delete('p03')
    net.here.delete('p03')
    net.get('p03').listening = false
    net.run(500)
    net.join('p03')
    net.run(2000)
    expect(net.get('p03').consent).toBeNull()
    net.runUntil(() => net.bus('p01').stops.length === 2, 30_000)
    const b = net.bus('p01')
    expect(b.went.map((i) => b.riders[i].id)).toEqual(['p02'])
    net.run(10_000)
    expect(net.get('p03').sub).toBe(START)
  })
})

describe('a seat kept through a pause', () => {
  it('back from a pause, a rider still seated asks nothing, and standing up still lets the bus go', () => {
    const net = atTable()
    const sat = new Map<string, Sat>()
    /* what useBus's chores does with a seat at the stop's table */
    const seat = (id: string, toy: string | null, settling = false) => {
      const c = net.get(id)
      c.seat = toy
      const s = sitNow(c.bus, sat.get(id) ?? null, toy, c.sub, settling)
      if (!s) return
      sat.set(id, s.sat)
      net.press(id, { t: 'sit', on: s.on })
      net.flush()
    }
    seat('p02', 'fourrow')
    seat('p03', 'fourrow')
    expect([...net.bus('p01').busy].sort()).toEqual([0, 1])
    /* p03 switches 🫱 off and on: listening starts again from nothing, the seat still taken */
    const c = net.get('p03')
    c.listening = false
    net.here.delete('p03')
    net.run(1000)
    c.bus = listen('p03', net.now)
    sat.delete('p03')
    c.listening = true
    net.here.add('p03')
    net.run(3000)
    expect(net.bus('p03').busy).toContain(0)
    const from = net.log.length
    /* the table comes back a moment after the bus: its seat reads as given up, then held again */
    seat('p03', null, true)
    seat('p03', 'fourrow', true)
    seat('p03', 'fourrow')
    expect(net.log.slice(from).filter((e) => e.from === 'p03' && e.m.t === 'sit')).toEqual([])
    /* the game ends: both stand up, and nothing holds the roll */
    seat('p02', null)
    seat('p03', null)
    expect(net.bus('p01').busy).toEqual([])
  })
  it('the host counts a sit that changes nothing as nothing', () => {
    const net = atTable()
    const tour = net.bus('p01').tour
    for (const on of [true, true, false]) {
      net.wire.push({ from: 'p03', m: { v: 1, t: 'sit', tour, n: 1, on } })
      net.flush()
    }
    expect(net.bus('p01').busy).toEqual([])
  })
})

describe('the tour kept aside through a pause', () => {
  it('is kept only for the call it came from, and never outlives that call', () => {
    const kept = keepAside(null, FULL, 'call-a', 1000)
    expect(keptFor(kept, 'call-a', 2000, KNOBS)).toBe(FULL)
    /* listening already off when the call ends: the end of the call clears it */
    expect(keepAside(kept, null, null, 3000)).toBeNull()
    expect(keepAside(null, FULL, null, 3000)).toBeNull()
    /* and nothing kept from one call is taken up in another */
    expect(keptFor(kept, 'call-b', 2000, KNOBS)).toBeNull()
    expect(keepAside(kept, null, 'call-b', 3000)).toBeNull()
    expect(keptFor(kept, 'call-a', 1000 + KNOBS.TOUR_IDLE_MS + 1, KNOBS)).toBeNull()
  })
  it('a pause that finds nothing to keep leaves the copy not yet put back, with its own clock', () => {
    const kept = keepAside(null, FULL, 'call-a', 1000)
    /* a stranger reloading: the gate shuts again before the tour was heard on the way back */
    const again = keepAside(kept, listen('p03', 2000), 'call-a', 4600)
    expect(again).toBe(kept)
    /* an ended tour is not worth keeping, and does not replace one that is */
    expect(keepAside(kept, { ...FULL, phase: 'end' }, 'call-a', 4600)).toBe(kept)
    const fresh = keepAside(kept, { ...FULL, seq: 50 }, 'call-a', 4600)
    expect([fresh?.bus.seq, fresh?.at]).toEqual([50, 4600])
  })
})

describe('hosts handing over within a second (3.16)', () => {
  it('everybody hops off as soon as they host, with a sit each: N requests and a state per host', () => {
    for (const N of [4, 6, 8]) {
      const ids = named(N)
      const net = party(ids, { paced: true })
      net.run(2000)
      /* the highest id starts, so every boarder is a lower id: each one a new host */
      net.start(ids[N - 1])
      net.flush()
      net.press(ids[N - 1], { t: 'roll', faces: ['chess', 'fourrow', 'swarm'] })
      net.runUntil(() => ids.every((id) => net.bus(id).phase === 'choose'), 5000)
      net.press(ids[N - 1], { t: 'pick', toy: 'fourrow' })
      net.runUntil(() => ids.every((id) => net.bus(id).phase === 'ready'), 5000)
      for (const id of ids.slice(0, -1)) net.ready(id, true)
      net.runUntil(() => net.landings.length === N, 60_000)
      net.run(3000)
      const from = net.log.length
      /* the host hops off, and so does each next host the moment its own browser says it hosts;
         everybody else sits down meanwhile, a request each */
      for (const id of ids) {
        net.runUntil(() => leads(net.bus(id), net.ctx(id)), 3000, 10)
        net.press(id, { t: 'off' })
        for (const other of ids) if (other !== id) net.press(other, { t: 'sit', on: true })
      }
      net.run(5000)
      expect(ids.every((id) => net.bus(id).phase === 'end')).toBe(true)
      const sends = net.log.slice(from)
      let changes = 0
      for (let i = 0; i < sends.length; i++) {
        const win = sends.filter((e) => e.at >= sends[i].at && e.at < sends[i].at + 1000)
        const senders = new Set(win.filter((e) => e.m.t === 'state').map((e) => e.from))
        changes = Math.max(changes, senders.size)
        /* one request a person and one state from each browser that hosted in that second */
        expect([N, win.length]).toEqual([N, Math.min(win.length, N + senders.size)])
        /* and never two states a second from any one browser */
        for (const s of senders)
          expect(win.filter((e) => e.m.t === 'state' && e.from === s).length).toBe(1)
      }
      /* the case is exercised: several hosts published inside one second */
      expect(changes).toBeGreaterThan(2)
    }
  })
})

describe('a tour that ends and starts again', () => {
  /*
   * The recheck's Dee: she starts a tour alone, so she is its only rider and its host; she rolls,
   * the window opens on Bo's and Ann's screens, and she presses Hop off and then, within the
   * second, 🚌 Another tour. Ids sort Bo < Ann < Dee, so neither friend can host either tour.
   * The shape of the world afterwards: everybody holds the tour Dee holds — the new one, as she
   * has it — and nobody is left on the window of the one that ended.
   */
  const lone = (stopsFirst: number) => {
    const net = party(['p01', 'p02', 'p04'], { paced: true })
    net.run(2000)
    net.start('p04')
    net.flush()
    const rand = seeded(11 + stopsFirst)
    for (let s = 0; s < stopsFirst; s++) {
      rollAndPick(net, rand)
      expect(net.runUntil(() => net.bus('p01').stops.length === s + 1, 30_000)).toBe(true)
    }
    rollAndPick(net, rand)
    expect(net.runUntil(() => ['p01', 'p02'].every((id) => net.bus(id).phase === 'ready'))).toBe(
      true,
    )
    return net
  }
  for (const stopsFirst of [0, 1])
    for (const wait of [0, 300, 900, 1500])
      it(`Hop off, then Another tour ${wait} ms after the window opened, ${stopsFirst} stop(s) made: every friend on the new tour`, () => {
        const net = lone(stopsFirst)
        const opened = net.states('p04').at(-1)!.at
        if (opened + wait > net.now) net.run(opened + wait - net.now, 10)
        const old = net.bus('p04').tour
        /* two presses, as a person makes them: whatever the first may send goes before the second */
        net.press('p04', { t: 'off' })
        net.flush()
        expect(net.bus('p04').phase).toBe('end')
        net.start('p04')
        const fresh = net.bus('p04').tour
        expect(fresh).not.toBe(old)
        /* ⚠️ the case is the one claimed: under a second, the tour's end is still waiting to go */
        if (wait < 1000) expect(net.now - opened).toBeLessThan(net.k.STATE_GAP_MS)
        for (const after of [3000, 30_000]) {
          net.run(after)
          for (const id of ['p01', 'p02'])
            expect([id, after, net.bus(id).tour]).toEqual([id, after, fresh])
          expect(net.agree()).toBe(true)
        }
      })

  it('nobody who decides a tour gives it up for a state of another from the one who published it', () => {
    /* Ann leads her tour (the host: the lowest rider here); Dee published it last and is still on
       it. A state of another tour from Dee is two tours at once, settled as ever — Ann's has a stop
       and Dee's fresh one none, so Ann's stands, on Ann's screen and on Bo's */
    const net = party(['p01', 'p02', 'p04'])
    net.run(2000)
    net.start('p04')
    net.flush()
    rollAndPick(net, seeded(3))
    net.ready('p02', true)
    net.flush()
    net.runUntil(() => net.bus('p01').stops.length === 1, 30_000)
    const mine = net.bus('p02')
    expect(leads(mine, net.ctx('p02'))).toBe(true)
    const other: Bus = {
      ...listen('p04', net.now),
      seq: mine.seq + 5,
      tour: 'zzzz0000',
      len: 5,
      riders: [{ id: 'p04', on: true, stars: 0, played: 0 }],
      phase: 'pick',
      openAt: net.now,
      due: net.now + net.k.TOUR_IDLE_MS,
    }
    const forced = { ...net.bus('p01'), from: 'p04' }
    net.get('p01').bus = forced
    net.get('p02').bus = { ...mine, from: 'p04' }
    net.wire.push({ from: 'p04', m: wireOf(other, net.here, net.now) })
    net.flush()
    for (const id of ['p01', 'p02']) expect([id, net.bus(id).tour]).toEqual([id, mine.tour])
  })
})

describe('Close closes the finished tour it was drawn on', () => {
  const ended = (me: string, over: Partial<Bus> = {}): Bus => ({
    ...listen(me, 0),
    seq: 7,
    from: 'p04',
    tour: 'aaaa0001',
    len: 5,
    riders: [{ id: 'p04', on: false, stars: 0, played: 0 }],
    phase: 'end',
    heard: true,
    ...over,
  })
  it('a rider back after the end is handed the ended tour and says nothing: a closed card stays closed', () => {
    /* the tour ends between stops for want of requests, its riders still on it; Ann closes the
       finale. Bo, the lowest rider, reloads: handed the ended tour, he would decide it if it were
       live, and a first beat one count on would open Ann's card again (closedFor) */
    const net = atTable()
    net.run(net.k.TOUR_IDLE_MS + 2000, 1000)
    expect(net.bus('p02').phase).toBe('end')
    const closed = closeOf(net.bus('p02'))
    expect(closedFor(closed, net.bus('p02'))).toBe(true)
    net.roster.delete('p01')
    net.here.delete('p01')
    net.get('p01').listening = false
    net.run(300)
    const states = net.states().length
    net.join('p01')
    net.run(5000)
    expect(net.bus('p01').tour).toBe(net.bus('p02').tour)
    expect(
      net
        .states()
        .slice(states)
        .map((e) => e.from),
    ).toEqual(['p02'])
    expect(closedFor(closed, net.bus('p02'))).toBe(true)
  })
  it('Another tour then Close, handled in that order, leaves the new tour on screen', () => {
    /* Dee's two presses, handled one after the other: the new tour is what Close is handled with */
    const net = party(['p01', 'p04'])
    net.run(2000)
    net.get('p04').bus = ended('p04')
    net.start('p04')
    const fresh = net.bus('p04')
    expect(fresh.phase).toBe('pick')
    const shut = closeOf(fresh)
    expect(closedFor(shut, fresh)).toBe(false)
  })
  it('the card closed on one tour is never another tour that happens to be at the same state', () => {
    const shut = closeOf(ended('p01'))
    expect(closedFor(shut, ended('p01'))).toBe(true)
    /* Ann's new tour, heard at seq 7 too: a new tour, so the card is back */
    const anns = ended('p01', { tour: 'bbbb0002', phase: 'pick', from: 'p02' })
    expect(closedFor(shut, anns)).toBe(false)
    /* and the next state of the same tour shows it again, as ever */
    expect(closedFor(shut, ended('p01', { seq: 8 }))).toBe(false)
  })
})

describe('a lone host whose page goes, and comes back holding nothing', () => {
  /*
   * The verify pass's Dee: alone on her tour and its host (ids sort Bo < Ann < Dee, so neither
   * friend can host it), she rolls, and the window opens on Bo's and Ann's screens. Then her page
   * goes — a reload, or Leave and a new tab later — and the page that comes back holds nothing and
   * has pressed nothing. Bo and Ann hold the tour and are not on it, so nobody here decides it.
   * The shape of the world once she is back, at every look: each friend holds a tour somebody here
   * decides, and no window past its end — or is offered Start; and since nobody has pressed Take
   * me there on a page that still exists, nobody goes anywhere: no stop is made, and Dee is moved
   * nowhere.
   */
  const ids = ['p01', 'p02', 'p04']
  const loneWindow = (stopsFirst: number) => {
    const net = party(ids, { paced: true })
    net.run(2000)
    net.start('p04')
    net.flush()
    const rand = seeded(41 + stopsFirst)
    for (let s = 0; s < stopsFirst; s++) {
      rollAndPick(net, rand)
      expect(net.runUntil(() => net.bus('p01').stops.length === s + 1, 30_000)).toBe(true)
    }
    rollAndPick(net, rand)
    expect(net.runUntil(() => ['p01', 'p02'].every((id) => net.bus(id).phase === 'ready'))).toBe(
      true,
    )
    return net
  }
  /** what a friend's panel can be: a tour somebody here moves along, or Start */
  const movable = (net: Net, id: string) => {
    const b = net.bus(id)
    if (canStart(b, net.ctx(id))) return 'start'
    const deciders = net.leaders().filter((x) => net.bus(x).tour === b.tour)
    /* a window may read past its end for as long as the departure takes to arrive, no longer */
    const stuck = b.phase === 'ready' && net.now > b.due + 2 * net.k.STATE_GAP_MS
    return deciders.length && !stuck ? 'moving' : `stuck: ${b.phase}, deciding ${deciders}`
  }
  for (const stopsFirst of [0, 1])
    for (const [how, away] of [
      ['reloads', 400],
      ['leaves and comes back after the window', KNOBS.READY_MS + 2000],
      ['leaves and comes back after Start was offered', KNOBS.ABANDON_MS + 5000],
    ] as const)
      it(`${how}, ${stopsFirst} stop(s) made: every friend can move on, and nobody goes`, () => {
        const net = loneWindow(stopsFirst)
        const made = net.bus('p01').stops.length
        /* the page goes: a bye, and nothing of it is left */
        net.roster.delete('p04')
        net.here.delete('p04')
        net.get('p04').listening = false
        net.run(away)
        const back = net.now
        net.join('p04')
        for (const after of [3000, 15_000, 40_000]) {
          net.run(back + after - net.now)
          for (const id of ['p01', 'p02']) {
            expect([id, after, movable(net, id)]).toEqual([
              id,
              after,
              expect.stringMatching(/^(start|moving)$/),
            ])
            expect([id, after, net.bus(id).stops.length]).toEqual([id, after, made])
          }
          /* and nobody is counted going, on any screen: no page that exists has said yes */
          for (const id of ids) {
            const b = net.bus(id)
            expect([id, after, b.ready.map((i) => b.riders[i].id)]).toEqual([id, after, []])
          }
        }
        expect(net.landings.filter((l) => l.id === 'p04' && l.at >= back)).toEqual([])
        expect(net.get('p04').sub).toBe(START)
        /* what handing it back cost: one state, from the lowest friend here, and none from Ann */
        const answered = (id: string) => net.states(id).filter((e) => e.at >= back).length
        expect([answered('p01'), answered('p02')]).toEqual([1, 0])
      })
  it('back from a hidden tab instead, she keeps her own yes, and goes', () => {
    /* a hidden tab keeps listening and keeps its press: the page never went */
    const net = loneWindow(0)
    const toy = net.bus('p04').toy
    net.here.delete('p04')
    net.run(3000)
    net.here.add('p04')
    expect(net.runUntil(() => net.bus('p01').stops.length === 1, 30_000)).toBe(true)
    net.run(5000)
    expect(net.landings.filter((l) => l.id === 'p04').map((l) => l.toy)).toEqual([toy])
  })
})

describe('a Hop off pressed as the host changes', () => {
  /*
   * The verify pass's E6: Dee starts, Ann boards at the first stop, so Ann hosts (p02 < p04) and
   * Dee rides; Bo (p01) never does. At the second window Ann hops off, and Dee hops off a moment
   * later — while Ann's state saying so still waits its second in Ann's Outbox. Dee's request
   * reaches a browser that no longer decides anything, and by the time anybody could decide it,
   * it is Dee. The shape of the world: both pressed Hop off, so nobody is on the bus, on any
   * screen, and the tour is over.
   */
  const ids = ['p01', 'p02', 'p04']
  const twoAboard = () => {
    const net = party(ids, { paced: true })
    net.run(2000)
    net.start('p04')
    net.flush()
    const rand = seeded(31)
    rollAndPick(net, rand)
    net.runUntil(() => net.bus('p02').phase === 'ready')
    net.ready('p02', true)
    net.flush()
    expect(net.runUntil(() => net.bus('p01').stops.length === 1, 60_000)).toBe(true)
    net.run(1500)
    rollAndPick(net, rand)
    net.runUntil(() => net.bus('p01').phase === 'ready')
    expect(leads(net.bus('p02'), net.ctx('p02'))).toBe(true)
    return net
  }
  const on = (net: Net, holder: string, id: string) =>
    net.bus(holder).riders.find((r) => r.id === id)?.on
  for (const w of [0, 100, 400, 900, 1300])
    it(`Dee hops off ${w} ms after Ann: nobody on the bus anywhere, and the tour over`, () => {
      const net = twoAboard()
      net.press('p02', { t: 'off' })
      net.flush()
      if (w) net.run(w, 10)
      /* ⚠️ the case is the one claimed: under a second, Dee has not heard that Ann got off */
      if (w < 1000) expect(on(net, 'p04', 'p02')).toBe(true)
      net.press('p04', { t: 'off' })
      net.flush()
      net.run(5000)
      for (const id of ids)
        expect([id, on(net, id, 'p02'), on(net, id, 'p04'), net.bus(id).phase]).toEqual([
          id,
          false,
          false,
          'end',
        ])
    })
  for (const w of [0, 400, 900])
    it(`with Cy riding too, Dee hops off ${w} ms after Ann: asked again of Cy, the host now`, () => {
      /* Cy (p03) boards as well, so the host after Ann is Cy and not Dee: Dee's Hop off has to
         reach somebody else, since she never comes to decide it herself */
      const all = ['p01', 'p02', 'p03', 'p04']
      const net = party(all, { paced: true })
      net.run(2000)
      net.start('p04')
      net.flush()
      const rand = seeded(31)
      rollAndPick(net, rand)
      net.runUntil(() => net.bus('p02').phase === 'ready')
      net.ready('p02', true)
      net.ready('p03', true)
      net.flush()
      expect(net.runUntil(() => net.bus('p01').stops.length === 1, 60_000)).toBe(true)
      net.run(1500)
      rollAndPick(net, rand)
      net.runUntil(() => net.bus('p01').phase === 'ready')
      expect(leads(net.bus('p02'), net.ctx('p02'))).toBe(true)
      net.press('p02', { t: 'off' })
      net.flush()
      if (w) net.run(w, 10)
      expect(on(net, 'p04', 'p02')).toBe(true)
      net.press('p04', { t: 'off' })
      net.flush()
      net.run(5000)
      for (const id of all)
        expect([id, on(net, id, 'p02'), on(net, id, 'p04'), on(net, id, 'p03')]).toEqual([
          id,
          false,
          false,
          true,
        ])
      expect(leads(net.bus('p03'), net.ctx('p03'))).toBe(true)
    })
  it('a Hop off taken back by Take me there before anybody decided it is not sent again', () => {
    const net = twoAboard()
    net.press('p02', { t: 'off' })
    net.flush()
    net.run(100, 10)
    net.press('p04', { t: 'off' })
    net.flush()
    net.run(200, 10)
    /* still in the window as Dee's own bus has it: her last word is that she is going */
    net.ready('p04', true)
    net.flush()
    net.run(5000)
    for (const id of ids) expect([id, on(net, id, 'p04')]).toEqual([id, true])
    expect(net.bus('p01').phase).not.toBe('end')
  })
})

describe('two tours at once, decided by two', () => {
  it('nor for a state of another tour from the host, while the one who published mine still decides it', () => {
    /* Ann has just boarded Dee's tour: Dee published her on, so Ann is host by everybody's
       reckoning (p02 < p04), and Dee goes on deciding until Ann publishes (leads). A state of
       another tour from Ann now, however it came to be sent, is not the end of mine — Dee still
       decides it — so it is two tours at once, settled as ever: mine has two riders and Ann's one,
       so mine stands, on Dee's screen and on Bo's */
    const net = party(['p01', 'p02', 'p04'])
    net.run(2000)
    net.start('p04')
    net.flush()
    rollAndPick(net, seeded(3))
    net.ready('p02', true)
    net.flush()
    const mine = net.bus('p04')
    expect(mine.riders.map((r) => [r.id, r.on])).toEqual([
      ['p04', true],
      ['p02', true],
    ])
    expect([mine.from, net.bus('p01').from]).toEqual(['p04', 'p04'])
    expect(leads(mine, net.ctx('p04'))).toBe(true)
    const other: Bus = {
      ...listen('p02', net.now),
      seq: mine.seq + 5,
      tour: 'zzzz0000',
      len: 5,
      riders: [{ id: 'p02', on: true, stars: 0, played: 0 }],
      phase: 'pick',
      openAt: net.now,
      due: net.now + net.k.TOUR_IDLE_MS,
    }
    net.wire.push({ from: 'p02', m: wireOf(other, net.here, net.now) })
    net.flush()
    for (const id of ['p01', 'p04']) expect([id, net.bus(id).tour]).toEqual([id, mine.tour])
  })
})

describe('the host away while the lowest friend’s page is new', () => {
  /*
   * The verify of 25119408, defect A: Dee alone on her tour and its host (ids sort Bo < Ann < Dee),
   * the window open on Bo's and Ann's screens, and Dee's page goes. While she is away Bo's page is
   * new — he reloaded, or first arrived — and on 25119408 nobody answered his hello, because nobody
   * on the tour was here. Then Dee was back, holding nothing, and the lowest here was Bo, who held
   * nothing either: her hellos went unanswered and Ann kept the window past its end, with Take me
   * there, at 3, 15 and 40 s. Now Ann hands Bo the tour when he arrives (answerers), and Bo hands it
   * to Dee — or, when both are new at once, Ann hands it to both. The shape of the world afterwards is the host pass's: every friend holds a
   * tour somebody here moves along, or is offered Start; and since no page that exists has pressed
   * Take me there, nobody goes anywhere.
   */
  const ids = ['p01', 'p02', 'p04']
  const gone = (net: Net, id: string) => {
    net.roster.delete(id)
    net.here.delete(id)
    net.get(id).listening = false
  }
  const loneWindow = (stopsFirst: number) => {
    const net = party(ids, { paced: true })
    net.run(2000)
    net.start('p04')
    net.flush()
    const rand = seeded(41 + stopsFirst)
    for (let s = 0; s < stopsFirst; s++) {
      rollAndPick(net, rand)
      expect(net.runUntil(() => net.bus('p01').stops.length === s + 1, 30_000)).toBe(true)
    }
    rollAndPick(net, rand)
    expect(net.runUntil(() => ['p01', 'p02'].every((id) => net.bus(id).phase === 'ready'))).toBe(
      true,
    )
    return net
  }
  /** what a panel can be: a tour somebody here moves along, or Start — never a window gone by */
  const movable = (net: Net, id: string) => {
    const b = net.bus(id)
    if (canStart(b, net.ctx(id))) return 'start'
    const deciders = net.leaders().filter((x) => net.bus(x).tour === b.tour)
    const stuck = b.phase === 'ready' && net.now > b.due + 2 * net.k.STATE_GAP_MS
    return deciders.length && !stuck ? 'moving' : `stuck: ${b.phase}, deciding ${deciders}`
  }
  /** every friend at 3, 15 and 40 s after `back`: movable, no stop made, nobody counted going */
  const look = (net: Net, back: number, made: number) => {
    for (const after of [3000, 15_000, 40_000]) {
      net.run(back + after - net.now)
      for (const id of ids) {
        const b = net.bus(id)
        expect([id, after, movable(net, id)]).toEqual([
          id,
          after,
          expect.stringMatching(/^(start|moving)$/),
        ])
        expect([id, after, b.ready.map((i) => b.riders[i].id)]).toEqual([id, after, []])
        if (b.tour === net.bus('p04').tour && holds(b))
          expect([id, after, b.stops.length]).toEqual([id, after, made])
      }
    }
    expect(net.landings.filter((l) => l.id === 'p04' && l.at >= back)).toEqual([])
  }
  /** the tour back with its host: every screen on Dee's tour, and Dee deciding it */
  const backWithDee = (net: Net, tour: string) => {
    expect(net.leaders()).toEqual(['p04'])
    for (const id of ids) expect([id, net.bus(id).tour]).toEqual([id, tour])
    expect(net.agree()).toBe(true)
  }

  for (const stopsFirst of [0, 1])
    for (const [how, w] of [
      ['reloads', 1500],
      ['reloads', 4000],
      ['reloads, and Dee is back after Start was offered', KNOBS.ABANDON_MS + 5000],
    ] as const)
      it(`Bo ${how} while Dee is away (${w} ms), ${stopsFirst} stop(s) made: the tour goes back to Dee`, () => {
        const net = loneWindow(stopsFirst)
        const tour = net.bus('p01').tour
        const made = net.bus('p01').stops.length
        gone(net, 'p04')
        net.run(500)
        gone(net, 'p01')
        net.run(200)
        const arrived = net.states().length
        net.join('p01')
        net.run(w)
        /* Bo's new page is handed the tour at once by Ann, the lowest here who holds it: a tour its
           host is away from is still a tour (answerers). On 25119408 nobody answered him */
        expect(
          net
            .states()
            .slice(arrived)
            .map((e) => e.from),
        ).toEqual(['p02'])
        expect(net.bus('p01').tour).toBe(tour)
        const states = net.states().length
        net.join('p04')
        const back = net.now
        /* two state gaps: Dee's state saying she has taken it, then the overdue window closed */
        net.run(2500)
        /* handed back at once, by Bo, now the lowest here who holds it — one state */
        const answers = net.states().slice(states, states + 1)
        expect(answers.map((e) => [e.from, e.at - back <= 200])).toEqual([['p01', true]])
        backWithDee(net, tour)
        look(net, back, made)
        expect(net.get('p04').sub).toBe(START)
      })

  for (const stopsFirst of [0, 1])
    for (const [first, d] of [
      ['together', 0],
      ['Bo', 100],
      ['Bo', 2500],
      ['Dee', 100],
      ['Dee', 1000],
      ['Dee', 4000],
    ] as const)
      it(`Dee and Bo reload at once, ${first === 'together' ? 'back together' : `${first} back ${d} ms first`}, ${stopsFirst} stop(s) made: the tour goes back to Dee`, () => {
        const net = loneWindow(stopsFirst)
        const tour = net.bus('p01').tour
        const made = net.bus('p01').stops.length
        gone(net, 'p04')
        gone(net, 'p01')
        net.run(400)
        const [a, b] = first === 'Dee' ? ['p04', 'p01'] : ['p01', 'p04']
        net.join(a)
        if (d) net.run(d, 10)
        net.join(b)
        const back = net.now
        net.run(2500)
        backWithDee(net, tour)
        look(net, back, made)
      })

  for (const stopsFirst of [1, 2])
    it(`then Bo goes to press Start, ${stopsFirst} stop(s) made: there is none, and nobody is left on a dead window`, () => {
      /* the verify's second form: on 25119408 Bo, holding nothing, was offered Start, and Ann kept
         Dee's dead window, whose stops beat Bo's new tour's none */
      const net = loneWindow(stopsFirst)
      const tour = net.bus('p01').tour
      gone(net, 'p04')
      net.run(500)
      gone(net, 'p01')
      net.run(200)
      net.join('p01')
      net.run(1500)
      net.join('p04')
      net.run(3000)
      expect(canStart(net.bus('p01'), net.ctx('p01'))).toBe(false)
      net.start('p01')
      net.flush()
      const back = net.now
      for (const after of [3000, 15_000, 40_000]) {
        net.run(back + after - net.now)
        for (const id of ids)
          expect([id, after, movable(net, id)]).toEqual([
            id,
            after,
            expect.stringMatching(/^(start|moving)$/),
          ])
        expect(new Set(ids.map((id) => net.bus(id).tour))).toEqual(new Set([tour]))
      }
    })
})

describe('the host back just as a friend presses Start', () => {
  /*
   * The verify of 25119408, defect B: Dee alone on her tour, the window open, and Dee's page goes;
   * past ABANDON_MS, Bo and Ann are offered Start. Bo presses it as Dee's new page comes back. On
   * 25119408 Ann's Start went the moment Dee was here, so she refused Bo's tour for Dee's old one —
   * it had a stop, and Bo's none — and Dee took Bo's: Ann held a window nobody would close at 3,
   * 15 and 40 s. Afterwards everybody is on one tour, somebody here moves it along, and Dee has
   * moved nowhere.
   */
  const ids = ['p01', 'p02', 'p04']
  for (const lat of [0, 120])
    for (const stopsFirst of [0, 1])
      for (const starter of ['p01', 'p02'])
        for (const d of [-1000, -300, -80, 0, 80, 300, 1000])
          it(`${lat} ms apart, ${stopsFirst} stop(s) made, ${starter === 'p01' ? 'Bo' : 'Ann'} presses Start, Dee back ${d} ms after: one tour, moving, on every screen`, () => {
            const net = party(ids, { paced: true, ...(lat && { lat: () => lat }) })
            net.run(2000)
            net.start('p04')
            net.flush()
            const rand = seeded(41 + stopsFirst)
            for (let s = 0; s < stopsFirst; s++) {
              rollAndPick(net, rand)
              expect(net.runUntil(() => net.bus('p01').stops.length === s + 1, 30_000)).toBe(true)
            }
            rollAndPick(net, rand)
            expect(
              net.runUntil(() => ['p01', 'p02'].every((id) => net.bus(id).phase === 'ready')),
            ).toBe(true)
            net.roster.delete('p04')
            net.here.delete('p04')
            net.get('p04').listening = false
            net.run(net.k.ABANDON_MS + 2000)
            expect(canStart(net.bus(starter), net.ctx(starter))).toBe(true)
            if (d < 0) {
              net.join('p04')
              net.run(-d, 10)
              net.start(starter)
            } else {
              net.start(starter)
              if (d) net.run(d, 10)
              net.join('p04')
            }
            const back = net.now
            for (const after of [3000, 15_000, 40_000]) {
              net.run(back + after - net.now)
              const tours = new Set(ids.map((id) => net.bus(id).tour))
              expect([after, tours.size]).toEqual([after, 1])
              const deciders = net.leaders().filter((x) => net.bus(x).tour === [...tours][0])
              for (const id of ids) {
                const b = net.bus(id)
                const ok =
                  canStart(b, net.ctx(id)) ||
                  (deciders.length > 0 && !(b.phase === 'ready' && net.now > b.due + 2000))
                expect([id, after, ok]).toEqual([id, after, true])
              }
            }
            expect(net.landings.filter((l) => l.id === 'p04' && l.at >= back)).toEqual([])
          })
})

describe('the verify’s two repros, as they were written', () => {
  /* the independent verify's minimal unit repros of 25119408, unchanged but for the names: red on
     25119408 and on 8b4d87ea */
  it('Bo (p01) reloads while Dee (p04) is away; Dee comes back: Ann (p02) is not left on a dead window', () => {
    const ids = ['p01', 'p02', 'p04']
    const net = party(ids, { paced: true })
    net.run(2000)
    net.start('p04')
    net.flush()
    rollAndPick(net, seeded(42))
    expect(net.runUntil(() => net.bus('p01').stops.length === 1, 30_000)).toBe(true)
    rollAndPick(net, seeded(43))
    expect(net.runUntil(() => ['p01', 'p02'].every((id) => net.bus(id).phase === 'ready'))).toBe(
      true,
    )
    const gone = (id: string) => {
      net.roster.delete(id)
      net.here.delete(id)
      net.get(id).listening = false
    }
    gone('p04')
    net.run(500)
    gone('p01')
    net.run(200)
    net.join('p01')
    net.run(1500)
    net.join('p04')
    const back = net.now
    for (const after of [3000, 15_000, 40_000]) {
      net.run(back + after - net.now)
      const ann = net.bus('p02')
      const deciding = net.leaders().filter((x) => net.bus(x).tour === ann.tour)
      const dead = ann.phase === 'ready' && net.now > ann.due + 2 * net.k.STATE_GAP_MS
      expect([after, canStart(ann, net.ctx('p02')) || (deciding.length > 0 && !dead)]).toEqual([
        after,
        true,
      ])
    }
  })
  it('Dee comes back past ABANDON_MS just as Bo presses Start: everybody is on Bo’s tour', () => {
    const ids = ['p01', 'p02', 'p04']
    const net = party(ids, { paced: true })
    net.run(2000)
    net.start('p04')
    net.flush()
    rollAndPick(net, seeded(42))
    expect(net.runUntil(() => net.bus('p01').stops.length === 1, 30_000)).toBe(true)
    rollAndPick(net, seeded(43))
    expect(net.runUntil(() => ['p01', 'p02'].every((id) => net.bus(id).phase === 'ready'))).toBe(
      true,
    )
    net.roster.delete('p04')
    net.here.delete('p04')
    net.get('p04').listening = false
    net.run(net.k.ABANDON_MS + 2000)
    expect(canStart(net.bus('p01'), net.ctx('p01'))).toBe(true)
    net.start('p01')
    net.join('p04')
    net.run(3000)
    const bo = net.bus('p01').tour
    expect(ids.map((id) => net.bus(id).tour)).toEqual([bo, bo, bo])
  })
})

/** what `id`'s screen draws from (busWords's View), with every toy in its Lab named by its id */
function viewOfBus(net: Net, id: string): View {
  const c = net.get(id)
  const x = net.ctx(id)
  return {
    bus: c.bus,
    now: x.now,
    k: x.k,
    name: (i) => i,
    toy: (t) => t,
    title: (t) => t,
    roster: x.roster,
    present: x.present,
    subOf: x.subOf,
    myToy: c.sub,
    seated: false,
    inMatch: false,
    consent: c.consent,
    hopAt: c.hop?.at ?? null,
    people: x.people,
  }
}

describe('the liveness bound, and who hands a tour back', () => {
  /*
   * bus.ts's `stalled`: a tour no state of which has moved its count on here for STALL_MS is one
   * nobody is driving, in every phase, and it is abandoned on every screen that holds it — and the
   * rules that go with it, about who hands a tour back (answerers, receive's hello).
   *
   * Dee alone on her tour and its host, one stop made, the window open on Bo's and Ann's screens;
   * then her page crashes — no bye, so she stays on everybody's Lab and on the roster, a rider here
   * whom nobody can tell from one still deciding. No rule that asks who is here can give her tour
   * up; only its clock can.
   */
  const ids = ['p01', 'p02', 'p04']
  const crashed = () => {
    const net = party(ids, { paced: true })
    net.run(2000)
    net.start('p04')
    net.flush()
    const rand = seeded(5)
    rollAndPick(net, rand)
    expect(net.runUntil(() => net.bus('p01').stops.length === 1, 30_000)).toBe(true)
    rollAndPick(net, rand)
    expect(net.runUntil(() => ['p01', 'p02'].every((id) => net.bus(id).phase === 'ready'))).toBe(
      true,
    )
    net.get('p04').listening = false
    return net
  }
  /** the bound, as the commit that makes it says it: thirty seconds, in every phase */
  const at = (b: Bus) => b.stateAt + 30_000
  /** a fresh tour of Cy's, one rider and no stop: it loses to Dee's on stops (`beats`) */
  const fresh = (net: Net) => ({
    from: 'p03',
    m: wireOf(
      {
        ...listen('p03', net.now),
        seq: 1,
        tour: 'cccc0003',
        len: 5,
        riders: [{ id: 'p03', on: true, stars: 0, played: 0 }],
        phase: 'pick',
        openAt: net.now,
        freeAt: net.now + KNOBS.IDLE_MS,
        due: net.now + KNOBS.TOUR_IDLE_MS,
      },
      net.here,
      net.now,
    ),
  })

  it('the bound is thirty seconds at every pace, and outlasts a beat and the longest sweep', () => {
    for (const k of [KNOBS, knobs(0.25)]) {
      expect(k.STALL_MS).toBe(30_000)
      expect(k.BEAT_MS).toBe(5000)
      /* a decider silent just before its beat, on everybody's Lab for 16 s stale and a 2 s sweep,
         and the next host's first state through its Outbox and over a 150 ms wire, twice */
      expect(k.BEAT_MS + 18_000 + k.STATE_GAP_MS + 2 * 150).toBeLessThan(k.STALL_MS)
    }
  })

  it('STALL_MS with no state that moved it: Start, and the next state of any tour', () => {
    const net = crashed()
    net.join('p03')
    net.here.delete('p03')
    const ann = () => net.bus('p02')
    const dead = at(ann())
    net.run(dead - 100 - net.now, 10)
    expect([canStart(ann(), net.ctx('p02')), canStart(net.bus('p01'), net.ctx('p01'))]).toEqual([
      false,
      false,
    ])
    /* a moment before, a tour that beats nothing is refused, as two tours at once ever are */
    net.wire.push(fresh(net))
    net.flush()
    expect(ann().tour).not.toBe('cccc0003')
    net.run(200, 10)
    for (const id of ['p01', 'p02']) {
      const b = net.bus(id)
      expect([id, canStart(b, net.ctx(id))]).toEqual([id, true])
      expect([id, phaseLine(viewOfBus(net, id))]).toEqual([
        id,
        { text: STALLED, buttons: [{ act: 'start', label: '🚌 Start a party tour' }] },
      ])
    }
    /* and once it has stopped, any other tour's next state is taken, though it beats nothing */
    net.wire.push(fresh(net))
    net.flush()
    expect([net.bus('p01').tour, ann().tour]).toEqual(['cccc0003', 'cccc0003'])
    expect(
      net.landings.filter((l) => l.at > 0 && l.id !== 'p04' && l.toy === net.bus('p04').toy),
    ).toEqual([])
  })

  it('between stops too: a tour ten minutes from its own deadline stalls thirty seconds after its last state', () => {
    /* the shape the deadline-relative backstop missed (C and D): `due` is TOUR_IDLE_MS away */
    const net = party(ids, { paced: true })
    net.run(2000)
    net.start('p04')
    net.flush()
    rollAndPick(net, seeded(5))
    expect(net.runUntil(() => net.bus('p01').stops.length === 1, 30_000)).toBe(true)
    net.run(1000)
    net.get('p04').listening = false
    const b = net.bus('p02')
    expect(b.phase).toBe('pick')
    expect(b.due - net.now).toBeGreaterThan(KNOBS.TOUR_IDLE_MS - 60_000)
    net.run(at(b) - 100 - net.now, 10)
    expect(canStart(net.bus('p02'), net.ctx('p02'))).toBe(false)
    net.run(200, 10)
    expect(canStart(net.bus('p02'), net.ctx('p02'))).toBe(true)
    expect(phaseLine(viewOfBus(net, 'p02'))?.text).toBe(STALLED)
  })

  for (const during of ['pick', 'choose', 'ready'] as const)
    it(`at the real pace, the decider silent just before its beat (${during}) is taken over first: nobody offered Start at any 100 ms`, () => {
      /* the worst case for the bound: Bo deciding with Ann and Cy riding goes silent (no bye) 200 ms
         before his next beat would have gone, and stays on everybody's Lab for the party's longest
         sweep — 16 s stale and a 2 s sweep, after his last `here` crossed a 150 ms wire. Only then
         may Ann take the tour over, and she must find it not yet given up anywhere */
      const lat = 150
      const net = party(['p01', 'p02', 'p03'], { paced: true, lat: () => lat })
      net.run(2000)
      net.start('p01')
      net.flush()
      const rand = seeded(17)
      rollAndPick(net, rand)
      expect(net.runUntil(() => net.bus('p02').phase === 'ready')).toBe(true)
      net.ready('p02', true)
      net.ready('p03', true)
      expect(net.runUntil(() => net.bus('p01').stops.length === 1, 30_000)).toBe(true)
      if (during !== 'pick') {
        expect(net.runUntil(() => net.now >= net.bus('p01').openAt)).toBe(true)
        const b = net.bus('p01')
        const guide = b.riders[b.guide].id
        const faces = rollFaces(TOYS, b, net.get(guide).sub, () => undefined, 'all', rand)!
        net.press(guide, { t: 'roll', faces })
        net.flush()
        if (during === 'ready') {
          net.press(guide, { t: 'pick', toy: faces[1] })
          net.flush()
        }
        expect(net.runUntil(() => net.bus('p03').phase === during, 5000, 10)).toBe(true)
      }
      net.run(1000, 10)
      const bo = () => net.bus('p01')
      expect(net.leaders()).toEqual(['p01'])
      expect(net.runUntil(() => net.now >= bo().stateAt + KNOBS.BEAT_MS - 200, 10_000, 10)).toBe(
        true,
      )
      expect(bo().phase).toBe(during)
      const seq = net.bus('p03').seq
      net.drop((_to, from) => from === 'p01')
      const silent = net.now
      const offered: string[] = []
      const watch = (until: number) => {
        while (net.now < until) {
          net.run(100, 100)
          for (const id of ['p02', 'p03'])
            if (canStart(net.bus(id), net.ctx(id))) offered.push(`${id}@${net.now - silent}`)
        }
      }
      watch(silent + 18_000 + lat)
      net.here.delete('p01')
      net.get('p01').listening = false
      watch(net.now + KNOBS.STALL_MS)
      expect(offered).toEqual([])
      expect(net.leaders()).toEqual(['p02'])
      /* and the tour moved on under Ann: a count on, heard by Cy */
      expect(net.bus('p03').seq).toBeGreaterThan(seq)
      expect(net.states('p02').some((e) => e.at > silent + 18_000)).toBe(true)
    })

  it('a state one count on keeps it; the same bus handed on at its count does not', () => {
    const net = crashed()
    const ann = net.bus('p02')
    const dee = net.bus('p04')
    expect(ann.seq).toBe(dee.seq)
    /* a second before the bound, Bo's copy handed on (a hello answered): Ann's count, so nothing */
    net.run(at(ann) - 1000 - net.now, 10)
    net.wire.push({ from: 'p01', m: wireOf(net.bus('p01'), net.here, net.now) })
    net.flush()
    expect(net.bus('p02').seq).toBe(ann.seq)
    net.run(1500, 10)
    expect(canStart(net.bus('p02'), net.ctx('p02'))).toBe(true)
    /* then a state of Dee's one count on — her beat, late — and the tour is driven again */
    net.wire.push({ from: 'p04', m: wireOf({ ...dee, seq: dee.seq + 1 }, net.here, net.now) })
    net.flush()
    expect(net.bus('p02').seq).toBe(dee.seq + 1)
    expect(canStart(net.bus('p02'), net.ctx('p02'))).toBe(false)
    net.run(KNOBS.STALL_MS - 1000, 100)
    expect(canStart(net.bus('p02'), net.ctx('p02'))).toBe(false)
    net.run(2000, 100)
    expect(canStart(net.bus('p02'), net.ctx('p02'))).toBe(true)
  })

  it('a state this browser refuses is not the tour heard: a stop it may never make keeps nothing standing', () => {
    /* an older build can still roll Gust (tour.ts's NEVER_A_STOP); every reader here refuses that
       state whole (readBus), so it never reaches the clock either */
    const net = crashed()
    const dee = net.bus('p04')
    const ann = net.bus('p02')
    net.run(at(ann) - 1000 - net.now, 10)
    const gust = {
      ...wireOf({ ...dee, seq: dee.seq + 1 }, net.here, net.now),
      phase: 'ready',
      toy: 'gust',
    }
    expect(readBus(JSON.parse(JSON.stringify(gust)))).toBeNull()
    net.run(1500, 10)
    expect(canStart(net.bus('p02'), net.ctx('p02'))).toBe(true)
  })

  it('never on the screen of the one deciding it, though it was given up while she was hidden', () => {
    /* Dee alone on the call and on her tour: hidden past ABANDON_MS, she gives it up on her own
       screen too — and back, with nobody to ask, she leads it after SYNC_MS and must not be
       offered Start, nor told it has stalled, on a tour she is moving along herself */
    const net = party(['p04'], { paced: true })
    net.run(2000)
    net.start('p04')
    net.flush()
    net.here.delete('p04')
    net.run(KNOBS.ABANDON_MS + 5000)
    net.here.add('p04')
    net.run(3000)
    const b = net.bus('p04')
    expect(leads(b, net.ctx('p04'))).toBe(true)
    expect(canStart(b, net.ctx('p04'))).toBe(false)
    expect(phaseLine(viewOfBus(net, 'p04'))?.text).not.toBe(STALLED)
  })

  it('a tour given up goes back only to whoever would drive it: a newcomer is never handed it', () => {
    /* Ann hosted with Dee riding, hopped off, and published that last — so she answers newcomers
       while she holds a live tour. Dee's page goes; past ABANDON_MS the tour is given up. Cy
       arrives: handed the dead tour, he would hold it without Start, and every holder hearing
       the answer would count it as heard of. Then Dee is back, and gets it back. */
    const net = party(ids, { paced: true })
    net.run(2000)
    net.start('p04')
    net.flush()
    rollAndPick(net, seeded(9))
    expect(net.runUntil(() => net.bus('p02').phase === 'ready')).toBe(true)
    net.ready('p02', true)
    net.flush()
    expect(net.runUntil(() => net.bus('p01').stops.length === 1, 30_000)).toBe(true)
    net.run(2000)
    net.press('p02', { t: 'off' })
    net.run(3000)
    expect(net.bus('p01').from).toBe('p02')
    net.roster.delete('p04')
    net.here.delete('p04')
    net.get('p04').listening = false
    net.run(KNOBS.ABANDON_MS + 2000)
    expect(canStart(net.bus('p02'), net.ctx('p02'))).toBe(true)
    const states = net.states().length
    net.join('p03')
    net.run(4000)
    expect(net.states().slice(states)).toEqual([])
    expect(holds(net.bus('p03'))).toBe(false)
    expect(canStart(net.bus('p03'), net.ctx('p03'))).toBe(true)
    net.join('p04')
    net.run(3000)
    expect(net.states().slice(states)[0]?.from).toBe('p01')
    expect(net.leaders()).toEqual(['p04'])
  })

  it('a hello answers everybody still asking: Dee’s first, Bo’s a moment after, both new pages', () => {
    /* Bo's link to Ann is slow, so Dee's hello reaches her first, while Bo — the lowest, the one
       to answer Dee — is here and has not asked yet. His hello makes Ann the one, and she answers
       Dee then, not at Dee's retry three seconds later */
    const net = party(ids, {
      paced: true,
      lat: (from, to) => (from === 'p01' && to === 'p02' ? 150 : 0),
    })
    net.run(2000)
    net.start('p04')
    net.flush()
    rollAndPick(net, seeded(41))
    expect(net.runUntil(() => ['p01', 'p02'].every((id) => net.bus(id).phase === 'ready'))).toBe(
      true,
    )
    for (const id of ['p04', 'p01']) {
      net.roster.delete(id)
      net.here.delete(id)
      net.get(id).listening = false
    }
    net.run(400)
    const states = net.states().length
    net.join('p04')
    net.join('p01')
    const back = net.now
    net.run(1000, 10)
    const answer = net.states().slice(states)[0]
    expect([answer?.from, answer && answer.at - back < 500]).toEqual(['p02', true])
    expect(net.leaders()).toEqual(['p04'])
  })
})

describe('the verify of 596d9b2d: every page that could drive a tour new at once, between stops', () => {
  /*
   * C: Dee (p04) starts and hosts, Eve (p05) boards at stop 1, Bo (p01) and Ann (p02) watch; in the
   * dwell Dee and Eve reload together. D: Bo starts and hosts, Ann and Dee board at stop 1; Bo and
   * Ann reload together. Both ways every page that could decide the tour is a new page holding
   * nothing, and on 596d9b2d nobody answered either: riders answered riders (room.ts's answersHello)
   * and the publisher, and both were the new pages. Between stops the tour's deadline is ten
   * minutes off, so the deadline's backstop left Bo and Ann (C), or Dee (D), with no Start and
   * nobody deciding at 3, 15, 40, 120 and 400 s, while the new pages were offered Start beside
   * them; pressing it moved the rest of the new pages to the new tour and left them behind. Now the
   * lowest here who holds it hands it back in about a round trip (answerers), and the page that
   * comes to decide it says so at once.
   */
  const gone = (net: Net, id: string) => {
    net.roster.delete(id)
    net.here.delete(id)
    net.get(id).listening = false
  }
  /** what each screen offers: Start, or the tour it holds and whether anybody live decides it */
  const panel = (net: Net, id: string) => {
    const b = net.bus(id)
    const line = holds(b) ? phaseLine(viewOfBus(net, id)) : null
    const start =
      canStart(b, net.ctx(id)) &&
      (!holds(b) || b.phase === 'end' || !!line?.buttons.some((x) => x.act === 'start'))
    if (start) return 'START'
    const deciders = net.leaders().filter((x) => net.bus(x).tour === b.tour)
    return `${b.tour} ${b.phase} s${b.stops.length} ${deciders.length ? `decided by ${deciders}` : 'NOBODY DECIDES'}`
  }
  /** every panel at 3, 15, 40, 120 and 400 s after `back` */
  const panels = (net: Net, ids: string[], back: number) => {
    const seen: string[] = []
    for (const after of [3000, 15_000, 40_000, 120_000, 400_000]) {
      net.run(back + after - net.now)
      for (const id of ids) seen.push(`${after / 1000}s ${id}: ${panel(net, id)}`)
    }
    return seen
  }
  /** from the moment the new pages are back: nobody offered Start, at any 100 ms, for `ms` */
  const never = (net: Net, ids: string[], ms: number) => {
    const offered: string[] = []
    const end = net.now + ms
    while (net.now < end) {
      net.run(100, 100)
      for (const id of ids) if (panel(net, id) === 'START') offered.push(`${id}@${net.now}`)
    }
    return offered
  }

  const shapeC = () => {
    const ids = ['p01', 'p02', 'p04', 'p05']
    const net = party(ids, { paced: true })
    net.run(2000)
    net.start('p04')
    net.flush()
    rollAndPick(net, seeded(5))
    expect(net.runUntil(() => net.bus('p05').phase === 'ready')).toBe(true)
    net.ready('p05', true)
    expect(net.runUntil(() => net.bus('p01').stops.length === 1, 30_000)).toBe(true)
    net.run(1000)
    expect(net.bus('p01').phase).toBe('pick')
    const tour = net.bus('p01').tour
    gone(net, 'p04')
    gone(net, 'p05')
    net.run(300)
    const states = net.states().length
    net.join('p04')
    net.join('p05')
    return { net, ids, tour, back: net.now, states }
  }
  for (const eve of [false, true])
    it(`C: both deciders reload at once in the dwell${eve ? ', and Eve goes to press Start' : ''}: nobody is left without a driver or Start`, () => {
      const { net, ids, tour, back, states } = shapeC()
      expect(never(net, ids, 3000)).toEqual([])
      /* handed back by Bo, the lowest here who holds it, within a round trip — one state — and
         Dee, deciding it now, says so at once */
      const after = net.states().slice(states)
      expect(after[0]?.from).toBe('p01')
      expect(after[0]!.at - back).toBeLessThan(KNOBS.SYNC_MS)
      expect(after[1]?.from).toBe('p04')
      expect(after[1]!.at - after[0]!.at).toBeLessThan(KNOBS.STATE_GAP_MS)
      if (eve) {
        expect(canStart(net.bus('p05'), net.ctx('p05'))).toBe(false)
        net.start('p05')
        net.flush()
      }
      const seen = panels(net, ids, back)
      expect(seen.filter((x) => /NOBODY DECIDES|START/.test(x))).toEqual([])
      expect(new Set(ids.map((id) => net.bus(id).tour))).toEqual(new Set([tour]))
      expect(net.leaders()).toEqual(['p04'])
    })

  for (const when of ['dwell', 'window'] as const)
    for (const starter of [null, 'p02'] as const)
      it(`D: in the ${when}, the two lowest riders reload at once${starter ? ', and Ann goes to press Start' : ''}: Dee is never left alone on it`, () => {
        const ids = ['p01', 'p02', 'p04']
        const net = party(ids, { paced: true })
        net.run(2000)
        net.start('p01')
        net.flush()
        rollAndPick(net, seeded(12))
        expect(net.runUntil(() => net.bus('p04').phase === 'ready')).toBe(true)
        net.ready('p02', true)
        net.ready('p04', true)
        expect(net.runUntil(() => net.bus('p04').stops.length === 1, 30_000)).toBe(true)
        net.run(1000)
        expect(
          net
            .bus('p04')
            .riders.filter((r) => r.on)
            .map((r) => r.id)
            .sort(),
        ).toEqual(['p01', 'p02', 'p04'])
        if (when === 'window') {
          rollAndPick(net, seeded(13))
          expect(net.runUntil(() => net.bus('p04').phase === 'ready', 60_000)).toBe(true)
        }
        const tour = net.bus('p04').tour
        gone(net, 'p01')
        gone(net, 'p02')
        net.run(300)
        const states = net.states().length
        net.join('p01')
        net.join('p02')
        const back = net.now
        expect(never(net, ids, 3000)).toEqual([])
        /* Dee hands it back — the only one here who holds it — and Bo, deciding it, says so */
        const after = net.states().slice(states)
        expect(after[0]?.from).toBe('p04')
        expect(after[0]!.at - back).toBeLessThan(KNOBS.SYNC_MS)
        expect(after[1]?.from).toBe('p01')
        if (starter) {
          expect(canStart(net.bus(starter), net.ctx(starter))).toBe(false)
          net.start(starter)
          net.flush()
        }
        const seen = panels(net, ids, back)
        expect(seen.filter((x) => /NOBODY DECIDES|START/.test(x))).toEqual([])
        expect(new Set(ids.map((id) => net.bus(id).tour))).toEqual(new Set([tour]))
        expect(net.leaders()).toEqual(['p01'])
        /* and no page that came back was counted going anywhere it did not press for */
        expect(net.landings.filter((l) => l.at >= back && l.id !== 'p04')).toEqual([])
      })

  it('the retry goes to the next one along: a crashed rider lower than everybody holding it', () => {
    /* the verify's seeds 42 and 52: Bo (p01) rides, and his page crashes — no bye, so he is on
       everybody's Lab until the party's sweep, first in the order to answer, and answering nobody.
       Dee's new page asks; on 596d9b2d both her hellos went to Bo, and she was offered Start for
       the 16–18 s his presence lingered. The retry goes to Ann (p02), HELLO_RETRY_MS later */
    const ids = ['p01', 'p02', 'p03', 'p04']
    const net = party(ids, { paced: true, lat: () => 100 })
    net.run(2000)
    net.start('p03')
    net.flush()
    rollAndPick(net, seeded(21))
    expect(net.runUntil(() => net.bus('p04').phase === 'ready')).toBe(true)
    for (const id of ['p01', 'p02', 'p04']) net.ready(id, true)
    expect(net.runUntil(() => net.bus('p04').stops.length === 1, 30_000)).toBe(true)
    net.run(1000)
    /* Bo crashes: still here and on the roster, his page deaf and dumb */
    net.get('p01').listening = false
    net.drop((_to, from) => from === 'p01')
    net.run(500)
    gone(net, 'p04')
    net.run(300)
    net.join('p04')
    const back = net.now
    let offered = 0
    while (!holds(net.bus('p04')) && net.now - back < 20_000) {
      net.run(100, 100)
      if (canStart(net.bus('p04'), net.ctx('p04'))) offered += 100
    }
    expect(holds(net.bus('p04'))).toBe(true)
    expect(net.now - back).toBeLessThanOrEqual(KNOBS.HELLO_RETRY_MS + 500)
    expect(offered).toBeLessThanOrEqual(KNOBS.HELLO_RETRY_MS - KNOBS.SYNC_MS + 500)
  })

  it('two crashed ahead take the hello and its retry: the sweep of either moves the order on, and the holder answers', () => {
    /* the property's seed 4364: Bo (p01, deciding) and Ann (p02) crash — no bye, both on
       everybody's Lab until the party's sweep, first and second in the order to answer — and Cy
       (p03) reloads. His hello goes to Bo, his retry to Ann, and he has no third. Dee (p04) holds
       the tour: the sweep of Bo moves the order on, and she answers the retry then (tick) */
    const ids = ['p01', 'p02', 'p03', 'p04']
    const net = party(ids, { paced: true, lat: () => 100 })
    net.run(2000)
    net.start('p01')
    net.flush()
    rollAndPick(net, seeded(23))
    expect(net.runUntil(() => net.bus('p04').phase === 'ready')).toBe(true)
    for (const id of ['p02', 'p03', 'p04']) net.ready(id, true)
    expect(net.runUntil(() => net.bus('p04').stops.length === 1, 30_000)).toBe(true)
    net.run(1000)
    const tour = net.bus('p04').tour
    for (const id of ['p01', 'p02']) {
      net.get(id).listening = false
      net.drop((_to, from) => from === id)
    }
    net.run(500)
    gone(net, 'p03')
    net.run(300)
    const from = net.log.length
    net.join('p03')
    net.run(KNOBS.HELLO_RETRY_MS + 2000)
    expect(hellos(net, 'p03', from)).toBe(2)
    expect(holds(net.bus('p03'))).toBe(false)
    /* Bo swept: Dee is the next one along for Cy's retry, and answers at once */
    net.here.delete('p01')
    const swept = net.now
    net.run(1000, 10)
    expect(net.bus('p03').tour).toBe(tour)
    const answer = net.states().find((e) => e.at >= swept)
    expect([answer?.from, answer && answer.at - swept < 200]).toEqual(['p04', true])
    expect(hellos(net, 'p03', from)).toBe(2)
  })

  it('a page that reloads and asks again is asking a retry, not a third answerer along', () => {
    /* Bo (p01), Ann (p02) and Dee (p04) ride; Ann's page has crashed (here, answering nobody). Bo's
       page asked twice and went unanswered, reloaded, and asks again: that is his retry, which is
       Dee's to answer — counted as a third hello it would go to a third answerer, and there is none */
    const ids = ['p01', 'p02', 'p04']
    const net = party(ids, { paced: true })
    net.run(2000)
    net.start('p01')
    net.flush()
    rollAndPick(net, seeded(12))
    expect(net.runUntil(() => net.bus('p04').phase === 'ready')).toBe(true)
    net.ready('p02', true)
    net.ready('p04', true)
    expect(net.runUntil(() => net.bus('p04').stops.length === 1, 30_000)).toBe(true)
    net.run(1000)
    const dee = { ...net.bus('p04'), askers: ['p01', 'p01'] }
    const hello = { v: 1, t: 'hello' } as const
    expect(receive(dee, net.ctx('p04'), 'p01', hello).out).toEqual([{ t: 'state' }])
    /* and its first hello is Ann's to answer, not Dee's */
    expect(receive({ ...dee, askers: [] }, net.ctx('p04'), 'p01', hello).out).toEqual([])
  })

  it('riders answer first: a watcher on an older build, lower than every rider, costs a returning rider nothing', () => {
    /* Bo (p01) watches on a build that answers no hello — 596d9b2d's watchers did not — and is the
       lowest here. Dee (p04) hosts with Ann (p02) riding; Dee reloads. A rider holds the tour and
       knows the bus, so Ann answers her at once; asked in id order, Bo would be first, answer
       nothing, and Dee would wait out HELLO_RETRY_MS offered Start */
    const ids = ['p01', 'p02', 'p04']
    const net = party(ids, { paced: true, lat: () => 100 })
    net.drop((to, _from, m) => to === 'p01' && m.t === 'hello')
    net.run(2000)
    net.start('p04')
    net.flush()
    rollAndPick(net, seeded(31))
    expect(net.runUntil(() => net.bus('p02').phase === 'ready')).toBe(true)
    net.ready('p02', true)
    expect(net.runUntil(() => net.bus('p01').stops.length === 1, 30_000)).toBe(true)
    net.run(1000)
    const tour = net.bus('p01').tour
    gone(net, 'p04')
    net.run(300)
    const states = net.states().length
    net.join('p04')
    const back = net.now
    expect(never(net, ids, 3000)).toEqual([])
    const answer = net.states().slice(states)[0]
    expect([answer?.from, answer && answer.at - back < KNOBS.SYNC_MS]).toEqual(['p02', true])
    expect(net.bus('p04').tour).toBe(tour)
    expect(net.leaders()).toEqual(['p02'])
  })

  it('a watcher handing the bus on at my count is not a new publisher; a rider at my count is', () => {
    /* two deciders for a moment publish at the same count, and the lower one's wins (`newer`) —
       but a watcher repeating the bus to a hello is not deciding anything, and taken as the one
       who published it, every yes would be asked again (askAgain) */
    const net = atTable(['p00'])
    /* Ann holds the bus as Cy published it; Bo rides, and the newcomer p00 watches */
    const b = { ...net.bus('p02'), from: 'p03' }
    const at = (from: string) =>
      receive(b, net.ctx('p02'), from, wireOf({ ...b, from }, net.here, net.now)).bus
    expect(b.riders.find((r) => r.id === 'p00')).toBeUndefined()
    expect([at('p00').from, at('p00').seq]).toEqual(['p03', b.seq])
    expect([at('p01').from, at('p01').seq]).toEqual(['p01', b.seq])
    /* and neither moves the clock that says somebody is driving it: the count did not move */
    expect([at('p00').stateAt, at('p01').stateAt]).toEqual([b.stateAt, b.stateAt])
  })
})

describe('no Start while somebody decides (the verify of 596d9b2d, kept as guards)', () => {
  const startable = (net: Net, id: string) => {
    const b = net.bus(id)
    const line = holds(b) ? phaseLine(viewOfBus(net, id)) : null
    return (
      canStart(b, net.ctx(id)) &&
      (!holds(b) || b.phase === 'end' || !!line?.buttons.some((x) => x.act === 'start'))
    )
  }
  /** run `ms` in 100 ms steps, noting anybody offered Start on a tour that is not over */
  const watch = (net: Net, ids: string[], ms: number, seen: string[]) => {
    const end = net.now + ms
    while (net.now < end) {
      net.run(100)
      for (const id of ids)
        if (holds(net.bus(id)) && net.bus(id).phase !== 'end' && startable(net, id))
          seen.push(`${net.now} ${id} offered Start on ${net.bus(id).tour}#${net.bus(id).seq}`)
    }
  }
  const ids = ['p01', 'p02', 'p04']
  for (const by of [-1500, -500])
    it(`a slow host: Dee rolls, and everything she sends arrives STALL_MS ${by} ms after the last state heard`, () => {
      /* the verify wrote this against the deadline's backstop (the dice's deadline + ABANDON_MS);
         the bound is STALL_MS of silence now, so the slowness runs to just short of that */
      let slowFrom = Infinity
      let slowTo = -Infinity
      let t = 0
      const net = party(ids, {
        paced: true,
        lat: (from) => (from === 'p04' && t >= slowFrom && t < slowTo ? slowTo - t + 150 : 150),
      })
      net.run(2000)
      net.start('p04')
      net.flush()
      net.runUntil(() => net.now >= net.bus('p04').openAt)
      const faces = rollFaces(
        TOYS,
        net.bus('p04'),
        net.get('p04').sub,
        () => undefined,
        'all',
        seeded(9),
      )!
      net.press('p04', { t: 'roll', faces })
      net.flush()
      expect(
        net.runUntil(() => ['p01', 'p02'].every((id) => net.bus(id).phase === 'choose'), 5000),
      ).toBe(true)
      t = net.now
      slowFrom = net.now
      slowTo = Math.min(net.bus('p01').stateAt, net.bus('p02').stateAt) + KNOBS.STALL_MS + by - 150
      const seen: string[] = []
      while (net.now < slowTo + 15_000) {
        t = net.now
        watch(net, ids, 100, seen)
      }
      expect(seen).toEqual([])
      expect(['p01', 'p02'].every((id) => ['ready', 'pick'].includes(net.bus(id).phase))).toBe(true)
    })
  it('a host in a hidden tab with a rider here: 15 s hidden in the window, nobody offered Start', () => {
    const net = party(['p01', 'p02', 'p04', 'p05'], { paced: true, lat: () => 150 })
    net.run(2000)
    net.start('p04')
    net.flush()
    rollAndPick(net, seeded(3))
    expect(net.runUntil(() => net.bus('p05').phase === 'ready')).toBe(true)
    net.ready('p05', true)
    expect(net.runUntil(() => net.bus('p01').stops.length === 1, 30_000)).toBe(true)
    const seen: string[] = []
    watch(net, ['p01', 'p02', 'p04', 'p05'], 1000, seen)
    /* Eve rolls stop 2 when it is her turn; Dee's tab is hidden as the window opens */
    expect(
      net.runUntil(
        () => net.bus('p05').phase === 'pick' && net.now >= net.bus('p05').openAt,
        60_000,
      ),
    ).toBe(true)
    const g = net.bus('p05').riders[net.bus('p05').guide].id
    const faces = rollFaces(TOYS, net.bus(g), net.get(g).sub, () => undefined, 'all', seeded(4))!
    net.press(g, { t: 'roll', faces })
    net.flush()
    net.press(g, { t: 'pick', toy: faces[1] })
    net.flush()
    net.here.delete('p04')
    watch(net, ['p01', 'p02', 'p05'], 15_000, seen)
    net.here.add('p04')
    watch(net, ['p01', 'p02', 'p04', 'p05'], 30_000, seen)
    expect(seen).toEqual([])
  })
  it('a long dwell: five minutes between stops with nobody rolling, nobody offered Start', () => {
    const net = party(['p01', 'p02', 'p04', 'p05'], {
      paced: true,
      lat: (a, b) => 100 + ((a.charCodeAt(2) * 7 + b.charCodeAt(2) * 13) % 60),
    })
    net.run(2000)
    net.start('p04')
    net.flush()
    rollAndPick(net, seeded(8))
    expect(net.runUntil(() => net.bus('p05').phase === 'ready')).toBe(true)
    net.ready('p05', true)
    expect(net.runUntil(() => net.bus('p01').stops.length === 1, 30_000)).toBe(true)
    const seen: string[] = []
    watch(net, ['p01', 'p02', 'p04', 'p05'], 300_000, seen)
    expect(seen).toEqual([])
    expect(net.bus('p01').phase).toBe('pick')
  })
})

describe('a party that does anything, in any order: nobody is left on a tour nobody can move', () => {
  /*
   * The property behind every case above. Three to five browsers on a paced party — each its own
   * Outbox, a link delay of 0–150 ms each, half the seeds at the dev call's pace — press whatever
   * their own screens offer (the phase line's buttons, the strip's Start and Hop off), reload,
   * leave and come back, hide their tabs, and reload two at once: the tour's decider and the
   * lowest id here. Gaps run 0–30 s, a third of them under 1.5 s so that presses race. Then
   * nothing, and two looks:
   *
   *   — once every window could have closed (CHOOSE_MS + READY_MS) and ABANDON_MS run, or the
   *     liveness bound (STALL_MS) if that is later: nobody is on a window or a roll nobody can
   *     close, unless Start is on their screen;
   *   — once every tour could have ended (TOUR_IDLE_MS more): every browser here either describes
   *     the one live tour somebody here moves along, or has Start on its screen.
   *
   * And throughout, the rule this protocol is built on: nobody moves who did not press, on that
   * page, for that toy — and the one browser that never presses anything never moves at all.
   */
  const SEEDS = 600
  /* a better stream than `seeded` for a sweep: mulberry32 */
  const stream = (seed: number) => {
    let a = seed >>> 0
    return () => {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  /** what a screen offers: the phase line's buttons, and the strip's Start and Hop off */
  const buttonsOf = (net: Net, id: string): BusButton[] => {
    const b = net.bus(id)
    const line = phaseLine(viewOfBus(net, id))?.buttons ?? []
    const strip: BusButton[] = []
    if (!holds(b) && canStart(b, net.ctx(id))) strip.push({ act: 'start', label: 'Start' })
    if (b.phase !== 'end' && b.riders.some((r) => r.id === id && r.on))
      strip.push({ act: 'off', label: 'Hop off' })
    return [...line, ...strip]
  }
  /** Start on this screen, and pressing it would start a tour */
  const offered = (net: Net, id: string) => {
    const b = net.bus(id)
    if (!canStart(b, net.ctx(id))) return false
    if (!holds(b) || b.phase === 'end') return true
    return buttonsOf(net, id).some((x) => x.act === 'start')
  }
  const live = (net: Net, id: string) => net.get(id).listening && net.ctx(id).meLive
  /** how often a person presses each button, given the chance */
  const WEIGHT: Record<BusButton['act'], number> = {
    take: 6,
    come: 3,
    face: 6,
    roll: 6,
    rollFor: 2,
    rollAnyway: 1,
    go: 2,
    fin: 3,
    finAnyway: 1,
    no: 1,
    stay: 1,
    off: 0.4,
    start: 2,
    another: 2,
    catchUp: 0,
    close: 0,
  }

  type Seen = { violations: string[]; stalls: number; actions: number; simulated: number }

  function ride(seed: number, opt: { quiet?: boolean } = {}): Seen {
    const r = stream(seed)
    const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
    const any = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]
    const n = int(3, 5)
    const ids = named(n)
    const watcher = ids[n - 1]
    const k = seed % 2 ? knobs(0.25) : KNOBS
    const delay = new Map<string, number>()
    const lat = (from: string, to: string) => {
      const key = `${from}>${to}`
      if (!delay.has(key)) delay.set(key, int(0, 150))
      return delay.get(key)!
    }
    const net = party(ids, { paced: true, k, lat })
    const v: string[] = []
    const gen = new Map(ids.map((id) => [id, 1]))
    /** the toys each page has pressed to go to: Take me there, Come too, the guide's own pick */
    const pressed = new Map(ids.map((id) => [id, new Set<string>()]))
    let landed = 0
    const away = new Map<string, number>()
    const hidden = new Map<string, number>()
    const goes = (id: string) => {
      net.roster.delete(id)
      net.here.delete(id)
      net.get(id).listening = false
      hidden.delete(id)
    }
    const comes = (id: string) => {
      net.join(id)
      gen.set(id, gen.get(id)! + 1)
      pressed.set(id, new Set())
    }
    const audit = () => {
      for (const l of net.landings.slice(landed))
        if (!pressed.get(l.id)!.has(l.toy) || l.id === watcher)
          v.push(`${l.id} moved to ${l.toy} at ${l.at} without pressing for it on that page`)
      landed = net.landings.length
    }
    /** the clock on to `until`, the page returns and the tabs shown again on their way */
    const advance = (until: number, step: number) => {
      while (net.now < until) {
        const next = Math.min(until, ...away.values(), ...hidden.values())
        if (next > net.now) net.run(next - net.now, step)
        audit()
        for (const [id, at] of [...away])
          if (at <= net.now) {
            away.delete(id)
            comes(id)
          }
        for (const [id, at] of [...hidden])
          if (at <= net.now) {
            hidden.delete(id)
            net.here.add(id)
          }
      }
    }
    const press = (id: string, btn: BusButton) => {
      const b = net.bus(id)
      switch (btn.act) {
        case 'start':
        case 'another':
          if (canStart(b, net.ctx(id))) net.start(id)
          return
        case 'roll':
        case 'rollFor':
        case 'rollAnyway': {
          const faces = rollFaces(TOYS, b, net.get(id).sub, () => undefined, 'all', r)
          if (faces)
            net.press(id, { t: 'roll', faces, ...(btn.act === 'rollAnyway' && { anyway: true }) })
          return
        }
        case 'face':
          pressed.get(id)!.add(btn.toy!)
          return net.press(id, { t: 'pick', toy: btn.toy! })
        case 'take':
        case 'come':
          pressed.get(id)!.add(btn.toy!)
          return net.press(id, { t: 'ready', on: true, n: btn.n!, toy: btn.toy! })
        case 'no':
        case 'stay':
          return net.press(id, { t: 'ready', on: false, n: btn.n!, toy: btn.toy! })
        case 'go':
          return net.press(id, { t: 'go' })
        case 'off':
          return net.press(id, { t: 'off' })
        case 'fin':
        case 'finAnyway':
          return net.press(id, { t: 'fin', ...(btn.act === 'finAnyway' && { anyway: true }) })
      }
    }

    /** a press somebody makes: mostly whatever moves the tour along, now and then anything */
    const pick = (offer: { id: string; btn: BusButton }[]) => {
      const total = offer.reduce((t, o) => t + WEIGHT[o.btn.act], 0)
      let x = r() * total
      for (const o of offer) if ((x -= WEIGHT[o.btn.act]) < 0) return o
      return offer[offer.length - 1]
    }

    advance(2000, 100)
    net.start(any(ids.filter((id) => id !== watcher)))
    net.flush()
    const actions = int(15, 40)
    for (let a = 0; a < actions; a++) {
      advance(net.now + (r() < 1 / 3 ? int(0, 1500) : int(0, 30_000)), 100)
      const here = ids.filter((id) => net.get(id).listening && !away.has(id))
      if (!here.length) continue
      const roll = r()
      if (roll < 0.6) {
        const offer = here
          .filter((id) => live(net, id))
          .flatMap((id) =>
            buttonsOf(net, id)
              .filter((btn) => id !== watcher || btn.act === 'start' || btn.act === 'another')
              .map((btn) => ({ id, btn })),
          )
        if (offer.length) {
          const o = pick(offer)
          press(o.id, o.btn)
        }
      } else if (roll < 0.7) {
        const id = any(here)
        goes(id)
        away.set(id, net.now + int(100, 3000))
      } else if (roll < 0.76) {
        const id = any(here)
        goes(id)
        away.set(id, net.now + int(3000, 45_000))
      } else if (roll < 0.84) {
        /* the one deciding (or the host as everybody reckons it) and the lowest id here, at once */
        const decider = net.leaders()[0] ?? hostOf(net.bus(here[0]), net.ctx(here[0]))
        const lowest = [...here].sort()[0]
        for (const id of new Set([decider ?? lowest, lowest]))
          if (net.get(id).listening && !away.has(id)) {
            goes(id)
            away.set(id, net.now + int(100, 3000))
          }
      } else if (roll < 0.93) {
        const id = any(here.filter((x) => !hidden.has(x)))
        if (!id) continue
        net.here.delete(id)
        hidden.set(id, net.now + int(300, 30_000))
      } else {
        const id = any(here)
        if (live(net, id) && offered(net, id)) net.start(id)
      }
      net.flush()
    }
    /* the last page back and the last tab shown are the last things that happen */
    advance(Math.max(net.now, ...away.values(), ...hidden.values()), 100)
    const quiet = net.now
    const windows =
      quiet +
      Math.max(k.CHOOSE_MS + k.READY_MS + 2 * k.STATE_GAP_MS + k.ABANDON_MS, k.STALL_MS) +
      5000
    advance(windows, 250)
    let stalls = 0
    for (const id of ids) {
      if (!live(net, id)) continue
      const b = net.bus(id)
      if (holds(b) && (b.phase === 'ready' || b.phase === 'choose')) {
        if (offered(net, id)) stalls++
        else
          v.push(`${id} on a ${b.phase} nobody closes at ${net.now}: ${JSON.stringify(shape(b))}`)
      }
      if (buttonsOf(net, id).some((x) => x.act === 'start') && !canStart(b, net.ctx(id)))
        v.push(`${id} shows a Start that would do nothing`)
    }
    advance(windows + k.TOUR_IDLE_MS + k.CHOOSE_MS + k.READY_MS + k.ABANDON_MS + 5000, 1000)
    const here = ids.filter((id) => live(net, id))
    const riding = here.filter((id) => !offered(net, id))
    const tours = new Set(riding.map((id) => net.bus(id).tour))
    if (tours.size > 1) v.push(`two tours at the end: ${[...tours]}`)
    for (const id of riding) {
      const b = net.bus(id)
      const moving = net.leaders().some((x) => net.bus(x).tour === b.tour)
      if (!holds(b) || b.phase === 'end' || !moving)
        v.push(`${id} at the end: no Start, and ${JSON.stringify(shape(b))} with nobody moving it`)
    }
    if (riding.length && !net.agree(riding)) v.push(`the riders disagree at the end`)
    if (!opt.quiet && v.length)
      v.unshift(`seed ${seed}: ${n} browsers, pace ${seed % 2 ? 0.25 : 1}`)
    return { violations: v, stalls, actions, simulated: net.now }
  }
  const shape = (b: Bus) => ({
    tour: b.tour,
    seq: b.seq,
    phase: b.phase,
    due: Math.round(b.due),
    riders: b.riders.map((x) => `${x.id}${x.on ? '' : '-'}`),
    stops: b.stops.length,
  })

  for (let chunk = 0; chunk < SEEDS / 100; chunk++)
    it(`seeds ${chunk * 100 + 1}–${chunk * 100 + 100}: every screen can move on`, () => {
      const bad: string[] = []
      for (let seed = chunk * 100 + 1; seed <= chunk * 100 + 100; seed++)
        bad.push(...ride(seed).violations.slice(0, 4))
      expect(bad).toEqual([])
    })
})

describe('a stray tour does not answer a hello for another (askers)', () => {
  /* ⚠️ A HOLDER FORGOT WHO WAS ASKING ON HEARING ANY STATE, including a stray tour's that it ignored
     as weaker — so when who is here changed, it had nobody left to hand its own tour back to. The
     shape the verify found: Ann's page crashes and lingers until the sweep, so she is first in Cy's
     answering order for both hellos; Bo and Dee reload together; Dee presses the Start she is
     offered inside the retry's gap, and Bo's new page takes that tour. Once Ann is swept, the four
     riders' tour must be back on every screen still here, with somebody deciding it */
  for (const hopOff of [true, false])
    it(`Dee's press in the retry's gap${hopOff ? ', then Hop off,' : ''} does not lose the four riders' tour`, () => {
      const ids = ['p01', 'p02', 'p03', 'p04']
      const net = party(ids, { paced: true, lat: () => 150 })
      net.run(2000)
      net.start('p01')
      net.flush()
      rollAndPick(net, seeded(5))
      expect(net.runUntil(() => net.bus('p04').phase === 'ready')).toBe(true)
      for (const id of ['p02', 'p03', 'p04']) net.ready(id, true)
      expect(net.runUntil(() => net.bus('p03').stops.length === 1, 30_000)).toBe(true)
      net.run(2000)
      const tour = net.bus('p03').tour
      expect(
        net
          .bus('p03')
          .riders.filter((r) => r.on)
          .map((r) => r.id)
          .sort(),
      ).toEqual(ids)
      /* Ann's page crashes: no bye, so she stays on everybody's Lab and roster until the sweep */
      net.get('p02').listening = false
      net.run(500)
      for (const id of ['p01', 'p04']) {
        net.roster.delete(id)
        net.here.delete(id)
        net.get(id).listening = false
      }
      net.run(300)
      net.join('p01')
      net.join('p04')
      const back = net.now
      net.run(2500)
      /* the gap itself is documented and left (Evan's call): Start is offered here */
      expect(canStart(net.bus('p04'), net.ctx('p04'))).toBe(true)
      net.start('p04')
      net.flush()
      if (hopOff) {
        net.run(300)
        net.press('p04', { t: 'off' })
        net.flush()
      }
      /* the party's sweep takes Ann off everybody's Lab */
      net.run(back + 17_000 - net.now)
      net.here.delete('p02')
      net.run(back + 25_000 - net.now)
      for (const id of ['p01', 'p03', 'p04']) {
        expect([id, net.bus(id).tour, net.bus(id).phase !== 'end']).toEqual([id, tour, true])
        expect(net.leaders().filter((x) => net.bus(x).tour === tour)).not.toEqual([])
      }
    })
})

describe('a hello once answered stays answered (askers)', () => {
  /* ⚠️ EVERY SCREEN HOLDING THE TOUR KEEPS WHO IS ASKING, AND ANSWERS FROM THAT LIST WHEN THE ORDER
     MOVES. So the list must empty on every screen once the tour has been heard — handed back at its
     count, or moved on in the same second — or the next screen in line answers a page that already
     has its tour, at each change of who is here, and the page left on the list is passed over as
     an answerer by everybody but itself */
  const setUp = () => {
    const ids = ['p01', 'p02', 'p03', 'p04']
    const net = party(ids, { paced: true, lat: () => 150 })
    net.run(2000)
    net.start('p01')
    net.flush()
    rollAndPick(net, seeded(5))
    expect(net.runUntil(() => net.bus('p04').phase === 'ready')).toBe(true)
    return net
  }
  /* the one who answered goes; nobody else hands the page its tour again */
  const quietAfter = (net: Net) => {
    const tour = net.bus('p01').tour
    expect(net.bus('p05').tour).toBe(tour)
    const held = net.bus('p03').seq
    expect(net.bus('p02').seq).toBe(held)
    const from = net.log.length
    for (const id of ['p01']) {
      net.roster.delete(id)
      net.here.delete(id)
      net.get(id).listening = false
    }
    net.run(1000)
    const again = net.log.slice(from).filter((e) => e.m.t === 'state' && e.m.seq === held)
    expect(again.map((e) => e.from)).toEqual([])
  }
  it('handed back at its count, by the screen that published it', () => {
    const net = setUp()
    /* just after the host's last state, so the hand-back cannot fold into a count that moves */
    const n = net.log.length
    expect(net.runUntil(() => net.log.slice(n).some((e) => e.m.t === 'state'), 10_000)).toBe(true)
    net.run(200)
    net.join('p05')
    net.run(1500)
    quietAfter(net)
  })
  it('answered by the tour moving on in the same second', () => {
    const net = setUp()
    net.run(3000)
    net.join('p05')
    net.ready('p02', true)
    net.run(1500)
    quietAfter(net)
  })
})
