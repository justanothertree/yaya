import { useSyncExternalStore } from 'react'
import { motionReduced, onMotionChange } from './motion'

/**
 * Should this component hold still?
 *
 * ⚠️ `motion.ts` ALREADY SAID EVERYTHING READS IT, AND FIFTEEN FILES DID NOT. Its header
 * promises "everything animated reads this rather than matchMedia directly, so one switch
 * reaches the click flair, the ambient backdrop, the scroll reveals… and anything added later
 * that remembers to ask" — and twenty-five call sites were still asking the browser instead.
 *
 * That gap is not cosmetic, because the site switch is a localStorage flag and the media query
 * cannot see it. `motionReduced()` is `OS || site`, so a component reading the query directly
 * honours the operating system and ignores the switch — and the switch exists precisely because
 * "the person most likely to need it is the least likely" to find the OS setting. Someone who
 * turned it on still got the park, every pet, the circuit canvas and the watchlist wheel moving:
 * canvas render loops, which are most of the motion on this site, where the things that DID
 * obey were mostly CSS transitions already covered by the blanket rule.
 *
 * ⚠️ IT IS A HOOK BECAUSE THE SHAPE WAS COPIED TEN TIMES. Every one of those files carried the
 * same ten lines — a `useState` with a matchMedia initialiser and a `useEffect` adding a
 * `change` listener — and ten copies of a rule is ten chances to miss the next change to it.
 * One line now, and it subscribes to the switch as well as to the OS.
 *
 * `motion.ts` stays free of React so `pets/play.ts` and the other pure modules can keep asking
 * it without pulling a renderer in.
 */
export function useMotionReduced(): boolean {
  /* the server snapshot is `false`: there is no matchMedia in node, and "allow motion" is what
     the page renders as before hydration decides otherwise */
  return useSyncExternalStore(onMotionChange, motionReduced, () => false)
}
