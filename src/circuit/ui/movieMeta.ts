// Movie rating vocabulary (mirrors the standalone app) + shared helpers.
import { peopleInGroup } from '../groupFilter'
import { circuitStore } from '../store'
import { peekPersistedUserId } from '../../finance/auth'
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
  /**
   * ⚠️ THE ID IS THE ACCOUNT NOW, not circuit_people.id, because that is what a rating is keyed
   * by since ratings became rows. Everything downstream does `movie.ratings[rater.id]`, so
   * swapping the id here is the whole of the change — five screens carried on unedited.
   *
   * ⚠️ `?? p.id` is not defensive padding, it is the signed-out demo. Nobody in the public seed
   * has an account, so filtering to people who do would empty the board of columns for every
   * visitor. Falling back keeps the sandbox internally consistent — it writes and reads its own
   * ratings under the same key — while a real member gets a real account id.
   */
  /**
   * ⚠️ ONE ENTRY PER ACCOUNT, because two person rows can point at the same one.
   *
   * Swapping in the account id makes that collision visible: tIN had both a "Tin" row carrying 46
   * logs and a later "Ramtin" row carrying none, both with his owner_user_id — so the board drew
   * two columns with the SAME id. Duplicate React keys, `hidden` applying to both at once, and a
   * column that would not hide and multiplied when toggled.
   *
   * The account is the identity for a rating, so two rows sharing one is one rater however the
   * people table got that way. Deduped here rather than trusted not to happen, because a merged
   * account, a re-invite or a second device can all produce it again.
   *
   * The row carrying history wins: keeping the one with a real id over a generated one would be
   * arbitrary, but "the one people have actually logged against" is the row the rest of the app
   * already treats as that person.
   */
  const seen = new Map<string, Person>()
  for (const p of peopleInGroup(people, group ?? '')) {
    const keyed = p.ownerUserId ? { ...p, id: p.ownerUserId } : p
    const had = seen.get(keyed.id)
    if (!had) seen.set(keyed.id, keyed)
  }
  return [...seen.values()]
}

/**
 * Whether you may rate in this person's name.
 *
 * ⚠️ You may not, and the policies say so too: a rating row carries `user_id = auth.uid()`. The
 * board used to let anyone fill in anyone's column, which suited four people round one laptop
 * and is exactly how one person's write erased another's. Signed out there are no accounts at
 * all, so the demo stays fully playable.
 */
export function canRateAs(raterId: string): boolean {
  const me = peekPersistedUserId()
  return !me || raterId === me
}

/**
 * Which circuit a new review joins, when nobody said.
 *
 * ⚠️ Lives here rather than in AddMovie.tsx because two screens now create reviews — the Add
 * dialog and "Rate it" on a pool's result — and a component file that also exports helpers
 * breaks fast refresh (see the same note atop visibilityLabels.ts).
 *
 * ⚠️ Reviews are still circuit-scoped while pools are not, so a pool shared with friends who
 * share no circuit files its review under YOUR usual circuit. That is the honest behaviour of
 * the current model rather than a decision made here; it goes away when the review board moves
 * to friends too.
 */
export function defaultMovieGroup(): string | undefined {
  const st = circuitStore.getState()
  const counts = new Map<string, number>()
  for (const m of st.movies) if (m.groupId) counts.set(m.groupId, (counts.get(m.groupId) ?? 0) + 1)
  let best: string | undefined
  let bestN = 0
  for (const [g, n] of counts)
    if (n > bestN) {
      bestN = n
      best = g
    }
  return best ?? st.groups?.[0]?.id ?? undefined
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
