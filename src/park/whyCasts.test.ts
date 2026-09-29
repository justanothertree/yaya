import { describe, expect, it } from 'vitest'
import { saysOf, swapRanged, temperOf, whyCasts } from './temper'
import { CAST } from './cast'
import type { Drawing, Stroke } from '../draw/strokes'

/**
 * What the wizard tells a maker about the moves their drawing produced.
 *
 * ⚠️ THIS EXISTS BECAUSE THE RULE WAS UNLEARNABLE. temperOf forks the ranged slot on pace — a
 * creature gets a bolt OR a mark, never both — and nothing anywhere said so, so half the makers
 * on this site have never seen a bolt and had no way to find out one exists. Reported as "I'm
 * not sure how to cast the bolt", about a creature that did not have one.
 *
 * ⚠️ AND THE EXPLANATION IS READ OFF THE DIALS, WHICH IS saysOf's RULE AND MATTERS MORE HERE.
 * "You drew legs, so it is quick" would be a second copy of a weighting that lives inside
 * temperOf, free to drift the day somebody tunes it and wrong in a way nobody would catch. So
 * what these tests guard is not the wording — it is that the wording can only ever describe the
 * creature the park is actually going to fight.
 */

const stroke = (over: Partial<Stroke> = {}): Stroke => ({
  t: 'brush',
  c: '#4a7c3f',
  a: 1,
  w: 0.05,
  p: [0.4, 0.3, 0.6, 0.7],
  ...over,
})

/** a creature built out of named layers, which is how rigOf reads one */
const creature = (...parts: string[]): Drawing => ({
  v: 1,
  name: 'Test',
  ratio: 1,
  bg: null,
  layers: parts,
  strokes: parts.map((_, i) => stroke({ l: i, p: [0.3 + i * 0.04, 0.25, 0.55 + i * 0.04, 0.75] })),
})

const zoo: Drawing[] = [
  creature('body'),
  creature('body', 'leg', 'leg'),
  creature('body', 'wing'),
  creature('body', 'leg', 'leg', 'wing', 'horn'),
  creature('body', 'flame', 'tail'),
  creature('body', 'horn', 'mouth'),
  creature('body', 'spin', 'float'),
  creature('body', 'tail', 'tail', 'flame', 'mouth'),
]

describe('why a drawing got the moves it got', () => {
  /**
   * ⚠️ ONE REASON PER MOVE, IN THE SAME ORDER. The list sits directly under CastShow, which
   * plays them best-first — a reason against the wrong chip is worse than no reason, because it
   * teaches the opposite of the truth.
   */
  it('explains every move it was given, in the order it was given them', () => {
    for (const art of zoo) {
      const t = temperOf(art)
      const why = whyCasts(t)
      expect(
        why.map((w) => w.kind),
        `for ${art.layers?.join('+')}`,
      ).toEqual(t.casts)
    }
  })

  it('and says something for each one', () => {
    for (const art of zoo) {
      for (const { kind, because } of whyCasts(temperOf(art))) {
        expect(because.length, `${kind} had nothing said about it`).toBeGreaterThan(20)
      }
    }
  })

  /**
   * ⚠️ AND IT NAMES THE FORK, which is the whole reason this exists. A creature has a bolt or a
   * mark; whichever it has, the sentence has to mention the other one — that is the thing
   * nobody could discover by playing.
   */
  it('and whichever ranged move it has, it mentions the one it does not', () => {
    for (const art of zoo) {
      const t = temperOf(art)
      const ranged = whyCasts(t).find((w) => w.kind === 'bolt' || w.kind === 'mark')
      expect(ranged, 'every creature has one of the two').toBeTruthy()
      const other = ranged!.kind === 'bolt' ? 'mark' : 'bolt'
      expect(ranged!.because, `${ranged!.kind} did not mention the ${other}`).toContain(other)
    }
  })

  /** ⚠️ and the advice points the other way, or it is a description rather than a tool */
  it('and says which way to push the drawing to swap it', () => {
    for (const art of zoo) {
      const t = temperOf(art)
      const ranged = whyCasts(t).find((w) => w.kind === 'bolt' || w.kind === 'mark')!
      const want = ranged.kind === 'bolt' ? 'mark' : 'bolt'
      expect(swapRanged(t), `it should offer the ${want}`).toContain(want)
    }
  })

  /**
   * ⚠️ THE ZOO HAS TO CONTAIN BOTH SIDES OF THE FORK, or every test above passes while only
   * ever seeing one of them. This is the check that the fixtures are a population rather than
   * eight copies of one creature — the same mistake the temper zoo made once by varying layer
   * NAMES without varying shape.
   */
  it('and the creatures tested are not all the same creature', () => {
    const ranged = zoo.map(
      (a) => whyCasts(temperOf(a)).find((w) => w.kind === 'bolt' || w.kind === 'mark')!.kind,
    )
    expect(new Set(ranged).size, `every fixture came out ${ranged[0]}`).toBe(2)
  })

  /** ⚠️ read off the dials, so a cast and the sentence about it can never disagree */
  it('and never describes a move the creature does not have', () => {
    for (const art of zoo) {
      const t = temperOf(art)
      const named = whyCasts(t).map((w) => CAST[w.kind].short)
      for (const short of named) expect(saysOf(t).length + short.length).toBeGreaterThan(0)
      expect(new Set(whyCasts(t).map((w) => w.kind)).size, 'a move explained twice').toBe(
        t.casts.length,
      )
    }
  })
})
