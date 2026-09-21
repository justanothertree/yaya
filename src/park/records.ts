/**
 * What you have beaten, and how quickly.
 *
 * ⚠️ THE FIGHT HAD NO MEMORY, WHICH IS THE LAST THING MISSING FROM THE LOOP. You draw a
 * creature, stand it up, beat it, read a line saying how long it took — and then nothing. Ask
 * "now what" and the honest answer was "draw another one". A boss you have already beaten
 * looks exactly like one you have not, and a fight you won in four minutes looks exactly like
 * the one you won in ninety seconds.
 *
 * ⚠️ LOCAL-FIRST, WHICH IS THE HOUSE PATTERN AND NOT A SHORTCUT. The song library, the paint
 * gallery, saved looks and adopted minions all work this way: localStorage is the source every
 * room reads synchronously, and library/cloud.ts keeps an account copy level behind it. Doing
 * anything else here would mean the park waits on the network to tell you whether you have
 * fought something before.
 *
 * ⚠️ AND IT IS YOURS, NOT A LEAGUE TABLE. Nobody else's times are here and none of these ever
 * leave for anywhere they could be compared. The park is where somebody's family go to hit a
 * drawing together; the thing worth keeping is "we did that, and faster than last time", not a
 * ranking of who is best at it.
 *
 * ⚠️ KEYED BY NAME, like every other merge in this codebase. It is the same key the gallery,
 * the library and the minion sync all use, so two creatures called the same thing share a
 * record — which is the same trade those made, for the same reason: a name is the only handle
 * a person actually has on their own drawing.
 */

const KEY = 'park_wins_v1'
const MAX = 200

export type Win = {
  /** the creature's name, which is the key */
  name: string
  /** how many times it has gone down */
  beaten: number
  /** the quickest, in seconds */
  best: number
  /** how many times it put you on the floor, in that quickest run */
  fell: number
  /** when it was last beaten */
  at: number
}

let cache: Win[] | null = null
const watchers = new Set<() => void>()

const tell = () => {
  cache = null
  for (const w of watchers) w()
}

export function subscribeWins(fn: () => void) {
  watchers.add(fn)
  return () => {
    watchers.delete(fn)
  }
}

/**
 * ⚠️ RE-VALIDATED ON THE WAY OUT AS WELL AS IN, the same rule the gallery states: localStorage
 * is editable by anything on this origin, so what a trusted path wrote is not necessarily what
 * comes back. Nothing here is rendered on anybody else's screen, but a NaN best time would
 * still put "NaNs" on yours.
 */
export function wins(): Win[] {
  if (cache) return cache
  let out: Win[] = []
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]')
    if (Array.isArray(raw)) {
      out = raw
        .map((v): Win | null => {
          if (!v || typeof v !== 'object') return null
          const o = v as Record<string, unknown>
          const name = typeof o.name === 'string' ? o.name.trim().slice(0, 40) : ''
          const num = (x: unknown, cap: number) =>
            typeof x === 'number' && Number.isFinite(x)
              ? Math.max(0, Math.min(cap, Math.round(x)))
              : 0
          if (!name) return null
          const beaten = num(o.beaten, 99999)
          const best = num(o.best, 86400)
          if (!beaten || !best) return null
          return { name, beaten, best, fell: num(o.fell, 9999), at: num(o.at, Date.now() * 2) }
        })
        .filter((v): v is Win => !!v)
        .slice(0, MAX)
    }
  } catch {
    out = []
  }
  cache = out
  return out
}

/** What you have done to this one before, or null if it is new to you. */
export const winFor = (name: string): Win | null =>
  wins().find((w) => w.name === name.trim().slice(0, 40)) ?? null

/**
 * Write one down.
 *
 * ⚠️ THE BEST RUN KEEPS ITS OWN KNOCKDOWNS. Storing the fewest falls separately from the
 * quickest time would make a "best" nobody ever actually had — a time from one fight and a
 * count from another, presented as one run. They move together or they are not a record of
 * anything.
 *
 * @returns the record as it now stands, and whether this run was the quickest yet
 */
export function recordWin(name: string, secs: number, fell: number): { win: Win; best: boolean } {
  const key = name.trim().slice(0, 40) || 'Something'
  const took = Math.max(1, Math.round(secs))
  const had = winFor(key)
  const better = !had || took < had.best
  const win: Win = {
    name: key,
    beaten: (had?.beaten ?? 0) + 1,
    best: better ? took : had.best,
    fell: better ? Math.max(0, Math.round(fell)) : had.fell,
    at: Date.now(),
  }
  const rest = wins().filter((w) => w.name !== key)
  /* newest first, so the cap drops what you have not touched in longest */
  const next = [win, ...rest].slice(0, MAX)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* full or blocked — the fight still happened */
  }
  tell()
  return { win, best: better }
}

/**
 * ⚠️ THE MERGE IS THE CONTRACT, and it is the reason these took a second step to reach the
 * account. library/cloud.ts was add-only and keyed by name — "if it is here already, skip it" —
 * which is right for a song or a drawing, things you either have or do not, and wrong for a
 * record, where the copy on the other machine might be the QUICKER one and would have been
 * dropped without a word. So the sync asks this file who wins rather than assuming the first
 * copy it met does, and this one function answers for both callers: a backup file off a disk
 * and a row off the account. One rule, or they would drift.
 *
 * ⚠️ MERGED, NEVER REPLACED. Times take the better, counts take the larger, and the newest
 * timestamp survives — so restoring an old backup onto a machine that has played more since
 * cannot throw the newer fights away, and neither can signing in on a second browser.
 *
 * @returns how many records this actually changed — zero when the two were already level,
 *          which is what the sync counts and what a restore summary should be honest about.
 */
export function mergeWins(v: unknown): number {
  if (!Array.isArray(v)) return 0
  const next = new Map(wins().map((w) => [w.name, w]))
  let changed = 0

  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : 0)
    const name = typeof o.name === 'string' ? o.name.trim().slice(0, 40) : ''
    const best = num(o.best)
    const beaten = num(o.beaten)
    if (!name || best <= 0 || beaten <= 0) continue

    const had = next.get(name)
    /* ⚠️ THE BEST RUN KEEPS ITS OWN KNOCKDOWNS, the same rule recordWin follows above: the
       falls come from whichever copy holds the quicker time, or a "best" would be a time from
       one fight and a count from another, presented as one run nobody ever had. */
    const quicker = !had || best < had.best
    const merged: Win = {
      name,
      beaten: Math.max(beaten, had?.beaten ?? 0),
      best: had ? Math.min(best, had.best) : best,
      fell: quicker ? num(o.fell) : had.fell,
      at: Math.max(num(o.at), had?.at ?? 0),
    }
    if (had && JSON.stringify(had) === JSON.stringify(merged)) continue
    next.set(name, merged)
    changed++
  }

  if (!changed) return 0
  /* newest first, so the cap drops what you have not touched in longest — same order recordWin
     writes in, because the cap has to mean the same thing whichever door a record came through */
  const list = [...next.values()].sort((a, b) => b.at - a.at).slice(0, MAX)
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* full or blocked — nothing was written, so nothing is half-merged */
    return 0
  }
  tell()
  return changed
}

/**
 * ⚠️ ONE ROW ON THE ACCOUNT, NOT TWO HUNDRED. member_library caps a person at 400 items, and a
 * record is about 90 bytes — one row each would spend half of somebody's whole library on 18KB
 * of text, next to songs and drawings that are measured in kilobytes. A record is also not a
 * separable thing the way a song is: nobody shares one, renames one or deletes one. The list is
 * the unit, so it travels as one document. See docs/2026-09-20-records-cross-the-browser.sql.
 */
export const packWins = (): Win[] => wins()
