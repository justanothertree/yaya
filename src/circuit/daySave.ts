import type { DayLog, LogEntry } from './types'

/**
 * The day the grid saves when somebody types into it: the day the board already has, with the
 * numbers replaced.
 *
 * ⚠️ EVERYTHING ELSE ON THAT DAY GOES WITH IT. The autosave used to build a fresh day out of the
 * numbers alone, and the store paints a save on screen before the server answers — so one typed
 * number quietly took two things off the board's copy of that day:
 *
 * - **its photograph.** Measured in the preview: a day with a photo, one number typed, and the
 *   board's copy read `picture: null` while the stored row still had it. Clearing the numbers
 *   afterwards then DELETED the row, because the grid keeps a day alive only while it can see a
 *   photo on it — and a deleted row takes its comments with it. The realtime echo does not repair
 *   it: the store replays its own recent write over every board for four seconds, and the echo
 *   arrives inside that window.
 * - **the part Chronicle's sessions hold.** The cell went on showing the right total, but its
 *   "15 from Chronicle sessions · change them there" line vanished after every save, and with it
 *   the only way the grid offers to lower that part (OPEN-DECISIONS §19g).
 *
 * Neither is sent to the server: `logToRow` does not write `picture`, and the adapter splits a total
 * against the sessions it loaded, not these. They are carried so the screen goes on telling the
 * truth about a row nobody changed.
 */
export function daySave(
  existing: DayLog | undefined,
  personId: string,
  date: string,
  entries: LogEntry[],
): DayLog {
  return { ...existing, id: existing?.id ?? `l-${personId}-${date}`, personId, date, entries }
}
