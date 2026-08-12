/**
 * Hungry Snake.
 *
 * The meter drains with time and refills when you eat. What makes it a mode rather than a
 * countdown is that it degrades in STAGES: a nudge, then a shove, then real damage. "You die if
 * you don't eat" is a timer with extra steps — you either make it or you don't, and there's
 * nothing to react to. Staged pressure tells you it's coming, tells you it's getting worse, and
 * leaves you a moment to do something about it.
 *
 * Per-player and purely local, so this needs nothing from the relay: everyone runs their own
 * meter and the only shared thing is the setting itself.
 */

export type HungerStage = 'full' | 'peckish' | 'hungry' | 'starving' | 'dying'

export type HungerState = {
  /** 0–1 */
  level: number
  stage: HungerStage
  /** multiply the tick interval by this — below 1 means faster, which is the punishment */
  speedScale: number
  /** true while the meter is empty: the snake starts shedding its tail */
  losingTail: boolean
}

const DEFAULT_SECONDS = 20

/**
 * Thresholds, high to low. Faster-when-starving is deliberately a punishment rather than a
 * reward: it takes control away, which is what makes running on empty frightening instead of
 * something you'd farm for.
 */
export function stageFor(level: number): HungerState {
  if (level > 0.5) {
    return { level, stage: level > 0.75 ? 'full' : 'peckish', speedScale: 1, losingTail: false }
  }
  if (level > 0.25) return { level, stage: 'hungry', speedScale: 0.9, losingTail: false }
  if (level > 0) return { level, stage: 'starving', speedScale: 0.75, losingTail: false }
  return { level: 0, stage: 'dying', speedScale: 0.75, losingTail: true }
}

/** How much meter one tick of `ms` costs. */
export function drainFor(ms: number, hungerSeconds?: number): number {
  const total = Math.max(4, hungerSeconds ?? DEFAULT_SECONDS) * 1000
  return ms / total
}

/** Human words for the HUD — the number alone doesn't tell you to do anything. */
export function hungerLabel(stage: HungerStage): string {
  switch (stage) {
    case 'full':
      return 'Full'
    case 'peckish':
      return 'Peckish'
    case 'hungry':
      return 'Hungry'
    case 'starving':
      return 'Starving'
    default:
      return 'Dying'
  }
}
