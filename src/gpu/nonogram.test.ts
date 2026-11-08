import { describe, expect, it } from 'vitest'
import {
  BLANK,
  CROSS,
  EMPTY_SAVED,
  FILL,
  LEVELS,
  MAX_CLUES,
  MAX_FLOATS,
  MAX_KEPT,
  MAX_SIDE,
  cellAt,
  cluesOf,
  count,
  drag,
  fitBoard,
  fromCode,
  hint,
  judge,
  keep,
  lineSolve,
  linesDone,
  marksFromText,
  marksToText,
  pack,
  press,
  readSaved,
  runs,
  solved,
  toCode,
  type Picture,
} from './nonogram'

/** a small seeded generator, so a failure names a case that comes back */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const picture = (w: number, h: number, rand: () => number, density = 0.55): Picture => ({
  w,
  h,
  cells: Uint8Array.from({ length: w * h }, () => (rand() < density ? 1 : 0)),
})

describe('one line at a time', () => {
  /** the answer by brute force: every line of that length, kept if it fits */
  const brute = (known: Int8Array, clue: number[]) => {
    const n = known.length
    let any = false
    const can1 = new Uint8Array(n)
    const can0 = new Uint8Array(n)
    for (let b = 0; b < 1 << n; b++) {
      const line = Array.from({ length: n }, (_, i) => (b >> i) & 1)
      if (line.some((v, i) => known[i] !== -1 && known[i] !== v)) continue
      const r = runs(line)
      if (r.length !== clue.length || r.some((v, i) => v !== clue[i])) continue
      any = true
      line.forEach((v, i) => (v ? (can1[i] = 1) : (can0[i] = 1)))
    }
    if (!any) return null
    return Int8Array.from({ length: n }, (_, i) => (can1[i] && can0[i] ? -1 : can1[i] ? 1 : 0))
  }

  it('says exactly what every fitting arrangement agrees on — against brute force, 3,000 lines', () => {
    const rand = rng(7)
    for (let t = 0; t < 3000; t++) {
      const n = 1 + Math.floor(rand() * 12)
      const truth = Array.from({ length: n }, () => (rand() < 0.5 ? 1 : 0))
      // half the time the clue belongs to another line, so contradictions are asked about too
      const clue = runs(
        rand() < 0.5 ? truth : Array.from({ length: n }, () => (rand() < 0.5 ? 1 : 0)),
      )
      const known = Int8Array.from(truth, (v) => (rand() < 0.35 ? v : -1))
      expect(lineSolve(known, clue), `${n} ${clue} ${known}`).toEqual(brute(known, clue))
    }
  })

  it('the classics: a run longer than half the line pins its middle', () => {
    const u = (n: number) => new Int8Array(n).fill(-1)
    expect([...lineSolve(u(10), [7])!]).toEqual([-1, -1, -1, 1, 1, 1, 1, -1, -1, -1])
    expect([...lineSolve(u(5), [])!]).toEqual([0, 0, 0, 0, 0])
    expect([...lineSolve(u(5), [2, 2])!]).toEqual([1, 1, 0, 1, 1])
    expect([...lineSolve(u(7), [3, 1])!]).toEqual([-1, -1, 1, -1, -1, -1, -1])
    expect(lineSolve(u(4), [2, 2])).toBeNull()
  })
})

describe('whole puzzles', () => {
  it('counts answers exactly — against every 4×4 picture there is', () => {
    // 65,536 pictures, grouped by their numbers: how many share each set is how many answers it has
    const key = (p: Picture) => JSON.stringify(cluesOf(p))
    const share = new Map<string, number>()
    for (let b = 0; b < 1 << 16; b++) {
      const p = { w: 4, h: 4, cells: Uint8Array.from({ length: 16 }, (_, i) => (b >> i) & 1) }
      share.set(key(p), (share.get(key(p)) ?? 0) + 1)
    }
    const rand = rng(11)
    for (let t = 0; t < 300; t++) {
      const p = picture(4, 4, rand, 0.3 + rand() * 0.5)
      const { answers, exhausted } = count(cluesOf(p), 4, 4, 3)
      expect(exhausted).toBe(false)
      expect(answers.length).toBe(Math.min(3, share.get(key(p))!))
      for (const a of answers) expect(key({ w: 4, h: 4, cells: Uint8Array.from(a) })).toBe(key(p))
    }
  })

  it('tells a fair picture from one with two answers, and points at the cells that differ', () => {
    const checker: Picture = {
      w: 5,
      h: 5,
      // a 2×2 checkerboard in a corner: its numbers fit it either way round
      cells: Uint8Array.from('10000' + '01000' + '00000' + '00000' + '00000', Number),
    }
    const v = judge(checker)
    expect(v.kind).toBe('many')
    expect(v.kind === 'many' && v.open.sort((a, b) => a - b)).toEqual([0, 1, 5, 6])
    expect(judge({ w: 5, h: 5, cells: new Uint8Array(25) }).kind).toBe('empty')
    expect(judge({ w: 5, h: 5, cells: new Uint8Array(25).fill(1) }).kind).toBe('logic')
  })

  it('finds pictures with one answer that line logic alone cannot reach', () => {
    // a sweep of random 8×8 pictures: some need a guess — and those really have just one answer
    const rand = rng(3)
    let guess = 0
    for (let t = 0; t < 400; t++) {
      const p = picture(8, 8, rand)
      const v = judge(p)
      if (v.kind !== 'guess') continue
      guess++
      expect(count(cluesOf(p), 8, 8, 2).answers.length).toBe(1)
      expect(v.stuck.length).toBeGreaterThan(0)
    }
    expect(guess).toBeGreaterThan(0)
  })

  it('every built-in picture is solvable a line at a time, with one answer', () => {
    for (const l of LEVELS) {
      expect(judge(l.picture).kind, l.name).toBe('logic')
      expect(l.picture.w).toBeLessThanOrEqual(MAX_SIDE)
      expect(l.colours.length).toBe(l.picture.w * l.picture.h)
    }
    expect(new Set(LEVELS.map((l) => l.name)).size).toBe(LEVELS.length)
  })
})

describe('the player', () => {
  it('is done when every line fits — a different picture with the same numbers counts', () => {
    const p = LEVELS[0].picture
    const c = cluesOf(p)
    const marks = Uint8Array.from(p.cells, (v) => (v ? FILL : CROSS))
    expect(solved(c, p.w, p.h, marks)).toBe(true)
    marks[0] = marks[0] === FILL ? BLANK : FILL
    expect(solved(c, p.w, p.h, marks)).toBe(false)
    // the checkerboard the other way round
    const a = Uint8Array.from('10000' + '01000' + '00000' + '00000' + '00000', Number)
    const b = Uint8Array.from('01000' + '10000' + '00000' + '00000' + '00000', Number)
    expect(solved(cluesOf({ w: 5, h: 5, cells: a }), 5, 5, b)).toBe(true)
  })

  it('greys a line out when it fits, and not before', () => {
    const p = LEVELS[1].picture // Tree: ..g.. / .ggg. / ggggg / ..n.. / .nnn.
    const marks = new Uint8Array(25)
    marks.set([FILL, FILL, FILL, FILL, FILL], 10)
    const d = linesDone(cluesOf(p), 5, 5, marks)
    expect(d.rows).toEqual([false, false, true, false, false])
    // the two outer columns hold one cell each, in that row: they fit already
    expect(d.cols).toEqual([true, false, false, false, true])
  })

  it('hints, taken one after another, solve every built-in picture — and never say anything false', () => {
    for (const l of LEVELS) {
      const p = l.picture
      const c = cluesOf(p)
      const marks = new Uint8Array(p.w * p.h)
      let steps = 0
      for (;;) {
        const h = hint(c, p, marks)
        if (h.kind === 'none') break
        expect(h.kind, l.name).toBe('line') // a fair puzzle never needs the fallback
        if (h.kind !== 'line') break
        h.cells.forEach((i, k) => {
          expect(h.values[k], `${l.name} cell ${i}`).toBe(p.cells[i])
          marks[i] = h.values[k] ? FILL : CROSS
        })
        steps++
      }
      expect(solved(c, p.w, p.h, marks), l.name).toBe(true)
      expect(steps).toBeGreaterThan(0)
    }
  })

  it('points at a wrong mark before anything else', () => {
    const p = LEVELS[2].picture
    const marks = new Uint8Array(p.w * p.h)
    const off = p.cells.indexOf(0)
    const on = p.cells.indexOf(1)
    marks[off] = FILL
    marks[on] = CROSS
    expect(hint(cluesOf(p), p, marks)).toEqual({
      kind: 'wrong',
      cells: [on, off].sort((a, b) => a - b),
    })
  })
})

describe('painting with a drag', () => {
  const W = 6
  const at = (m: Uint8Array) => [...m].join('')
  it('a press fills a blank cell and clears a filled one; the drag repeats that one action', () => {
    const m = new Uint8Array(W * 2)
    const s = press(m, W, [0, 0], FILL, true)
    drag(m, W, s, [4, 0])
    expect(at(m)).toBe('111110' + '000000')
    const t = press(m, W, [1, 0], FILL, true)
    drag(m, W, t, [3, 0])
    expect(at(m)).toBe('100010' + '000000')
  })
  it('in play a drag holds to its first direction and never paints over the other mark', () => {
    const m = new Uint8Array(W * 3)
    m[2] = CROSS
    const s = press(m, W, [0, 0], FILL, true)
    drag(m, W, s, [1, 0])
    drag(m, W, s, [4, 2]) // the thumb drifts two rows down: still row 0
    expect(at(m)).toBe('112110' + '000000' + '000000')
    // a clearing stroke clears only the mark it started on
    const t = press(m, W, [0, 0], FILL, true)
    drag(m, W, t, [5, 0])
    expect(at(m)).toBe('002000' + '000000' + '000000')
  })
  it('in the maker a drag goes anywhere, and a fast one leaves no gaps', () => {
    const m = new Uint8Array(W * W)
    const s = press(m, W, [0, 0], FILL, false)
    drag(m, W, s, [5, 5])
    expect([0, 7, 14, 21, 28, 35].every((i) => m[i] === FILL)).toBe(true)
    drag(m, W, s, [5, 0])
    expect([5, 11, 17, 23, 29].every((i) => m[i] === FILL)).toBe(true)
  })
})

describe('codes and what this browser keeps', () => {
  it('a code is the picture, exactly, at every size', () => {
    const rand = rng(5)
    for (let w = 5; w <= MAX_SIDE; w++)
      for (const h of [5, 9, 13, MAX_SIDE]) {
        const p = picture(w, h, rand)
        p.cells[0] = 1
        const back = fromCode(toCode(p))
        expect(back, `${w}x${h}`).toEqual(p)
      }
    expect(toCode(LEVELS[0].picture)).toMatch(/^5x5\.[A-Za-z0-9_-]{5}$/)
  })
  it('refuses anything that is not exactly one', () => {
    const good = toCode(LEVELS[2].picture)
    expect(fromCode(`  ${good}\n`)).toEqual(LEVELS[2].picture)
    expect(fromCode(good.replace('10x10', '10x11'))).toBeNull()
    expect(fromCode(good.slice(0, -1))).toBeNull()
    expect(fromCode(good + 'A')).toBeNull()
    expect(fromCode(good.replace('.', '.!'))).toBeNull()
    expect(fromCode('4x4.AAA')).toBeNull()
    expect(fromCode('21x5.' + 'A'.repeat(18))).toBeNull()
    expect(fromCode('5x5.AAAAA')).toBeNull() // blank
    expect(fromCode('5x5.AAAAB')).toBeNull() // the 26th bit is padding, and set
    expect(fromCode('5x5.AAAAg')).not.toBeNull() // the 25th is the last cell
  })

  it('reads back everything it wrote, every field away from its default', () => {
    const saved = {
      kept: [
        { name: 'Dog', code: toCode(LEVELS[3].picture) },
        { name: 'Boat two', code: toCode(LEVELS[2].picture) },
      ],
      progress: {
        Heart: { m: '1200110000000000000000021', ms: 4321, hints: 3 },
        'Dog?': { m: '2'.repeat(100), ms: 1, hints: 1 },
      },
      solved: { Heart: { ms: 61234, hints: 2 }, Fish: { ms: 5, hints: 0 } },
      draft: toCode(LEVELS[4].picture),
    }
    expect(readSaved(JSON.stringify(saved))).toEqual(saved)
  })
  it('a damaged store loses only what is damaged', () => {
    const good = toCode(LEVELS[0].picture)
    const got = readSaved(
      JSON.stringify({
        kept: [
          { name: '', code: good },
          { name: 'x', code: 'nope' },
          'z',
          { name: 'y'.repeat(99), code: good },
        ],
        progress: { a: { m: '0123' }, b: { m: '1'.repeat(25), ms: 'x' }, c: 7, d: '1'.repeat(25) },
        solved: { a: { ms: 'x', hints: 1 }, b: { ms: 3.7, hints: -2 } },
        draft: '5x5.AAAAA',
      }),
    )
    expect(got.kept).toEqual([
      { name: 'Untitled', code: good },
      { name: 'y'.repeat(30), code: good },
    ])
    expect(got.progress).toEqual({ b: { m: '1'.repeat(25), ms: 0, hints: 0 } })
    expect(got.draft).toBeNull()
    expect(got.solved).toEqual({ b: { ms: 4, hints: 0 } })
    expect(readSaved('{')).toEqual(EMPTY_SAVED)
    expect(readSaved(null)).toEqual(EMPTY_SAVED)
    expect(readSaved('[1]')).toEqual(EMPTY_SAVED)
  })
  it('keeping refuses when full or already kept — it never drops an older one', () => {
    let s = EMPTY_SAVED
    const rand = rng(9)
    for (let i = 0; i < MAX_KEPT; i++) {
      const p = picture(6, 6, rand)
      p.cells[0] = 1
      s = keep(s, `n${i}`, toCode(p))!
      expect(s).not.toBeNull()
    }
    expect(keep(s, 'one more', toCode(LEVELS[0].picture))).toBeNull()
    expect(keep(EMPTY_SAVED, 'a', 'x')?.kept).toEqual([{ name: 'a', code: 'x' }])
    expect(keep(keep(EMPTY_SAVED, 'a', 'x')!, 'b', 'x')).toBeNull()
  })
  it('marks survive as text, and text of the wrong length is a fresh start', () => {
    const m = Uint8Array.from([0, 1, 2, 2, 1, 0])
    expect(marksFromText(marksToText(m), 6)).toEqual(m)
    expect(marksFromText('012', 6)).toEqual(new Uint8Array(6))
  })
})

describe('the stage', () => {
  it('fits the grid and its numbers inside the stage, and finds the cell under a point', () => {
    for (const l of LEVELS) {
      const { w, h } = l.picture
      for (const stage of [
        [686, 1040],
        [1180, 1120],
        [300, 240],
      ] as [number, number][]) {
        const f = fitBoard(stage, w, h, cluesOf(l.picture))
        expect(f.ox - f.left * f.s).toBeGreaterThanOrEqual(0)
        expect(f.oy - f.top * f.s).toBeGreaterThanOrEqual(0)
        expect(f.ox + w * f.s).toBeLessThanOrEqual(stage[0])
        expect(f.oy + h * f.s).toBeLessThanOrEqual(stage[1])
        expect(cellAt(f, w, h, [f.ox + 0.5, f.oy + 0.5])).toEqual([0, 0])
        expect(cellAt(f, w, h, [f.ox + w * f.s - 0.5, f.oy + h * f.s - 0.5])).toEqual([
          w - 1,
          h - 1,
        ])
        expect(cellAt(f, w, h, [f.ox - 1, f.oy])).toBeNull()
      }
    }
  })
  it('packs the clues where the shader looks for them', () => {
    const l = LEVELS[6]
    const { w, h } = l.picture
    const c = cluesOf(l.picture)
    const n = w * h
    const { data, offRows, offCols, offLines, stride } = pack(
      w,
      h,
      c,
      new Uint8Array(n),
      new Uint8Array(n),
      l.colours,
      { rows: c.rows.map((_, y) => y), cols: c.cols.map((_, x) => 100 + x) },
    )
    for (let y = 0; y < h; y++) {
      const k = data[offRows + y * stride]
      const read = Array.from({ length: k }, (_, j) => data[offRows + y * stride + 1 + j])
      expect(read).toEqual(c.rows[y].length ? c.rows[y] : [0])
    }
    expect(data[offCols + 3 * stride + 1]).toBe(c.cols[3][0])
    expect(data[offLines + 4]).toBe(4)
    expect(data[offLines + h + 2]).toBe(102)
    expect(data[2]).toBe(l.colours[0]) // a colour survives the float exactly: 24 bits fit
    expect(data.length).toBeLessThanOrEqual(MAX_FLOATS)
    expect(MAX_CLUES).toBe(10)
  })
})
