import { useEffect, useMemo, useRef, useState } from 'react'
import { frameCount, paintDrawing, readDrawing, type Drawing } from '../draw/strokes'

/**
 * Somebody's pictures on their page, one at a time.
 *
 * ⚠️ NOTHING IS HOSTED. A drawing is the strokes that made it, so the visitor's browser draws it —
 * no image file, no upload, no CDN, and no third party told that somebody looked at this page.
 * Same reasoning as the song block, and the same reason both were possible without a byte of
 * storage: the format was chosen for this.
 *
 * ⚠️ It redraws on RESIZE rather than scaling a bitmap, so the picture is sharp in a block a
 * third of the page wide and sharp again full width. That is the whole payoff of coordinates
 * being fractions.
 */

const SHUFFLE_MS = 7000

export function ArtBlock({ cfg }: { cfg: Record<string, unknown> }) {
  const host = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const [i, setI] = useState(0)
  const redraw = useRef<(() => void) | null>(null)

  /**
   * ⚠️ MEMOISED, and it matters far more than it looks.
   *
   * These are rebuilt by parsing cfg.art, so without this every render produced brand new Drawing
   * objects — a new `current` each time. The effect below depends on it, so the ResizeObserver
   * was being torn down and rebuilt on every render, and the frame reset that arrived with
   * animation would have fired on every render too and pinned the animation to frame 0 for good.
   */
  const pieces: Drawing[] = useMemo(
    () => (Array.isArray(cfg.art) ? (cfg.art.map(readDrawing).filter(Boolean) as Drawing[]) : []),
    [cfg.art],
  )
  const shuffle = cfg.shuffle !== false
  const current = pieces[i % Math.max(1, pieces.length)]

  /**
   * ⚠️ A DRAWING WITH FRAMES PLAYS ITSELF, and its own fps is the speed.
   *
   * The speed belongs to the drawing rather than to the block because it is a property of the
   * animation — eight frames of a walk cycle and three frames of a blinking sign want completely
   * different rates, and the person who drew it is the only one who knows which. A block-level
   * speed would be one number wrong for every picture after the first.
   *
   * ⚠️ OFF IF THE VISITOR ASKED FOR LESS MOTION. This is somebody else's page moving on its
   * own in the corner of their eye, which is exactly what prefers-reduced-motion is for. It is
   * checked live rather than once, because the setting can change while the page is open.
   */
  const frames = current ? frameCount(current) : 0
  const [f, setF] = useState(0)
  const frameRef = useRef(0)
  frameRef.current = f
  const [still, setStill] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  )
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const on = () => setStill(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  const plays = cfg.autoplay !== false && !still
  /** back to the first frame when the shuffle moves on, or the next drawing starts mid-stride */
  useEffect(() => setF(0), [i])

  useEffect(() => {
    if (!plays || frames < 2) return
    const fps = Math.max(1, Math.min(24, current?.fps ?? 8))
    const t = window.setInterval(
      () => {
        // ⚠️ same reason as the shuffle above: nobody is watching a background tab
        if (document.visibilityState === 'visible') setF((n) => (n + 1) % frames)
      },
      Math.round(1000 / fps),
    )
    return () => window.clearInterval(t)
  }, [plays, frames, current?.fps])

  /**
   * ⚠️ Paused while the tab is hidden and when there is only one picture. A timer redrawing a
   * canvas every few seconds in a background tab is a battery cost with nobody watching, and a
   * "shuffle" between one picture and itself is just a repaint.
   */
  useEffect(() => {
    if (!shuffle || pieces.length < 2) return
    const tick = () => {
      if (document.visibilityState === 'visible') setI((n) => n + 1)
    }
    const t = window.setInterval(tick, SHUFFLE_MS)
    return () => window.clearInterval(t)
  }, [shuffle, pieces.length])

  useEffect(() => {
    const el = cv.current
    const box = host.current
    if (!el || !box || !current) return
    const ctx = el.getContext('2d')
    if (!ctx) return

    /**
     * ⚠️ THIS BLOCK USED TO GROW UNTIL THE BROWSER GAVE UP, and the loop is worth spelling out
     * because nothing about it looks wrong line by line.
     *
     * A canvas with no CSS size lays out at its `width`/`height` ATTRIBUTES, in CSS pixels. This
     * measured the host, multiplied by devicePixelRatio and wrote that into the attributes — so on
     * a 2x screen the canvas laid out twice as wide as the box it was measured from. The host is a
     * block and grew to fit its child. The ResizeObserver saw the host change, measured it again,
     * and multiplied again. Every pass doubled it. On a phone at 3x it ran away faster.
     *
     * Two things break the cycle, and both are needed:
     *
     *   · the CSS size is set explicitly, so the backing store can be whatever the screen wants
     *     without the layout following it
     *   · the HEIGHT comes from the drawing's own ratio rather than from measuring, so height is
     *     computed from width and never read back
     *
     * Width is then the only thing measured, and nothing this function does can change it.
     */
    let lastW = 0
    const draw = () => {
      const w = Math.round(box.clientWidth)
      if (w < 1) return
      const ratio = current.ratio > 0.05 && current.ratio < 20 ? current.ratio : 0.6
      const h = Math.max(60, Math.round(w * ratio))
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      el.style.width = w + 'px'
      el.style.height = h + 'px'
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr)
        el.height = Math.round(h * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      paintDrawing(ctx, current, w, h, { frame: frameRef.current })
      lastW = w
    }
    draw()
    /* ⚠️ redraw only when the WIDTH actually changed. The observer also fires for the height
       this function just set, and answering that would be the same loop in a politer form. */
    const ro = new ResizeObserver(() => {
      if (Math.round(box.clientWidth) !== lastW) draw()
    })
    ro.observe(box)
    /**
     * ⚠️ HANDED OUT THROUGH A REF so a frame change can repaint WITHOUT re-running this effect.
     * Adding the frame to the dependencies would tear down and rebuild the ResizeObserver on
     * every tick of the animation — a new observer several times a second, for a redraw.
     */
    redraw.current = draw
    return () => {
      redraw.current = null
      ro.disconnect()
    }
  }, [current])

  const redrawOn = f
  useEffect(() => {
    redraw.current?.()
  }, [redrawOn])

  if (!pieces.length) return null

  return (
    <div
      className="card profile-block profile-art"
      ref={host}
      /* the picture's own paper, or the page showing through where it is transparent */
      style={current?.bg ? { background: current.bg } : undefined}
    >
      <canvas ref={cv} aria-label={current?.name ?? 'Drawing'} />
      <span className="profile-art-name muted">
        {current?.name}
        {pieces.length > 1 && (
          <span className="profile-art-dots" aria-hidden>
            {pieces.map((_, n) => (
              <i key={n} className={n === i % pieces.length ? 'is-on' : undefined} />
            ))}
          </span>
        )}
      </span>
    </div>
  )
}
