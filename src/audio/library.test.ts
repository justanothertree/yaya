import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Layer } from './looper'
import { toSong } from './songFile'

/**
 * The Library, asked the question the parser's own tests could not answer: where does a song
 * lose what it lost?
 *
 * ⚠️ AT KEEP, NOT AT REOPEN — which is the opposite of how the bug was first written down.
 * `saveToLibrary` passes the song through `readSong` BEFORE it stores it, so the parser's old
 * ceilings (8 bars, a gain of 1.5) were applied on the way in: a sixteen-bar arrangement was
 * stored as eight and a layer at 1.8 was stored at 1.5. Two consequences, and the second is the
 * one that matters for anybody who has already kept something:
 *
 *   · from now on a keep holds the bar count and the fader the room actually offered, and
 *   · a song kept BEFORE the fix plays exactly as it did, because what is on disk is already
 *     the clamped value — raising the reader's ceiling changes no stored song's level or length.
 *
 * ⚠️ IT READS THE STORE BACK FROM A FRESH MODULE. library.ts caches what it has read, so
 * asking the same instance would answer from memory and prove nothing about the disk.
 */

const store = new Map<string, string>()

beforeEach(() => {
  store.clear()
  vi.resetModules()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
})

const fresh = () => import('./library')

const loud = (over: Partial<Layer> = {}): Layer => ({
  id: 'x-0',
  instrument: 'rhodes',
  muted: false,
  len: 2,
  gain: 1.8,
  fx: { echo: 0, echoTime: 0.26, space: 0, vibrato: 0, glide: 0, tone: 0.5 },
  events: [
    { t: 0, midi: 60, on: true },
    { t: 0.5, midi: 60, on: false },
  ],
  ...over,
})

describe('a song kept in the Library', () => {
  it('is stored with the bar count the room offered, not the parser’s old eight', async () => {
    const { saveToLibrary } = await fresh()
    expect(saveToLibrary('song', toSong('Long', 96, 16, [loud()]))!.song.bars).toBe(16)
    /* …and off the disk, through a module that has never seen it */
    const { library } = await fresh()
    expect(library()[0].song.bars).toBe(16)
  })

  it('and with the fader where it was left, not the parser’s old 1.5', async () => {
    const { saveToLibrary } = await fresh()
    saveToLibrary('song', toSong('Loud', 96, 2, [loud()]))
    const { library } = await fresh()
    expect(library()[0].song.layers[0].gain).toBe(1.8)
  })

  it('and a song already kept at the old ceilings reopens exactly as it was stored', async () => {
    /* the shape on disk of a keep made before this fix: clamped on the way in, so 8 and 1.5 */
    store.set(
      'inst_library_v1',
      JSON.stringify([
        {
          id: 'old',
          kind: 'song',
          name: 'Old',
          at: 1,
          song: toSong('Old', 96, 8, [loud({ gain: 1.5 })]),
        },
      ]),
    )
    const { library } = await fresh()
    expect(library()[0].song.bars).toBe(8)
    expect(library()[0].song.layers[0].gain).toBe(1.5)
  })
})
