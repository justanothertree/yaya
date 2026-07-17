// Free canvas — turns the Circuit panes into draggable / resizable floating windows
// (Aero-style edge snapping, minimize / maximize / fit, z-order focus, persisted layout).
// Ported from the standalone's "operating system" mode. Desktop-only.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { showToast } from '../toast'
import { site } from '../../config/site'
import { IconGitHub, IconLinkedIn } from '../../components/Icons'

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
    if (!host) return { w: 900, h: 700 }
    const cs = getComputedStyle(host)
    const padL = parseFloat(cs.paddingLeft) || 0
    const padR = parseFloat(cs.paddingRight) || 0
    const padT = parseFloat(cs.paddingTop) || 0
    const padB = parseFloat(cs.paddingBottom) || 0
    return { w: host.clientWidth - padL - padR, h: host.clientHeight - padT - padB }
  }, [])

  const snapGeom = useCallback(
    (zone: Zone) => {
      const b = hostBox()
      const halfW = Math.floor((b.w - GAP) / 2)
      const halfH = Math.floor((b.h - GAP) / 2)
      switch (zone) {
        case 'max':
          return { x: 0, y: 0, w: b.w, h: b.h }
        case 'left':
          return { x: 0, y: 0, w: halfW, h: b.h }
        case 'right':
          return { x: halfW + GAP, y: 0, w: b.w - halfW - GAP, h: b.h }
        case 'tl':
          return { x: 0, y: 0, w: halfW, h: halfH }
        case 'tr':
          return { x: halfW + GAP, y: 0, w: b.w - halfW - GAP, h: halfH }
        case 'bl':
          return { x: 0, y: halfH + GAP, w: halfW, h: b.h - halfH - GAP }
        case 'br':
          return { x: halfW + GAP, y: halfH + GAP, w: b.w - halfW - GAP, h: b.h - halfH - GAP }
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
          x: col * (colW + GAP),
          y: row * (rowH + GAP),
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
      const b = hostBox()
      const next: Layout = {}
      for (const [id, w] of Object.entries(l)) {
        next[id] = w.max ? { ...w, ...snapGeom('max')! } : clampBox(w, b)
      }
      return next
    },
    [hostBox, snapGeom],
  )

  // ── init: restore saved layout (fitted to today's canvas) or tile fresh ──
  useLayoutEffect(() => {
    // only this tab's OWN panes come from its layout; pinned ones carry their box with them
    const own = panes.filter((p) => !pinnedIds.includes(p.id))
    const saved = loadLayout(storeKey(panes, pinnedIds))
    const valid = saved && own.every((p) => saved[p.id])
    const base = valid ? saved! : defaultTile(own)
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
      const pins = loadPins()
      const next = { ...prev }
      missing.forEach((p, i) => {
        const pin = pins[p.id]
        if (pin) {
          next[p.id] = { ...clampBox(pin, b), z: ++maxZ.current }
          return
        }
        const w = Math.min(IDEAL_W, b.w)
        const h = Math.min(IDEAL_H, b.h)
        const off = 26 * ((Object.keys(prev).length + i) % 5)
        next[p.id] = {
          x: Math.max(0, Math.min(off, b.w - w)),
          y: Math.max(0, Math.min(off, b.h - h)),
          w,
          h,
          min: false,
          max: false,
          z: ++maxZ.current,
        }
      })
      return next
    })
  }, [panes, hostBox])

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
      const host = hostRef.current?.getBoundingClientRect()
      const rw = w.prev?.w ?? Math.min(IDEAL_W, w.w)
      const rh = w.prev?.h ?? Math.min(IDEAL_H, w.h)
      const b = hostBox()
      const px = host ? e.clientX - host.left : 0
      ox = Math.max(0, Math.min(px - rw / 2, b.w - rw))
      oy = 0
      const el = winRefs.current[id]
      if (el) {
        el.style.left = ox + 'px'
        el.style.top = '0px'
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
      // keep the window fully inside the canvas (don't let it slide past any edge)
      const b = hostBox()
      const maxX = Math.max(0, b.w - el.offsetWidth)
      const maxY = Math.max(0, b.h - el.offsetHeight)
      const nx = Math.min(maxX, Math.max(0, d.ox + (e.clientX - d.sx)))
      const ny = Math.min(maxY, Math.max(0, d.oy + (e.clientY - d.sy)))
      // move via direct DOM for smoothness; commit to state on drop
      el.style.left = nx + 'px'
      el.style.top = ny + 'px'
      // smoothed velocity, so the release direction is the hand's real direction and a
      // single jittery event can't fling the window somewhere surprising
      const now = performance.now()
      const dt = Math.max(1, now - d.lt)
      d.vx = 0.75 * d.vx + 0.25 * ((e.clientX - d.lx) / dt)
      d.vy = 0.75 * d.vy + 0.25 * ((e.clientY - d.ly) / dt)
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
        const b = hostBox()
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
      const b = hostBox()
      const dx = e.clientX - r.sx
      const dy = e.clientY - r.sy
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
        const x = Math.max(0, Math.min(win.x, b.w - nw))
        const y = Math.max(0, Math.min(win.y, b.h - nh))
        return { ...prev, [id]: { ...win, min: false, max: false, x, y, w: nw, h: nh } }
      })
      focus(id)
      return
    }
    const bar = el.querySelector<HTMLElement>('.cz-bar')
    const barH = Math.ceil(bar?.getBoundingClientRect().height ?? 38)
    const sZoom = body.style.zoom
    const sBodyW = body.style.width
    const sElW = el.style.width
    // measure at natural scale so the numbers are the content's own, not the current zoom's
    body.style.zoom = '1'
    // natural unwrapped width (content + the body's own padding), forced no-wrap
    body.style.width = 'max-content'
    const wNeed = Math.ceil(body.getBoundingClientRect().width)
    body.style.width = ''
    const w = Math.min(b.w, Math.max(MIN_W, wNeed + 4))
    // height the content needs once wrapped to that width
    el.style.width = w + 'px'
    const hNeed = Math.ceil(body.scrollHeight)
    // restore the live styles (the state update below re-applies the real ones)
    body.style.zoom = sZoom
    body.style.width = sBodyW
    el.style.width = sElW
    // just 2px slack — enough to dodge sub-pixel rounding without leaving visible dead space
    const h = Math.min(b.h, Math.max(MIN_H, hNeed + barH + 2))
    // armed only now — a transition during the measurement above would animate the probe
    // width and make scrollHeight read against the old layout
    settle(id)
    setWins((prev) => {
      const win = prev[id]
      if (!win) return prev
      const x = Math.max(0, Math.min(win.x, b.w - w))
      const y = Math.max(0, Math.min(win.y, b.h - h))
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
            {p.title}
          </button>
        )
      })}
      <button
        className="btn cz-menu-end"
        onClick={tile}
        title="Tile the open windows to fill the canvas"
      >
        ⊞ Tile
      </button>
    </div>
  )

  return createPortal(surface(bar), portalTarget)

  // Full-width canvas surface: a fixed panel spanning the viewport below the nav.
  // Desktop-only (the launcher button is hidden on phones), so mobile keeps the tabs.
  function surface(inlineBar: ReactNode) {
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
          style={{
            position: 'relative',
            flex: 1,
            minHeight: 0,
            padding: 4,
            // windows are always clamped inside the surface, so nothing ever scrolls —
            // a maximized window is exactly the visible canvas
            overflow: 'hidden',
            background:
              'repeating-linear-gradient(45deg, transparent, transparent 11px, rgba(127,127,127,0.025) 11px, rgba(127,127,127,0.025) 12px)',
            borderRadius: 10,
          }}
        >
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
                    p.id === topId
                      ? '1px solid var(--accent, #7c6af7)'
                      : '1px solid var(--b2, rgba(127,127,127,0.3))',
                  borderRadius: 12,
                  boxShadow:
                    p.id === topId ? '0 10px 34px rgba(0,0,0,0.55)' : '0 8px 28px rgba(0,0,0,0.45)',
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

          {/* snap preview overlay */}
          {snap && host && (
            <div
              style={{
                position: 'fixed',
                left: host.left + 4 + snap.x,
                top: host.top + 4 + snap.y,
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
