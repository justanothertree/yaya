/**
 * Who is holding what. A game action — a flipper, a rudder, the throttle — can be held by several
 * things at once: two keys bound to it, a pad under a thumb, a finger on the stage. It is held while
 * ANY of them is, so letting go of one must not let go of the others.
 *
 * ⚠️ WHY THIS EXISTS. Pinball, Night crossing and Bike trials each kept one boolean an action, and any
 * release cleared it: hold Z and tap the ◀ pad, and the flipper dropped with Z still down. Each source
 * is named here instead — `key:z`, `pad:left:7`, `stage:12` — and the action is the union.
 */
export class Holds<A extends string> {
  private by = new Map<A, Set<string>>()

  /** `source` starts holding `action`; true if the action was not held before */
  press(action: A, source: string) {
    let s = this.by.get(action)
    if (!s) this.by.set(action, (s = new Set()))
    const was = s.size > 0
    s.add(source)
    return !was
  }

  /** `source` lets go of `action`; true if that was the last thing holding it */
  release(action: A, source: string) {
    const s = this.by.get(action)
    if (!s || !s.delete(source)) return false
    return s.size === 0
  }

  /** every action `source` holds is let go: a finger lifted, a key released wherever focus is.
   *  Returns the actions nothing holds any more. */
  releaseSource(source: string): A[] {
    const freed: A[] = []
    for (const [a, s] of this.by) if (s.delete(source) && s.size === 0) freed.push(a)
    return freed
  }

  has(action: A) {
    return (this.by.get(action)?.size ?? 0) > 0
  }

  /** everything let go — focus left the toy, so no key release will ever reach it */
  clear() {
    this.by.clear()
  }
}

/** the holder name for a key: its lowercased key, or its code for keys whose side matters (Shift) */
export const keySource = (e: { key: string; code: string }) =>
  e.key === 'Shift' ? `key:${e.code}` : `key:${e.key.toLowerCase()}`
