import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type LaunchableWindow = {
  id: string
  title: string
  /** heading this window is listed under */
  group?: string
  /** why it can't be added right now — shown, and the row is disabled */
  disabled?: string
}

type Workspace = { name: string; ids: string[] }
const WORKSPACES = 'canvas_workspaces_v1'

const loadWorkspaces = (): Workspace[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(WORKSPACES) || '[]')
    return Array.isArray(raw) ? raw.filter((w) => w && typeof w.name === 'string') : []
  } catch {
    return []
  }
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
  const [spaces, setSpaces] = useState<Workspace[]>(loadWorkspaces)
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

  const persist = (next: Workspace[]) => {
    setSpaces(next)
    try {
      localStorage.setItem(WORKSPACES, JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }

  /**
   * Save the windows that are open right now under a name.
   *
   * Only the IDS are stored, never the boxes: the canvas already persists a box per window and
   * keeps it across tabs, so restoring a set of ids brings the arrangement back with it. Storing
   * positions here as well would be a second copy of the truth, free to drift from the first.
   */
  const saveCurrent = () => {
    const name = window.prompt('Name this layout')?.trim()
    if (!name) return
    persist([...spaces.filter((w) => w.name !== name), { name, ids: [...openIds] }])
  }

  /** Make the canvas match a saved layout: add what's missing, remove what isn't in it. */
  const restore = (w: Workspace) => {
    const want = new Set(w.ids)
    for (const id of openIds) if (!want.has(id)) onToggle(id)
    for (const id of w.ids) if (!openIds.includes(id)) onToggle(id)
  }

  const groups = shown.reduce<Array<[string, LaunchableWindow[]]>>((acc, w) => {
    const g = w.group ?? ''
    const row = acc.find(([name]) => name === g)
    if (row) row[1].push(w)
    else acc.push([g, [w]])
    return acc
  }, [])

  /**
   * Portalled to <body>. Anything with a transform, filter or will-change between here and the
   * viewport becomes the containing block for `position: fixed` — the nav does exactly that —
   * and this has to sit against the viewport to stay put over the canvas.
   */
  /**
   * Publishes the button's real width as --winlauncher-w, so CircuitCanvas can reserve that
   * strip when sizing a maximized window -- otherwise a maximized window's own title-bar
   * controls (also right-aligned) end up in the exact corner this button occupies. Measured
   * rather than hardcoded because the count badge changes the button's width.
   */
  const btnRoRef = useRef<ResizeObserver | null>(null)
  const btnRef = useCallback((el: HTMLButtonElement | null) => {
    btnRoRef.current?.disconnect()
    btnRoRef.current = null
    if (!el) {
      document.documentElement.style.setProperty('--winlauncher-w', '0px')
      return
    }
    const ro = new ResizeObserver(() => {
      document.documentElement.style.setProperty('--winlauncher-w', el.offsetWidth + 'px')
    })
    ro.observe(el)
    btnRoRef.current = ro
    document.documentElement.style.setProperty('--winlauncher-w', el.offsetWidth + 'px')
  }, [])

  return createPortal(
    <div className="winlauncher" ref={panelRef}>
      {/* Button first in DOM: the panel now opens BELOW it (the container is anchored to the
          top-right, not the bottom-right as before), and flex-direction: column always stacks
          in DOM order regardless of which edge the container is pinned to. */}
      <button
        ref={btnRef}
        className="btn winlauncher-btn"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title="Choose which windows are on your canvas"
      >
        ⊞ Windows{count ? <span className="winlauncher-count">{count}</span> : null}
      </button>
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
            {groups.map(([group, items]) => (
              <div key={group || 'all'}>
                {group && <div className="winlauncher-group">{group}</div>}
                {items.map((w) => {
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
              </div>
            ))}
            {!shown.length && <div className="muted winlauncher-empty">Nothing matches.</div>}
          </div>
          {/* Layouts last: you build a set first, then keep it. */}
          <div className="winlauncher-spaces">
            {spaces.map((w) => (
              <span className="winlauncher-space" key={w.name}>
                <button
                  className="btn"
                  onClick={() => restore(w)}
                  title={`${w.ids.length} windows`}
                >
                  {w.name}
                </button>
                <button
                  className="btn winlauncher-x"
                  onClick={() => persist(spaces.filter((x) => x.name !== w.name))}
                  aria-label={`Forget ${w.name}`}
                >
                  ✕
                </button>
              </span>
            ))}
            <button className="btn" onClick={saveCurrent} disabled={!count}>
              ＋ Save layout
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}
