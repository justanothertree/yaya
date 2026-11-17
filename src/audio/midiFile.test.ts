import { describe, expect, it } from 'vitest'
import type { Layer, LoopEvent } from './looper'
import { GM_DRUM, PPQ, songToMidi, vlq } from './midiFile'

/**
 * The file read back by a parser written here and nowhere else — chunks, variable-length deltas,
 * running time — so a test asks "is there a snare on channel 10 at the second beat", never "did
 * the writer push the bytes the writer pushes".
 */

type Got = { tick: number; status: number; data: number[] }
function parse(bytes: Uint8Array) {
  let p = 0
  const u8 = () => bytes[p++]
  const u16 = () => (u8() << 8) | u8()
  const u32 = () => ((u8() << 24) >>> 0) + (u8() << 16) + (u8() << 8) + u8()
  const id = () => String.fromCharCode(u8(), u8(), u8(), u8())
  const v = () => {
    let n = 0
    for (;;) {
      const b = u8()
      n = (n << 7) | (b & 0x7f)
      if (!(b & 0x80)) return n
    }
  }
  expect(id()).toBe('MThd')
  expect(u32()).toBe(6)
  const head = { format: u16(), tracks: u16(), division: u16() }
  const tracks: Got[][] = []
  for (let k = 0; k < head.tracks; k++) {
    expect(id()).toBe('MTrk')
    const end = u32() + p
    const evs: Got[] = []
    let at = 0
    while (p < end) {
      at += v()
      const status = u8()
      if (status === 0xff) {
        const type = u8()
        const len = v()
        evs.push({ tick: at, status: 0xff00 | type, data: [...bytes.slice(p, p + len)] })
        p += len
      } else {
        const n = (status & 0xf0) === 0xc0 ? 1 : 2
        evs.push({ tick: at, status, data: [...bytes.slice(p, p + n)] })
        p += n
      }
    }
    tracks.push(evs)
  }
  expect(p).toBe(bytes.length)
  return { head, tracks }
}
const word = (d: number[]) => new TextDecoder().decode(new Uint8Array(d))
const ons = (t: Got[]) => t.filter((e) => (e.status & 0xf0) === 0x90 && e.data[1] > 0)

/** notes into a take's events: each an on and an off */
const take = (notes: [number, number, number][]): LoopEvent[] =>
  notes.flatMap(([t, dur, midi]) => [
    { t, midi, on: true },
    { t: t + dur, midi, on: false },
  ])
const FX = { echo: 0.2, echoTime: 0.3, space: 0.4, vibrato: 0.1, glide: 0.2, tone: 0.6 }
const layer = (over: Partial<Layer>): Layer => ({
  id: 'x',
  instrument: 'keys',
  events: [],
  muted: false,
  len: 2,
  fx: FX,
  ...over,
})

/* 120 bpm: a beat is half a second and 480 ticks, a bar two seconds; the song is two bars */
const song = {
  bpm: 120,
  bars: 2,
  quantize: 8,
  layers: [
    layer({
      id: 'k',
      events: take([
        [0, 0.4, 60],
        [1, 0.5, 64],
      ]),
      lyrics: ['hel-lo', ''],
    }),
    layer({
      id: 'd',
      instrument: 'drums',
      /* a kick, a snare on beat two, and a kick an octave up on beat four: the same kick */
      events: take([
        [0, 0.1, 36],
        [0.5, 0.1, 38],
        [1.5, 0.1, 48],
      ]),
      muted: true,
      /* arranged to play the first bar and sit out the second */
      plan: [0, null],
      gain: 0.7,
    }),
    layer({ id: 'b', instrument: 'bass', events: take([[0, 1.9, 36]]), gain: 1.3 }),
  ],
}

describe('a song as a MIDI file', () => {
  const { head, tracks } = parse(songToMidi(song))

  it('is format 1, a tempo track and one track per part, at 480 ticks a beat', () => {
    expect(head).toEqual({ format: 1, tracks: 4, division: 480 })
    expect(PPQ).toBe(480)
    /* 120 bpm is half a million microseconds a beat */
    const tempo = tracks[0].find((e) => e.status === 0xff51)!
    expect((tempo.data[0] << 16) | (tempo.data[1] << 8) | tempo.data[2]).toBe(500_000)
    expect(tracks[0].find((e) => e.status === 0xff58)!.data.slice(0, 2)).toEqual([4, 2])
  })

  it('every note where the song plays it, a bar repeating across the song', () => {
    const keys = tracks[1]
    expect(word(keys.find((e) => e.status === 0xff03)!.data)).toBe('1 Keys')
    expect(keys.find((e) => (e.status & 0xf0) === 0xc0)!.data).toEqual([0])
    /* beat 1 and beat 3 of bar one, then the same in bar two: 0s, 1s, 2s, 3s */
    expect(ons(keys).map((e) => [e.tick, e.data[0]])).toEqual([
      [0, 60],
      [960, 64],
      [1920, 60],
      [2880, 64],
    ])
    /* 0.4s long is 384 ticks */
    const off = keys.find((e) => (e.status & 0xf0) === 0x80 && e.data[0] === 60)!
    expect(off.tick).toBe(384)
    expect(ons(keys).every((e) => (e.status & 0x0f) === 0)).toBe(true)
  })

  it('the kit on channel 10, each piece on its General MIDI key, sitting out the bar it is arranged out of', () => {
    const kit = tracks[2]
    expect(word(kit.find((e) => e.status === 0xff03)!.data)).toBe('2 Drums (muted)')
    expect(kit.some((e) => (e.status & 0xf0) === 0xc0)).toBe(false)
    expect(ons(kit).every((e) => e.status === 0x99)).toBe(true)
    expect(ons(kit).map((e) => [e.tick, e.data[0]])).toEqual([
      [0, 36],
      [480, 38],
      [1440, 36],
    ])
    expect(GM_DRUM).toHaveLength(12)
  })

  it('a melodic part after the kit takes the next channel and its own sound', () => {
    const bass = tracks[3]
    expect(bass.find((e) => (e.status & 0xf0) === 0xc0)!.data).toEqual([33])
    expect(ons(bass).every((e) => (e.status & 0x0f) === 1)).toBe(true)
  })

  it('the sung part carries its words, each syllable where it is sung, a space after a word', () => {
    const lyr = tracks[1].filter((e) => e.status === 0xff05).map((e) => [e.tick, word(e.data)])
    expect(lyr).toEqual([
      [0, 'hel'],
      [960, 'lo '],
    ])
    expect(tracks[2].some((e) => e.status === 0xff05)).toBe(false)
  })

  it('a note ending where the same note starts again lets go first, so the second sounds', () => {
    const { tracks: t } = parse(
      songToMidi({
        ...song,
        bars: 1,
        layers: [
          layer({
            events: take([
              [0, 0.5, 60],
              [0.5, 0.5, 60],
            ]),
          }),
        ],
      }),
    )
    const at480 = t[1].filter((e) => e.tick === 480 && (e.status & 0xe0) === 0x80)
    expect(at480.map((e) => e.status & 0xf0)).toEqual([0x80, 0x90])
  })

  it('writes a delta as seven bits a byte, the high bit set on all but the last', () => {
    expect(vlq(0)).toEqual([0])
    expect(vlq(127)).toEqual([0x7f])
    expect(vlq(128)).toEqual([0x81, 0x00])
    expect(vlq(960)).toEqual([0x87, 0x40])
    expect(vlq(16383)).toEqual([0xff, 0x7f])
    expect(vlq(16384)).toEqual([0x81, 0x80, 0x00])
  })
})
