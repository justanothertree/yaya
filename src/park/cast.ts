import { footSpan, PARK_TALL, stepFrom, toScreen, type Aimed } from './strike'
import type { Spot } from './walk'

/**
 * The things a boss does that are not a swing.
 *
 * ⚠️ NOTHING NEW GOES OVER THE WIRE, and that is the whole shape of this module. A boss already
 * sends where it is, which way it is aimed, which slot it is using and how long that has been
 * out — so a cast that is a pure function of exactly those four things needs no message, no
 * relay change and no redeploy. Everyone derives the same patches from the same numbers, which
 * is the same bargain peer swings already make.
 *
 * ⚠️ WHICH IS ALSO WHY A MARK LANDS ALONG THE AIM rather than on top of whoever the boss picked.
 * The host knows its target; a viewer does not, and inventing a second message to tell them
 * would buy nothing a readable rule does not already give — "it throws it where it is looking"
 * is something you can learn and then dodge.
 *
 * ⚠️ PURE, so the whole pattern can be played out with no browser — the park's animation frame
 * does not fire in the pane any of this is checked in.
 */

/**
 * ⚠️ FOUR KINDS AND THREE SLOTS, which is what makes the fourth one worth adding rather than
 * just more. A creature gets the three that suit its drawing best, so one of the four is always
 * missing — and which one is missing is as much a fact about the picture as which three are
 * there. With three of three everybody had all of them in a different order; with three of four
 * two creatures can genuinely not share an attack.
 */
export type CastKind = 'bloom' | 'mark' | 'wave' | 'bolt'

/** One dangerous circle, at one moment. */
export type Patch = {
  at: Spot
  /** in screen-heights */
  r: number
  /** 0 to 1 while it is winding up, 1 once it is about to land */
  ready: number
  /** true while it can actually hurt you */
  live: boolean
}

/**
 * How long each one takes, and what it is for.
 *
 * ⚠️ ALL OF THEM LONGER THAN A SWING, deliberately. A cast is the boss's committed option: it
 * covers ground a swipe cannot reach and it costs a second and a half of doing nothing else,
 * which is the window the whole fight is built around.
 */
/**
 * ⚠️ AND HOW HIGH EACH ONE IS, which is what decides whether jumping answers it. Two of these
 * travel along the floor and one of them engulfs — so the fissure and the marked ground can be
 * cleared and the swelling cannot, and each cast now has a different right answer instead of
 * three having the same one. The numbers are on the same scale as Attack.lift so that overHead
 * asks one question of a swing and a cast alike; see HOP.under.
 */
/**
 * ⚠️ AND WHAT EACH ONE COSTS, which used to be one number for all three. Every cast waited
 * four seconds and rooted you for its whole length, so the three big moves were one economy
 * with three skins — and the bolt, which is a thrown thing rather than a piece of ground
 * being torn up, paid a ground-tearing price for it. Asked for as "rapid shoot bolt".
 *
 * `holds` is whether it takes you over while it runs; `wait` is its own cooldown. The two
 * earth-movers keep the old bargain — a second and a half of being a target, four seconds
 * before the next — and the bolt becomes something you can move while throwing and throw
 * again soon after.
 */
export const CAST: Record<
  CastKind,
  { time: number; says: string; lift: number; short: string; holds: boolean; wait: number }
> = {
  bloom: {
    time: 1.5,
    lift: 0.7,
    short: 'swell',
    holds: true,
    wait: 4,
    says: 'it swells — get out, and keep going',
  },
  mark: {
    time: 1.45,
    lift: 0.12,
    short: 'mark',
    holds: true,
    wait: 4,
    says: 'it marks the ground ahead — leave it or jump it',
  },
  wave: {
    time: 1.9,
    lift: 0.08,
    short: 'fissure',
    holds: true,
    wait: 4,
    says: 'it splits the ground away from itself — cross it or jump it',
  },
  /**
   * ⚠️ CHEST HIGH ON PURPOSE, which is the whole reason it is not a fourth ground attack. Its
   * lift sits above HOP.under, so a jump does nothing about it — you step out of the line, or
   * you meet it with a guard. Two of the four are answered by jumping and two are not, so no
   * single key is the answer to a boss's whole repertoire.
   */
  bolt: {
    time: 1.2,
    lift: 0.45,
    short: 'bolt',
    /* ⚠️ it does not root you, which is the whole difference. A bolt is thrown; the other two
       are the ground being done something to, and you cannot do that on the move. */
    holds: false,
    wait: 0.55,
    says: 'it throws something at you — step out of the line, or meet it',
  },
}

/**
 * How far these things reach, in pet-heights.
 *
 * ⚠️ THE VISIBLE FIELD IS ABOUT NINE PET-HEIGHTS ACROSS, which is the number all of this has
 * to be read against. A wave spaced 1.15 apart AND multiplied by a 2.5 boss put its last step
 * fourteen heights out — half of it past the edge of the screen, where it is neither a threat
 * nor a thing anybody can learn.
 *
 * ⚠️ WHICH WAS ANSWERED BY FIXING THE SPACING, AND THAT ANSWER COST THE MOVE ITS GAPS.
 * A spacing that does not scale while the radius does is a pattern that closes itself, and it
 * had — see WAVE_FLOOR. The reach is now a BUDGET rather than a fixed stride: spacing grows
 * with the steps so there is always floor between them, and the step count comes down to pay
 * for it. Where it starts still scales, gently, for the same reason as before.
 *
 * ⚠️ AND A MARK IS THROWN GENTLY FURTHER BY A BIGGER BOSS, not proportionally further. At a
 * straight multiple a 2.5 boss threw it 6.5 heights, which is most of the screen away from
 * itself and reads as unrelated to the creature that did it.
 */
/**
 * A cast as a slot number, for the wire, and back again.
 *
 * ⚠️ ONE TABLE, BECAUSE THERE WERE FOUR. A boss encodes its cast, a player encodes theirs,
 * and the other end decodes each of them — four hand-written ternary chains of the same three
 * names, across two files, that all have to agree or somebody's wave arrives as somebody else's
 * bloom. Nothing had gone wrong yet; the point is that nothing WOULD have told us.
 *
 * ⚠️ ABOVE THE SIX MOVE SLOTS. 0 is "nothing" and 1..6 are a creature's own moves, so casts
 * start at 7, and the ceiling is SLOTS.length + 6 — which is 10 with four kinds, and is what
 * the relay clamps that field to. This said 9, which was true for exactly as long as there were
 * three kinds: at 9 a bolt arrives as a wave, because castFromSlot(9) is the third entry. The
 * server has the right number and says why; this had the stale one. If a fifth kind is ever
 * added, the clamp in ws-server.js moves with this list.
 */
const SLOTS: CastKind[] = ['bloom', 'mark', 'wave', 'bolt']

export const castSlot = (kind: CastKind): number => SLOTS.indexOf(kind) + 7

export const castFromSlot = (n: number): CastKind | null => SLOTS[Math.round(n) - 7] ?? null

const MARK_RANGE = 2.6
/** where the bolt leaves from, how long it is telegraphed, and how fast it travels */
const BOLT_FROM = 1.0
const BOLT_WARN = 0.42
const BOLT_SPEED = 7

/**
 * What holding the throw buys, at full charge.
 *
 * ⚠️ ONLY THE BOLT CHARGES, and that follows from what the other three ARE. A bloom, a
 * mark and a fissure are the ground being done something to — they root you, they take a
 * second and a half, and "hold it longer" is not a thing you can do to a hole in the floor.
 * A bolt is a thrown object, it already does not root you, and winding up to throw something
 * harder is the most obvious verb there is. Asked for as "charge and shoot the bolt".
 *
 * ⚠️ AND IT IS THE SAME KIND, NOT A FIFTH ONE. Adding a charged bolt to SLOTS would make
 * it slot 11, and the relay clamps that field at 10 — see castSlot. A charged bolt is a bolt
 * that is bigger, faster and hits harder, which is three numbers rather than a new thing to
 * learn.
 */
export const BOLT_UP = {
  /** seconds of holding to reach full charge */
  full: 0.9,
  /** how much fatter the patch gets */
  fat: 0.5,
  /** how much faster it flies */
  quick: 0.6,
  /** how much harder it lands — read by the room, not here */
  bite: 1.2,
  /** how much longer before the next one */
  wait: 1,
}
/** the most steps a fissure is ever made of — a big creature tears the ground in fewer bites */
const WAVE_STEPS = 5
/** each step's radius at scale 1, in pet-heights */
const WAVE_R = 0.46
/**
 * Clear ground left between two steps, in pet-heights — the thing "cross it" means.
 *
 * ⚠️ A CREATURE HAS A WIDTH, WHICH IS WHAT THE OLD SUM FORGOT. The spacing used to be a
 * flat 1.15 against two radii of 0.46, and the note here said that left "0.23 of a pet-height of
 * floor between each pair, which is the standing room the whole move is built around". It is not
 * standing room. inPatch expands every patch by the target's own footprint — footSpan, which
 * along the aim is width × 0.4, and an ordinary creature is half a pet-height wide — so
 * standing between two steps needs 0.4 of floor, not a number above zero. Swept with inPatch
 * itself: at scale 1 there was NOWHERE on the axis a creature could stand, and that was true
 * from scale 1.0 up rather than from 1.25 as the arithmetic suggested. Only a 0.4 creature,
 * whose own footprint is small enough, ever fitted.
 *
 * So this is two footprints and a little over, and the test for it asks footSpan rather than
 * repeating it — the one sum that must not be made twice is the one that was already wrong.
 */
const WAVE_FLOOR = 0.5
/**
 * How fast the tear travels outward, in pet-heights a second.
 *
 * ⚠️ A SPEED RATHER THAN A DELAY, because the spacing is no longer fixed. 1.15 apart every
 * 0.16s is what this always was; holding the DELAY while the spacing grew would have made a big
 * creature's tear fly outward twice as fast as a small one's, which is a different move.
 */
const WAVE_SPEED = 1.15 / 0.16
/**
 * How far the far edge of the last step may ever get from the caster, in pet-heights.
 *
 * ⚠️ THE VISIBLE FIELD IS ABOUT NINE PET-HEIGHTS ACROSS, and this is the budget that
 * keeps the pattern inside it. It is what replaces the old fixed spacing: that spacing existed
 * to stop a 2.5 boss throwing its last step half a screen past the edge of the world, and it
 * bought that by closing the gaps instead. Spending the budget on spacing and taking the steps
 * out of the count keeps both — measured, the far edge now runs 5.8 heights for a player and
 * 6.7 for the biggest boss, against 6.2 and 8.0 before.
 */
const WAVE_FAR = 6.5
const WAVE_START = 1.1
/** a bigger creature starts further out, but not proportionally — see the note above */
const easedScale = (s: number) => 1 + (s - 1) * 0.4

/**
 * Every patch a cast covers right now.
 *
 * @param t seconds since the cast began
 */
/**
 * @param charge 0 to 1, and only the bolt reads it — see BOLT_UP
 */
export function patchesOf(
  kind: CastKind,
  from: Spot,
  aim: Aimed,
  t: number,
  scale = 1,
  charge = 0,
): Patch[] {
  const s = Math.max(0.4, scale)
  const up = Math.max(0, Math.min(1, charge))
  if (kind === 'bloom') {
    /**
     * ⚠️ LIVE WHILE IT GROWS, which is what makes it different from everything else here. A
     * burst you dodge once is a swipe with a bigger circle; something that keeps expanding while
     * it hurts is a thing you have to keep moving away from, and that is a different verb.
     */
    /**
     * ⚠️ IT ENDS HALF AS BIG AGAIN, and the growth is where the extra went rather than
     * the start. Asked for as some of these hitting bigger, and the swell is the one whose
     * whole idea is that it keeps coming — at 0.84 pet-heights it topped out barely wider
     * than the mark, which made "keep going" advice about a circle you had already left. The
     * opening size is nearly unchanged, so what you must react to is the same and what you
     * must keep reacting to is more.
     */
    const warn = 0.55
    const grown = Math.max(0, Math.min(1, (t - warn) / (CAST.bloom.time - warn)))
    const r = (0.26 + 0.95 * grown) * PARK_TALL * s
    return [{ at: from, r, ready: Math.min(1, t / warn), live: t >= warn }]
  }
  if (kind === 'mark') {
    /* ⚠️ A CRATER RATHER THAN A DINNER PLATE. It is the slowest of the four to land —
       1.05s of warning against the bolt's 0.42 — and it was paying that in full for a circle
       two thirds of a creature wide. What you buy with a long telegraph is area. */
    const warn = 1.05
    const r = 0.95 * PARK_TALL * s
    return [
      {
        at: stepFrom(from, aim, MARK_RANGE * easedScale(s)),
        r,
        ready: Math.min(1, t / warn),
        live: t >= warn && t <= warn + 0.26,
      },
    ]
  }
  if (kind === 'bolt') {
    /**
     * ⚠️ A PROJECTILE IS ONE PATCH WHOSE PLACE IS A FUNCTION OF TIME, and that is the entire
     * implementation. Everything else in this module already treats a cast as "what is
     * dangerous right now, given how long it has been going" — so a thing that travels needed
     * no position on the wire, no per-frame state, no spawn and no despawn. The relay carries
     * the same slot and the same elapsed it already carried for a fissure.
     *
     * ⚠️ WHICH ALSO MEANS EVERY MACHINE AGREES ABOUT WHERE IT IS without being told. Two
     * players watching the same bolt compute the same circle from the same four numbers, which
     * is the bargain the boss's other three already make and the reason none of them desync.
     */
    const flying = Math.max(0, t - BOLT_WARN)
    /* ⚠️ BIGGER AND FASTER, WHICH IS ONE DECISION TWICE. A charged bolt that was only
       harder would be an invisible upgrade; making it visibly fatter and visibly quicker is
       what lets somebody else read how long you held it. */
    /* ⚠️ AND THE BOLT IS DELIBERATELY LEFT ALONE. It is the cheap fast one — 0.55s of wait
       against the other three's four seconds — and the thing it trades for that is being a
       needle. Growing it too would have made "bigger" mean "every cast", which is the same as
       nothing being bigger. */
    const r = 0.34 * (1 + BOLT_UP.fat * up) * PARK_TALL * s
    const speed = BOLT_SPEED * (1 + BOLT_UP.quick * up)
    return [
      {
        at: stepFrom(from, aim, (BOLT_FROM + flying * speed) * easedScale(s)),
        r,
        ready: Math.min(1, t / BOLT_WARN),
        live: t >= BOLT_WARN,
      },
    ]
  }
  /**
   * ⚠️ A WAVE IS JUST PATCHES WITH STAGGERED CLOCKS, which is the trick that makes a rolling
   * fissure and a carpet of bombs the same feature. Each step lands a moment after the one
   * behind it, so the danger travels outward and the answer is to cross it rather than outrun it.
   */
  /**
   * ⚠️ THE SPACING IS THE RADIUS PLUS THE FLOOR, WHICH IS THE WHOLE FIX. It used to be
   * a flat 1.15 whatever the creature, so a fissure closed itself the moment the steps grew
   * past 0.575 — and with a crosser's own footprint counted, from scale 1.0 up. Deriving the
   * spacing from the radius means the floor between two steps is the same crossable width
   * whoever threw it, and a bigger creature spends its size on bigger holes rather than on
   * joining them together.
   *
   * ⚠️ AND THE COUNT IS WHAT GIVES: fewer, fatter bites rather than a longer line. The
   * pattern has a reach budget, so growing the spacing has to buy steps back out of the count
   * or the last one lands off screen — which is exactly the failure the fixed spacing was
   * protecting against, and the reason it was fixed in the first place. A player throws four
   * and the biggest boss throws two.
   *
   * ⚠️ NEVER FEWER THAN TWO, or it is a mark with a different name.
   */
  const r = WAVE_R * s
  const gap = 2 * r + WAVE_FLOOR
  const start = WAVE_START * easedScale(s)
  const room = WAVE_FAR - start - r
  /* ⚠️ a hair of tolerance: (n - 1) × gap and room are the same number in decimal and not
     always in binary, and without it a fissure silently loses its last step at some sizes */
  const steps = Math.max(2, Math.min(WAVE_STEPS, 1 + Math.floor(room / gap + 1e-9)))
  const roll = gap / WAVE_SPEED

  const out: Patch[] = []
  const warn = 0.5
  for (let i = 0; i < steps; i++) {
    const startsAt = warn + i * roll
    out.push({
      at: stepFrom(from, aim, start + i * gap),
      r: r * PARK_TALL,
      ready: Math.min(1, t / startsAt),
      live: t >= startsAt && t <= startsAt + 0.24,
    })
  }
  return out
}

/**
 * Is this creature standing in that patch?
 *
 * ⚠️ THE SAME ELLIPSE inSwipe USES, so being caught by a cast and being caught by a swing mean
 * the same thing about where you were standing. A patch is round and a creature is not, so its
 * footprint is measured along the line between the two — see footSpan.
 */
export function inPatch(at: Spot, wide: number, p: Patch, scale = 1): boolean {
  const { sx, sy } = toScreen(at.x - p.at.x, at.y - p.at.y)
  const d = Math.hypot(sx, sy)
  if (d < 1e-6) return true
  return d <= p.r + footSpan(wide, scale, sx / d, sy / d)
}
