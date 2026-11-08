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
  /** the sitting it belongs to — null for a note that belongs to a day instead */
  entry: string | null
  activity: string | null
  /** the local day it is listed under: the day it was written, or the day a day note is about */
  day: string
  /** the local day its sitting began — where it opens; null for a day note, which opens here */
  sat: string | null
}

/**
 * A note that belongs to a DAY rather than a sitting — "writing a note must not require starting a
 * timer". Private, in the export, never on anybody's timeline: see
 * docs/2026-11-08-chronicle-day-notes.DRAFT.sql, which is not applied yet.
 */
export type DayNote = { id: string; on: string; at: string; body: string }

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
export function journalRows(
  entries: readonly Entry[],
  fromMs: number,
  toMs: number,
  dayNotes: readonly DayNote[] = [],
): JournalRow[] {
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
  /**
   * A day note is listed under the day it is ABOUT, which is the day it was written unless you
   * wrote it later — so it is placed by its date, never by the moment, and ends at `toMs` like
   * everything else: a window ending at local midnight is the day before that midnight's date.
   */
  const fromDay = localISO(new Date(fromMs))
  const toDay = localISO(new Date(toMs))
  for (const n of dayNotes) {
    if (!(n.on >= fromDay && n.on < toDay) || seen.has(n.id)) continue
    seen.add(n.id)
    out.push({
      id: n.id,
      at: n.at,
      body: n.body,
      entry: null,
      activity: null,
      day: n.on,
      sat: null,
    })
  }
  /**
   * Newest DAY first, then newest moment; the id breaks a tie.
   *
   * ⚠️ BY DAY BEFORE MOMENT, because `byDay` groups in arrival order. A note about Monday written on
   * Tuesday has Tuesday's moment, and sorted by moment alone it would arrive among Tuesday's rows
   * and open a "Monday" group ABOVE Tuesday's. For a sitting's note the two orders are the same,
   * since its day is the day of its moment.
   */
  return out.sort(
    (a, b) =>
      b.day.localeCompare(a.day) || Date.parse(b.at) - Date.parse(a.at) || (a.id < b.id ? -1 : 1),
  )
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
    (r) =>
      r.body.toLocaleLowerCase().includes(q) ||
      ((r.activity && name.get(r.activity)) || '').includes(q),
  )
}

/**
 * A note with no session, placed in ONE day's log — the Day half's third kind of row, after a
 * sitting and a moment (§15a, answered).
 *
 * ⚠️ IT HAS A TIME ON THAT DAY ONLY IF IT WAS WRITTEN DURING THAT DAY. Evan's words: "a genuine
 * timestamp and no duration. Don't invent a time where only a date is known." A day note carries
 * two facts — the moment it was written, and the day it is about — and they differ whenever
 * somebody writes about yesterday, or a file puts one back. Placing "slept badly", written on
 * Thursday about Tuesday, at Thursday's 8:14 in Tuesday's list would be a time Tuesday never had.
 * So such a note goes to the head of the day with no clock, the way a workout with no hour does,
 * and says when it was written instead.
 *
 * ⚠️ `fromMs` AND `toMs` ARE THE DAY'S OWN BOUNDS, `dayBounds` in the room, which is what makes a
 * 25-hour day in November and a 23-hour one in March right without this knowing about either.
 */
export type DayLogNote = { at: number; timed: boolean; n: DayNote }

export function dayLogNotes(
  notes: readonly DayNote[],
  day: string,
  fromMs: number,
  toMs: number,
): DayLogNote[] {
  const out: DayLogNote[] = []
  for (const n of notes) {
    if (n.on !== day) continue
    const ms = Date.parse(n.at)
    const timed = Number.isFinite(ms) && ms >= fromMs && ms < toMs
    out.push({ at: timed ? ms : Infinity, timed, n })
  }
  return out
}
