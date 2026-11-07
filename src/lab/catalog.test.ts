import { describe, expect, it } from 'vitest'
import registry from '../sections/GpuLab.tsx?raw'
import draft from '../../supabase/drafts/lab-catalog-and-feedback.sql?raw'
import {
  CATEGORIES,
  META,
  byNewest,
  byRating,
  entries,
  listed,
  readFavourites,
  readFlags,
  search,
  toggleFavourite,
  withoutName,
  type Flags,
} from './catalog'

/** the DEMOS registry as the source has it: read as text, so this test needs no GPU module */
const DEMO_IDS = [...registry.matchAll(/^ {4}id: '([a-z0-9-]+)',$/gm)].map((m) => m[1])
const SEEDED = [
  ...(
    draft.match(/insert into public\.lab_demos \(id\) values([\s\S]*?)on conflict/)?.[1] ?? ''
  ).matchAll(/\('([a-z0-9-]+)'\)/g),
].map((m) => m[1])

const demo = (id: string, name = id) => ({ id, name, line: `${name} — a thing about ${id}` })
const flags = (f: Partial<Flags> = {}): Flags => ({
  featured: false,
  experiment: false,
  hidden: false,
  ...f,
})

describe('the registry, the catalog and the database agree', () => {
  it('reads all the experiments out of the registry', () => {
    expect(DEMO_IDS.length).toBeGreaterThanOrEqual(51)
    expect(new Set(DEMO_IDS).size).toBe(DEMO_IDS.length)
  })

  it('every experiment has a kind and a date, and nothing else does', () => {
    expect(Object.keys(META).sort()).toEqual([...DEMO_IDS].sort())
    for (const id of DEMO_IDS) expect(CATEGORIES.map((c) => c.id)).toContain(META[id].category)
  })

  it('dates only ever go forward along the registry, which is append-only', () => {
    const dates = DEMO_IDS.map((id) => META[id].added)
    for (let k = 1; k < dates.length; k++) expect(dates[k] >= dates[k - 1]).toBe(true)
    for (const d of dates) expect(d).toMatch(/^2026-\d\d-\d\d$/)
  })

  it('the draft migration seeds exactly the experiments the Lab ships, in the same order', () => {
    expect(SEEDED).toEqual(DEMO_IDS)
  })

  it('every kind has something in it', () => {
    for (const c of CATEGORIES) expect(DEMO_IDS.some((id) => META[id].category === c.id)).toBe(true)
  })
})

describe('reading what the server sends', () => {
  const known = new Set(['a', 'b', 'c'])
  it('keeps the fields it knows, of the types it expects', () => {
    const m = readFlags(
      [
        {
          id: 'a',
          featured: true,
          up: 3,
          down: 1,
          mine: 1,
          withheld: 2,
          notes: { idea: 1, more: 0, bug: 4 },
          reports: 1,
        },
        { id: 'b', hidden: true },
      ],
      known,
    )
    expect(m.get('a')).toEqual({
      featured: true,
      experiment: false,
      hidden: false,
      up: 3,
      down: 1,
      mine: 1,
      withheld: 2,
      notes: { idea: 1, more: 0, bug: 4 },
      reports: 1,
    })
    expect(m.get('b')).toEqual(flags({ hidden: true }))
  })

  it('drops what it does not expect: unknown ids, bad counts, half a total, a mine that is not ±1', () => {
    const m = readFlags(
      [
        { id: 'nope', featured: true },
        { id: 'a', featured: 'yes', up: -1, down: 2, mine: 2 },
        { id: 'b', up: 2 },
        { id: 'c', up: 1.5, down: 0, notes: { idea: 1 } },
        null,
        'a',
      ],
      known,
    )
    expect(m.has('nope')).toBe(false)
    expect(m.get('a')).toEqual(flags())
    expect(m.get('b')).toEqual(flags())
    expect(m.get('c')).toEqual(flags())
    expect(readFlags('not a list', known).size).toBe(0)
  })
})

describe('finding one', () => {
  const list = entries(
    [demo('mobius', 'Möbius golf'), demo('harp', 'Harp'), demo('fold', 'Fold')],
    new Map(),
  )
  it('ignores accents and case, and needs every word', () => {
    expect(search(list, 'MOBIUS').map((e) => e.id)).toEqual(['mobius'])
    expect(search(list, 'harp thing').map((e) => e.id)).toEqual(['harp'])
    expect(search(list, 'harp golf')).toEqual([])
    expect(search(list, '   ').length).toBe(3)
  })
  it('finds a kind by its name', () => {
    // fold and mobius are games, harp is sound
    expect(search(list, 'puzzles').map((e) => e.id)).toEqual(['mobius', 'fold'])
    expect(search(list, 'music').map((e) => e.id)).toEqual(['harp'])
  })
  it('lists a hidden one to the admin only', () => {
    const [e] = entries([demo('a')], new Map([['a', flags({ hidden: true })]]))
    expect(listed(e, false)).toBe(false)
    expect(listed(e, true)).toBe(true)
  })
})

describe('the orders the page states', () => {
  it('highly rated: net votes, then more votes, then the Lab’s order — unvoted last', () => {
    const list = entries(
      ['none', 'small', 'wide', 'loved', 'tie-late', 'mixed'].map((id) => demo(id)),
      new Map([
        ['small', flags({ up: 2, down: 0 })], //   net 2, 2 votes
        ['wide', flags({ up: 6, down: 4 })], //    net 2, 10 votes
        ['loved', flags({ up: 9, down: 1 })], //   net 8
        ['tie-late', flags({ up: 2, down: 0 })], // net 2, 2 votes, later in the Lab
        ['mixed', flags({ up: 0, down: 3 })], //   net −3
      ]),
    )
    expect(byRating(list).map((e) => e.id)).toEqual([
      'loved',
      'wide',
      'small',
      'tie-late',
      'mixed',
      'none',
    ])
  })
  it('new: the day added, newest first, then the order added', () => {
    const list = entries(
      [demo('swarm'), demo('fold'), demo('topple'), demo('printshop')],
      new Map(),
    )
    // printshop 7 Nov; fold and topple 6 Nov, topple listed after fold as in the Lab; swarm 5 Nov
    expect(byNewest(list).map((e) => e.id)).toEqual(['printshop', 'topple', 'fold', 'swarm'])
  })
})

describe('favourites, kept in this browser', () => {
  const known = new Set(['a', 'b', 'c'])
  it('reads only known ids, once each, from whatever is stored', () => {
    expect(readFavourites('["a","zz","a",3,"c"]', known)).toEqual(['a', 'c'])
    expect(readFavourites('{"a":1}', known)).toEqual([])
    expect(readFavourites('not json', known)).toEqual([])
    expect(readFavourites(null, known)).toEqual([])
  })
  it('caps the list', () => {
    const many = new Set(Array.from({ length: 300 }, (_, k) => `t${k}`))
    expect(readFavourites(JSON.stringify([...many]), many)).toHaveLength(200)
  })
  it('toggles in and out', () => {
    expect(toggleFavourite(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleFavourite(['a', 'b'], 'a')).toEqual(['b'])
  })
})

describe('a card’s line', () => {
  it('drops the name the card already shows, and nothing that is not the name', () => {
    expect(withoutName({ name: 'Harp', line: 'Harp — strum the strings.' })).toBe(
      'strum the strings.',
    )
    expect(withoutName({ name: 'Music', line: 'Music visual — your mic as bars.' })).toBe(
      'your mic as bars.',
    )
    const swarm =
      'Up to two million particles in a swirling current — a compute pass moves every one.'
    expect(withoutName({ name: 'Swarm', line: swarm })).toBe(swarm)
  })
  it('keeps every real line’s words after its name', () => {
    for (const m of registry.matchAll(
      /^ {4}name: '([^']+)',\n {4}line:\s*\n?\s*['"](.+)['"],$/gm,
    )) {
      const kept = withoutName({ name: m[1], line: m[2] })
      expect(kept.length, m[1]).toBeGreaterThan(10)
    }
  })
})
