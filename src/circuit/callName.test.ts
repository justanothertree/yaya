import { describe, expect, it } from 'vitest'
import { LOUNGE_NAME_PENDING, type LoungeName } from './loungeName'
import { callNameFor, presenceNameInCall } from './callName'

/**
 * Who a call announces you as.
 *
 * ⚠️ THE LOUNGE CALL WAS THE LEAK LEFT AFTER THE ALIAS FIX. The Lounge strip stopped carrying a
 * member's real name, but a call in the Lounge still did, two ways: Chat handed VoiceBar the real
 * name, which voice sends to everybody in the call in its hello and here; and App's voice presence
 * tracked the FULL real name for the call's room, which every Lounge member's room list and bell
 * show as "In the call: …" (found in review, 28 Nov 2026).
 */
const REAL = 'Evan Cook'
const known = (name: string | null): LoungeName => ({ status: 'known', name })

describe('the name a call joins with', () => {
  it('in the Lounge it is the Lounge name, never the real one', () => {
    expect(callNameFor('lounge', known('Moth'), REAL)).toBe('Moth')
  })

  it('in the Lounge, with the Lounge name not yet known or failed to load, there is no name — no call', () => {
    expect(callNameFor('lounge', LOUNGE_NAME_PENDING, REAL)).toBeNull()
    expect(callNameFor('lounge', { status: 'failed' }, REAL)).toBeNull()
  })

  it('everywhere else it is your usual name, as before', () => {
    expect(callNameFor('dm', LOUNGE_NAME_PENDING, REAL)).toBe(REAL)
    expect(callNameFor('circuit', known('Moth'), REAL)).toBe(REAL)
    expect(callNameFor(undefined, { status: 'failed' }, REAL)).toBe(REAL)
  })
})

describe('the name presence carries for the room a call is in', () => {
  it('is the name the call joined with — the Lounge name in the Lounge', () => {
    expect(presenceNameInCall({ inCall: true, myName: 'Moth' }, REAL)).toBe('Moth')
  })

  it('is your usual name when there is no call', () => {
    expect(presenceNameInCall({ inCall: false, myName: null }, REAL)).toBe(REAL)
  })
})
