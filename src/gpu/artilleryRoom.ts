import {
  LEVELS,
  gunner,
  newField,
  shoot,
  type Field,
  type Flight,
  type Level,
  type Who,
} from './artillery'
import type { Rules } from '../lab/social/room'

/**
 * Artillery as a room game (src/lab/social/room.ts). Seat 0 is the left gun and fires first,
 * seat 1 the right gun. Together, the two seats take the left gun's shots in turn and the
 * computer is the right gun, with artillery.ts's own `gunner`.
 *
 * A move is a shot: an angle and a charge, inside the same limits the toy's own controls keep.
 * Where it lands is not the mover's to say — the host fires it through artillery.ts's `shoot`.
 *
 * ⚠️ THE GAME TRAVELS AS ITS SEED AND ITS SHOTS, NOT AS ITS FIELD. The field is 321 heights, and
 * a field could be sent with a gun at full life that was hit three times; the seed and the shots
 * are a few hundred bytes, and every seat replays them through `newField` and `shoot`, so the
 * only field anybody can be shown is one those shots make. The wind drifts from the field's own
 * seed, so it replays too. The one thing this trusts is that every browser's Math.sin agrees to
 * the last bit, which the engines all take from the same fdlibm — Chromium is what was measured.
 */
export type Shot = { angle: number; charge: number }
export type ArtilleryGame = {
  seed: number
  shots: Shot[]
  f: Field
  /** the last shot fired — who fired it, its flight and what it did — for showing it everywhere */
  last: { by: Who; flight: Flight; hurt: [number, number] } | null
}

/** far more shots than a game takes (three good hits win); a list longer than this is not a game */
export const MAX_SHOTS = 200

const newSeed = () => (Math.random() * 2 ** 31) >>> 0

function fresh(seed = newSeed()): ArtilleryGame {
  return { seed, shots: [], f: newField(seed, 0), last: null }
}

function after(g: ArtilleryGame, s: Shot): ArtilleryGame {
  const by = g.f.turn
  const r = shoot(g.f, s.angle, s.charge)
  return { ...g, shots: [...g.shots, s], f: r.field, last: { by, flight: r.flight, hurt: r.hurt } }
}

const over = (g: ArtilleryGame) => g.f.winner !== null || g.shots.length >= MAX_SHOTS

/** a shot from the wire or the room, inside the limits the toy's controls keep; null otherwise */
export function readShot(x: unknown): Shot | null {
  const [angle, charge] = Array.isArray(x)
    ? x
    : [(x as Partial<Shot> | null)?.angle, (x as Partial<Shot> | null)?.charge]
  if (typeof angle !== 'number' || typeof charge !== 'number') return null
  if (!(angle >= 5 && angle <= 85 && charge >= 0.1 && charge <= 1)) return null
  return { angle, charge }
}

/** the game these shots make on this seed's field, or null at the first that is not a shot there */
export function replay(seed: unknown, shots: readonly unknown[]): ArtilleryGame | null {
  if (!Number.isInteger(seed) || (seed as number) < 0 || (seed as number) >= 2 ** 31) return null
  if (shots.length > MAX_SHOTS) return null
  let g = fresh(seed as number)
  for (const x of shots) {
    const s = readShot(x)
    if (!s || over(g)) return null
    g = after(g, s)
  }
  return g
}

export const artilleryRules: Rules<ArtilleryGame, Shot> = {
  fresh: () => fresh(),
  turn: (g) => (over(g) ? null : g.f.turn),
  legal: (g, s, by) => !over(g) && (by === undefined || by === g.f.turn) && readShot(s) !== null,
  apply: (g, s) => after(g, s),
  encode: (g) => ({ seed: g.seed, shots: g.shots.map((s) => [s.angle, s.charge]) }),
  decode: (x) => {
    const o = x as Record<string, unknown> | null
    if (!o || typeof o !== 'object' || !Array.isArray(o.shots)) return null
    return replay(o.seed, o.shots)
  },
  readMove: readShot,
  modes: ['versus', 'together'],
  computer: {
    side: 1,
    levels: LEVELS,
    choose: (g, level) => gunner(g.f, level as Level),
  },
  result: (g) => (!over(g) ? null : (g.f.winner ?? 'draw')),
  begun: (g) => g.shots.length > 0,
}
