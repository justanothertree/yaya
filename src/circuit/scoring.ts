// Shared scoring helpers for The Circuit (used by Board, Log, Charts…).
import type { DayLog, Person } from './types'

/** Points for a single entry. Imported "__total__" days store points directly. */
export function entryPoints(p: Person, eid: string, val: number): number {
  if (eid === '__total__') return val
  const ex = p.exercises.find((x) => x.id === eid)
  return ex ? val * ex.mult : 0
}

export function logPoints(p: Person, log: DayLog): number {
  return (log.entries || []).reduce((s, e) => s + entryPoints(p, e.eid, e.val), 0)
}

/** Total points a person earned on a given ISO date. */
export function dayTotal(p: Person, logs: DayLog[], date: string): number {
  return logs
    .filter((l) => l.personId === p.id && l.date === date)
    .reduce((s, l) => s + logPoints(p, l), 0)
}

/** Total points a person earned in a YYYY-MM month. */
export function monthTotal(p: Person, logs: DayLog[], ym: string): number {
  return logs
    .filter((l) => l.personId === p.id && l.date.startsWith(ym))
    .reduce((s, l) => s + logPoints(p, l), 0)
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

/** Does this person's log for the date exist and only carry an imported total? */
export function isImportedTotal(log: DayLog | undefined): boolean {
  return !!log && (log.entries || []).some((e) => e.eid === '__total__')
}

/** Current streak: consecutive days (back from the latest logged day) with any points. */
export function currentStreak(p: Person, logs: DayLog[]): number {
  const dates = new Set(
    logs.filter((l) => l.personId === p.id && logPoints(p, l) > 0).map((l) => l.date),
  )
  if (!dates.size) return 0
  const latest = [...dates].sort().pop() as string
  const d = new Date(latest + 'T00:00:00')
  let streak = 0
  while (dates.has(d.toISOString().slice(0, 10))) {
    streak++
    d.setDate(d.getDate() - 1)
  }
  return streak
}

/** Per-day point totals for a person across a YYYY-MM month (index 0 = day 1). */
export function monthDaily(p: Person, logs: DayLog[], ym: string, days: number): number[] {
  const out: number[] = []
  for (let d = 1; d <= days; d++) {
    out.push(dayTotal(p, logs, `${ym}-${String(d).padStart(2, '0')}`))
  }
  return out
}
