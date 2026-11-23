/**
 * The Lab tour: friends on the same call seeing each other on the Lab's toys, the way players see
 * each other on a board. Pure, so tour.test.ts can ask it without a call or a page —
 * docs/2026-11-22-lab-tour.md has the plan, and why none of it adds a message to the wire.
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
