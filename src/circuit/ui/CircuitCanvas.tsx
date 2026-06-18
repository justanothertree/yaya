// Free canvas — turns the Circuit panes into draggable / resizable floating windows
// (Aero-style edge snapping, minimize / maximize / fit, z-order focus, persisted layout).
// Ported from the standalone's "operating system" mode. Desktop-only.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { showToast } from '../toast'

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

const STORE_KEY = 'circuit_canvas_v3' // v3: full-width canvas surface (re-tile from old layouts)
const GAP = 12

function loadLayout(): Layout | null {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    return raw ? (JSON.parse(raw) as Layout) : null
  } catch {
    return null
  }
}
function saveLayout(l: Layout) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(l))
  } catch {
    /* ignore quota */
  }
}

type Zone = 'max' | 'left' | 'right' | 'tl' | 'tr' | 'bl' | 'br'
type Dir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
const RESIZE_DIRS: Dir[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']
const MIN_W = 240
const MIN_H = 120

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
  onExit,
}: {
  panes: CanvasPane[]
  focusPane?: { id: string; nonce: number } | null
  onExit: () => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const winRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const maxZ = useRef(10)
  const [wins, setWins] = useState<Layout>({})
  const [snap, setSnap] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const drag = useRef<{
    id: string
    sx: number
    sy: number
    ox: number
    oy: number
    zone: Zone | null
  } | null>(null)
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
  const defaultTile = useCallback((): Layout => {
    const b = hostBox()
    const n = panes.length
    const cols = b.w >= 1180 ? 3 : b.w >= 680 ? 2 : 1
    const rows = Math.ceil(n / cols)
    const colW = Math.floor((b.w - (cols - 1) * GAP) / cols)
    const rowH = Math.floor((b.h - (rows - 1) * GAP) / rows)
    const next: Layout = {}
    panes.forEach((p, i) => {
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
  }, [hostBox, panes])

  // ── init: restore saved layout or tile fresh ──
  useLayoutEffect(() => {
    const saved = loadLayout()
    const valid = saved && panes.every((p) => saved[p.id])
    const next = valid ? saved! : defaultTile()
    Object.values(next).forEach((w) => {
      if (w.z > maxZ.current) maxZ.current = w.z
    })
    setWins(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // persist whenever layout settles
  useEffect(() => {
    if (Object.keys(wins).length) saveLayout(wins)
  }, [wins])

  // lock background scroll while the full-width canvas overlay is open
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
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
    drag.current = { id, sx: e.clientX, sy: e.clientY, ox: w.x, oy: w.y, zone: null }
    e.preventDefault()
    window.addEventListener('pointermove', onDragMove)
    window.addEventListener('pointerup', onDragUp)
  }

  const zoneFor = useCallback((e: PointerEvent): Zone | null => {
    const host = hostRef.current
    if (!host) return null
    const h = host.getBoundingClientRect()
    const T = 36
    const C = 90
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
      const nx = Math.max(0, d.ox + (e.clientX - d.sx))
      const ny = Math.max(0, d.oy + (e.clientY - d.sy))
      // move via direct DOM for smoothness; commit to state on drop
      el.style.left = nx + 'px'
      el.style.top = ny + 'px'
      el.style.height = '' // moving cancels max
      const zone = zoneFor(e)
      d.zone = zone
      setSnap(zone ? snapGeom(zone) : null)
    },
    [snapGeom, zoneFor],
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
        const g = snapGeom(d.zone)!
        return {
          ...prev,
          [d.id]: { ...w, ...g, max: d.zone === 'max', prev: { x: w.x, y: w.y, w: w.w, h: w.h } },
        }
      }
      const nx = el ? parseFloat(el.style.left) || w.x : w.x
      const ny = el ? parseFloat(el.style.top) || w.y : w.y
      return { ...prev, [d.id]: { ...w, x: nx, y: ny, max: false } }
    })
    drag.current = null
  }, [onDragMove, snapGeom])

  // ── resize from any edge / corner ──
  const onResizeMove = useCallback((e: PointerEvent) => {
    const r = resz.current
    if (!r) return
    const el = winRefs.current[r.id]
    if (!el) return
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
    // direct DOM for smoothness; commit on release
    el.style.left = x + 'px'
    el.style.top = y + 'px'
    el.style.width = w + 'px'
    el.style.height = h + 'px'
  }, [])

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
    setWins((prev) => {
      const w = prev[id]
      if (w.max && w.prev) return { ...prev, [id]: { ...w, ...w.prev, max: false } }
      const g = snapGeom('max')!
      return { ...prev, [id]: { ...w, ...g, max: true, prev: { x: w.x, y: w.y, w: w.w, h: w.h } } }
    })
    focus(id)
  }
  function fitContent(id: string) {
    const el = winRefs.current[id]
    if (!el) return
    const body = el.querySelector('.cz-body') as HTMLElement | null
    const bar = el.querySelector('.cz-bar') as HTMLElement | null
    if (!body) return
    const h = (bar?.offsetHeight ?? 0) + body.scrollHeight + 4
    setWins((prev) => ({
      ...prev,
      [id]: { ...prev[id], min: false, h: Math.min(Math.max(140, h), 720) },
    }))
    showToast('⤢ Fit to content')
  }
  function tile() {
    maxZ.current = 10
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

  return (
    // Full-width canvas surface: a fixed panel spanning the viewport below the nav,
    // so the "operating system" isn't capped by the page container. Desktop-only
    // (the launcher button is hidden on phones), so mobile keeps the clean tab layout.
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
      {/* control bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
          marginBottom: '0.5rem',
          flexWrap: 'wrap',
          flexShrink: 0,
        }}
      >
        <strong style={{ fontSize: '0.9rem' }}>⛶ Canvas</strong>
        <span className="muted" style={{ fontSize: '0.74rem' }}>
          drag the title bar (snaps at edges) · drag any edge or corner to resize · ⤢ fit · ▢ max ·
          － min
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem' }}>
          <button className="btn" onClick={tile}>
            ⊞ Tile
          </button>
          <button
            className="btn"
            onClick={onExit}
            style={{
              background: 'var(--accent,#7c6af7)',
              color: '#fff',
              borderColor: 'transparent',
            }}
          >
            Done
          </button>
        </span>
      </div>

      {/* window-switcher taskbar: highlights the focused window, dims minimized ones */}
      <div
        style={{
          display: 'flex',
          gap: '0.35rem',
          flexWrap: 'wrap',
          marginBottom: '0.5rem',
          flexShrink: 0,
        }}
      >
        {panes.map((p) => {
          const w = wins[p.id]
          const min = !!w?.min
          const active = p.id === topId
          return (
            <button
              key={p.id}
              onClick={() => onTab(p.id)}
              title={
                min
                  ? `Restore ${p.title}`
                  : active
                    ? `Minimize ${p.title}`
                    : `Bring ${p.title} to front`
              }
              style={{
                ...taskTab,
                background: active
                  ? 'var(--accent, #7c6af7)'
                  : min
                    ? 'transparent'
                    : 'var(--b1, rgba(127,127,127,0.12))',
                color: active ? '#fff' : 'inherit',
                opacity: min ? 0.5 : 1,
                borderColor: active ? 'transparent' : 'var(--border, rgba(127,127,127,0.25))',
              }}
            >
              <span style={{ fontSize: '0.7rem' }}>{min ? '▫' : '▪'}</span>
              {p.title}
            </button>
          )
        })}
      </div>

      {/* canvas surface */}
      <div
        ref={hostRef}
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 0,
          padding: 4,
          overflow: 'auto',
          background:
            'repeating-linear-gradient(45deg, transparent, transparent 11px, rgba(127,127,127,0.025) 11px, rgba(127,127,127,0.025) 12px)',
          borderRadius: 10,
        }}
      >
        {panes.map((p) => {
          const w = wins[p.id]
          if (!w) return null
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
                height: w.min ? undefined : w.h,
                zIndex: w.z,
                display: 'flex',
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
                minHeight: w.min ? 0 : MIN_H,
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
                  borderBottom: w.min ? 'none' : '1px solid var(--b1, rgba(127,127,127,0.15))',
                  cursor: 'grab',
                  userSelect: 'none',
                  flexShrink: 0,
                  touchAction: 'none',
                }}
              >
                <span style={{ fontWeight: 700, fontSize: '0.82rem', flex: 1 }}>{p.title}</span>
                <button
                  className="cz-btn btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    fitContent(p.id)
                  }}
                  title="Fit to content"
                  style={czBtn}
                >
                  ⤢
                </button>
                <button
                  className="cz-btn btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleMax(p.id)
                  }}
                  title={w.max ? 'Restore' : 'Maximize'}
                  style={czBtn}
                >
                  {w.max ? '❐' : '▢'}
                </button>
                <button
                  className="cz-btn btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleMin(p.id)
                  }}
                  title={w.min ? 'Restore' : 'Minimize'}
                  style={czBtn}
                >
                  {w.min ? '＋' : '－'}
                </button>
              </div>
              {/* body */}
              {!w.min && (
                <div className="cz-body" style={{ flex: 1, overflow: 'auto', padding: 12 }}>
                  {p.node}
                </div>
              )}
              {/* resize handles on every edge + corner */}
              {!w.min &&
                !w.max &&
                RESIZE_DIRS.map((dir) => (
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

const taskTab: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.3rem',
  padding: '0.28rem 0.6rem',
  borderRadius: 8,
  border: '1px solid var(--border, rgba(127,127,127,0.25))',
  fontSize: '0.8rem',
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}
