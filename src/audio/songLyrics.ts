import { partAt, partsIn } from './arrange'
import { splitLyrics, type SungNote } from './lyrics'
import { linesFor } from './lyricLines'
import { toEvents, toNotes, type Note } from './noteEdit'
import { fitByBar, share, songMelody, type BarFit } from './pocket'
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
  return placed(part, bpm, bars).map(({ midi, t, dur }) => ({ midi, t, dur }))
}

/** a note of the song, with the note of the take it is (`src`, in the take's own time) */
type Placed = Note & { src: Note }

/** notesInSong, remembering which note of the take each one is — what changing it changes */
function placed(part: LyricPart, bpm: number, bars: number): Placed[] {
  const barLen = (60 / bpm) * BEATS_PER_BAR
  const end = bars * barLen
  const notes = toNotes(part.events, part.len)
  const out: Placed[] = []
  const put = (src: Note, t: number) => {
    if (t >= end - 1e-9) return
    out.push({ midi: src.midi, t, dur: Math.min(src.dur, end - t), src })
  }
  if (part.plan) {
    const parts = partsIn(part.len, bpm, BEATS_PER_BAR)
    for (let b = 0; b < bars; b++) {
      const src = partAt(part.plan, b, parts)
      if (src == null) continue
      for (const n of notes) {
        const owner = Math.floor(n.t / barLen + 1e-6)
        if (owner === src) put(n, b * barLen + (n.t - owner * barLen))
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
        put(n, t)
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

/**
 * Does this line open by holding on the last sound of the bar before? A leading `_` — the same
 * hold `_` is anywhere in a line, which fitByBar already carries across the bar line.
 *
 * ⚠️ A SWITCH ON THE WORDS, NOT A NEW FIELD — Evan, 15 Nov 2026: "let a bar's words carry across a
 * held note into the next bar". Holding on was always possible by typing `_` first, and nobody
 * would ever find that, so the box offers it as a button and writes the `_` itself. The song file
 * already carries it, everywhere a line goes.
 */
export const carries = (line: string): boolean => /^_+(\s|$)/.test(line.trimStart())

/** The line with its opening hold put on or taken off; nothing else in it changes. */
export function setCarry(line: string, on: boolean): string {
  const rest = line.trimStart().replace(/^_+(\s+|$)/, '')
  return on ? (rest ? `_ ${rest}` : '_') : rest
}

/** Whole words off the end of a line, so the rest have a note each. */
export type Overflow = { keep: string; move: string }

/**
 * The words to move to the next bar so a line has no more syllables than its bar has notes —
 * whole words from the end, never the line's first. Null when it already fits, or when its first
 * word alone does not.
 */
export function overflow(line: string, notes: number): Overflow | null {
  const words = line.trim().split(/\s+/).filter(Boolean)
  const count = (k: number) => splitLyrics(words.slice(0, k).join(' ')).length
  let k = words.length
  while (k > 1 && count(k) > notes) k--
  if (k === words.length || count(k) > notes) return null
  return { keep: words.slice(0, k).join(' '), move: words.slice(k).join(' ') }
}

/**
 * Bar `b`'s words that do not fit, moved to the start of the next bar's line.
 *
 * ⚠️ A HOLD THAT OPENED THE NEXT LINE GOES. It held on the last sound of this bar, and the words
 * arriving in front of it are that sound's continuation now — left in, it would hold their last
 * vowel over the next bar's first note, which nobody typed.
 */
export function moveWords(lines: readonly string[], b: number, o: Overflow): string[] {
  const out = [...lines]
  while (out.length <= b + 1) out.push('')
  out[b] = o.keep
  out[b + 1] = [o.move, setCarry(out[b + 1], false)].filter((x) => x.trim()).join(' ')
  return out
}

/** Notes added to a part so a bar's words have a note each: the part's new notes, and where. */
export type MoreNotes = { events: LoopEvent[]; added: number; bars: number[] }

/**
 * A bar with more syllables than notes: share its notes in the PART the way the voice shares them
 * when it sings (pocket.ts `share`), so the part plays a note for every syllable and the voice
 * sings them one each. Null when there is nothing to add — the words fit, or the notes are as
 * short as a syllable is ever sung.
 *
 * ⚠️ THE CUTS ARE THE VOICE'S OWN, from the same `songMelody` and `share` the singer fits with —
 * so a light syllable still lands on the second half of a note, and what you hear does not move
 * when the notes are written in. A new note starts on the grid; how long it sounds follows the
 * note it came from, so a part played short is still played short.
 *
 * ⚠️ A TAKE THAT REPEATS PLAYS THESE NOTES IN EVERY BAR IT REPEATS IN. `bars` says which, so the
 * box can say so before anybody presses it.
 */
export function moreNotesFor(
  part: LyricPart,
  song: { bpm: number; bars: number; quantize: number },
  b: number,
): MoreNotes | null {
  const beat = 60 / song.bpm
  const barLen = beat * BEATS_PER_BAR
  const syls = splitLyrics(linesFor(part, song.bars)[b] ?? '')
  const all = placed(part, song.bpm, song.bars)
  const { snapped, held, fine, source } = songMelody(all, {
    beat,
    snap: song.quantize,
    len: song.bars * barLen,
  })
  const mine = snapped
    .map((_, i) => i)
    .filter((i) => Math.floor(snapped[i].t / barLen + 1e-6) === b)
  if (!mine.length || syls.length <= mine.length) return null
  const line = share(
    mine.map((i) => held[i]),
    syls,
    beat,
    fine,
  )
  if (line.length <= mine.length) return null
  /* each new note, against the note of the song it was cut from */
  const cuts = new Map<number, number[]>()
  let j = 0
  for (const piece of line) {
    while (j + 1 < mine.length && piece.t >= held[mine[j + 1]].t - 1e-9) j++
    if (Math.abs(piece.t - held[mine[j]].t) > 1e-9) cuts.set(j, [...(cuts.get(j) ?? []), piece.t])
  }
  const notes = toNotes(part.events, part.len)
  const touched = new Set<Note>()
  cuts.forEach((at, k) => {
    const i = mine[k]
    const n = all[source[i]]
    const home = notes.find(
      (x) => x.midi === n.src.midi && Math.abs(x.t - n.src.t) < 1e-6 && !touched.has(x),
    )
    if (!home) return
    touched.add(home)
    /* the song's grid, in the take's own time: the played note keeps its own start */
    const starts = [home.t, ...at.map((c) => home.t + (c - n.t))]
    const slot = held[i].t + held[i].dur - snapped[i].t
    const played = Math.min(1, home.dur / slot)
    const end = home.t + Math.max(home.dur, slot)
    const pieces = starts.map((t, q) => ({
      midi: home.midi,
      t,
      dur: Math.max(0.03, ((starts[q + 1] ?? end) - t) * played),
    }))
    notes.splice(notes.indexOf(home), 1, ...pieces)
  })
  if (!touched.size) return null
  const changed = new Set([...touched].map((x) => `${x.midi}@${x.t.toFixed(6)}`))
  const bars = [
    ...new Set(
      all
        .filter((x) => changed.has(`${x.src.midi}@${x.src.t.toFixed(6)}`))
        .map((x) => Math.floor(x.t / barLen + 1e-6)),
    ),
  ].sort((x, y) => x - y)
  return { events: toEvents(notes, part.len), added: line.length - mine.length, bars }
}
