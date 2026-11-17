import {
  LANE_HALF,
  LEVELS,
  bowl,
  next,
  plan,
  score,
  upNext,
  wobble,
  type Level,
  type Roll,
  type Shot,
} from './bowling'
import type { Rules } from '../lab/social/room'

/**
 * Bowling as a room game (src/lab/social/room.ts). Two bowlers take turns a frame each, seat 0
 * first, as the toy and the computer do. Together, the two seats share one scorecard — taking its
 * balls in turn — against the computer's, which bowls with bowling.ts's own `plan` and `wobble`.
 *
 * A move is a ball: where it is let go, its line, its speed and its hook, with the bowler's own
 * release already in the line. Which pins it knocks down is not the bowler's to say — the host
 * bowls it through bowling.ts's `bowl` at the pins standing.
 *
 * ⚠️ THE GAME TRAVELS AS ITS BALLS, NOT AS ITS SCORES. A scorecard could say 300 with nothing
 * behind it; the balls are replayed through `bowl`, and the pins they leave standing, the frames
 * and the turn all come from the replay, so a score can only be one those balls made.
 */
export type Side = 0 | 1
export type BowlingGame = {
  balls: Shot[]
  rolls: [number[], number[]]
  /** whose frame it is, or null once both games are over */
  up: Side | null
  /** the pins standing for the next ball */
  standing: number[]
  /** the last ball bowled — who, what it knocked down and its path — for showing it everywhere */
  last: { by: Side; standing: number[]; roll: Roll } | null
}

const ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
/** two games of at most 21 balls each */
export const MAX_BALLS = 42

const fresh = (): BowlingGame => ({
  balls: [],
  rolls: [[], []],
  up: 0,
  standing: ALL,
  last: null,
})

function after(g: BowlingGame, s: Shot, keep = true): BowlingGame {
  const by = g.up!
  const roll = bowl(g.standing, s, keep)
  const mine = [...g.rolls[by], roll.felled.length]
  const rolls: [number[], number[]] = by === 0 ? [mine, g.rolls[1]] : [g.rolls[0], mine]
  const n = next(mine)
  const frameOver = n.over || n.fresh
  const up = upNext(rolls, by)
  const standing = frameOver ? ALL : g.standing.filter((p) => !roll.felled.includes(p))
  return { balls: [...g.balls, s], rolls, up, standing, last: { by, standing: g.standing, roll } }
}

/** a ball from the wire or the room, inside what any bowler here could send; null otherwise */
export function readBall(x: unknown): Shot | null {
  const a = Array.isArray(x)
    ? x
    : [
        (x as Partial<Shot> | null)?.x,
        (x as Partial<Shot> | null)?.angle,
        (x as Partial<Shot> | null)?.speed,
        (x as Partial<Shot> | null)?.hook,
      ]
  if (a.length !== 4 || !a.every((v) => typeof v === 'number' && Number.isFinite(v))) return null
  const [bx, angle, speed, hook] = a as number[]
  if (Math.abs(bx) > LANE_HALF || Math.abs(angle) > 0.1) return null
  if (speed < 5 || speed > 10 || Math.abs(hook) > 1) return null
  return { x: bx, angle, speed, hook }
}

/** a ball held to what readBall takes: the computer's wobble can, rarely, reach past it */
export const inside = (s: Shot): Shot => ({
  x: Math.max(-LANE_HALF, Math.min(LANE_HALF, s.x)),
  angle: Math.max(-0.1, Math.min(0.1, s.angle)),
  speed: Math.max(5, Math.min(10, s.speed)),
  hook: Math.max(-1, Math.min(1, s.hook)),
})

/** the game these balls make, or null at the first that is not a ball there */
export function replay(balls: readonly unknown[]): BowlingGame | null {
  if (balls.length > MAX_BALLS) return null
  let g = fresh()
  for (let i = 0; i < balls.length; i++) {
    const s = readBall(balls[i])
    if (!s || g.up === null) return null
    // only the last ball's path is shown, so only the last is kept
    g = after(g, s, i === balls.length - 1)
  }
  return g
}

export const bowlingRules: Rules<BowlingGame, Shot> = {
  fresh,
  turn: (g) => g.up,
  legal: (g, s, by) => g.up !== null && (by === undefined || by === g.up) && readBall(s) !== null,
  apply: (g, s) => after(g, s),
  encode: (g) => ({ balls: g.balls.map((s) => [s.x, s.angle, s.speed, s.hook]) }),
  decode: (x) => {
    const o = x as Record<string, unknown> | null
    if (!o || typeof o !== 'object' || !Array.isArray(o.balls)) return null
    return replay(o.balls)
  },
  readMove: readBall,
  modes: ['versus', 'together'],
  computer: {
    side: 1,
    levels: LEVELS,
    choose: (g, level) =>
      inside(wobble(plan(g.standing, level as Level, Math.random), level as Level, Math.random)),
  },
  result: (g) => {
    if (g.up !== null) return null
    const [a, b] = [score(g.rolls[0]), score(g.rolls[1])]
    return a > b ? 0 : b > a ? 1 : 'draw'
  },
  begun: (g) => g.balls.length > 0,
}
