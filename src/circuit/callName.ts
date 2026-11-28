import { loungePresenceName, type LoungeName } from './loungeName'

/**
 * Who a call announces you as — the second half of "the Lounge never gets your real name".
 *
 * ⚠️ A CALL HAS TWO MOUTHS, AND BOTH SPOKE THE REAL NAME IN THE LOUNGE. Voice sends the name it
 * joined with to everybody in the call (its `hello` and `here`), and App's voice presence tracks a
 * name on the call's room for every member's room list and bell ("In the call: …"). Chat gave the
 * first the real name and App gave the second the FULL real name, so a Lounge alias held in the
 * Lounge's strip and fell apart the moment somebody pressed Call (found in review, 28 Nov 2026).
 *
 * So the call joins with the Lounge name in the Lounge — or does not join, while that name is not
 * known — and presence carries whatever name the call joined with.
 */
export function callNameFor(
  kind: 'lounge' | 'dm' | 'circuit' | undefined,
  lounge: LoungeName,
  realName: string,
): string | null {
  return kind === 'lounge' ? loungePresenceName(lounge) : realName
}

/** The name presence carries for the call's room: the one the call joined with, when there is one. */
export function presenceNameInCall(
  voice: { inCall: boolean; myName: string | null },
  realName: string,
): string {
  return voice.inCall && voice.myName ? voice.myName : realName
}
