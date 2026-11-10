import { describe, expect, it } from 'vitest'
import {
  BOTS,
  COLS,
  EMPTY,
  HIDDEN,
  JUNK,
  KINDS,
  LOCK,
  ROWS,
  SENDS,
  bag,
  botHands,
  cellsOf,
  drop,
  fits,
  ghost,
  gravity,
  newWell,
  readSaved,
  receive,
  seeded,
  sent,
  shift,
  step,
  swap,
  turn,
  type Bot,
  type Kind,
  type Well,
} from './stack'

const only = (k: Kind) => (): Kind => k
const rowsUsed = (w: Well) => w.grid.filter((r) => r.some((c) => c)).length

describe('stackfall pieces', () => {
  it('every shape has four squares in every turn, and four turns come back to the start', () => {
    for (const k of KINDS)
      for (let r = 0; r < 4; r++) {
        const c = cellsOf(k, r)
        expect(new Set(c.map(([x, y]) => `${x},${y}`)).size, `${k} ${r}`).toBe(4)
        // the four squares touch: each is next to at least one other
        for (const [x, y] of c)
          expect(
            c.some(([a, b]) => Math.abs(a - x) + Math.abs(b - y) === 1),
            `${k} ${r}`,
          ).toBe(true)
      }
    for (const k of KINDS) expect(cellsOf(k, 4)).toEqual(cellsOf(k, 0))
  })
  it('the draw deals every shape once in each set of seven, the same for the same seed', () => {
    const d = bag(42)
    for (let set = 0; set < 20; set++) {
      const seven = Array.from({ length: 7 }, (_, i) => d(set * 7 + i))
      expect(new Set(seven).size, `set ${set}`).toBe(7)
    }
    const e = bag(42)
    expect(Array.from({ length: 30 }, (_, i) => e(i))).toEqual(
      Array.from({ length: 30 }, (_, i) => d(i)),
    )
  })
})

describe('stackfall rules', () => {
  it('a piece falls on gravity and locks half a second after it lands', () => {
    const w = newWell()
    step(w, 0, only('O'))
    const y0 = w.piece!.y
    step(w, gravity(0) + 1e-6, only('O'))
    expect(w.piece!.y).toBe(y0 + 1)
    // to the floor
    for (let i = 0; i < 1000 && w.drawn === 1; i++) step(w, 0.05, only('O'))
    expect(w.drawn).toBe(2)
    expect(w.grid[ROWS + HIDDEN - 1].filter(Boolean)).toHaveLength(2)
  })
  it('lock delay is measured from landing, and a slide while resting buys it back only so often', () => {
    const w = newWell()
    step(w, 0, only('T'))
    while (fits(w.grid, { ...w.piece!, y: w.piece!.y + 1 })) w.piece!.y++
    step(w, LOCK * 0.8, only('T'))
    expect(w.drawn).toBe(1)
    shift(w, 1)
    step(w, LOCK * 0.8, only('T'))
    expect(w.drawn, 'the slide reset the timer').toBe(1)
    // fidgeting forever does not keep it up forever
    for (let i = 0; i < 40 && w.drawn === 1; i++) {
      shift(w, i % 2 ? 1 : -1)
      step(w, LOCK * 0.6, only('T'))
    }
    expect(w.drawn).toBe(2)
  })
  it('a full row clears, and everything above it comes down one', () => {
    const w = newWell()
    const bottom = ROWS + HIDDEN - 1
    // nine of ten filled, with one square sitting above the gap's neighbour
    for (let x = 0; x < COLS; x++) if (x < 8) w.grid[bottom][x] = JUNK
    w.grid[bottom - 1][0] = JUNK
    step(w, 0, only('O'))
    while (shift(w, 1));
    drop(w, only('O'))
    expect(w.lines).toBe(1)
    expect(w.grid[bottom][0]).toBe(JUNK)
    expect(w.grid[bottom].filter(Boolean)).toHaveLength(3)
    expect(rowsUsed(w)).toBe(1)
  })
  it('the long piece turns against a wall instead of refusing', () => {
    const w = newWell()
    step(w, 0, only('I'))
    expect(turn(w, 1)).toBe(true)
    while (shift(w, -1));
    expect(turn(w, 1)).toBe(true)
    expect(fits(w.grid, w.piece!)).toBe(true)
  })
  it('the ghost is exactly where a drop puts the piece', () => {
    const w = newWell()
    step(w, 0, only('L'))
    turn(w, 1)
    shift(w, -2)
    const g = ghost(w)!
    const before = cellsOf(g.kind, g.rot).map(([x, y]) => [g.x + x, g.y + y])
    drop(w, only('L'))
    for (const [x, y] of before) expect(w.grid[y][x]).toBe(KINDS.indexOf('L') + 1)
  })
  it('hold swaps once per piece', () => {
    const w = newWell()
    const d = bag(1)
    step(w, 0, d)
    const first = w.piece!.kind
    swap(w, d)
    expect(w.hold).toBe(first)
    const second = w.piece!.kind
    swap(w, d)
    expect(w.piece!.kind, 'a second swap before locking is refused').toBe(second)
    drop(w, d)
    swap(w, d)
    expect(w.piece!.kind).toBe(first)
  })
  it('stacking straight up in the middle ends the game', () => {
    const w = newWell()
    let n = 0
    while (!w.over && n++ < 100) {
      step(w, 0, only('O'))
      drop(w, only('O'))
    }
    expect(w.over).toBe(true)
    // the middle columns are full to the top of the visible well
    expect(w.grid[HIDDEN][4]).not.toBe(0)
  })
  it('gets faster, and never faster than a row every 0.035 s', () => {
    for (let t = 0; t < 600; t += 10) expect(gravity(t + 10)).toBeLessThanOrEqual(gravity(t))
    expect(gravity(0)).toBeCloseTo(0.8)
    expect(gravity(75)).toBeCloseTo(0.4)
    expect(gravity(10_000)).toBe(0.035)
  })
})

describe('stackfall junk', () => {
  /** a well with n full-but-one rows at the bottom, gap in column 9, and an I piece to fill them */
  function ready(n: number) {
    const w = newWell()
    for (let i = 0; i < n; i++)
      for (let x = 0; x < COLS - 1; x++) w.grid[ROWS + HIDDEN - 1 - i][x] = JUNK
    step(w, 0, only('I'))
    turn(w, 1)
    while (shift(w, 1));
    return w
  }
  it('a clear of n sends the table’s junk across, and a single sends none', () => {
    for (const n of [1, 2, 3, 4]) {
      const w = ready(n)
      drop(w, only('I'))
      expect(w.lines, `${n}`).toBe(n)
      expect(sent(w), `${n}`).toBe(SENDS[n])
      expect(sent(w), 'taken once').toBe(0)
    }
  })
  it('junk rises when a piece locks without clearing, with its gap open', () => {
    const w = newWell()
    receive(w, 3, 4)
    step(w, 0, only('O'))
    drop(w, only('O'))
    const bottom = ROWS + HIDDEN - 1
    for (let i = 0; i < 3; i++) {
      expect(w.grid[bottom - i][4], `row ${i}`).toBe(0)
      expect(
        w.grid[bottom - i].filter((c) => c === JUNK),
        `row ${i}`,
      ).toHaveLength(COLS - 1)
    }
    // and the piece that locked sits on top of it
    expect(w.grid[bottom - 3].filter(Boolean)).toHaveLength(2)
  })
  it('a clear cancels junk on its way in before sending any', () => {
    const w = ready(4)
    receive(w, 3, 0)
    drop(w, only('I'))
    expect(sent(w)).toBe(1)
    expect(w.incoming).toEqual([])
  })
})

describe('stackfall computer', () => {
  /** a whole game with the computer at the keys, on a seeded draw */
  function play(bot: Bot, seconds: number, seed = 5) {
    const w = newWell()
    const d = bag(seed)
    const hands = botHands(bot, seeded(seed))
    const dt = 1 / 60
    for (let t = 0; t < seconds && !w.over; t += dt) {
      step(w, dt, d)
      hands(w, dt, d)
    }
    return w
  }
  it('the hard computer clears lines and survives two minutes of speeding up', () => {
    const w = play('hard', 120)
    expect(w.over).toBe(false)
    expect(w.lines).toBeGreaterThan(25)
  })
  it('easier computers clear fewer lines than harder ones over the same draw', () => {
    const lines = (Object.keys(BOTS) as Bot[]).map((b) => {
      let total = 0
      for (const seed of [3, 9, 27]) total += play(b, 90, seed).lines
      return total
    })
    expect(lines[0]).toBeLessThan(lines[2])
    expect(lines[1]).toBeLessThanOrEqual(lines[2])
  })
})

describe('stackfall saves', () => {
  it('round-trips every field set away from its default, and drops each one alone', () => {
    const s = {
      longest: 312.5,
      lines: 77,
      score: 41200,
      wins: { easy: 4, medium: 2, hard: 1 },
      losses: { easy: 1, medium: 3, hard: 9 },
    }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
    for (const k of Object.keys(s) as (keyof typeof s)[]) {
      const rest: Record<string, unknown> = structuredClone(s)
      delete rest[k]
      const back = readSaved(JSON.stringify(rest))
      expect(back[k], k).toEqual(EMPTY[k])
      for (const j of Object.keys(s) as (keyof typeof s)[])
        if (j !== k) expect(back[j], `${k}→${j}`).toEqual(s[j])
    }
  })
  it('a broken store loses only what is bad', () => {
    expect(readSaved('{')).toEqual(EMPTY)
    expect(
      readSaved(JSON.stringify({ longest: -1, lines: 3, wins: { easy: 'x', hard: 2 } })),
    ).toEqual({
      ...EMPTY,
      lines: 3,
      wins: { easy: 0, medium: 0, hard: 2 },
    })
  })
})
