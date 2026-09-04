import { useEffect, useRef, useState } from 'react'
import { paintDrawing, readDrawing, type Drawing } from '../draw/strokes'

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

  const pieces: Drawing[] = Array.isArray(cfg.art)
    ? (cfg.art.map(readDrawing).filter(Boolean) as Drawing[])
    : []
  const shuffle = cfg.shuffle !== false
  const current = pieces[i % Math.max(1, pieces.length)]

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
      paintDrawing(ctx, current, w, h)
      lastW = w
    }
    draw()
    /* ⚠️ redraw only when the WIDTH actually changed. The observer also fires for the height
       this function just set, and answering that would be the same loop in a politer form. */
    const ro = new ResizeObserver(() => {
      if (Math.round(box.clientWidth) !== lastW) draw()
    })
    ro.observe(box)
    return () => ro.disconnect()
  }, [current])

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
