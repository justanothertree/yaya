import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type LaunchableWindow = {
  id: string
  title: string
  /** why it can't be added right now — shown, and the row is disabled */
  disabled?: string
}

/**
 * Pick which windows sit on your canvas, without going to find them.
 *
 * Canvas showed the CURRENT tab's window plus anything pinned, so assembling a workspace meant
 * navigating to each section in turn and pinning it there — the windows you wanted were behind
 * the very navigation the canvas is meant to replace. Here every window is one list, filterable,
 * and toggling a row puts it on the canvas or takes it off.
 *
 * It is deliberately the same `pinned` state underneath: pinning already meant "keep this on my
 * canvas wherever I am", which is exactly what choosing a window means. No second concept.
 */
export function WindowLauncher({
  windows,
  openIds,
  onToggle,
}: {
  windows: LaunchableWindow[]
  openIds: string[]
  onToggle: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const panelRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    searchRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    // pointerdown, not click: a click that starts inside and drifts out shouldn't close it
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (panelRef.current && !panelRef.current.contains(t)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [open])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return windows
    return windows.filter((w) => w.title.toLowerCase().includes(needle))
  }, [windows, q])

  const count = openIds.length

  /**
   * Portalled to <body>. Anything with a transform, filter or will-change between here and the
   * viewport becomes the containing block for `position: fixed` — the nav does exactly that —
   * and this has to sit against the viewport to stay put over the canvas.
   */
  return createPortal(
    <div className="winlauncher" ref={panelRef}>
      {open && (
        <div className="winlauncher-panel" role="dialog" aria-label="Choose windows">
          <input
            ref={searchRef}
            className="winlauncher-search"
            type="search"
            placeholder="Filter windows…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Filter windows"
          />
          <div className="winlauncher-list">
            {shown.map((w) => {
              const on = openIds.includes(w.id)
              return (
                <button
                  key={w.id}
                  className="winlauncher-row"
                  role="menuitemcheckbox"
                  aria-checked={on}
                  disabled={!!w.disabled}
                  title={w.disabled}
                  onClick={() => onToggle(w.id)}
                >
                  <span>{w.title}</span>
                  {w.disabled ? (
                    <span className="muted winlauncher-why">{w.disabled}</span>
                  ) : (
                    <span className={'nav-menu-switch' + (on ? ' is-on' : '')} aria-hidden />
                  )}
                </button>
              )
            })}
            {!shown.length && <div className="muted winlauncher-empty">Nothing matches.</div>}
          </div>
        </div>
      )}
      <button
        className="btn winlauncher-btn"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title="Choose which windows are on your canvas"
      >
        ⊞ Windows{count ? <span className="winlauncher-count">{count}</span> : null}
      </button>
    </div>,
    document.body,
  )
}
