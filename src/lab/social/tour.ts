/**
 * The Lab tour: friends on the same call seeing each other on the Lab's toys, the way players see
 * each other on a board. Pure, so tour.test.ts can ask it without a call or a page —
 * docs/2026-11-22-lab-tour.md has the plan: everything here is a new reading of messages the call
 * already carries, and only the party tour (bus.ts) adds a kind of its own, `bus`.
 */

import type { PartyHere } from '../../party/party'
import type { CursorSkin } from '../../ui/cursorSkin'
import type { Refusal, Verdict } from './gate'

/**
 * "with Ann", "with Ann and Bo", "with Ann, Bo and Cy", "with Ann, Bo and 2 more" — who is on your
 * toy, said in the line above it, so a phone player scrolled down to the stage can see who is
 * there without scrolling back up to the picker. Empty for nobody: a line that says "with nobody"
 * only states what the screen already does.
 */
export function withWords(names: readonly string[]): string {
  const n = names.length
  if (n === 0) return ''
  if (n === 1) return `with ${names[0]}`
  if (n <= 3) return `with ${names.slice(0, -1).join(', ')} and ${names[n - 1]}`
  return `with ${names[0]}, ${names[1]} and ${n - 2} more`
}

/** where somebody on the call is, as far as the tour may say */
export type Place =
  /** on the toy on your screen */
  | { at: 'with' }
  /** on a toy you can open too */
  | { at: 'toy'; toy: string }
  /** on a toy your Lab does not list — hidden by its owner, or from a newer build */
  | { at: 'other-toy' }
  /** on the Lab page with no toy said: their own gate is shut */
  | { at: 'lab' }
  /** on some other page; the nav's ring already says which, so the tour does not */
  | { at: 'away' }
  /** on the call and saying nothing: not sharing, a hidden tab, or a private page */
  | { at: 'quiet' }

/** somebody on the call, drawn as a token: their colour comes from their id (hueFor) */
export type Shadow = {
  id: string
  name: string
  skin?: CursorSkin
  speaking: boolean
  place: Place
}

/** what the tour can show: nothing at all, a sentence about why not, or everybody's place */
export type Tour =
  | { why: Refusal | 'not-sharing'; names: string[] }
  | { why: null; me: string; people: Shadow[] }

/**
 * The tour as you may see it.
 *
 * ⚠️ PLACES ONLY UNDER THE TWO CONDITIONS THE PICKER'S DOTS ALREADY NEED: your gate allows (in a
 * call, the room's kind known and not the Lounge, friends loaded, everyone else present your
 * friend) and you are sharing — the party drops everything while you are not, so nobody sees more
 * than they show. When either fails it is the call's own names (the dock shows them already) and
 * the reason, and the gate's refusal comes first, because sharing would not open a shut gate.
 *
 * ⚠️ THE ROSTER IS THE LIST, AND IN ITS OWN ORDER. Somebody the party remembers but the call no
 * longer has is not drawn (onToysNow, the same rule); somebody on the call who says nothing is
 * drawn as quiet rather than left out, because "Ann is here and not sharing" is the true version of
 * that fact. The order is the roster's, never sorted by place: a chip that moved whenever somebody
 * changed toy would take a focused button with it.
 */
export function tourOf(a: {
  inCall: boolean
  onLabPage: boolean
  sharing: boolean
  verdict: Verdict
  /** your own id on the call */
  me: string | null
  /** everybody else on the call, in the call's order */
  roster: readonly { id: string; name: string; speaking: boolean }[]
  here: Readonly<Record<string, Pick<PartyHere, 'route' | 'sub' | 'skin'>>>
  /** the toy on your screen */
  myToy: string | null
  /** whether your Lab lists a toy, so Go can open it */
  openable: (toy: string) => boolean
}): Tour | null {
  if (!a.inCall || !a.onLabPage) return null
  const others = a.roster.filter((p) => p.id !== a.me)
  const names = others.map((p) => p.name.slice(0, 40))
  if (!a.verdict.allowed) return a.verdict.why === 'no-call' ? null : { why: a.verdict.why, names }
  if (!a.sharing || !a.me) return { why: 'not-sharing', names }
  const people = others.map((p): Shadow => {
    const h = a.here[p.id]
    return {
      id: p.id,
      name: p.name.slice(0, 40),
      ...(h?.skin ? { skin: h.skin } : {}),
      speaking: p.speaking,
      place: placeOf(h, a.myToy, a.openable),
    }
  })
  return { why: null, me: a.me, people }
}

function placeOf(
  h: Pick<PartyHere, 'route' | 'sub'> | undefined,
  myToy: string | null,
  openable: (toy: string) => boolean,
): Place {
  if (!h) return { at: 'quiet' }
  if (h.route !== 'lab') return { at: 'away' }
  if (!h.sub) return { at: 'lab' }
  if (h.sub === myToy) return { at: 'with' }
  return openable(h.sub) ? { at: 'toy', toy: h.sub } : { at: 'other-toy' }
}

/** "Ann", "Ann and Bo", "Ann, Bo and Cy", "Ann, Bo, Cy and Dee", "Ann, Bo and 3 others" */
export function peopleWords(names: readonly string[]): string {
  const n = names.length
  if (n === 0) return ''
  if (n === 1) return names[0]
  if (n <= 4) return `${names.slice(0, -1).join(', ')} and ${names[n - 1]}`
  return `${names[0]}, ${names[1]} and ${n - 2} others`
}

/**
 * Why the tour cannot show places, in a sentence — the first time the gate's reason is said
 * anywhere. ⚠️ THE STRANGER SENTENCE NAMES NOBODY: "someone here is not your friend" is the
 * whole of what the screen may say, and the names beside it would say who.
 */
export function whyWords(why: Refusal | 'not-sharing', names: readonly string[]): string {
  switch (why) {
    case 'lounge':
      return 'Lounge calls never show which toy anyone is on.'
    case 'stranger':
      return "Someone in this call isn't on your friends list, so the Lab keeps toys to itself."
    case 'room-unknown':
      return "This call didn't say what kind of room it is, so the Lab keeps toys to itself."
    case 'friends-unknown':
      return 'Toys stay private until your friends list has loaded.'
    case 'alone':
      return 'Nobody else is in the call yet.'
    case 'no-call':
      return ''
    case 'not-sharing': {
      /* ⚠️ IT NAMES EVERYTHING THE SWITCH SHARES, AND WITH WHOM, because the switch is the call's
         (CallDock's 🫱), not the Lab's. Its audience is the CALL — everyone on it, and anyone who
         joins later — not the people named here: the pointer and the page go to the whole call,
         any window you open with them, and the toy only while everyone present is your friend
         (gate.ts). A sentence that said "share with them" about the friends here now would
         describe a smaller audience than the switch has. It ends with the call (together.ts). */
      const who = peopleWords(names)
      const lead = who ? `${who} ${names.length === 1 ? 'is' : 'are'} in the call. ` : ''
      return `${lead}Press 🫱 in the call bar to share with everyone on the call, including anyone who joins later: your pointer, the page you're on and anything you open, and which toy, while everyone here is your friend. It lasts until the call ends; you'll see theirs once they share too.`
    }
  }
}

/** where somebody is, in the words a chip uses under their name */
export function placeWords(place: Place, toyName: (toy: string) => string): string {
  switch (place.at) {
    case 'with':
      return 'with you'
    case 'toy':
      return `on ${toyName(place.toy)}`
    case 'other-toy':
      return "on a toy that isn't in your Lab"
    case 'lab':
      return 'in the Lab'
    case 'away':
      return 'elsewhere on the site'
    case 'quiet':
      return 'not showing where they are'
  }
}

/**
 * The phone's one line for the whole call: "Bo with you · Ann on Chess". Everybody who is saying
 * where they are, in the roster's order; the quiet are left to the open list, and when nobody else
 * is saying anything the line says so rather than going blank — an empty line under a heading
 * reads as a broken one.
 *
 * ⚠️ "QUIET" NEVER SAYS WHY. Not sharing, a hidden tab and a private page all look the same from
 * here, and must: party.ts makes a private page indistinguishable from switching sharing off, so
 * the words cannot claim "not sharing" about somebody who is.
 */
export function summaryOf(people: readonly Shadow[], toyName: (toy: string) => string): string {
  const said = people.filter((p) => p.place.at !== 'quiet')
  if (!said.length) return people.length ? 'Nobody else is showing where they are' : ''
  return said
    .map((p) => {
      const at = p.place
      if (at.at === 'with') return `${p.name} with you`
      if (at.at === 'toy') return `${p.name} on ${toyName(at.toy)}`
      if (at.at === 'other-toy') return `${p.name} on another toy`
      if (at.at === 'lab') return `${p.name} in the Lab`
      return `${p.name} elsewhere`
    })
    .join(' · ')
}

/**
 * The 22 toys with a call table (useLabRoom): arriving on one opens its room, which sends more than
 * a `where`. Kept true by tour.test.ts, which reads every toy's source and the Lab's registry — a
 * list nobody checks would drift the first time a toy gained a table.
 */
export const ROOM_TOYS: ReadonlySet<string> = new Set([
  'artillery',
  'bowling',
  'breakthrough',
  'chess',
  'cube',
  'curling',
  'darts',
  'dots',
  'draughts',
  'fences',
  'fourrow',
  'fox',
  'go',
  'gomoku',
  'halma',
  'hex',
  'lamps',
  'mancala',
  'morris',
  'putt',
  'reversi',
  'ultimate',
])
/**
 * The toys a tour never stops at, each with its reason — the one rule every way a tour lands on a
 * toy asks: 🎲 Surprise us (surprise, below), the bus's dice (bus.ts's rollFaces), and so the
 * dice's own choice and the guide's pick, which are only ever a face; the host refuses a roll that
 * names one, and every reader a state that does (bus.ts's facesFit and readState).
 *
 * Evan, 27 Nov 2026: "Gust is not a tour stop; keep it out of online play." Its other online
 * surfaces never had it: no call table (ROOM_TOYS, held to the sources by tour.test.ts) and no
 * match by turns (matches/games.ts, and lab-move's own list).
 *
 * ⚠️ TAKING ONE OUT AGAIN IS A WIRE CHANGE: a tab on an older build refuses any state naming it, so
 * a tour that stopped there would stall on that tab until it reloads.
 */
export const NEVER_A_STOP: ReadonlyMap<string, string> = new Map([
  [
    'gust',
    'its puck lives on the GPU and its fluid differs by graphics card, so two machines would each see a different game',
  ],
])
/** whether a tour may stop at this toy: everywhere but NEVER_A_STOP */
export const mayStopAt = (toy: string) => !NEVER_A_STOP.has(toy)

/**
 * What one move onto a toy puts on the call, in sends. A plain toy: the `where` any pick sends. A
 * toy with a call table: that, the room's `hello`, and the host's `state` on seeing you arrive and
 * again in answer to the hello — measured on the dev call on 23 Nov 2026 as one `where`, a `hello`
 * and two `state`s (the dev build's StrictMode sends the hello twice, which production does not).
 */
export const sendsFor = (toy: string | undefined) => (toy && ROOM_TOYS.has(toy) ? 4 : 1)

/**
 * How long a leader's toy has to hold still before a follower is moved: one second for two people,
 * 400 ms more per person, times what a move there costs. A leader clicking through five toys moves
 * followers once.
 *
 * ⚠️ IT GROWS WITH THE CALL, AND WITH THE TOY, BECAUSE THE BILL DOES. Each send is delivered to
 * everybody else, which Realtime meters as N messages for N people. With a follower moved at most
 * once per settleMs(N, s) and a move costing s sends, each follower costs at most
 * s·N / (0.4·N·s) = 2.5 messages a second, whatever the call size and whatever the toy. A flat
 * second would cost 12 a second per follower at the call's cap of twelve, and 48 onto a call table.
 * The first version scaled by people alone and claimed 2.5 for every toy; a review counted the
 * room's handshake, and a measurement put it at four sends. tour.test.ts counts it from the rule.
 */
export const settleMs = (people: number, sends = 1) => Math.max(1000, 400 * people * sends)

/** pressing or typing inside a toy this recently is playing it, and a follow will not pull you out */
export const PLAY_HOLD_MS = 15_000

export type FollowStep =
  /** the follow ends */
  | { do: 'stop'; why: 'left' | 'gate' | 'sharing' }
  /** the follow holds and nothing moves; `at` is when to ask again */
  | {
      do: 'wait'
      why: 'quiet' | 'away' | 'unsaid' | 'with' | 'unopenable' | 'hidden' | 'settling' | 'crossed'
      at?: number
    }
  /** the leader moved and you stay, with a Go that keeps the follow */
  | { do: 'offer'; toy: string; why: 'seat' | 'match' | 'playing' | 'offered' }
  /** move to the leader's toy, keeping the follow */
  | { do: 'go'; toy: string }

/**
 * What following somebody does now. A standing, local, opt-in choice: nobody is moved who did not
 * press Follow, and the leader is never told (shared.ts and together.ts: sharing never makes anybody
 * follow). Checked in this order, and the order is the design:
 *
 * 1. STOP when the follow can no longer mean anything: the leader left the call, your gate shut, or
 *    you stopped sharing — the last two because the leader's toy is no longer yours to see.
 * 2. WAIT, holding the follow, while there is nowhere to go: the leader is quiet (a hidden tab sends
 *    `gone`, so a leader who alt-tabs would otherwise end every follower's tour), on another page,
 *    on the Lab with no toy said, already with you, on a toy your Lab does not list — or your own
 *    tab is hidden, where a move would be a surprise waiting for you.
 * 3. OFFER, never move, when you are in something a move would throw away: a seat in an unfinished
 *    call-table game, or a match you are viewing (the address would be rebuilt without it).
 * 4. WAIT while the leader's toy settles (settleMs, scaled by what a move there costs).
 * 5. KEEP OFFERING a toy already offered this move: an offer is made once per leader move and you
 *    are never moved later for that toy — but its Go stays, so the choice is still yours.
 * 6. WAIT on a crossing: two people who pressed Follow on each other at once would otherwise swap
 *    toys for ever. If the leader has just arrived on the toy you just left for theirs, only the one
 *    whose id sorts first goes; the other waits a moment, and they meet on one toy.
 * 7. OFFER when you were playing the toy in the last 15 s — so a press is never answered by a jump.
 * 8. GO.
 *
 * `first` is the press itself: following somebody moves you at once, without settling or the play
 * rule (you pressed Follow; you are not mid-game in the sense that matters), but never out of a seat
 * or a match. It is spent on the first ask, whatever that answers — a press made while the leader is
 * away is not a standing pass for their arrival minutes later (useFollow).
 */
export function followStep(a: {
  onRoster: boolean
  gateOpen: boolean
  sharing: boolean
  leader: Pick<PartyHere, 'route' | 'sub'> | undefined
  myToy: string | null
  openable: (toy: string) => boolean
  hidden: boolean
  seated: boolean
  inMatch: boolean
  first: boolean
  /** when the leader's toy last changed, and now, on one clock */
  since: number
  now: number
  /** you and everybody else on the call */
  people: number
  /** when you last pressed or typed inside the toy */
  lastPlay: number
  /** the toy already offered for this leader move */
  offered: string | null
  /** the toy your last follow move took you away from, and when */
  left?: { toy: string; at: number } | null
  /** whether your id sorts before the leader's: on a crossing, the first one goes */
  goesFirst?: boolean
}): FollowStep {
  if (!a.onRoster) return { do: 'stop', why: 'left' }
  if (!a.gateOpen) return { do: 'stop', why: 'gate' }
  if (!a.sharing) return { do: 'stop', why: 'sharing' }
  const h = a.leader
  if (!h) return { do: 'wait', why: 'quiet' }
  if (h.route !== 'lab') return { do: 'wait', why: 'away' }
  if (!h.sub) return { do: 'wait', why: 'unsaid' }
  const toy = h.sub
  if (toy === a.myToy) return { do: 'wait', why: 'with' }
  if (!a.openable(toy)) return { do: 'wait', why: 'unopenable' }
  if (a.hidden) return { do: 'wait', why: 'hidden' }
  if (a.seated) return { do: 'offer', toy, why: 'seat' }
  if (a.inMatch) return { do: 'offer', toy, why: 'match' }
  const settle = settleMs(a.people, sendsFor(toy))
  if (!a.first) {
    const ready = a.since + settle
    if (a.now < ready) return { do: 'wait', why: 'settling', at: ready }
  }
  if (a.offered === toy) return { do: 'offer', toy, why: 'offered' }
  if (a.left && a.left.toy === toy && !a.goesFirst) {
    const until = a.left.at + 2 * settle
    if (a.now < until) return { do: 'wait', why: 'crossed', at: until }
  }
  if (!a.first && a.now - a.lastPlay < PLAY_HOLD_MS) return { do: 'offer', toy, why: 'playing' }
  return { do: 'go', toy }
}

/**
 * 🎲 Surprise us: a toy chosen at random for the call to go to — any toy your Lab lists except the
 * one on screen and the ones a tour never stops at (NEVER_A_STOP), from the kind brought forward
 * when a filter is set, or from all of them when that kind has nothing else. Null when there is
 * nowhere else to go. `rand` is a parameter so a test can seed it; the button passes Math.random.
 *
 * It is a pick like any other, so it ends your own follow and anybody following you comes along —
 * which is the point: the dice are how a leader takes the call somewhere nobody chose.
 */
export function surprise(
  ids: readonly string[],
  current: string,
  kindOf: (id: string) => string | undefined,
  filter: string,
  rand: () => number,
): string | null {
  const others = ids.filter((id) => id !== current && mayStopAt(id))
  if (!others.length) return null
  const kind = filter === 'all' ? others : others.filter((id) => kindOf(id) === filter)
  const pool = kind.length ? kind : others
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))]
}
