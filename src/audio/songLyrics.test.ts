import { describe, expect, it } from 'vitest'
import { barSays, fitSongLyrics, notesInSong } from './songLyrics'
import { linesFor, tidyLyrics } from './lyricLines'
import { toEvents, type Note } from './noteEdit'

/**
 * A song's words, one line per bar of the song (songLyrics.ts).
 *
 * ⚠️ THE EXPECTATIONS ARE WRITTEN FROM THE SONG'S SHAPE, never from the module's arithmetic: at
 * 120bpm a bar is two seconds, so "the note half a second into the take, in the third bar" is at
 * 4.5s because that is where bar three starts — not because a function said so. The scheduler's
 * own placement is checked against this in the Browser pane (docs/2026-11-15-lyrics-and-layers.md),
 * which shares no code with it.
 */

const BAR = 2 // seconds, at 120bpm
const part = (notes: Note[], len: number, over: Record<string, unknown> = {}) => ({
  events: toEvents(notes, len),
  len,
  ...over,
})
const starts = (ns: Note[]) => ns.map((n) => +n.t.toFixed(3))

describe('the notes a part plays across the song', () => {
  it('repeat a one-bar part in every bar, at the same place in each', () => {
    const p = part([{ midi: 60, t: 0.5, dur: 0.25 }], BAR)
    expect(starts(notesInSong(p, 120, 4))).toEqual([0.5, 2.5, 4.5, 6.5])
  })

  it('leave out the bars somebody switched off', () => {
    const p = part([{ midi: 60, t: 0.5, dur: 0.25 }], BAR, { play: [true, false, true, true] })
    expect(starts(notesInSong(p, 120, 4))).toEqual([0.5, 4.5, 6.5])
  })

  it('follow an arrangement: which bar of the take plays in which bar of the song', () => {
    /* a two-bar take: C in its first bar, E in its second */
    const p = part(
      [
        { midi: 60, t: 0, dur: 0.5 },
        { midi: 64, t: BAR, dur: 0.5 },
      ],
      2 * BAR,
      { plan: [1, 0, null, 1] },
    )
    const got = notesInSong(p, 120, 4).map((n) => [n.t, n.midi])
    expect(got).toEqual([
      [0, 64],
      [BAR, 60],
      [3 * BAR, 64],
    ])
  })

  it('count a note in the bar it STARTS in, even when it is held into the next', () => {
    /* three bars of song, so the note's tail is not the song's end as well */
    const p = part([{ midi: 60, t: 1.9, dur: 0.5 }], 2 * BAR, { plan: [null, 0, null] })
    const [n] = notesInSong(p, 120, 3)
    expect(n.t).toBeCloseTo(BAR + 1.9, 6)
    expect(n.dur).toBeCloseTo(0.5, 6)
  })

  it('play only whole repetitions, as the loop does, and nothing past the end of the song', () => {
    /* a 1.5s take in a 4s song repeats twice; a third pass would start at 3s and be cut */
    const p = part([{ midi: 60, t: 0, dur: 0.2 }], 1.5)
    expect(starts(notesInSong(p, 120, 2))).toEqual([0, 1.5])
    /* a take longer than the song is cut at the song's end */
    const long = part([{ midi: 60, t: 5, dur: 0.2 }], 6)
    expect(notesInSong(long, 120, 2)).toEqual([])
  })
})

describe('a line of words per bar of the song', () => {
  /* one bar of four quarter notes, repeated across four bars of song */
  const four = part(
    [0, 0.5, 1, 1.5].map((t) => ({ midi: 64, t, dur: 0.45 })),
    BAR,
  )
  const song = { bpm: 120, bars: 4, quantize: 0 }

  it('sings each bar its own words over the same notes — a verse over a repeating melody', () => {
    const fit = fitSongLyrics(
      { ...four, lyrics: ['one two three four', '', 'five six ten nine'] },
      song,
    )
    expect(barSays(fit.bars[0])).toBe('one · two · three · four')
    expect(barSays(fit.bars[2])).toBe('five · six · ten · nine')
    /* every sung syllable sits inside the bar its words were written for */
    for (const s of fit.sung.filter((x) => x.text === 'five' || x.text === 'one'))
      expect(Math.floor(s.t / BAR), s.text).toBe(s.text === 'one' ? 0 : 2)
  })

  it('leaves a bar with no words silent, however many notes it has', () => {
    const fit = fitSongLyrics({ ...four, lyrics: ['la', '', '', 'la'] }, song)
    expect(fit.bars[1].sung).toEqual([])
    expect(fit.bars[1].notes).toBe(4)
    expect(fit.sung.every((s) => Math.floor(s.t / BAR) === 0 || Math.floor(s.t / BAR) === 3)).toBe(
      true,
    )
  })

  it('counts the words a bar cannot fit rather than dropping them', () => {
    const one = part([{ midi: 64, t: 0, dur: 0.2 }], BAR)
    const fit = fitSongLyrics({ ...one, lyrics: ['a b c'] }, song)
    expect(fit.bars[0].sung).toHaveLength(1)
    expect(fit.bars[0].spare).toBe(2)
  })

  it('counts every word in a bar the part is silent in as left over', () => {
    const fit = fitSongLyrics({ ...four, play: [true, false], lyrics: ['', 'no notes here'] }, song)
    expect(fit.bars[1].notes).toBe(0)
    expect(fit.bars[1].spare).toBe(4)
  })

  it('holds a vowel across a bar line when the next bar opens on _', () => {
    const fit = fitSongLyrics({ ...four, lyrics: ['one two three four', '_ five six seven'] }, song)
    const first = fit.bars[1].sung[0]
    expect(first.hold).toBe(true)
    expect(first.text).toBe('four')
  })

  it('and comes in fresh after a silent bar rather than holding across it', () => {
    const fit = fitSongLyrics({ ...four, lyrics: ['one two three four', '', '_ la'] }, song)
    expect(fit.bars[2].sung[0].hold).toBe(false)
  })
})

describe('the lines the box edits', () => {
  it('are one per bar, padded, and keep the words past the end when the song shrinks', () => {
    expect(linesFor({ lyrics: ['a', 'b'] }, 4)).toEqual(['a', 'b', '', ''])
    expect(linesFor({ lyrics: ['a', 'b', 'c'] }, 2)).toEqual(['a', 'b'])
    expect(linesFor({}, 3)).toEqual(['', '', ''])
  })

  it('keep a typed space, so the next word can be typed after it', () => {
    expect(tidyLyrics(['glit-ter '])).toEqual(['glit-ter '])
  })
})
