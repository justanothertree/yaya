import { harmonyAbove, splitLyrics } from '../audio/lyrics'
import { fitSyllables } from '../audio/pocket'
import { PRESETS, liveSingers, singInto, type PresetId } from '../audio/singer'

/**
 * The singer on its own page (singer-preview.html): the instrument room's voice, a fixed melody
 * and a small beat, so it can be heard on a phone without opening the room or loading a song.
 *
 * ⚠️ THE SAME `singInto` THE ROOM CALLS, into this page's own AudioContext — nothing here is a
 * second voice. It is a dev-server page, not a build input, and nothing is saved.
 */

/** two lines of seven notes in A minor, in beats; Am–F–C–G underneath */
const MELODY: [number, number, number][] = [
  [0, 0.5, 69],
  [0.5, 0.5, 67],
  [1, 0.5, 64],
  [1.5, 0.5, 64],
  [2, 1, 67],
  [3, 1, 69],
  [4, 1.5, 64],
  [8, 0.5, 72],
  [8.5, 0.5, 71],
  [9, 1, 69],
  [10, 0.5, 67],
  [10.5, 1.5, 69],
  [12, 1, 71],
  [13, 2, 69],
]
const CHORDS = [
  { pad: [57, 60, 64], bass: 45 },
  { pad: [57, 60, 65], bass: 41 },
  { pad: [55, 60, 64], bass: 48 },
  { pad: [55, 59, 62], bass: 43 },
]
const MINOR = [0, 2, 3, 5, 7, 8, 10]
const BARS = 4

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const hz = (m: number) => 440 * 2 ** ((m - 69) / 12)

let ctx: AudioContext | null = null
let master: GainNode | null = null
let vocal: GainNode | null = null
let playing: { stop(): void; timer: number } | null = null
let preset: PresetId = 'clean'
let double = false
let harmony = false
let beat = true

function audio() {
  if (ctx && master && vocal) return { c: ctx, master, vocal }
  const c = new AudioContext()
  const limiter = c.createDynamicsCompressor()
  limiter.threshold.value = -6
  limiter.ratio.value = 12
  limiter.connect(c.destination)
  const m = c.createGain()
  m.gain.value = 1.4
  m.connect(limiter)
  /* a short room for the voice, made from noise here like everything else */
  const verb = c.createConvolver()
  const n = Math.round(c.sampleRate * 1.8)
  const ir = c.createBuffer(2, n, c.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch)
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp((-5 * i) / n)
  }
  verb.buffer = ir
  const wet = c.createGain()
  wet.gain.value = 0.22
  verb.connect(wet).connect(m)
  const v = c.createGain()
  v.connect(m)
  v.connect(verb)
  ctx = c
  master = m
  vocal = v
  return { c, master: m, vocal: v }
}

/** four bars of kick, clap, hats, plucked bass and pumping chords; returns a stop */
function backing(c: AudioContext, out: AudioNode, t0: number, spb: number): () => void {
  const bus = c.createGain()
  bus.gain.value = 0.55
  bus.connect(out)
  const sources: AudioScheduledSourceNode[] = []
  const noise = c.createBuffer(1, c.sampleRate, c.sampleRate)
  const nd = noise.getChannelData(0)
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1
  const hit = (t: number, type: BiquadFilterType, f: number, level: number, len: number) => {
    const s = c.createBufferSource()
    s.buffer = noise
    const flt = c.createBiquadFilter()
    flt.type = type
    flt.frequency.value = f
    const g = c.createGain()
    g.gain.setValueAtTime(level, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + len)
    s.connect(flt).connect(g).connect(bus)
    s.start(t)
    s.stop(t + len + 0.02)
    sources.push(s)
  }
  const tone = (
    t: number,
    f: number,
    type: OscillatorType,
    level: number,
    len: number,
    lp: number,
  ) => {
    const o = c.createOscillator()
    o.type = type
    o.frequency.value = f
    const flt = c.createBiquadFilter()
    flt.type = 'lowpass'
    flt.frequency.value = lp
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(level, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.001, t + len)
    o.connect(flt).connect(g).connect(bus)
    o.start(t)
    o.stop(t + len + 0.02)
    sources.push(o)
  }
  for (let bar = 0; bar < BARS; bar++) {
    const b0 = t0 + bar * 4 * spb
    const ch = CHORDS[bar % CHORDS.length]
    for (const k of [0, 2, 2.75]) {
      const o = c.createOscillator()
      const g = c.createGain()
      const t = b0 + k * spb
      o.frequency.setValueAtTime(150, t)
      o.frequency.exponentialRampToValueAtTime(48, t + 0.11)
      g.gain.setValueAtTime(0.8, t)
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3)
      o.connect(g).connect(bus)
      o.start(t)
      o.stop(t + 0.32)
      sources.push(o)
    }
    for (const k of [1, 3]) hit(b0 + k * spb, 'bandpass', 1800, 0.5, 0.16)
    for (let k = 0; k < 8; k++)
      hit(b0 + k * 0.5 * spb, 'highpass', 8000, k % 2 ? 0.08 : 0.13, 0.035)
    for (let k = 0; k < 8; k++)
      tone(b0 + k * 0.5 * spb, hz(ch.bass - 12), 'sawtooth', 0.22, 0.22, 700)
    for (let k = 0; k < 4; k++)
      for (const n of ch.pad) tone(b0 + k * spb + 0.04, hz(n), 'sawtooth', 0.035, spb * 0.9, 1800)
  }
  return () => {
    const now = c.currentTime
    for (const s of sources)
      try {
        s.stop(now)
      } catch {
        /* already stopped */
      }
    bus.disconnect()
  }
}

function syllables() {
  const spb = 60 / Number($<HTMLSelectElement>('bpm').value)
  const notes = MELODY.map(([t, d, m]) => ({ t: t * spb, dur: d * spb * 0.95, midi: m }))
  return {
    spb,
    ...fitSyllables(notes, splitLyrics($<HTMLTextAreaElement>('lyric').value), { beat: spb }),
  }
}

function showWords() {
  const { sung, spare } = syllables()
  $('words').textContent =
    sung.map((s) => (s.hold ? '~' : s.text)).join(' · ') +
    (spare ? ` — ${spare} left over, shorten the words` : '')
}

function stop() {
  if (!playing) return
  playing.stop()
  window.clearTimeout(playing.timer)
  playing = null
  render()
}

async function sing() {
  if (playing) return stop()
  const { c, master: m, vocal: v } = audio()
  await c.resume()
  const { spb, sung } = syllables()
  if (!sung.length) return
  const t0 = c.currentTime + 0.15
  const stopVoice = singInto(c, v, sung, t0, {
    preset,
    double,
    harmony: harmony ? (n) => harmonyAbove(n, MINOR, 9) : null,
    beat: spb,
    seed: Math.floor(Math.random() * 1e9),
    lead: 0.12,
  })
  const stopBeat = beat ? backing(c, m, t0, spb) : () => undefined
  const span = BARS * 4 * spb
  playing = {
    stop() {
      stopVoice()
      stopBeat()
    },
    timer: window.setTimeout(stop, (span + 0.6) * 1000),
  }
  render()
}

const ABOUT: Record<PresetId, string> = {
  clean: 'A plain voice with a light vibrato on long notes.',
  breathy: 'Soft and airy, with a slower, wider vibrato.',
  glitchy: 'Hard tune, a light stutter and a little grit.',
}

function render() {
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-preset]'))
    b.setAttribute('aria-pressed', String(b.dataset.preset === preset))
  $('double').setAttribute('aria-pressed', String(double))
  $('harmony').setAttribute('aria-pressed', String(harmony))
  $('beat').setAttribute('aria-pressed', String(beat))
  $('sing').textContent = playing ? '■ Stop' : '▶ Sing'
  $('about').textContent = ABOUT[preset]
}

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-preset]'))
  b.addEventListener('click', () => {
    preset = b.dataset.preset as PresetId
    double = preset !== 'clean'
    render()
  })
$('double').addEventListener('click', () => {
  double = !double
  render()
})
$('harmony').addEventListener('click', () => {
  harmony = !harmony
  render()
})
$('beat').addEventListener('click', () => {
  beat = !beat
  render()
})
$('sing').addEventListener('click', () => void sing())
$('lyric').addEventListener('input', showWords)
$('bpm').addEventListener('change', showWords)
for (const id of Object.keys(PRESETS) as PresetId[]) {
  const b = document.querySelector<HTMLButtonElement>(`[data-preset="${id}"]`)
  if (b) b.textContent = PRESETS[id].name
}
showWords()
render()

/* for whoever is measuring: how many voices are alive right now */
Object.assign(window, { __singerLive: liveSingers })
