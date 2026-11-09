/**
 * The Lab's nonogram: a grid with a list of numbers beside every row and above every column — the
 * lengths of the runs of filled cells in that line, in order — and a picture that appears when
 * every line agrees with its numbers. Then a maker, which draws a picture and says whether it is
 * a fair puzzle.
 *
 * ⚠️ "FAIR" IS THE WHOLE ENGINEERING HERE. A picture's numbers do not always pin the picture down:
 * a 2×2 checkerboard has the same numbers either way round, and so does any picture with that
 * pattern anywhere inside it. And a picture can have exactly one answer and still need a guess on
 * the way. So the maker asks two different questions — does logic alone get there (`propagate`,
 * one line at a time, the way a person solves), and if not, is there one answer or several
 * (`count`, a search) — and every built-in picture is held to the first by a test.
 *
 * Pure, so all of it can be asked a question without a browser.
 */

export const MIN_SIDE = 5
export const MAX_SIDE = 20
/** the most numbers a line of MAX_SIDE can need: a run, a gap, a run… */
export const MAX_CLUES = Math.ceil(MAX_SIDE / 2)

export type Picture = { w: number; h: number; cells: Uint8Array }
export type Clues = { rows: number[][]; cols: number[][] }
/** what the player has put in a cell */
export const BLANK = 0
export const FILL = 1
export const CROSS = 2
export type Mark = typeof BLANK | typeof FILL | typeof CROSS

/** the runs of filled cells along a line, in order — a line with none is [] */
export function runs(line: ArrayLike<number>): number[] {
  const out: number[] = []
  let n = 0
  for (let i = 0; i < line.length; i++) {
    if (line[i] === 1) n++
    else if (n) {
      out.push(n)
      n = 0
    }
  }
  if (n) out.push(n)
  return out
}

const row = (cells: ArrayLike<number>, w: number, y: number) =>
  Array.from({ length: w }, (_, x) => cells[y * w + x])
const col = (cells: ArrayLike<number>, w: number, h: number, x: number) =>
  Array.from({ length: h }, (_, y) => cells[y * w + x])

export function cluesOf(p: Picture): Clues {
  return {
    rows: Array.from({ length: p.h }, (_, y) => runs(row(p.cells, p.w, y))),
    cols: Array.from({ length: p.w }, (_, x) => runs(col(p.cells, p.w, p.h, x))),
  }
}

/* ------------------------------------------------------------------------- one line at a time */

/** −1 not known yet, 0 empty, 1 filled */
export type Known = Int8Array

/**
 * Everything one line can say on its own: given what is known along it and its numbers, which of
 * the unknown cells are filled in EVERY arrangement of the runs that fits, and which are empty in
 * every one. Null when no arrangement fits at all.
 *
 * Two sweeps of a small table: `fwd[i][j]`, the first i cells can hold the first j runs (each
 * followed by its gap), and `bwd[i][j]`, the cells from i on can hold runs j onward. A cell may be
 * empty when some j splits the line round it; it may be filled when some run, placed over it,
 * has a fitting arrangement on both sides. O(length × runs × longest run), which for twenty cells
 * is nothing.
 */
export function lineSolve(line: Known, clue: readonly number[]): Known | null {
  const n = line.length
  const k = clue.length
  const canEmpty = (i: number) => line[i] !== 1
  // filledOk[i][L]: cells i..i+L−1 may all be filled — from a running count of definite empties
  const empties = new Int32Array(n + 1)
  for (let i = 0; i < n; i++) empties[i + 1] = empties[i] + (line[i] === 0 ? 1 : 0)
  const mayFill = (i: number, L: number) => i + L <= n && empties[i + L] - empties[i] === 0

  const W = k + 1
  const fwd = new Uint8Array((n + 2) * W)
  fwd[0] = 1
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= k; j++) {
      if (!fwd[i * W + j]) continue
      if (i < n && canEmpty(i)) fwd[(i + 1) * W + j] = 1
      if (j < k) {
        const L = clue[j]
        if (!mayFill(i, L)) continue
        if (i + L === n) fwd[n * W + j + 1] = 1
        else if (canEmpty(i + L)) fwd[(i + L + 1) * W + j + 1] = 1
      }
    }
  if (!fwd[n * W + k]) return null

  const bwd = new Uint8Array((n + 2) * W)
  bwd[n * W + k] = 1
  for (let i = n - 1; i >= 0; i--)
    for (let j = k; j >= 0; j--) {
      let ok = canEmpty(i) && bwd[(i + 1) * W + j] === 1
      if (!ok && j < k) {
        const L = clue[j]
        if (mayFill(i, L))
          ok = i + L === n ? j + 1 === k : canEmpty(i + L) && bwd[(i + L + 1) * W + j + 1] === 1
      }
      if (ok) bwd[i * W + j] = 1
    }

  const empty = new Uint8Array(n)
  const fill = new Int32Array(n + 1) // a difference array: +1 where a placed run starts, −1 after
  for (let i = 0; i < n; i++) {
    if (canEmpty(i))
      for (let j = 0; j <= k && !empty[i]; j++)
        if (fwd[i * W + j] && bwd[(i + 1) * W + j]) empty[i] = 1
    for (let j = 0; j < k; j++) {
      const L = clue[j]
      if (!fwd[i * W + j] || !mayFill(i, L)) continue
      const after =
        i + L === n ? j + 1 === k : canEmpty(i + L) && bwd[(i + L + 1) * W + j + 1] === 1
      if (after) {
        fill[i]++
        fill[i + L]--
        // the gap after a run is consumed with it, so the plain test above never sees it
        if (i + L < n) empty[i + L] = 1
      }
    }
  }
  const out = new Int8Array(n)
  let on = 0
  for (let i = 0; i < n; i++) {
    on += fill[i]
    const f = on > 0
    const e = empty[i] === 1
    if (!f && !e) return null
    out[i] = f && e ? -1 : f ? 1 : 0
    if (line[i] !== -1 && out[i] !== line[i]) return null
  }
  return out
}

/**
 * Line logic to a standstill: every row and column solved on its own, again and again while any
 * of them learns something. A copy; null when the numbers contradict what is known.
 */
export function propagate(c: Clues, w: number, h: number, known: Known): Known | null {
  const s = Int8Array.from(known)
  const dirtyRow = new Uint8Array(h).fill(1)
  const dirtyCol = new Uint8Array(w).fill(1)
  let busy = true
  while (busy) {
    busy = false
    for (let y = 0; y < h; y++) {
      if (!dirtyRow[y]) continue
      dirtyRow[y] = 0
      const line = s.subarray(y * w, y * w + w)
      const got = lineSolve(line, c.rows[y])
      if (!got) return null
      for (let x = 0; x < w; x++)
        if (line[x] === -1 && got[x] !== -1) {
          line[x] = got[x]
          dirtyCol[x] = 1
          busy = true
        }
    }
    for (let x = 0; x < w; x++) {
      if (!dirtyCol[x]) continue
      dirtyCol[x] = 0
      const line = Int8Array.from({ length: h }, (_, y) => s[y * w + x])
      const got = lineSolve(line, c.cols[x])
      if (!got) return null
      for (let y = 0; y < h; y++)
        if (line[y] === -1 && got[y] !== -1) {
          s[y * w + x] = got[y]
          dirtyRow[y] = 1
          busy = true
        }
    }
  }
  return s
}

export const unknown = (w: number, h: number): Known => new Int8Array(w * h).fill(-1)

/**
 * Up to `limit` answers, by line logic with a guess wherever it stalls — the guess tried both
 * ways. `budget` bounds the guesses, so a picture that would take an age says so rather than
 * hanging the page; `exhausted` is then true and the answers found are only some of them.
 */
export function count(
  c: Clues,
  w: number,
  h: number,
  limit = 2,
  budget = 4000,
): { answers: Known[]; exhausted: boolean } {
  const answers: Known[] = []
  let left = budget
  const go = (s: Known | null) => {
    if (!s || answers.length >= limit || left <= 0) return
    const at = s.indexOf(-1)
    if (at < 0) {
      answers.push(s)
      return
    }
    left--
    for (const v of [1, 0]) {
      const t = Int8Array.from(s)
      t[at] = v
      go(propagate(c, w, h, t))
      if (answers.length >= limit) return
    }
  }
  go(propagate(c, w, h, unknown(w, h)))
  return { answers, exhausted: left <= 0 && answers.length < limit }
}

export type Verdict =
  /** a person can solve it a line at a time, and there is one answer */
  | { kind: 'logic' }
  /** one answer, but a line at a time gets stuck: somewhere it needs a guess */
  | { kind: 'guess'; stuck: number[] }
  /** more than one picture has these numbers: the cells that differ between two of them */
  | { kind: 'many'; open: number[] }
  /** too slow to tell, so the maker does not pretend */
  | { kind: 'unknown' }
  | { kind: 'empty' }

/** is this picture a fair puzzle — the maker's whole question */
export function judge(p: Picture): Verdict {
  if (!p.cells.some((v) => v === 1)) return { kind: 'empty' }
  const c = cluesOf(p)
  const s = propagate(c, p.w, p.h, unknown(p.w, p.h))
  if (s && !s.includes(-1)) return { kind: 'logic' }
  const { answers, exhausted } = count(c, p.w, p.h)
  if (answers.length >= 2) {
    const open: number[] = []
    for (let i = 0; i < p.w * p.h; i++) if (answers[0][i] !== answers[1][i]) open.push(i)
    return { kind: 'many', open }
  }
  if (exhausted) return { kind: 'unknown' }
  const stuck: number[] = []
  if (s) for (let i = 0; i < s.length; i++) if (s[i] === -1) stuck.push(i)
  return { kind: 'guess', stuck }
}

/* --------------------------------------------------------------------------- the player's marks */

const filled = (marks: ArrayLike<number>) => Array.from(marks, (m) => (m === FILL ? 1 : 0))

/** which lines already match their numbers — the clues the page greys out */
export function linesDone(c: Clues, w: number, h: number, marks: ArrayLike<number>) {
  const f = filled(marks)
  const same = (a: number[], b: readonly number[]) =>
    a.length === b.length && a.every((v, i) => v === b[i])
  return {
    rows: c.rows.map((clue, y) => same(runs(row(f, w, y)), clue)),
    cols: c.cols.map((clue, x) => same(runs(col(f, w, h, x)), clue)),
  }
}

/** solved when every line agrees with its numbers — any picture that does, not only the drawn one */
export function solved(c: Clues, w: number, h: number, marks: ArrayLike<number>) {
  const d = linesDone(c, w, h, marks)
  return d.rows.every(Boolean) && d.cols.every(Boolean)
}

export type Hint =
  /** marks that disagree with the answer: those first, or every later hint is built on sand */
  | { kind: 'wrong'; cells: number[] }
  /** one line that, with what is already marked, settles some cells by itself */
  | { kind: 'line'; axis: 'row' | 'col'; index: number; cells: number[]; values: number[] }
  /** line logic has nothing to say (a puzzle that needs a guess): one cell from the answer */
  | { kind: 'cell'; cells: number[]; values: number[] }
  | { kind: 'none' }

/**
 * The next thing to learn. A hint TEACHES rather than fills: it names a line that settles cells
 * from what is already marked, the line that settles the most — so the player sees why.
 */
export function hint(c: Clues, p: Picture, marks: ArrayLike<number>): Hint {
  const { w, h } = p
  const wrong: number[] = []
  for (let i = 0; i < w * h; i++)
    if ((marks[i] === FILL && p.cells[i] !== 1) || (marks[i] === CROSS && p.cells[i] === 1))
      wrong.push(i)
  if (wrong.length) return { kind: 'wrong', cells: wrong }
  if (solved(c, w, h, marks)) return { kind: 'none' }
  const known = Int8Array.from(marks, (m) => (m === FILL ? 1 : m === CROSS ? 0 : -1))
  let best: Extract<Hint, { kind: 'line' }> | null = null
  const consider = (axis: 'row' | 'col', index: number, idx: number[]) => {
    const line = Int8Array.from(idx, (i) => known[i])
    const got = lineSolve(line, axis === 'row' ? c.rows[index] : c.cols[index])
    if (!got) return
    const cells: number[] = []
    const values: number[] = []
    idx.forEach((i, k) => {
      if (line[k] === -1 && got[k] !== -1) {
        cells.push(i)
        values.push(got[k])
      }
    })
    if (cells.length && (!best || cells.length > best.cells.length))
      best = { kind: 'line', axis, index, cells, values }
  }
  for (let y = 0; y < h; y++)
    consider(
      'row',
      y,
      Array.from({ length: w }, (_, x) => y * w + x),
    )
  for (let x = 0; x < w; x++)
    consider(
      'col',
      x,
      Array.from({ length: h }, (_, y) => y * w + x),
    )
  if (best) return best
  // only a guess would get further: give one cell of the answer, a filled one if any are left
  let at = -1
  for (let i = 0; i < w * h && at < 0; i++) if (known[i] === -1 && p.cells[i] === 1) at = i
  if (at < 0) at = known.indexOf(-1)
  if (at < 0) return { kind: 'none' }
  return { kind: 'cell', cells: [at], values: [p.cells[at]] }
}

/* ------------------------------------------------------------------------- painting with a drag */

/**
 * One press-and-drag. A press decides the action from the cell it lands on — the tool's mark on a
 * cell without it, or clearing a cell that already has it — and the drag then applies that one
 * action, so dragging across a row never toggles cells back and forth. In play the drag is held to
 * the row or column it first moved along (a nonogram is solved a line at a time, and a thumb
 * drifts), and it fills only blank cells, never painting over the other mark.
 */
export type Stroke = {
  action: Mark
  /** what the press cleared, when it clears: only cells holding that are cleared */
  clears: Mark
  from: [number, number]
  axis: 'row' | 'col' | null
  lock: boolean
  /** where an unheld drag last reached, so the next move joins on from there */
  last?: [number, number]
}

export function press(
  marks: Uint8Array,
  w: number,
  at: [number, number],
  tool: typeof FILL | typeof CROSS,
  lock: boolean,
): Stroke {
  const was = marks[at[1] * w + at[0]] as Mark
  const action: Mark = was === tool ? BLANK : tool
  const s: Stroke = { action, clears: was, from: at, axis: null, lock }
  apply(marks, w, s, at)
  return s
}

function apply(marks: Uint8Array, w: number, s: Stroke, [x, y]: [number, number]) {
  const i = y * w + x
  if (s.action === BLANK) {
    if (marks[i] === s.clears) marks[i] = BLANK
  } else if (marks[i] === BLANK || !s.lock) marks[i] = s.action
}

/** the drag reaches a cell: every cell on the way there gets the stroke's action, so a fast drag
 *  leaves no gaps. Returns the cell the stroke actually reached (held to its line). */
export function drag(
  marks: Uint8Array,
  w: number,
  s: Stroke,
  to: [number, number],
): [number, number] {
  let [x, y] = to
  if (s.lock) {
    if (!s.axis && (x !== s.from[0] || y !== s.from[1]))
      s.axis = Math.abs(x - s.from[0]) >= Math.abs(y - s.from[1]) ? 'row' : 'col'
    if (s.axis === 'row') y = s.from[1]
    if (s.axis === 'col') x = s.from[0]
  }
  // every cell from the stroke's start along its line: a drag that doubles back is still one stroke
  const [fx, fy] = s.lock ? s.from : (s.last ?? s.from)
  const n = Math.max(Math.abs(x - fx), Math.abs(y - fy))
  for (let k = 0; k <= n; k++) {
    const cx = n ? Math.round(fx + ((x - fx) * k) / n) : x
    const cy = n ? Math.round(fy + ((y - fy) * k) / n) : y
    apply(marks, w, s, [cx, cy])
  }
  s.last = [x, y]
  return [x, y]
}

/* ------------------------------------------------------------------------------ the pictures */

export type Level = {
  name: string
  picture: Picture
  /** each cell's colour when the picture is revealed — 0xRRGGBB, the paper's where empty */
  colours: Uint32Array
  /** what the empty cells become when it is revealed */
  paper: number
}

const INKS: Record<string, number> = {
  k: 0x2a2a35,
  r: 0xd8443c,
  o: 0xef8a2a,
  y: 0xf4c542,
  g: 0x4caf50,
  d: 0x2e7d32,
  b: 0x3b7dd8,
  c: 0x7fd0f0,
  n: 0x8b5a2b,
  p: 0xf28bb0,
  w: 0xf7f4ea,
  s: 0x9aa3b5,
  v: 0x8e5cc8,
}

/** a picture from rows of text: '.' empty, any letter in INKS a filled cell of that colour */
export function level(name: string, paper: number, art: string): Level {
  const lines = art
    .trim()
    .split('\n')
    .map((l) => l.trim())
  const h = lines.length
  const w = lines[0].length
  const cells = new Uint8Array(w * h)
  const colours = new Uint32Array(w * h)
  lines.forEach((l, y) => {
    if (l.length !== w) throw new Error(`${name}: row ${y + 1} is ${l.length} wide, not ${w}`)
    for (let x = 0; x < w; x++) {
      const ch = l[x]
      if (ch === '.') {
        colours[y * w + x] = paper
        continue
      }
      const ink = INKS[ch]
      if (ink === undefined) throw new Error(`${name}: no ink called "${ch}"`)
      cells[y * w + x] = 1
      colours[y * w + x] = ink
    }
  })
  return { name, picture: { w, h, cells }, colours, paper }
}

export const LEVELS: Level[] = [
  level(
    'Heart',
    0xfbe3e8,
    `
    .r.r.
    rrrrr
    rrrrr
    .rrr.
    ..r..`,
  ),
  level(
    'Tree',
    0xdff0ff,
    `
    ..g..
    .ggg.
    ggggg
    ..n..
    .nnn.`,
  ),
  level(
    'Sailboat',
    0xcfe9ff,
    `
    ....w.....
    ....ww....
    ....www...
    ....wwww..
    ....wwwww.
    ....n.....
    nnnnnnnnnn
    .nnnnnnnn.
    ..nnnnnn..
    bb.bbb.bbb`,
  ),
  level(
    'Mushroom',
    0xe7f5df,
    `
    ...rrrr...
    .rrwwrrrr.
    rrrwwrrwwr
    rrrrrrrwwr
    rwwrrrrrrr
    ...wwww...
    ...wwww...
    ...wwww...
    ..wwwwww..
    gggggggggg`,
  ),
  level(
    'Cat',
    0xfff1d6,
    `
    k........k
    kk......kk
    kkkkkkkkkk
    kk.kkkk.kk
    kkkkkkkkkk
    .kkkk.kkk.
    ..kkkkkk..
    ...kkkk...
    ..kkkkkk..
    .kkkkkkkk.`,
  ),
  level(
    'Note',
    0xf0e6ff,
    `
    ....vvvvvv
    ....vvvvvv
    ....v....v
    ....v....v
    ....v....v
    ....v....v
    .vvvv..vvv
    vvvvv.vvvv
    vvvvv.vvvv
    .vvv...vv.`,
  ),
  level(
    'Fish',
    0x9fd8f0,
    `
    ...............
    .....oooo......
    ....oooooo.....
    ...oooooooo...o
    ..okooooooo..oo
    .oooooooooooooo
    ooooooooooooo..
    .oooooooooooooo
    ..oooooooooo.oo
    ...oooooooo...o
    ....oooooo.....
    .....oooo......
    ...............
    .c.....c....c..
    c.c...c.c..c.c.`,
  ),
  level(
    'House',
    0xd6ecff,
    `
    ..........nn...
    .......r..nn...
    ......rrr.nn...
    .....rrrrrnn...
    ....rrrrrrrr...
    ...rrrrrrrrrr..
    ..rrrrrrrrrrrr.
    .rrrrrrrrrrrrrr
    ..yyyyyyyyyyyy.
    ..yy..yyyy..yy.
    ..yy..yyyy..yy.
    ..yyyyyyyyyyyy.
    ..yyyyy..yyyyy.
    ..yyyyy..yyyyy.
    ggggggggggggggg`,
  ),
  level(
    'Rocket',
    0x1d2440,
    `
    .......s.......
    ......sss......
    .....sssss.....
    .....sbbbs.....
    .....sbbbs.....
    .....sssss.....
    .....sssss.....
    ....sssssss....
    ...rsssssssr...
    ..rrsssssssrr..
    .rrrsssssssrrr.
    .rr..sssss..rr.
    .....o.o.o.....
    ....oyoyoyo....
    .....y.y.y.....`,
  ),
  level(
    'Snail',
    0xe3f4d7,
    `
    ...............
    ....nnnnnn.....
    ...nn....nn....
    ..nn.nnnn.nn...
    ..n.nn..nn.n...
    ..n.n.nn.n.n..y
    ..n.n.n..n.n.y.
    ..n.nn..nn.n.y.
    ..nn.nnnn.nn.yy
    ...nn....nn.yyy
    ....nnnnnnyyyy.
    .yyyyyyyyyyyy..
    ..yyyyyyyyyy...
    ...............
    ggggggggggggggg`,
  ),
]

/* ------------------------------------------------------------------ codes, and what is kept */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** a picture as a few dozen characters to pass on by hand — "10x10.Ab3…" — six cells a letter */
export function toCode(p: Picture): string {
  let out = ''
  for (let i = 0; i < p.w * p.h; i += 6) {
    let v = 0
    for (let k = 0; k < 6; k++) v = (v << 1) | (p.cells[i + k] === 1 ? 1 : 0)
    out += B64[v]
  }
  return `${p.w}x${p.h}.${out}`
}

/** a code read back, refusing anything that is not exactly one: the wrong size, a stray
 *  character, a blank picture */
export function fromCode(text: string): Picture | null {
  const m = /^(\d{1,2})x(\d{1,2})\.([A-Za-z0-9_-]+)$/.exec(text.trim())
  if (!m) return null
  const w = Number(m[1])
  const h = Number(m[2])
  if (w < MIN_SIDE || w > MAX_SIDE || h < MIN_SIDE || h > MAX_SIDE) return null
  if (m[3].length !== Math.ceil((w * h) / 6)) return null
  const cells = new Uint8Array(w * h)
  for (let c = 0; c < m[3].length; c++) {
    const v = B64.indexOf(m[3][c])
    for (let k = 0; k < 6; k++) {
      const i = c * 6 + k
      const bit = (v >> (5 - k)) & 1
      if (i < w * h) cells[i] = bit
      else if (bit) return null // padding must be zeros, or two codes would mean one picture
    }
  }
  return cells.some((v) => v === 1) ? { w, h, cells } : null
}

export const NONOGRAM_KEY = 'lab_nonogram_v1'
export const MAX_KEPT = 12
const MAX_NAME = 30

export type Kept = { name: string; code: string }
/** a puzzle part-way: one digit a cell (0 blank, 1 filled, 2 crossed), the time spent on it and
 *  the hints taken — kept together, so a reload neither restarts the clock nor forgets a hint */
export type Progress = { m: string; ms: number; hints: number }
export type Saved = {
  kept: Kept[]
  /** by puzzle: a level's name, or the code of a picture somebody made */
  progress: Record<string, Progress>
  /** solved puzzles: the quickest, and the fewest hints taken */
  solved: Record<string, { ms: number; hints: number }>
  /** the maker's drawing, as a code, so leaving and coming back does not lose it */
  draft: string | null
}

export const EMPTY_SAVED: Saved = { kept: [], progress: {}, solved: {}, draft: null }

const count0 = (v: unknown) => (Number.isFinite(v) ? Math.max(0, Math.round(v as number)) : null)

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** what this browser kept, read defensively: a hand-edited or older shape loses only what is bad */
export function readSaved(text: string | null): Saved {
  let v: unknown
  try {
    v = JSON.parse(text ?? 'null')
  } catch {
    return { ...EMPTY_SAVED }
  }
  if (!isRecord(v)) return { ...EMPTY_SAVED }
  const kept: Kept[] = []
  if (Array.isArray(v.kept))
    for (const k of v.kept) {
      if (!isRecord(k) || typeof k.code !== 'string' || !fromCode(k.code)) continue
      const name = typeof k.name === 'string' && k.name.trim() ? k.name.trim() : 'Untitled'
      if (kept.length < MAX_KEPT) kept.push({ name: name.slice(0, MAX_NAME), code: k.code.trim() })
    }
  const progress: Record<string, Progress> = {}
  if (isRecord(v.progress))
    for (const [id, p] of Object.entries(v.progress)) {
      if (!isRecord(p) || typeof p.m !== 'string' || !/^[012]{25,400}$/.test(p.m)) continue
      progress[id] = { m: p.m, ms: count0(p.ms) ?? 0, hints: count0(p.hints) ?? 0 }
    }
  const solved: Saved['solved'] = {}
  if (isRecord(v.solved))
    for (const [id, s] of Object.entries(v.solved)) {
      const ms = isRecord(s) ? count0(s.ms) : null
      const hints = isRecord(s) ? count0(s.hints) : null
      if (ms !== null && hints !== null) solved[id] = { ms, hints }
    }
  const draft = typeof v.draft === 'string' && fromCode(v.draft) ? v.draft.trim() : null
  return { kept, progress, solved, draft }
}

/** keep a made picture: refused (null) when the list is full or it is already there — never by
 *  dropping an older one, which would be a delete nobody asked for */
export function keep(saved: Saved, name: string, code: string): Saved | null {
  if (saved.kept.length >= MAX_KEPT || saved.kept.some((k) => k.code === code)) return null
  const n = name.trim().slice(0, MAX_NAME) || 'Untitled'
  return { ...saved, kept: [...saved.kept, { name: n, code }] }
}

export const marksToText = (m: ArrayLike<number>) => Array.from(m).join('')
export function marksFromText(t: string | undefined, n: number): Uint8Array {
  const out = new Uint8Array(n)
  if (t && t.length === n) for (let i = 0; i < n; i++) out[i] = Number(t[i]) as Mark
  return out
}

/** a better result than what is kept: quicker, or as quick with fewer hints */
export function better(was: { ms: number; hints: number } | undefined, ms: number, hints: number) {
  return !was || hints < was.hints || (hints === was.hints && ms < was.ms)
}

/* ---------------------------------------------------------------------------- the stage */

/** how many numbers the widest row clue and the tallest column clue need — at least one each */
export const depth = (c: Clues) => ({
  left: Math.max(1, ...c.rows.map((r) => r.length)),
  top: Math.max(1, ...c.cols.map((r) => r.length)),
})

/** the board's cell size and where the grid's top-left corner sits, clues included in the fit */
export function fitBoard(stage: [number, number], w: number, h: number, c: Clues) {
  return fitSized(stage, w, h, depth(c))
}

/** the same, from how deep the numbers go — what the engine knows */
export function fitSized(
  stage: [number, number],
  w: number,
  h: number,
  d: { left: number; top: number },
) {
  const across = w + d.left + 0.6
  const down = h + d.top + 0.6
  const s = Math.max(1, Math.floor(Math.min(stage[0] / across, stage[1] / down)))
  const ox = Math.round((stage[0] - (w + d.left) * s) / 2 + d.left * s)
  const oy = Math.round((stage[1] - (h + d.top) * s) / 2 + d.top * s)
  return { s, ox, oy, left: d.left, top: d.top }
}

/** the grid cell under a stage point, or null off the grid */
export function cellAt(
  f: ReturnType<typeof fitBoard>,
  w: number,
  h: number,
  p: [number, number],
): [number, number] | null {
  const x = Math.floor((p[0] - f.ox) / f.s)
  const y = Math.floor((p[1] - f.oy) / f.s)
  return x >= 0 && x < w && y >= 0 && y < h ? [x, y] : null
}

/** the same, but a drag that leaves the grid is held at its edge rather than dropped */
export function cellNear(
  f: ReturnType<typeof fitBoard>,
  w: number,
  h: number,
  p: [number, number],
): [number, number] {
  const x = Math.floor((p[0] - f.ox) / f.s)
  const y = Math.floor((p[1] - f.oy) / f.s)
  return [Math.max(0, Math.min(w - 1, x)), Math.max(0, Math.min(h - 1, y))]
}

/** cell flags the shader reads */
export const WRONG = 1
export const OPEN = 2
export const GHOST_FILL = 4
export const GHOST_CROSS = 8

/**
 * Everything the shader draws, in one array of floats: per cell (mark, flags, colour, 0), then each
 * row's clue (count, numbers… padded to MAX_CLUES), each column's, then one flag a line (1 done,
 * 2 the line a hint is about). Offsets are returned for the uniform.
 */
export function pack(
  w: number,
  h: number,
  c: Clues,
  marks: ArrayLike<number>,
  flags: ArrayLike<number>,
  colours: ArrayLike<number>,
  lineFlags: { rows: number[]; cols: number[] },
) {
  const stride = MAX_CLUES + 1
  const offRows = w * h * 4
  const offCols = offRows + h * stride
  const offLines = offCols + w * stride
  const out = new Float32Array(offLines + h + w)
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = marks[i]
    out[i * 4 + 1] = flags[i]
    out[i * 4 + 2] = colours[i]
  }
  const put = (at: number, clue: readonly number[]) => {
    const list = clue.length ? clue : [0]
    out[at] = list.length
    list.forEach((v, k) => (out[at + 1 + k] = v))
  }
  c.rows.forEach((r, y) => put(offRows + y * stride, r))
  c.cols.forEach((r, x) => put(offCols + x * stride, r))
  lineFlags.rows.forEach((v, y) => (out[offLines + y] = v))
  lineFlags.cols.forEach((v, x) => (out[offLines + h + x] = v))
  return { data: out, offRows, offCols, offLines, stride }
}

/** the biggest packed array, for the GPU buffer */
export const MAX_FLOATS = MAX_SIDE * MAX_SIDE * 4 + 2 * MAX_SIDE * (MAX_CLUES + 1) + 2 * MAX_SIDE
