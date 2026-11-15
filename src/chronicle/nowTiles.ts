import { overlapMs, type Activity } from './record'

/*
 * ⚠️ THE FILE IS STILL CALLED nowTiles BECAUSE THE ROOM IT WAS NAMED FOR IS GONE. The Now room
 * folded into Chronicle's Day half, and `tilesFor` came with it — it is the switch row's ranking
 * now, and the only copy of it, because Timer.tsx had grown a second one inline. The name is left
 * alone on purpose: it is what the tests, the docs and the commit that explains the midnight-
 * straddle fix all say, and renaming it would cost all of that to save a word.
 */

/** just enough of a sitting to weigh it — see `tilesFor` */
export type Sat = { activity: string; start: string; end: string | null }

/**
 * The activities to offer as buttons, in the order they are worth offering.
 *
 * ⚠️ IT IS PURE SO IT CAN BE ASKED A QUESTION. This lived inside the Now room as a `useMemo`,
 * which
 * is where this project keeps saying logic should not live: it has a UNIT in it — minutes — and
 * three claims about what a tile IS, none of which could be checked without a browser.
 *
 * ⚠️ `nowMs` IS A PARAMETER, and it was `Date.now()` read inside the memo. That is both
 * untestable and slightly wrong: the memo recomputes only when the activities or the log change,
 * so the running sitting's length froze between loads and the order drifted from the truth it is
 * supposed to reflect.
 */
/**
 * ⚠️ IT TAKES THE WINDOW, because "today" was a claim this function could not keep. It summed
 * `to - from` for every sitting it was handed and called the result minutes today — true only
 * while the caller's log happened to hold exactly today, and `entriesBetween` deliberately
 * returns a sitting that STRADDLES midnight. `record.ts` is explicit that such a sitting is "two
 * hours long and belongs to two days — one hour each"; this counted both hours against today.
 *
 * Measured, before: a night shift of 23:00→07:00 holds seven hours of today, and a 09:00→16:30
 * sitting holds seven and a half — so the second belongs first. It was ranked second, because
 * eight is more than seven and a half.
 *
 * ⚠️ AND IT BORROWS `overlapMs` RATHER THAN CLAMPING ITSELF, which is the same argument `lane`,
 * `against` and `coveredMs` are all built on: the day strip, the grids, the totals and this list
 * must not be able to disagree about what a sitting is worth in a window, and the only way to
 * guarantee that is for them to be the same arithmetic asked again.
 */
export function tilesFor(
  acts: readonly Activity[],
  log: readonly Sat[],
  fromMs: number,
  toMs: number,
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

  /* ⚠️ a sitting with no end is the one you are IN, and `overlapMs` measures it to `nowMs` and
     no further — which is what keeps the thing you are doing near the front of the list rather
     than wherever it was this morning. An unparseable date is worth nothing there, not NaN. */
  const mins = new Map<string, number>()
  for (const e of log) {
    const ms = overlapMs(e, fromMs, toMs, nowMs)
    if (ms > 0) mins.set(e.activity, (mins.get(e.activity) ?? 0) + ms)
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

/**
 * Your activities, the most recently started first — the chips under ▶ Start something.
 *
 * ⚠️ RECENT, NOT BUSIEST, which is the answer #298's third question was given ("the three most
 * recent activities, or ones you pin?"). `tilesFor` ranks by minutes TODAY, which is right for a
 * list you are switching around in and wrong for the first screen of a morning: before anything
 * has run every activity has zero minutes, and the row is alphabetical. "What did I start last" is
 * the question somebody opening an idle Day is asking.
 *
 * ⚠️ AND THE REST FOLLOW, BY NAME, rather than the list stopping short. The room hands in a week,
 * so the first morning of a week has nothing recent in it — and no chips there would be the one
 * screen where a shortcut is most wanted and least present. Auto and archived activities are never
 * offered, for the reason `tilesFor` gives.
 */
export function recentFirst(acts: readonly Activity[], log: readonly Sat[]): Activity[] {
  const last = new Map<string, number>()
  for (const e of log) {
    const t = Date.parse(e.start)
    if (Number.isFinite(t) && t > (last.get(e.activity) ?? -Infinity)) last.set(e.activity, t)
  }
  /* ⚠️ `-Infinity - -Infinity` is NaN, which is falsy, so two never-started ones fall through to
     the name — the same tie-break `tilesFor` uses */
  return acts
    .filter((a) => !a.archived && !a.auto)
    .sort(
      (x, y) =>
        (last.get(y.id) ?? -Infinity) - (last.get(x.id) ?? -Infinity) ||
        x.name.localeCompare(y.name),
    )
}

/** how far either side of now a start still counts as "around now", in minutes */
export const USUAL_WINDOW = 90
/** how much evidence makes a habit: about two starts near this time */
export const USUAL_ENOUGH = 1.5

/**
 * Your activities, what you usually start around now first — the chips under ▶ Start something.
 *
 * ⚠️ A ROUTINE BEFORE A MEMORY. "The three you started last" (`recentFirst`) answers the morning
 * badly when last night was Drawing and every weekday at seven is Gym. So each start in `past` (the
 * last four weeks, from the room) counts towards its activity when its clock time is within
 * `USUAL_WINDOW` minutes of now, more the closer it is. Midnight wraps: 23:50 is twenty minutes
 * from 00:10.
 *
 * ⚠️ THIS WEEKDAY FIRST, THEN ANY DAY, then recency. A single weighted sum let a habit five days a
 * week outvote the one that only happens today: Gym at seven on weekdays beat Guitar at half past
 * seven on Saturdays, ON a Saturday. So an activity with enough evidence on this weekday leads, one
 * with enough evidence near this time on any day comes next, and everything else keeps the
 * `recentFirst` order — which is the whole list on a new account, so nothing is lost by this.
 *
 * ⚠️ `USUAL_ENOUGH` IS ABOUT TWO STARTS, so one stray evening does not become a routine.
 */
export function usualFirst(
  acts: readonly Activity[],
  past: readonly Sat[],
  lately: readonly Sat[],
  nowMs: number,
): Activity[] {
  const now = new Date(nowMs)
  const at = now.getHours() * 60 + now.getMinutes()
  const sameDay = new Map<string, number>()
  const anyDay = new Map<string, number>()
  for (const e of past) {
    const t = Date.parse(e.start)
    if (!Number.isFinite(t) || t > nowMs) continue
    const d = new Date(t)
    const raw = Math.abs(d.getHours() * 60 + d.getMinutes() - at)
    const off = Math.min(raw, 24 * 60 - raw)
    if (off >= USUAL_WINDOW) continue
    const w = 1 - off / USUAL_WINDOW
    anyDay.set(e.activity, (anyDay.get(e.activity) ?? 0) + w)
    if (d.getDay() === now.getDay()) sameDay.set(e.activity, (sameDay.get(e.activity) ?? 0) + w)
  }
  const order = recentFirst(acts, lately)
  const rank = new Map(order.map((a, i) => [a.id, i]))
  /* the tier, then the evidence inside it: this weekday, any day, or none */
  const key = (a: Activity): [number, number] => {
    const s = sameDay.get(a.id) ?? 0
    if (s >= USUAL_ENOUGH) return [2, s]
    const n = anyDay.get(a.id) ?? 0
    return n >= USUAL_ENOUGH ? [1, n] : [0, 0]
  }
  return order.sort((x, y) => {
    const [tx, sx] = key(x)
    const [ty, sy] = key(y)
    return ty - tx || sy - sx || rank.get(x.id)! - rank.get(y.id)!
  })
}
