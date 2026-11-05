/**
 * What is sounding, and under which voice.
 *
 * A press and its release are two events separated by however long somebody holds a key — and in
 * between, they can change the octave, the scale or the key. The instrument room used to answer
 * "which note am I releasing?" by WORKING IT OUT AGAIN at release time:
 *
 *     press('k:' + key, live.current.noteAt(off))   // keydown
 *     lift('k:' + key, live.current.noteAt(off))    // keyup — recomputed
 *
 * Those two agree only while nothing moves underneath them. Measured in the pane: hold `z`, press
 * Octave up, let go, come back to octave 4 — **C4 is lit with nothing pressed**. The note-off was
 * about C5, so the filter that clears the highlight never matched, and `held` kept a note that had
 * already stopped. The sound itself was fine, because the synth releases by voice id rather than
 * by pitch, which is exactly what made it survive: the audible half was correct and the four
 * bookkeeping calls fed from that same `midi` were not — the lit key, the recorded note-off, the
 * note-off sent to everyone jamming with you, and the rolling history Capture reads.
 *
 * So this is a BOOK rather than another computation. A press writes down what it sounded; a
 * release reads it back and strikes it out. Nothing is derived twice, which means no two readings
 * can disagree however much moves in between.
 *
 * ⚠️ IT OWNS THE VOICE IDS TOO, because one press is not always one note. A chord is several
 * voices that have to be started and stopped together, and the id scheme that keeps them apart
 * belongs next to the book that remembers them rather than spread across each call site. The
 * first note of a press keeps the bare id, so a single note's voice id is exactly what it was
 * before this file existed — `k:z` stays `k:z` — and only the extra notes of a chord get a
 * suffix.
 */

/** One voice: the id the synth knows it by, and the note it is playing. */
export type Voice = { voice: string; midi: number }

/**
 * The voice id for the nth note of a press.
 *
 * ⚠️ `/` because note names and pointer ids do not contain one, and the existing ids are
 * `k:<key>` and `p:<pointerId>` — a separator that could appear inside an id would let two
 * presses collide and steal each other's note-offs.
 */
const voiceId = (id: string, n: number) => (n === 0 ? id : `${id}/${n}`)

export type SoundingBook = {
  /**
   * Note that `id` is now sounding `notes`, and say which voices to start.
   *
   * If that id is already sounding — a retrigger, which the pointer path guards against but the
   * keyboard's auto-repeat and a jammed modifier key can still produce — the voices it was
   * holding are returned to be stopped first, so nothing is left open.
   */
  start: (id: string, notes: number[]) => { stop: Voice[]; play: Voice[] }
  /** Strike `id` out and say which voices to stop. An id that is not sounding gives an empty list. */
  end: (id: string) => Voice[]
  /** Everything currently sounding, as voices. */
  open: () => Voice[]
  /**
   * The first note of each open press — the key a finger is actually on.
   *
   * ⚠️ IT EXISTS BECAUSE CHORDS MADE `notes()` AMBIGUOUS. Before chords, every lit key was one
   * somebody was touching; now four light up and only one of them was pressed, so the keyboard
   * could no longer say which. That is a question only the book can answer, because only the
   * book knows which notes arrived together and in what order.
   */
  leads: () => number[]
  /**
   * The distinct notes sounding, for the keyboard's lit keys.
   *
   * Distinct because two fingers on one key, or a chord that doubles a note at the octave, are
   * two voices and one lit key — and because `held` is read with `includes`, which cannot tell
   * the difference but would grow without bound.
   */
  notes: () => number[]
  /** Forget everything and say what to stop — the blur case, where no keyup is ever coming. */
  clear: () => Voice[]
}

export function soundingBook(): SoundingBook {
  /* insertion-ordered, so `notes()` returns them in the order they were played rather than
     sorted — which is what a chord's own voicing is, and what a test can state exactly */
  const held = new Map<string, Voice[]>()

  const open = () => [...held.values()].flat()

  return {
    start(id, notes) {
      const stop = held.get(id) ?? []
      const play = notes.map((midi, n) => ({ voice: voiceId(id, n), midi }))
      /* an empty chord sounds nothing and must not leave a key lit, so the entry goes
         altogether rather than being stored empty */
      if (play.length) held.set(id, play)
      else held.delete(id)
      return { stop, play }
    },
    end(id) {
      const v = held.get(id) ?? []
      held.delete(id)
      return v
    },
    open,
    leads() {
      const seen: number[] = []
      for (const v of held.values()) if (v.length && !seen.includes(v[0].midi)) seen.push(v[0].midi)
      return seen
    },
    notes() {
      const seen: number[] = []
      for (const { midi } of open()) if (!seen.includes(midi)) seen.push(midi)
      return seen
    },
    clear() {
      const all = open()
      held.clear()
      return all
    },
  }
}
