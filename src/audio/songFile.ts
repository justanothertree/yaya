import { INSTRUMENTS, type Fx, type InstrumentId } from './synth'
import { toEvents, toNotes, type Note } from './noteEdit'
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
  /** which bars of the song this layer plays in; absent means all of them */
  play?: boolean[]
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
      play: l.play,
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
    glide: num(o.glide, 0, 1, 0),
  }
}

/**
 * An arrangement mask off the wire.
 *
 * ⚠️ Bounded at MAX_BARS like everything else here. It is an array a stranger's file supplies
 * and it becomes a loop bound in the scheduler, so a million-entry mask is a million comparisons
 * per repetition. Absent or unusable means "plays everywhere", which is the safe reading: a song
 * that loses its arrangement is still a song, where one that silently mutes itself is a bug
 * nobody can diagnose.
 */
function readPlay(v: unknown): boolean[] | undefined {
  if (!Array.isArray(v) || !v.length) return undefined
  return v.slice(0, 32).map((x) => x !== false)
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

  return {
    instrument: inst,
    events,
    len,
    fx: readFx(o.fx),
    muted: o.muted === true,
    play: readPlay(o.play),
  }
}

/** Read a song from anywhere. Returns null rather than throwing — a bad file is not a crash. */
export function readSong(v: unknown): Song | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  // ⚠️ Both forms, forever. Songs kept before the compact encoding existed are still in
  // people's libraries, and a reader that dropped them would quietly delete work.
  if (o.v === 2 || Array.isArray(o.l)) return readPacked(o)
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

/**
 * The same song, small enough to live in a profile block.
 *
 * ⚠️ STORED AS NOTES, NOT EVENTS, and as flat numbers rather than objects. Measured on real
 * material, the readable form costs about 67 characters per note — `{"t":0.5,"midi":60,"on":true}`
 * twice over, once for the press and once for the release. A four-layer song of 192 notes came to
 * 12,800 characters, and the profile block limit is 4,000: a two-layer sketch of 64 notes already
 * did not fit.
 *
 * A note is a start, a pitch and a length, so three integers say everything: milliseconds, midi,
 * milliseconds. That is about 14 characters per note instead of 67, and it halves the count on
 * top of that by storing one note where there were two events.
 *
 *     4 layers, 192 notes    12,800 chars  →  ~2,700
 *
 * Integers rather than seconds-with-decimals for the same reason: "0.4833333333333333" is
 * eighteen characters of false precision for a moment nobody can hear the difference in.
 *
 * ⚠️ It goes back out through toEvents like every other path, so a compact song is subject to
 * exactly the same guarantees as a verbose one — pairing, the boundary rule, no overlaps. This is
 * a smaller way of writing the same thing down, not a second format with its own semantics.
 */
export type PackedSong = {
  v: 2
  name: string
  bpm: number
  bars: number
  /** layers: instrument, own length in ms, fx as five numbers, muted, notes as flat triples */
  l: Array<{
    i: string
    /** arrangement bitmask, one bit per bar; -1 means "every bar" */
    p: number
    d: number
    /**
     * ⚠️ [echo, echoTime, space, vibrato, glide] — and any future one goes on the END. A reader
     * takes these by position, so appending is invisible to an old file and inserting would
     * re-label every value after it.
     */
    f: [number, number, number, number, number]
    m: 0 | 1
    n: number[]
  }>
}

export function packSong(song: Song): PackedSong {
  return {
    v: 2,
    name: song.name,
    bpm: song.bpm,
    bars: song.bars,
    l: song.layers.map((layer) => {
      const notes = toNotes(layer.events, layer.len)
      const n: number[] = []
      for (const note of notes) {
        n.push(Math.round(note.t * 1000), note.midi, Math.round(note.dur * 1000))
      }
      // ⚠️ the mask packs to ONE NUMBER — a bit per bar. Thirty-two booleans as JSON is
      // "[true,false,...]" at ~6 characters each; as an integer it is at most ten.
      let mask = 0
      if (layer.play)
        for (let i = 0; i < layer.play.length && i < 32; i++) if (layer.play[i]) mask |= 1 << i
      return {
        i: layer.instrument,
        p: layer.play ? mask : -1,
        d: Math.round(layer.len * 1000),
        /* ⚠️ glide is APPENDED, never inserted. This array is positional, so a fifth entry is
           invisible to an older reader and a missing one simply defaults — where putting it in
           the middle would silently turn every saved song's reverb into its vibrato. */
        f: [layer.fx.echo, layer.fx.echoTime, layer.fx.space, layer.fx.vibrato, layer.fx.glide].map(
          (x) => Math.round(x * 100) / 100,
        ) as [number, number, number, number, number],
        m: layer.muted ? 1 : 0,
        n,
      }
    }),
  }
}

/** Read the compact form. Same caps and the same normaliser as the verbose one. */
function readPacked(v: Record<string, unknown>): Song | null {
  if (!Array.isArray(v.l)) return null
  const layers: SongLayer[] = []
  let budget = MAX_EVENTS_TOTAL
  for (const raw of v.l.slice(0, MAX_LAYERS)) {
    if (budget <= 0) break
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    if (!Array.isArray(o.n)) continue
    const len = num(o.d, 100, 60000, 2000) / 1000
    const inst = typeof o.i === 'string' && INSTRUMENT_IDS.has(o.i) ? (o.i as InstrumentId) : 'keys'
    const fxArr = Array.isArray(o.f) ? o.f : []
    const fx: Fx = {
      echo: num(fxArr[0], 0, 1, 0),
      echoTime: num(fxArr[1], 0, 1, 0.26),
      space: num(fxArr[2], 0, 1, 0),
      vibrato: num(fxArr[3], 0, 1, 0),
      /* absent in songs saved before glide existed, which is exactly what the default is for */
      glide: num(fxArr[4], 0, 1, 0),
    }
    // ⚠️ budget is in EVENTS and each note becomes two, so the triple count is halved against it
    const notes: Note[] = []
    const cap = Math.min(MAX_EVENTS_PER_LAYER, budget) / 2
    for (let i = 0; i + 2 < o.n.length && notes.length < cap; i += 3) {
      const t = o.n[i]
      const midi = o.n[i + 1]
      const dur = o.n[i + 2]
      if (typeof t !== 'number' || typeof midi !== 'number' || typeof dur !== 'number') continue
      if (!Number.isFinite(t) || !Number.isFinite(midi) || !Number.isFinite(dur)) continue
      if (!Number.isInteger(midi) || midi < 0 || midi > 127) continue
      if (t < 0 || t > 60000 || dur <= 0) continue
      notes.push({ midi, t: t / 1000, dur: dur / 1000 })
    }
    if (!notes.length) continue
    const events = toEvents(notes, len)
    if (!events.some((e) => e.on)) continue
    budget -= events.length
    const bits = typeof o.p === 'number' && Number.isInteger(o.p) ? o.p : -1
    const play =
      bits < 0 ? undefined : Array.from({ length: 32 }, (_, i) => (bits & (1 << i)) !== 0)
    layers.push({ instrument: inst, events, len, fx, muted: o.m === 1, play })
  }
  if (!layers.length) return null
  return {
    v: VERSION,
    name: typeof v.name === 'string' ? v.name.slice(0, MAX_NAME).trim() || 'Untitled' : 'Untitled',
    bpm: Math.round(num(v.bpm, 40, 200, 96)),
    bars: Math.round(num(v.bars, 1, 8, 2)),
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
    play: l.play,
  }))
}
