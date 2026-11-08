import { describe, expect, it } from 'vitest'
import { duckVerdict } from './sound-probe.js'

/**
 * The one sentence anybody reads out of `ducking()`.
 *
 * ⚠️ THE VERDICT IGNORED THE GUARDS FOR AS LONG AS BOTH EXISTED, and the probe's own header is
 * where the rule against that is written down: "a checker that reports a stuck voice for a silent
 * room is the cry-wolf failure `mobile-audit.js` is built to avoid". The guards were there, they
 * were correct, they came back in the result — and `reading` was computed from `dB < -1` and
 * nothing else, so a run the guards had already refused printed the finding anyway.
 *
 * ⚠️ WHAT IS PINNED HERE IS THE DECISION, NOT THE RUN. A whole `ducking()` needs a browser, an
 * instrument with a four-layer backing loaded, and ninety seconds of pressing and settling — so
 * it cannot be a unit test, and the fault was never in the pressing. It was in one line choosing
 * what the numbers were allowed to mean. `mobile-audit.test.mjs` exists for the same reason and
 * on the same terms: the rule moves out where something can call it, the browser keeps the DOM.
 *
 * ⚠️ AND THE GREEN FIXTURE IS LOAD-BEARING IN A WAY THAT IS EASY TO MISS. A guard added to
 * `DUCK_GUARDS` and not added to `green()` reads `undefined`, fails its `=== true`, and turns the
 * green run VOID — so "lets a run with every guard green say what it measured" goes red until the
 * fixture names it. That is the hand-maintained-list problem solved by the list being asked
 * rather than copied: there is no second place to remember.
 */

/**
 * The 7 Nov 2026 run that WAS entitled to its verdict — every guard green, after the room had
 * settled. The levels and both dB figures are that run's; the two settled readings are what a
 * quiet room answers, which is 0 or a whisker above it.
 */
const green = () => ({
  alone: 0.5255,
  overSilentBacking: 0.6143,
  dB: 1.36,
  guards: {
    quietBefore: 0,
    quietBetween: 0.0043,
    backingPeak: 0,
    backingReallySilent: true,
    aloneAgain: 0.5255,
    repeatable: true,
    overLoadedButStopped: 0.5255,
    controlDb: 0,
    controlIsFlat: true,
  },
})

const withGuards = (over) => {
  const r = green()
  return { ...r, guards: { ...r.guards, ...over } }
}

/**
 * One fault each, so a guard that stops being consulted is named rather than merely counted.
 *
 * Each pair keeps the result internally consistent — `repeatable` really is false for that pair
 * of levels (0.3245 against 0.5255 is 38% apart, and 0.3245 is this file's own recorded figure
 * for the first press after a backing is built), and `controlDb: -2.61` is the review run's.
 */
const oneFaultEach = [
  ['quietBefore', { quietBefore: null }],
  ['quietBetween', { quietBetween: null }],
  ['backingReallySilent', { backingPeak: 0.4182, backingReallySilent: false }],
  ['repeatable', { aloneAgain: 0.3245, repeatable: false }],
  ['controlIsFlat', { controlDb: -2.61, controlIsFlat: false }],
]

describe('duckVerdict', () => {
  it('lets a run with every guard green say what it measured', () => {
    const v = duckVerdict(green())
    expect(v.refused).toBeUndefined()
    expect(v.reading).toBe('no ducking from a silent backing')
  })

  it('still reports a real duck, which is the finding this probe exists for', () => {
    /* the bug as it was measured before the fix, and the numbers in `busGain`'s own note:
       0.5334 for the key alone against 0.2879 with a backing that made no sound at all */
    const v = duckVerdict({
      ...green(),
      alone: 0.5334,
      overSilentBacking: 0.2879,
      dB: -5.36,
      guards: { ...green().guards, aloneAgain: 0.5334, overLoadedButStopped: 0.5334 },
    })
    expect(v.refused).toBeUndefined()
    expect(v.reading).toBe('your hands are ducked by a backing that cannot be heard')
  })

  it('refuses the reading when the null control was ducked as hard as the finding', () => {
    /**
     * ⚠️ THE RUN THIS FILE IS FOR. First `ducking()` of a release review, 7 Nov 2026:
     * `repeatable: false`, `controlIsFlat: false`, `controlDb: -2.61` — the null control ducked
     * within 0.07dB of the finding, so the probe had measured its own machinery and nothing was
     * learned. It printed "your hands are ducked by a backing that cannot be heard" regardless.
     */
    const v = duckVerdict(
      withGuards({ aloneAgain: 0.3245, repeatable: false, controlDb: -2.61, controlIsFlat: false }),
    )
    expect(v.refused).toEqual(['repeatable', 'controlIsFlat'])
    expect(v.reading).toContain('VOID')
    expect(v.reading).toContain('measuring its own machinery')
    expect(v.reading).not.toContain('your hands are ducked')
  })

  for (const [name, fault] of oneFaultEach) {
    it(`refuses it, and names ${name}, when that guard alone refuses it`, () => {
      const v = duckVerdict(withGuards(fault))
      /* exactly one, so a guard that fires on a healthy room fails here too */
      expect(v.refused).toEqual([name])
      expect(v.reading).toContain('VOID')
      expect(v.reading).not.toContain('your hands are ducked')
      expect(v.reading).not.toContain('no ducking from a silent backing')
    })
  }

  it('treats a perfectly settled room as a pass, not as a missing reading', () => {
    /* ⚠️ `untilQuiet` answers with the LEVEL it settled at, and 0 is the best answer available.
       A truthy test would void every good run — the same mistake with its sign flipped, and the
       one that would have made this fix worse than the bug. */
    const v = duckVerdict(withGuards({ quietBefore: 0, quietBetween: 0 }))
    expect(v.refused).toBeUndefined()
    expect(v.reading).toBe('no ducking from a silent backing')
  })

  it('says the key made no sound before any guard gets a word in', () => {
    /* ⚠️ ORDER. `repeatable` folds `sound` into itself, so a dead key fails that guard too —
       true, and not the thing worth saying about a key that never sounded. */
    for (const dead of [
      withGuards({ aloneAgain: 0, repeatable: false }),
      { ...green(), alone: 0 },
      {},
    ]) {
      const v = duckVerdict(dead)
      expect(v.reading).toBe('no sound from the key at all — nothing here is a measurement')
      expect(v.refused).toBeUndefined()
    }
  })

  it('calls a key silenced completely the worst duck there is, not the absence of one', () => {
    /* ⚠️ `dBof` answers null when the key read a flat 0 over the backing, and `null < -1` is
       false — so the one case where the fault is total used to read as "no ducking". */
    const v = duckVerdict({ ...green(), overSilentBacking: 0, dB: null })
    expect(v.reading).toBe('the key was silenced completely by a backing that cannot be heard')
  })
})
