import * as nowLyrics from './before/lyrics'
import * as now from './before/singer'
import * as vibeLyrics from '../audio/lyrics'
import * as vibe from '../audio/singer'
import type { PresetId } from '../audio/singer'

/**
 * The vibe pass's A/B page (singer-vibe.html): fixed lines sung by today's voice (A, frozen in
 * ./before at the #325 release) and the vibe prototype (B), on the same notes and the same seed.
 *
 * ⚠️ EACH SIDE HEARS THE ROOM IT WOULD GET IN THE INSTRUMENT. A goes through a copy of the part
 * bus's reverb at the singer's setting (space 0.25 on the shared 2.2s impulse), which is what it has
 * on the site today; B brings its own plate and echo and gets none from the bus, which is what
 * SingPanel now does for a voice with a `space`. Giving both the same room would hide half of B.
 *
 * ⚠️ DEV-ONLY, like singer-preview.html: not a build input, nothing saved. Delete it and ./before
 * once the comparison is done.
 */

type Which = 'a' | 'b'

/** the lines, and a tune for each in beats: [start, length, midi] — one note per syllable or hold */
const LINES: { text: string; tune: [number, number, number][] }[] = [
  {
    /* two phrases with a rest between: a breath, a dip down onto "me", a long "go" that falls */
    text: 'hold me close let me go',
    tune: [
      [0, 0.5, 67],
      [0.5, 0.5, 69],
      [1, 1.5, 71],
      [4, 0.5, 72],
      [4.5, 0.5, 71],
      [5, 2.5, 67],
    ],
  },
  {
    /* a repeated note, a leap of a fourth onto "sky" that overshoots, then "night" closing on a t */
    text: 'light up the sky to-night',
    tune: [
      [0, 0.5, 64],
      [0.5, 0.5, 64],
      [1, 0.5, 67],
      [1.5, 1.5, 72],
      [4, 0.5, 71],
      [4.5, 2.5, 69],
    ],
  },
  {
    /* one held syllable carried up two steps, then a long open note */
    text: 'la la la _ love',
    tune: [
      [0, 0.5, 72],
      [0.5, 0.5, 72],
      [1, 1, 74],
      [2, 1, 76],
      [3, 2, 72],
    ],
  },
  {
    /* from the diction A/B, so the words can be checked as well as the feel */
    text: 'we will meet at night',
    tune: [
      [0, 0.5, 64],
      [0.5, 0.5, 67],
      [1, 1, 69],
      [2, 0.5, 67],
      [2.5, 1.5, 72],
    ],
  },
]
const BPM = 96
const SPB = 60 / BPM
/** time in hand before each line, so its first breath and first consonant fit before the beat */
const LEAD = 0.45
/* what the room does: clean sings alone, the other two are doubled */
const DOUBLED: Record<PresetId, boolean> = { clean: false, breathy: true, glitchy: true }
const LABEL: Record<Which, string> = { a: 'A, now', b: 'B, vibe' }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

let preset: PresetId = 'clean'
let snap = false
let ctx: { c: AudioContext; a: AudioNode; b: AudioNode } | null = null
let playing: { stops: (() => void)[]; timers: number[] } | null = null

/**
 * The part bus's reverb as the singer gets it today — synth.ts's makeBus at space 0.25: the dry
 * path at 1 - 0.25 × 0.35 and the wet at 0.25 × 0.9, through 2.2s of noise falling as (1 - x)^2.5.
 */
export function busRoom(c: BaseAudioContext, dest: AudioNode): AudioNode {
  const input = c.createGain()
  const dry = c.createGain()
  dry.gain.value = 1 - 0.25 * 0.35
  input.connect(dry).connect(dest)
  const verb = c.createConvolver()
  const n = Math.floor(c.sampleRate * 2.2)
  const ir = c.createBuffer(2, n, c.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch)
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.5)
  }
  verb.buffer = ir
  const wet = c.createGain()
  wet.gain.value = 0.25 * 0.9
  input.connect(verb).connect(wet).connect(dest)
  return input
}

function audio() {
  if (ctx) return ctx
  const c = new AudioContext()
  /* the instrument's own limiter, roughly: only the overshoot is caught */
  const limiter = c.createDynamicsCompressor()
  limiter.threshold.value = -6
  limiter.ratio.value = 12
  limiter.connect(c.destination)
  const master = c.createGain()
  master.gain.value = 1.4
  master.connect(limiter)
  ctx = { c, a: busRoom(c, master), b: master }
  return ctx
}

export function notesOf(line: number) {
  return LINES[line].tune.map(([t, d, m]) => ({ t: t * SPB, dur: d * SPB * 0.95, midi: m }))
}

/** sing one line on one side into `c` at `t`: the same notes, seed and lead for both */
export function singLine(
  c: BaseAudioContext,
  dest: AudioNode,
  which: Which,
  line: number,
  t: number,
  opt: { preset: PresetId; snap: boolean },
) {
  const notes = notesOf(line)
  const text = LINES[line].text
  const opts = {
    preset: opt.preset,
    double: DOUBLED[opt.preset],
    harmony: null,
    beat: SPB,
    seed: 7 + line,
    lead: LEAD,
  }
  if (which === 'a') {
    const sung = nowLyrics.assignSyllables(notes, nowLyrics.splitLyrics(text)).sung
    return now.singInto(c, dest, sung, t, opts)
  }
  const sung = vibeLyrics.assignSyllables(notes, vibeLyrics.splitLyrics(text)).sung
  return vibe.singInto(c, dest, sung, t, { ...opts, snap: opt.snap })
}

/** how long a line takes, start to last note, in seconds */
export function lineLength(line: number) {
  const last = notesOf(line).at(-1)!
  return last.t + last.dur
}

export const LINE_COUNT = LINES.length

function stop() {
  if (!playing) return
  for (const s of playing.stops) s()
  for (const t of playing.timers) window.clearTimeout(t)
  playing = null
  show(null)
}

async function play(items: { line: number; which: Which }[]) {
  stop()
  const { c, a, b } = audio()
  await c.resume()
  const stops: (() => void)[] = []
  const timers: number[] = []
  let t = c.currentTime + 0.2 + LEAD
  for (const it of items) {
    stops.push(singLine(c, it.which === 'a' ? a : b, it.which, it.line, t, { preset, snap }))
    timers.push(window.setTimeout(() => show(it), (t - LEAD - c.currentTime) * 1000))
    /* room for the echo to die away and the next line's breath before it */
    t += lineLength(it.line) + 1.1 + LEAD
  }
  timers.push(window.setTimeout(stop, (t - LEAD - c.currentTime) * 1000))
  playing = { stops, timers }
  render()
}

function show(it: { line: number; which: Which } | null) {
  $('now').textContent = it ? `${LABEL[it.which]}: ${LINES[it.line].text}` : ' '
  document.querySelectorAll<HTMLElement>('#lines li').forEach((li, i) => {
    if (it && it.line === i) li.dataset.on = ''
    else delete li.dataset.on
  })
  render()
}

function render() {
  for (const el of document.querySelectorAll<HTMLButtonElement>('[data-preset]'))
    el.setAttribute('aria-pressed', String(el.dataset.preset === preset))
  for (const el of document.querySelectorAll<HTMLButtonElement>('[data-snap]'))
    el.setAttribute('aria-pressed', String((el.dataset.snap === 'on') === snap))
  $('all').textContent = playing ? '■ Stop' : '▶ All lines, A then B'
}

if (typeof document !== 'undefined' && document.getElementById('lines')) {
  const list = $('lines')
  LINES.forEach((l, i) => {
    const li = document.createElement('li')
    const said = document.createElement('p')
    said.className = 'said'
    said.textContent = l.text.replace(' _', '…')
    const row = document.createElement('div')
    row.className = 'row'
    const button = (text: string, items: { line: number; which: Which }[]) => {
      const el = document.createElement('button')
      el.type = 'button'
      el.className = 'pill'
      el.textContent = text
      el.addEventListener('click', () => void play(items))
      row.append(el)
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
  for (const el of document.querySelectorAll<HTMLButtonElement>('[data-preset]'))
    el.addEventListener('click', () => {
      preset = el.dataset.preset as PresetId
      render()
    })
  for (const el of document.querySelectorAll<HTMLButtonElement>('[data-snap]'))
    el.addEventListener('click', () => {
      snap = el.dataset.snap === 'on'
      render()
    })
  render()

  /* for whoever is measuring: how many voices each singer has alive right now */
  Object.assign(window, { __vibeLive: () => [now.liveSingers(), vibe.liveSingers()] })
}
