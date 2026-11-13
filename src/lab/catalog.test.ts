import { describe, expect, it } from 'vitest'
import registry from '../sections/labDemos.tsx?raw'
import draft from '../../supabase/migrations/20261109030613_lab_catalog_and_feedback.sql?raw'
import { CATEGORIES, META, entries, listed, readFilter, readFlags, type Flags } from './catalog'

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

  // the draft seeds the 51 the Lab had when it was written; a toy added since is registered by the
  // admin's own visit (admin_lab_register), so the draft stays the reviewed text rather than being
  // edited for every toy. What must hold is that the seed is the registry's START, in its order —
  // a renamed or reordered id would still go red here
  it('the draft migration seeds the experiments the Lab shipped, as the start of the registry', () => {
    expect(SEEDED.length).toBe(51)
    expect(DEMO_IDS.slice(0, SEEDED.length)).toEqual(SEEDED)
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

describe('who sees which', () => {
  it('lists a hidden one to the admin only', () => {
    const [e] = entries([demo('a')], new Map([['a', flags({ hidden: true })]]))
    expect(listed(e, false)).toBe(false)
    expect(listed(e, true)).toBe(true)
  })
})

describe('the picker’s filter, kept in this browser', () => {
  it('reads back a kind it knows, and anything else as all', () => {
    for (const c of CATEGORIES) expect(readFilter(c.id)).toBe(c.id)
    expect(readFilter('all')).toBe('all')
    expect(readFilter(null)).toBe('all')
    expect(readFilter('weird')).toBe('all')
  })
  it('every kind the filter offers has a short name before its description', () => {
    for (const c of CATEGORIES) expect(c.label.split(' — ')[0].length).toBeLessThan(20)
  })
})
