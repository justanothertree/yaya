import { rigOf } from './rig'
import type { Drawing } from '../draw/strokes'

/**
 * How many parts a creature is allowed, and how it earns more.
 *
 * ⚠️ THIS IS THE ANSWER TO A TENSION EVAN NAMED RATHER THAN A FEATURE ANYBODY ASKED FOR
 * DIRECTLY: "on one hand i want a balanced fighting system with uniformity but on the other
 * hand i want unique minions having unique but equal in strategy parts". A budget is what
 * makes asymmetry fair. Parts stay un-normalised — a wing does what a wing does and a horn
 * does what a horn does, and nobody has to pretend they are worth the same — because what is
 * equal between two creatures is how MANY they get, not what each one is worth.
 *
 * ⚠️ AND WITHOUT ONE, PARTS ONLY EVER STACK. traitsOf caps legs at four and wings at two, but
 * nothing stops a drawing having every part at once and every trait at once, which is the
 * strictly-better creature the tension was worried about. A budget turns that from an exploit
 * into a choice.
 */

/**
 * ⚠️ FOUR, BECAUSE THAT IS WHAT IS ALREADY DRAWN. The creatures on this machine use 0, 1, 3,
 * 4 and 4 named parts — so four is the smallest base that makes every existing creature legal
 * on the day this ships. A budget that retroactively made somebody's minion illegal would be
 * a rule applied to people who could not have known it, which is not a rule, it is a loss.
 */
export const PART_BASE = 4

/**
 * ⚠️ IT GETS HARDER, WHICH IS THE WHOLE SHAPE OF IT. One win buys nothing — a slot has to be
 * worth having — and then they come at 3, 8, 15, 24, 35: the gaps grow so that a veteran
 * creature is meaningfully further along than a new one without ever running away with it.
 * Five is the ceiling, so the widest a creature can get is nine parts against a newcomer's
 * four, and "more parts" never becomes the only thing that decides a fight.
 */
export const SLOT_AT = [3, 8, 15, 24, 35]

/** How many extra parts this many wins has earned. */
export const slotsFor = (wins: number): number => SLOT_AT.filter((n) => wins >= n).length

/** How many wins until the next one, or null once they are all earned. */
export const nextSlotAt = (wins: number): number | null => SLOT_AT.find((n) => wins < n) ?? null

/**
 * How many parts a drawing actually spends.
 *
 * ⚠️ THE BODY IS FREE. Every creature has one and nothing is a choice you can make about it —
 * partOf returns 'body' for anything unnamed, so charging for it would charge a one-layer
 * drawing for existing. What costs is what you NAMED, which is exactly the set of things that
 * do something.
 */
export const partsUsed = (art: Drawing): number =>
  rigOf(art).filter((p) => p.kind !== 'body').length

/** What a creature may spend, given how often it has won. */
export const partsAllowed = (wins: number): number => PART_BASE + slotsFor(wins)
