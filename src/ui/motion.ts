/**
 * One answer to "should this move?", for the whole site.
 *
 * The site already honoured `prefers-reduced-motion` in nine CSS blocks and several scripts, and
 * that was never the gap. The gap is that it is an OPERATING SYSTEM setting: someone who gets
 * motion sick has to know it exists, know their OS has it, and find it — and the person most
 * likely to need it is the least likely to do any of that. A switch on the site is the version
 * that actually reaches them.
 *
 * ⚠️ It is deliberately OR, not an override. Effective = the OS asked for it, or you asked for
 * it here. Someone whose system says "reduce" has already answered the question, and a site that
 * lets a stray click undo that is a site that ignores an accessibility setting — so the toggle
 * can add reduction and can never remove it. The control says so when that is why it is stuck.
 *
 * Everything animated reads this rather than matchMedia directly, so one switch reaches the
 * click flair, the ambient backdrop, the scroll reveals, the canvas window transitions, and
 * anything added later that remembers to ask.
 */

const KEY = 'reduce_motion_v1'
const EVENT = 'yaya:motion'

const mq = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null

/** Has the viewer asked for less motion ON THIS SITE, regardless of what the OS says. */
export function motionPreferenceStored(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/** Is the OS asking for it — in which case the site switch cannot turn motion back on. */
export function motionReducedBySystem(): boolean {
  return mq()?.matches ?? false
}

/** The answer everything animated should actually use. */
export function motionReduced(): boolean {
  return motionReducedBySystem() || motionPreferenceStored()
}

/**
 * Write the current answer onto <html> so CSS can see it too.
 *
 * A single attribute rather than duplicating every `@media (prefers-reduced-motion)` block with a
 * second selector: there are nine of them and they would have to be kept in step forever, and the
 * blanket rule in index.css is both shorter and impossible to forget to update.
 */
export function applyMotionAttr() {
  if (typeof document === 'undefined') return
  const on = motionReduced()
  const el = document.documentElement
  if (on) el.setAttribute('data-motion', 'reduce')
  else el.removeAttribute('data-motion')
}

/** Turn the site preference on or off. The OS setting still wins if it says reduce. */
export function setMotionReduced(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    /* private mode — it applies for this visit and simply will not persist */
  }
  applyMotionAttr()
  window.dispatchEvent(new CustomEvent(EVENT))
}

/**
 * Run `fn` whenever the answer changes — from the switch OR from the OS changing under us.
 *
 * The OS half matters: someone can turn the system setting on while the tab is open, and an
 * effect that only checked at mount would keep animating at exactly the moment they asked it to
 * stop.
 */
export function onMotionChange(fn: () => void): () => void {
  const m = mq()
  const handler = () => {
    applyMotionAttr()
    fn()
  }
  window.addEventListener(EVENT, handler)
  m?.addEventListener?.('change', handler)
  return () => {
    window.removeEventListener(EVENT, handler)
    m?.removeEventListener?.('change', handler)
  }
}
