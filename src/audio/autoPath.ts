/**
 * A pointer that moves itself.
 *
 * The mouse turned out to be half the fun of the visualiser, which is a problem: it only works
 * while your hand is on it, and it does nothing at all when you are across the room watching. So
 * a virtual pointer can trace a shape instead — the same pointer the modes already react to, just
 * driven by arithmetic rather than a hand.
 *
 * ⚠️ THE REAL MOUSE ALWAYS WINS. When your pointer is over the surface it takes over completely
 * and the path is ignored; move away and the path resumes from where it had got to. A blend of
 * the two would fight you, and freezing the path while you play would make taking your hand away
 * feel like something broke.
 *
 * Shapes are parameterised by one number 0–1 around the figure, so adding another is one entry in
 * the table below and nothing else. Polygons share a single edge-walking implementation, since a
 * triangle and a hexagon differ only in how many corners you divide the perimeter into.
 */

export type PathId =
  | 'off'
  | 'line'
  | 'circle'
  | 'wave'
  | 'figure8'
  | 'triangle'
  | 'square'
  | 'pentagon'
  | 'hexagon'
  | 'star'
  | 'drift'

export const PATHS: Array<[PathId, string]> = [
  ['off', 'Off'],
  ['line', 'Line'],
  ['circle', 'Circle'],
  ['wave', 'Wave'],
  ['figure8', 'Figure 8'],
  ['triangle', 'Triangle'],
  ['square', 'Square'],
  ['pentagon', 'Pentagon'],
  ['hexagon', 'Hexagon'],
  ['star', 'Star'],
  ['drift', 'Drift'],
]

const SIDES: Partial<Record<PathId, number>> = {
  triangle: 3,
  square: 4,
  pentagon: 5,
  hexagon: 6,
}

/**
 * Walk the perimeter of a regular polygon at constant speed.
 *
 * ⚠️ By EDGE, not by angle. Stepping the angle evenly around a polygon races through the corners
 * and crawls along the flats, because a corner is further from the centre than an edge midpoint —
 * the motion visibly stutters at every vertex. Dividing the perimeter into equal edges instead
 * gives a constant pace all the way round, which is what makes it read as a shape being traced
 * rather than a wobble.
 */
function polygon(sides: number, t: number): [number, number] {
  const edge = t * sides
  const i = Math.floor(edge) % sides
  const f = edge - Math.floor(edge)
  const a0 = (i / sides) * Math.PI * 2 - Math.PI / 2
  const a1 = ((i + 1) / sides) * Math.PI * 2 - Math.PI / 2
  return [
    Math.cos(a0) + (Math.cos(a1) - Math.cos(a0)) * f,
    Math.sin(a0) + (Math.sin(a1) - Math.sin(a0)) * f,
  ]
}

/**
 * Where the virtual pointer is, in -1..1 on both axes.
 *
 * Returned unscaled so the caller decides how much of the canvas to use — a path that reached the
 * very edges would spend half its time where several modes have nothing to push.
 */
export function pathPoint(id: PathId, t: number): [number, number] {
  const u = ((t % 1) + 1) % 1
  const a = u * Math.PI * 2
  const sides = SIDES[id]
  if (sides) return polygon(sides, u)
  switch (id) {
    case 'line':
      // back and forth, eased so it slows at the turns instead of snapping round
      return [Math.sin(a), 0]
    case 'circle':
      return [Math.cos(a), Math.sin(a)]
    case 'wave':
      return [Math.sin(a), Math.sin(a * 3) * 0.55]
    case 'figure8':
      // a lemniscate: one loop of x for two of y
      return [Math.sin(a), Math.sin(a * 2) * 0.6]
    case 'star':
      // a five-pointed star is a pentagon walked two vertices at a time
      return polygon(5, (u * 2) % 1)
    case 'drift': {
      // three incommensurable frequencies, so it never repeats and never looks periodic
      return [
        Math.sin(a) * 0.7 + Math.sin(a * 2.37) * 0.3,
        Math.cos(a * 1.61) * 0.7 + Math.sin(a * 3.11) * 0.3,
      ]
    }
    default:
      return [0, 0]
  }
}
