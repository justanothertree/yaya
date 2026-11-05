import { useEffect, useRef, type RefObject } from 'react'

/**
 * What a dialog owes a keyboard.
 *
 * `role="dialog" aria-modal="true"` is a promise to a screen reader that the rest of the page is
 * inert. Three dialogs on this site made that promise and kept none of it: the appearance tray,
 * What's here, and the bug report. Each one could be dismissed by clicking its scrim or its ✕,
 * and that was all — **Escape did nothing**, focus stayed on the button behind the overlay, Tab
 * walked the page underneath, and closing dropped focus to the top of the document.
 *
 * `circuit/ui/Modal.tsx` already had the whole contract, and had paid for it: the ref-versus-
 * identity trap, the `document.body` case on restore, the empty dep list. All of that is here
 * now, and Modal calls it. Hardly any of this is new code — what is new is that the three
 * bespoke dialogs get it too, instead of a fourth copy getting written one day.
 *
 * ⚠️ THE TWO DECISIONS ARE PURE AND SO THEY ARE EXPORTED. A Tab wrap and a focus restore are
 * both small rules with edges — a single-element dialog, focus that has escaped the subtree
 * entirely, an `activeElement` that is `body` because React has already detached the node — and
 * none of them could be asked a question while they lived inside an effect inside a component.
 * `dialogContract.test.ts` asks them.
 */

/** The same list every browser treats as tabbable, in DOM order. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Where Tab should move inside a dialog.
 *
 * @returns the element to focus, `null` to let the browser do its normal thing, or `false` to
 *   swallow the key — which is the trap holding when there is nothing in here to focus.
 */
export function tabTarget<T>(
  list: readonly T[],
  active: T | null,
  shiftKey: boolean,
  insideDialog: boolean,
): T | null | false {
  if (list.length === 0) return false
  const first = list[0]
  const last = list[list.length - 1]
  /* wrap at both ends, and pull focus back in if it has escaped the dialog entirely */
  if (shiftKey) return active === first || !insideDialog ? last : null
  return active === last || !insideDialog ? first : null
}

/**
 * Should the thing that opened the dialog get focus back?
 *
 * ⚠️ `body` IS THE CASE THAT MATTERS and the one a careful reading misses. By the time a cleanup
 * runs, React has already detached the dialog, so the element that had focus is gone and the
 * browser has dropped focus to `<body>`. Asking only "is focus still inside the box" is therefore
 * false exactly when a restore is most needed — measured in Modal: closing with Escape left focus
 * on BODY instead of on the row that opened it.
 *
 * Restore when focus was lost or is somehow still in the dead subtree; leave it alone when
 * something else has legitimately taken it since.
 */
export function focusIsLoose(
  active: Element | null,
  body: Element | null,
  stillInBox: boolean,
): boolean {
  return !active || active === body || stillInBox
}

/**
 * Escape closes, focus moves in, Tab is trapped, and the opener gets focus back.
 *
 * @param box the dialog's own element — the subtree focus is kept inside
 * @param enabled false while the dialog is closed, for a component that renders null rather than
 *   being unmounted (BugReport). A hook cannot be called conditionally, so the flag is here.
 */
export function useDialogContract(
  box: RefObject<HTMLElement | null>,
  onClose: () => void,
  enabled = true,
): void {
  /**
   * ⚠️ A REF, BECAUSE EVERY CALLER PASSES AN INLINE ARROW. `onClose={() => setOpen(false)}` is a
   * new function on every render of the parent, so an effect that depended on it re-ran on every
   * keystroke — which re-ran "open", which moved focus back to the Close button. One letter, then
   * you had to click back into the field, in every dialog with a text box in it. Opening is a
   * mount concern; only the Escape handler needs a CURRENT onClose.
   */
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  /**
   * ⚠️ CAPTURED DURING RENDER, AND AN EFFECT IS TOO LATE. React runs a CHILD's effects before
   * its parent's, so by the time this hook's effect ran, a dialog whose content focuses
   * something on mount had already moved focus inside -- and `document.activeElement` was that
   * control, not the button somebody pressed to get here. The opener was then an element inside
   * the dialog, disconnected the moment it closed, so `opener?.isConnected` was false and the
   * restore never fired.
   *
   * Measured on the review sheet before this: `HTMLElement.prototype.focus` patched to log every
   * call showed the order `opener → INPUT (the content) → ✕ (this hook)`, and after Escape, zero
   * calls -- focus sat on BODY. Render runs before every effect in the tree, so this sees the
   * page as it was.
   */
  const openerRef = useRef<HTMLElement | null | undefined>(undefined)
  if (openerRef.current === undefined && enabled) {
    openerRef.current =
      typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null)
  }

  useEffect(() => {
    if (!enabled) return
    const opener = openerRef.current
    const el = box.current
    const focusables = () =>
      Array.from(el?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (n) => n.offsetParent !== null || n === document.activeElement,
      )
    /* the close button is the safe default: it is always present, and landing there means Escape
       and Enter both do the obvious thing.
       ⚠️ UNLESS THE CONTENT HAS ALREADY CHOSEN. A child's effects run before this one, so a
       dialog that focuses its own first field on mount has done it by now -- and the field is a
       better place to land than the ✕ for a form somebody opened in order to type. Only move
       focus when it is still outside. */
    if (!el?.contains(document.activeElement)) (focusables()[0] ?? el)?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const active = document.activeElement as HTMLElement | null
      const to = tabTarget(focusables(), active, e.shiftKey, !!el?.contains(active))
      if (to === false) {
        e.preventDefault()
        return
      }
      if (to) {
        e.preventDefault()
        to.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      const active = document.activeElement
      if (focusIsLoose(active, document.body, !!el?.contains(active)) && opener?.isConnected) {
        opener.focus?.()
      }
    }
    /* `box` is a ref object and `enabled` only moves when the dialog opens or closes, so this
       runs on open and cleans up on close — which is the whole point. */
  }, [box, enabled])
}
