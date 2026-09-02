/**
 * Named setups you keep, for any room that has settings worth keeping.
 *
 * The site had three of these written out separately before this file existed — saved palettes,
 * saved Looks, and the instrument room's single remembered instrument — and Paint, which has the
 * most settings of the lot, had none at all and forgot everything the moment you left.
 *
 * ⚠️ THE LIST LOGIC IS WRITTEN ONCE AND THE VALIDATION IS NOT. That split is the whole design.
 * Reading, capping, storing and notifying are identical for every room, so a fourth copy would
 * only be a fourth thing to fix. What is emphatically NOT shared is `read`: each room checks its
 * own fields against its own lists, because that is exactly the check that goes stale when it is
 * copied — a hand-kept duplicate of an id list is what silently dropped sixteen instruments
 * between peers, and what made a stranger's flair throw on every click.
 *
 * So: one store, and every caller brings a validator that cannot pass something the room does not
 * have.
 */

/** A setup under a name the person chose. The name is the identity — saving over one replaces it. */
export type Named = { name: string }

export type KitStore<T extends Named> = {
  /** Everything saved, newest first. Stable between writes, so useSyncExternalStore is happy. */
  all: () => T[]
  subscribe: (fn: () => void) => () => void
  /** Saving under an existing name replaces it, which is what "save" means everywhere else. */
  save: (kit: T) => void
  remove: (name: string) => void
}

/** Plenty to choose from, few enough that the row stays readable — the same cap saved palettes use. */
const MAX = 24

export function kitStore<T extends Named>(
  key: string,
  read: (v: unknown) => T | null,
): KitStore<T> {
  let mine: T[] = load()
  const listeners = new Set<() => void>()

  function load(): T[] {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) return []
      const list: unknown = JSON.parse(raw)
      /* ⚠️ every entry back through the room's own reader, not trusted because we wrote it.
         Storage outlives the code: an entry saved by a build that had a tool this one has since
         renamed is indistinguishable from one somebody typed in by hand. */
      return Array.isArray(list) ? (list.map(read).filter(Boolean) as T[]).slice(0, MAX) : []
    } catch {
      return []
    }
  }

  function write(next: T[]) {
    mine = next
    try {
      localStorage.setItem(key, JSON.stringify(next))
    } catch {
      /* private mode, or a full quota — they last for this visit */
    }
    listeners.forEach((l) => l())
  }

  return {
    all: () => mine,
    subscribe(fn) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    save(kit) {
      const clean = read(kit)
      if (!clean) return
      const without = mine.filter((k) => k.name.toLowerCase() !== clean.name.toLowerCase())
      write([clean, ...without].slice(0, MAX))
    },
    remove(name) {
      write(mine.filter((k) => k.name !== name))
    },
  }
}

/** A name somebody typed, made safe to store and to show. Empty means they did not give one. */
export const kitName = (v: unknown): string => (typeof v === 'string' ? v.slice(0, 40).trim() : '')

/** A number from storage, held inside the range the room's own control offers. */
export const kitNum = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback

/** One of a list, or the fallback. The list is always the room's own, never a copy of it. */
export const kitPick = <T>(list: readonly T[], v: unknown, fallback: T): T =>
  (list as readonly unknown[]).includes(v) ? (v as T) : fallback
