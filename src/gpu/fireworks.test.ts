import { describe, expect, it } from 'vitest'
import {
  COLOURS,
  DEFAULT_SHELL,
  EMPTY,
  MAX_CUES,
  PATTERNS,
  PRESETS,
  SPREAD,
  burst,
  decode,
  encode,
  lengthOf,
  readSaved,
  riseAt,
  apex,
  RISE,
  settle,
  sparkAt,
  splitOf,
  type Cue,
  type Shell,
  type Show,
} from './fireworks'

const shell = (s: Partial<Shell> = {}): Shell => ({ ...DEFAULT_SHELL, ...s })

describe('a burst', () => {
  it('is the same spark for spark from the same seed, and different from another', () => {
    for (const p of PATTERNS) {
      expect(burst(shell({ pattern: p }), 0.5, 0.7, 42), p).toEqual(
        burst(shell({ pattern: p }), 0.5, 0.7, 42),
      )
      expect(burst(shell({ pattern: p }), 0.5, 0.7, 42), p).not.toEqual(
        burst(shell({ pattern: p }), 0.5, 0.7, 43),
      )
    }
  })
  it('a peony throws its stars out to the size it says, measured where the air stops them', () => {
    for (const size of [0, 1, 2] as const) {
      const sparks = burst(shell({ pattern: 'peony', size }), 0, 0, 7)
      // gravity aside, a star coasts speed / drag; its speeds vary ±8% around the size's spread
      const reach = Math.max(...sparks.map((s) => Math.hypot(s.vx, s.vy) / s.drag))
      expect(reach, `size ${size}`).toBeGreaterThan(SPREAD[size] * 0.98)
      expect(reach, `size ${size}`).toBeLessThan(SPREAD[size] * 1.09)
      // and measured through the flight itself, not the formula: where the widest star ends up
      const far = sparks.reduce((a, b) => (Math.hypot(b.vx, b.vy) > Math.hypot(a.vx, a.vy) ? b : a))
      const [x, y] = sparkAt({ ...far }, 40)
      const [gx, gy] = [x, y + (0.32 / far.drag) * (40 - 1 / far.drag)]
      expect(Math.hypot(gx, gy)).toBeCloseTo(reach, 4)
    }
  })
  it('bigger shells have more stars', () => {
    const n = (size: 0 | 1 | 2) => burst(shell({ size }), 0, 0, 1).length
    expect(n(0)).toBeLessThan(n(1))
    expect(n(1)).toBeLessThan(n(2))
  })
  it('a heart is a heart: mirror-symmetric, wider than tall, with a dip at the top', () => {
    const s = burst(shell({ pattern: 'heart' }), 0, 0, 3).map((p) => [p.vx, p.vy])
    const xs = s.map((p) => p[0])
    expect(Math.max(...xs) + Math.min(...xs)).toBeCloseTo(0, 2)
    // the top centre (x near 0, upper half) is lower than the two lobes beside it
    const top = s.filter((p) => Math.abs(p[0]) < 0.02 && p[1] > 0).map((p) => p[1])
    const lobes = Math.max(...s.map((p) => p[1]))
    expect(Math.max(...top)).toBeLessThan(lobes)
  })
  it('falls under gravity once the air has slowed it', () => {
    const [s] = burst(shell(), 0.5, 0.7, 9)
    const y1 = sparkAt({ ...s, vx: 0, vy: 0 }, 1)[1]
    const y2 = sparkAt({ ...s, vx: 0, vy: 0 }, 2)[1]
    expect(y2).toBeLessThan(y1)
    expect(y1).toBeLessThan(0.7)
  })
  it('a crossette star splits into four where it has got to', () => {
    const [s] = burst(shell({ pattern: 'crossette' }), 0.5, 0.7, 5)
    expect(s.splits).toBe(true)
    const kids = splitOf(s, 1)
    expect(kids).toHaveLength(4)
    const [x, y] = sparkAt(s, s.life * 0.6)
    for (const k of kids) {
      expect(k.x).toBeCloseTo(x, 9)
      expect(k.y).toBeCloseTo(y, 9)
      expect(k.splits).toBe(false)
    }
  })
  it('a shell rises to its own height and bursts there', () => {
    const c: Cue = { at: 0, x: 0.4, seed: 2, shell: shell({ height: 0.3 }) }
    expect(riseAt(c, RISE)[1]).toBeCloseTo(apex(c.shell), 9)
    expect(riseAt(c, RISE / 2)[1]).toBeLessThan(apex(c.shell))
    expect(apex(shell({ height: 1 }))).toBeGreaterThan(apex(shell({ height: 0 })))
  })
})

describe('a show as a link', () => {
  const show: Show = {
    scene: 'lake',
    cues: [
      {
        at: 12.3,
        x: 0.2,
        seed: 0,
        shell: {
          pattern: 'spiral',
          colours: [7, 11],
          size: 2,
          height: 0.25,
          trail: false,
          crackle: true,
        },
      },
      {
        at: 0.5,
        x: 0.9,
        seed: 0,
        shell: {
          pattern: 'willow',
          colours: [3, 4],
          size: 0,
          height: 1,
          trail: true,
          crackle: false,
        },
      },
    ],
  }
  it('round-trips every field, each away from its default, in time order', () => {
    const back = decode(encode(show))!
    expect(back.scene).toBe('lake')
    expect(back.cues.map((c) => c.at)).toEqual([0.5, 12.3])
    const spiral = back.cues[1]
    expect(spiral.x).toBeCloseTo(0.2, 2)
    expect(spiral.shell).toMatchObject({
      pattern: 'spiral',
      colours: [7, 11],
      size: 2,
      trail: false,
      crackle: true,
    })
    expect(spiral.shell.height).toBeCloseTo(0.25, 1)
    expect(back.cues[0].shell).toMatchObject({
      pattern: 'willow',
      colours: [3, 4],
      size: 0,
      height: 1,
      trail: true,
    })
  })
  it('encodes to the same text every time, and decodes to the same seeds', () => {
    expect(encode(show)).toBe(encode(show))
    expect(decode(encode(show))).toEqual(decode(encode(show)))
    expect(settle(settle(show))).toEqual(settle(show))
  })
  it('is short: eighty cues fit in a link', () => {
    const big: Show = {
      scene: 'city',
      cues: Array.from({ length: 200 }, (_, i) => ({
        at: i / 3,
        x: (i % 10) / 10,
        seed: 0,
        shell: shell(),
      })),
    }
    const text = encode(big)
    expect(decode(text)!.cues).toHaveLength(MAX_CUES)
    expect(text.length).toBeLessThan(700)
  })
  it('turns away anything malformed', () => {
    const good = encode(show)
    for (const bad of [
      '',
      'abc',
      good + '!',
      'A'.repeat(2000),
      good.slice(0, -2),
      btoa('\x02\x00').replace(/=+$/, ''),
    ])
      expect(decode(bad), bad.slice(0, 12)).toBeNull()
  })
  it('the presets are real shows that run', () => {
    for (const p of PRESETS) {
      expect(p.show.cues.length, p.name).toBeGreaterThan(0)
      expect(lengthOf(p.show), p.name).toBeGreaterThan(4)
      expect(decode(encode(p.show)), p.name).toEqual(p.show)
    }
  })
})

describe('fireworks saves', () => {
  it('round-trips a designed shell and kept shows, every field away from its default', () => {
    const s = {
      shell: {
        pattern: 'heart',
        colours: [8, 5],
        size: 2,
        height: 0.31,
        trail: false,
        crackle: true,
      },
      show: encode(PRESETS[0].show),
      shows: [{ name: 'Mine', show: encode(PRESETS[1].show) }],
    }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
  })
  it('a broken store loses only what is bad', () => {
    expect(readSaved('{')).toEqual(EMPTY)
    const back = readSaved(
      JSON.stringify({
        shell: { pattern: 'nope', colours: [99, 3], size: 9 },
        show: '!!',
        shows: [{ name: 'x', show: 'bad' }],
      }),
    )
    expect(back.shell.pattern).toBe('peony')
    expect(back.shell.colours).toEqual([0, 3])
    expect(back.show).toBe('')
    expect(back.shows).toEqual([])
    expect(COLOURS).toHaveLength(12)
  })
})
