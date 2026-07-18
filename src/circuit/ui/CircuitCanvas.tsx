// Free canvas — turns the Circuit panes into draggable / resizable floating windows
// (Aero-style edge snapping, minimize / maximize / fit, z-order focus, persisted layout).
// Ported from the standalone's "operating system" mode. Desktop-only.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { showToast } from '../toast'
import { site } from '../../config/site'
import { IconGitHub, IconLinkedIn } from '../../components/Icons'
import { AmbientBackdrop } from '../../components/AmbientBackdrop'

export type CanvasPane = { id: string; title: string; node: ReactNode }

type WinBox = {
  x: number
  y: number
  w: number
  h: number
  min: boolean
  max: boolean
  z: number
  prev?: { x: number; y: number; w: number; h: number }
}
type Layout = Record<string, WinBox>

// v4: layouts are stored per canvas (home vs circuit have different panes — one shared
// key made each page clobber the other's layout and re-tile every visit).
// PINNED panes are excluded from the key and from the per-tab layout: they're the same
// window following you between tabs, so their box lives in the shared pin store below.
// Keeping them out also means pinning/unpinning no longer changes a tab's key — which
// used to invalidate its saved layout and re-tile everything.
const storeKey = (panes: CanvasPane[], pinnedIds: string[]) =>
  'canvas_v4:' +
  panes
    .filter((p) => !pinnedIds.includes(p.id))
    .map((p) => p.id)
    .sort()
    .join(',')
const GAP = 12
const MAP_W = 120
// the canvas plane extends 2x the screen in each direction - room to park windows off-view
const WORLD = 2
// One box per pinned window, shared by every tab's canvas — so a pinned window stays
// exactly where you put it as you move page to page.
const PIN_KEY = 'canvas_pins_v1'

function loadLayout(key: string): Layout | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as Layout) : null
  } catch {
    return null
  }
}
function saveLayout(key: string, l: Layout) {
  try {
    localStorage.setItem(key, JSON.stringify(l))
  } catch {
    /* ignore quota */
  }
}
const loadPins = (): Layout => loadLayout(PIN_KEY) || {}
// where you LEFT the view (pan + zoom), per canvas — without this every remount reset to
// the plane's centre, and any windows arranged above it sat off-view over the top edge
type SavedView = { x: number; y: number; v: number }
function loadView(key: string): SavedView | null {
  try {
    const raw = localStorage.getItem('canvas_view_v1:' + key)
    return raw ? (JSON.parse(raw) as SavedView) : null
  } catch {
    return null
  }
}
function saveView(key: string, sv: SavedView) {
  try {
    localStorage.setItem('canvas_view_v1:' + key, JSON.stringify(sv))
  } catch {
    /* ignore */
  }
}
function savePins(boxes: Layout) {
  saveLayout(PIN_KEY, { ...loadPins(), ...boxes })
}

type Zone = 'max' | 'left' | 'right' | 'tl' | 'tr' | 'bl' | 'br'
type Dir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
const RESIZE_DIRS: Dir[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']
const MIN_W = 240
const MIN_H = 120
// the width at which a window's content reads cleanly at 100% (also the "ideal size" the
// Window button snaps back to).
const IDEAL_W = 440
const IDEAL_H = 560
// Content scale from WIDTH only, capped at 100%. A window is never zoomed PAST natural
// size, so making it bigger always reveals MORE content instead of enlarging what's there
// — dragging a window taller used to also grow the content (via a width+height scale), so
// you could never catch the bottom. Narrow windows still shrink content a little so it
// fits without excessive reflow. Height no longer affects scale, so growing height purely
// shows more. Content already reads at a screen-appropriate size via the fluid root.
// Quantized to 5% steps so text doesn't reflow on every pixel of a resize.
const scaleFor = (w: number) => Math.min(1, Math.max(0.6, Math.round(w / IDEAL_W / 0.05) * 0.05))

// fit one window fully inside the canvas (shared by the restore paths and clampAll)
function clampBox(w: WinBox, b: { w: number; h: number }): WinBox {
  const cw = Math.max(MIN_W, Math.min(w.w, b.w))
  const ch = Math.max(MIN_H, Math.min(w.h, b.h))
  return {
    ...w,
    w: cw,
    h: ch,
    x: Math.max(0, Math.min(w.x, b.w - cw)),
    y: Math.max(0, Math.min(w.y, b.h - ch)),
  }
}

function handleStyle(dir: Dir): React.CSSProperties {
  const base: React.CSSProperties = { position: 'absolute', zIndex: 6, touchAction: 'none' }
  const edge = 8 // grab thickness
  const corner = 15
  switch (dir) {
    case 'n':
      return { ...base, top: 0, left: corner, right: corner, height: edge, cursor: 'ns-resize' }
    case 's':
      return { ...base, bottom: 0, left: corner, right: corner, height: edge, cursor: 'ns-resize' }
    case 'e':
      return { ...base, right: 0, top: corner, bottom: corner, width: edge, cursor: 'ew-resize' }
    case 'w':
      return { ...base, left: 0, top: corner, bottom: corner, width: edge, cursor: 'ew-resize' }
    case 'ne':
      return { ...base, top: 0, right: 0, width: corner, height: corner, cursor: 'nesw-resize' }
    case 'nw':
      return { ...base, top: 0, left: 0, width: corner, height: corner, cursor: 'nwse-resize' }
    case 'se':
      return { ...base, bottom: 0, right: 0, width: corner, height: corner, cursor: 'nwse-resize' }
    case 'sw':
      return { ...base, bottom: 0, left: 0, width: corner, height: corner, cursor: 'nesw-resize' }
  }
}

export function CircuitCanvas({
  panes,
  focusPane,
  pinnedIds = [],
  onTogglePin,
}: {
  panes: CanvasPane[]
  focusPane?: { id: string; nonce: number } | null
  /** ids of panes the user pinned — they follow them across tabs */
  pinnedIds?: string[]
  onTogglePin?: (pane: CanvasPane) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const winRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const maxZ = useRef(10)
  // portal target captured once at first render (this is a browser-only SPA, so body is
  // always present) — evaluating document.body per-render tripped an intermittent
  // "target container is not a DOM element" during error-boundary recovery / HMR
  const [portalTarget] = useState<HTMLElement | null>(() =>
    typeof document !== 'undefined' ? document.body : null,
  )
  const [wins, setWins] = useState<Layout>({})
  // ── wheel zoom: scroll out to EXPAND the canvas area (view shrinks, world grows);
  // scrolling back in caps at the default 1.0 — never closer than natural size ──
  const [view, setView] = useState(1)
  const viewRef = useRef(1)
  // pan: the plane is WORLD x the screen per axis; grab empty canvas and drag to move
  // around it. During the drag the transform is written straight to the DOM - no React
  // render per pointer move, so it stays at the pointer's own frame rate.
  const [pan, setPanState] = useState({ x: 0, y: 0 })
  const panRef = useRef({ x: 0, y: 0 })
  const worldRef = useRef<HTMLDivElement>(null)
  const panDrag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)
  // selection: the wheel scrolls only the window you CLICKED; everywhere else it zooms
  // the canvas. Clicking empty canvas deselects.
  const [selId, setSelId] = useState<string | null>(null)
  const selRef = useRef<string | null>(null)
  // minimap: fades in while the view moves, updated via refs so panning stays render-free
  const mapRef = useRef<HTMLDivElement>(null)
  const vpRef = useRef<HTMLSpanElement>(null)
  const mapFade = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // visibility is React state (a render on show/hide is fine); the viewport RECT stays
  // ref-driven so per-frame panning never renders
  const [mapOn, setMapOn] = useState(false)
  // the canvas wallpaper honours the same cog toggle as the page glow
  const [ambientOn] = useState(
    () => typeof localStorage === 'undefined' || localStorage.getItem('ambient_v1') !== '0',
  )
  const [snap, setSnap] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const drag = useRef<{
    id: string
    sx: number
    sy: number
    ox: number
    oy: number
    zone: Zone | null
    // velocity tracking (px/ms, exponentially smoothed) — a released window keeps
    // its momentum instead of stopping dead under the cursor
    lx: number
    ly: number
    lt: number
    vx: number
    vy: number
  } | null>(null)
  // ── weight: programmatic box changes settle into place instead of teleporting ──
  const settleTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const reducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  // Arm a one-shot eased transition on a window, then disarm so pointer drags stay 1:1.
  // The bezier overshoots a touch (1.35) — enough to read as mass, tight enough to
  // never read as broken.
  const settle = useCallback(
    (id: string) => {
      if (reducedMotion) return
      const el = winRefs.current[id]
      if (!el) return
      const ease = 'cubic-bezier(0.3, 1.35, 0.45, 1)'
      el.style.transition = `left 0.32s ${ease}, top 0.32s ${ease}, width 0.32s ${ease}, height 0.32s ${ease}`
      clearTimeout(settleTimers.current[id])
      settleTimers.current[id] = setTimeout(() => {
        el.style.transition = ''
      }, 340)
    },
    [reducedMotion],
  )
  const resz = useRef<{
    id: string
    dir: Dir
    sx: number
    sy: number
    ox: number
    oy: number
    ow: number
    oh: number
  } | null>(null)

  // ── geometry helpers (host-relative coordinate space) ──
  const hostBox = useCallback(() => {
    const host = hostRef.current
    if (!host) return { x: 0, y: 0, w: 900, h: 700 }
    const cs = getComputedStyle(host)
    const padL = parseFloat(cs.paddingLeft) || 0
    const padR = parseFloat(cs.paddingRight) || 0
    const padT = parseFloat(cs.paddingTop) || 0
    const padB = parseFloat(cs.paddingBottom) || 0
    const v = viewRef.current
    return {
      x: panRef.current.x,
      y: panRef.current.y,
      w: (host.clientWidth - padL - padR) / v,
      h: (host.clientHeight - padT - padB) / v,
    }
  }, [])
  // the whole plane, in world coords - windows clamp to THIS, the viewport just looks at it
  const worldBox = useCallback(() => {
    const host = hostRef.current
    if (!host) return { w: 1800, h: 1400 }
    return { w: host.clientWidth * WORLD, h: host.clientHeight * WORLD }
  }, [])
  const clampPan = useCallback((pn: { x: number; y: number }) => {
    const host = hostRef.current
    if (!host) return pn
    const v = viewRef.current
    const maxX = Math.max(0, host.clientWidth * WORLD - host.clientWidth / v)
    const maxY = Math.max(0, host.clientHeight * WORLD - host.clientHeight / v)
    return { x: Math.min(maxX, Math.max(0, pn.x)), y: Math.min(maxY, Math.max(0, pn.y)) }
  }, [])
  const worldTransform = (pn: { x: number; y: number }, v: number) =>
    `translate(${-pn.x * v}px, ${-pn.y * v}px) scale(${v})`
  const pokeMap = useCallback(() => {
    const host = hostRef.current
    const mapEl = mapRef.current
    const vp = vpRef.current
    if (!host || !mapEl || !vp) return
    const scale = MAP_W / (host.clientWidth * WORLD)
    setMapOn(true)
    vp.style.left = panRef.current.x * scale + 'px'
    vp.style.top = panRef.current.y * scale + 'px'
    vp.style.width = (host.clientWidth / viewRef.current) * scale + 'px'
    vp.style.height = (host.clientHeight / viewRef.current) * scale + 'px'
    clearTimeout(mapFade.current)
    mapFade.current = setTimeout(() => setMapOn(false), 1400)
  }, [])
  // one zoom path for wheel and slider: anchored so the given point stays put
  const applyZoom = useCallback(
    (target: number, cx: number, cy: number) => {
      const v = viewRef.current
      const next = Math.min(1, Math.max(0.5, +target.toFixed(2)))
      if (next === v) return
      const k = 1 / v - 1 / next
      viewRef.current = next
      panRef.current = clampPan({ x: panRef.current.x + cx * k, y: panRef.current.y + cy * k })
      if (worldRef.current) worldRef.current.style.transform = worldTransform(panRef.current, next)
      pokeMap()
      setView(next)
    },
    [clampPan, pokeMap],
  )
  const onPanMove = useCallback(
    (e: PointerEvent) => {
      const d = panDrag.current
      if (!d) return
      const v = viewRef.current
      const pn = clampPan({ x: d.ox - (e.clientX - d.sx) / v, y: d.oy - (e.clientY - d.sy) / v })
      panRef.current = pn
      if (worldRef.current) worldRef.current.style.transform = worldTransform(pn, v)
      pokeMap()
    },
    [clampPan, pokeMap],
  )
  const onPanUp = useCallback(() => {
    window.removeEventListener('pointermove', onPanMove)
    window.removeEventListener('pointerup', onPanUp)
    if (!panDrag.current) return
    panDrag.current = null
    if (hostRef.current) hostRef.current.style.cursor = 'grab'
    setPanState({ ...panRef.current })
  }, [onPanMove])
  function onPanStart(e: React.PointerEvent) {
    // only empty canvas pans - windows, links and buttons keep their own gestures
    if ((e.target as HTMLElement).closest('[data-czid], a, button')) return
    setSelId(null)
    selRef.current = null
    panDrag.current = { sx: e.clientX, sy: e.clientY, ox: panRef.current.x, oy: panRef.current.y }
    if (hostRef.current) hostRef.current.style.cursor = 'grabbing'
    e.preventDefault()
    window.addEventListener('pointermove', onPanMove)
    window.addEventListener('pointerup', onPanUp)
  }

  const snapGeom = useCallback(
    (zone: Zone) => {
      const b = hostBox()
      const halfW = Math.floor((b.w - GAP) / 2)
      const halfH = Math.floor((b.h - GAP) / 2)
      // zones are relative to what you're LOOKING at (the panned viewport), not the plane
      switch (zone) {
        case 'max':
          return { x: b.x, y: b.y, w: b.w, h: b.h }
        case 'left':
          return { x: b.x, y: b.y, w: halfW, h: b.h }
        case 'right':
          return { x: b.x + halfW + GAP, y: b.y, w: b.w - halfW - GAP, h: b.h }
        case 'tl':
          return { x: b.x, y: b.y, w: halfW, h: halfH }
        case 'tr':
          return { x: b.x + halfW + GAP, y: b.y, w: b.w - halfW - GAP, h: halfH }
        case 'bl':
          return { x: b.x, y: b.y + halfH + GAP, w: halfW, h: b.h - halfH - GAP }
        case 'br':
          return {
            x: b.x + halfW + GAP,
            y: b.y + halfH + GAP,
            w: b.w - halfW - GAP,
            h: b.h - halfH - GAP,
          }
      }
    },
    [hostBox],
  )

  // Tile to fill the whole canvas: pick a column count for the width, then size
  // rows/cols so the grid uses all the available space (no dead gaps).
  const defaultTile = useCallback(
    (list: CanvasPane[] = panes): Layout => {
      const b = hostBox()
      const n = list.length
      const cols = b.w >= 1180 ? 3 : b.w >= 680 ? 2 : 1
      const rows = Math.ceil(n / cols)
      const colW = Math.floor((b.w - (cols - 1) * GAP) / cols)
      const rowH = Math.floor((b.h - (rows - 1) * GAP) / rows)
      const next: Layout = {}
      list.forEach((p, i) => {
        const col = i % cols
        const row = Math.floor(i / cols)
        next[p.id] = {
          x: b.x + col * (colW + GAP),
          y: b.y + row * (rowH + GAP),
          w: colW,
          h: rowH,
          min: false,
          max: false,
          z: ++maxZ.current,
        }
      })
      return next
    },
    [hostBox, panes],
  )

  // Fit every window to the current canvas: maximized ones re-take the full surface,
  // the rest are clamped fully inside. Fixes stale saved layouts (from a bigger window
  // or different zoom) that used to leave a "full screen" window hanging past the edge.
  const clampAll = useCallback(
    (l: Layout): Layout => {
      const b = worldBox()
      const next: Layout = {}
      for (const [id, w] of Object.entries(l)) {
        next[id] = w.max ? { ...w, ...snapGeom('max')! } : clampBox(w, b)
      }
      return next
    },
    [worldBox, snapGeom],
  )

  // Wheel on empty canvas zooms the view; wheel INSIDE a window still scrolls that
  // window. Non-passive listener because we must preventDefault the page.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const onWheel = (e: WheelEvent) => {
      // only the window you SELECTED scrolls its content — over everything else
      // (empty canvas or unselected windows) the wheel zooms, so browsing the plane
      // never hijacks a window's scroll by accident
      const winEl = (e.target as HTMLElement).closest('[data-czid]')
      if (winEl && winEl.getAttribute('data-czid') === selRef.current) return
      e.preventDefault()
      const rect = host.getBoundingClientRect()
      applyZoom(
        viewRef.current - Math.sign(e.deltaY) * 0.1,
        e.clientX - rect.left,
        e.clientY - rect.top,
      )
    }
    host.addEventListener('wheel', onWheel, { passive: false })
    return () => host.removeEventListener('wheel', onWheel)
  }, [applyZoom])
  // zooming back IN shrinks the world — pull any window parked out there back inside
  useEffect(() => {
    viewRef.current = view
    // panRef is the truth here — the wheel handler may have just anchored it to the
    // cursor; clamping the stale state instead would throw that adjustment away
    setPanState(() => {
      const c = clampPan(panRef.current)
      panRef.current = c
      return c
    })
    setWins((prev) => clampAll(prev))
  }, [view, clampAll, clampPan])

  // ── init: restore saved layout (fitted to today's canvas) or tile fresh ──
  useLayoutEffect(() => {
    // Start the viewport at the plane's CENTRE, not its corner — cursor-anchored zoom
    // needs pan room on every side, and at the corner the clamp eats the anchor (the
    // map-edge problem: zoom drifted instead of holding under the cursor).
    const hostEl = hostRef.current
    const ex = hostEl ? (hostEl.clientWidth * (WORLD - 1)) / 2 : 0
    const ey = hostEl ? (hostEl.clientHeight * (WORLD - 1)) / 2 : 0
    // come back where you left off; the centre is only the first-visit default
    const sv = loadView(storeKey(panes, pinnedIds))
    const p0 = sv ? { x: sv.x, y: sv.y } : { x: ex, y: ey }
    if (sv && sv.v !== 1) {
      viewRef.current = sv.v
      setView(sv.v)
    }
    panRef.current = p0
    setPanState(p0)
    // only this tab's OWN panes come from its layout; pinned ones carry their box with them
    const own = panes.filter((p) => !pinnedIds.includes(p.id))
    const saved = loadLayout(storeKey(panes, pinnedIds))
    const valid = saved && own.every((p) => saved[p.id])
    const base = valid ? saved! : defaultTile(own)
    // layouts saved before the plane existed live in the top-left quadrant — carry them
    // to the centre once (post-shift coords fail this test, so it can't double-apply)
    if (valid && hostEl) {
      const legacy = own.every((pn) => {
        const b0 = base[pn.id]
        return b0.x + b0.w <= hostEl.clientWidth + 8 && b0.y + b0.h <= hostEl.clientHeight + 8
      })
      if (legacy)
        own.forEach((pn) => {
          base[pn.id] = { ...base[pn.id], x: base[pn.id].x + ex, y: base[pn.id].y + ey }
        })
    }
    const pins = loadPins()
    const next: Layout = {}
    for (const p of panes) {
      const box = pinnedIds.includes(p.id) ? pins[p.id] || base[p.id] : base[p.id]
      if (box) next[p.id] = box
    }
    const fitted = clampAll(next)
    Object.values(fitted).forEach((w) => {
      if (w.z > maxZ.current) maxZ.current = w.z
    })
    setWins(fitted)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Panes can arrive after mount — pinning a window here, or one following you from another
  // tab. A pinned window keeps its shared box (it's the same window, so it must not jump);
  // anything genuinely new gets a cascaded spot. The init above only runs once, so without
  // this a late pane would never render.
  useEffect(() => {
    setWins((prev) => {
      const missing = panes.filter((p) => !prev[p.id])
      if (!missing.length) return prev
      const b = hostBox()
      const wb = worldBox()
      const pins = loadPins()
      const next = { ...prev }
      missing.forEach((p, i) => {
        const pin = pins[p.id]
        if (pin) {
          next[p.id] = { ...clampBox(pin, wb), z: ++maxZ.current }
          return
        }
        const w = Math.min(IDEAL_W, b.w)
        const h = Math.min(IDEAL_H, b.h)
        const off = 26 * ((Object.keys(prev).length + i) % 5)
        next[p.id] = {
          x: b.x + Math.max(0, Math.min(off, b.w - w)),
          y: b.y + Math.max(0, Math.min(off, b.h - h)),
          w,
          h,
          min: false,
          max: false,
          z: ++maxZ.current,
        }
      })
      return next
    })
  }, [panes, hostBox, worldBox])

  // remember where the view sits, so the next mount opens on your arrangement
  useEffect(() => {
    saveView(storeKey(panes, pinnedIds), { x: pan.x, y: pan.y, v: view })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pan, view])

  // Persist whenever layout settles — this tab's own windows to its layout, pinned ones to
  // the shared pin store so wherever you drop a pinned window is where the next tab shows it.
  useEffect(() => {
    if (!Object.keys(wins).length) return
    const own: Layout = {}
    const pins: Layout = {}
    for (const [id, w] of Object.entries(wins)) {
      if (pinnedIds.includes(id)) pins[id] = w
      else own[id] = w
    }
    if (Object.keys(own).length) saveLayout(storeKey(panes, pinnedIds), own)
    if (Object.keys(pins).length) savePins(pins)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wins, panes, pinnedIds.join(',')])

  // canvas resized (browser window, devtools, zoom) → keep every window fitting
  useEffect(() => {
    const host = hostRef.current
    if (!host || typeof ResizeObserver === 'undefined') return
    let raf = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setWins((prev) => clampAll(prev)))
    })
    ro.observe(host)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [clampAll])

  // lock background scroll while the full-width canvas overlay is open, and tell the
  // app shell a canvas is active (it suspends the global zoom, which otherwise fights
  // the fixed surface and pushes maximized windows past the viewport)
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.dispatchEvent(new CustomEvent('yaya:canvas', { detail: true }))
    return () => {
      document.body.style.overflow = prev
      window.dispatchEvent(new CustomEvent('yaya:canvas', { detail: false }))
    }
  }, [])

  // ── external focus request (e.g. Board's "log today" summons the Log window) ──
  useEffect(() => {
    if (!focusPane) return
    focus(focusPane.id)
    setWins((prev) =>
      prev[focusPane.id]
        ? { ...prev, [focusPane.id]: { ...prev[focusPane.id], min: false } }
        : prev,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPane?.nonce])

  function focus(id: string) {
    setSelId(id)
    selRef.current = id
    maxZ.current++
    setWins((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], z: maxZ.current } } : prev))
  }

  // ── drag (title bar) ──
  function onWinPointerDown(e: React.PointerEvent, id: string) {
    if ((e.target as HTMLElement).closest('.cz-btn')) return
    focus(id)
    const w = wins[id]
    if (!w) return
    let ox = w.x
    let oy = w.y
    // dragging a maximized window restores it under the cursor (OS behavior), instead
    // of the old height-collapse glitch mid-drag
    if (w.max) {
      const rw = w.prev?.w ?? Math.min(IDEAL_W, w.w)
      const rh = w.prev?.h ?? Math.min(IDEAL_H, w.h)
      const b = hostBox()
      const px = host ? (e.clientX - host.left) / viewRef.current + panRef.current.x : 0
      ox = Math.max(0, Math.min(px - rw / 2, b.w - rw))
      oy = panRef.current.y
      const el = winRefs.current[id]
      if (el) {
        el.style.left = ox + 'px'
        el.style.top = oy + 'px'
        el.style.width = rw + 'px'
        el.style.height = rh + 'px'
        const body = el.querySelector<HTMLElement>('.cz-body')
        if (body) body.style.zoom = String(scaleFor(rw))
      }
      setWins((prev) => ({
        ...prev,
        [id]: { ...prev[id], x: ox, y: 0, w: rw, h: rh, max: false },
      }))
    }
    drag.current = {
      id,
      sx: e.clientX,
      sy: e.clientY,
      ox,
      oy,
      zone: null,
      lx: e.clientX,
      ly: e.clientY,
      lt: performance.now(),
      vx: 0,
      vy: 0,
    }
    // a fresh grab must kill any in-flight settle, or the drag fights the transition
    const grabbed = winRefs.current[id]
    if (grabbed) grabbed.style.transition = ''
    e.preventDefault()
    window.addEventListener('pointermove', onDragMove)
    window.addEventListener('pointerup', onDragUp)
  }

  // Snap only when the pointer is pressed right against an edge (12px) — the old 36px
  // band hijacked ordinary drags that merely passed near a border.
  const zoneFor = useCallback((e: PointerEvent): Zone | null => {
    const host = hostRef.current
    if (!host) return null
    const h = host.getBoundingClientRect()
    const T = 12
    const C = 48
    const rx = e.clientX - h.left
    const ry = e.clientY - h.top
    const nearL = rx < T
    const nearR = rx > h.width - T
    const nearT = ry < T
    if (nearT && rx < C) return 'tl'
    if (nearT && rx > h.width - C) return 'tr'
    if (nearT) return 'max'
    if (nearL && ry > h.height - C) return 'bl'
    if (nearR && ry > h.height - C) return 'br'
    if (nearL) return 'left'
    if (nearR) return 'right'
    return null
  }, [])

  const onDragMove = useCallback(
    (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const el = winRefs.current[d.id]
      if (!el) return
      // keep the window inside the PLANE (it may leave the visible screen - that's
      // what panning is for)
      const b = worldBox()
      const maxX = Math.max(0, b.w - el.offsetWidth)
      const maxY = Math.max(0, b.h - el.offsetHeight)
      const v = viewRef.current
      const nx = Math.min(maxX, Math.max(0, d.ox + (e.clientX - d.sx) / v))
      const ny = Math.min(maxY, Math.max(0, d.oy + (e.clientY - d.sy) / v))
      // move via direct DOM for smoothness; commit to state on drop
      el.style.left = nx + 'px'
      el.style.top = ny + 'px'
      // smoothed velocity, so the release direction is the hand's real direction and a
      // single jittery event can't fling the window somewhere surprising
      const now = performance.now()
      const dt = Math.max(1, now - d.lt)
      d.vx = 0.75 * d.vx + 0.25 * ((e.clientX - d.lx) / v / dt)
      d.vy = 0.75 * d.vy + 0.25 * ((e.clientY - d.ly) / v / dt)
      d.lx = e.clientX
      d.ly = e.clientY
      d.lt = now
      const zone = zoneFor(e)
      d.zone = zone
      setSnap(zone ? snapGeom(zone) : null)
    },
    [hostBox, snapGeom, zoneFor],
  )

  const onDragUp = useCallback(() => {
    const d = drag.current
    window.removeEventListener('pointermove', onDragMove)
    window.removeEventListener('pointerup', onDragUp)
    setSnap(null)
    if (!d) return
    const el = winRefs.current[d.id]
    setWins((prev) => {
      const w = prev[d.id]
      if (!w) return prev
      if (d.zone) {
        // snapping is a programmatic move — ease into the zone instead of teleporting
        settle(d.id)
        const g = snapGeom(d.zone)!
        return {
          ...prev,
          [d.id]: { ...w, ...g, max: d.zone === 'max', prev: { x: w.x, y: w.y, w: w.w, h: w.h } },
        }
      }
      const nx = el ? parseFloat(el.style.left) || w.x : w.x
      const ny = el ? parseFloat(el.style.top) || w.y : w.y
      // Momentum: a thrown window glides on for a beat and settles, clamped to the
      // canvas. The velocity must DECAY with hold time — while the pointer sits still no
      // pointermove fires, so without decay a flick-then-hold released at the stale flick
      // speed and the window flew off. Slow drops land exactly where the hand left them.
      const idle = performance.now() - d.lt
      const decay = Math.exp(-idle / 55)
      const vx = d.vx * decay
      const vy = d.vy * decay
      if (Math.hypot(vx, vy) > 0.3 && el && !reducedMotion) {
        const b = worldBox()
        const glide = 110 // ms worth of carried momentum
        const cap = 130 // a throw carries, it doesn't escape
        const gx = Math.max(
          0,
          Math.min(nx + Math.max(-cap, Math.min(vx * glide, cap)), b.w - el.offsetWidth),
        )
        const gy = Math.max(
          0,
          Math.min(ny + Math.max(-cap, Math.min(vy * glide, cap)), b.h - el.offsetHeight),
        )
        settle(d.id)
        return { ...prev, [d.id]: { ...w, x: gx, y: gy, max: false } }
      }
      return { ...prev, [d.id]: { ...w, x: nx, y: ny, max: false } }
    })
    drag.current = null
  }, [onDragMove, snapGeom, settle, hostBox, reducedMotion])

  // ── resize from any edge / corner ──
  const onResizeMove = useCallback(
    (e: PointerEvent) => {
      const r = resz.current
      if (!r) return
      const el = winRefs.current[r.id]
      if (!el) return
      const b = worldBox()
      const dx = (e.clientX - r.sx) / viewRef.current
      const dy = (e.clientY - r.sy) / viewRef.current
      let x = r.ox
      let y = r.oy
      let w = r.ow
      let h = r.oh
      if (r.dir.includes('e')) w = Math.max(MIN_W, r.ow + dx)
      if (r.dir.includes('s')) h = Math.max(MIN_H, r.oh + dy)
      if (r.dir.includes('w')) {
        w = Math.max(MIN_W, r.ow - dx)
        x = r.ox + (r.ow - w)
      }
      if (r.dir.includes('n')) {
        h = Math.max(MIN_H, r.oh - dy)
        y = r.oy + (r.oh - h)
      }
      if (x < 0) {
        w += x
        x = 0
      }
      if (y < 0) {
        h += y
        y = 0
      }
      // don't let the right / bottom edge spill past the canvas
      if (x + w > b.w) w = Math.max(MIN_W, b.w - x)
      if (y + h > b.h) h = Math.max(MIN_H, b.h - y)
      // direct DOM for smoothness; commit on release
      el.style.left = x + 'px'
      el.style.top = y + 'px'
      el.style.width = w + 'px'
      el.style.height = h + 'px'
      // content scale tracks the resize live (it used to pop only on release)
      const body = el.querySelector<HTMLElement>('.cz-body')
      if (body) body.style.zoom = String(scaleFor(w))
    },
    [hostBox],
  )

  const onResizeUp = useCallback(() => {
    const r = resz.current
    window.removeEventListener('pointermove', onResizeMove)
    window.removeEventListener('pointerup', onResizeUp)
    if (!r) return
    const el = winRefs.current[r.id]
    setWins((prev) => {
      const w = prev[r.id]
      if (!w || !el) return prev
      return {
        ...prev,
        [r.id]: {
          ...w,
          x: parseFloat(el.style.left) || w.x,
          y: parseFloat(el.style.top) || w.y,
          w: parseFloat(el.style.width) || w.w,
          h: parseFloat(el.style.height) || w.h,
          max: false,
        },
      }
    })
    resz.current = null
  }, [onResizeMove])

  function onResizeStart(e: React.PointerEvent, id: string, dir: Dir) {
    e.stopPropagation()
    e.preventDefault()
    focus(id)
    const w = wins[id]
    if (!w) return
    resz.current = { id, dir, sx: e.clientX, sy: e.clientY, ox: w.x, oy: w.y, ow: w.w, oh: w.h }
    window.addEventListener('pointermove', onResizeMove)
    window.addEventListener('pointerup', onResizeUp)
  }

  // ── window controls ──
  function toggleMin(id: string) {
    setWins((prev) => ({ ...prev, [id]: { ...prev[id], min: !prev[id].min } }))
    if (!wins[id]?.min) focus(id)
  }
  function toggleMax(id: string) {
    settle(id)
    setWins((prev) => {
      const w = prev[id]
      if (w.max && w.prev) return { ...prev, [id]: { ...w, ...w.prev, max: false } }
      const g = snapGeom('max')!
      return { ...prev, [id]: { ...w, ...g, max: true, prev: { x: w.x, y: w.y, w: w.w, h: w.h } } }
    })
    focus(id)
  }
  // Window button: snap back to the ideal size where content reads at 100% (un-maximizes,
  // un-minimizes), clamped so it stays fully on the canvas.
  // "Fit to content" — measure THIS window's content and size the window to show all of
  // it without forced wrapping or scrolling, instead of a one-size-fits-all constant.
  // Width = the content's natural unwrapped width; height = what that width needs. Both
  // clamped to the canvas. Measured at scale 1; the window's actual scale is ≤1 (wider
  // effective layout), so the fit always has a little slack rather than clipping.
  // Measure one window's best fit. Tries several widths — a wider window that reflows
  // shorter beats a skinny tower (word-wrap is what makes towers), so among candidates
  // that need no scrollbar we take the least AREA, with a nudge toward wide. Height is
  // read under the candidate's real content zoom, so fit ends where the scrollbar would
  // begin.
  function measureFit(id: string): { w: number; h: number } | null {
    const el = winRefs.current[id]
    const body = el?.querySelector<HTMLElement>('.cz-body')
    const host = hostRef.current
    if (!el || !body || !host) return null
    // fits target the 100%-zoom view — Evan's ideal is navigating and organizing at
    // 100% — NOT the current-zoom viewport, which balloons when zoomed out and made
    // fitted windows bigger than a screen
    const b = { w: host.clientWidth - 8, h: host.clientHeight - 8 }
    const bar = el.querySelector<HTMLElement>('.cz-bar')
    const barH = Math.ceil(bar?.getBoundingClientRect().height ?? 38)
    const sZoom = body.style.zoom
    const sBodyW = body.style.width
    const sElW = el.style.width
    const sDisp = el.style.display
    el.style.display = 'flex' // minimized windows are display:none and would measure 0
    body.classList.add('cz-measure')
    body.style.zoom = '1'
    body.style.width = 'max-content'
    const wNeed = Math.ceil(body.getBoundingClientRect().width)
    body.style.width = ''
    body.classList.remove('cz-measure')
    const cands = Array.from(
      new Set([wNeed + 4, 560, 700, 860].map((c) => Math.round(Math.min(b.w, Math.max(MIN_W, c))))),
    ).sort((c1, c2) => c1 - c2)
    let best: { w: number; h: number; score: number } | null = null
    for (const cw of cands) {
      const sc = scaleFor(cw)
      el.style.width = cw + 'px'
      body.style.zoom = String(sc)
      const rawH = Math.ceil(body.scrollHeight * sc) + barH + 2
      const ch = Math.min(b.h, Math.max(MIN_H, rawH))
      // a scrolling candidate only wins if nothing fits; wider wins near-ties
      const score = (rawH > b.h ? 1e9 : 0) + cw * ch
      if (!best || score <= best.score * 1.05) best = { w: cw, h: ch, score }
    }
    body.style.zoom = sZoom
    body.style.width = sBodyW
    el.style.width = sElW
    el.style.display = sDisp
    return best && { w: best.w, h: best.h }
  }

  // ▣ Fit all: every window at its fitted size, packed around the plane's centre —
  // the whole site laid out as a mosaic you pan through.
  function fitTile() {
    const sizes: Record<string, { w: number; h: number }> = {}
    panes.forEach((p) => {
      const m = measureFit(p.id)
      if (m) sizes[p.id] = m
    })
    // every pane joins the mosaic — an unmeasured one gets the default box rather than
    // staying behind to overlap the others
    panes.forEach((p) => {
      if (!sizes[p.id]) sizes[p.id] = { w: IDEAL_W, h: IDEAL_H }
    })
    const ids = panes.map((p) => p.id)
    if (!ids.length) return
    ids.sort((a2, b2) => sizes[b2].h - sizes[a2].h)
    const totalArea = ids.reduce((acc, id) => acc + (sizes[id].w + GAP) * (sizes[id].h + GAP), 0)
    const targetW = Math.max(...ids.map((id) => sizes[id].w), Math.sqrt(totalArea * 1.6))
    const rows: { ids: string[]; w: number; h: number }[] = []
    let cur = { ids: [] as string[], w: 0, h: 0 }
    for (const id of ids) {
      const sz = sizes[id]
      if (cur.w > 0 && cur.w + sz.w + GAP > targetW) {
        rows.push(cur)
        cur = { ids: [], w: 0, h: 0 }
      }
      cur.w += (cur.w ? GAP : 0) + sz.w
      cur.h = Math.max(cur.h, sz.h)
      cur.ids.push(id)
    }
    if (cur.ids.length) rows.push(cur)
    let blockW = Math.max(...rows.map((r) => r.w))
    let blockH = rows.reduce((acc, r) => acc + r.h, 0) + GAP * (rows.length - 1)
    const wb = worldBox()
    // the mosaic must FIT THE PLANE — beyond its edge, clamps pile windows into a heap.
    // If it's too big, every window scales down uniformly (a little scroll beats chaos).
    const f = Math.min(1, (wb.w - 2 * GAP) / blockW, (wb.h - 2 * GAP) / blockH)
    if (f < 1) {
      for (const id of ids) {
        sizes[id] = {
          w: Math.max(MIN_W, Math.floor(sizes[id].w * f)),
          h: Math.max(MIN_H, Math.floor(sizes[id].h * f)),
        }
      }
      for (const r of rows) {
        r.w = Math.floor(r.w * f)
        r.h = Math.floor(r.h * f)
      }
      blockW = Math.floor(blockW * f)
      blockH = Math.floor(blockH * f)
    }
    const ox = Math.max(GAP, (wb.w - blockW) / 2)
    const oy = Math.max(GAP, (wb.h - blockH) / 2)
    const next: Layout = {}
    let yy = oy
    for (const r of rows) {
      let xx = ox + (blockW - r.w) / 2
      for (const id of r.ids) {
        const sz = sizes[id]
        next[id] = {
          x: xx,
          y: yy + (r.h - sz.h) / 2,
          w: sz.w,
          h: sz.h,
          min: false,
          max: false,
          z: ++maxZ.current,
        }
        xx += sz.w + GAP
      }
      yy += r.h + GAP
    }
    panes.forEach((p) => settle(p.id))
    setWins((prev) => ({ ...prev, ...next }))
    // centre the view on the mosaic
    const host = hostRef.current
    if (host) {
      const v = viewRef.current
      // land at the mosaic's TOP, horizontally centred — centring vertically put the
      // first rows above the view and their title bars out of reach
      const pn = clampPan({
        x: ox + blockW / 2 - host.clientWidth / (2 * v),
        y: oy - GAP,
      })
      panRef.current = pn
      setPanState(pn)
      if (worldRef.current) worldRef.current.style.transform = worldTransform(pn, v)
      pokeMap()
    }
    showToast('▣ Everything, fitted')
  }

  function idealSize(id: string) {
    const el = winRefs.current[id]
    const body = el?.querySelector<HTMLElement>('.cz-body')
    const b = hostBox()
    if (!el || !body) {
      // fallback: the old fixed guess if we can't measure
      const nw = Math.min(IDEAL_W, b.w)
      const nh = Math.min(IDEAL_H, b.h)
      settle(id)
      setWins((prev) => {
        const win = prev[id]
        if (!win) return prev
        const x = Math.max(b.x, Math.min(win.x, b.x + b.w - nw))
        const y = Math.max(b.y, Math.min(win.y, b.y + b.h - nh))
        return { ...prev, [id]: { ...win, min: false, max: false, x, y, w: nw, h: nh } }
      })
      focus(id)
      return
    }
    const m = measureFit(id)
    if (!m) return
    const w = m.w
    const h = m.h
    // armed only now — a transition during the measurement above would animate the probe
    // width and make scrollHeight read against the old layout
    settle(id)
    setWins((prev) => {
      const win = prev[id]
      if (!win) return prev
      // land IN VIEW, preferring unused space: try where it is, then the view's corners
      // and centre — first spot covering no other window wins (else least overlap)
      const others = Object.entries(prev).filter(([oid, ow]) => oid !== id && !ow.min)
      const overlapAt = (qx: number, qy: number) =>
        others.reduce((acc, [, o]) => {
          const ix = Math.max(0, Math.min(qx + w, o.x + o.w) - Math.max(qx, o.x))
          const iy = Math.max(0, Math.min(qy + h, o.y + o.h) - Math.max(qy, o.y))
          return acc + ix * iy
        }, 0)
      const spots: [number, number][] = [
        [
          Math.max(b.x, Math.min(win.x, b.x + b.w - w)),
          Math.max(b.y, Math.min(win.y, b.y + b.h - h)),
        ],
        [b.x, b.y],
        [b.x + b.w - w, b.y],
        [b.x, b.y + b.h - h],
        [b.x + b.w - w, b.y + b.h - h],
        [b.x + (b.w - w) / 2, b.y + (b.h - h) / 2],
      ]
      let x = spots[0][0]
      let y = spots[0][1]
      let best = Infinity
      for (const [qx, qy] of spots) {
        const ov = overlapAt(qx, qy)
        if (ov < best) {
          best = ov
          x = qx
          y = qy
        }
        if (best === 0) break
      }
      return { ...prev, [id]: { ...win, min: false, max: false, x, y, w, h } }
    })
    focus(id)
    showToast('▭ Fit to content')
    // an image (Feed photo) whose height wasn't known at measure time would force a
    // scroll once it loads — re-fit when each pending image finishes so the window
    // grows to include it instead
    body.querySelectorAll('img').forEach((img) => {
      if (!img.complete) img.addEventListener('load', () => idealSize(id), { once: true })
    })
  }
  function tile() {
    maxZ.current = 10
    panes.forEach((p) => settle(p.id))
    setWins(defaultTile())
    showToast('⊞ Windows tiled')
  }

  // taskbar tab toggle: restore+focus a minimized pane, focus a back one, or
  // minimize the one that's already on top.
  function onTab(id: string) {
    const w = wins[id]
    if (!w) return
    if (w.min) {
      setWins((prev) => ({ ...prev, [id]: { ...prev[id], min: false } }))
      focus(id)
    } else if (id !== topId) {
      focus(id)
    } else {
      setWins((prev) => ({ ...prev, [id]: { ...prev[id], min: true } }))
    }
  }

  // the currently-focused (front-most, non-minimized) pane
  let topId = ''
  let topZ = -1
  panes.forEach((p) => {
    const w = wins[p.id]
    if (w && !w.min && w.z > topZ) {
      topZ = w.z
      topId = p.id
    }
  })

  const host = hostRef.current?.getBoundingClientRect()

  if (!portalTarget) return null
  // Portaled to <body> so the fixed surface spans the true viewport. Rendered inline it
  // gets trapped by any ancestor that establishes a containing block (the #circuit card's
  // reveal transform did exactly that — a maximized window collapsed to the card's height).
  // The window taskbar lives IN the site nav (one menu, not a second bar stacked under the
  // first). The nav renders an empty slot; we portal into it when it's there, and fall back
  // to an in-surface bar if it isn't (the Circuit can mount this canvas on its own).
  // The canvas menu is its OWN bar, but it speaks the nav's language: same .btn, same
  // sizing, same accent for the active item (see .cz-menu in index.css). Two menus, one
  // design — rather than one bar doing two jobs.
  const bar = (
    <div className="cz-menu">
      <strong
        className="cz-menu-label"
        title="Drag a title bar to move (press against an edge to snap) · drag any edge or corner to resize · ▭ fit to content · ⛶ full screen · － hide"
      >
        ⛶ Canvas <span className="muted">ⓘ</span>
      </strong>
      {panes.map((p) => {
        const w = wins[p.id]
        const min = !!w?.min
        const front = p.id === topId && !min
        return (
          <button
            key={p.id}
            className={'btn' + (min ? ' is-min' : '')}
            aria-pressed={front}
            onClick={() => onTab(p.id)}
            title={
              min ? `Restore ${p.title}` : front ? `Hide ${p.title}` : `Bring ${p.title} to front`
            }
          >
            <span aria-hidden style={{ fontSize: '0.7rem' }}>
              {min ? '▫' : '▪'}
            </span>{' '}
            {pinnedIds.includes(p.id) ? '📌 ' : ''}
            {p.title}
          </button>
        )
      })}
      <input
        type="range"
        min={50}
        max={100}
        step={5}
        value={Math.round(view * 100)}
        onChange={(e) => {
          const host = hostRef.current
          if (!host) return
          applyZoom(+e.target.value / 100, host.clientWidth / 2, host.clientHeight / 2)
        }}
        title={`Zoom ${Math.round(view * 100)}%`}
        aria-label="Canvas zoom"
        className="cz-menu-end"
        style={{ width: 76, flexShrink: 0, accentColor: 'var(--accent, #7c6af7)' }}
      />
      <button className="btn" onClick={tile} title="Tile the open windows to fill the canvas">
        ⊞ Tile
      </button>
      <button
        className="btn"
        onClick={fitTile}
        title="Fit every window to its content and arrange them around the centre — pan to explore"
      >
        ▣ Fit all
      </button>
    </div>
  )

  return createPortal(surface(bar), portalTarget)

  // Full-width canvas surface: a fixed panel spanning the viewport below the nav.
  // Desktop-only (the launcher button is hidden on phones), so mobile keeps the tabs.
  function surface(inlineBar: ReactNode) {
    const hw = hostRef.current?.clientWidth ?? 1200
    const hh = hostRef.current?.clientHeight ?? 800
    const mScale = MAP_W / (hw * WORLD)
    const mapH = hh * WORLD * mScale
    return (
      <div
        style={{
          position: 'fixed',
          top: 'var(--nav-h, 56px)',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg)',
          padding: '0.5rem clamp(0.6rem, 1.6vw, 1.1rem) 0.6rem',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ marginBottom: '0.45rem', flexShrink: 0 }}>{inlineBar}</div>

        {/* canvas surface */}
        <div
          ref={hostRef}
          onPointerDown={onPanStart}
          style={{
            position: 'relative',
            flex: 1,
            minHeight: 0,
            padding: 4,
            // the viewport onto the plane: windows clamp to the WORLD, and grabbing
            // empty canvas pans the view around it
            overflow: 'hidden',
            cursor: 'grab',
            touchAction: 'none',
            background:
              'repeating-linear-gradient(45deg, transparent, transparent 11px, rgba(127,127,127,0.025) 11px, rgba(127,127,127,0.025) 12px)',
            borderRadius: 10,
          }}
        >
          {ambientOn && <AmbientBackdrop inline section="home" theme="" enabled />}
          {/* the site's signature, canvas edition — copyright, build and socials were the
              one thing full-screen canvas hid entirely. Bottom-right, under the windows. */}
          <div
            className="muted"
            style={{
              position: 'absolute',
              right: 10,
              bottom: 6,
              zIndex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: '0.72rem',
              opacity: 0.75,
            }}
          >
            <span>
              © {new Date().getFullYear()} {site.name}
              {import.meta.env.VITE_APP_VERSION
                ? ` · build ${import.meta.env.VITE_APP_VERSION}`
                : ''}
            </span>
            <a
              href={site.socials.github}
              className="icon-link"
              aria-label="GitHub"
              target="_blank"
              rel="noreferrer"
            >
              <IconGitHub />
            </a>
            <a
              href={site.socials.linkedin}
              className="icon-link"
              aria-label="LinkedIn"
              target="_blank"
              rel="noreferrer"
            >
              <IconLinkedIn />
            </a>
          </div>
          {/* the world: windows live in world coordinates and the whole plane scales —
              zoomed out it's bigger than the host, giving more room to arrange */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: `${WORLD * 100}%`,
              height: `${WORLD * 100}%`,
              transform: worldTransform(pan, view),
              transformOrigin: '0 0',
            }}
            ref={worldRef}
          >
            {panes.map((p) => {
              const w = wins[p.id]
              if (!w) return null
              // minimized windows stay MOUNTED but hidden — restoring from the taskbar used
              // to rebuild the whole pane from scratch (a visible flash); now it's instant
              // and keeps scroll position / half-typed inputs alive
              // scale the content with the window size: at the "ideal" width it sits at 100%,
              // and growing the window past that scales everything up so it's easier to see.
              const bodyScale = scaleFor(w.w)
              return (
                <div
                  key={p.id}
                  ref={(el) => {
                    winRefs.current[p.id] = el
                  }}
                  data-czid={p.id}
                  onPointerDown={() => focus(p.id)}
                  style={{
                    position: 'absolute',
                    left: w.x,
                    top: w.y,
                    width: w.w,
                    height: w.h,
                    zIndex: w.z,
                    display: w.min ? 'none' : 'flex',
                    flexDirection: 'column',
                    background: 'var(--panel, #141a2a)',
                    border:
                      p.id === selId
                        ? '1px solid var(--accent, #7c6af7)'
                        : '1px solid var(--b2, rgba(127,127,127,0.3))',
                    borderRadius: 12,
                    boxShadow:
                      p.id === selId
                        ? '0 10px 34px rgba(0,0,0,0.55)'
                        : '0 8px 28px rgba(0,0,0,0.45)',
                    overflow: 'hidden',
                    minWidth: MIN_W,
                    minHeight: MIN_H,
                  }}
                >
                  {/* title bar */}
                  <div
                    className="cz-bar"
                    onPointerDown={(e) => onWinPointerDown(e, p.id)}
                    onDoubleClick={(e) => {
                      if (!(e.target as HTMLElement).closest('.cz-btn')) toggleMax(p.id)
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      padding: '6px 9px',
                      background: 'var(--b1, rgba(127,127,127,0.12))',
                      borderBottom: '1px solid var(--b1, rgba(127,127,127,0.15))',
                      cursor: 'grab',
                      userSelect: 'none',
                      flexShrink: 0,
                      touchAction: 'none',
                    }}
                  >
                    <span style={{ fontWeight: 700, fontSize: '0.82rem', flex: 1 }}>{p.title}</span>
                    {onTogglePin && (
                      <button
                        className="cz-btn btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          onTogglePin(p)
                        }}
                        title={
                          pinnedIds.includes(p.id)
                            ? 'Unpin — stops following you across tabs'
                            : 'Pin — keep this window with you on every tab'
                        }
                        aria-pressed={pinnedIds.includes(p.id)}
                        style={{
                          ...czBtn,
                          color: pinnedIds.includes(p.id) ? 'var(--accent, #7c6af7)' : undefined,
                          opacity: pinnedIds.includes(p.id) ? 1 : 0.55,
                        }}
                      >
                        📌
                      </button>
                    )}
                    <button
                      className="cz-btn btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleMin(p.id)
                      }}
                      title="Minimize (hide)"
                      style={czBtn}
                    >
                      －
                    </button>
                    <button
                      className="cz-btn btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        idealSize(p.id)
                      }}
                      title="Fit to content — size this window to show everything, no scroll"
                      style={czBtn}
                    >
                      ▭
                    </button>
                    <button
                      className="cz-btn btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleMax(p.id)
                      }}
                      title={w.max ? 'Restore' : 'Full screen'}
                      style={czBtn}
                    >
                      {w.max ? '🗗' : '⛶'}
                    </button>
                  </div>
                  {/* body — content scales with the window so a bigger window = bigger, clearer UI */}
                  <div
                    className="cz-body"
                    style={{ flex: 1, overflow: 'auto', padding: 12, zoom: bodyScale }}
                  >
                    {p.node}
                  </div>
                  {/* resize handles on every edge + corner — available even when maximized,
                  so dragging an edge inward shrinks it back out of full-screen */}
                  {RESIZE_DIRS.map((dir) => (
                    <div
                      key={dir}
                      onPointerDown={(e) => onResizeStart(e, p.id, dir)}
                      style={handleStyle(dir)}
                    />
                  ))}
                </div>
              )
            })}

            {/* snap preview overlay — world coords, so it scales with the view */}
            {snap && (
              <div
                style={{
                  position: 'absolute',
                  left: snap.x,
                  top: snap.y,
                  width: snap.w,
                  height: snap.h,
                  border: '2px solid var(--accent, #7c6af7)',
                  background: 'rgba(124,106,247,0.16)',
                  borderRadius: 12,
                  pointerEvents: 'none',
                  zIndex: 9999,
                  transition: 'left .08s, top .08s, width .08s, height .08s',
                }}
              />
            )}
          </div>
          {/* minimap: where you are on the plane — fades in while the view moves */}
          <div
            ref={mapRef}
            aria-hidden
            style={{
              position: 'absolute',
              left: 10,
              bottom: 8,
              width: MAP_W,
              height: mapH,
              opacity: mapOn ? 1 : 0,
              transition: 'opacity 0.35s',
              background: 'rgba(10,10,18,0.55)',
              border: '1px solid var(--b2, rgba(127,127,127,0.3))',
              borderRadius: 6,
              zIndex: 5,
              pointerEvents: 'none',
            }}
          >
            {Object.entries(wins)
              .filter(([, w]) => !w.min)
              .map(([wid, w]) => (
                <span
                  key={wid}
                  style={{
                    position: 'absolute',
                    left: w.x * mScale,
                    top: w.y * mScale,
                    width: Math.max(2, w.w * mScale),
                    height: Math.max(2, w.h * mScale),
                    background: 'rgba(124,106,247,0.55)',
                    borderRadius: 1,
                  }}
                />
              ))}
            <span
              ref={vpRef}
              style={{
                position: 'absolute',
                border: '1px solid rgba(255,255,255,0.85)',
                borderRadius: 2,
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>
      </div>
    )
  }
}

const czBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 30,
  height: 28,
  padding: 0,
  fontSize: '1rem',
  lineHeight: 1,
  minWidth: 'auto',
  flexShrink: 0,
}
