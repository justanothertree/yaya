import type { Drawing } from '../draw/strokes'
import { bossPace, movesOf, type Attack } from '../pets/attack'
import { CAST, type CastKind } from './cast'
import { bodyRatio, rigOf, type PartKind } from '../pets/rig'

/**
 * What kind of thing a boss is, read out of the drawing.
 *
 * ⚠️ THE DRAWING ALREADY DECIDED WHAT IT LOOKS LIKE AND WHAT IT CAN THROW. It did not decide how
 * it MOVES or how it picks its fights, and those are most of what makes an opponent memorable —
 * so every boss walked at the same speed, backed off on the same beat and carried the same 520
 * health whether it was a winged darter or a thing made of one enormous jaw. Two completely
 * different pictures fought identically, which quietly said the drawing was decoration.
 *
 * ⚠️ DIALS, NOT PERSONALITIES. The obvious version of this is a list — "wings mean the darter,
 * horns mean the charger" — and a list is exactly what the nav-key guard was before it got found
 * out. A list has to be extended for every new combination, silently does nothing for a creature
 * that is two of them at once, and has a right answer at the top. So the parts turn a handful of
 * continuous dials, one brain reads the dials, and a creature with wings AND a horn is genuinely
 * between the two rather than whichever the list checked first.
 *
 * ⚠️ AND IT COSTS THE WIRE NOTHING. This is a pure function of the drawing, and everybody in the
 * park already has the drawing — so both ends work out the same temper from the same picture with
 * nothing sent about it. A boss whose character travelled as numbers would be a boss whose
 * character could disagree between two screens.
 */

export type Temper = {
  /** how many times taller than an ordinary creature it stands */
  scale: number
  /** what it starts with */
  life: number
  /** how fast it walks, as a multiple of everybody else */
  pace: number
  /** where it wants to stand, as a multiple of its own longest reach */
  range: number
  /** seconds it commits to a decision before making another */
  beat: number
  /** 0 gives ground constantly, 1 never gives an inch */
  nerve: number
  /** 0..1, how much it commits to a straight run at you */
  charge: number
  /**
   * The big committed things it reaches for, best first.
   *
   * ⚠️ THREE CASTS THAT EVERY CREATURE THREW IDENTICALLY was the one place in this module
   * where the drawing stopped deciding. Size, health, pace, range, rhythm and nerve are all read
   * off the picture; the casts were a rotation through a fixed list, so two completely different
   * bosses had exactly the same three big attacks in exactly the same order. Whatever somebody
   * drew, this was the part of the fight that ignored them.
   *
   * ⚠️ AND IT IS AN ORDER, NOT A CHOICE OF ONE. A boss with only its favourite would be a
   * boss you learn in ten seconds; a boss that never throws its favourite has no character. The
   * order is the character, and the rotation still visits all three.
   */
  casts: CastKind[]
}

/**
 * The band everything is held inside.
 *
 * ⚠️ VARIETY WITHOUT A BAND IS JUST A RANDOM STAT GENERATOR, and the failure is not that some
 * bosses are weak — it is that some are impossible and nobody can tell which from looking. Every
 * dial below is clamped, so the worst drawing anybody makes is still a fight and the best one is
 * still beatable.
 */
const BAND = {
  scale: [2.05, 3.05],
  pace: [0.68, 1.3],
  range: [0.5, 1.02],
  beat: [0.34, 0.92],
  nerve: [0.2, 0.92],
  life: [220, 470],
} as const

const hold = (v: number, [lo, hi]: readonly [number, number]) => Math.max(lo, Math.min(hi, v))

/**
 * How much health a boss gets.
 *
 * ⚠️ DIFFICULTY IS A BUDGET; THE DRAWING DECIDES HOW IT IS SPENT, NOT HOW MUCH THERE IS. This is
 * the whole of "unique but still a challenge" in one line. Let the drawing set health directly and
 * a creature that already hits hardest is also the one that lasts longest, which is not two kinds
 * of boss — it is one good one and one bad one. So what a boss can put out is exactly what its
 * health is divided by: the dangerous ones are short, sharp and frightening, and the ones with
 * little to throw are walls you chip down.
 *
 * ⚠️ AND IT IS A DESIGN LEVER, NOT A CORRECTION. Measured with health held flat at 520 across
 * twelve very different drawings, a scripted fight already took between 49 and 78 seconds — so
 * fights were not unequal in LENGTH and this is not fixing that. What was flat was their SHAPE:
 * every boss took about a minute and none was either a sprint or a siege. This makes glass cannons
 * and walls out of what somebody drew, and the band is what keeps both of them a fight.
 *
 * ⚠️ WHAT IT DOES NOT PREDICT is how much you actually get hit, which ran 110 to 310 over those
 * same twelve and did not follow this figure at all. What a boss LANDS depends on how it moves and
 * how you answer it; this is only what it is capable of throwing.
 *
 * ⚠️ 280 PUTS THE MIDDLE NEAR 390, which for a middling creature is about forty seconds alone
 * and twenty with a friend. The flat 520 it replaces was nearer a minute of holding one button.
 */
const BUDGET = 280

/** ⚠️ park-only and host-only, unlike the fight sim — see the note on determinism in fight.ts */
const roll = (n: number, salt: number): number => {
  const x = Math.sin(n * 12.9898 + salt * 78.233) * 43758.5453
  return x - Math.floor(x)
}

/** Which beat is a backing-off one, and which is a run at you. */
export const givesGround = (beat: number, t: Temper): boolean => roll(beat, 1) > t.nerve
export const runsAtYou = (beat: number, t: Temper): boolean => roll(beat, 2) < t.charge * 0.55
/**
 * Whether this beat's swing is a committed one.
 *
 * ⚠️ NERVE DECIDES, because a heavy is the move you have to mean — it reaches further and hurts
 * nearly twice as much, and leaves you standing there afterwards. A creature that never gives
 * ground is exactly the one that should be willing to pay that, and a darter is the one that
 * should not.
 */
export const goesBig = (beat: number, t: Temper): boolean => roll(beat, 3) < 0.22 + t.nerve * 0.36

/** The longest thing it can throw, which is what it wants to fight at. */
const longest = (moves: Attack[]): number =>
  moves.reduce((best, a) => Math.max(best, a.reach), 0) || 0.9

/** How much it can put out, per second of being committed to doing it. */
const bitePerSecond = (moves: Attack[]): number =>
  moves.reduce((best, a) => Math.max(best, a.bite / Math.max(0.2, a.span + a.rest)), 0) || 8

/**
 * How long its QUICKEST move ties it up, which is how twitchy or deliberate the thing reads.
 *
 * ⚠️ THE QUICK ONE, NOT THE AVERAGE OF ALL SIX. An average includes the heavies, which are a
 * fixed multiple of the lights — so every creature measured came out between 0.56 and 1.25 and
 * the dial spent its life clamped at the slow end of its own band. The move a creature throws
 * without thinking is the honest answer to how often it does something.
 */
const poise = (moves: Attack[]): number => {
  const q = moves[0]
  return q ? q.span + q.rest : 0.5
}

export function temperOf(art: Drawing): Temper {
  const parts = rigOf(art).filter((p) => p.kind !== 'hit')
  const count = new Map<PartKind, number>()
  for (const p of parts) count.set(p.kind, (count.get(p.kind) ?? 0) + 1)
  const has = (k: PartKind) => count.has(k)
  const many = (k: PartKind) => Math.min(2, count.get(k) ?? 0)

  /* ⚠️ THE MOVES THE BOSS WILL ACTUALLY THROW, not the ones the creature throws. Reading the
     player's timings here would budget health against a danger the boss does not have — see
     bossPace, which slows it down and hits harder in the same breath. */
  const moves = movesOf(art).map(bossPace)
  const reach = longest(moves)
  /* 0 for a stub, 1 for the longest thing the templates can produce — see the reach note */
  const far = hold((reach - 0.7) / 0.9, [0, 1] as const)

  /**
   * ⚠️ A SPRAWLING CREATURE STANDS SHORTER THAN A COMPACT ONE, so that both are about as much
   * boss. Scale is a HEIGHT, and a drawing three times as wide as it is tall scaled to the same
   * height covers three times the field — which is not a bigger boss, it is a boss you cannot
   * walk past. bodyRatio is width over height, and it is the creature's own shape rather than
   * the picture's, so a long attack drawn off the side does not shrink it.
   */
  const wide = bodyRatio(art)
  /**
   * ⚠️ PIVOTED ON THE SHAPE A CREATURE ACTUALLY IS, NOT ON A SQUARE. This was linear either
   * side of wide = 1, which quietly assumed the neutral creature is as tall as it is broad — and
   * none of them are. The default paper is Free, which pins to the board, so a creature drawn to
   * fill a normal page lands somewhere around 1.5–2.0. Measured across the 13 drawings on this
   * machine: bodyRatio ran 0.93–3.51 and TEN of them came out at 2.05, the floor. A dial that
   * returns the same number for four fifths of its inputs is not a dial, and this is the one a
   * player would notice first, because it is how big the thing is.
   *
   * ⚠️ AND IN OCTAVES, because a ratio is multiplicative — twice as broad is one step
   * whichever end you start from. Half an octave of shape is half the band, so the range real
   * drawings occupy is the range the height actually uses.
   */
  const scale = hold(2.55 - 0.5 * Math.log2(wide / 1.6), BAND.scale)

  /**
   * ⚠️ WHAT IT MOVES WITH, AND THEN WHAT IT NEEDS. Legs and wings make a thing quick and fire
   * makes it slow, which is character. But a short-armed boss that is also slow can simply be
   * walked away from for as long as you like, which is not an easy boss, it is a boss that has
   * been switched off — so anything that has to get close is given the legs to do it.
   */
  const foot =
    0.88 +
    0.1 * many('leg') +
    0.15 * (has('wing') ? 1 : 0) +
    0.1 * (has('spin') ? 1 : 0) +
    0.05 * (has('float') ? 1 : 0) -
    0.17 * (has('flame') ? 1 : 0) -
    0.06 * (has('tail') ? 1 : 0)
  const pace = hold(foot + (1 - far) * 0.16, BAND.pace)

  /* it fights at the range its own drawing is good at: a sweeper hovers at the end of its tail,
     a biter has to be in your face and knows it */
  const range = hold(0.52 + far * 0.46, BAND.range)

  /* 0.42s of commitment becomes a 0.40s tick and 0.92s becomes 0.85 — the measured band mapped
     onto this one, so the dial is used rather than clamped */
  const beat = hold(0.02 + poise(moves) * 0.9, BAND.beat)

  /**
   * ⚠️ NERVE IS NOT AGGRESSION, it is whether it gives ground. A winged thing beating back out of
   * reach and coming in again is as frightening as a horned one that never steps back — they are
   * two ways of being hard, and a single "how aggressive" dial would have collapsed them into one.
   */
  const nerve = hold(
    0.46 +
      0.12 * many('leg') +
      0.24 * (has('horn') ? 1 : 0) +
      0.16 * (has('flame') ? 1 : 0) +
      0.1 * (has('mouth') ? 1 : 0) -
      0.26 * (has('wing') ? 1 : 0) -
      0.14 * (has('float') ? 1 : 0),
    BAND.nerve,
  )

  /* the parts that mean "this thing comes at you in a straight line and you move or you don't" */
  const charge = hold(
    0.12 +
      0.5 * (has('horn') ? 1 : 0) +
      0.3 * (has('spin') ? 1 : 0) +
      0.22 * (has('mouth') ? 1 : 0) +
      0.1 * many('leg'),
    [0, 0.95] as const,
  )

  /**
   * ⚠️ EVERYTHING ABOVE GOES INTO THIS, which is what keeps the band a band: how much it can
   * throw, how relentlessly it gets to throw it, and how close it insists on standing.
   *
   * ⚠️ BEING ON TOP OF YOU IS WORSE THAN OUT-RANGING YOU, and this term was the wrong way round
   * first. Reach looks like the frightening stat, so far-reaching bosses were scored as the
   * dangerous ones — and then measured: over twelve drawings the damage a boss actually landed
   * ran almost perfectly INVERSE to how far away it wanted to stand. 500 off me for the one that
   * fights at 0.68 of its reach, 138 for the one that fights at 0.92. A boss in your face shoves
   * you, and a shoved creature cannot swing, so being crowded costs you the fight twice over. The
   * worst case of getting it backwards was a body-only slab given 510 health for being "harmless"
   * that then stagger-locked a scripted player for a hundred and nine seconds.
   *
   * ⚠️ AND ONLY THE TERMS THAT SURVIVED THE MEASUREMENT. Size and charge were in here too and
   * moved the answer by a few percent each in a sample of twelve, which is not a finding, it is a
   * formula nobody can reason about later.
   */
  const danger =
    (bitePerSecond(moves) / 14) *
    (1.2 - 0.4 * far) *
    (0.72 + 0.28 * pace) *
    Math.pow(0.62 / beat, 0.35)
  const life = Math.round(hold(BUDGET / Math.max(0.05, danger), BAND.life) / 5) * 5

  /**
   * ⚠️ READ OFF THE SAME DIALS EVERYTHING ELSE IS, rather than given a roll of their own. A
   * creature that runs at you wants the one that grows out from under it; one that hangs at the
   * end of a long reach wants the one thrown ahead; one that neither charges nor keeps its
   * distance gets the rolling line, which is the answer to standing anywhere in particular.
   * Scoring all three and sorting means the favourite is the drawing's, and the other two are
   * still in the fight.
   */
  /**
   * ⚠️ SCORED ON WHERE EACH DIAL SITS IN ITS OWN BAND, not on its raw value — and the first
   * version of this did the latter and gave all thirteen creatures on this machine the same
   * favourite. The dials do not share a scale: `charge` starts at 0.12 and only climbs if you
   * drew a horn, a spin or a mouth, so it lives near its floor; `range` lives in the top half of
   * its band. Comparing them raw is comparing a number that is usually 0.12 against one that is
   * usually 0.8, and the second one wins every time regardless of the drawing. This is the same
   * mistake the boss's SIZE dial made, which also came out pinned for ten of thirteen.
   */
  const inBand = (v: number, lo: number, hi: number) =>
    Math.max(0, Math.min(1, (v - lo) / (hi - lo)))
  const chargeN = inBand(charge, 0, 0.95)
  const paceN = inBand(pace, BAND.pace[0], BAND.pace[1])
  const rangeN = inBand(range, BAND.range[0], BAND.range[1])
  const nerveN = inBand(nerve, BAND.nerve[0], BAND.nerve[1])
  /* ⚠️ WEIGHTS SET AGAINST THE MEASURED SPREAD, the way saysOf's thresholds are. Picked by
     eye the first two times and both times one cast took every creature on this machine — these
     are the set, out of a search over the real thirteen, that actually leaves all three as
     somebody's favourite. */
  const likesClose = chargeN * 1.4 + (1 - rangeN) * 0.2
  const likesRange = rangeN * 0.9
  const likesLines = nerveN * 0.9
  /**
   * ⚠️ THE RANGED SLOT IS A FORK, NOT A FOURTH COMPETITOR, and that is a decision about the
   * population rather than about the attack. Scoring four things against each other needs the
   * four scores to separate on real drawings — and the real drawings do not oblige: across the
   * thirteen on this machine there are only FOUR distinct tempers (eight are test probes with
   * identical dials), charge sits between 0.12 and 0.34 inside a 0..0.95 band, and the three
   * existing scores already land within 6% of each other on the commonest profile. A fourth
   * weight tuned to separate four points is a weight fitted to four points, which is how the
   * size dial and the first cast dial both ended up pinned.
   *
   * So the two RANGED answers split on a second question instead of competing on the first.
   * Something that fights at the end of its reach either plants and marks the ground or throws
   * something at you, and which of those it is comes down to how quick it is. That is legible
   * at the pencil — shorter legs and longer parts make a marker, the other way round makes a
   * thrower — and it cannot be pinned, because it is a side of a threshold rather than the top
   * of a ranking.
   *
   * ⚠️ AND THE THRESHOLD IS THE OBSERVED MEDIAN. Normalised pace runs 0.47 to 0.67 on the real
   * shapes with its middle at about 0.52, so that is where the fork goes: against the band's own
   * midpoint of 0.5 it would look identical and mean something else entirely.
   */
  const ranged: CastKind = paceN >= 0.52 ? 'bolt' : 'mark'
  const casts = (
    [
      ['bloom', likesClose],
      [ranged, likesRange],
      ['wave', likesLines],
    ] as Array<[CastKind, number]>
  )
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k)

  return { scale, life, pace, range, beat, nerve, charge, casts }
}

/**
 * What the room says it read.
 *
 * ⚠️ SAID OUT LOUD OR THE DRAWING MIGHT AS WELL NOT MATTER. Half the point of a boss made out of
 * your own picture is noticing that the picture is WHY it fights like that — and nobody notices a
 * number they were never shown. Asked for directly: guide me rather than leave me clueless.
 *
 * ⚠️ FROM THE DIALS, NOT FROM THE PARTS, so it can never describe a boss that is not the one you
 * are about to fight. A sentence built from the layer names would be a second reading of the
 * drawing, free to drift from the first.
 */
export function saysOf(t: Temper): string {
  /* ⚠️ THRESHOLDS SET AGAINST THE MEASURED SPREAD, not against the width of the band. Picked by
     eye first, and eight of twelve creatures came back "keeps swinging and circles" — a readout
     that agrees with itself about everything is one nobody learns anything from. */
  const speed = t.pace > 1.05 ? 'quick' : t.pace < 0.85 ? 'lumbering' : 'steady'
  const where =
    t.range > 0.85
      ? 'fights at the end of its reach'
      : t.range < 0.76
        ? 'has to be right on top of you'
        : 'keeps you at arm’s length'
  const how = t.charge > 0.45 ? 'charges' : t.beat > 0.62 ? 'picks its moment' : 'keeps swinging'
  const hold = t.nerve > 0.6 ? 'never gives ground' : t.nerve < 0.4 ? 'darts away' : 'circles'
  /* ⚠️ HOW BIG IT IS WAS THE ONE THING THIS DID NOT SAY, and it is the first thing you see on
     the field. Same rule as the thresholds above — 2.55/2.47 split the 13 drawings on this machine
     4 / 5 / 4 rather than agreeing about everybody. Nothing is said in the middle, because "about
     the usual size" is not worth a word. */
  const size = t.scale > 2.55 ? 'towering, ' : t.scale < 2.47 ? 'squat, ' : ''
  /* ⚠️ AND THE BIG THING IT IS BUILT FOR. Every other line here describes a swing, and a
     creature's cast is the part of it that reaches where swings cannot — leaving it out of the
     one sentence that says what a boss IS meant a maker could not see the thing it would do
     most memorably. The wording is the cast's own, so the maker and the field agree. */
  return `A ${size}${speed} boss that ${where}. It ${how} and ${hold}. Then ${CAST[t.casts[0]].says}.`
}
