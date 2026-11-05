import { describe, expect, it } from 'vitest'
import { soundingBook } from './sounding'

/**
 * A note is released as the note it STARTED as.
 *
 * The bug this book replaces: the instrument room recomputed the pitch at release time from the
 * octave, scale and key as they stood THEN. Measured in the pane — hold `z`, press Octave up, let
 * go, return to octave 4, and C4 is lit with nothing pressed. These tests state the property that
 * makes that impossible rather than the arithmetic that got it wrong, because the arithmetic is
 * exactly what disagreed with itself.
 *
 * ⚠️ EVERY TEST HERE CHANGES SOMETHING BETWEEN THE PRESS AND THE RELEASE, or asks about a case
 * where one press is more than one note. A suite that pressed and released in the same breath
 * would pass against the old code too.
 */

describe('a press and its release', () => {
  it('releases what it started, not what the same key would play now', () => {
    const book = soundingBook()
    book.start('k:z', [60])
    /* the octave moves under the finger — the room would now compute 72 for this key */
    expect(book.end('k:z')).toEqual([{ voice: 'k:z', midi: 60 }])
  })

  it('leaves nothing lit afterwards, which is the symptom that was reported', () => {
    const book = soundingBook()
    book.start('k:z', [60])
    expect(book.notes()).toEqual([60])
    book.end('k:z')
    expect(book.notes()).toEqual([])
    expect(book.open()).toEqual([])
  })

  it('has nothing to release for a key that was never pressed', () => {
    /* a keyup with no keydown is ordinary: hold a key, click away, come back and let go */
    expect(soundingBook().end('k:z')).toEqual([])
  })

  it('ends the same press twice without sounding a second note-off', () => {
    const book = soundingBook()
    book.start('p:1', [60])
    expect(book.end('p:1')).toHaveLength(1)
    expect(book.end('p:1')).toEqual([])
  })
})

describe('one press, several notes', () => {
  it('gives the first note the bare id, so a single note is what it always was', () => {
    /* ⚠️ NOT COSMETIC. `k:z` and `p:1` are the ids the synth has keyed voices by since before
       this file existed; renaming them all to `k:z/0` would be a silent change to every
       single-note press in the room for the sake of a tidier loop. */
    const { play } = soundingBook().start('k:z', [60])
    expect(play[0].voice).toBe('k:z')
  })

  it('gives every other note its own id, so a chord does not stop itself', () => {
    const { play } = soundingBook().start('p:1', [60, 64, 67])
    expect(play.map((v) => v.voice)).toEqual(['p:1', 'p:1/1', 'p:1/2'])
    expect(play.map((v) => v.midi)).toEqual([60, 64, 67])
  })

  it('releases every note of the chord together', () => {
    const book = soundingBook()
    book.start('p:1', [60, 64, 67])
    expect(book.end('p:1')).toHaveLength(3)
    expect(book.notes()).toEqual([])
  })

  it('keeps two presses apart even when their ids share a prefix', () => {
    /* `p:1` and `p:11` are both real pointer ids, and `p:1/1` must not be either of them */
    const book = soundingBook()
    book.start('p:1', [60, 64])
    book.start('p:11', [72])
    expect(book.end('p:11')).toEqual([{ voice: 'p:11', midi: 72 }])
    expect(book.notes()).toEqual([60, 64])
  })

  it('lights one key for a note two voices are playing', () => {
    /* two fingers on one key, and a chord that doubles its root an octave up */
    const book = soundingBook()
    book.start('p:1', [60])
    book.start('p:2', [60])
    expect(book.open()).toHaveLength(2)
    expect(book.notes()).toEqual([60])
    book.end('p:1')
    /* still lit: the other finger is still down */
    expect(book.notes()).toEqual([60])
  })

  it('reports notes in the order they were played, not sorted', () => {
    /* a voicing is an order; `notes()` is also what the keyboard reads, and a sort would make a
       test about a chord's shape unable to see it */
    const book = soundingBook()
    book.start('p:1', [67, 60, 64])
    expect(book.notes()).toEqual([67, 60, 64])
  })

  it('sounds nothing and lights nothing for an empty chord', () => {
    const book = soundingBook()
    const { play } = book.start('p:1', [])
    expect(play).toEqual([])
    expect(book.notes()).toEqual([])
    /* and leaves no entry behind to be released later */
    expect(book.end('p:1')).toEqual([])
  })
})

describe('a retrigger', () => {
  it('hands back the voices it was holding, so none is left open', () => {
    /* the keyboard's auto-repeat is guarded by `e.repeat`, but a keydown that never gets its
       keyup — a modifier combination, a dialog stealing focus mid-hold — reaches here as a
       second start on a live id */
    const book = soundingBook()
    book.start('k:z', [60])
    const { stop, play } = book.start('k:z', [64])
    expect(stop).toEqual([{ voice: 'k:z', midi: 60 }])
    expect(play).toEqual([{ voice: 'k:z', midi: 64 }])
    /* and the book now holds only the new note */
    expect(book.notes()).toEqual([64])
  })

  it('stops a wider chord completely when a narrower one replaces it', () => {
    /* ⚠️ THE LEAK THIS GUARDS. Starting [60,64,67] then [60] over the same id must stop all
       three, not just the one whose voice id the new press happens to reuse — otherwise the
       two upper voices are open with nothing left that names them. */
    const book = soundingBook()
    book.start('p:1', [60, 64, 67])
    const { stop } = book.start('p:1', [60])
    expect(stop.map((v) => v.voice)).toEqual(['p:1', 'p:1/1', 'p:1/2'])
    expect(book.open()).toEqual([{ voice: 'p:1', midi: 60 }])
  })

  it('has nothing to stop on a first press', () => {
    expect(soundingBook().start('p:1', [60]).stop).toEqual([])
  })
})

describe('clear', () => {
  it('hands back everything open, which is the blur case', () => {
    /* a key still down when the window loses focus never gets its keyup */
    const book = soundingBook()
    book.start('k:z', [60, 64])
    book.start('p:1', [72])
    expect(book.clear()).toHaveLength(3)
    expect(book.open()).toEqual([])
    expect(book.notes()).toEqual([])
  })

  it('leaves the book usable', () => {
    const book = soundingBook()
    book.start('k:z', [60])
    book.clear()
    book.start('k:z', [62])
    expect(book.notes()).toEqual([62])
  })

  it('has nothing to hand back when nothing is sounding', () => {
    expect(soundingBook().clear()).toEqual([])
  })
})

describe('two books', () => {
  it('do not share state', () => {
    /* the room makes one per mount; a module-level Map would carry a stuck note across a
       navigation, which is the shape of bug this whole file is about */
    const a = soundingBook()
    const b = soundingBook()
    a.start('k:z', [60])
    expect(b.notes()).toEqual([])
    expect(b.end('k:z')).toEqual([])
  })
})

describe('which key is under a finger', () => {
  /**
   * ⚠️ CHORDS MADE THE LIT KEYS AMBIGUOUS. Before them, every highlighted key was one somebody
   * was touching. A triad lights three and only one was pressed — so the keyboard needs to tell
   * the two apart, and the book is the only thing that can, because only it knows which notes
   * arrived together and in which order.
   */
  it('is the first note of the press, not the lowest note sounding', () => {
    const book = soundingBook()
    /* a chord rooted above a note held by the other hand: the lead is 64, not 60 */
    book.start('p:1', [60])
    book.start('p:2', [64, 67, 71])
    expect(book.leads()).toEqual([60, 64])
    expect(book.notes()).toEqual([60, 64, 67, 71])
  })

  it('is every note when nothing is a chord, so a plain keyboard is unchanged', () => {
    const book = soundingBook()
    book.start('k:z', [60])
    book.start('k:x', [62])
    expect(book.leads()).toEqual(book.notes())
  })

  it('stops being a lead when that press ends', () => {
    const book = soundingBook()
    book.start('p:1', [60, 64, 67])
    expect(book.leads()).toEqual([60])
    book.end('p:1')
    expect(book.leads()).toEqual([])
  })

  it('counts a note once when two presses lead with it', () => {
    const book = soundingBook()
    book.start('p:1', [60, 64])
    book.start('p:2', [60, 67])
    expect(book.leads()).toEqual([60])
  })

  it('still names the lead when another press ADDED the same note', () => {
    /* press A's chord reaches 67; press B is a finger on 67. It is a lead — a finger beats a
       chord tone, or the key you are touching would draw as one you are not. */
    const book = soundingBook()
    book.start('p:1', [60, 64, 67])
    book.start('p:2', [67, 71, 74])
    expect(book.leads()).toEqual([60, 67])
  })

  it('has no leads when nothing is sounding', () => {
    const book = soundingBook()
    expect(book.leads()).toEqual([])
    book.start('p:1', [60])
    book.clear()
    expect(book.leads()).toEqual([])
  })
})
