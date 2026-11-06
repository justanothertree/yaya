import { describe, expect, it } from 'vitest'
import code from './voiceprint.wgsl?raw'
import {
  COLUMNS,
  FFT,
  HIGH,
  LOW,
  PRINT,
  ROWS,
  columnOf,
  fft,
  hzRow,
  packPrint,
  rowHz,
  startingPrint,
  synth,
} from './voiceprint'
import { wgslLayout } from './wgslLayout'

function lcg(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

describe('the shader and this file describe one voiceprint', () => {
  const wgsl = wgslLayout(code, 'Print')

  it('agrees about where every field of the uniform lives', () => {
    const { bytes, perColumn, ...rest } = PRINT
    expect(wgsl.offsets).toEqual({ ...rest, per_column: perColumn })
    expect(wgsl.bytes).toBe(bytes)
  })

  it('writes every field where the shader will look for it', () => {
    const v = new DataView(
      packPrint({
        w: 640,
        h: 480,
        head: 77,
        rate: 48000,
        from: 4800,
        dabs: 3,
        playing: true,
        playhead: 12.5,
      }),
    )
    const u = (k: string, i = 0) => v.getUint32(wgsl.offsets[k] + 4 * i, true)
    const f = (k: string) => v.getFloat32(wgsl.offsets[k], true)
    expect([
      u('size'),
      u('size', 1),
      u('columns'),
      u('rows'),
      u('head'),
      u('per_column'),
      u('first'),
      u('dabs'),
      u('playing'),
    ]).toEqual([640, 480, COLUMNS, ROWS, 77, 800, 4800, 3, 1])
    expect([f('rate'), f('playhead')]).toEqual([48000, 12.5])
  })

  it('spaces its rows from the same lowest to the same highest pitch', () => {
    const num = (name: string) => Number(new RegExp(`const ${name} = ([\\d.]+)`).exec(code)?.[1])
    expect([num('LOW'), num('HIGH'), num('FFT')]).toEqual([LOW, HIGH, FFT])
  })
})

describe('the transform', () => {
  it('is the Fourier sum, done fast', () => {
    const rand = lcg(3)
    const n = 64
    const x = Array.from({ length: n }, () => rand() * 2 - 1)
    const re = Float64Array.from(x)
    const im = new Float64Array(n)
    fft(re, im)
    for (let k = 0; k < n; k++) {
      let sr = 0
      let si = 0
      for (let t = 0; t < n; t++) {
        sr += x[t] * Math.cos((-2 * Math.PI * k * t) / n)
        si += x[t] * Math.sin((-2 * Math.PI * k * t) / n)
      }
      expect(re[k]).toBeCloseTo(sr, 9)
      expect(im[k]).toBeCloseTo(si, 9)
    }
  })

  it('keeps every bit of the energy (Parseval)', () => {
    const rand = lcg(5)
    const re = Float64Array.from({ length: FFT }, () => rand() - 0.5)
    const energy = re.reduce((s, x) => s + x * x, 0)
    const im = new Float64Array(FFT)
    fft(re, im)
    let spectral = 0
    for (let k = 0; k < FFT; k++) spectral += re[k] ** 2 + im[k] ** 2
    expect(spectral / FFT).toBeCloseTo(energy, 6)
  })

  it('hears a tuning fork on the row of its pitch, at about full loudness', () => {
    const rate = 48000
    for (const hz of [220, 440, 1000, 3000]) {
      const samples = Array.from({ length: FFT }, (_, i) => Math.sin((2 * Math.PI * hz * i) / rate))
      const col = columnOf(samples, rate)
      const loudest = col.indexOf(Math.max(...col))
      expect(Math.abs(loudest - hzRow(hz)), `${hz} Hz`).toBeLessThan(3)
      expect(Math.max(...col)).toBeGreaterThan(0.8)
      expect(Math.max(...col)).toBeLessThan(1.15)
    }
  })
})

describe('the rows', () => {
  it('run from LOW to HIGH, evenly in pitch: each octave the same number of rows', () => {
    expect(rowHz(0)).toBeCloseTo(LOW, 9)
    expect(rowHz(ROWS - 1)).toBeCloseTo(HIGH, 6)
    const perOctave = hzRow(880) - hzRow(440)
    expect(hzRow(1760) - hzRow(880)).toBeCloseTo(perOctave, 9)
    expect(hzRow(rowHz(100))).toBeCloseTo(100, 9)
  })
})

describe('playing it', () => {
  const rate = 8000

  it('plays a level stroke as a pure note of its row’s pitch', () => {
    const p = new Float32Array(4 * ROWS)
    const row = Math.round(hzRow(440))
    for (let c = 0; c < 4; c++) p[c * ROWS + row] = 0.8
    const out = synth(p, 4, rate)
    // count the zero crossings: a sine crosses twice a cycle
    let crossings = 0
    for (let i = 1; i < out.length; i++)
      if (Math.sign(out[i]) !== Math.sign(out[i - 1])) crossings++
    const seconds = out.length / rate
    expect(crossings / 2 / seconds).toBeCloseTo(rowHz(row), -1)
  })

  it('never jumps between columns: the phase belongs to the time, not the column', () => {
    const p = new Float32Array(3 * ROWS)
    const row = Math.round(hzRow(300))
    p[0 * ROWS + row] = 0.8
    p[1 * ROWS + row] = 0.8
    p[2 * ROWS + row] = 0.8
    const whole = synth(p, 3, rate)
    // rendering the middle stretch alone gives the same samples as the whole
    const per = Math.round(rate / 60)
    const part = synth(p, 3, rate, per, per)
    for (let i = 0; i < per; i++) expect(part[i]).toBeCloseTo(whole[per + i], 9)
    // and from one sample to the next it moves by no more than a sine at that pitch can
    let jump = 0
    for (let i = 1; i < whole.length; i++) jump = Math.max(jump, Math.abs(whole[i] - whole[i - 1]))
    expect(jump).toBeLessThanOrEqual(0.64 * 2 * Math.PI * (rowHz(row) / rate) * 1.01)
  })

  it('is silent where the picture is dark', () => {
    expect(synth(new Float32Array(2 * ROWS), 2, rate).every((x) => x === 0)).toBe(true)
  })

  it('starts with a tune to play', () => {
    const p = startingPrint()
    expect(p.filter((x) => x > 0.3).length).toBeGreaterThan(400)
    expect(p.length).toBe(COLUMNS * ROWS)
  })
})
