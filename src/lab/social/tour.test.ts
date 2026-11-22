import { describe, expect, it } from 'vitest'
import {
  peopleWords,
  placeWords,
  summaryOf,
  tourOf,
  whyWords,
  withWords,
  type Shadow,
} from './tour'
import type { Refusal } from './gate'

describe('who is on your toy, in words (withWords)', () => {
  it('says nothing about nobody', () => {
    expect(withWords([])).toBe('')
  })
  it('names one, two and three people in full', () => {
    expect(withWords(['Ann'])).toBe('with Ann')
    expect(withWords(['Ann', 'Bo'])).toBe('with Ann and Bo')
    expect(withWords(['Ann', 'Bo', 'Cy'])).toBe('with Ann, Bo and Cy')
  })
  it('past three, names two and counts the rest — and the count is the rest, not the total', () => {
    expect(withWords(['Ann', 'Bo', 'Cy', 'Dee'])).toBe('with Ann, Bo and 2 more')
    const twelve = Array.from({ length: 11 }, (_, i) => `P${i}`)
    expect(withWords(twelve)).toBe('with P0, P1 and 9 more')
    /* every name the sentence says plus the number it gives is everybody on the toy */
    for (let n = 4; n <= 11; n++) {
      const names = Array.from({ length: n }, (_, i) => `P${i}`)
      const said = withWords(names)
      const more = Number(/and (\d+) more$/.exec(said)?.[1])
      expect(2 + more).toBe(n)
    }
  })
})

/* every field something other than its default: a skin, somebody speaking, a toy, a page */
const roster = [
  { id: 'ann', name: 'Ann', speaking: true },
  { id: 'bo', name: 'Bo', speaking: false },
  { id: 'cy', name: 'Cy', speaking: false },
  { id: 'dee', name: 'Dee', speaking: false },
  { id: 'eve', name: 'Eve', speaking: false },
  { id: 'fay', name: 'Fay', speaking: false },
]
const here = {
  ann: { route: 'lab', sub: 'chess', skin: 'pen' as const },
  bo: { route: 'lab', sub: 'swarm' },
  cy: { route: 'lab', sub: 'secret-toy' },
  dee: { route: 'lab' },
  eve: { route: 'paint', skin: 'star' as const },
  /* fay says nothing */
  ghost: { route: 'lab', sub: 'chess' },
}
const listed = new Set(['chess', 'swarm', 'fourrow'])
const asked = {
  inCall: true,
  onLabPage: true,
  sharing: true,
  verdict: { allowed: true } as const,
  me: 'me',
  roster,
  here,
  myToy: 'swarm',
  openable: (t: string) => listed.has(t),
}
const touring = (over: Partial<Parameters<typeof tourOf>[0]> = {}) => {
  const t = tourOf({ ...asked, ...over })
  if (!t || t.why !== null) throw new Error(`not touring: ${JSON.stringify(t)}`)
  return t
}

describe('the tour (tourOf)', () => {
  it('draws everybody on the call in the call’s order, each in their place', () => {
    const t = touring()
    expect(t.me).toBe('me')
    expect(t.people.map((p) => [p.id, p.place])).toEqual([
      ['ann', { at: 'toy', toy: 'chess' }],
      ['bo', { at: 'with' }],
      ['cy', { at: 'other-toy' }],
      ['dee', { at: 'lab' }],
      ['eve', { at: 'away' }],
      ['fay', { at: 'quiet' }],
    ])
  })
  it('carries each person’s skin and whether they are talking', () => {
    const t = touring()
    expect(t.people[0]).toEqual({
      id: 'ann',
      name: 'Ann',
      skin: 'pen',
      speaking: true,
      place: { at: 'toy', toy: 'chess' },
    })
    expect(t.people[4].skin).toBe('star')
    expect(t.people[1].skin).toBeUndefined()
  })
  it('never draws somebody the call does not have, however recently they said where they were', () => {
    expect(touring().people.some((p) => p.id === 'ghost')).toBe(false)
  })
  it('the order is the roster’s whatever the places are', () => {
    const moved = { ...here, ann: { route: 'paint' }, bo: { route: 'lab', sub: 'chess' } }
    expect(touring({ here: moved }).people.map((p) => p.id)).toEqual(roster.map((p) => p.id))
  })
  it('a toy your Lab does not list is never offered as a place to go', () => {
    expect(touring({ openable: () => false }).people[0].place).toEqual({ at: 'other-toy' })
  })
  it('does not draw you twice when the call lists your own id (two tabs of one account)', () => {
    const t = touring({ roster: [...roster, { id: 'me', name: 'Me', speaking: false }] })
    expect(t.people.some((p) => p.id === 'me')).toBe(false)
  })
  it('a name is cut to 40 characters', () => {
    const long = '🦊'.repeat(10) + 'x'.repeat(50)
    const t = touring({ roster: [{ id: 'ann', name: long, speaking: false }] })
    expect(t.people[0].name).toBe(long.slice(0, 40))
  })
})

describe('when the tour may not show places', () => {
  it('nothing at all off the Lab page or out of a call', () => {
    expect(tourOf({ ...asked, onLabPage: false })).toBeNull()
    expect(tourOf({ ...asked, inCall: false })).toBeNull()
    expect(tourOf({ ...asked, verdict: { allowed: false, why: 'no-call' } })).toBeNull()
  })
  it('a shut gate gives its reason and the call’s names, and no places', () => {
    const t = tourOf({ ...asked, verdict: { allowed: false, why: 'stranger' } })
    expect(t).toEqual({ why: 'stranger', names: ['Ann', 'Bo', 'Cy', 'Dee', 'Eve', 'Fay'] })
  })
  it('the gate comes before sharing: sharing would not open a shut gate', () => {
    const t = tourOf({ ...asked, sharing: false, verdict: { allowed: false, why: 'lounge' } })
    expect(t?.why).toBe('lounge')
  })
  it('not sharing gives names and no places, even with a stale place in hand', () => {
    const t = tourOf({ ...asked, sharing: false })
    expect(t).toEqual({ why: 'not-sharing', names: ['Ann', 'Bo', 'Cy', 'Dee', 'Eve', 'Fay'] })
  })
})

describe('the sentences', () => {
  const refusals: Refusal[] = ['lounge', 'stranger', 'room-unknown', 'friends-unknown', 'alone']
  it('every refusal has its own sentence', () => {
    const said = refusals.map((r) => whyWords(r, ['Ann', 'Bo']))
    for (const s of said) expect(s.length).toBeGreaterThan(10)
    expect(new Set(said).size).toBe(refusals.length)
  })
  it('the stranger sentence names nobody', () => {
    const s = whyWords('stranger', ['Ann', 'Bo', 'Zed'])
    for (const n of ['Ann', 'Bo', 'Zed']) expect(s).not.toContain(n)
  })
  it('not sharing names who is waiting and what pressing the switch shares', () => {
    expect(whyWords('not-sharing', ['Ann'])).toMatch(/^Ann is in the call\. Press 🫱/)
    const s = whyWords('not-sharing', ['Ann', 'Bo'])
    expect(s).toMatch(/^Ann and Bo are in the call\./)
    expect(s).toContain("your pointer, the page you're on and anything you open")
    expect(s).toContain('until the call ends')
  })
  it('names the whole call as the audience, not just the friends here now', () => {
    /* the switch is the call's: the pointer and page go to everyone on it, and to anyone who
       joins later — "share with them" about the people named would describe a smaller audience */
    const s = whyWords('not-sharing', ['Ann', 'Bo'])
    expect(s).toContain('everyone on the call, including anyone who joins later')
    expect(s).not.toMatch(/share with them/)
    /* and the toy only while everyone present is a friend (gate.ts) */
    expect(s).toContain('while everyone here is your friend')
  })
  it('a long call is two names and a count, and the count is the rest', () => {
    expect(peopleWords(['A', 'B', 'C', 'D'])).toBe('A, B, C and D')
    expect(peopleWords(['A', 'B', 'C', 'D', 'E'])).toBe('A, B and 3 others')
  })
  it('each place has its words, and only a listed toy is named', () => {
    const name = (t: string) => (t === 'chess' ? 'Chess' : t)
    expect(touring().people.map((p) => placeWords(p.place, name))).toEqual([
      'on Chess',
      'with you',
      "on a toy that isn't in your Lab",
      'in the Lab',
      'elsewhere on the site',
      'not showing where they are',
    ])
  })
})

describe('the phone’s one line (summaryOf)', () => {
  const name = (t: string) => (t === 'chess' ? 'Chess' : t)
  it('says where everybody who is saying anything is, in the roster’s order', () => {
    expect(summaryOf(touring().people, name)).toBe(
      'Ann on Chess · Bo with you · Cy on another toy · Dee in the Lab · Eve elsewhere',
    )
  })
  it('says that nobody is sharing rather than going blank', () => {
    const quiet: Shadow[] = [{ id: 'a', name: 'Ann', speaking: false, place: { at: 'quiet' } }]
    expect(summaryOf(quiet, name)).toBe('Nobody else is showing where they are')
    expect(summaryOf([], name)).toBe('')
  })
})
