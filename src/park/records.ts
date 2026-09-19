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
 * ⚠️ AND DELIBERATELY NOT ON library/cloud.ts, WHICH WOULD LOSE THE THING THIS IS FOR. That
 * sync is add-only and keyed by name: "if it is here already, skip it". Right for a song or a
 * drawing, which you either have or do not — and wrong for a record, where the copy on the
 * other machine might be the QUICKER one and would be dropped without a word. Merging records
 * is well defined (see restoreWins) but it is a second contract for that file to hold, so it
 * is a deliberate piece of work rather than a fifth line in its list. Until then a record
 * moves between machines the way everything did before the sync existed: in the backup file.
 */

/** For the backup file, which already carries everything else a person has made here. */
export const packWins = (): Win[] => wins()

export function restoreWins(v: unknown): number {
  if (!Array.isArray(v)) return 0
  let n = 0
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    const name = typeof o.name === 'string' ? o.name.trim().slice(0, 40) : ''
    const best = typeof o.best === 'number' && Number.isFinite(o.best) ? Math.round(o.best) : 0
    const beaten =
      typeof o.beaten === 'number' && Number.isFinite(o.beaten) ? Math.round(o.beaten) : 0
    if (!name || best <= 0 || beaten <= 0) continue
    const had = winFor(name)
    /**
     * ⚠️ MERGED, NEVER REPLACED, the same add-only rule the library sync follows and for the
     * same reason: a backup restored onto a machine that has since played more should not
     * throw away the newer fights. Times take the better, counts take the larger.
     */
    const fell = typeof o.fell === 'number' && Number.isFinite(o.fell) ? Math.round(o.fell) : 0
    const merged: Win = {
      name,
      beaten: Math.max(beaten, had?.beaten ?? 0),
      best: had ? Math.min(best, had.best) : best,
      fell: !had || best < had.best ? fell : had.fell,
      at: Math.max(typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : 0, had?.at ?? 0),
    }
    const rest = wins().filter((w) => w.name !== name)
    try {
      localStorage.setItem(KEY, JSON.stringify([merged, ...rest].slice(0, MAX)))
    } catch {
      /* full — stop rather than half-write the rest */
      break
    }
    cache = null
    n++
  }
  tell()
  return n
}
