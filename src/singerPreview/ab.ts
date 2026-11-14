import * as afterLyrics from '../audio/lyrics'
import * as after from '../audio/singer'
import type { PresetId } from '../audio/singer'
import * as beforeLyrics from './before/lyrics'
import * as before from './before/singer'

/**
 * The singer A/B page (singer-ab.html): fixed lines sung by today's voice (A, frozen in ./before)
 * and the new one (B), on the same notes, the same seed and the same room, so the only difference
 * is the voice. Built to answer one question by ear in half a minute: can you make out the words?
 *
 * ⚠️ DEV-ONLY, like singer-preview.html: not a build input, nothing saved. Delete it and ./before
 * once the comparison is done.
 */

type Which = 'a' | 'b'
type Mode = 'sung' | 'spoken'

/** the lines, and a tune for each in beats: [start, length, midi] — one note per syllable */
const LINES: { text: string; tune: [number, number, number][] }[] = [
  {
    text: 'the cat sat on the mat',
    tune: [
      [0, 0.5, 64],
      [0.5, 0.5, 67],
      [1, 0.5, 69],
      [1.5, 0.5, 67],
      [2, 0.5, 64],
      [2.5, 1.5, 67],
    ],
  },
  {
    text: 'sixty six fish',
    tune: [
      [0, 0.5, 69],
      [0.5, 0.5, 67],
      [1, 1, 64],
      [2, 2, 67],
    ],
  },
  {
    text: 'we will meet at night',
    tune: [
      [0, 0.5, 64],
      [0.5, 0.5, 67],
      [1, 1, 69],
      [2, 0.5, 67],
      [2.5, 1.5, 72],
    ],
  },
  {
    text: 'play the drums and dance',
    tune: [
      [0, 1, 67],
      [1, 0.5, 64],
      [1.5, 1, 67],
      [2.5, 0.5, 69],
      [3, 1.5, 72],
    ],
  },
]
const BPM = 96
const SPB = 60 / BPM
/* what the room does: clean sings alone, the other two are doubled */
const DOUBLED: Record<PresetId, boolean> = { clean: false, breathy: true, glitchy: true }
const LABEL: Record<Which, string> = { a: 'A, now', b: 'B, new' }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

let preset: PresetId = 'clean'
let mode: Mode = 'sung'
let ctx: { c: AudioContext; out: AudioNode } | null = null
let playing: { stops: (() => void)[]; timers: number[] } | null = null

function audio() {
  if (ctx) return ctx
  const c = new AudioContext()
  const limiter = c.createDynamicsCompressor()
  limiter.threshold.value = -6
  limiter.ratio.value = 12
  limiter.connect(c.destination)
  const master = c.createGain()
  master.gain.value = 1.4
  master.connect(limiter)
  /* a little room, as the instrument room gives the voice — made from noise like everything else */
  const verb = c.createConvolver()
  const n = Math.round(c.sampleRate * 1.2)
  const ir = c.createBuffer(2, n, c.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch)
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp((-6 * i) / n)
  }
  verb.buffer = ir
  const wet = c.createGain()
  wet.gain.value = 0.15
  verb.connect(wet).connect(master)
  const out = c.createGain()
  out.connect(master)
  out.connect(verb)
  ctx = { c, out }
  return ctx
}

/** the notes a line is sung on — its tune, or one quick syllable each on a falling, spoken line */
function notesOf(line: number) {
  if (mode === 'sung')
    return LINES[line].tune.map(([t, d, m]) => ({ t: t * SPB, dur: d * SPB * 0.95, midi: m }))
  const n = LINES[line].tune.length
  return Array.from({ length: n }, (_, i) => ({
    t: i * 0.26,
    dur: i === n - 1 ? 0.45 : 0.24,
    midi: 62 - Math.round((i * 5) / Math.max(1, n - 1)),
  }))
}

function stop() {
  if (!playing) return
  for (const s of playing.stops) s()
  for (const t of playing.timers) window.clearTimeout(t)
  playing = null
  show(null)
}

async function play(items: { line: number; which: Which }[]) {
  stop()
  const { c, out } = audio()
  await c.resume()
  const stops: (() => void)[] = []
  const timers: number[] = []
  let t = c.currentTime + 0.2
  for (const it of items) {
    const notes = notesOf(it.line)
    const text = LINES[it.line].text
    const opts = {
      preset,
      double: DOUBLED[preset],
      harmony: null,
      beat: SPB,
      /* the same seed for both, so the humanising is the same and only the voice differs */
      seed: 7 + it.line,
      lead: 0.12,
    }
    if (it.which === 'a') {
      const sung = beforeLyrics.assignSyllables(notes, beforeLyrics.splitLyrics(text)).sung
      stops.push(before.singInto(c, out, sung, t, opts))
    } else {
      const sung = afterLyrics.assignSyllables(notes, afterLyrics.splitLyrics(text)).sung
      stops.push(after.singInto(c, out, sung, t, opts))
    }
    timers.push(window.setTimeout(() => show(it), (t - c.currentTime) * 1000))
    const last = notes[notes.length - 1]
    t += last.t + last.dur + 0.7
  }
  timers.push(window.setTimeout(stop, (t - c.currentTime) * 1000))
  playing = { stops, timers }
  render()
}

function show(it: { line: number; which: Which } | null) {
  $('now').textContent = it ? `${LABEL[it.which]}: ${LINES[it.line].text}` : ' '
  document.querySelectorAll<HTMLElement>('#lines li').forEach((li, i) => {
    if (it && it.line === i) li.dataset.on = ''
    else delete li.dataset.on
  })
  render()
}

function render() {
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-preset]'))
    b.setAttribute('aria-pressed', String(b.dataset.preset === preset))
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-mode]'))
    b.setAttribute('aria-pressed', String(b.dataset.mode === mode))
  $('all').textContent = playing ? '■ Stop' : '▶ All lines, A then B'
}

const list = $('lines')
LINES.forEach((l, i) => {
  const li = document.createElement('li')
  const said = document.createElement('p')
  said.className = 'said'
  said.textContent = l.text
  const row = document.createElement('div')
  row.className = 'row'
  const button = (text: string, items: { line: number; which: Which }[]) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'pill'
    b.textContent = text
    b.addEventListener('click', () => void play(items))
    row.append(b)
  }
  button(LABEL.a, [{ line: i, which: 'a' }])
  button(LABEL.b, [{ line: i, which: 'b' }])
  button('A then B', [
    { line: i, which: 'a' },
    { line: i, which: 'b' },
  ])
  li.append(said, row)
  list.append(li)
})

$('all').addEventListener('click', () => {
  if (playing) return stop()
  void play(
    LINES.flatMap((_, i) => [
      { line: i, which: 'a' as const },
      { line: i, which: 'b' as const },
    ]),
  )
})
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-preset]'))
  b.addEventListener('click', () => {
    preset = b.dataset.preset as PresetId
    render()
  })
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-mode]'))
  b.addEventListener('click', () => {
    mode = b.dataset.mode as Mode
    render()
  })
render()

/* for whoever is measuring: how many voices each singer has alive right now */
Object.assign(window, { __abLive: () => [before.liveSingers(), after.liveSingers()] })
