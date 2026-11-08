import type { DayLog } from './types'

/**
 * Chronicle's sessions, in the Circuit grid — step 2b of recorded-once, under OPEN-DECISIONS §19g.
 *
 * A cell is one person's exercise on one day, and its TOTAL is two parts: what was typed into the
 * grid (the manual part, stored in `circuit_logs` until a person's logs are converted) and every set
 * counted during a Chronicle sitting for that person, exercise and day. The board shows totals —
 * so scoring, charts, the feed and personal bests all go on reading `entries` as they always have —
 * and a save sends a total back for the server to split (`circuit_cell_set`).
 *
 * ⚠️ THE SPLIT IS THE SERVER'S, NOT THIS FILE'S. This only says what the screen SAW, so the server
 * can refuse a save made against figures that have since moved. Evan's rule: "Saving 20 again must
 * still total 20—not 28", and "later sessions add normally".
 *
 * ⚠️ DRAFT-DEPENDENT: until docs/2026-11-09-circuit-grid-sessions.DRAFT.sql is applied the session
 * reader does not exist, every sum is empty, and the board is exactly what it was.
 */
export type SessionSum = { person: string; exercise: string; on: string; value: number }

/**
 * The board's logs with the sessions added in — totals in `entries`, the session part kept beside
 * them in `sessions` so a save can say what it saw.
 *
 * ⚠️ INTO THE FIRST ROW OF THE DAY, by id. Two rows for one day are allowed and the grid has always
 * read the first; adding a day's sessions to both would double them on screen. A day with sessions
 * and no row gets one, with the id the grid itself would give it, so typing into it finds that row.
 */
export function withSessions(logs: readonly DayLog[], sums: readonly SessionSum[]): DayLog[] {
  if (!sums.length) return [...logs]
  const byDay = new Map<string, SessionSum[]>()
  for (const x of sums) {
    if (!(x.value > 0)) continue
    const k = `${x.person}|${x.on}`
    const list = byDay.get(k)
    if (list) list.push(x)
    else byDay.set(k, [x])
  }
  const first = new Map<string, string>()
  for (const l of [...logs].sort((a, b) => a.id.localeCompare(b.id))) {
    const k = `${l.personId}|${l.date}`
    if (!first.has(k)) first.set(k, l.id)
  }
  const out = logs.map((l) => {
    const k = `${l.personId}|${l.date}`
    const here = byDay.get(k)
    if (!here || first.get(k) !== l.id) return l
    const entries = l.entries.map((e) => ({ ...e }))
    for (const x of here) {
      const hit = entries.find((e) => e.eid === x.exercise)
      if (hit) hit.val += x.value
      else entries.push({ eid: x.exercise, val: x.value })
    }
    return { ...l, entries, sessions: here.map((x) => ({ eid: x.exercise, val: x.value })) }
  })
  for (const [k, here] of byDay) {
    if (first.has(k)) continue
    const [person, on] = k.split('|')
    out.push({
      id: `l-${person}-${on}`,
      personId: person,
      date: on,
      entries: here.map((x) => ({ eid: x.exercise, val: x.value })),
      sessions: here.map((x) => ({ eid: x.exercise, val: x.value })),
    })
  }
  return out
}

/** How much of a cell its sessions hold, on a log as the board has it. */
export const sessionsIn = (log: DayLog | undefined, eid: string): number =>
  (log?.sessions ?? []).reduce((n, x) => (x.eid === eid ? n + x.val : n), 0)

/** One cell to send: the total typed, and what the screen saw underneath it. */
export type CellChange = { eid: string; total: number; seenSessions: number; seenManual: number }

/**
 * The cells a save changes, from the log the board had to the log the grid wants.
 *
 * ⚠️ ONLY THE CELLS THAT MOVED, and a cell cleared from the grid is a total of 0 — which the server
 * refuses with the session amount if sessions hold part of it, rather than this guessing what a
 * blank meant.
 */
export function cellChanges(prev: DayLog | undefined, next: DayLog): CellChange[] {
  const was = new Map((prev?.entries ?? []).map((e) => [e.eid, e.val]))
  const now = new Map(next.entries.map((e) => [e.eid, e.val]))
  const out: CellChange[] = []
  for (const eid of new Set([...was.keys(), ...now.keys()])) {
    if (eid === '__total__') continue
    const before = was.get(eid) ?? 0
    const after = now.get(eid) ?? 0
    if (before === after) continue
    const seenSessions = sessionsIn(prev, eid)
    out.push({ eid, total: after, seenSessions, seenManual: Math.max(0, before - seenSessions) })
  }
  return out
}
