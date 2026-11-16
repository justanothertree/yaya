import { describe, expect, it } from 'vitest'
import {
  barSays,
  carries,
  fitSongLyrics,
  moreNotesFor,
  moveWords,
  notesInSong,
  overflow,
  setCarry,
} from './songLyrics'
import { splitLyrics } from './lyrics'
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
    /* one eighth: shared into two sixteenths at most, so a third word has nowhere to go */
    const one = part([{ midi: 64, t: 0, dur: 0.25 }], BAR)
    const fit = fitSongLyrics({ ...one, lyrics: ['a b c d'] }, song)
    expect(fit.bars[0].sung.map((s) => s.text)).toEqual(['a', 'b'])
    expect(fit.bars[0].spare).toBe(2)
  })

  it("holds a line's last word on to the next note of the part, across the bar line", () => {
    /* a short note at the end of bar one, and the part's next note on bar two's downbeat — a bar
       with no words, so nothing is sung there, but "star" rings until that note comes */
    const p = part(
      [
        { midi: 64, t: 1.5, dur: 0.1 },
        { midi: 62, t: BAR, dur: 0.1 },
      ],
      2 * BAR,
    )
    const fit = fitSongLyrics({ ...p, lyrics: ['star', ''] }, { ...song, bars: 2 })
    expect(fit.sung).toHaveLength(1)
    expect(fit.sung[0].t + fit.sung[0].dur).toBeCloseTo(BAR, 9)
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

describe("holding on to the bar before's last sound", () => {
  it('is a leading _, put on and taken off without touching the words', () => {
    expect(carries('_ love you')).toBe(true)
    expect(carries('__ love')).toBe(true)
    expect(carries('love _ you')).toBe(false)
    expect(setCarry('love you', true)).toBe('_ love you')
    expect(setCarry('', true)).toBe('_')
    expect(setCarry('_ love you', false)).toBe('love you')
    expect(setCarry('__ love', false)).toBe('love')
    expect(setCarry('_', false)).toBe('')
    expect(setCarry(setCarry('glit-ter in the', true), false)).toBe('glit-ter in the')
  })

  it('on an empty bar, holds the last word through every note of it', () => {
    const four = part(
      [0, 0.5, 1, 1.5].map((t) => ({ midi: 64, t, dur: 0.45 })),
      BAR,
    )
    const song = { bpm: 120, bars: 2, quantize: 0 }
    const fit = fitSongLyrics(
      { ...four, lyrics: ['one two three night', setCarry('', true)] },
      song,
    )
    expect(fit.bars[1].sung).toHaveLength(4)
    expect(fit.bars[1].sung.every((s) => s.hold && s.text === 'night')).toBe(true)
  })
})

describe('words that do not fit their bar', () => {
  const lyric = 'and the cit-y lights are call-ing me home'

  it('move whole words from the end, until the rest have a note each', () => {
    expect(overflow(lyric, 8)).toEqual({
      keep: 'and the cit-y lights are call-ing',
      move: 'me home',
    })
    expect(overflow(lyric, 10)).toBeNull()
    /* the line's first word always stays, and a word is never broken */
    expect(overflow(lyric, 1)).toEqual({ keep: 'and', move: lyric.slice(4) })
    expect(overflow('won-der-ful', 2)).toBeNull()
  })

  it('arrive at the start of the next bar, taking the place of a hold that opened it', () => {
    const o = overflow(lyric, 8)!
    expect(moveWords([lyric, '_ to-night'], 0, o)).toEqual([
      'and the cit-y lights are call-ing',
      'me home to-night',
    ])
    expect(moveWords([lyric], 0, o)).toEqual(['and the cit-y lights are call-ing', 'me home'])
  })
})

describe('adding notes so the words have one each', () => {
  /* one bar of four quarters held for 60% of the beat, a keys part played short */
  const quarters = [0, 0.5, 1, 1.5].map((t, i) => ({ midi: 60 + i, t, dur: 0.3 }))
  const song = { bpm: 120, bars: 1, quantize: 0 }
  const six = 'shine on for-ev-er and'

  it('adds as many notes as the line is short of, and then every word has its own', () => {
    const p = { ...part(quarters, BAR), lyrics: [six] }
    const more = moreNotesFor(p, song, 0)!
    expect(more.added).toBe(2)
    const after = { ...p, events: more.events }
    expect(notesInSong(after, 120, 1)).toHaveLength(6)
    expect(fitSongLyrics(after, song).bars[0].sung).toHaveLength(splitLyrics(six).length)
  })

  it('writes in the notes the voice was already singing, so what you hear does not move', () => {
    const p = { ...part(quarters, BAR), lyrics: [six] }
    const before = fitSongLyrics(p, song).sung.map((s) => [s.text, +s.t.toFixed(6)])
    const after = fitSongLyrics({ ...p, events: moreNotesFor(p, song, 0)!.events }, song)
    expect(after.sung.map((s) => [s.text, +s.t.toFixed(6)])).toEqual(before)
  })

  it('keeps every note where it was played, and plays the new ones as short as it', () => {
    const p = { ...part(quarters, BAR), lyrics: [six] }
    const notes = notesInSong({ ...p, events: moreNotesFor(p, song, 0)!.events }, 120, 1)
    for (const q of quarters) expect(notes.some((n) => Math.abs(n.t - q.t) < 1e-9)).toBe(true)
    /* two quarters shared into eighths, each held for 60% of its eighth; the others untouched */
    const lengths = notes.map((n) => +n.dur.toFixed(6)).sort()
    expect(lengths).toEqual([0.15, 0.15, 0.15, 0.15, 0.3, 0.3])
  })

  it('says which bars of the song play the changed notes: every bar a take repeats in', () => {
    const p = { ...part(quarters, BAR), lyrics: [six] }
    expect(moreNotesFor(p, { ...song, bars: 4 }, 0)!.bars).toEqual([0, 1, 2, 3])
    /* arranged: song bar 1 plays the take's second bar, and only that bar changes */
    const two = part([...quarters, ...quarters.map((q) => ({ ...q, t: q.t + BAR }))], 2 * BAR, {
      plan: [0, 1, 0],
    })
    const more = moreNotesFor({ ...two, lyrics: ['', six] }, { ...song, bars: 3 }, 1)!
    expect(more.bars).toEqual([1])
    const take = notesInSong({ ...two, events: more.events, plan: undefined }, 120, 2)
    expect(take.filter((n) => n.t < BAR)).toHaveLength(4)
    expect(take.filter((n) => n.t >= BAR)).toHaveLength(6)
  })

  it('has nothing to add when the words fit, or when the notes are already as short as a word', () => {
    const p = part(quarters, BAR)
    expect(moreNotesFor({ ...p, lyrics: ['one two three four'] }, song, 0)).toBeNull()
    /* sixteenths at 120 bpm: 125ms, and a syllable is never sung under 120ms */
    const fast = part(
      Array.from({ length: 16 }, (_, i) => ({ midi: 60, t: i * 0.125, dur: 0.1 })),
      BAR,
    )
    const lots = Array.from({ length: 20 }, () => 'la').join(' ')
    expect(moreNotesFor({ ...fast, lyrics: [lots] }, song, 0)).toBeNull()
  })
})
