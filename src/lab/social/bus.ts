/**
 * The party tour, "the bus": friends on a call riding the Lab's toys together, one stop at a time.
 * The guide rolls three toys, picks one, and everybody who presses Take me there goes; then the
 * turn to roll passes on. docs/2026-11-22-lab-tour.md has the plan.
 *
 * Pure, like room.ts: the bus is a value, and every input — somebody's message, a button pressed
 * here, the clock — returns the next bus and what to send. bus.test.ts rides whole tours between
 * several of these over an in-memory network, with hosts leaving and states repeated.
 *
 *
 * WHO DECIDES
 *
 * One HOST: the lowest id among the riders on the Lab now (`hostOf`). The same rule as a call
 * table's, asked of a smaller set — ⚠️ A WATCHER NEVER HOSTS, AND NEITHER DOES AN OLD CLIENT,
 * because only a press makes a rider, and a client that has never heard of the bus never presses.
 * The host alone changes the bus, and answers each change with the whole of it (`state`); everyone
 * else asks. When the host goes, the next lowest carries on from the last state it had, its clocks
 * re-armed from the time remaining on the wire rather than started again.
 *
 * ⚠️ NOBODY IS MOVED BY A STATE. The state says where the bus went and who said yes; a browser
 * moves only for its own press, kept here and never sent (`Consent`), and only to the toy that
 * press named. A lost, late or forged state can at most fail to move somebody — never move
 * somebody who did not press, nor to anywhere else (`hopPlan`, `rideStep`). And a press means what
 * its button said when it was drawn, never what the bus has come to mean by the time it is handled
 * (`meant`): a Take me there for one toy is never a yes to another.
 *
 * ⚠️ THE BUS WAITS ONLY FOR RIDERS WHO ARE HERE. Nobody who has not pressed is waited for — not a
 * friend who is busy, not a tab on an older build — so a silent non-rider can never hold it.
 *
 *
 * NEWCOMERS, AND HOSTS COMING BACK
 *
 * Nothing is periodic: with no tour, the bus sends nothing at all. A browser that starts listening
 * with somebody else on the Lab says `hello` (once more after HELLO_RETRY_MS), and the host as it
 * was before it arrived, or whoever published the bus we hold, answers — room.ts's answersHello,
 * asked of the riders. ⚠️ NOBODY LEADS BEFORE LISTENING: a browser may neither lead nor offer
 * Start until it has heard the tour or listened for SYNC_MS, so somebody arriving finds a tour
 * already going rather than starting a second, and a host back from a hidden tab does not lead
 * from a bus everybody else has moved past. When one leads stale anyway, its deputy answers it.
 *
 * Two tours at once — two Starts in the same moment, or a call that split — settle on the one with
 * more riders, then more stops, then the lower starter's id. An ended or abandoned tour gives way
 * to anything; a live one never to an ended one.
 */

import { answersHello, newer, readSeats, type Seats } from './room'
import { isToyId } from './gate'
import { ROOM_TOYS, sendsFor } from './tour'

/* ── the knobs ─────────────────────────────────────────────────────────────────────────────── */

export type Knobs = {
  /** stops in a tour: about five to fifteen minutes */
  STOPS: number
  /** the guide's time to pick before the dice choose face 1 † */
  CHOOSE_MS: number
  /** the Take me there window † */
  READY_MS: number
  /** non-riders always get this long to board, before an early close or Go now † */
  READY_MIN_MS: number
  /** the 3-2-1 † */
  COUNT_MS: number
  /** from the last hop to the next roll † */
  DWELL_MS: number
  /** the longest the roll waits for a game in progress † */
  HOLD_MAX_MS: number
  /** after this, any rider may roll, or open the finale, for an idle guide † */
  IDLE_MS: number
  /** a guide absent this long loses the turn † */
  GUIDE_GONE_MS: number
  /** no rider here this long, so Start is offered again † */
  ABANDON_MS: number
  /** this long between stops with no request, and the host ends the tour † */
  TOUR_IDLE_MS: number
  /** the host: at most one state a second, leading and trailing */
  STATE_GAP_MS: number
  /** everyone: at most one request a second; later presses coalesce, the latest of each kind */
  ASK_GAP_MS: number
  /** ready requests per person per window (a skipped one included); further presses stay local */
  READY_SENDS: number
  /** sit requests per person per stop: one on, one off */
  SIT_SENDS: number
  /** listen this long before leading, and before offering Start */
  SYNC_MS: number
  /** one hello retry this long after the first */
  HELLO_RETRY_MS: number
  /** then at most one repair this often */
  HELLO_REPAIR_MS: number
  /** the call's cap of twelve, plus churn */
  MAX_RIDERS: number
  /** games a stop may star: min(this, max(1, ceil(went / 2))), fixed at departure */
  GAMES_CAP: number
}

export const KNOBS: Knobs = {
  STOPS: 5,
  CHOOSE_MS: 20_000,
  READY_MS: 15_000,
  READY_MIN_MS: 5_000,
  COUNT_MS: 3_000,
  DWELL_MS: 20_000,
  HOLD_MAX_MS: 300_000,
  IDLE_MS: 45_000,
  GUIDE_GONE_MS: 20_000,
  ABANDON_MS: 20_000,
  TOUR_IDLE_MS: 600_000,
  STATE_GAP_MS: 1_000,
  ASK_GAP_MS: 1_000,
  READY_SENDS: 3,
  SIT_SENDS: 2,
  SYNC_MS: 1_500,
  HELLO_RETRY_MS: 3_000,
  HELLO_REPAIR_MS: 5_000,
  MAX_RIDERS: 16,
  GAMES_CAP: 3,
}

/** the timers a dev call may speed up (†); the rates, the caps and the listening are never paced */
const PACED = [
  'CHOOSE_MS',
  'READY_MS',
  'READY_MIN_MS',
  'COUNT_MS',
  'DWELL_MS',
  'HOLD_MAX_MS',
  'IDLE_MS',
  'GUIDE_GONE_MS',
  'ABANDON_MS',
  'TOUR_IDLE_MS',
] as const

/** the windows a state has to reach somebody inside: to choose, to answer, to board, to count down */
const AFTER_A_STATE = ['CHOOSE_MS', 'READY_MS', 'READY_MIN_MS', 'COUNT_MS'] as const

/**
 * The knobs with the timers marked † multiplied by `pace` (the dev call's `pace=`).
 *
 * ⚠️ ONLY EVER FASTER. A pace over 1 would put TOUR_IDLE_MS past the longest timer a state may
 * carry (MAX_TIMER_MS), and every state would then be refused as malformed by everybody — so
 * anything that is not a number in (0, 1] is 1.
 */
export function knobs(pace = 1): Knobs {
  const p = Number.isFinite(pace) && pace > 0 && pace <= 1 ? pace : 1
  const k = { ...KNOBS }
  for (const key of PACED) k[key] = Math.round(KNOBS[key] * p)
  /* ⚠️ AND NO WINDOW SHORTER THAN A STATE CAN TAKE TO ARRIVE. The host sends one state a second, so
     the state that opens a window, or says the bus has left, can wait up to STATE_GAP_MS to go out
     — and a window shorter than that wait reaches everybody already closed: measured on the dev
     call at pace 0.25, a 750 ms count meant every rider but the host was told the bus had left
     without them. Twice the gap leaves the wait and the wire their second each; at the real pace
     every one of these is far above it. */
  for (const key of AFTER_A_STATE) k[key] = Math.max(k[key], 2 * k.STATE_GAP_MS)
  return k
}

/** the longest time remaining a state may carry: TOUR_IDLE_MS, the longest knob */
export const MAX_TIMER_MS = 600_000

/**
 * How far apart riders land, lowest id first.
 *
 * ⚠️ IT GROWS WITH THE CALL AND WITH THE TOY, BECAUSE THE BILL DOES. A hop sends what a move to
 * that toy sends (sendsFor: one `where`, or four onto a call table), and every send is metered
 * once per person on the call — so a hop costs sendsFor(toy)·N, and spacing hops 10·N·sendsFor
 * apart keeps a landing near 100 metered a second whatever N is. A constant spacing would be
 * 192 a second for twelve people landing on a table. Never paced: it is a rate, not a wait.
 */
export const hopMs = (people: number, toy: string) => Math.max(250, 10 * people * sendsFor(toy))

/**
 * When the latest departure's last rider lands, by this browser's clock: Come too is taken until
 * then — by the host (decide), by this browser for its own press (meant, hopPlan), and offered on
 * screen until then (busWords). Nought before the first departure.
 */
export function landedAt(bus: Pick<Bus, 'stops' | 'leaveAt' | 'went'>, people: number) {
  const stop = bus.stops[bus.stops.length - 1]
  return stop ? bus.leaveAt + bus.went.length * hopMs(people, stop.toy) : 0
}

/** how many of a stop's games may star: about one per two riders who went, at least one */
export const capFor = (went: number, k: Knobs): 1 | 2 | 3 =>
  Math.min(k.GAMES_CAP, 3, Math.max(1, Math.ceil(went / 2))) as 1 | 2 | 3

/* ── the value ─────────────────────────────────────────────────────────────────────────────── */

export type Faces = [string, string, string]
/** `stars` and `played` are null when not known here: a fact about somebody absent is not sent */
export type Rider = { id: string; on: boolean; stars: number | null; played: number | null }
/** a departure: the toy, how many of its games may star, the games counted, who won one there */
export type Stop = {
  toy: string
  cap: 1 | 2 | 3
  games: [g: number, i0: number, i1: number][]
  won: number[]
}
export type Phase = 'pick' | 'choose' | 'ready' | 'end'

export type Bus = {
  me: string
  /** the host's count of changes, and who published the one held */
  seq: number
  from: string
  /** [a-z0-9]{8}; '' while no tour is held — the listening below needs a home before one is */
  tour: string
  len: number
  /** boarding order, which is the turn order; never shrinks, so an index names one rider */
  riders: Rider[]
  /** whose turn it is to roll, as an index into riders */
  guide: number
  phase: Phase
  /** choose only */
  faces: Faces | null
  /** ready only */
  toy: string | null
  /** this departure's answers, by index */
  ready: number[]
  no: number[]
  /** the last departure's riders, and those seated in a begun game at its stop */
  went: number[]
  busy: number[]
  /** every departure so far; a toy is a stop at most once in a tour */
  stops: Stop[]
  /**
   * Clocks, in this browser's performance.now(), re-armed on receipt from the time remaining.
   * `due` is when the host acts on its own in this phase: the dice choose (choose), the bus leaves
   * (ready), or the tour ends for want of anybody asking for anything (pick).
   */
  due: number
  readyAt: number
  openAt: number
  holdUntil: number
  freeAt: number
  leaveAt: number
  /* local only, never sent */
  /** whether I may lead and offer Start: I have listened for SYNC_MS, or heard the tour */
  heard: boolean
  /** when I started listening for it: on arriving, or on coming back as the one who would lead */
  syncAt: number
  /** whether I am still asking for the tour, and the hellos sent since syncAt, the last when */
  asking: boolean
  hellos: number
  lastHello: number
  /** whether I was live at the last tick, so coming back is noticed */
  live: boolean
  /** the last repair hello, and the last answer to a host leading from a stale bus */
  repairAt: number
  answerAt: number
  /** ready requests counted per person and window (`id:n:toy`), and sits per person and stop */
  presses: Record<string, number>
  sits: Record<string, number>
  /** since when the guide has been away: kept by everybody holding the tour, used by its host */
  guideAway: number | null
  /** since when no rider has been here */
  quietSince: number | null
}

/** what this browser knows that the bus reads: everything here is about now */
export type Ctx = {
  now: number
  /** ids on a Lab toy now (gate.ts's onToysNow), and mine while I am live */
  present: ReadonlySet<string>
  roster: ReadonlySet<string>
  /** my gate allows, I am sharing, on the Lab, my tab visible and a toy on screen */
  meLive: boolean
  /** the toy somebody present is on, as their `where` says */
  subOf: (id: string) => string | null
  /** everybody on the call, which is what each send is metered by */
  people: number
  k: Knobs
}

/* ── the wire: one party kind, `bus`, and every body says `v: 1` ──────────────────────────── */

export type Req =
  | { v: 1; t: 'roll'; tour: string; n: number; faces: Faces; anyway?: true }
  | { v: 1; t: 'pick'; tour: string; n: number; toy: string }
  /** `toy`: the window's, or for Come too the stop's — what the press was for (`meant`) */
  | { v: 1; t: 'ready'; tour: string; n: number; toy: string; on: boolean }
  | { v: 1; t: 'go'; tour: string; n: number }
  | { v: 1; t: 'off'; tour: string }
  | { v: 1; t: 'fin'; tour: string; anyway?: true }
  | { v: 1; t: 'sit'; tour: string; n: number; on: boolean }
  /* step 7 of the plan: a finished game reported by a seated rider; typed here, not yet counted */
  | {
      v: 1
      t: 'game'
      tour: string
      n: number
      sub: string
      g: number
      seats: Seats
      how: 'win' | 'draw' | 'cpu'
      won: string[]
    }

/** the whole bus, with each clock as the ms remaining when it was sent */
export type State = {
  v: 1
  t: 'state'
  seq: number
  tour: string
  len: number
  riders: [id: string, on: 0 | 1, stars: number | null, played: number | null][]
  guide: number
  phase: Phase
  faces: Faces | null
  toy: string | null
  ready: number[]
  no: number[]
  went: number[]
  busy: number[]
  stops: Stop[]
  left: number
  open: number
  free: number
  hold: number
  leave: number
}
export type Hello = { v: 1; t: 'hello' }
export type Msg = Req | State | Hello

/** what a step asks to send: a request as it stands, or a state serialised when it goes */
export type Out = Req | Hello | { t: 'state' }
export type Step = { bus: Bus; out: Out[] }

/* ── who is who ────────────────────────────────────────────────────────────────────────────── */

/** a bus with no tour, as it is when I start listening */
export function listen(me: string, now: number): Bus {
  return {
    me,
    seq: 0,
    from: me,
    tour: '',
    len: 0,
    riders: [],
    guide: 0,
    phase: 'end',
    faces: null,
    toy: null,
    ready: [],
    no: [],
    went: [],
    busy: [],
    stops: [],
    due: 0,
    readyAt: 0,
    openAt: 0,
    holdUntil: 0,
    freeAt: 0,
    leaveAt: 0,
    heard: false,
    syncAt: now,
    asking: true,
    hellos: 0,
    lastHello: Number.NEGATIVE_INFINITY,
    live: false,
    repairAt: Number.NEGATIVE_INFINITY,
    answerAt: Number.NEGATIVE_INFINITY,
    presses: {},
    sits: {},
    guideAway: null,
    quietSince: null,
  }
}

export const holds = (bus: Bus) => bus.tour !== ''
export const TOUR_ID = /^[a-z0-9]{8}$/
/** a tour id from eight random bytes (crypto.getRandomValues), so the pure code needs no crypto */
export const tourIdFrom = (bytes: ArrayLike<number>) =>
  Array.from({ length: 8 }, (_, i) => 'abcdefghijklmnopqrstuvwxyz0123456789'[bytes[i] % 36]).join(
    '',
  )

const indexOf = (bus: Bus, id: string) => bus.riders.findIndex((r) => r.id === id)

/** the riders on the Lab now, by id: who may host, in the order that decides it */
export const hostSet = (bus: Bus, present: ReadonlySet<string>) =>
  bus.riders
    .filter((r) => r.on && present.has(r.id))
    .map((r) => r.id)
    .sort()
export const hostOf = (bus: Bus, ctx: Pick<Ctx, 'present'>): string | null =>
  hostSet(bus, ctx.present)[0] ?? null
/**
 * Whether I decide: live, having heard the tour rather than leading from a stale copy, a rider
 * here — and the host, or the one who published the bus we hold.
 *
 * ⚠️ THE PUBLISHER KEEPS DECIDING UNTIL THE NEW HOST HAS PUBLISHED. Somebody boarding with a lower
 * id is host by everyone's reckoning the moment the host appends them — before their own browser
 * has heard that they are on the bus at all. At the first stop everybody boards at once, and every
 * other yes already on its way reached a host that did not yet know it was one, and was lost:
 * measured in bus.test.ts, four of six riders left off a bus they had said yes to. So, as with a
 * newcomer's hello (room.ts's answersHello), whoever published the bus we hold goes on deciding
 * until the host publishes its own. Two deciding for a moment hold the same bus and hear the same
 * requests, so they decide alike; where they differ, `newer` settles it as for two hosts.
 */
export function leads(bus: Bus, ctx: Ctx): boolean {
  if (!holds(bus) || !ctx.meLive || !bus.heard) return false
  const set = hostSet(bus, ctx.present)
  return set[0] === bus.me || (set.includes(bus.me) && bus.from === bus.me)
}

/**
 * Whose turn it is next: the first rider after the guide, in boarding order and wrapping round,
 * who is on the bus and here. Nobody else here and the guide keeps it.
 *
 * ⚠️ BOARDING ORDER, NOT IDS. Ids are the host's tie-break and nothing more; the turn goes round
 * the people in the order they got on, which is the order the scoreboard shows them in.
 */
export function nextGuide(bus: Pick<Bus, 'riders' | 'guide'>, present: ReadonlySet<string>) {
  const n = bus.riders.length
  for (let step = 1; step <= n; step++) {
    const j = (bus.guide + step) % n
    if (bus.riders[j].on && present.has(bus.riders[j].id)) return j
  }
  return bus.guide
}

/**
 * Whether the roll waits for a game: at a call-table stop, somebody here is seated in a begun,
 * unfinished game there, the stop still has stars to give, and the hold has not run out.
 */
export function holdOn(bus: Bus, ctx: Pick<Ctx, 'now' | 'present'>): boolean {
  const stop = bus.stops[bus.stops.length - 1]
  if (bus.phase !== 'pick' || !stop || !ROOM_TOYS.has(stop.toy)) return false
  if (stop.games.length >= stop.cap || ctx.now >= bus.holdUntil) return false
  return bus.busy.some((i) => ctx.present.has(bus.riders[i]?.id))
}

/** a tour nobody on it has been here for, for ABANDON_MS */
export const abandoned = (bus: Bus, ctx: Pick<Ctx, 'now' | 'k'>) =>
  holds(bus) && bus.quietSince !== null && ctx.now - bus.quietSince >= ctx.k.ABANDON_MS

/** whether I may start a tour: I have listened, I am live, and there is no live tour to find */
export const canStart = (bus: Bus, ctx: Ctx) =>
  bus.heard && ctx.meLive && (!holds(bus) || bus.phase === 'end' || abandoned(bus, ctx))

/* ── the host ──────────────────────────────────────────────────────────────────────────────── */

const none = (bus: Bus): Step => ({ bus, out: [] })
const plus = (xs: number[], i: number) => (xs.includes(i) ? xs : [...xs, i])
const minus = (xs: number[], i: number) => (xs.includes(i) ? xs.filter((x) => x !== i) : xs)

/** the host's answer to a change: the bus one seq on, its clocks brought up to date */
function publish(bus: Bus, ctx: Ctx, patch: Partial<Bus>): Step {
  const next = clocked({ ...bus, ...patch, seq: bus.seq + 1, from: bus.me }, ctx)
  return { bus: next, out: [{ t: 'state' }] }
}

/**
 * `freeAt`, when any rider may roll for an idle guide: IDLE_MS after the roll opened, or after the
 * hold lifted if it was holding. While it holds, the latest it can lift is `holdUntil`.
 */
function clocked(bus: Bus, ctx: Ctx): Bus {
  if (bus.phase !== 'pick') return bus
  const free = holdOn(bus, ctx)
    ? bus.holdUntil + ctx.k.IDLE_MS
    : Math.min(bus.freeAt, Math.max(bus.openAt, ctx.now) + ctx.k.IDLE_MS)
  return free === bus.freeAt ? bus : { ...bus, freeAt: free }
}

/** the turn passes: a new guide gets the whole of IDLE_MS before anybody may roll for them */
function passTurn(bus: Bus, ctx: Ctx, guide: number): Partial<Bus> {
  const openAt = Math.max(bus.openAt, ctx.now)
  return { guide, openAt, freeAt: openAt + ctx.k.IDLE_MS, guideAway: null }
}

/** the guide rolls once the dwell is over and nothing holds; anybody else only once it is free */
function mayRoll(bus: Bus, ctx: Ctx, from: string, anyway: boolean) {
  const guide = bus.riders[bus.guide]
  if (guide?.id === from) return guide.on && ctx.now >= bus.openAt && (anyway || !holdOn(bus, ctx))
  const r = bus.riders[indexOf(bus, from)]
  /* ⚠️ "ANYWAY" IS THE GUIDE'S ALONE. It overrides somebody's game in progress, so it belongs to
     the one person the turn gives that choice to — anybody else asking it is refused outright. */
  return !anyway && !!r?.on && ctx.present.has(from) && ctx.now >= bus.freeAt
}

/** three distinct toys, none already a stop */
function facesFit(bus: Bus, faces: Faces) {
  const visited = new Set(bus.stops.map((s) => s.toy))
  return new Set(faces).size === 3 && faces.every((f) => !visited.has(f))
}

/** the bus leaves: the riders here who said yes go, and the turn passes */
function depart(bus: Bus, ctx: Ctx): Partial<Bus> {
  const { k, now } = ctx
  const toy = bus.toy!
  const went = bus.ready.filter((i) => ctx.present.has(bus.riders[i].id))
  const leaveAt = now + k.COUNT_MS
  const openAt = leaveAt + Math.max(0, went.length - 1) * hopMs(ctx.people, toy) + k.DWELL_MS
  return {
    phase: 'pick',
    stops: [...bus.stops, { toy, cap: capFor(went.length, k), games: [], won: [] }],
    went,
    busy: [],
    ready: [],
    no: [],
    toy: null,
    faces: null,
    leaveAt,
    openAt,
    holdUntil: openAt + k.HOLD_MAX_MS,
    freeAt: openAt + k.IDLE_MS,
    guide: nextGuide(bus, ctx.present),
    guideAway: null,
    due: now + k.TOUR_IDLE_MS,
  }
}

/** nobody here said yes: no departure, and the turn passes at once — there is no dwell to wait */
function skip(bus: Bus, ctx: Ctx): Partial<Bus> {
  return {
    phase: 'pick',
    ready: [],
    no: [],
    toy: null,
    faces: null,
    guide: nextGuide(bus, ctx.present),
    guideAway: null,
    openAt: ctx.now,
    freeAt: ctx.now + ctx.k.IDLE_MS,
    due: ctx.now + ctx.k.TOUR_IDLE_MS,
  }
}

/**
 * The host acting on a request — its own press, or somebody else's off the wire. Every request is
 * checked again here whatever the sender's own browser decided: its role, the phase, which
 * departure it is about, the clocks, that the sender is here (for `ready` and `sit`), and the
 * sender's caps.
 */
export function decide(bus: Bus, ctx: Ctx, from: string, q: Req): Step {
  if (!holds(bus) || q.tour !== bus.tour || bus.phase === 'end') return none(bus)
  const { k, now } = ctx
  const i = indexOf(bus, from)
  const rider = i >= 0 ? bus.riders[i] : null
  const here = ctx.present.has(from)
  const next = bus.stops.length + 1
  const isGuide = rider !== null && rider.on && bus.guide === i
  /* the clock that ends a quiet tour restarts with every request accepted between stops */
  const stir = bus.phase === 'pick' ? { due: now + k.TOUR_IDLE_MS } : {}

  if (q.t === 'roll') {
    if (bus.phase !== 'pick' || bus.stops.length >= bus.len || q.n !== next) return none(bus)
    if (!facesFit(bus, q.faces) || !mayRoll(bus, ctx, from, !!q.anyway)) return none(bus)
    return publish(bus, ctx, { phase: 'choose', faces: q.faces, due: now + k.CHOOSE_MS })
  }
  if (q.t === 'fin') {
    if (bus.phase !== 'pick' || bus.stops.length < bus.len) return none(bus)
    if (!mayRoll(bus, ctx, from, !!q.anyway)) return none(bus)
    return publish(bus, ctx, { phase: 'end', ready: [], no: [], toy: null, faces: null })
  }
  if (q.t === 'pick') {
    if (bus.phase !== 'choose' || q.n !== next || !isGuide) return none(bus)
    if (!bus.faces?.includes(q.toy)) return none(bus)
    /* the guide's pick is the guide's own yes */
    return publish(bus, ctx, {
      phase: 'ready',
      toy: q.toy,
      faces: null,
      ready: [bus.guide],
      no: [],
      readyAt: now,
      due: now + k.READY_MS,
    })
  }
  if (q.t === 'go') {
    if (bus.phase !== 'ready' || q.n !== next || !isGuide) return none(bus)
    if (now < bus.readyAt + k.READY_MIN_MS) return none(bus)
    if (!bus.ready.some((j) => ctx.present.has(bus.riders[j].id))) return none(bus)
    return publish(bus, ctx, depart(bus, ctx))
  }
  if (q.t === 'off') {
    if (!rider?.on) return none(bus)
    const riders = bus.riders.map((r, j) => (j === i ? { ...r, on: false } : r))
    const patch: Partial<Bus> = {
      riders,
      ready: minus(bus.ready, i),
      no: minus(bus.no, i),
      busy: minus(bus.busy, i),
      ...stir,
    }
    if (!riders.some((r) => r.on))
      return publish(bus, ctx, { ...patch, phase: 'end', toy: null, faces: null })
    const after = { ...bus, ...patch }
    const j = bus.guide === i ? nextGuide(after, ctx.present) : i
    return publish(bus, ctx, { ...patch, ...(j !== i ? passTurn(after, ctx, j) : {}) })
  }
  if (q.t === 'sit') {
    /* ⚠️ IN EVERY PHASE BUT THE END, NOT ONLY BETWEEN STOPS. A game goes on through the roll and
       the ready check, and ends when it ends: a stand-up refused there left `busy` naming somebody
       whose game was over, a skipped window kept it, and the next guide's roll was held by nobody
       for up to five minutes — with the sender's two sits spent, so nothing could clear it. The
       hold reads `busy` only between stops, so keeping it true the rest of the time costs nothing,
       and a skip inherits the truth. (The end is refused above.) */
    if (!bus.stops.length || q.n !== bus.stops.length) return none(bus)
    if (!rider?.on || !here) return none(bus)
    const key = `${from}:${q.n}`
    const used = bus.sits[key] ?? 0
    if (used >= k.SIT_SENDS) return none(bus)
    const counted = { ...bus, sits: { ...bus.sits, [key]: used + 1 } }
    const busy = q.on ? plus(bus.busy, i) : minus(bus.busy, i)
    if (busy === bus.busy) return none(counted)
    return publish(counted, ctx, { busy, ...stir })
  }
  if (q.t === 'ready') {
    if (!here) return none(bus)
    const last = bus.stops.length
    const window = bus.phase === 'ready' && q.n === next && q.toy === bus.toy
    const comeToo =
      bus.phase === 'pick' && last > 0 && q.n === last && q.toy === bus.stops[last - 1].toy
    if (!window && !(comeToo && q.on)) return none(bus)
    /* ⚠️ COUNTED PER WINDOW, NOT PER DEPARTURE. A skipped window leaves the departure's number
       where it was, so a count keyed by it alone carried a skipped window's three presses into
       the next one — and a rider's first yes to a new toy, with a new guide, was dropped without
       a word, here and in their own browser alike (ask). So the window's toy is in the key. */
    const key = `${from}:${q.n}:${q.toy}`
    const used = bus.presses[key] ?? 0
    if (used >= k.READY_SENDS) return none(bus)
    const counted = { ...bus, presses: { ...bus.presses, [key]: used + 1 } }
    /* Come too: after a departure, while its riders are still landing; you land after them */
    if (comeToo && now >= landedAt(bus, ctx.people)) return none(counted)
    let riders = bus.riders
    let j = i
    if (q.on) {
      /* pressing yes is boarding: a newcomer is appended, a rider who hopped off is back on */
      if (j < 0) {
        if (riders.length >= k.MAX_RIDERS) return none(counted)
        riders = [...riders, { id: from, on: true, stars: 0, played: 0 }]
        j = riders.length - 1
      } else if (!riders[j].on) riders = riders.map((r, x) => (x === j ? { ...r, on: true } : r))
    } else if (j < 0 || !riders[j].on) return none(counted)
    if (comeToo) {
      const went = plus(bus.went, j)
      if (went === bus.went && riders === bus.riders) return none(counted)
      return publish(counted, ctx, { riders, went, ...stir })
    }
    const ready = q.on ? plus(bus.ready, j) : minus(bus.ready, j)
    const no = q.on ? minus(bus.no, j) : plus(bus.no, j)
    if (riders === bus.riders && ready === bus.ready && no === bus.no) return none(counted)
    return publish(counted, ctx, { riders, ready, no })
  }
  /* `game`: counted from step 7 of the plan */
  return none(bus)
}

/**
 * The clock: the host's timed transitions, and everyone's own bookkeeping. Silent unless the bus
 * changed — ⚠️ A TICK THAT PUBLISHED EVERY TIME WOULD BE A HEARTBEAT, and the bus has none: with no
 * change, nothing is sent.
 */
export function tick(bus: Bus, ctx: Ctx): Step {
  const { k, now } = ctx
  let b = bus
  const said: Out[] = []
  /* ⚠️ BACK LIVE, HOLDING A TOUR I WOULD LEAD: LISTEN BEFORE LEADING IT. A tab that was hidden or
     paused kept listening, but anything lost while it was away would have it lead from an older
     bus than everybody else's — so it asks, and leads once it has heard, or after SYNC_MS.
     Coming back is noticed as `live` changing between ticks, so whoever drives this must tick
     whenever meLive changes, not only on a timer. */
  if (ctx.meLive && !b.live && holds(b) && b.phase !== 'end' && hostOf(b, ctx) === b.me)
    b = { ...b, heard: false, asking: true, syncAt: now, hellos: 0 }
  if (ctx.meLive !== b.live) b = { ...b, live: ctx.meLive }
  /* ask whoever else is here for the tour: once, and once more after HELLO_RETRY_MS. Nobody else
     here, nobody to ask — and with nobody else on the Lab, nothing is sent at all */
  const others = [...ctx.present].some((id) => id !== b.me)
  const due = b.hellos === 0 || (b.hellos === 1 && now - b.lastHello >= k.HELLO_RETRY_MS)
  if (b.asking && ctx.meLive && others && due) {
    b = { ...b, hellos: b.hellos + 1, lastHello: now }
    said.push({ v: 1, t: 'hello' })
  }
  if (holds(b)) {
    const anyone = b.riders.some((r) => r.on && ctx.present.has(r.id))
    const quietSince = anyone ? null : (b.quietSince ?? now)
    if (quietSince !== b.quietSince) b = { ...b, quietSince }
    /* ⚠️ EVERYBODY HOLDING THE TOUR KEEPS THE GUIDE'S CLOCK, NOT ONLY ITS HOST. The clock is never
       sent, so one kept by the host alone started again from nought at every change of host:
       measured, a guide gone at t0 with the host leaving 15 s later lost the turn at 35.1 s, not
       20. Only the turn to roll or to choose can be lost, so only then does the clock run. */
    const g = b.riders[b.guide]
    const turn = b.phase === 'pick' || b.phase === 'choose'
    const guideAway = turn && (!g.on || !ctx.present.has(g.id)) ? (b.guideAway ?? now) : null
    if (guideAway !== b.guideAway) b = { ...b, guideAway }
  }
  if (!b.heard && now - b.syncAt >= k.SYNC_MS) b = { ...b, heard: true }
  if (!leads(b, ctx) || b.phase === 'end') return { bus: b, out: said }

  let w = b
  let changed = false
  const change = (patch: Partial<Bus>) => {
    w = { ...w, ...patch }
    changed = true
  }
  /* the guide is away, or has hopped off: the turn passes after GUIDE_GONE_MS, or at once */
  if (w.guideAway !== null) {
    const g = w.riders[w.guide]
    if (!g.on || now - w.guideAway >= k.GUIDE_GONE_MS) {
      const j = nextGuide(w, ctx.present)
      if (j !== w.guide) change(passTurn(w, ctx, j))
    }
  }
  if (w.phase === 'choose' && now >= w.due) {
    /* ⚠️ THE DICE CHOOSE, AND NOBODY SAID YES. The guide's pick is their yes; a timeout is not a
       pick, so `ready` starts empty and the guide is asked like everybody else */
    change({
      phase: 'ready',
      toy: w.faces![0],
      faces: null,
      ready: [],
      no: [],
      readyAt: now,
      due: now + k.READY_MS,
    })
  }
  if (w.phase === 'ready') {
    const toy = w.toy
    const answered = w.riders.every(
      (r, i) =>
        !r.on ||
        !ctx.present.has(r.id) ||
        w.ready.includes(i) ||
        w.no.includes(i) ||
        ctx.subOf(r.id) === toy,
    )
    if (now >= w.due || (now >= w.readyAt + k.READY_MIN_MS && answered)) {
      const going = w.ready.some((i) => ctx.present.has(w.riders[i].id))
      change(going ? depart(w, ctx) : skip(w, ctx))
    }
  }
  if (w.phase === 'pick' && now >= w.due) change({ phase: 'end', toy: null, faces: null })
  if (!changed) {
    const c = clocked(w, ctx)
    if (c === w) return { bus: w, out: said }
    w = c
  }
  const p = publish(w, ctx, {})
  return { bus: p.bus, out: [...said, ...p.out] }
}

/* ── presses here ──────────────────────────────────────────────────────────────────────────── */

/**
 * Take me there, Come too, Stay here or Not this one — with the departure and the toy its button
 * named when it was drawn (busWords puts them on the button), which `meant` reads it against.
 */
export type Answer = { t: 'ready'; on: boolean; n: number; toy: string }
export type Press =
  | { t: 'roll'; faces: Faces; anyway?: boolean }
  | { t: 'pick'; toy: string }
  | Answer
  | { t: 'go' }
  | { t: 'off' }
  | { t: 'fin'; anyway?: boolean }
  | { t: 'sit'; on: boolean }

/**
 * What an answer pressed here means against the bus held now: a yes or a no to the window that is
 * boarding, Come too for the stop just left while its riders are still landing — or nothing.
 *
 * ⚠️ A PRESS MEANS WHAT ITS BUTTON SAID, NEVER WHAT THE PHASE NOW IMPLIES. The button is drawn
 * from one bus and pressed against whichever is held by the time the press is handled, and a
 * window can be skipped in between. Read from the phase alone, a Take me there for Hex that landed
 * just after the skip was Come too for the stop before, long after its landing, and moved somebody
 * to Four in a row — a toy the button never named. So an answer carries the departure and the toy
 * its button named, and one the bus has moved past does nothing at all: no consent, no request.
 * The panel can ask this to say so (busWords's missedWords).
 */
export function meant(bus: Bus, ctx: Pick<Ctx, 'now' | 'people'>, p: Answer) {
  if (!holds(bus)) return null
  const last = bus.stops.length
  if (bus.phase === 'ready') return p.n === last + 1 && p.toy === bus.toy ? 'window' : null
  if (bus.phase !== 'pick' || !last || !p.on) return null
  if (p.n !== last || p.toy !== bus.stops[last - 1].toy) return null
  return ctx.now < landedAt(bus, ctx.people) ? 'come' : null
}

/** the request a press makes, or null for one that asks nothing of anybody */
function requestFor(bus: Bus, ctx: Ctx, p: Press): Req | null {
  const { tour } = bus
  const next = bus.stops.length + 1
  const last = bus.stops.length
  switch (p.t) {
    case 'roll':
      return { v: 1, t: 'roll', tour, n: next, faces: p.faces, ...(p.anyway && { anyway: true }) }
    case 'pick':
      return { v: 1, t: 'pick', tour, n: next, toy: p.toy }
    case 'go':
      return { v: 1, t: 'go', tour, n: next }
    case 'off':
      return { v: 1, t: 'off', tour }
    case 'fin':
      return { v: 1, t: 'fin', tour, ...(p.anyway && { anyway: true }) }
    case 'sit':
      return last ? { v: 1, t: 'sit', tour, n: last, on: p.on } : null
    case 'ready':
      /* an answer to the window, or Come too; Stay here during the count is this browser's
         alone, and an answer the bus has moved past asks nothing of anybody */
      return meant(bus, ctx, p) ? { v: 1, t: 'ready', tour, n: p.n, toy: p.toy, on: p.on } : null
  }
}

/**
 * A button pressed here: the host decides it at once, anybody else asks.
 *
 * ⚠️ A PRESS PAST ITS CAP STAYS HERE. Three ready requests a window and two sits a stop are
 * what anybody's browser sends; a fourth press still changes this browser's own consent
 * (consentAfter), which is what moves it, and the host simply goes on believing the third.
 */
export function ask(bus: Bus, ctx: Ctx, p: Press): Step {
  if (!holds(bus) || !ctx.meLive || bus.phase === 'end') return none(bus)
  const q = requestFor(bus, ctx, p)
  if (!q) return none(bus)
  if (leads(bus, ctx)) return decide(bus, ctx, bus.me, q)
  if (q.t === 'ready') {
    /* per window, as the host counts them (decide) */
    const key = `${bus.me}:${q.n}:${q.toy}`
    const used = bus.presses[key] ?? 0
    if (used >= ctx.k.READY_SENDS) return none(bus)
    return { bus: { ...bus, presses: { ...bus.presses, [key]: used + 1 } }, out: [q] }
  }
  if (q.t === 'sit') {
    const key = `${bus.me}:${q.n}`
    const used = bus.sits[key] ?? 0
    if (used >= ctx.k.SIT_SENDS) return none(bus)
    return { bus: { ...bus, sits: { ...bus.sits, [key]: used + 1 } }, out: [q] }
  }
  return { bus, out: [q] }
}

/** a new tour, with me its only rider and its first guide */
export function startTour(bus: Bus, ctx: Ctx, tour: string): Step {
  if (!canStart(bus, ctx) || !TOUR_ID.test(tour)) return none(bus)
  const { k, now } = ctx
  return {
    bus: {
      ...bus,
      seq: bus.seq + 1,
      from: bus.me,
      tour,
      len: k.STOPS,
      riders: [{ id: bus.me, on: true, stars: 0, played: 0 }],
      guide: 0,
      phase: 'pick',
      faces: null,
      toy: null,
      ready: [],
      no: [],
      went: [],
      busy: [],
      stops: [],
      due: now + k.TOUR_IDLE_MS,
      readyAt: 0,
      openAt: now,
      holdUntil: 0,
      freeAt: now + k.IDLE_MS,
      leaveAt: 0,
      asking: false,
      presses: {},
      sits: {},
      guideAway: null,
      quietSince: null,
    },
    out: [{ t: 'state' }],
  }
}

/* ── the state on the wire ─────────────────────────────────────────────────────────────────── */

const remaining = (at: number, now: number) =>
  Math.min(MAX_TIMER_MS, Math.max(0, Math.round(at - now)))

/**
 * The bus as it goes out, serialised at send time so its clocks are current.
 *
 * ⚠️ A FACT ABOUT A PERSON GOES OUT ONLY WHILE THAT PERSON IS LIVE IN THE SENDER'S VIEW. Their own
 * `where` then names a toy, so their own gate is open and everybody present is their friend. For
 * anybody else — paused, gone, or never sharing with whoever is here now — their answer this
 * departure, whether they went, whether they are playing, their stars and games, and the stops
 * they won are all left off. So once Ann has paused or left, a newcomer (or a patched client)
 * never learns what Ann did; receivers who already knew keep it (mergeKnown). Tour-level facts —
 * the faces, the stops, whose turn it is, the riders' ids, which are the call's own `from`s — go
 * out under the sender's gate, as `where`'s toy does.
 */
export function wireOf(bus: Bus, present: ReadonlySet<string>, now: number): State {
  const live = (i: number) => present.has(bus.riders[i]?.id)
  const only = (xs: number[]) => xs.filter(live)
  return {
    v: 1,
    t: 'state',
    seq: bus.seq,
    tour: bus.tour,
    len: bus.len,
    riders: bus.riders.map((r, i) => [
      r.id,
      r.on ? 1 : 0,
      live(i) ? r.stars : null,
      live(i) ? r.played : null,
    ]),
    guide: bus.guide,
    phase: bus.phase,
    faces: bus.faces,
    toy: bus.toy,
    ready: only(bus.ready),
    no: only(bus.no),
    went: only(bus.went),
    busy: only(bus.busy),
    stops: bus.stops.map((s) => ({
      toy: s.toy,
      cap: s.cap,
      games: s.games.map(([g, i0, i1]) => [g, i0, i1]),
      won: only(s.won),
    })),
    left: remaining(bus.due, now),
    open: remaining(bus.openAt, now),
    free: remaining(bus.freeAt, now),
    hold: remaining(bus.holdUntil, now),
    leave: remaining(bus.leaveAt, now),
  }
}

/** the most a body may weigh: a state is about 1.5 kB at its largest, a request under 200 B */
export const MAX_BODY_BYTES = 4096

const PHASES: readonly Phase[] = ['pick', 'choose', 'ready', 'end']
const HOWS = ['win', 'draw', 'cpu'] as const
const int = (v: unknown, lo: number, hi: number): v is number =>
  Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
/** distinct whole numbers, each an index into a list `n` long */
const indexes = (v: unknown, n: number): v is number[] =>
  Array.isArray(v) && v.every((i) => int(i, 0, n - 1)) && new Set(v).size === v.length
const isFaces = (v: unknown): v is Faces =>
  Array.isArray(v) && v.length === 3 && v.every(isToyId) && new Set(v).size === 3
/** `anyway` is true or absent; anything else is a malformed body */
const anywayOf = (v: unknown) =>
  v === undefined ? {} : v === true ? { anyway: true as const } : null
const bytes = (x: unknown) => {
  try {
    return new TextEncoder().encode(JSON.stringify(x)).length
  } catch {
    return Infinity
  }
}

/**
 * A `bus` body off the wire, every field checked, or null. ⚠️ ONE BAD FIELD REFUSES THE WHOLE
 * MESSAGE: nothing is half-believed. This checks shape — what can be known from the body alone —
 * and decide() checks it again against the bus (which departure, whose turn, which faces).
 */
export function readBus(x: unknown): Msg | null {
  if (!isObj(x) || x.v !== 1 || typeof x.t !== 'string') return null
  if (bytes(x) > MAX_BODY_BYTES) return null
  if (x.t === 'hello') return { v: 1, t: 'hello' }
  if (x.t === 'state') return readState(x)
  const { tour, n } = x
  if (typeof tour !== 'string' || !TOUR_ID.test(tour)) return null
  if (x.t === 'off') return { v: 1, t: 'off', tour }
  if (x.t === 'fin') {
    const anyway = anywayOf(x.anyway)
    return anyway && { v: 1, t: 'fin', tour, ...anyway }
  }
  /* every other request is about one departure: there are at most eight */
  if (!int(n, 1, 8)) return null
  if (x.t === 'roll') {
    const anyway = anywayOf(x.anyway)
    if (!isFaces(x.faces) || !anyway) return null
    return { v: 1, t: 'roll', tour, n, faces: [...x.faces], ...anyway }
  }
  if (x.t === 'pick') return isToyId(x.toy) ? { v: 1, t: 'pick', tour, n, toy: x.toy } : null
  if (x.t === 'go') return { v: 1, t: 'go', tour, n }
  if (x.t === 'sit') return typeof x.on === 'boolean' ? { v: 1, t: 'sit', tour, n, on: x.on } : null
  if (x.t === 'ready')
    return typeof x.on === 'boolean' && isToyId(x.toy)
      ? { v: 1, t: 'ready', tour, n, toy: x.toy, on: x.on }
      : null
  if (x.t === 'game') {
    const seats = readSeats(x.seats)
    const how = HOWS.find((h) => h === x.how)
    const won = x.won
    if (!isToyId(x.sub) || !int(x.g, 1, 1e6) || !seats || !how) return null
    if (!Array.isArray(won) || !won.every((id) => typeof id === 'string')) return null
    if (new Set(won).size !== won.length) return null
    /* a win names one or two of the players seated; a draw or the computer's win names nobody */
    if (
      how === 'win'
        ? !won.length || won.length > 2 || !won.every((id) => seats.includes(id))
        : won.length
    )
      return null
    return { v: 1, t: 'game', tour, n, sub: x.sub, g: x.g, seats, how, won: [...won] }
  }
  return null
}

function readState(x: Record<string, unknown>): State | null {
  const { seq, tour, len, riders, guide, phase, faces, toy, ready, no, went, busy, stops } = x
  if (!int(seq, 1, 1e9) || typeof tour !== 'string' || !TOUR_ID.test(tour)) return null
  if (!int(len, 1, 8) || !Array.isArray(riders) || riders.length < 1 || riders.length > 16)
    return null
  /* a rider's stars or games: unknown here, or at most three games at each stop */
  const tally = (v: unknown): v is number | null => v === null || int(v, 0, 3 * len)
  const rs: State['riders'] = []
  for (const r of riders) {
    if (!Array.isArray(r) || r.length !== 4) return null
    const [id, on, stars, played] = r as unknown[]
    if (typeof id !== 'string' || id.length < 1 || id.length > 64) return null
    if ((on !== 0 && on !== 1) || !tally(stars) || !tally(played)) return null
    rs.push([id, on, stars, played])
  }
  if (new Set(rs.map((r) => r[0])).size !== rs.length) return null
  const n = rs.length
  if (!int(guide, 0, n - 1) || !PHASES.includes(phase as Phase)) return null
  if (!Array.isArray(stops) || stops.length > len) return null
  const ss: Stop[] = []
  for (const s of stops) {
    if (!isObj(s) || !isToyId(s.toy) || !int(s.cap, 1, 3)) return null
    const cap = s.cap as Stop['cap']
    if (!Array.isArray(s.games) || s.games.length > cap) return null
    const games: Stop['games'] = []
    for (const g of s.games) {
      if (!Array.isArray(g) || g.length !== 3 || !int(g[0], 1, 1e6)) return null
      if (!int(g[1], -1, n - 1) || !int(g[2], -1, n - 1)) return null
      games.push([g[0], g[1], g[2]])
    }
    if (!indexes(s.won, n) || s.won.length > 2 * cap) return null
    ss.push({ toy: s.toy, cap, games, won: [...s.won] })
  }
  const visited = new Set(ss.map((s) => s.toy))
  if (visited.size !== ss.length) return null
  /* the faces exactly while choosing, the toy exactly while boarding: neither already a stop */
  if ((phase === 'choose') !== (faces !== null)) return null
  if (faces !== null && (!isFaces(faces) || faces.some((f) => visited.has(f)))) return null
  if ((phase === 'ready') !== (toy !== null)) return null
  if (toy !== null && (!isToyId(toy) || visited.has(toy))) return null
  if (!indexes(ready, n) || !indexes(no, n) || !indexes(went, n) || !indexes(busy, n)) return null
  if (ready.some((i) => no.includes(i))) return null
  const { left, open, free, hold, leave } = x
  if (![left, open, free, hold, leave].every((t) => int(t, 0, MAX_TIMER_MS))) return null
  /* a counted game stars at most its two players */
  const stars = rs.reduce((a, r) => a + (r[2] ?? 0), 0)
  if (stars > 2 * ss.reduce((a, s) => a + s.games.length, 0)) return null
  return {
    v: 1,
    t: 'state',
    seq,
    tour,
    len,
    riders: rs,
    guide,
    phase: phase as Phase,
    faces: faces === null ? null : [...(faces as Faces)],
    toy: toy as string | null,
    ready: [...ready],
    no: [...no],
    went: [...went],
    busy: [...busy],
    stops: ss,
    left: left as number,
    open: open as number,
    free: free as number,
    hold: hold as number,
    leave: leave as number,
  }
}

/**
 * The incoming bus with everything `held` knew that it does not say. Stars and games only grow,
 * and a stop's winners only gather, so each is kept as the most known — ⚠️ AND A NULL IS "NOT
 * SAID", NEVER NOUGHT: a sender leaves out what it may not tell about somebody absent, and reading
 * that as zero would erase a star its owner earned.
 */
export function mergeKnown(held: Bus, next: Bus): Bus {
  if (held.tour !== next.tour) return next
  const most = (a: number | null, b: number | null) =>
    a === null ? b : b === null ? a : Math.max(a, b)
  const knew = new Map(held.riders.map((r) => [r.id, r]))
  const riders = next.riders.map((r) => {
    const h = knew.get(r.id)
    return h ? { ...r, stars: most(r.stars, h.stars), played: most(r.played, h.played) } : r
  })
  const wonAt = new Map(held.stops.map((s) => [s.toy, s.won]))
  const stops = next.stops.map((s) => {
    const more = (wonAt.get(s.toy) ?? []).filter((i) => !s.won.includes(i))
    return more.length ? { ...s, won: [...s.won, ...more] } : s
  })
  return { ...next, riders, stops }
}

/**
 * Whether another tour wins over the one I hold: more riders on it, then more stops made, then the
 * lower starter's id. ⚠️ NOT THE LOWER TOUR ID, which is random: a tour started a moment ago would
 * then wipe out one that has been going for an hour about half the time.
 */
function beats(s: State, bus: Bus) {
  const theirs = s.riders.filter((r) => r[1] === 1).length
  const mine = bus.riders.filter((r) => r.on).length
  if (theirs !== mine) return theirs > mine
  if (s.stops.length !== bus.stops.length) return s.stops.length > bus.stops.length
  return s.riders[0][0] < (bus.riders[0]?.id ?? '')
}

/**
 * A state taken as the bus. Clocks are re-armed from the time remaining, so a new host carries on
 * from where the old one was rather than starting a phase again; `readyAt` is not sent, and is
 * where the window began: READY_MS before it ends.
 */
function adopt(bus: Bus, s: State, from: string, ctx: Ctx): Bus {
  const { now } = ctx
  const same = s.tour === bus.tour
  const next: Bus = {
    ...bus,
    seq: s.seq,
    from,
    tour: s.tour,
    len: s.len,
    riders: s.riders.map(([id, on, stars, played]) => ({ id, on: on === 1, stars, played })),
    guide: s.guide,
    phase: s.phase,
    faces: s.faces,
    toy: s.toy,
    ready: s.ready,
    no: s.no,
    went: s.went,
    busy: s.busy,
    stops: s.stops,
    due: now + s.left,
    readyAt: s.phase === 'ready' ? now + s.left - ctx.k.READY_MS : bus.readyAt,
    openAt: now + s.open,
    freeAt: now + s.free,
    holdUntil: now + s.hold,
    leaveAt: leaveOf(bus, s, ctx),
    heard: true,
    asking: false,
    presses: same ? bus.presses : {},
    sits: same ? bus.sits : {},
    /* the clock is about one guide: the turn passing starts it again */
    guideAway: same && s.guide === bus.guide ? bus.guideAway : null,
    quietSince: same ? bus.quietSince : null,
  }
  return mergeKnown(bus, next)
}

/**
 * When the latest departure's count ended, as this state tells it.
 *
 * ⚠️ A CLOCK THAT HAS RUN OUT STAYS RUN OUT. The wire carries the time remaining, clamped at
 * nought, so every state after the count — a sit, an off — says `leave: 0`, and read as "the count
 * ends now" each one re-opened the landing, and Come too with it, for another went·hopMs: on
 * screen Catch up turned back into Come too, and a new host took a Come too that the old one had
 * refused. So nought, for a departure already held, keeps the clock where it was; and a departure
 * first heard after its count reads as landed, which is what Catch up is for.
 */
function leaveOf(bus: Bus, s: State, ctx: Ctx): number {
  const stop = s.stops[s.stops.length - 1]
  if (s.leave > 0 || !stop) return ctx.now + s.leave
  if (s.tour === bus.tour && s.stops.length === bus.stops.length)
    return Math.min(bus.leaveAt, ctx.now)
  return ctx.now - s.went.length * hopMs(ctx.people, stop.toy)
}

/** the second-lowest rider here: who repairs a host that came back leading from a stale bus */
export const deputyOf = (bus: Bus, ctx: Pick<Ctx, 'present'>): string | null =>
  hostSet(bus, ctx.present)[1] ?? null

/**
 * Whether I answer a newcomer's hello: room.ts's rule asked of the riders here. ⚠️ A WATCHER IS
 * NEVER "HOST BEFORE THEY ARRIVED", whatever its id, so only the host as it was, or whoever
 * published the bus we hold, answers — once, however many hold it. And only from a bus I have
 * heard: one I may be leading from stale would hand a newcomer the wrong tour.
 */
function answers(bus: Bus, ctx: Ctx, from: string) {
  if (!holds(bus) || !ctx.meLive || !bus.heard) return false
  const set = hostSet(bus, ctx.present)
  return set.includes(bus.me)
    ? answersHello(bus.me, set, from, bus.seq, bus.from)
    : bus.seq > 0 && bus.from === bus.me
}

/** a state off the wire: my tour if it is newer, another if it beats mine, or a stale host's repair */
function onState(bus: Bus, ctx: Ctx, from: string, s: State): Step {
  if (holds(bus) && s.tour === bus.tour) {
    /* any state of my tour at a seq of mine or later is the tour as it is: I may lead from it */
    const b = s.seq >= bus.seq ? { ...bus, heard: true, asking: false } : bus
    if (newer(s.seq, from, bus.seq, bus.from)) return none(adopt(b, s, from, ctx))
    /* ⚠️ A HOST LEADING FROM A STALE BUS IS ANSWERED BY ITS DEPUTY: a host back from a hidden tab
       whose hello went unanswered publishes from what it last had, which everybody else ignores
       as older — and it never hears the newer bus, because nobody sends one until something
       changes. The deputy sends it, at most once every HELLO_REPAIR_MS. */
    const stale = s.seq < bus.seq && from === hostOf(bus, ctx) && deputyOf(bus, ctx) === bus.me
    if (stale && ctx.meLive && ctx.now - b.answerAt >= ctx.k.HELLO_REPAIR_MS)
      return { bus: { ...b, answerAt: ctx.now }, out: [{ t: 'state' }] }
    return none(b)
  }
  /* ⚠️ AN ENDED TOUR NEVER REPLACES A LIVE ONE, and a fresh one only by having more riders or
     more stops — or the lower starter, when two were started at the same moment */
  const live = holds(bus) && bus.phase !== 'end' && !abandoned(bus, ctx)
  if (live && (s.phase === 'end' || !beats(s, bus))) return none(bus)
  return none(adopt(bus, s, from, ctx))
}

/**
 * Traffic for a tour I do not hold while I hold no live one: I missed it, so ask — at most once
 * every HELLO_REPAIR_MS. While I hold a live tour, another's requests are followed by its states,
 * which settle which tour wins without asking.
 */
function repair(bus: Bus, ctx: Ctx): Step {
  const live = holds(bus) && bus.phase !== 'end' && !abandoned(bus, ctx)
  if (live || !ctx.meLive || ctx.now - bus.repairAt < ctx.k.HELLO_REPAIR_MS) return none(bus)
  return { bus: { ...bus, repairAt: ctx.now }, out: [{ v: 1, t: 'hello' }] }
}

/**
 * Somebody else's message, read by readBus first. Only from somebody on the call's roster: the
 * party's `from` is self-stated, and somebody the call does not have is nobody's to believe.
 */
export function receive(bus: Bus, ctx: Ctx, from: string, m: Msg): Step {
  if (from === bus.me || !ctx.roster.has(from)) return none(bus)
  if (m.t === 'state') return onState(bus, ctx, from, m)
  /* one state answers every hello in that second: the Outbox folds them into one publish */
  if (m.t === 'hello') return answers(bus, ctx, from) ? { bus, out: [{ t: 'state' }] } : none(bus)
  if (holds(bus) && m.tour === bus.tour)
    return leads(bus, ctx) ? decide(bus, ctx, from, m) : none(bus)
  return repair(bus, ctx)
}

/* ── what goes out, and how often ──────────────────────────────────────────────────────────── */

export type Outbox = {
  /** something to send: a request or a hello waits its turn, a state is folded into the next */
  push(o: Out): void
  /** when take() will next have something, or null when nothing waits */
  dueAt(): number | null
  /** what may go now */
  take(now: number): Out[]
}

/**
 * The gate everything this browser sends goes through.
 *
 * ⚠️ AT MOST ONE REQUEST A SECOND, WHATEVER WAS PRESSED. Requests wait in one queue, one of each
 * kind, the latest press of a kind standing for every press before it — so ready, stay, ready in
 * one breath is one `ready`, and it says ready. And the host's states at most one a second, leading
 * and trailing: the first change goes at once, every change within the second after it goes as one
 * state at its end, serialised then so its clocks are current. So any second of a call holds at
 * most N requests and one state, N + 1 sends, metered (N + 1)·N; with no tour, it holds none.
 */
export function outbox(k: Pick<Knobs, 'STATE_GAP_MS' | 'ASK_GAP_MS'>): Outbox {
  let asks: Exclude<Out, { t: 'state' }>[] = []
  let state = false
  let askAt = Number.NEGATIVE_INFINITY
  let stateAt = Number.NEGATIVE_INFINITY
  return {
    push(o) {
      if (o.t === 'state') {
        state = true
        return
      }
      const i = asks.findIndex((a) => a.t === o.t)
      if (i >= 0) asks = asks.map((a, j) => (j === i ? o : a))
      else asks = [...asks, o]
    },
    dueAt() {
      const ask = asks.length ? askAt + k.ASK_GAP_MS : Infinity
      const st = state ? stateAt + k.STATE_GAP_MS : Infinity
      const at = Math.min(ask, st)
      return at === Infinity ? null : at
    },
    take(now) {
      const out: Out[] = []
      if (state && now >= stateAt + k.STATE_GAP_MS) {
        state = false
        stateAt = now
        out.push({ t: 'state' })
      }
      if (asks.length && now >= askAt + k.ASK_GAP_MS) {
        out.push(asks[0])
        asks = asks.slice(1)
        askAt = now
      }
      return out
    },
  }
}

/* ── consent and the hop: this browser's alone ─────────────────────────────────────────────── */

/** what a press here said it would leave behind: the seat it named, or the match */
export type Leaves = { seat: string } | { match: true } | null
/**
 * This browser's yes to one departure: the tour, which departure, and the toy — a move goes to
 * that toy for that departure or nowhere. `come` for Come too, which lands after everybody.
 */
export type Consent = {
  tour: string
  n: number
  toy: string
  leaves: Leaves
  come?: true
} | null

/**
 * Consent after a press here. Set by the guide's pick, Take me there (with what its label said it
 * would leave) and Come too, each only for the departure and toy its button named and only while
 * the bus still offers them (`meant`); cleared by Stay here, Not this one and Hop off, whatever the
 * bus is doing, because a withdrawal never needs to match anything. Anything else leaves it as it
 * was — ⚠️ AN OWN PICK OF ANOTHER TOY NEVER CANCELS A YES, because nothing on screen would say that
 * it had.
 */
export function consentAfter(
  c: Consent,
  bus: Bus,
  ctx: Pick<Ctx, 'now' | 'people'>,
  p: Press,
  leaves: Leaves = null,
): Consent {
  if (p.t === 'off') return null
  if (!holds(bus)) return c
  const { tour } = bus
  const last = bus.stops.length
  if (p.t === 'pick') return bus.phase === 'choose' ? { tour, n: last + 1, toy: p.toy, leaves } : c
  if (p.t !== 'ready') return c
  if (!p.on) return null
  const means = meant(bus, ctx, p)
  if (means === 'window') return { tour, n: p.n, toy: p.toy, leaves }
  if (means === 'come') return { tour, n: p.n, toy: p.toy, leaves, come: true }
  return c
}

/** a yes this browser holds, and the host it was last asked of */
export type Asked = { key: string; host: string | null } | null

/**
 * Whom to ask again for a yes the bus does not show, or null. ⚠️ A YES STANDS UNTIL A HOST HAS
 * HEARD IT. A press is a request to whoever hosts, and a host that leaves before its next state
 * takes the yes with it: measured on the dev call, Ann said yes, the host closed its tab, Ann
 * became host herself — and skipped the window she had said yes to, because the bus she now led
 * had never been told. So a yes the window does not list is asked again, once of each new host
 * (me, when I lead: decided at once), and `ask` counts it against READY_SENDS like any press.
 */
export function askAgain(bus: Bus, ctx: Ctx, consent: Consent, asked: Asked): Asked {
  const n = bus.stops.length + 1
  const c = consent
  if (bus.phase !== 'ready' || !c || c.come || c.tour !== bus.tour) return null
  if (c.n !== n || c.toy !== bus.toy || !ctx.meLive) return null
  if (bus.ready.some((i) => bus.riders[i]?.id === bus.me)) return null
  const host = leads(bus, ctx) ? bus.me : hostOf(bus, ctx)
  const key = `${bus.tour}:${n}:${c.toy}`
  if (!host || (asked?.key === key && asked.host === host)) return null
  return { key, host }
}

export type HopPlan =
  | { do: 'hop'; key: string; at: number; rank: number }
  /** the departure arrived after its count had ended: Catch up, never a move */
  | { do: 'late'; key: string }
  | null

/**
 * When I hop for a departure, given the state that carried it and when it arrived.
 *
 * ⚠️ CONSENT DECIDES, AND `went` ONLY ORDERS. A state listing me as going, from a host that is
 * wrong, late or lying, schedules nothing unless I pressed for that departure and that toy. My
 * place in the queue is my id's among those who went; a request of mine that never reached the
 * host puts me after them, and Come too after that. `receivedAt` is when the departure arrived —
 * for Come too, when it was pressed, since that is when its hop was asked for, and asked again on
 * each state with that same time.
 */
export function hopPlan(
  bus: Bus,
  receivedAt: number,
  consent: Consent,
  people: number,
  moved: ReadonlySet<string>,
): HopPlan {
  const n = bus.stops.length
  if (!holds(bus) || !n || !consent) return null
  const toy = bus.stops[n - 1].toy
  const key = `${bus.tour}:${n}`
  if (consent.tour !== bus.tour || consent.n !== n || consent.toy !== toy || moved.has(key))
    return null
  const ids = bus.went
    .map((i) => bus.riders[i]?.id)
    .filter((id): id is string => !!id && id !== bus.me)
    .sort()
  const gap = hopMs(people, toy)
  if (consent.come) {
    /* ⚠️ COME TOO TAKES THE SLOT THE HOST GAVE IT. Pressed during the landing, it is due after
       the last rider; and the host appends each Come too to `went` in the order it hears them, so
       once a state lists me, my place there is my slot — two friends pressing it together would
       otherwise both land one slot after the riders, at the same instant. Ask again on each
       state while the hop waits.
       ⚠️ AND NEVER AFTER THE LANDING. The host refuses a Come too once the last rider has landed,
       and so does this browser: a consent that says `come` for a press made after that — however
       it came to say so — is Catch up, never a move. */
    const at = bus.went.findIndex((i) => bus.riders[i]?.id === bus.me)
    if (receivedAt >= landedAt(bus, people)) return { do: 'late', key }
    const rank = (at >= 0 ? at : ids.length) + 1
    return { do: 'hop', key, rank, at: Math.max(receivedAt, bus.leaveAt + rank * gap) }
  }
  const leave = bus.leaveAt - receivedAt
  if (leave <= 0) return { do: 'late', key }
  const mine = bus.went.some((i) => bus.riders[i]?.id === bus.me)
  const rank = mine ? [...ids, bus.me].sort().indexOf(bus.me) : ids.length
  return { do: 'hop', key, rank, at: receivedAt + leave + rank * gap }
}

export type Ride =
  | { do: 'none' }
  | { do: 'with' }
  | { do: 'unopenable' }
  | { do: 'offer'; why: 'away' | 'seat' | 'match' }
  | { do: 'go'; toy: string }

/**
 * What happens at my hop, checked in this order, and the order is the design: no consent for this
 * departure and toy is no move at all; already there needs none; a toy my Lab lacks cannot be
 * opened; a shut gate means the bus is not mine to see. Then OFFERED, NEVER MOVED, out of anything
 * a move would throw away that the press did not name — an away tab, a seat in a game still
 * going, a match being watched — and a departure already moved for is not moved for twice.
 */
export function rideStep(a: {
  consent: Consent
  tour: string
  n: number
  toy: string
  myToy: string | null
  openable: boolean
  gateOpen: boolean
  sharing: boolean
  visible: boolean
  onLab: boolean
  /** the toy where I hold a seat in a begun, unfinished game (held.ts) */
  heldSeat: string | null
  inMatch: boolean
  moved: ReadonlySet<string>
}): Ride {
  const c = a.consent
  if (!c || c.tour !== a.tour || c.n !== a.n || c.toy !== a.toy) return { do: 'none' }
  if (a.myToy === a.toy) return { do: 'with' }
  if (!a.openable) return { do: 'unopenable' }
  if (!a.gateOpen || !a.sharing) return { do: 'none' }
  if (!a.visible || !a.onLab) return { do: 'offer', why: 'away' }
  const leaves = c.leaves
  if (a.heldSeat !== null && a.heldSeat === a.myToy) {
    if (!leaves || !('seat' in leaves) || leaves.seat !== a.myToy)
      return { do: 'offer', why: 'seat' }
  }
  if (a.inMatch && !(leaves && 'match' in leaves)) return { do: 'offer', why: 'match' }
  if (a.moved.has(`${a.tour}:${a.n}`)) return { do: 'none' }
  return { do: 'go', toy: a.toy }
}

/* ── the dice, the table and the podium ────────────────────────────────────────────────────── */

/**
 * Three faces for the guide to choose from, or null with fewer than three places left to go.
 *
 * Drawn from `rollable` alone — the toys this viewer's friends can see (catalog.ts's `listed` with
 * admin false), never a toy hidden from them — leaving out every stop so far and the toy on
 * screen, from the kind the picker brings forward when it has three, like 🎲 Surprise us.
 * ⚠️ FACE 1 IS A GAME FOR TWO AT A TABLE whenever one is left: it is the face the dice choose when
 * the guide does not, and a stop with a table is a stop with a game to win.
 */
export function rollFaces(
  rollable: readonly string[],
  bus: Pick<Bus, 'stops'>,
  current: string | null,
  kindOf: (id: string) => string | undefined,
  filter: string,
  rand: () => number,
): Faces | null {
  const gone = new Set(bus.stops.map((s) => s.toy))
  if (current) gone.add(current)
  const base = [...new Set(rollable)].filter((id) => !gone.has(id))
  const kind = filter === 'all' ? base : base.filter((id) => kindOf(id) === filter)
  const pool = kind.length >= 3 ? kind : base
  if (pool.length < 3) return null
  const draw = (from: readonly string[]) =>
    from[Math.min(from.length - 1, Math.floor(rand() * from.length))]
  const tables = pool.filter((id) => ROOM_TOYS.has(id))
  const first = draw(tables.length ? tables : pool)
  const rest = pool.filter((id) => id !== first)
  const second = draw(rest)
  return [first, second, draw(rest.filter((id) => id !== second))]
}

/**
 * Who is up next at the stop's table: the two riders on its toy who have played fewest games
 * there, leaving out anybody seated now, ties going to whoever got on first. Empty anywhere
 * without a table.
 */
export function upNext(bus: Bus, ctx: Pick<Ctx, 'present' | 'subOf'>): number[] {
  const stop = bus.stops[bus.stops.length - 1]
  if (!stop || bus.phase === 'end' || !ROOM_TOYS.has(stop.toy)) return []
  return bus.riders
    .map((r, i) => ({ r, i }))
    .filter(
      ({ r, i }) =>
        r.on && ctx.present.has(r.id) && ctx.subOf(r.id) === stop.toy && !bus.busy.includes(i),
    )
    .sort((a, b) => (a.r.played ?? 0) - (b.r.played ?? 0) || a.i - b.i)
    .slice(0, 2)
    .map(({ i }) => i)
}

/** a place on the podium: everybody on the same number of stars shares it */
export type Place = { place: number; stars: number; ids: string[] }
/** the finale's podium, places shared by ties, and everybody else who rode, in boarding order */
export function podium(bus: Pick<Bus, 'riders'>): { places: Place[]; also: string[] } {
  const starred = bus.riders.filter((r) => (r.stars ?? 0) > 0)
  const counts = [...new Set(starred.map((r) => r.stars!))].sort((a, b) => b - a)
  return {
    places: counts.map((stars, j) => ({
      place: j + 1,
      stars,
      ids: starred.filter((r) => r.stars === stars).map((r) => r.id),
    })),
    also: bus.riders.filter((r) => !((r.stars ?? 0) > 0)).map((r) => r.id),
  }
}
