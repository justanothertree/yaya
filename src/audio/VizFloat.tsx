// The visualiser as one panel floating over whatever page you are on.
//
// ⚠️ ONE PANEL, NOT A MODE. Canvas mode turns the whole site into windows; this is a single thing
// held above the page you were already reading, which you open and close. Wanting to watch the
// visualiser while playing the keys should not mean rearranging the site into a desktop.
//
// ⚠️ IT LIVES IN App, ABOVE THE ROUTER, which is the only place it can live. Rendered inside a
// page it would unmount the moment you left that page — and staying alive when you walk to the
// instrument is the entire feature. Being mounted once also means the audio graph behind it is
// never torn down and rebuilt as you navigate.
//
// ⚠️ CLAMPED ON EVERY RESIZE, not only when dragged. A window remembered at the right edge of a
// wide monitor is a window entirely off screen on a laptop, with its title bar — and therefore
// the only way to move it back — out of reach. So the position is a preference, and the viewport
// gets the final say every time.
import { useCallback, useEffect, useRef, Suspense, lazy } from 'react'
import { MIN_H, MIN_W, useVizFloat, vizFloat } from './floatingViz'

const Visualizer = lazy(() =>
  import('../sections/AudioVisualizer').then((m) => ({ default: m.AudioVisualizer })),
)

/** keep it on screen, and always keep the title bar grabbable */
function clamp(x: number, y: number, w: number, h: number) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const cw = Math.min(w, Math.max(MIN_W, vw - 16))
  const ch = Math.min(h, Math.max(MIN_H, vh - 16))
  return {
    w: cw,
    h: ch,
    x: Math.min(Math.max(8, x), Math.max(8, vw - cw - 8)),
    /* never above 0: the bar has to stay reachable, or the window cannot be moved back */
    y: Math.min(Math.max(8, y), Math.max(8, vh - 44)),
  }
}

export function VizFloat() {
  const st = useVizFloat()
  const box = useRef<HTMLDivElement | null>(null)
  /** what kind of gesture is running, and where it started */
  const drag = useRef<{
    mode: 'move' | 'size'
    px: number
    py: number
    x: number
    y: number
    w: number
    h: number
  } | null>(null)

  /* first open lands it bottom-right rather than at a stored -1 */
  useEffect(() => {
    if (!st.open) return
    if (st.x >= 0 && st.y >= 0) {
      const c = clamp(st.x, st.y, st.w, st.h)
      if (c.x !== st.x || c.y !== st.y || c.w !== st.w || c.h !== st.h) vizFloat.place(c)
      return
    }
    const w = Math.min(st.w, Math.max(MIN_W, window.innerWidth - 16))
    const h = Math.min(st.h, Math.max(MIN_H, window.innerHeight - 16))
    vizFloat.place({ ...clamp(window.innerWidth - w - 20, window.innerHeight - h - 20, w, h) })
  }, [st.open, st.x, st.y, st.w, st.h])

  useEffect(() => {
    if (!st.open) return
    const onResize = () => {
      const s = vizFloat.get()
      vizFloat.place(clamp(s.x, s.y, s.w, s.h))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [st.open])

  const start = useCallback(
    (mode: 'move' | 'size') => (e: React.PointerEvent) => {
      e.preventDefault()
      const s = vizFloat.get()
      drag.current = { mode, px: e.clientX, py: e.clientY, x: s.x, y: s.y, w: s.w, h: s.h }
      ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    },
    [],
  )

  const move = useCallback((e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.px
    const dy = e.clientY - d.py
    if (d.mode === 'move') vizFloat.place(clamp(d.x + dx, d.y + dy, d.w, d.h))
    else vizFloat.place(clamp(d.x, d.y, Math.max(MIN_W, d.w + dx), Math.max(MIN_H, d.h + dy)))
  }, [])

  const end = useCallback(() => {
    if (!drag.current) return
    drag.current = null
    vizFloat.settle()
  }, [])

  if (!st.open) return null

  return (
    <div
      ref={box}
      className="vizwin"
      style={{ left: st.x, top: st.y, width: st.w, height: st.h }}
      role="dialog"
      aria-label="Visualiser"
    >
      {/* ⚠️ touch-action:none in CSS, or a finger drags the PAGE under the window instead */}
      <div
        className="vizwin-bar"
        onPointerDown={start('move')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <span className="vizwin-title">🎚️ Visualiser</span>
        <button
          type="button"
          className="vizwin-x"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => vizFloat.close()}
          aria-label="Close the visualiser window"
          title="Close"
        >
          ✕
        </button>
      </div>
      <div className="vizwin-body">
        <Suspense fallback={<div className="muted vizwin-wait">Loading…</div>}>
          <Visualizer />
        </Suspense>
      </div>
      <div
        className="vizwin-grip"
        onPointerDown={start('size')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        aria-hidden
        title="Drag to resize"
      />
    </div>
  )
}
