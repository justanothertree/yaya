/**
 * The instrument menu's families — what kind of thing each voice is.
 *
 * ⚠️ WHY THE MENU IS GROUPED (Evan, 10 Nov 2026: "group related controls, keep common ones up
 * front"). It was one flat grid of every voice, which at thirty-one was four rows and, with the
 * menu open on a desktop as he asked it to be, put ▶ Play at 998px in a 900px window. Picking a
 * family first shows one row of tiles instead of every row, and "I want a bass" is how people
 * actually look — nobody scans forty icons for the fourth one that happens to be low.
 *
 * ⚠️ MEMBERS ARE WRITTEN AS PLAIN STRINGS, NOT `InstrumentId`, ON PURPOSE. A family can name a
 * voice this bundle does not have yet (the basses added in a separate draft), and the room only
 * ever shows the members that are on the picker — so the list is right on either side of that
 * merge instead of being wrong on one of them. The test asks the other direction: every voice on
 * the picker has exactly one family.
 */

export type Family = { id: string; name: string; members: readonly string[] }

export const FAMILIES: readonly Family[] = [
  {
    id: 'keys',
    name: 'Keys',
    members: ['keys', 'rhodes', 'harpsichord', 'organ', 'clav', 'accordion'],
  },
  /* ⚠️ TWO BASS FAMILIES since there were ten basses and a family is one row of eight at 1440 —
     the played ones, and the ones a synth makes. "I want a bass" still lands on Bass first. */
  {
    id: 'bass',
    name: 'Bass',
    members: ['bass', 'finger', 'pick', 'fuzz', 'slap', 'fretless', 'upright'],
  },
  { id: 'synth-bass', name: 'Synth bass', members: ['synthbass', 'acid', '808', 'sub'] },
  {
    id: 'strings',
    name: 'Strings',
    members: ['strings', 'cello', 'guitar', 'overdrive', 'harp', 'koto', 'sitar', 'banjo'],
  },
  { id: 'winds', name: 'Winds', members: ['flute', 'whistle', 'reed', 'brass', 'choir'] },
  /* ⚠️ PLUCK MOVED HERE FROM STRINGS when the guitars arrived, 10 Nov 2026: it is a saw through a
     resonant filter that slams shut — a synth pluck, not a string — and Strings needed the room
     to stay one row of eight with two guitars in it. */
  {
    id: 'synth',
    name: 'Synth',
    members: ['lead', 'supersaw', 'chip', 'pad', 'pluck', 'fifths', 'drone'],
  },
  {
    id: 'bells',
    name: 'Bells',
    members: ['bell', 'box', 'glass', 'marimba', 'vibes', 'kalimba', 'steelpan', 'handpan'],
  },
  { id: 'drums', name: 'Drums', members: ['drums'] },
]

/** The family a voice belongs to — Keys for one nobody has filed, so the menu never opens empty. */
export function familyOf(id: string): string {
  return FAMILIES.find((f) => f.members.includes(id))?.id ?? 'keys'
}

/** The voices of one family that this picker actually offers, in the family's own order. */
export function familyVoices<T extends string>(family: string, offered: readonly T[]): T[] {
  const f = FAMILIES.find((x) => x.id === family)
  if (!f) return []
  return f.members.filter((m): m is T => (offered as readonly string[]).includes(m)) as T[]
}
