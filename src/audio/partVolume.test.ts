import { describe, expect, it, vi } from 'vitest'
import type { Layer } from './looper'

/**
 * Every part of a song has a volume (Evan, 21 Nov 2026): the parts always did, and now each
 * recording and the words. These ask the looper itself, with the audio graph stood in for, what
 * those two faders do — the round trips through a saved song and a reload are in songFile.test.ts
 * and workbench.test.ts.
 */

const fake = vi.hoisted(() => {
  type Node = {
    gain: {
      value: number
      target: number | null
      from: number | null
      setTargetAtTime: (v: number, at: number) => void
    }
    connect: () => void
    disconnect: () => void
  }
  const made: Node[] = []
  const ctx = {
    currentTime: 12.5,
    createGain(): Node {
      const n: Node = {
        gain: {
          value: 1,
          target: null,
          from: null,
          setTargetAtTime: (v: number, at: number) => {
            n.gain.target = v
            n.gain.from = at
          },
        },
        connect: () => {},
        disconnect: () => {},
      }
      made.push(n)
      return n
    },
  }
  return { ctx, made }
})
vi.mock('./context', () => ({ sharedCtx: () => fake.ctx, resumeAudio: () => {} }))
vi.mock('./takeBus', () => ({ takeBus: () => ({}) }))
/* the recordings store, remembering what is written to it the way IndexedDB would */
const kept = vi.hoisted(() => new Map<string, { gain?: number; songAt?: number }>())
vi.mock('./takes', () => ({
  getTake: async (id: string) => ({
    id,
    blob: new Blob(['voice']),
    len: 2,
    at: 0,
    ...kept.get(id),
  }),
  keepOnTake: async (id: string, patch: { gain?: number; songAt?: number }) => {
    const next = { ...kept.get(id) }
    if (patch.gain !== undefined) next.gain = patch.gain
    if (patch.songAt !== undefined) next.songAt = patch.songAt
    kept.set(id, next)
    return true
  },
  hasTake: async () => true,
  TAKE_MAX_SECONDS: 600,
}))
vi.mock('./recordTake', () => ({ decodeTake: async () => ({ duration: 2 }) }))
vi.mock('./takeAudio', () => ({ editedBuffer: (b: unknown) => b }))
vi.mock('./takeFx', async (actual) => ({
  ...(await actual<typeof import('./takeFx')>()),
  makeVoiceChain: () => ({ in: {}, set: () => {}, dispose: () => {} }),
}))

const {
  liftTake,
  loadSong,
  loopState,
  moveLyrics,
  moveTake,
  placeTake,
  setLayerWordsGain,
  setTakeGain,
  settleTake,
} = await import('./looper')

/* a take on the song, by name: loading a song keeps the takes, which sit beside its parts */
const take = (id: string) => loopState().takes.find((t) => t.id === id)

const part = (id: string, over: Partial<Layer> = {}): Layer => ({
  id,
  instrument: 'keys',
  len: 2,
  muted: false,
  fx: { echo: 0, echoTime: 0.3, space: 0, vibrato: 0, glide: 0, tone: 0.5 },
  events: [
    { t: 0, midi: 60, on: true },
    { t: 0.5, midi: 60, on: false },
  ],
  ...over,
})

describe("a recording's volume", () => {
  it('is turned where it stands, so the take already singing gets quieter', async () => {
    loadSong(120, 2, [])
    const before = fake.made.length
    expect(await placeTake('take-a', 1)).toBe(true)
    /* placing it made its level, the one node that outlives every pass */
    const level = fake.made[before]
    expect(level).toBeDefined()
    setTakeGain('take-a', 0.4)
    expect(take('take-a')?.gain).toBe(0.4)
    expect(level.gain.target, 'ramped on the node that stays, not saved for the next pass').toBe(
      0.4,
    )
    /* from a moment ahead of the clock, never from it: currentTime is behind the render head */
    expect(level.gain.from!).toBeGreaterThan(fake.ctx.currentTime)
  })

  it('stays between silent and twice as loud, like a part', async () => {
    loadSong(120, 2, [])
    await placeTake('take-b', 0)
    setTakeGain('take-b', 9)
    expect(take('take-b')?.gain).toBe(2)
    setTakeGain('take-b', -1)
    expect(take('take-b')?.gain).toBe(0)
    setTakeGain('take-b', Number.NaN)
    expect(take('take-b')?.gain, 'not a number changes nothing').toBe(0)
  })

  it('comes back as loud as it was left when it is taken off the song and put back', async () => {
    loadSong(120, 2, [])
    await placeTake('take-c', 2)
    setTakeGain('take-c', 0.3)
    /* kept on the recording once the fader stops, not as it moves */
    expect(kept.get('take-c')?.gain).toBeUndefined()
    await new Promise((r) => setTimeout(r, 450))
    expect(kept.get('take-c')?.gain).toBe(0.3)
    liftTake('take-c')
    const before = fake.made.length
    await placeTake('take-c', 2)
    expect(take('take-c')?.gain).toBe(0.3)
    expect(fake.made[before].gain.value, 'and heard that way from its first note').toBe(0.3)
  })

  it('put back straight after the fader moved, it comes back at the new level', async () => {
    loadSong(120, 2, [])
    await placeTake('take-d', 1)
    setTakeGain('take-d', 0.7)
    /* putting a take back settles what its recording is owed before reading it (useTakes, toLoop) */
    await settleTake('take-d')
    expect(kept.get('take-d')?.gain).toBe(0.7)
    liftTake('take-d')
    await placeTake('take-d', 1)
    expect(take('take-d')?.gain).toBe(0.7)
  })

  it('is nothing to set on a take that is not on the song', () => {
    const was = loopState().takes
    setTakeGain('nowhere', 0.5)
    expect(take('nowhere')).toBeUndefined()
    expect(loopState().takes).toBe(was)
  })
})

describe('where a take was moved', () => {
  it('is kept on its recording once the moving stops, so off the song and back on returns it there', async () => {
    loadSong(120, 2, [])
    await placeTake('take-m', 1)
    moveTake('take-m', 2.5)
    moveTake('take-m', 3)
    expect(kept.get('take-m')?.songAt, 'not on every move').toBeUndefined()
    await settleTake('take-m')
    expect(kept.get('take-m')?.songAt).toBe(3)
  })
})

describe('how loud the words are sung', () => {
  it('goes with the words when they move to another part', () => {
    loadSong(120, 2, [part('a', { lyrics: ['la la', 'la'], wordsGain: 0.3 }), part('b')])
    moveLyrics('a', 'b')
    const [a, b] = loopState().layers
    expect(b.lyrics).toEqual(['la la', 'la'])
    expect(b.wordsGain).toBe(0.3)
    /* the part they left keeps no level for words it no longer has */
    expect(a.lyrics).toBeUndefined()
    expect(a.wordsGain).toBeUndefined()
  })

  it('stays between silent and twice as loud', () => {
    loadSong(120, 2, [part('a', { lyrics: ['la'] })])
    setLayerWordsGain('a', 5)
    expect(loopState().layers[0].wordsGain).toBe(2)
    setLayerWordsGain('a', -2)
    expect(loopState().layers[0].wordsGain).toBe(0)
  })
})

describe('a reload', () => {
  it('puts a take back as loud as it was left', async () => {
    /* the bench is put back only onto an empty room, so what the tests above made goes */
    for (const t of loopState().takes) liftTake(t.id)
    loadSong(120, 2, [])
    const disk = new Map<string, string>()
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
    const { openWorkbench, packWork } = await import('./workbench')
    /* take-s was turned down once and kept that on its recording, then put back to 100% just
       before the page went away: the bench says 100% (which it writes as no gain at all) */
    kept.set('take-s', { gain: 0.3 })
    const left = {
      bpm: 120,
      bars: 2,
      layers: [],
      takes: [
        { id: 'take-r', at: 0.5, gain: 0.55 },
        { id: 'take-s', at: 1, gain: 1 },
      ],
    }
    disk.set('inst_work_v1', JSON.stringify(packWork(left)))
    openWorkbench()
    await new Promise((r) => setTimeout(r, 30))
    expect(take('take-r')?.at).toBe(0.5)
    expect(take('take-r')?.gain, 'a reload used to put every take back at 1').toBe(0.55)
    expect(
      take('take-s')?.gain ?? 1,
      'the bench decides, not an older level on the recording',
    ).toBe(1)
    vi.unstubAllGlobals()
  })
})
