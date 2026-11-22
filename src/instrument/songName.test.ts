import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Layer } from '../audio/looper'
import { exportName } from './songName'

/* an evening where the person is: in UTC it is already the next day almost everywhere west of it */
const EVENING = new Date(2026, 10, 16, 23, 30)

describe('what an export is called', () => {
  it('is the song and the day, or song- and the day when it has no name', () => {
    expect(exportName('Sunday morning', EVENING)).toBe('Sunday morning 2026-11-16')
    expect(exportName(null, EVENING)).toBe('song-2026-11-16')
    expect(exportName('   ', EVENING)).toBe('song-2026-11-16')
  })

  it('leaves out what a phone or a desktop will not have in a file name', () => {
    expect(exportName('a/b\\c:d*e?f"g<h>i|j', EVENING)).toBe('a b c d e f g h i j 2026-11-16')
    expect(exportName('tab\there\nand\u0000there', EVENING)).toBe('tab here and there 2026-11-16')
    /* a leading dot hides a file on a Mac; a trailing one is renamed away by Windows */
    expect(exportName('..hidden.', EVENING)).toBe('hidden 2026-11-16')
    expect(exportName('///', EVENING)).toBe('song-2026-11-16')
  })

  it('cuts a long name by character, so an emoji at the cut is whole or gone, and keeps the day', () => {
    const long = 'a'.repeat(59) + '🎵🎵🎵'
    const got = exportName(long, EVENING)
    expect(got).toBe('a'.repeat(59) + '🎵 2026-11-16')
    /* no half of a surrogate pair anywhere in it */
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(got)).toBe(
      false,
    )
  })
})

describe('the song keeps its name', () => {
  const disk = new Map<string, string>()
  beforeEach(() => {
    disk.clear()
    vi.resetModules()
    vi.stubGlobal('window', {
      setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
      clearTimeout: (t: ReturnType<typeof setTimeout>) => clearTimeout(t),
      addEventListener: () => {},
    })
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => disk.get(k) ?? null,
      setItem: (k: string, v: string) => void disk.set(k, v),
      removeItem: (k: string) => void disk.delete(k),
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  const part: Layer = {
    id: 'k',
    instrument: 'keys',
    events: [
      { t: 0, midi: 60, on: true },
      { t: 0.5, midi: 60, on: false },
    ],
    muted: false,
    len: 2,
    fx: { echo: 0, echoTime: 0.3, space: 0, vibrato: 0, glide: 0, tone: 0.5 },
  }
  const fresh = async () => ({
    names: await import('./songName'),
    lp: await import('../audio/looper'),
  })

  it('across a reload', async () => {
    const before = await fresh()
    before.names.setSongName('Sunday')
    vi.resetModules()
    const after = await fresh()
    expect(after.names.songName()).toBe('Sunday')
  })

  it('while the bench is put back into an empty room, whichever comes first', async () => {
    disk.set('inst_song_name_v1', 'Sunday')
    const { names, lp } = await fresh()
    const stop = names.forgetWhenEmptied()
    lp.loadSong(120, 1, [part])
    expect(names.songName()).toBe('Sunday')
    stop()
  })

  it('and forgets it when the song empties, so what comes next is not called that', async () => {
    const { names, lp } = await fresh()
    lp.loadSong(120, 1, [part])
    names.setSongName('Sunday')
    const stop = names.forgetWhenEmptied()
    lp.loadSong(100, 1, [{ ...part, id: 'k2' }])
    expect(names.songName()).toBe('Sunday')
    lp.clearLayers()
    expect(names.songName()).toBeNull()
    expect(disk.has('inst_song_name_v1')).toBe(false)
    stop()
  })
})
