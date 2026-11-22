import { describe, expect, it } from 'vitest'
import { cursorPlace, tapShown, TAP_MS } from './cursorPlace'

type Asked = Parameters<typeof cursorPlace>[0]
/* every field set to something other than its default, so dropping one shows */
const onSwarm = { route: 'lab', y: 900, sub: 'swarm', tx: 0.25, ty: 0.75 }
const base = {
  peer: onSwarm as Asked['peer'],
  knownSub: 'swarm' as string | undefined,
  myRoute: 'lab',
  myToy: 'swarm' as string | null,
  labOk: true,
  stage: true,
  lineTop: 400 as number | null,
}
const place = (over: Partial<typeof base> = {}) => cursorPlace({ ...base, ...over })

describe('a friend on your toy, with your gate open', () => {
  it('is drawn on the stage, at the spot on the toy they are pointing at', () => {
    expect(place()).toBe('stage')
  })
  it('a toy with no stage to measure against falls back to the page position', () => {
    expect(place({ stage: false })).toBe('page')
  })
})

describe('your own gate decides what is drawn, whatever the sender sent (receive side)', () => {
  it('a toy-relative sample is never placed on your stage while your gate is shut', () => {
    expect(place({ labOk: false })).toBe('page')
  })
  it('and a sample for a different toy is not hidden on the strength of a toy you may not use', () => {
    /* with the gate shut, the page position is all that counts — the same as any other page */
    expect(place({ labOk: false, peer: { ...onSwarm, sub: 'chess' } })).toBe('page')
  })
  it('the below-the-line rule needs the gate too', () => {
    const domToy = { route: 'lab', y: 900 }
    expect(place({ labOk: false, peer: domToy, knownSub: 'chess', stage: false })).toBe('page')
  })
})

describe('a friend on a different toy', () => {
  it('is hidden when their pointer is over that other toy', () => {
    expect(place({ peer: { ...onSwarm, sub: 'chess' } })).toBe('hidden')
  })
  it('on a toy built from the page, is hidden below your line and shown above it', () => {
    /* no sub/tx/ty: their toy has no stage, so the sample is a page position only */
    const below = { route: 'lab', y: 401 }
    const above = { route: 'lab', y: 399 }
    expect(place({ peer: below, knownSub: 'chess' })).toBe('hidden')
    expect(place({ peer: above, knownSub: 'chess' })).toBe('page')
  })
  it('the line is not asked about when they are on the same toy', () => {
    expect(place({ peer: { route: 'lab', y: 2000 }, knownSub: 'swarm' })).toBe('page')
  })
  it('without a line to measure, nothing is hidden by it', () => {
    expect(place({ peer: { route: 'lab', y: 2000 }, knownSub: 'chess', lineTop: null })).toBe(
      'page',
    )
  })
  it('a toy their `where` never named is not treated as different', () => {
    expect(place({ peer: { route: 'lab', y: 2000 }, knownSub: undefined })).toBe('page')
  })
})

describe('pages', () => {
  it('somebody on another page is not drawn', () => {
    expect(place({ peer: { route: 'home', y: 10 }, knownSub: undefined })).toBe('hidden')
  })
  it('off the Lab, a stale toy sample is just a page position', () => {
    expect(place({ myRoute: 'lab', myToy: null })).toBe('page')
    expect(place({ myRoute: 'home', myToy: null, peer: { ...onSwarm, route: 'home' } })).toBe(
      'page',
    )
  })
})

describe('tap rings', () => {
  const tap = { tap: { sub: 'swarm' }, myToy: 'swarm' as string | null, labOk: true, stage: true }
  it('are drawn on your stage while fresh', () => {
    expect(tapShown({ ...tap, age: 0 })).toBe(true)
    expect(tapShown({ ...tap, age: TAP_MS })).toBe(true)
    expect(tapShown({ ...tap, age: TAP_MS + 1 })).toBe(false)
  })
  it('are never drawn while your own gate is shut', () => {
    expect(tapShown({ ...tap, labOk: false, age: 10 })).toBe(false)
  })
  it('only on the same toy, and only with a stage', () => {
    expect(tapShown({ ...tap, tap: { sub: 'chess' }, age: 10 })).toBe(false)
    expect(tapShown({ ...tap, stage: false, age: 10 })).toBe(false)
    expect(tapShown({ ...tap, myToy: null, age: 10 })).toBe(false)
  })
})
