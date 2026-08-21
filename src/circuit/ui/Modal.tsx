// Modal overlay used by the movie/person sheets. The header (✕) and footer stay
// pinned while only the body scrolls, so tall content wraps cleanly and the close
// button is always reachable. Caps at 92vh / 96vw so it always fits the screen.
import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 460,
}: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** Max content width in px (clamped to 96vw). */
  width?: number
}) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const titleId = useId()

  /**
   * The rest of the dialog contract: Escape already worked, but focus did not.
   *
   * Without this, opening a sheet left focus wherever it was — on the button behind the
   * overlay — so Tab walked through the page underneath instead of the dialog, and a
   * keyboard or screen-reader user could be typing into something they cannot see. On close,
   * focus was simply lost, dumping you back at the top of the document.
   *
   * Focus moves in on open, is trapped while open, and is handed back to whatever opened the
   * dialog on close.
   */
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const box = boxRef.current
    // the close button is the safe default: it is always present, and landing there means
    // Escape and Enter both do the obvious thing
    const focusables = () =>
      Array.from(
        box?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null || el === document.activeElement)
    ;(focusables()[0] ?? box)?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const list = focusables()
      if (list.length === 0) {
        e.preventDefault()
        return
      }
      const first = list[0]
      const last = list[list.length - 1]
      const active = document.activeElement
      // wrap at both ends, and pull focus back in if it has escaped the dialog entirely
      if (e.shiftKey && (active === first || !box?.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || !box?.contains(active))) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      /**
       * ⚠️ The test for "focus is still ours" has to include document.body.
       *
       * By the time this cleanup runs React has already detached the dialog, so the element
       * that had focus is gone and the browser has dropped focus to <body>. Checking only
       * `box.contains(activeElement)` is therefore false exactly when a restore is most
       * needed — measured: closing with Escape left focus on BODY instead of the name that
       * opened it.
       *
       * Restore when focus was lost (body/null) or is somehow still inside the old subtree,
       * but not when something else has legitimately taken it since.
       */
      const active = document.activeElement
      const focusIsLoose = !active || active === document.body || !!box?.contains(active)
      if (focusIsLoose && opener?.isConnected) opener.focus?.()
    }
  }, [onClose])

  const divider = '1px solid var(--border, rgba(127,127,127,0.18))'

  // Portal to <body> so the fixed overlay escapes any zoomed/transformed ancestor
  // (the main zoom, or a canvas window) — otherwise the modal gets trapped and sized
  // to that ancestor instead of the viewport, forcing an awkward tiny scroll box.
  return createPortal(
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '4vh 1rem',
        zIndex: 1000,
        overflowY: 'auto',
      }}
    >
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{
          width: `min(${width}px, 96vw)`,
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--panel, #141a2a)', // opaque so the page doesn't bleed through
          color: 'var(--text)',
          border: '1px solid var(--border, rgba(127,127,127,0.25))',
          borderRadius: 14,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}
      >
        {/* pinned header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.5rem',
            padding: '0.85rem 1rem',
            flexShrink: 0,
            borderBottom: divider,
          }}
        >
          <h3 id={titleId} style={{ margin: 0, fontSize: '1.1rem', minWidth: 0 }}>
            {title}
          </h3>
          <button
            className="btn btn-ghost"
            onClick={onClose}
            aria-label="Close"
            style={{ padding: '0.25rem 0.6rem', flexShrink: 0 }}
          >
            ✕
          </button>
        </div>

        {/* scrolling body */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '1rem' }}>{children}</div>

        {/* pinned footer */}
        {footer && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '0.5rem',
              padding: '0.75rem 1rem',
              flexShrink: 0,
              borderTop: divider,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
