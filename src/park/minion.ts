import { A_SWING, movesOf } from '../pets/attack'
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
 * ⚠️ AND life IS IN SWINGS, NOT IN POINTS. A boss has 220 to 470 against swings that land for
 * five to fifteen, which is a fight you learn. A minion has to be a thing you clear on the way
 * past, so the whole band is two or three swings wide — the number that makes a crowd a crowd
 * rather than forty fights.
 */
export const BAND = {
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
  /**
   * ⚠️ IN SWINGS, AND THAT IS A CORRECTION. This read `[8, 26]` beside the note above promising
   * a band "two or three swings wide" — and an ordinary swing takes off A_SWING, so it was
   * really 1.6 to 5.2. Measured in the park: a wave of ten at 23.8 life against a bite of 5,
   * which is five clean swings EACH and about fifty to clear one wave. That is not a crowd you
   * get through, it is forty fights, which is the exact failure the note warns about and the
   * number underneath it was causing.
   *
   * ⚠️ AND 1.1 AT THE BOTTOM RATHER THAN 1, so the frailest thing anybody can draw still takes
   * a swing rather than falling over to a graze — a crowd that dies to being looked at has no
   * weight to it either.
   */
  /* ⚠️ TWO SWINGS AT THE TOP, NOT THREE, AND THAT IS A SECOND CORRECTION. Three was already a
     tighter band than the [8, 26] it replaced, and against a wave of ten it still means roughly
     twenty-four clean swings to clear one — reported as "hard to hit quickly". A crowd you work
     through is the genre; a crowd you grind through is not. */
  life: [1.1 * A_SWING, 2 * A_SWING],
  /**
   * ⚠️ ABOVE PARITY AT THE BOTTOM, BECAUSE 1.0 MEANT "CANNOT CATCH YOU".  is
   * TUNE.speed times this, and TUNE.speed is the player's own top speed — so a minion at 1.0
   * matched a running player exactly and could never close the gap. Measured: walking away in a
   * straight line took 0 hits in 4.5 seconds, which is not a crowd, it is scenery. Reported as
   * "the minions right now feel a little easy to dodge".
   *
   * ⚠️ AND ONLY JUST ABOVE IT. Making them all clearly faster would mean never being able to
   * disengage, which is the opposite failure; a sixth again means running buys you distance
   * slowly rather than instantly, and the thing that actually kills you is still being
   * surrounded rather than being outrun.
   */
  /**
   * ⚠️ ABOVE PARITY AT THE BOTTOM, BECAUSE 1.0 MEANT "CANNOT CATCH YOU". The flock's speed is
   * TUNE.speed times this, and TUNE.speed is the PLAYER's own top speed — so a minion at 1.0
   * matched a running player exactly and could never close the gap. Measured: walking away in a
   * straight line took 0 hits in 4.5 seconds, which is not a crowd, it is scenery. Reported as
   * "the minions right now feel a little easy to dodge".
   *
   * ⚠️ AND ONLY JUST ABOVE IT. Making them all clearly faster would mean never being able to
   * disengage, which is the opposite failure and a worse one. A sixth again means running buys
   * you distance slowly rather than instantly, so the thing that kills you is still being
   * surrounded rather than being outrun.
   */
  pace: [1.16, 1.9],
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

/**
 * How a minion's bite is paced, in seconds.
 *
 * ⚠️ BECAUSE A MINION HAD NO ATTACK AT ALL. Touching you WAS the damage: the park found anything
 * whose footprint met yours and applied a blow on that frame, with no wind-up, no commitment and
 * nothing to read. That is why the grace window had to exist — `safe` is a patch over contact
 * being unreadable, and the note on it says so. A bite with three stages makes the same contact
 * into something you can see coming, step out of, or swing first against, which is the whole
 * difference between standing in a crowd and fighting one.
 *
 * ⚠️ THE SAME SHAPE AN Attack HAS, deliberately: a wind-up, a window where it is dangerous, and
 * a recovery where it is not. Everything else in this game that hurts you is built that way, and
 * a swarm that worked differently would be a second set of rules to learn for the enemy there
 * are most of.
 *
 * ⚠️ AND DERIVED FROM THE ROLE RATHER THAN PICKED, like every other number here. A quick minion
 * snaps at you and recovers fast; a big slow one telegraphs and then stands there having missed.
 * `pace` already carries exactly that reading of the drawing, so this asks it rather than adding
 * a dial — which also means the creature you drew decides how its wave feels to fight.
 */
export type Bite = {
  /** seconds of wind-up before it lands, during which it is committed and holds still */
  wind: number
  /** seconds the bite is dangerous */
  live: number
  /** seconds it stands there harmless afterwards */
  rest: number
}

/**
 * ⚠️ THE WIND-UP IS LONGER THAN A PLAYER'S REACTION AT ITS SHORTEST. 0.18s is about the floor of
 * what anybody can act on, so the quickest thing anybody can draw is still readable rather than
 * merely fast — a crowd whose tells cannot be seen is the unreadable contact this replaces.
 */
const BITE = {
  wind: [0.5, 0.18],
  live: 0.1,
  rest: [0.72, 0.26],
} as const

export function biteOf(k: Minion): Bite {
  /* ⚠️ the bands run DOWNWARD, because quicker means shorter at both ends — see BITE */
  const quick = where(k.pace, BAND.pace)
  return {
    wind: into(quick, BITE.wind),
    live: BITE.live,
    rest: into(quick, BITE.rest),
  }
}

/** how long one whole bite takes, start to finish */
export const biteSpan = (b: Bite): number => b.wind + b.live + b.rest

/**
 * Whether a bite that has been running this long is dangerous right now.
 *
 * ⚠️ ASKED RATHER THAN COMPARED AT THE CALL SITE, for the reason posedAt is: the park needs this
 * to decide damage and the renderer needs it to decide what to draw, and two places comparing
 * their own pair of numbers is how those two come to disagree about when a bite lands.
 */
export const biting = (b: Bite, t: number): boolean => t >= b.wind && t < b.wind + b.live

/** and whether it is still winding up, which is the part you are meant to see and answer */
export const winding = (b: Bite, t: number): boolean => t >= 0 && t < b.wind
