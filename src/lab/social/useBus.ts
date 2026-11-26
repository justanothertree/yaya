import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react'
import { onParty, sendParty, type PartyEnvelope } from '../../voice/voiceSession'
import type { PartyHere } from '../../party/party'
import { senderGate } from '../../voice/callChatLog'
import { onToysNow } from './gate'
import { heldSeat } from './held'
import { hashParam } from '../links'
import { useToyNames } from './where'
import {
  ask,
  askAgain,
  canStart,
  consentAfter,
  holdOn,
  holds,
  hopPlan,
  hostOf,
  keepAside,
  keptFor,
  knobs,
  landedAt,
  leads,
  listen,
  meant,
  mergeKnown,
  outbox,
  readBus,
  receive,
  rideStep,
  rollFaces,
  sitNow,
  startTour,
  tick,
  tourIdFrom,
  windowGone,
  wireOf,
  type Asked,
  type Bus,
  type Consent,
  type Ctx,
  type Faces,
  type Kept,
  type Knobs,
  type Leaves,
  type Outbox,
  type Press,
  type Sat,
  type Step,
} from './bus'
import {
  GATE_SHUT,
  HOPPED_OFF,
  SHARING_OFF,
  TOUR_BACK,
  arrivedWords,
  faceCard,
  followEndedWords,
  heading,
  hopWords,
  lineWith,
  missedWords,
  phaseLine,
  riderWords,
  saidOf,
  secs,
  startedRow,
  startedWords,
  toyOf,
  type BusButton,
  type View,
} from './busWords'
import { busNow, type BusModel, type BusNow, type Offer } from './busNow'
import type { Place } from './tour'

/**
 * The party tour on a call, on the page: bus.ts holds its rules and busWords.ts every sentence,
 * and this is the only part that touches anything — the call's party channel, the clock, and
 * moving you. docs/2026-11-22-lab-tour.md, "Step 5: the bus".
 *
 * ⚠️ IT LISTENS ONLY WHILE YOUR LAB MAY SHARE, AND SENDS ONLY WHILE YOUR `where` NAMES A TOY. Bus
 * messages are read while your gate allows, you are sharing, you are in the call and on the Lab
 * page — a hidden tab keeps listening, as the party does — and sent only while you are LIVE: all
 * that, and your tab visible with a toy on screen, which are exactly the moments your own `where`
 * carries your toy. When listening stops, everything on screen goes with it — the tour, your yes,
 * your count — and the strip says why.
 *
 * ⚠️ NOTHING HERE IS PERIODIC. The clock is one setTimeout, re-armed to the next moment the bus
 * itself names (a window closing, a count ending, a hop, the next whole second of a countdown on
 * screen), and the bus is also asked again whenever who is here, or whether you are live, changes —
 * bus.ts's tick notices a host coming back only between two asks (its own comment says so). Never
 * requestAnimationFrame: a hidden tab and a hidden pane both stop it, and the bus must not stop.
 *
 * ⚠️ NOBODY IS MOVED BY A STATE: a hop is this browser's own press, kept here (`consent`), and goes
 * to the toy that press named or nowhere (bus.ts's hopPlan and rideStep). And a move never takes
 * away what the press did not name: a seat in a game still going, a match being watched, an away
 * tab — each is offered instead.
 */

/** the dev call's pace (src/dev/labCall.ts's `pace=`): every timer the bus marks † runs this fast */
function devPace(): number {
  /* ⚠️ BEHIND import.meta.env.DEV, SO THE BUILD DROPS IT: a production bus is never paced, and the
     dev call's key never reaches the bundle (the docs record the grep) */
  if (import.meta.env.DEV) {
    try {
      const cfg = JSON.parse(sessionStorage.getItem('dev_call') ?? 'null') as { pace?: unknown }
      if (typeof cfg?.pace === 'number') return cfg.pace
    } catch {
      /* no dev call: the real pace */
    }
  }
  return 1
}

/**
 * ⚠️ ONE LAB DRIVES THE BUS, HOWEVER MANY ARE MOUNTED. Two would each answer every hello, each
 * keep a clock, each hop you — so the first live instance takes this token and drives, and any
 * other draws from busNow and presses through it. Handed on when the driver unmounts.
 */
let owner: object | null = null
const waiting = new Set<() => void>()
function claim(me: object) {
  if (owner === null) owner = me
  return owner === me
}
function release(me: object) {
  if (owner !== me) return
  owner = null
  busNow.clear()
  waiting.forEach((w) => w())
}

/** what the hook reads from the strip; every field is about now */
export type BusInputs = {
  inCall: boolean
  /** the call's room: a tour kept aside through a pause belongs to it (bus.ts's keepAside) */
  room: string | null
  /** the Lab is the page: a Lab in a canvas window over another page is not on the tour */
  onLabPage: boolean
  gateOpen: boolean
  sharing: boolean
  me: string | null
  /** the party's people on the Lab (usePartyHere's `lab`) */
  lab: readonly PartyHere[] | undefined
  /** everybody else on the call, in its order */
  roster: readonly { id: string; name: string }[]
  current: string
  /** every toy your Lab lists, by id */
  toys: ReadonlyMap<string, string>
  /** the toys listed for everybody: what the bus's dice may land on */
  rollable: readonly string[]
  kindOf: (id: string) => string | undefined
  filter: string
  /** a person's name as this browser knows it, kept after they go */
  name: (id: string) => string | null
  /** whom you follow, and their name */
  following: string | null
  leaderName: string
  /** GpuLab's show: a move that is not a pick of your own */
  show: (toy: string) => void
  /** GpuLab's pick: Catch up is a toy you chose */
  onGo: (toy: string) => void
  /** stop following, saying these words in the strip's status region */
  endFollow: (words: string) => void
  /** the strip's one status region: the latest sentence wins */
  say: (text: string) => void
}

export type BusApi = BusNow & {
  /** whether this Lab drives the bus, or draws a copy (a second Lab mounted) */
  driving: boolean
  /** off the bus for a reason the caller says in its own words (Follow pressed while riding) */
  hopOff: () => void
  /** the phase line, where a hop moves a focus that was inside the toy */
  sayRef: RefObject<HTMLParagraphElement | null>
  /** the first face: Roll moves the focus there when the faces arrive */
  firstFaceRef: RefObject<HTMLButtonElement | null>
}

const onVisible = (fn: () => void) => {
  document.addEventListener('visibilitychange', fn)
  return () => document.removeEventListener('visibilitychange', fn)
}
const tabVisible = () => document.visibilityState === 'visible'
const onHash = (fn: () => void) => {
  window.addEventListener('hashchange', fn)
  return () => window.removeEventListener('hashchange', fn)
}
const inMatchNow = () => !!hashParam('match')

type Hop = { at: number; key: string; tour: string; toy: string; n: number; asked: number }

/** this browser's own part of the tour: never sent, gone when listening stops */
type Local = {
  bus: Bus | null
  box: Outbox
  gate: ReturnType<typeof senderGate>
  consent: Consent
  moved: Set<string>
  planned: Set<string>
  hop: Hop | null
  offer: Offer | null
  pending: { key: 'roll' | 'go'; until: number; seq: number } | null
  flash: { text: string; until: number } | null
  closedSeq: number | null
  /** the last sit asked for, per stop */
  sat: Sat
  /** windows already answered no for a toy this Lab does not list */
  autoNo: Set<string>
  /** my yes to a window, and the host it was last asked of (bus.ts's askAgain) */
  asked: Asked
  /**
   * My own Roll, and until when its faces take the focus: the roll it was (`tour:n`), never
   * Roll for somebody — whose faces are theirs — and never a roll that was refused or lost, which
   * would otherwise take the focus from wherever it was when somebody later rolled for me
   */
  focusFaces: { key: string; until: number } | null
  /** the faces of the last roll pressed here, so the words can say whose roll it was */
  rolled: Faces | null
  /** my own no to the window open now (`tour:n:toy`), drawn at once (engine.shown) */
  noTo: string | null
  /** the tour as it was when listening last stopped, when, and in which call (engine.restore) */
  kept: Kept
  /** a pause said so (GATE_SHUT, SHARING_OFF): what comes back says so too */
  paused: boolean
  /** when listening last started: a seat is not given up while the table is still coming back */
  listenAt: number
}

export function useBus(a: BusInputs): BusApi {
  const k: Knobs = useMemo(() => knobs(devPace()), [])
  const visible = useSyncExternalStore(onVisible, tabVisible, tabVisible)
  const inMatch = useSyncExternalStore(onHash, inMatchNow, inMatchNow)
  const held = useSyncExternalStore(heldSeat.subscribe, heldSeat.get, heldSeat.get)
  const [version, setVersion] = useState(0)
  const changed = useCallback(() => setVersion((v) => v + 1), [])

  const listening = a.inCall && a.gateOpen && a.sharing && !!a.me && a.onLabPage
  const current = a.current
  const meLive = listening && visible && !!current
  /* ⚠️ WHO IS ON WHICH TOY, AS ONE STRING. The party rebuilds its `lab` list on every pointer
     sample — several a second per friend moving — and the bus is asked again whenever who is here
     changes, so it is asked about what changed, never about a new array saying the same thing */
  const rosterKey = JSON.stringify(a.roster.map((p) => p.id))
  const labKey = JSON.stringify((a.lab ?? []).map((p) => ({ id: p.id, sub: p.sub })))
  const me = a.me
  const roster = useMemo(() => {
    const ids = JSON.parse(rosterKey) as string[]
    return new Set(me ? [...ids, me] : ids) as ReadonlySet<string>
  }, [rosterKey, me])
  const present = useMemo(() => {
    const lab = JSON.parse(labKey) as { id: string; sub?: string }[]
    const ids = new Set(onToysNow(lab, roster, a.gateOpen).map((p) => p.id))
    if (meLive && me) ids.add(me)
    return ids as ReadonlySet<string>
  }, [labKey, roster, a.gateOpen, meLive, me])
  const names = useToyNames(listening)

  /* the latest of everything, read by the clock and the listener without re-subscribing them */
  const inputs = useRef({ ...a, listening, meLive, visible, inMatch, held, present, roster })
  inputs.current = { ...a, listening, meLive, visible, inMatch, held, present, roster }
  const titleRef = useRef(names)
  titleRef.current = names

  const L = useRef<Local>({
    bus: null,
    box: outbox(k),
    gate: senderGate({ burst: 8, refillMs: 500 }),
    consent: null,
    moved: new Set(),
    planned: new Set(),
    hop: null,
    offer: null,
    pending: null,
    flash: null,
    closedSeq: null,
    sat: null,
    autoNo: new Set(),
    asked: null,
    focusFaces: null,
    rolled: null,
    noTo: null,
    kept: null,
    paused: false,
    listenAt: 0,
  }).current
  const timer = useRef(0)
  const sayRef = useRef<HTMLParagraphElement | null>(null)
  const firstFaceRef = useRef<HTMLButtonElement | null>(null)

  /* ── the owner token ── */
  const token = useRef({}).current
  const [driving, setDriving] = useState(false)
  useEffect(() => {
    const tryClaim = () => setDriving(claim(token))
    tryClaim()
    waiting.add(tryClaim)
    return () => {
      waiting.delete(tryClaim)
      release(token)
    }
  }, [token])

  /* ── the engine: every function below reads `inputs` and `L` as they are when it runs ── */
  const engine = useMemo(() => {
    const inp = () => inputs.current
    const ctx = (): Ctx => {
      const i = inp()
      const subs = new Map((i.lab ?? []).map((p) => [p.id, p.sub ?? null]))
      return {
        now: performance.now(),
        present: i.present,
        roster: i.roster,
        meLive: i.meLive,
        subOf: (id) =>
          !i.present.has(id) ? null : id === i.me ? i.current : (subs.get(id) ?? null),
        people: i.roster.size,
        k,
      }
    }
    const view = (c: Ctx): View => {
      const i = inp()
      return {
        bus: L.bus!,
        now: c.now,
        k,
        name: i.name,
        toy: (id) => i.toys.get(id) ?? null,
        title: (id) => i.toys.get(id) ?? titleRef.current?.[id] ?? null,
        roster: c.roster,
        present: c.present,
        subOf: c.subOf,
        myToy: i.current,
        seated: i.held !== null && i.held === i.current,
        inMatch: i.inMatch,
        consent: L.consent,
        hopAt: L.hop?.at ?? null,
        people: c.people,
        rolled:
          L.bus!.phase === 'choose' &&
          !!L.rolled &&
          !!L.bus!.faces?.every((f, j) => f === L.rolled![j]),
      }
    }
    /**
     * What the panel draws: the bus held, with my own no to the window already in it. A yes is
     * this browser's consent and shows at once; a no would wait up to a second for the host's state
     * to say it back, with Not this one still on screen to be pressed again meanwhile.
     */
    const shown = (c: Ctx): View => {
      const v = view(c)
      const b = v.bus
      const me = b.riders.findIndex((r) => r.id === inp().me)
      const key = `${b.tour}:${b.stops.length + 1}:${b.toy}`
      if (b.phase !== 'ready' || L.noTo !== key || me < 0 || b.no.includes(me)) return v
      return { ...v, bus: { ...b, no: [...b.no, me], ready: b.ready.filter((x) => x !== me) } }
    }
    /**
     * ⚠️ ONE PRESS, ONE SENTENCE. The status region keeps only the latest, and a press that ends a
     * follow usually says something of its own in the same breath — Start says the tour started,
     * Take me there may close the window — so the follow's "you've stopped following" was written
     * and overwritten before anything read it. Within a press its sentences are gathered, the
     * latest winning as ever, and the follow ending is added to it.
     */
    let saying: { text: string | null; follow: string | null } | null = null
    const say = (text: string) => {
      if (saying) saying.text = text
      else inp().say(text)
    }
    const pressing = (fn: () => void) => {
      if (saying) return fn()
      const s: { text: string | null; follow: string | null } = { text: null, follow: null }
      saying = s
      try {
        fn()
      } finally {
        saying = null
        const i = inp()
        if (s.follow) i.endFollow(s.text ? `${s.text} ${s.follow}` : s.follow)
        else if (s.text !== null) i.say(s.text)
      }
    }

    /** a departure seen for the first time: when do I hop, if at all (bus.ts's hopPlan) */
    const plan = (c: Ctx) => {
      const b = L.bus!
      const n = b.stops.length
      if (!holds(b)) return
      const key = `${b.tour}:${n}`
      /* a Come too still waiting takes the slot each state gives it */
      if (L.hop?.key === key && L.consent?.come) {
        const again = hopPlan(b, L.hop.asked, L.consent, c.people, L.moved)
        if (again?.do === 'hop') L.hop = { ...L.hop, at: again.at }
      }
      if (!n || L.planned.has(key)) return
      L.planned.add(key)
      const toy = b.stops[n - 1].toy
      const p = hopPlan(b, c.now, L.consent, c.people, L.moved)
      if (p?.do === 'hop') L.hop = { at: p.at, key, tour: b.tour, toy, n, asked: c.now }
      if (p?.do === 'late') L.offer = { key, toy, why: 'late' }
    }

    /** the bus after a step: what it asks to send waits its turn, and a change is said once */
    const apply = (s: Step, c: Ctx) => {
      const prev = L.bus!
      L.bus = s.bus
      for (const o of s.out) L.box.push(o)
      if (L.kept && holds(L.bus)) {
        /* heard the tour from somebody: what was known before the pause still counts (stars only
           grow), and the copy kept aside is done with */
        L.bus = mergeKnown(L.kept.bus, L.bus)
        L.kept = null
      }
      if (L.bus === prev) return
      /* a yes, a no and an automatic no each go with the window they answered (bus.ts's windowGone):
         a skip keeps the departure's number, and the same toy can be rolled there again */
      if (windowGone(prev, L.bus, L.consent)) {
        L.consent = null
        L.asked = null
      }
      if (L.bus.phase !== 'ready') {
        L.noTo = null
        L.autoNo.clear()
      }
      plan(c)
      if (L.closedSeq !== null && L.bus.seq !== L.closedSeq) L.closedSeq = null
      if (L.pending && L.bus.seq !== L.pending.seq) L.pending = null
      const said = saidOf(prev, view(c))
      if (said) say(said)
    }

    /** what may go now goes — only while live, which is when my `where` names my toy */
    const pump = (now: number) => {
      const i = inp()
      if (!i.meLive || !L.bus) return
      for (const o of L.box.take(now))
        sendParty('bus', o.t === 'state' ? wireOf(L.bus, i.present, now) : o)
    }

    /**
     * ⚠️ BACK AFTER A PAUSE THAT TOOK EVERYBODY: put the tour back. A stranger joining shuts every
     * friend's gate at once, so every copy of the tour stops listening together and nobody is left
     * holding it to answer a hello. The tour is kept aside — never drawn, sent or acted on while
     * paused — and only if nobody answers for SYNC_MS on coming back is it taken up again, its
     * clocks moved on by the pause. Anybody who does answer is newer than this, and wins.
     */
    const restore = (c: Ctx) => {
      const kept = L.kept
      if (!kept || !L.bus || !L.bus.heard || holds(L.bus)) return
      L.kept = null
      const b = keptFor(kept, inp().room, c.now, k)
      if (!b) return
      const by = c.now - kept.at
      L.bus = {
        ...b,
        due: b.due + by,
        readyAt: b.readyAt + by,
        openAt: b.openAt + by,
        holdUntil: b.holdUntil + by,
        freeAt: b.freeAt + by,
        leaveAt: b.leaveAt + by,
        heard: true,
        asking: false,
        syncAt: L.bus.syncAt,
        hellos: L.bus.hellos,
        lastHello: L.bus.lastHello,
        live: c.meLive,
        repairAt: L.bus.repairAt,
        answerAt: L.bus.answerAt,
        guideAway: null,
        quietSince: null,
      }
    }

    /** my hop, when it is due: rideStep decides, against my own consent */
    const hops = (c: Ctx) => {
      const h = L.hop
      if (!h || c.now < h.at || !L.bus) return
      L.hop = null
      const i = inp()
      const r = rideStep({
        consent: L.consent,
        tour: h.tour,
        n: h.n,
        toy: h.toy,
        myToy: i.current,
        openable: i.toys.has(h.toy),
        gateOpen: i.gateOpen,
        sharing: i.sharing,
        visible: i.visible,
        onLab: i.onLabPage,
        heldSeat: i.held,
        inMatch: i.inMatch,
        moved: L.moved,
      })
      if (r.do === 'with') L.moved.add(h.key)
      else if (r.do === 'unopenable') L.offer = { key: h.key, toy: h.toy, why: 'unopenable' }
      else if (r.do === 'offer') L.offer = { key: h.key, toy: h.toy, why: r.why }
      else if (r.do === 'go') {
        const v = view(c)
        const there = [...c.present]
          .filter((id) => id !== i.me && c.subOf(id) === r.toy)
          .map((id) => i.name(id) ?? '')
          .filter(Boolean)
        /* ⚠️ THE FOCUS GOES SOMEWHERE THAT STAYS, as a follow's move does (TourStrip's useFollow):
           a move remounts the toy, so a focused control inside it vanishes and the keyboard lands
           on the page. Moved BEFORE the toy changes, so the Lab's focus rescue sees it already
           outside the toy, and only a keyboard focus: a pointer that last touched the toy is
           looking at the stage, and the rescue puts it on the new toy there. */
        const f = document.activeElement
        if (f?.closest('.lab-toy') && f.matches(':focus-visible'))
          sayRef.current?.focus({ preventScroll: true })
        L.moved.add(h.key)
        L.flash = { text: hopWords(v, r.toy), until: c.now + 1500 }
        i.show(r.toy)
        say(arrivedWords(v, r.toy, there))
      }
    }

    /** a press here: my consent first, then what it asks of the bus */
    const press = (p: Press, leaves: Leaves = null, pend: 'roll' | 'go' | null = null) => {
      const b = L.bus
      if (!b) return
      const c = ctx()
      const had = L.consent
      L.consent = consentAfter(L.consent, b, c, p, leaves)
      /* a withdrawal during the count cancels it: nothing on screen counts down to nothing */
      if (had && !L.consent) L.hop = null
      const s = ask(b, c, p)
      apply(s, c)
      if (p.t === 'ready' && p.on && !meant(b, c, p)) say(missedWords(view(c), p.toy))
      if (p.t === 'ready')
        L.noTo = !p.on && meant(b, c, p) === 'window' ? `${b.tour}:${p.n}:${p.toy}` : null
      if (p.t === 'ready' && p.on && meant(b, c, p) === 'window')
        L.asked = {
          key: `${b.tour}:${p.n}:${p.toy}`,
          host: leads(b, c) ? b.me : hostOf(b, c),
          from: b.from,
        }
      if (p.t === 'ready' && L.consent?.come) {
        const plan2 = hopPlan(L.bus!, c.now, L.consent, c.people, L.moved)
        if (plan2?.do === 'hop')
          L.hop = {
            at: plan2.at,
            key: plan2.key,
            tour: L.consent.tour,
            toy: L.consent.toy,
            n: L.consent.n,
            asked: c.now,
          }
      }
      /* a request that went out rather than being decided here: its button waits, at most 3 s */
      if (pend && s.bus === b && s.out.some((o) => o.t === p.t))
        L.pending = { key: pend, until: c.now + 3000, seq: b.seq }
    }

    /** what nobody presses: the automatic no, and sitting down or standing up at a stop */
    const chores = (c: Ctx) => {
      const b = L.bus
      const i = inp()
      if (!b || !holds(b) || b.phase === 'end' || !c.meLive || !i.me) return
      const me = b.riders.findIndex((r) => r.id === i.me)
      /* a yes the window does not list is asked again of a new host (bus.ts's askAgain) */
      const again = askAgain(b, c, L.consent, L.asked)
      if (again && L.consent) {
        L.asked = again
        apply(ask(b, c, { t: 'ready', on: true, n: L.consent.n, toy: L.consent.toy }), c)
      }
      const rider = L.bus!.riders[me]
      if (!rider?.on) return
      /* ⚠️ A RIDER WHOSE LAB DOES NOT LIST THE TOY ANSWERS NO, ONCE. They cannot go, and the bus
         waits for every rider here to answer — so their silence would hold it to the end of the
         window for nothing. Once per window: a no is a no, and they are told why on screen. */
      if (b.phase === 'ready' && b.toy && !i.toys.has(b.toy)) {
        const n = b.stops.length + 1
        const key = `${b.tour}:${n}:${b.toy}`
        if (!L.autoNo.has(key) && !b.ready.includes(me) && !b.no.includes(me)) {
          L.autoNo.add(key)
          press({ t: 'ready', on: false, n, toy: b.toy })
        }
      }
      /* sitting at the stop's table in a game going on holds the roll for it (bus.ts's holdOn):
         a seat taken or given up is said once each way, as it happens (bus.ts's sitNow) */
      const sit = sitNow(L.bus!, L.sat, i.held, i.current, c.now - L.listenAt < k.SYNC_MS)
      if (sit) {
        L.sat = sit.sat
        apply(ask(L.bus!, c, { t: 'sit', on: sit.on }), c)
      }
    }

    /** the moment anything on screen, or anything the bus does, next changes */
    const rearm = () => {
      window.clearTimeout(timer.current)
      timer.current = 0
      const b = L.bus
      if (!b) return
      const now = performance.now()
      const people = inp().roster.size
      const ts: number[] = []
      const add = (t: number | null | undefined) => {
        if (typeof t === 'number' && Number.isFinite(t) && t > now) ts.push(t)
      }
      /* a countdown on screen changes on the whole second, and a hold on the whole minute */
      const every = (t: number, unit: number) => {
        if (t > now) add(t - (Math.ceil((t - now) / unit) - 1) * unit)
      }
      if (!b.heard) add(b.syncAt + k.SYNC_MS)
      add(L.listenAt + k.SYNC_MS)
      if (b.asking && b.hellos === 1) add(b.lastHello + k.HELLO_RETRY_MS)
      if (holds(b) && b.phase !== 'end') {
        add(b.due)
        add(b.openAt)
        add(b.freeAt)
        add(b.holdUntil)
        add(b.leaveAt)
        add(landedAt(b, people))
        if (b.phase === 'ready') {
          add(b.readyAt + k.READY_MIN_MS)
          every(b.due, 1000)
        }
        if (holdOn(b, { now, present: inp().present })) every(b.holdUntil, 60_000)
        if (b.guideAway !== null) add(b.guideAway + k.GUIDE_GONE_MS)
        if (b.quietSince !== null) add(b.quietSince + k.ABANDON_MS)
      }
      add(L.box.dueAt())
      if (L.hop) {
        add(L.hop.at)
        every(L.hop.at, 1000)
      }
      add(L.pending?.until)
      add(L.flash?.until)
      if (!ts.length) return
      timer.current = window.setTimeout(run, Math.max(0, Math.min(...ts) - now) + 1)
    }

    /** the clock, and every change to who is here: tick, hop, send, and wait for what is next */
    const run = () => {
      if (!L.bus) return
      const c = ctx()
      apply(tick(L.bus, c), c)
      restore(c)
      /* back from a pause that was said: the tour is back, or there is none to come back to — never
         "the party tour is hidden" left standing over a strip that shows it */
      if (L.paused && L.bus.heard) {
        L.paused = false
        say(holds(L.bus) ? TOUR_BACK : '')
      }
      hops(c)
      chores(c)
      pump(c.now)
      if (L.pending && c.now >= L.pending.until) L.pending = null
      if (L.flash && c.now >= L.flash.until) L.flash = null
      rearm()
      changed()
    }

    /** a `bus` message off the party, from somebody on my roster, at most a few a second each */
    const onMsg = (m: PartyEnvelope) => {
      if (m.kind !== 'bus' || !L.bus) return
      if (!L.gate.allow(m.from)) return
      const msg = readBus(m.body)
      if (!msg) return
      const c = ctx()
      apply(receive(L.bus, c, m.from, msg), c)
      run()
    }

    const stopFollowing = () => {
      const i = inp()
      if (!i.following) return
      const words = followEndedWords(i.leaderName)
      if (saying) saying.follow = words
      else i.endFollow(words)
    }

    const start = () => {
      const b = L.bus
      if (!b) return
      const c = ctx()
      if (!canStart(b, c)) return
      stopFollowing()
      L.consent = null
      L.hop = null
      L.offer = null
      L.closedSeq = null
      L.pending = null
      apply(startTour(b, c, tourIdFrom(crypto.getRandomValues(new Uint8Array(8)))), c)
      run()
    }

    /** what a yes here would leave behind, as its label says it (busWords's takeLabel) */
    const leavesNow = (): Leaves => {
      const i = inp()
      if (i.held !== null && i.held === i.current) return { seat: i.current }
      return i.inMatch ? { match: true } : null
    }

    const act = (btn: BusButton) => pressing(() => acting(btn))
    const acting = (btn: BusButton) => {
      const b = L.bus
      const i = inp()
      if (!b) return
      switch (btn.act) {
        case 'start':
        case 'another':
          return start()
        case 'roll':
        case 'rollFor':
        case 'rollAnyway': {
          if (L.pending?.key === 'roll') return
          const faces = rollFaces(i.rollable, b, i.current, i.kindOf, i.filter, Math.random)
          if (!faces) return
          L.rolled = faces
          L.focusFaces =
            btn.act === 'rollFor'
              ? null
              : { key: `${b.tour}:${b.stops.length + 1}`, until: performance.now() + 3000 }
          press(
            { t: 'roll', faces, ...(btn.act === 'rollAnyway' && { anyway: true }) },
            null,
            'roll',
          )
          break
        }
        case 'face':
          if (!btn.toy) return
          stopFollowing()
          press({ t: 'pick', toy: btn.toy })
          break
        case 'take':
        case 'come':
          if (!btn.toy || btn.n === undefined) return
          stopFollowing()
          press({ t: 'ready', on: true, n: btn.n, toy: btn.toy }, leavesNow())
          break
        case 'no':
        case 'stay':
          if (!btn.toy || btn.n === undefined) return
          press({ t: 'ready', on: false, n: btn.n, toy: btn.toy })
          break
        case 'go':
          if (L.pending?.key === 'go') return
          press({ t: 'go' }, null, 'go')
          break
        case 'off':
          say(HOPPED_OFF)
          press({ t: 'off' })
          break
        case 'fin':
        case 'finAnyway':
          press({ t: 'fin', ...(btn.act === 'finAnyway' && { anyway: true }) })
          break
        case 'catchUp': {
          const toy = L.offer?.toy ?? b.stops[b.stops.length - 1]?.toy
          L.offer = null
          if (toy) i.onGo(toy)
          break
        }
        case 'close':
          L.closedSeq = b.seq
          break
      }
      run()
    }

    /** off the bus for a reason the caller says itself (Follow pressed while riding), at once */
    const hopOff = () => {
      press({ t: 'off' })
      run()
    }

    return { ctx, view, shown, run, onMsg, act, hopOff, rearm }
  }, [k, L, changed])

  /* ── listening: start from nothing, and leave nothing behind ── */
  useEffect(() => {
    if (!listening || !driving || !me) return
    L.listenAt = performance.now()
    L.bus = listen(me, L.listenAt)
    L.box = outbox(k)
    L.gate = senderGate({ burst: 8, refillMs: 500 })
    const off = onParty(engine.onMsg)
    engine.run()
    return () => {
      off()
      window.clearTimeout(timer.current)
      const b = L.bus
      const i = inputs.current
      const rider =
        !!b && holds(b) && b.phase !== 'end' && b.riders.some((r) => r.id === me && r.on)
      /* the call over, nothing to come back to; otherwise the tour is kept aside (engine.restore) */
      L.kept = keepAside(L.kept, b, i.inCall ? i.room : null, performance.now())
      L.bus = null
      L.consent = null
      L.hop = null
      L.offer = null
      L.pending = null
      L.flash = null
      L.closedSeq = null
      L.sat = null
      L.planned.clear()
      L.autoNo.clear()
      L.asked = null
      L.noTo = null
      L.focusFaces = null
      L.rolled = null
      busNow.clear()
      /* ⚠️ SAID, NOT LEFT TO VANISH: the panel goes with the gate, and a screen reader is told why,
         and that the place is kept — in the host's state, or aside here if every copy paused */
      if (rider && i.inCall && i.onLabPage && (!i.gateOpen || !i.sharing)) {
        i.say(i.gateOpen ? SHARING_OFF : GATE_SHUT)
        L.paused = true
      }
      changed()
    }
  }, [listening, driving, me, k, L, engine, changed])

  /* ⚠️ A CALL THAT ENDS TAKES ITS KEPT TOUR WITH IT, though listening had already stopped: switched
     off with 🫱, the tour was kept aside, and nothing else would clear it before the next call */
  const room = a.inCall ? a.room : null
  useEffect(() => {
    L.kept = keepAside(L.kept, null, room, performance.now())
    if (!room) L.paused = false
  }, [room, L])

  /* the bus is asked again whenever whether I am live, who is here, or where I am changes */
  useEffect(() => {
    if (L.bus) engine.run()
  }, [meLive, present, roster, current, held, inMatch, L, engine])

  /* my own Roll moves the focus to the first face once its faces arrive, and only then */
  useLayoutEffect(() => {
    const f = L.focusFaces
    const b = L.bus
    if (!f || !firstFaceRef.current || !b) return
    L.focusFaces = null
    if (performance.now() < f.until && f.key === `${b.tour}:${b.stops.length + 1}`)
      firstFaceRef.current.focus()
  })

  /* ── what to draw: built when the bus or what it reads changes, never on a render of its own ── */
  const drawn = useMemo(() => {
    const bus = L.bus
    if (!driving || !bus) return { model: null, canStart: false }
    const c = engine.ctx()
    return {
      model: holds(bus) ? modelOf(engine.shown(c), L, me ?? '') : null,
      canStart: canStart(bus, c),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` is the bus changing
  }, [version, driving, engine, L, me, current, a.toys, held, inMatch, present, roster])
  const act = engine.act
  /* published for whatever draws the bus away from the strip, and for a second Lab */
  useEffect(() => {
    if (driving) busNow.set({ ...drawn, act })
  }, [driving, drawn, act])
  /* ⚠️ THE DRIVER NEVER LISTENS TO ITSELF: it publishes a fresh model whenever it draws, and
     drawing again on hearing that would never end */
  const subscribe = useCallback(
    (fn: () => void) => (driving ? () => {} : busNow.subscribe(fn)),
    [driving],
  )
  const shared = useSyncExternalStore(subscribe, busNow.get, busNow.get)

  if (!driving) return { ...shared, driving, hopOff: () => {}, sayRef, firstFaceRef }
  return {
    ...drawn,
    act,
    driving,
    hopOff: engine.hopOff,
    sayRef,
    firstFaceRef,
  }
}

/** where a rider's token stands, as the strip's chips say it */
function placeOf(v: View, id: string, me: string): Place {
  if (id === me) return { at: 'with' }
  if (!v.present.has(id)) return { at: 'quiet' }
  const sub = v.subOf(id)
  return sub === v.myToy ? { at: 'with' } : sub ? { at: 'toy', toy: sub } : { at: 'lab' }
}

/** everything the panel draws, in words (busWords.ts), from the bus and this browser's own part */
function modelOf(
  v: View,
  L: Pick<Local, 'offer' | 'flash' | 'pending' | 'closedSeq' | 'hop' | 'consent'>,
  me: string,
): BusModel {
  const b = v.bus
  const stop = b.stops[b.stops.length - 1]
  const phase = phaseLine(v)
  const line = L.flash
    ? { text: L.flash.text, buttons: [] }
    : (lineWith(v, L.offer) ?? { text: '', buttons: [] })
  /* the phone's row says the opening in a line, not a paragraph */
  const row =
    b.phase === 'pick' && !stop && line.text === startedWords(v) ? startedRow(v) : line.text
  const guide = b.riders[b.guide]?.id
  const h = L.hop
  const counting =
    h && v.now < h.at && L.consent?.n === h.n && L.consent.toy === h.toy ? secs(h.at - v.now) : null
  const i = b.riders.findIndex((r) => r.id === me)
  return {
    view: v,
    heading: heading(v),
    line,
    row,
    faces:
      b.phase === 'choose' && b.faces
        ? b.faces.map((f) => {
            const card = faceCard(v, f)
            return {
              toy: f,
              name: toyOf(v, f),
              kind: card.kind,
              star: card.star,
              press:
                guide === me
                  ? (phase?.buttons.find((x) => x.act === 'face' && x.toy === f) ?? null)
                  : null,
            }
          })
        : null,
    riders: b.riders.map((r, j) => ({
      id: r.id,
      ...riderWords(v, j),
      place: placeOf(v, r.id, me),
      me: r.id === me,
    })),
    count: counting,
    pending: L.pending?.key ?? null,
    riding: b.phase !== 'end' && b.riders[i]?.on === true,
    closed: L.closedSeq !== null && L.closedSeq === b.seq,
  }
}
