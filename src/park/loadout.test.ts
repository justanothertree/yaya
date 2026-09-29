import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ALL_CASTS, castsFor, readLoadout, SLOTS, waitFor } from './loadout'
import { CAST, castFromSlot, castSlot, type CastKind } from './cast'

/**
 * The three you take in, as opposed to the three a boss was drawn with.
 *
 * ⚠️ THE BUG THIS EXISTS FOR IS UNREACHABILITY, NOT PREFERENCE. temperOf forks the ranged slot
 * on `paceN >= 0.52 ? 'bolt' : 'mark'`, so a creature gets a bolt OR a mark and never both —
 * which means a slow creature could not throw a bolt at all and its owner had no way to learn
 * that a bolt exists. Reported as "I'm not sure how to cast the bolt", about a creature that
 * did not have one.
 */

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  })
})

describe('a loadout off the disk', () => {
  it('is three of the kinds that exist', () => {
    expect(readLoadout(['bolt', 'wave', 'bloom'])).toEqual(['bolt', 'wave', 'bloom'])
  })

  it('and is refused when it is not', () => {
    expect(readLoadout(null)).toBeNull()
    expect(readLoadout('bolt')).toBeNull()
    expect(readLoadout([])).toBeNull()
    expect(readLoadout(['bolt', 'wave']), 'too few').toBeNull()
    expect(readLoadout(['bolt', 'wave', 'nonsense']), 'one that does not exist').toBeNull()
  })

  /**
   * ⚠️ DISTINCT, because two of the same is a slot spent on nothing — you would hold three
   * abilities and have two. It is also the one mistake a hand-edited localStorage can make that
   * still looks like a working loadout.
   */
  it('and never holds the same move twice', () => {
    expect(readLoadout(['bolt', 'bolt', 'wave'])).toBeNull()
    for (const k of ALL_CASTS) expect(readLoadout([k, k, k])).toBeNull()
  })
})

describe('what ends up in the belt', () => {
  it('is what you chose, when you chose', () => {
    expect(castsFor(['mark', 'wave', 'bloom'], ['bolt', 'bloom', 'wave'])).toEqual([
      'bolt',
      'bloom',
      'wave',
    ])
  })

  /**
   * ⚠️ NOT CHOOSING IS NOT A CHOICE OF NOTHING. Somebody who has never opened the picker plays
   * exactly the park they played yesterday, with the three their drawing rolled.
   */
  it('and what the drawing rolled, when you did not', () => {
    expect(castsFor(['mark', 'wave', 'bloom'], null)).toEqual(['mark', 'wave', 'bloom'])
  })

  it('and is always three, however little it was given', () => {
    for (const derived of [undefined, [], ['wave'] as CastKind[], ['wave', 'wave'] as CastKind[]]) {
      const out = castsFor(derived, null)
      expect(out, `from ${JSON.stringify(derived)}`).toHaveLength(SLOTS)
      expect(new Set(out).size, 'and never the same one twice').toBe(SLOTS)
      for (const k of out) expect(ALL_CASTS).toContain(k)
    }
  })

  /**
   * ⚠️ AND EVERY KIND IS REACHABLE, WHICH IS THE WHOLE POINT. Before this, a creature whose
   * pace fell under 0.52 had a mark and could never hold a bolt, whatever its owner did.
   */
  it('and any of the four can be had, whatever the drawing said', () => {
    for (const want of ALL_CASTS) {
      const slow: CastKind[] = ['mark', 'wave', 'bloom']
      const chosen = castsFor(slow, [want, ...ALL_CASTS.filter((k) => k !== want).slice(0, 2)])
      expect(chosen[0], `${want} could not be put on the first slot`).toBe(want)
    }
  })
})

describe('the waits', () => {
  it('are each one its own, not one shared between them', () => {
    const waits = ALL_CASTS.map(waitFor)
    expect(new Set(waits).size, 'they are not all the same number').toBeGreaterThan(1)
    for (const k of ALL_CASTS) expect(waitFor(k)).toBe(CAST[k].wait)
  })

  /**
   * ⚠️ AND THE CASTS THEMSELVES ARE THE FLOOR, WHICH I ONLY BELIEVED AFTER TRYING TO ADD ONE.
   * The note this feature overturned warned that separate cooldowns would mean "chain all
   * three, then wait", so I put a 0.7s lockout between casts — and this test pointed out it was
   * LONGER than the bolt's own 0.55s wait, which would have governed the cheap fast one by a
   * rule nobody can see.
   *
   * It was never needed: a cast holds you for CAST[kind].time and no other can start while one
   * runs, so throwing the whole kit already costs seconds of standing there. That is the window
   * a boss acts in, it is visible, and it was always there.
   */
  it('and the whole kit back to back still costs real seconds', () => {
    const slowest = ALL_CASTS.map((k) => CAST[k].time).sort((a, b) => b - a)
    const burst = slowest.slice(0, SLOTS).reduce((a, b) => a + b, 0)
    expect(burst, 'three casts are not three frames').toBeGreaterThan(3)
  })

  /**
   * ⚠️ AND NO WAIT IS SHORTER THAN THE CAST THAT EARNS IT for the earth-movers, so they cannot
   * be held down. The bolt is deliberately the exception — it is the one you rotate on.
   */
  it('and only the bolt comes back before the next one could be thrown', () => {
    const quick = ALL_CASTS.filter((k) => waitFor(k) < CAST[k].time)
    expect(quick).toEqual(['bolt'])
  })

  /** ⚠️ the bolt is the cheap fast one, and that is what makes it a primary worth holding */
  it('and the bolt comes back sooner than the earth-movers', () => {
    for (const k of ['bloom', 'mark', 'wave'] as CastKind[]) {
      expect(waitFor('bolt')).toBeLessThan(waitFor(k))
    }
  })
})

/**
 * ⚠️ A CAST TRAVELS AS ITS KIND, NEVER AS YOUR SLOT — which is the reason choosing a kit needs
 * no protocol change and no relay deploy. If this ever stopped being true, a peer would read
 * your first move as their first move and see the wrong attack entirely.
 */
describe('what the wire carries', () => {
  it('is the move itself, not where you put it', () => {
    for (const k of ALL_CASTS) expect(castFromSlot(castSlot(k))).toBe(k)
  })

  it('so two people who chose differently still see the same thing thrown', () => {
    const mine: CastKind[] = ['bolt', 'wave', 'bloom']
    const theirs: CastKind[] = ['bloom', 'bolt', 'wave']
    /* I throw my first, they throw their second: different slots, one kind, one number */
    expect(castSlot(mine[0])).toBe(castSlot(theirs[1]))
    expect(castFromSlot(castSlot(mine[0]))).toBe('bolt')
  })
})
