/**
 * Which picker put a layer there, as a tag that can survive being written down.
 *
 * ⚠️ THE MARK LIVES IN THE LAYER'S ID, AND IDS ARE NOT SAVED. `addPatternLayer` builds
 * `${Date.now()}-chords:four` so that picking a progression SWAPS the one already there rather
 * than stacking a second — the id is the only thing saying "this layer is the chords". The song
 * format never carried it, and `songToLayers` mints fresh ids on purpose, so every mark was lost
 * the moment a song went to the library and came back.
 *
 * Measured in the room: keep a song with chords and a bass, open it again, and the Chords picker
 * shows nothing selected, the Bass button is DISABLED reading "Pick some chords first" about a
 * song that contains a bass layer, and the keyboard's chord hint is dead. Then picking a
 * progression takes the layers from two to three — `['pad', 'bass', 'pad']` — because the swap
 * finds nothing to swap. Two pads on different progressions is the one thing every comment in
 * chordPatterns.ts is written to prevent, reachable in three clicks.
 *
 * ⚠️ ITS OWN MODULE BECAUSE TWO FILES NEED THE VOCABULARY AND ONE OF THEM MUST NOT IMPORT THE
 * OTHER. songFile.ts takes `Layer` from looper.ts as a TYPE only, which costs nothing at
 * runtime; reaching for the mark strings would make that a real import and a cycle, since
 * looper.ts imports the song format back. A third file both can see is the ordinary answer, and
 * it has the side benefit that the validator below can be asked questions without a browser.
 */

/** The pickers that own a layer. A mark is this, then the pattern's own id. */
export const PATTERN_MARKS = ['-beat:', '-chords:', '-bass:', '-fill:'] as const

/**
 * ⚠️ A FILE'S TAG BECOMES PART OF A LAYER ID, which becomes part of every voice id the
 * scheduler mints (`L${layer.id}:${time}:${midi}`) and a key in the sounding map. So this is the
 * narrowest thing that can work: a known mark, then at most 24 characters of lowercase, digits
 * and dashes. Anything else is not rejected loudly — it simply is not a mark, and the layer
 * arrives as an ordinary one, which is exactly what a layer without a tag already is.
 */
const SHAPE = new RegExp(`^(${PATTERN_MARKS.join('|')})[a-z0-9-]{0,24}$`)

/** The tag on a live layer's id, or null — `1793939405153-chords:four` → `-chords:four`. */
export function markOf(id: string): string | null {
  for (const mark of PATTERN_MARKS) {
    const at = id.indexOf(mark)
    if (at !== -1) {
      const tag = id.slice(at)
      return SHAPE.test(tag) ? tag : null
    }
  }
  return null
}

/** The same tag off the wire, or null. Everything about it is checked; see SHAPE. */
export function readMark(v: unknown): string | null {
  return typeof v === 'string' && SHAPE.test(v) ? v : null
}

/**
 * Hand out each mark at most once.
 *
 * ⚠️ BECAUSE A SECOND CHORDS LAYER IS THE BUG THIS IS FIXING, and a file can simply say so. The
 * whole point of a mark is that picking a progression swaps the one that is there; two layers
 * carrying `-chords:` means the swap hits the first and leaves the second playing underneath it.
 * Nothing the app writes can produce that, which is exactly why a reader must not assume it.
 *
 * The later one keeps its notes and loses its tag, which is the gentle failure: the music is
 * still there and still plays, it is just no longer claimed by a picker.
 */
export function uniqueMarks(kinds: readonly (string | null | undefined)[]): (string | null)[] {
  const used = new Set<string>()
  return kinds.map((k) => {
    const tag = typeof k === 'string' ? readMark(k) : null
    if (!tag) return null
    const mark = PATTERN_MARKS.find((m) => tag.startsWith(m))
    if (!mark || used.has(mark)) return null
    used.add(mark)
    return tag
  })
}
