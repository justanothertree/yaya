import { useEffect, useRef, useState } from 'react'
import type { Notifications } from '../hooks/useNotifications'
import { notificationsChanged } from '../hooks/notifySignal'

/**
 * The bell: what's waiting for you, in one list. Lives as a direct child of .nav-right —
 * a sibling of the scrolling link strip, never inside it. A popover placed in that strip
 * gets clipped out of existence, because its overflow-x:auto forces overflow-y to auto too.
 */
export function NotificationBell({ notifications }: { notifications: Notifications }) {
  const { items, total, markSeen } = notifications
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [open])

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button
        className="notif-btn"
        aria-label={total > 0 ? `Notifications (${total} waiting)` : 'Notifications'}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          const next = !open
          setOpen(next)
          // opening it is the read receipt — the count clears while the list stays readable
          if (next) markSeen()
        }}
      >
        <span aria-hidden>🔔</span>
        {total > 0 && <span className="notif-dot">{total > 9 ? '9+' : total}</span>}
      </button>

      {open && (
        <div className="notif-panel" role="menu">
          <div className="notif-head">Waiting for you</div>
          {items.length === 0 ? (
            <p className="muted notif-empty">You&apos;re all caught up.</p>
          ) : (
            items.map((n) => (
              <a
                key={n.id}
                className="notif-item"
                href={n.href}
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  // If the href matches where we already are, the browser fires no
                  // hashchange and nothing re-reads. Most visible when the entry is for
                  // the very room you're looking at. Let the target screen mark it read,
                  // then recheck. Harmless when the hash does change.
                  window.setTimeout(() => notificationsChanged(), 700)
                }}
              >
                <span className="notif-ic" aria-hidden>
                  {n.kind === 'chat'
                    ? '💬'
                    : n.kind === 'friend'
                      ? '🧑‍🤝‍🧑'
                      : n.kind === 'kudos'
                        ? '👏'
                        : n.kind === 'comment'
                          ? '💭'
                          : '🎉'}
                </span>
                <span className="notif-text">
                  <span className="notif-title">{n.text}</span>
                  {n.detail && <span className="notif-detail muted">{n.detail}</span>}
                </span>
              </a>
            ))
          )}
        </div>
      )}
    </div>
  )
}
