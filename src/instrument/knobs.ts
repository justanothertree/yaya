import type { Knob } from '../audio/synth'

/**
 * The six things you can bend about the sound, as sliders rather than a patch editor — the room's
 * own (⚙ Sound) and each part's (its menu, PartPanel), so the two read as the same controls.
 */
export const KNOBS: Array<[Knob, string, string]> = [
  ['echo', 'Echo', 'How much of the note comes back'],
  ['echoTime', 'Echo time', 'How long before it does'],
  ['space', 'Space', 'The size of the room it is played in'],
  ['vibrato', 'Vibrato', 'A wobble in the pitch, like a singer'],
  /* the only one that is about PLAYING rather than about the sound, and it applies to all of
     them — see Fx.glide for why it lives with the effects rather than with the instruments */
  ['glide', 'Glide', 'Each note slides from the one before it'],
  /* ⚠️ THE ONE WHOSE MIDDLE IS "OFF". The other five add something and read 0 when they are
     doing nothing; this one shapes what is already there, so the preset as written sits at the
     halfway mark and the slider has somewhere to go both ways. The hint says so, because a
     slider resting at 50 with no explanation looks like a setting somebody left on. */
  ['tone', 'Tone', 'Darker to the left, brighter to the right — the middle is the sound as it is'],
]
