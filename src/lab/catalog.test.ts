import { describe, expect, it } from 'vitest'
import registry from '../sections/GpuLab.tsx?raw'
import draft from '../../supabase/drafts/lab-catalog-and-feedback.sql?raw'
import {
  CATEGORIES,
  EVERYTHING,
  META,
  arrange,
  showingAll,
  byNewest,
  byRating,
  entries,
  listed,
  MAX_RECENT,
  openedNow,
  readFavourites,
  readRecent,
  surprise,
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
      notes: { idea: 1, more: 0, bug: 4 },
      reports: 1,
    })
    expect(m.get('b')).toEqual(flags({ hidden: true }))
  })

  it('reads zeros as a total — nothing voted is 0 and 0, not missing', () => {
    const m = readFlags([{ id: 'a', up: 0, down: 0 }], known)
    expect(m.get('a')).toEqual(flags({ up: 0, down: 0 }))
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

describe('what the catalog is showing', () => {
  const list = entries(
    [demo('swarm'), demo('fold', 'Fold'), demo('harp', 'Harp'), demo('topple'), demo('mobius')],
    new Map([['topple', flags({ featured: true })]]),
  )
  const ids = (b: Partial<typeof EVERYTHING>, fav: string[] = [], rec: string[] = []) =>
    arrange(list, { ...EVERYTHING, ...b }, fav, rec).map((e) => e.id)
  it('everything: featured first, then the Lab’s order', () => {
    expect(ids({})).toEqual(['topple', 'swarm', 'fold', 'harp', 'mobius'])
  })
  // ⚠️ by SOUND, not games: which kind a game or puzzle belongs to is a call the catalog revisits
  // (games and puzzles were split), and a test about filtering must not break when it does
  it('narrows by search, kind and list together', () => {
    const sound = arrange(
      entries(
        [demo('swarm'), demo('harp', 'Harp'), demo('fold'), demo('music', 'Music')],
        new Map(),
      ),
      { ...EVERYTHING, category: 'sound' },
      [],
      [],
    ).map((e) => e.id)
    expect(sound).toEqual(['harp', 'music'])
    expect(ids({ category: 'sound' })).toEqual(['harp'])
    expect(ids({ category: 'sound', query: 'fold' })).toEqual([])
    expect(ids({ category: 'patterns', view: 'favourites' }, ['harp', 'swarm'])).toEqual(['swarm'])
    expect(ids({ category: 'patterns', view: 'favourites' }, ['harp'])).toEqual([])
  })
  it('recent: the order they were opened in, not the Lab’s', () => {
    expect(ids({ view: 'recent' }, [], ['mobius', 'swarm', 'harp'])).toEqual([
      'mobius',
      'swarm',
      'harp',
    ])
  })
  it('knows when it is showing everything, so the page can offer the way back to it', () => {
    expect(showingAll(EVERYTHING)).toBe(true)
    expect(showingAll({ ...EVERYTHING, query: '   ' })).toBe(true)
    expect(showingAll({ ...EVERYTHING, query: 'x' })).toBe(false)
    expect(showingAll({ ...EVERYTHING, view: 'new' })).toBe(false)
    expect(showingAll({ ...EVERYTHING, category: 'sound' })).toBe(false)
  })
})

describe('recently opened, kept in this browser', () => {
  const known = new Set(['a', 'b', 'c', 'd'])
  it('puts the one just opened first, once, and keeps the rest in the order they were opened', () => {
    let r: string[] = []
    for (const id of ['a', 'b', 'c', 'b', 'd']) r = openedNow(r, id)
    expect(r).toEqual(['d', 'b', 'c', 'a'])
    expect(openedNow(r, 'd')).toEqual(r)
  })

  it('remembers the last twelve and forgets the oldest', () => {
    let r: string[] = []
    for (let i = 0; i < 20; i++) r = openedNow(r, `t${i}`)
    expect(r.length).toBe(MAX_RECENT)
    expect(r[0]).toBe('t19')
    expect(r[MAX_RECENT - 1]).toBe(`t${20 - MAX_RECENT}`)
  })

  it('reads back only ids the Lab has, without repeats, and nothing from junk', () => {
    expect(readRecent(JSON.stringify(['c', 'gone', 'a', 'c', 7, null, 'b']), known)).toEqual([
      'c',
      'a',
      'b',
    ])
    expect(readRecent('{"a":1}', known)).toEqual([])
    expect(readRecent('nope', known)).toEqual([])
    expect(readRecent(null, known)).toEqual([])
  })
})

describe('surprise me', () => {
  const list = ['a', 'b', 'c', 'd'].map((id, order) => ({
    ...demo(id),
    order,
    category: 'games' as const,
    added: '2026-11-01',
    flags: flags(),
  }))
  it('never hands back one opened lately while there are others', () => {
    for (let i = 0; i < 40; i++) {
      const r = i / 40
      expect(['c', 'd']).toContain(surprise(list, ['a', 'b'], () => r))
    }
  })
  it('reaches every one it may choose from', () => {
    const got = new Set([0, 0.3, 0.6, 0.99].map((r) => surprise(list, ['a'], () => r)))
    expect([...got].sort()).toEqual(['b', 'c', 'd'])
  })
  it('when all were opened lately, anything but the one open now; nothing from nothing', () => {
    for (const r of [0, 0.5, 0.999])
      expect(surprise(list, ['b', 'a', 'c', 'd'], () => r)).not.toBe('b')
    expect(surprise(list.slice(0, 1), ['a'], () => 0.5)).toBe('a')
    expect(surprise([], [], () => 0.5)).toBeNull()
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
