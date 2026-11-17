import { hasLyrics } from './lyricLines'
import type { Layer } from './looper'
import { fitSongLyrics, notesInSong } from './songLyrics'
import { INSTRUMENTS, type InstrumentId } from './synth'

/**
 * A song's parts as a Standard MIDI File — every note each part plays across the song, as the
 * scheduler places it, so a part arranged to sit out bar three sits it out there too.
 *
 * One track per part, after a first track holding the tempo and 4/4. A melodic part gets its own
 * channel and the General MIDI sound nearest to what it plays as; the drum kit goes on channel
 * 10, each piece on the General MIDI key for it, so it opens as a kit rather than as twelve
 * pitched notes. The part that sings has its syllables as lyric events, at the notes they land on.
 *
 * ⚠️ PURE, so it can be asked a question without a browser: bytes in, nothing touched.
 */

/** ticks per quarter note */
export const PPQ = 480

/**
 * The General MIDI program (0-based) nearest each instrument's sound. Not a claim that they sound
 * alike, only that a program opened somewhere else starts from the right family.
 */
export const GM_PROGRAM: Record<Exclude<InstrumentId, 'drums'>, number> = {
  keys: 0,
  rhodes: 4,
  harpsichord: 6,
  clav: 7,
  box: 10,
  vibes: 11,
  marimba: 12,
  bassmarimba: 12,
  bell: 14,
  organ: 16,
  accordion: 21,
  pluck: 25,
  guitar: 27,
  overdrive: 29,
  upright: 32,
  bass: 33,
  finger: 33,
  pick: 34,
  fretless: 35,
  slap: 36,
  synthbass: 38,
  fuzz: 38,
  '808': 38,
  sub: 38,
  acid: 39,
  fmbass: 39,
  cello: 42,
  harp: 46,
  strings: 48,
  choir: 52,
  tuba: 58,
  brass: 61,
  reed: 65,
  flute: 73,
  whistle: 78,
  chip: 80,
  lead: 81,
  supersaw: 81,
  fifths: 81,
  pad: 89,
  glass: 92,
  drone: 95,
  sitar: 104,
  banjo: 105,
  koto: 107,
  kalimba: 108,
  steelpan: 114,
  handpan: 114,
}

/**
 * The kit's twelve pieces (synth.ts DRUMS, one per semitone of the octave) on the General MIDI
 * percussion keys: kick, side stick, snare, clap, low tom, mid tom, closed hat, high tom, open
 * hat, ride, cowbell, crash.
 */
export const GM_DRUM = [36, 37, 38, 39, 45, 47, 42, 50, 46, 51, 56, 49] as const

export type MidiSong = {
  bpm: number
  bars: number
  quantize: number
  layers: readonly Layer[]
}

type Ev = { tick: number; order: number; bytes: number[] }

/** a variable-length quantity: seven bits a byte, the high bit set on all but the last */
export function vlq(n: number): number[] {
  let v = Math.max(0, Math.round(n))
  const out = [v & 0x7f]
  v >>= 7
  while (v > 0) {
    out.unshift((v & 0x7f) | 0x80)
    v >>= 7
  }
  return out
}

const text = (s: string) => [...new TextEncoder().encode(s)]
const meta = (type: number, data: number[]) => [0xff, type, ...vlq(data.length), ...data]
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]

function chunk(id: string, body: number[]): number[] {
  return [...text(id), ...u32(body.length), ...body]
}

/** events into a track's bytes: by time, and at the same time a note's end before a note's start */
function track(evs: Ev[]): number[] {
  evs.sort((a, b) => a.tick - b.tick || a.order - b.order)
  const body: number[] = []
  let at = 0
  for (const e of evs) {
    body.push(...vlq(e.tick - at), ...e.bytes)
    at = e.tick
  }
  body.push(0, ...meta(0x2f, []))
  return chunk('MTrk', body)
}

/** the instrument's own name, as the instrument picker says it */
const nameOf = (id: InstrumentId) => INSTRUMENTS.find(([i]) => i === id)?.[2] ?? id

export function songToMidi(song: MidiSong): Uint8Array<ArrayBuffer> {
  const perSecond = (song.bpm / 60) * PPQ
  const tick = (s: number) => Math.max(0, Math.round(s * perSecond))
  const usPerBeat = Math.round(60_000_000 / song.bpm)

  const head: Ev[] = [
    { tick: 0, order: 0, bytes: meta(0x03, text('Song')) },
    {
      tick: 0,
      order: 0,
      bytes: meta(0x51, [(usPerBeat >> 16) & 0xff, (usPerBeat >> 8) & 0xff, usPerBeat & 0xff]),
    },
    /* 4/4, a click every quarter, eight 32nds a quarter */
    { tick: 0, order: 0, bytes: meta(0x58, [4, 2, 24, 8]) },
  ]
  const tracks = [track(head)]

  let next = 0
  song.layers.forEach((l, i) => {
    const drums = l.instrument === 'drums'
    /* channel 10 (9 from zero) is the kit's; the rest take the others in turn */
    let ch = 9
    if (!drums) {
      ch = next % 15
      if (ch >= 9) ch++
      next++
    }
    const evs: Ev[] = [
      {
        tick: 0,
        order: 0,
        bytes: meta(0x03, text(`${i + 1} ${nameOf(l.instrument)}${l.muted ? ' (muted)' : ''}`)),
      },
    ]
    if (l.instrument !== 'drums')
      evs.push({ tick: 0, order: 1, bytes: [0xc0 | ch, GM_PROGRAM[l.instrument]] })
    for (const n of notesInSong(l, song.bpm, song.bars)) {
      const key = drums
        ? GM_DRUM[((n.midi % 12) + 12) % 12]
        : Math.max(0, Math.min(127, Math.round(n.midi)))
      const on = tick(n.t)
      const off = Math.max(on + 1, tick(n.t + n.dur))
      evs.push({ tick: on, order: 3, bytes: [0x90 | ch, key, 100] })
      evs.push({ tick: off, order: 2, bytes: [0x80 | ch, key, 64] })
    }
    /* the words, each syllable where it is sung, with a space after a word's last syllable */
    if (hasLyrics(l)) {
      const sung = fitSongLyrics(l, song).sung.filter((s) => !s.hold && s.text)
      sung.forEach((s, k) => {
        const after = sung[k + 1]
        const gap = !after || after.start !== false ? ' ' : ''
        evs.push({ tick: tick(s.t), order: 2.5, bytes: meta(0x05, text(s.text + gap)) })
      })
    }
    tracks.push(track(evs))
  })

  const header = chunk('MThd', [
    0,
    1,
    (tracks.length >> 8) & 0xff,
    tracks.length & 0xff,
    (PPQ >> 8) & 0xff,
    PPQ & 0xff,
  ])
  return new Uint8Array([...header, ...tracks.flat()])
}
