import { describe, expect, it } from 'vitest'
import { tempoFace } from './tempoFace'

describe('the speed, length and snap button', () => {
  it('reads all three values, so none of them is hidden behind it', () => {
    expect(tempoFace(104, 2, 0)).toBe('104 BPM · 2 bars · snap off')
    expect(tempoFace(90, 8, 16)).toBe('90 BPM · 8 bars · snap 1/16')
  })

  it('says bar, not bars, for a one-bar loop', () => {
    expect(tempoFace(120, 1, 4)).toBe('120 BPM · 1 bar · snap 1/4')
  })

  it("spells snap the way the sheet's own buttons do", () => {
    /* SnapPicker's faces: Off, 1/4, 1/8, 1/16 */
    for (const q of [4, 8, 16]) expect(tempoFace(100, 2, q)).toContain(`snap 1/${q}`)
  })
})
