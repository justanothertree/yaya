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
import { CATS as YACHT_BOXES, score as yachtScore } from '../gpu/yacht'
import { ALL as ALL_UP, tilesOf } from '../gpu/shut'
/* ── g2 imports ── */
import { deal as golfDeal, left as golfLeft } from '../gpu/golf'
import { SIZES as MINE_SIZES } from '../gpu/mines'
import { LAYOUTS as TILE_LAYOUTS } from '../gpu/tiles'
/* ── g3 imports ── */
import { SIZES as PIPES_SIZES, keepBest as pipesKeep } from '../gpu/pipes'
import { SIZES as CAGES_SIZES, keepBest as cagesKeep } from '../gpu/cages'
import { SIZES as BRIDGES_SIZES, keepBest as bridgesKeep } from '../gpu/bridges'
import { SIZES as TENTS_SIZES, keepBest as tentsKeep } from '../gpu/tents'
/* ── g4 imports ── */
import * as lampsToy from '../gpu/lamps'
import * as slideToy from '../gpu/slide'
import { dayNumber as lampsDay } from '../gpu/daily'

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
  yacht: { game: 'yacht', seed: 4_279_824_600, points: 212 },
  shut: { game: 'shut', seed: 3_000_000_001, left: 7 },
  /* ── g2 fixtures ── */
  golf: { game: 'golf', seed: daySeedOf(2026, 11, 27), wrap: true, score: -3 },
  mines: { game: 'mines', seed: 4_294_967_295, size: 'large', start: 241, tenths: 1234 },
  tiles: { game: 'tiles', seed: 3_000_000_001, layout: 'twin', secs: 431 },
  /* ── g3 fixtures ── */
  pipes: { game: 'pipes', seed: daySeedOf(2026, 11, 27), size: 9, wrap: true, secs: 95, turns: 61 },
  cages: { game: 'cages', seed: 3_000_000_001, size: 6, secs: 140 },
  bridges: { game: 'bridges', seed: 3_000_000_001, size: 11, secs: 140 },
  tents: { game: 'tents', seed: 3_000_000_001, size: 10, secs: 140 },
  /* ── g4 fixtures ── */
  // a real solve with a press and its undo put in, so the run is neither empty nor the fewest
  lamps: { game: 'lamps', seed: 3_000_000_001, size: 6, pattern: 'cross', presses: lampsRun() },
  slide: { game: 'slide', seed: 99_998, difficulty: 'hard', pushes: 23 },
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
describe('g1: Yacht and Shut the box', () => {
  /* the bounds worked out from each toy's own rules, never typed in again beside the arm: the most
     each of the twelve boxes holds over every throw of five dice, and every tile of the box up */
  const most = YACHT_BOXES.reduce((sum, cat) => {
    let best = 0
    for (let k = 0; k < 6 ** 5; k++)
      best = Math.max(
        best,
        yachtScore(
          [0, 1, 2, 3, 4].map((i) => 1 + (Math.floor(k / 6 ** i) % 6)),
          cat,
        ),
      )
    return sum + best
  }, 0)
  const allUp = tilesOf(ALL_UP).reduce((s, t) => s + t, 0)
  const yachtAt = (v: number) => {
    const b = readBeat(`#lab?demo=yacht&seed=4279824600&points=${v}`)
    return b?.game === 'yacht' ? b.points : null
  }
  const shutAt = (v: number) => {
    const b = readBeat(`#lab?demo=shut&seed=3000000001&left=${v}`)
    return b?.game === 'shut' ? b.left : null
  }
  const yacht = FIXTURE.yacht
  const shut = FIXTURE.shut
  it('Yacht: from no points to the most twelve boxes can hold, and nothing past it', () => {
    // the room says "of 297 possible" beside the best alone
    expect(most).toBe(297)
    expect([yachtAt(-1), yachtAt(0), yachtAt(most), yachtAt(most + 1)]).toEqual([
      null,
      0,
      most,
      null,
    ])
  })
  it('Shut the box: from the box shut to every tile still up, and nothing past it', () => {
    expect(allUp).toBe(45)
    expect([shutAt(-1), shutAt(0), shutAt(allUp), shutAt(allUp + 1)]).toEqual([
      null,
      0,
      allUp,
      null,
    ])
  })
  it('Yacht: more points wins', () => {
    expect(outcome({ ...yacht, points: 213 }, yacht)).toBe('beat')
    expect(outcome({ ...yacht, points: 212 }, yacht)).toBe('level')
    expect(outcome({ ...yacht, points: 211 }, yacht)).toBe('short')
    expect(outcome({ ...yacht, seed: 5, points: 297 }, yacht)).toBeNull()
  })
  it('Shut the box: fewer left wins, and a shut box can only be levelled', () => {
    expect(outcome({ ...shut, left: 6 }, shut)).toBe('beat')
    expect(outcome({ ...shut, left: 7 }, shut)).toBe('level')
    expect(outcome({ ...shut, left: 8 }, shut)).toBe('short')
    const closed: Beat = { ...shut, left: 0 }
    expect(outcome(closed, closed)).toBe('level')
    expect(outcome({ ...shut, left: 1 }, closed)).toBe('short')
  })
  it('Yacht: the banner, the invitation and the reply say it as the toy does', () => {
    expect(bannerText(yacht)).toEqual({
      lead: 'A game to beat:',
      body: 'this link says 212 points. Same dice for the same keeps — more points wins.',
    })
    expect(beatMessage(yacht, 'L')).toBe(
      '🏁 Beat my game at Yacht: 212 points. Same dice for the same keeps:\nL',
    )
    expect(beatMessage({ ...yacht, points: 230 }, 'L', yacht)).toBe(
      '🏆 I beat the link at Yacht: 230 points — it said 212 points. Same dice for the same keeps, your go:\nL',
    )
    expect(verdict({ ...yacht, points: 200 }, yacht)).toBe(
      ' The link says 212 points — not this time.',
    )
  })
  it('Shut the box: the banner, the invitation and the reply say it as the toy does', () => {
    expect(bannerText(shut)).toEqual({
      lead: 'A turn to beat:',
      body: 'this link says 7 left. Same dice for the same choices — fewer left wins.',
    })
    expect(beatMessage({ ...shut, left: 0 }, 'L')).toBe(
      '🏁 Beat my turn at Shut the box: 0 left — the box shut. Same dice for the same choices:\nL',
    )
    expect(beatMessage({ ...shut, left: 9 }, 'L', shut)).toBe(
      '🏁 My go at Shut the box: 9 left — the link I was sent said 7 left. Same dice for the same choices, your go:\nL',
    )
    expect(verdict({ ...shut, left: 0 }, shut)).toBe(' You beat the link’s 7 left!')
  })
})
/* ── g2 cases ── */
describe('g2: Golf patience, Mines and Tile pairs', () => {
  const at = (b: Beat, key: string, v: string) => {
    const q = paramsOf(beatHash(b))
    q.set(key, v)
    return readBeat(`#lab?${q}`)
  }
  describe('golf', () => {
    const b = FIXTURE.golf
    /* the bounds from the deal itself, sharing no arithmetic with the arm: nothing taken leaves
       every column card, and clearing with the whole stock unturned scores minus the stock */
    const d = golfDeal(4_279_824_600)
    const hi = golfLeft(d)
    const lo = -d.stock.length
    it('scores from minus the stock to every column card, written one way only', () => {
      expect([hi, lo]).toEqual([35, -16])
      expect(at(b, 'score', String(lo - 1))).toBeNull()
      expect(at(b, 'score', String(lo))).toMatchObject({ score: lo })
      expect(at(b, 'score', String(hi))).toMatchObject({ score: hi })
      expect(at(b, 'score', String(hi + 1))).toBeNull()
      expect(at(b, 'score', '0')).toMatchObject({ score: 0 })
      for (const v of ['-0', '+3', '03', '-03', '3.0']) expect(at(b, 'score', v), v).toBeNull()
      expect(at(b, 'wrap', '0')).toMatchObject({ wrap: false })
      expect(at(b, 'wrap', '2')).toBeNull()
    })
    it('lower wins, on the same deal under the same rule', () => {
      expect(outcome({ ...b, score: -4 }, b)).toBe('beat')
      expect(outcome({ ...b, score: -3 }, b)).toBe('level')
      expect(outcome({ ...b, score: 0 }, b)).toBe('short')
      expect(outcome({ ...b, wrap: false, score: -9 }, b)).toBeNull()
      expect(outcome({ ...b, seed: 5, score: -9 }, b)).toBeNull()
    })
    it('says the score the way the toy does, and names the rule only when it is on', () => {
      expect(beatMessage(b, 'L')).toBe(
        '🏁 Beat my deal at Golf patience: −3, king and ace neighbours. Same cards, same order:\nL',
      )
      expect(beatMessage({ ...b, wrap: false, score: 4 }, 'L')).toBe(
        '🏁 Beat my deal at Golf patience: +4. Same cards, same order:\nL',
      )
      expect(bannerText({ ...b, wrap: false, score: 0 }, true)).toEqual({
        lead: 'A deal to beat:',
        body: 'this link says 0. Same cards, same order — lower wins. It is today’s board here, so it counts as your today’s.',
      })
      expect(beatMessage({ ...b, score: -5 }, 'L', b)).toBe(
        '🏆 I beat the link at Golf patience: −5, king and ace neighbours — it said −3, king and ace neighbours. Same cards, same order, your go:\nL',
      )
    })
  })
  describe('mines', () => {
    const b = FIXTURE.mines
    const names = Object.keys(MINE_SIZES) as (keyof typeof MINE_SIZES)[]
    it('opens from any square of its own size, and from none past it', () => {
      expect(names).toEqual(['small', 'medium', 'large'])
      for (const size of names) {
        const last = MINE_SIZES[size].w * MINE_SIZES[size].h - 1
        const q = (start: number) => ({ ...b, size, start })
        expect(readBeat(beatHash(q(0))), `${size} 0`).toMatchObject({ size, start: 0 })
        expect(readBeat(beatHash(q(last))), `${size} ${last}`).toMatchObject({ size, start: last })
        expect(readBeat(beatHash(q(last + 1))), `${size} ${last + 1}`).toBeNull()
      }
      // the three last squares, as numbers: 9×9, 16×16 and 16×30
      expect(names.map((n) => MINE_SIZES[n].w * MINE_SIZES[n].h - 1)).toEqual([80, 255, 479])
      expect(readBeat(beatHash({ ...b, size: 'small', start: 200 }))).toBeNull()
      expect(at(b, 'start', '-1')).toBeNull()
      expect(at(b, 'size', 'huge')).toBeNull()
      expect(at(b, 'size', 'Large')).toBeNull()
    })
    it('a time from a tenth of a second to a day', () => {
      const day = 24 * 60 * 60 * 10
      expect(at(b, 'tenths', '0')).toBeNull()
      expect(at(b, 'tenths', '1')).toMatchObject({ tenths: 1 })
      expect(at(b, 'tenths', String(day))).toMatchObject({ tenths: day })
      expect(at(b, 'tenths', String(day + 1))).toBeNull()
      expect(at(b, 'tenths', '12.3')).toBeNull()
    })
    it('faster wins, on the same board opened from the same square', () => {
      expect(outcome({ ...b, tenths: 1233 }, b)).toBe('beat')
      expect(outcome({ ...b, tenths: 1234 }, b)).toBe('level')
      expect(outcome({ ...b, tenths: 1235 }, b)).toBe('short')
      expect(outcome({ ...b, start: 240, tenths: 1 }, b)).toBeNull()
      expect(outcome({ ...b, size: 'medium', start: 136, tenths: 1 }, b)).toBeNull()
    })
    it('says the time and the size', () => {
      expect(beatMessage(b, 'L')).toBe(
        '🏁 Beat my board at Mines: 123.4 s on a large board. Same board, opened from the same square:\nL',
      )
      expect(bannerText(b)).toEqual({
        lead: 'A board to beat:',
        body: 'this link says 123.4 s on a large board. Same board, opened from the same square — faster wins.',
      })
      expect(beatMessage({ ...b, tenths: 1500 }, 'L', b)).toBe(
        '🏁 My go at Mines: 150.0 s on a large board — the link I was sent said 123.4 s on a large board. Same board, opened from the same square, your go:\nL',
      )
    })
  })
  describe('tiles', () => {
    const b = FIXTURE.tiles
    it('any layout the toy has, and a time from a second to a day', () => {
      for (const l of TILE_LAYOUTS) expect(at(b, 'layout', l.id)).toMatchObject({ layout: l.id })
      expect(at(b, 'layout', 'Twin')).toBeNull()
      expect(at(b, 'layout', 'tower')).toBeNull()
      const day = 24 * 60 * 60
      expect(at(b, 'secs', '0')).toBeNull()
      expect(at(b, 'secs', '1')).toMatchObject({ secs: 1 })
      expect(at(b, 'secs', String(day))).toMatchObject({ secs: day })
      expect(at(b, 'secs', String(day + 1))).toBeNull()
    })
    it('faster wins, on the same tiles', () => {
      expect(outcome({ ...b, secs: 430 }, b)).toBe('beat')
      expect(outcome({ ...b, secs: 431 }, b)).toBe('level')
      expect(outcome({ ...b, secs: 432 }, b)).toBe('short')
      expect(outcome({ ...b, layout: 'pyramid', secs: 1 }, b)).toBeNull()
    })
    it('says the time and the layout by the name the toy shows', () => {
      expect(beatMessage(b, 'L')).toBe(
        '🏁 Beat my deal at Tile pairs: 7:11 on Twin towers. Same tiles, and the same shuffles for the same presses:\nL',
      )
      expect(bannerText(b)).toEqual({
        lead: 'A deal to beat:',
        body: 'this link says 7:11 on Twin towers. Same tiles, and the same shuffles for the same presses — faster wins; hints and shuffles add time.',
      })
      expect(beatMessage({ ...b, secs: 95 }, 'L', b)).toBe(
        '🏆 I beat the link at Tile pairs: 1:35 on Twin towers — it said 7:11 on Twin towers. Same tiles, and the same shuffles for the same presses, your go:\nL',
      )
    })
  })
})
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
/** Lamps' FIXTURE run: the fewest presses for its board, with a press and its undo put in */
function lampsRun(): number[] {
  const way = lampsToy.solve(lampsToy.make(6, 'cross', 3_000_000_001), 6, 'cross')!
  const spare = [...Array(36).keys()].find((i) => !way.includes(i))!
  return [...way.slice(0, 3), spare, -1, ...way.slice(3)]
}

describe('g4: Lamps, checked by replaying the presses on the board they name', () => {
  type Lamps = Extract<Beat, { game: 'lamps' }>
  const link = FIXTURE.lamps
  const way = lampsToy.solve(lampsToy.make(6, 'cross', 3_000_000_001), 6, 'cross')!
  const at = (b: Lamps) => readBeat(beatHash(b))
  /** the link with its presses spelled by hand, so a letter the writer never makes can be put in */
  const spelled = (letters: string) => {
    const q = paramsOf(beatHash(link))
    q.set('presses', letters)
    return readBeat(`#lab?${q}`)
  }
  const letters = paramsOf(beatHash({ ...link, presses: way })).get('presses')!
  it('a link reads as it was first written: parameters, order and letters', () => {
    expect(beatHash(link)).toBe(
      '#lab?demo=lamps&seed=3000000001&size=6&pattern=cross&presses=JKNA_WXaij',
    )
  })
  it('a real solve opens, an undo counted as a press, as the toy counts it', () => {
    expect(link.presses).toHaveLength(way.length + 2)
    expect(at(link)).toEqual(link)
    expect(at({ ...link, presses: way })).toEqual({ ...link, presses: way })
  })
  it('an old day’s board opens: the link carries the seed, and verifyLamps refuses any but today’s', () => {
    const today = 20_784 // 27 Nov 2026, as dayNumber says
    expect(today).toBe(lampsDay(new Date(2026, 10, 27, 12)))
    const day = today - 30
    const seed = lampsToy.seedFor(day, 5, 'plus')
    const board = lampsToy.make(5, 'plus', seed)
    const actions = lampsToy.solve(board, 5, 'plus')!
    expect(lampsToy.verifyLamps({ day, size: 5, pattern: 'plus', actions }, today)).toEqual({
      ok: false,
      why: 'day',
    })
    const old: Lamps = { game: 'lamps', seed, size: 5, pattern: 'plus', presses: actions }
    expect(at(old)).toEqual(old)
  })
  it('refuses presses that do not switch that board off, or are not presses at all', () => {
    expect(at({ ...link, presses: way.slice(0, -1) }), 'one short').toBeNull()
    expect(at({ ...link, presses: [...way, 0] }), 'a press after dark').toBeNull()
    expect(at({ ...link, presses: [-1, ...way] }), 'an undo first').toBeNull()
    // a press and its undo before the solve is a real run; on a lamp past the board it is not
    expect(at({ ...link, presses: [35, -1, ...way] })).not.toBeNull()
    expect(at({ ...link, presses: [36, -1, ...way] }), 'lamp 36 of 36').toBeNull()
    expect(spelled(`J_${letters}`)).not.toBeNull()
    for (const c of ['x', 'y', 'z', ...'0123456789', '-'])
      expect(spelled(`${c}_${letters}`), c).toBeNull()
    expect(at({ ...link, size: 7 }), 'the same presses on another size').toBeNull()
    expect(at({ ...link, size: 5 })).toBeNull()
    expect(at({ ...link, seed: link.seed + 1 }), 'and another seed').toBeNull()
  })
  it('sizes from the toy’s own list, and runs up to the toy’s own bound', () => {
    const sizes = lampsToy.SIZES
    const solved = (n: number, seed = 3_000_000_001): Lamps =>
      ({
        game: 'lamps',
        seed,
        size: n,
        pattern: 'plus',
        presses: lampsToy.solve(lampsToy.make(n, 'plus', seed), n, 'plus')!,
      }) as Lamps
    const lo = sizes[0]
    const hi = sizes[sizes.length - 1]
    expect(at(solved(lo - 1)), 'lo − 1').toBeNull()
    expect(at(solved(lo))).not.toBeNull()
    expect(at(solved(hi))).not.toBeNull()
    expect(at(solved(hi + 1)), 'hi + 1').toBeNull()
    expect(at(solved(5, 0))).toBeNull()
    expect(at(solved(5, 2 ** 32 - 1))).not.toBeNull()
    /* pad a real solve with presses and their undos to a length. Every real run is EVEN: a board
       is lit by an even number of presses (lamps.ts make), and a press and its undo, or a lamp
       pressed twice, add two — so the first real run past the bound is two past it */
    for (const n of sizes) expect(solved(n).presses.length % 2, `${n}×${n}`).toBe(0)
    const max = lampsToy.MAX_ACTIONS
    const b = solved(6)
    const padded = (length: number): Lamps => {
      const pairs = (length - b.presses.length) / 2
      expect(Number.isInteger(pairs)).toBe(true)
      return { ...b, presses: [...Array(pairs).fill([0, -1]).flat(), ...b.presses] }
    }
    expect(at(padded(max))).toEqual(padded(max))
    expect(at(padded(max + 2)), 'a real run two past the bound').toBeNull()
    expect(shareable(padded(max + 2))).toBe(false)
    expect(spelled('A'.repeat(max + 1)), `${max + 1} letters`).toBeNull()
  })
  it('fewer presses wins, and only on the same board', () => {
    expect(outcome({ ...link, presses: way }, link)).toBe('beat')
    expect(outcome({ ...link, presses: [...link.presses] }, link)).toBe('level')
    expect(outcome({ ...link, presses: [...link.presses, 0, -1] }, link)).toBe('short')
    expect(outcome({ ...link, size: 5, presses: way }, link)).toBeNull()
    expect(outcome({ ...link, pattern: 'plus', presses: way }, link)).toBeNull()
  })
  it('the banner says what was checked, and the sentences read as they should', () => {
    expect(bannerText(link)).toEqual({
      lead: 'A board to beat:',
      body: 'checked here — 10 presses on a 6×6 ✖ board. They were replayed on this page and do switch it off; hints are not in the link. Same board — fewer presses wins, and an undo counts.',
    })
    expect(beatMessage(link, 'L')).toBe(
      '🏁 Beat my board at Lamps: 10 presses on a 6×6 ✖ board. Same board:\nL',
    )
    expect(beatMessage({ ...link, presses: way }, 'L', link)).toBe(
      '🏆 I beat the link at Lamps: 8 presses on a 6×6 ✖ board — it said 10 presses on a 6×6 ✖ board. Same board, your go:\nL',
    )
    expect(verdict({ ...link, presses: way }, link)).toBe(
      ' You beat the link’s 10 presses on a 6×6 ✖ board!',
    )
    expect(bannerText({ ...link, pattern: 'plus' }).body).toContain('a 6×6 ✚ board')
  })
})

describe('g4: Slide, an endless board from its own seeds', () => {
  type Slide = Extract<Beat, { game: 'slide' }>
  const link = FIXTURE.slide
  const at = (b: Slide) => readBeat(beatHash(b))
  const kinds = Object.keys(slideToy.DIFFICULTY) as slideToy.Difficulty[]
  it('a link reads as it was first written', () => {
    expect(beatHash(link)).toBe('#lab?demo=slide&seed=99998&difficulty=hard&pushes=23')
  })
  it('seeds from 1 to the toy’s own last seed', () => {
    expect(at({ ...link, seed: 0 })).toBeNull()
    expect(at({ ...link, seed: 1 })).not.toBeNull()
    expect(at({ ...link, seed: slideToy.SEEDS })).not.toBeNull()
    expect(at({ ...link, seed: slideToy.SEEDS + 1 })).toBeNull()
    expect(slideToy.SEEDS + 1).toBe(100_000)
  })
  it('never fewer pushes than the difficulty’s own fewest, and a bounded count above that', () => {
    for (const difficulty of kinds) {
      const { min } = slideToy.DIFFICULTY[difficulty]
      expect(at({ ...link, difficulty, pushes: min - 1 }), `${difficulty} ${min - 1}`).toBeNull()
      expect(at({ ...link, difficulty, pushes: min })).toEqual({ ...link, difficulty, pushes: min })
    }
    expect(at({ ...link, pushes: 9_999 })).not.toBeNull()
    expect(at({ ...link, pushes: 10_000 })).toBeNull()
  })
  it('only a difficulty the toy has, spelled as it spells it', () => {
    const q = (d: string) => {
      const p = paramsOf(beatHash(link))
      p.set('difficulty', d)
      return readBeat(`#lab?${p}`)
    }
    for (const d of kinds) expect(q(d)).toEqual({ ...link, difficulty: d })
    for (const d of ['expert', 'Hard', 'HARD', 'constructor', ' hard']) expect(q(d), d).toBeNull()
  })
  it('fewer pushes wins, and only on the same board', () => {
    expect(outcome({ ...link, pushes: 22 }, link)).toBe('beat')
    expect(outcome({ ...link }, link)).toBe('level')
    expect(outcome({ ...link, pushes: 24 }, link)).toBe('short')
    expect(outcome({ ...link, seed: 99_997, pushes: 12 }, link)).toBeNull()
    expect(outcome({ ...link, difficulty: 'medium', pushes: 12 }, link)).toBeNull()
  })
  it('the banner and the sentences', () => {
    expect(bannerText(link)).toEqual({
      lead: 'A board to beat:',
      body: 'this link says 23 pushes on a hard board. Same board — fewer pushes wins.',
    })
    expect(beatMessage(link, 'L')).toBe(
      '🏁 Beat my board at Slide: 23 pushes on a hard board. Same board:\nL',
    )
    expect(beatMessage({ ...link, pushes: 30 }, 'L', link)).toBe(
      '🏁 My go at Slide: 30 pushes on a hard board — the link I was sent said 23 pushes on a hard board. Same board, your go:\nL',
    )
  })
})
