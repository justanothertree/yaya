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
 * nor a thing anybody can learn. Spacing is therefore the pattern's own and does not scale;
 * only where it STARTS does, because a bigger creature reaches further before it begins.
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
 * start at 7 — which is why the relay clamps that field to 9 rather than 6.
 */
const SLOTS: CastKind[] = ['bloom', 'mark', 'wave', 'bolt']

export const castSlot = (kind: CastKind): number => SLOTS.indexOf(kind) + 7

export const castFromSlot = (n: number): CastKind | null => SLOTS[Math.round(n) - 7] ?? null

const MARK_RANGE = 2.6
/** where the bolt leaves from, how long it is telegraphed, and how fast it travels */
const BOLT_FROM = 1.0
const BOLT_WARN = 0.42
const BOLT_SPEED = 7
const WAVE_STEPS = 5
const WAVE_GAP = 1.15
const WAVE_ROLL = 0.16
/** a bigger creature starts further out, but not proportionally — see the note above */
const easedScale = (s: number) => 1 + (s - 1) * 0.4

/**
 * Every patch a cast covers right now.
 *
 * @param t seconds since the cast began
 */
export function patchesOf(kind: CastKind, from: Spot, aim: Aimed, t: number, scale = 1): Patch[] {
  const s = Math.max(0.4, scale)
  if (kind === 'bloom') {
    /**
     * ⚠️ LIVE WHILE IT GROWS, which is what makes it different from everything else here. A
     * burst you dodge once is a swipe with a bigger circle; something that keeps expanding while
     * it hurts is a thing you have to keep moving away from, and that is a different verb.
     */
    const warn = 0.55
    const grown = Math.max(0, Math.min(1, (t - warn) / (CAST.bloom.time - warn)))
    const r = (0.22 + 0.62 * grown) * PARK_TALL * s
    return [{ at: from, r, ready: Math.min(1, t / warn), live: t >= warn }]
  }
  if (kind === 'mark') {
    const warn = 1.05
    const r = 0.62 * PARK_TALL * s
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
    const r = 0.34 * PARK_TALL * s
    return [
      {
        at: stepFrom(from, aim, (BOLT_FROM + flying * BOLT_SPEED) * easedScale(s)),
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
  const out: Patch[] = []
  const warn = 0.5
  for (let i = 0; i < WAVE_STEPS; i++) {
    const startsAt = warn + i * WAVE_ROLL
    const r = 0.46 * PARK_TALL * s
    out.push({
      at: stepFrom(from, aim, 1.1 * easedScale(s) + i * WAVE_GAP),
      r,
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
