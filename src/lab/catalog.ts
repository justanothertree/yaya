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

export type Category = 'games' | 'puzzles' | 'make' | 'sound' | 'nature' | 'patterns'

export const CATEGORIES: { id: Category; label: string }[] = [
  /* ⚠️ GAMES AND PUZZLES WERE ONE KIND until it held twenty of sixty-one — a third of the Lab, so
     choosing it narrowed almost nothing. A game asks for skill and timing; a puzzle has an answer
     to find, usually against a par. Toys with both (Bridge drives a cart; Orbit has a fewest-fuel
     answer) go where most of the time is spent. */
  { id: 'games', label: '🎮 Games — skill and timing' },
  { id: 'puzzles', label: '🧩 Puzzles — find the answer' },
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
  waterworks: { category: 'puzzles', added: '2026-11-06' },
  studio: { category: 'make', added: '2026-11-06' },
  critters: { category: 'make', added: '2026-11-06' },
  strut: { category: 'games', added: '2026-11-06' },
  gust: { category: 'games', added: '2026-11-06' },
  seedling: { category: 'puzzles', added: '2026-11-06' },
  mobius: { category: 'games', added: '2026-11-06' },
  pinball: { category: 'games', added: '2026-11-06' },
  crossing: { category: 'games', added: '2026-11-06' },
  shadowbox: { category: 'puzzles', added: '2026-11-06' },
  fold: { category: 'puzzles', added: '2026-11-06' },
  topple: { category: 'puzzles', added: '2026-11-06' },
  printshop: { category: 'make', added: '2026-11-07' },
  jigsaw: { category: 'puzzles', added: '2026-11-08' },
  palette: { category: 'make', added: '2026-11-08' },
  beams: { category: 'puzzles', added: '2026-11-08' },
  bridge: { category: 'puzzles', added: '2026-11-08' },
  epicycles: { category: 'patterns', added: '2026-11-08' },
  orbit: { category: 'games', added: '2026-11-08' },
  wallpaper: { category: 'make', added: '2026-11-08' },
  nonogram: { category: 'puzzles', added: '2026-11-08' },
  gates: { category: 'puzzles', added: '2026-11-08' },
  slide: { category: 'puzzles', added: '2026-11-08' },
  mix: { category: 'puzzles', added: '2026-11-08' },
  intervals: { category: 'sound', added: '2026-11-08' },
  graph: { category: 'patterns', added: '2026-11-08' },
  sun: { category: 'nature', added: '2026-11-08' },
  skip: { category: 'games', added: '2026-11-08' },
}

/** what the server says about one experiment; every field optional, and only what it may say */
export type Flags = {
  featured: boolean
  experiment: boolean
  hidden: boolean
  /** votes up and down in the shared total, zeros included — present only for a signed-in member */
  up?: number
  down?: number
  /** the caller's own vote */
  mine?: 1 | -1
  /** admin only: notes by kind among the ones the admin can read, and notes with an open report */
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

/* ---------------------------------------------------------------- what the catalog is showing */

export type View = 'all' | 'recent' | 'favourites' | 'new' | 'top'

/** the catalog's search, list and kind. ⚠️ The Lab holds this, not the catalog: the catalog is
 *  unmounted while a toy plays, and when this lived inside it every return from a toy started
 *  again at All with the search empty, a long way above the card just left. */
export type Browse = { query: string; view: View; category: Category | null }
export const EVERYTHING: Browse = { query: '', view: 'all', category: null }
export const showingAll = (b: Browse) => !b.query.trim() && b.view === 'all' && b.category === null

/** the cards to show, in the order the page states for the list chosen */
export function arrange(
  list: readonly Entry[],
  b: Browse,
  favourites: readonly string[],
  recent: readonly string[],
): Entry[] {
  let out = search(list, b.query)
  if (b.category) out = out.filter((e) => e.category === b.category)
  if (b.view === 'favourites') out = out.filter((e) => favourites.includes(e.id))
  if (b.view === 'recent')
    return out
      .filter((e) => recent.includes(e.id))
      .sort((x, y) => recent.indexOf(x.id) - recent.indexOf(y.id))
  if (b.view === 'new') return byNewest(out)
  if (b.view === 'top') return byRating(out)
  // featured first, then the Lab's own order — the page says so above the list
  return [...out].sort(
    (x, y) => Number(y.flags.featured) - Number(x.flags.featured) || x.order - y.order,
  )
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

/* The experiments opened lately, most recent first — a history in this browser, not a library.
   ⚠️ UNLIKE FAVOURITES IT FORGETS: the twelfth-newest falls off when another is opened. That is
   safe here only because nothing else mirrors this list; it is not anybody's work, and it never
   leaves the browser. */
export const RECENT_KEY = 'lab_recent_v1'
export const MAX_RECENT = 12

export function readRecent(text: string | null, known: ReadonlySet<string>): string[] {
  try {
    const v: unknown = JSON.parse(text ?? '[]')
    if (!Array.isArray(v)) return []
    return [...new Set(v.filter((x): x is string => typeof x === 'string' && known.has(x)))].slice(
      0,
      MAX_RECENT,
    )
  } catch {
    return []
  }
}

/**
 * One to try: picked at random from the list given (what the catalog is showing), preferring ones
 * not opened lately — a surprise that hands back what you just closed is not one. When everything
 * shown has been opened lately, anything but the one open now; null for an empty list.
 */
export function surprise(
  list: readonly Entry[],
  recent: readonly string[],
  rand: () => number = Math.random,
): string | null {
  const fresh = list.filter((e) => !recent.includes(e.id))
  const pool = fresh.length ? fresh : list.filter((e) => e.id !== recent[0])
  const from = pool.length ? pool : list
  if (!from.length) return null
  return from[Math.min(from.length - 1, Math.floor(rand() * from.length))].id
}

/** opening one brings it to the front, once */
export const openedNow = (list: readonly string[], id: string): string[] =>
  [id, ...list.filter((x) => x !== id)].slice(0, MAX_RECENT)

/* What this browser has already met, so an experiment added since can say so. ⚠️ A FIRST VISIT
   MEETS EVERYTHING: with no record, every experiment there is is written down as seen, so the
   badge means "added since you started coming here" — not fifty-nine badges on a first look,
   which would say nothing. An experiment stops being new to you once you open it, or when you
   say you have seen them all. Kept in this browser only, like favourites; never sent. */
export const SEEN_KEY = 'lab_seen_v1'

/** the ids seen, known ones only; null when nothing was ever written — a first visit */
export function readSeen(text: string | null, known: ReadonlySet<string>): string[] | null {
  if (text === null) return null
  try {
    const v: unknown = JSON.parse(text)
    if (!Array.isArray(v)) return null
    return [...new Set(v.filter((x): x is string => typeof x === 'string' && known.has(x)))]
  } catch {
    return null
  }
}

/** seen now as well as before — the same array when nothing is new, so a state update can bail */
export function seeNow(seen: readonly string[], ids: readonly string[]): readonly string[] {
  const fresh = ids.filter((id) => !seen.includes(id))
  return fresh.length ? [...seen, ...fresh] : seen
}

/** the ones in a list this browser has not met */
export const unseen = (list: readonly Entry[], seen: readonly string[] | null): string[] =>
  seen ? list.filter((e) => !seen.includes(e.id)).map((e) => e.id) : []
