import { useEffect, useRef } from 'react'
import { paintDrawing, type Drawing } from './strokes'

/**
 * A kept picture, small.
 *
 * ⚠️ THE PICTURE IS THE NAME. A gallery of "cat" and "cat1" is a gallery you have to open twice
 * to tell apart, which is exactly what it looked like on his screen — sixteen rows of a word and
 * a stroke count. Asked for: a menu "that pops up with your art next to".
 *
 * ⚠️ A FIXED BOX WITH THE DRAWING LETTERBOXED IN IT, not a canvas the shape of the drawing. The
 * shape-of-the-drawing version was the first one and it made every row a different height — 33px
 * for a wide picture against 65px for a phone-shaped one — which is the same untidiness as the
 * wrapping row this list was just fixed for. The box is constant, the picture keeps its own
 * proportions inside it, and nothing is stretched.
 *
 * ⚠️ AND THE PAPER GOES BEHIND THE CANVAS, not into it. paintDrawing opens with a clearRect, so a
 * `bg` filled in first is wiped by the first thing that draws — which is why every room puts it
 * behind the surface instead (see the note by Drawing.bg). Without it a white drawing on white
 * paper is a thumbnail of nothing. It sits on the canvas rather than the box so it covers the
 * paper and not the letterbox bars.
 */
export function ArtThumb({ art, w = 56, h = 40 }: { art: Drawing; w?: number; h?: number }) {
  const cv = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = cv.current
    if (!c) return
    const ar = art.ratio > 0.05 && art.ratio < 20 ? art.ratio : 1
    /* contain: as wide as the box allows, unless that makes it taller than the box */
    let iw = w
    let ih = Math.round(w / ar)
    if (ih > h) {
      ih = h
      iw = Math.round(h * ar)
    }
    iw = Math.max(6, iw)
    ih = Math.max(6, ih)
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    c.width = Math.round(iw * dpr)
    c.height = Math.round(ih * dpr)
    c.style.width = `${iw}px`
    c.style.height = `${ih}px`
    c.style.background = art.bg || 'transparent'
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    paintDrawing(ctx, art, iw, ih)
  }, [art, w, h])
  return (
    <span className="art-thumb-box" style={{ width: `${w}px`, height: `${h}px` }} aria-hidden>
      <canvas ref={cv} className="art-thumb" />
    </span>
  )
}
