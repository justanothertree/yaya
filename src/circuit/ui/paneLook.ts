/**
 * A look published by whatever is inside a canvas window, for the window itself to wear.
 *
 * ⚠️ A window's chrome is an ANCESTOR of its content, so a profile that sets someone's palette on
 * its own element can never reach the title bar, the border or the shell around it — CSS custom
 * properties inherit downward only. The result was a window whose body was in someone's colours
 * inside a frame that was still in yours, which reads as a rendering fault rather than a theme.
 *
 * So the content publishes upward instead. A module-level store rather than a context value,
 * because the setter has to be STABLE: handed down through context it would be a new function on
 * every canvas render, and an effect depending on it would re-run forever. The pane id comes
 * through the context (a plain string, stable), and everything else is here.
 *
 * Keyed by pane id so several windows can wear different looks at once — two profiles open side
 * by side is exactly the case that makes this worth doing rather than styling one global thing.
 */

export type PaneLook = {
  /** CSS custom properties, already derived — the same object the content puts on itself */
  vars: Record<string, string>
  /** a built-in theme name, when the look is one of those rather than a custom palette */
  theme: string | null
}

const looks = new Map<string, PaneLook>()
const listeners = new Set<() => void>()
const EMPTY: ReadonlyMap<string, PaneLook> = new Map()

/** Snapshot for useSyncExternalStore — a new Map identity only when something actually changed. */
let snapshot: ReadonlyMap<string, PaneLook> = EMPTY

function publish() {
  snapshot = new Map(looks)
  for (const fn of listeners) fn()
}

export function setPaneLook(paneId: string | null, look: PaneLook | null) {
  if (!paneId) return
  const current = looks.get(paneId)
  if (!look) {
    if (!current) return
    looks.delete(paneId)
    publish()
    return
  }
  // cheap equality: the vars object is rebuilt per render, so compare what it means
  if (
    current &&
    current.theme === look.theme &&
    JSON.stringify(current.vars) === JSON.stringify(look.vars)
  ) {
    return
  }
  looks.set(paneId, look)
  publish()
}

export function subscribePaneLooks(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function paneLooksSnapshot(): ReadonlyMap<string, PaneLook> {
  return snapshot
}

export function serverPaneLooksSnapshot(): ReadonlyMap<string, PaneLook> {
  return EMPTY
}
