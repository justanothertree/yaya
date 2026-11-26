import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Layer } from '../audio/looper'

/**
 * ✚ New song, asked through the real looper, library, name store and undo history — the modules
 * the button reaches — with only `window` and `localStorage` stood in, as songName.test.ts does.
 *
 * ⚠️ "A NEW SONG" IS MEASURED AGAINST A PAGE THAT HAS JUST OPENED, not against FRESH_BPM. A test
 * comparing the reset with the constant the reset uses would agree with any value the constant
 * had; a looper module loaded fresh is what a new song is supposed to look like.
 */

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
afterEach(() => {
  vi.unstubAllGlobals()
  vi.doUnmock('../audio/looper')
  vi.restoreAllMocks()
})

const fx = { echo: 0, echoTime: 0.3, space: 0, vibrato: 0, glide: 0, tone: 0.5 }
const part = (id = 'k', over: Partial<Layer> = {}): Layer => ({
  id,
  instrument: 'keys',
  events: [
    { t: 0, midi: 60, on: true },
    { t: 0.5, midi: 60, on: false },
  ],
  muted: false,
  len: 2,
  fx,
  ...over,
})

const fresh = async () => ({
  ns: await import('./newSong'),
  lp: await import('../audio/looper'),
  lib: await import('../audio/library'),
  file: await import('../audio/songFile'),
  names: await import('./songName'),
})

/** a confirm that records what it was asked and answers `yes` */
function asker(yes: boolean) {
  const asked: string[] = []
  return { asked, confirm: (q: string) => (asked.push(q), yes) }
}
const never = () => {
  throw new Error('asked, when there was nothing to lose')
}

describe('a new song', () => {
  it('is the song a page opens with: no parts, its tempo, its length, and no name', async () => {
    const { lp: pristine } = await fresh()
    const opened = { bpm: pristine.loopState().bpm, bars: pristine.loopState().bars }
    vi.resetModules()
    const { ns, lp, names } = await fresh()
    lp.loadSong(140, 4, [part('a'), part('b', { instrument: 'bass' })])
    names.setSongName('Sunday')
    const { confirm } = asker(true)
    expect(ns.startNewSong({ saved: [], confirm })).toBe(true)
    const now = lp.loopState()
    expect(now.layers).toEqual([])
    expect({ bpm: now.bpm, bars: now.bars }).toEqual(opened)
    expect(names.songName()).toBe(null)
  })

  it('does nothing and asks nothing when the song is new already', async () => {
    const { ns } = await fresh()
    expect(ns.startNewSong({ saved: [], confirm: never })).toBe(false)
  })

  it('treats a tempo changed on an empty song as nothing to lose', async () => {
    const { ns, lp } = await fresh()
    lp.loadSong(150, 3, [])
    expect(ns.startNewSong({ saved: [], confirm: never })).toBe(true)
    expect(lp.loopState().bpm).not.toBe(150)
  })
})

describe('asking first, so nobody loses work by accident', () => {
  it('asks before clearing parts nobody kept, and leaves everything as it was when told no', async () => {
    const { ns, lp, names } = await fresh()
    lp.loadSong(120, 4, [part('a')])
    names.setSongName('Sunday')
    const { asked, confirm } = asker(false)
    expect(ns.startNewSong({ saved: [], confirm })).toBe(false)
    expect(asked).toEqual(['Start a new song? Anything you haven’t kept will be lost.'])
    const now = lp.loopState()
    expect(now.layers.map((l) => l.id)).toEqual(['a'])
    expect([now.bpm, now.bars]).toEqual([120, 4])
    expect(names.songName()).toBe('Sunday')
  })

  it('asks nothing when the song is exactly one you kept, even kept under another name', async () => {
    const { ns, lp, lib, file } = await fresh()
    /* lyrics with spaces round them: a kept copy is tidied on the way in, and is still this song */
    const layers = [part('a', { lyrics: ['  la la  ', 'hey'] }), part('b', { gain: 1.2 })]
    lp.loadSong(120, 4, layers)
    expect(lib.saveToLibrary('song', file.toSong('An old name', 120, 4, layers))).not.toBe(null)
    expect(ns.startNewSong({ saved: lib.library(), confirm: never })).toBe(true)
    expect(lp.loopState().layers).toEqual([])
  })

  it('asks again once a kept song has been changed, and not once it is changed back', async () => {
    const { ns, lp, lib, file } = await fresh()
    lp.loadSong(120, 4, [part('a'), part('b')])
    lib.saveToLibrary('song', file.toSong('Kept', 120, 4, lp.loopState().layers))
    lp.toggleMute('b')
    expect(ns.wouldLose(lp.loopState(), lib.library())).toBe(true)
    lp.toggleMute('b')
    expect(ns.wouldLose(lp.loopState(), lib.library())).toBe(false)
    lp.setBars(8)
    expect(ns.wouldLose(lp.loopState(), lib.library())).toBe(true)
  })

  it('does not count a kept LOOP as the song being kept', async () => {
    const { ns, lp, lib, file } = await fresh()
    lp.loadSong(120, 4, [part('a')])
    lib.saveToLibrary('loop', file.toSong('A loop', 120, 4, lp.loopState().layers))
    expect(ns.wouldLose(lp.loopState(), lib.library())).toBe(true)
  })
})

describe('recordings on the loop', () => {
  /**
   * ⚠️ A RECORDING CAN ONLY BE PLACED THROUGH IndexedDB AND A DECODER, neither of which this runs
   * in, so the loop is shown holding two through `loopState` and the rest of the looper is real.
   */
  const withTakes = async () => {
    vi.doMock('../audio/looper', async (orig) => {
      const real = await orig<typeof import('../audio/looper')>()
      return {
        ...real,
        loopState: () => ({ ...real.loopState(), takes: [{ id: 't1' }, { id: 't2' }] }),
      }
    })
    return fresh()
  }

  it('always asks, says they stay in Voice, and takes each one off the loop when told yes', async () => {
    const { ns, lp, lib, file } = await withTakes()
    lp.loadSong(120, 4, [part('a')])
    /* kept parts are not enough: where the recordings sit is never in a kept song */
    lib.saveToLibrary('song', file.toSong('Kept', 120, 4, [part('a')]))
    const lifted: string[] = []
    const { asked, confirm } = asker(true)
    expect(ns.startNewSong({ saved: lib.library(), confirm, lift: (id) => lifted.push(id) })).toBe(
      true,
    )
    expect(asked).toEqual([
      'Start a new song? Anything you haven’t kept will be lost. Your recordings stay in 🎤 Voice.',
    ])
    expect(lifted).toEqual(['t1', 't2'])
  })

  it('takes none off when told no', async () => {
    const { ns, lp } = await withTakes()
    lp.loadSong(120, 4, [])
    const lifted: string[] = []
    expect(
      ns.startNewSong({ saved: [], confirm: () => false, lift: (id) => lifted.push(id) }),
    ).toBe(false)
    expect(lifted).toEqual([])
  })
})

describe('a way back', () => {
  it('↶ Undo brings the old parts, tempo and length back', async () => {
    const { ns, lp } = await fresh()
    const hist = await import('../audio/history')
    hist.resetHistoryForTests()
    lp.fromElsewhere(() => lp.loadSong(120, 4, [part('a'), part('b')]))
    hist.startHistory()
    expect(ns.startNewSong({ saved: [], confirm: () => true })).toBe(true)
    expect(lp.loopState().layers).toEqual([])
    expect(hist.undo()).toBe(true)
    const back = lp.loopState()
    expect(back.layers.map((l) => l.id)).toEqual(['a', 'b'])
    expect([back.bpm, back.bars]).toEqual([120, 4])
  })
})
