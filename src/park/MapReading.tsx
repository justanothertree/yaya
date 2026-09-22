import { useMemo, useState } from 'react'
import type { Stroke } from '../draw/strokes'
import { mapOf, standable, type Place } from './mapOf'

/**
 * What the game would make of this drawing, if it were a map.
 *
 * ⚠️ THE SAME JOB THE MINIONS ROOM'S PART LIST DOES, and for the same reason. A creature's
 * rig was invisible until something said "this layer is a wing, and a wing flaps" — before
 * that, naming a layer was an act of faith. A map read out of layer names has exactly that
 * problem and needs exactly that answer: say what you understood, in the words the person
 * typed, while they are still standing in the room where they can change it.
 *
 * ⚠️ IN PAINT RATHER THAN SOMEWHERE ELSE, because this is the feedback half of a tool. Asked
 * for as "extra tools as UI to help anyone draw the components to make the map" — and the tool
 * that helps most is not another brush, it is being told that the thing you just drew reads as
 * a pond three fifths of a screen wide.
 *
 * ⚠️ FOLDED AWAY BY DEFAULT. Most drawings are not maps, and a panel about map-making under
 * every picture somebody paints is a room that has decided what you are doing.
 */

/**
 * What counts as small and big, in screenfuls.
 *
 * ⚠️ SET AGAINST THE PARK THAT EXISTS, not against the range the number could take. The
 * five landmarks in MARKS are 0.24, 0.26, 0.28, 0.30 and 0.34 screenfuls wide — so a first
 * guess of "small under 0.35" called every real place in the game small, and the three I drew
 * to test it all came out "middling" because they happened to be bigger than anything the park
 * actually has. Banding a measurement against its theoretical range rather than its observed
 * one is the mistake this repository keeps writing down.
 */
const SMALL = 0.26
const BIG = 0.38

const KIND_SAYS: Record<Place['kind'], string> = {
  pond: 'water',
  grove: 'trees',
  ring: 'a clearing',
  rocks: 'rocks',
  flat: 'nothing in particular',
}

/**
 * ⚠️ THE PIECES, NOT A Drawing. PaintRoom keeps the live drawing in a ref, which never
 * triggers a render — and building a fresh Drawing object in the JSX would make a new
 * identity every render, so the memo below would recompute the whole map on every brush
 * stroke. The three things that actually matter are state, so they can be depended on.
 */
export function MapReading({
  strokes,
  layerNames,
  ratio,
}: {
  strokes: Stroke[]
  layerNames: string[]
  ratio: number
}) {
  const [open, setOpen] = useState(false)
  const places = useMemo(
    () => (open ? mapOf({ ratio, layers: layerNames, strokes }) : []),
    [open, strokes, layerNames, ratio],
  )
  const climbable = standable(places)

  return (
    <div className="paint-row paint-asmap">
      <button
        className={'btn btn-ghost' + (open ? ' is-on' : '')}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title="Read this drawing the way the park would"
      >
        🗺 As a map
      </button>
      {open && !places.length && (
        <span className="muted">
          Nothing named yet. Press ✎ on a layer and call it <strong>pond</strong>,{' '}
          <strong>trees</strong>, <strong>rocks</strong> or <strong>clearing</strong> — and add a
          number for how high it stands, like <strong>rocks 0.5</strong>.
        </span>
      )}
      {open && places.length > 0 && (
        <ul className="paint-asmap-list">
          {places.map((p, i) => (
            <li key={`${p.name}-${i}`}>
              <span className="paint-asmap-name">{p.name}</span>
              <span className="muted">
                {' — '}
                {KIND_SAYS[p.kind]}
                {', '}
                {p.size < SMALL ? 'small' : p.size > BIG ? 'big' : 'middling'}
                {/* ⚠️ THE HEIGHT IN WHAT IT MEANS, not in the number they typed. 0.72 is not a
                    unit anybody has a feel for; "only with wings" is the fact behind it — see
                    HOP.up, which a plain jump peaks at. */}
                {p.top <= 0
                  ? ', flat'
                  : p.top < 0.3
                    ? ', a step up'
                    : p.top <= 0.62
                      ? ', a jump up'
                      : ', only with wings'}
              </span>
            </li>
          ))}
        </ul>
      )}
      {open && places.length > 0 && (
        <span className="muted paint-asmap-meta">
          {places.length} place{places.length === 1 ? '' : 's'}
          {climbable.length > 0 && `, ${climbable.length} you can stand on`}. Unnamed layers are
          scenery.
        </span>
      )}
    </div>
  )
}
