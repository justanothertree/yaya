import { createPortal } from 'react-dom'
import type { CanvasPane, LaunchableWindow, Layout } from './CircuitCanvas'
import { WORKSPACES_KEY, type Workspace, type WindowsMenuState } from './useWindowsMenu'

/**
 * The canvas bar's Windows button and the list it opens. Its state lives in useWindowsMenu, which
 * the canvas owns; which window is in front comes from the canvas too, as `topId`.
 */
export function WindowsMenu({
  menu,
  panes,
  wins,
  topId,
  launchableWindows,
  launcherOpenIds,
  onToggleWindow,
  onTab,
  portalTarget,
}: {
  menu: WindowsMenuState
  panes: CanvasPane[]
  wins: Layout
  topId: string
  launchableWindows: LaunchableWindow[]
  launcherOpenIds: string[]
  onToggleWindow?: (id: string) => void
  onTab: (id: string) => void
  portalTarget: HTMLElement | null
}) {
  const {
    winMenuOpen,
    setWinMenuOpen,
    winMenuAnchor,
    winMenuQuery,
    setWinMenuQuery,
    winMenuSpaces,
    setWinMenuSpaces,
    winMenuBtnRef,
    winMenuPanelRef,
    winMenuSearchRef,
  } = menu
  // The Windows menu's rows: the site-wide catalog first, then anything already open on THIS
  // canvas that the catalog doesn't otherwise know about — so nothing that's actually on screen
  // can ever be missing from "everything", regardless of whether the two lists are perfectly in
  // sync (they're maintained independently, by different components).
  const winMenuCatalog = new Map<string, LaunchableWindow>()
  for (const w of launchableWindows) winMenuCatalog.set(w.id, w)
  for (const p of panes) {
    if (!winMenuCatalog.has(p.id)) winMenuCatalog.set(p.id, { id: p.id, title: p.title })
  }
  const winMenuNeedle = winMenuQuery.trim().toLowerCase()
  const winMenuShown = Array.from(winMenuCatalog.values()).filter(
    (w) => !winMenuNeedle || w.title.toLowerCase().includes(winMenuNeedle),
  )
  const winMenuGroups = winMenuShown.reduce<Array<[string, LaunchableWindow[]]>>((acc, w) => {
    const g = w.group ?? ''
    const row = acc.find(([name]) => name === g)
    if (row) row[1].push(w)
    else acc.push([g, [w]])
    return acc
  }, [])
  const persistWinMenuSpaces = (next: Workspace[]) => {
    setWinMenuSpaces(next)
    try {
      localStorage.setItem(WORKSPACES_KEY, JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }
  /** Save the windows pinned/showing right now (the site-wide set, not this tab's own default
   * panes) under a name. Only ids, never boxes — the canvas already persists a box per window. */
  const saveWinMenuSpace = () => {
    const name = window.prompt('Name this layout')?.trim()
    if (!name) return
    persistWinMenuSpaces([
      ...winMenuSpaces.filter((w) => w.name !== name),
      { name, ids: [...launcherOpenIds] },
    ])
  }
  const restoreWinMenuSpace = (w: Workspace) => {
    const want = new Set(w.ids)
    for (const id of launcherOpenIds) if (!want.has(id)) onToggleWindow?.(id)
    for (const id of w.ids) if (!launcherOpenIds.includes(id)) onToggleWindow?.(id)
  }

  return (
    <>
      {/**
       * ONE menu for "what's on my canvas", not two. This used to be a room-tab strip (wrapped,
       * then scrolled sideways — neither felt good) PLUS a completely separate Windows launcher
       * for adding/removing anything else, each answering half of the same question. Now a
       * single button opens a single list: every window you could add, with a switch for on/off,
       * and — for whichever are already open — whether it's front, behind, or minimized, click
       * to jump to it.
       */}
      <button
        ref={winMenuBtnRef}
        className="btn"
        aria-expanded={winMenuOpen}
        aria-haspopup="menu"
        onClick={() => setWinMenuOpen((v) => !v)}
        title="Add, remove, or switch between windows"
      >
        ⊞ {topId ? (panes.find((p) => p.id === topId)?.title ?? 'Windows') : 'Windows'}
        {panes.length > 1 && <span className="muted"> · {panes.length}</span>}
      </button>
      {winMenuOpen &&
        winMenuAnchor &&
        portalTarget &&
        createPortal(
          <div
            className="winlauncher-panel"
            ref={winMenuPanelRef}
            role="dialog"
            aria-label="Windows"
            style={{ position: 'fixed', top: winMenuAnchor.top + 6, left: winMenuAnchor.left }}
          >
            <input
              ref={winMenuSearchRef}
              className="winlauncher-search"
              type="search"
              placeholder="Filter windows…"
              value={winMenuQuery}
              onChange={(e) => setWinMenuQuery(e.target.value)}
              aria-label="Filter windows"
            />
            <div className="winlauncher-list">
              {winMenuGroups.map(([group, items]) => (
                <div key={group || 'all'}>
                  {group && <div className="winlauncher-group">{group}</div>}
                  {items.map((w) => {
                    const win = wins[w.id]
                    const isOpen = panes.some((p) => p.id === w.id)
                    const min = !!win?.min
                    const front = isOpen && w.id === topId && !min
                    const pinned = launcherOpenIds.includes(w.id)
                    return (
                      <div key={w.id} className="winlauncher-row">
                        <button
                          className="winlauncher-row-main"
                          role="menuitem"
                          disabled={!!w.disabled}
                          onClick={() => (isOpen ? onTab(w.id) : onToggleWindow?.(w.id))}
                          title={
                            w.disabled ??
                            (!isOpen
                              ? `Open ${w.title}`
                              : min
                                ? `Restore ${w.title}`
                                : front
                                  ? `Minimize ${w.title}`
                                  : `Bring ${w.title} to front`)
                          }
                        >
                          {isOpen && (
                            <span
                              className={'winlauncher-dot' + (min ? ' is-min' : '')}
                              aria-hidden
                            />
                          )}
                          <span className="winlauncher-row-title">{w.title}</span>
                          {w.disabled ? (
                            <span className="winlauncher-why">{w.disabled}</span>
                          ) : (
                            isOpen && (
                              <span className={'winlauncher-why' + (front ? ' is-front' : '')}>
                                {min ? 'minimized' : front ? 'front' : 'open'}
                              </span>
                            )
                          )}
                        </button>
                        {!w.disabled && onToggleWindow && (
                          <button
                            className="winlauncher-row-switch"
                            role="menuitemcheckbox"
                            aria-checked={pinned}
                            aria-label={pinned ? `Remove ${w.title}` : `Add ${w.title}`}
                            title={pinned ? `Remove ${w.title}` : `Add ${w.title}`}
                            onClick={() => onToggleWindow(w.id)}
                          >
                            <span
                              className={'nav-menu-switch' + (pinned ? ' is-on' : '')}
                              aria-hidden
                            />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
              {!winMenuShown.length && (
                <div className="muted winlauncher-empty">Nothing matches.</div>
              )}
            </div>
            {/* Layouts last: you build a set first, then keep it. */}
            <div className="winlauncher-spaces">
              {winMenuSpaces.map((w) => (
                <span className="winlauncher-space" key={w.name}>
                  <button
                    className="btn"
                    onClick={() => restoreWinMenuSpace(w)}
                    title={`${w.ids.length} windows`}
                  >
                    {w.name}
                  </button>
                  <button
                    className="btn winlauncher-x"
                    onClick={() =>
                      persistWinMenuSpaces(winMenuSpaces.filter((x) => x.name !== w.name))
                    }
                    aria-label={`Forget ${w.name}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
              <button className="btn" onClick={saveWinMenuSpace} disabled={!launcherOpenIds.length}>
                ＋ Save layout
              </button>
            </div>
          </div>,
          portalTarget,
        )}
    </>
  )
}
