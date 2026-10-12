import { describe, expect, it } from 'vitest'
import { furFrom, HAIR_MOST, LEAN_MOST } from './fur'
import { simplifyDrawing } from './strokes'
import type { Drawing, Stroke } from './strokes'

const line = (n: number): number[] => {
  const p: number[] = []
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    p.push(0.1 + t * 0.8, 0.5 + Math.sin(t * 7) * 0.12)
  }
  return p
}

const stroke = (p: number[]): Stroke => ({ t: 'fur', c: '#5a3', a: 1, w: 0.03, p })
const drawing = (p: number[]): Drawing => ({
  v: 1,
  name: 'Coat',
  ratio: 1,
  bg: null,
  strokes: [stroke(p)],
})

describe('a coat that lies the way your hand went', () => {
  it('says the same thing twice', () => {
    const p = line(120)
    expect(furFrom(p, 0.03)).toEqual(furFrom(p, 0.03))
  })

  /** ⚠️ in brush widths, asked of the constant that states it — see HAIR_MOST */
  it('and a hair is never longer than the brush would draw', () => {
    for (const w of [0.004, 0.012, 0.03, 0.08, 0.2]) {
      for (const h of furFrom(line(200), w)) {
        expect(h.len, `w ${w}`).toBeGreaterThan(0)
        expect(h.len, `w ${w}`).toBeLessThanOrEqual(HAIR_MOST * w)
      }
    }
  })

  /**
   * ⚠️ THE CLAIM THE WHOLE BRUSH RESTS ON. `turn` is measured from straight BACK, so a hair
   * inside a quarter turn is swept back and one outside it is standing up or leading the stroke.
   * A coat with hairs leading the hand reads as having been brushed the wrong way — which is the
   * difference between fur and a bottle brush, and the thing a sign error would produce.
   */
  it('and every hair sweeps back, never forward', () => {
    const hairs = furFrom(line(400), 0.03)
    expect(hairs.length, 'there is a coat to check').toBeGreaterThan(20)
    for (const h of hairs) {
      expect(Math.abs(h.turn)).toBeLessThanOrEqual(LEAN_MOST)
      expect(LEAN_MOST, 'and the spread itself stays inside a quarter turn').toBeLessThan(
        Math.PI / 2,
      )
    }
  })

  /** ⚠️ and it parts both ways — a coat leaning all one way is a comb, not fur */
  it('and lies to both sides of the line', () => {
    const hairs = furFrom(line(400), 0.03)
    expect(hairs.some((h) => h.turn < -0.05)).toBe(true)
    expect(hairs.some((h) => h.turn > 0.05)).toBe(true)
  })

  /**
   * ⚠️ POSITIONS ONLY, AND THE MODULE SAYS WHY. Thinning removes points, so a surviving hair must
   * still be the same hair in the same place at the same length — but its LAY comes from the
   * neighbouring points, which thinning also removes, so the angle follows the simplified path.
   * Promising the angle here would be promising something the renderer cannot deliver.
   */
  it('and thinning takes hairs away without moving the ones that stay', () => {
    const p = line(240)
    const full = new Set(furFrom(p, 0.03).map((h) => `${h.x},${h.y},${h.len},${h.turn}`))
    let everThinned = false
    for (const tol of [0.0005, 0.002, 0.008, 0.03]) {
      const thinned = simplifyDrawing(drawing(p), tol).strokes[0].p
      if (thinned.length < p.length) everThinned = true
      for (const h of furFrom(thinned, 0.03)) {
        expect(full.has(`${h.x},${h.y},${h.len},${h.turn}`), `tol ${tol}`).toBe(true)
      }
    }
    expect(everThinned, 'at least one tolerance really did thin it').toBe(true)
  })

  it('and no two hairs are the same length by design', () => {
    const lens = new Set(furFrom(line(300), 0.03).map((h) => h.len.toFixed(6)))
    expect(lens.size).toBeGreaterThan(3)
  })

  /** ⚠️ a slow hand lays a thicker coat, for the reason drip sheds more ink — see COAT */
  it('and a slow hand lays more of it than a quick one', () => {
    expect(furFrom(line(400), 0.03).length).toBeGreaterThan(furFrom(line(40), 0.03).length)
  })

  it('and refuses a width that is not one, and a point that is not a point', () => {
    for (const w of [0, -1, Number.NaN]) expect(furFrom(line(100), w)).toEqual([])
    for (const h of furFrom([0.2, 0.3, Number.NaN, 0.4, 0.5, 0.6], 0.03)) {
      expect(Number.isFinite(h.x) && Number.isFinite(h.y) && Number.isFinite(h.turn)).toBe(true)
    }
  })
})
