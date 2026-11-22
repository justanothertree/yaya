import { describe, expect, it } from 'vitest'
import { labShareAllowed, isToyId } from './gate'

const friends = new Set(['ann', 'bo', 'cy'])
const call = (over: Partial<Parameters<typeof labShareAllowed>[0]> = {}) =>
  labShareAllowed({ inCall: true, roomKind: 'dm', present: ['ann'], friends, ...over })

describe('who the Lab may tell where you are (Evan, 13 Nov: everyone present is a friend)', () => {
  it('shares in a call where everyone else present is an accepted friend', () => {
    expect(call()).toEqual({ allowed: true })
    expect(call({ present: ['ann', 'bo', 'cy'], roomKind: 'profile' })).toEqual({ allowed: true })
  })
  it('stops for the whole call when anyone present is not a friend', () => {
    expect(call({ present: ['ann', 'stranger'] })).toEqual({ allowed: false, why: 'stranger' })
  })
  it('a circuit call counts only when everyone in it is also a friend', () => {
    expect(call({ roomKind: 'circuit', present: ['ann', 'bo'] }).allowed).toBe(true)
    expect(call({ roomKind: 'circuit', present: ['ann', 'cousin'] }).allowed).toBe(false)
  })
  it('never in the Lounge, even if everyone there happens to be a friend', () => {
    expect(call({ roomKind: 'lounge' })).toEqual({ allowed: false, why: 'lounge' })
  })
  it('fails closed on anything it does not know', () => {
    expect(call({ inCall: false })).toEqual({ allowed: false, why: 'no-call' })
    // a call joined by a path that did not say what kind of room it is
    expect(call({ roomKind: null })).toEqual({ allowed: false, why: 'room-unknown' })
    // friends not loaded yet, or the load failed: not "nobody is a stranger"
    expect(call({ friends: undefined })).toEqual({ allowed: false, why: 'friends-unknown' })
    // alone in the call: nobody to share with, so nothing goes out
    expect(call({ present: [] })).toEqual({ allowed: false, why: 'alone' })
  })
})

describe('a toy id off the wire', () => {
  it('takes the shape a toy id has and nothing else', () => {
    expect(isToyId('fourrow')).toBe(true)
    expect(isToyId('time-trial')).toBe(true)
    for (const bad of ['', 'Four', 'a b', '<img>', 'x'.repeat(41), 7, null, undefined, {}])
      expect(isToyId(bad)).toBe(false)
  })
})
