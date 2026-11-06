import { describe, expect, it } from 'vitest'
import code from './bubbles.wgsl?raw'
import {
  BREAK_AT,
  BUBBLES,
  FILM_N,
  MAX_R,
  MIN_R,
  WAVELENGTHS,
  blow,
  filmColour,
  flingOf,
  hit,
  packBubbles,
  packFrame,
  popNote,
  stepBubbles,
  type Bubble,
} from './bubbles'
import { wgslLayout } from './wgslLayout'

describe('the shader and this file describe one film', () => {
  const wgsl = wgslLayout(code, 'Bubbles')

  it('agrees about where every field of the uniform lives', () => {
    const { bytes, ...table } = BUBBLES
    expect(wgsl.offsets).toEqual(table)
    expect(wgsl.bytes).toBe(bytes)
    const v = new DataView(packFrame(640, 480, 7, 2.5))
    expect([
      v.getUint32(0, true),
      v.getUint32(4, true),
      v.getUint32(8, true),
      v.getFloat32(12, true),
    ]).toEqual([640, 480, 7, 2.5])
  })

  it('agrees about soap water and the three wavelengths', () => {
    expect(code).toContain(`const FILM_N = ${FILM_N};`)
    expect(code).toContain(`vec3f(${WAVELENGTHS.map((l) => l.toFixed(1)).join(', ')})`)
  })

  it('packs each bubble where the shader reads it', () => {
    const b = { ...blow(10, 20, 3), r: 30, film: 700, popping: 0.25, held: false }
    expect([...packBubbles([b]).subarray(0, 7)]).toEqual([10, 20, 30, 3, 700, 0.25, 0])
  })
})

describe('the film', () => {
  it('turns black as it thins to nothing, as a bubble does just before it bursts', () => {
    for (const c of filmColour(5)) expect(c).toBeLessThan(0.02)
    expect(Math.max(...filmColour(BREAK_AT))).toBeLessThan(0.1)
  })

  it('reflects a colour fully where the film is a quarter of its wavelength, in the water', () => {
    // brightest when 2·n·d = λ/2: a quarter-wave film
    WAVELENGTHS.forEach((l, k) => expect(filmColour(l / (4 * FILM_N))[k]).toBeCloseTo(1, 9))
  })

  it('repeats every half-wavelength of thickness, so a draining film sweeps through the colours', () => {
    const d = 400
    WAVELENGTHS.forEach((l, k) =>
      expect(filmColour(d + l / (2 * FILM_N))[k]).toBeCloseTo(filmColour(d)[k], 9),
    )
  })

  it('shifts towards blue seen at a slant, as the path through the film shortens', () => {
    const straight = filmColour(300, 1)
    const slant = filmColour(300, 0.4)
    expect(slant).not.toEqual(straight)
  })
})

describe('bubbles', () => {
  const free = (o: Partial<Bubble>): Bubble => ({ ...blow(100, 100, 1), held: false, r: 30, ...o })

  it('grows on the finger that blows it, up to a limit', () => {
    let list = [blow(50, 50, 1)]
    for (let k = 0; k < 600; k++) list = stepBubbles(list, 1 / 60, 400, 400)
    expect(list[0].r).toBe(MAX_R)
    expect(list[0].r).toBeGreaterThan(MIN_R)
  })

  it('rises once let go, and drains until it bursts by itself', () => {
    let list = [free({ y: 300 })]
    for (let k = 0; k < 60; k++) list = stepBubbles(list, 1 / 60, 400, 400)
    expect(list[0].y).toBeLessThan(300)
    let n = 0
    while (list.length && n++ < 10000) list = stepBubbles(list, 1 / 60, 400, 400)
    expect(list.length).toBe(0)
  })

  it('stays inside the canvas, and pushes neighbours apart where they overlap', () => {
    let list = [
      free({ x: 100, y: 100 }),
      free({ x: 110, y: 100, seed: 2 }),
      free({ x: -50, y: 900, seed: 3 }),
    ]
    list = stepBubbles(list, 1 / 60, 400, 400)
    expect(Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y)).toBeGreaterThan(10)
    expect(list[2].x).toBeGreaterThanOrEqual(list[2].r)
    expect(list[2].y).toBeLessThanOrEqual(400 - list[2].r)
  })

  it('pops the front bubble a tap lands on, and nothing for a tap in the air', () => {
    const list = [free({ r: 80 }), free({ r: 20, seed: 2 })]
    expect(hit(list, 105, 100)).toBe(1)
    expect(hit(list, 170, 100)).toBe(0)
    expect(hit(list, 390, 390)).toBe(-1)
  })

  it('throws a released bubble the way the finger was going', () => {
    const [vx, vy] = flingOf([
      { x: 0, y: 0, t: 0 },
      { x: 50, y: -20, t: 100 },
    ])
    expect(vx).toBeGreaterThan(0)
    expect(vy).toBeLessThan(0)
    expect(flingOf([{ x: 1, y: 1, t: 0 }])).toEqual([0, 0])
  })

  it('sounds a big bubble lower than a small one', () => {
    expect(popNote(MAX_R)).toBeLessThan(popNote(MIN_R))
  })
})
