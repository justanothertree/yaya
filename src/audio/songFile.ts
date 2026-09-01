import { INSTRUMENTS, type Fx, type InstrumentId } from './synth'
import { toEvents, toNotes } from './noteEdit'
import type { Layer, LoopEvent } from './looper'

/**
 * A song, as data you can keep.
 *
 * ⚠️ THE WHOLE THING IS NOTES, WHICH IS WHY ANY OF THIS IS CHEAP. A four-layer arrangement is a
 * couple of kilobytes of JSON — no audio file, no upload, no transcoding, no storage bill, and no
 * bandwidth when somebody plays it. A visitor's own browser synthesises it from the events, so
 * putting a song on your profile costs about what a paragraph of text costs.
 *
 * That is also why a saved loop can be lifted into a different song later: a drum part is a list
 * of times and pitches, not a recording of a drum part, so pasting it into another arrangement is
 * an array operation rather than an audio edit.
 *
 *
 * ⚠️ LOADING IS THE DANGEROUS DIRECTION
 *
 * A song read from anywhere — a file, another person's profile, localStorage that something else
 * wrote — becomes OSCILLATORS on the machine that opens it. That makes this parser a security
 * boundary, not a convenience, and it is written to assume the input is hostile:
 *
 *   · every count is capped, so no song can ask a browser for ten thousand voices
 *   · every number is finite and clamped into the range its control offers
 *   · every instrument name is checked against the real list, never trusted into the synth
 *   · every string is length-limited before it can be stored or rendered
 *
 * And the load path ends by pushing every layer through toNotes → toEvents, the same normaliser
 * the note editor writes through. That is worth more than all the checks above put together: it
 * means a malformed take cannot exist after parsing. A note-on with no note-off — the shape that
 * makes a voice ring until Panic — is not something this function can return, because the
 * converter has no way to express it.
 */

const MAX_LAYERS = 12
const MAX_EVENTS_PER_LAYER = 2000
const MAX_EVENTS_TOTAL = 6000
const MAX_NAME = 60
/** Current format. Bumped only for a change old readers could not survive. */
const VERSION = 1

const INSTRUMENT_IDS = new Set<string>(INSTRUMENTS.map(([id]) => id))

export type SongLayer = {
  instrument: InstrumentId
  events: LoopEvent[]
  len: number
  fx: Fx
  muted: boolean
}

export type Song = {
  v: number
  name: string
  bpm: number
  bars: number
  layers: SongLayer[]
}

/** What the instrument room hands over — its own state, in the shape above. */
export function toSong(
  name: string,
  bpm: number,
  bars: number,
  layers: Layer[],
  only?: string,
): Song {
  const picked = only ? layers.filter((l) => l.id === only) : layers
  return {
    v: VERSION,
    name: name.slice(0, MAX_NAME),
    bpm,
    bars,
    layers: picked.slice(0, MAX_LAYERS).map((l) => ({
      instrument: l.instrument,
      events: l.events,
      len: l.len,
      fx: l.fx,
      muted: l.muted,
    })),
  }
}

const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback

function readFx(v: unknown): Fx {
  const o = (v ?? {}) as Record<string, unknown>
  return {
    echo: num(o.echo, 0, 1, 0),
    echoTime: num(o.echoTime, 0, 1, 0.26),
    space: num(o.space, 0, 1, 0),
    vibrato: num(o.vibrato, 0, 1, 0),
  }
}

function readLayer(v: unknown, budget: number): SongLayer | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const inst =
    typeof o.instrument === 'string' && INSTRUMENT_IDS.has(o.instrument)
      ? (o.instrument as InstrumentId)
      : 'keys'
  const len = num(o.len, 0.1, 60, 2)
  if (!Array.isArray(o.events)) return null

  const raw: LoopEvent[] = []
  for (const e of o.events.slice(0, Math.min(MAX_EVENTS_PER_LAYER, budget))) {
    if (!e || typeof e !== 'object') continue
    const r = e as Record<string, unknown>
    if (typeof r.midi !== 'number' || !Number.isInteger(r.midi) || r.midi < 0 || r.midi > 127)
      continue
    if (typeof r.t !== 'number' || !Number.isFinite(r.t) || r.t < 0 || r.t > len) continue
    raw.push({ t: r.t, midi: r.midi, on: r.on === true })
  }
  if (!raw.some((e) => e.on)) return null

  /**
   * ⚠️ Normalised, not merely validated.
   *
   * Passing the events through the converter is what guarantees the result is playable: every
   * note-on gets a note-off, nothing lands on the loop boundary, and two notes of one pitch
   * cannot overlap. Checking the numbers alone would let a file through that is individually
   * valid and collectively a stuck note.
   */
  const events = toEvents(toNotes(raw, len), len)
  if (!events.some((e) => e.on)) return null

  return { instrument: inst, events, len, fx: readFx(o.fx), muted: o.muted === true }
}

/** Read a song from anywhere. Returns null rather than throwing — a bad file is not a crash. */
export function readSong(v: unknown): Song | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (!Array.isArray(o.layers)) return null

  const layers: SongLayer[] = []
  let budget = MAX_EVENTS_TOTAL
  for (const raw of o.layers.slice(0, MAX_LAYERS)) {
    if (budget <= 0) break
    const l = readLayer(raw, budget)
    if (!l) continue
    budget -= l.events.length
    layers.push(l)
  }
  if (!layers.length) return null

  return {
    v: VERSION,
    name: typeof o.name === 'string' ? o.name.slice(0, MAX_NAME).trim() || 'Untitled' : 'Untitled',
    bpm: Math.round(num(o.bpm, 40, 200, 96)),
    bars: Math.round(num(o.bars, 1, 8, 2)),
    layers,
  }
}

/** How many notes are in it — for a UI that wants to say "3 layers · 48 notes". */
export function songNotes(s: Song): number {
  return s.layers.reduce((n, l) => n + l.events.filter((e) => e.on).length, 0)
}

/**
 * Give a song's layers the ids the sequencer wants.
 *
 * ⚠️ Fresh ids every time, rather than ids stored in the file. A layer id is a key in the live
 * `sounding` map and in every scheduled voice id; loading the same song twice, or dropping one
 * loop into a song that already came from the same file, would otherwise produce two layers
 * claiming the same identity — and releasing one would silence the other.
 */
export function songToLayers(s: Song): Layer[] {
  const stamp = Date.now()
  return s.layers.map((l, i) => ({
    id: `${stamp}-${i}`,
    instrument: l.instrument,
    events: l.events,
    muted: l.muted,
    fx: l.fx,
    len: l.len,
  }))
}
