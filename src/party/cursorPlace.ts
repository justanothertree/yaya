/**
 * Where somebody else's pointer may be drawn on your screen: on the Lab toy's stage, at its page
 * position, or not at all. Pure, so cursorPlace.test.ts can ask it every case without a call — the
 * loop in PartyCursors only measures the page and moves elements by the answer.
 *
 * ⚠️ NOTHING FINER THAN THE PAGE IS DRAWN UNLESS YOUR OWN LAB GATE ALLOWS IT. The gate
 * (src/lab/social/gate.ts) decides, for the SENDER, whether a toy and a spot on it may go out: only
 * in a call where everyone else present is their friend. Friendship is not transitive, so in one
 * call Bo can be friends with everybody while Ann is not friends with Cy — Bo's gate opens and his
 * toy goes to the whole channel, while Ann's stays shut. Before this, Ann's screen drew Bo's
 * toy-relative cursor and taps anyway, because the receiving side never asked; every other Lab
 * surface (the picker dots, the roster link, the call's game rooms) already asked the viewer's own
 * gate. A refused toy-relative sample now falls back to the page position it also carries, which
 * is exactly what any other page of the site shows.
 */

import type { PartyPeer } from './party'

/** how long a tap ring lives, from its arrival */
export const TAP_MS = 700

export type CursorPlace = 'stage' | 'page' | 'hidden'

export function cursorPlace(a: {
  /** the latest pointer sample */
  peer: Pick<PartyPeer, 'route' | 'y' | 'sub' | 'tx' | 'ty'>
  /** the toy their last `where` named, if it named one */
  knownSub: string | undefined
  /** your page */
  myRoute: string
  /** the toy on your screen, on the Lab page; null anywhere else */
  myToy: string | null
  /** your own Lab gate (labSocial.allowed()) */
  labOk: boolean
  /** whether your toy has a stage to measure fractions against */
  stage: boolean
  /** the document top of your `.lab-line`, when there is one to ask; null otherwise */
  lineTop: number | null
}): CursorPlace {
  const { peer, knownSub, myRoute, myToy, labOk, stage, lineTop } = a
  if (labOk && myToy && peer.sub !== undefined && peer.tx !== undefined && peer.ty !== undefined) {
    /* their pointer is over a picture you do not have */
    if (peer.sub !== myToy) return 'hidden'
    if (stage) return 'stage'
  }
  /**
   * Somebody on another page is not drawn at all, rather than drawn at the edge or faded. A cursor
   * floating over content it is not actually pointing at is worse than no cursor: it is a wrong
   * answer to "what are they looking at" rather than no answer. The call bar names the page they
   * are on instead, which is the true version of that fact.
   */
  if (peer.route !== myRoute) return 'hidden'
  /**
   * ⚠️ ON THE LAB, A FRIEND ON A DIFFERENT TOY IS HIDDEN BELOW YOUR TOY'S LINE. 39 toys are built
   * from the page rather than on a stage, so a pointer over one of them carries no toy-relative
   * spot — only a page position, which on your screen lands on a board they are not looking at.
   * Above the line is the part of the Lab you share — the kinds, the picker — and there their
   * pointer still means what it says.
   *
   * ⚠️ AN APPROXIMATION, AND SAID SO. The line is measured on YOUR page and the pointer on theirs;
   * whatever sits above it that differs between you (Your games is your own list) moves the two
   * apart. That is the error every page-position cursor on this site already carries, and here it
   * only decides which side of the line a pointer near it falls on.
   */
  if (labOk && myRoute === 'lab' && myToy && knownSub && knownSub !== myToy && lineTop !== null)
    if (peer.y > lineTop) return 'hidden'
  return 'page'
}

/** whether a tap ring is drawn: on your toy's stage, while your gate allows, while it is fresh */
export function tapShown(a: {
  tap: { sub: string }
  myToy: string | null
  labOk: boolean
  stage: boolean
  /** milliseconds since it arrived */
  age: number
}): boolean {
  return a.labOk && a.stage && !!a.myToy && a.tap.sub === a.myToy && a.age <= TAP_MS
}
