import { describe, it, expect } from 'vitest'
import {
  R2_CLASS_A,
  R2_CLASS_B,
  R2_FREE,
  r2Class,
  r2Known,
  r2Operations,
  r2Storage,
} from './r2ops.mjs'

/**
 * The R2 price list, and the two folds built on it.
 *
 * ⚠️ THESE NUMBERS GO ON A BILLING SCREEN, which is the only reason this file exists. The panel's
 * one job is to answer "am I about to be charged" — so every way of getting it wrong here ends
 * with either a figure that alarms for nothing or, far worse, a confident zero that says do not
 * look. The relay could not be asked any of this: the fold ran inside a 2,700-line module that
 * opens a WebSocket server at import.
 *
 * ⚠️ MADE TO FAIL ONCE, 3 Nov 2026. Two perturbations, each the mistake this file is
 * really about. Pricing an unknown operation as FREE rather than as a write: 2 red. Summing
 * `r2StorageAdaptiveGroups` over the window instead of taking its max: 2 red. The other 13 stay
 * green through both, which is the asymmetry that matters -- a wrong price list and a wrong fold
 * are both correct about everything except the thing that costs money.
 *
 * The expectations are written from the PRICE LIST's shape rather than from the functions' sums:
 * "a write is Class A, a read is Class B, a delete is free, and anything unrecognised is priced
 * as the expensive one" is a claim about money, and it would catch the fallback being flipped.
 */
describe('r2Class', () => {
  it('prices a write as A, a read as B and a delete as free', () => {
    expect(r2Class('PutObject')).toBe('A')
    expect(r2Class('ListObjects')).toBe('A')
    expect(r2Class('GetObject')).toBe('B')
    expect(r2Class('HeadObject')).toBe('B')
    expect(r2Class('DeleteObject')).toBe('free')
  })

  /**
   * ⚠️ THE FALLBACK IS THE POINT, AND ITS DIRECTION IS THE WHOLE DECISION. R2 gains operations
   * over time and these lists are a copy of somebody else's document. Priced high, a new write
   * makes the panel slightly pessimistic; priced free, it makes it reassuring and wrong.
   */
  it('prices an operation it has never heard of as the expensive one', () => {
    expect(r2Class('PutSomethingInventedNextYear')).toBe('A')
    expect(r2Class('')).toBe('A')
    expect(r2Class(undefined)).toBe('A')
    expect(r2Class(null)).toBe('A')
    expect(r2Class(42)).toBe('A')
  })

  it('knows what it knows, and says so, so an unknown can be looked up', () => {
    expect(r2Known('GetObject')).toBe(true)
    expect(r2Known('DeleteObject')).toBe(true)
    expect(r2Known('PutSomethingInventedNextYear')).toBe(false)
  })

  /** no operation may be in two classes, or one count would be priced twice */
  it('puts every named operation in exactly one class', () => {
    const all = [...R2_CLASS_A, ...R2_CLASS_B, ...R2_FREE]
    expect(new Set(all).size).toBe(all.length)
  })

  it('agrees with its own lists for every name in them', () => {
    for (const a of R2_CLASS_A) expect(r2Class(a)).toBe('A')
    for (const b of R2_CLASS_B) expect(r2Class(b)).toBe('B')
    for (const f of R2_FREE) expect(r2Class(f)).toBe('free')
  })

  /**
   * The operations this site actually performs, named rather than left to the lists. Keeping a
   * picture is a PutObject each for the full size and the thumbnail; looking at one is a
   * GetObject; taking it down is two DeleteObjects — and the diagnostic op is a HeadBucket.
   * If deleting were ever priced, tidying up would cost money, which is the wrong incentive to
   * build into somebody's photo album.
   */
  it('prices what this site does: two writes to keep, two free deletes to remove', () => {
    expect(r2Class('PutObject')).toBe('A')
    expect(r2Class('GetObject')).toBe('B')
    expect(r2Class('DeleteObject')).toBe('free')
    expect(r2Class('HeadBucket')).toBe('B')
  })
})

describe('r2Operations', () => {
  const g = (actionType, requests) => ({ sum: { requests }, dimensions: { actionType } })

  it('folds the dataset into the three numbers a bill is made of', () => {
    expect(r2Operations([g('PutObject', 10), g('GetObject', 100), g('DeleteObject', 5)])).toEqual({
      classA: 10,
      classB: 100,
      freeOps: 5,
      unknown: [],
    })
  })

  it('adds up several groups of the same class', () => {
    const out = r2Operations([g('PutObject', 10), g('UploadPart', 7), g('HeadObject', 3)])
    expect(out.classA).toBe(17)
    expect(out.classB).toBe(3)
  })

  /**
   * ⚠️ `null`, NOT 0, WHEN THERE IS NOTHING TO FOLD. A missing dataset and an idle month are
   * different answers, and this is the one panel where reporting the second for the first is the
   * whole failure: zero says "no need to look". It is the same rule the relay's `!r.ok` check
   * was added for.
   */
  it('answers null for a dataset that is not there, and 0 for one that is empty', () => {
    for (const nothing of [undefined, null, {}, 'nope', 7]) {
      expect(r2Operations(nothing)).toEqual({
        classA: null,
        classB: null,
        freeOps: null,
        unknown: [],
      })
    }
    expect(r2Operations([])).toEqual({ classA: 0, classB: 0, freeOps: 0, unknown: [] })
  })

  it('reports an unrecognised action once, and still counts it as a write', () => {
    const out = r2Operations([g('PutBlobNextYear', 4), g('PutBlobNextYear', 6), g('GetObject', 1)])
    expect(out.unknown).toEqual(['PutBlobNextYear'])
    expect(out.classA).toBe(10)
    expect(out.classB).toBe(1)
  })

  /** a count that is not a count must not poison the total — a NaN would make the whole bill NaN */
  it('drops a count that is not a positive number rather than spoiling the sum', () => {
    const out = r2Operations([
      g('PutObject', 5),
      g('PutObject', 'lots'),
      g('PutObject', -3),
      g('PutObject', null),
      { dimensions: { actionType: 'PutObject' } },
    ])
    expect(out.classA).toBe(5)
  })
})

describe('r2Storage', () => {
  const s = (payloadSize, metadataSize, objectCount) => ({
    max: { payloadSize, metadataSize, objectCount },
  })

  /**
   * ⚠️ MAX, NOT SUM, AND THE TEST IS WRITTEN SO THE TWO CANNOT AGREE. Thirty identical daily
   * buckets of one bucket of objects: summed they are thirty times the truth, which on a 10 GB
   * free tier is the difference between "almost none" and "nearly spent". Measured against the
   * WORLD's shape — what is stored is a level, not a flow.
   */
  it('takes the high-water mark over the window rather than adding the days up', () => {
    const month = Array.from({ length: 30 }, () => s(7_000_000, 4_000, 31))
    expect(r2Storage(month)).toEqual({ bytes: 7_004_000, objects: 31 })
  })

  it('reports the peak when the level moved', () => {
    expect(r2Storage([s(1_000, 0, 1), s(9_000, 0, 9), s(5_000, 0, 5)])).toEqual({
      bytes: 9_000,
      objects: 9,
    })
  })

  /** R2 bills payload + metadata together, so a bucket of small objects is mostly metadata */
  it('counts metadata beside the payload, because the bill does', () => {
    expect(r2Storage([s(100, 25, 1)]).bytes).toBe(125)
  })

  it('still answers when metadata is missing, rather than returning NaN', () => {
    expect(r2Storage([s(100, undefined, 1)]).bytes).toBe(100)
    expect(r2Storage([s(100, 'x', 1)]).bytes).toBe(100)
  })

  it('answers null for a dataset that is not there', () => {
    for (const nothing of [undefined, null, {}, 'nope']) {
      expect(r2Storage(nothing)).toEqual({ bytes: null, objects: null })
    }
    expect(r2Storage([])).toEqual({ bytes: null, objects: null })
  })

  it('answers null for a field that is absent rather than calling it zero', () => {
    expect(r2Storage([{ max: { objectCount: 4 } }])).toEqual({ bytes: null, objects: 4 })
    expect(r2Storage([{ max: { payloadSize: 9 } }])).toEqual({ bytes: 9, objects: null })
  })
})
