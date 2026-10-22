/**
 * The keyboard half of `role="tablist"`.
 *
 * ⚠️ DECLARING THE ROLE IS A PROMISE ABOUT THE ARROW KEYS. A tablist tells a screen reader that
 * the strip is ONE tab stop and that Left and Right walk it. A row of plain buttons announced as
 * tabs — six tab stops on the way past, arrow keys that do nothing — is worse than a row of plain
 * buttons, because the announcement describes a behaviour that is not there. This is that
 * behaviour, in one place, because this site has six strips and five of them had none.
 *
 * ⚠️ AND IT SELECTS AS IT MOVES, which is what the pattern asks for when switching is cheap.
 * Every strip here is a client-side filter or a CSS class, so none of them has a reason to make
 * you press Enter: moving focus without selecting would leave a strip and the thing below it
 * disagreeing about which tab you are on, which is the one thing a tab strip must never do.
 */
import type { KeyboardEvent } from 'react'

/**
 * Which tab a key moves to, or null when the key is not the strip's business.
 *
 * ⚠️ NULL BELOW TWO TABS, so a lone tab does not swallow the key. `moveTab` stops what it
 * handles and the site's own arrow navigation lives on window, so a one-tab strip that claimed
 * ArrowRight would take the key and then go nowhere with it. The snake's side panel is one tab in
 * solo, which is the case that asked the question.
 *
 * ⚠️ AND ONLY LEFT AND RIGHT. All six strips are horizontal; a horizontal tablist that answered
 * ArrowUp would be taking a key the page above it has a use for.
 */
export function tabKeyTarget(key: string, from: number, count: number): number | null {
  if (count < 2) return null
  const to =
    key === 'ArrowRight'
      ? from + 1
      : key === 'ArrowLeft'
        ? from - 1
        : key === 'Home'
          ? 0
          : key === 'End'
            ? count - 1
            : null
  if (to == null) return null
  /* it wraps, which is the other half of cheap tabs — Home and End already land inside */
  return (to + count) % count
}

/**
 * Arrow, Home and End across a strip: move focus, and select what focus lands on.
 *
 * ⚠️ AND STOP THE EVENT, OR THE ARROW DOES BOTH THINGS. App.tsx keeps a `keydown` listener on
 * WINDOW that walks the site's own sections with the arrow keys. It asks `defaultPrevented` now,
 * so `preventDefault` alone would be enough — `stopPropagation` is here as well because it is the
 * older guard and the one the two handlers that predate the question use, and it costs nothing.
 * Measured before either existed: ArrowRight on a focused chronicle tab moved the window strip
 * AND left the room, four presses taking #chronicle → #investments → #account-settings → #games.
 *
 * ⚠️ THE STRIP COMES FROM THE EVENT rather than from a ref each caller has to keep. The tab that
 * was pressed is inside its own tablist by definition, so `closest` cannot name the wrong strip —
 * and six components asking for a ref they use nowhere else is six places to forget one.
 */
export function moveTab(
  e: KeyboardEvent,
  from: number,
  count: number,
  select: (to: number) => void,
): void {
  const to = tabKeyTarget(e.key, from, count)
  if (to == null) return
  e.preventDefault()
  e.stopPropagation()
  select(to)
  /* `[role="tab"]` rather than `button`, so a strip that ever holds anything else keeps counting
     only its tabs — and the query says what it is looking for */
  const strip = e.currentTarget.closest('[role="tablist"]')
  strip?.querySelectorAll<HTMLElement>('[role="tab"]')[to]?.focus()
}
