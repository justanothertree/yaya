/**
 * The scales the instrument's keys can be remapped to.
 *
 * ⚠️ THIS LIVED IN InstrumentRoom.tsx, and it moved for the reason the room's own comment beside
 * `instKits` gives about copies: it is DATA, and two things now need to ask it a question. The
 * room builds the picker and the saved-rig validator from it; `scales.test.ts` sweeps every entry
 * through `chordNotes` so that a scale added years from now is checked for free rather than when
 * somebody notices a chord landing outside it. A list that only a component can see is a list
 * only a component can check.
 *
 * Scale lock remaps the KEYS, it does not filter the notes — greying out the wrong keys would
 * leave gaps and still demand you know which ones to avoid, while handing every key the next note
 * of the scale means there is no wrong key left to press.
 *
 * Chromatic is first and is the honest default: every semitone, black keys and all, exactly like
 * a piano. The others are for when you would rather noodle than practise.
 */

/**
 * id, label, degrees, and a short sentence.
 *
 * ⚠️ THE SENTENCE IS NOT IN THE LABEL, and that is a layout decision rather than a style one. A
 * `<select>` is as wide as its longest option, and three of them share one row at 375px — so
 * "Harmonic minor — dramatic and a little eastern" in the label is horizontal scroll on a phone.
 * The room prints it under the picker instead, where it can wrap.
 *
 * ⚠️ AND THE IDS ARE FOREVER. A saved rig stores the id, and `makeInstKits` silently falls back
 * to Chromatic for one it does not recognise — so renaming `penta` would quietly reset every kit
 * that used it. The LABEL changed to "Major pentatonic" when its minor sibling arrived; the id
 * did not.
 */
export type Scale = [id: string, label: string, degrees: number[], hint: string]

export const SCALES: Scale[] = [
  [
    'chromatic',
    'Chromatic',
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    'Every note, just like a piano',
  ],
  ['major', 'Major', [0, 2, 4, 5, 7, 9, 11], 'The bright, ordinary one'],
  ['minor', 'Minor', [0, 2, 3, 5, 7, 8, 10], 'The sad one'],
  [
    'penta',
    'Major pentatonic',
    [0, 2, 4, 7, 9],
    'Five notes, and it is genuinely hard to sound bad',
  ],
  [
    'minorPenta',
    'Minor pentatonic',
    [0, 3, 5, 7, 10],
    'Five notes again — this is the rock and blues one',
  ],
  ['blues', 'Blues', [0, 3, 5, 6, 7, 10], 'Minor pentatonic with the flat note between'],
  ['dorian', 'Dorian', [0, 2, 3, 5, 7, 9, 10], 'Minor, but hopeful — folk and funk live here'],
  ['mixo', 'Mixolydian', [0, 2, 4, 5, 7, 9, 10], 'Major with a softer seventh — bluesy and warm'],
  ['lydian', 'Lydian', [0, 2, 4, 6, 7, 9, 11], 'Major with one note lifted — floating, film-score'],
  [
    'phrygian',
    'Phrygian',
    [0, 1, 3, 5, 7, 8, 10],
    'Dark and Spanish, from the half step at the bottom',
  ],
  ['harmonic', 'Harmonic minor', [0, 2, 3, 5, 7, 8, 11], 'Minor with a dramatic leap near the top'],
  ['hirajoshi', 'Hirajoshi', [0, 2, 3, 7, 8], 'A Japanese five-note scale — spare and still'],
  ['wholetone', 'Whole tone', [0, 2, 4, 6, 8, 10], 'Every step the same size, so nothing resolves'],
]

/**
 * Chromatic cannot answer "two degrees up" — every semitone is in it — so chords there are
 * resolved against these with the pressed note as the root, which makes them all major and
 * predictable. Read out of the list rather than written again.
 */
export const MAJOR_DEGREES = SCALES.find(([id]) => id === 'major')?.[2] ?? SCALES[0][2]

/** The degrees of a scale by id, falling back to Chromatic for one nobody has heard of. */
export const degreesOf = (id: string): number[] =>
  SCALES.find(([sid]) => sid === id)?.[2] ?? SCALES[0][2]
