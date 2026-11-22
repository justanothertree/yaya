import {
  FLEETS,
  LEVELS,
  SIZES,
  aim,
  blankSeen,
  fire,
  fits,
  randomFleet,
  shipCells,
  type Fleet,
  type FleetName,
  type Level,
  type Seen,
  type Shot,
} from './seabattle'
import type { Mode, Rules, Seat } from '../lab/social/room'

/**
 * Sea battle as a match by turns (src/lab/matches), the first toy with something hidden: each
 * side's fleet. Seat 0 fires first; together, the two seats share one fleet and take its shots in
 * turn, and the computer's fleet is laid out by the server, its shots aimed by seabattle.ts's own
 * `aim`, which never looks at a fleet.
 *
 * ⚠️ A FLEET IS NEVER IN THE STATE. The state is what both players may know — whose fleet is set
 * out, every shot and what it did, and a ship's cells once it is sunk — and the fleets live in the
 * match's `secret`, which no RPC returns (Rules.hidden). The server puts them back to fire a shot
 * and re-fires every earlier one against them, so a stored result the fleets disagree with is
 * refused rather than built on. Each player is shown their own fleet and nothing of the other's.
 *
 * A fleet is set out by the player, as alone: the friend brings theirs with their yes, and the
 * challenger theirs with their first shot — and since the challenger always fires first, no fleet
 * is ever shot at before it is fixed. A move is a cell, and the challenger's first carries their
 * fleet; the history keeps only the cell.
 */
export type SeaSettings = {
  size: (typeof SIZES)[number]
  fleet: FleetName
  /** ships may not touch, even at a corner */
  apart: boolean
  /** a hit earns another shot */
  again: boolean
}
export type SeaShot = { by: Seat; at: number; shot: Shot; sunk?: number[] }
export type SeaGame = {
  set: SeaSettings
  sizes: readonly number[]
  /** each side's fleet: null in a browser (they are not sent) and before it is set out */
  fleets: [Fleet | null, Fleet | null]
  /** whether each side has set out its fleet, which anybody may know */
  placed: [boolean, boolean]
  /** what each side has seen of the other's sea */
  seen: [Seen, Seen]
  shots: SeaShot[]
  turn: Seat | null
  winner: Seat | null
}
/** a shot, and with the challenger's first one their fleet: each ship's cells, in the fleet's order */
export type SeaMove = { at: number; fleet?: number[][] }

/** the toy's own settings, its defaults when none are named; null for anything it does not offer */
export function readSeaSettings(s: Record<string, unknown>): SeaSettings | null {
  const size = s.size ?? 10
  const fleet = s.fleet ?? 'classic'
  const apart = s.apart ?? true
  const again = s.again ?? false
  if (!(SIZES as readonly unknown[]).includes(size)) return null
  if (typeof fleet !== 'string' || !Object.hasOwn(FLEETS, fleet)) return null
  if (typeof apart !== 'boolean' || typeof again !== 'boolean') return null
  return { size: size as SeaSettings['size'], fleet: fleet as FleetName, apart, again }
}

const other = (s: Seat): Seat => (s === 0 ? 1 : 0)

function fresh(set: SeaSettings): SeaGame {
  return {
    set,
    sizes: FLEETS[set.fleet],
    fleets: [null, null],
    placed: [false, false],
    seen: [blankSeen(set.size), blankSeen(set.size)],
    shots: [],
    turn: 0,
    winner: null,
  }
}

/**
 * A fleet from the wire as ships, or null: one ship of each of the settings' sizes in order, each
 * a straight run of cells on the sea, none on another (nor touching it, when they must be apart).
 */
export function readFleet(set: SeaSettings, x: unknown): Fleet | null {
  const sizes = FLEETS[set.fleet]
  const n = set.size
  if (!Array.isArray(x) || x.length !== sizes.length) return null
  const fleet: Fleet = []
  for (let id = 0; id < sizes.length; id++) {
    const cells = x[id]
    if (!Array.isArray(cells) || cells.length !== sizes[id]) return null
    if (!cells.every((c) => Number.isInteger(c) && c >= 0 && c < n * n)) return null
    const sorted = [...(cells as number[])].sort((a, b) => a - b)
    const line =
      sizes[id] === 1
        ? [sorted[0]]
        : (shipCells(n, sorted[0], sizes[id], sorted[1] - sorted[0] === 1) ?? [])
    if (line.join() !== sorted.join()) return null
    if (!fits(n, fleet, sorted, set.apart)) return null
    fleet.push({ id, size: sizes[id], cells: sorted })
  }
  return fleet
}
const fleetCells = (f: Fleet) => f.map((s) => s.cells)

/** a shot fired by `by` at the other side's fleet, which must be there */
function shoot(g: SeaGame, by: Seat, at: number): SeaGame {
  const target = g.fleets[other(by)]!
  const seen: [Seen, Seen] = [
    { ...g.seen[0], marks: [...g.seen[0].marks], sunk: [...g.seen[0].sunk] },
    { ...g.seen[1], marks: [...g.seen[1].marks], sunk: [...g.seen[1].sunk] },
  ]
  const shot = fire(target, seen[by], at)
  const sunk = shot === 'sunk' ? seen[by].sunk[seen[by].sunk.length - 1].cells : undefined
  const won = seen[by].sunk.length === g.sizes.length
  const again = shot !== 'miss' && g.set.again
  return {
    ...g,
    seen,
    shots: [...g.shots, { by, at, shot, ...(sunk ? { sunk } : {}) }],
    winner: won ? by : null,
    turn: won ? null : again ? by : other(by),
  }
}

/**
 * The game anybody in the match may see, from its state: shots in turn, each one cell not shot
 * before by its side, a sunk ship a straight run of that side's hits of a size still afloat. The
 * fleets are not here; `join` puts them back on the server and checks every shot against them.
 */
export function replayPublic(set: SeaSettings, x: unknown): SeaGame | null {
  const o = x as { placed?: unknown; shots?: unknown } | null
  if (!o || typeof o !== 'object' || !Array.isArray(o.placed) || !Array.isArray(o.shots))
    return null
  if (o.placed.length !== 2 || !o.placed.every((p) => typeof p === 'boolean')) return null
  const n = set.size
  let g = fresh(set)
  g = { ...g, placed: [o.placed[0], o.placed[1]] as [boolean, boolean] }
  if (o.shots.length > 2 * n * n) return null
  for (const raw of o.shots) {
    if (g.turn === null || !Array.isArray(raw) || raw.length < 2) return null
    const [at, r] = raw as number[]
    const by = g.turn
    if (!Number.isInteger(at) || at < 0 || at >= n * n || g.seen[by].marks[at]) return null
    if (r !== 1 && r !== 2 && r !== 3) return null
    // a shot can only have been fired at a fleet that was set out, by a side that had set its own
    if (!g.placed[other(by)] || !g.placed[by]) return null
    const seen: [Seen, Seen] = [
      { ...g.seen[0], marks: [...g.seen[0].marks], sunk: [...g.seen[0].sunk] },
      { ...g.seen[1], marks: [...g.seen[1].marks], sunk: [...g.seen[1].sunk] },
    ]
    seen[by].marks[at] = r === 1 ? 1 : 2
    let sunk: number[] | undefined
    if (r === 3) {
      sunk = (raw as number[]).slice(2)
      const afloat = [...g.sizes]
      for (const s of seen[by].sunk) afloat.splice(afloat.indexOf(s.size), 1)
      const sorted = [...sunk].sort((a, b) => a - b)
      const line =
        sorted.length === 1
          ? [sorted[0]]
          : (shipCells(n, sorted[0], sorted.length, sorted[1] - sorted[0] === 1) ?? [])
      if (!afloat.includes(sunk.length) || line.join() !== sorted.join()) return null
      if (!sunk.includes(at) || !sunk.every((c) => seen[by].marks[c] === 2)) return null
      seen[by].sunk.push({ size: sunk.length, cells: sorted })
      sunk = sorted
    } else if (raw.length !== 2) return null
    const shot: Shot = r === 1 ? 'miss' : r === 2 ? 'hit' : 'sunk'
    const won = seen[by].sunk.length === g.sizes.length
    const again = shot !== 'miss' && set.again
    g = {
      ...g,
      seen,
      shots: [...g.shots, { by, at, shot, ...(sunk ? { sunk } : {}) }],
      winner: won ? by : null,
      turn: won ? null : again ? by : other(by),
    }
  }
  return g
}

/** a move from the wire: a cell, and perhaps a fleet; whether the fleet is one is for `legal` */
export function readSeaMove(x: unknown): SeaMove | null {
  const o = x as { at?: unknown; fleet?: unknown } | null
  if (!o || typeof o !== 'object' || !Number.isInteger(o.at) || (o.at as number) < 0) return null
  if (o.fleet === undefined) return { at: o.at as number }
  if (!Array.isArray(o.fleet) || o.fleet.length > 10) return null
  return { at: o.at as number, fleet: o.fleet as number[][] }
}

export function seaRules(set: SeaSettings): Rules<SeaGame, SeaMove> {
  const n = set.size
  /** the fleet a move brings, when the mover has none set out yet; null if it brings none */
  const brings = (g: SeaGame, m: SeaMove, by: Seat) =>
    g.placed[by]
      ? m.fleet === undefined
        ? 'none'
        : null
      : m.fleet
        ? readFleet(set, m.fleet)
        : null
  return {
    fresh: () => fresh(set),
    turn: (g) => g.turn,
    legal: (g, m, by) => {
      if (g.turn === null || (by !== undefined && by !== g.turn)) return false
      const side = g.turn
      if (!Number.isInteger(m.at) || m.at < 0 || m.at >= n * n || g.seen[side].marks[m.at])
        return false
      if (!g.placed[other(side)]) return false
      return brings(g, m, side) !== null
    },
    apply: (g, m) => {
      if (g.turn === null) return g
      const side = g.turn
      const f = brings(g, m, side)
      if (f === null) return g
      let cur = g
      if (f !== 'none') {
        const fleets: [Fleet | null, Fleet | null] = [...g.fleets]
        fleets[side] = f
        const placed: [boolean, boolean] = [...g.placed]
        placed[side] = true
        cur = { ...g, fleets, placed }
      }
      // the other side's fleet is only ever on the server, which is where a shot is fired
      return cur.fleets[other(side)] ? shoot(cur, side, m.at) : cur
    },
    encode: (g) => ({
      placed: g.placed,
      shots: g.shots.map((s) =>
        s.shot === 'sunk' ? [s.at, 3, ...s.sunk!] : [s.at, s.shot === 'hit' ? 2 : 1],
      ),
    }),
    decode: (x) => replayPublic(set, x),
    readMove: readSeaMove,
    modes: ['versus', 'together'],
    computer: {
      side: 1,
      levels: LEVELS,
      choose: (g, level) => ({
        at: aim(g.seen[1], g.sizes, set.apart, level as Level, Math.random),
      }),
    },
    result: (g) => g.winner,
    begun: (g) => g.shots.length > 0,
    hidden: {
      secret: (g) => ({ fleets: g.fleets.map((f) => (f ? fleetCells(f) : null)) }),
      join: (g, secret) => {
        const list = (secret as { fleets?: unknown } | null)?.fleets
        if (!Array.isArray(list) || list.length !== 2) return null
        const fleets: [Fleet | null, Fleet | null] = [null, null]
        for (const s of [0, 1] as Seat[]) {
          if (!g.placed[s]) {
            if (list[s] !== null) return null
            continue
          }
          fleets[s] = readFleet(set, list[s])
          if (!fleets[s]) return null
        }
        // every shot again, against the fleets: the results stored must be the ones they give
        let check: SeaGame = { ...fresh(set), placed: g.placed, fleets }
        for (const s of g.shots) {
          check = shoot(check, s.by, s.at)
          const again = check.shots[check.shots.length - 1]
          if (again.shot !== s.shot || (again.sunk ?? []).join() !== (s.sunk ?? []).join())
            return null
        }
        return { ...g, fleets }
      },
      mine: (g, side) => (g.fleets[side] ? fleetCells(g.fleets[side]!) : null),
      logged: (m) => ({ at: m.at }),
      accept: (g, brought, mode: Mode) => {
        // together, the friend joins the challenger's side and the computer's fleet is dealt here
        const f =
          mode === 'together'
            ? randomFleet(n, g.sizes, set.apart, Math.random)
            : readFleet(set, brought)
        if (!f) return null
        return { ...g, fleets: [g.fleets[0], f], placed: [g.placed[0], true] }
      },
    },
  }
}
