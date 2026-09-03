// Movie rating vocabulary (mirrors the standalone app) + shared helpers.
import { peopleInGroup } from '../groupFilter'
import type { Person } from '../types'

/**
 * Who can rate and vote here.
 *
 * ⚠️ DERIVED FROM CIRCUIT MEMBERSHIP, never written out. This was `MV_PIDS`, five person
 * ids typed in when the crew was five people — and it decided who got a rating slot, who got a
 * vote chip in the pool, and who appeared in the stats, across six files. Everyone else was
 * invisible to the whole ratings surface, and invisible in a way that could not heal: with no
 * slot to rate in you never get a rating, and several places only showed people who already had
 * one. Measured on the live board, four of nine people were locked out, including both of the
 * members who had actually signed up and joined — and one circuit of two people had exactly one
 * participant.
 *
 * Membership was already modelled, already enforced by RLS on every verb, and already synced by
 * realtime. Only this list disagreed with it.
 *
 * An empty group means "all circuits", which is what the toolbar's picker means by it too.
 */
export function ratersIn(people: Person[], group?: string | null): Person[] {
  return peopleInGroup(people, group ?? '')
}

export const MV_ICONS = [
  { id: 'pop', emoji: '🍿', label: 'Popcorn' },
  { id: 'boom', emoji: '💥', label: 'Boom' },
  { id: 'candy', emoji: '🍬', label: 'Candy' },
  { id: 'soda', emoji: '🥤', label: 'Soda' },
  { id: 'zzz', emoji: '😴', label: 'Snooze' },
  { id: 'star', emoji: '⭐', label: 'Star' },
  { id: 'fire', emoji: '🔥', label: 'Fire' },
] as const

export const SENTIMENT = [
  { e: '🤮', l: 'Really bad' },
  { e: '👎', l: 'Bad' },
  { e: '😐', l: 'Okay' },
  { e: '👍', l: 'Liked it' },
  { e: '😍', l: 'Loved it' },
] as const

export const REWATCH = [
  { v: 0, e: '🚯', l: 'Never again' },
  { v: 1, e: '🔂', l: 'Maybe once' },
  { v: 2, e: '🔁', l: 'A few times' },
  { v: 3, e: '♾️', l: 'Forever' },
] as const

export const REC = [
  { v: 'y' as const, e: '✅', l: 'Yes' },
  { v: 'm' as const, e: '🤷', l: 'Maybe' },
  { v: 'n' as const, e: '🚫', l: 'No' },
] as const

export const TIPS = [
  { id: 'soundtrack', e: '🎵', l: 'Soundtrack' },
  { id: 'plot', e: '📖', l: 'Plot' },
  { id: 'cinema', e: '🎥', l: 'Cinematography' },
  { id: 'babes', e: '💋', l: 'Babes' },
] as const

export const TAG_PRESETS = [
  'banger',
  'snoozer',
  'low key fire',
  'woke',
  '20 min too long',
  'gross',
  'horror',
  'comedy',
  'action',
  'drama',
  'sci-fi',
  'thriller',
  'romance',
  'documentary',
]

export function scoreColor(v: number | null | undefined): string {
  if (v == null) return 'var(--b1, rgba(127,127,127,0.2))'
  return `hsl(${Math.round(v * 1.2)} 60% 42%)` // 0=red → 100=green
}
