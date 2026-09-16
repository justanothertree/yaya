import { useEffect, useState, useSyncExternalStore } from 'react'
import { PetView } from './PetView'
import { companion, cornerSize, setCompanion, subscribeCompanion } from './companion'
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
 *
 * ⚠️ IT WATCHES YOU ACROSS THE WHOLE PAGE, which is what makes a creature in a corner read
 * as company rather than as a sticker. The rig has moved the head and the eyes since the stances
 * landed, and the Pets room advertises it — but the room's pet is one you are leaning over, so
 * `'hover'` was enough there, and this one was left with no watching at all. Your cursor is almost
 * never on top of a thing pinned in a corner: for this pet, following the pointer anywhere on the
 * screen is not a richer mode, it is the only one that would ever fire.
 *
 * ⚠️ AND A POKE MAKES IT ALERT rather than only faster. `alert` is the stance the rig
 * describes as the pose before it does something, which is exactly what being prodded is. It uses
 * the timer that was already here and keeps no state about the pet — there is deliberately
 * nothing in this corner that can be neglected.
 *
 * ⚠️ ITS SIZE COMES FROM THE SCREEN, NOT FROM A NUMBER. It was a fixed 104 pixels, which is a
 * reasonable ornament on a laptop, a third of the width of a phone, and a speck on a big monitor
 * — reported as "very tiny compared to my screen", which it was, on the screen it was being
 * looked at on. A fraction of the SHORT side tracks all three, and the floor and ceiling stop a
 * phone getting a creature it has to look around and a wall display getting a poster.
 */

/** the short side of the window, live, because a pet should not need a reload to fit */
function useShortSide(): number {
  const [n, setN] = useState(() => Math.min(window.innerWidth, window.innerHeight))
  useEffect(() => {
    const on = () => setN(Math.min(window.innerWidth, window.innerHeight))
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return n
}

const REST = 0.45

export function PetCompanion() {
  const want = useSyncExternalStore(subscribeCompanion, companion, companion)
  const mine = useSyncExternalStore(subscribePets, pets, pets)
  const shortSide = useShortSide()

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
          size={Math.round(cornerSize(shortSide) * want.size)}
          energy={still ? 0 : awake ? 1 : REST}
          stance={awake ? 'alert' : 'idle'}
          watch="page"
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
