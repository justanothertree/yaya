import { describe, expect, it } from 'vitest'
import { SHARES, bestLine, clock } from './bests'
import { GLIDE_KEY, TASKS } from '../gpu/glide'
import { SKIP_KEY } from '../gpu/skip'
import { SUN_KEY } from '../gpu/sun'
import { JIGSAW_BESTS_KEY } from '../gpu/jigsaw'
import { BEST_KEY as TRIALS_KEY } from '../gpu/trials'
import { PEGDROP_KEY } from '../gpu/pegdrop'
import { STACK_KEY } from '../gpu/stack'
import { RPS_KEY } from '../gpu/rps'
import { DICE_KEY } from '../gpu/dice'
import { POKER_KEY } from '../gpu/poker'
import registry from '../sections/GpuLab.tsx?raw'

const store = (o: Record<string, string>) => (k: string) => o[k] ?? null

describe('sharing a best in a comment', () => {
  it('says nothing for a toy with nothing kept, or one that keeps no best', () => {
    for (const id of SHARES) expect(bestLine(id, 'X', store({})), id).toBeNull()
    expect(bestLine('swarm', 'Swarm', store({}))).toBeNull()
  })
  it('words a kept best with the toy’s own reader', () => {
    const read = store({
      [SKIP_KEY]: JSON.stringify({ best: 17, furthest: 41.5, done: ['three', 'bridge'] }),
      [GLIDE_KEY]: JSON.stringify({ glide: 780, street: 2969 }),
      [SUN_KEY]: JSON.stringify({ place: 'Lima', lat: -12, day: 9, best: 412, scale: 'sun' }),
      [JIGSAW_BESTS_KEY]: JSON.stringify({ 'dusk:48': 301, 'reef:24': 95 }),
      [TRIALS_KEY]: '3723',
    })
    expect(bestLine('skip', 'Skipping stones', read)).toBe(
      '🏆 My best at Skipping stones: best 17 skips, furthest 41.5 m, 2 of 6 challenges',
    )
    const glide = TASKS.find((t) => t.id === 'glide')!.name
    const street = TASKS.find((t) => t.id === 'street')!.name
    expect(bestLine('glide', 'Soaring', read)).toBe(
      `🏆 My best at Soaring: ${glide} 13:00, ${street} 49:29`,
    )
    expect(bestLine('sun', 'Sun path', read)).toBe(
      '🏆 My best at Sun path: Where’s the sun? best 412 of 500',
    )
    expect(bestLine('jigsaw', 'Jigsaw', read)).toBe(
      '🏆 My best at Jigsaw: Coral reef, 24 pieces in 1:35',
    )
    expect(bestLine('trials', 'Bike trials', read)).toBe(
      '🏆 My best at Bike trials: best time 62.05 s',
    )
  })
  it('peg drop shares a best only above the bank everybody starts with', () => {
    const at = (o: object) => store({ [PEGDROP_KEY]: JSON.stringify(o) })
    expect(bestLine('pegdrop', 'Peg drop', at({ points: 40, best: 100, drops: 9 }))).toBeNull()
    expect(
      bestLine('pegdrop', 'Peg drop', at({ points: 40, best: 412.5, drops: 9, bigHit: 33 })),
    ).toBe('🏆 My best at Peg drop: most points ever 412.5, biggest landing 33× (9 drops)')
  })
  it('stackfall names the longest survival and the hardest computer beaten', () => {
    const at = (o: object) => store({ [STACK_KEY]: JSON.stringify(o) })
    expect(bestLine('stack', 'Stackfall', at({ wins: { easy: 0 } }))).toBeNull()
    expect(
      bestLine(
        'stack',
        'Stackfall',
        at({ longest: 192.4, lines: 45, wins: { easy: 3, medium: 1 } }),
      ),
    ).toBe('🏆 My best at Stackfall: survived 3:12 with 45 lines, beat the medium computer')
  })
  it('rock, paper, scissors names matches won and the longest coin run worth mentioning', () => {
    const at = (o: object) => store({ [RPS_KEY]: JSON.stringify(o) })
    expect(bestLine('rps', 'RPS', at({ matchesLost: 4, streak: 2 }))).toBeNull()
    expect(bestLine('rps', 'RPS', at({ matchesWon: 2, matchesLost: 3, streak: 6 }))).toBe(
      '🏆 My best at RPS: beat the mind-reader in 2 of 5 matches, called the coin right 6 times running',
    )
  })
  it('ten thousand shares only a win', () => {
    const at = (o: object) => store({ [DICE_KEY]: JSON.stringify(o) })
    expect(bestLine('dice', 'Ten thousand', at({ lost: 3, bestTurn: 900 }))).toBeNull()
    expect(
      bestLine('dice', 'Ten thousand', at({ won: 2, lost: 3, bestTurn: 3450, fewestTurns: 14 })),
    ).toBe(
      '🏆 My best at Ten thousand: won 2 of 5 against the computer, fastest in 14 turns, best turn 3,450',
    )
  })
  it('hold’em names tables won and the biggest pot', () => {
    const at = (o: object) => store({ [POKER_KEY]: JSON.stringify(o) })
    expect(bestLine('poker', 'Hold’em', at({ tables: 3 }))).toBeNull()
    expect(bestLine('poker', 'Hold’em', at({ tables: 5, won: 2, biggestPot: 4200 }))).toBe(
      '🏆 My best at Hold’em: won 2 of 5 tables, biggest pot 4,200',
    )
  })
  it('a hand-edited or broken store is no best, never a crash', () => {
    const junk = store({ [SKIP_KEY]: '{', [GLIDE_KEY]: '"x"', [TRIALS_KEY]: 'fast' })
    for (const id of ['skip', 'glide', 'trials']) expect(bestLine(id, 'X', junk)).toBeNull()
  })
  it('only names toys the Lab has', () => {
    for (const id of SHARES) expect(registry, id).toContain(`id: '${id}'`)
  })
  it('clock is m:ss, and h:mm:ss past the hour', () => {
    expect([59.4, 61, 3600, 3725].map(clock)).toEqual(['0:59', '1:01', '1:00:00', '1:02:05'])
  })
})
