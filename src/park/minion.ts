import { movesOf } from '../pets/attack'
import { BAND as BOSS, temperOf } from './temper'
import type { Drawing } from '../draw/strokes'

/**
 * The same creature, at the size there are forty of.
 *
 * ⚠️ ONE DRAWING, ONE READING, THREE ROLES. A boss is already "you but bigger" — said in those
 * words — and that is the right instinct rather than a complaint about it: what a creature IS
 * comes off the picture once, and the ROLE only decides how much of it you get. A player is the
 * reading at scale 1 picking its three casts; a boss is the reading grown and slowed; a minion is
 * the reading shrunk, hurried, and given a few seconds of life.
 *
 * ⚠️ SO THIS IS temperOf RE-RANGED, NEVER A SECOND READING OF THE DRAWING. It asks where a
 * creature sits INSIDE the boss bands — a third of the way up pace, near the top of size — and
 * puts it the same distance up its own. That is what keeps one drawing one creature: the boss
 * version and the minion version of a long-legged thing are both the quick one. Deriving a
 * separate set of dials from the picture would be a second opinion about what somebody drew, and
 * temper.ts exists to be the only one.
 *
 * ⚠️ AND IT COSTS THE WIRE NOTHING, which is the bargain the whole park is built on: everybody
 * already has the drawing, so forty minions are forty creatures nobody had to send.
 */
export type Minion = {
  /** how many times taller than an ordinary creature — under 1, because there are a lot of them */
  scale: number
  /** what it starts with. A few hits, not a fight. */
  life: number
  /** how fast it comes, as a multiple of everybody else */
  pace: number
  /** what it costs you to be touched by one */
  bite: number
}

/**
 * The band everything is held inside.
 *
 * ⚠️ FOR THE REASON temperOf HAS ONE, in its own words: "variety without a band is just a random
 * stat generator, and the failure is not that some bosses are weak — it is that some are
 * impossible and nobody can tell which from looking." Forty of an unbanded drawing is that
 * failure multiplied by forty.
 *
 * ⚠️ AND life IS IN HITS, NOT IN HUNDREDS. A boss has 220 to 470 against swings that land for
 * five to fifteen, which is a fight you learn. A minion has to be a thing you clear on the way
 * past, so the whole band is two or three swings wide — the number that makes a crowd a crowd
 * rather than forty fights.
 */
const BAND = {
  /**
   * ⚠️ AROUND YOUR OWN SIZE, NOT A THIRD OF IT, and that is a correction. This ran 0.45 to 0.85
   * on the reasoning that a crowd has to be readable — and forty things at half height read as
   * young rather than as numerous: "when i spawned the group of minions i thought it was strange
   * they were small." A crowd is made of creatures. What separates a minion from you is that it
   * dies in two hits and there are forty, not that it is knee-high.
   *
   * ⚠️ AND IT SPANS 1, so some are bigger than you. That is the band doing its job rather than a
   * slip: a drawing that would make a towering boss should make a minion you notice, and one that
   * would make a squat boss should make a small quick thing. The role sets the range; the picture
   * still says where in it you land.
   */
  scale: [0.7, 1.15],
  life: [8, 26],
  pace: [1.0, 1.75],
  bite: [3, 9],
} as const

/** where a value sits inside a band, 0 to 1 */
const where = (v: number, [lo, hi]: readonly [number, number]) =>
  hi > lo ? Math.max(0, Math.min(1, (v - lo) / (hi - lo))) : 0.5

/** the same place, in another band */
const into = (u: number, [lo, hi]: readonly [number, number]) => lo + u * (hi - lo)

export function minionOf(art: Drawing): Minion {
  const t = temperOf(art)
  /**
   * ⚠️ THE SIZE READING IS INVERTED, AND THAT IS DELIBERATE RATHER THAN A SLIP. temperOf's scale
   * band runs the other way to what it reads: `2.55 - 0.5 * log2(wide / 1.6)` means a WIDE, squat
   * drawing scores LOW and a tall narrow one scores high. Carried straight across, the lanky
   * thing would also be the biggest minion — which is the right answer, because that is what
   * "bigger" meant about it as a boss too. One creature, one character, three sizes of it.
   */
  const big = where(t.scale, BOSS.scale)
  const quick = where(t.pace, BOSS.pace)
  const tough = where(t.life, BOSS.life)

  /**
   * ⚠️ WHAT IT HITS FOR COMES FROM WHAT IT IS MADE OF, which is the line the scrap's own tile
   * uses and the rule the casts already follow — a cast is as heavy as the average of everything
   * the creature can throw, because taking entry zero meant a boss of one heavy tail hit as
   * softly as a boss of one flick.
   */
  const moves = movesOf(art)
  const swing = moves.length ? moves.reduce((n, m) => n + m.bite, 0) / moves.length : 6

  return {
    scale: into(big, BAND.scale),
    life: into(tough, BAND.life),
    /**
     * ⚠️ MOSTLY ITS OWN QUICKNESS, PARTLY THE FACT THAT IT IS SMALL. Carried across untouched,
     * a creature that reads as a ponderous boss makes a ponderous minion — and forty ponderous
     * things is a slow wall rather than a crowd. Weighting the small ones upward keeps the
     * drawing deciding while making the role feel like the role.
     */
    pace: into(Math.min(1, quick * 0.65 + (1 - big) * 0.35), BAND.pace),
    bite: into(where(swing, [4, 16]), BAND.bite),
  }
}
