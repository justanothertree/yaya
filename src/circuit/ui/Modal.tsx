// Modal overlay used by the movie/person sheets. The header (✕) and footer stay
// pinned while only the body scrolls, so tall content wraps cleanly and the close
// button is always reachable. Caps at 92vh / 96vw so it always fits the screen.
import { useEffect } from 'react'
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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
          <h3 style={{ margin: 0, fontSize: '1.1rem', minWidth: 0 }}>{title}</h3>
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
