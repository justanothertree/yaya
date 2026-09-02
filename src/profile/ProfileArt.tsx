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

    const draw = () => {
      const r = box.getBoundingClientRect()
      if (r.width < 1) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.round(r.width)
      const h = Math.round(r.height)
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr)
        el.height = Math.round(h * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      paintDrawing(ctx, current, w, h)
    }
    draw()
    const ro = new ResizeObserver(draw)
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
