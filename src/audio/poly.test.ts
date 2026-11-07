import { describe, expect, it } from 'vitest'
import { BUS_CEILING, LIMIT_AT, busGain, levelAt, polyGain, soundingSum } from './poly'
import type { Ringing } from './poly'

/**
 * The polyphony scaler, asked the question it was getting wrong.
 *
 * ⚠️ EVERY EXPECTATION HERE IS WRITTEN FROM WHAT THE ROOM DOES, NEVER FROM WHAT poly.ts
 * COMPUTES, because a test built from the same sum as the code confirms the mistake — this
 * repository has the park's `across(PARK_TALL)` and the fissure's `gap > r + r` as two standing
 * examples of exactly that. So the fixtures below are FLAT voices: attack and decay of a tenth of
 * a millisecond and a sustain equal to the peak, which means a fixture's contribution is its
 * `peak` times its fader and nothing else. `heard()` adds those up with two multiplications
 * anybody can check by eye, and the claims are then about the WORLD — "a thing making no sound
 * takes nothing off anything else", "what reaches the limiter is held at the threshold" — rather
 * than about `LIMIT_AT / sum`.
 *
 * The envelope-shaped fixtures are kept for the one describe that is about envelopes.
 */

/** A voice that holds one level for as long as it is down. No envelope to reason about. */
const flat = (part: string, level: number, at = 0): Ringing => ({
  at,
  a: 0.0001,
  d: 0.0001,
  peak: level,
  target: level,
  tau: 1,
  off: Infinity,
  until: Infinity,
  part,
})

/** The faders, as a function of part — and 0 for a part with no bus, which is silence. */
const faders =
  (m: Record<string, number>) =>
  (part: string): number =>
    m[part] ?? 0

/**
 * What the room is actually sending, worked out by hand.
 *
 * One multiplication per flat voice — its level by its fader — with the fader clamped the way a
 * slider past the end of its travel is clamped. Nothing from poly.ts is involved, which is the
 * whole point: if this and `polyGain` ever disagree, one of them is wrong and the test says which
 * side the disagreement is on.
 */
const heard = (rings: Ringing[], m: Record<string, number>): number =>
  rings.reduce((sum, r) => {
    const f = Math.min(BUS_CEILING, Math.max(0, m[r.part] ?? 0))
    return sum + r.peak * f
  }, 0)

const dB = (ratio: number) => 20 * Math.log10(ratio)

/** your own hands: one key, at a level no single patch exceeds, so nothing ducks it on its own */
const hand = () => flat('live', 0.6)

/** the four-layer backing the pane probe uses — chords, bass, fill and a drum part */
const backing = () => [flat('L1', 0.6), flat('L2', 0.55), flat('L3', 0.5), flat('L4', 0.45)]

const ALL_OFF = { live: 1, L1: 0, L2: 0, L3: 0, L4: 0 }
const ALL_UP = { live: 1, L1: 1, L2: 1, L3: 1, L4: 1 }

describe('a backing that cannot be heard cannot duck your hands', () => {
  /**
   * ⚠️ THE BUG, STATED AS THE PROBE STATES IT. Measured in the Browser pane on 7 Nov 2026 with
   * the real four-layer backing and every fader dragged to 0 — the room silent to 0.0013, the
   * null control flat to the last digit, the alone reading repeating afterwards exactly — a held
   * C4 went from **0.5312 to 0.2831**, which is **-5.47dB of ducking from nothing at all**.
   */
  it('takes nothing off them at all', () => {
    const alone = polyGain([hand()], 1, faders({ live: 1 }))
    const over = polyGain([hand(), ...backing()], 1, faders(ALL_OFF))
    expect(dB(over / alone)).toBe(0)
    expect(over).toBe(1)
  })

  /**
   * ⚠️ AND THE CONTROL, which is what makes the line above a result rather than a tautology. The
   * same four layers at the same moment with their faders UP really would have ducked those
   * hands, and hard — so "no change" is a fact about the faders and not about a fixture that
   * could never have ducked anything.
   */
  it('and the same four layers audible really would have', () => {
    const over = polyGain([hand(), ...backing()], 1, faders(ALL_UP))
    expect(over).toBeLessThan(1)
    expect(dB(over)).toBeLessThan(-6)
  })

  it('counts a part with no bus as silent, the same as a fader at zero', () => {
    /* a muted layer is never scheduled at all, and an evicted bus is disconnected — either way
       there is no fader to read and nothing to hear */
    const withNoBus = polyGain([hand(), ...backing()], 1, faders({ live: 1 }))
    expect(withNoBus).toBe(1)
  })

  it('still ducks when it is your own hands that are too loud', () => {
    /* the fix must not become "nothing ever ducks": five keys at once is the case the scaler was
       written for, and the live part has no fader to be turned down */
    const keys = [0, 1, 2, 3, 4].map((n) => flat('live', 0.6, n * 0.0001))
    const g = polyGain(keys, 1, faders({ live: 1 }))
    expect(g).toBeLessThan(1)
    expect(g * heard(keys, { live: 1 })).toBeCloseTo(LIMIT_AT, 12)
  })
})

describe('the sum is measured in the same unit as the signal', () => {
  /**
   * ⚠️ THE INVARIANT THE BUG BROKE, and the one worth having even if every other test here went.
   * A fader at a half must duck exactly like a patch half as loud, because those are the same
   * signal — and the broken version made them different by a factor of two.
   */
  it('a fader at half ducks like a patch half as loud', () => {
    for (const f of [0, 0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5]) {
      const viaFader = polyGain([hand(), flat('L1', 0.8)], 1, faders({ live: 1, L1: f }))
      const viaLevel = polyGain([hand(), flat('L1', 0.8 * f)], 1, faders({ live: 1, L1: 1 }))
      expect(viaFader).toBeCloseTo(viaLevel, 12)
    }
  })

  /**
   * ⚠️ THE SCALER'S WHOLE PROMISE, checked against a sum written out by hand. It holds what is
   * sounding at the limiter's threshold and otherwise does nothing — so below the threshold the
   * answer must be exactly 1 (one note and two notes are at FULL level, which is the complaint
   * the 1/sqrt(n) version earned), and above it the product must land on the threshold rather
   * than somewhere under it.
   */
  it('holds what reaches the limiter at the threshold, and never over it', () => {
    const cases: [Ringing[], Record<string, number>][] = [
      [[hand()], { live: 1 }],
      [[hand(), ...backing()], ALL_OFF],
      [[hand(), ...backing()], ALL_UP],
      [[hand(), ...backing()], { live: 1, L1: 0.4, L2: 0.5, L3: 0.55, L4: 0.55 }],
      [[hand(), ...backing()], { live: 1, L1: 2, L2: 2, L3: 2, L4: 2 }],
      [[hand(), ...backing()], { live: 1, L1: 0, L2: 0, L3: 0, L4: 1 }],
      [backing(), ALL_UP],
      [[flat('L1', 0.2)], { L1: 1 }],
      [[], {}],
    ]
    for (const [rings, m] of cases) {
      const g = polyGain([...rings], 1, faders(m))
      const signal = heard(rings, m) * g
      expect(signal).toBeLessThanOrEqual(LIMIT_AT + 1e-12)
      if (heard(rings, m) > LIMIT_AT) expect(signal).toBeCloseTo(LIMIT_AT, 12)
      else expect(g).toBe(1)
    }
  })

  it('is one number for the whole room, so it never changes the balance between layers', () => {
    /* the scaler is pushed to every bus at the same value — two layers an octave apart in level
       keep that ratio whatever it does, and the faders own the balance */
    const rings = [flat('L1', 0.6), flat('L2', 0.3)]
    const m = { L1: 1, L2: 1 }
    const g = polyGain([...rings], 1, faders(m))
    expect((0.6 * g) / (0.3 * g)).toBeCloseTo(2, 12)
  })
})

describe('moving a fader is heard without waiting for the next note', () => {
  /**
   * ⚠️ THE TRANSIENT FORM OF THE SAME BUG, and the reason `Ringing` stores a part key rather than
   * a copy of the gain. `setLayerGain` rides the bus, so it takes effect on whatever is already
   * ringing — a gain snapshotted at note-on would keep ducking your hands for as long as the
   * longest note already sounding, which on a pad layer is a whole bar.
   */
  it('pulling a backing down hands the headroom straight back', () => {
    const rings = [hand(), ...backing()]
    const ducked = polyGain(rings, 1, faders(ALL_UP))
    /* the SAME rings — nothing re-struck, nothing released */
    const released = polyGain(rings, 1, faders(ALL_OFF))
    expect(ducked).toBeLessThan(1)
    expect(released).toBe(1)
  })

  it('and pushing it back up ducks again, by exactly as much as before', () => {
    const rings = [hand(), ...backing()]
    const first = polyGain(rings, 1, faders(ALL_UP))
    /* ⚠️ WITHOUT THIS LINE THE TEST PASSES ON A CONSTANT, which is how it read when it was
       first written: three identical answers satisfy "back to where it was" even when the answer
       is identical because the faders are being ignored. Perturbing the sum proved it green. */
    expect(first).toBeLessThan(1)
    expect(polyGain(rings, 1, faders(ALL_OFF))).toBe(1)
    expect(polyGain(rings, 1, faders(ALL_UP))).toBe(first)
  })

  it('follows a fader through every position in order', () => {
    const rings = [hand(), ...backing()]
    const sweep = [0, 0.25, 0.5, 1, 1.5, 1, 0.5, 0.25, 0]
    const got = sweep.map((f) =>
      polyGain(rings, 1, faders({ live: 1, L1: f, L2: f, L3: f, L4: f })),
    )
    /* down the way up: the only thing that moved is the fader, so the curve has to be symmetric */
    expect(got.slice(0, 5)).toEqual([...got.slice(4)].reverse())
    /* and it only ever goes one way as the faders come up */
    for (let i = 1; i < 5; i++) expect(got[i]).toBeLessThanOrEqual(got[i - 1])
    /* ⚠️ AND IT HAS TO HAVE MOVED AT ALL. Symmetry and monotonicity are both satisfied by
       a flat line, so without this the whole sweep passed with the faders ignored. */
    expect(got[0]).toBe(1)
    expect(got[4]).toBeLessThan(got[0])
  })
})

describe('a fader past the end of its travel', () => {
  it('stops where the bus stops, and the sum stops there with it', () => {
    expect(busGain(undefined)).toBe(1)
    expect(busGain(0)).toBe(0)
    expect(busGain(0.5)).toBe(0.5)
    expect(busGain(1)).toBe(1)
    expect(busGain(BUS_CEILING)).toBe(BUS_CEILING)
    /* setLayerGain clamps to 2 and the bus to 1.5 — see BUS_CEILING, and OPEN-DECISIONS §11c */
    expect(busGain(2)).toBe(BUS_CEILING)
    expect(busGain(1e9)).toBe(BUS_CEILING)
    expect(busGain(Infinity)).toBe(BUS_CEILING)
  })

  it('ducks at the top of the slider exactly as it does at the ceiling', () => {
    const rings = [hand(), ...backing()]
    const atTwo = polyGain(rings, 1, faders({ live: 1, L1: 2, L2: 2, L3: 2, L4: 2 }))
    const atCeiling = polyGain(
      rings,
      1,
      faders({ live: 1, L1: BUS_CEILING, L2: BUS_CEILING, L3: BUS_CEILING, L4: BUS_CEILING }),
    )
    expect(atTwo).toBe(atCeiling)
  })

  it('treats a negative or corrupt fader as silence rather than passing it on', () => {
    /* a NaN on a gain node is already silence, so nothing is lost by saying so here — and a NaN
       in the SUM would be a NaN pushed onto every bus, which silences the whole instrument */
    expect(busGain(-1)).toBe(0)
    expect(busGain(-0)).toBe(0)
    expect(busGain(NaN)).toBe(0)
    expect(busGain(-Infinity)).toBe(0)
  })

  it('never answers anything but a finite gain in (0, 1]', () => {
    const odd = [undefined, NaN, Infinity, -Infinity, -1, -0, 0, 1e-9, 0.5, 1, 1.5, 2, 1e9]
    for (const a of odd)
      for (const b of odd) {
        const g = polyGain(
          [hand(), flat('L1', 0.8), flat('L2', 0.7)],
          1,
          (part) => (part === 'live' ? 1 : part === 'L1' ? (a as number) : (b as number)) as number,
        )
        expect(Number.isFinite(g)).toBe(true)
        expect(g).toBeGreaterThan(0)
        expect(g).toBeLessThanOrEqual(1)
      }
  })
})

describe('what a voice contributes follows its own envelope', () => {
  /**
   * ⚠️ THE BELL CASE, kept because it is the other way this sum has been wrong. Bell is a
   * one-shot — decay 2.4s, release 1.4s, sustain zero — and the first version of the scaler
   * counted its full 0.4 for the whole 3.8 seconds its entry lived, so four bell notes summed to
   * 1.6 and pulled the room down to 0.44 on the strength of level that had decayed away a second
   * earlier.
   */
  const bell = (part = 'live'): Ringing => ({
    at: 0,
    a: 0.004,
    d: 2.4,
    peak: 0.4,
    target: 0.0001,
    tau: 0.28,
    off: Infinity,
    until: 3.8,
    part,
  })

  it('falls away as the note decays', () => {
    const b = bell()
    const early = levelAt(b, 0.05)
    const middle = levelAt(b, 1)
    const late = levelAt(b, 2.2)
    expect(early).toBeGreaterThan(middle)
    expect(middle).toBeGreaterThan(late)
    expect(early).toBeLessThanOrEqual(0.4)
    expect(late).toBeLessThan(0.01)
  })

  it('so four of them stop ducking the room once they have died', () => {
    const four = [0, 1, 2, 3].map(() => bell())
    expect(polyGain([...four], 0.05, faders({ live: 1 }))).toBeLessThan(1)
    expect(polyGain([...four], 2.2, faders({ live: 1 }))).toBe(1)
  })

  it('counts nothing before it starts', () => {
    expect(levelAt(bell(), -1)).toBe(0)
    expect(levelAt(bell(), 0)).toBe(0)
  })

  it('and a fader scales the whole envelope, not just its peak', () => {
    /* the fader is a multiplication downstream of the voice, so it applies to the tail as much
       as to the attack — half a fader is half the contribution at every instant */
    for (const t of [0.002, 0.05, 0.5, 1, 2, 3]) {
      const full = soundingSum([bell('L1')], t, () => 1)
      const half = soundingSum([bell('L1')], t, () => 0.5)
      expect(half).toBeCloseTo(full / 2, 12)
    }
  })

  it('drops an entry whose time is up, so the room hands its headroom back', () => {
    const rings = [bell('L1'), flat('live', 0.6)]
    expect(soundingSum(rings, 1, () => 1)).toBeGreaterThan(0.6)
    const after = soundingSum(rings, 4, () => 1)
    expect(rings).toHaveLength(1)
    expect(rings[0].part).toBe('live')
    expect(after).toBeCloseTo(0.6, 12)
  })

  it('a released voice decays by its own tau, whatever the fader says', () => {
    const held: Ringing = { ...flat('L1', 0.6), off: 1, tau: 0.2 }
    const atRelease = soundingSum([held], 1, () => 1)
    const oneTau = soundingSum([held], 1.2, () => 1)
    expect(oneTau / atRelease).toBeCloseTo(Math.exp(-1), 6)
  })
})
