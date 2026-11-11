import { describe, expect, it } from 'vitest'
import {
  COLS,
  EMPTY,
  GUN,
  HEIGHT,
  LINE_Y,
  MIN_AIM,
  ROWS,
  WIDTH,
  centre,
  clearPoints,
  fallPoints,
  flight,
  group,
  hanging,
  neighbours,
  newGame,
  present,
  readSaved,
  rowAt,
  shoot,
  snap,
  swap,
  valid,
  width,
  type Game,
  type Saved,
} from './popper'

/** an empty board with bubbles put where asked, ready to fire `now` */
function board(put: [number, number, number][], now = 1, shift = false): Game {
  const g = newGame(4, 1)
  const cells = new Int8Array(g.cells.length)
  for (const [r, c, v] of put) cells[r * COLS + c] = v
  return { ...g, cells, shift, now, next: now, misses: 0, shots: 0, score: 0 }
}
const UP = Math.PI / 2
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y)
/** every aim from flat on the left to flat on the right, a degree apart */
const AIMS = Array.from({ length: 165 }, (_, i) => MIN_AIM + (i / 164) * (Math.PI - 2 * MIN_AIM))

describe('the grid', () => {
  it('packs every bubble exactly a bubble apart from each of its neighbours, either way round', () => {
    for (const shift of [false, true])
      for (let r = 0; r <= ROWS; r++)
        for (let c = 0; c < width(shift, r); c++) {
          const ns = neighbours(shift, r, c)
          // six inside the field, fewer at its edges
          expect(ns.length).toBeLessThanOrEqual(6)
          if (r > 0 && r < ROWS && c > 0 && c < width(shift, r) - 1) expect(ns).toHaveLength(6)
          for (const [a, b] of ns) {
            expect(dist(centre(shift, r, c), centre(shift, a, b))).toBeCloseTo(2, 9)
            // and the relation runs both ways
            expect(neighbours(shift, a, b)).toContainEqual([r, c])
          }
          // nothing else is that close
          for (let a = 0; a <= ROWS; a++)
            for (let b = 0; b < width(shift, a); b++)
              if ((a !== r || b !== c) && !ns.some(([x, y]) => x === a && y === b))
                expect(dist(centre(shift, r, c), centre(shift, a, b))).toBeGreaterThan(2.5)
          // and every bubble lies inside the walls
          const p = centre(shift, r, c)
          expect(p.x).toBeGreaterThanOrEqual(1)
          expect(p.x).toBeLessThanOrEqual(WIDTH - 1)
        }
    // the stylesheet gives the stage this shape by number (.bp-stage in lab.css)
    expect(WIDTH).toBe(22)
    expect(HEIGHT).toBeCloseTo(27.85, 2)
    expect(valid(false, 0, COLS)).toBe(false)
    expect(valid(false, 1, COLS - 1)).toBe(false)
  })
})

describe('a shot', () => {
  it('goes straight up to the ceiling from the middle, and settles touching it', () => {
    const g = board([])
    const f = flight(g, UP)
    expect(f.path[0]).toEqual(GUN)
    expect(f.cell?.[0]).toBe(0)
    const end = f.path[f.path.length - 1]
    expect(Math.abs(end.x - GUN.x)).toBeLessThanOrEqual(1)
  })
  it('bounces off a wall at the angle it came in, and lands on the far side', () => {
    const g = board([])
    // aimed low to the left: it meets the left wall, then crosses over
    const f = flight(g, Math.PI - 0.5)
    const wall = f.path[1]
    expect(wall.x).toBe(1)
    // the same rise either side of the bounce: as far up the wall as it travelled across to it
    const before = (GUN.y - wall.y) / (GUN.x - 1)
    expect(before).toBeCloseTo(Math.tan(0.5), 1)
    const after = f.path[2]
    expect(after.x).toBeGreaterThan(1)
    expect((wall.y - after.y) / (after.x - 1)).toBeCloseTo(Math.tan(0.5), 1)
  })
  it('stops on meeting a bubble and settles in an empty cell beside it', () => {
    for (const shift of [false, true]) {
      // a row of bubbles across the top, and one hanging below the middle
      const put: [number, number, number][] = []
      for (let c = 0; c < width(shift, 0); c++) put.push([0, c, 2])
      put.push([1, 5, 3])
      const g = board(put, 1, shift)
      for (const a of AIMS) {
        const { cell } = flight(g, a)
        expect(cell).not.toBeNull()
        const [r, c] = cell!
        expect(g.cells[r * COLS + c]).toBe(0)
        expect(neighbours(shift, r, c).some(([x, y]) => g.cells[x * COLS + y])).toBe(true)
      }
    }
  })
  it('stops on grazing a bubble, not only on striking it square', () => {
    // a bubble low in the middle, and a shot that passes a bubble-and-a-half to one side of it: the
    // two would overlap, so it must stop there rather than fly on to the ceiling
    const g = board([
      [0, 5, 2],
      [1, 5, 2],
      [2, 5, 2],
      [3, 5, 2],
      [4, 5, 2],
      [5, 5, 2],
    ])
    const b = centre(false, 5, 5)
    const angle = Math.atan2(GUN.y - b.y, b.x + 1.5 - GUN.x)
    const { cell } = flight(g, angle)
    expect(cell![0]).toBeGreaterThanOrEqual(4)
    expect(neighbours(false, cell![0], cell![1])).toContainEqual([5, 5])
  })
  it('settles only somewhere held: on the ceiling, or touching a bubble', () => {
    const g = board([[3, 4, 1]])
    // near the lone bubble, the cell beside it rather than a nearer empty one with nothing near
    const p = centre(false, 4, 4)
    const s = snap(g, { x: p.x, y: p.y + 0.3 })!
    expect(neighbours(false, s[0], s[1])).toContainEqual([3, 4])
    // and nothing settles in mid-air: on an empty board, only the top row
    const empty = board([])
    expect(snap(empty, centre(false, 6, 5))![0]).toBe(0)
  })
})

describe('popping', () => {
  it('pops three of a colour and not two, and drops what was hanging from them', () => {
    // two reds at the top, and a blue hanging from the second
    const g = board(
      [
        [0, 4, 1],
        [0, 5, 1],
        [1, 5, 2],
      ],
      1,
    )
    // fired straight up into the gap beside them
    const angle = AIMS.find((a) => {
      const c = flight(g, a).cell
      return c && c[0] === 0 && c[1] === 6
    })
    expect(angle).toBeDefined()
    const l = shoot(g, angle!)
    expect(l.popped).toHaveLength(3)
    expect(l.fell).toEqual([[1, 5]])
    // which cleared the board: points for that, and a fresh one
    expect(l.game.cleared).toBe(1)
    expect(l.gained).toBe(3 * 10 + fallPoints(1) + clearPoints(1))
    expect(present(l.game).length).toBeGreaterThan(0)
    // the bubble ready next was the colour just cleared: it becomes one still on the board
    const last = board(
      [
        [0, 4, 1],
        [0, 5, 1],
        [0, 0, 3],
      ],
      1,
    )
    const a3 = AIMS.find((a) => {
      const c = flight(last, a).cell
      return c && c[0] === 0 && c[1] === 6
    })
    const after = shoot({ ...last, next: 1 }, a3!).game
    expect(present(after)).toEqual([3])
    expect(after.now).toBe(3)
    expect(after.next).toBe(3)
    // two of a colour stay
    const two = board([[0, 4, 1]], 1)
    const a2 = AIMS.find((a) => {
      const c = flight(two, a).cell
      return c && c[0] === 0 && c[1] === 5
    })
    expect(shoot(two, a2!).popped).toHaveLength(0)
  })
  it('finds a group across the rows, and what hangs from nothing', () => {
    const g = board(
      [
        [0, 0, 1],
        [1, 0, 1],
        [2, 0, 1],
        [2, 1, 2],
        [4, 4, 3],
      ],
      1,
    )
    expect(group(g, 0, 0)).toHaveLength(3)
    expect(group(g, 2, 1)).toHaveLength(1)
    expect(hanging(g)).toEqual([[4, 4]])
  })
  it('pays for falling bubbles more the more fall, up to eight times as much', () => {
    expect(fallPoints(4)).toBe(80)
    expect(fallPoints(5)).toBe(200)
    expect(fallPoints(10)).toBe(800)
    expect(fallPoints(40)).toBe(40 * 20 * 8)
  })
})

describe('the ceiling', () => {
  it('brings a row down when the count fills, keeping every bubble beside its neighbours', () => {
    let g = newGame(5, 77)
    const before = present(g)
    // shots in a colour of their own — a different one each time, so they cannot pop each other
    // either — pop nothing: two each towards the count
    expect(rowAt(0)).toBe(8)
    let rows = 0
    for (let k = 0; k < 4; k++) {
      const top = g.cells.slice(0, COLS)
      const l = shoot({ ...g, now: 9 + k }, MIN_AIM)
      if (l.newRow) {
        rows++
        // the old top row is the second row now, unchanged
        expect([...l.game.cells.slice(COLS, 2 * COLS)].slice(0, width(l.game.shift, 1))).toEqual(
          [...top].slice(0, width(g.shift, 0)),
        )
        expect(l.game.shift).toBe(!g.shift)
      }
      g = l.game
    }
    expect(rows).toBe(1)
    expect(present(g).every((c) => before.includes(c) || c >= 9)).toBe(true)
    // the bar falls as the game goes on, never below two
    expect(rowAt(30)).toBe(7)
    expect(rowAt(10_000)).toBe(2)
  })
  it('ends the game when a bubble comes down past the line', () => {
    const put: [number, number, number][] = []
    for (let r = 0; r < ROWS; r++) put.push([r, 0, (r % 3) + 1])
    let g: Game = { ...board(put, 4), misses: 7 }
    expect(centre(false, ROWS - 1, 0).y).toBeLessThan(LINE_Y)
    expect(centre(false, ROWS, 0).y).toBeGreaterThan(LINE_Y)
    g = shoot(g, Math.PI - MIN_AIM).game
    expect(g.over).toBe(true)
    // and a game that is over takes no more shots
    expect(shoot(g, UP).game).toBe(g)
  })
})

describe('a game', () => {
  it('is the same from the same seed, and offers only colours still on the board', () => {
    const a = newGame(6, 1234)
    expect(newGame(6, 1234)).toEqual(a)
    expect(newGame(6, 1235).cells).not.toEqual(a.cells)
    let g = a
    for (let k = 0; k < 120 && !g.over; k++) {
      g = shoot(g, AIMS[(k * 37) % AIMS.length]).game
      if (present(g).length) expect(present(g)).toContain(g.now)
    }
    const fresh = newGame(6, 99)
    expect(swap(fresh)).toMatchObject({ now: fresh.next, next: fresh.now })
  })
  it('rewards aiming: trying every aim and taking the best outlasts aiming at random', () => {
    // measured on other games: random aim lasts about 17 shots with five colours, the best of every
    // aim about 180
    const play = (smart: boolean, seed: number) => {
      let g = newGame(5, seed)
      let k = 0
      while (!g.over && k < 60) {
        let a = AIMS[(seed * 31 + k * 53) % AIMS.length]
        if (smart) {
          let bv = -Infinity
          for (const x of AIMS.filter((_, i) => i % 3 === 0)) {
            const l = shoot(g, x)
            const v = l.gained - (l.newRow ? 5 : 0) - (l.game.over ? 1e9 : 0)
            if (v > bv) {
              bv = v
              a = x
            }
          }
        }
        g = shoot(g, a).game
        k++
      }
      return k
    }
    let smart = 0
    let blind = 0
    for (let s = 1; s <= 6; s++) {
      smart += play(true, s * 101)
      blind += play(false, s * 101)
    }
    expect(smart).toBe(6 * 60)
    expect(blind).toBeLessThan(6 * 35)
  }, 60_000)
})

describe('what is kept', () => {
  it('round-trips every field that is not a default', () => {
    const s: Saved = {
      colours: 6,
      look: 'night',
      guide: false,
      best: { 4: 1200, 5: 870, 6: 40 },
      games: 9,
    }
    for (const k of Object.keys(s) as (keyof Saved)[]) expect(s[k]).not.toEqual(EMPTY[k])
    expect(readSaved(JSON.stringify(s))).toEqual(s)
    expect(readSaved('{"colours":7,"look":"gold","guide":"no","best":{"5":-3}}')).toEqual(EMPTY)
  })
})
