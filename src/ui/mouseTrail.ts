/**
 * Mouse trails — something that follows the pointer, rather than answering a click.
 *
 * ⚠️ A TRAIL IS NOT A FLAIR ON A TIMER. Click flair fires once at a point and is done; a trail is
 * continuous, and the whole difficulty is that a pointer produces events far faster than anything
 * should be drawn. So emission is gated by DISTANCE, not by time: move a long way quickly and you
 * get an evenly spaced ribbon, move slowly and you get nothing extra, stop and it stops. A
 * time-throttled version bunches particles when you move slowly and tears gaps when you move
 * fast, which is exactly backwards.
 *
 * Everything is drawn into the same fixed, pointer-events:none layer the click flair uses, so a
 * trail can never eat a click or shift the page, and the two can run together without either
 * knowing about the other.
 *
 * ⚠️ Reduced motion turns this off entirely — it is the most persistent movement on the site, so
 * it is the first thing that should stop. And it never runs on a coarse pointer: there is no
 * hovering cursor to trail on a phone, and the touch equivalent would be a smear under your own
 * thumb.
 */

import { motionReduced } from './motion'
import { touchOnly } from './pointerKind'
import { scalesFor, spacingFor } from './effectAmount'

// the trail's own size and speed — see scalesFor. A trail wants to be bigger and slower than
// a click does, which is exactly why these stopped being shared.
const { dur, px } = scalesFor('trail')

export type TrailStyle =
  | 'none'
  | 'comet'
  | 'ribbon'
  | 'motes'
  | 'ink'
  | 'spark'
  | 'bloom'
  | 'thread'
  | 'orbit'
  | 'dash'
  | 'rise'
  | 'smoke'
  | 'chase'
  | 'rings'
  | 'fireflies'
  | 'rain'
  | 'arrows'
  | 'snake'
  | 'wave'
  | 'bolt'
  | 'shadow'
  | 'flame'
  | 'notes'
  | 'frost'
  | 'confetti'

export const TRAIL_OPTIONS: Array<[TrailStyle, string, string]> = [
  ['none', '∅', 'None'],
  ['comet', '☄', 'Comet'],
  ['ribbon', '🎗', 'Ribbon'],
  ['motes', '✧', 'Motes'],
  ['ink', '🖋', 'Ink'],
  ['spark', '⚡', 'Spark'],
  ['bloom', '🌷', 'Petals'],
  ['thread', '🧵', 'Thread'],
  ['orbit', '⟳', 'Orbit'],
  ['dash', '≡', 'Dash'],
  ['rise', '🫧', 'Rise'],
  ['smoke', '🌫', 'Smoke'],
  ['chase', '🐾', 'Chase'],
  ['rings', '◎', 'Rings'],
  ['fireflies', '💡', 'Fireflies'],
  ['rain', '🌧', 'Rain'],
  ['arrows', '➤', 'Arrows'],
  ['snake', '🐍', 'Snake'],
  ['wave', '〰️', 'Wave'],
  ['bolt', '⌁', 'Bolt'],
  ['shadow', '◑', 'Shadow'],
  ['flame', '🔥', 'Flame'],
  ['notes', '🎶', 'Notes'],
  ['frost', '❅', 'Frost'],
  ['confetti', '🎉', 'Confetti'],
]

export const TRAIL_IDS = TRAIL_OPTIONS.map(([id]) => id)

export function isTrailStyle(v: unknown): v is TrailStyle {
  return typeof v === 'string' && (TRAIL_IDS as string[]).includes(v)
}

const LAYER_ID = 'click-fx-layer'
/** Live trail particles allowed at once. A fast hand must not be able to pile up hundreds. */
const MAX_LIVE = 90

let style: TrailStyle = 'none'
let installed = false
let live = 0
let lastX = 0
let lastY = 0
let started = false

function layer(): HTMLElement {
  let el = document.getElementById(LAYER_ID)
  if (!el) {
    el = document.createElement('div')
    el.id = LAYER_ID
    document.body.appendChild(el)
  }
  return el
}

/**
 * The flair ramp — five colours rather than the accent pair.
 *
 * ⚠️ Twelve trails drawing two colours read as one trail in twelve shapes, because the eye
 * takes the hue before the motion. Same ramp the click flairs and the backgrounds use, so a
 * trail and a click look like they come from the same site without looking like each other.
 * Falls back to the pair on a theme that predates the ramp.
 */
function palette(): string[] {
  const s = getComputedStyle(document.documentElement)
  const get = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback
  const ramp = [0, 1, 2, 3, 4].map((i) => s.getPropertyValue(`--fx-${i}`).trim()).filter(Boolean)
  if (ramp.length >= 2) return ramp
  const a = get('--accent', '#22c55e')
  return [a, get('--accent-2', a)]
}

function mk(cls: string, x: number, y: number) {
  const el = document.createElement('i')
  el.className = cls
  el.style.left = x + 'px'
  el.style.top = y + 'px'
  return el
}

/** One particle, cleaned up by its own animation finishing — no timers to keep in sync. */
function emit(node: HTMLElement, keyframes: Keyframe[], opts: KeyframeAnimationOptions) {
  if (live >= MAX_LIVE) return
  live++
  layer().appendChild(node)
  const anim = node.animate(keyframes, opts)
  const done = () => {
    node.remove()
    live--
  }
  anim.finished.then(done, done)
}

/**
 * How far the pointer must travel before the next particle.
 *
 * Per style, because spacing IS the character: a comet wants a dense stream, petals want to be
 * occasional or they stop reading as petals and become a smear.
 */
const SPACING: Record<Exclude<TrailStyle, 'none'>, number> = {
  comet: 8,
  ribbon: 6,
  motes: 26,
  ink: 14,
  spark: 18,
  bloom: 42,
  thread: 10,
  orbit: 30,
  dash: 22,
  rise: 20,
  smoke: 24,
  chase: 14,
  /* rings and fireflies are big or slow, so they need room or they stop being either */
  rings: 34,
  fireflies: 30,
  rain: 12,
  arrows: 26,
  /* a body wants its segments touching; a shadow wants one copy, not a stream */
  snake: 9,
  wave: 7,
  bolt: 20,
  shadow: 16,
  flame: 8,
  notes: 30,
  frost: 22,
  confetti: 14,
}

/**
 * Where each trail sits on the ramp, 0–1.
 *
 * ⚠️ Sixteen trails all drew the same two colours, so they read as one trail in twelve shapes
 * — the eye takes hue before motion. Giving each style its own place means comet and ink are
 * recognisably different things before you have registered how they move, while all twelve stay
 * inside the theme because the ramp IS the theme. Spread deliberately rather than evenly: styles
 * that tend to appear together are pushed apart.
 */
const TRAIL_HUE: Record<Exclude<TrailStyle, 'none'>, number> = {
  comet: 0.0,
  ribbon: 0.55,
  motes: 0.25,
  ink: 0.8,
  spark: 0.12,
  bloom: 0.68,
  thread: 0.42,
  orbit: 0.9,
  dash: 0.32,
  rise: 0.6,
  smoke: 0.75,
  chase: 0.18,
  rings: 0.5,
  fireflies: 0.22,
  rain: 0.58,
  arrows: 0.08,
  snake: 0.3,
  wave: 0.47,
  bolt: 0.14,
  shadow: 0.86,
  flame: 0.05,
  notes: 0.64,
  frost: 0.52,
  confetti: 0.36,
}

function drop(s: Exclude<TrailStyle, 'none'>, x: number, y: number, dx: number, dy: number) {
  const ramp = palette()
  const at = (t: number) => ramp[Math.round(Math.max(0, Math.min(1, t)) * (ramp.length - 1))]
  const base = TRAIL_HUE[s] ?? 0
  const a = at(base)
  // a partner far enough away to be a different colour, wrapped so it never runs off the end
  const b = at((base + 0.45) % 1)
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI
  const speed = Math.min(1, Math.hypot(dx, dy) / 40)

  switch (s) {
    /** A head with a tail: the dot fades where it was, so the shape is a streak behind you. */
    case 'comet': {
      const p = mk('trail-comet', x, y)
      p.style.background = a
      emit(
        p,
        [
          {
            transform: `translate(-50%, -50%) rotate(${angle}deg) scaleX(${1 + speed * 2})`,
            opacity: 0.9,
          },
          { transform: `translate(-50%, -50%) rotate(${angle}deg) scaleX(0.2)`, opacity: 0 },
        ],
        { duration: dur(420), easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', fill: 'forwards' },
      )
      break
    }
    /** A wide soft band that narrows as it dies — reads as one continuous stroke, not dots. */
    case 'ribbon': {
      const p = mk('trail-ribbon', x, y)
      p.style.background = `linear-gradient(90deg, ${a}, ${b})`
      emit(
        p,
        [
          { transform: `translate(-50%, -50%) rotate(${angle}deg) scale(1, 1)`, opacity: 0.55 },
          { transform: `translate(-50%, -50%) rotate(${angle}deg) scale(1.1, 0.1)`, opacity: 0 },
        ],
        { duration: dur(520), easing: 'ease-out', fill: 'forwards' },
      )
      break
    }
    /** Sparse specks that drift off sideways and twinkle out. Quiet — for people who want almost nothing. */
    case 'motes': {
      const off = px((Math.random() - 0.5) * 40)
      const p = mk('trail-mote', x, y)
      p.style.background = Math.random() < 0.5 ? a : b
      emit(
        p,
        [
          { transform: 'translate(-50%, -50%) translate(0, 0) scale(1)', opacity: 0.8 },
          {
            transform: `translate(-50%, -50%) translate(${off}px, ${-14 - Math.random() * 18}px) scale(0.2)`,
            opacity: 0,
          },
        ],
        { duration: dur(900 + Math.random() * 400), easing: 'ease-out', fill: 'forwards' },
      )
      break
    }
    /** Wet blots that spread and sink in. Slower and heavier than the rest. */
    case 'ink': {
      const p = mk('trail-ink', x, y)
      const size = px(9 + Math.random() * 13)
      p.style.width = size + 'px'
      p.style.height = size + 'px'
      p.style.background = a
      emit(
        p,
        [
          { transform: 'translate(-50%, -50%) scale(0.4)', opacity: 0.45 },
          { transform: 'translate(-50%, -50%) scale(1.25)', opacity: 0 },
        ],
        { duration: dur(780), easing: 'cubic-bezier(0.2, 0.6, 0.4, 1)', fill: 'forwards' },
      )
      break
    }
    /** Thrown perpendicular to the direction of travel, like something being struck. */
    case 'spark': {
      const perp = ((angle + 90 + (Math.random() - 0.5) * 70) * Math.PI) / 180
      const dist = px(12 + Math.random() * 34 * (0.4 + speed))
      const p = mk('trail-spark', x, y)
      p.style.background = Math.random() < 0.4 ? b : a
      emit(
        p,
        [
          { transform: 'translate(-50%, -50%) translate(0, 0) scale(1)', opacity: 1 },
          {
            transform: `translate(-50%, -50%) translate(${Math.cos(perp) * dist}px, ${Math.sin(perp) * dist}px) scale(0.2)`,
            opacity: 0,
          },
        ],
        { duration: dur(320 + Math.random() * 160), easing: 'ease-out', fill: 'forwards' },
      )
      break
    }
    /** Occasional petals that turn as they fall. Deliberately sparse — density kills it. */
    case 'bloom': {
      const p = mk('trail-petal', x, y)
      p.style.background = Math.random() < 0.5 ? a : b
      const spin = (Math.random() - 0.5) * 260
      emit(
        p,
        [
          { transform: 'translate(-50%, -50%) rotate(0deg) scale(0.5)', opacity: 0.85 },
          {
            transform: `translate(-50%, -50%) translate(${(Math.random() - 0.5) * 26}px, ${20 + Math.random() * 26}px) rotate(${spin}deg) scale(1)`,
            opacity: 0,
          },
        ],
        {
          duration: dur(1100 + Math.random() * 500),
          easing: 'cubic-bezier(0.3, 0.5, 0.5, 1)',
          fill: 'forwards',
        },
      )
      break
    }
    /**
     * Particles that circle the point they were dropped at instead of leaving it.
     *
     * The only trail whose motion is not "away from here" — each one runs a small orbit and fades
     * in place, so a slow drag leaves a row of little wheels rather than a line.
     */
    case 'orbit': {
      const r = px(13 + Math.random() * 14)
      const from = Math.random() * 360
      const p = mk('trail-mote', x, y)
      p.style.background = Math.random() < 0.5 ? a : b
      emit(
        p,
        [
          {
            transform: `translate(-50%, -50%) rotate(${from}deg) translateX(${r}px) scale(1)`,
            opacity: 0.9,
          },
          {
            transform: `translate(-50%, -50%) rotate(${from + 260}deg) translateX(${r}px) scale(0.3)`,
            opacity: 0,
          },
        ],
        { duration: dur(780), easing: 'linear', fill: 'forwards' },
      )
      break
    }
    /** Speed lines: short ticks square across the direction of travel, like motion in a comic. */
    case 'dash': {
      const p = mk('trail-dash', x, y)
      p.style.background = a
      emit(
        p,
        [
          {
            transform: `translate(-50%, -50%) rotate(${angle + 90}deg) scaleX(${0.6 + speed})`,
            opacity: 0.85,
          },
          {
            transform: `translate(-50%, -50%) rotate(${angle + 90}deg) scaleX(0.1)`,
            opacity: 0,
          },
        ],
        { duration: dur(300), easing: 'ease-out', fill: 'forwards' },
      )
      break
    }
    /** Bubbles that lift off the path and wobble as they go, indifferent to which way you moved. */
    case 'rise': {
      const p = mk('trail-bubble', x, y)
      const size = px(6 + Math.random() * 10)
      p.style.width = size + 'px'
      p.style.height = size + 'px'
      p.style.borderColor = Math.random() < 0.5 ? a : b
      emit(
        p,
        [
          { transform: 'translate(-50%, -50%) translate(0, 0) scale(0.6)', opacity: 0.8 },
          {
            transform: `translate(-50%, -50%) translate(${(Math.random() - 0.5) * 22}px, -34px) scale(1)`,
            opacity: 0,
          },
        ],
        { duration: dur(1100 + Math.random() * 500), easing: 'ease-out', fill: 'forwards' },
      )
      break
    }
    /** Soft puffs that swell and thin out — the quietest of the set, and the only blurred one. */
    case 'smoke': {
      const p = mk('trail-smoke', x, y)
      const size = px(16 + Math.random() * 20)
      p.style.width = size + 'px'
      p.style.height = size + 'px'
      p.style.background = a
      emit(
        p,
        [
          { transform: 'translate(-50%, -50%) scale(0.4)', opacity: 0.28 },
          {
            transform: `translate(-50%, -50%) translate(${(Math.random() - 0.5) * 18}px, -22px) scale(1.6)`,
            opacity: 0,
          },
        ],
        { duration: dur(1200 + Math.random() * 500), easing: 'ease-out', fill: 'forwards' },
      )
      break
    }
    /**
     * A dot that runs after the cursor and never quite arrives.
     *
     * Every other style is emitted and then forgotten; this one is animated from where it was
     * dropped TOWARD where the pointer is going, so it reads as something following you rather
     * than something you left behind. Overshoots slightly, which is what makes it feel alive
     * instead of mechanical.
     */
    case 'chase': {
      const p = mk('trail-chase', x, y)
      p.style.background = b
      const lead = 1.6 + speed * 1.2
      emit(
        p,
        [
          { transform: 'translate(-50%, -50%) translate(0, 0) scale(0.5)', opacity: 0.9 },
          {
            transform: `translate(-50%, -50%) translate(${dx * lead}px, ${dy * lead}px) scale(1)`,
            opacity: 0.7,
            offset: 0.55,
          },
          {
            transform: `translate(-50%, -50%) translate(${dx * lead * 1.25}px, ${dy * lead * 1.25}px) scale(0.2)`,
            opacity: 0,
          },
        ],
        { duration: dur(560), easing: 'cubic-bezier(0.2, 0.8, 0.4, 1)', fill: 'forwards' },
      )
      break
    }
    /**
     * A line segment joining where you were to where you are.
     *
     * The only one that draws the PATH rather than points along it, so a fast flick produces one
     * long stroke instead of a scatter — the shape of the gesture rather than a sample of it.
     */
    /**
     * Expanding rings dropped where you passed, like something touching water.
     *
     * ⚠️ Given the widest SPACING of any style. Rings are large and hollow, so at a normal rate
     * they overlap into a solid band and stop reading as rings at all — the gap between them is
     * what makes each one a ring rather than part of a tube.
     */
    case 'rings': {
      const p = mk('trail-bubble', x, y)
      const size = px(10)
      p.style.width = size + 'px'
      p.style.height = size + 'px'
      p.style.borderColor = a
      emit(
        p,
        [
          { transform: 'translate(-50%, -50%) scale(0.4)', opacity: 0.9 },
          { transform: `translate(-50%, -50%) scale(${2.6 + speed * 1.6})`, opacity: 0 },
        ],
        { duration: dur(900), easing: 'cubic-bezier(0.1, 0.6, 0.3, 1)', fill: 'forwards' },
      )
      break
    }
    /**
     * Slow points that blink on, hang, and go out.
     *
     * ⚠️ the only style that gets BRIGHTER before it fades. Everything else here starts at
     * full and decays, which reads as exhaust; a lamp that comes up and holds reads as alive. They
     * also drift almost independently of the pointer, so they linger where you have been instead
     * of chasing you.
     */
    case 'fireflies': {
      const p = mk('trail-mote', x + (Math.random() - 0.5) * 26, y + (Math.random() - 0.5) * 26)
      const size = px(4 + Math.random() * 4)
      p.style.width = size + 'px'
      p.style.height = size + 'px'
      p.style.background = Math.random() < 0.4 ? b : a
      emit(
        p,
        [
          { transform: 'translate(-50%, -50%) scale(0.2)', opacity: 0 },
          { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.35 },
          { transform: 'translate(-50%, -50%) scale(1)', opacity: 0.85, offset: 0.6 },
          {
            transform: `translate(-50%, -50%) translate(${(Math.random() - 0.5) * 18}px, ${-8 - Math.random() * 14}px) scale(0.3)`,
            opacity: 0,
          },
        ],
        { duration: dur(1300 + Math.random() * 700), easing: 'ease-in-out', fill: 'forwards' },
      )
      break
    }
    /**
     * Streaks that fall away from the pointer instead of following it.
     *
     * ⚠️ gravity, which no other trail has. Every other style drifts along the direction you
     * moved, so they all read as variations on a wake; this one ignores your direction entirely
     * and goes down, which is why it still looks different at a glance from Comet or Dash.
     */
    case 'rain': {
      const p = mk('trail-dash', x + (Math.random() - 0.5) * 16, y)
      p.style.background = Math.random() < 0.3 ? b : a
      p.style.width = px(2) + 'px'
      p.style.height = px(9 + Math.random() * 7) + 'px'
      emit(
        p,
        [
          { transform: 'translate(-50%, -50%) translate(0, 0)', opacity: 0.85 },
          {
            transform: `translate(-50%, -50%) translate(${(Math.random() - 0.5) * 10}px, ${px(26 + Math.random() * 26)}px)`,
            opacity: 0,
          },
        ],
        {
          duration: dur(620 + Math.random() * 260),
          easing: 'cubic-bezier(0.4,0,0.9,1)',
          fill: 'forwards',
        },
      )
      break
    }
    /**
     * Small chevrons laid down pointing the way you went.
     *
     * ⚠️ rotated to the MOVEMENT, not to a fixed angle, so the trail becomes a readable path
     * rather than decoration — you can see which way you came. They shrink rather than travel,
     * because an arrow that also moves is two motions telling you the same thing.
     */
    case 'arrows': {
      const p = mk('trail-dash', x, y)
      p.style.background = a
      p.style.width = px(10 + speed * 8) + 'px'
      p.style.height = px(3) + 'px'
      emit(
        p,
        [
          { transform: `translate(-50%, -50%) rotate(${angle}deg) scaleX(1)`, opacity: 0.9 },
          { transform: `translate(-50%, -50%) rotate(${angle}deg) scaleX(0.2)`, opacity: 0 },
        ],
        { duration: dur(520), easing: 'ease-out', fill: 'forwards' },
      )
      break
    }
    /**
     * A body that follows the head, in a site that already has a snake in it.
     *
     * ⚠️ the segments SHRINK along the tail rather than fading, which is what makes it a
     * body instead of exhaust. Fading is how every other trail here ends; tapering is how a tail
     * ends, and the two read completely differently even with identical timing.
     */
    case 'snake': {
      const p = mk('trail-mote', x, y)
      const size = px(11)
      p.style.width = size + 'px'
      p.style.height = size + 'px'
      p.style.background = a
      p.style.borderRadius = '50%'
      emit(
        p,
        [
          { transform: 'translate(-50%, -50%) scale(1)', opacity: 0.95 },
          { transform: 'translate(-50%, -50%) scale(0.15)', opacity: 0.5 },
        ],
        { duration: dur(560), easing: 'linear', fill: 'forwards' },
      )
      break
    }
    /**
     * A ripple laid ACROSS your direction of travel, so the trail reads as a wave rather than a
     * line.
     *
     * ⚠️ offset perpendicular to the movement and alternating side to side. Everything else
     * here sits on the path; stepping off it in alternate directions is the whole effect, and it
     * only works because the offset is computed from the angle rather than from the axes.
     */
    case 'wave': {
      const side = Math.random() < 0.5 ? 1 : -1
      const rad = (angle * Math.PI) / 180
      const off = px(9 + speed * 12) * side
      const p = mk(
        'trail-mote',
        x + Math.cos(rad + Math.PI / 2) * off,
        y + Math.sin(rad + Math.PI / 2) * off,
      )
      const size = px(5 + speed * 4)
      p.style.width = size + 'px'
      p.style.height = size + 'px'
      p.style.background = side > 0 ? a : b
      emit(
        p,
        [
          { transform: 'translate(-50%, -50%) scale(0.4)', opacity: 0.9 },
          { transform: 'translate(-50%, -50%) scale(1.1)', opacity: 0 },
        ],
        { duration: dur(620), easing: 'ease-out', fill: 'forwards' },
      )
      break
    }
    /**
     * Short arcs that snap into place and vanish, like static jumping off the cursor.
     *
     * ⚠️ stepped easing and a hard cut, where every other style eases. Electricity does not
     * accelerate — it is there or it is not, and using a smooth curve for it is what makes most
     * attempts at this look like a worm instead of a spark.
     */
    case 'bolt': {
      const p = mk('trail-dash', x, y)
      const len = px(10 + Math.random() * 16)
      p.style.width = len + 'px'
      p.style.height = px(2) + 'px'
      p.style.background = Math.random() < 0.4 ? b : a
      const jag = angle + (Math.random() - 0.5) * 150
      emit(
        p,
        [
          { transform: `translate(-50%, -50%) rotate(${jag}deg) scaleX(0.2)`, opacity: 1 },
          {
            transform: `translate(-50%, -50%) rotate(${jag}deg) scaleX(1)`,
            opacity: 1,
            offset: 0.5,
          },
          { transform: `translate(-50%, -50%) rotate(${jag}deg) scaleX(1)`, opacity: 0 },
        ],
        { duration: dur(260), easing: 'steps(2, end)', fill: 'forwards' },
      )
      break
    }
    /**
     * One soft copy of the pointer, arriving late.
     *
     * ⚠️ the quietest thing in this list, and deliberately so. Every other trail is a
     * STREAM; this is a single lagging disc, so it reads as a shadow under your hand rather than
     * as an effect — the option for someone who wants a trail without wanting to be told about it.
     */
    case 'shadow': {
      const p = mk('trail-smoke', x, y)
      const size = px(20 + speed * 10)
      p.style.width = size + 'px'
      p.style.height = size + 'px'
      p.style.background = a
      emit(
        p,
        [
          { transform: 'translate(-50%, -50%) scale(0.8)', opacity: 0.28 },
          { transform: 'translate(-50%, -50%) scale(1)', opacity: 0 },
        ],
        { duration: dur(520), easing: 'ease-out', fill: 'forwards' },
      )
      break
    }
    /**
     * Tongues that rise and narrow, brightening as they go.
     *
     * ⚠️ it moves UP regardless of which way you moved, which no other trail does — even
     * Rise, which drifts with you. Fire does not follow a hand, it goes up, and ignoring the
     * pointer's direction entirely is what stops this looking like exhaust.
     */
    case 'flame': {
      const p = mk('trail-smoke', x + (Math.random() - 0.5) * 8, y)
      const size = px(10 + Math.random() * 10)
      p.style.width = size + 'px'
      p.style.height = size * 1.4 + 'px'
      p.style.background = Math.random() < 0.35 ? b : a
      emit(
        p,
        [
          { transform: 'translate(-50%, -50%) translate(0, 0) scale(1, 1)', opacity: 0.75 },
          {
            transform: `translate(-50%, -50%) translate(${(Math.random() - 0.5) * 12}px, ${px(-26)}px) scale(0.3, 1.5)`,
            opacity: 0,
          },
        ],
        { duration: dur(520 + Math.random() * 260), easing: 'ease-out', fill: 'forwards' },
      )
      break
    }
    /**
     * Notes drifting off the pointer, for the site that has an instrument in it.
     *
     * ⚠️ the only trail made of GLYPHS rather than shapes, so it is the only one whose
     * particles have a meaning of their own. That is also why it is spaced so widely — a stream of
     * overlapping characters is illegible, and an illegible letter is just a smudge with corners.
     */
    case 'notes': {
      const GLYPHS = ['\u266a', '\u266b', '\u266c']
      /* ⚠️ click-fx-glyph, not a new class of its own. Trails share the click layer, and that
         rule already carries the text reset a character particle needs — a second copy of it
         would be one more thing to keep in step for no gain. */
      const el = mk('click-fx-glyph', x, y)
      el.textContent = GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
      el.style.fontSize = px(13 + Math.random() * 7) + 'px'
      el.style.color = Math.random() < 0.5 ? a : b
      emit(
        el,
        [
          { transform: 'translate(-50%, -50%) translate(0, 0) rotate(0deg)', opacity: 0.95 },
          {
            transform: `translate(-50%, -50%) translate(${(Math.random() - 0.5) * 26}px, ${px(-30)}px) rotate(${(Math.random() - 0.5) * 60}deg)`,
            opacity: 0,
          },
        ],
        { duration: dur(900 + Math.random() * 400), easing: 'ease-out', fill: 'forwards' },
      )
      break
    }
    /**
     * Crystals that grow outward in a fixed direction and hold, rather than drifting.
     *
     * ⚠️ it does not MOVE at all — it scales from nothing and stops. Every other style here
     * travels; this one is deposited, which is what ice does, and the stillness is the effect.
     */
    case 'frost': {
      const p = mk('trail-dash', x, y)
      const len = px(12 + Math.random() * 12)
      p.style.width = len + 'px'
      p.style.height = px(2) + 'px'
      p.style.background = Math.random() < 0.4 ? b : a
      const spoke = Math.round(Math.random() * 6) * 60
      emit(
        p,
        [
          { transform: `translate(-50%, -50%) rotate(${spoke}deg) scaleX(0)`, opacity: 0.95 },
          {
            transform: `translate(-50%, -50%) rotate(${spoke}deg) scaleX(1)`,
            opacity: 0.8,
            offset: 0.35,
          },
          { transform: `translate(-50%, -50%) rotate(${spoke}deg) scaleX(1)`, opacity: 0 },
        ],
        { duration: dur(900), easing: 'cubic-bezier(0.1,0.8,0.2,1)', fill: 'forwards' },
      )
      break
    }
    /**
     * Little rectangles that tumble as they fall.
     *
     * ⚠️ rectangles, not dots, and they ROTATE — which is the entire difference from Rain.
     * A falling dot has no orientation, so it reads as a drop however it moves; a falling oblong
     * that turns reads as paper, and the two never get confused even though the physics is the
     * same.
     */
    case 'confetti': {
      const p = mk('trail-dash', x + (Math.random() - 0.5) * 18, y)
      p.style.width = px(5 + Math.random() * 4) + 'px'
      p.style.height = px(8 + Math.random() * 5) + 'px'
      p.style.background = Math.random() < 0.5 ? a : b
      const spin = (Math.random() - 0.5) * 720
      emit(
        p,
        [
          { transform: 'translate(-50%, -50%) translate(0, 0) rotate(0deg)', opacity: 0.95 },
          {
            transform: `translate(-50%, -50%) translate(${(Math.random() - 0.5) * 30}px, ${px(34 + Math.random() * 24)}px) rotate(${spin}deg)`,
            opacity: 0,
          },
        ],
        {
          duration: dur(1000 + Math.random() * 500),
          easing: 'cubic-bezier(0.4,0.1,0.7,1)',
          fill: 'forwards',
        },
      )
      break
    }
    case 'thread': {
      const len = Math.hypot(dx, dy)
      if (len < 1) break
      const p = mk('trail-thread', x - dx / 2, y - dy / 2)
      p.style.width = len + 'px'
      p.style.background = a
      emit(
        p,
        [
          { transform: `translate(-50%, -50%) rotate(${angle}deg) scaleY(1)`, opacity: 0.7 },
          { transform: `translate(-50%, -50%) rotate(${angle}deg) scaleY(0.2)`, opacity: 0 },
        ],
        { duration: dur(480), easing: 'ease-out', fill: 'forwards' },
      )
      break
    }
  }
}

function onMove(e: PointerEvent) {
  if (style === 'none') return
  // ⚠️ asked per move, not at install: the switch has to take effect without a reload
  if (motionReduced()) return
  if (!started) {
    lastX = e.clientX
    lastY = e.clientY
    started = true
    return
  }
  const dx = e.clientX - lastX
  const dy = e.clientY - lastY
  const dist = Math.hypot(dx, dy)
  if (dist < spacingFor(SPACING[style])) return
  lastX = e.clientX
  lastY = e.clientY
  drop(style, e.clientX, e.clientY, dx, dy)
}

export function setTrailStyle(next: TrailStyle) {
  style = next
  started = false
}

/** Play one particle where asked, so a picker can show what a style does. */
export function previewTrail(s: TrailStyle, x: number, y: number) {
  if (s === 'none' || motionReduced()) return
  for (let i = 0; i < 6; i++) {
    drop(s, x + i * 9 - 22, y, 9, 0)
  }
}

export function installMouseTrail(): () => void {
  if (installed) return () => {}
  if (typeof Element.prototype.animate !== 'function') return () => {}
  // no hovering cursor on a phone: a touch trail is a smear under your own thumb. The picker
  // says so out loud now — same query, one definition, so the two cannot disagree.
  if (touchOnly()) return () => {}
  installed = true
  window.addEventListener('pointermove', onMove, { passive: true })
  return () => {
    installed = false
    window.removeEventListener('pointermove', onMove)
  }
}
