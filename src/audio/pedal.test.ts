import { describe, expect, it } from 'vitest'
import { pedalBook } from './pedal'
import { soundingBook } from './sounding'

/**
 * A sustain pedal, and the one case that is genuinely hard.
 *
 * Holding notes after the finger leaves is three lines. What is not obvious is what happens
 * when you press a key whose last note is STILL PEDALLED: the synth keys voices by id, so
 * striking `k:z` again stops the old `k:z` and starts a new one under the same name. The pedal
 * is then holding a reference to a voice that no longer exists — and lifting the pedal sends a
 * note-off to the NEW note, cutting off a key the person is still holding down.
 *
 * That is the bug this file is mostly about. The symptom — "sometimes letting go of the pedal
 * kills a note I am playing" — gives away nothing about the cause.
 */

const v = (voice: string, midi: number) => ({ voice, midi })

describe('holding after the finger leaves', () => {
  it('keeps what was let go of', () => {
    const p = pedalBook()
    p.hold([v('k:z', 60), v('k:x', 62)])
    expect(
      p
        .open()
        .map((x) => x.midi)
        .sort(),
    ).toEqual([60, 62])
  })

  it('hands everything back when the pedal comes up, once', () => {
    const p = pedalBook()
    p.hold([v('k:z', 60)])
    expect(p.release()).toEqual([v('k:z', 60)])
    expect(p.release()).toEqual([])
    expect(p.open()).toEqual([])
  })

  it('has nothing to release when nothing was pedalled', () => {
    expect(pedalBook().release()).toEqual([])
  })

  it('does not store the same voice twice', () => {
    /* two presses of one key, both pedalled, must not leave two note-offs pointing at one
       voice — the second would land on whatever has taken that id since */
    const p = pedalBook()
    p.hold([v('k:z', 60)])
    p.hold([v('k:z', 60)])
    expect(p.open()).toHaveLength(1)
  })

  it('accumulates across several presses', () => {
    const p = pedalBook()
    for (const n of [60, 62, 64, 65]) p.hold([v('k:' + n, n)])
    expect(p.open()).toHaveLength(4)
  })
})

describe('striking a key that is still pedalled', () => {
  it('forgets it, because the synth has already replaced it', () => {
    /**
     * ⚠️ THE ONE THAT MATTERS. `noteOn` retriggers by id, so the old voice is gone the instant
     * the key is pressed again — nothing needs stopping, and the stale entry must not survive
     * to be stopped later.
     */
    const p = pedalBook()
    p.hold([v('k:z', 60)])
    p.forget(['k:z'])
    expect(p.open()).toEqual([])
    expect(p.release()).toEqual([])
  })

  it('leaves the other pedalled notes alone', () => {
    const p = pedalBook()
    p.hold([v('k:z', 60), v('k:x', 62), v('k:c', 64)])
    p.forget(['k:x'])
    expect(p.open().map((x) => x.voice)).toEqual(['k:z', 'k:c'])
  })

  it('forgets every voice of a re-struck chord, not just its root', () => {
    /* a chord press owns `p:1`, `p:1/1`, `p:1/2` — re-striking replaces all three */
    const p = pedalBook()
    p.hold([v('p:1', 60), v('p:1/1', 64), v('p:1/2', 67)])
    p.forget(['p:1', 'p:1/1', 'p:1/2'])
    expect(p.open()).toEqual([])
  })

  it('shrugs at an id it never held', () => {
    const p = pedalBook()
    p.hold([v('k:z', 60)])
    p.forget(['k:q', 'nonsense'])
    expect(p.open()).toHaveLength(1)
  })
})

describe('with the sounding book beside it', () => {
  /**
   * The two answer different questions and that is the point: `sounding` is what somebody is
   * HOLDING, which the lit keys read, and the pedal is what is still making a NOISE. The pedal
   * exists precisely because those stop being the same thing.
   */
  it('lights no key for a note the pedal is holding', () => {
    const book = soundingBook()
    const p = pedalBook()
    book.start('k:z', [60])
    expect(book.notes()).toEqual([60])
    p.hold(book.end('k:z'))
    expect(book.notes(), 'the finger has gone, so the key is dark').toEqual([])
    expect(
      p.open().map((x) => x.midi),
      'but it is still sounding',
    ).toEqual([60])
  })

  it('survives the whole cycle: press, release, press again, pedal up', () => {
    /* the sequence the hard case actually arrives as */
    const book = soundingBook()
    const p = pedalBook()
    p.hold(book.start('k:z', [60]).stop)
    p.hold(book.end('k:z'))
    expect(p.open()).toHaveLength(1)

    /* struck again while pedalled */
    const again = book.start('k:z', [60])
    p.forget(again.play.map((x) => x.voice))
    expect(p.open(), 'the stale voice is gone').toEqual([])

    /* and the pedal coming up must not touch the key still being held */
    expect(p.release()).toEqual([])
    expect(book.notes(), 'still held, still lit').toEqual([60])
  })

  it('holds a whole chord and gives all of it back', () => {
    const book = soundingBook()
    const p = pedalBook()
    book.start('p:1', [60, 64, 67])
    p.hold(book.end('p:1'))
    expect(p.open()).toHaveLength(3)
    expect(p.release().map((x) => x.midi)).toEqual([60, 64, 67])
  })
})
