import type { Spot } from './walk'

/**
 * Whether the boss has noticed you, and whether it still has you.
 *
 * ⚠️ A CHASE HAD NO BEGINNING AND NO END. bossThink has always been handed `target` and always
 * walked at it — so a boss knew where you were through a hill, from across the park, the instant
 * it existed, and kept knowing forever. That is a thing following you rather than a thing
 * hunting you, and it is why there was nothing to do about a chase except outrun it or kill it.
 *
 * ⚠️ WHICH IS ALSO WHY SNEAKING HAD NOWHERE TO LIVE. "Sneaking (think metal gear solid)" needs
 * something to be hidden FROM, and an omniscient boss cannot be hidden from at any speed. The
 * two are one feature: this is the state that makes creeping mean something.
 *
 * ⚠️ PURE, AND THE HOST'S ALONE. It is a function of where the two of you are, which the host
 * already knows — so it needs nothing from the wire, exactly like every patch in cast.ts. A
 * viewer watching somebody else's boss sees it act noticed or not without being told which.
 */

/** How aware of you it is, and where it will go looking. */
export type Watch = {
  /** 0 it has no idea you are there, 1 it is on you */
  seen: number
  /**
   * The last place it actually had eyes on you.
   *
   * ⚠️ THE LAST PLACE, NOT WHERE YOU ARE. This is the whole of breaking a chase: it goes to
   * where you were, and if you are not there any more it has nothing. Handing it your real
   * position here would make losing it impossible and the mark pointless.
   */
  mark: Spot | null
  /** seconds since it last saw you, which is how long it keeps looking */
  cold: number
}

export const NOTICE = {
  /**
   * How far it can notice you at all, in pet-heights.
   *
   * ⚠️ SHORTER THAN THE FIELD ON PURPOSE. The park is about nine pet-heights across a screen,
   * so this is a bit over half a screen — far enough that walking up to a boss is a decision,
   * short enough that there is somewhere to stand and think.
   */
  far: 5.5,
  /** seconds to go from nothing to certain, right in front of it and walking normally */
  spot: 0.8,
  /**
   * ⚠️ BEHIND IT IS THE POINT. A boss faces left or right and nothing else — the Walker only
   * carries a sign — so this is honest about what it can know: coming at its back is the
   * quietest approach there is, and circling is therefore a real move.
   */
  behind: 0.22,
  /** creeping, which is what the sneak key buys you */
  sneak: 0.3,
  /** standing perfectly still, which is quieter than walking and louder than nothing */
  still: 0.45,
  /**
   * How long it keeps hunting the mark after losing sight.
   *
   * ⚠️ IT DOES NOT SNAP BACK TO CALM, because a chase that ends the instant you round a corner
   * is not a chase you escaped, it is one that forgot. Four seconds is long enough that getting
   * away is a thing you did and short enough that it is worth trying.
   */
  give: 4,
  /** seconds of not being seen before it has fully cooled off */
  cool: 2.6,
  /** at or above this it is coming for you; below it, it is only wondering */
  onto: 1,
  /** how fast it walks to the mark while it is only wondering, as a share of its own pace */
  creep: 0.55,
  /**
   * How fast YOU go while creeping, as a share of your own walk.
   *
   * ⚠️ SLOW ENOUGH TO BE A TRADE. Creeping cuts how noticeable you are to under a third,
   * and if it cost nothing it would simply be how everybody walks everywhere. Just over half
   * speed is the price: quiet is worth having and not worth having all the time.
   */
  crept: 0.52,
}

/** It is on you and closing. */
export const hunted = (w: Watch): boolean => w.seen >= NOTICE.onto

/** It knows something is up but has not committed. */
export const wary = (w: Watch): boolean => w.seen > 0.05 && w.seen < NOTICE.onto

export const unseen = (): Watch => ({ seen: 0, mark: null, cold: NOTICE.give + NOTICE.cool })

/** What the boss can tell about you this frame. */
export type Telling = {
  /** how far off you are, in pet-heights */
  off: number
  /** -1 directly behind it, 1 directly in front — see NOTICE.behind */
  ahead: number
  /** true while you are actually going somewhere */
  moving: boolean
  /** true while you are deliberately creeping */
  sneaking: boolean
  /**
   * Something happened that no amount of creeping hides.
   *
   * ⚠️ HITTING IT IS NOT SNEAKING. A swing that lands, a cast, being hit — any of those put it
   * straight onto you whatever your feet were doing, because the alternative is a stealth game
   * where the winning move is to stab something repeatedly from behind while it wonders.
   */
  loud: boolean
}

/**
 * How noticeable you are right now, 0 to 1.
 *
 * ⚠️ MULTIPLIED, NOT ADDED, so the quiet options stack the way you would expect: creeping up
 * behind something a long way off is the sum of three good decisions rather than the best one.
 */
export function loudness(t: Telling): number {
  if (t.loud) return 1
  if (t.off >= NOTICE.far) return 0
  /* nearer is louder, and it falls off rather than stopping at a line */
  const near = 1 - t.off / NOTICE.far
  const side = t.ahead > 0 ? 1 : NOTICE.behind + (1 - NOTICE.behind) * (1 + t.ahead)
  const feet = t.sneaking ? NOTICE.sneak : t.moving ? 1 : NOTICE.still
  return Math.max(0, Math.min(1, near * side * feet))
}

/**
 * One frame of it working out whether you are there.
 *
 * @param at where you are, for the mark it will go looking at
 */
export function stepWatch(w: Watch, t: Telling, at: Spot, dt: number): Watch {
  const step = Math.max(0, Math.min(0.05, dt))
  const loud = loudness(t)

  if (loud > 0) {
    /* ⚠️ IT RISES, IT DOES NOT SNAP. The ramp is the tell — a boss going from calm to charging
       in one frame gives you nothing to react to, and the whole point of an awareness state is
       the moment where you can still back out of it. See the alert pose. */
    const seen = Math.min(NOTICE.onto, w.seen + (loud * step) / NOTICE.spot)
    return { seen, mark: { x: at.x, y: at.y }, cold: 0 }
  }

  const cold = w.cold + step
  /* ⚠️ IT HOLDS WHAT IT HAD WHILE IT HUNTS. Falling off the instant you are out of sight would
     mean the mark is never used, because the boss would be calm before it got there. */
  if (cold < NOTICE.give) return { ...w, cold }
  const seen = Math.max(0, w.seen - step / NOTICE.cool)
  return { seen, mark: seen > 0 ? w.mark : null, cold }
}
