import { wallOf, type Wall } from './solid'

/**
 * The parts of a map you cannot walk into, painted rather than placed.
 *
 * ⚠️ WHY THIS EXISTS WHEN A WALL ALREADY DOES. A solid stamp blocks the BOX its picture was
 * stamped in, which is right for a brick and wrong for almost anything else: a tree blocks its
 * empty corners, and two trees side by side block the gap between them. Asked for directly —
 * being able to draw the no-walk zones — and it is the honest answer, because where you may
 * walk is a fact about the MAP rather than a property of each thing standing on it.
 *
 * ⚠️ A GRID, NOT SHAPES. Painting wants an eraser, and an eraser is what a list of shapes
 * cannot do: rubbing half of a rectangle away leaves something that is no longer a rectangle.
 * A grid of cells takes paint and takes it back with the same gesture, which is the whole
 * reason a bitmap is the right container here and the wrong one for the ground.
 *
 * ⚠️ AND THE CELLS ARE SQUARE ON SCREEN, which is why the two numbers are not the same. The
 * world is `across × ASPECT` wide against `down` tall — 1.6 times wider than it is high — so a
 * grid that is 1.6 times wider than it is tall has square cells. 192 by 120 puts about three
 * and a half cells across a creature, which is finer than anything you can walk through.
 */
export const ZONE = { w: 192, h: 120 }

const CELLS = ZONE.w * ZONE.h

/**
 * ⚠️ A CEILING ON BOXES, BECAUSE THIS IS READ FROM STORAGE. A painted zone merges into a
 * handful of rectangles and never comes near this; a chequerboard written by hand into
 * localStorage would merge into eleven thousand, and every one of them is checked against every
 * creature several times a frame. The grid is coarsened rather than truncated when it happens,
 * so a hostile map loses precision instead of losing its walls — which is the safe direction:
 * a zone that got bigger stops you, a zone that got smaller lets you through it.
 */
const MAX_WALLS = 800

export const blankZone = () => new Uint8Array(CELLS)

export const zoneIsEmpty = (cells: Uint8Array): boolean => !cells.some((c) => c)

/**
 * The grid as text, one bit per cell.
 *
 * ⚠️ A FIXED-SIZE BITSET RATHER THAN RUN-LENGTHS. Runs are smaller for the maps people
 * actually paint and unbounded for the ones they do not — a fine speckle encodes LARGER than
 * the raw bits. 23040 cells is 2880 bytes is about 3.8KB of base64, flat, whatever is painted,
 * against a map budget of two hundred. A number that cannot surprise you is worth more here
 * than a number that is usually smaller.
 */
export function packZone(cells: Uint8Array): string {
  const bytes = new Uint8Array(Math.ceil(CELLS / 8))
  for (let i = 0; i < CELLS; i++) if (cells[i]) bytes[i >> 3] |= 1 << (i & 7)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  try {
    return btoa(s)
  } catch {
    return ''
  }
}

/**
 * Read one, from anywhere.
 *
 * ⚠️ VALIDATED LIKE EVERY OTHER PART OF A MAP. localStorage is editable by anything on this
 * origin, and this one decides where a creature may stand — so a string of the wrong length, of
 * the wrong alphabet, or of the wrong type all come back as "no zone" rather than as a crash
 * halfway through a park somebody is walking in.
 */
export function readZone(v: unknown): Uint8Array | null {
  if (typeof v !== 'string' || !v) return null
  let raw: string
  try {
    raw = atob(v)
  } catch {
    return null
  }
  if (raw.length !== Math.ceil(CELLS / 8)) return null
  const cells = blankZone()
  let any = false
  for (let i = 0; i < CELLS; i++) {
    const on = (raw.charCodeAt(i >> 3) >> (i & 7)) & 1
    if (on) {
      cells[i] = 1
      any = true
    }
  }
  return any ? cells : null
}

/** Paint a round patch of cells, or rub one out. `r` is in world-x, the same unit `wide` is. */
export function brushZone(cells: Uint8Array, x: number, y: number, r: number, on: boolean) {
  /**
   * ⚠️ THE SAME NUMBER OF CELLS EITHER WAY, which is the payoff for square cells. `r`
   * is a fraction of the world's WIDTH; the same distance downwards is r × the world's aspect
   * as a fraction of its HEIGHT, and ZONE.h × that aspect is exactly ZONE.w. So the radius is
   * r × ZONE.w in both directions and a round brush comes out round. Written in one variable
   * to make it hard to reintroduce the bug where it was not.
   */
  const rc = r * ZONE.w
  const rx = rc
  const ry = rc
  const cx = x * ZONE.w
  const cy = y * ZONE.h
  const x0 = Math.max(0, Math.floor(cx - rx))
  const x1 = Math.min(ZONE.w - 1, Math.ceil(cx + rx))
  const y0 = Math.max(0, Math.floor(cy - ry))
  const y1 = Math.min(ZONE.h - 1, Math.ceil(cy + ry))
  for (let gy = y0; gy <= y1; gy++) {
    for (let gx = x0; gx <= x1; gx++) {
      const dx = gx + 0.5 - cx
      const dy = gy + 0.5 - cy
      if (dx * dx + dy * dy <= rx * rx) cells[gy * ZONE.w + gx] = on ? 1 : 0
    }
  }
}

/**
 * The painted cells as the boxes the park already knows how to be stopped by.
 *
 * ⚠️ GREEDY MAXIMAL RECTANGLES, NOT ONE BOX PER CELL AND NOT ONE PER ROW. A cell each would
 * be twenty-three thousand boxes; a row each turns a round blob into a hundred and twenty, and a
 * map with six blobs on it into seven hundred. Taking the widest run and then pushing it down as
 * far as it stays solid gets a filled rectangle down to ONE box and a circle down to about
 * twenty — which matters because every box is tested against every creature several times a
 * frame, by slideAround resolving overlaps and by canSee tracing sight lines.
 *
 * ⚠️ AND THEY ARE FULL-SIZE BOXES. wallOf shrinks a drawn place to its middle two thirds
 * because the park's landmarks are soft-edged blobs; a cell somebody painted has no soft edge
 * and no margin to give — the whole point of painting it was to say exactly this much.
 */
export function zoneWalls(cells: Uint8Array): Wall[] {
  let grid = cells
  let w = ZONE.w
  let h = ZONE.h
  for (let tries = 0; ; tries++) {
    const out = greedy(grid, w, h)
    if (out.length <= MAX_WALLS || tries >= 3) return out.slice(0, MAX_WALLS)
    /* too fragmented to be a hand-painted zone: halve the grid and try again — see MAX_WALLS */
    const nw = Math.max(1, w >> 1)
    const nh = Math.max(1, h >> 1)
    const next = new Uint8Array(nw * nh)
    for (let y = 0; y < nh; y++)
      for (let x = 0; x < nw; x++) {
        const a = grid[y * 2 * w + x * 2]
        const b = grid[y * 2 * w + Math.min(w - 1, x * 2 + 1)]
        const c = grid[Math.min(h - 1, y * 2 + 1) * w + x * 2]
        const d = grid[Math.min(h - 1, y * 2 + 1) * w + Math.min(w - 1, x * 2 + 1)]
        /* ⚠️ ANY of the four, not a majority: coarsening must never open a gap somebody
           painted shut. A zone that grew stops you; a zone that shrank lets you through. */
        next[y * nw + x] = a || b || c || d ? 1 : 0
      }
    grid = next
    w = nw
    h = nh
  }
}

function greedy(cells: Uint8Array, w: number, h: number): Wall[] {
  const used = new Uint8Array(w * h)
  const out: Wall[] = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!cells[i] || used[i]) continue
      /* as wide as it goes on this row */
      let x1 = x
      while (x1 + 1 < w && cells[y * w + x1 + 1] && !used[y * w + x1 + 1]) x1++
      /* then as far down as the whole span stays solid */
      let y1 = y
      down: while (y1 + 1 < h) {
        for (let xx = x; xx <= x1; xx++) {
          const j = (y1 + 1) * w + xx
          if (!cells[j] || used[j]) break down
        }
        y1++
      }
      for (let yy = y; yy <= y1; yy++) for (let xx = x; xx <= x1; xx++) used[yy * w + xx] = 1
      out.push(wallOf(x / w, y / h, (x1 + 1) / w, (y1 + 1) / h, `zone ${out.length + 1}`, 1))
    }
  }
  return out
}
