/**
 * A song's lyrics as lines — one per bar of the song, kept on the part whose notes sing them. See
 * songLyrics.ts for what they are sung on and why they belong to a bar of the SONG.
 *
 * ⚠️ ITS OWN TINY MODULE, because songFile.ts reads these and is reached from the profile
 * renderer: it must not drag the singer's spelling tables, the pocket or the audio engine in with
 * it. Nothing here imports anything.
 */

/** the most a bar's line holds — a long line is a sentence nobody can sing in one bar anyway */
export const MAX_LYRIC = 120

/** does this part have any words on it */
export const hasLyrics = (p: { lyrics?: readonly string[] }): boolean =>
  !!p.lyrics?.some((l) => l.trim())

/**
 * One line per bar of a song this long, padded with empty ones — what the lyrics box edits.
 *
 * ⚠️ LINES PAST THE END ARE KEPT, NOT CUT. A song shortened from eight bars to four still has the
 * words of bars five to eight on its part, and growing it back brings them back — the same rule
 * a take's own notes follow when the loop shrinks (see Layer.len).
 */
export function linesFor(part: { lyrics?: readonly string[] }, bars: number): string[] {
  return Array.from({ length: Math.max(bars, 0) }, (_, i) => part.lyrics?.[i] ?? '')
}

/**
 * The lines as they are stored: each one a bounded string with no control characters, the empty
 * ones at the end dropped, and nothing at all when there are no words — so a part nobody wrote on
 * carries no field.
 *
 * ⚠️ ALSO THE READER FOR A FILE. A song's lines arrive from strangers (the jam, a profile), so
 * anything that is not a string becomes an empty line and every line is cut to MAX_LYRIC.
 *
 * ⚠️ NOT TRIMMED INSIDE A LINE. This runs on every keystroke, and trimming would eat the space
 * somebody just typed before their next word.
 */
export function tidyLyrics(lines: unknown, max = 32): string[] | undefined {
  if (!Array.isArray(lines)) return undefined
  const out = lines.slice(0, max).map((l) =>
    typeof l === 'string'
      ? // eslint-disable-next-line no-control-regex
        l.replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, MAX_LYRIC)
      : '',
  )
  while (out.length && !out[out.length - 1].trim()) out.pop()
  return out.length ? out : undefined
}
