import { whole } from '../../gpu/kept'
import { isToyId } from './gate'
import type { Mode } from './room'

/**
 * Games finished in a call, kept in this browser per toy, so a finished online match can be shared
 * like any other result (docs/2026-11-14-lab-online-modes-plan.md, Share your score).
 *
 * One key for every toy, since a toy that plays online writes here and nowhere else about it: a
 * tally for versus (against the other seat) and one for together (the two of you against the
 * computer, or against the puzzle). A watcher keeps nothing; each seated player keeps their own.
 * Recorded, not checked: a card made from this says so.
 */
export const ONLINE_KEY = 'lab_online_v1'
export type Tally = { won: number; lost: number; drawn: number }
export type ToyRecord = Partial<Record<Mode, Tally>>
export type Online = Record<string, ToyRecord>
const NONE: Tally = { won: 0, lost: 0, drawn: 0 }

/** the online record from untrusted storage: toy ids of the catalog's shape, whole counts only */
export function readOnline(text: string | null): Online {
  let v: unknown
  try {
    v = JSON.parse(text ?? 'null')
  } catch {
    return {}
  }
  if (typeof v !== 'object' || !v || Array.isArray(v)) return {}
  const out: Online = {}
  for (const [toy, r] of Object.entries(v as Record<string, unknown>).slice(0, 200)) {
    if (!isToyId(toy) || typeof r !== 'object' || !r) continue
    const rec: ToyRecord = {}
    for (const mode of ['versus', 'together'] as const) {
      const t = (r as Record<string, unknown>)[mode] as Record<string, unknown> | undefined
      if (typeof t !== 'object' || !t) continue
      const tally = { won: whole(t.won), lost: whole(t.lost), drawn: whole(t.drawn) }
      if (tally.won + tally.lost + tally.drawn) rec[mode] = tally
    }
    if (rec.versus || rec.together) out[toy] = rec
  }
  return out
}

/** the record with one more finished game */
export function recordOnline(
  o: Online,
  toy: string,
  mode: Mode,
  how: 'won' | 'lost' | 'drawn',
): Online {
  const t = o[toy]?.[mode] ?? NONE
  return { ...o, [toy]: { ...o[toy], [mode]: { ...t, [how]: t[how] + 1 } } }
}

/** keep one more finished game; a store that refuses (private mode) keeps nothing */
export function keepOnline(toy: string, mode: Mode, how: 'won' | 'lost' | 'drawn') {
  try {
    const next = recordOnline(readOnline(localStorage.getItem(ONLINE_KEY)), toy, mode, how)
    localStorage.setItem(ONLINE_KEY, JSON.stringify(next))
  } catch {
    /* private mode: the game was played, and is simply not kept */
  }
}

const games = (n: number) => `${n} online ${n === 1 ? 'game' : 'games'}`
const drew = (t: Tally) => (t.drawn ? ` (${t.drawn} drawn)` : '')

/**
 * The online part of a toy's share line, or null with nothing won: "beat friends in 3 of 5 online
 * games", "won 2 of 3 online games together against the computer". `against` names what the two
 * of you play together, for a toy whose together game has no computer.
 */
export function onlineLine(
  read: (key: string) => string | null,
  toy: string,
  against = 'against the computer',
): string | null {
  const r = readOnline(read(ONLINE_KEY))[toy]
  const parts: string[] = []
  const v = r?.versus
  if (v?.won) parts.push(`beat friends in ${v.won} of ${games(v.won + v.lost + v.drawn)}${drew(v)}`)
  const t = r?.together
  if (t?.won)
    parts.push(`won ${t.won} of ${games(t.won + t.lost + t.drawn)} together ${against}${drew(t)}`)
  return parts.length ? parts.join(', ') : null
}
