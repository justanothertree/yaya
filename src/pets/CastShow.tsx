import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Drawing } from '../draw/strokes'
import { PetView } from './PetView'
import { footRoom, petCanvas } from './rig'
import { CAST, patchesOf, type CastKind } from '../park/cast'
import { SwipePatch } from '../park/SwipePatch'
import { strikeSwipe } from '../park/strike'
import type { Attack } from './attack'
import { footSpan, PARK_TALL } from '../park/strike'
import { petWide } from './attack'
import { shapeOf } from '../park/castShape'
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
 * ⚠️ IT PLAYS THE REAL patchesOf, AT THE REAL SPEED AND IN THE REAL SHAPE. Not a diagram of
 * one. Every circle here comes out of the same function the park calls and is drawn with the
 * same class, so a preview cannot quietly drift from the game — which is the one failure mode
 * that would make it worse than having none.
 *
 * ⚠️ AND AT THE REAL SIZE, WHICH IT SPENT A WHILE NOT BEING. The shapes and the timings were
 * always exact and the SCALE was a lie: patchesOf was called without one, so every circle was a
 * creature of scale 1 while the panel around it described a boss, which is 2.05 to 3.05 times
 * bigger and says so two lines down with its health. The note that used to sit here worked out
 * why passing the scale was not the fix on its own — the creature was drawn at a fixed pixel
 * height passed in as a prop, so scaling the circles alone would have made them enormous beside
 * a creature that had not grown — and then left it, because a stylised model is not wrong, only
 * less useful. Asked for directly: the wizard should be "as 1:1 with how the drawings looks and
 * moves/operate in game so you can see the scale of what you are drawing".
 *
 * So the field is the unit now. The box is one screenful, the same screenful the park's camera
 * shows, and everything in it is a fraction of that: a creature is PARK_TALL of a screen times
 * its own scale, and the circles come out of patchesOf at that same scale. Nothing here is a
 * chosen pixel size any more, which is what makes it true rather than tuned — and it is why a
 * boss now fills a third of the box and a cast lands where a cast lands.
 *
 * ⚠️ AND THE ORDER IS THE DRAWING'S, not the declaration's. temperOf picks three of the four
 * kinds and sorts them by how well they suit the picture. That sort IS what a BOSS throws —
 * it was also what 1, 2 and 3 did for a player until loadout.ts, and a player now chooses their
 * own three. So this row is the boss's kit, which is what the panel around it is about.
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
  scale = 1,
  swing,
  onPickCast,
}: {
  art: Drawing
  /** the creature's three, best-first — temperOf's own order, which is what 1/2/3 press */
  casts: CastKind[]
  /**
   * How big this creature actually is, from its own Temper.
   *
   * ⚠️ IT DEFAULTS TO A PLAYER, NOT TO A BOSS. Everything in here is a fraction of the field,
   * so a caller that forgets this gets a creature at player size rather than a creature at a
   * size nobody has — wrong, but wrong in a way you can see, and the same size the four casts
   * were previewed at for as long as this component has existed.
   */
  scale?: number
  /**
   * A SWING to show instead of a cast, from the row of moves above.
   *
   * ⚠️ NO NEW ROW OF BUTTONS, which matters more here than it sounds: there were already three
   * rows of them, and being confused by exactly that was reported in one block. The six moves
   * have a picker, the three casts have a picker, and this field shows whichever of the nine you
   * last pressed — so the park-scale view with the hitboxes in it is driven entirely by controls
   * that were already on the page.
   *
   * ⚠️ AND IT IS THE SAME MOVE THE PANEL ABOVE IS PLAYING, seen from above instead of side on.
   * That one is what the swing looks like; this is where it actually reaches, at the size and in
   * the place the park puts it.
   */
  swing?: Attack | null
  /** pressed a cast, so the field stops showing a swing — the picker is the only switch */
  onPickCast?: () => void
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
  /* ⚠️ the creature's own footprint, so a spell layer changes this preview while you draw
     it — which is the whole point of drawing one. See castShapeOf. */
  const shape = useMemo(() => shapeOf(art), [art])

  const firstLive = useMemo(() => {
    const at = { x: 0.5, y: 0.5 }
    for (let t = 0; t <= CAST[kind].time; t += 1 / 60)
      if (patchesOf(kind, at, { x: 1, y: 0 }, t, scale, 0, shape).some((p) => p.live)) return t
    return CAST[kind].time * 0.7
  }, [kind, shape, scale])
  /* ⚠️ the still frame for reduced motion has to be a moment the swing is OUT, or the one frame
     somebody gets is a creature standing there — the same reason firstLive exists above */
  const swingLive = swing ? swing.span * ((swing.live[0] + swing.live[1]) / 2) : 0

  /**
   * How tall the field is, in pixels, because it is the unit everything in here is measured in.
   *
   * ⚠️ MEASURED RATHER THAN CHOSEN, which is the whole of "1:1". The box is `width: 100%` with
   * a 16/10 aspect, so its height is whatever the rail's width makes it — and the creature has
   * to be PARK_TALL of that, times its scale, or it is a creature of some pixel height standing
   * next to circles of some other. Those two agreeing is the only thing that makes the picture
   * mean anything.
   *
   * ⚠️ BEFORE PAINT, so the first frame is already right rather than being right on the second.
   * A creature that pops from one size to another on load reads as a layout bug, and a measure
   * taken in a plain effect is exactly how you get one.
   *
   * ⚠️ AND ResizeObserver DOES NOT FIRE IN THE BROWSER PANE, so this is the one line here that
   * cannot be exercised where the rest was. It is the same guarded shape Charts and the ambient
   * backdrop use, and the initial measure below is what a screenshot actually proves.
   */
  const field = useRef<HTMLDivElement | null>(null)
  const [fieldTall, setFieldTall] = useState(0)
  useLayoutEffect(() => {
    const el = field.current
    if (!el) return
    const measure = () => setFieldTall(el.getBoundingClientRect().height)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const cycle = (swing ? swing.span : CAST[kind].time) + PAUSE
  const [gone, setGone] = useState(0)
  const at = useRef(0)
  useEffect(() => {
    if (still) {
      setGone(swing ? swingLive : firstLive)
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
  }, [cycle, still, firstLive, swing, swingLive])

  if (!casts.length) return null

  /**
   * ⚠️ THE OFFSET IS WHAT MATTERS, NOT THE PLACE. patchesOf answers in world units across a
   * three-screen park; this is one little box. Taking the difference from where the creature
   * stands and dividing by one screenful converts the answer without the preview having to
   * know anything about parks, cameras or where in one it is pretending to be.
   */
  const from = { x: 0.5, y: 0.5 }
  /**
   * ⚠️ THE PARK'S OWN strikeSwipe, AND THE PARK'S OWN COMPONENT TO DRAW IT. Both of those are
   * the point rather than a convenience: a swing's region is worked out once and painted once,
   * so a box shown here cannot drift from the box that decides whether you were hit. The file
   * that component came out of says it plainly — a telegraph and a debug box that disagree about
   * where a swing is are the whole bug that module keeps paying for, and a preview in a third
   * room is just a third place for them to disagree.
   */
  const swiped =
    swing && !still
      ? strikeSwipe(from, { x: 1, y: 0 }, swing, Math.min(gone, swing.span), scale)
      : swing
        ? strikeSwipe(from, { x: 1, y: 0 }, swing, swingLive, scale)
        : null
  const patches = patchesOf(
    kind,
    from,
    { x: 1, y: 0 },
    Math.min(gone, CAST[kind].time),
    scale,
    0,
    shape,
  )
  /**
   * What this cast would have been if you had drawn no spell layer.
   *
   * ⚠️ BECAUSE A CLAIM IS NOT A DEMONSTRATION. The line above this says "your spell layer: these
   * reach much further but stay tighter", which is true and is still only a sentence — there is
   * nothing on screen to compare it against, so drawing one and watching looks exactly like
   * drawing one and nothing happening. Reported in those words: "i still cant figure out how to
   * use spell yet i havnt seen it do anything."
   *
   * ⚠️ IT IS THE SAME FUNCTION WITH null WHERE THE SHAPE GOES, which is the one honest way to
   * draw it: a hand-made outline of "roughly where it used to land" would be a second opinion
   * about the default, and the default is exactly what patchesOf answers when asked with nothing.
   */
  const ghost = shape
    ? patchesOf(kind, from, { x: 1, y: 0 }, Math.min(gone, CAST[kind].time), scale, 0, null)
    : []
  /* ⚠️ PARK_TALL is a creature's height in SCREEN-heights and the box is one screenful, so this
     is the same sum the park makes — and petCanvas turns a creature's height into the canvas
     that holds it, headroom and all, which is the one part that is not a bare multiplication. */
  const size = petCanvas(art, Math.max(1, fieldTall * PARK_TALL * scale))

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
              onPickCast?.()
              at.current = 0
              setGone(0)
            }}
          >
            <b>{i + 1}</b> {CAST[k].short}
          </button>
        ))}
      </div>
      <div className="cast-show-field" ref={field}>
        {swiped && (
          <SwipePatch
            swipe={swiped}
            /* the creature stands at STANDS, and a swing comes from where the creature is */
            at={STANDS}
            aspect={FIELD_ASPECT}
            className="park-box is-hit"
          />
        )}
        {/* ⚠️ UNDER YOURS AND UNFILLED, so it reads as "where this used to go" rather than as a
            second cast arriving. It is only drawn when there IS a spell layer: a ghost of itself
            on every creature would be a permanent double image explaining nothing. */}
        {!swing &&
          ghost.map((p, i) => (
            <span
              key={'g' + i}
              className="cast-show-ghost"
              aria-hidden
              style={{
                left: `${(STANDS.x + (p.at.x - from.x) / VIEW.w) * 100}%`,
                top: `${(STANDS.y + (p.at.y - from.y) / VIEW.h) * 100}%`,
                width: `${((p.r * 2) / FIELD_ASPECT) * 100}%`,
                height: `${p.r * 2 * 100}%`,
                transform: `translate(-50%, -50%) scale(${(0.5 + p.ready * 0.5).toFixed(3)})`,
              }}
            />
          ))}
        {!swing &&
          patches.map((p, i) => (
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
        {/**
          ⚠️ THE HITBOX THE PARK ACTUALLY USES, drawn with the park's own sum at the park's own
          scale. Asked for directly — "im interested in being able to test your drawing in a park
          like space live 1:1 with hitboxes on like in park as well so you see your hitbox" — and
          this field is already that space: one screenful, the same one the camera shows, with the
          creature at PARK_TALL times its own scale.

          ⚠️ AN ELLIPSE, AND A SHALLOW ONE, because that is what footSpan tests against: seen from
          above a creature covers a shallow patch, about four to one. A circle here would be a
          picture of a hitbox rather than the hitbox.

          ⚠️ AND IT IS NARROWER THAN THE CREATURE ON PURPOSE — 0.8 of the body's width, not the
          picture's. There is no empty-space buffer in it to remove: it is already smaller than
          you are, and the 12% padding that does exist belongs to the CANVAS, so a limb swinging
          past where it rests is not clipped. Nothing about being hit reads that number.
        */}
        <span
          className="park-box is-foot cast-show-foot"
          aria-hidden
          style={{
            left: `${STANDS.x * 100}%`,
            top: `${STANDS.y * 100}%`,
            /* ⚠️ the hit test's own function, asked along each axis — never a second copy of
               its arithmetic, which is how the park's debug ellipse came to agree with a bug */
            width: `${((footSpan(petWide(art), scale, 1, 0) * 2) / FIELD_ASPECT) * 100}%`,
            height: `${footSpan(petWide(art), scale, 0, 1) * 2 * 100}%`,
            transform: 'translate(-50%, -50%)',
            borderRadius: '50%',
          }}
        />
        {/* ⚠️ STOOD ON ITS FEET, THE WAY THE PARK STANDS IT. The bottom of a pet's canvas is the
            bottom of its ink box, which carries whatever was drawn below the body and the
            animation headroom with it — so anchoring the canvas puts the creature that far above
            the ground, and above the footprint drawn at its feet. Every room that stands a
            creature on a floor makes this correction; this one is a floor. */}
        <span
          className="cast-show-pet"
          style={{
            left: `${STANDS.x * 100}%`,
            top: `${STANDS.y * 100}%`,
            transform: `translate(-50%, calc(-100% + ${(footRoom(art) * 100).toFixed(1)}%))`,
          }}
        >
          <PetView art={art} size={size} facing={1} energy={0} label="" />
        </span>
      </div>
      {/* ⚠️ IT HAS TO SAY WHICH OF THE NINE IT IS SHOWING, because the field is now driven by
          two pickers and a caption about a cast under a picture of a swing is worse than none. */}
      <p className="muted cast-show-why">
        {swing ? (
          <>
            <strong>{swing.name}</strong> — this is where it reaches, from above, at the size the
            park throws it. The blue patch is what has to be hit to hit <em>you</em>.
          </>
        ) : (
          <>
            <strong>{CAST[kind].short}</strong> — {CAST[kind].says.replace(/^it /, '')}. {WHY[kind]}
          </>
        )}
      </p>
    </div>
  )
}
