import { beforeAll, describe, expect, it, vi } from 'vitest'
import { applyFx, captureFx, readInstKit, type InstKit } from './instKit'
import { knob, setKnob, type Fx, type Knob } from './synth'
import { SCALES } from './scales'

/**
 * A rig has to come back as the thing you kept.
 *
 * ⚠️ THIS FILE EXISTS BECAUSE `applyFx` SILENTLY DROPPED A KNOB. `fxSnapshot` saved `tone`,
 * `readInstKit` validated it, and `applyFx` set the other five and not that one — so a rig
 * carried the tone faithfully in storage and ignored it on the way back out. Two of the three
 * paths updated and the third forgotten, with nothing to notice: no type error, no exception,
 * just a slider that does not move. Measured in the room before the fix — save at 0.85, move
 * the slider to 0, apply the rig, and the knob is still 0 while echo comes back correctly.
 *
 * ⚠️ AND EVERY FIXTURE HERE IS OFF ITS DEFAULT. A round trip fed defaults passes whether the
 * field is carried or dropped, which is the trap this repository has paid for in three separate
 * serialisers. Where a test needs a value, it is one nothing else would produce.
 */

const scaleIds = SCALES.map(([id]) => id)

/**
 * ⚠️ `setKnob` REACHES FOR TWO BROWSER GLOBALS and this suite runs in node. It writes the value
 * to localStorage so it survives a visit, and dispatches a window event so the sliders and the
 * live bus hear about it — neither of which this file is testing, and both of which throw here.
 * Stubbed rather than worked around, because the thing under test is which knobs `applyFx`
 * touches, and that is the real `setKnob` or it is nothing.
 */
beforeAll(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('window', {
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  })
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
})

/** Every effect at a value that is not its default. */
const loudFx: Fx = {
  echo: 0.41,
  echoTime: 0.62,
  space: 0.73,
  vibrato: 0.29,
  glide: 0.17,
  tone: 0.86,
}

const fullKit = {
  name: 'Test rig',
  inst: 'rhodes',
  octave: 5,
  scale: 'harmonic',
  root: 7,
  fx: loudFx,
  chord: 'seventh',
  strum: 'slow',
  arp: 'updown',
  swing: true,
}

describe('applying a rig puts every knob back', () => {
  it('restores all six, including the one that was being dropped', () => {
    /* set every knob somewhere else first, so a knob that is simply not touched fails */
    for (const k of Object.keys(loudFx) as Knob[]) setKnob(k, 0)
    applyFx(loudFx)
    for (const k of Object.keys(loudFx) as Knob[])
      expect(knob(k), `${k} was not restored`).toBeCloseTo(loudFx[k], 5)
  })

  it('covers every field of Fx, so the next knob added is applied for free', () => {
    /**
     * ⚠️ THE SHAPE OF THE BUG, STATED. The old `applyFx` was five hand-written `setKnob` calls
     * — a list somebody has to remember to extend, and the one time it mattered nobody did.
     * Walking the object is what makes this test true by construction rather than by vigilance.
     */
    for (const k of Object.keys(loudFx) as Knob[]) setKnob(k, 0.11)
    applyFx({ ...loudFx, tone: 0.93 })
    expect(knob('tone')).toBeCloseTo(0.93, 5)
    expect(Object.keys(captureFx()).sort()).toEqual(Object.keys(loudFx).sort())
  })

  it('round trips through capture and apply', () => {
    for (const [k, v] of Object.entries(loudFx) as Array<[Knob, number]>) setKnob(k, v)
    const kept = captureFx()
    for (const k of Object.keys(loudFx) as Knob[]) setKnob(k, 0)
    applyFx(kept)
    for (const k of Object.keys(loudFx) as Knob[]) expect(knob(k), k).toBeCloseTo(loudFx[k], 5)
  })
})

describe('reading a rig', () => {
  it('keeps every field of a complete one', () => {
    const k = readInstKit(fullKit, scaleIds)!
    expect(k).toMatchObject({
      name: 'Test rig',
      inst: 'rhodes',
      octave: 5,
      scale: 'harmonic',
      root: 7,
      chord: 'seventh',
      strum: 'slow',
      arp: 'updown',
      swing: true,
    })
    expect(k.fx.tone).toBeCloseTo(0.86, 5)
  })

  it.each([
    ['chord', 'off'],
    ['strum', 'off'],
    ['arp', 'off'],
  ])('reads %s as %s in a rig saved before it existed', (field, want) => {
    /**
     * ⚠️ OFF IS THE HONEST DEFAULT, not merely a safe one — a rig kept before chords existed
     * sounded like no chord, so that is what it should come back as. A kit arriving with an
     * arpeggio nobody chose would be the stuck-arpeggio bug all over again, from storage.
     */
    const old = { ...fullKit } as Record<string, unknown>
    delete old[field]
    expect((readInstKit(old, scaleIds) as unknown as Record<string, unknown>)[field]).toBe(want)
  })

  it('reads swing as off when a rig predates it', () => {
    const old = { ...fullKit } as Record<string, unknown>
    delete old.swing
    expect(readInstKit(old, scaleIds)!.swing).toBe(false)
  })

  it('falls back for a shape that no longer exists', () => {
    const k = readInstKit(
      { ...fullKit, chord: 'eleventh', arp: 'spiral', strum: 'sideways' },
      scaleIds,
    )!
    expect([k.chord, k.arp, k.strum]).toEqual(['off', 'off', 'off'])
  })

  it('refuses anything that is not a rig', () => {
    for (const bad of [null, undefined, 42, 'rig', [], {}])
      expect(readInstKit(bad, scaleIds)).toBeNull()
  })

  it('clamps an effect that would hurt', () => {
    /* a feedback gain above 1 is a delay line that never decays — the reason this clamps */
    const k = readInstKit({ ...fullKit, fx: { echo: 9, tone: -4, space: Number.NaN } }, scaleIds)!
    expect(k.fx.echo).toBe(1)
    expect(k.fx.tone).toBe(0)
    expect(k.fx.space).toBe(0)
  })

  it('clamps the octave and the key', () => {
    const k = readInstKit({ ...fullKit, octave: 99, root: -5 }, scaleIds)!
    expect(k.octave).toBe(6)
    expect(k.root).toBe(0)
  })

  it('falls back to Chromatic for a scale the room does not offer', () => {
    expect(readInstKit({ ...fullKit, scale: 'locrian-ultra' }, scaleIds)!.scale).toBe('chromatic')
  })
})

describe('what a rig now describes', () => {
  it('carries how it is played, not only what it sounds like', () => {
    /* the gap this commit closed: four playing settings arrived after the type did, so a rig
       set the scale and the effects and left the chord and the arpeggio wherever they were */
    const k = readInstKit(fullKit, scaleIds) as InstKit
    expect(Object.keys(k).sort()).toEqual(
      ['arp', 'chord', 'fx', 'inst', 'name', 'octave', 'root', 'scale', 'strum', 'swing'].sort(),
    )
  })
})

describe('swing is on only when a rig says so', () => {
  /**
   * ⚠️ FOUND BY A PERTURBATION THAT STAYED GREEN. Replacing `o.swing === true` with `!!o.swing`
   * changed nothing here, because no fixture fed a truthy non-boolean — the two readings are
   * identical for every value a fixture happened to use, so the distinction was untested.
   *
   * It is pinned strict on purpose, and the arpeggio bug from two ticks ago is the argument: a
   * setting that turns itself on from data nobody meant as "on" is the failure mode this room
   * has already had once. A rig has to say `true`.
   */
  it.each([
    [true, true],
    [false, false],
    [1, false],
    ['yes', false],
    [undefined, false],
    [null, false],
  ])('reads %s as %s', (given, want) => {
    expect(readInstKit({ ...fullKit, swing: given }, scaleIds)!.swing).toBe(want)
  })
})
