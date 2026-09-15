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

/**
 * What the screen suggests a corner pet should be, before the person's own preference.
 *
 * ⚠️ A FRACTION OF THE SHORT SIDE. It was a fixed 104 pixels — a reasonable ornament on a
 * laptop, a third of the width of a phone, and a speck on a big monitor. Reported as "very tiny
 * compared to my screen", which it was, on the screen it was being looked at on. The floor and
 * the ceiling stop a phone getting a creature it has to look around and a wall display getting a
 * poster.
 *
 * ⚠️ HERE RATHER THAN IN THE COMPONENT, because fast refresh only works when a component file
 * exports components — and because the rule and the multiplier that scales it are one idea.
 */
export const cornerSize = (shortSide: number) =>
  Math.max(88, Math.min(260, Math.round(shortSide * 0.18)))

export type Companion = {
  on: boolean
  /** which pet, by name. Absent or unknown falls back to the first one you have. */
  name: string | null
  /**
   * How big, as a multiple of the size the screen suggests.
   *
   * ⚠️ A MULTIPLIER AND NOT A PIXEL COUNT, because the thing it adjusts is already relative
   * to the screen — a number of pixels that is right on a laptop is a speck on a big monitor and
   * a third of a phone. Storing "a bit bigger than the default" survives moving between them;
   * storing 140 does not.
   */
  size: number
}

const OFF: Companion = { on: false, name: null, size: 1 }

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
        size:
          typeof o.size === 'number' && Number.isFinite(o.size)
            ? Math.max(0.6, Math.min(2, o.size))
            : 1,
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
