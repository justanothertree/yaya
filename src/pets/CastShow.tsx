import { useEffect, useMemo, useRef, useState } from 'react'
import type { Drawing } from '../draw/strokes'
import { PetView } from './PetView'
import { petCanvas } from './rig'
import { CAST, patchesOf, type CastKind } from '../park/cast'
import { VIEW } from '../park/walk'

/**
 * What your creature's three BIG moves actually look like.
 *
 * ⚠️ MOVESHOW'S ARGUMENT, ONE SIZE UP. That component exists because the room named the six
 * swings and never showed one, and naming a thing is not showing it. The three casts were in
 * exactly that state and worse: a swing at least happens next to the creature that threw it, so
 * you can guess. "Then it splits the ground away from itself" is a sentence about an attack that
 * covers most of a screen, arrives in five staggered pieces and is answered completely
 * differently from the other two — and the only way to find out was to adopt the creature, walk
 * into the park and press 3. Asked for in those words: live previews like there are now, but for
 * the more complicated attacks.
 *
 * ⚠️ IT PLAYS THE REAL patchesOf, AT THE REAL SPEED, AT THE REAL SIZE. Not a diagram of one.
 * Every circle here is the circle that will be on the grass, taken from the same function the
 * park calls and drawn with the same class, so a preview cannot quietly drift from the game —
 * which is the one failure mode that would make it worse than having none. The only thing this
 * invents is where the creature stands.
 *
 * ⚠️ AND THE ORDER IS THE DRAWING'S, not the declaration's. temperOf picks three of the four
 * kinds and sorts them by how well they suit the picture, and that sort IS what 1, 2 and 3 do
 * in the park — so this row is the loadout rather than a catalogue. Redrawing a horn reorders
 * it; changing how quick the thing is swaps one of the three for a different attack entirely.
 */

/** how long it sits empty at the end before going round again, so the cooldown reads as a cost */
const PAUSE = 0.6

/** the field is 16:10, and a screen-height is its height — the same constant the park uses */
const FIELD_ASPECT = 16 / 10

/** where the creature stands in the little field, as a fraction of it */
const STANDS = { x: 0.17, y: 0.54 }

/**
 * What you would change to change which one you get.
 *
 * ⚠️ POINTED AT THE PENCIL, the same rule tweakFor follows: "likesClose 0.71" is a fact nobody
 * asked for, "a horn pushes this up" is the same fact aimed at the thing you can actually do.
 *
 * ⚠️ AND IT HAS TO STAY TRUE. Each line below names the parts that feed the dial temper.ts
 * actually uses — charge for the swell, nerve for the fissure, reach for the ranged slot, and
 * pace for which of the two ranged answers fills it. A sentence that could disagree with the
 * creature it describes is worse than none, so these move when that scoring moves.
 */
const WHY: Record<CastKind, string> = {
  bloom:
    'Won by creatures that get on top of you: a horn, a wheel or a mouth pushes this up, and so does having no long parts to fight at the end of.',
  mark: 'Won by reach: the longer the furthest thing you drew, the more this suits you. Slow and long-limbed marks the ground — quicker on its feet and it throws a bolt instead.',
  bolt: 'The quick creature’s answer to fighting at range. Legs and short parts make a thrower; slower and longer-limbed marks the ground instead. Too high to jump — step out of the line or meet it with a guard.',
  wave: 'Won by creatures that never give ground: legs, a horn or a flame push this up, and wings or a float pull it down.',
}

export function CastShow({
  art,
  casts,
  tall = 84,
}: {
  art: Drawing
  /** the creature's three, best-first — temperOf's own order, which is what 1/2/3 press */
  casts: CastKind[]
  tall?: number
}) {
  const [pick, setPick] = useState(0)
  const kind = casts[pick] ?? casts[0]
  /* ⚠️ asked here rather than passed in, so this cannot be dropped into a room that forgot
     about it — and unverifiable in the Browser pane, which cannot emulate the setting */
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

  /**
   * The first moment anything is dangerous, for the one frame reduced motion gets.
   *
   * ⚠️ FOUND BY ASKING patchesOf RATHER THAN BY KNOWING. The warn-up is a different number for
   * each of the three and lives inside that function; copying the three here would be three
   * constants that go stale the first time one is tuned, and the still frame would then be the
   * wrong frame — silently, because a still picture cannot look mistimed.
   */
  const firstLive = useMemo(() => {
    const at = { x: 0.5, y: 0.5 }
    for (let t = 0; t <= CAST[kind].time; t += 1 / 60)
      if (patchesOf(kind, at, { x: 1, y: 0 }, t).some((p) => p.live)) return t
    return CAST[kind].time * 0.7
  }, [kind])

  const cycle = CAST[kind].time + PAUSE
  const [gone, setGone] = useState(0)
  const at = useRef(0)
  useEffect(() => {
    if (still) {
      setGone(firstLive)
      return
    }
    at.current = 0
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      at.current = (at.current + (now - last) / 1000) % cycle
      last = now
      setGone(at.current)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [cycle, still, firstLive])

  if (!casts.length) return null

  /**
   * ⚠️ THE OFFSET IS WHAT MATTERS, NOT THE PLACE. patchesOf answers in world units across a
   * three-screen park; this is one little box. Taking the difference from where the creature
   * stands and dividing by one screenful converts the answer without the preview having to
   * know anything about parks, cameras or where in one it is pretending to be.
   */
  const from = { x: 0.5, y: 0.5 }
  const patches = patchesOf(kind, from, { x: 1, y: 0 }, Math.min(gone, CAST[kind].time))
  const size = petCanvas(art, tall)

  return (
    <div className="cast-show">
      <div className="cast-show-pick" role="group" aria-label="Your big moves">
        {casts.map((k, i) => (
          <button
            key={k}
            className={'btn btn-ghost' + (i === pick ? ' is-on' : '')}
            aria-pressed={i === pick}
            onClick={() => {
              setPick(i)
              at.current = 0
              setGone(0)
            }}
          >
            <b>{i + 1}</b> {CAST[k].short}
          </button>
        ))}
      </div>
      <div className="cast-show-field">
        {patches.map((p, i) => (
          <span
            key={i}
            className={'park-patch' + (p.live ? ' is-live' : '')}
            aria-hidden
            style={{
              left: `${(STANDS.x + (p.at.x - from.x) / VIEW.w) * 100}%`,
              top: `${(STANDS.y + (p.at.y - from.y) / VIEW.h) * 100}%`,
              width: `${((p.r * 2) / FIELD_ASPECT) * 100}%`,
              height: `${p.r * 2 * 100}%`,
              /* the same growth the park draws, so a wind-up looks like a wind-up in both */
              transform: `translate(-50%, -50%) scale(${(0.5 + p.ready * 0.5).toFixed(3)})`,
              opacity: p.live ? 0.9 : 0.2 + p.ready * 0.5,
            }}
          />
        ))}
        <span
          className="cast-show-pet"
          style={{ left: `${STANDS.x * 100}%`, top: `${STANDS.y * 100}%` }}
        >
          <PetView art={art} size={size} facing={1} energy={0} label="" />
        </span>
      </div>
      <p className="muted cast-show-why">
        <strong>{CAST[kind].short}</strong> — {CAST[kind].says.replace(/^it /, '')}. {WHY[kind]}
      </p>
    </div>
  )
}
