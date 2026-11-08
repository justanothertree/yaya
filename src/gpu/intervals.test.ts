import { describe, expect, it } from 'vitest'
import {
  HIGH,
  INTERVALS,
  LOW,
  STAGES,
  answerOf,
  byShort,
  noteName,
  question,
  readSaved,
  record,
  unlocked,
  weights,
  type Stats,
} from './intervals'

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

describe('the intervals and the stages', () => {
  it('twelve intervals, one for each distance from a semitone to an octave', () => {
    expect(INTERVALS.map((i) => i.semis)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(new Set(INTERVALS.map((i) => i.short)).size).toBe(12)
  })
  it('each stage keeps everything the last one had, and the first is easy to tell apart', () => {
    for (let k = 1; k < STAGES.length; k++) {
      for (const s of STAGES[k - 1]) expect(STAGES[k], `stage ${k + 1}`).toContain(s)
      expect(STAGES[k].length).toBeGreaterThan(STAGES[k - 1].length)
    }
    for (const s of STAGES.flat()) expect(byShort(s)).toBeDefined()
    expect(STAGES[STAGES.length - 1].length).toBe(12)
    // the first three are at least three semitones from each other — no near neighbours yet
    const first = STAGES[0].map((s) => byShort(s).semis).sort((a, b) => a - b)
    for (let i = 1; i < first.length; i++) expect(first[i] - first[i - 1]).toBeGreaterThanOrEqual(3)
  })
  it('passing a stage opens the next, and the last stays the last', () => {
    expect([0, 1, 5, 6, 9].map(unlocked)).toEqual([0, 1, 5, 5, 5])
  })
})

describe('questions', () => {
  it('stay in range, go the way asked, and are answered by their own notes', () => {
    const rand = rng(1)
    let last: string | undefined
    for (let n = 0; n < 3000; n++) {
      const set = STAGES[n % STAGES.length]
      const dir = (['up', 'down', 'together', 'mixed'] as const)[n % 4]
      const q = question(set, {}, dir, rand, last)
      expect(q.first).toBeGreaterThanOrEqual(LOW)
      expect(q.second).toBeLessThanOrEqual(HIGH)
      expect(Math.max(q.first, q.second)).toBeLessThanOrEqual(HIGH)
      expect(Math.min(q.first, q.second)).toBeGreaterThanOrEqual(LOW)
      expect(answerOf(q)).toBe(q.interval)
      expect(set).toContain(q.interval)
      if (dir !== 'mixed') expect(q.direction).toBe(dir)
      if (q.direction === 'down') expect(q.first).toBeGreaterThan(q.second)
      else expect(q.second).toBeGreaterThan(q.first)
      if (set.length > 1 && last) expect(q.interval).not.toBe(last)
      last = q.interval
    }
  })
  it('lean towards the ones you miss — about four times as often as one never missed', () => {
    const set = STAGES[2] // five intervals
    const stats: Stats = Object.fromEntries(set.map((s) => [s, { asked: 20, right: 20 }]))
    stats.m3 = { asked: 20, right: 0 }
    const w = weights(set, stats)
    expect(w[set.indexOf('m3')]).toBe(4)
    expect(w[set.indexOf('P8')]).toBe(1)
    // drawn, not computed: 40,000 questions with no repeat rule (no `last`)
    const rand = rng(7)
    let m3 = 0
    const N = 40000
    for (let n = 0; n < N; n++) if (question(set, stats, 'up', rand).interval === 'm3') m3++
    expect(m3 / N).toBeCloseTo(4 / 8, 1) // 4 of 4 + 1 + 1 + 1 + 1
    // nothing to go on counts as half missed
    expect(weights(['P5'], {})).toEqual([2.5])
  })
  it('name their notes', () => {
    expect([60, 61, 69, 48, 79].map(noteName)).toEqual(['C4', 'C♯4', 'A4', 'C3', 'G5'])
  })
})

describe('what is kept', () => {
  it('records answers and reads back a full record, every field away from its default', () => {
    let st: Stats = {}
    st = record(st, 'P5', true)
    st = record(st, 'P5', false)
    st = record(st, 'm3', true)
    expect(st).toEqual({ P5: { asked: 2, right: 1 }, m3: { asked: 1, right: 1 } })
    const saved = { passed: 3, stats: st, best: [10, 9, 8, 6] }
    expect(readSaved(JSON.stringify(saved))).toEqual(saved)
  })
  it('a damaged record loses only what is damaged', () => {
    const got = readSaved(
      JSON.stringify({
        passed: 99,
        stats: {
          P5: { asked: 3, right: 4 },
          m3: { asked: 2, right: 1 },
          XX: { asked: 1, right: 1 },
          P4: 'x',
        },
        best: [10, 11, -1, 7, 1, 2, 3, 4],
      }),
    )
    expect(got).toEqual({
      passed: 0,
      stats: { m3: { asked: 2, right: 1 } },
      best: [10, 0, 0, 7, 1, 2],
    })
    expect(readSaved('{')).toEqual({ passed: 0, stats: {}, best: [] })
  })
})
