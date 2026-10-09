import { describe, expect, it } from 'vitest'
import { biggestPart, mapBytes, mapParts, MAP_LIMIT } from './maps'
import type { MapDoc } from './mapDoc'
import type { Drawing } from '../draw/strokes'

/**
 * Where a map's bytes are, and whether the refusal can name them.
 *
 * ⚠️ THE CLAIM IS ABOUT ADVICE BEING ACTIONABLE. "Use simpler drawings" was the whole of the
 * old refusal, and on a map whose weight is the painted ground it is advice that cannot work.
 * So what is tested is that the part named is the part that is actually heavy.
 */

/** a drawing with `n` strokes of `pts` points each — the only knob that moves bytes */
const art = (name: string, n: number, pts: number): Drawing => ({
  v: 1,
  name,
  ratio: 1,
  bg: null,
  strokes: Array.from({ length: n }, () => ({
    t: 'brush' as const,
    c: '#4a7c3f',
    a: 1,
    w: 0.02,
    p: Array.from({ length: pts * 2 }, (_, i) => (i % 97) / 100),
  })),
})

const doc = (over: Partial<MapDoc> = {}): MapDoc => ({
  v: 1,
  name: 'A map',
  palette: [art('rock', 2, 10)],
  pieces: [{ art: 0, at: { x: 0.5, y: 0.5 }, wide: 0.1, kind: 'flat', top: 0 }],
  ground: null,
  spawn: null,
  block: null,
  doors: [],
  ...over,
})

describe('where a map’s bytes are', () => {
  it('blames the ground when the ground is the heavy thing', () => {
    const d = doc({ ground: art('painted world', 300, 60) })
    const worst = biggestPart(d)
    expect(worst?.what).toBe('the ground you painted')
    expect(mapParts(d).ground).toBeGreaterThan(mapParts(d).palette)
  })

  it('blames the stamps when the stamps are the heavy thing', () => {
    const d = doc({ palette: [art('a', 300, 60), art('b', 300, 60)] })
    expect(biggestPart(d)?.what).toBe('the drawings you stamped')
  })

  it('says nothing when nothing dominates', () => {
    /* ⚠️ "it is all of them a bit" is not advice, so it declines to name one */
    const d = doc({ palette: [art('a', 100, 40)], ground: art('g', 100, 40) })
    expect(biggestPart(d)).toBeNull()
  })

  it('counts the same bytes the keeper counts', () => {
    /* ⚠️ or the refusal quotes a number nothing enforces. mapBytes is what saveMap checks. */
    const d = doc({ ground: art('g', 40, 30) })
    expect(mapParts(d).total).toBe(mapBytes(d))
  })

  it('keeps the whole-origin budget from growing', () => {
    /**
     * ⚠️ THE REAL CEILING IS items × bytes, NOT EITHER ALONE. localStorage is about five
     * megabytes for the origin and maps share it with the gallery, the songs and the minions.
     * Twelve at 200KB was 2.4MB; this must not be more than that.
     */
    expect(MAP_LIMIT.items * MAP_LIMIT.bytes).toBeLessThanOrEqual(12 * 200 * 1024)
  })
})
