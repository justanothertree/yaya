/**
 * The Lab's catalog: what kind of thing each experiment is, when it arrived, how a list of them is
 * searched and ordered, and the browser's own favourites. Pure, so catalog.test.ts can ask it
 * questions without a GPU or a page.
 *
 * ⚠️ THE ORDERS ARE THE ONES THE PAGE SAYS THEY ARE, AND NOTHING ELSE. "Highly rated" is votes up
 * minus votes down, then more votes, then the order the Lab lists them; "New" is the date an
 * experiment was added, newest first. No weighting, no decay, no hidden boost — the page states
 * the rule beside the list, so the list must be exactly that rule.
 *
 * ⚠️ AND A FAVOURITE IS NOT A VOTE. A favourite is a bookmark kept in this browser and never sent
 * anywhere; a vote is an account's public-in-aggregate opinion kept on the server. Neither moves
 * the other.
 */

export type Category = 'games' | 'make' | 'sound' | 'nature' | 'patterns'

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'games', label: '🎮 Games & puzzles' },
  { id: 'make', label: '🎨 Draw & make' },
  { id: 'sound', label: '🎵 Sound & music' },
  { id: 'nature', label: '🌊 Poke at nature' },
  { id: 'patterns', label: '🔬 Patterns & maths' },
]

/**
 * Each experiment's kind, and the day it was added — the author date of the commit that first put
 * its id in the DEMOS list (`git log --format=%as -S "'id'" -- src/sections/GpuLab.tsx`). A new
 * experiment needs a line here: catalog.test.ts fails until every DEMOS id has one.
 */
export const META: Record<string, { category: Category; added: string }> = {
  swarm: { category: 'patterns', added: '2026-11-05' },
  life: { category: 'patterns', added: '2026-11-05' },
  fluid: { category: 'make', added: '2026-11-05' },
  music: { category: 'sound', added: '2026-11-05' },
  kaleido: { category: 'make', added: '2026-11-05' },
  lava: { category: 'nature', added: '2026-11-05' },
  galaxy: { category: 'sound', added: '2026-11-05' },
  marble: { category: 'make', added: '2026-11-05' },
  growth: { category: 'patterns', added: '2026-11-05' },
  aquarium: { category: 'nature', added: '2026-11-05' },
  tunnel: { category: 'games', added: '2026-11-05' },
  cloth: { category: 'nature', added: '2026-11-05' },
  ribbons: { category: 'sound', added: '2026-11-05' },
  fractal: { category: 'patterns', added: '2026-11-05' },
  light: { category: 'nature', added: '2026-11-05' },
  harp: { category: 'sound', added: '2026-11-05' },
  neon: { category: 'make', added: '2026-11-05' },
  sand: { category: 'nature', added: '2026-11-05' },
  pond: { category: 'nature', added: '2026-11-05' },
  slime: { category: 'nature', added: '2026-11-05' },
  mirror: { category: 'make', added: '2026-11-05' },
  bubbles: { category: 'nature', added: '2026-11-05' },
  clay: { category: 'make', added: '2026-11-05' },
  fireflies: { category: 'sound', added: '2026-11-05' },
  blackhole: { category: 'nature', added: '2026-11-05' },
  erosion: { category: 'nature', added: '2026-11-05' },
  snowflake: { category: 'nature', added: '2026-11-05' },
  pixelsort: { category: 'make', added: '2026-11-05' },
  squish: { category: 'nature', added: '2026-11-05' },
  lightning: { category: 'nature', added: '2026-11-05' },
  voiceprint: { category: 'sound', added: '2026-11-05' },
  marbles: { category: 'games', added: '2026-11-05' },
  glass: { category: 'make', added: '2026-11-05' },
  harmonograph: { category: 'make', added: '2026-11-05' },
  rain: { category: 'make', added: '2026-11-05' },
  loom: { category: 'make', added: '2026-11-05' },
  ferro: { category: 'sound', added: '2026-11-05' },
  trials: { category: 'games', added: '2026-11-06' },
  waterworks: { category: 'games', added: '2026-11-06' },
  studio: { category: 'make', added: '2026-11-06' },
  critters: { category: 'make', added: '2026-11-06' },
  strut: { category: 'games', added: '2026-11-06' },
  gust: { category: 'games', added: '2026-11-06' },
  seedling: { category: 'games', added: '2026-11-06' },
  mobius: { category: 'games', added: '2026-11-06' },
  pinball: { category: 'games', added: '2026-11-06' },
  crossing: { category: 'games', added: '2026-11-06' },
  shadowbox: { category: 'games', added: '2026-11-06' },
  fold: { category: 'games', added: '2026-11-06' },
  topple: { category: 'games', added: '2026-11-06' },
  printshop: { category: 'make', added: '2026-11-07' },
}

/** what the server says about one experiment; every field optional, and only what it may say */
export type Flags = {
  featured: boolean
  experiment: boolean
  hidden: boolean
  /** votes up and down in the shared total — present only for a signed-in member */
  up?: number
  down?: number
  /** the caller's own vote */
  mine?: 1 | -1
  /** whether the caller's own vote is in the shared total (not for a minor or an unknown age) */
  counted?: boolean
  /** admin only: votes kept out of the total, notes by kind, reported notes */
  withheld?: number
  notes?: { idea: number; more: number; bug: number }
  reports?: number
}

export type Entry = {
  id: string
  name: string
  line: string
  category: Category
  added: string
  /** position in the DEMOS list, which is the order they were added */
  order: number
  flags: Flags
}

const NO_FLAGS: Flags = { featured: false, experiment: false, hidden: false }
const count = (v: unknown) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e9 ? v : undefined

/**
 * The server's catalog, read defensively: an array of objects keyed by id, every field checked,
 * anything unexpected dropped. Ids the page does not know are ignored rather than shown.
 */
export function readFlags(raw: unknown, known: ReadonlySet<string>): Map<string, Flags> {
  const out = new Map<string, Flags>()
  if (!Array.isArray(raw)) return out
  for (const r of raw.slice(0, 1000)) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    if (typeof o.id !== 'string' || !known.has(o.id)) continue
    const f: Flags = {
      featured: o.featured === true,
      experiment: o.experiment === true,
      hidden: o.hidden === true,
    }
    const up = count(o.up)
    const down = count(o.down)
    if (up !== undefined && down !== undefined) {
      f.up = up
      f.down = down
    }
    if (o.mine === 1 || o.mine === -1) f.mine = o.mine
    if (typeof o.counted === 'boolean') f.counted = o.counted
    const withheld = count(o.withheld)
    if (withheld !== undefined) f.withheld = withheld
    if (o.notes && typeof o.notes === 'object') {
      const n = o.notes as Record<string, unknown>
      const [idea, more, bug] = [count(n.idea), count(n.more), count(n.bug)]
      if (idea !== undefined && more !== undefined && bug !== undefined)
        f.notes = { idea, more, bug }
    }
    const reports = count(o.reports)
    if (reports !== undefined) f.reports = reports
    out.set(o.id, f)
  }
  return out
}

export function entries(
  demos: readonly { id: string; name: string; line: string }[],
  flags: ReadonlyMap<string, Flags>,
): Entry[] {
  return demos.map((d, order) => ({
    id: d.id,
    name: d.name,
    line: d.line,
    category: META[d.id]?.category ?? 'patterns',
    added: META[d.id]?.added ?? '1970-01-01',
    order,
    flags: flags.get(d.id) ?? NO_FLAGS,
  }))
}

/** the card already says the name: drop a line's leading "Name — ", and only when it IS the name */
export function withoutName(e: Pick<Entry, 'name' | 'line'>) {
  const m = e.line.match(/^([^—]*?)\s*—\s*/)
  return m && m[1].startsWith(e.name) ? e.line.slice(m[0].length) : e.line
}

/** may this viewer see this experiment in the picker and the catalog at all */
export const listed = (e: Entry, admin: boolean) => admin || !e.flags.hidden

/** lower case, accents gone, so "mobius" finds "Möbius" */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** every word of the query in the name, the line or the category's name */
export function search(list: readonly Entry[], query: string): Entry[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return [...list]
  return list.filter((e) => {
    const hay = fold(
      `${e.name} ${e.line} ${CATEGORIES.find((c) => c.id === e.category)?.label ?? ''}`,
    )
    return words.every((w) => hay.includes(w))
  })
}

export const net = (e: Entry) => (e.flags.up ?? 0) - (e.flags.down ?? 0)
const votes = (e: Entry) => (e.flags.up ?? 0) + (e.flags.down ?? 0)

/** highest net votes first, then more votes, then the Lab's own order. Unvoted ones last. */
export function byRating(list: readonly Entry[]): Entry[] {
  return [...list].sort(
    (a, b) =>
      Number(votes(b) > 0) - Number(votes(a) > 0) ||
      net(b) - net(a) ||
      votes(b) - votes(a) ||
      a.order - b.order,
  )
}

/** newest first: the day added, then the order added */
export function byNewest(list: readonly Entry[]): Entry[] {
  return [...list].sort((a, b) => b.added.localeCompare(a.added) || b.order - a.order)
}

/* ---------------------------------------------------------------- favourites, in this browser */

export const FAVOURITES_KEY = 'lab_favourites_v1'
const MAX_FAVOURITES = 200

/** the favourites kept here, read defensively: ids the page knows, at most 200, no repeats */
export function readFavourites(text: string | null, known: ReadonlySet<string>): string[] {
  try {
    const v: unknown = JSON.parse(text ?? '[]')
    if (!Array.isArray(v)) return []
    return [...new Set(v.filter((x): x is string => typeof x === 'string' && known.has(x)))].slice(
      0,
      MAX_FAVOURITES,
    )
  } catch {
    return []
  }
}

export function toggleFavourite(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id].slice(-MAX_FAVOURITES)
}
