import type { Activity } from './record'

/** just enough of a sitting to weigh it — see `tilesFor` */
export type Sat = { activity: string; start: string; end: string | null }

/**
 * The activities to offer as buttons, in the order they are worth offering.
 *
 * ⚠️ IT IS PURE SO IT CAN BE ASKED A QUESTION. This lived inside `Now.tsx` as a `useMemo`, which
 * is where this project keeps saying logic should not live: it has a UNIT in it — minutes — and
 * three claims about what a tile IS, none of which could be checked without a browser.
 *
 * ⚠️ `nowMs` IS A PARAMETER, and it was `Date.now()` read inside the memo. That is both
 * untestable and slightly wrong: the memo recomputes only when the activities or the log change,
 * so the running sitting's length froze between loads and the order drifted from the truth it is
 * supposed to reflect.
 */
export function tilesFor(
  acts: readonly Activity[],
  log: readonly Sat[],
  nowMs: number,
): Activity[] {
  /**
   * ⚠️ ARCHIVED AND `auto` ARE BOTH OUT, and for different reasons that happen to agree.
   * `chronicle_start` refuses an activity with an `archived_at`, so a tile for one would be a
   * button whose only possible answer is an error — the lesson an archived routine step taught.
   * An `auto` activity is written by the room itself ("Chronicle" counts time on the site), so
   * it is not a thing a person starts at all.
   */
  const live = acts.filter((a) => !a.archived && !a.auto)

  const mins = new Map<string, number>()
  for (const e of log) {
    const from = Date.parse(e.start)
    if (!Number.isFinite(from)) continue
    /* ⚠️ a sitting with no end is the one you are IN, and it reaches to now — which is what keeps
       the thing you are doing near the front of the list rather than wherever it was this morning */
    const to = e.end ? Date.parse(e.end) : nowMs
    if (!Number.isFinite(to)) continue
    mins.set(e.activity, (mins.get(e.activity) ?? 0) + Math.max(0, to - from))
  }

  /**
   * ⚠️ MOST USED TODAY FIRST, BY NAME WHEN LEVEL. The order is the whole ergonomics of the room:
   * the two or three things somebody actually does should be under the thumb without reading.
   * Alphabetical as the tie-break rather than whatever order the server sent, so a screen full
   * of untouched activities is at least stable between loads instead of shuffling.
   *
   * ⚠️ SORTED IN PLACE, AND THAT IS SAFE HERE — `filter` above has already made a new array, so
   * this can never reach the list the caller is holding. The first version spread `live` again
   * to guard against exactly that, with a test to match; the test could not be made to fail,
   * because the thing it described was impossible. Both are gone rather than kept as a comfort.
   */
  return live.sort(
    (x, y) => (mins.get(y.id) ?? 0) - (mins.get(x.id) ?? 0) || x.name.localeCompare(y.name),
  )
}
