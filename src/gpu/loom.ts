/**
 * The arithmetic of the Lab's loom: a weaving draft — which shaft each warp end is threaded
 * through, which shafts each treadle lifts, which treadle each pick presses — and the cloth it
 * makes.
 *
 * ⚠️ THE DRAFT IS THE WHOLE CLOTH, AND THE CLOTH IS ONE LOOKUP A CELL. Where warp end `j` crosses
 * pick `i`, the warp is on top exactly when the treadle that pick presses lifts the shaft that end
 * is threaded through: bit `threading[j]` of `tieup[treadling[i]]`. That is the drawdown weavers
 * draw by hand on squared paper; here every pixel of the cloth works out its own cell, its two
 * neighbours along each thread (to know where the thread dives under), and — when asked — how long
 * the float it is part of runs, which is what makes a cloth weak. loom.test.ts holds these to the
 * drafts weavers know: plain weave is a checkerboard, a twill is a diagonal, a satin has one
 * crossing a row.
 */

export const SHAFTS = 8
export const TREADLES = 8
export const MAX_REPEAT = 64
/** floats are counted this far each way and no further */
export const MAX_FLOAT = 16

export type RGB = readonly [number, number, number]

export type Draft = {
  /** per warp end, the shaft it is threaded through */
  threading: number[]
  /** per pick, the treadle pressed */
  treadling: number[]
  /** per treadle, the shafts it lifts, a bit each */
  tieup: number[]
  /** per warp end and per pick, which of `colours` the thread is */
  warp: number[]
  weft: number[]
  colours: RGB[]
}

/** Hand-packed to match `struct Loom` — loom.test.ts lays the struct out from the shader. */
export const LOOM = {
  size: 0,
  cell: 8,
  woven: 12,
  first: 16,
  floats: 20,
  light: 24,
  bytes: 32,
} as const

/** where each part of the draft starts in the storage buffer, in u32s — the shader's consts */
export const AT = { threading: 0, treadling: 64, warp: 128, weft: 192, tieup: 256, words: 264 }

const mod = (a: number, n: number) => ((a % n) + n) % n

export const ends = (d: Draft) => d.threading.length
export const picks = (d: Draft) => d.treadling.length

/** is the warp on top where end `end` crosses pick `pick`? Both repeat. */
export function warpUp(d: Draft, pick: number, end: number): boolean {
  const lifts = d.tieup[d.treadling[mod(pick, picks(d))]]
  return ((lifts >> d.threading[mod(end, ends(d))]) & 1) === 1
}

/** the drawdown: 1 where the warp is on top, a row a pick */
export function drawdown(d: Draft, rows = picks(d), cols = ends(d)): Uint8Array {
  const out = new Uint8Array(rows * cols)
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) out[i * cols + j] = +warpUp(d, i, j)
  return out
}

/**
 * The cell's own float: how many cells the thread on top runs over without going under — along
 * the warp if the warp is on top, along the pick if the weft is. Counted up to MAX_FLOAT each way.
 */
export function floatAt(d: Draft, pick: number, end: number): number {
  const up = warpUp(d, pick, end)
  let n = 1
  if (up) {
    for (let k = 1; k <= MAX_FLOAT && warpUp(d, pick - k, end); k++) n++
    for (let k = 1; k <= MAX_FLOAT && warpUp(d, pick + k, end); k++) n++
  } else {
    for (let k = 1; k <= MAX_FLOAT && !warpUp(d, pick, end - k); k++) n++
    for (let k = 1; k <= MAX_FLOAT && !warpUp(d, pick, end + k); k++) n++
  }
  return n
}

/** the longest float anywhere in one repeat */
export function longestFloat(d: Draft): number {
  let most = 0
  for (let i = 0; i < picks(d); i++)
    for (let j = 0; j < ends(d); j++) most = Math.max(most, floatAt(d, i, j))
  return most
}

/**
 * A tap on the cloth: the one bit of the tie-up that cell reads, flipped — so every cell sharing
 * its shaft and its treadle flips with it, all through the cloth.
 */
export function flipAt(d: Draft, pick: number, end: number): Draft {
  const t = d.treadling[mod(pick, picks(d))]
  const s = d.threading[mod(end, ends(d))]
  const tieup = d.tieup.slice()
  tieup[t] ^= 1 << s
  return { ...d, tieup }
}

export const thread = (d: Draft, end: number, shaft: number): Draft => {
  const threading = d.threading.slice()
  threading[mod(end, ends(d))] = shaft
  return { ...d, threading }
}
export const treadle = (d: Draft, pick: number, t: number): Draft => {
  const treadling = d.treadling.slice()
  treadling[mod(pick, picks(d))] = t
  return { ...d, treadling }
}
export const tie = (d: Draft, t: number, shaft: number): Draft => {
  const tieup = d.tieup.slice()
  tieup[t] ^= 1 << shaft
  return { ...d, tieup }
}

const rgb = (c: RGB) =>
  (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255)

/**
 * The draft for the shader, every part repeated out to MAX_REPEAT, so the shader needs one modulus
 * for everything. Colours repeat on their own lengths, which need not be the weave's — a stripe of
 * 12 over a twill of 4 is how most cloth is — but ⚠️ EVERY LENGTH MUST DIVIDE MAX_REPEAT, or the
 * pattern jumps where the 64 wraps. `fits` says so, and loom.test.ts asks it of every draft.
 */
export function packDraft(d: Draft): Uint32Array<ArrayBuffer> {
  const u = new Uint32Array(AT.words)
  for (let k = 0; k < MAX_REPEAT; k++) {
    u[AT.threading + k] = d.threading[k % ends(d)]
    u[AT.treadling + k] = d.treadling[k % picks(d)]
    u[AT.warp + k] = rgb(d.colours[d.warp[k % d.warp.length]])
    u[AT.weft + k] = rgb(d.colours[d.weft[k % d.weft.length]])
  }
  for (let t = 0; t < TREADLES; t++) u[AT.tieup + t] = d.tieup[t] ?? 0
  return u
}

/** whether every part of a draft repeats evenly in MAX_REPEAT */
export const fits = (d: Draft) =>
  [d.threading, d.treadling, d.warp, d.weft].every(
    (a) => a.length > 0 && MAX_REPEAT % a.length === 0,
  ) && d.tieup.length === TREADLES

export type LoomParams = {
  w: number
  h: number
  /** a cell's side, in canvas px */
  cell: number
  /** picks woven so far; the fraction is the shuttle on its way across */
  woven: number
  /** the pick shown in the cloth's top row */
  first: number
  /** floats longer than this are marked; 0 marks none */
  floats: number
  light: readonly [number, number]
}

export function packLoom(p: LoomParams, into = new ArrayBuffer(LOOM.bytes)) {
  const u = new Uint32Array(into)
  const f = new Float32Array(into)
  u[0] = p.w
  u[1] = p.h
  f[LOOM.cell / 4] = p.cell
  f[LOOM.woven / 4] = p.woven
  u[LOOM.first / 4] = p.first
  u[LOOM.floats / 4] = p.floats
  f.set(p.light, LOOM.light / 4)
  return into
}

/**
 * The canvas's layout, as a weaver's draft has it: threading along the top, tie-up in the corner,
 * treadling down the right, and the cloth — the drawdown, woven — filling the rest.
 */
export function layoutFor(w: number, h: number, cell: number) {
  const margin = cell * (SHAFTS + 1)
  return {
    margin,
    cols: Math.max(1, Math.floor((w - margin) / cell)),
    rows: Math.max(1, Math.floor((h - margin) / cell)),
  }
}

export type Spot =
  | { at: 'cloth'; row: number; col: number }
  | { at: 'threading'; col: number; shaft: number }
  | { at: 'tieup'; treadle: number; shaft: number }
  | { at: 'treadling'; row: number; treadle: number }
  | { at: 'none' }

/** what a point on the canvas (canvas px) is on */
export function spotAt(x: number, y: number, w: number, h: number, cell: number): Spot {
  const { margin, cols, rows } = layoutFor(w, h, cell)
  const left = x < w - margin
  const top = y < margin
  const col = Math.floor(x / cell)
  const row = Math.floor((y - margin) / cell)
  const shaft = SHAFTS - 1 - Math.floor(y / cell)
  const t = Math.floor((x - (w - margin) - cell) / cell)
  if (left && !top) return col < cols && row < rows ? { at: 'cloth', row, col } : { at: 'none' }
  if (left && top)
    return shaft >= 0 && col < cols ? { at: 'threading', col, shaft } : { at: 'none' }
  if (t < 0 || t >= TREADLES) return { at: 'none' }
  if (top) return shaft >= 0 ? { at: 'tieup', treadle: t, shaft } : { at: 'none' }
  return row < rows ? { at: 'treadling', row, treadle: t } : { at: 'none' }
}

/* ---------------------------------------------------------------- the drafts ---------------- */

const C = {
  cream: [0.93, 0.89, 0.8],
  ink: [0.13, 0.14, 0.2],
  madder: [0.68, 0.16, 0.14],
  indigo: [0.14, 0.22, 0.45],
  moss: [0.27, 0.38, 0.22],
  ochre: [0.82, 0.6, 0.2],
  heather: [0.55, 0.47, 0.58],
  silk: [0.86, 0.75, 0.52],
  plum: [0.36, 0.12, 0.3],
} satisfies Record<string, RGB>

const twill = [0b0011, 0b0110, 0b1100, 0b1001]
const rep = (seq: number[], n: number) => Array.from({ length: n }, (_, i) => seq[i % seq.length])
/** a stripe sequence: [colour, how many] … */
const sett = (...runs: [number, number][]) => runs.flatMap(([c, n]) => Array<number>(n).fill(c))

export const DRAFTS = {
  logcabin: {
    name: 'Log cabin',
    line: 'plain weave, light and dark alternating, then swapping — blocks of tiny steps',
    draft: {
      threading: rep([0, 1], 16),
      treadling: rep([0, 1], 16),
      tieup: [0b01, 0b10, 0, 0, 0, 0, 0, 0],
      warp: [...rep([0, 1], 8), ...rep([1, 0], 8)],
      weft: [...rep([0, 1], 8), ...rep([1, 0], 8)],
      colours: [C.cream, C.indigo],
    },
  },
  houndstooth: {
    name: 'Houndstooth',
    line: 'a 2/2 twill, four dark and four light each way — the tooth comes from the twill',
    draft: {
      threading: rep([0, 1, 2, 3], 8),
      treadling: rep([0, 1, 2, 3], 8),
      tieup: [...twill, 0, 0, 0, 0],
      warp: sett([1, 4], [0, 4]),
      weft: sett([1, 4], [0, 4]),
      colours: [C.cream, C.ink],
    },
  },
  herringbone: {
    name: 'Herringbone',
    line: 'a twill that turns back on itself every eight ends, in a tweed',
    draft: {
      threading: [0, 1, 2, 3, 0, 1, 2, 3, 1, 0, 3, 2, 1, 0, 3, 2],
      treadling: [0, 1, 2, 3],
      tieup: [...twill, 0, 0, 0, 0],
      warp: [0],
      weft: [1, 1, 1, 2],
      colours: [C.ink, C.heather, C.ochre],
    },
  },
  rosepath: {
    name: 'Rosepath',
    line: 'a point twill on four shafts, treadled as drawn in: diamonds and stars',
    draft: {
      threading: [0, 1, 2, 3, 0, 3, 2, 1],
      treadling: [0, 1, 2, 3, 0, 3, 2, 1],
      tieup: [...twill, 0, 0, 0, 0],
      warp: [0],
      weft: sett([1, 8], [2, 8]),
      colours: [C.cream, C.madder, C.moss],
    },
  },
  satin: {
    name: 'Satin',
    line: 'eight shafts, the weft tying the warp down once a row, a scattered step of three apart: smooth as silk',
    draft: {
      threading: [0, 1, 2, 3, 4, 5, 6, 7],
      treadling: [0, 1, 2, 3, 4, 5, 6, 7],
      tieup: [0, 1, 2, 3, 4, 5, 6, 7].map((t) => 0xff ^ (1 << (t * 3) % 8)),
      warp: [0],
      weft: [1],
      colours: [C.silk, C.plum],
    },
  },
  tartan: {
    name: 'Tartan',
    line: 'a 2/2 twill with the same stripes in the warp and the weft',
    draft: {
      threading: rep([0, 1, 2, 3], 4),
      treadling: rep([0, 1, 2, 3], 4),
      tieup: [...twill, 0, 0, 0, 0],
      warp: sett([0, 12], [1, 4], [0, 4], [2, 2], [0, 4], [1, 4], [3, 2]),
      weft: sett([0, 12], [1, 4], [0, 4], [2, 2], [0, 4], [1, 4], [3, 2]),
      colours: [C.indigo, C.moss, C.madder, C.ochre],
    },
  },
} satisfies Record<string, { name: string; line: string; draft: Draft }>

export type DraftId = keyof typeof DRAFTS

/** the treadles' notes: a pentatonic run, so whatever is treadled is a tune */
export const NOTES = [60, 62, 64, 67, 69, 72, 74, 76]
