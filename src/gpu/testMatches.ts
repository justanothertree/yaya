/**
 * ⚠️ FOR TESTS ONLY. Nothing in the site imports this, and nothing should.
 *
 * How many whole matches a room's tests play, and at how many of their positions they ask the
 * wire for the game back.
 *
 * Every `*Room.test.ts` plays real matches through the room's own rules and decodes them again,
 * and asked of every match at every position that was the slowest thing in the suite. Decoding
 * replays a game from its first move, so a match of n moves costs about n²/2 of them; a room
 * whose computer searches before it moves pays for that search on every match; and a deep
 * `toEqual` of a whole field costs more than the physics that made it. Measured on 16 Nov 2026
 * with only the room files running: go 13.3s, fox 6.3s, bowling 4.6s, under a 20-second ceiling
 * that bowling went past on a busy runner (#366). The code was not slow. The tests asked the same
 * question many times over.
 *
 * So by default a test plays the few matches it NAMES, each chosen for what is in it (a strike,
 * a capture, a win for each side), and one more drawn at random for this run, and decodes a
 * sample of each match's positions. The nightly run (`.github/workflows/nightly.yml`, with
 * YAYA_NIGHTLY=1) plays every match these tests ever played, at every position, plus the drawn
 * one.
 *
 * The drawn seed is in the test's name. To repeat a red run, pin it:
 *   YAYA_SEED=<seed> npx vitest run src/gpu/bowlingRoom.test.ts
 *
 * The tests that ask whether each computer level beats the one below it are split the same way,
 * with `NIGHTLY` and nothing drawn: their bars were measured over dozens of games, and a game
 * drawn at random can be lost by the better player, so a drawn one would make a red run mean
 * nothing. Every push plays one named seed from both chairs, which a level that plays like the one
 * below cannot win twice; the whole games the bars were measured on run nightly. Measured on
 * 16 Nov 2026 under a full run: cribbage 58.5s and hex 51.4s, each against a 60-second limit.
 *
 * Two do it differently, and say why where they do it. Fox's two sides are not the same side,
 * so swapping chairs makes no one game of two; there, one side's level is raised on a seed that
 * side lost, and the result has to change. Chess's Hard takes three to six seconds a game, so it
 * is asked at the one place its extra move of depth decides: a mate in two that starts by giving
 * the queen away. Golf's par is asked of three named deals instead of twenty-five.
 */

/** the exhaustive run: every named match, every position */
export const NIGHTLY = import.meta.env.YAYA_NIGHTLY === '1'

const pinned = Number(import.meta.env.YAYA_SEED)

/**
 * One seed for this run, the same for every test in a file: YAYA_SEED when that is set,
 * otherwise drawn. Never below 100, so it is never one of the small seeds a test names, and
 * under 2³⁰, which every room's seed reader takes.
 */
export const DRAWN =
  Number.isSafeInteger(pinned) && pinned > 0 ? pinned : 100 + Math.floor(Math.random() * 2 ** 30)

/** the seeds a test names: `few` by default, `all` in the nightly run */
export const named = (few: readonly number[], all: readonly number[]): number[] =>
  NIGHTLY ? [...all] : [...few]

export type Match = { seed: number; kind: 'named' | 'drawn for this run' }

/** the matches to play, for `it.each`: the named seeds, then the drawn one */
export const matches = (few: readonly number[], all: readonly number[]): Match[] => [
  ...named(few, all).map((seed) => ({ seed, kind: 'named' as const })),
  { seed: DRAWN, kind: 'drawn for this run' },
]

/**
 * The positions of a match worth decoding. In the nightly run, every one. By default, the
 * first, the last, and every `every`-th between, starting from an offset drawn for this run, so
 * the positions skipped are not the same ones every time.
 */
export function sample<T>(seen: readonly T[], every = 4): T[] {
  if (NIGHTLY) return [...seen]
  const from = DRAWN % every
  return seen.filter((_, i) => i === 0 || i === seen.length - 1 || i % every === from)
}
