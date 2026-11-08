import { describe, expect, it } from 'vitest'
import {
  MAX_PIECES,
  PICTURE_ASPECT,
  PICTURES,
  REACH,
  SIZES,
  SLOT,
  SNAP,
  cut,
  deal,
  done,
  fit,
  fromSaved,
  grid,
  hint,
  hit,
  home,
  isEdge,
  members,
  move,
  owner,
  packKnobs,
  packPieces,
  placedCount,
  raise,
  readBests,
  readSaved,
  settle,
  table,
  tidy,
  toSaved,
  toTable,
  type Cuts,
  type Knob,
  type Puzzle,
} from './jigsaw'

const knobs = (c: Cuts): Knob[] => [...c.across, ...c.down]

describe('cutting', () => {
  it('every knob has a neck and a head: it crosses its edge by a sliver and reaches well past it', () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      const c = cut(8, 6, seed)
      for (const k of c.across) {
        const d = Math.abs(k.x - Math.round(k.x))
        expect(d).toBeLessThan(k.r) // it crosses the edge: there is a neck
        expect(2 * Math.sqrt(k.r * k.r - d * d)).toBeGreaterThan(0.12) // a neck you can see
        expect(d + k.r).toBeGreaterThan(0.28) // and a head well beyond it
        expect(d + k.r).toBeLessThanOrEqual(REACH) // no further than a piece is said to reach
      }
    }
  })

  it('a knob stays inside the two cells it joins, clear of their corners', () => {
    for (const seed of [4, 5, 6]) {
      const c = cut(10, 7, seed)
      for (const k of c.across) {
        const edge = Math.round(k.x)
        const row = Math.floor(k.y)
        expect(k.x - k.r).toBeGreaterThan(edge - 1)
        expect(k.x + k.r).toBeLessThan(edge + 1)
        expect(k.y - k.r).toBeGreaterThan(row + 0.1)
        expect(k.y + k.r).toBeLessThan(row + 0.9)
      }
      for (const k of c.down) {
        const edge = Math.round(k.y)
        const col = Math.floor(k.x)
        expect(k.x - k.r).toBeGreaterThan(col + 0.1)
        expect(k.x + k.r).toBeLessThan(col + 0.9)
        expect(k.y - k.r).toBeGreaterThan(edge - 1)
        expect(k.y + k.r).toBeLessThan(edge + 1)
      }
    }
  })

  it('no two knobs touch, so which piece owns a point never depends on the order they are asked', () => {
    const c = cut(12, 9, 77)
    const all = knobs(c)
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i]
        const b = all[j]
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.r + b.r)
      }
  })

  it('every piece is one piece: its knobs are joined to it, never floating loose', () => {
    const c = cut(6, 5, 2024)
    const step = 0.02
    const nx = Math.round(c.cols / step)
    const ny = Math.round(c.rows / step)
    const who = new Int32Array(nx * ny)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) who[j * nx + i] = owner(c, (i + 0.5) * step, (j + 0.5) * step)
    const seen = new Uint8Array(nx * ny)
    const components = new Map<number, number>()
    for (let s = 0; s < nx * ny; s++) {
      if (seen[s]) continue
      const k = who[s]
      components.set(k, (components.get(k) ?? 0) + 1)
      const stack = [s]
      seen[s] = 1
      while (stack.length) {
        const q = stack.pop()!
        const i = q % nx
        const j = (q - i) / nx
        for (const [di, dj] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const a = i + di
          const b = j + dj
          if (a < 0 || b < 0 || a >= nx || b >= ny) continue
          const t = b * nx + a
          if (!seen[t] && who[t] === k) {
            seen[t] = 1
            stack.push(t)
          }
        }
      }
    }
    expect(components.size).toBe(c.cols * c.rows)
    for (const n of components.values()) expect(n).toBe(1)
  })

  it('a piece is a cell give or take its four knobs, and together they cover the board once', () => {
    const c = cut(8, 6, 31)
    const area = new Float64Array(48)
    const step = 0.01
    for (let y = step / 2; y < c.rows; y += step)
      for (let x = step / 2; x < c.cols; x += step) area[owner(c, x, y)] += step * step
    // at most four knobs out, or four holes in, each no bigger than its whole circle
    const most = 4 * Math.PI * Math.max(...knobs(c).map((k) => k.r)) ** 2
    for (const a of area) {
      expect(a).toBeGreaterThan(1 - most)
      expect(a).toBeLessThan(1 + most)
    }
    expect(area.reduce((s, a) => s + a, 0)).toBeCloseTo(48, 1)
  })

  it('off the board belongs to nobody, and the board’s own edge is straight', () => {
    const c = cut(4, 3, 8)
    expect(owner(c, -0.01, 1)).toBe(-1)
    expect(owner(c, 4, 1)).toBe(-1)
    expect(owner(c, 2, -0.001)).toBe(-1)
    // along the outer edge there are no knobs: a point just inside belongs to its own cell
    for (let x = 0.05; x < 4; x += 0.1) expect(owner(c, x, 0.001)).toBe(Math.floor(x))
  })

  it('the same seed cuts the same puzzle, and another seed another', () => {
    expect(cut(6, 4, 5)).toEqual(cut(6, 4, 5))
    expect(cut(6, 4, 5)).not.toEqual(cut(6, 4, 6))
  })
})

describe('sizes and the table', () => {
  it('cuts near the asked number of pieces, keeping them square to the picture', () => {
    for (const n of SIZES) {
      const { cols, rows } = grid(n, PICTURE_ASPECT)
      expect(Math.abs(cols * rows - n) / n).toBeLessThan(0.1)
      expect(cols / rows).toBeGreaterThan(1.1)
      expect(cols / rows).toBeLessThan(1.6)
    }
    const tall = grid(48, 0.6)
    expect(tall.rows).toBeGreaterThan(tall.cols)
  })

  it('gives every piece its own slot, off the board and clear of it, on a table the stage’s shape', () => {
    for (const n of SIZES)
      for (const aspect of [0.55, 1, 1.78, 2.6]) {
        const { cols, rows } = grid(n, PICTURE_ASPECT)
        const t = table(cols, rows, aspect)
        expect(t.slots.length).toBeGreaterThanOrEqual(cols * rows)
        const ta = (t.x1 - t.x0) / (t.y1 - t.y0)
        expect(Math.abs(ta - aspect) / aspect).toBeLessThan(0.05)
        for (const [x, y] of t.slots) {
          // the whole piece, knobs included, stays on the table and off the board
          expect(x - REACH).toBeGreaterThanOrEqual(t.x0)
          expect(x + 1 + REACH).toBeLessThanOrEqual(t.x1)
          expect(y - REACH).toBeGreaterThanOrEqual(t.y0)
          expect(y + 1 + REACH).toBeLessThanOrEqual(t.y1)
          const off = x + 1 + REACH < 0 || x - REACH > cols || y + 1 + REACH < 0 || y - REACH > rows
          expect(off).toBe(true)
        }
        for (let i = 0; i < t.slots.length; i += 7)
          for (let j = i + 1; j < t.slots.length; j++)
            expect(
              Math.max(
                Math.abs(t.slots[i][0] - t.slots[j][0]),
                Math.abs(t.slots[i][1] - t.slots[j][1]),
              ),
            ).toBeGreaterThanOrEqual(SLOT - 1e-9)
      }
  })

  it('a point of the stage and a point of the table are one round trip', () => {
    const t = table(8, 6, 1.5)
    const f = fit(t, [900, 600])
    const p = toTable(f, [123, 456])
    expect(p[0] * f.s + f.ox).toBeCloseTo(123, 9)
    expect(p[1] * f.s + f.oy).toBeCloseTo(456, 9)
    // and the whole table is on the stage
    expect(t.x0 * f.s + f.ox).toBeGreaterThanOrEqual(-1e-9)
    expect(t.x1 * f.s + f.ox).toBeLessThanOrEqual(900 + 1e-9)
  })
})

const fresh = (cols = 4, rows = 3, seed = 7): Puzzle => {
  const c = cut(cols, rows, seed)
  return deal(c, table(cols, rows, 1.5), seed)
}

describe('picking a piece up', () => {
  it('is dealt one piece to a slot, none on the board, none touching another', () => {
    const p = fresh(8, 6)
    const seen = new Set(p.pieces.map((q) => `${q.x},${q.y}`))
    expect(seen.size).toBe(48)
    for (const q of p.pieces) expect(q.x + 1 < 0 || q.x > 8 || q.y + 1 < 0 || q.y > 6).toBe(true)
    // asked of the shapes themselves: across the table, no point is under two pieces
    const t = table(8, 6, 1.5)
    for (let y = t.y0; y < t.y1; y += 0.05)
      for (let x = t.x0; x < t.x1; x += 0.05) {
        let under = 0
        p.pieces.forEach((q, k) => {
          const [hc, hr] = home(p.cuts, k)
          if (owner(p.cuts, x - q.x + hc, y - q.y + hr) === k) under++
        })
        expect(under).toBeLessThanOrEqual(1)
      }
  })

  it('is picked up by its knob, not through its hole', () => {
    const p = fresh(4, 3, 11)
    // a piece that has a knob of its own on its right, and a hole somewhere
    for (const k of [...p.cuts.across]) {
      const mine = k.owner
      const theirs = mine % 4 === Math.round(k.x) - 1 ? mine + 1 : mine - 1
      const [hc, hr] = home(p.cuts, mine)
      const q = p.pieces[mine]
      // the far tip of the knob, carried to where the piece is now
      const dir = Math.sign(k.x - Math.round(k.x))
      const tip: [number, number] = [k.x + dir * k.r * 0.9 - hc + q.x, k.y - hr + q.y]
      expect(hit(p, tip[0], tip[1])).toBe(mine)
      // the same knob seen from the piece it bulges into: a hole there, so not that piece
      const [nc, nr] = home(p.cuts, theirs)
      const n = p.pieces[theirs]
      const hole: [number, number] = [k.x - nc + n.x, k.y - nr + n.y]
      expect(hit(p, hole[0], hole[1])).not.toBe(theirs)
    }
  })

  it('takes the topmost of two overlapping pieces, and raising changes which', () => {
    const p = fresh()
    p.pieces[3].x = p.pieces[5].x
    p.pieces[3].y = p.pieces[5].y
    const [hx, hy] = [p.pieces[5].x + 0.5, p.pieces[5].y + 0.5]
    const top = p.order.indexOf(3) > p.order.indexOf(5) ? 3 : 5
    expect(hit(p, hx, hy)).toBe(top)
    raise(p, p.pieces[top === 3 ? 5 : 3].group)
    expect(hit(p, hx, hy)).toBe(top === 3 ? 5 : 3)
  })
})

/** lay piece k beside piece n as it belongs, off by (ex, ey) */
const layBeside = (p: Puzzle, k: number, n: number, ex: number, ey: number) => {
  const [kc, kr] = home(p.cuts, k)
  const [nc, nr] = home(p.cuts, n)
  const q = p.pieces[k]
  move(p, q.group, p.pieces[n].x + kc - nc + ex - q.x, p.pieces[n].y + kr - nr + ey - q.y)
}

describe('joining and placing', () => {
  it('joins a piece laid close to its neighbour, exactly, and not one laid too far', () => {
    const p = fresh()
    layBeside(p, 1, 0, 0.2, -0.1)
    expect(settle(p, p.pieces[1].group).joined).toBe(1)
    expect(p.pieces[1].group).toBe(p.pieces[0].group)
    expect(p.pieces[1].x - p.pieces[0].x).toBeCloseTo(1, 12)
    expect(p.pieces[1].y - p.pieces[0].y).toBeCloseTo(0, 12)
    layBeside(p, 4, 0, SNAP + 0.02, 0)
    expect(settle(p, p.pieces[4].group).joined).toBe(0)
    expect(p.pieces[4].group).not.toBe(p.pieces[0].group)
  })

  it('a joined group moves as one, and joining one neighbour can bring the next into reach', () => {
    const p = fresh()
    layBeside(p, 1, 0, 0, 0)
    settle(p, p.pieces[1].group)
    // piece 2 already lies by piece 1's right; piece 4 is brought under piece 0. Settling 4 pulls
    // the pair onto it, and the pair arriving brings 2 with it — one release, two joins
    layBeside(p, 2, 1, 0.1, 0)
    layBeside(p, 4, 0, 0, 0.1)
    expect(settle(p, p.pieces[4].group).joined).toBe(2)
    expect(settle(p, p.pieces[2].group).joined).toBe(0)
    expect(members(p, p.pieces[0].group).sort()).toEqual([0, 1, 2, 4])
    const before = p.pieces.map((q) => [q.x, q.y])
    move(p, p.pieces[0].group, 3, 1)
    for (const k of [0, 1, 2, 4]) {
      expect(p.pieces[k].x).toBeCloseTo(before[k][0] + 3, 12)
      expect(p.pieces[k].y).toBeCloseTo(before[k][1] + 1, 12)
    }
  })

  it('fixes a group laid near its place on the board, and a fixed group does not move', () => {
    const p = fresh()
    const q = p.pieces[5]
    move(p, q.group, 1 + 0.15 - q.x, 1 - 0.1 - q.y)
    expect(settle(p, q.group).placed).toBe(true)
    expect([q.x, q.y]).toEqual([1, 1])
    move(p, q.group, 3, 3)
    expect([q.x, q.y]).toEqual([1, 1])
    // a loose piece laid against a fixed one joins it, in place
    layBeside(p, 6, 5, -0.1, 0.12)
    const s = settle(p, p.pieces[6].group)
    expect(s.placed).toBe(true)
    expect([p.pieces[6].x, p.pieces[6].y]).toEqual([2, 1])
    expect(placedCount(p)).toBe(2)
  })

  it('is done when every piece is in its place — and not one before', () => {
    const p = fresh(4, 3, 3)
    const order = [7, 0, 11, 4, 2, 9, 1, 5, 10, 3, 8, 6]
    order.forEach((k, i) => {
      expect(done(p)).toBe(false)
      const [hc, hr] = home(p.cuts, k)
      const q = p.pieces[k]
      move(p, q.group, hc + 0.1 * Math.cos(i) - q.x, hr + 0.1 * Math.sin(i) - q.y)
      settle(p, q.group)
    })
    expect(done(p)).toBe(true)
    expect(placedCount(p)).toBe(12)
    for (let k = 0; k < 12; k++) expect([p.pieces[k].x, p.pieces[k].y]).toEqual(home(p.cuts, k))
  })

  it('tidies the loose pieces with the edges nearest the board, and leaves joined ones alone', () => {
    const p = fresh(6, 4, 9)
    layBeside(p, 8, 7, 0, 0)
    settle(p, p.pieces[8].group)
    const joined = [p.pieces[7].x, p.pieces[7].y, p.pieces[8].x, p.pieces[8].y]
    tidy(p, table(6, 4, 1.5))
    expect([p.pieces[7].x, p.pieces[7].y, p.pieces[8].x, p.pieces[8].y]).toEqual(joined)
    const out = (k: number) => {
      const q = p.pieces[k]
      return Math.max(-q.x, q.x + 1 - 6, -q.y, q.y + 1 - 4, 0)
    }
    const loose = p.pieces.flatMap((_, k) => (k === 7 || k === 8 ? [] : [k]))
    const edge = loose.filter((k) => isEdge(p.cuts, k)).map(out)
    const inner = loose.filter((k) => !isEdge(p.cuts, k)).map(out)
    expect(Math.max(...edge)).toBeLessThanOrEqual(Math.min(...inner) + 1e-9)
  })
})

describe('a hint, and what the GPU is sent', () => {
  it('a hint puts one more piece in its place, and the puzzle can be finished by hints alone', () => {
    const p = fresh(4, 3, 5)
    let before = placedCount(p)
    for (let i = 0; i < 12 && !done(p); i++) {
      expect(hint(p)).toBeGreaterThanOrEqual(0)
      const now = placedCount(p)
      expect(now).toBeGreaterThan(before)
      before = now
    }
    expect(done(p)).toBe(true)
    expect(hint(p)).toBe(-1)
    // and every piece really is at home, not merely called placed
    p.pieces.forEach((q, k) => expect([q.x, q.y]).toEqual(home(p.cuts, k)))
  })

  it('packs a piece as (x, y, group, placed) at its own index, and knobs as (x, y, r, owner)', () => {
    const p = fresh(4, 3, 5)
    hint(p)
    raise(p, p.pieces[6].group)
    const { pieces, order } = packPieces(p)
    expect(pieces.length).toBe(48)
    p.pieces.forEach((q, k) => {
      expect(pieces[k * 4]).toBeCloseTo(q.x, 5)
      expect(pieces[k * 4 + 1]).toBeCloseTo(q.y, 5)
      expect(pieces[k * 4 + 2]).toBe(q.group)
      expect(pieces[k * 4 + 3]).toBe(p.placed.has(q.group) ? 1 : 0)
    })
    expect([...order]).toEqual(p.order)
    expect(order[order.length - 1]).toBe(6)
    const { across, down } = packKnobs(p.cuts)
    expect(across.length).toBe(4 * 3 * 3)
    expect(down.length).toBe(4 * 4 * 2)
    const k = p.cuts.down[5]
    expect([...down.slice(20, 24)]).toEqual([...Float32Array.from([k.x, k.y, k.r, k.owner])])
    // the biggest size fits the buffers
    const g = grid(150, PICTURE_ASPECT)
    expect(g.cols * g.rows).toBeLessThanOrEqual(MAX_PIECES)
  })
})

describe('kept in this browser', () => {
  const head = {
    picture: 'reef' as const,
    size: 96 as const,
    seed: 123456,
    aspect: 1.6,
    seconds: 754.9,
    hints: 3,
  }
  const played = () => {
    const { cols, rows } = grid(96, PICTURE_ASPECT)
    const c = cut(cols, rows, head.seed)
    const p = deal(c, table(cols, rows, head.aspect), head.seed)
    layBeside(p, 1, 0, 0.1, 0)
    settle(p, p.pieces[1].group)
    const q = p.pieces[20]
    move(p, q.group, home(c, 20)[0] - q.x, home(c, 20)[1] - q.y)
    settle(p, q.group)
    return p
  }

  it('round-trips a puzzle with every field off its default', () => {
    const p = played()
    const saved = toSaved(p, head)
    const back = readSaved(JSON.stringify(saved))
    expect(back).not.toBeNull()
    expect(back).toEqual({ ...saved, seconds: 754 })
    const q = fromSaved(back!)
    expect(q.cuts).toEqual(p.cuts)
    expect(q.placed).toEqual(p.placed)
    q.pieces.forEach((x, k) => {
      expect(x.group).toBe(p.pieces[k].group)
      expect(x.x).toBeCloseTo(p.pieces[k].x, 2)
      expect(x.y).toBeCloseTo(p.pieces[k].y, 2)
    })
  })

  it('refuses a kept puzzle missing any field, or with one out of bounds', () => {
    const good = toSaved(played(), head) as unknown as Record<string, unknown>
    for (const field of [
      'picture',
      'size',
      'seed',
      'aspect',
      'pieces',
      'placed',
      'seconds',
      'hints',
    ]) {
      const v = { ...good }
      delete v[field]
      expect(readSaved(JSON.stringify(v)), field).toBeNull()
    }
    const bad: Record<string, unknown>[] = [
      { picture: 'mona-lisa' },
      { size: 1000 },
      { seed: -1 },
      { seed: 1.5 },
      { aspect: 50 },
      { seconds: -3 },
      { hints: -1 },
      { hints: 1.5 },
      { hints: 5000 },
      { pieces: (good.pieces as unknown[]).slice(1) },
      { pieces: [[NaN, 0, 0], ...(good.pieces as unknown[]).slice(1)] },
      { pieces: [[1e9, 0, 0], ...(good.pieces as unknown[]).slice(1)] },
      { pieces: [[0, 0, 5000], ...(good.pieces as unknown[]).slice(1)] },
      { placed: [9999] },
      { placed: ['0'] },
    ]
    for (const b of bad)
      expect(
        readSaved(JSON.stringify({ ...good, ...b })),
        JSON.stringify(b).slice(0, 40),
      ).toBeNull()
    expect(readSaved('not json')).toBeNull()
    expect(readSaved(null)).toBeNull()
  })

  it('trusts "placed" over a position: a placed piece comes back home, under the loose ones', () => {
    const saved = toSaved(played(), head)
    const g = saved.placed[0]
    const k = saved.pieces.findIndex((q) => q[2] === g)
    saved.pieces[k] = [-3, -3, g]
    const q = fromSaved(readSaved(JSON.stringify(saved))!)
    expect([q.pieces[k].x, q.pieces[k].y]).toEqual(home(q.cuts, k))
    const firstLoose = q.order.findIndex((i) => !q.placed.has(q.pieces[i].group))
    for (const i of q.order.slice(firstLoose)) expect(q.placed.has(q.pieces[i].group)).toBe(false)
  })

  it('keeps best times for real pictures and sizes only', () => {
    const b = readBests(
      JSON.stringify({ 'dusk:48': 312, 'dusk:7': 5, 'mona:48': 9, 'city:12': -1, 'reef:150': 1.5 }),
    )
    expect(b).toEqual({ 'dusk:48': 312 })
    expect(readBests('nope')).toEqual({})
    expect(PICTURES.length).toBeGreaterThanOrEqual(6)
  })
})
