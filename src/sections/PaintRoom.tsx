import { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { KitBar } from '../ui/KitBar'
import { ShadePad } from '../theme/ColorField'
import { loadLastKit, paintKits, saveLastKit, type PaintKit } from '../draw/paintKit'
import {
  NONE,
  RAINBOW,
  TOOLS,
  paintDrawing,
  paintStroke,
  type Drawing,
  type Stroke,
  type Tool,
  isFreehand,
  SYMMETRIES,
  ECHOES,
  frameCount,
  layerCount,
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

/**
 * What you were last drawing with, read ONCE rather than per render.
 *
 * ⚠️ the room used to open at its defaults every single time, so the six controls that
 * decide what a mark looks like had to be set again before every drawing. Read at module load
 * because it is only ever the seed for the initial state; re-reading it later would fight the
 * controls the person is currently using.
 */
const LAST = loadLastKit()

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
  /**
   * ⚠️ LAYERS AND FRAMES ARE ONE FEATURE HERE, because they are one field each on a stroke.
   * A layer decides what is drawn OVER what, a frame decides WHEN — everything else about the
   * room, every tool, undo, the party feed, is untouched by both. See Stroke.l and Stroke.f.
   */
  const [layer, setLayer] = useState(0)
  const [hidden, setHidden] = useState<number[]>([])
  const [layerNames, setLayerNames] = useState<string[]>([])
  /**
   * ⚠️ NULL MEANS "NOT ANIMATING", and that is the default so the room stays a paint
   * program until you ask for more. A stroke drawn while this is null gets no frame at all,
   * which is what makes it show on every frame if you start animating later — the drawing you
   * already had becomes the background of the animation rather than being stranded on frame 0.
   */
  const [frame, setFrame] = useState<number | null>(null)
  const [onion, setOnion] = useState(2)
  const [playing, setPlaying] = useState(false)
  const [fps, setFps] = useState(8)

  /**
   * ⚠️ SELECTING IS NOT A TOOL, and deliberately not in the TOOLS list.
   *
   * Every entry in TOOLS is a kind of STROKE — it is validated against that list on the way in
   * and written into saved files — so putting "select" beside brush and eraser would have added
   * a stroke type that can never be drawn, to a format that travels to other people's machines.
   * It is a mode the room is in, which is what it actually is.
   */
  const [selecting, setSelecting] = useState(false)
  const [sel, setSel] = useState<number[]>([])
  const [clip, setClip] = useState<Stroke[]>([])
  /** the rectangle being dragged, and the move in progress — refs, they change per pointer event */
  const band = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const shove = useRef<{ x: number; y: number } | null>(null)
  const markRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null)

  const [tool, setTool] = useState<Tool>(() => LAST?.tool ?? 'brush')
  const [colour, setColour] = useState(() => LAST?.colour ?? '#22c55e')
  const [alpha, setAlpha] = useState(() => LAST?.alpha ?? 1)
  const [width, setWidth] = useState(() => LAST?.width ?? 0.008)
  /** kaleidoscope segments for strokes drawn from now on — see Stroke.k */
  const [symmetry, setSymmetry] = useState(() => LAST?.symmetry ?? 0)
  /** fading copies trailing each stroke along the way it was drawn — see Stroke.e */
  const [echo, setEcho] = useState(() => LAST?.echo ?? 0)
  /* ⚠️ Stored on CHANGE, not on leaving: a tab closed or crashed never gets an unload handler,
     and losing the setup in exactly the case where you were interrupted is the worst of both. */
  useEffect(() => {
    saveLastKit({ tool, colour, alpha, width, symmetry, echo })
  }, [tool, colour, alpha, width, symmetry, echo])

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
    layers: layerNames.length ? layerNames : undefined,
    fps,
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
    /**
     * ⚠️ The selection is drawn ON THE VIEW, never into `base`. It is not part of the picture,
     * so it must not survive a save, appear in the gallery thumbnail, or be there when somebody
     * else opens the drawing. Anything painted into base is the drawing; this is furniture.
     */
    const box = markRef.current
    if (box) {
      vc.setTransform(dpr, 0, 0, dpr, 0, 0)
      const px = (fx: number) => (fx - off.current.x) * w * scale
      const py = (fy: number) => (fy - off.current.y) * h * scale
      vc.save()
      vc.lineWidth = 1
      vc.setLineDash([5, 4])
      vc.strokeStyle = 'rgba(255,255,255,0.85)'
      vc.strokeRect(px(box.x0), py(box.y0), px(box.x1) - px(box.x0), py(box.y1) - py(box.y0))
      vc.setLineDash([])
      vc.strokeStyle = 'rgba(0,0,0,0.55)'
      vc.strokeRect(
        px(box.x0) - 1,
        py(box.y0) - 1,
        px(box.x1) - px(box.x0) + 2,
        py(box.y1) - py(box.y0) + 2,
      )
      vc.restore()
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
    /**
     * ⚠️ The view is passed EVERY repaint rather than baked into the drawing, because which
     * frame you are on and which layers you have hidden are things about looking, not about the
     * picture. Save the file and none of it travels; it is the same drawing seen from here.
     */
    paintDrawing(bc, drawingRef.current, w, h, {
      frame: frame ?? undefined,
      hidden,
      onion: frame === null || playing ? 0 : onion,
    })
    blit()
  }, [blit, frame, hidden, onion, playing])

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
  /* the outline lives on the view, so a change of selection needs a blit and not a repaint */
  useEffect(() => {
    blit()
  }, [sel, selecting, blit])
  /**
   * ⚠️ A SELECTION IS A LIST OF POSITIONS IN THE STROKE ARRAY, so anything that renumbers that
   * array leaves it pointing at the wrong strokes — undo and redo do, and so does moving to a
   * frame or layer where the caught strokes are not even visible. Dropping it is the honest
   * answer: a selection that silently means something else is how you delete the wrong thing.
   */
  useEffect(() => {
    setSel([])
  }, [frame, layer])
  /**
   * ⚠️ ONE BLIT PER FRAME, NOT ONE PER WHEEL EVENT.
   *
   * A wheel is not one event per notch. A trackpad or a smooth mouse wheel sends a stream of
   * them, ten or twenty inside a single frame, and each one set the scale, re-rendered, and
   * blitted the whole document again. Measured at 2048x1536 into a 2560x1600 view that is about
   * 2.7ms a blit, so a frame's worth of wheel spent 30-50ms redrawing the same picture over and
   * over and only the last one was ever seen. That is the stutter when zooming with a lot on the
   * canvas, and it got worse the more there was to draw.
   *
   * Scheduling on an animation frame collapses the burst into the single blit that was the only
   * one that could reach the screen anyway.
   */
  const blitSoon = useRef(0)
  /**
   * ⚠️ THROUGH A REF, because blit() is rebuilt whenever `scale` changes.
   *
   * Calling the captured blit would draw the scale from the FIRST event of the burst and then
   * skip the other fourteen, since the guard below stops them scheduling anything of their own —
   * the zoom would visibly lag a notch behind the wheel and stop early. The ref always holds the
   * newest one, so the single blit that does run is the one for where the wheel actually ended.
   */
  const latestBlit = useRef(blit)
  latestBlit.current = blit
  useEffect(() => {
    if (blitSoon.current) return
    blitSoon.current = requestAnimationFrame(() => {
      blitSoon.current = 0
      latestBlit.current()
    })
  }, [scale, blit])
  useEffect(
    () => () => {
      if (blitSoon.current) cancelAnimationFrame(blitSoon.current)
    },
    [],
  )

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
  const onWheel = (e: WheelEvent) => {
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

  /**
   * ⚠️ ATTACHED BY HAND, because React's onWheel is PASSIVE and a passive listener is forbidden
   * to preventDefault.
   *
   * The handler above always called preventDefault and it was always ignored, so the wheel
   * zoomed the picture AND scrolled the page under it — the drawing went in while the room went
   * up, which is exactly what it looked like. Nothing about the code said so: the call is there,
   * it just has no effect from a listener React added with { passive: true }.
   *
   * Re-attached when `scale` changes because the handler closes over it; the alternative is a ref
   * shadowing the state, and one listener swap per zoom step is cheaper than that confusion.
   */
  useEffect(() => {
    const el = view.current
    if (!el) return
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale])

  /**
   * ⚠️ PLAYBACK IS A TIMER, not an animation loop, because the frames are not moving pictures —
   * each one is a full repaint of committed strokes, and asking for a redraw sixty times a
   * second to show eight frames would do the work seven times for nothing. Onion skin is turned
   * off while playing above: ghosts are a drawing aid, and during playback they would just be
   * every frame smeared over every other one.
   */
  const animating = frame !== null
  useEffect(() => {
    if (!playing || !animating) return
    const id = window.setInterval(
      () => {
        // ⚠️ counted INSIDE the tick, not captured when the timer was made: add a frame while it
        // is playing and a captured total would loop over the old length and never show it
        const total = frameCount(drawingRef.current)
        if (total < 2) return
        setFrame((f) => ((f ?? 0) + 1) % total)
      },
      Math.round(1000 / Math.max(1, Math.min(24, fps))),
    )
    return () => window.clearInterval(id)
    // ⚠️ `frame` is deliberately not a dependency — it changes on every tick, and depending on it
    // would tear the timer down and build a new one sixty times a minute instead of running one
  }, [playing, animating, fps])

  const layers = layerCount(drawingRef.current)
  const frames = frameCount(drawingRef.current)
  const nameOf = (i: number) => layerNames[i]?.trim() || `Layer ${i + 1}`

  const addLayer = () => {
    if (layers >= 12) return
    setLayerNames((n) => {
      const next = [...n]
      while (next.length < layers) next.push('')
      next.push('')
      return next
    })
    setLayer(layers)
  }
  /**
   * ⚠️ Starting an animation puts you on frame 1, not frame 0.
   *
   * Everything already drawn has no frame, so it shows on all of them — it has become the
   * background. Landing on frame 0 would invite you to draw the first pose ON TOP of that shared
   * background with no way to tell them apart afterwards, whereas frame 1 makes "the bit that
   * stays" and "the bit that moves" two different places from the first stroke.
   */
  const startFrames = () => setFrame((f) => (f === null ? Math.max(1, frames) : null))

  const addFrame = () => {
    const at = Math.max(frames, (frame ?? 0) + 1)
    if (at >= 60) return
    setFrame(at)
  }

  /**
   * Which strokes a rectangle catches.
   *
   * ⚠️ ONLY WHAT YOU CAN SEE. A stroke on a hidden layer, or belonging to another frame, is
   * not offered to the rectangle — dragging a box on frame three and cutting something out of
   * frame one would be indistinguishable from the program losing your work. What is selectable
   * has to be what is on screen.
   *
   * Any point inside counts, rather than the whole stroke: a long line half in the box is
   * something you meant to catch, and requiring containment makes big strokes almost unselectable.
   */
  const inBand = (r: { x0: number; y0: number; x1: number; y1: number }) => {
    const lo = { x: Math.min(r.x0, r.x1), y: Math.min(r.y0, r.y1) }
    const hi = { x: Math.max(r.x0, r.x1), y: Math.max(r.y0, r.y1) }
    const out: number[] = []
    strokes.forEach((k, i) => {
      if (hidden.includes(k.l ?? 0)) return
      if (frame !== null && k.f !== undefined && k.f !== frame) return
      for (let n = 0; n < k.p.length; n += 2) {
        if (k.p[n] >= lo.x && k.p[n] <= hi.x && k.p[n + 1] >= lo.y && k.p[n + 1] <= hi.y) {
          out.push(i)
          return
        }
      }
    })
    return out
  }

  /** the box around the current selection, in 0-1 space, or null */
  const selBox = () => {
    if (!sel.length) return null
    let x0 = 1
    let y0 = 1
    let x1 = 0
    let y1 = 0
    for (const i of sel) {
      const k = strokes[i]
      if (!k) continue
      for (let n = 0; n < k.p.length; n += 2) {
        x0 = Math.min(x0, k.p[n])
        x1 = Math.max(x1, k.p[n])
        y0 = Math.min(y0, k.p[n + 1])
        y1 = Math.max(y1, k.p[n + 1])
      }
    }
    return x1 > x0 || y1 > y0 ? { x0, y0, x1, y1 } : null
  }

  const drop = () => setSel([])
  /* ⚠️ through a ref: blit is a useCallback on [scale] and must not be rebuilt per drag event */
  markRef.current = band.current ?? selBox()
  const selectAll = () => setSel(inBand({ x0: -1, y0: -1, x1: 2, y1: 2 }))
  const copy = () => {
    if (!sel.length) return
    setClip(sel.map((i) => ({ ...strokes[i], p: [...strokes[i].p] })).filter(Boolean))
  }
  const cut = () => {
    if (!sel.length) return
    copy()
    setUndone([])
    setStrokes((prev) => prev.filter((_, i) => !sel.includes(i)))
    drop()
  }
  const erase = () => {
    if (!sel.length) return
    setUndone([])
    setStrokes((prev) => prev.filter((_, i) => !sel.includes(i)))
    drop()
  }
  /**
   * ⚠️ PASTE STAMPS THE LAYER AND FRAME YOU ARE ON NOW, which is what makes this the
   * animation tool rather than only a copy tool. Select a frame, copy, add a frame, paste, and
   * nudge — that is frame-by-frame animation with the previous drawing as the starting point,
   * which is exactly what onion skin is for. Pasting things back onto the frame they came from
   * would have made the obvious workflow impossible.
   *
   * Offset slightly so a paste is visibly a second copy rather than an invisible one exactly on
   * top of the original.
   */
  const paste = () => {
    if (!clip.length) return
    const same = clip.every((k) => (k.f ?? -1) === (frame ?? -1) && (k.l ?? 0) === layer)
    const nudge = same ? 0.02 : 0
    const add = clip.map((k) => ({
      ...k,
      l: layer,
      f: frame ?? undefined,
      p: k.p.map((n) => n + nudge),
    }))
    setUndone([])
    setStrokes((prev) => {
      const at = prev.length
      setSel(add.map((_, i) => at + i))
      return [...prev, ...add]
    })
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
    /**
     * ⚠️ Inside the current selection starts a MOVE, anywhere else starts a new rectangle. It is
     * the behaviour every editor has and the only one that lets you drag something you have just
     * caught without catching something else instead.
     */
    if (selecting) {
      const box = selBox()
      const pad = 0.02
      if (box && x >= box.x0 - pad && x <= box.x1 + pad && y >= box.y0 - pad && y <= box.y1 + pad) {
        shove.current = { x, y }
      } else {
        band.current = { x0: x, y0: y, x1: x, y1: y }
        setSel([])
      }
      preview()
      return
    }
    if (tool === 'fill') {
      commit({ t: 'fill', c: colour, a: alpha, w: width, k: 0, e: 0, p: [x, y] })
      return
    }
    live.current = {
      t: tool,
      c: colour,
      a: alpha,
      w: width,
      k: symmetry,
      e: echo,
      l: layer,
      f: frame ?? undefined,
      p: isFreehand(tool) ? [x, y] : [x, y, x, y],
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
    if (band.current) {
      const [bx, by] = at(e)
      band.current.x1 = bx
      band.current.y1 = by
      preview()
      return
    }
    if (shove.current) {
      const [mx, my] = at(e)
      const dx = mx - shove.current.x
      const dy = my - shove.current.y
      shove.current = { x: mx, y: my }
      // ⚠️ moved in place rather than re-added, so the indices the selection holds stay valid
      setStrokes((prev) =>
        prev.map((k, i) =>
          sel.includes(i) ? { ...k, p: k.p.map((n, j) => n + (j % 2 ? dy : dx)) } : k,
        ),
      )
      return
    }
    const s = live.current
    if (!s) return
    const [x, y] = at(e)
    if (isFreehand(s.t)) {
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
    if (band.current) {
      const r = band.current
      band.current = null
      // a tap rather than a drag clears the selection instead of catching nothing
      const tiny = Math.abs(r.x1 - r.x0) < 0.005 && Math.abs(r.y1 - r.y0) < 0.005
      setSel(tiny ? [] : inBand(r))
      preview()
      return
    }
    if (shove.current) {
      shove.current = null
      setUndone([])
      return
    }
    const s = live.current
    if (!s) return
    commit(s)
  }

  const undo = () => {
    setSel([])
    setStrokes((prev) => {
      if (!prev.length) return prev
      setUndone((u) => [...u, prev[prev.length - 1]])
      return prev.slice(0, -1)
    })
  }
  const redo = () => {
    setSel([])
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
        return
      }
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      if (mod && k === 'c' && sel.length) {
        e.preventDefault()
        copy()
      } else if (mod && k === 'x' && sel.length) {
        e.preventDefault()
        cut()
      } else if (mod && k === 'v' && clip.length) {
        e.preventDefault()
        paste()
      } else if (mod && k === 'a' && selecting) {
        e.preventDefault()
        selectAll()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) {
        e.preventDefault()
        erase()
      } else if (e.key === 'Escape' && sel.length) {
        drop()
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

      <div className="paint-row paint-select">
        <button
          className={'btn' + (selecting ? ' is-on' : '')}
          aria-pressed={selecting}
          onClick={() => {
            setSelecting((v) => !v)
            drop()
          }}
          title="Drag a box round some strokes, then move, copy or cut them"
        >
          ⬚ Select
        </button>
        {selecting && (
          <>
            <button className="btn" onClick={selectAll} title="Select everything you can see">
              All
            </button>
            <span className="muted paint-select-count">
              {sel.length ? `${sel.length} picked` : 'drag a box'}
            </span>
            <button className="btn" onClick={copy} disabled={!sel.length} title="Copy (Ctrl+C)">
              Copy
            </button>
            <button className="btn" onClick={cut} disabled={!sel.length} title="Cut (Ctrl+X)">
              Cut
            </button>
            {/* ⚠️ paste lands on the layer and frame you are on now — see paste() */}
            <button
              className="btn"
              onClick={paste}
              disabled={!clip.length}
              title={
                frame === null
                  ? 'Paste (Ctrl+V)'
                  : 'Paste onto this frame (Ctrl+V) — the way to build the next pose'
              }
            >
              Paste{clip.length ? ` · ${clip.length}` : ''}
            </button>
            <button
              className="btn"
              onClick={erase}
              disabled={!sel.length}
              title="Delete the selection"
            >
              ✕
            </button>
          </>
        )}
      </div>

      <div className="paint-row paint-stack">
        <span className="muted paint-stack-label">Layers</span>
        {Array.from({ length: layers }, (_, i) => layers - 1 - i).map((i) => (
          <span key={i} className={'paint-layer' + (layer === i ? ' is-on' : '')}>
            <button
              className="paint-layer-pick"
              aria-pressed={layer === i}
              onClick={() => setLayer(i)}
              title={`Draw on ${nameOf(i)}`}
            >
              {nameOf(i)}
            </button>
            <button
              className="paint-layer-eye"
              aria-pressed={!hidden.includes(i)}
              onClick={() =>
                setHidden((h) => (h.includes(i) ? h.filter((n) => n !== i) : [...h, i]))
              }
              title={hidden.includes(i) ? 'Show this layer' : 'Hide this layer'}
            >
              {hidden.includes(i) ? '🚫' : '👁'}
            </button>
          </span>
        ))}
        <button
          className="btn"
          onClick={addLayer}
          disabled={layers >= 12}
          title="Add a layer above"
        >
          + layer
        </button>

        <span className="paint-stack-gap" aria-hidden />

        <button
          className={'btn' + (frame !== null ? ' is-on' : '')}
          aria-pressed={frame !== null}
          onClick={startFrames}
          title={
            frame !== null
              ? 'Back to drawing one picture'
              : 'Animate — what you have drawn so far stays behind every frame'
          }
        >
          🎬 Frames
        </button>
        {frame !== null && (
          <>
            <button
              className="btn"
              onClick={() => setFrame((f) => Math.max(0, (f ?? 0) - 1))}
              disabled={(frame ?? 0) <= 0}
              title="Previous frame"
            >
              ◀
            </button>
            <span className="muted paint-frame-at">
              {(frame ?? 0) + 1} / {Math.max(frames, (frame ?? 0) + 1)}
            </span>
            <button
              className="btn"
              onClick={() => setFrame((f) => Math.min(frames - 1, (f ?? 0) + 1))}
              disabled={(frame ?? 0) >= frames - 1}
              title="Next frame"
            >
              ▶
            </button>
            <button className="btn" onClick={addFrame} title="Add a frame after this one">
              + frame
            </button>
            <label className="paint-onion" title="How many earlier frames show through behind">
              <span className="muted">Onion</span>
              <input
                type="range"
                min={0}
                max={4}
                step={1}
                value={onion}
                onChange={(e) => setOnion(Number(e.target.value))}
              />
            </label>
            <button
              className={'btn' + (playing ? ' is-on' : '')}
              aria-pressed={playing}
              onClick={() => setPlaying((v) => !v)}
              disabled={frames < 2}
              title={playing ? 'Stop' : 'Play the animation'}
            >
              {playing ? '⏸' : '▶️'}
            </button>
            <label className="paint-onion" title="Frames a second">
              <span className="muted">{fps}fps</span>
              <input
                type="range"
                min={1}
                max={24}
                step={1}
                value={fps}
                onChange={(e) => setFps(Number(e.target.value))}
              />
            </label>
          </>
        )}
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
          {/* Next to transparency because it is the same kind of thing: a colour any tool can be
              loaded with, rather than a mode the tools have to know about. */}
          <button
            className={'paint-swatch paint-swatch-rainbow' + (colour === RAINBOW ? ' is-on' : '')}
            aria-label="Rainbow"
            aria-pressed={colour === RAINBOW}
            title="Rainbow — the colour moves along as you draw"
            onClick={() => setColour(RAINBOW)}
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
        {/**
         * ⚠️ THE SITE'S OWN PAD, not the operating system's colour dialog.
         *
         * `input type=color` hands the choice to a native window that looks like nothing else
         * here, covers what you are painting, and on some platforms is a modal you have to
         * dismiss before you can see whether the colour was right. The theme already has a pad
         * built for exactly this — hue rail, shade square, live — and a paint room choosing
         * colours is the same job. Reusing it also means one place to improve rather than two
         * that drift.
         */}
        <span className="paint-colour">
          <ShadePad
            label="Colour"
            value={colour === NONE || colour === RAINBOW ? '#22c55e' : colour}
            onChange={setColour}
          />
        </span>
        <span className="paint-colour">
          <ShadePad label="Paper" value={bg ?? '#111111'} onChange={setBg} />
          <button
            className={'btn' + (bg === null ? ' is-on' : '')}
            onClick={() => setBg(null)}
            title="No paper — the picture stays transparent"
          >
            None
          </button>
        </span>
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
        {/* ⚠️ A MODIFIER, not a tool: it applies to whichever of the fifteen tools is selected, so
            one control multiplies the whole toolbar rather than adding one more thing to it. It
            is remembered per stroke, so turning it off later leaves what you already drew. */}
        <label className="inst-pick">
          <span className="muted" title="Mirror what you draw around the middle of the picture">
            Symmetry
          </span>
          <span className="paint-sym-row">
            {SYMMETRIES.map((n) => (
              <button
                key={n}
                className={'btn' + (symmetry === n ? ' is-on' : '')}
                aria-pressed={symmetry === n}
                onClick={() => setSymmetry(n)}
                title={n === 0 ? 'No mirroring' : `${n} mirrored segments`}
              >
                {n === 0 ? 'Off' : n}
              </button>
            ))}
          </span>
        </label>
        {/* the second modifier, and it composes with the first: an echoed mandala is one stroke
            drawn twelve times, twice over, from two numbers in the file */}
        <label className="inst-pick">
          <span className="muted" title="Fading copies trailing the way you drew">
            Echo
          </span>
          <span className="paint-sym-row">
            {ECHOES.map((n) => (
              <button
                key={n}
                className={'btn' + (echo === n ? ' is-on' : '')}
                aria-pressed={echo === n}
                onClick={() => setEcho(n)}
                title={
                  n === 0 ? 'No trailing copies' : `${n} trailing ${n === 1 ? 'copy' : 'copies'}`
                }
              >
                {n === 0 ? 'Off' : n}
              </button>
            ))}
          </span>
        </label>
        {/* ⚠️ SIX CONTROLS ARE ENOUGH TO BE WORTH A NAME. Tool, colour, alpha, width, symmetry
            and echo make a way of drawing rather than a setting, and rebuilding one from memory
            is the thing that stops people trying the others. Saved palettes made the same case
            for three numbers. */}
        <KitBar
          store={paintKits}
          placeholder="Name this brush"
          capture={(name) => ({ name, tool, colour, alpha, width, symmetry, echo })}
          apply={(k: PaintKit) => {
            setTool(k.tool)
            setColour(k.colour)
            setAlpha(k.alpha)
            setWidth(k.width)
            setSymmetry(k.symmetry)
            setEcho(k.echo)
          }}
          describe={(k) =>
            [
              TOOLS.find(([id]) => id === k.tool)?.[2] ?? k.tool,
              k.symmetry ? `${k.symmetry}-fold` : null,
              k.echo ? `echo ${k.echo}` : null,
            ]
              .filter(Boolean)
              .join(' · ')
          }
        />
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
              setSel([])
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
