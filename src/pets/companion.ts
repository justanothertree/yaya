/**
 * Whether one of your pets follows you around the site, and which.
 *
 * ⚠️ OFF UNTIL ASKED FOR, and that is not a default I would argue about. A creature in the corner
 * of every page is the most intrusive thing this site could do on its own — it is on the Circuit,
 * on somebody else's profile, over the family's money. Nobody gets one because the feature
 * shipped; you get one because you said yes in the Pets room.
 *
 * ⚠️ AND IT IS ALWAYS DISMISSIBLE FROM WHERE IT IS. Evan's note about the mouse-trail anchor was
 * "neat but an eye sore" and that it should be hideable — the same is true here and more so, so
 * the ✕ sits on the pet rather than being a setting you have to go and find. The one thing an
 * overlay must never do is make you hunt for the way to stop looking at it.
 *
 * ⚠️ PER BROWSER, like the theme. It is a preference about this screen rather than a fact about
 * you, and it does not belong in the library that syncs — a pet in the corner of a shared laptop
 * is not something to inflict from another machine.
 */

const KEY = 'pet_companion_v1'

export type Companion = {
  on: boolean
  /** which pet, by name. Absent or unknown falls back to the first one you have. */
  name: string | null
}

const OFF: Companion = { on: false, name: null }

let cache: Companion | null = null
const listeners = new Set<() => void>()

export function subscribeCompanion(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function companion(): Companion {
  if (cache) return cache
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (raw && typeof raw === 'object') {
      const o = raw as Record<string, unknown>
      cache = {
        on: o.on === true,
        name: typeof o.name === 'string' ? o.name.slice(0, 40) : null,
      }
      return cache
    }
  } catch {
    /* private mode, or something else wrote nonsense here — the answer is simply no */
  }
  cache = OFF
  return cache
}

export function setCompanion(next: Partial<Companion>) {
  const now = { ...companion(), ...next }
  cache = now
  try {
    localStorage.setItem(KEY, JSON.stringify(now))
  } catch {
    /* it holds for this visit */
  }
  listeners.forEach((l) => l())
}
