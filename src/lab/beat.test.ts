import { describe, expect, it } from 'vitest'
import {
  beatHash,
  beatLink,
  beatMessage,
  beatsDice,
  beatsStack,
  dealRand,
  newSeed,
  readBeat,
  type Beat,
} from './beat'
import { roll } from '../gpu/dice'
import { seeded } from '../gpu/stack'
import registry from '../sections/GpuLab.tsx?raw'

describe('beat links', () => {
  it('round-trip, every field away from its default', () => {
    const cases: Beat[] = [
      { game: 'stack', seed: 123456789, time: 192.4, lines: 45 },
      { game: 'dice', seed: 2147483647, turns: 14 },
    ]
    for (const b of cases) {
      expect(readBeat(beatHash(b))).toEqual(b)
      expect(beatLink(b, 'https://evancook.dev/')).toBe(`https://evancook.dev/${beatHash(b)}`)
    }
  })
  it('lose any one field and the link is no challenge at all', () => {
    const stack = '#lab?demo=stack&seed=5&t=12.5&lines=3'
    expect(readBeat(stack)).not.toBeNull()
    for (const drop of ['demo', 'seed', 't', 'lines']) {
      const q = new URLSearchParams(stack.slice(5))
      q.delete(drop)
      expect(readBeat(`#lab?${q}`), drop).toBeNull()
    }
    expect(readBeat('#lab?demo=dice&seed=5')).toBeNull()
  })
  it('turns away anything malformed, out of range or for another place', () => {
    const bad = [
      '#lab',
      '#lab?',
      '#games?demo=stack&seed=5&t=12.5&lines=3',
      '#lab?demo=stack&seed=0&t=12.5&lines=3',
      '#lab?demo=stack&seed=-5&t=12.5&lines=3',
      '#lab?demo=stack&seed=99999999999&t=12.5&lines=3',
      '#lab?demo=stack&seed=5&t=0&lines=3',
      '#lab?demo=stack&seed=5&t=1e9&lines=3',
      '#lab?demo=stack&seed=5&t=12.55&lines=3',
      '#lab?demo=stack&seed=5&t=NaN&lines=3',
      '#lab?demo=stack&seed=5&t=12.5&lines=3.5',
      '#lab?demo=dice&seed=5&turns=0',
      '#lab?demo=dice&seed=5&turns=401',
      '#lab?demo=poker&seed=5&turns=3',
      '#lab?demo=dice&seed=5x&turns=3',
    ]
    for (const h of bad) expect(readBeat(h), h).toBeNull()
  })
  it('only names games the Lab has', () => {
    for (const id of ['stack', 'dice']) expect(registry).toContain(`id: '${id}'`)
  })
  it('new seeds are in range', () => {
    const rand = seeded(3)
    for (let i = 0; i < 1000; i++) {
      const s = newSeed(rand)
      expect(readBeat(beatHash({ game: 'dice', seed: s, turns: 9 }))?.seed).toBe(s)
    }
    expect(newSeed(() => 0)).toBe(1)
    expect(newSeed(() => 0.9999999999)).toBeLessThanOrEqual(2 ** 31 - 1)
  })
  it('the copied sentence reads as an invitation with the link on its own line', () => {
    const b: Beat = { game: 'stack', seed: 7, time: 192.4, lines: 45 }
    expect(beatMessage(b, 'L')).toBe(
      '🏁 Beat my run at Stackfall: 3:12 with 45 lines. Same pieces, same order:\nL',
    )
  })
})

describe('who did better', () => {
  it('stackfall: longer wins, a tie on time goes to more lines', () => {
    const b = { time: 192.4, lines: 45 }
    expect(beatsStack(b, 192.5, 0)).toBe(true)
    expect(beatsStack(b, 192.4, 46)).toBe(true)
    expect(beatsStack(b, 192.4, 45)).toBe(false)
    expect(beatsStack(b, 192.3, 99)).toBe(false)
    // the time is compared at the tenth the link carries, not at float noise below it
    expect(beatsStack(b, 192.41, 45)).toBe(false)
  })
  it('ten thousand: fewer turns wins', () => {
    expect(beatsDice({ turns: 14 }, 13)).toBe(true)
    expect(beatsDice({ turns: 14 }, 14)).toBe(false)
  })
})

describe('the dice deal', () => {
  it('the same seed, turn and roll give the same dice', () => {
    expect(roll(6, dealRand(9, 3, 1))).toEqual(roll(6, dealRand(9, 3, 1)))
  })
  it('fewer dice take the first of the same six, so keeping one more never shifts the deal', () => {
    const six = roll(6, dealRand(42, 0, 0))
    for (let n = 1; n <= 6; n++) expect(roll(n, dealRand(42, 0, 0))).toEqual(six.slice(0, n))
  })
  it('different turns and rolls get different dice, and the faces are fair', () => {
    const seen = new Set<string>()
    const faces = [0, 0, 0, 0, 0, 0, 0]
    for (let t = 0; t < 60; t++)
      for (let k = 0; k < 5; k++) {
        const r = roll(6, dealRand(77, t, k))
        seen.add(r.join(''))
        for (const f of r) faces[f]++
      }
    // 300 rolls of six dice: nearly all distinct, and each face near a sixth of 1,800
    expect(seen.size).toBeGreaterThan(290)
    for (let f = 1; f <= 6; f++) {
      expect(faces[f], `face ${f}`).toBeGreaterThan(240)
      expect(faces[f], `face ${f}`).toBeLessThan(360)
    }
  })
  it('a different deal is different from the first roll', () => {
    expect(roll(6, dealRand(1, 0, 0))).not.toEqual(roll(6, dealRand(2, 0, 0)))
  })
})
