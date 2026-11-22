/**
 * Keeping a keyboard player's place when the control they pressed goes away.
 *
 * ⚠️ A BUTTON THAT REMOVES OR DISABLES ITSELF DROPS THE FOCUS ON THE PAGE, and the next key goes
 * nowhere — Tab starts again from the top of the site. In the Lab that is most presses that
 * matter: a card played leaves the hand, a pit sown is disabled, Start and Launch become something
 * else, a third roll disables Roll, and the WebGPU fallback's Try again is replaced while the GPU
 * is asked again. Measured on 12 Nov 2026 by pressing every control of every toy by keyboard: 63
 * of 133 toys dropped the focus at least once. Yacht and Shut the box had each been fixed with an
 * effect of their own; fixing the rest that way would have been sixty more.
 *
 * So one watcher, round the whole toy (GpuLab mounts it). It remembers the control that last took
 * the focus and the controls round it at that moment; when that control is removed or disabled
 * while it holds the focus, the focus moves on:
 *
 * - to the control the lost one names in `data-focus-next` — selectors tried in turn, separated by
 *   `||` — for a toy that knows where the next move is (Yacht's open boxes after the last roll);
 * - else to the next control still usable, forward first so a played card hands on to the next
 *   card, then back;
 * - else to the first control in the toy.
 *
 * And if there is nothing to move to yet — the computer is taking its turn, or the GPU is being
 * asked again — it waits, and moves the focus the moment something usable appears, unless the
 * player has put the focus somewhere themselves by then.
 */

/** The first usable thing after `i` in a list taken earlier, else the last usable one before it */
export function nextUsable<T>(old: readonly T[], i: number, usable: (x: T) => boolean): T | null {
  for (let k = Math.max(0, i + 1); k < old.length; k++) if (usable(old[k])) return old[k]
  for (let k = Math.min(old.length, i) - 1; k >= 0; k--) if (usable(old[k])) return old[k]
  return null
}
/** the selectors in a `data-focus-next`, in the order they are to be tried */
export const hintsOf = (hint: string | null) =>
  (hint ?? '')
    .split('||')
    .map((s) => s.trim())
    .filter(Boolean)

const SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
const usable = (el: HTMLElement) =>
  el.isConnected &&
  !(el as HTMLButtonElement).disabled &&
  el.getAttribute('aria-disabled') !== 'true' &&
  el.checkVisibility()

/** Watch a region; returns the function that stops watching */
export function rescueFocus(region: HTMLElement): () => void {
  let last: HTMLElement | null = null
  let around: HTMLElement[] = []
  let hints: string[] = []
  /** the focus was lost and there was nowhere to put it yet */
  let waiting = false
  const controls = () => [...region.querySelectorAll<HTMLElement>(SELECTOR)].filter(usable)
  const hinted = () => {
    for (const h of hints) {
      const el = [...region.querySelectorAll<HTMLElement>(h)].find(usable)
      if (el) return el
    }
    return null
  }

  const onIn = (e: FocusEvent) => {
    const t = e.target as HTMLElement
    waiting = false
    if (!region.contains(t)) {
      last = null
      return
    }
    last = t
    around = controls()
    hints = hintsOf(t.getAttribute('data-focus-next'))
  }
  // the focus taken away on purpose — a click on the page, or Tab out of the window — is not lost
  const onOut = (e: FocusEvent) => {
    if (e.target !== last) return
    queueMicrotask(() => {
      if (last && usable(last) && document.activeElement !== last) last = null
    })
  }
  const check = () => {
    const active = document.activeElement
    const onPage = !active || active === document.body
    if (waiting) {
      if (!onPage) {
        waiting = false
        return
      }
      const next = hints.length ? hinted() : controls()[0]
      if (next) {
        waiting = false
        next.focus()
      }
      return
    }
    if (!last || usable(last)) return
    if (!onPage && active !== last) return
    const from = last
    last = null
    const next =
      hinted() ??
      (hints.length ? null : (nextUsable(around, around.indexOf(from), usable) ?? controls()[0]))
    if (next) next.focus()
    else waiting = true
  }
  const watcher = new MutationObserver(check)
  watcher.observe(region, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['disabled', 'aria-disabled', 'hidden', 'class', 'style'],
  })
  document.addEventListener('focusin', onIn)
  document.addEventListener('focusout', onOut)
  return () => {
    watcher.disconnect()
    document.removeEventListener('focusin', onIn)
    document.removeEventListener('focusout', onOut)
  }
}
