import { useEffect, useRef, useState } from 'react'
import type { Drawing } from '../draw/strokes'
import { PetView } from './PetView'
import { bodyRatio, petCanvas } from './rig'
import { lungeOf, phaseOf } from './fight'
import { HIT_SHAPES, type Attack, type HitShape } from './attack'

/**
 * What your creature's moves actually look like.
 *
 * ⚠️ THE ROOM NAMED THE MOVES AND NEVER SHOWED ONE. "In a scrap: swipe, heavy gore, up buffet,
 * down sweep" is four words, and four words is not a reason to call a layer `horn` — you had to
 * believe that naming a layer bought you a fighting style, keep the creature, adopt it, open the
 * games tab and press things to find out what you had made. Said out loud by the owner: nobody is
 * going to pick a layer name for a fighting style they have never been shown and cannot tweak.
 *
 * ⚠️ SO IT PLAYS THE SWING, AT THE SPEED IT HAPPENS, WITH THE DANGEROUS PART DRAWN. A move in this
 * game is three things — how long you are committed, when in that it can hurt, and how far it
 * covers — and none of the three is a word. Watching a heavy wind up, flash and leave you standing
 * there is the entire argument for why a heavy costs more, made in about a second and a half.
 *
 * ⚠️ AND IT SAYS WHAT WOULD CHANGE IT, which is the tweak. There is deliberately no slider here:
 * the drawing is the only source of truth in this whole module, and a number you could drag would
 * be a second one that could disagree with it. What there IS instead is the sentence telling you
 * that the reach came from how long you drew the part — so the pencil is the knob, and now it is
 * a knob you can see moving.
 */

/** how long it sits still at the end before going round again, so the recovery reads as a cost */
const PAUSE = 0.5

const BUTTON = ['F', 'G', '↑ F', '↑ G', '↓ F', '↓ G']

/** ⚠️ by slot, because the slot is what a person presses — see slotFor */
const ROLE = ['quick', 'heavy', 'up, quick', 'up, heavy', 'down, quick', 'down, heavy']

/**
 * What you would change to change it.
 *
 * ⚠️ NAMED AFTER THE PART, NOT AFTER THE NUMBER. "reach 1.25" is a fact about a creature nobody
 * asked for; "draw the horn longer" is the same fact pointed at the pencil.
 */
function tweakFor(a: Attack): string {
  if (a.from === 'hit')
    return 'You drew this one. Further from the middle reaches further, higher up launches harder, and bigger hurts more.'
  const part: Record<string, string> = {
    arm: 'arm',
    leg: 'leg',
    head: 'head',
    mouth: 'mouth',
    tail: 'tail',
    wing: 'wing',
    horn: 'horn',
    spin: 'wheel',
    pulse: 'heart',
    flame: 'flame',
  }
  const p = part[a.from] ?? a.from
  return `Comes from your ${p}. Draw a longer one and it reaches further; a layer called hit gives you a move you draw yourself.`
}

/** How far a move reaches and how tall it is, as fractions of the creature's height. */
const spanOf = (a: Attack) => ({ wide: a.reach, tall: Math.max(a.rise, 0.2) * 2 })

export function MoveShow({
  art,
  moves,
  /** the creature's height in the preview, in pixels */
  tall = 104,
  hits,
  onShape,
}: {
  art: Drawing
  moves: Attack[]
  tall?: number
  /** what kind each part throws — see Drawing.hits */
  hits?: Record<string, string>
  /** given, this turns the preview into the place you DECIDE rather than only watch */
  onShape?: (part: string, shape: HitShape) => void
}) {
  /**
   * Which earlier button already throws this exact move.
   *
   * ⚠️ MOST CREATURES HAVE FEWER THAN SIX MOVES AND THE ROW PRETENDED OTHERWISE. moveTable
   * always returns six entries, and a creature with one or two named parts fills several of them
   * with the same attack — so the row read as six things that all behaved identically. Reported
   * as "a lot of the attacks seem to be so similar". They were the same attack.
   */
  const sameAs = moves.map((m) =>
    moves.findIndex(
      (o) => o.name === m.name && o.reach === m.reach && o.bite === m.bite && o.span === m.span,
    ),
  )
  const [pick, setPick] = useState(0)
  /**
   * Which PART you were last looking at, so shaping it does not move it out from under you.
   *
   * ⚠️ A SLOT IS NOT A MOVE. The six buttons are won by whichever attack is best at going
   * that way, and a shape changes what an attack is best at — so pressing Slam on the head made
   * the head slower, handed that slot to the wing, and left the wizard showing the wing with
   * Swipe marked. Watched exactly that: press Slam, panel says Swipe, because it was no longer
   * the same creature's head being asked about. The belt learned the same lesson the other way
   * round; a control that answers a different question after you press it is worse than one that
   * refuses.
   *
   * So the selection follows the PART. The slot it lives in may move; what you are editing does
   * not.
   */
  const want = useRef<string | null>(null)
  /* ⚠️ asked here rather than taken as a prop, so this cannot be dropped into a room that
     forgot about it — and unverifiable in the Browser pane, which cannot emulate the setting */
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
  const [gone, setGone] = useState(0)
  const a = moves[pick] ?? moves[0]

  useEffect(() => {
    const here = moves[pick]
    if (!want.current || !here || here.from === want.current) return
    const again = moves.findIndex((m) => m.from === want.current)
    /* gone entirely — the part lost every slot — so stop chasing it and stay where we are */
    if (again < 0) want.current = here.from
    else setPick(again)
  }, [moves, pick])
  const cycle = a ? a.span + a.rest + PAUSE : 1

  /**
   * ⚠️ THE CLOCK IS THE WHOLE POINT, so reduced motion gets the one frame that matters rather
   * than nothing: parked at the middle of the live window, which is the frame the move IS.
   */
  const at = useRef(0)
  useEffect(() => {
    if (!a) return
    if (still) {
      setGone(a.span * ((a.live[0] + a.live[1]) / 2))
      return
    }
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
  }, [a, cycle, still])

  if (!a) return null

  const swinging = { swing: Math.max(0, a.span - gone), move: 0, spent: false, stun: 0, hold: 0 }
  const phase = gone < a.span ? phaseOf(swinging, [a]) : 'ready'
  const live = phase === 'live'
  const lunge = gone < a.span ? lungeOf(swinging, [a]) : 0
  const { wide, tall: high } = spanOf(a)

  /* ⚠️ the same sum the games use, so the box drawn here is the box you are hit by there */
  const size = petCanvas(art, tall)

  return (
    <div className="move-show">
      <div className="move-show-pick" role="group" aria-label="Your moves">
        {moves.map((m, i) => (
          <button
            key={i}
            className={'btn btn-ghost' + (i === pick ? ' is-on' : '')}
            aria-pressed={i === pick}
            onClick={() => {
              setPick(i)
              /* what you chose is a PART from here on — see `want` */
              want.current = m.from
              at.current = 0
              setGone(0)
            }}
          >
            <b>{BUTTON[i]}</b> {m.name}
            {sameAs[i] < i && <i className="move-show-dup"> = {BUTTON[sameAs[i]]}</i>}
          </button>
        ))}
      </div>

      <div className="move-show-stage" style={{ height: `${Math.round(tall * 1.5)}px` }}>
        {/* ⚠️ THE DANGEROUS PATCH, DRAWN WHERE IT IS. Reach and rise are in creature-heights, so
            at a known pixel height they are a rectangle and nothing has to be guessed. It is only
            on screen while the move can actually hurt, which is how the wind-up and the recovery
            become visible as the thing they are. */}
        <span
          className={'move-show-box' + (live ? ' is-live' : '')}
          style={{
            width: `${wide * tall * (a.both ? 2 : 1)}px`,
            height: `${high * tall}px`,
            left: a.both ? `calc(50% - ${wide * tall}px)` : '50%',
          }}
          aria-hidden
        />
        {/* ⚠️ WHAT THEY HAVE TO REACH TO HIT YOU, which is not the picture and does not lunge
            with it. A creature's width is its BODY — attacks drawn off the side are not part of
            what can be hit — and a swing moves the drawing while leaving the creature where it
            stands, so this box stays put while the picture leans out of it. */}
        <span
          className="move-show-body"
          style={{ width: `${bodyRatio(art) * tall}px`, height: `${tall}px` }}
          aria-hidden
        />
        <span
          className="move-show-pet"
          style={{ transform: `translate(calc(-50% + ${(lunge * 100).toFixed(1)}%), -50%)` }}
        >
          <PetView
            art={art}
            size={size}
            facing={1}
            energy={gone < a.span ? 2 : 0.6}
            show={gone < a.span ? a.layer : undefined}
            label={`your minion throwing its ${a.name}`}
          />
        </span>
        <span className="move-show-phase">{live ? 'now it hurts' : phase}</span>
      </div>

      <p className="muted move-show-says">
        <strong>
          {a.name} — {ROLE[pick]}
        </strong>
        <br />
        Reaches <strong>{a.reach.toFixed(1)}</strong> of its own height
        {a.both ? ' on both sides' : ''}, hits for <strong>{a.bite}</strong>, and ties it up for{' '}
        <strong>{(a.span + a.rest).toFixed(2)}s</strong>
        {a.lift > 0.5 ? ' — this is the one that launches.' : '.'}
        {a.both && ' It comes out both sides, so it does not matter which way you are facing.'}
        <br />
        {sameAs[pick] < pick
          ? `The same move as ${BUTTON[sameAs[pick]]}. Name another layer and this button gets one of its own.`
          : tweakFor(a)}
      </p>

      {/**
       * The one question the drawing cannot answer, asked where you can see the answer.
       *
       * ⚠️ UNDER THE MOVE PLAYING, NOT IN A PANEL OF ITS OWN. "Very easy follow-along wizard"
       * is the ask, and the thing that makes this one followable is that pressing a shape changes
       * the animation above it on the spot — the box the move covers, how long it winds up, how
       * far it goes. It is one question about the thing you are looking at.
       *
       * ⚠️ IT SETS THE PART, NOT THE BUTTON. Six buttons share however many parts you drew,
       * so shaping "the F button" would silently shape whatever else that part answers for. The
       * line underneath says which part is being changed, so that is never a surprise.
       */}
      {onShape && (
        <div className="move-show-shape">
          <span className="muted">What does this do?</span>
          <span className="move-show-pick">
            {HIT_SHAPES.map(([id, label, why]) => {
              const on = (hits?.[a.from] ?? 'swipe') === id
              return (
                <button
                  key={id}
                  className={'btn' + (on ? ' is-on' : '')}
                  aria-pressed={on}
                  title={why}
                  onClick={() => {
                    /* ⚠️ claimed BEFORE the table is rebuilt, or the first thing you shape is
                       the one thing this cannot follow — see `want` */
                    want.current = a.from
                    onShape(a.from, id)
                  }}
                >
                  {label}
                </button>
              )
            })}
          </span>
          <span className="muted move-show-shape-why">
            {HIT_SHAPES.find(([id]) => id === (hits?.[a.from] ?? 'swipe'))?.[2]}
            <br />
            Sets every move thrown with the <strong>{a.from}</strong>. Size still comes from how big
            you drew it.
          </span>
        </div>
      )}
    </div>
  )
}
