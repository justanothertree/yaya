/**
 * Sea battle: each side hides a fleet on a grid and takes turns calling shots at the other's;
 * sink every ship to win. Pure — fleets, shots and the computer's aim — so seabattle.test.ts can
 * play whole battles without a page; SeaBattleDemo draws both seas and takes your shots.
 *
 * ⚠️ THE COMPUTER NEVER LOOKS AT YOUR SHIPS. Its every choice is made from what a player could
 * know: where it has shot, which shots hit, and which ships are sunk and how long they were. The
 * `Sea` it is handed for that is the view from its side — `seen` — never the fleet itself, so
 * cheating is not a thing a careless change could make it start doing.
 */

export type Ship = { id: number; size: number; cells: number[] }
export type Fleet = Ship[]
export type Shot = 'miss' | 'hit' | 'sunk'
/** what one side knows of the other's sea: each cell unknown, a miss or a hit; and what it sank */
export type Seen = { n: number; marks: (0 | 1 | 2)[]; sunk: { size: number; cells: number[] }[] }

export const FLEETS = {
  classic: [5, 4, 3, 3, 2],
  quick: [4, 3, 2, 2],
  swarm: [3, 3, 2, 2, 2, 1, 1],
} as const
export type FleetName = keyof typeof FLEETS
export const SIZES = [8, 10] as const

export function shipCells(n: number, at: number, size: number, across: boolean): number[] | null {
  const r = Math.floor(at / n)
  const c = at % n
  if (across ? c + size > n : r + size > n) return null
  return Array.from({ length: size }, (_, k) => (across ? at + k : at + k * n))
}

/** can a ship sit here: on the sea, on nothing else, and (if `apart`) touching nothing else */
export function fits(
  n: number,
  fleet: Fleet,
  cells: number[],
  apart: boolean,
  ignore = -1,
): boolean {
  const taken = new Set<number>()
  for (const s of fleet) {
    if (s.id === ignore) continue
    for (const c of s.cells) {
      taken.add(c)
      if (!apart) continue
      const r = Math.floor(c / n)
      const k = c % n
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr
          const cc = k + dc
          if (rr >= 0 && rr < n && cc >= 0 && cc < n) taken.add(rr * n + cc)
        }
    }
  }
  return cells.every((c) => !taken.has(c))
}

/** a whole fleet laid at random; ships are tried biggest first, so it never paints itself in */
export function randomFleet(
  n: number,
  sizes: readonly number[],
  apart: boolean,
  rand: () => number,
): Fleet {
  for (let attempt = 0; attempt < 200; attempt++) {
    const fleet: Fleet = []
    let ok = true
    const order = sizes.map((size, id) => ({ size, id })).sort((a, b) => b.size - a.size)
    for (const { size, id } of order) {
      let placed = false
      for (let t = 0; t < 400 && !placed; t++) {
        const across = rand() < 0.5
        const cells = shipCells(n, Math.floor(rand() * n * n), size, across)
        if (cells && fits(n, fleet, cells, apart)) {
          fleet.push({ id, size, cells })
          placed = true
        }
      }
      if (!placed) {
        ok = false
        break
      }
    }
    if (ok) return fleet.sort((a, b) => a.id - b.id)
  }
  throw new Error('no room for that fleet')
}

export const blankSeen = (n: number): Seen => ({ n, marks: Array(n * n).fill(0), sunk: [] })

/** a shot at a fleet: what the shooter learns, written into what they have seen */
export function fire(fleet: Fleet, seen: Seen, at: number): Shot {
  if (seen.marks[at]) throw new Error(`already shot at ${at}`)
  const ship = fleet.find((s) => s.cells.includes(at))
  if (!ship) {
    seen.marks[at] = 1
    return 'miss'
  }
  seen.marks[at] = 2
  if (ship.cells.every((c) => seen.marks[c] === 2)) {
    seen.sunk.push({ size: ship.size, cells: ship.cells })
    return 'sunk'
  }
  return 'hit'
}
export const allSunk = (fleet: Fleet, seen: Seen) => seen.sunk.length === fleet.length

/* ---------------------------------------------------------------------------- the computer */

export const LEVELS = ['easy', 'fair', 'hard'] as const
export type Level = (typeof LEVELS)[number]

/** the sizes of the ships still afloat, worked out from the fleet's make-up and what has sunk */
function afloat(sizes: readonly number[], seen: Seen): number[] {
  const left = [...sizes]
  for (const s of seen.sunk) left.splice(left.indexOf(s.size), 1)
  return left
}

/** hits that are not part of a sunk ship: a wounded ship is somewhere among them */
function wounded(seen: Seen): number[] {
  const sunk = new Set(seen.sunk.flatMap((s) => s.cells))
  const out: number[] = []
  seen.marks.forEach((m, i) => {
    if (m === 2 && !sunk.has(i)) out.push(i)
  })
  return out
}

/**
 * For every unshot cell, how many ways the ships still afloat could lie across it, given every
 * miss and sunk ship — and, while a ship is wounded, counting only the ways that pass through its
 * hits, many times over. Where to shoot is wherever the ships most probably are.
 */
export function density(seen: Seen, sizes: readonly number[], apart: boolean): number[] {
  const { n } = seen
  const heat = Array(n * n).fill(0)
  const open = wounded(seen)
  const sunkCells = new Set(seen.sunk.flatMap((s) => s.cells))
  const near = (c: number) => {
    if (!apart) return false
    const r = Math.floor(c / n)
    const k = c % n
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr
        const cc = k + dc
        if (rr >= 0 && rr < n && cc >= 0 && cc < n && sunkCells.has(rr * n + cc)) return true
      }
    return false
  }
  for (const size of afloat(sizes, seen))
    for (let at = 0; at < n * n; at++)
      for (const across of [true, false]) {
        const cells = shipCells(n, at, size, across)
        if (!cells) continue
        if (cells.some((c) => seen.marks[c] === 1 || sunkCells.has(c) || near(c))) continue
        const through = cells.filter((c) => open.includes(c)).length
        if (open.length && !through) continue
        const weight = open.length ? 1 + through * 40 : 1
        for (const c of cells) if (!seen.marks[c]) heat[c] += weight
      }
  return heat
}

/**
 * The computer's shot. Easy fires at random, and finishes a ship it has hit only half the time.
 * Fair hunts on a chequerboard (every ship covers a dark square) and then works along a hit.
 * Hard shoots wherever the ships still afloat could most often be.
 */
export function aim(
  seen: Seen,
  sizes: readonly number[],
  apart: boolean,
  level: Level,
  rand: () => number,
): number {
  const { n } = seen
  const unshot = seen.marks.map((m, i) => (m ? -1 : i)).filter((i) => i >= 0)
  const pick = (list: number[]) => list[Math.floor(rand() * list.length)]
  const hits = wounded(seen)
  const around = (c: number) =>
    [c - n, c + n, c % n ? c - 1 : -1, c % n < n - 1 ? c + 1 : -1].filter(
      (x) => x >= 0 && x < n * n && !seen.marks[x],
    )
  if (level === 'easy') {
    if (hits.length && rand() < 0.5) {
      const next = hits.flatMap(around)
      if (next.length) return pick(next)
    }
    return pick(unshot)
  }
  if (level === 'fair') {
    if (hits.length) {
      // two hits in a line: carry on along it before trying the sides
      const line = hits.length >= 2
      const across = line && hits.every((h) => Math.floor(h / n) === Math.floor(hits[0] / n))
      const down = line && hits.every((h) => h % n === hits[0] % n)
      let next = hits.flatMap(around)
      if (across) next = next.filter((c) => Math.floor(c / n) === Math.floor(hits[0] / n))
      else if (down) next = next.filter((c) => c % n === hits[0] % n)
      if (!next.length) next = hits.flatMap(around)
      if (next.length) return pick(next)
    }
    const smallest = Math.min(...afloat(sizes, seen))
    const checker = unshot.filter(
      (i) => (Math.floor(i / n) + (i % n)) % Math.max(2, smallest) === 0,
    )
    return pick(checker.length ? checker : unshot)
  }
  const heat = density(seen, sizes, apart)
  let best: number[] = []
  let bh = -1
  for (const i of unshot) {
    if (heat[i] > bh) {
      bh = heat[i]
      best = [i]
    } else if (heat[i] === bh) best.push(i)
  }
  return pick(best)
}

/* ---------------------------------------------------------------------------- what is kept */

export const SEA_KEY = 'lab_seabattle_v1'
export const THEMES = ['navy', 'tropic', 'arctic'] as const
export type Tally = { won: number; lost: number; fewest: number }
export type Saved = {
  level: Level
  size: (typeof SIZES)[number]
  fleet: FleetName
  apart: boolean
  /** a hit earns another shot */
  again: boolean
  theme: (typeof THEMES)[number]
  record: Record<Level, Tally>
}
const NONE: Tally = { won: 0, lost: 0, fewest: 0 }
export const EMPTY: Saved = {
  level: 'fair',
  size: 10,
  fleet: 'classic',
  apart: true,
  again: false,
  theme: 'navy',
  record: { easy: NONE, fair: NONE, hard: NONE },
}
/** a battle is over: `shots` is how many you fired, which only counts when you won */
export function recordBattle(r: Tally, won: boolean, shots: number): Tally {
  return {
    won: r.won + (won ? 1 : 0),
    lost: r.lost + (won ? 0 : 1),
    fewest: won ? (r.fewest ? Math.min(r.fewest, shots) : shots) : r.fewest,
  }
}
const count = (v: unknown) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e6 ? v : 0
export function readSaved(text: string | null): Saved {
  let v: unknown
  try {
    v = JSON.parse(text ?? 'null')
  } catch {
    return EMPTY
  }
  if (typeof v !== 'object' || !v || Array.isArray(v)) return EMPTY
  const o = v as Record<string, unknown>
  const pick = <T>(list: readonly T[], x: unknown, d: T): T =>
    list.includes(x as T) ? (x as T) : d
  const rec = (typeof o.record === 'object' && o.record ? o.record : {}) as Record<string, unknown>
  const record = {} as Record<Level, Tally>
  for (const l of LEVELS) {
    const x = (typeof rec[l] === 'object' && rec[l] ? rec[l] : {}) as Record<string, unknown>
    record[l] = { won: count(x.won), lost: count(x.lost), fewest: count(x.fewest) }
  }
  return {
    level: pick(LEVELS, o.level, EMPTY.level),
    size: pick(SIZES, o.size, EMPTY.size),
    fleet: pick(Object.keys(FLEETS) as FleetName[], o.fleet, EMPTY.fleet),
    apart: typeof o.apart === 'boolean' ? o.apart : EMPTY.apart,
    again: typeof o.again === 'boolean' ? o.again : EMPTY.again,
    theme: pick(THEMES, o.theme, EMPTY.theme),
    record,
  }
}
