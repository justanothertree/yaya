/**
 * Dominoes, the draw game, for two: you and the computer. Seven tiles each from a double-six set,
 * the rest face down in the boneyard. Lay a tile whose end matches an open end of the line; with
 * nothing to lay, draw until you can, and pass when the boneyard is empty. Out first, and you score
 * the pips left in the other hand; a line that blocks goes to the lighter hand, by the difference.
 * First to the target wins. Pure, so dominoes.test.ts can play thousands of rounds without a page.
 */
import { rng } from './bricks'

/** a tile as its two ends, low first */
export type Tile = [number, number]
export const SET: Tile[] = []
for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) SET.push([a, b])
export const pips = (t: Tile) => t[0] + t[1]
export const same = (a: Tile, b: Tile) => a[0] === b[0] && a[1] === b[1]
export const handPips = (h: Tile[]) => h.reduce((s, t) => s + pips(t), 0)

export type Side = 'left' | 'right'
/** a tile in the line, turned so that `a` faces left and `b` faces right */
export type Laid = { a: number; b: number }
export type Round = {
  hands: [Tile[], Tile[]]
  yard: Tile[]
  line: Laid[]
  turn: 0 | 1
  /** consecutive passes, two of which block the line */
  passes: number
  /** which ends each player has had to draw or pass on: the other side may count on it */
  lacks: [Set<number>, Set<number>]
  over: null | { winner: 0 | 1 | null; points: number; why: 'out' | 'blocked' }
}

export function deal(seed: number, first: 0 | 1 = 0): Round {
  const rand = rng(seed)
  const tiles = SET.map((t) => [...t] as Tile)
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[tiles[i], tiles[j]] = [tiles[j], tiles[i]]
  }
  return {
    hands: [tiles.slice(0, 7), tiles.slice(7, 14)],
    yard: tiles.slice(14),
    line: [],
    turn: first,
    passes: 0,
    lacks: [new Set(), new Set()],
    over: null,
  }
}
export const ends = (r: Round): [number, number] | null =>
  r.line.length ? [r.line[0].a, r.line[r.line.length - 1].b] : null

/** where a tile can go now: either end on an empty table, else the ends it matches */
export function fits(r: Round, t: Tile): Side[] {
  const e = ends(r)
  if (!e) return ['right']
  const out: Side[] = []
  if (t[0] === e[0] || t[1] === e[0]) out.push('left')
  if (t[0] === e[1] || t[1] === e[1]) out.push('right')
  return out
}
export const playable = (r: Round, who: 0 | 1 = r.turn) =>
  r.hands[who].filter((t) => fits(r, t).length)

function finish(r: Round): Round {
  const [a, b] = r.hands
  if (!a.length || !b.length) {
    const winner: 0 | 1 = a.length ? 1 : 0
    return { ...r, over: { winner, points: handPips(r.hands[winner === 0 ? 1 : 0]), why: 'out' } }
  }
  if (r.passes >= 2) {
    const pa = handPips(a)
    const pb = handPips(b)
    const winner = pa === pb ? null : pa < pb ? 0 : 1
    return { ...r, over: { winner, points: Math.abs(pa - pb), why: 'blocked' } }
  }
  return r
}

/** lay a tile at an end, turning it to fit */
export function lay(r: Round, t: Tile, side: Side): Round {
  if (r.over || !r.hands[r.turn].some((x) => same(x, t)) || !fits(r, t).includes(side)) return r
  const e = ends(r)
  let laid: Laid
  if (!e) laid = { a: t[0], b: t[1] }
  else if (side === 'left') laid = t[1] === e[0] ? { a: t[0], b: t[1] } : { a: t[1], b: t[0] }
  else laid = t[0] === e[1] ? { a: t[0], b: t[1] } : { a: t[1], b: t[0] }
  const line = side === 'left' ? [laid, ...r.line] : [...r.line, laid]
  const hands = r.hands.map((h, i) =>
    i === r.turn ? h.filter((x) => !same(x, t)) : h,
  ) as Round['hands']
  return finish({ ...r, hands, line, turn: r.turn === 0 ? 1 : 0, passes: 0 })
}
/** with nothing to lay: draw one from the boneyard, or pass when it is empty */
export function drawOrPass(r: Round): Round {
  if (r.over || playable(r).length) return r
  const e = ends(r)
  const lacks = r.lacks.map((s) => new Set(s)) as Round['lacks']
  if (e) {
    lacks[r.turn].add(e[0])
    lacks[r.turn].add(e[1])
  }
  if (r.yard.length) {
    const hands = r.hands.map((h, i) => (i === r.turn ? [...h, r.yard[0]] : h)) as Round['hands']
    return { ...r, hands, yard: r.yard.slice(1), lacks }
  }
  return finish({ ...r, turn: r.turn === 0 ? 1 : 0, passes: r.passes + 1, lacks })
}

/* ---------------------------------------------------------------------------- the computer */

export const LEVELS = ['easy', 'fair', 'hard'] as const
export type Level = (typeof LEVELS)[number]

/**
 * The computer's play, or null when it must draw. Easy lays any tile that fits. Fair weighs
 * getting rid of heavy tiles and doubles against keeping its hand varied (a hand of many numbers
 * can follow more ends) and keeping ends it can follow. Hard also remembers which numbers the
 * other player has had to draw or pass on, and leaves those at the ends.
 */
export function choose(
  r: Round,
  level: Level,
  rand: () => number = Math.random,
): { tile: Tile; side: Side } | null {
  const me = r.turn
  const options: { tile: Tile; side: Side }[] = []
  for (const t of r.hands[me]) for (const side of fits(r, t)) options.push({ tile: t, side })
  if (!options.length) return null
  if (level === 'easy') return options[Math.floor(rand() * options.length)]
  const score = (o: { tile: Tile; side: Side }) => {
    let v = pips(o.tile)
    if (o.tile[0] === o.tile[1]) v += 3 // a double is hard to play later
    const after = lay(r, o.tile, o.side)
    if (after.over?.winner === me) return 1000
    const rest = after.hands[me]
    const numbers = new Set(rest.flatMap((t) => t))
    v += numbers.size * 2
    const e = ends(after)!
    // ends the other player has shown they cannot follow — what Hard watches for and Fair does not
    const them = me === 0 ? 1 : 0
    if (level === 'hard') {
      for (const x of e) if (r.lacks[them].has(x)) v += 6
      // and counts: the fewer unseen tiles carry an end's number, the less likely they can follow it
      const seen = [
        ...rest,
        ...after.line.map((l) => [Math.min(l.a, l.b), Math.max(l.a, l.b)] as Tile),
      ]
      const unseen = SET.filter((t) => !seen.some((x) => same(x, t)))
      for (const x of e) v -= unseen.filter((t) => t[0] === x || t[1] === x).length * 1.5
    }
    // ends I can still follow next time
    v += e.filter((x) => rest.some((t) => t[0] === x || t[1] === x)).length * 3
    return v
  }
  let best = options[0]
  let bv = -Infinity
  for (const o of options) {
    const v = score(o) + rand() * 0.01
    if (v > bv) {
      bv = v
      best = o
    }
  }
  return best
}

/* ---------------------------------------------------------------------------- what is kept */

export const DOMINOES_KEY = 'lab_dominoes_v1'
export const STYLES = ['ivory', 'ebony', 'candy'] as const
export const TARGETS = [50, 100] as const
export type Tally = { won: number; lost: number }
export type Saved = {
  level: Level
  style: (typeof STYLES)[number]
  target: (typeof TARGETS)[number]
  /** light the tiles in your hand that can be laid */
  hints: boolean
  record: Record<Level, Tally>
}
const NONE: Tally = { won: 0, lost: 0 }
export const EMPTY: Saved = {
  level: 'fair',
  style: 'ivory',
  target: 100,
  hints: true,
  record: { easy: NONE, fair: NONE, hard: NONE },
}
const whole = (v: unknown) =>
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
    record[l] = { won: whole(x.won), lost: whole(x.lost) }
  }
  return {
    level: pick(LEVELS, o.level, EMPTY.level),
    style: pick(STYLES, o.style, EMPTY.style),
    target: pick(TARGETS, o.target, EMPTY.target),
    hints: typeof o.hints === 'boolean' ? o.hints : EMPTY.hints,
    record,
  }
}
