// Minimal modal overlay used by the movie add/rate sheets.
import type { ReactNode } from 'react'

export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  return (
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
        className="card"
        style={{
          width: 'min(460px, 96vw)',
          maxHeight: '92vh',
          overflowY: 'auto',
          background: 'var(--panel, #141a2a)', // opaque so the page doesn't bleed through
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.5rem',
            marginBottom: '0.75rem',
          }}
        >
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button className="btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
        {footer && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '0.5rem',
              marginTop: '1.1rem',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
