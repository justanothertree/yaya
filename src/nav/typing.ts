/**
 * Whether a key pressed on this element belongs to the element rather than to the page.
 *
 * ⚠️ THIS IS ONE QUESTION THAT USED TO HAVE TWO ANSWERS. App.tsx has two window `keydown`
 * listeners — the arrow keys that walk between sections, and the help shortcut — and each wrote
 * out its own list of "typing" tags. The help listener's list had `select` in it and the arrow
 * listener's did not, so ArrowRight on any dropdown on the site walked off the page. It was
 * worse than doing both: the walk called `preventDefault`, which cancelled the dropdown's own
 * change, so in Chromium the option stayed put and the page moved instead (measured with
 * Playwright on #instrument and #paint, 11 Nov 2026).
 *
 * A `<select>` cannot be caught by checking `defaultPrevented` either, because moving its option
 * IS the key's default action — nothing has prevented anything by the time the window hears it.
 *
 * Takes a shape rather than an `HTMLElement` so it can be asked without a DOM.
 */
export type KeyTarget = { tagName?: string; isContentEditable?: boolean } | null | undefined

const FIELDS = new Set(['input', 'textarea', 'select'])

export function isTypingTarget(target: KeyTarget): boolean {
  if (!target) return false
  if (target.isContentEditable) return true
  return FIELDS.has((target.tagName ?? '').toLowerCase())
}
