import { useCallback, useEffect, useRef, useState } from 'react'
import {
  NONE,
  TOOLS,
  paintDrawing,
  paintStroke,
  type Drawing,
  type Stroke,
  type Tool,
} from '../draw/strokes'

/**
 * A place to draw.
 *
 * ⚠️ THE CANVAS IS NOT THE DOCUMENT. What you have made is the list of strokes; the canvas is a
 * rendering of it that gets thrown away and rebuilt whenever the window changes size. Every
 * feature that matters falls out of that: undo pops a stroke and repaints, resizing reflows the
 * picture instead of stretching a bitmap, and saving to a profile stores a few kilobytes of
 * numbers rather than an image nobody has to host. See draw/strokes.ts.
 *
 * ⚠️ TWO SURFACES, and the second one is what makes dragging a shape feel right. Committed
 * strokes live on `base`; the stroke you are in the middle of is drawn on top of a copy each
 * frame. Without that, dragging a rectangle would either leave a trail of every intermediate
 * rectangle or force a full repaint of the whole drawing on every pointer move — the first is
 * wrong and the second gets slower the more you have drawn.
 */

const SWATCHES = [
  '#000000',
  '#ffffff',
  '#e02020',
  '#f5a623',
  '#f8e71c',
  '#7ed321',
  '#22c55e',
  '#00bcd4',
  '#2563eb',
  '#7c3aed',
  '#e91e63',
  '#8b5a2b',
]

export function PaintRoom() {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<HTMLCanvasElement>(null)
  /** everything committed, rendered once and reused while a stroke is in progress */
  const base = useRef<HTMLCanvasElement | null>(null)
  const size = useRef({ w: 0, h: 0, dpr: 1 })

  const [strokes, setStrokes] = useState<Stroke[]>([])
  /**
   * What sits behind the paint. null is the checkerboard — a genuinely transparent picture.
   *
   * ⚠️ Behind the canvas, not painted into it. Erasing is destination-out, so a background
   * drawn into the picture would be rubbed out along with the line on top of it: you would erase
   * a stroke over a black backdrop and punch a hole through to the page. Behind means the eraser
   * takes away paint and reveals the backdrop, which is what erasing means everywhere else.
   */
  const [bg, setBg] = useState<string | null>(null)
  const [undone, setUndone] = useState<Stroke[]>([])
  const [tool, setTool] = useState<Tool>('brush')
  const [colour, setColour] = useState('#22c55e')
  const [alpha, setAlpha] = useState(1)
  const [width, setWidth] = useState(0.008)
  const live = useRef<Stroke | null>(null)

  /** the drawing, as it would be saved */
  const drawingRef = useRef<Drawing>({
    v: 1,
    name: 'Untitled',
    ratio: 1.5,
    bg: null,
    strokes: [],
  })
  drawingRef.current = {
    v: 1,
    name: 'Untitled',
    ratio: size.current.h ? size.current.w / size.current.h : 1.5,
    bg,
    strokes,
  }

  /** Rebuild `base` from the committed strokes, then show it. */
  const repaint = useCallback(() => {
    const b = base.current
    const v = view.current
    if (!b || !v) return
    const { w, h } = size.current
    if (w < 1 || h < 1) return
    const bc = b.getContext('2d')
    const vc = v.getContext('2d')
    if (!bc || !vc) return
    paintDrawing(bc, drawingRef.current, w, h)
    vc.clearRect(0, 0, w, h)
    vc.drawImage(b, 0, 0, w, h)
  }, [])

  /** Show `base` plus whatever is being drawn right now. */
  const preview = useCallback(() => {
    const b = base.current
    const v = view.current
    if (!b || !v) return
    const { w, h } = size.current
    const vc = v.getContext('2d')
    if (!vc) return
    vc.clearRect(0, 0, w, h)
    vc.drawImage(b, 0, 0, w, h)
    if (live.current) paintStroke(vc, live.current, w, h)
  }, [])

  // ── sizing ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = host.current
    const v = view.current
    if (!el || !v) return
    if (!base.current) base.current = document.createElement('canvas')

    const fit = () => {
      const r = el.getBoundingClientRect()
      if (r.width < 1) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.round(r.width)
      const h = Math.round(r.height)
      if (w === size.current.w && h === size.current.h && dpr === size.current.dpr) return
      size.current = { w, h, dpr }
      for (const c of [v, base.current!]) {
        c.width = Math.round(w * dpr)
        c.height = Math.round(h * dpr)
        c.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0)
      }
      /**
       * ⚠️ The picture is REDRAWN at the new size, not stretched. Coordinates are 0–1, so a
       * resize reflows the artwork the way text reflows — which is only possible because the
       * canvas was never the document.
       */
      repaint()
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    // the observer does not fire in every embedding, and a canvas that missed its size stays blank
    const poll = window.setInterval(fit, 1000)
    return () => {
      ro.disconnect()
      window.clearInterval(poll)
    }
  }, [repaint])

  useEffect(() => {
    repaint()
  }, [strokes, repaint])

  // ── drawing ───────────────────────────────────────────────────────────────
  const at = (e: React.PointerEvent): [number, number] => {
    const r = view.current!.getBoundingClientRect()
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]
  }

  const commit = (s: Stroke) => {
    live.current = null
    setUndone([])
    setStrokes((prev) => [...prev, s])
  }

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault()
    const [x, y] = at(e)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* some inputs cannot be captured; drawing still works, it just stops at the edge */
    }
    if (tool === 'fill') {
      commit({ t: 'fill', c: colour, a: alpha, w: width, p: [x, y] })
      return
    }
    live.current = {
      t: tool,
      c: colour,
      a: alpha,
      w: width,
      p: tool === 'brush' || tool === 'eraser' ? [x, y] : [x, y, x, y],
    }
    preview()
  }

  const onMove = (e: React.PointerEvent) => {
    const s = live.current
    if (!s) return
    const [x, y] = at(e)
    if (s.t === 'brush' || s.t === 'eraser') {
      // ⚠️ skip points closer than a fraction of a percent — a fast drag emits hundreds of
      // events a second and every one of them would be stored forever in the saved file
      const px = s.p[s.p.length - 2]
      const py = s.p[s.p.length - 1]
      if (Math.hypot(x - px, y - py) < 0.002) return
      s.p.push(x, y)
    } else {
      s.p[2] = x
      s.p[3] = y
    }
    preview()
  }

  const onUp = () => {
    const s = live.current
    if (!s) return
    commit(s)
  }

  const undo = () => {
    setStrokes((prev) => {
      if (!prev.length) return prev
      setUndone((u) => [...u, prev[prev.length - 1]])
      return prev.slice(0, -1)
    })
  }
  const redo = () => {
    setUndone((u) => {
      if (!u.length) return u
      setStrokes((prev) => [...prev, u[u.length - 1]])
      return u.slice(0, -1)
    })
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  return (
    <section className="paint-wrap">
      <div className="paint-bar">
        <div className="fx-style-row paint-tools">
          {TOOLS.map(([id, icon, label]) => (
            <button
              key={id}
              className={'fx-style-btn' + (tool === id ? ' is-on' : '')}
              aria-pressed={tool === id}
              onClick={() => setTool(id)}
            >
              <span aria-hidden>{icon}</span>
              <span className="fx-style-label">{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="paint-row">
        <span className="paint-swatches" role="group" aria-label="Colour">
          {/* ⚠️ Transparency sits in the SWATCH ROW, not as a tool. It is a colour you can load
              into anything: brush with it and you rub out, fill with it and you clear a region,
              draw a box in it and you cut an outline. Reaching it only through an eraser tool
              meant the bucket could never be given nothing, so an area could be painted but not
              un-painted. */}
          <button
            className={'paint-swatch paint-swatch-none' + (colour === NONE ? ' is-on' : '')}
            aria-label="Transparent"
            aria-pressed={colour === NONE}
            title="Transparent — paint or fill with nothing"
            onClick={() => setColour(NONE)}
          />
          {SWATCHES.map((c) => (
            <button
              key={c}
              className={'paint-swatch' + (colour === c ? ' is-on' : '')}
              style={{ background: c }}
              aria-label={c}
              aria-pressed={colour === c}
              onClick={() => setColour(c)}
            />
          ))}
        </span>
        <label className="inst-pick">
          <span className="muted">Colour</span>
          <input
            type="color"
            value={colour === NONE ? '#000000' : colour}
            onChange={(e) => setColour(e.target.value)}
          />
        </label>
        <label className="inst-pick">
          <span className="muted" title="What sits behind the paint">
            Paper
          </span>
          <input type="color" value={bg ?? '#000000'} onChange={(e) => setBg(e.target.value)} />
          <button
            className={'btn' + (bg === null ? ' is-on' : '')}
            onClick={() => setBg(null)}
            title="No paper — the picture stays transparent"
          >
            None
          </button>
        </label>
        <label className="appearance-slider">
          {/* Renamed: "Alpha" read as a mode when it is really just how thin the paint is.
              Transparency proper is the swatch above. */}
          <span className="muted" title="How thin the paint is — 100 is solid">
            Opacity
          </span>
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.01}
            value={alpha}
            onChange={(e) => setAlpha(Number(e.target.value))}
          />
          <span className="appearance-slider-val">{Math.round(alpha * 100)}</span>
        </label>
        <label className="appearance-slider">
          <span className="muted">Size</span>
          <input
            type="range"
            min={0.0015}
            max={0.09}
            step={0.0005}
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
          />
          <span className="appearance-slider-val">{Math.round(width * 1000)}</span>
        </label>
        <button className="btn" onClick={undo} disabled={!strokes.length} title="Undo (Ctrl+Z)">
          ↶ Undo
        </button>
        <button
          className="btn"
          onClick={redo}
          disabled={!undone.length}
          title="Redo (Ctrl+Shift+Z)"
        >
          ↷ Redo
        </button>
        <button
          className="btn"
          disabled={!strokes.length}
          onClick={() => {
            if (window.confirm('Clear the whole picture?')) {
              setUndone([])
              setStrokes([])
            }
          }}
        >
          ✕ Clear
        </button>
        <span className="muted paint-count">
          {strokes.length} stroke{strokes.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* ⚠️ The board is transparent, not white. A drawing has no background of its own, which is
          what lets the same picture sit on a light profile and a dark one — so the checkerboard
          behind it is the page telling you where the paint ends and the page begins. */}
      {/* ⚠️ The paper is a BACKDROP, not paint. See `bg` above — this is the same colour a
          profile block will put behind the strokes, so what you draw against is what other
          people will see it against. With no paper the checkerboard shows through, which is how
          you can tell transparent from white. */}
      <div
        className={'paint-board' + (bg ? ' has-paper' : '')}
        ref={host}
        style={bg ? { background: bg } : undefined}
      >
        <canvas
          ref={view}
          className="paint-canvas"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>

      <p className="muted paint-note">
        Drawings are kept as the strokes you made, not as an image — so they redraw sharp at any
        size, undo is free, and one fits in a profile without being hosted anywhere. Nothing here is
        uploaded.
      </p>
    </section>
  )
}
