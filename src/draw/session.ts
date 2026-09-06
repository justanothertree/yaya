/**
 * The drawing you have not finished, held across a remount.
 *
 * ⚠️ TURNING CANVAS MODE ON THREW YOUR PICTURE AWAY, and nothing warned you. Paint is mounted in
 * two different places in the tree — inside a canvas window, and as a plain section — so flipping
 * that switch is not a re-render, it is React unmounting one and mounting the other. Every piece
 * of `useState` in the room went with it, including every stroke.
 *
 * paintKit.ts already keeps the tool, colour, width and symmetry across exactly this boundary, so
 * the room already believed some of its state was worth surviving. It just drew the line in a
 * strange place: your brush size came back and your drawing did not.
 *
 * ⚠️ IN MEMORY, NOT localStorage, and that is the deliberate half. A picture is unbounded — the
 * gallery has a packer for putting one on disk on purpose — and quietly writing every stroke to
 * a 5MB quota on every change is how a paint app starts silently failing to save at the exact
 * moment somebody has drawn something worth keeping. This survives navigation and the canvas
 * toggle, which is what was asked for. Surviving a reload is what ⬇ Save is for.
 *
 * ⚠️ Held whole rather than diffed, because a stroke list is already the smallest form of itself:
 * points in 0–1 space, no pixels. Copying the array reference costs nothing.
 */
import type { Stroke } from './strokes'

export type PaintSession = {
  strokes: Stroke[]
  bg: string | null
  /** which layers are hidden, and what they are called — part of the picture, not the tool */
  hidden: number[]
  layerNames: string[]
}

let held: PaintSession | null = null

export const paintSession = {
  /** Remember where the room got to. Called as the picture changes, never on every pointer move. */
  keep(next: PaintSession) {
    held = next
  },
  /** What the room should come back to, or null on a genuinely fresh start. */
  restore(): PaintSession | null {
    return held
  },
  /**
   * Deliberately forgotten — after a clear, or after loading something from the gallery, where
   * carrying the previous picture forward would be a bug rather than a courtesy.
   */
  forget() {
    held = null
  },
}
