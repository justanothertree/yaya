import { describe, expect, it } from 'vitest'
import { DT, muscles, type Body } from './critters'
import code from './strut.wgsl?raw'
import {
  FINISH,
  INK,
  MAX_MUSCLES,
  MAX_SPLATS,
  PITCH_FLOOR,
  PITCH_STEP,
  PAINT,
  PULL,
  RELAX,
  STEPS,
  STRUTS,
  drums,
  emptyRows,
  hueOf,
  inkSize,
  middleOf,
  notes,
  packPaint,
  readStrut,
  splatsFor,
  trailFor,
  startStrut,
  stepAt,
  stepLength,
  strut,
  type Event,
  type Pattern,
} from './strut'
import { wgslLayout } from './wgslLayout'

const stomper = STRUTS.stomper
const bars = (p: Pattern, n: number) => Math.round((n * STEPS * stepLength(p.bpm)) / DT)
const play = (body: Body, p: Pattern, n: number) => {
  const s = startStrut(body)
  const events: Event[] = []
  let top = 0
  const total = bars(p, n)
  for (let k = 0; k < total; k += 20) {
    events.push(...strut(body, p, s, Math.min(20, total - k)))
    top = Math.max(top, ...s.y)
  }
  return { s, events, top }
}

describe('the shader and this file describe one painting', () => {
  const wgsl = wgslLayout(code, 'Paint')
  it('agree about where every field of the uniform lives, and write each where it is read', () => {
    const { bytes, ...rest } = PAINT
    expect(wgsl.offsets).toEqual(rest)
    expect(wgsl.bytes).toBe(bytes)
    const v = new DataView(
      packPaint({
        w: 640,
        h: 360,
        cam: [3, 1.1],
        scale: 140,
        splats: 5,
        bones: 9,
        joints: 6,
        time: 2,
      }),
    )
    const u = (k: string, i = 0) => v.getUint32(wgsl.offsets[k] + 4 * i, true)
    const f = (k: string, i = 0) => v.getFloat32(wgsl.offsets[k] + 4 * i, true)
    expect([
      u('size'),
      u('size', 1),
      u('ink'),
      u('ink', 1),
      u('splats'),
      u('bones'),
      u('joints'),
    ]).toEqual([640, 360, ...inkSize(), 5, 9, 6])
    expect([
      f('origin'),
      f('origin', 1),
      f('cam'),
      f('cam', 1),
      f('ppm'),
      f('scale'),
      f('finish'),
      f('time'),
    ]).toEqual([INK.x0, INK.y0, 3, 1.1, INK.ppm, 140, FINISH, 2].map(Math.fround))
  })
  it('keeps the whole parade, from before the start to past the flag, and two octaves of notes, on the paper', () => {
    expect(PITCH_FLOOR + 24 * PITCH_STEP).toBeLessThan(INK.y1)
    expect(INK.x0).toBeLessThan(-1)
    expect(INK.x1).toBeGreaterThan(FINISH + 2)
    const [w, h] = inkSize()
    expect(w).toBe((INK.x1 - INK.x0) * INK.ppm)
    expect(w * h * 8).toBeLessThan(8 * 1024 * 1024)
  })
})

describe('the music a body makes', () => {
  it('gives longer muscles lower notes, on a pentatonic scale from the root, and every muscle its own', () => {
    const b = STRUTS.inchworm.body
    const n = notes(b, 60)
    const len = b.bones
      .filter((x) => x.muscle)
      .map((x) =>
        Math.hypot(b.joints[x.b][0] - b.joints[x.a][0], b.joints[x.b][1] - b.joints[x.a][1]),
      )
    for (let i = 0; i < n.length; i++)
      for (let j = 0; j < n.length; j++) {
        if (len[i] > len[j] + 0.01) expect(n[i]).toBeLessThan(n[j])
        // the same length: neighbouring notes, the earlier muscle lower — never the same note
        if (i < j && Math.abs(len[i] - len[j]) < 0.005) expect(n[i]).toBeLessThan(n[j])
      }
    expect(Math.min(...n)).toBe(60)
    expect(new Set(n).size).toBe(n.length)
    // the Stomper is symmetric: its two equal muscles still play two notes
    expect(new Set(notes(STRUTS.stomper.body, 48)).size).toBe(2)
    for (const x of n) expect([0, 2, 4, 7, 9]).toContain((x - 60) % 12)
  })
  it('drums the feet kick and snare, left to right, and saves the toms for joints off the ground', () => {
    const d = drums(stomper.body)
    // the Stomper's feet are joints 4 (left) and 5 (right)
    expect([d[4], d[5]]).toEqual([36, 38])
    for (const j of [0, 1, 2, 3]) expect([40, 41, 43, 46]).toContain(d[j])
  })
  it('colours the twelve pitches round the wheel, each its own', () => {
    const hues = Array.from({ length: 12 }, (_, i) =>
      hueOf(60 + i)
        .map((x) => x.toFixed(2))
        .join(),
    )
    expect(new Set(hues).size).toBe(12)
    expect(hueOf(60)).toEqual([1, 0, 0])
    expect(hueOf(72)).toEqual(hueOf(60))
  })
})

describe('the sequencer', () => {
  it('sounds every lit step once, as it starts — from the very first', () => {
    const one: Pattern = {
      ...stomper.pattern,
      rows: [
        Array(STEPS)
          .fill(false)
          .map((_, i) => i === 0),
        Array(STEPS).fill(false),
      ],
    }
    const notesOf = (p: Pattern, n: number) =>
      play(stomper.body, p, n).events.filter((e) => e.kind === 'note')
    expect(notesOf(one, 3)).toHaveLength(3)
    expect(notesOf(one, 3).every((e) => e.kind === 'note' && e.step === 0 && e.muscle === 0)).toBe(
      true,
    )
    const all: Pattern = {
      ...stomper.pattern,
      rows: [Array(STEPS).fill(true), Array(STEPS).fill(false)],
    }
    expect(notesOf(all, 2)).toHaveLength(2 * STEPS)
    expect(stepAt(0, 120)).toBe(0)
    expect(stepAt(stepLength(120) * 17.5, 120)).toBe(1)
  })
  it('pulls a lit muscle in and lets an unlit one out', () => {
    const p: Pattern = {
      ...stomper.pattern,
      rows: [Array(STEPS).fill(true), Array(STEPS).fill(false)],
    }
    const s = startStrut(stomper.body)
    const rest = [...s.len]
    strut(stomper.body, p, s, Math.round(0.5 / DT))
    expect(s.len[0]).toBeCloseTo(rest[0] * PULL, 3)
    expect(s.len[1]).toBeCloseTo(rest[1] * RELAX, 3)
  })
  it('stands still and silent with nothing lit', () => {
    const { s, events, top } = play(
      stomper.body,
      { ...stomper.pattern, rows: emptyRows(stomper.body) },
      2,
    )
    expect(events.filter((e) => e.kind === 'note')).toHaveLength(0)
    expect(Math.abs(middleOf(s))).toBeLessThan(0.05)
    expect(top).toBeLessThan(1.1)
  })
  it('walks each preset forward along the parade, upright, and drums as it goes', () => {
    for (const [id, want] of [
      ['stomper', 10],
      ['inchworm', 4],
    ] as const) {
      const { body, pattern } = STRUTS[id]
      const { s, events, top } = play(body, pattern, 8)
      expect(middleOf(s)).toBeGreaterThan(want)
      expect(top).toBeLessThan(Math.max(...body.joints.map((j) => j[1])) + 0.4)
      expect(events.filter((e) => e.kind === 'foot').length).toBeGreaterThan(16)
    }
  })
  it('is the same walk every time', () => {
    const a = play(stomper.body, stomper.pattern, 2)
    const b = play(stomper.body, stomper.pattern, 2)
    expect([...a.s.x]).toEqual([...b.s.x])
    expect(a.events).toEqual(b.events)
  })
})

describe('the painting', () => {
  it('lays a note at its muscle in the colour its pitch takes out of the paper, and a footfall on the floor', () => {
    const s = startStrut(stomper.body)
    const out = splatsFor(
      [
        { kind: 'note', muscle: 1, step: 0 },
        { kind: 'foot', joint: 4, speed: 2 },
      ],
      stomper.body,
      stomper.pattern,
      s,
    )
    expect(out).toHaveLength(16)
    const m = stomper.body.bones.filter((b) => b.muscle)[1]
    expect(out[0]).toBeCloseTo((s.x[m.a] + s.x[m.b]) / 2, 9)
    // as high up the paper as the note is up the scale: a score
    const n = notes(stomper.body, stomper.pattern.root)[1]
    expect(out[1]).toBeCloseTo(PITCH_FLOOR + (n - stomper.pattern.root) * PITCH_STEP, 9)
    const c = hueOf(n)
    expect(out.slice(4, 7).map((x) => +x.toFixed(9))).toEqual(
      c.map((x) => +((1 - x) * 0.6).toFixed(9)),
    )
    expect(out[8]).toBeCloseTo(s.x[4], 9)
    expect(out[9]).toBeLessThan(0.05)
    // and the dance: a faint dot under every joint
    const trail = trailFor(s)
    expect(trail).toHaveLength(stomper.body.joints.length * 8)
    expect([trail[0], trail[1]]).toEqual([s.x[0], s.y[0]])
    const many = Array.from({ length: 200 }, (): Event => ({ kind: 'foot', joint: 4, speed: 1 }))
    expect(splatsFor(many, stomper.body, stomper.pattern, s).length / 8).toBe(MAX_SPLATS)
  })
})

describe('keeping a strut', () => {
  const body: Body = {
    joints: [
      [-0.3, 0.1],
      [0.5, 0.1],
      [0.1, 0.7],
      [0.6, 0.6],
    ],
    bones: [
      { a: 0, b: 1, muscle: true },
      { a: 1, b: 2, muscle: false },
      { a: 2, b: 0, muscle: true },
      { a: 2, b: 3, muscle: true },
    ],
  }
  const pattern: Pattern = {
    rows: [0, 1, 2].map((m) => Array.from({ length: STEPS }, (_, k) => (k + m) % 3 === 0)),
    bpm: 133,
    instrument: 'steelpan',
    root: 53,
  }
  it('comes back as it went — every field away from its default', () => {
    expect(readStrut(JSON.stringify({ body, pattern }))).toEqual({ body, pattern })
  })
  it('takes nothing on trust, and refuses rather than repairs', () => {
    const bad = (x: unknown) => readStrut(JSON.stringify(x))
    expect(bad({ body, pattern: { ...pattern, rows: pattern.rows.slice(1) } })).toBe(null)
    expect(
      bad({
        body,
        pattern: { ...pattern, rows: [...pattern.rows.slice(1), Array(STEPS).fill(1)] },
      }),
    ).toBe(null)
    expect(bad({ body, pattern: { ...pattern, rows: pattern.rows.map((r) => r.slice(1)) } })).toBe(
      null,
    )
    expect(bad({ body: { ...body, bones: [{ a: 0, b: 9, muscle: true }] }, pattern })).toBe(null)
    const nine: Body = {
      joints: Array.from(
        { length: 10 },
        (_, i) => [i * 0.2, i % 2 ? 0.3 : 0.1] as [number, number],
      ),
      bones: Array.from({ length: 9 }, (_, i) => ({ a: i, b: i + 1, muscle: true })),
    }
    expect(muscles(nine)).toBeGreaterThan(MAX_MUSCLES)
    expect(bad({ body: nine, pattern: { ...pattern, rows: emptyRows(nine) } })).toBe(null)
    // tempo clamped, an unknown voice is the default, the root clamped and whole
    const odd = bad({ body, pattern: { ...pattern, bpm: 9999, instrument: 'kazoo', root: 200.4 } })!
    expect(odd.pattern).toMatchObject({ bpm: 180, instrument: 'marimba', root: 72 })
    for (const t of [null, '', '[]', '{}', 'nope', 'x'.repeat(60_000)])
      expect(readStrut(t)).toBe(null)
  })
})
