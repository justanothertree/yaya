/**
 * The demo's mixdown: the sung voices through a vocal chain (low cut, air, compression, a reverb
 * and a dotted-eighth echo) over a small glitchpop loop — kick, clap, hats, a plucked bass and
 * pumping chords, Am–F–C–G. Rendered offline, so what plays is exactly what was rendered.
 *
 * ⚠️ THROWAWAY DEMO. The backing exists so the voice is heard in a song rather than on its own;
 * nothing about it is meant to reach the instrument room.
 */

export type Voice = { buf: Float32Array; gain: number; pan: number; delay: number }

export type MixIn = {
  voices: Voice[]
  /** the voices' own sample rate */
  vsr: number
  /** seconds per beat */
  beat: number
  bars: number
  transpose: number
  withBeat: boolean
}

const CHORDS = [
  { pad: [57, 60, 64], bass: 45 },
  { pad: [57, 60, 65], bass: 41 },
  { pad: [55, 60, 64], bass: 48 },
  { pad: [55, 59, 62], bass: 43 },
]

export async function mixdown(m: MixIn): Promise<AudioBuffer> {
  const sr = 44100
  const span = m.bars * 4 * m.beat
  const c = new OfflineAudioContext(2, Math.ceil((span + 2.2) * sr), sr)

  const master = c.createDynamicsCompressor()
  master.threshold.value = -8
  master.knee.value = 6
  master.ratio.value = 12
  master.attack.value = 0.003
  master.release.value = 0.15
  master.connect(c.destination)

  const verb = c.createConvolver()
  verb.buffer = impulse(c, 2.4)
  const verbOut = c.createGain()
  verbOut.gain.value = 0.3
  verb.connect(verbOut).connect(master)

  const echo = c.createDelay(2)
  echo.delayTime.value = m.beat * 0.75
  const echoTone = c.createBiquadFilter()
  echoTone.type = 'lowpass'
  echoTone.frequency.value = 3200
  const feedback = c.createGain()
  feedback.gain.value = 0.3
  echo.connect(echoTone).connect(feedback).connect(echo)
  const echoOut = c.createGain()
  echoOut.gain.value = 0.2
  echoTone.connect(echoOut).connect(master)

  const bus = c.createGain()
  const lowCut = c.createBiquadFilter()
  lowCut.type = 'highpass'
  lowCut.frequency.value = 140
  const air = c.createBiquadFilter()
  air.type = 'highshelf'
  air.frequency.value = 6000
  air.gain.value = 4
  const squash = c.createDynamicsCompressor()
  squash.threshold.value = -24
  squash.ratio.value = 4
  squash.attack.value = 0.005
  squash.release.value = 0.12
  const vocal = c.createGain()
  vocal.gain.value = 2.2
  bus.connect(lowCut).connect(air).connect(squash).connect(vocal)
  vocal.connect(master)
  vocal.connect(verb)
  vocal.connect(echo)

  for (const v of m.voices) {
    if (!v.buf.length) continue
    const b = c.createBuffer(1, v.buf.length, m.vsr)
    b.copyToChannel(v.buf as Float32Array<ArrayBuffer>, 0)
    const s = c.createBufferSource()
    s.buffer = b
    const g = c.createGain()
    g.gain.value = v.gain
    const p = c.createStereoPanner()
    p.pan.value = v.pan
    s.connect(g).connect(p).connect(bus)
    s.start(v.delay)
  }

  if (m.withBeat) backing(c, master, m, verb)
  return c.startRendering()
}

function backing(c: OfflineAudioContext, out: AudioNode, m: MixIn, verb: AudioNode) {
  const noise = c.createBuffer(1, c.sampleRate, c.sampleRate)
  const d = noise.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  const B = m.beat
  const hz = (midi: number) => 440 * 2 ** ((midi + m.transpose - 69) / 12)

  const kick = (t: number) => {
    const o = c.createOscillator()
    o.frequency.setValueAtTime(150, t)
    o.frequency.exponentialRampToValueAtTime(48, t + 0.11)
    const g = c.createGain()
    g.gain.setValueAtTime(0.9, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.32)
    o.connect(g).connect(out)
    o.start(t)
    o.stop(t + 0.35)
  }
  const hiss = (t: number, type: BiquadFilterType, f: number, level: number, len: number) => {
    const s = c.createBufferSource()
    s.buffer = noise
    const bp = c.createBiquadFilter()
    bp.type = type
    bp.frequency.value = f
    const g = c.createGain()
    g.gain.setValueAtTime(level, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + len)
    s.connect(bp).connect(g).connect(out)
    if (type === 'bandpass') g.connect(verb)
    s.start(t, Math.random() * 0.5)
    s.stop(t + len + 0.02)
  }

  for (let bar = 0; bar < m.bars; bar++) {
    const t0 = bar * 4 * B
    const ch = CHORDS[bar % CHORDS.length]
    for (const k of [0, 2, 2.75]) kick(t0 + k * B)
    for (const k of [1, 3]) hiss(t0 + k * B, 'bandpass', 1800, 0.55, 0.18)
    for (let k = 0; k < 8; k++) hiss(t0 + k * 0.5 * B, 'highpass', 8000, k % 2 ? 0.1 : 0.16, 0.035)
    if (bar === m.bars - 1)
      for (let k = 0; k < 4; k++) hiss(t0 + (3 + k / 4) * B, 'highpass', 9000, 0.12, 0.03)

    /* the bass: eighth-note plucks on the root */
    for (let k = 0; k < 8; k++) {
      const t = t0 + k * 0.5 * B
      const o = c.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = hz(ch.bass - 12)
      const lp = c.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.setValueAtTime(900, t)
      lp.frequency.exponentialRampToValueAtTime(180, t + 0.2)
      const g = c.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.linearRampToValueAtTime(0.32, t + 0.008)
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.24)
      o.connect(lp).connect(g).connect(out)
      o.start(t)
      o.stop(t + 0.26)
    }

    /* the chords, ducked on every beat — the pump */
    const pad = c.createGain()
    pad.gain.setValueAtTime(0, t0)
    for (let k = 0; k < 4; k++) {
      pad.gain.setValueAtTime(0.25, t0 + k * B)
      pad.gain.linearRampToValueAtTime(1, t0 + k * B + B * 0.6)
    }
    pad.gain.setValueAtTime(1, t0 + 4 * B - 0.01)
    pad.gain.linearRampToValueAtTime(0, t0 + 4 * B + 0.05)
    const lp = c.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 2200
    pad.connect(lp).connect(out)
    lp.connect(verb)
    for (const n of ch.pad)
      for (const cents of [-8, 8]) {
        const o = c.createOscillator()
        o.type = 'sawtooth'
        o.frequency.value = hz(n)
        o.detune.value = cents
        const g = c.createGain()
        g.gain.value = 0.03
        o.connect(g).connect(pad)
        o.start(t0)
        o.stop(t0 + 4 * B + 0.1)
      }
  }
}

function impulse(c: BaseAudioContext, secs: number): AudioBuffer {
  const n = Math.round(secs * c.sampleRate)
  const b = c.createBuffer(2, n, c.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch)
    let lp = 0
    for (let i = 0; i < n; i++) {
      lp = 0.6 * lp + 0.4 * (Math.random() * 2 - 1)
      d[i] = lp * Math.exp((-4.5 * i) / n)
    }
  }
  return b
}

/** 16-bit PCM WAV, every channel interleaved */
export function wav(b: AudioBuffer): Blob {
  const ch = b.numberOfChannels
  const n = b.length
  const view = new DataView(new ArrayBuffer(44 + n * ch * 2))
  const str = (o: number, s: string) =>
    [...s].forEach((x, i) => view.setUint8(o + i, x.charCodeAt(0)))
  str(0, 'RIFF')
  view.setUint32(4, 36 + n * ch * 2, true)
  str(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, ch, true)
  view.setUint32(24, b.sampleRate, true)
  view.setUint32(28, b.sampleRate * ch * 2, true)
  view.setUint16(32, ch * 2, true)
  view.setUint16(34, 16, true)
  str(36, 'data')
  view.setUint32(40, n * ch * 2, true)
  const data = [...Array(ch)].map((_, i) => b.getChannelData(i))
  let o = 44
  for (let i = 0; i < n; i++)
    for (let k = 0; k < ch; k++) {
      const v = Math.max(-1, Math.min(1, data[k][i]))
      view.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true)
      o += 2
    }
  return new Blob([view.buffer], { type: 'audio/wav' })
}
