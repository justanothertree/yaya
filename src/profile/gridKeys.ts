import { isTypingTarget, type KeyTarget } from '../nav/typing'

/**
 * What a key press inside the profile editor's block grid means, decided without a DOM.
 *
 * ProfileBlocks.tsx used to decide this inline, and its "is somebody typing?" test was its own
 * list — INPUT, TEXTAREA, contenteditable — which is exactly the list that let ArrowRight on a
 * dropdown walk the whole site off the page (fixed in #227 by `isTypingTarget`). Here it would
 * have been quieter and worse: an arrow on a `<select>` inside a block would have moved the
 * selection to the next block instead of changing the option, and Backspace would have DELETED
 * the block. The editor renders the real blocks, so whatever a block puts in front of somebody
 * is inside this grid.
 *
 * Arrows go one step along the saved order (see `ARROW_STEP` below for why it is
 * one-dimensional); Shift moves the block rather than the selection; Alt is left alone because
 * Alt+Left/Right are the browser's Back and Forward.
 */
export type GridKey = { kind: 'step'; step: -1 | 1; move: boolean } | { kind: 'remove' } | null

export type GridKeyEvent = {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  target: KeyTarget
}

/**
 * Every arrow, mapped to one step along the page's reading order.
 *
 * ⚠️ ALL FOUR MEAN THE SAME MOVE, because the grid is not always a grid. At Column width the
 * page is one block per row and left/right is the wrong word for what you want; at Wide it is
 * six across and up/down is. Both are "one step along the order the blocks are saved in", which
 * is the only order that exists — a 2D walk would need rows, and blocks of three different
 * widths do not sit in rows you could walk.
 */
export const ARROW_STEP: Record<string, -1 | 1 | undefined> = {
  ArrowLeft: -1,
  ArrowUp: -1,
  ArrowRight: 1,
  ArrowDown: 1,
}

export function gridKey(e: GridKeyEvent): GridKey {
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  if (isTypingTarget(e.target)) return null
  const step = ARROW_STEP[e.key]
  if (step) return { kind: 'step', step, move: !!e.shiftKey }
  if (e.key === 'Delete' || e.key === 'Backspace') return { kind: 'remove' }
  return null
}
