import { useEffect, useState, useSyncExternalStore } from 'react'
import { PetView } from './PetView'
import { companion, setCompanion, subscribeCompanion } from './companion'
import { pets, subscribePets } from './pets'

/**
 * One of your pets, hanging about in the corner.
 *
 * ⚠️ IT DOES NOT WALK ACROSS THE PAGE. "Hang out in a corner" is what was asked for and it is
 * also the only version that is not hostile: a creature wandering over a page is a thing that
 * covers the words you are reading, lands on the button you are aiming at, and has to be given
 * rules about where it may not go. It sits still and is alive where it sits, which is what the
 * rig already does for free.
 *
 * ⚠️ IT CANNOT SWALLOW A CLICK. The corner it sits in is pointer-events: none, and only the pet
 * itself and its ✕ take presses back. Otherwise it would be an invisible square over whatever is
 * underneath it, which on a phone is most of the bottom of the screen.
 *
 * ⚠️ IT SITS ABOVE WHATEVER ELSE IS PINNED DOWN THERE, using --bottom-guard the way the call dock
 * does — that is 0 on a desktop and the phone's nav bar height on a phone, so it needs no
 * breakpoint and cannot end up underneath the navigation.
 */

const REST = 0.45

export function PetCompanion() {
  const want = useSyncExternalStore(subscribeCompanion, companion, companion)
  const mine = useSyncExternalStore(subscribePets, pets, pets)

  const [still, setStill] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  )
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const on = () => setStill(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  const [awake, setAwake] = useState(false)
  useEffect(() => {
    if (!awake) return
    const t = window.setTimeout(() => setAwake(false), 2600)
    return () => window.clearTimeout(t)
  }, [awake])

  if (!want.on) return null
  /* the one you chose, or the one you have — a name that no longer matches anything is somebody
     having let that pet go, not a reason to show nothing */
  const pet = mine.find((p) => p.name === want.name) ?? mine[0]
  if (!pet) return null

  return (
    <div className="pet-corner">
      <button
        className="pet-corner-poke"
        onClick={() => setAwake(true)}
        title={still ? pet.name : `Say hello to ${pet.name}`}
      >
        <PetView
          art={pet.art}
          /* ⚠️ 88 before the crop landed, when most of that was empty paper. A creature now fills
             it, so the corner is bigger in effect than this number suggests — and a little larger
             again, because "really small" was the first thing said about it. */
          size={104}
          energy={still ? 0 : awake ? 1 : REST}
          label={`${pet.name}, in the corner`}
        />
      </button>
      {/* ⚠️ ON THE PET, not in a settings page. See the note in companion.ts — the way to stop
          looking at an overlay must be where you are already looking. */}
      <button
        className="pet-corner-away"
        onClick={() => setCompanion({ on: false })}
        title={`Put ${pet.name} away — the Pets room brings them back`}
        aria-label={`Put ${pet.name} away`}
      >
        ✕
      </button>
    </div>
  )
}
