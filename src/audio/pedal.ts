import type { Voice } from './sounding'

/**
 * Notes that are still ringing with nobody holding them — a sustain pedal.
 *
 * Every keyboard has one and this one did not.
 *
 * ⚠️ THIS PARAGRAPH SAID THE OPPOSITE OF THE TRUTH FOR TWENTY MINUTES. It read: "most obvious
 * on the short voices — a marimba, a kalimba, a music box and the new handpan all decay to
 * nothing in a second". That is exactly backwards, and measuring it is what found the mistake.
 *
 * A patch with `s === 0` SCHEDULES ITS OWN STOP in `noteOn`: `o.stop(at + a + d + r)`, plus a
 * timer that drops it from the voice map. Marimba's whole life is 0.42s. So the pedal can only
 * extend a struck voice from "cut at release" to "its full natural decay", which on marimba is
 * about a tenth of a second — and my first test of the pedal read zero voices half a second
 * after release and looked like a broken feature. It was a 0.42-second instrument sampled at
 * 0.5 seconds.
 *
 * Where it plainly works is the SUSTAINING voices, which ring until a note-off that the pedal
 * withholds. Measured, sampling the live voice count eight times over 2.4s after letting go:
 *
 *       Pad     no pedal  0 0 0 0 0 0 0 0     with pedal  1 1 1 1 1 1 1 1
 *       Organ   no pedal  0 0 0 0 0 0 0 0     with pedal  1 1 1 1 1 1 1 1
 *
 * So it is for Pad, Organ, Strings, Drone, Choir, Accordion, Reed and Flute — anything with a
 * sustain above zero — and it is nearly a no-op on the struck half of the instrument list.
 * Making it mean more there would require `noteOn` not to schedule that stop while the pedal is
 * down, which is a change to the voice lifetime and is not attempted here.
 *
 * ⚠️ IT IS A SEPARATE BOOK FROM `sounding.ts`, DELIBERATELY. That one answers "what is somebody
 * holding", which the lit keys and `lift` both read; this one answers "what is still making a
 * sound". Merging them would mean a key staying lit after the finger left it — the pedal's
 * entire point is that those two stop being the same question.
 *
 * ⚠️ AND `forget` IS THE WHOLE DIFFICULTY. Pressing a key whose last note is still pedalled
 * re-strikes it, and the synth keys voices by id — so `noteOn('k:z', …)` stops the old `k:z`
 * and starts a new one under the same name. The pedal is then holding a reference to a voice
 * that no longer exists, and lifting the pedal would send a note-off to the NEW note: a key you
 * are still holding, cut off by releasing a pedal. Which is both wrong and almost impossible to
 * guess at from the symptom.
 */
export type PedalBook = {
  /** These were let go of while the pedal was down; they keep sounding. */
  hold: (voices: Voice[]) => void
  /**
   * These voice ids are about to be struck again, so the pedal no longer owns them.
   * The synth retriggers them by id on its own — nothing needs stopping, only forgetting.
   */
  forget: (ids: string[]) => void
  /** Pedal up, or Panic: everything still ringing, and the book is emptied. */
  release: () => Voice[]
  /** What is ringing without a finger on it. */
  open: () => Voice[]
}

export function pedalBook(): PedalBook {
  /* keyed by voice id, because that is what the synth and `forget` both talk in. A Map rather
     than an array so re-pedalling the same id cannot store it twice. */
  const held = new Map<string, Voice>()
  return {
    hold(voices) {
      for (const v of voices) held.set(v.voice, v)
    },
    forget(ids) {
      for (const id of ids) held.delete(id)
    },
    release() {
      const all = [...held.values()]
      held.clear()
      return all
    },
    open: () => [...held.values()],
  }
}
