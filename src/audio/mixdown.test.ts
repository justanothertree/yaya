import { describe, expect, it } from 'vitest'
import { endOfSound, fadeOut, fromMarker, measure, underCeiling } from './mixdown'
import { toWav } from './wav'

const RATE = 1000

describe('a recorded mix', () => {
  /** blocks of four frames; each sample is its own frame number, so where a cut lands is legible */
  const blocks = (frames: number, markFrom: number | null) => {
    const left: Float32Array[] = []
    const right: Float32Array[] = []
    const mark: Float32Array[] = []
    for (let b = 0; b < frames; b += 4) {
      const n = Math.min(4, frames - b)
      left.push(Float32Array.from({ length: n }, (_, k) => b + k))
      right.push(Float32Array.from({ length: n }, (_, k) => -(b + k)))
      mark.push(
        Float32Array.from({ length: n }, (_, k) =>
          markFrom !== null && b + k >= markFrom ? 1 : 0,
        ),
      )
    }
    return { left, right, mark }
  }

  it('starts on the very sample the marker does, across a block boundary', () => {
    const got = fromMarker(blocks(20, 6))!
    expect(got.left[0]).toBe(6)
    expect(got.right[0]).toBe(-6)
    expect(got.left).toHaveLength(14)
  })

  it('refuses a recording the marker never reached', () => {
    expect(fromMarker(blocks(20, null))).toBeNull()
  })

  it('ends where the sound does, a breath after it, never before the song has', () => {
    /* a second of tone at full level, then a quiet tail 30dB down for half a second, then 40dB
       further down: the floor (60dB under the peak) keeps the first tail and drops the second */
    const left = new Float32Array(2 * RATE)
    for (let i = 0; i < 1000; i++) left[i] = Math.sin(i)
    for (let i = 1000; i < 1500; i++) left[i] = 0.03 * Math.sin(i)
    for (let i = 1500; i < 2000; i++) left[i] = 0.0003 * Math.sin(i)
    const right = left.slice()
    const end = endOfSound(left, right, 0, RATE)
    expect(end).toBeGreaterThan(1495)
    expect(end).toBeLessThan(1500 + 0.06 * RATE)
    /* and the song's own length when it ends on a rest */
    expect(endOfSound(left, right, 1900, RATE)).toBe(1900)
  })

  it('fades to silence over its last frames, and leaves the rest alone', () => {
    const left = new Float32Array(100).fill(1)
    const right = new Float32Array(100).fill(-1)
    fadeOut(left, right, 10)
    expect(left[99]).toBe(0)
    expect(right[99] === 0).toBe(true)
    expect(left[94]).toBeCloseTo(0.5, 5)
    expect(left[89]).toBe(1)
  })

  it('measures length, peak and average level, and counts samples at full scale', () => {
    const left = Float32Array.from({ length: RATE }, (_, i) =>
      Math.sin((2 * Math.PI * 50 * i) / RATE),
    )
    const right = left.slice()
    const s = measure(left, right, RATE)
    expect(s.seconds).toBe(1)
    expect(s.peakDb).toBeCloseTo(0, 1)
    /* a sine's average is its peak over the root of two: 3dB down */
    expect(s.rmsDb).toBeCloseTo(-3.01, 1)
    expect(s.clipped).toBeGreaterThan(0)
    const half = measure(
      left.map((x) => x / 2),
      right.map((x) => x / 2),
      RATE,
    )
    expect(half.peakDb).toBeCloseTo(-6.02, 1)
    expect(half.clipped).toBe(0)
  })
})

describe('under full scale', () => {
  it('a mix past full scale comes down by one amount, its loudest sample at the ceiling', () => {
    const left = new Float32Array([0.5, 1.2, -0.3])
    const right = new Float32Array([-1.1, 0.2, 0.6])
    const g = underCeiling(left, right, 0.9)
    expect(g).toBeCloseTo(0.75, 6)
    expect(Math.max(...left.map(Math.abs), ...right.map(Math.abs))).toBeCloseTo(0.9, 6)
    /* the same amount everywhere: a quiet sample keeps its share of the loudest */
    expect(left[0] / left[1]).toBeCloseTo(0.5 / 1.2, 6)
    expect(right[2]).toBeCloseTo(0.45, 6)
  })

  it('a mix already under is left exactly as it was', () => {
    const left = new Float32Array([0.5, -0.8])
    const right = new Float32Array([0.1, 0.2])
    expect(underCeiling(left, right, 0.9)).toBe(1)
    expect([...left]).toEqual([0.5, -0.8].map(Math.fround))
  })
})

describe('a WAV file', () => {
  const read = async (b: Blob) => new DataView(await b.arrayBuffer())

  it('of two channels: a stereo header, then left and right in turn', async () => {
    const v = await read(
      toWav([new Float32Array([0.5, -0.5]), new Float32Array([0.25, 1.5])], 8000),
    )
    expect(v.getUint16(22, true)).toBe(2)
    expect(v.getUint32(24, true)).toBe(8000)
    expect(v.getUint32(28, true)).toBe(8000 * 2 * 2)
    expect(v.getUint16(32, true)).toBe(4)
    expect(v.getUint32(40, true)).toBe(2 * 2 * 2)
    expect(v.byteLength).toBe(44 + 8)
    /* frame one: left then right; frame two the same, the right clamped at full scale */
    expect([0, 1, 2, 3].map((k) => v.getInt16(44 + 2 * k, true))).toEqual([
      Math.round(0.5 * 0x7fff - 0.5),
      Math.round(0.25 * 0x7fff - 0.5),
      -0x4000,
      0x7fff,
    ])
  })

  it('of one channel, as it always was', async () => {
    const v = await read(toWav(new Float32Array([0, 0.5, -1]), 44100))
    expect(v.getUint16(22, true)).toBe(1)
    expect(v.getUint32(28, true)).toBe(44100 * 2)
    expect(v.getUint16(32, true)).toBe(2)
    expect(v.getUint32(40, true)).toBe(6)
    expect(v.getInt16(48, true)).toBe(-0x8000)
  })
})
