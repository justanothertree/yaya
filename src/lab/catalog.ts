/**
 * The Lab's catalog: what kind of thing each experiment is, when it arrived, the owner's flags the
 * server sends, and the picker's filter. Pure, so catalog.test.ts can ask it questions without a
 * GPU or a page.
 *
 * ⚠️ IT USED TO SEARCH, SORT AND REMEMBER TOO — a catalog view with search, Recent, New, Highly
 * rated and favourites (8 Nov). Evan preferred every toy on one page with a filter that fades the
 * rest (9 Nov), so that view and everything only it used went, rather than staying as dead code.
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
  vision: { category: 'make', added: '2026-11-08' },
  glide: { category: 'games', added: '2026-11-08' },
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

/** may this viewer see this experiment in the picker and the catalog at all */
export const listed = (e: Entry, admin: boolean) => admin || !e.flags.hidden

/* ── the picker's filter ───────────────────────────────────────────────────────────────────── */

/** the kind the picker brings forward, kept in this browser. 'all' fades nothing. */
export const FILTER_KEY = 'lab_filter_v1'
export function readFilter(text: string | null): Category | 'all' {
  return CATEGORIES.some((c) => c.id === text) ? (text as Category) : 'all'
}
