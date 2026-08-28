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

function palette(): string[] {
  const s = getComputedStyle(document.documentElement)
  const get = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback
  const a = get('--accent', '#22c55e')
  const b = get('--accent-2', a)
  return [a, b]
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
}

function drop(s: Exclude<TrailStyle, 'none'>, x: number, y: number, dx: number, dy: number) {
  const [a, b] = palette()
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
  // no hovering cursor on a phone: a touch trail is a smear under your own thumb
  if (window.matchMedia?.('(hover: none) and (pointer: coarse)').matches) return () => {}
  installed = true
  window.addEventListener('pointermove', onMove, { passive: true })
  return () => {
    installed = false
    window.removeEventListener('pointermove', onMove)
  }
}
