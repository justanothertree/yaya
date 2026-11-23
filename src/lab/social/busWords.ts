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
  holdOn,
  holds,
  landedAt,
  podium,
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
export const twoStartsWords = (v: View, starter: string) =>
  `Two tours started at once; this one is ${nameOf(v, starter)}'s. Press Take me there at the first stop to ride.`
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
      return twoStartsWords(v, b.riders[0]?.id ?? '')
    return b.phase === 'pick' && !b.stops.length ? startedWords(v) : null
  }
  if (b.phase === 'end' && prev.phase !== 'end' && !b.riders.some((r) => r.on)) return ALL_OFF
  if (prev.phase === 'pick' && b.phase === 'choose' && guideId(b) === b.me)
    return 'You rolled. Pick the next stop:'
  if (prev.phase === 'choose' && b.phase === 'ready' && b.toy && !b.ready.length)
    return diceChoseWords(v, guideId(prev), b.toy)
  if (prev.phase === 'ready' && b.phase === 'pick') {
    if (b.stops.length > prev.stops.length) {
      const toy = lastStop(b).toy
      const c = v.consent
      if (c && c.tour === b.tour && c.n === b.stops.length && c.toy === toy)
        return leavingWords(v, toy, b.leaveAt - v.now)
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
  const leaves = `The bus leaves in ${secs(b.due - v.now)} s.`
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

/** the game holding the roll: who is still playing, and for how much longer at most */
function holdWords(v: View, what: 'bus' | 'finale'): string {
  const b = v.bus
  const busy = b.busy.filter((i) => v.present.has(b.riders[i].id))
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
    /* the turn can pass before the first roll, if the one who started it is away */
    if (isGuide && b.guide !== 0)
      return { text: 'Your turn to roll.', buttons: [button('roll', '🎲 Roll')] }
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
    const busy = b.busy.filter((j) => v.present.has(b.riders[j].id))
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
  /* nobody on the bus is here: the bus waits, and after a while anybody may start another */
  if (b.quietSince !== null) {
    if (v.now - b.quietSince < v.k.ABANDON_MS)
      return { text: `The bus is waiting for ${nameOf(v, guideId(b))}.`, buttons: [] }
    return {
      text: 'Nobody on the bus is here right now.',
      buttons: [button('start', '🚌 Start a party tour')],
    }
  }
  if (b.phase === 'choose') {
    const faces = b.faces!
    if (guideId(b) === b.me)
      return {
        text: 'You rolled. Pick the next stop:',
        buttons: faces.map((f) => button('face', faceCard(v, f).label, f)),
      }
    return {
      text: `${nameOf(v, guideId(b))} rolled ${listWords(faces.map((f) => toyOf(v, f)))} and is choosing…`,
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
  if (!holds(b) || b.phase === 'end' || b.quietSince !== null) return null
  const i = myIndex(b)
  if (b.phase === 'ready') {
    const toy = b.toy!
    if (!v.toy(toy) || v.myToy === toy) return null
    const s = secs(b.due - v.now)
    const n = b.stops.length + 1
    if (yes(v, n, toy))
      return {
        text: `🚌 You're going to ${toyOf(v, toy)} in ${s} s`,
        buttons: [answer('stay', 'Stay here', n, toy)],
      }
    if (i >= 0 && b.no.includes(i)) return null
    return {
      text: `🚌 ${toyOf(v, toy)} in ${s} s`,
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
