import { describe, expect, it } from 'vitest'
import {
  abandoned,
  ask,
  canStart,
  consentAfter,
  holds,
  hopPlan,
  hostSet,
  knobs,
  leads,
  listen,
  outbox,
  readBus,
  receive,
  rideStep,
  rollFaces,
  stalled,
  startTour,
  tick,
  windowGone,
  wireOf,
  type Bus,
  type Consent,
  type Ctx,
  type Knobs,
  type Msg,
  type Outbox,
  type Press,
  type Step,
} from './bus'
import { phaseLine, type BusButton, type View } from './busWords'
import { ROOM_TOYS } from './tour'

/*
 * THE LIVENESS BOUND, ASKED OF A PARTY THAT DOES ANYTHING — each browser seeing the call its own
 * way. bus.test.ts's "a party that does anything" shares one list of who is here among every
 * browser; the independent verify of 596d9b2d wrote this one from the pure module's exports alone,
 * and it found what that one could not. Its model is kept, its looks are made continuous, and three
 * things are added (the last three below) without which the answering rules closed every shape it
 * made before the clock mattered — so the clock itself, judged by `due` again, passed:
 *
 *  - presence is PER OBSERVER and travels the wire: the party's `here`, `gone` and the call's beat
 *    and `bye` share each link's FIFO with the bus's own messages. A crashed page sends nothing and
 *    is swept by each browser on its own clock (16 s stale, a 2 s sweep), and stays on the call's
 *    roster, as the dev call keeps it until a `bye`; a hidden tab says `gone` and keeps listening;
 *    the call and the party each answer a newcomer at once (labCall.ts, party.ts);
 *  - every link has its own delay of 0–150 ms and 0–40 ms of jitter, in order on its link, and a
 *    message to a page that has since reloaded is lost;
 *  - besides reloads, crashes, hidden tabs and leaving the call, the decider crashes, or leaves the
 *    call for longer than ABANDON_MS — alone on its tour, given up on every screen — and comes back;
 *  - a page presses only what its own phase line, or the strip's Start, offers it, and a friend told
 *    the bus has stalled mostly waits a while before starting another;
 *  - in a third of the parties one friend is on an older build: a watcher that holds the tour,
 *    presses nothing and answers no hello, so the answering rules can miss and the bound must hold
 *    by itself.
 *
 * And at every sample, in every phase — a window, a roll, between stops:
 *
 *  STUCK   no browser here holds a tour that is not over, with no Start on its screen and nobody
 *          here deciding that tour, for longer than THE BOUND, thirty seconds, and a margin for
 *          one wire and one sample;
 *  RETURN  no browser here is offered Start for longer than HELLO_RETRY_MS, and a margin, while a
 *          friend it sees here, on this build, holds a tour it rides and could hand it — one not
 *          given up there, or one this browser would drive — or, while that friend sees two or
 *          more pages here that cannot answer (crashed and lingering, or the older build), for
 *          longer than the party's sweep;
 *  EAGER   no screen gives a tour up while somebody here decides it;
 *  TAKE    a screen that has given its tour up takes the next state of any other tour;
 *  MOVED   nobody hops anywhere without a press for that tour, departure and toy on that page;
 *  GUST    nothing anywhere names Gust, a toy no tour may stop at;
 *  END     once every tour could have ended, every browser here is offered Start.
 */

const PLAIN = ['swarm', 'paint', 'aurora', 'tides', 'boids', 'mandala', 'orbit', 'ripple', 'gust']
const ROLLABLE = [...ROOM_TOYS, ...PLAIN]
const KIND = (id: string) => (ROOM_TOYS.has(id) ? 'board' : 'arcade')

/** THE BOUND, as the claim says it: no screen waits longer than this for a tour nobody drives */
const BOUND_MS = 30_000
/** one wire at its slowest, a sample, and a tick */
const MARGIN_MS = 1000
/** one hello and its retry, then a round trip */
const RETURN_MS = 3000 + MARGIN_MS
/** the party's sweep: `here` stale after 16 s, swept every 2 s (party.ts) */
const HERE_STALE_MS = 16_000
const SWEEP_MS = HERE_STALE_MS + 2000

/** xorshift32, so a seed is the same party every run */
function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1
  return () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 4294967296
  }
}

type Hop = { at: number; key: string; tour: string; toy: string; n: number; asked: number }
type Page = {
  id: string
  gen: number
  bus: Bus
  box: Outbox
  consent: Consent
  hop: Hop | null
  moved: Set<string>
  planned: Set<string>
  sub: string
  visible: boolean
  alive: boolean
  inCall: boolean
  /** when each friend's `here` last reached this page */
  seen: Map<string, number>
  subs: Map<string, string>
  roster: Set<string>
  presses: Set<string>
  filter: string
  beatAt: number
  hereAt: number
  sweepAt: number
  /** bumped whenever anything this page's Ctx is made from changes, so a Ctx is made once a step */
  ver: number
  cache: { now: number; ver: number; ctx: Ctx } | null
}
type Kind = 'beat' | 'here' | 'gone' | 'bye' | 'bus'
type Wire = {
  at: number
  n: number
  to: string
  gen: number
  from: string
  kind: Kind
  body?: unknown
  sub?: string
}

/** the wire in flight, earliest first: a binary heap on (at, n) */
function heap() {
  const xs: Wire[] = []
  const less = (a: Wire, b: Wire) => a.at < b.at || (a.at === b.at && a.n < b.n)
  return {
    push(w: Wire) {
      xs.push(w)
      let i = xs.length - 1
      while (i > 0) {
        const up = (i - 1) >> 1
        if (!less(xs[i], xs[up])) break
        ;[xs[i], xs[up]] = [xs[up], xs[i]]
        i = up
      }
    },
    /** the earliest due by `now`, or null */
    pop(now: number): Wire | null {
      if (!xs.length || xs[0].at > now) return null
      const top = xs[0]
      const last = xs.pop()!
      if (xs.length) {
        xs[0] = last
        let i = 0
        for (;;) {
          const l = 2 * i + 1
          const r = l + 1
          let m = i
          if (l < xs.length && less(xs[l], xs[m])) m = l
          if (r < xs.length && less(xs[r], xs[m])) m = r
          if (m === i) break
          ;[xs[i], xs[m]] = [xs[m], xs[i]]
          i = m
        }
      }
      return top
    },
  }
}

export type Report = {
  seed: number
  pace: number
  n: number
  stuck: string[]
  ret: string[]
  eager: string[]
  take: string[]
  moved: string[]
  gust: string[]
  end: string[]
  /** the longest any browser here waited with no driver and no Start, and with Start beside a friend holding its tour */
  maxStuck: number
  maxReturn: number
  events: string[]
}

export function simulate(
  seed: number,
  opt: { pace?: number; n?: number; trace?: boolean } = {},
): Report {
  const R = rng(seed)
  const pace = opt.pace ?? (R() < 0.5 ? 0.25 : 1)
  const k: Knobs = knobs(pace)
  const n = opt.n ?? 3 + Math.floor(R() * 3)
  const names = ['p01', 'p02', 'p03', 'p04', 'p05', 'p06'].slice(0, n)
  const extra = 'p00'
  /* a third of the parties have a friend on an older build: a watcher that holds the tour, presses
     nothing and answers no hello (as 596d9b2d's watchers did not), so the answering rules can miss
     and the bound has to hold on its own */
  const mute = R() < 1 / 3 ? names[Math.floor(R() * n)] : null
  const rep: Report = {
    seed,
    pace,
    n,
    stuck: [],
    ret: [],
    eager: [],
    take: [],
    moved: [],
    gust: [],
    end: [],
    maxStuck: 0,
    maxReturn: 0,
    events: [],
  }
  if (mute) rep.events.push(`${mute} is on an older build: it presses nothing and answers no hello`)
  const secs = (t: number) => (t / 1000).toFixed(2)
  let now = 0
  let wn = 0
  let tours = 0
  const wire = heap()
  const linkAt = new Map<string, number>()
  const base = new Map<string, number>()
  const lat = (a: string, b: string) => {
    const key = `${a}>${b}`
    if (!base.has(key)) base.set(key, Math.floor(R() * 151))
    return base.get(key)! + Math.floor(R() * 41)
  }
  const pages = new Map<string, Page>()
  const gens = new Map<string, number>()
  const ev = (s: string) => {
    if (rep.events.length < (opt.trace ? 5000 : 300)) rep.events.push(`${secs(now)} ${s}`)
  }

  const send = (from: Page, kind: Kind, body?: unknown) => {
    /* a bus message crosses the wire as JSON once, and each page reads it back (readBus) */
    const copy = body === undefined ? undefined : JSON.parse(JSON.stringify(body))
    for (const to of pages.values()) {
      if (to.id === from.id || !to.alive || !to.inCall) continue
      const link = `${from.id}>${to.id}`
      const at = Math.max(linkAt.get(link) ?? -Infinity, now + lat(from.id, to.id))
      linkAt.set(link, at)
      wire.push({
        at,
        n: wn++,
        to: to.id,
        gen: to.gen,
        from: from.id,
        kind,
        body: copy,
        sub: from.sub,
      })
    }
  }
  const meLive = (p: Page) => p.alive && p.inCall && p.visible
  const presentOf = (p: Page) => {
    const s = new Set<string>()
    for (const [id, at] of p.seen) if (now - at < HERE_STALE_MS) s.add(id)
    if (meLive(p)) s.add(p.id)
    return s as ReadonlySet<string>
  }
  const ctx = (p: Page): Ctx => {
    if (p.cache?.now === now && p.cache.ver === p.ver) return p.cache.ctx
    const present = presentOf(p)
    const roster = new Set([...p.roster, p.id]) as ReadonlySet<string>
    const c: Ctx = {
      now,
      present,
      roster,
      meLive: meLive(p),
      subOf: (x) => (!present.has(x) ? null : x === p.id ? p.sub : (p.subs.get(x) ?? null)),
      people: roster.size,
      k,
    }
    p.cache = { now, ver: p.ver, ctx: c }
    return c
  }
  const viewOf = (p: Page, c = ctx(p)): View => ({
    bus: p.bus,
    now,
    k,
    name: (i) => i,
    toy: (t) => t,
    title: (t) => t,
    roster: c.roster,
    present: c.present,
    subOf: c.subOf,
    myToy: p.sub,
    seated: false,
    inMatch: false,
    consent: p.consent,
    hopAt: p.hop?.at ?? null,
    people: c.people,
  })
  const gustIn = (b: Bus) =>
    b.toy === 'gust' || !!b.faces?.includes('gust') || b.stops.some((s) => s.toy === 'gust')
  const plan = (p: Page) => {
    const b = p.bus
    const c = ctx(p)
    const nn = b.stops.length
    if (!holds(b)) return
    const key = `${b.tour}:${nn}`
    if (p.hop?.key === key && p.consent?.come) {
      const again = hopPlan(b, p.hop.asked, p.consent, c.people, p.moved)
      if (again?.do === 'hop') p.hop = { ...p.hop, at: again.at }
    }
    if (!nn || p.planned.has(key)) return
    p.planned.add(key)
    const pl = hopPlan(b, now, p.consent, c.people, p.moved)
    if (pl?.do === 'hop')
      p.hop = { at: pl.at, key, tour: b.tour, toy: b.stops[nn - 1].toy, n: nn, asked: now }
  }
  const apply = (p: Page, s: Step) => {
    const prev = p.bus
    p.bus = s.bus
    for (const o of s.out) p.box.push(o)
    if (prev === p.bus) return
    if (
      opt.trace &&
      (prev.tour !== p.bus.tour || prev.seq !== p.bus.seq || prev.phase !== p.bus.phase)
    )
      ev(
        `  ${p.id}#${p.gen} holds ${p.bus.tour || '-'}#${p.bus.seq}/${p.bus.phase} from ${p.bus.from}`,
      )
    if (gustIn(p.bus) && rep.gust.length < 5) rep.gust.push(`${secs(now)} ${p.id} holds gust`)
    if (windowGone(prev, p.bus, p.consent)) p.consent = null
    plan(p)
  }
  const newPage = (id: string, sub: string) => {
    const gen = (gens.get(id) ?? 0) + 1
    gens.set(id, gen)
    const p: Page = {
      id,
      gen,
      bus: listen(id, now),
      box: outbox(k),
      consent: null,
      hop: null,
      moved: new Set(),
      planned: new Set(),
      sub,
      visible: true,
      alive: true,
      inCall: true,
      seen: new Map(),
      subs: new Map(),
      roster: new Set(),
      presses: new Set(),
      filter: R() < 0.5 ? 'all' : 'arcade',
      beatAt: now,
      hereAt: now,
      sweepAt: now + Math.floor(R() * 2000),
      ver: 0,
      cache: null,
    }
    pages.set(id, p)
    /* arriving: the call's hello, the party's where, then the bus listens */
    send(p, 'beat')
    send(p, 'here')
    return p
  }
  const homes = new Map<string, string>()
  for (const id of [...names, extra]) homes.set(id, PLAIN[Math.floor(R() * 8)])
  for (const id of names) newPage(id, homes.get(id)!)

  const deliver = (w: Wire) => {
    const p = pages.get(w.to)
    if (!p || p.gen !== w.gen || !p.alive || !p.inCall) return
    switch (w.kind) {
      case 'beat': {
        /* the dev call answers a newcomer at once (labCall.ts) */
        if (p.roster.has(w.from)) return
        p.roster.add(w.from)
        p.ver++
        send(p, 'beat')
        return
      }
      case 'here': {
        /* the party answers somebody heard for the first time at once (party.ts) */
        const was = p.seen.get(w.from)
        const isNew = was === undefined
        if (isNew || now - was >= HERE_STALE_MS || !p.roster.has(w.from)) p.ver++
        if (w.sub && p.subs.get(w.from) !== w.sub) p.ver++
        p.roster.add(w.from)
        p.seen.set(w.from, now)
        if (w.sub) p.subs.set(w.from, w.sub)
        if (isNew && p.visible) send(p, 'here')
        return
      }
      case 'gone':
        p.seen.delete(w.from)
        p.ver++
        return
      case 'bye':
        p.roster.delete(w.from)
        p.seen.delete(w.from)
        p.ver++
        return
      case 'bus': {
        if (p.id === mute && (w.body as { t?: string } | undefined)?.t === 'hello') return
        const m = readBus(w.body)
        if (!m) {
          if (rep.gust.length < 5)
            rep.gust.push(`${secs(now)} ${p.id} refused a message from ${w.from}`)
          return
        }
        const before = p.bus
        const dead = holds(before) && before.phase !== 'end' && abandoned(before, ctx(p))
        apply(p, receive(p.bus, ctx(p), w.from, m as Msg))
        if (
          m.t === 'state' &&
          dead &&
          m.tour !== before.tour &&
          m.phase !== 'end' &&
          p.bus.tour !== m.tour &&
          rep.take.length < 5
        )
          rep.take.push(
            `${secs(now)} ${p.id} gave up ${before.tour}#${before.seq} and ignored ${m.tour}#${m.seq}/${m.phase} from ${w.from}`,
          )
      }
    }
  }
  const pump = () => {
    for (const p of pages.values()) {
      if (!meLive(p)) continue
      for (const o of p.box.take(now)) {
        const m = o.t === 'state' ? wireOf(p.bus, ctx(p).present, now) : o
        if (opt.trace)
          ev(
            `${p.id}#${p.gen} > ${m.t}${m.t === 'state' ? ` ${m.tour}#${m.seq}/${m.phase}/s${m.stops.length} [${m.riders.map((r) => r[0] + (r[1] ? '' : '-'))}]` : 'tour' in m ? ` ${m.tour}` : ''}`,
          )
        send(p, 'bus', m)
      }
    }
  }
  const flush = () => {
    for (let guard = 0; guard < 100_000; guard++) {
      const w = wire.pop(now)
      if (!w) return
      deliver(w)
      pump()
    }
  }
  const hops = () => {
    for (const p of pages.values()) {
      const h = p.hop
      if (!h || now < h.at || !p.alive) continue
      p.hop = null
      const r = rideStep({
        consent: p.consent,
        tour: h.tour,
        n: h.n,
        toy: h.toy,
        myToy: p.sub,
        openable: true,
        gateOpen: true,
        sharing: true,
        visible: p.visible,
        onLab: true,
        heldSeat: null,
        inMatch: false,
        moved: p.moved,
      })
      if (r.do === 'with') p.moved.add(h.key)
      if (r.do !== 'go') continue
      if (!p.presses.has(`${h.tour}:${h.n}:${r.toy}`) && rep.moved.length < 5)
        rep.moved.push(
          `${secs(now)} ${p.id} moved to ${r.toy} (${h.tour}:${h.n}) without a press on this page`,
        )
      if (r.toy === 'gust' && rep.gust.length < 5)
        rep.gust.push(`${secs(now)} ${p.id} landed on gust`)
      p.moved.add(h.key)
      p.sub = r.toy
      p.ver++
      send(p, 'here')
    }
  }
  /** Start on this screen, and pressing it would start a tour */
  const startOn = (p: Page, c = ctx(p)) => {
    if (!canStart(p.bus, c)) return false
    if (!holds(p.bus) || p.bus.phase === 'end') return true
    return !!phaseLine(viewOf(p, c))?.buttons.some((x) => x.act === 'start' || x.act === 'another')
  }
  const press = (p: Page, b: BusButton) => {
    const c = ctx(p)
    if (b.act === 'start' || b.act === 'another') {
      if (!canStart(p.bus, c)) return
      tours++
      p.consent = null
      p.hop = null
      ev(`${p.id} Start t${tours}`)
      apply(p, startTour(p.bus, c, `t${String(tours).padStart(7, '0')}`))
      return
    }
    let q: Press | null = null
    switch (b.act) {
      case 'roll':
      case 'rollFor':
      case 'rollAnyway': {
        const faces = rollFaces(ROLLABLE, p.bus, p.sub, KIND, p.filter, R)
        if (!faces) return
        if (faces.includes('gust') && rep.gust.length < 5)
          rep.gust.push(`${secs(now)} ${p.id} rolled gust`)
        q = { t: 'roll', faces, ...(b.act === 'rollAnyway' && { anyway: true }) }
        break
      }
      case 'face':
        q = b.toy ? { t: 'pick', toy: b.toy } : null
        break
      case 'take':
      case 'come':
        if (!b.toy || b.n === undefined) return
        q = { t: 'ready', on: true, n: b.n, toy: b.toy }
        p.presses.add(`${p.bus.tour}:${b.n}:${b.toy}`)
        break
      case 'no':
      case 'stay':
        if (!b.toy || b.n === undefined) return
        q = { t: 'ready', on: false, n: b.n, toy: b.toy }
        break
      case 'go':
        q = { t: 'go' }
        break
      case 'off':
        q = { t: 'off' }
        break
      case 'fin':
      case 'finAnyway':
        q = { t: 'fin', ...(b.act === 'finAnyway' && { anyway: true }) }
        break
      default:
        return
    }
    if (!q) return
    /* the guide's pick is a yes too (consentAfter): a press of the face on this page */
    if (q.t === 'pick') p.presses.add(`${p.bus.tour}:${p.bus.stops.length + 1}:${q.toy}`)
    p.consent = consentAfter(p.consent, p.bus, c, q, null)
    apply(p, ask(p.bus, c, q))
    if (q.t === 'ready' && p.consent?.come) {
      const pl = hopPlan(p.bus, now, p.consent, c.people, p.moved)
      if (pl?.do === 'hop')
        p.hop = {
          at: pl.at,
          key: pl.key,
          tour: p.consent.tour,
          toy: p.consent.toy,
          n: p.consent.n,
          asked: now,
        }
    }
  }
  /** answers and rolls often, leaving and starting rarely */
  const WEIGHT: Partial<Record<BusButton['act'], number>> = {
    take: 6,
    come: 2,
    face: 6,
    roll: 6,
    rollFor: 2,
    rollAnyway: 1,
    go: 3,
    no: 1,
    stay: 1,
    off: 0.4,
    fin: 3,
    finAnyway: 1,
    start: 1.2,
    another: 1.2,
  }
  const randomPress = (p: Page) => {
    const c = ctx(p)
    const opts: BusButton[] = holds(p.bus) ? [...(phaseLine(viewOf(p, c))?.buttons ?? [])] : []
    if (startOn(p, c) && !opts.some((x) => x.act === 'start' || x.act === 'another'))
      opts.push({ act: 'start', label: 'Start' })
    const useful = opts.filter((x) => x.act !== 'close' && x.act !== 'catchUp')
    if (!useful.length) return
    /* a friend told the bus has stalled, or that nobody on it is here, mostly waits a while for it
       to come back before starting another — so a tour given up stays on screens to be handed back */
    const given = holds(p.bus) && p.bus.phase !== 'end' && abandoned(p.bus, c)
    const w = (x: BusButton) => (given && x.act === 'start' ? 0.25 : 1) * (WEIGHT[x.act] ?? 0.5)
    if (given && useful.every((x) => x.act === 'start') && R() < 0.75) return
    let r = R() * useful.reduce((s, x) => s + w(x), 0)
    for (const x of useful) {
      r -= w(x)
      if (r <= 0) return press(p, x)
    }
  }
  const step = () => {
    for (const p of pages.values()) {
      if (!p.alive || !p.inCall) continue
      if (now >= p.beatAt + 1000) {
        p.beatAt = now
        send(p, 'beat')
      }
      if (p.visible && now >= p.hereAt + 5000) {
        p.hereAt = now
        send(p, 'here')
      }
      if (now >= p.sweepAt + 2000) {
        p.sweepAt = now
        for (const [id, at] of p.seen)
          if (now - at >= HERE_STALE_MS) {
            p.seen.delete(id)
            p.ver++
          }
      }
      apply(p, tick(p.bus, ctx(p)))
    }
    pump()
    flush()
    hops()
    flush()
  }

  /* ── disturbances ── */
  const live = () => [...pages.values()].filter((p) => p.alive && p.inCall)
  const bye = (p: Page) => {
    send(p, 'gone')
    send(p, 'bye')
    p.inCall = false
    p.alive = false
    p.ver++
  }
  let later: { at: number; fn: () => void }[] = []
  const after = (ms: number, fn: () => void) => later.push({ at: now + ms, fn })
  const back = (p: Page) => () => {
    if (pages.get(p.id) === p) newPage(p.id, p.sub)
  }
  const reload = (p: Page, ms: number) => {
    ev(`${p.id} reloads (${ms} ms)`)
    bye(p)
    after(ms, back(p))
  }
  const disturb = () => {
    const ps = live()
    if (!ps.length) return
    const r = R()
    const pick = () => ps[Math.floor(R() * ps.length)]
    const decider = ps.find((p) => leads(p.bus, ctx(p)))
    if (r < 0.25) reload(pick(), 100 + Math.floor(R() * 2900))
    else if (r < 0.37) {
      /* the decider and the lowest id at once, or any two, or three */
      const lowest = [...ps].sort((a, b) => (a.id < b.id ? -1 : 1))[0]
      const group = new Set<Page>([decider ?? pick(), lowest])
      if (R() < 0.4) group.add(pick())
      const ms = 100 + Math.floor(R() * 2000)
      for (const g of group) reload(g, ms + Math.floor(R() * 300))
    } else if (r < 0.52) {
      const p = pick()
      if (!p.visible) return
      const ms = 1000 + Math.floor(R() * 30_000)
      ev(`${p.id} hidden ${ms} ms`)
      p.visible = false
      p.ver++
      send(p, 'gone')
      after(ms, () => {
        if (pages.get(p.id) !== p || !p.alive) return
        p.visible = true
        p.ver++
        p.hereAt = now
        send(p, 'here')
      })
    } else if (r < 0.62) {
      const p = pick()
      const ms = 2000 + Math.floor(R() * 40_000)
      ev(`${p.id} crashes, back in ${ms} ms`)
      p.alive = false
      p.ver++
      after(ms, back(p))
    } else if (r < 0.72) {
      const p = pick()
      const ms = 1000 + Math.floor(R() * 30_000)
      ev(`${p.id} leaves the call, back in ${ms} ms`)
      bye(p)
      after(ms, back(p))
    } else if (r < 0.77 && !pages.has(extra)) {
      ev(`${extra} joins`)
      newPage(extra, homes.get(extra)!)
    } else if (r < 0.8 && decider) {
      /* the decider goes silent (a crash) wherever the tour is, and is back in 20 s */
      ev(`${decider.id} (deciding) crashes, back in 20 s`)
      decider.alive = false
      decider.ver++
      after(20_000, back(decider))
    } else if (r < 0.88 && decider) {
      /* the decider leaves the call for longer than ABANDON_MS — alone on its tour, the tour is
         given up on every screen — and comes back on a new page, to be handed it again */
      const ms = k.ABANDON_MS + 1000 + Math.floor(R() * 15_000)
      ev(`${decider.id} (deciding) leaves the call, back in ${ms} ms`)
      bye(decider)
      after(ms, back(decider))
    }
  }

  /* ── the looks, at every sample ── */
  const stuckSince = new Map<Page, { at: number; tour: string }>()
  const startSince = new Map<Page, { at: number; allow: number }>()
  const stalledSeen = new Set<string>()
  const panel = (p: Page) =>
    `${p.id}=${p.bus.tour || '-'}#${p.bus.seq}/${p.bus.phase}/s${p.bus.stops.length}${startOn(p) ? '/START' : ''}${leads(p.bus, ctx(p)) ? '/LEADS' : ''}`
  const observe = () => {
    const ps = live().filter(meLive)
    /* a page not on screen waits for nothing: its clocks start again when it is */
    for (const m of [stuckSince, startSince])
      for (const p of m.keys()) if (!ps.includes(p)) m.delete(p)
    const deciding = new Set<string>()
    const cs = new Map(ps.map((p) => [p, ctx(p)]))
    for (const p of ps) if (leads(p.bus, cs.get(p)!)) deciding.add(p.bus.tour)
    for (const p of ps) {
      const b = p.bus
      const c = cs.get(p)!
      const start = startOn(p, c)
      /* EAGER: a tour given up here by its clock, the moment it is, while somebody here decides it */
      if (holds(b) && b.phase !== 'end' && stalled(b, c)) {
        const key = `${p.id}#${p.gen}:${b.tour}:${b.seq}`
        if (!stalledSeen.has(key) && deciding.has(b.tour) && rep.eager.length < 5)
          rep.eager.push(
            `${secs(now)} ${p.id} gave up ${b.tour}#${b.seq} ${b.phase} while it is decided here — ${ps.map(panel).join(' ')}`,
          )
        stalledSeen.add(key)
      }
      /* STUCK: a tour not over, no Start, and nobody here deciding it */
      const stuck = holds(b) && b.phase !== 'end' && !start && !deciding.has(b.tour)
      /* the bound is about a tour: a screen that takes up another tour waits on that one afresh */
      if (!stuck) stuckSince.delete(p)
      else {
        if (stuckSince.get(p)?.tour !== b.tour) stuckSince.set(p, { at: now, tour: b.tour })
        const d = now - stuckSince.get(p)!.at
        rep.maxStuck = Math.max(rep.maxStuck, d)
        if (d > BOUND_MS + MARGIN_MS && !rep.stuck.some((x) => x.includes(` ${p.id}#${p.gen} `)))
          rep.stuck.push(
            `${secs(stuckSince.get(p)!.at)} ${p.id}#${p.gen} on ${b.tour}#${b.seq} ${b.phase} s${b.stops.length} riders[${b.riders.filter((r) => r.on).map((r) => r.id)}]: nobody deciding, no Start, for ${secs(d)} s — ${ps.map(panel).join(' ')}`,
          )
      }
      /* RETURN: Start here, while a friend here holds a tour I ride and could hand it to me */
      const holder =
        start &&
        ps.find((q) => {
          /* a friend here as this page sees it: a page back from a crash before the sweep is not
             greeted again (party.ts answers only somebody new), so it sees nobody until a beat */
          if (q === p || q.id === mute || !c.present.has(q.id)) return false
          if (!holds(q.bus) || q.bus.phase === 'end' || q.bus.tour === b.tour) return false
          if (!q.bus.riders.some((r) => r.id === p.id && r.on)) return false
          const qc = cs.get(q)!
          if (!abandoned(q.bus, qc)) return true
          return hostSet(q.bus, new Set([...qc.present, p.id]))[0] === p.id
        })
      if (!holder) startSince.delete(p)
      else {
        /* pages the holder sees here that cannot answer anybody: crashed and lingering until the
           sweep, or the friend on an older build — asked of the world, not of the answering order */
        const dead = [...cs.get(holder)!.present].filter(
          (id) => id !== p.id && id !== holder.id && (!pages.get(id)?.alive || id === mute),
        ).length
        const allow = dead >= 2 ? SWEEP_MS + MARGIN_MS : RETURN_MS
        const was = startSince.get(p)
        const since = { at: was?.at ?? now, allow: Math.max(was?.allow ?? 0, allow) }
        startSince.set(p, since)
        const d = now - since.at
        rep.maxReturn = Math.max(rep.maxReturn, d)
        if (d > since.allow && !rep.ret.some((x) => x.includes(` ${p.id}#${p.gen} `)))
          rep.ret.push(
            `${secs(since.at)} ${p.id}#${p.gen} offered Start for ${secs(d)} s while ${holder.id} holds ${holder.bus.tour}#${holder.bus.seq}${abandoned(holder.bus, cs.get(holder)!) ? ' (given up)' : ''}, which it rides — ${ps.map(panel).join(' ')}`,
          )
      }
    }
  }
  const runFor = (ms: number, mode: 'active' | 'presses' | 'still', dt: number) => {
    const end = now + ms
    while (now < end) {
      now += dt
      const due = later.filter((l) => l.at <= now)
      later = later.filter((l) => l.at > now)
      for (const l of due) l.fn()
      if (mode !== 'still')
        for (const p of live()) if (p.id !== mute && meLive(p) && R() < dt / 2500) randomPress(p)
      if (mode === 'active' && R() < (dt / 50) * 0.0035 * (pace === 1 ? 0.5 : 1)) disturb()
      step()
      observe()
    }
  }

  /* the run: a tour started, disturbances among the presses, presses alone, then nothing at all */
  runFor(3000, 'presses', 50)
  const starters = live().filter((p) => p.id !== mute)
  const first = starters[Math.floor(R() * starters.length)]
  if (startOn(first)) press(first, { act: 'start', label: 'Start' })
  runFor(pace === 1 ? 240_000 : 90_000, 'active', 50)
  runFor(45_000, 'presses', 50)
  /* every disturbance put right: whoever is gone comes back */
  for (const l of later) l.fn()
  later = []
  runFor(pace === 1 ? 120_000 : 60_000, 'presses', 50)
  runFor(k.TOUR_IDLE_MS + 3 * k.ABANDON_MS + 20_000, 'still', 250)
  for (const p of live().filter(meLive))
    if (!startOn(p))
      rep.end.push(`${p.id} still holds ${p.bus.tour}#${p.bus.seq} ${p.bus.phase} with no Start`)
  return rep
}

const red = (r: Report) =>
  [...r.stuck, ...r.ret, ...r.eager, ...r.take, ...r.moved, ...r.gust, ...r.end].slice(0, 3)

describe('no screen waits more than thirty seconds for a party tour nobody is driving', () => {
  /* 500 seeds, half of them at the dev call's pace: twenty tests of 25, each a few seconds, so
     none of them comes near the suite's testTimeout on a loaded machine (vite.config.ts).
     `simulate` is exported so a longer sweep can ask it the same of more seeds
     (docs/2026-11-22-lab-tour.md records 5,000) */
  const PER = 25
  for (let chunk = 0; chunk < 500 / PER; chunk++)
    it(`seeds ${chunk * PER + 1}–${chunk * PER + PER}: every look, at every sample`, () => {
      const bad: string[] = []
      for (let seed = chunk * PER + 1; seed <= chunk * PER + PER; seed++) {
        const r = simulate(seed)
        const why = red(r)
        if (why.length) bad.push(`seed ${seed} (pace ${r.pace}, ${r.n} pages): ${why.join(' | ')}`)
      }
      expect(bad).toEqual([])
    })
})
