import { useEffect, useRef, useState } from 'react'

export type Workspace = { name: string; ids: string[] }
export const WORKSPACES_KEY = 'canvas_workspaces_v1'
const loadWorkspaces = (): Workspace[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(WORKSPACES_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter((w) => w && typeof w.name === 'string') : []
  } catch {
    return []
  }
}

/**
 * The Windows menu — one list for both halves of "what's on my canvas": every window you
 * COULD add (the site-wide catalog), and, for whichever of those are actually open right now,
 * whether it's front, behind, or minimized. Click a row's title to jump to it (or open it, if
 * it wasn't); the switch on the right adds or fully removes it, independent of that.
 *
 * ⚠️ A HOOK CALLED BY THE CANVAS, NOT STATE INSIDE THE MENU, for the reason useActivityEditor is one:
 * the menu's button sits in the canvas bar, which the canvas rebuilds every render, and what you
 * typed into its filter has to survive the panel closing — exactly as when this lived in
 * CircuitCanvas.tsx. The menu draws it (WindowsMenu.tsx).
 */
export function useWindowsMenu() {
  const [winMenuOpen, setWinMenuOpen] = useState(false)
  const [winMenuAnchor, setWinMenuAnchor] = useState<{ left: number; top: number } | null>(null)
  const [winMenuQuery, setWinMenuQuery] = useState('')
  const [winMenuSpaces, setWinMenuSpaces] = useState<Workspace[]>(loadWorkspaces)
  const winMenuBtnRef = useRef<HTMLButtonElement | null>(null)
  const winMenuPanelRef = useRef<HTMLDivElement | null>(null)
  const winMenuSearchRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (!winMenuOpen) return
    winMenuSearchRef.current?.focus()
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (winMenuBtnRef.current?.contains(t)) return
      if (winMenuPanelRef.current && !winMenuPanelRef.current.contains(t)) setWinMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWinMenuOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [winMenuOpen])
  useEffect(() => {
    if (!winMenuOpen) return
    const measure = () => {
      const r = winMenuBtnRef.current?.getBoundingClientRect()
      if (r) setWinMenuAnchor({ left: Math.round(r.left), top: Math.round(r.bottom) })
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [winMenuOpen])
  return {
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
  }
}

export type WindowsMenuState = ReturnType<typeof useWindowsMenu>
