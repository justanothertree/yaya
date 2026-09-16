import { PET_TALL } from './play'
import { petRatio, type Box, type Part, type PartKind } from './rig'
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
  /** how hard it launches, before the damage already taken is counted */
  shove: number
  /** how much of that launch is upward, 0–1 */
  lift: number
  /** how long after it before another can be thrown */
  rest: number
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
    reach: 0.95,
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
    reach: 0.8,
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
    reach: 0.74,
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
    reach: 1.3,
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
    reach: 1.0,
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
    reach: 0.85,
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
    reach: 0.8,
    rise: 0.62,
    both: true,
    bite: 8,
    shove: 1.5,
    lift: 0.7,
    rest: 0.44,
  },
  flame: {
    name: 'scorch',
    span: 0.46,
    live: [0.42, 0.88],
    reach: 1.15,
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
  reach: 0.8,
  rise: 0.4,
  bite: 5,
  shove: 1,
  lift: 0.38,
  rest: 0.22,
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
export function attacksOf(parts: Part[]): Attack[] {
  const ink = inkOf(parts)
  if (!ink) return [POUNCE]

  const best = new Map<PartKind, number>()
  for (const p of parts) {
    if (!FROM[p.kind]) continue
    const big = bulk(p, ink)
    const had = best.get(p.kind)
    if (had === undefined || big > had) best.set(p.kind, big)
  }

  const out: Attack[] = []
  for (const [kind, big] of best) {
    const t = FROM[kind]
    if (!t) continue
    /* 0.75× for a stub, up to 1.65× for something half the creature long — see bulk */
    out.push({ ...t, from: kind, reach: t.reach * (0.75 + big * 0.9) })
  }
  if (!out.length) return [POUNCE]
  return out.sort((a, b) => a.span + a.rest - (b.span + b.rest))
}

/** The quick one and the heavy one, which is what a pair of buttons can hold. */
export function pairOf(list: Attack[]): [Attack, Attack] {
  if (!list.length) return [POUNCE, POUNCE]
  return [list[0], list[list.length - 1]]
}

/**
 * How wide this creature is in world units, given that every creature stands PET_TALL high.
 *
 * ⚠️ THIS IS THE BODY, NOT THE REACH — see the note on Attack.reach for why those are
 * measured in different units. How wide a creature is to HIT is honestly its drawing's business:
 * somebody who drew a long low thing is a long low thing and is easier to catch, the same way it
 * is drawn. How far it can reach is not, or being drawn wide would be a straight upgrade.
 */
export const petWide = (art: Drawing): number => PET_TALL * petRatio(art)

/** Where a creature stands, in the terms a hit test needs. */
export type At = { x: number; y: number; facing: number }

/**
 * The region an attack is hurting right now, or null if it is not hurting yet.
 *
 * ⚠️ `y` IS THE GROUND UNDER THE CREATURE, not its middle — the body's y is its feet, which is
 * the same trap `touching` documents for treats. Everything here is measured from the middle of
 * the creature, half a pet-height up.
 */
export function hurtBox(at: At, a: Attack, gone: number): Box | null {
  const f = gone / a.span
  if (f < a.live[0] || f > a.live[1]) return null
  const reach = a.reach * PET_TALL
  const cy = at.y - PET_TALL / 2
  const rise = a.rise * PET_TALL
  const x0 = a.both ? at.x - reach : at.facing > 0 ? at.x : at.x - reach
  return { x0, y0: cy - rise, x1: x0 + (a.both ? reach * 2 : reach), y1: cy + rise }
}

/** Is this creature standing in that? Its body is a box PET_TALL high and `wide` across. */
export function inBox(at: At, wide: number, b: Box): boolean {
  const half = wide / 2
  return at.x + half > b.x0 && at.x - half < b.x1 && at.y > b.y0 && at.y - PET_TALL < b.y1
}
