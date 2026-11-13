import { harmonyAbove } from '../audio/lyrics'
import { planLine, type Note } from './line'
import { mixdown, wav, type Voice } from './mix'
import { analyse, singLine, type Spoken, type Style } from './sing'

/**
 * The singer demo page (singer-demo.html): type lyrics, hear a neural voice sing them on a melody.
 *
 * ⚠️ THROWAWAY, AND DELIBERATELY OUTSIDE THE APP. Nothing imports this; the page is served by the
 * dev server and is not a build input, so the site's bundle does not change. Nothing is saved.
 *
 * ⚠️ THE VOICE LOADS FROM A CDN AT RUN TIME, NOT FROM package.json. kokoro-js (Apache-2.0) and the
 * Kokoro-82M weights (Apache-2.0, ~92MB at q8, fetched from Hugging Face once and then cached by
 * the browser) are the demo's only outside pieces, and no dependency was added for them. No
 * account, no key, and the lyrics never leave the browser — only static files come in.
 */

const KOKORO = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js'
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX'

type Raw = { audio: Float32Array; sampling_rate: number }
type Tts = { generate(text: string, o: { voice: string; speed?: number }): Promise<Raw> }
type Progress = { status: string; file?: string; progress?: number }
type KokoroModule = {
  KokoroTTS: {
    from_pretrained(
      id: string,
      o: { dtype: string; device: string; progress_callback?: (p: Progress) => void },
    ): Promise<Tts>
  }
}

declare global {
  interface Window {
    /** what the last render made and how long each stage took — read by whoever is measuring */
    __singer?: {
      wav: Blob | null
      timings: Record<string, number>
      settings: Record<string, unknown>
      /** the dry lead and the notes it was asked for, so a probe can check it is in tune */
      lead: Float32Array
      sr: number
      sung: { t: number; end: number; pitches: { at: number; midi: number }[] }[]
      /** each word as analysed, and how long the voice took to say each one */
      spoken: Spoken[]
      perWord: { word: string; ms: number }[]
    }
  }
}

/** two lines of seven notes in A minor, in beats; Am–F–C–G underneath */
const MELODY: Note[] = [
  { t: 0, dur: 0.5, midi: 69 },
  { t: 0.5, dur: 0.5, midi: 67 },
  { t: 1, dur: 0.5, midi: 64 },
  { t: 1.5, dur: 0.5, midi: 64 },
  { t: 2, dur: 1, midi: 67 },
  { t: 3, dur: 1, midi: 69 },
  { t: 4, dur: 1.5, midi: 64 },
  { t: 8, dur: 0.5, midi: 72 },
  { t: 8.5, dur: 0.5, midi: 71 },
  { t: 9, dur: 1, midi: 69 },
  { t: 10, dur: 0.5, midi: 67 },
  { t: 10.5, dur: 1.5, midi: 69 },
  { t: 12, dur: 1, midi: 71 },
  { t: 13, dur: 2, midi: 69 },
]
const MINOR = [0, 2, 3, 5, 7, 8, 10]
const A = 9

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const say = (s: string) => ($('status').textContent = s)

let model: Promise<Tts> | null = null
const spokenWords = new Map<string, Spoken>()

function voiceModel(): Promise<Tts> {
  model ??= (async () => {
    const mod = (await import(/* @vite-ignore */ KOKORO)) as KokoroModule
    const files = new Map<string, number>()
    return mod.KokoroTTS.from_pretrained(MODEL, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (p) => {
        if (p.status !== 'progress' || !p.file) return
        files.set(p.file, p.progress ?? 0)
        say(`Loading the voice (about 90 MB, once)… ${Math.round(Math.min(...files.values()))}%`)
      },
    })
  })()
  model.catch(() => (model = null))
  return model
}

async function sing() {
  const button = $<HTMLButtonElement>('sing')
  button.disabled = true
  const timings: Record<string, number> = {}
  try {
    const t0 = performance.now()
    const voice = $<HTMLSelectElement>('voice').value
    const hard = $<HTMLSelectElement>('tune').value === 'hard'
    const formant = Number($<HTMLSelectElement>('formant').value)
    const transpose = Number($<HTMLSelectElement>('key').value)
    const bpm = Math.min(170, Math.max(70, Number($<HTMLInputElement>('bpm').value) || 120))
    const beat = 60 / bpm
    const lyric = $<HTMLTextAreaElement>('lyric').value
    const doubled = $<HTMLInputElement>('double').checked
    const harmony = $<HTMLInputElement>('harmony').checked
    const stutter = $<HTMLInputElement>('stutter').checked
    const withBeat = $<HTMLInputElement>('beat').checked

    const notes = MELODY.map((n) => ({ t: n.t * beat, dur: n.dur * beat, midi: n.midi }))
    const plan = planLine(lyric, notes)
    if (!plan.words.length) return say('Type some words first.')

    const tts = await voiceModel()
    timings.load = performance.now() - t0

    const t1 = performance.now()
    const spoken: Spoken[] = []
    const perWord: { word: string; ms: number }[] = []
    for (const w of plan.words) {
      const key = `${voice}|${w.text}|${w.syllables}`
      let s = spokenWords.get(key)
      if (!s) {
        say(`Speaking “${w.text}”…`)
        const tw = performance.now()
        const raw = await tts.generate(w.text, { voice })
        perWord.push({ word: w.text, ms: Math.round(performance.now() - tw) })
        s = analyse(raw.audio, raw.sampling_rate, w.syllables)
        spokenWords.set(key, s)
      }
      spoken.push(s)
    }
    timings.speak = performance.now() - t1

    say('Singing…')
    const t2 = performance.now()
    const base: Style = { hard, vibrato: !hard, formant, transpose, cents: 0, stutter }
    const voices: Voice[] = [
      { buf: singLine(plan.sung, spoken, base, beat), gain: 1, pan: doubled ? -0.25 : 0, delay: 0 },
    ]
    if (doubled)
      voices.push({
        buf: singLine(plan.sung, spoken, { ...base, cents: 9, formant: formant * 1.02 }, beat),
        gain: 0.75,
        pan: 0.25,
        delay: 0.014,
      })
    if (harmony) {
      const up = plan.sung.map((s) => ({
        ...s,
        pitches: s.pitches.map((p) => ({ ...p, midi: harmonyAbove(p.midi, MINOR, A) })),
      }))
      voices.push({
        buf: singLine(up, spoken, { ...base, stutter: false }, beat),
        gain: 0.42,
        pan: 0,
        delay: 0,
      })
    }
    timings.sing = performance.now() - t2

    const t3 = performance.now()
    const mixed = await mixdown({ voices, vsr: spoken[0].sr, beat, bars: 4, transpose, withBeat })
    let peak = 0
    for (let c = 0; c < mixed.numberOfChannels; c++)
      for (const v of mixed.getChannelData(c)) peak = Math.max(peak, Math.abs(v))
    if (peak > 0)
      for (let c = 0; c < mixed.numberOfChannels; c++) {
        const d = mixed.getChannelData(c)
        for (let i = 0; i < d.length; i++) d[i] *= 0.89 / peak
      }
    timings.mix = performance.now() - t3

    const blob = wav(mixed)
    const audio = $<HTMLAudioElement>('out')
    if (audio.src) URL.revokeObjectURL(audio.src)
    audio.src = URL.createObjectURL(blob)
    timings.total = performance.now() - t0
    window.__singer = {
      wav: blob,
      timings,
      settings: {
        voice,
        hard,
        formant,
        transpose,
        bpm,
        lyric,
        doubled,
        harmony,
        stutter,
        withBeat,
      },
      lead: voices[0].buf,
      sr: spoken[0].sr,
      sung: plan.sung.map((s) => ({
        ...s,
        pitches: s.pitches.map((p) => ({ ...p, midi: p.midi + transpose })),
      })),
      spoken,
      perWord,
    }
    const fresh = plan.words.length
    say(
      `Sung. Words: ${fresh} · speaking ${(timings.speak / 1000).toFixed(1)}s · singing ` +
        `${(timings.sing / 1000).toFixed(1)}s · mix ${(timings.mix / 1000).toFixed(1)}s` +
        (plan.spare ? ` · ${plan.spare} syllables did not fit the melody` : ''),
    )
    await audio.play().catch(() => undefined)
  } catch (e) {
    say(`Could not sing: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    button.disabled = false
  }
}

$('sing').addEventListener('click', () => void sing())
