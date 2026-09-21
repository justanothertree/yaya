import { PET_TALL } from './play'
import { inPlay } from './budget'
import { bodyRatio, rigOf, type Box, type Part, type PartKind } from './rig'
import type { Drawing } from '../draw/strokes'

/**
 * What a creature can throw, read out of what it is made of.
 *
 * ⚠️ THIS FILE KNOWS NOTHING ABOUT FIGHTING, and that is the point of it existing separately.
 * An attack here is a SHAPE AND A CLOCK — how far it reaches, how long the swing lasts, and when
 * during that swing it is dangerous. What a hit then DOES is the game's business: the fighting
 * room turns it into damage and a launch, and a park would turn the same swipe into a snack
 * knocked out of a bush. The drawing owns the geometry, the game owns the consequences, so an
 * attack drawn once works in both without either game knowing the other exists.
 *
 * ⚠️ AND IT IS THE SAME BET AS THE RIG, A THIRD TIME. Layer names already decide what a part is
 * and how it moves; here they decide what it can hit you with. You do not pick moves from a list
 * — you drew a tail, so you have a sweep, and it is as long as the tail you actually drew.
 */

export type Attack = {
  /** what to call it, in one word */
  name: string
  /** the part it is thrown with, so a room can say where it came from */
  from: PartKind
  /** how long the whole swing takes, in seconds */
  span: number
  /**
   * When inside the swing it can hurt, as fractions of `span`.
   *
   * ⚠️ A WIND-UP AND A RECOVERY ARE WHAT MAKE AN ATTACK A DECISION. Live for the whole swing and
   * the only question is who pressed first; live for the middle third and there is a moment to
   * step into and a moment to punish, which is the entire game underneath a fighting game.
   */
  live: [number, number]
  /**
   * How far past the creature's middle it reaches, in PET-HEIGHTS.
   *
   * ⚠️ HEIGHTS, NOT WIDTHS, and it was widths first. Every creature is drawn the same height
   * on screen and whatever width its drawing says, so a width is the one measurement that varies
   * wildly between two pets standing side by side — measured on a long-tailed test creature it was
   * 0.46 of the stage against 0.24 for a compact one. Reach in widths therefore gave the wide
   * creature nearly twice the range before any bonus was applied, and then the bonus for having a
   * long tail on top of that: a sweep came out at 0.98 of the screen, which is the whole stage.
   */
  reach: number
  /** how far above and below the creature's middle it reaches, in pet-heights */
  rise: number
  /** it comes out both sides, so facing does not matter */
  both?: boolean
  /** how much damage it adds */
  bite: number
  /**
   * How hard it launches, before the damage already taken is counted.
   *
   * ⚠️ AND IT IS COUNTED IN THE PARK — see KNOCK in strike.ts. This sentence described a
   * mechanic nothing implemented for a long time; it is true now, and the multiplier lives at
   * the one door every blow goes through rather than at any call site.
   */
  shove: number
  /** how much of that launch is upward, 0–1 */
  lift: number
  /** how long after it before another can be thrown */
  rest: number
  /**
   * The layer to reveal while this is being thrown, for an attack somebody drew.
   *
   * ⚠️ ABSENT FOR EVERY TEMPLATE MOVE. A kick or a sweep is the creature's own leg or tail
   * doing something, and those are on screen the whole time; a drawn attack is a layer that
   * exists only while it is out. Undefined therefore means "nothing extra to show", which is
   * what all the derived moves want.
   */
  layer?: number
  /**
   * True when its owner chose this move's shape rather than letting the drawing decide.
   *
   * ⚠️ IT IS A CLAIM ON A BUTTON, which is the whole reason it exists — see moveTable. A
   * shape is a trade, so a shaped move is deliberately worse at something, and "worst at
   * everything it is not for" is exactly the profile that wins no slot at all. Measured: a head
   * given a spin lost all six buttons on a creature with a tail and a wing, so choosing it made
   * the move unreachable. Drawn attacks already had this problem and already have this answer.
   */
  chosen?: boolean
  /**
   * How hard this move carries its owner forward while it is live, in pet-heights per second.
   *
   * ⚠️ THE LUNGE WAS ONLY EVER A PICTURE. lungeOf shifts the drawing inside its own box and
   * says so — "it moves the picture without moving where it actually IS" — which is right for a
   * flourish and wrong for a move whose whole identity is that it travels. Four shapes that
   * differ in their numbers and move identically were reported, correctly, as not looking
   * different.
   *
   * ⚠️ IT MOVES THE CREATURE, so the hitbox goes with it — strikeArea is computed from where
   * the thing IS. That is the point: a lunge closes distance, which makes it a different question
   * to answer rather than a different animation to watch.
   *
   * ⚠️ ABSENT MEANS ROOTED, which is what every template move has always done.
   */
  drive?: number
}

/**
 * What shape a hit is, when its owner has said.
 *
 * ⚠️ THE ONE THING THE DRAWING CANNOT TELL YOU. Everything else about a move is read off the
 * picture — how far it reaches, how hard it lands, how long it takes — and that works because
 * those are all questions about SIZE, which a drawing answers by being a size. "Does this sweep
 * the ground or come round both sides" is not a question about size, and inferring it from stroke
 * direction would be a guess that is wrong often enough to feel like the game ignoring you.
 *
 * ⚠️ AND SHAPES ARE TRADES, NEVER UPGRADES. Every one of these gives something up for what
 * it gains: a slam is short and slow for its damage, a lunge is long and quick for being feeble
 * and punishable, a spin covers both sides for reaching least of all. That is what lets somebody
 * choose freely without it being a question of who picked the strongest — the worry about
 * balancing everyone's drawing, answered by there being nothing to win.
 *
 * ⚠️ SIZE STILL COMES FROM THE PICTURE. These are multipliers on the derived move, so a long
 * arm slams further than a stubby one. Choosing the kind never overrules what you drew.
 */
export type HitShape = 'swipe' | 'slam' | 'lunge' | 'spin'

export const HIT_SHAPES: Array<[HitShape, string, string]> = [
  ['swipe', 'Swipe', 'A straight hit in front of it. No surprises either way.'],
  ['slam', 'Slam', 'Slow and heavy, low to the ground. You can SEE it coming — and move.'],
  ['lunge', 'Lunge', 'Long and quick, but feeble, and it is left hanging afterwards.'],
  ['spin', 'Spin', 'Comes round BOTH sides, so facing does not save you. Reaches least.'],
]

export const isHitShape = (v: unknown): v is HitShape => HIT_SHAPES.some(([id]) => id === v)

/**
 * How fast a move is carrying its owner right now, in pet-heights per second.
 *
 * ⚠️ THE BACK HALF OF THE WIND-UP, AND THEN THE LIVE WINDOW. Live-only was the first
 * version and it moved a lunge four hundredths of a walk — measured, and invisible — because a
 * live window is about fifty milliseconds and nothing travels anywhere in fifty milliseconds
 * without teleporting. Starting partway through the wind-up gives it something to travel FOR:
 * the creature leans, then goes, and the danger arrives with it.
 *
 * ⚠️ AND THE TELEGRAPH COMES ALONG, which is the part that makes this honest rather than a
 * cheat — strikeTell is computed from where the creature IS on each frame, so the patch sweeps
 * forward with the lunge instead of promising a place the attack has already left.
 *
 * ⚠️ NOT THROUGH THE RECOVERY, ever. Sliding away afterwards would take back the punish the
 * recovery just handed somebody.
 */
export const driveAt = (a: Attack, gone: number): number => {
  if (!a.drive) return 0
  const f = gone / a.span
  return f >= a.live[0] * 0.6 && f <= a.live[1] ? a.drive : 0
}

/** The trades, as multipliers on whatever the drawing already earned. */
const SHAPED: Record<HitShape, (a: Attack) => Attack> = {
  /* ⚠️ rooted, like every template move — the shape you pick when you want none of this */
  swipe: (a) => a,
  slam: (a) => {
    /**
     * ⚠️ A WIND-UP IN SECONDS, NOT IN FRACTIONS, because the thing it has to beat is measured
     * in seconds: a person reacts in about 250ms. As a multiplier on the move's own live window
     * this came out at 185ms on a median move — still quicker than anybody can answer, which made
     * "telegraphed" a word in a description and nothing in the game. Measured across all 78 moves
     * on this machine, the LONGEST wind-up of anything was 224ms, so nothing was reactable at all.
     *
     * ⚠️ AND THE DANGEROUS WINDOW HAS TO MOVE WITH IT. Pushing the start out without pushing
     * the end left one measured at 18ms of danger, which is a move you dodge by existing. A fixed
     * share of the swing after the wind-up keeps it a real hit.
     */
    const span = a.span * 1.6
    const start = Math.max(a.live[0], Math.min(0.62, 0.26 / span))
    return {
      ...a,
      reach: a.reach * 0.78,
      rise: a.rise * 1.5,
      /* ⚠️ MATCHED TO THE COMMITMENT, so the shape wins nothing on the exchange. It was 1.35
         against a 1.25 commitment and came out the hardest hitter AND the best damage per second
         at once — 12.4 against a swipe's 11.5, which is a shape with no downside and therefore the
         shape everybody picks. Now it is slower again, so it may hit harder again. */
      bite: a.bite * 1.5,
      span,
      rest: a.rest * 1.2,
      /* ⚠️ PLANTED. A slam commits hardest, and a heavy blow that also carries you is a heavy
         blow with no downside — see the note on shapes being trades rather than upgrades. */
      drive: 0,
      live: [start, Math.min(0.96, start + 0.28)] as [number, number],
    }
  },
  lunge: (a) => ({
    ...a,
    reach: a.reach * 1.35,
    bite: a.bite * 0.75,
    span: a.span * 0.85,
    rest: a.rest * 1.15,
    /* ⚠️ THE ONE THAT TRAVELS, which is what the word means and what it never did. Tuned to
       close a little over half a pet-height — far enough to catch somebody who backed just out
       of range, short enough that it stays an attack rather than a movement button. */
    drive: 5,
    live: [a.live[0], Math.min(a.live[1], a.live[0] + (a.live[1] - a.live[0]) * 0.7)],
  }),
  spin: (a) => ({
    ...a,
    both: true,
    reach: a.reach * 0.72,
    bite: a.bite * 0.85,
    /* a spin wanders, because a thing turning about itself does not hold a line */
    drive: 1.2,
    span: a.span * 1.2,
    rest: a.rest * 1.35,
  }),
}

/**
 * The move as its owner shaped it.
 *
 * ⚠️ UNKNOWN NAMES ARE LEFT ALONE, not defaulted to swipe and not dropped. A drawing can
 * arrive from localStorage, from a profile block or from the relay, and the one thing it must
 * never do is turn into a different creature because it mentions a shape this build has not heard
 * of. Nothing said means the drawing decides, which is what it did before any of this existed.
 */
export const shaped = (a: Attack, shape: string | undefined): Attack =>
  shape && isHitShape(shape) ? { ...SHAPED[shape](a), chosen: true } : a

/**
 * The same move, thrown by something the size of a boss.
 *
 * ⚠️ A BOSS COMMITS HARDER THAN A PERSON DOES, and that is a design decision rather than an
 * oversight being corrected. A player's swing winds up in 82 to 224ms; a person reacts in about
 * 250, so nothing a boss threw could be answered by seeing it — and its decisions are a weighted
 * coin per beat, so it could not be learned either. Between those two you can neither react nor
 * predict, which is the whole of why "bait an attack, dodge it, hit it from somewhere else" did
 * not work: there was nothing to bait, only something to be standing in the wrong place for.
 *
 * ⚠️ THE WIND-UP IS IN SECONDS, because what it has to beat is measured in seconds — the same
 * reasoning slam already uses. 320ms is comfortably past reaction, so the swing is a thing you
 * watch start and then leave.
 *
 * ⚠️ AND IT HITS HARDER TO PAY FOR IT. Slowing a boss without raising its damage makes it
 * less dangerous per second, and temperOf budgets health AGAINST danger — so the fight would not
 * get more readable, it would get longer by the same factor. Matching the damage to the pace
 * keeps the fight the length it was and changes what it is made of: fewer, heavier, readable
 * blows instead of a stream of unanswerable ones.
 */
/**
 * ⚠️ 0.40, UP FROM 0.32, and the span with it. Reported twice: readable, and then "still
 * slightly too fast". Reaction is about 250ms, so 320 was past it on paper and only just — a
 * telegraph you can theoretically answer is not the same as one you can comfortably answer, and
 * the difference between those two is the whole feel of a fight.
 */
const BOSS_WINDUP = 0.4
export const bossPace = (a: Attack): Attack => {
  const span = a.span * 1.8
  /**
   * ⚠️ 0.72 OF THE SWING MAY BE WIND-UP, up from 0.66, because the cap was binding before
   * the target did: at 0.66 a 400ms telegraph came out between 299 and 400 depending on the
   * move, which is the slow ones being slow and the quick ones still quick. A boss's swing is
   * mostly anticipation by design — the recovery it owes you lives in `rest`, after the span,
   * so spending more of the span on the wind-up costs the punish window nothing.
   */
  const start = Math.max(a.live[0], Math.min(0.72, BOSS_WINDUP / span))
  return {
    ...a,
    span,
    rest: a.rest * 1.5,
    /**
     * ⚠️ DELIBERATELY SHORT OF THE PACE, 1.62 against a span of 1.8, where it used to match
     * exactly. Matching keeps the fight the same length — temperOf budgets health against danger
     * — but a boss now also throws casts, and those do damage the budget knows nothing about.
     * Holding the swing back a little is where that is paid for, rather than letting the two
     * stack into a boss that kills you in five.
     */
    bite: a.bite * 1.62,
    live: [start, Math.min(0.94, start + (a.live[1] - a.live[0]))],
  }
}

/**
 * One template per kind of part, which is the whole roster.
 *
 * ⚠️ TUNED AGAINST EACH OTHER, NOT IN ISOLATION. The trade is always reach and damage against
 * how long you are committed: a bite hurts and leaves you standing there, a swipe barely tickles
 * and is over before anyone can answer it. A tail is the long one, wings are the one that sends
 * you upward, and a flame is the slowest thing in the game because it is also the worst to be hit
 * by. Nothing here is strictly better than anything else, which is what stops the roster being a
 * list with a right answer at the top.
 */
const FROM: Partial<Record<PartKind, Omit<Attack, 'from'>>> = {
  arm: {
    name: 'swipe',
    span: 0.26,
    live: [0.26, 0.6],
    reach: 0.92,
    rise: 0.44,
    bite: 4,
    shove: 0.95,
    lift: 0.36,
    rest: 0.16,
  },
  leg: {
    name: 'kick',
    span: 0.3,
    live: [0.3, 0.64],
    reach: 0.88,
    rise: 0.34,
    bite: 6,
    shove: 1.15,
    lift: 0.28,
    rest: 0.2,
  },
  head: {
    name: 'butt',
    span: 0.28,
    live: [0.3, 0.62],
    reach: 0.84,
    rise: 0.38,
    bite: 6,
    shove: 1.2,
    lift: 0.34,
    rest: 0.24,
  },
  mouth: {
    name: 'bite',
    span: 0.36,
    live: [0.38, 0.7],
    reach: 0.78,
    rise: 0.3,
    bite: 10,
    shove: 0.95,
    lift: 0.46,
    rest: 0.3,
  },
  tail: {
    name: 'sweep',
    span: 0.38,
    live: [0.3, 0.76],
    reach: 1.15,
    rise: 0.28,
    bite: 7,
    shove: 1.4,
    lift: 0.2,
    rest: 0.32,
  },
  wing: {
    name: 'buffet',
    span: 0.32,
    live: [0.26, 0.7],
    reach: 0.96,
    rise: 0.6,
    bite: 6,
    shove: 1.1,
    lift: 0.66,
    rest: 0.26,
  },
  /* ⚠️ the two that come out both sides, because a wheel and a heartbeat have no front */
  spin: {
    name: 'spin',
    span: 0.36,
    live: [0.2, 0.86],
    reach: 0.88,
    rise: 0.42,
    both: true,
    bite: 6,
    shove: 1.15,
    lift: 0.3,
    rest: 0.34,
  },
  pulse: {
    name: 'burst',
    span: 0.42,
    live: [0.48, 0.72],
    reach: 0.84,
    rise: 0.62,
    both: true,
    bite: 8,
    shove: 1.5,
    lift: 0.7,
    rest: 0.44,
  },
  /**
   * ⚠️ THE ONE THING YOU DRAW TO FIGHT WITH RATHER THAN TO MOVE WITH. Every other part is a
   * piece of an animal that happens to be usable; a horn, a blade or a spike is only ever a
   * weapon, so it is the one entry allowed to be plainly the best at hurting somebody — paid for
   * in being slow to bring out, short of the tail's range, and almost no lift, so it hurts a great
   * deal and is poor at actually finishing anybody off.
   */
  horn: {
    name: 'gore',
    span: 0.44,
    live: [0.44, 0.72],
    reach: 1.0,
    rise: 0.26,
    bite: 14,
    shove: 1.05,
    lift: 0.16,
    rest: 0.4,
  },
  flame: {
    name: 'scorch',
    span: 0.46,
    live: [0.42, 0.88],
    reach: 1.05,
    rise: 0.48,
    bite: 12,
    shove: 1.3,
    lift: 0.42,
    rest: 0.46,
  },
}

/**
 * What everything can do.
 *
 * ⚠️ NOBODY IS UNARMED. A creature drawn as one unnamed blob has no parts the rig recognises and
 * would otherwise arrive at a fight with nothing to press — which would make "draw anything and
 * play with it" false in exactly the room where it matters most. The pounce already existed as
 * the thing a pet DOES rather than IS, and it is the honest floor: short, weak, always there.
 */
export const POUNCE: Attack = {
  name: 'pounce',
  from: 'body',
  span: 0.34,
  live: [0.24, 0.66],
  reach: 0.84,
  rise: 0.4,
  bite: 5,
  shove: 1,
  lift: 0.38,
  rest: 0.22,
}

/**
 * The attacks somebody actually drew.
 *
 * ⚠️ WHERE YOU DREW IT IS THE MOVE. Everything about a drawn attack comes out of the ink: how
 * far it reaches is how far it extends from the creature, how high it sends somebody is how high
 * above the middle it sits, how much it hurts is how big it is — and the price of all of it is
 * that a bigger attack is a slower one. Nobody sets a number; you draw a short jab near the body
 * or a long arc over your head, and that IS the difference between them.
 *
 * ⚠️ WHICH MEANS IT ANSWERS A DIRECTION BY ITSELF. A hit drawn high has lift and becomes the
 * up attack; one drawn far out has reach and becomes the down attack. The same rule that already
 * sorts a wing from a tail sorts two things you drew, with nothing new to learn.
 *
 * ⚠️ AND IT IS MEASURED AGAINST THE BODY, never against everything. A creature's size must not
 * include the attack it can throw, or drawing a bigger slash would quietly shrink the creature it
 * belongs to and make every other move's reach wrong.
 */
function drawnAttacks(parts: Part[], body: Box): Attack[] {
  const h = body.y1 - body.y0
  if (h <= 0) return []
  const cx = (body.x0 + body.x1) / 2
  const cy = (body.y0 + body.y1) / 2
  const area = Math.max(1e-6, (body.x1 - body.x0) * h)

  return parts
    .filter((p) => p.kind === 'hit')
    .map((p) => {
      /* how far the ink gets from the middle of the creature, in creature-heights */
      const out = Math.max(cx - p.box.x0, p.box.x1 - cx) / h
      /**
       * ⚠️ THE PAGE RUNS OUT BEFORE THE SCALE DOES, AND IT PUNISHES DRAWING WELL. Reach is
       * measured in creature-heights and capped at 1.6 — but a creature drawn to fill the page
       * is tall in page terms, so 1.6 of its height is off the paper and the cap is simply
       * unreachable. Measured across the thirteen drawings here: a body 0.70 of the page tall
       * can never get past 0.79, one at 0.54 caps out at 1.17, and only the small cramped ones
       * reach 1.6 at all. Drawing your creature big quietly halved every attack you drew for
       * it, which is the opposite of the incentive this module wants, and is exactly what was
       * reported — "there isnt too much space to draw outside of your guy".
       *
       * ⚠️ SO IT IS A RESCUE, NOT A NEW SCALE. Where there IS room for the full range nothing
       * changes: `out` is used as it always was, and every creature that was not being
       * penalised keeps the reach it had. Only when the paper is the binding constraint does
       * the range it CAN express get stretched over the range the game uses, so that drawing a
       * hit out to the edge of the page means the same thing whatever size the body is.
       */
      const room = Math.max(cx, 1 - cx) / h
      const far = room >= 1.6 ? out : 0.5 + (out / Math.max(1e-6, room)) * 1.1
      const tall = (p.box.y1 - p.box.y0) / h
      /* above the middle is positive; a hit drawn overhead launches, one at the feet does not */
      const high = (cy - (p.box.y0 + p.box.y1) / 2) / h
      const size = ((p.box.x1 - p.box.x0) * (p.box.y1 - p.box.y0)) / area
      /* ⚠️ both sides only if it genuinely straddles the middle rather than merely touching it */
      const both = p.box.x0 < cx - h * 0.12 && p.box.x1 > cx + h * 0.12
      const heft = Math.max(0.25, Math.min(1.6, size))
      return {
        name: p.name.toLowerCase().slice(0, 14) || 'hit',
        from: 'hit' as PartKind,
        span: 0.24 + heft * 0.2,
        live: [0.32, 0.72] as [number, number],
        reach: Math.max(0.5, Math.min(1.6, far)),
        rise: Math.max(0.2, Math.min(0.9, tall / 2)),
        ...(both ? { both: true } : {}),
        bite: Math.round(Math.max(3, Math.min(16, 4 + heft * 8))),
        shove: 0.9 + heft * 0.35,
        lift: Math.max(0.1, Math.min(0.85, 0.34 + high * 0.9)),
        rest: 0.16 + heft * 0.22,
        layer: p.layer,
      }
    })
}

/** The union of every part's box: the creature, rather than the paper it sits on. */
function inkOf(parts: Part[]): Box | null {
  let b: Box | null = null
  for (const p of parts) {
    if (!b) b = { ...p.box }
    else {
      b.x0 = Math.min(b.x0, p.box.x0)
      b.y0 = Math.min(b.y0, p.box.y0)
      b.x1 = Math.max(b.x1, p.box.x1)
      b.y1 = Math.max(b.y1, p.box.y1)
    }
  }
  return b
}

/**
 * How big this part is next to the creature it is on — 0 for a speck, 1 for anything half the
 * creature's size or more.
 *
 * ⚠️ THIS IS WHAT MAKES THE DRAWING MATTER RATHER THAN THE WORD. Two people type "tail" and get
 * the same move out of a template; one of them drew a long one and should out-range the other, or
 * the length of the thing you drew was decoration.
 *
 * ⚠️ IT ASKS HOW LONG THE PART IS, NOT HOW FAR OUT IT SITS, and the first version asked the
 * second. Measuring the part's box against the creature's gave every tail a score of exactly 1,
 * because the creature's extent is SET by its outermost part — a tail is always at the edge of
 * the animal, by definition. Measured on two test creatures identical but for a tail six times
 * longer: both scored 1, both got a reach of 1.625, and the whole idea quietly did nothing.
 */
function bulk(p: Part, ink: Box): number {
  const across = Math.max(ink.x1 - ink.x0, ink.y1 - ink.y0)
  if (across <= 0) return 0.5
  const long = Math.max(p.box.x1 - p.box.x0, p.box.y1 - p.box.y0)
  return Math.max(0, Math.min(1, long / across / 0.5))
}

/**
 * Everything this creature can throw, quickest first.
 *
 * ⚠️ ONE PER KIND, not one per layer. Somebody who drew "leg 1" through "leg 4" has four legs and
 * one kick, because four identical kicks on four buttons is a longer menu saying the same thing.
 * The REACH still comes from the longest of them, so drawing more of something is never wasted.
 *
 * ⚠️ SORTED BY COMMITMENT, so the first is always the one you can throw out safely and the last
 * is always the one you have to mean. The room binds two buttons to the ends of this list, which
 * is why the order is part of the answer rather than a detail of how it was built.
 */
export function attacksOf(parts: Part[], hits?: Record<string, string>): Attack[] {
  /**
   * ⚠️ THE BODY, NOT THE BODY PLUS WHATEVER IT CAN SWING. Every measurement below is relative
   * to how big the creature is, and a hit layer is an attack rather than anatomy — so counting
   * it would mean drawing a longer slash quietly shrank every other move's reach, and made the
   * slash itself score as a smaller fraction of a creature it had just inflated.
   */
  const ink = inkOf(parts.filter((p) => p.kind !== 'hit')) ?? inkOf(parts)
  /* ⚠️ THE FALLBACK IS SHAPEABLE TOO. A creature with nothing named still has one move, and
     it is the only move it has — leaving this path unshaped would mean the wizard did nothing at
     all for the simplest creature anybody can make, which is the first one everybody makes. */
  if (!ink) return [shaped(POUNCE, hits?.[POUNCE.from])]

  const best = new Map<PartKind, number>()
  for (const p of parts) {
    if (p.kind === 'hit' || !FROM[p.kind]) continue
    const big = bulk(p, ink)
    const had = best.get(p.kind)
    if (had === undefined || big > had) best.set(p.kind, big)
  }

  const out: Attack[] = []
  for (const [kind, big] of best) {
    const t = FROM[kind]
    if (!t) continue
    /**
     * ⚠️ A NARROWER SPREAD THAN IT LOOKS LIKE IT SHOULD BE. This ran 0.75× to 1.65×, which on
     * top of the base reaches put the longest sweep two body-lengths in front of the creature —
     * and the first person to play it said the fighting felt "ranged", which it was. Drawing a
     * longer tail should still out-reach a stub, and it still does; it should not turn a melee
     * game into one fought at a distance where neither creature is near the other.
     */
    out.push({ ...t, from: kind, reach: t.reach * (0.85 + big * 0.4) })
  }
  /**
   * ⚠️ WHAT SOMEBODY DREW GOES IN WITH WHAT THEY GREW. A drawn attack is not a special case
   * that overrides the parts — it takes its place among them and is sorted by the same
   * commitment, so a creature can have a tail AND a slash and moveTable picks whichever of them
   * is actually best at going up.
   *
   * ⚠️ THE PARTS, AND ONLY THE PARTS, otherwise. This used to force a second entry in so that
   * two buttons could never land on the same move — which moveTable now does properly, and doing
   * it here as well produced a "big big sweep": a heavy made out of a heavy, commitment squared.
   */
  const drawn = drawnAttacks(parts, ink)
  /**
   * ⚠️ SHAPED HERE, BEFORE THE SORT AND BEFORE THE TABLE. The order these come out in is by
   * total commitment, and a shape CHANGES the commitment — a slam is slower than the swipe it was
   * made from. Shaping afterwards would sort them by what they used to be, and then moveTable
   * would hand the six slots out on the same stale reading.
   */
  const all = [...out, ...drawn].map((a) => shaped(a, hits?.[a.from]))
  return all.length
    ? all.sort((a, b) => a.span + a.rest - (b.span + b.rest))
    : [shaped(POUNCE, hits?.[POUNCE.from])]
}

/**
 * Every move a drawing has, shaped as its owner asked, in button order.
 *
 * ⚠️ ONE DOOR, because five rooms were each writing `moveTable(attacksOf(rigOf(art)))` by
 * hand and a sixth wrote a variant of it. Adding the shapes to that expression meant adding them
 * in five places and hoping — and the thing this repository has learned most often is that the
 * call site you did not think of is the one that is wrong. There is nothing to remember now.
 */
/**
 * @param allowed how many named parts this creature has earned the right to use, or -1 for
 * everything. Everywhere that only draws a creature passes nothing — see inPlay.
 */
export const movesOf = (art: Drawing, allowed = -1): Attack[] =>
  moveTable(attacksOf(inPlay(rigOf(art), allowed), art.hits))

/**
 * A committed version of a move, for a creature that only has the one.
 *
 * ⚠️ WITHOUT THIS, MOST CREATURES HAD TWO BUTTONS THAT DID THE SAME THING. `pairOf` took the
 * first and the last of the list, which for anything with a single recognised part is the same
 * entry twice — and one recognised part is the common case, not the odd one. Reported after the
 * first real fight: "the light and heavy attack are the same". They were, literally.
 *
 * ⚠️ AND THE TRADE IS THE ONE THE WHOLE ROSTER IS BUILT ON: more reach and nearly twice the
 * damage, paid for in being committed for about three times as long. A heavy you can throw as
 * freely as a light is not a heavy, it is a better light.
 */
const heavier = (a: Attack): Attack => ({
  ...a,
  name: 'big ' + a.name,
  span: a.span * 1.55,
  live: [a.live[0] + 0.08, Math.min(0.95, a.live[1] + 0.05)],
  reach: a.reach * 1.2,
  bite: Math.round(a.bite * 1.9),
  shove: a.shove * 1.4,
  lift: Math.min(0.85, a.lift * 1.15),
  rest: a.rest * 1.9,
})

/**
 * Where you are pointing when you press.
 *
 * ⚠️ TAKEN FROM THE KEYS YOU ALREADY HOLD, so this costs nobody a new button to learn: up is the
 * jump key and down is the crouch key, both of which your hand is on. An attack aimed up
 * therefore comes out as you leave the ground, which is what an up attack is anyway.
 */
export type Aim = 'neutral' | 'up' | 'down'

const pickBy = (list: Attack[], score: (a: Attack) => number): Attack =>
  list.reduce((best, a) => (score(a) > score(best) ? a : best))

/**
 * The six things a creature can throw, in the order the buttons index them.
 *
 * ⚠️ THE AIM PICKS WHICH PART ANSWERS; THE BUTTON PICKS HOW HARD. That is the whole design, and
 * it is what makes drawing another part worth doing: a creature with four recognised parts has a
 * different one answering each direction, while one with a single part answers all three the same
 * way and is honestly told so. Nobody picks moves from a menu — you point, and whatever you drew
 * that is best at going that way is what comes out.
 *
 * ⚠️ up IS THE MOST LAUNCHING PART, down IS THE LONGEST-REACHING, and neutral-heavy is the
 * hardest hitter. Sorting by character rather than by position in the list is what stops a part
 * from being unreachable: `many` has a kick, a buffet, a bite and a sweep, and before this the
 * two buttons could only ever produce the first and the last of them.
 *
 * ⚠️ A SIX-ENTRY TABLE RATHER THAN A CHOOSING FUNCTION, because a fighter stores which move it is
 * throwing as an INDEX, and everything downstream — the hit test, the phase readout, the network
 * — looks it up in this same list. A chooser that could return a move which is not in the list
 * would be a move the rest of the game cannot find.
 */
type Role = 'neutral' | 'up' | 'down'

/** What each direction is asking for. */
const SCORE: Record<Role, (a: Attack) => number> = {
  neutral: (a) => a.bite,
  up: (a) => a.lift,
  down: (a) => a.reach,
}

/**
 * The same move, thrown upward — and the same move, swept low.
 *
 * ⚠️ BECAUSE SIX BUTTONS ON A SIMPLE DRAWING WERE TWO MOVES. Slots are won by being best at
 * something, so a creature with one named part wins every slot with the same attack and the
 * table comes out [A, big A, A, big A, A, big A]. Reported in those words — "a lot of the
 * attacks seem to be so similar" — and they were not similar, they were identical.
 *
 * ⚠️ AND IT IS THE PERSON WHO CAN LEAST AFFORD IT WHO PAYS. Said out loud: "it doesnt make
 * sense to add a horn/wings or things i dont want but i lack in ability now". Wanting four
 * distinct moves should not require being able to draw four distinct limbs; the variety a
 * confident drawing gets for free is the variety a plain one should be able to earn by
 * pressing a different key.
 *
 * ⚠️ SO IT IS A DERIVATION, EXACTLY LIKE heavier. That one has always turned any attack into
 * its committed version rather than demanding you draw a second heavier limb, and nobody
 * thinks of it as a cheat — these are the same idea on the other axis. A thing thrown upward
 * gets there sooner, reaches less far and launches harder; a thing swept low goes further,
 * takes longer and stays down.
 *
 * ⚠️ AND THE SWEEP DROPS UNDER HOP.under ON PURPOSE, so the low variant is a move that can be
 * JUMPED. That is the mechanical difference doing the work: it is not a reskin with different
 * numbers, it is the one of your six that a jumping opponent goes straight over.
 *
 * Clamped to the same bounds a drawn attack is held inside, so a derived move can never be
 * outside the range something drawn could have reached.
 */
const upward = (a: Attack): Attack => ({
  ...a,
  name: 'rising ' + a.name,
  span: a.span * 0.92,
  reach: Math.max(0.5, a.reach * 0.78),
  rise: Math.min(0.9, a.rise * 1.35),
  bite: Math.max(3, Math.round(a.bite * 0.9)),
  shove: a.shove * 0.95,
  lift: Math.min(0.85, Math.max(0.5, a.lift * 1.5)),
  rest: a.rest * 0.95,
})

const sweeping = (a: Attack): Attack => ({
  ...a,
  name: 'low ' + a.name,
  span: a.span * 1.18,
  reach: Math.min(1.6, a.reach * 1.3),
  rise: Math.max(0.2, a.rise * 0.7),
  bite: Math.max(3, Math.round(a.bite * 1.05)),
  shove: a.shove * 1.05,
  /* ⚠️ under HOP.under, which is 0.35 — see the note above; this is the jumpable one */
  lift: Math.max(0.1, Math.min(0.28, a.lift * 0.45)),
  rest: a.rest * 1.1,
})

export function moveTable(list: Attack[]): Attack[] {
  const src = list.length ? list : [POUNCE]

  /**
   * ⚠️ AN ATTACK YOU DREW ALWAYS COMES OUT SOMEWHERE, and without this one could sit on a
   * creature and never be reachable. Slots are won by being best at something, and a drawn attack
   * competes against parts that are specialists — so a perfectly good hit that is not the
   * quickest, not the hardest, not the highest and not the longest wins nothing at all. Watched
   * exactly that: a creature with an arm, a horn, a wing and a drawn hit had six buttons that
   * produced swipe, gore, buffet and big buffet, and the thing its owner had actually drawn was
   * unreachable. Reported as "I drew a hit body part but I'm not seeing what that looks like".
   *
   * ⚠️ EACH ONE CLAIMS THE DIRECTION IT IS MOST SUITED TO rather than simply outranking
   * everything. Giving drawn attacks blanket priority would mean one modest slash hid the horn,
   * the wing and the arm all at once — which punishes drawing MORE. Scored against the best of
   * this creature in each of the three, so the claim is about what the drawing is FOR.
   */
  const top: Record<Role, number> = {
    neutral: Math.max(...src.map(SCORE.neutral)) || 1,
    up: Math.max(...src.map(SCORE.up)) || 1,
    down: Math.max(...src.map(SCORE.down)) || 1,
  }
  const roleOf = (a: Attack): Role => {
    const n = SCORE.neutral(a) / top.neutral
    const u = SCORE.up(a) / top.up
    const d = SCORE.down(a) / top.down
    return u >= d && u >= n ? 'up' : d >= n ? 'down' : 'neutral'
  }
  const claimed = new Map<Role, Attack>()
  for (const a of src) {
    /* ⚠️ A HIT YOU DREW OR A SHAPE YOU CHOSE — both are somebody saying what they want, and
       both lose on the raw scores for exactly the reason they are interesting. See `chosen`. */
    if (a.from !== 'hit' && !a.chosen) continue
    const r = roleOf(a)
    const had = claimed.get(r)
    if (!had || SCORE[r](a) > SCORE[r](had)) claimed.set(r, a)
  }
  const forRole = (r: Role) => claimed.get(r) ?? pickBy(src, SCORE[r])

  /* ⚠️ the quick neutral stays the fastest thing you have whatever you drew — it is the
     button you throw out without thinking, and a drawn attack claiming it would take that away */
  const quick = src[0]
  const hardest = forRole('neutral')
  const upPick = forRole('up')
  const downPick = forRole('down')
  /**
   * ⚠️ ONLY WHEN THE DRAWING HAS NOTHING BETTER, so a creature that DID draw a horn and a
   * tail is untouched — those already win their own slots and derived variants would be
   * throwing away the thing its owner drew. The test is identity: if the winner of a
   * direction is the very attack already sitting in a neutral slot, that direction has no
   * specialist and gets a derived one instead of a copy.
   */
  const up = upPick === quick || upPick === hardest ? upward(upPick) : upPick
  const down =
    downPick === quick || downPick === hardest || downPick === upPick
      ? sweeping(downPick)
      : downPick
  return [
    quick,
    /* a heavy must always cost more than the quick beside it — for a one-part creature the
       hardest hitter IS the quick one, so it gets the committed version instead */
    hardest === quick ? heavier(quick) : hardest,
    up,
    heavier(up),
    down,
    heavier(down),
  ]
}

/** Which entry of the table a press lands on. */
export const slotFor = (heavy: boolean, aim: Aim): number =>
  (aim === 'up' ? 2 : aim === 'down' ? 4 : 0) + (heavy ? 1 : 0)

/** The quick one and the heavy one, for a readout that has room for two. */
export function pairOf(list: Attack[]): [Attack, Attack] {
  if (!list.length) return [POUNCE, heavier(POUNCE)]
  return [list[0], list[1] ?? heavier(list[0])]
}

/**
 * How wide this creature is in world units, given that every creature stands PET_TALL high.
 *
 * ⚠️ THIS IS THE BODY, NOT THE REACH — see the note on Attack.reach for why those are
 * measured in different units. How wide a creature is to HIT is honestly its drawing's business:
 * somebody who drew a long low thing is a long low thing and is easier to catch, the same way it
 * is drawn. How far it can reach is not, or being drawn wide would be a straight upgrade.
 */
export const petWide = (art: Drawing): number => PET_TALL * bodyRatio(art)

/** Where a creature stands, in the terms a hit test needs. */
export type At = { x: number; y: number; facing: number }

/**
 * The region an attack is hurting right now, or null if it is not hurting yet.
 *
 * ⚠️ `y` IS THE GROUND UNDER THE CREATURE, not its middle — the body's y is its feet, which is
 * the same trap `touching` documents for treats. Everything here is measured from the middle of
 * the creature, half a pet-height up.
 */
/**
 * How far above and below its middle a move can hurt you, as a half-height in pet-heights.
 *
 * ⚠️ ONE ANSWER, BECAUSE THERE WERE THREE. The ring measured `a.rise`, the park measured
 * `max(a.rise, 0.4)` and the maker's preview drew `max(a.rise, 0.2)` — so the box somebody was
 * shown while drawing matched the ring exactly and the park only four times in ten. Measured on
 * the real move table: a tail sweep is drawn at 0.28 and hits you at 0.4 in the park, which is
 * 43% further out than the picture said. Reported as buffered gaps in hitboxes and swings that
 * feel unfair, and that is exactly what being hit from outside the drawn box is.
 *
 * ⚠️ THE FLOOR IS THE GAME'S, NOT THE MOVE'S, which is why it is an argument. Seen from
 * above, y is DEPTH rather than height, and a swing dangerous only within a razor-thin band of
 * depth is one nobody could ever land — so the park needs a floor and the side-on ring does not.
 * Passing it in keeps that a decision each room makes out loud, rather than three numbers that
 * drifted apart quietly.
 */
export const hurtHalf = (a: Attack, floor = 0): number => Math.max(a.rise, floor)

export function hurtBox(at: At, a: Attack, gone: number): Box | null {
  const f = gone / a.span
  if (f < a.live[0] || f > a.live[1]) return null
  const reach = a.reach * PET_TALL
  const cy = at.y - PET_TALL / 2
  const rise = hurtHalf(a) * PET_TALL
  const x0 = a.both ? at.x - reach : at.facing > 0 ? at.x : at.x - reach
  return { x0, y0: cy - rise, x1: x0 + (a.both ? reach * 2 : reach), y1: cy + rise }
}

/** Is this creature standing in that? Its body is a box PET_TALL high and `wide` across. */
export function inBox(at: At, wide: number, b: Box): boolean {
  const half = wide / 2
  return at.x + half > b.x0 && at.x - half < b.x1 && at.y > b.y0 && at.y - PET_TALL < b.y1
}
