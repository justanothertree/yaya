import { describe, expect, it } from 'vitest'
import { buzz, canVibrate, hapticsOn, offerVibration, PATTERNS, setHaptics } from './haptics'

/** a browser's storage and vibrator, kept in plain objects so the rules can be asked directly */
const storage = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init))
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  }
}
const phone = () => {
  const felt: Array<number | number[]> = []
  return { felt, vibrate: (p: number | number[]) => (felt.push(p), true) }
}

describe('vibration', () => {
  it('is off for anybody who has not turned it on', () => {
    const s = storage()
    const p = phone()
    expect(hapticsOn(s)).toBe(false)
    expect(buzz('stop', s, p)).toBe(false)
    expect(p.felt).toEqual([])
  })

  it('buzzes once turned on, with the pattern for that moment', () => {
    const s = storage()
    const p = phone()
    setHaptics(true, s)
    expect(buzz('stop', s, p)).toBe(true)
    expect(buzz('tap', s, p)).toBe(true)
    expect(p.felt).toEqual([[12, 60, 12], 10])
  })

  it('stops again when turned off', () => {
    const s = storage()
    const p = phone()
    setHaptics(true, s)
    setHaptics(false, s)
    expect(buzz('done', s, p)).toBe(false)
    expect(p.felt).toEqual([])
  })

  it('does nothing, and says so, on a device that cannot vibrate', () => {
    const s = storage({ haptics_v1: '1' })
    expect(canVibrate({})).toBe(false)
    expect(canVibrate(null)).toBe(false)
    expect(buzz('tap', s, {})).toBe(false)
  })

  it('is offered only on a touch device whose browser can vibrate', () => {
    expect(offerVibration(phone(), true)).toBe(true)
    /* desktop Chrome: the call exists, the motor does not */
    expect(offerVibration(phone(), false)).toBe(false)
    /* Safari on an iPhone: a touch device with no call */
    expect(offerVibration({}, true)).toBe(false)
  })

  it('reads storage it cannot read as off, and never throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    expect(hapticsOn(broken)).toBe(false)
    expect(() => setHaptics(true, broken)).not.toThrow()
    const p = {
      vibrate: () => {
        throw new Error('blocked')
      },
    }
    expect(buzz('tap', storage({ haptics_v1: '1' }), p)).toBe(false)
  })

  it('keeps every pattern short, because each one is only a confirmation', () => {
    for (const [k, v] of Object.entries(PATTERNS)) {
      const total = typeof v === 'number' ? v : v.reduce((a, b) => a + b, 0)
      expect(total, k).toBeLessThanOrEqual(150)
    }
  })
})
