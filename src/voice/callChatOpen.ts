import { useSyncExternalStore } from 'react'

/**
 * "Open the call's chat", from anywhere on the page — and whether it is open, for the control
 * that asked.
 *
 * The panel belongs to the dock (CallDock.tsx keeps its three panels in one slot, so opening one
 * closes the rest), and the dock is mounted once in App, while what wants to open it — a live Lab
 * game's table, which has no chat of its own — is lazy-loaded on the other side of the tree. So a
 * window event rather than a prop chain, the same shape as notifySignal.ts and the `yaya:*` events.
 *
 * ⚠️ IT ONLY ASKS, AND ONLY DURING A CALL. The dock listens while it is in one and at no other
 * time, so a press outside a call cannot leave the panel waiting open for the next. Closing is
 * still the dock's too: its ✕, its 💬, another panel, hanging up — or the control that opened it,
 * which is a toggle like the 💬 and says so with `aria-expanded`.
 *
 * ⚠️ AND IT SAYS WHERE IT WAS ASKED FROM, because the dock renders before <main>: a panel opened
 * from a game's table is the whole primary nav behind it in the tab order, so a keyboard player
 * pressing the table's button would otherwise be left on it with the box they wanted to type in
 * out of reach. The dock moves the focus into the panel's box when asked from the page, and back
 * to the control that asked when the panel's ✕ closes it. The dock's own 💬 needs neither: the
 * panel renders straight after it.
 */
const OPEN = 'yaya:call-chat-open'
const CLOSE = 'yaya:call-chat-close'

/** open the call dock's chat panel, with the focus in its box; does nothing when there is no call */
export function openCallChat(from: HTMLElement | null = null) {
  window.dispatchEvent(new CustomEvent<HTMLElement | null>(OPEN, { detail: from }))
}

/** close the call dock's chat panel, if it is the one showing */
export function closeCallChat() {
  window.dispatchEvent(new Event(CLOSE))
}

/** the dock's side: returns the unsubscriber, so it drops straight into a useEffect */
export function onCallChatAsk(
  open: (from: HTMLElement | null) => void,
  close: () => void,
): () => void {
  const opened = (e: Event) => open((e as CustomEvent<HTMLElement | null>).detail ?? null)
  window.addEventListener(OPEN, opened)
  window.addEventListener(CLOSE, close)
  return () => {
    window.removeEventListener(OPEN, opened)
    window.removeEventListener(CLOSE, close)
  }
}

/* whether the panel is showing, published by the dock — the one place that knows */
let shown = false
const subs = new Set<() => void>()
const subscribe = (fn: () => void) => {
  subs.add(fn)
  return () => {
    subs.delete(fn)
  }
}

/** the dock says whether its chat panel is showing */
export function setCallChatShown(on: boolean) {
  if (on === shown) return
  shown = on
  for (const fn of subs) fn()
}

/** whether the call dock's chat panel is showing, for a control on the page that opens it */
export function useCallChatShown(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => shown,
    () => false,
  )
}
