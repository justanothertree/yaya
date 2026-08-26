// Canvas window geometry — the constants the layout is built on, and the edge-snapping maths.
//
// Its own file because CircuitCanvas.tsx exports a component, and react-refresh/only-export-
// components rightly refuses to let a module export both. The useful side effect is that the
// arithmetic below can be exercised without mounting React or faking a pointer.

/** Space between adjacent windows. defaultTile() lays out on it; snapping reproduces it. */
export const GAP = 12

/**
 * How close an edge has to get before it is pulled flush, IN SCREEN PIXELS.
 *
 * ⚠️ Screen, not world. Everything in a drag is world units (`delta / viewRef.current`), so a
 * constant expressed in world units would silently mean something different at every zoom: at
 * 0.5x an 8-unit tolerance is 4 real pixels and nobody can find it, at 2x it is 16 and nobody
 * can escape it. The pull has to feel identical to the hand whatever the zoom, so this is
 * divided by the current scale at the moment it is used, never baked in.
 */
export const SNAP_PX = 8

/**
 * Where a dragged edge wants to land on one axis, or null if nothing is near enough.
 *
 * Four candidates per neighbour, which are two different gestures that happen to share the
 * arithmetic: sitting NEXT TO something (a GAP away, on either side) and LINING UP with it
 * (leading edges level, or trailing edges level). Both are what people mean by "snapping" and
 * they want them at the same time.
 *
 * ⚠️ The gap is GAP, not zero. defaultTile() lays windows out GAP apart, so snapping flush at 0
 * would make a hand-arranged row and a tiled row disagree about what "next to" looks like.
 * Matching it means you can build the tiled layout by hand and land exactly where Tile would.
 *
 * The guide is reported as the NEIGHBOUR's edge — the thing you locked onto — so the line drawn
 * for it runs through the edge that explains the snap.
 *
 * Caller resolves the axes separately: a window near-aligned on x and far away on y should still
 * snap on x, and when both hit it lands on the corner.
 */
export function snapAxis(
  lo: number,
  size: number,
  targets: Array<{ lo: number; hi: number }>,
  tol: number,
): { lo: number; guide: number } | null {
  const near: Array<{ dist: number; lo: number; guide: number }> = []
  for (const t of targets) {
    const candidates: Array<[number, number]> = [
      [t.hi + GAP, t.hi], // sit after it
      [t.lo - GAP - size, t.lo], // sit before it
      [t.lo, t.lo], // leading edges level
      [t.hi - size, t.hi], // trailing edges level
    ]
    for (const [candidate, guide] of candidates) {
      const dist = Math.abs(candidate - lo)
      if (dist <= tol) near.push({ dist, lo: candidate, guide })
    }
  }
  if (near.length === 0) return null
  const best = near.reduce((a, b) => (b.dist < a.dist ? b : a))
  return { lo: best.lo, guide: best.guide }
}
