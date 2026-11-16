import { partAt, partsIn } from './arrange'
import { splitLyrics, type SungNote } from './lyrics'
import { linesFor } from './lyricLines'
import { toNotes, type Note } from './noteEdit'
import { fitByBar, type BarFit } from './pocket'
import type { LoopEvent } from './looper'

/**
 * A song's lyrics: one line of words per bar of the SONG, kept on the part whose notes sing them.
 *
 * ⚠️ PER SONG BAR, NOT PER NOTE AND NOT PER TAKE BAR — Evan, 15 Nov 2026, after he built a song
 * and could not find where its words went. A two-bar melody tiled across eight bars is the same
 * notes four times and wants four different lines over them, which is what a verse is. So a line
 * belongs to a bar of the song, and the notes it sings are whichever the part plays there — the
 * arrangement included (notesInSong).
 *
 * ⚠️ ON THE PART, so a song keeps its words everywhere a part already goes: the room's undo, the
 * bench a reload puts back, a kept song, the jam. Nothing here stores anything on a note; the
 * phase-1 plan in docs/2026-11-10-sung-lyrics-plan.md (a syllable on every note) is still open,
 * and this does not close it.
 *
 * ⚠️ PURE — which bar a word lands in is a question with a right answer, asked in
 * songLyrics.test.ts without a browser.
 */

const BEATS_PER_BAR = 4

/** What songLyrics needs to know of a part — the fields of a Layer that decide what it plays. */
export type LyricPart = {
  events: LoopEvent[]
  len: number
  plan?: (number | null)[]
  play?: boolean[]
  lyrics?: string[]
}

/**
 * Every note a part plays across the song, in song time — the scheduler's own placement, written
 * down once so the lyrics are fitted to what you hear rather than to the take as it was recorded.
 *
 * ⚠️ TWO PATHS, BECAUSE THE SCHEDULER HAS TWO (looper.ts, scheduleWindow). An arranged part is
 * placed bar by bar through `partAt` — the same call the scheduler makes — and a note belongs to
 * the bar it STARTS in. An unarranged one repeats by its own length, in WHOLE repetitions only,
 * and `play` silences the bars somebody switched off. A note that would start past the end of the
 * song does not play there, so it is not here either.
 */
export function notesInSong(part: LyricPart, bpm: number, bars: number): Note[] {
  const barLen = (60 / bpm) * BEATS_PER_BAR
  const end = bars * barLen
  const notes = toNotes(part.events, part.len)
  const out: Note[] = []
  const put = (midi: number, t: number, dur: number) => {
    if (t >= end - 1e-9) return
    out.push({ midi, t, dur: Math.min(dur, end - t) })
  }
  if (part.plan) {
    const parts = partsIn(part.len, bpm, BEATS_PER_BAR)
    for (let b = 0; b < bars; b++) {
      const src = partAt(part.plan, b, parts)
      if (src == null) continue
      for (const n of notes) {
        const owner = Math.floor(n.t / barLen + 1e-6)
        if (owner === src) put(n.midi, b * barLen + (n.t - owner * barLen), n.dur)
      }
    }
  } else {
    const own = Math.max(0.05, part.len)
    const reps = Math.max(1, Math.floor(end / own + 1e-6))
    for (let k = 0; k < reps; k++)
      for (const n of notes) {
        const t = k * own + n.t
        const bar = Math.floor(t / barLen)
        if (part.play && bar >= 0 && bar < part.play.length && !part.play[bar]) continue
        put(n.midi, t, n.dur)
      }
  }
  return out.sort((a, b) => a.t - b.t || a.midi - b.midi)
}

/**
 * A part's lyrics onto the notes it plays across the song: the whole line the voice sings, and
 * each bar's share of it, for the box to say what landed where.
 */
export function fitSongLyrics(
  part: LyricPart,
  song: { bpm: number; bars: number; quantize: number },
): { sung: SungNote[]; bars: BarFit[] } {
  const beat = 60 / song.bpm
  const barLen = beat * BEATS_PER_BAR
  const lines = linesFor(part, song.bars).map((l) => splitLyrics(l))
  return fitByBar(notesInSong(part, song.bpm, song.bars), lines, {
    beat,
    snap: song.quantize,
    len: song.bars * barLen,
    barLen,
  })
}

/** What a bar's fit says in a few characters: the syllables as sung, `~` for a held vowel. */
export function barSays(fit: BarFit | undefined): string {
  if (!fit || !fit.sung.length) return ''
  return fit.sung.map((s) => (s.hold ? '~' : s.text)).join(' · ')
}
