import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearLayers,
  fromElsewhere,
  loadSong,
  loopState,
  moveLayerBar,
  putSharedLayer,
  removeLayer,
  setBars,
  setBpm,
  setLayerGain,
  setLayersShared,
  toggleMute,
  type Layer,
} from './looper'
import { historyNow, redo, resetHistoryForTests, startHistory, undo } from './history'

/**
 * Room-wide undo, driven through the looper's own edits — the same calls the room's buttons make.
 *
 * ⚠️ EVERY EXPECTATION IS WHAT THE ROOM LOOKS LIKE AFTERWARDS — which layers, in which order,
 * muted or not, how many bars — never the shape of the history's own records. A test that read
 * the undo stack would be checking the bookkeeping against itself.
 */

const fx = { echo: 0, echoTime: 0.26, space: 0, vibrato: 0, glide: 0, tone: 0.5 }
const layer = (id: string, over: Partial<Layer> = {}): Layer => ({
  id,
  instrument: 'rhodes',
  muted: false,
  len: 4,
  gain: 0.8,
  fx,
  events: [
    { t: 0, midi: 60, on: true },
    { t: 0.5, midi: 60, on: false },
  ],
  ...over,
})
const ids = () => loopState().layers.map((l) => l.id)
const byId = (id: string) => loopState().layers.find((l) => l.id === id)

let clock = 1_000_000
beforeEach(() => {
  resetHistoryForTests()
  /* the bench as the page opened it — not an edit anybody made */
  fromElsewhere(() => loadSong(120, 2, [layer('a'), layer('b'), layer('c')]))
  startHistory()
  clock += 10_000
  vi.spyOn(Date, 'now').mockImplementation(() => clock)
})
afterEach(() => vi.restoreAllMocks())
/** time passing between two separate actions — more than a slider drag lasts */
const later = () => (clock += 5_000)

describe('undo takes back the last change to the room', () => {
  it('a deleted layer comes back where it was, and redo deletes it again', () => {
    removeLayer('b')
    expect(ids()).toEqual(['a', 'c'])
    expect(undo()).toBe(true)
    expect(ids()).toEqual(['a', 'b', 'c'])
    expect(redo()).toBe(true)
    expect(ids()).toEqual(['a', 'c'])
  })

  it('Clear all is one step, and undo brings every layer back', () => {
    clearLayers()
    expect(ids()).toEqual([])
    undo()
    expect(ids()).toEqual(['a', 'b', 'c'])
  })

  it('a song opened over the work can be undone', () => {
    loadSong(90, 4, [layer('x'), layer('y')])
    undo()
    expect(ids()).toEqual(['a', 'b', 'c'])
    expect(loopState().bpm).toBe(120)
    expect(loopState().bars).toBe(2)
  })

  it('a tempo change takes its rescaled notes back with it', () => {
    setBpm(60)
    expect(byId('a')!.len).toBe(8)
    undo()
    expect(loopState().bpm).toBe(120)
    expect(byId('a')!.len).toBe(4)
    expect(byId('a')!.events[1].t).toBe(0.5)
  })

  it('growing the song takes back the bars and the arrangement it carried', () => {
    fromElsewhere(() => moveLayerBar('a', 0, 1))
    const arranged = byId('a')!.plan
    later()
    setBars(4)
    expect(byId('a')!.plan).toHaveLength(4)
    undo()
    expect(loopState().bars).toBe(2)
    expect(byId('a')!.plan).toEqual(arranged)
  })

  it('a bar dragged into place can be undone', () => {
    moveLayerBar('a', 0, 1)
    undo()
    expect(byId('a')!.plan).toBe(undefined)
  })

  it('steps come back one at a time, newest first', () => {
    toggleMute('a')
    later()
    removeLayer('c')
    undo()
    expect(ids()).toEqual(['a', 'b', 'c'])
    expect(byId('a')!.muted).toBe(true)
    undo()
    expect(byId('a')!.muted).toBe(false)
    expect(undo()).toBe(false)
  })
})

describe('what one step is', () => {
  it('a fader dragged for a moment is one step, not sixty', () => {
    for (let i = 0; i < 60; i++) {
      setLayerGain('a', 0.8 + i / 100)
      clock += 15
    }
    undo()
    expect(byId('a')!.gain).toBe(0.8)
    expect(historyNow().undo).toBe(0)
  })

  it('but a fader and then a mute are two', () => {
    setLayerGain('a', 1.5)
    toggleMute('a')
    undo()
    expect(byId('a')!.muted).toBe(false)
    expect(byId('a')!.gain).toBe(1.5)
  })

  it('a new change after an undo leaves nothing to redo', () => {
    removeLayer('a')
    undo()
    later()
    toggleMute('b')
    expect(redo()).toBe(false)
    expect(ids()).toEqual(['a', 'b', 'c'])
  })

  it('cannot undo past what the page opened with', () => {
    expect(undo()).toBe(false)
    expect(ids()).toEqual(['a', 'b', 'c'])
  })
})

/**
 * ⚠️ OWN CHANGES ONLY IN A JAM — Evan's words. A partner's edit is never something to undo, and
 * an undo never overwrites what a partner did since.
 */
describe('in a jam, undo is yours', () => {
  it('a partner muting your layer is not a step you can undo', () => {
    putSharedLayer({ ...byId('a')!, muted: true })
    expect(undo()).toBe(false)
    expect(byId('a')!.muted).toBe(true)
  })

  it('and undoing your own earlier change leaves their later one alone', () => {
    setLayerGain('a', 1.5)
    later()
    /* then a partner mutes it, which arrives as a new version of the layer */
    putSharedLayer({ ...byId('a')!, muted: true })
    undo()
    expect(byId('a')!.muted).toBe(true)
    expect(byId('a')!.gain).toBe(1.5)
  })

  it('a partner’s layer arriving is not a step either', () => {
    putSharedLayer(layer('peer:z', { from: 'peer' }))
    expect(undo()).toBe(false)
    expect(ids()).toContain('peer:z')
  })

  it('your own change to their part is yours to undo', () => {
    putSharedLayer(layer('peer:z', { from: 'peer' }))
    toggleMute('peer:z')
    undo()
    expect(byId('peer:z')!.muted).toBe(false)
  })

  /* the jam marks your layers as shared after sending them; that is not an edit, and it must not
     make every step before it look overwritten */
  it('the jam marking your layers as shared does not stop undo', () => {
    removeLayer('c')
    later()
    toggleMute('a')
    setLayersShared(true)
    undo()
    expect(byId('a')!.muted).toBe(false)
    undo()
    expect(ids()).toEqual(['a', 'b', 'c'])
    expect(byId('a')!.shared).toBe(true)
  })
})
