import { describe, it, expect } from 'vitest'
import {
  R2_FREE_A,
  R2_FREE_B,
  R2_FREE_GB_MONTH,
  R2_PER_GB_MONTH,
  R2_PER_M_A,
  R2_PER_M_B,
  r2Cost,
} from './r2Cost'

const GB = 1024 * 1024 * 1024

/**
 * What the Pictures (R2) card says it will cost.
 *
 * ⚠️ THE BROWSER PANE CANNOT ANSWER ANY OF THIS, which is the only reason the arithmetic was
 * lifted out of the JSX. The card needs an admin session the preview harness has not got, and
 * its figures come from a relay that does not run locally — so a screenshot of it proves the
 * component mounts and nothing more. These are written from the PRICE LIST rather than from the
 * function's own sums: "nothing is owed inside the allowance, and past it you pay the rate on the
 * excess" is a claim about money.
 *
 * ⚠️ MADE TO FAIL ONCE, 3 Nov 2026. Two perturbations, each a plausible slip: charging for the
 * whole figure instead of the excess (`gb * rate` rather than `max(0, gb - free) * rate`) turned
 * **5** red; and letting an unknown figure count as zero rather than propagating null turned
 * **3** red — and the two sets do not overlap, which is the asymmetry that matters. A wrong
 * tiered price is correct about every share and wrong only about the money; a null read as zero
 * is correct about every bill it can compute and wrong only about the ones it cannot.
 */
describe('r2Cost', () => {
  it('owes nothing inside every allowance', () => {
    expect(r2Cost({ bytes: 7_000_000, classA: 1_000, classB: 50_000 }).owed).toBe(0)
  })

  it('owes nothing at exactly the allowance, because free means up to and including', () => {
    const at = r2Cost({
      bytes: R2_FREE_GB_MONTH * GB,
      classA: R2_FREE_A,
      classB: R2_FREE_B,
    })
    expect(at.owed).toBe(0)
    expect(at.storageShare).toBe(1)
    expect(at.writeShare).toBe(1)
    expect(at.readShare).toBe(1)
  })

  /** the excess, never the whole figure — the commonest way to get a tiered price wrong */
  it('charges only what is past the allowance', () => {
    const over = r2Cost({
      bytes: (R2_FREE_GB_MONTH + 4) * GB,
      classA: R2_FREE_A + 500_000,
      classB: R2_FREE_B + 2_000_000,
    })
    expect(over.owed).toBeCloseTo(4 * R2_PER_GB_MONTH + 0.5 * R2_PER_M_A + 2 * R2_PER_M_B, 10)
  })

  it('prices each of the three on its own', () => {
    expect(r2Cost({ bytes: (R2_FREE_GB_MONTH + 1) * GB, classA: 0, classB: 0 }).owed).toBeCloseTo(
      R2_PER_GB_MONTH,
      10,
    )
    expect(r2Cost({ bytes: 0, classA: R2_FREE_A + 1_000_000, classB: 0 }).owed).toBeCloseTo(
      R2_PER_M_A,
      10,
    )
    expect(r2Cost({ bytes: 0, classA: 0, classB: R2_FREE_B + 1_000_000 }).owed).toBeCloseTo(
      R2_PER_M_B,
      10,
    )
  })

  /** writes cost twelve and a half times what reads do, which is why the split is worth making */
  it('keeps writes far more expensive than reads, as the price list has it', () => {
    const million = 1_000_000
    const writes = r2Cost({ bytes: 0, classA: R2_FREE_A + million, classB: 0 }).owed!
    const reads = r2Cost({ bytes: 0, classA: 0, classB: R2_FREE_B + million }).owed!
    expect(writes).toBeGreaterThan(reads * 10)
  })

  /**
   * ⚠️ AN UNKNOWN FIGURE MAKES THE BILL UNKNOWN, NOT SMALLER. This is the whole reason the type
   * carries nulls: a sum over two of three figures is a confident understatement, and "nothing to
   * pay" is the one sentence this card must not say by accident.
   */
  it('refuses to total a bill while any figure is unknown', () => {
    for (const hole of [
      { bytes: null, classA: 1, classB: 1 },
      { bytes: 1, classA: null, classB: 1 },
      { bytes: 1, classA: 1, classB: null },
      { bytes: undefined, classA: undefined, classB: undefined },
      {},
    ]) {
      expect(r2Cost(hole).owed).toBeNull()
    }
  })

  it('still reports the shares it does know while the total is unknown', () => {
    const half = r2Cost({ bytes: 5 * GB, classA: null, classB: R2_FREE_B / 2 })
    expect(half.owed).toBeNull()
    expect(half.storageShare).toBeCloseTo(0.5, 10)
    expect(half.writeShare).toBeNull()
    expect(half.readShare).toBeCloseTo(0.5, 10)
  })

  it('treats a non-finite figure as unknown rather than as a number', () => {
    expect(r2Cost({ bytes: NaN, classA: 1, classB: 1 }).owed).toBeNull()
    expect(r2Cost({ bytes: Infinity, classA: 1, classB: 1 }).storageShare).toBeNull()
  })

  /**
   * The site's real numbers on 3 Nov 2026, so the card's own figures can be checked against a
   * hand calculation rather than against itself: 31 pictures, 7,404,794 bytes, which is 0.0069 GB
   * — about seven hundredths of one per cent of the allowance. Nothing to pay, by a wide margin,
   * and that is the answer the card should be giving for a long time yet.
   */
  it('reports this site as nowhere near any allowance', () => {
    const now = r2Cost({ bytes: 7_404_794, classA: 2_000, classB: 40_000 })
    expect(now.owed).toBe(0)
    expect(now.storageShare! * 100).toBeLessThan(0.1)
    expect(now.writeShare!).toBeLessThan(0.01)
    expect(now.readShare!).toBeLessThan(0.01)
  })
})
