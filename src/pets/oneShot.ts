import { useCallback, useEffect, useRef, useState } from 'react'
import { POUNCE_FOR } from './rig'

/**
 * A thing the creature does once and stops doing.
 *
 * ⚠️ THE FIVE STANCES ARE STATES AND THIS IS NOT ONE. Idle, alert, run, crouch and sleep are
 * things a pet IS: you pick one and it stays there. A pounce is a thing a pet DOES — it happens,
 * it takes about a third of a second, and then you have your creature back. That difference is
 * why it was left out when the other five landed, and it is the whole of what this adds: the rig
 * already knew how to hold the pose (see TUNE.pounce), nothing knew how to let go of it.
 *
 * ⚠️ RE-FIRING RESTARTS RATHER THAN STACKS. Press it twice and you get one pounce that lasts from
 * the second press, not two overlapping timers racing to turn it off — the first of which would
 * cut the second one short, so the faster you pressed the less would happen.
 *
 * ⚠️ AND IT CLEARS UP AFTER ITSELF. Leaving the room mid-pounce would otherwise set state on a
 * component that is gone, which React complains about and is a real leak of a timer nobody owns.
 */
export function useOneShot(seconds = POUNCE_FOR): [boolean, () => void] {
  const [on, setOn] = useState(false)
  const timer = useRef(0)

  const fire = useCallback(() => {
    setOn(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOn(false), seconds * 1000)
  }, [seconds])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return [on, fire]
}
