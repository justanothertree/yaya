import { describe, expect, it } from 'vitest'
import {
  EMPTY,
  NOTES,
  answer,
  gapFor,
  newRun,
  press,
  readSaved,
  roundTune,
  tune,
  type Run,
  type Saved,
} from './echo'

/** play a round back perfectly */
const playBack = (r: Run) => {
  let run = r
  for (const p of answer(roundTune(run), run.mode)) run = press(run, p).run
  return run
}

describe('the tune', () => {
  it('is the same for the same seed, and a longer one begins with the shorter', () => {
    expect(tune(5, 12, 4)).toEqual(tune(5, 12, 4))
    expect(tune(5, 20, 6).slice(0, 12)).toEqual(tune(5, 12, 6))
    expect(tune(5, 12, 4)).not.toEqual(tune(6, 12, 4))
    for (let s = 1; s < 50; s++) {
      const t = tune(s, 40, 4)
      expect(t.every((p) => p >= 0 && p < 4)).toBe(true)
      // never one pad four times running
      for (let i = 3; i < t.length; i++)
        expect(t[i] === t[i - 1] && t[i] === t[i - 2] && t[i] === t[i - 3]).toBe(false)
    }
  })
  it('uses every pad, about as often as each other', () => {
    const t = tune(9, 6000, 6)
    for (let p = 0; p < 6; p++) {
      const share = t.filter((x) => x === p).length / t.length
      expect(share).toBeGreaterThan(0.14)
      expect(share).toBeLessThan(0.19)
    }
  })
  it('is played back in order, or backwards in mirror play', () => {
    expect(answer([0, 1, 2, 3], 'echo')).toEqual([0, 1, 2, 3])
    expect(answer([0, 1, 2, 3], 'mirror')).toEqual([3, 2, 1, 0])
  })
  it('is played quicker as it grows, but never too quick to follow', () => {
    for (let n = 1; n < 40; n++) expect(gapFor(n + 1)).toBeLessThanOrEqual(gapFor(n))
    expect(gapFor(1)).toBeGreaterThan(500)
    expect(gapFor(100)).toBe(260)
  })
  it('sounds like a tune: the pads are a pentatonic scale, with no two a semitone apart', () => {
    for (const notes of Object.values(NOTES))
      for (const a of notes)
        for (const b of notes) if (a !== b) expect(Math.abs(a - b) % 12).not.toBe(1)
    expect(NOTES[4]).toHaveLength(4)
    expect(NOTES[6]).toHaveLength(6)
  })
})

describe('a game', () => {
  it('grows by a note for every round played back', () => {
    let r = newRun(3, 4, 'echo', 1)
    for (let k = 1; k <= 10; k++) {
      expect(r.length).toBe(k)
      r = playBack(r)
      expect(r.best).toBe(k)
    }
    expect(r.over).toBe(false)
  })
  it('in mirror play wants the tune backwards, and the forwards order is wrong', () => {
    let r = newRun(4, 4, 'mirror', 1)
    r = playBack(playBack(playBack(r)))
    expect(r.length).toBe(4)
    const t = roundTune(r)
    if (t[0] !== t[t.length - 1]) expect(press(r, t[0]).verdict).toBe('over')
  })
  it('ends at the first wrong pad when strict, and gives three goes when gentle', () => {
    const wrongOf = (r: Run) => (answer(roundTune(r), r.mode)[r.pressed.length] + 1) % r.pads
    const strict = playBack(newRun(7, 4, 'echo', 1))
    const s = press(strict, wrongOf(strict))
    expect(s.verdict).toBe('over')
    expect(s.run.over).toBe(true)
    expect(s.run.best).toBe(1)
    expect(press(s.run, 0).verdict).toBe('ignored')
    let g = playBack(newRun(7, 4, 'echo', 3))
    for (const want of ['wrong', 'wrong', 'over'] as const) {
      const before = g.length
      const v = press(g, wrongOf(g))
      expect(v.verdict).toBe(want)
      g = v.run
      // a wrong pad replays the same round from its start
      if (want === 'wrong') {
        expect(g.length).toBe(before)
        expect(g.pressed).toEqual([])
      }
    }
  })
  it('ignores a pad that is not there', () => {
    const r = newRun(1, 4, 'echo', 1)
    expect(press(r, 4).verdict).toBe('ignored')
    expect(press(r, -1).verdict).toBe('ignored')
  })
})

describe('what is kept', () => {
  it('round-trips every field that is not a default', () => {
    const s: Saved = {
      pads: 6,
      mode: 'mirror',
      strict: false,
      sound: 'pluck',
      palette: 'neon',
      best: {
        strict: { 4: { echo: 12, mirror: 7 }, 6: { echo: 9, mirror: 5 } },
        gentle: { 4: { echo: 15, mirror: 8 }, 6: { echo: 11, mirror: 6 } },
      },
    }
    for (const k of Object.keys(s) as (keyof Saved)[]) expect(s[k]).not.toEqual(EMPTY[k])
    expect(readSaved(JSON.stringify(s))).toEqual(s)
  })
  it('falls back on anything it does not recognise', () => {
    expect(readSaved('{"pads":5,"sound":"drum","strict":"yes"}')).toEqual(EMPTY)
    expect(readSaved('')).toEqual(EMPTY)
  })
})
