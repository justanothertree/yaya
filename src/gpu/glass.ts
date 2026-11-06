/**
 * The arithmetic of the Lab's stained glass: lead lines drawn with a finger cut a window into panes,
 * a tap fills a pane with coloured glass, and the sun throws the window's colours across the floor.
 *
 * ⚠️ THE PANES ARE FOUND BY THE GPU, WHATEVER SHAPE YOU DRAW. A tap must fill exactly the pane it
 * lands in — everything the lead encloses, and nothing past it — and the lead is wherever a finger
 * put it. That is connected-component labelling: every cell of glass starts as its own label, and
 * each pass every cell takes the smallest label among itself and its four neighbours (lead stops
 * it), then JUMPS — takes the label its new label has — so a label crosses a pane in a few dozen
 * passes rather than one cell a pass. When nothing changes, every pane is one label, and a fill
 * colours every cell whose label is the tapped cell's. `labelPass` is that pass; glass.test.ts holds
 * it to a plain flood fill, and counts the passes a spiral needs.
 */

/** Hand-packed to match `struct Glass` — glass.test.ts lays the struct out from the shader. */
export const GLASS = {
  size: 0,
  grid: 8,
  sun: 16,
  tap: 24,
  colour: 32,
  dabs: 48,
  brush: 52,
  floor: 56,
  bytes: 64,
} as const

/** the window's longer side, in cells */
export const LONG = 320
/** a label for lead: larger than any cell's */
export const LEAD = 0xffffffff
/** label passes a frame while the panes are being found */
export const PASSES = 32

export type Grid = { w: number; h: number; lead: Uint8Array }

/** every cell its own label, lead none */
export function freshLabels(g: Grid): Uint32Array {
  const l = new Uint32Array(g.w * g.h)
  for (let i = 0; i < l.length; i++) l[i] = g.lead[i] ? LEAD : i
  return l
}

/**
 * One pass — mirrored in glass.wgsl's `label`: each glass cell takes the least of its own label and
 * its four glass neighbours', then the label that label has. Returns the new labels and whether
 * anything changed.
 */
export function labelPass(g: Grid, l: Uint32Array): { next: Uint32Array; changed: boolean } {
  const next = new Uint32Array(l.length)
  let changed = false
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      const i = y * g.w + x
      if (g.lead[i]) {
        next[i] = LEAD
        continue
      }
      let m = l[i]
      if (x > 0 && !g.lead[i - 1]) m = Math.min(m, l[i - 1])
      if (x < g.w - 1 && !g.lead[i + 1]) m = Math.min(m, l[i + 1])
      if (y > 0 && !g.lead[i - g.w]) m = Math.min(m, l[i - g.w])
      if (y < g.h - 1 && !g.lead[i + g.w]) m = Math.min(m, l[i + g.w])
      // the jump: a cell's label is itself a cell, whose label is no larger
      m = Math.min(m, l[m])
      next[i] = m
      if (m !== l[i]) changed = true
    }
  return { next, changed }
}

/** passes until nothing changes, and the labels then */
export function labelAll(g: Grid, limit = 10000): { labels: Uint32Array; passes: number } {
  let l = freshLabels(g)
  for (let p = 1; p <= limit; p++) {
    const r = labelPass(g, l)
    l = r.next
    if (!r.changed) return { labels: l, passes: p }
  }
  return { labels: l, passes: limit }
}

export type Rgb = readonly [number, number, number]

/** the glass, in the colours old windows are made of */
export const COLOURS: Record<string, { name: string; rgb: Rgb }> = {
  ruby: { name: 'Ruby', rgb: [0.78, 0.08, 0.14] },
  amber: { name: 'Amber', rgb: [0.95, 0.6, 0.1] },
  gold: { name: 'Gold', rgb: [0.98, 0.85, 0.3] },
  emerald: { name: 'Emerald', rgb: [0.1, 0.6, 0.3] },
  cobalt: { name: 'Cobalt', rgb: [0.1, 0.25, 0.85] },
  violet: { name: 'Violet', rgb: [0.45, 0.15, 0.65] },
  sky: { name: 'Sky', rgb: [0.45, 0.75, 0.95] },
  clear: { name: 'Clear', rgb: [0.88, 0.9, 0.86] },
}
export type ColourId = keyof typeof COLOURS
export const COLOUR_IDS = Object.keys(COLOURS) as ColourId[]

export const TOOLS = { fill: '🎨 Fill', lead: '✏️ Lead', erase: '🧽 Erase', sun: '☀️ Sun' } as const
export type Tool = keyof typeof TOOLS

/** the window for a canvas: LONG cells along its longer side */
export const gridFor = (w: number, h: number): [number, number] =>
  w >= h
    ? [LONG, Math.max(60, Math.round((LONG * h) / w))]
    : [Math.max(60, Math.round((LONG * w) / h)), LONG]

/**
 * A rose window to start with: rings and spokes of lead round the middle, a border, and a few panes
 * already glazed — returned as lead, and as the colour (index into COLOUR_IDS, or −1) of a cell in
 * each pane that is glazed.
 */
export function roseWindow(
  w: number,
  h: number,
): { lead: Uint8Array; glazed: [number, number, number][] } {
  const lead = new Uint8Array(w * h)
  const cx = w / 2
  const cy = h / 2
  const R = Math.min(w, h) * 0.46
  const put = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const px = Math.round(x) + dx
        const py = Math.round(y) + dy
        if (px >= 0 && py >= 0 && px < w && py < h) lead[py * w + px] = 1
      }
  }
  for (const r of [R * 0.22, R * 0.55, R])
    for (let a = 0; a < Math.PI * 2; a += 0.5 / r) put(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
  for (let k = 0; k < 12; k++) {
    const a = (k * Math.PI) / 6
    for (let t = R * 0.22; t <= R; t += 0.7) put(cx + Math.cos(a) * t, cy + Math.sin(a) * t)
  }
  // petals between the inner rings, every other spoke
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3 + Math.PI / 6
    const px = cx + Math.cos(a) * R * 0.77
    const py = cy + Math.sin(a) * R * 0.77
    for (let b = 0; b < Math.PI * 2; b += 0.08)
      put(px + Math.cos(b) * R * 0.11, py + Math.sin(b) * R * 0.11)
  }
  for (let x = 0; x < w; x++) {
    put(x, 1)
    put(x, h - 2)
  }
  for (let y = 0; y < h; y++) {
    put(1, y)
    put(w - 2, y)
  }
  const glazed: [number, number, number][] = [[cx, cy, 2]]
  for (let k = 0; k < 12; k++) {
    const a = (k * Math.PI) / 6 + Math.PI / 12
    glazed.push([cx + Math.cos(a) * R * 0.4, cy + Math.sin(a) * R * 0.4, k % 2 ? 0 : 4])
    glazed.push([cx + Math.cos(a) * R * 0.88, cy + Math.sin(a) * R * 0.88, [3, 5, 1, 6][k % 4]])
  }
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3 + Math.PI / 6
    glazed.push([cx + Math.cos(a) * R * 0.77, cy + Math.sin(a) * R * 0.77, 2])
  }
  return { lead, glazed }
}

export type GlassFrame = {
  w: number
  h: number
  grid: readonly [number, number]
  /** where the sun is: across (−1..1) and how high (0..1) */
  sun: readonly [number, number]
  /** a tap to fill: the cell, or null */
  tap: readonly [number, number] | null
  colour: Rgb
  dabs: number
  brush: number
  /** how much of the canvas, from the bottom, is the floor the light falls on */
  floor: number
}

export function packGlass(p: GlassFrame, into = new ArrayBuffer(GLASS.bytes)) {
  const u = new Uint32Array(into)
  const i = new Int32Array(into)
  const f = new Float32Array(into)
  u[0] = p.w
  u[1] = p.h
  u[GLASS.grid / 4] = p.grid[0]
  u[GLASS.grid / 4 + 1] = p.grid[1]
  f.set(p.sun, GLASS.sun / 4)
  i[GLASS.tap / 4] = p.tap ? Math.floor(p.tap[0]) : -1
  i[GLASS.tap / 4 + 1] = p.tap ? Math.floor(p.tap[1]) : -1
  f.set([...p.colour, 1], GLASS.colour / 4)
  u[GLASS.dabs / 4] = p.dabs
  f[GLASS.brush / 4] = p.brush
  f[GLASS.floor / 4] = p.floor
  return into
}
