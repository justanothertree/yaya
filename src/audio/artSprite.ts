import { frameCount, paintDrawing, type Drawing } from '../draw/strokes'

/**
 * A drawing, rendered once into pictures the visualiser can stamp.
 *
 * ⚠️ BAKED, AND THAT IS THE WHOLE DESIGN. Replaying strokes is what costs — the same measurement
 * that found aurora at 39ms found that rasterising paths, not compositing, is where a frame goes.
 * A swarm redrawing a hundred-stroke picture forty times a frame would be hopeless, while forty
 * drawImage calls of a ready-made bitmap is nothing. So the strokes are rasterised once, here,
 * and every frame after that is a blit.
 *
 * ⚠️ ONE CANVAS PER ANIMATION FRAME, so a drawing made in the paint room's frame editor keeps
 * being an animation when it gets here — the sprite is a strip, and a mode picks which cell to
 * stamp. A flat drawing is simply a strip of one, so no mode needs to know the difference.
 */
export type Sprite = {
  cells: HTMLCanvasElement[]
  /** height as a multiple of width, so a mode can size it without measuring */
  ratio: number
  /** what it was baked at, so the caller can tell when it is worth doing again */
  px: number
}

/**
 * ⚠️ Baked at a size derived from the canvas rather than a fixed one. Too small and a shape used
 * as a centrepiece is visibly soft on a retina fullscreen; too big and a swarm is stamping
 * megapixel bitmaps to draw thumbnails. Clamped at both ends because neither a tiny window nor a
 * wall display should decide this on its own.
 */
export const bakeSize = (w: number, h: number): number =>
  Math.round(Math.max(128, Math.min(640, Math.min(w, h) * 0.55)))

export function bakeSprite(d: Drawing, px: number): Sprite | null {
  const ratio = d.ratio > 0.05 && d.ratio < 20 ? d.ratio : 1
  const w = Math.max(8, Math.round(px))
  const h = Math.max(8, Math.round(px * ratio))
  const frames = Math.max(1, frameCount(d))
  const cells: HTMLCanvasElement[] = []
  for (let i = 0; i < frames; i++) {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    if (!ctx) return null
    /**
     * ⚠️ The background is deliberately NOT painted. A drawing's bg belongs behind it on a page;
     * baking it in would give every stamp an opaque rectangle and turn a swarm into confetti of
     * little cards. The strokes alone are the shape.
     */
    paintDrawing(ctx, d, w, h, { frame: i })
    cells.push(c)
  }
  return { cells, ratio, px: w }
}
