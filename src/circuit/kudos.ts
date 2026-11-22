/**
 * Who gave which kudos on a log, said in words (OPEN-DECISIONS §22d, approved 22 Nov 2026).
 *
 * ⚠️ THE NAMES LIVED ONLY IN A TOOLTIP. A chip reads "🔥 2", and who the two were was its `title`,
 * which a phone never shows — and tapping the chip gives or takes back your own kudos, so no
 * gesture was left that showed them. The feed now puts one line above the open comments, built
 * here, and each chip carries the same names in its accessible name.
 *
 * Pure, so it can be asked without a browser: the chips and the line both read from this one
 * grouping, and the order is the order the kudos arrived in.
 */

export type KudosRow = {
  emoji: string
  user_id: string
  author_name: string | null
}

export type KudosGroup = {
  emoji: string
  count: number
  /** whether one of them is yours — the chip is drawn pressed */
  mine: boolean
  /** everybody else by the name they gave, in the order they arrived, then "you" */
  names: string[]
}

export function kudosGroups(rows: readonly KudosRow[], uid: string | null): KudosGroup[] {
  const by = new Map<string, { others: string[]; mine: boolean; count: number }>()
  for (const r of rows) {
    const g = by.get(r.emoji) ?? { others: [], mine: false, count: 0 }
    g.count++
    if (uid && r.user_id === uid) g.mine = true
    else g.others.push(r.author_name?.trim() || 'Member')
    by.set(r.emoji, g)
  }
  return [...by].map(([emoji, g]) => ({
    emoji,
    count: g.count,
    mine: g.mine,
    names: g.mine ? [...g.others, 'you'] : g.others,
  }))
}

/** "🔥 Jordan, Samantha · 💪 you" — empty when nobody has given one */
export const kudosLine = (groups: readonly KudosGroup[]): string =>
  groups.map((g) => `${g.emoji} ${g.names.join(', ')}`).join(' · ')
