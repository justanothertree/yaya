/**
 * Which of several overlapping loads gets to speak.
 *
 * ⚠️ THE NEWEST STARTED, NOT THE LAST TO ANSWER. Chronicle's room reloads after every tick, so two
 * loads overlap all the time, and the slower one answered last and won. That was a cosmetic flicker
 * until a load could FAIL: an older load that read the goal marks fine, answering after a newer one
 * whose read failed, switched − and + back on over marks the room no longer had (found in review,
 * 28 Nov 2026) — and the other way round, an old failure re-blocked them after a Retry worked.
 *
 * `start()` is called as a load begins and hands back its ticket; `current(ticket)` says whether
 * that load is still the newest, and is asked after every await before anything is set.
 */
export function latestOnly() {
  let newest = 0
  return {
    start: (): number => ++newest,
    current: (ticket: number): boolean => ticket === newest,
  }
}
