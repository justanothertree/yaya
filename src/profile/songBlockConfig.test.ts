import { describe, expect, it } from 'vitest'
import { songFromConfig, songsFromConfig } from './songBlockConfig'
import { readSong } from '../audio/songFile'

/**
 * What a song block holds, and the two keys it can hold it under.
 *
 * ⚠️ THIS EXISTS BECAUSE THE DIFFERENCE BETWEEN THEM EMPTIED A WHOLE PROFILE. `song` is one
 * packed song and `songs` is a playlist; the singular reader only ever looks at the first, which
 * is correct for what it is and was wrong for the question the page was asking it. isBlockEmpty
 * asked the singular one, so every block built as a playlist answered "yes, empty" — and
 * ProfileBlocksView returns NULL when nothing will draw, so a page whose only visible block was
 * a playlist rendered no grid, no tabs and no slot. Found on the live site: the server returning
 * one public song block and the page showing none of it.
 *
 * ⚠️ THE TEST IS ABOUT THE PAIR, NOT ABOUT EITHER ONE. Each function is right on its own; what
 * was wrong was which one a caller reached for, so what is pinned here is the thing that makes
 * them confusable — that a real playlist is invisible to the singular reader.
 */

/** the smallest thing readSong will vouch for — one layer with one event */
const aSong = (name: string) => ({
  name,
  bpm: 96,
  bars: 2,
  /* ⚠️ the shape readLayer really wants: midi + t + on, and at least one note ON —
     the first fixture here used {at, pitch, dur} and was refused, which the last test in
     this file now catches before any of the others can lie about what they proved. */
  layers: [
    {
      instrument: 'keys',
      len: 2,
      events: [
        { t: 0, midi: 60, on: true },
        { t: 0.5, midi: 60, on: false },
      ],
    },
  ],
})

describe('a song block holds one song or a playlist', () => {
  it('reads a block made the old way, under `song`', () => {
    const cfg = { song: aSong('old') }
    expect(songFromConfig(cfg), 'the singular reader').not.toBeNull()
    expect(songsFromConfig(cfg).length, 'and the plural one agrees').toBe(1)
  })

  /** ⚠️ THE ONE THAT WAS WRONG: a playlist is invisible to the singular reader, by design */
  it('and a playlist under `songs` is invisible to the singular reader', () => {
    const cfg = { songs: [aSong('a'), aSong('b')] }
    expect(songFromConfig(cfg), 'nothing under `song`').toBeNull()
    expect(songsFromConfig(cfg).length, 'but the playlist is really there').toBe(2)
  })

  /**
   * ⚠️ AND THIS IS THE ACTUAL CLAIM — "does this block hold a song" has exactly one right
   * answer, and it is the plural reader's. Asking the singular is what made a real block read
   * as an empty one.
   */
  it('so "has this block got anything in it" must ask the plural one', () => {
    const playlist = { songs: [aSong('only')] }
    const holdsSomething = songsFromConfig(playlist).length > 0
    expect(holdsSomething, 'a playlist block is not empty').toBe(true)
  })

  /** ⚠️ and a block with both is a playlist whose first track was set the old way */
  it('and a block with both keeps them in order, the old one first', () => {
    const cfg = { song: aSong('first'), songs: [aSong('second')] }
    expect(songsFromConfig(cfg).map((s) => s.name)).toEqual(['first', 'second'])
  })

  /** ⚠️ and an empty block is still empty, which is the case the filter is actually for */
  it('and nothing in it is still nothing', () => {
    for (const cfg of [{}, { songs: [] }, { song: null }, { songs: ['junk'] }]) {
      expect(songsFromConfig(cfg as Record<string, unknown>).length, JSON.stringify(cfg)).toBe(0)
    }
  })

  /** ⚠️ the fixture has to be a thing readSong actually vouches for, or this proves nothing */
  it('and the song used above is one the reader accepts', () => {
    expect(readSong(aSong('check'))).not.toBeNull()
  })
})
