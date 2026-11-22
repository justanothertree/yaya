/**
 * A short vibration when something you did took effect — off unless you turn it on.
 *
 * ⚠️ OFF BY DEFAULT, AND ONLY EVER YOURS TO TURN ON. A phone that buzzes on its own is a phone
 * that feels like it is shouting, and the people who would want this are the ones who will look
 * for it: the switch is in the settings menu beside Reduce motion. Stored in this browser, like
 * Call sound beside it, because it is a preference about this device and not about the account.
 *
 * ⚠️ NOT TIED TO REDUCE MOTION, deliberately. That setting is about things moving on screen; a
 * vibration is something else, which somebody can want with motion reduced or not want without.
 *
 * ⚠️ AND MOST DEVICES CANNOT. `navigator.vibrate` is an Android browser's; Safari on an iPhone has
 * none, so the switch is not shown there at all rather than offered and doing nothing.
 *
 * Storage and the vibrator are passed in so the rules can be asked without a browser.
 */

const KEY = 'haptics_v1'

/** what each moment feels like, in milliseconds on and off — short, since these are confirmations */
export const PATTERNS = {
  /** a small thing kept: a note saved, a rating */
  tap: 10,
  /** a timer started */
  start: 15,
  /** a timer stopped: two short pulses, so it does not feel like a start */
  stop: [12, 60, 12],
  /** a goal filled: three, the last a little longer */
  done: [10, 50, 10, 50, 24],
} as const

export type Buzz = keyof typeof PATTERNS

type Store = Pick<Storage, 'getItem' | 'setItem'>
type Vibrator = { vibrate?: (pattern: number | number[]) => boolean }

const store = (): Store | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}
const device = (): Vibrator | null => (typeof navigator === 'undefined' ? null : navigator)

/** whether this browser can vibrate at all — the switch is only drawn where it can */
export const canVibrate = (nav: Vibrator | null = device()): boolean =>
  typeof nav?.vibrate === 'function'

/**
 * Whether to offer the switch at all: the browser has the call AND the device is touch-first.
 *
 * ⚠️ DESKTOP CHROME HAS `navigator.vibrate` AND NOTHING TO VIBRATE, so the call alone would put a
 * switch on a laptop that does nothing when pressed — the broken-looking control the menu is
 * careful to avoid. A coarse pointer is the honest proxy for "a phone or tablet in the hand".
 */
export const offerVibration = (
  nav: Vibrator | null = device(),
  coarse = coarsePointer(),
): boolean => canVibrate(nav) && coarse

const coarsePointer = (): boolean => {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches
  } catch {
    return false
  }
}

/** whether vibration is on; anything unreadable is off */
export function hapticsOn(s: Store | null = store()): boolean {
  try {
    return s?.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setHaptics(on: boolean, s: Store | null = store()): void {
  try {
    s?.setItem(KEY, on ? '1' : '0')
  } catch {
    /* private mode: it applies for this visit only, which is what the menu's switch shows */
  }
}

/**
 * Vibrate for one of the moments above, if vibration is on and the device can; says whether it
 * did. Never throws: a confirmation that breaks the thing it confirms is worse than none.
 */
export function buzz(
  kind: Buzz,
  s: Store | null = store(),
  nav: Vibrator | null = device(),
): boolean {
  if (!hapticsOn(s) || !canVibrate(nav)) return false
  const p = PATTERNS[kind]
  try {
    return nav!.vibrate!(typeof p === 'number' ? p : [...p])
  } catch {
    return false
  }
}
