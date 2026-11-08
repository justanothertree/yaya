import { localISO } from '../circuit/dates'
import type { Activity, Entry } from './record'

/**
 * Everything you have written, as one list — the journal read across sittings instead of inside
 * one.
 *
 * ⚠️ THE NOTES EXISTED AND HAD NO LIST. Every journal entry hangs off a sitting, and the only way
 * to read one was to find that sitting in a day's log and open its editor — so "what did I write
 * about the gym last Tuesday" meant stepping back day by day and opening rows to look. The words
 * were all kept; nothing could show them together.
 *
 * ⚠️ IT IS PURE SO THE TWO DAY RULES CAN BE ASKED, and they are different rules on purpose. A
 * note is LISTED under the day it was written, because that is the day you remember writing it.
 * It OPENS on the day its sitting began, because the editor is reached through a day's log and a
 * sitting from Monday with a line added on Thursday is not in Thursday's log at all — opening it
 * there would land on an editor with nothing in it.
 */
export type JournalRow = {
  /** the note's own id */
  id: string
  /** when it was written, ISO */
  at: string
  body: string
  /** the sitting it belongs to */
  entry: string
  activity: string
  /** the local day it was written — where it is listed */
  day: string
  /** the local day its sitting began — where it opens */
  sat: string
}

/**
 * Every note written inside `[fromMs, toMs)`, newest first.
 *
 * ⚠️ FILTERED ON THE NOTE, NOT THE SITTING. `entriesBetween` returns every sitting that OVERLAPS
 * the range, which includes one that began before it — and that sitting carries all of its notes,
 * including ones written before the window opened. Listing those would put last month's sentence
 * at the bottom of this month's journal, looking like it belonged there.
 *
 * ⚠️ AND ONCE PER NOTE. Two windows fetched separately and joined can carry the same sitting
 * twice; a note listed twice reads as having been written twice.
 */
export function journalRows(entries: readonly Entry[], fromMs: number, toMs: number): JournalRow[] {
  const seen = new Set<string>()
  const out: JournalRow[] = []
  for (const e of entries) {
    for (const n of e.notes) {
      const ms = Date.parse(n.at)
      if (!(ms >= fromMs && ms < toMs) || seen.has(n.id)) continue
      seen.add(n.id)
      out.push({
        id: n.id,
        at: n.at,
        body: n.body,
        entry: e.id,
        activity: e.activity,
        day: localISO(new Date(ms)),
        sat: localISO(new Date(Date.parse(e.start))),
      })
    }
  }
  /* newest first; the id breaks a tie so two notes in the same millisecond keep one order */
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.id < b.id ? -1 : 1))
}

/** The rows grouped by the day they were written, in the order they arrived. */
export function byDay(rows: readonly JournalRow[]): Array<[string, JournalRow[]]> {
  const groups = new Map<string, JournalRow[]>()
  for (const r of rows) {
    const g = groups.get(r.day)
    if (g) g.push(r)
    else groups.set(r.day, [r])
  }
  return [...groups]
}

/**
 * The rows a search keeps — the words, or the name of what they were written about.
 *
 * ⚠️ THE ACTIVITY'S NAME COUNTS AS A MATCH, because "gym" is how somebody looks for what they
 * wrote at the gym, and the note itself almost never says the word — it says "left knee again".
 */
export function matching(
  rows: readonly JournalRow[],
  query: string,
  acts: readonly Activity[],
): JournalRow[] {
  const q = query.trim().toLocaleLowerCase()
  if (!q) return [...rows]
  const name = new Map(acts.map((a) => [a.id, a.name.toLocaleLowerCase()]))
  return rows.filter(
    (r) => r.body.toLocaleLowerCase().includes(q) || (name.get(r.activity) ?? '').includes(q),
  )
}
