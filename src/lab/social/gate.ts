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
