/**
 * Every sentence the party tour says (bus.ts), as pure functions of the bus and of what this
 * browser knows — so busWords.test.ts can read each one back without a call or a page, and the
 * panel (later) only lays them out. The wording is the plan's (docs/2026-11-22-lab-tour.md, "What
 * friends see and do"), word for word where it gives one.
 *
 * ⚠️ COUNTS, NOT NAMES, FOR WHO IS GOING. The house rule is that a leader is never told who
 * follows (shared.ts, together.ts), so the ready check says "3 going so far" and names nobody. The
 * scoreboard names riders because boarding is a pressed, public act, as a seat at a table is.
 *
 * ⚠️ A TOY YOUR LAB DOES NOT LIST IS NEVER NAMED AS ONE YOU CAN OPEN. `{toy}` is the name in your
 * own Lab, or "a toy that isn't in your Lab" — hidden by its owner, or from a newer build.
 */

import {
  abandoned,
  holdOn,
  holds,
  landedAt,
  podium,
  stalled,
  upNext,
  type Bus,
  type Consent,
  type Knobs,
  type Place,
} from './bus'
import { ROOM_TOYS, peopleWords, withWords } from './tour'

/** what this browser knows that the words read; everything here is about now */
export type View = {
  bus: Bus
  now: number
  k: Knobs
  /** a person's name from this browser's roster (cut to 40, kept after they go), or null */
  name: (id: string) => string | null
  /** a toy's name in your Lab, or null when your Lab does not list it */
  toy: (id: string) => string | null
  /** a toy's name from the whole list, whether or not your Lab lists it */
  title: (id: string) => string | null
  roster: ReadonlySet<string>
  present: ReadonlySet<string>
  subOf: (id: string) => string | null
  myToy: string | null
  /** you hold a seat in a begun, unfinished game on the toy on your screen (held.ts) */
  seated: boolean
  /** you are viewing a match (`&match=` in the address) */
  inMatch: boolean
  consent: Consent
  /** when your own hop is due, while it is (bus.ts's hopPlan) */
  hopAt: number | null
  /** everybody on the call: the landing is spaced by it (hopMs) */
  people: number
  /** step 7 of the plan: a star for each game won at a stop */
  stars?: boolean
  /** the faces on the bus are the ones this browser rolled: its own 🎲 Roll, or Roll for */
  rolled?: boolean
}

export type BusAct =
  | 'start'
  | 'roll'
  | 'rollAnyway'
  | 'rollFor'
  | 'face'
  | 'take'
  | 'no'
  | 'stay'
  | 'go'
  | 'off'
  | 'come'
  | 'catchUp'
  | 'fin'
  | 'finAnyway'
  | 'another'
  | 'close'
/**
 * `toy` on a face, and on every answer — take, no, stay, come — with `n`: the departure and the
 * toy the line was drawn from, which the press carries (bus.ts's Answer), so a press handled
 * after the bus has moved on is read as what the button said and not as what the bus now means.
 */
export type BusButton = { act: BusAct; label: string; toy?: string; n?: number }
export type Line = { text: string; buttons: BusButton[] }

const button = (act: BusAct, label: string, toy?: string): BusButton =>
  toy ? { act, label, toy } : { act, label }
/** an answer's button: what it is for goes with it */
const answer = (act: BusAct, label: string, n: number, toy: string): BusButton => ({
  act,
  label,
  toy,
  n,
})

/* ── the small words ───────────────────────────────────────────────────────────────────────── */

export const FRIEND_WHO_LEFT = 'a friend who left'
export const NOT_IN_LAB = "a toy that isn't in your Lab"

/** somebody by name, as this browser knows them */
export const nameOf = (v: View, id: string) => v.name(id) ?? FRIEND_WHO_LEFT
/** a toy as your Lab names it, or as one it does not have */
export const toyOf = (v: View, id: string) => v.toy(id) ?? NOT_IN_LAB
/** seconds left, rounded up: "The bus leaves in 15 s" at the moment it opens */
export const secs = (ms: number) => Math.max(0, Math.ceil(ms / 1000))
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
/** "Four in a row, Swarm and Paint": every item, however many — toys are never "and 3 others" */
export function listWords(xs: readonly string[]): string {
  if (xs.length <= 1) return xs.join('')
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
}
const guideId = (bus: Bus) => bus.riders[bus.guide]?.id ?? ''
/** "Bo rolls next" / "You roll next": the guide, said from where you sit */
const rollsNext = (v: View) =>
  guideId(v.bus) === v.bus.me ? 'You roll next.' : `${nameOf(v, guideId(v.bus))} rolls next.`
const lastStop = (bus: Bus) => bus.stops[bus.stops.length - 1]
/**
 * Who rolled the faces being chosen from: this browser, or the guide — or null, not known here.
 *
 * ⚠️ ROLL FOR BO IS NOT BO'S ROLL. Said as the guide's own, Bo was told "You rolled." for a roll he
 * never pressed, and everybody read "Bo rolled …" — the one who did roll among them. A roll is the
 * guide's only where it is known to be (bus.ts's guideRolled); otherwise nobody is named.
 */
const roller = (v: View): 'me' | 'guide' | null =>
  v.rolled ? 'me' : v.bus.guideRolled ? 'guide' : null
const PICK_NEXT = 'You rolled. Pick the next stop:'
const ROLLED_FOR_YOU = 'Somebody rolled for you. Pick the next stop:'
const myIndex = (bus: Bus) => bus.riders.findIndex((r) => r.id === bus.me)
const onRider = (bus: Bus) => bus.riders[myIndex(bus)]?.on === true
const said = (v: View, ids: readonly number[]) =>
  peopleWords(ids.map((i) => nameOf(v, v.bus.riders[i].id)))

/* ── the header and the scoreboard ─────────────────────────────────────────────────────────── */

/** "🚌 Party tour · 5 stops", "🚌 Party tour · stop 1 of 5: Four in a row", "🏁 Party tour over" */
export function heading(v: View): string {
  const b = v.bus
  if (!holds(b)) return ''
  if (b.phase === 'end') return '🏁 Party tour over'
  const stop = lastStop(b)
  if (!stop) return `🚌 Party tour · ${b.len} stops`
  return `🚌 Party tour · stop ${b.stops.length} of ${b.len}: ${toyOf(v, stop.toy)}`
}

/** one scoreboard entry: a name, stars, whether they roll next, and whether they are still here */
export function riderWords(v: View, i: number) {
  const b = v.bus
  const r = b.riders[i]
  const stars = r.stars ?? 0
  const top = Math.max(0, ...b.riders.map((x) => x.stars ?? 0))
  return {
    name: nameOf(v, r.id),
    stars: v.stars && stars > 0 ? `⭐${stars}` : '',
    starsSr: v.stars && stars > 0 ? count(stars, 'star', 'stars') : '',
    rolls: b.phase !== 'end' && b.guide === i ? '🎲' : '',
    rollsSr: b.phase !== 'end' && b.guide === i ? ', rolls next' : '',
    note: !r.on ? '(off the bus)' : r.id !== b.me && !v.roster.has(r.id) ? '(left the call)' : '',
    /* 👑 only once somebody has a star: a crown on everybody at nought says nothing */
    lead: !!v.stars && top > 0 && stars === top,
  }
}

/* ── things said once (to the strip's status region) ───────────────────────────────────────── */

/** a tour has started; `stars` adds what a stop is for */
export function startedWords(v: View): string {
  const b = v.bus
  const starter = b.riders[0]?.id ?? ''
  const rules = v.stars
    ? `${b.len} stops, everybody takes a turn to roll, and a star for each game won at a stop.`
    : `${b.len} stops, and everybody takes a turn to roll.`
  if (starter === b.me) return `You started a party tour: ${rules} You roll first.`
  const s = nameOf(v, starter)
  return `${s} started a party tour: ${rules} ${s} rolls first. When the bus picks a stop, press Take me there to come along.`
}
/** the phone's bus row while the first roll is awaited */
export function startedRow(v: View): string {
  const starter = v.bus.riders[0]?.id ?? ''
  if (starter === v.bus.me) return '🚌 Your party tour · You roll first.'
  const s = nameOf(v, starter)
  return `🚌 ${s}'s party tour · ${s} rolls first.`
}
export const diceChoseWords = (v: View, guide: string, toy: string) =>
  guide === v.bus.me
    ? `You didn't choose, so the dice chose ${toyOf(v, toy)}.`
    : `${nameOf(v, guide)} didn't choose, so the dice chose ${toyOf(v, toy)}.`
export const leavingWords = (v: View, toy: string, ms: number) =>
  `Leaving for ${toyOf(v, toy)} in ${count(secs(ms), 'second', 'seconds')}.`
export const hopWords = (v: View, toy: string) => `🚌 Off to ${toyOf(v, toy)}!`
/** on arrival: who is there with you, by name, as the line above a toy says it */
export function arrivedWords(v: View, toy: string, names: readonly string[]): string {
  const w = withWords(names)
  return w ? `You're at ${toyOf(v, toy)}, ${w}.` : `You're at ${toyOf(v, toy)}.`
}
export const skippedWords = (v: View, toy: string, next: string) =>
  next === v.bus.me
    ? `Nobody took the bus to ${toyOf(v, toy)}, so it's your turn.`
    : `Nobody took the bus to ${toyOf(v, toy)}, so it's ${nameOf(v, next)}'s turn.`
export const guideGoneWords = (v: View, was: string, next: string) =>
  next === v.bus.me
    ? `${nameOf(v, was)} isn't here, so it's your turn to roll.`
    : `${nameOf(v, was)} isn't here, so it's ${nameOf(v, next)}'s turn to roll.`
export const followEndedWords = (leader: string) =>
  `You're on the bus, so you've stopped following ${leader}.`
export const followOffWords = (leader: string) =>
  `You hopped off the party tour to follow ${leader}.`
export const HOPPED_OFF =
  "You've hopped off the party tour. Press Take me there at any stop to hop back on."
export const ALL_OFF = 'Everyone got off the bus, so the tour is over.'
export const GATE_SHUT =
  'Toys are private in this call now, so the party tour is hidden. Your place on the bus is kept.'
/**
 * The same pause for a reason that is yours: you switched 🫱 off. ⚠️ NOT GATE_SHUT, which says the
 * CALL made toys private — true of a stranger joining, and untrue of a switch you pressed.
 */
export const SHARING_OFF =
  'You stopped sharing, so the party tour is hidden. Your place on the bus is kept.'
/** the pause over and the tour on screen again: said, because the pause was */
export const TOUR_BACK = 'The party tour is back.'
/**
 * My fresh tour lost to another started at the same moment. ⚠️ NOT "TWO TOURS": three Starts in
 * one moment told a loser "Two tours started at once" (measured on the dev call), and no browser
 * can know how many there were — each hears only the tours that reach it before the winner does —
 * so the count is not said.
 */
export const startedAtOnceWords = (v: View, starter: string) =>
  `More than one tour started at once; this one is ${nameOf(v, starter)}'s. Press Take me there at the first stop to ride.`
/**
 * The window's time is up and the departure has not been heard. ⚠️ NOT "THE BUS LEAVES IN 0 s",
 * which is what the count said once it ran out: true for the moment a departure takes to arrive,
 * and untrue for as long as a host gone silent stays on the Lab — measured on the dev call, 12.6 to
 * 15.2 s, until the party's sweep let somebody else take the window over. One sentence, and it
 * holds until the bus moves: nothing about it changes by the second, so it is read once.
 */
export const ABOUT_TO_LEAVE = 'The bus is about to leave…'
/** a tour given up on (bus.ts's abandoned) with somebody on it here, and nothing moving it on */
export const STALLED = 'The bus has stalled: nobody is driving it.'
/** "The bus leaves in 12 s." while the window is open, then what is true once it is not */
const leavesWords = (v: View) =>
  v.now < v.bus.due ? `The bus leaves in ${secs(v.bus.due - v.now)} s.` : ABOUT_TO_LEAVE

/**
 * When the status region says ABOUT_TO_LEAVE: two state gaps after the zero, the bound knobs()
 * already puts on how long a state can take to arrive (a gap waiting in the host's Outbox, and a
 * second for the wire).
 *
 * ⚠️ NOT AT THE ZERO. Every viewer but the host reaches the zero before the departure does, and
 * when the host sent a state in the second before it — a late Take me there — the departure waits
 * out that gap: measured on the dev call, Dee read "about to leave" for 0.9 s at a departure that
 * went at its time. Said at the zero, it would be heard at nearly every stop about a bus that was
 * leaving; said here, it is heard when the bus is late.
 */
export const leavingSaidAt = (b: Pick<Bus, 'due'>, k: Pick<Knobs, 'STATE_GAP_MS'>) =>
  b.due + 2 * k.STATE_GAP_MS
/**
 * ABOUT_TO_LEAVE for the status region, once a window. Evan, 27 Nov 2026: "Yes, screen readers
 * announce 'About to leave…' once." `told` is the window it was last said in, kept by the caller
 * and handed back; the answer is the `told` to keep, and the sentence to say now or null.
 *
 * ⚠️ ONLY WHILE THE LINE SAYS IT, so the status never says what the screen does not: not to a rider
 * staying here, nor somebody already at the toy, nor once the line says the bus has stalled.
 * ⚠️ ONCE A WINDOW, NOT ONCE A STATE: a state of the same window heard after the zero carries nought
 * left and moves `due` to when it arrived, so the window is its tour, departure and toy — as a no
 * and the presses are kept (useBus, closeWindow) — and forgotten when the phase leaves ready, so the
 * same toy rolled again at the same departure after a skip is a window of its own.
 */
export function leavingSaid(
  told: string | null,
  v: View,
): { told: string | null; text: string | null } {
  const b = v.bus
  if (!holds(b) || b.phase !== 'ready' || !b.toy) return { told: null, text: null }
  const key = `${b.tour}:${b.stops.length + 1}:${b.toy}`
  if (told === key) return { told, text: null }
  if (v.now < leavingSaidAt(b, v.k) || !phaseLine(v)?.text.includes(ABOUT_TO_LEAVE))
    return { told: null, text: null }
  return { told: key, text: ABOUT_TO_LEAVE }
}
/** a button whose request is in flight: at most 3 s, then the button comes back */
export const PENDING = { roll: 'Rolling…', ready: 'Going…' } as const
/**
 * A Take me there or Come too that the bus had moved past by the time it was handled (bus.ts's
 * `meant` answers null): it did nothing, and says so, rather than seeming to have worked.
 */
export const missedWords = (v: View, toy: string) =>
  `Too late for ${toyOf(v, toy)}: the bus had moved on, so you're staying here.`

/**
 * What to say when the bus changes from `prev` to `v.bus`, or null for nothing. One sentence, the
 * latest winning — countdowns and counts are never said, only what happened.
 */
export function saidOf(prev: Bus, v: View): string | null {
  const b = v.bus
  if (!holds(b)) return null
  if (prev.tour !== b.tour) {
    /* my own fresh tour lost to one started at the same moment */
    const mine = holds(prev) && prev.phase !== 'end' && prev.riders[0]?.id === b.me
    if (mine && !prev.stops.length && b.riders[0]?.id !== b.me)
      return startedAtOnceWords(v, b.riders[0]?.id ?? '')
    return b.phase === 'pick' && !b.stops.length ? startedWords(v) : null
  }
  if (b.phase === 'end' && prev.phase !== 'end' && !b.riders.some((r) => r.on)) return ALL_OFF
  if (prev.phase === 'pick' && b.phase === 'choose' && guideId(b) === b.me)
    return roller(v) ? PICK_NEXT : ROLLED_FOR_YOU
  if (prev.phase === 'choose' && b.phase === 'ready' && b.toy && !b.ready.length)
    return diceChoseWords(v, guideId(prev), b.toy)
  if (prev.phase === 'ready' && b.phase === 'pick') {
    if (b.stops.length > prev.stops.length) {
      const toy = lastStop(b).toy
      const c = v.consent
      if (c && c.tour === b.tour && c.n === b.stops.length && c.toy === toy)
        return b.leaveAt > v.now
          ? leavingWords(v, toy, b.leaveAt - v.now)
          : /* heard after its count: gone, as the line says (offerWords's late) */
            `The bus already left for ${toyOf(v, toy)}.`
      return null
    }
    return prev.toy ? skippedWords(v, prev.toy, guideId(b)) : null
  }
  if (b.phase === prev.phase && b.guide !== prev.guide && b.stops.length === prev.stops.length) {
    const was = prev.riders[prev.guide]
    if (was && b.riders[prev.guide]?.on) return guideGoneWords(v, was.id, guideId(b))
  }
  return null
}

/* ── the dice ──────────────────────────────────────────────────────────────────────────────── */

/** a face as the guide's card says it: where it goes, what it is, and (step 7) what it is worth */
export function faceCard(v: View, toy: string) {
  const table = ROOM_TOYS.has(toy)
  return {
    toy,
    label: `Go to ${toyOf(v, toy)}`,
    kind: table ? 'a game for two at a table' : 'a toy to look at',
    star: v.stars ? (table ? '⭐ win a game here for a star' : 'no star here') : '',
  }
}

/* ── the line under the scoreboard: what is happening, and what you can do ─────────────────── */

/**
 * Whether you said yes to this departure of this toy. ⚠️ THE TOY IS PART OF IT, as it is for the
 * hop (bus.ts's rideStep): a yes for a window that was skipped is still held for the same
 * departure, and keyed by that alone it told you "You're going to Hex" — counted among the going,
 * with Take me there hidden — when your yes was for Four in a row and nothing would move you.
 */
const yes = (v: View, n: number, toy: string) => {
  const c = v.consent
  return !!c && c.tour === v.bus.tour && c.n === n && c.toy === toy
}
/** the yes button says what it costs */
const takeLabel = (v: View, after = false) =>
  v.seated
    ? '🚌 Leave my game and go'
    : v.inMatch
      ? '🚌 Leave this match and go'
      : after
        ? '🚌 Take me there after all'
        : '🚌 Take me there'

function readyLine(v: View): Line {
  const b = v.bus
  const toy = b.toy!
  const t = toyOf(v, toy)
  const leaves = leavesWords(v)
  if (!v.toy(toy))
    return { text: `Next stop: ${NOT_IN_LAB}, so you'll sit this one out.`, buttons: [] }
  if (v.myToy === toy) return { text: `Next stop: ${t}. You're already here.`, buttons: [] }
  const n = b.stops.length + 1
  const going = new Set(b.ready.map((i) => b.riders[i].id))
  const mine = yes(v, n, toy)
  if (mine) going.add(b.me)
  else going.delete(b.me)
  const i = myIndex(b)
  if (mine) {
    const guide = b.guide === i && v.now >= b.readyAt + v.k.READY_MIN_MS
    return {
      text: `You're going to ${t}. ${going.size} going so far. ${leaves}`,
      buttons: [...(guide ? [button('go', 'Go now')] : []), answer('stay', 'Stay here', n, toy)],
    }
  }
  if (i >= 0 && b.no.includes(i))
    return {
      text: `You're staying here this stop. ${going.size} going.`,
      buttons: [answer('take', takeLabel(v, true), n, toy)],
    }
  if (i < 0 && b.riders.length >= v.k.MAX_RIDERS)
    return { text: `Next stop: ${t}. The bus is full.`, buttons: [] }
  if (onRider(b))
    return {
      text: `Next stop: ${t}. Going? ${leaves}`,
      buttons: [answer('take', takeLabel(v), n, toy), answer('no', 'Not this one', n, toy)],
    }
  return {
    text: `Next stop: ${t}. ${leaves} Press Take me there to come along.`,
    buttons: [answer('take', takeLabel(v), n, toy)],
  }
}

/**
 * Who is holding the bus with a game, here now, in turn order — the order the scoreboard reads,
 * not the order their seats happened to reach the host in
 */
const playing = (v: View) =>
  v.bus.busy.filter((i) => v.present.has(v.bus.riders[i].id)).sort((x, y) => x - y)

/** the game holding the roll: who is still playing, and for how much longer at most */
function holdWords(v: View, what: 'bus' | 'finale'): string {
  const b = v.bus
  const busy = playing(v)
  const who = said(v, busy)
  const left = count(
    Math.max(1, Math.ceil((b.holdUntil - v.now) / 60_000)),
    'more minute',
    'more minutes',
  )
  const t = toyOf(v, lastStop(b).toy)
  const are = busy.length === 1 ? 'is' : 'are'
  return what === 'bus'
    ? `${who} ${are} still playing ${t}. The bus waits for their game, up to ${left}.`
    : `${who} ${are} still playing ${t}. The finale waits for their game, up to ${left}.`
}

function stopLine(v: View): string {
  const b = v.bus
  const stop = lastStop(b)
  const head = `Stop ${b.stops.length} of ${b.len}: ${toyOf(v, stop.toy)}.`
  if (!ROOM_TOYS.has(stop.toy)) return `${head} Have a look around.`
  if (!v.stars) return `${head} Sit down and play. ${rollsNext(v)}`
  const up = upNext(b, v)
  const ids = up.map((i) => b.riders[i].id)
  const win = `${head} Win a game here for a star.`
  if (ids.includes(b.me)) {
    const other = ids.find((id) => id !== b.me)
    return other
      ? `${win} You're up next with ${nameOf(v, other)}: take a seat below.`
      : `${win} You're up next: take a seat below.`
  }
  return ids.length ? `${win} Up next at the table: ${said(v, up)}.` : win
}

function pickLine(v: View): Line {
  const b = v.bus
  const me = b.me
  const isGuide = guideId(b) === me
  const stop = lastStop(b)
  const free = onRider(b) && v.present.has(me) && v.now >= b.freeAt
  if (!stop) {
    /* ⚠️ THE TURN CAN PASS BEFORE THE FIRST STOP — the one who started it away, or the first
       window skipped — and then nobody rolls first any more: the starter was still told "You roll
       first" with no Roll to press, and everybody else that the starter rolls first, while the
       scoreboard's 🎲 sat beside somebody else */
    if (b.guide !== 0)
      return isGuide
        ? { text: 'Your turn to roll.', buttons: [button('roll', '🎲 Roll')] }
        : { text: `The party tour hasn't made a stop yet. ${rollsNext(v)}`, buttons: [] }
    return {
      text: startedWords(v),
      buttons: isGuide ? [button('roll', '🎲 Roll'), button('off', 'Hop off')] : [],
    }
  }
  const t = toyOf(v, stop.toy)
  const n = b.stops.length
  /* the host takes Come too until the last rider has landed, so the offer lasts as long */
  const landed = v.now >= landedAt(b, v.people)
  /* my own count, to my own hop */
  const mine = yes(v, n, stop.toy)
  if (mine && v.hopAt !== null && v.now < v.hopAt)
    return {
      text: `Off to ${t} in ${secs(v.hopAt - v.now)}`,
      buttons: [answer('stay', 'Stay here', n, stop.toy)],
    }
  if (v.myToy !== stop.toy && !mine) {
    const riders = count(b.went.length, 'rider', 'riders')
    if (!landed)
      return {
        text: `The bus is leaving for ${t} with ${riders}.`,
        buttons: v.toy(stop.toy) ? [answer('come', 'Come too', n, stop.toy)] : [],
      }
    if (v.now < b.openAt)
      return {
        text: `The bus left for ${t} with ${riders}.`,
        buttons: v.toy(stop.toy) ? [button('catchUp', 'Catch up')] : [],
      }
  }
  const held = holdOn(b, v)
  if (b.stops.length >= b.len) {
    /* ⚠️ THE FINALE WAITS FOR THE DWELL, AS A ROLL DOES: the host refuses `fin` before openAt, so a
       Finale offered the moment the bus lands was a button that did nothing */
    if (isGuide && v.now < b.openAt)
      return {
        text: `That was the last stop. You open the finale once everyone's had a moment at ${t}.`,
        buttons: [],
      }
    if (isGuide)
      return held
        ? { text: holdWords(v, 'finale'), buttons: [button('finAnyway', '🏁 Finale anyway')] }
        : { text: 'That was the last stop.', buttons: [button('fin', '🏁 Finale')] }
    return {
      text: `${nameOf(v, guideId(b))} opens the finale.`,
      buttons: free ? [button('fin', '🏁 Finale')] : [],
    }
  }
  if (v.now < b.openAt)
    return {
      text: isGuide ? `Your turn to roll next, once everyone's had a moment at ${t}.` : stopLine(v),
      buttons: [],
    }
  const i = myIndex(b)
  if (held) {
    if (isGuide)
      return { text: holdWords(v, 'bus'), buttons: [button('rollAnyway', '🎲 Roll anyway')] }
    if (b.busy.includes(i))
      return { text: 'The bus is waiting for your game. Take your time.', buttons: [] }
    const busy = playing(v)
    const finish = busy.length === 1 ? 'finishes' : 'finish'
    return {
      text: `The bus waits while ${said(v, busy)} ${finish} their game. ${rollsNext(v)}`,
      buttons: [],
    }
  }
  if (isGuide) return { text: 'Your turn to roll.', buttons: [button('roll', '🎲 Roll')] }
  return {
    text: stopLine(v),
    buttons: free ? [button('rollFor', `🎲 Roll for ${nameOf(v, guideId(b))}`)] : [],
  }
}

/**
 * The phase line: what is happening now, and the one to three buttons that go with it. Null with
 * no tour, when the strip's own Start is the whole of it.
 */
export function phaseLine(v: View): Line | null {
  const b = v.bus
  if (!holds(b)) return null
  if (b.phase === 'end') return { text: finaleWords(v), buttons: finaleButtons }
  /* nobody on the bus is here, or nobody is moving it on (bus.ts's abandoned): after a while
     anybody may start another. ⚠️ SAID FROM WHO IS HERE, NOT FROM WHICH RULE GAVE IT UP: a rider
     back on a page that holds nothing is here, and "Nobody on the bus is here" would be untrue */
  if (abandoned(b, v)) {
    const here = b.riders.some((r) => r.on && v.present.has(r.id))
    return {
      text: here ? STALLED : 'Nobody on the bus is here right now.',
      buttons: [button('start', '🚌 Start a party tour')],
    }
  }
  if (b.quietSince !== null)
    return { text: `The bus is waiting for ${nameOf(v, guideId(b))}.`, buttons: [] }
  if (b.phase === 'choose') {
    const faces = b.faces!
    const by = roller(v)
    if (guideId(b) === b.me)
      return {
        text: by ? PICK_NEXT : ROLLED_FOR_YOU,
        buttons: faces.map((f) => button('face', faceCard(v, f).label, f)),
      }
    const g = nameOf(v, guideId(b))
    const rolled = listWords(faces.map((f) => toyOf(v, f)))
    return {
      text:
        by === 'guide'
          ? `${g} rolled ${rolled} and is choosing…`
          : `${by === 'me' ? 'You' : 'Somebody'} rolled ${rolled} for ${g}, and ${g} is choosing…`,
      buttons: [],
    }
  }
  if (b.phase === 'ready') return readyLine(v)
  return pickLine(v)
}

/**
 * The one line above the toy (BusLine), for somebody scrolled down to the stage: always led by 🚌,
 * so it can never read as the Lab's own "⭐ Featured", and at most one button.
 */
export function busLine(v: View): Line | null {
  const b = v.bus
  if (!holds(b) || b.phase === 'end' || b.quietSince !== null || stalled(b, v)) return null
  const i = myIndex(b)
  if (b.phase === 'ready') {
    const toy = b.toy!
    if (!v.toy(toy) || v.myToy === toy) return null
    /* the count, or once it is out with no departure heard, what readyLine says then */
    const when = v.now < b.due ? ` in ${secs(b.due - v.now)} s` : ': about to leave…'
    const n = b.stops.length + 1
    if (yes(v, n, toy))
      return {
        text: `🚌 You're going to ${toyOf(v, toy)}${when}`,
        buttons: [answer('stay', 'Stay here', n, toy)],
      }
    if (i >= 0 && b.no.includes(i)) return null
    return {
      text: `🚌 ${toyOf(v, toy)}${when}`,
      buttons: [answer('take', 'Take me there', n, toy)],
    }
  }
  if (b.phase !== 'pick' || !b.stops.length) return null
  if (holdOn(b, v) && b.busy.includes(i))
    return { text: '🚌 The bus waits for your game', buttons: [] }
  if (guideId(b) === b.me && v.now < b.openAt && b.stops.length < b.len)
    return { text: '🚌 Your turn to roll soon', buttons: [] }
  return null
}

/* ── step 7's star sentences ───────────────────────────────────────────────────────────────── */

/** a game counted at a stop, said once to everybody */
export function gameWords(
  v: View,
  toy: string,
  how: 'win' | 'draw' | 'cpu',
  won: readonly string[],
  computer: boolean,
): string {
  const t = toyOf(v, toy)
  if (how === 'draw') return `${t} was a draw: no star.`
  if (how === 'cpu') return `The computer won ${t}: no star.`
  const names = [...won]
    .sort((a, b) => (a === v.bus.me ? -1 : b === v.bus.me ? 1 : 0))
    .map((id) => (id === v.bus.me ? 'You' : nameOf(v, id)))
  if (names.length === 1) return `⭐ ${names[0]} won ${t}!`
  return computer
    ? `⭐ ${peopleWords(names)} beat the computer at ${t}: a star each!`
    : `⭐ ${peopleWords(names)} won ${t} together: a star each!`
}
export const NO_STAR_NOT_ON_BUS = "No star for that game: the winner isn't on the bus."
export const capReachedWords = (v: View, toy: string) =>
  `That's all the stars at ${toyOf(v, toy)}. ${rollsNext(v)}`
export const JUST_FOR_FUN = "That game was after this stop's stars, so it was just for fun."
export const starLineWords = (v: View, winner: string, toy: string) =>
  `🚌 ${winner === v.bus.me ? 'You' : nameOf(v, winner)} won ${toyOf(v, toy)}: ⭐ +1 on the tour`

/* ── the finale ────────────────────────────────────────────────────────────────────────────── */

const finaleButtons: BusButton[] = [button('another', '🚌 Another tour'), button('close', 'Close')]

/**
 * How the tour ended. ⚠️ IT NEVER SAYS NOTHING: a tour with no stars says so, and one that ended
 * before its first stop says that — an empty card under "Party tour over" reads as a broken one.
 */
export function finaleWords(v: View): string {
  const b = v.bus
  if (!v.stars) {
    if (!b.stops.length) return 'The tour ended before its first stop.'
    return `That was the tour: ${listWords(b.stops.map((s) => toyOf(v, s.toy)))}.`
  }
  const top = podium(b).places[0]
  if (!top) return 'No stars this time: every stop was just for fun. Thanks for the tour!'
  const mine = top.ids.includes(b.me)
  if (top.ids.length === 1)
    return mine
      ? `🏆 You win the party tour with ${top.stars} ⭐!`
      : `🏆 ${nameOf(v, top.ids[0])} wins the party tour with ${top.stars} ⭐!`
  const names = [
    ...(mine ? ['You'] : []),
    ...top.ids.filter((id) => id !== b.me).map((id) => nameOf(v, id)),
  ]
  return `🏆 ${peopleWords(names)} share the win with ${top.stars} ⭐ each!`
}

const MEDALS = ['🥇', '🥈', '🥉']
/** "🥇 Bo: 3 stars", "🥈 Ann and Cy: 1 star each", and "Also riding: Dee" */
export function podiumWords(v: View): string[] {
  const { places, also } = podium(v.bus)
  const line = (p: Place) =>
    `${MEDALS[p.place - 1] ?? `${p.place}th`} ${peopleWords(p.ids.map((id) => nameOf(v, id)))}: ${count(p.stars, 'star', 'stars')}${p.ids.length > 1 ? ' each' : ''}`
  return [
    ...places.map(line),
    ...(also.length ? [`Also riding: ${peopleWords(also.map((id) => nameOf(v, id)))}`] : []),
  ]
}

/**
 * The stops, with each one's winners where this browser knows them: "Four in a row: Ann ⭐ ·
 * Swarm · Chess: no star". A winner absent when the star was given may be unknown here (bus.ts
 * sends facts about a person only while they are live), so a stop never claims nobody won it.
 */
export function stopLogWords(v: View): string {
  return v.bus.stops
    .map((s) => {
      const t = toyOf(v, s.toy)
      if (s.won.length) return `${t}: ${said(v, s.won)} ⭐`
      return s.games.length ? `${t}: no star` : t
    })
    .join(' · ')
}

/** what the bus can offer at a hop that did not move you (bus.ts's rideStep and hopPlan) */
export function offerWords(
  v: View,
  toy: string,
  why: 'seat' | 'match' | 'away' | 'late' | 'unopenable',
): Line {
  const t = toyOf(v, toy)
  const catchUp = [button('catchUp', 'Catch up')]
  switch (why) {
    case 'seat':
      return {
        text: `The bus went to ${t}. You're in a game here, so you stayed.`,
        buttons: catchUp,
      }
    case 'match':
      return {
        text: `The bus went to ${t}. You're watching a match here, so you stayed.`,
        buttons: catchUp,
      }
    case 'away':
      return { text: `The bus went to ${t} while you were away.`, buttons: catchUp }
    case 'late':
      return { text: `The bus already left for ${t}.`, buttons: catchUp }
    case 'unopenable': {
      const known = v.title(toy)
      return {
        text: known
          ? `The bus went to ${known}, which isn't in your Lab.`
          : `The bus went to ${NOT_IN_LAB}.`,
        buttons: [],
      }
    }
  }
}

/** an offer this browser holds: the departure it is about (`tour:n`), its toy, and why */
export type HeldOffer = { key: string; toy: string; why: Parameters<typeof offerWords>[2] }

/**
 * The line the panel draws: the phase line, or an offer made at my hop while it is about the stop
 * just made and I am not on its toy.
 *
 * ⚠️ AN OFFER GIVES WAY TO A TURN. It stands until the next stop — somebody away for the whole
 * dwell still comes back to it — but whoever it was made to may be the next guide, and an offer
 * drawn over "Your turn to roll." left the tour with nobody able to roll: found on the dev call, a
 * guide who stayed in a game, was offered, and was never shown the dice.
 */
/**
 * Where Catch up takes me: the stop the bus is at.
 *
 * ⚠️ NOT WHATEVER OFFER IS HELD. An offer stands until the next stop (lineWith) and nothing clears
 * it when the bus moves on, so the toy it names can be a stop behind. Read off the code in the step
 * 6 design pass, 27 Nov 2026, and live on main until this: Cy, offered at stop 1 for staying in her
 * game, was shown "The bus left for Hex" at stop 2 with Catch up under it, and the press took her
 * to Four in a row. Every Catch up on screen sits under a line naming the stop the bus holds now
 * (the offer's own line only while it is about that stop), so that stop is where it goes.
 */
export function catchUpToy(b: Pick<View['bus'], 'tour' | 'stops'>, offer: HeldOffer | null) {
  const n = b.stops.length
  const here = b.stops[n - 1]?.toy ?? null
  return offer && offer.key === `${b.tour}:${n}` ? offer.toy : here
}

export function lineWith(v: View, offer: HeldOffer | null): Line | null {
  const b = v.bus
  const phase = phaseLine(v)
  const about = offer && b.phase === 'pick' && offer.key === `${b.tour}:${b.stops.length}`
  const yours = !!phase?.buttons.some((x) => x.act !== 'off')
  return about && v.myToy !== offer.toy && !yours ? offerWords(v, offer.toy, offer.why) : phase
}
