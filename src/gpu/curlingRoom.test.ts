import { describe, expect, it } from 'vitest'
import { rng } from './bricks'
import {
  STEP,
  TEE,
  addStep,
  deliver,
  drawTo,
  moving,
  settle,
  slide,
  spansOf,
  step,
  sweepTo,
  sweptOn,
  type Spans,
  type Stone,
} from './curling'
import {
  CALL_ENDS,
  MAX_THROWS,
  computerThrow,
  curlingRules as R,
  pack,
  readThrow,
  type CurlingGame,
  type Throw,
} from './curlingRoom'

const at = (s: readonly Stone[]) => s.map((x) => [x.team, x.x, x.y])

/** a whole game between two computer skips through the room's own rules, every throw of it */
function playThrough(seed: number) {
  const rand = rng(seed)
  let cg = R.fresh()
  const seen: CurlingGame[] = [cg]
  while (R.turn(cg) !== null) {
    const side = R.turn(cg) as 0 | 1
    const t = computerThrow(cg, side ? 'fair' : 'hard', rand)
    expect(R.legal(cg, t, side)).toBe(true)
    expect(R.legal(cg, t, side === 0 ? 1 : 0)).toBe(false)
    cg = R.apply(cg, t, side)
    seen.push(cg)
  }
  return { cg, seen }
}

/** a stone slid the way the toy slides yours: a step at a time, swept while a hand is held down */
function liveSlide(stones: Stone[], t: Throw['shot'], team: 0 | 1, held: (i: number) => boolean) {
  let now = deliver(stones, t, team)
  const thrown = now[now.length - 1]
  const knocked = new Set<Stone>()
  const spans: Spans = []
  for (let i = 0; moving(now); i++) {
    const sw = held(i) && now.includes(thrown) ? thrown : null
    if (sw) addStep(spans, i)
    now = step(now, sw, STEP, knocked)
  }
  for (const s of now) {
    s.vx = 0
    s.vy = 0
  }
  return { stones: settle(now, thrown, knocked.has(thrown)), spans }
}

describe('curling on the wire', () => {
  it('replays to the very same game from its throws, at every throw of a real game', () => {
    const { cg, seen } = playThrough(3)
    expect(cg.g.over).toBe(true)
    expect(cg.g.scores.length).toBeGreaterThanOrEqual(CALL_ENDS)
    for (const d of seen) {
      const w = JSON.parse(JSON.stringify(R.encode(d)))
      const back = R.decode(w)!
      expect(at(back.g.stones)).toEqual(at(d.g.stones))
      expect(back.g.scores).toEqual(d.g.scores)
      expect([back.g.hammer, back.g.thrown, back.g.over]).toEqual([
        d.g.hammer,
        d.g.thrown,
        d.g.over,
      ])
      expect(back.last?.ended).toEqual(d.last?.ended)
      expect(at(back.last?.stones ?? [])).toEqual(at(d.last?.stones ?? []))
      expect(R.encode(back)).toEqual(w)
    }
    expect(R.result!(cg)).not.toBeNull()
    expect(R.legal(cg, seen[1].throws[0])).toBe(false)
    expect(R.decode({ throws: [...cg.throws.map(pack), pack(cg.throws[0])] })).toBeNull()
  })

  it('⚠️ slides a stone swept live to exactly where the thrower saw it stop', () => {
    // a light draw, swept in two bursts as a thumb might hold and lift and hold again
    const shot = {
      ...drawTo({ x: 0.3, y: TEE }, 1),
      speed: drawTo({ x: 0.3, y: TEE }, 1).speed * 0.95,
    }
    const guard: Stone[] = [{ x: 0.2, y: TEE - 1, vx: 0, vy: 0, spin: 0, team: 1 }]
    for (const held of [
      (i: number) => i >= 300 && i < 700,
      (i: number) => (i >= 120 && i < 260) || (i >= 900 && i < 1300),
      (i: number) => i % 50 < 20,
      () => false,
    ]) {
      const live = liveSlide(guard, shot, 0, held)
      const cg = R.apply(
        { ...R.fresh(), g: { ...R.fresh().g, stones: guard } },
        { shot, sweeps: live.spans },
        0,
      )
      expect(at(cg.last!.stones)).toEqual(at(live.stones))
    }
    // and sweeping makes a difference worth carrying: the swept stone is not where the unswept is
    const swept = liveSlide([], shot, 0, (i) => i >= 300 && i < 700).stones
    const not = liveSlide([], shot, 0, () => false).stones
    expect(swept[0].y - not[0].y).toBeGreaterThan(0.1)
  })

  it('carries the computer’s sweepers as the very steps they swept', () => {
    const shot = drawTo({ x: 0, y: TEE }, -1)
    const light = { ...shot, speed: shot.speed * 0.95 }
    const sweeper = sweepTo({ x: 0, y: TEE })
    const spans = spansOf([], light, 0, sweeper)
    expect(spans.length).toBeGreaterThan(0)
    expect(at(slide([], light, 0, sweptOn(spans)).stones)).toEqual(
      at(slide([], light, 0, sweeper).stones),
    )
  })

  it('refuses a throw outside what any thrower here could send', () => {
    expect(readThrow([0.01, 4, 1, [[3, 9]]])).toEqual({
      shot: { angle: 0.01, speed: 4, spin: 1 },
      sweeps: [[3, 9]],
    })
    for (const bad of [
      [0.7, 4, 1, []],
      [0, 11, 1, []],
      [0, 0.2, 1, []],
      [0, 4, 0, []],
      [0, 4, 1, null],
      [0, 4, 1, [[9, 3]]],
      [
        0,
        4,
        1,
        [
          [3, 9],
          [5, 12],
        ],
      ],
      [0, 4, 1, [[1.5, 3]]],
      [0, 4, 1, [[0, 99999]]],
      [0, 4, 1, Array.from({ length: 401 }, (_, i) => [i * 2, i * 2 + 1])],
      null,
    ])
      expect(readThrow(bad)).toBeNull()
  })

  it('refuses a game that is not a list of throws, or longer than any game', () => {
    expect(R.decode(null)).toBeNull()
    expect(R.decode({})).toBeNull()
    expect(R.decode({ throws: [[0, 99, 1, []]] })).toBeNull()
    expect(
      R.decode({ throws: Array.from({ length: MAX_THROWS + 1 }, () => [0, 1, 1, []]) }),
    ).toBeNull()
  })

  it('starts with seat 0 throwing and seat 1 holding the hammer', () => {
    const cg = R.fresh()
    expect(R.turn(cg)).toBe(0)
    expect(cg.g.hammer).toBe(1)
    const t = computerThrow(cg, 'hard', rng(1))
    expect(R.turn(R.apply(cg, t, 0))).toBe(1)
  })
})
