import { autoSplit } from '../audio/lyrics'

/**
 * Typed lyrics onto a melody, keeping track of which WORD each syllable came from — the neural
 * voice speaks whole words (a syllable on its own is mispronounced: "ter" is not the end of
 * "glitter"), so the word is what gets synthesised and the syllable is what gets cut out of it.
 *
 * ⚠️ THROWAWAY DEMO. Same lyric rules as lyrics.ts, whose `autoSplit` this reuses: spaces between
 * words, a hyphen splits a word, `_` holds the last syllable across the next note.
 */

export type Note = { t: number; dur: number; midi: number }
export type Word = { text: string; syllables: number }
/** one syllable on its note, extended by any holds after it */
export type Sung = {
  word: number
  syl: number
  t: number
  end: number
  pitches: { at: number; midi: number }[]
}

type Token = { word: number; syl: number } | 'hold'

export function planLine(lyric: string, notes: readonly Note[]) {
  const words: Word[] = []
  const stream: Token[] = []
  for (const raw of lyric.trim().split(/\s+/)) {
    if (!raw) continue
    if (/^_+$/.test(raw)) {
      for (let i = 0; i < raw.length; i++) stream.push('hold')
      continue
    }
    const parts = raw.includes('-') ? raw.split('-').filter(Boolean) : autoSplit(raw)
    const text = raw.replace(/-/g, '').replace(/[^a-z'’]/gi, '')
    if (!text) continue
    words.push({ text, syllables: parts.length })
    for (let s = 0; s < parts.length; s++) stream.push({ word: words.length - 1, syl: s })
  }
  const order = [...notes].sort((a, b) => a.t - b.t)
  const sung: Sung[] = []
  order.forEach((n, i) => {
    const tok = stream[i]
    const last = sung[sung.length - 1]
    if (tok && tok !== 'hold') {
      sung.push({ ...tok, t: n.t, end: n.t + n.dur, pitches: [{ at: n.t, midi: n.midi }] })
    } else if (last) {
      last.end = n.t + n.dur
      last.pitches.push({ at: n.t, midi: n.midi })
    }
  })
  return { words, sung, spare: Math.max(0, stream.length - order.length) }
}
