import {
  HANDS,
  LEVELS,
  STEP,
  STONES_EACH,
  after,
  choose,
  count,
  newGame,
  slide,
  spansOf,
  sweepTo,
  sweptOn,
  toThrow,
  winner,
  wobble,
  type Game,
  type Level,
  type Shot,
  type Spans,
  type Stone,
  type Team,
} from './curling'
import type { Rules } from '../lab/social/room'

/**
 * Curling as a room game (src/lab/social/room.ts). Seat 0's stones are yellow and throw first in
 * the first end, so seat 1 has the hammer; after that it goes as the rules say, to the side that
 * did not score. Together, the two seats throw their side's stones in turn and the computer
 * throws the other side's, with curling.ts's own `choose`, `wobble` and sweepers.
 *
 * ⚠️ A MOVE IS A THROW AND ITS SWEEP. Sweeping is done live, by holding a button while the stone
 * slides, so it cannot be decided before the throw — the thrower slides their own stone on their
 * own screen as the toy always has, and sends the throw with the steps they swept on (curling.ts's
 * Spans). The host slides it again with exactly those steps swept, and a slide is the same every
 * time from the same stones, throw and sweep, so every seat sees where the thrower saw it stop.
 * Where it stops is still not the thrower's to say: only the throw and the sweep travel.
 *
 * THE GAME TRAVELS AS ITS THROWS, replayed through curling.ts's `slide` and `after`, so the
 * stones in the house and the score can only be what those throws made.
 */
export type Throw = { shot: Shot; sweeps: Spans }
export type CurlingGame = {
  throws: Throw[]
  g: Game
  /** the last throw: who threw it, the stones before and after, its slide, and the end it closed */
  last: {
    by: Team
    before: Stone[]
    stones: Stone[]
    frames: Stone[][]
    ended: ReturnType<typeof count> | null
  } | null
}

/** a game in a call is four ends; a fifth is played if they are level */
export const CALL_ENDS = 4
/** every stone of every end, the extra one included */
export const MAX_THROWS = (CALL_ENDS + 1) * STONES_EACH * 2
/** no slide lasts longer than this many steps (curling.ts's slide stops there) */
const LAST_STEP = Math.round(40 / STEP)
const MAX_SPANS = 400

const fresh = (): CurlingGame => ({ throws: [], g: newGame(CALL_ENDS, 1), last: null })

function play(cg: CurlingGame, t: Throw, keep = true): CurlingGame {
  const by = toThrow(cg.g)
  const r = slide(cg.g.stones, t.shot, by, t.sweeps.length ? sweptOn(t.sweeps) : null, keep)
  const a = after(cg.g, r.stones)
  return {
    throws: [...cg.throws, t],
    g: a.game,
    last: { by, before: cg.g.stones, stones: r.stones, frames: r.frames, ended: a.ended },
  }
}

/** a throw from the wire or the room, inside what any thrower here could send; null otherwise */
export function readThrow(x: unknown): Throw | null {
  const o = x as Partial<Throw> | unknown[] | null
  const [angle, speed, spin, sweeps] = Array.isArray(o)
    ? o
    : [o?.shot?.angle, o?.shot?.speed, o?.shot?.spin, o?.sweeps]
  if (typeof angle !== 'number' || typeof speed !== 'number') return null
  if (!(Math.abs(angle) <= 0.6 && speed >= 0.3 && speed <= 10)) return null
  if (spin !== 1 && spin !== -1) return null
  if (!Array.isArray(sweeps) || sweeps.length > MAX_SPANS) return null
  let at = 0
  for (const sp of sweeps) {
    if (!Array.isArray(sp) || sp.length !== 2) return null
    const [a, b] = sp
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < at || b <= a || b > LAST_STEP)
      return null
    at = b
  }
  return {
    shot: { angle, speed, spin },
    sweeps: (sweeps as [number, number][]).map(([a, b]) => [a, b]),
  }
}

/** the game these throws make, or null at the first that is not a throw there */
export function replay(throws: readonly unknown[]): CurlingGame | null {
  if (throws.length > MAX_THROWS) return null
  let cg = fresh()
  for (let i = 0; i < throws.length; i++) {
    const t = readThrow(throws[i])
    if (!t || cg.g.over) return null
    // only the last throw's slide is shown, so only the last is kept
    cg = play(cg, t, i === throws.length - 1)
  }
  return cg
}

/** the computer's throw: its plan, its own hand, and its sweepers' sweep worked out in advance */
export function computerThrow(cg: CurlingGame, level: Level, rand: () => number): Throw {
  const team = toThrow(cg.g)
  const last = cg.g.thrown === STONES_EACH * 2 - 1
  const plan = choose(cg.g.stones, team, level, last, rand)
  const shot = wobble(plan.shot, level, rand)
  const sweeper = HANDS[level].sweeps && plan.kind !== 'hit' ? sweepTo(plan.target) : null
  const safe = {
    angle: Math.max(-0.6, Math.min(0.6, shot.angle)),
    speed: Math.max(0.3, Math.min(10, shot.speed)),
    spin: shot.spin,
  }
  return { shot: safe, sweeps: spansOf(cg.g.stones, safe, team, sweeper) }
}

export const curlingRules: Rules<CurlingGame, Throw> = {
  fresh,
  turn: (cg) => (cg.g.over ? null : toThrow(cg.g)),
  legal: (cg, t, by) =>
    !cg.g.over && (by === undefined || by === toThrow(cg.g)) && readThrow(pack(t)) !== null,
  apply: (cg, t) => play(cg, t),
  encode: (cg) => ({ throws: cg.throws.map(pack) }),
  decode: (x) => {
    const o = x as Record<string, unknown> | null
    if (!o || typeof o !== 'object' || !Array.isArray(o.throws)) return null
    return replay(o.throws)
  },
  readMove: readThrow,
  modes: ['versus', 'together'],
  computer: {
    side: 1,
    levels: LEVELS,
    choose: (cg, level) => computerThrow(cg, level as Level, Math.random),
  },
  result: (cg) => winner(cg.g),
  begun: (cg) => cg.throws.length > 0,
}

/** a throw as it goes on the wire: [angle, speed, spin, sweeps] */
export function pack(t: Throw): unknown[] {
  return [t.shot.angle, t.shot.speed, t.shot.spin, t.sweeps.map(([a, b]) => [a, b])]
}
