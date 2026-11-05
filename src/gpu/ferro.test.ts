import { describe, expect, it } from 'vitest'
import code from './ferro.wgsl?raw'
import {
  FERRO,
  G,
  K0,
  MAX_MAGNETS,
  N,
  R_GAIN,
  R_REST,
  REACH,
  bass,
  damping,
  fft,
  fft2,
  field,
  growth,
  noiseAt,
  pool,
  POOL,
  packFerro,
  ramp,
  reverse,
  stepSH,
  twiddles,
  wave,
} from './ferro'
import { wgslLayout } from './wgslLayout'

function lcg(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** the definition, term by term, sharing nothing with the butterflies */
function dft(re: number[], im: number[]) {
  const n = re.length
  const or = new Array<number>(n).fill(0)
  const oi = new Array<number>(n).fill(0)
  for (let k = 0; k < n; k++)
    for (let t = 0; t < n; t++) {
      const a = (-2 * Math.PI * k * t) / n
      or[k] += re[t] * Math.cos(a) - im[t] * Math.sin(a)
      oi[k] += re[t] * Math.sin(a) + im[t] * Math.cos(a)
    }
  return [or, oi]
}

describe('the shader and this file describe one dish', () => {
  const wgsl = wgslLayout(code, 'Ferro')
  it('agrees about where every field of the uniform lives', () => {
    const { bytes, ...rest } = FERRO
    expect(wgsl.offsets).toEqual(rest)
    expect(wgsl.bytes).toBe(bytes)
  })
  it('writes every field where the shader will look for it, magnets and all', () => {
    const magnets = [1, 2, 3, 4, 5].map((k) => ({ x: k * 10, y: k * 20, s: k / 10 }))
    const v = new DataView(
      packFerro({
        w: 800,
        h: 600,
        magnets,
        dt: 0.3,
        spike: [6, 3],
        light: [0.4, -0.5],
        tick: 77,
      }),
    )
    const u = (k: string, i = 0) => v.getUint32(wgsl.offsets[k] + 4 * i, true)
    const f = (k: string, i = 0) => v.getFloat32(wgsl.offsets[k] + 4 * i, true)
    expect([u('size'), u('size', 1), u('grid'), u('grid', 1), u('count'), u('tick')]).toEqual([
      800,
      600,
      N,
      N,
      MAX_MAGNETS,
      77,
    ])
    expect(['m0', 'm1', 'm2', 'm3'].map((m) => [0, 1, 2].map((i) => f(m, i)))).toEqual(
      magnets.slice(0, 4).map((m) => [m.x, m.y, m.s].map(Math.fround)),
    )
    expect([
      f('dt'),
      f('k0'),
      f('g'),
      f('spike'),
      f('spike', 1),
      f('light'),
      f('light', 1),
    ]).toEqual([0.3, K0, G, 6, 3, 0.4, -0.5].map(Math.fround))
  })
  it('shares its constants with the shader', () => {
    expect(code).toContain(`const N = ${N}u;`)
    expect(code).toContain(`const BITS = ${Math.log2(N)}u;`)
    expect(code).toContain(`const REACH = ${REACH.toFixed(1)};`)
    expect(code).toContain(`const R_REST = ${R_REST};`)
    expect(code).toContain(`const R_GAIN = ${R_GAIN};`)
    expect(code).toContain(`const POOL = ${POOL};`)
  })
})

describe('the FFT', () => {
  it('reverses bits as the shader does', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((i) => reverse(i, 3))).toEqual([0, 4, 2, 6, 1, 5, 3, 7])
    expect(reverse(1, 8)).toBe(128)
  })
  it('is the DFT, for a random sequence of every length up to 64', () => {
    const rand = lcg(3)
    for (const n of [2, 4, 8, 16, 32, 64]) {
      const re = Array.from({ length: n }, () => rand() - 0.5)
      const im = Array.from({ length: n }, () => rand() - 0.5)
      const [wr, wi] = dft(re, im)
      const r = Float64Array.from(re)
      const i = Float64Array.from(im)
      fft(r, i)
      for (let k = 0; k < n; k++) {
        expect(r[k]).toBeCloseTo(wr[k], 10)
        expect(i[k]).toBeCloseTo(wi[k], 10)
      }
    }
  })
  it('comes back where it started, in two dimensions, and keeps the energy (Parseval)', () => {
    const rand = lcg(4)
    const n = 32
    const re = Float64Array.from({ length: n * n }, () => rand() - 0.5)
    const im = new Float64Array(n * n)
    const was = re.slice()
    const energy = re.reduce((s, x) => s + x * x, 0)
    fft2(re, im, n)
    const spectral = re.reduce((s, x, k) => s + x * x + im[k] * im[k], 0) / (n * n)
    expect(spectral).toBeCloseTo(energy, 9)
    fft2(re, im, n, true)
    for (let k = 0; k < n * n; k++) {
      expect(re[k]).toBeCloseTo(was[k], 12)
      expect(im[k]).toBeCloseTo(0, 12)
    }
  })
  it('reads its twiddles from a table that is e^(−2πij/N)', () => {
    const t = twiddles(8)
    expect([...t].map((x) => +x.toFixed(6))).toEqual(
      [1, 0, Math.SQRT1_2, -Math.SQRT1_2, 0, -1, -Math.SQRT1_2, -Math.SQRT1_2].map(
        (x) => +Math.fround(x).toFixed(6),
      ),
    )
  })
})

describe('the surface', () => {
  const n = 64
  const spectrumPeak = (u: Float64Array) => {
    const re = u.slice()
    const im = new Float64Array(n * n)
    fft2(re, im, n)
    let best = 0
    let at = 0
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        if (x === 0 && y === 0) continue
        const p = re[y * n + x] ** 2 + im[y * n + x] ** 2
        if (p > best) {
          best = p
          at = Math.hypot(wave(x, n), wave(y, n))
        }
      }
    return at
  }
  const noise = (seed: number) => {
    const rand = lcg(seed)
    return Float64Array.from({ length: n * n }, () => (rand() - 0.5) * 0.02)
  }
  const rms = (u: Float64Array) => Math.sqrt(u.reduce((s, x) => s + x * x, 0) / u.length)

  it('damps every mode but the chosen wavelength, which it leaves alone', () => {
    expect(damping(K0, 0, 0.3)).toBe(1)
    expect(damping(0, K0, 0.3)).toBe(1)
    expect(damping(K0 * 0.6, K0 * 0.8, 0.3)).toBeCloseTo(1, 12)
    expect(damping(0, 0, 0.3)).toBeLessThan(1)
    expect(damping(K0 * 2, 0, 0.3)).toBeLessThan(damping(K0 * 1.2, 0, 0.3))
  })

  it('goes flat where there is no field, however rough it starts', () => {
    const u = noise(5)
    const r = new Float64Array(n * n).fill(growth(0))
    for (let k = 0; k < 120; k++) stepSH(u, r, n, 0.3)
    expect(rms(u)).toBeLessThan(1e-4)
  })

  it('rises into a pattern at its own wavelength under a field, from noise', () => {
    const u = noise(6)
    const r = new Float64Array(n * n).fill(growth(1))
    for (let k = 0; k < 400; k++) stepSH(u, r, n, 0.3)
    expect(rms(u)).toBeGreaterThan(0.2)
    // the dominant spatial frequency is k₀ to within a grid's step
    expect(Math.abs(spectrumPeak(u) - K0)).toBeLessThan((2 * Math.PI) / n)
  })

  it('makes upward spikes, not pits: with g > 0 the peaks stand twice as far up as the troughs go down', () => {
    const shape = (g: number) => {
      const u = noise(7)
      const r = new Float64Array(n * n).fill(growth(1))
      for (let k = 0; k < 400; k++) stepSH(u, r, n, 0.3, g)
      const m = u.reduce((s, x) => s + x, 0) / u.length
      const sd = Math.sqrt(u.reduce((s, x) => s + (x - m) ** 2, 0) / u.length)
      return {
        skew: u.reduce((s, x) => s + (x - m) ** 3, 0) / u.length / sd ** 3,
        upDown: (Math.max(...u) - m) / (m - Math.min(...u)),
      }
    }
    // hexagons of spikes: three waves at 120° sum to +3 at a peak and −1.5 at worst, a ratio of 2
    const hex = shape(G)
    expect(hex.skew).toBeGreaterThan(0.5)
    expect(hex.upDown).toBeGreaterThan(1.6)
    // with no quadratic term it is stripes, as far down as up
    const stripes = shape(0)
    expect(Math.abs(stripes.skew)).toBeLessThan(0.1)
    expect(stripes.upDown).toBeLessThan(1.15)
  })

  it('is stable: a large step on a strong field does not blow up', () => {
    const u = noise(8)
    const r = new Float64Array(n * n).fill(growth(1.5))
    for (let k = 0; k < 200; k++) stepSH(u, r, n, 0.6)
    expect(Number.isFinite(rms(u))).toBe(true)
    expect(Math.max(...u.map(Math.abs))).toBeLessThan(3)
  })
})

describe('magnets', () => {
  it('pull hardest straight above, falling away like a dipole, and add up', () => {
    const m = { x: 100, y: 100, s: 1 }
    expect(field(100, 100, [m])).toBe(1)
    expect(field(100 + REACH, 100, [m])).toBeCloseTo(2 ** -1.5, 12)
    expect(field(100, 100 + REACH * 3, [m])).toBeLessThan(0.04)
    expect(field(130, 100, [m, { ...m, x: 160 }])).toBeCloseTo(
      field(130, 100, [m]) + field(130, 100, [{ ...m, x: 160 }]),
      12,
    )
  })
  it('need a real field to raise spikes: none at rest, some under a held magnet', () => {
    expect(growth(0)).toBeLessThan(0)
    expect(growth(1)).toBeCloseTo(0.25, 12)
    // the threshold, where the surface stops being flat
    expect(growth(-R_REST / R_GAIN)).toBeCloseTo(0, 12)
  })
  it('gather over about a second while held, and let go faster', () => {
    let s = 0
    for (let k = 0; k < 30; k++) s = ramp(s, true, 1 / 60)
    expect(s).toBeGreaterThan(0.45)
    expect(s).toBeLessThan(0.6)
    for (let k = 0; k < 60; k++) s = ramp(s, true, 1 / 60)
    expect(s).toBeGreaterThan(0.9)
    let off = s
    for (let k = 0; k < 30; k++) off = ramp(off, false, 1 / 60)
    expect(off).toBeLessThan(s * 0.3)
  })
  it('hear the bass, not the treble', () => {
    const low = new Uint8Array(1024)
    low.fill(255, 0, 12)
    const high = new Uint8Array(1024)
    high.fill(255, 200, 400)
    expect(bass(low)).toBe(1)
    expect(bass(high)).toBe(0)
    expect(bass(new Uint8Array(0))).toBe(0)
  })
})

describe('the pool', () => {
  it('is a puddle in the middle of the dish with no magnet, and dry at the edge', () => {
    expect(pool(N / 2, N / 2, [])).toBe(1)
    expect(pool(N / 2 + N * POOL - 12, N / 2, [])).toBe(1)
    expect(pool(N / 2 + N * POOL + 1, N / 2, [])).toBe(0)
    expect(pool(10, 10, [])).toBe(0)
  })
  it('is drawn out toward a magnet past its edge, and not one held far away', () => {
    const near = { x: N / 2 + N * POOL + 20, y: N / 2, s: 1 }
    expect(pool(near.x, near.y, [near])).toBe(1)
    const far = { x: 10, y: 10, s: 0.2 }
    expect(pool(far.x, far.y, [far])).toBe(0)
  })
  it('stirs with a noise that is a fixed function of the cell and the frame, 0..1', () => {
    const a = noiseAt(10, 20, 3)
    expect(noiseAt(10, 20, 3)).toBe(a)
    expect(noiseAt(10, 20, 4)).not.toBe(a)
    let sum = 0
    for (let k = 0; k < 4096; k++) {
      const v = noiseAt(k % 64, k >> 6, 9)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
      sum += v
    }
    expect(sum / 4096).toBeCloseTo(0.5, 1)
  })
})
