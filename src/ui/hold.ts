/**
 * How fast a held button repeats.
 *
 * ⚠️ PURE, AND SEPARATE FROM THE BUTTON, FOR THE USUAL REASON. The thing worth getting right here
 * is a feeling — "press and hold to ramp faster" — and a feeling expressed as four constants
 * inside a pointer handler is one nobody can check. `requestAnimationFrame` never fires in the
 * Browser pane and a `computer` click there is about a millisecond long, so a ramp driven from a
 * component is close to unobservable; asked directly, `stepsWithin` answers "how far does two
 * seconds of holding move it" with no browser involved.
 *
 * The shape: one step on press, a pause long enough that a TAP is one step and not two, then
 * repeats that accelerate to a floor.
 */

/** the pause after the first step, before repeating begins */
const FIRST = 400
/** the first repeating interval */
const SLOW = 180
/** as fast as it ever goes — 25 steps a second is already faster than anybody can react */
const FAST = 40
/**
 * ⚠️ THE FLOOR EVERY LOOP IN THIS FILE AGREES ON, and it is one constant because two were a bug.
 * `holdDelay` clamped to `max(1, FAST)` while `msToFullSpeed` asked `holdDelay(n) > FAST` — so
 * with `FAST` at 0 the clamp returned 1, 1 > 0 for ever, and the function span. Found by
 * perturbing `FAST` to 0 and `EASE` negative to check the tests could fail: neither FAILED,
 * both HUNG, which is the one result a test cannot report. Two numbers describing one floor will
 * disagree eventually; this is the floor.
 */
const FLOOR = Math.max(1, FAST)
/** how much each repeat shortens the next one */
const EASE = 14

/**
 * The wait before repeat number `fired + 1`, in milliseconds.
 *
 * ⚠️ `FIRST` IS LONG ON PURPOSE AND IS THE ONLY REASON A TAP WORKS. Without a pause that outlasts
 * an ordinary press, every tap on a minute button would move the clock twice — which reads as the
 * control being broken rather than as being too eager. A person's click is 60–120ms, so 400 has
 * room either side.
 */
export function holdDelay(fired: number): number {
  if (fired <= 0) return FIRST
  /* FLOOR, never FAST — see the note on FLOOR for what asking two different questions cost */
  return Math.max(FLOOR, Math.round(SLOW - (fired - 1) * EASE))
}

/**
 * How many steps a hold of `ms` produces, counting the one on press.
 *
 * This is the function to argue with when the ramp feels wrong, because it is the sentence the
 * ramp is making: hold for a second and you move a handful; hold for five and you cross an hour.
 */
export function stepsWithin(ms: number): number {
  let steps = 1
  let at = 0
  /* bounded as well as clamped: 1ms floor means a minute of holding is 60,000 at the very most,
     so anything past that is a broken ramp rather than a long press, and returning is better than
     spinning */
  while (steps < 100_000) {
    at += holdDelay(steps - 1)
    if (at > ms) return steps
    steps++
  }
  return steps
}

/** milliseconds until the ramp is at full speed, for a test to pin the claim to */
export function msToFullSpeed(): number {
  let at = 0
  let fired = 0
  /* bounded as well as floored: a ramp that never reaches its floor — an EASE of zero, or the
     wrong sign — is a broken ramp, and answering is better than spinning */
  while (fired < 10_000 && holdDelay(fired) > FLOOR) {
    at += holdDelay(fired)
    fired++
  }
  return at
}

export const HOLD_FLOOR_MS = FLOOR
