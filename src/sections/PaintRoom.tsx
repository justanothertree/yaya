import { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  NONE,
  TOOLS,
  paintDrawing,
  paintStroke,
  type Drawing,
  type Stroke,
  type Tool,
} from '../draw/strokes'
import { InCanvasWindow } from '../circuit/ui/canvasContext'
import { gallery, removeArt, saveArt, subscribeGallery, type Art } from '../draw/gallery'
import { drawParty } from '../party/draw'
import { useVoiceSession } from '../voice/useVoiceSession'

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
  const { inWindow } = useContext(InCanvasWindow)

  /**
   * The view: how far in, and where.
   *
   * ⚠️ ZOOM IS A VIEW, NOT AN EDIT. Nothing about the drawing changes — `scale` and the offset
   * only decide which part of the 0–1 space the screen is showing. That is only possible because
   * strokes are stored in fractions rather than pixels, and it is why zooming in gives you a
   * genuinely sharper line instead of a magnified one: the stroke is re-rendered at the new size
   * rather than blown up.
   */
  const [scale, setScale] = useState(1)
  const off = useRef({ x: 0, y: 0 })
  const pan = useRef<{ x: number; y: number } | null>(null)
  const [undone, setUndone] = useState<Stroke[]>([])
  const [tool, setTool] = useState<Tool>('brush')
  const [colour, setColour] = useState('#22c55e')
  const [alpha, setAlpha] = useState(1)
  const [width, setWidth] = useState(0.008)
  const live = useRef<Stroke | null>(null)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const saved = useSyncExternalStore(subscribeGallery, gallery, gallery)
  const call = useVoiceSession()
  const party = useSyncExternalStore(drawParty.subscribe, drawParty.getState, drawParty.getState)
  const [note, setNote] = useState<string | null>(null)

  /**
   * Somebody else's stroke.
   *
   * ⚠️ It goes into the SAME list as your own, so it is undoable, savable and part of the
   * picture exactly like anything you drew. Keeping other people's marks in a separate layer
   * would mean two pictures that only look like one, and a save that quietly dropped half of what
   * is on screen.
   */
  useEffect(() => drawParty.start(), [])
  useEffect(() => {
    drawParty.setHandler((s) => setStrokes((prev) => [...prev, s]))
    return () => drawParty.setHandler(null)
  }, [])
  useEffect(() => () => drawParty.setOn(false), [])

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

  /**
   * Put `base` on screen, cropped to whatever the view is showing.
   *
   * ⚠️ `base` is ALWAYS rendered unzoomed, at the document's own resolution, and the zoom is
   * applied only when blitting it here. That is not an optimisation — it is what keeps the fill
   * bucket honest. A flood fill reads the pixels that are actually on a canvas, so computing one
   * against a zoomed view would fill only what happened to be visible and give a different
   * result at every zoom level. Filling against the unzoomed document means a fill is the same
   * fill however far in you were when you asked for it.
   */
  const blit = useCallback(() => {
    const b = base.current
    const v = view.current
    if (!b || !v) return
    const { w, h, dpr } = size.current
    const vc = v.getContext('2d')
    if (!vc) return
    vc.setTransform(1, 0, 0, 1, 0, 0)
    vc.clearRect(0, 0, v.width, v.height)
    vc.imageSmoothingEnabled = true
    const sw = b.width / scale
    const sh = b.height / scale
    vc.drawImage(
      b,
      off.current.x * b.width,
      off.current.y * b.height,
      sw,
      sh,
      0,
      0,
      v.width,
      v.height,
    )
    if (live.current) {
      // the stroke in progress is drawn straight onto the view, so it needs the same mapping
      vc.setTransform(
        dpr * scale,
        0,
        0,
        dpr * scale,
        -off.current.x * w * dpr * scale,
        -off.current.y * h * dpr * scale,
      )
      paintStroke(vc, live.current, w, h)
    }
    vc.setTransform(dpr, 0, 0, dpr, 0, 0)
  }, [scale])

  /** Rebuild `base` from the committed strokes, then show it. */
  const repaint = useCallback(() => {
    const b = base.current
    const v = view.current
    if (!b || !v) return
    const { w, h } = size.current
    if (w < 1 || h < 1) return
    const bc = b.getContext('2d')
    if (!bc) return
    paintDrawing(bc, drawingRef.current, w, h)
    blit()
  }, [blit])

  const preview = blit

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
  useEffect(() => {
    blit()
  }, [scale, blit])

  // ── drawing ───────────────────────────────────────────────────────────────
  /**
   * Where the pointer is IN THE DRAWING, not on the screen.
   *
   * ⚠️ Through the view, or every stroke would land where the cursor is rather than where you
   * are pointing the moment you zoom in. The screen fraction is divided by the scale and shifted
   * by the offset, which is the inverse of what blit() does to get the picture on screen.
   */
  const at = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = view.current!.getBoundingClientRect()
    return [
      off.current.x + (e.clientX - r.left) / r.width / scale,
      off.current.y + (e.clientY - r.top) / r.height / scale,
    ]
  }

  /** Keep the view over the picture: at 1x it is exactly the picture, further in it can roam. */
  const clampOffset = (nextScale: number) => {
    const span = 1 - 1 / nextScale
    off.current.x = Math.max(0, Math.min(span, off.current.x))
    off.current.y = Math.max(0, Math.min(span, off.current.y))
  }

  /**
   * ⚠️ Zoom toward the POINTER, not the middle.
   *
   * Zooming about the centre means the thing you are looking at slides away as you go in, and you
   * spend the whole time chasing it. Keeping the point under the cursor fixed is what makes a
   * wheel feel like a magnifying glass rather than a slider.
   */
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const r = view.current!.getBoundingClientRect()
    const fx = (e.clientX - r.left) / r.width
    const fy = (e.clientY - r.top) / r.height
    const before = at(e)
    const next = Math.max(1, Math.min(12, scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
    off.current.x = before[0] - fx / next
    off.current.y = before[1] - fy / next
    clampOffset(next)
    setScale(next)
  }

  const commit = (s: Stroke) => {
    live.current = null
    setUndone([])
    setStrokes((prev) => [...prev, s])
    // ⚠️ sent on COMPLETION, never while dragging — see party/draw.ts for why a half-drawn
    // stroke is not something the room should be shown
    drawParty.send(s)
  }

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault()
    // middle button, or any button while zoomed out of reach, drags the picture around
    if (e.button === 1 || e.button === 2) {
      pan.current = { x: e.clientX, y: e.clientY }
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* nothing to capture */
      }
      return
    }
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
    if (pan.current) {
      const r = view.current!.getBoundingClientRect()
      off.current.x -= (e.clientX - pan.current.x) / r.width / scale
      off.current.y -= (e.clientY - pan.current.y) / r.height / scale
      pan.current = { x: e.clientX, y: e.clientY }
      clampOffset(scale)
      blit()
      return
    }
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
    pan.current = null
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
    /* ⚠️ In a canvas window the board takes the height it is GIVEN. Outside one it has to pick
       a height, and vh is the only sensible guess — but inside a window that guess ignored the
       window, so dragging the bottom edge made it wider and never taller. */
    <section className={'paint-wrap' + (inWindow ? ' is-inwindow' : '')}>
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
        <label className="appearance-slider">
          <span className="muted" title="Or spin the wheel over the picture">
            Zoom
          </span>
          <input
            type="range"
            min={1}
            max={12}
            step={0.1}
            value={scale}
            onChange={(e) => {
              const next = Number(e.target.value)
              clampOffset(next)
              setScale(next)
            }}
          />
          <span className="appearance-slider-val">{scale.toFixed(1)}×</span>
        </label>
        <button
          className="btn"
          disabled={scale === 1 && !off.current.x && !off.current.y}
          onClick={() => {
            off.current = { x: 0, y: 0 }
            setScale(1)
          }}
          title="Back to the whole picture"
        >
          ⤢ Fit
        </button>
        <button
          className={'btn' + (galleryOpen ? ' is-on' : '')}
          aria-pressed={galleryOpen}
          onClick={() => setGalleryOpen((v) => !v)}
          title="Pictures you have kept"
        >
          🖼 Gallery{saved.length ? ` · ${saved.length}` : ''}
        </button>
        <button
          className="btn"
          disabled={!strokes.length}
          onClick={() => {
            const name = window.prompt('Name this picture', '')?.trim() ?? ''
            if (!name) return
            const item = saveArt({ ...drawingRef.current, name })
            setNote(item ? `Kept “${item.name}”` : 'Nothing to keep yet.')
            window.setTimeout(() => setNote(null), 4000)
            if (item) setGalleryOpen(true)
          }}
        >
          ⬇ Keep
        </button>
        {call.inCall && (
          <button
            className={'btn' + (party.on ? ' is-on' : '')}
            aria-pressed={party.on}
            onClick={() => drawParty.setOn(!party.on)}
            title={
              party.on
                ? 'Stop sending your strokes to the call'
                : 'Draw together — finished strokes go to everyone in the call'
            }
          >
            {party.on ? '◉ Drawing together' : '◎ Draw together'}
          </button>
        )}
        {party.on && Object.keys(party.peers).length > 0 && (
          <span className="muted paint-peers">with {Object.values(party.peers).join(', ')}</span>
        )}
        <span className="muted paint-count">
          {strokes.length} stroke{strokes.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* ⚠️ The board is transparent, not white. A drawing has no background of its own, which is
          what lets the same picture sit on a light profile and a dark one — so the checkerboard
          behind it is the page telling you where the paint ends and the page begins. */}
      {note && (
        <p className="muted paint-note" role="status">
          {note}
        </p>
      )}

      {galleryOpen && (
        <div className="paint-row paint-gallery">
          {!saved.length ? (
            <span className="muted">
              Nothing kept yet. Draw something, then press <strong>Keep</strong>.
            </span>
          ) : (
            <ul className="paint-gallery-list">
              {saved.map((a: Art) => (
                <li key={a.id}>
                  <span className="paint-gallery-name">🖼 {a.name}</span>
                  <span className="muted paint-gallery-meta">{a.art.strokes.length} strokes</span>
                  <button
                    className="btn"
                    onClick={() => {
                      setUndone([])
                      setBg(a.art.bg)
                      setStrokes(a.art.strokes)
                    }}
                    title="Open this, replacing what is on the board"
                  >
                    Open
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      if (window.confirm(`Delete “${a.name}”?`)) removeArt(a.id)
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

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
          onWheel={onWheel}
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
