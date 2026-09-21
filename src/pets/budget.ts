import { rigOf, type Part } from './rig'
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

/**
 * The parts that actually do something, given what a creature has earned.
 *
 * ⚠️ OVER-BUDGET PARTS DO NOT DISAPPEAR, THEY FALL ASLEEP. Evan, asked whether the maker
 * should refuse: "not count until earned". So a layer beyond the budget is demoted to `body`
 * — which is what an UNNAMED layer already is, so it still draws, still breathes with the
 * rest of the creature, and simply grants nothing. Nobody is ever stopped from drawing, and
 * nothing anybody has drawn is ever deleted or refused; the wing is there, it is just not
 * doing anything yet.
 *
 * ⚠️ AND IT IS LAYER ORDER, WHICH IS A THING YOU CAN SEE AND CHANGE. The first parts you named
 * are the ones that count, so which of them is asleep is decided by the layer stack in the
 * paint room rather than by a rule nobody can inspect — and reordering layers is already a
 * button. The alternative, picking by ink or by whichever is "best", would be the game making
 * a choice on your behalf and not telling you where.
 *
 * ⚠️ AND A BUDGET OF -1 MEANS "NO BUDGET", not "nothing counts". Everywhere that only wants to
 * DRAW a creature — the paint room, the previews, the maker — has no business asking how many
 * fights it has won, and a default that quietly disabled parts in those places would be the
 * worst kind of bug: correct-looking code with a creature that breathes wrong.
 */
export function inPlay(parts: Part[], allowed = -1): Part[] {
  if (allowed < 0) return parts
  let spent = 0
  return parts.map((p) => {
    if (p.kind === 'body') return p
    spent += 1
    return spent <= allowed ? p : { ...p, kind: 'body' as const }
  })
}
