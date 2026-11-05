import { describe, expect, it } from 'vitest'
import code from './music.wgsl?raw'
import {
  BANDS,
  BASS_BANDS,
  HIGH_HZ,
  LOW_HZ,
  MUSIC,
  QUIET,
  bandEdges,
  beat,
  ease,
  foldBands,
  foldWave,
  packMusic,
  type MusicParams,
} from './music'
import { wgslLayout } from './wgslLayout'

describe('the uniform the shader reads is the one JavaScript writes', () => {
  const wgsl = wgslLayout(code, 'Music')

  it('agrees with the shader about where every field lives', () => {
    const { bytes, ...table } = MUSIC
    expect(wgsl.offsets).toEqual(table)
    expect(wgsl.bytes).toBe(bytes)
  })

  it('writes every field where the shader will look for it', () => {
    const p: MusicParams = {
      aspect: 1.5,
      spin: 0.25,
      zoom: 1.125,
      decay: 0.875,
      time: 12.5,
      level: 0.375,
      mode: 1,
      bands: 96,
      wave: 256,
      kick: 0.625,
    }
    const v = new DataView(packMusic(p))
    const f = (n: string) => v.getFloat32(wgsl.offsets[n], true)
    const u = (n: string) => v.getUint32(wgsl.offsets[n], true)
    expect(['aspect', 'spin', 'zoom', 'decay', 'time', 'level', 'kick'].map(f)).toEqual([
      1.5, 0.25, 1.125, 0.875, 12.5, 0.375, 0.625,
    ])
    expect(['mode', 'bands', 'wave'].map(u)).toEqual([1, 96, 256])
  })
})

describe('bands', () => {
  const edges = bandEdges(BANDS)

  it('span the range with every band the same musical width', () => {
    expect(edges[0]).toBeCloseTo(LOW_HZ, 9)
    expect(edges[BANDS]).toBeCloseTo(HIGH_HZ, 6)
    const ratio = edges[1] / edges[0]
    for (let i = 1; i < BANDS; i++) expect(edges[i + 1] / edges[i]).toBeCloseTo(ratio, 9)
  })

  it('give the bottom octave as many bands as the top one', () => {
    const inOctave = (lo: number) => edges.filter((e) => e >= lo && e < lo * 2).length
    expect(Math.abs(inOctave(LOW_HZ) - inOctave(HIGH_HZ / 2))).toBeLessThanOrEqual(1)
  })

  /** a byte spectrum with one loud bin at `hz` — the shape a pure tone makes */
  const tone = (hz: number, rate = 48000, fft = 2048) => {
    const s = new Uint8Array(fft / 2)
    s[Math.round(hz / (rate / fft))] = 255
    return s
  }

  it('put a tone in the band whose range holds its pitch, for bass, middle and treble', () => {
    for (const hz of [60, 440, 3000, 12000]) {
      const b = foldBands(tone(hz), 48000, 2048, edges)
      const loudest = b.indexOf(Math.max(...b))
      const binHz = Math.round(hz / (48000 / 2048)) * (48000 / 2048)
      // the band that lit up contains the bin's own frequency
      expect(edges[loudest]).toBeLessThanOrEqual(binHz + 48000 / 2048)
      expect(edges[loudest + 1]).toBeGreaterThanOrEqual(binHz - 48000 / 2048)
      expect(b[loudest]).toBe(1)
    }
  })

  it('reads silence as silence', () => {
    expect(Math.max(...foldBands(new Uint8Array(1024), 48000, 2048, edges))).toBe(0)
  })
})

describe('motion', () => {
  it('rises to a hit faster than it falls away from one', () => {
    const up = ease(0, 1, 1 / 60)
    const down = 1 - ease(1, 0, 1 / 60)
    expect(up).toBeGreaterThan(down * 3)
  })

  it('gets where it is going, given time', () => {
    let v = 0
    for (let i = 0; i < 120; i++) v = ease(v, 0.8, 1 / 60)
    expect(v).toBeCloseTo(0.8, 6)
  })

  it('reads a byte waveform as -1..1 around silence', () => {
    const w = foldWave(new Uint8Array([128, 255, 0, 128]), 4)
    expect([...w].map((x) => Math.round(x * 100) / 100)).toEqual([0, 0.99, -1, 0])
  })
})

describe('the beat', () => {
  /** run a bass signal through the detector at 60 fps, returning when the hits landed */
  const hits = (signal: (t: number) => number, seconds: number) => {
    let state = QUIET
    const at: number[] = []
    for (let i = 0; i < seconds * 60; i++) {
      const t = i / 60
      const b = beat(state, signal(t), 1 / 60)
      state = b.state
      if (b.hit) at.push(t)
    }
    return at
  }
  /**
   * A kick drum at `bpm` AS THE ANALYSER REPORTS IT — the shape measured off the site's own music
   * analyser playing a 120 BPM kick: up from 0.75 to 0.99 in about 50 ms, then sagging back to 0.72
   * by the next one. It never goes near zero, because the bands are decibels and smoothed; a fixture
   * that dropped to silence between kicks is what let a detector that could not work pass.
   */
  const kicks = (bpm: number) => (t: number) => {
    const period = 60 / bpm
    const into = t % period
    return into < 0.05
      ? 0.75 + 0.24 * (into / 0.05)
      : 0.99 - 0.27 * ((into - 0.05) / (period - 0.05))
  }
  /** the same kick as an idealised drum, quiet between hits */
  const clean = (bpm: number) => (t: number) => 0.1 + 0.8 * Math.exp(-(t % (60 / bpm)) / 0.05)

  it('finds every kick at 120 BPM as the analyser reports it, and nothing between them', () => {
    const at = hits(kicks(120), 4)
    expect(at).toHaveLength(8)
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeCloseTo(0.5, 1)
  })

  it('finds them in an idealised drum too', () => {
    expect(hits(clean(120), 4)).toHaveLength(8)
  })

  it('keeps up with a fast kick at 174 BPM', () => {
    expect(hits(kicks(174), 4).length).toBeGreaterThanOrEqual(11)
  })

  it('does not hear a beat in a held bass note', () => {
    const at = hits(() => 0.8, 4)
    // the note's own arrival is a beat; holding it is not
    expect(at.filter((t) => t > 0.5)).toHaveLength(0)
  })

  it('does not hear a beat in a held note with vibrato', () => {
    // a real held note is never flat: it wobbles, and every wobble upward is a small rise
    const at = hits((t) => 0.8 + 0.02 * Math.sin(t * 2 * Math.PI * 5), 4)
    expect(at.filter((t) => t > 0.5)).toHaveLength(0)
  })

  it('does not hear a beat in music that only swells', () => {
    // the sound's arrival out of silence is a beat; the swell after it is not
    expect(hits((t) => 0.3 + 0.15 * t, 4).filter((t) => t > 0.5)).toHaveLength(0)
  })

  it('does not hear a beat in near-silence, however it flickers', () => {
    expect(hits((t) => 0.05 + 0.05 * Math.sin(t * 40), 4)).toHaveLength(0)
  })

  it('listens to the bass and only the bass', () => {
    expect(bandEdges(BANDS)[BASS_BANDS]).toBeGreaterThan(110)
    expect(bandEdges(BANDS)[BASS_BANDS - 1]).toBeLessThanOrEqual(110)
  })
})
