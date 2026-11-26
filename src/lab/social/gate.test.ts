import { describe, expect, it } from 'vitest'
import { labShareAllowed, isToyId, onToysNow } from './gate'

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

describe('who is drawn on a toy (onToysNow)', () => {
  /* every field filled, so a filter that drops the wrong thing shows */
  const lab = [
    { id: 'ann', name: 'Ann', route: 'lab', sub: 'chess', skin: 'pen', at: 5 },
    { id: 'bo', name: 'Bo', route: 'lab', sub: 'swarm', skin: 'dot', at: 6 },
    { id: 'cy', name: 'Cy', route: 'lab', at: 7 },
  ]
  const roster = new Set(['ann', 'bo', 'cy'])
  it('draws everybody on a toy who is still in the call, while your gate allows', () => {
    expect(onToysNow(lab, roster, true).map((p) => p.id)).toEqual(['ann', 'bo'])
  })
  it('somebody the call no longer has is not drawn, however recently they said where they were', () => {
    /* Bo's tab crashed: the roster dropped him, the party still remembers his last `where` */
    expect(onToysNow(lab, new Set(['ann', 'cy']), true).map((p) => p.id)).toEqual(['ann'])
  })
  it('an id that never joined the call is never drawn', () => {
    const spoof = [...lab, { id: 'ghost', name: 'Ann', route: 'lab', sub: 'chess', at: 8 }]
    expect(onToysNow(spoof, roster, true).map((p) => p.id)).toEqual(['ann', 'bo'])
  })
  it('nobody is drawn while your own gate is shut', () => {
    expect(onToysNow(lab, roster, false)).toEqual([])
  })
  it('somebody on the Lab with no toy said is not on a toy', () => {
    expect(onToysNow(lab, roster, true).some((p) => p.id === 'cy')).toBe(false)
  })
  it('keeps what it was given', () => {
    expect(onToysNow(lab, roster, true)[0]).toBe(lab[0])
    expect(onToysNow(undefined, roster, true)).toEqual([])
  })
})
