import { describe, expect, it } from 'vitest'
import { PATTERN_MARKS, markOf, readMark, uniqueMarks } from './patternMark'

/**
 * The tag that says which picker owns a layer.
 *
 * ⚠️ IT ENDS UP INSIDE A LAYER ID, which the scheduler builds voice ids from and the sounding
 * book keys on — so a file's string reaches further into the room than most, and the shape test
 * is the whole of the defence. These are written as claims about what a mark IS rather than as a
 * second copy of the regex.
 */

describe('reading a mark off a live id', () => {
  it('finds the tag the pickers put there', () => {
    expect(markOf('1793939405153-chords:four')).toBe('-chords:four')
    expect(markOf('1793939405153-beat:straight')).toBe('-beat:straight')
    expect(markOf('1793939405153-bass:fifties')).toBe('-bass:fifties')
  })

  it('is nothing on an ordinary recorded layer', () => {
    expect(markOf('1793939405153')).toBeNull()
    expect(markOf('1793939405153-0')).toBeNull()
    expect(markOf('1793939405153-blank')).toBeNull()
  })

  it('and nothing when the tag is not one a picker could have written', () => {
    /* a layer id is minted by this app, but it has come off a file before now */
    expect(markOf('x-chords:FOUR'), 'uppercase').toBeNull()
    expect(markOf('x-chords:a b'), 'a space').toBeNull()
    expect(markOf('x-chords:' + 'a'.repeat(25)), 'too long').toBeNull()
  })

  it('accepts a picker with no pattern name, which is what an empty one looks like', () => {
    expect(markOf('123-beat:')).toBe('-beat:')
  })
})

describe('reading a mark off the wire', () => {
  it('takes the shapes the app writes', () => {
    for (const mark of PATTERN_MARKS) expect(readMark(mark + 'four'), mark).toBe(mark + 'four')
  })

  it('refuses everything else rather than trusting it into an id', () => {
    for (const bad of [
      '',
      'chords:four',
      '-chords',
      '-nope:four',
      '-chords:four/../x',
      '-chords:' + 'a'.repeat(25),
      '-chords:<script>',
      ' -chords:four',
      '-chords:four ',
      42,
      null,
      undefined,
      {},
      ['-chords:four'],
    ] as unknown[]) {
      expect(readMark(bad), JSON.stringify(bad)).toBeNull()
    }
  })

  /**
   * ⚠️ THE PROPERTY, because the list above can only ever be the cases somebody thought of.
   * Whatever comes back must be usable as part of an id without changing how an id parses.
   */
  it('and whatever it does accept is safe to splice into an id', () => {
    for (const s of ['-chords:four', '-beat:boom-bap', '-bass:', '-chords:x1-2-3']) {
      const got = readMark(s)
      expect(got, s).not.toBeNull()
      expect(markOf('12345' + got!), 'round trips through a live id').toBe(got)
    }
  })
})

describe('handing each mark out once', () => {
  it('keeps the first of a repeated mark and drops the rest', () => {
    /* nothing the app writes can produce two chord layers; a file can simply say so, and two
       pads on different progressions is the thing the whole backing is built to prevent */
    expect(uniqueMarks(['-chords:four', '-bass:four', '-chords:fifties'])).toEqual([
      '-chords:four',
      '-bass:four',
      null,
    ])
  })

  it('leaves a full set of different marks alone', () => {
    const all = ['-beat:straight', '-chords:four', '-bass:four']
    expect(uniqueMarks(all)).toEqual(all)
  })

  it('passes untagged layers through as untagged', () => {
    expect(uniqueMarks([undefined, null, '', '-chords:four'])).toEqual([
      null,
      null,
      null,
      '-chords:four',
    ])
  })

  it('and drops a tag it would not have accepted in the first place', () => {
    expect(uniqueMarks(['-chords:NOPE', '-chords:four'])).toEqual([null, '-chords:four'])
  })
})
