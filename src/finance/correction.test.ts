import { describe, expect, it } from 'vitest'
import { correctionWarning, decimalsOf, fullPrecision } from './correction'

/**
 * ⚠️ THE NUMBERS ARE LCID'S, from Part F of the 28 Oct review: a position of 253.783975 forced to
 * 253.78 by a correction typed from a broker screen. That is the case this file exists for, and
 * it is the one that must not pass silently.
 */
const LCID = 253.783975

describe('writing a held position out in full', () => {
  it('keeps every place the fund actually holds', () => {
    expect(fullPrecision(LCID)).toBe('253.783975')
  })

  /** ⚠️ `String(1e-7)` is "1e-7", which is not a number anybody can edit in a box */
  it('never falls back to exponent notation', () => {
    expect(fullPrecision(0.0000001)).not.toMatch(/e/i)
    expect(fullPrecision(1e21)).not.toMatch(/e/i)
  })

  it('trims trailing zeros rather than padding to six every time', () => {
    expect(fullPrecision(6)).toBe('6')
    expect(fullPrecision(3.5)).toBe('3.5')
  })

  /** the box is `min="0"`, and a negative position is the "oversold?" case, not a prefill */
  it('floors a negative position at zero', () => {
    expect(fullPrecision(-28)).toBe('0')
  })
})

describe('counting the decimals as TYPED', () => {
  it('reads what is in the box, not what the number rounds to', () => {
    expect(decimalsOf('253.78')).toBe(2)
    expect(decimalsOf('253.783975')).toBe(6)
    expect(decimalsOf('254')).toBe(0)
    expect(decimalsOf('253.780000')).toBe(6)
  })
})

describe('the warning before overwriting a position', () => {
  /**
   * ⚠️ THE LCID CASE. Shorter than what is held, and within a hundredth of it — a broker screen's
   * rounding pasted over the fund's own arithmetic. It must name both numbers, because the whole
   * failure is that they look the same at a glance.
   */
  it('warns when a shorter number is pasted over a longer one', () => {
    const w = correctionWarning(LCID, '253.78')
    expect(w).not.toBeNull()
    expect(w?.says).toMatch(/drops 4 decimal places/)
    expect(w?.because).toContain('253.783975')
    expect(w?.because).toContain('253.78')
    expect(w?.because).toMatch(/rounded/)
  })

  it('warns about a near-miss at the same precision too', () => {
    const w = correctionWarning(100.123456, '100.128456')
    expect(w).not.toBeNull()
    expect(w?.says).toMatch(/almost exactly/)
    expect(w?.because).toMatch(/split/)
  })

  it('says so when the number is identical', () => {
    expect(correctionWarning(LCID, '253.783975')?.says).toMatch(/already hold/)
  })

  /**
   * ⚠️ A REAL SPLIT MUST PASS WITHOUT A WORD. This tool exists for an export that missed a 1-for-10
   * — MYPS and GP both did — and a warning on the legitimate case is how a warning gets ignored.
   */
  it('says nothing about a genuine split', () => {
    expect(correctionWarning(1234.5, '123.45')).toBeNull()
    expect(correctionWarning(6, '30')).toBeNull()
    expect(correctionWarning(0, '12.5')).toBeNull()
  })

  it('says nothing about an empty or half-typed box', () => {
    expect(correctionWarning(LCID, '')).toBeNull()
    expect(correctionWarning(LCID, '   ')).toBeNull()
    expect(correctionWarning(LCID, 'abc')).toBeNull()
  })

  /**
   * ⚠️ BOTH ENDS OF THE BAND. A hundredth of a unit is the line; just under it warns and just over
   * it does not, or the threshold is decoration.
   */
  it('warns just inside a hundredth and stays quiet just outside it', () => {
    expect(correctionWarning(100, '100.009')).not.toBeNull()
    expect(correctionWarning(100, '100.02')).toBeNull()
  })
})
