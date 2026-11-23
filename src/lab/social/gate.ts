/**
 * Whether the Lab may tell a call which toy you are on, and later where your pointer is on it.
 *
 * ⚠️ FRIENDS ONLY, AND CHECKED BY THE SENDER (Evan, 13 Nov). A call's channel admits more than
 * friends — the Lounge, a circuit, a profile owner's friends who are not each other's — and a
 * broadcast reaches everybody on the channel, so the only place "friends only" can be kept is
 * before anything is sent. The rule: everyone else present is an accepted friend of yours. A
 * circuit-mate counts only if they are a friend as well; the Lounge never counts.
 *
 * ⚠️ IT FAILS CLOSED. Not in a call, a room whose kind was never said, friends not loaded yet or
 * failed to load, nobody else there: each is "not allowed", never "nobody objected". The party's
 * own page-and-pointer sharing is unchanged by this; this gates only what the Lab adds.
 *
 * Pure, so gate.test.ts asks it every case without a call.
 */

import type { RoomKind } from '../../voice/voiceSession'
export type { RoomKind }
export type Refusal =
  | 'no-call'
  | 'room-unknown'
  | 'lounge'
  | 'friends-unknown'
  | 'alone'
  | 'stranger'
export type Verdict = { allowed: true } | { allowed: false; why: Refusal }

export function labShareAllowed(a: {
  inCall: boolean
  roomKind: RoomKind | null
  /** everyone else in the call, by user id */
  present: readonly string[]
  /** your accepted friends' user ids, or undefined while unknown */
  friends: ReadonlySet<string> | undefined
}): Verdict {
  if (!a.inCall) return { allowed: false, why: 'no-call' }
  if (!a.roomKind) return { allowed: false, why: 'room-unknown' }
  if (a.roomKind === 'lounge') return { allowed: false, why: 'lounge' }
  if (!a.friends) return { allowed: false, why: 'friends-unknown' }
  if (!a.present.length) return { allowed: false, why: 'alone' }
  if (!a.present.every((id) => a.friends!.has(id))) return { allowed: false, why: 'stranger' }
  return { allowed: true }
}

/**
 * A toy id as it may arrive from somebody else's client: the shape the lab_demos table itself
 * enforces (`^[a-z0-9][a-z0-9-]{0,39}$`), and nothing more. The Lab shows only a toy it can find
 * in its own list, so a well-formed id that names nothing is simply never drawn — this keeps the
 * 133-toy catalog out of the site's main bundle, where the party lives.
 */
export const isToyId = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(v)

/**
 * Who to draw on which toy: the people the party says are on a Lab toy, kept only while your own
 * gate allows and only while they are still in the call.
 *
 * ⚠️ THE CALL'S ROSTER IS THE LIST, AND THE PARTY ONLY ADDS WHERE. Somebody who has left the call
 * has left every toy, and a `where` from an id that never joined the call is never drawn at all.
 * The roster drops a person on their `bye` — the Leave button, or a tab closed — and leaving
 * tells the party nothing (leave() sends the call a `bye` and the party no `gone`), so without
 * this a friend who hung up stayed on their toy until the party's 16 s sweep.
 *
 * ⚠️ A CRASH IS NOT FASTER, AND THIS USED TO SAY IT WAS. A crashed tab sends no `bye`, and WebRTC
 * never reports it closed — voiceSession marks it reconnecting and keeps it on the roster for the
 * rest of the call — so it still leaves a toy at the party's 16 s sweep, as before. The faster drop
 * once measured for it belonged to the dev call, which expired silent tabs (labCall.ts says so).
 * useLabRoom has always asked it this way; the picker dots and the roster link did not.
 */
export function onToysNow<T extends { id: string; sub?: string }>(
  lab: readonly T[] | undefined,
  roster: ReadonlySet<string>,
  allowed: boolean,
): T[] {
  if (!allowed) return []
  return (lab ?? []).filter((p) => !!p.sub && roster.has(p.id))
}
