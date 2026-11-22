import * as nowLyrics from './before/lyrics'
import * as now from './before/singer'
import { harmonyAbove } from '../audio/lyrics'
import * as vibeLyrics from '../audio/lyrics'
import * as vibe from '../audio/singer'
import type { PresetId, SingOpts } from '../audio/singer'

/**
 * The vibe pass's A/B page (singer-vibe.html), second round: the voice before the vibe pass (A,
 * frozen in ./before at the #325 release) against the same voice with whichever of three switches
 * are on (B). With every switch off, B is A.
 *
 * ⚠️ A IS NOT THE SITE'S VOICE ANY MORE. Since #338 the Sing panel sings with B's late vibrato and
 * light room on, so the page calls A "before" rather than "today" (Evan, 14 Nov 2026).
 *
 * ⚠️ EACH SIDE HEARS THE ROOM IT WOULD GET IN THE INSTRUMENT: A, and B unless its room switch says
 * otherwise, go through a copy of the part bus's reverb at the singer's setting. B's "Light room"
 * replaces it, the way the Sing panel would turn the bus's off for it.
 *
 * ⚠️ LEVEL-MATCHED BEFORE IT PLAYS. B is measured against A with the same voice and switches, over
 * all four lines — rendered offline through roughly the curve LUFS uses (+4dB above 1.5kHz, nothing
 * below 38Hz) — and turned up or down by the difference. A harmony or an echo adds level, and the
 * louder side wins an A/B whatever else it does.
 *
 * ⚠️ PUBLISHED, UNLISTED, at /singer-vibe.html — Evan's call, 14 Nov 2026, so it can be heard on
 * a phone. A second build input (vite.config.ts), linked from nowhere, asking not to be indexed, and
 * saving nothing. Sound starts on a tap, because a phone will not play until something is touched.
 * Delete it, ./before and its build input together when it is no longer wanted.
 */

type Which = 'a' | 'b'
type Switches = {
  vibrato: 'off' | 'late'
  space: 'off' | 'room' | 'echo'
  harmony: 'off' | 'third' | 'octave'
}

/** the lines, and a tune for each in beats: [start, length, midi] — one note per syllable or hold */
const LINES: { text: string; tune: [number, number, number][] }[] = [
  {
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
const LEAD = 0.2
/* every line is in C major, so the harmony's third is the scale's */
const C_MAJOR = [0, 2, 4, 5, 7, 9, 11]
/* what the room does: clean sings alone, the other two are doubled */
const DOUBLED: Record<PresetId, boolean> = { clean: false, breathy: true, glitchy: true }
const OFF: Switches = { vibrato: 'off', space: 'off', harmony: 'off' }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

let preset: PresetId = 'clean'
let sw: Switches = { ...OFF }
let ctx: { c: AudioContext; master: AudioNode; bus: AudioNode } | null = null
let playing: { stops: (() => void)[]; timers: number[] } | null = null

/**
 * The part bus's reverb as A's voice got it — synth.ts's makeBus at space 0.25: the dry
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

export function notesOf(line: number) {
  return LINES[line].tune.map(([t, d, m]) => ({ t: t * SPB, dur: d * SPB * 0.95, midi: m }))
}

export const LINE_COUNT = LINES.length

export function lineLength(line: number) {
  const last = notesOf(line).at(-1)!
  return last.t + last.dur
}

/** does B go through the bus's reverb? Every time but the light room, which replaces it */
export const viaBus = (which: Which, s: Switches) => which === 'a' || s.space !== 'room'

/** sing one line on one side into `dest` at `t`: the same notes, seed and lead for both */
export function singLine(
  c: BaseAudioContext,
  dest: AudioNode,
  which: Which,
  line: number,
  t: number,
  p: PresetId,
  s: Switches,
) {
  const notes = notesOf(line)
  const text = LINES[line].text
  const base = {
    preset: p,
    double: DOUBLED[p],
    harmony: null,
    beat: SPB,
    seed: 7 + line,
    lead: LEAD,
  }
  if (which === 'a') {
    const sung = nowLyrics.assignSyllables(notes, nowLyrics.splitLyrics(text)).sung
    return now.singInto(c, dest, sung, t, base)
  }
  const opts: SingOpts = {
    ...base,
    vibrato: s.vibrato === 'late' ? 'late' : undefined,
    space: s.space === 'off' ? undefined : s.space,
    harmony: s.harmony === 'off' ? null : (m) => harmonyAbove(m, C_MAJOR, 0),
    octave: s.harmony === 'octave',
  }
  const sung = vibeLyrics.assignSyllables(notes, vibeLyrics.splitLyrics(text)).sung
  return vibe.singInto(c, dest, sung, t, opts)
}

/**
 * How loud one side is, in dB, through roughly the curve LUFS uses: every line rendered offline with
 * the room it would play in, then the mean square of both channels across all of them, tails and all.
 *
 * ⚠️ ALL FOUR LINES, NOT THE ONE ABOUT TO PLAY. A doubled voice wanders at a random rate and beats
 * against its twin, so one short line measured twice disagreed with itself by up to 0.6dB — as much as
 * the switches being judged. Across the four the beating averages out.
 */
export async function loudness(which: Which, p: PresetId, s: Switches) {
  /* low, because a phone renders all four lines before the first play of each setting; the curve's
     shelf is at 1.5kHz and both sides lose the same top, so the difference is unchanged */
  const rate = 16000
  let sum = 0
  let n = 0
  for (let line = 0; line < LINES.length; line++) {
    const c = new OfflineAudioContext(2, Math.ceil(rate * (lineLength(line) + LEAD + 4)), rate)
    const shelf = c.createBiquadFilter()
    shelf.type = 'highshelf'
    shelf.frequency.value = 1500
    shelf.gain.value = 4
    const hp = c.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 38
    hp.Q.value = 0.5
    shelf.connect(hp).connect(c.destination)
    singLine(c, viaBus(which, s) ? busRoom(c, shelf) : shelf, which, line, LEAD, p, s)
    const buf = await c.startRendering()
    for (let ch = 0; ch < buf.numberOfChannels; ch++)
      for (const x of buf.getChannelData(ch)) {
        sum += x * x
        n++
      }
  }
  return 10 * Math.log10(sum / n + 1e-20)
}

/**
 * B's trim against A, in gain — measured once per voice and set of switches, and kept as a PROMISE,
 * so a play pressed while the same setting is still being measured waits for that measurement
 * rather than starting a second one. A does not depend on the switches, so it is measured once per
 * voice.
 */
const louder = new Map<string, Promise<number>>()
const trims = new Map<string, Promise<number>>()
function trimFor(p: PresetId, s: Switches) {
  const key = `${p}|${s.vibrato}|${s.space}|${s.harmony}`
  let g = trims.get(key)
  if (!g) {
    let a = louder.get(p)
    if (!a) louder.set(p, (a = loudness('a', p, OFF)))
    const b = loudness('b', p, s)
    g = Promise.all([a, b]).then(([la, lb]) => 10 ** ((la - lb) / 20))
    trims.set(key, g)
  }
  return g
}

/**
 * The context, made and started inside the tap that asks for sound — the only moment a phone allows
 * it. On an iPhone, Web Audio also follows the ring switch unless the page says it is playing media,
 * which a page you came to in order to listen to is; and one silent sample played inside the tap is
 * what older iPhones need before they will play anything later.
 */
function audio() {
  if (ctx) return ctx
  const Ctor =
    window.AudioContext ??
    (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  const session = (navigator as { audioSession?: { type: string } }).audioSession
  if (session) session.type = 'playback'
  const c = new Ctor()
  const blip = c.createBufferSource()
  blip.buffer = c.createBuffer(1, 1, c.sampleRate)
  blip.connect(c.destination)
  blip.start()
  /* the instrument's own limiter, roughly: only the overshoot is caught */
  const limiter = c.createDynamicsCompressor()
  limiter.threshold.value = -6
  limiter.ratio.value = 12
  limiter.connect(c.destination)
  const master = c.createGain()
  master.gain.value = 1.4
  master.connect(limiter)
  ctx = { c, master, bus: busRoom(c, master) }
  return ctx
}

function stop() {
  if (!playing) return
  for (const s of playing.stops) s()
  for (const t of playing.timers) window.clearTimeout(t)
  playing = null
  show(null)
}

/** what B has on, in words, for the line that is playing */
function says(s: Switches) {
  const on = [
    s.vibrato === 'late' ? 'late vibrato' : '',
    s.space === 'room' ? 'light room' : s.space === 'echo' ? 'soft echo' : '',
    s.harmony === 'third' ? 'third above' : s.harmony === 'octave' ? 'third and octave' : '',
  ].filter(Boolean)
  return on.length ? `B, ${on.join(' + ')}` : 'B, nothing on (same as A)'
}

/** each press of a play button; one that is overtaken while it waits gives up */
let generation = 0

async function play(items: { line: number; which: Which }[]) {
  stop()
  const mine = ++generation
  const { c, master, bus } = audio()
  await c.resume()
  const s = { ...sw }
  const p = preset
  $('now').textContent = 'Matching levels…'
  const trim = await trimFor(p, s)
  if (mine !== generation) return
  const gains = items.map((it) => (it.which === 'a' ? 1 : trim))
  const stops: (() => void)[] = []
  const timers: number[] = []
  let t = c.currentTime + 0.2 + LEAD
  items.forEach((it, i) => {
    const trim = c.createGain()
    trim.gain.value = gains[i]
    trim.connect(viaBus(it.which, s) ? bus : master)
    const sing = singLine(c, trim, it.which, it.line, t, p, s)
    stops.push(() => {
      sing()
      trim.disconnect()
    })
    const label = it.which === 'a' ? 'A, before' : says(s)
    timers.push(window.setTimeout(() => show(it, label), (t - LEAD - c.currentTime) * 1000))
    t += lineLength(it.line) + 1.2 + LEAD
  })
  timers.push(window.setTimeout(stop, (t - LEAD - c.currentTime) * 1000))
  playing = { stops, timers }
  render()
}

function show(it: { line: number; which: Which } | null, label = '') {
  $('now').textContent = it ? `${label}: ${LINES[it.line].text.replace(' _', '…')}` : ' '
  document.querySelectorAll<HTMLElement>('#lines li').forEach((li, i) => {
    if (it && it.line === i) li.dataset.on = ''
    else delete li.dataset.on
  })
  render()
}

function render() {
  for (const el of document.querySelectorAll<HTMLButtonElement>('[data-preset]'))
    el.setAttribute('aria-pressed', String(el.dataset.preset === preset))
  for (const el of document.querySelectorAll<HTMLButtonElement>('[data-sw]'))
    el.setAttribute('aria-pressed', String(sw[el.dataset.sw as keyof Switches] === el.dataset.val))
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
    button('A, before', [{ line: i, which: 'a' }])
    button('B', [{ line: i, which: 'b' }])
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
  /* measuring a setting starts as soon as it is chosen, so the play after it rarely waits */
  const warm = () => {
    if (ctx) void trimFor(preset, sw)
  }
  for (const el of document.querySelectorAll<HTMLButtonElement>('[data-preset]'))
    el.addEventListener('click', () => {
      preset = el.dataset.preset as PresetId
      render()
      warm()
    })
  for (const el of document.querySelectorAll<HTMLButtonElement>('[data-sw]'))
    el.addEventListener('click', () => {
      sw = { ...sw, [el.dataset.sw as keyof Switches]: el.dataset.val } as Switches
      render()
      warm()
    })
  $('start').addEventListener('click', () => {
    void audio().c.resume()
    $('start').hidden = true
    $('controls').hidden = false
    warm()
    $('all').focus()
  })
  render()

  /* for whoever is measuring: how many voices each singer has alive right now */
  Object.assign(window, { __vibeLive: () => [now.liveSingers(), vibe.liveSingers()] })
}
