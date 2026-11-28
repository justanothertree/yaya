import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ARMS,
  bannerText,
  beatHash,
  beatLink,
  beatMessage,
  beatsDice,
  beatsStack,
  dealRand,
  dropBeat,
  flag,
  newSeed,
  oneOf,
  outcome,
  presses,
  readBeat,
  sameBoard,
  shareable,
  signed,
  tenths,
  verdict,
  whole,
  type Beat,
  type Game,
} from './beat'
import { currentToy, hashParam, toyHash } from './links'
import { roll } from '../gpu/dice'
import { daySeedOf } from '../gpu/bricks'
import { seeded } from '../gpu/stack'
import registry from '../sections/labDemos.tsx?raw'
/* ── g1 imports ── */
/* ── g2 imports ── */
/* ── g3 imports ── */
import { SIZES as PIPES_SIZES, keepBest as pipesKeep } from '../gpu/pipes'
import { SIZES as CAGES_SIZES, keepBest as cagesKeep } from '../gpu/cages'
import { SIZES as BRIDGES_SIZES, keepBest as bridgesKeep } from '../gpu/bridges'
import { SIZES as TENTS_SIZES, keepBest as tentsKeep } from '../gpu/tents'
/* ── g4 imports ── */

/**
 * One finished game per arm, EVERY FIELD AWAY FROM ITS DEFAULT: not the toy's EMPTY setting, not a
 * codec's lower bound, not the first value of a `oneOf` list; flags true; seeds above 2^31 (Slide's
 * own bound excepted). A round trip is only worth the fields its fixture fills (CLAUDE.md §2), and
 * the generic tests below run against every row — an arm with no row fails `npm run typecheck`.
 */
const FIXTURE: { [G in Game]: Extract<Beat, { game: G }> } = {
  stack: { game: 'stack', seed: 3_000_000_001, time: 192.4, lines: 45 },
  dice: { game: 'dice', seed: daySeedOf(2026, 11, 27), turns: 14 },
  /* ── g1 fixtures ── */
  /* ── g2 fixtures ── */
  /* ── g3 fixtures ── */
  pipes: { game: 'pipes', seed: daySeedOf(2026, 11, 27), size: 9, wrap: true, secs: 95, turns: 61 },
  cages: { game: 'cages', seed: 3_000_000_001, size: 6, secs: 140 },
  bridges: { game: 'bridges', seed: 3_000_000_001, size: 11, secs: 140 },
  tents: { game: 'tents', seed: 3_000_000_001, size: 10, secs: 140 },
  /* ── g4 fixtures ── */
}
const ROWS: Beat[] = Object.values(FIXTURE)
const paramsOf = (h: string) => new URLSearchParams(h.slice('#lab?'.length))

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

describe('links already pasted in somebody’s chat open exactly as before', () => {
  it('a Stackfall link, verbatim, both ways', () => {
    const h = '#lab?demo=stack&seed=123456789&t=192.4&lines=45'
    expect(readBeat(h)).toEqual({ game: 'stack', seed: 123456789, time: 192.4, lines: 45 })
    expect(beatHash(readBeat(h)!)).toBe(h)
  })
  it('a Ten thousand link, verbatim, both ways', () => {
    const h = '#lab?demo=dice&seed=2147483647&turns=14'
    expect(readBeat(h)).toEqual({ game: 'dice', seed: 2147483647, turns: 14 })
    expect(beatHash(readBeat(h)!)).toBe(h)
  })
  it('parameter order, a leading zero and a repeated parameter read as they always did', () => {
    expect(readBeat('#lab?demo=dice&turns=9&seed=77')).toEqual({ game: 'dice', seed: 77, turns: 9 })
    expect(readBeat('#lab?demo=dice&seed=05&turns=9')).toEqual({ game: 'dice', seed: 5, turns: 9 })
    expect(readBeat('#lab?demo=dice&seed=5&seed=6&turns=3')?.seed).toBe(5)
  })
  it('the same seed deals the same dice', () => {
    expect(roll(6, dealRand(42, 0, 0))).toEqual([3, 3, 1, 4, 6, 5])
    expect(roll(6, dealRand(2147483647, 13, 2))).toEqual([3, 5, 5, 2, 6, 3])
  })
  it('the Ten thousand sentence is unchanged', () => {
    expect(beatMessage({ game: 'dice', seed: 7, turns: 14 }, 'L')).toBe(
      '🏁 Beat my run at Ten thousand: 10,000 in 14 turns. Same dice for the same choices:\nL',
    )
  })
})

describe('the seed bound is every seed a toy can make', () => {
  it('today’s daily seed opens — a full 32-bit number', () => {
    const seed = daySeedOf(2026, 11, 27)
    expect(seed).toBe(4_279_824_600)
    expect(readBeat(`#lab?demo=dice&seed=${seed}&turns=14`)).toEqual({
      game: 'dice',
      seed,
      turns: 14,
    })
  })
  it('opens from 1 to 2^32 − 1 and nowhere else', () => {
    const at = (s: string) => readBeat(`#lab?demo=dice&seed=${s}&turns=14`)?.seed ?? null
    expect(at('0')).toBeNull()
    expect(at('1')).toBe(1)
    expect(at('2147483647')).toBe(2147483647)
    expect(at('2147483648')).toBe(2147483648)
    expect(at('4294967295')).toBe(4294967295)
    expect(at('4294967296')).toBeNull()
    expect(at('99999999999')).toBeNull()
  })
})

describe('every arm, from its FIXTURE row', () => {
  for (const b of ROWS) {
    const h = beatHash(b)
    const arm = ARMS[b.game]
    describe(b.game, () => {
      it('round-trips both ways, and can be shared', () => {
        expect(readBeat(h)).toEqual(b)
        expect(beatHash(readBeat(h)!)).toBe(h)
        expect(shareable(b)).toBe(true)
      })
      it('without any one parameter, or with one spoiled, is no challenge', () => {
        const names = [...paramsOf(h).keys()]
        expect(names[0]).toBe('demo')
        expect(names).toHaveLength(Object.keys(arm.fields).length + 1)
        for (const name of names)
          for (const spoil of [null, 'x', '']) {
            const q = paramsOf(h)
            if (spoil === null) q.delete(name)
            else q.set(name, spoil)
            expect(readBeat(`#lab?${q}`), `${name}=${spoil}`).toBeNull()
          }
      })
      it('names its toy to the tour and Follow, and is no match', () => {
        expect(currentToy(h)).toBe(b.game)
        expect(toyHash(h, 'swarm')).toBe('#lab?demo=swarm')
        expect(toyHash(h, b.game)).toBeNull()
        expect(hashParam('match', h)).toBeNull()
      })
      it('reads as an invitation, with the link on its own line', () => {
        const text = beatMessage(b, 'L')
        expect(text.startsWith(`🏁 Beat my ${arm.noun} at ${arm.name}: `)).toBe(true)
        expect(text.endsWith(':\nL')).toBe(true)
      })
      it('is level with itself', () => {
        expect(outcome(b, b)).toBe('level')
      })
      it('keeps its parameters apart, and its board is made of its own fields', () => {
        const keys = Object.values(arm.fields).map((c) => c.key)
        expect(new Set(keys).size).toBe(keys.length)
        expect(keys).not.toContain('demo')
        for (const k of arm.board) expect(Object.keys(arm.fields)).toContain(k)
      })
    })
  }
  it('every arm is a toy the Lab has', () => {
    for (const id of Object.keys(ARMS)) expect(registry).toContain(`id: '${id}'`)
  })
  it('a name every object inherits is no game, with every parameter any arm reads present', () => {
    const all = new URLSearchParams()
    for (const b of ROWS)
      for (const [k, v] of paramsOf(beatHash(b))) if (k !== 'demo') all.set(k, v)
    for (const demo of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      const q = new URLSearchParams({ demo })
      for (const [k, v] of all) q.set(k, v)
      expect(readBeat(`#lab?${q}`), demo).toBeNull()
    }
  })
})

describe('the codecs, at their edges', () => {
  it('whole: inclusive, digits only, a leading zero as it always read', () => {
    const c = whole('k', 3, 12)
    expect([c.read('2'), c.read('3'), c.read('12'), c.read('13')]).toEqual([null, 3, 12, null])
    expect(c.read('05')).toBe(5)
    for (const v of [null, '', '-3', '+5', '5.0', ' 5', '5 ', '1e1', '0x5', '12345678901'])
      expect(c.read(v), String(v)).toBeNull()
    expect(c.write(7)).toBe('7')
  })
  it('signed: below zero allowed, but written one way only', () => {
    const c = signed('k', -16, 35)
    expect([c.read('-17'), c.read('-16'), c.read('35'), c.read('36')]).toEqual([
      null,
      -16,
      35,
      null,
    ])
    expect(c.read('0')).toBe(0)
    expect(c.read('-3')).toBe(-3)
    for (const v of [null, '', '-0', '+5', '05', '-05', '- 3', '1.0', '--3'])
      expect(c.read(v), String(v)).toBeNull()
    expect(c.write(-3)).toBe('-3')
  })
  it('tenths: above zero, at most the bound, at most one decimal', () => {
    const c = tenths('k', 86_400)
    expect([c.read('0'), c.read('0.0'), c.read('0.1'), c.read('86400')]).toEqual([
      null,
      null,
      0.1,
      86_400,
    ])
    expect([c.read('86400.0'), c.read('86400.1')]).toEqual([86_400, null])
    for (const v of [null, '', '12.55', '1e3', '.5', '5.', '-1', 'NaN', '100000'])
      expect(c.read(v), String(v)).toBeNull()
    expect([c.write(192.4), c.write(5)]).toEqual(['192.4', '5.0'])
  })
  it('oneOf: only a value from the toy’s own list, spelled as the list spells it', () => {
    const n = oneOf('k', [5, 7, 9] as const)
    expect([n.read('5'), n.read('9'), n.read('6'), n.read('05'), n.read(''), n.read(null)]).toEqual(
      [5, 9, null, null, null, null],
    )
    const s = oneOf('k', ['twin', 'fort'] as const)
    expect([s.read('fort'), s.read('TWIN'), s.read('constructor')]).toEqual(['fort', null, null])
    expect(n.write(9)).toBe('9')
  })
  it('flag: 1 or 0 and nothing else', () => {
    const c = flag('k')
    expect([c.read('1'), c.read('0')]).toEqual([true, false])
    for (const v of [null, '', 'true', '01', '2']) expect(c.read(v), String(v)).toBeNull()
    expect([c.write(true), c.write(false)]).toEqual(['1', '0'])
  })
  it('presses: A–Z a–w for lamps 0 to 48, _ for an undo, at most the bound', () => {
    const c = presses('k', 60)
    const every = [...Array.from({ length: 49 }, (_, i) => i), -1]
    expect(c.write(every)).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvw_')
    expect(c.read(c.write(every))).toEqual(every)
    expect([c.read('A'), c.read('Z'), c.read('a'), c.read('w'), c.read('_')]).toEqual([
      [0],
      [25],
      [26],
      [48],
      [-1],
    ])
    for (const v of [null, '', 'x', 'y', 'z', '0', '9', '-', 'A B', 'A-'])
      expect(c.read(v), String(v)).toBeNull()
    const short = presses('k', 5)
    expect(short.read('AAAAA')).toEqual([0, 0, 0, 0, 0])
    expect(short.read('AAAAAA')).toBeNull()
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
  it('outcome agrees with the rule as the toys have always said it, across a sweep', () => {
    /* the rule written out again from the world, sharing no arithmetic with the arms: a run that
       lasts longer at the tenth wins, a tie goes to more lines; a race in fewer turns wins */
    const longer = (t: number, l: number, bt: number, bl: number) =>
      Math.round(t * 10) > Math.round(bt * 10) ||
      (Math.round(t * 10) === Math.round(bt * 10) && l > bl)
    const rand = seeded(20261127)
    const times = [192.4, 192.41, 192.39, 192.45, 192.35, 192.5, 192.3, 0.1, 86_400]
    let checked = 0
    for (let i = 0; i < 2000; i++) {
      const link = { time: times[i % times.length], lines: Math.floor(rand() * 4) + 44 }
      const t = rand() < 0.5 ? times[Math.floor(rand() * times.length)] : 190 + rand() * 5
      const l = Math.floor(rand() * 4) + 44
      const o = outcome(
        { game: 'stack', seed: 5, time: t, lines: l },
        { game: 'stack', seed: 5, ...link },
      )
      expect(o === 'beat', `${t}/${l} vs ${link.time}/${link.lines}`).toBe(
        longer(t, l, link.time, link.lines),
      )
      expect(o === 'beat').toBe(beatsStack(link, t, l))
      expect(o === 'short').toBe(longer(link.time, link.lines, t, l))
      checked++
    }
    for (let mine = 1; mine <= 30; mine++)
      for (let theirs = 1; theirs <= 30; theirs++) {
        const o = outcome(
          { game: 'dice', seed: 5, turns: mine },
          { game: 'dice', seed: 5, turns: theirs },
        )
        expect(o).toBe(mine < theirs ? 'beat' : mine > theirs ? 'short' : 'level')
        expect(o === 'beat').toBe(beatsDice({ turns: theirs }, mine))
        checked++
      }
    expect(checked).toBe(2900)
    // the tenth boundary, named: float noise below the tenth is level
    const link: Beat = { game: 'stack', seed: 5, time: 192.4, lines: 45 }
    expect(outcome({ ...link, time: 192.41 }, link)).toBe('level')
  })
  it('a different board is no comparison at all', () => {
    const link: Beat = { game: 'stack', seed: 5, time: 192.4, lines: 45 }
    expect(outcome({ ...link, seed: 6, time: 500 }, link)).toBeNull()
    expect(sameBoard({ ...link, time: 1 }, link)).toBe(true)
    expect(sameBoard({ ...link, seed: 6 }, link)).toBe(false)
    expect(sameBoard({ game: 'dice', seed: 5, turns: 3 }, link)).toBe(false)
    expect(outcome({ game: 'dice', seed: 5, turns: 3 }, link)).toBeNull()
  })
  it('the result line says how it stood, and nothing off the link’s board', () => {
    const link: Beat = { game: 'stack', seed: 5, time: 192.4, lines: 45 }
    expect(verdict({ ...link, time: 200 }, link)).toBe(' You beat the link’s 3:12 with 45 lines!')
    expect(verdict(link, link)).toBe(' Level with the link’s 3:12 with 45 lines.')
    expect(verdict({ ...link, time: 100 }, link)).toBe(
      ' The link says 3:12 with 45 lines — not this time.',
    )
    expect(verdict({ ...link, seed: 6, time: 200 }, link)).toBe('')
  })
})

describe('replies, banners and what can be sent', () => {
  const link: Beat = { game: 'stack', seed: 5, time: 192.4, lines: 45 }
  it('a result that beats the link says so, and passes it on', () => {
    expect(beatMessage({ ...link, time: 200, lines: 50 }, 'L', link)).toBe(
      '🏆 I beat the link at Stackfall: 3:20 with 50 lines — it said 3:12 with 45 lines. Same pieces, same order, your go:\nL',
    )
  })
  it('one that does not still sends its own go, beside the link’s', () => {
    expect(beatMessage({ ...link, time: 150, lines: 30 }, 'L', link)).toBe(
      '🏁 My go at Stackfall: 2:30 with 30 lines — the link I was sent said 3:12 with 45 lines. Same pieces, same order, your go:\nL',
    )
    expect(beatMessage(link, 'L', link)).toBe(
      '🏁 My go at Stackfall: 3:12 with 45 lines — the link I was sent said 3:12 with 45 lines. Same pieces, same order, your go:\nL',
    )
  })
  it('a result from another board is a plain invitation, not a reply to a link it never played', () => {
    expect(beatMessage({ ...link, seed: 6, time: 200 }, 'L', link)).toBe(
      '🏁 Beat my run at Stackfall: 3:20 with 45 lines. Same pieces, same order:\nL',
    )
  })
  it('the banner words the score as what the link says', () => {
    expect(bannerText(link)).toEqual({
      lead: 'A run to beat:',
      body: 'this link says 3:12 with 45 lines. Same pieces, same order — last longer.',
    })
    expect(bannerText(link, true).body).toBe(
      'this link says 3:12 with 45 lines. Same pieces, same order — last longer. It is today’s board here, so it counts as your today’s.',
    )
  })
  it('a result whose link would not read back is not offered', () => {
    expect(shareable({ ...link, time: 100_000 })).toBe(false)
    expect(shareable({ ...link, time: 86_400 })).toBe(true)
    expect(shareable({ game: 'dice', seed: 5, turns: 401 })).toBe(false)
    expect(shareable({ game: 'dice', seed: 2 ** 32, turns: 14 })).toBe(false)
  })
})

describe('leaving a challenge', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })
  it('puts the address back on the toy alone, and keeps the history entry’s state', () => {
    const state = { kept: 1 }
    const replaceState = vi.fn()
    vi.stubGlobal('history', { state, replaceState })
    vi.stubGlobal('location', { pathname: '/', search: '' })
    dropBeat('stack')
    expect(replaceState).toHaveBeenCalledTimes(1)
    const [passed, , url] = replaceState.mock.calls[0] as [unknown, string, string]
    expect(passed).toBe(state)
    expect(url).toBe('/#lab?demo=stack')
    expect(currentToy(url.slice(1))).toBe('stack')
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

/* ── g1 cases ── */
/* ── g2 cases ── */
/* ── g3 cases ── */
describe('g3: Pipes, Cages, Island bridges and Tents', () => {
  const G3 = ['pipes', 'cages', 'bridges', 'tents'] as const
  /** every size each toy offers, from the toy's own module */
  const SIZED: Record<(typeof G3)[number], readonly number[]> = {
    pipes: PIPES_SIZES,
    cages: CAGES_SIZES,
    bridges: BRIDGES_SIZES,
    tents: TENTS_SIZES,
  }
  const DAY = 24 * 60 * 60
  /** the fixture's link with one parameter set to `v`, read back */
  const withParam = (b: Beat, key: string, v: string) => {
    const q = paramsOf(beatHash(b))
    q.set(key, v)
    return readBeat(`#lab?${q}`)
  }
  for (const game of G3) {
    const b = FIXTURE[game]
    it(`${game}: opens on every size the toy has, and on no other`, () => {
      const sizes = SIZED[game]
      for (const n of sizes)
        expect(withParam(b, 'size', String(n)), String(n)).toEqual({ ...b, size: n })
      let refused = 0
      for (let n = Math.min(...sizes) - 1; n <= Math.max(...sizes) + 1; n++)
        if (!sizes.includes(n)) {
          expect(withParam(b, 'size', String(n)), String(n)).toBeNull()
          refused++
        }
      // below the smallest, above the largest, and every gap between
      expect(refused).toBe(Math.max(...sizes) - Math.min(...sizes) + 3 - sizes.length)
      expect(withParam(b, 'size', `0${sizes[0]}`)).toBeNull()
    })
    it(`${game}: a time from one second to a day, hints included`, () => {
      expect(withParam(b, 'secs', '0')).toBeNull()
      expect(withParam(b, 'secs', '1')).toEqual({ ...b, secs: 1 })
      expect(withParam(b, 'secs', String(DAY))).toEqual({ ...b, secs: DAY })
      expect(withParam(b, 'secs', String(DAY + 1))).toBeNull()
      expect(withParam(b, 'secs', '1.5')).toBeNull()
    })
    it(`${game}: faster beats it, the same time is level, slower is not this time`, () => {
      expect(outcome({ ...b, secs: b.secs - 1 }, b)).toBe('beat')
      expect(outcome({ ...b }, b)).toBe('level')
      expect(outcome({ ...b, secs: b.secs + 1 }, b)).toBe('short')
    })
    it(`${game}: another seed or another size is another board, and no comparison`, () => {
      const size = SIZED[game].find((n) => n !== b.size)
      expect(outcome({ ...b, size, secs: 1 } as Beat, b)).toBeNull()
      expect(outcome({ ...b, seed: b.seed + 1, secs: 1 }, b)).toBeNull()
    })
    it(`${game}: says the size with the article English gives it, at every size`, () => {
      /* the world's rule, not the code's: "an" before a number whose word starts with a vowel */
      const WORD: Record<number, string> = {
        4: 'four',
        5: 'five',
        6: 'six',
        7: 'seven',
        8: 'eight',
        9: 'nine',
        10: 'ten',
        11: 'eleven',
      }
      for (const n of SIZED[game]) {
        const text = beatMessage({ ...b, size: n } as Beat, 'L')
        const an = /^[aeiou]/.test(WORD[n])
        expect(text, String(n)).toContain(` on ${an ? 'an' : 'a'} ${n}×${n} `)
      }
    })
  }
  it('a faster finish is a better one exactly when the toy’s own record would keep it', () => {
    /* asked of each toy's keepBest, which decides "better" for its own records and shares no
       arithmetic with the arms: the time, and for Pipes the turns on a tie */
    let checked = 0
    for (let secs = 1; secs <= 4; secs++)
      for (let turns = 1; turns <= 4; turns++) {
        /** whether the toy's own record keeps `mine` over `kept`, a finish already there */
        const keeps = <T>(keep: (bests: T[], b: T, today: number) => T[], kept: T, mine: T) =>
          keep([kept], mine, 9).includes(mine)
        const pipes = FIXTURE.pipes
        const day = { day: 9, size: pipes.size, wrap: pipes.wrap }
        expect(
          outcome({ ...pipes, secs, turns }, { ...pipes, secs: 2, turns: 2 }) === 'beat',
          `${secs}s ${turns}`,
        ).toBe(keeps(pipesKeep, { ...day, seconds: 2, turns: 2 }, { ...day, seconds: secs, turns }))
        for (const [game, keep] of [
          ['cages', cagesKeep],
          ['bridges', bridgesKeep],
          ['tents', tentsKeep],
        ] as const) {
          const b = FIXTURE[game]
          const at = { day: 9, size: b.size }
          expect(outcome({ ...b, secs }, { ...b, secs: 2 }) === 'beat', `${game} ${secs}s`).toBe(
            keeps(keep, { ...at, seconds: 2 }, { ...at, seconds: secs }),
          )
        }
        checked++
      }
    expect(checked).toBe(16)
  })
  it('pipes: a tie on time goes to fewer turns, and a faster time wins whatever the turns', () => {
    const b = FIXTURE.pipes
    expect(outcome({ ...b, turns: b.turns - 1 }, b)).toBe('beat')
    expect(outcome({ ...b, turns: b.turns + 1 }, b)).toBe('short')
    expect(outcome({ ...b, secs: b.secs - 1, turns: b.turns + 500 }, b)).toBe('beat')
    expect(outcome({ ...b, secs: b.secs + 1, turns: 1 }, b)).toBe('short')
    expect(outcome({ ...b, wrap: false }, b)).toBeNull()
  })
  it('pipes: turns from 1 to 99,999, and wrapping as 1 or 0', () => {
    const b = FIXTURE.pipes
    expect(withParam(b, 'turns', '0')).toBeNull()
    expect(withParam(b, 'turns', '1')).toEqual({ ...b, turns: 1 })
    expect(withParam(b, 'turns', '99999')).toEqual({ ...b, turns: 99_999 })
    expect(withParam(b, 'turns', '100000')).toBeNull()
    expect(withParam(b, 'wrap', '0')).toEqual({ ...b, wrap: false })
    expect(withParam(b, 'wrap', 'true')).toBeNull()
    expect(beatMessage({ ...b, turns: 1 }, 'L')).toContain(' and 1 turn on ')
  })
  it('the banners, the invitations and the replies, verbatim', () => {
    expect(bannerText(FIXTURE.pipes)).toEqual({
      lead: 'A board to beat:',
      body: 'this link says 1:35 and 61 turns on a 9×9 wrapping board. Same board — faster wins, then fewer turns.',
    })
    expect(beatMessage(FIXTURE.pipes, 'L')).toBe(
      '🏁 Beat my board at Pipes: 1:35 and 61 turns on a 9×9 wrapping board. Same board:\nL',
    )
    expect(beatMessage({ ...FIXTURE.pipes, secs: 95, turns: 58 }, 'L', FIXTURE.pipes)).toBe(
      '🏆 I beat the link at Pipes: 1:35 and 58 turns on a 9×9 wrapping board — it said 1:35 and 61 turns on a 9×9 wrapping board. Same board, your go:\nL',
    )
    expect(bannerText(FIXTURE.cages, true)).toEqual({
      lead: 'A board to beat:',
      body: 'this link says 2:20 on a 6×6 board. Same board — faster wins; hints add time. It is today’s board here, so it counts as your today’s.',
    })
    expect(beatMessage(FIXTURE.cages, 'L')).toBe(
      '🏁 Beat my board at Cages: 2:20 on a 6×6 board. Same board:\nL',
    )
    expect(beatMessage({ ...FIXTURE.cages, secs: 200 }, 'L', FIXTURE.cages)).toBe(
      '🏁 My go at Cages: 3:20 on a 6×6 board — the link I was sent said 2:20 on a 6×6 board. Same board, your go:\nL',
    )
    expect(bannerText(FIXTURE.bridges)).toEqual({
      lead: 'A map to beat:',
      body: 'this link says 2:20 on an 11×11 map. Same map — faster wins; hints add time.',
    })
    expect(beatMessage(FIXTURE.bridges, 'L')).toBe(
      '🏁 Beat my map at Island bridges: 2:20 on an 11×11 map. Same map:\nL',
    )
    expect(beatMessage({ ...FIXTURE.bridges, secs: 75 }, 'L', FIXTURE.bridges)).toBe(
      '🏆 I beat the link at Island bridges: 1:15 on an 11×11 map — it said 2:20 on an 11×11 map. Same map, your go:\nL',
    )
    expect(bannerText(FIXTURE.tents)).toEqual({
      lead: 'A field to beat:',
      body: 'this link says 2:20 on a 10×10 field. Same field — faster wins; hints add time.',
    })
    expect(beatMessage(FIXTURE.tents, 'L')).toBe(
      '🏁 Beat my field at Tents: 2:20 on a 10×10 field. Same field:\nL',
    )
    expect(beatMessage(FIXTURE.tents, 'L', FIXTURE.tents)).toBe(
      '🏁 My go at Tents: 2:20 on a 10×10 field — the link I was sent said 2:20 on a 10×10 field. Same field, your go:\nL',
    )
  })
  it('the result line says how a finish stood, and a time past a day is not offered', () => {
    expect(verdict({ ...FIXTURE.tents, secs: 100 }, FIXTURE.tents)).toBe(
      ' You beat the link’s 2:20 on a 10×10 field!',
    )
    expect(verdict({ ...FIXTURE.tents, size: 6 }, FIXTURE.tents)).toBe('')
    for (const game of G3) {
      expect(shareable({ ...FIXTURE[game], secs: DAY }), game).toBe(true)
      expect(shareable({ ...FIXTURE[game], secs: DAY + 1 }), game).toBe(false)
    }
    expect(shareable({ ...FIXTURE.pipes, turns: 100_000 })).toBe(false)
  })
})
/* ── g4 cases ── */
