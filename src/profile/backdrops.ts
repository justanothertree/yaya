/**
 * Animated profile backdrops.
 *
 * One canvas, one requestAnimationFrame loop, no DOM per particle. Everything below is a plain
 * simulation stepped by a delta and drawn with 2D primitives — no library, and nothing retained
 * between frames except the particle arrays themselves.
 *
 * ⚠️ THE BUDGET IS THE FEATURE. A backdrop that makes someone's laptop fan spin is worse than no
 * backdrop, and a phone is not a small desktop. The rules every effect here holds to:
 *
 *   - particle count scales with AREA and is capped hard, lower on coarse pointers
 *   - devicePixelRatio is capped at 2; past that you are painting four times the pixels for a
 *     difference nobody can see on a backdrop that is deliberately soft
 *   - the loop does not run when the tab is hidden or the canvas is scrolled out of view
 *   - pointer interaction is desktop-only, because there is no hovering cursor on a phone —
 *     that is a fact about the device rather than a feature being withheld
 *   - under reduced motion the canvas is never created at all, not merely paused
 *
 * Colours come from the live palette, so a backdrop belongs to whoever's theme it is drawn in
 * rather than being a fixed picture pasted behind them.
 */

import { amount, effectScale } from '../ui/effectAmount'

export type BackdropId = 'none' | 'glow' | 'waves' | 'bubbles' | 'flames' | 'leaves'

export const BACKDROPS: Array<[BackdropId, string, string]> = [
  ['none', '∅', 'None'],
  /**
   * The ambient glow, which predates the rest and used to be its own on/off switch.
   *
   * ⚠️ It belongs in this list, not beside it. It is a background effect — the same slot, the
   * same question — and having one of them be a toggle while the others were a picker meant
   * "background" had two controls that could disagree: glow on AND waves on was reachable, and
   * meant two animated layers nobody asked for. One list, one answer, and None is in it.
   */
  ['glow', '🌫', 'Glow'],
  ['waves', '🌊', 'Waves'],
  ['bubbles', '🫧', 'Bubbles'],
  ['flames', '🔥', 'Flames'],
  ['leaves', '🍃', 'Leaves'],
]

export const BACKDROP_IDS = BACKDROPS.map(([id]) => id)

export function isBackdropId(v: unknown): v is BackdropId {
  return typeof v === 'string' && (BACKDROP_IDS as string[]).includes(v)
}

export type Paint = {
  /** their accent, their second accent, and their text colour, as rgb triples */
  accent: [number, number, number]
  accent2: [number, number, number]
  ink: [number, number, number]
}

type Ctx = {
  ctx: CanvasRenderingContext2D
  w: number
  h: number
  /** seconds since the effect started */
  t: number
  /** seconds since the previous frame, clamped so a backgrounded tab cannot teleport anything */
  dt: number
  paint: Paint
  /** pointer in canvas coordinates, or null on a device without one */
  px: number | null
  py: number | null
}

export type Effect = {
  /** (re)build whatever the effect keeps, for a canvas of this size */
  init(w: number, h: number, coarse: boolean): void
  step(c: Ctx): void
}

const rgba = ([r, g, b]: [number, number, number], a: number) => `rgba(${r},${g},${b},${a})`

/**
 * Size and speed, read per frame rather than captured at init.
 *
 * ⚠️ Per frame on purpose. A backdrop runs continuously, so a slider moved while it is on screen
 * has to change what you are already watching — capturing the value in init() would mean the
 * dial only took effect when the canvas happened to be rebuilt, which is a resize or a mode
 * change. Reading two numbers a frame costs nothing next to the drawing.
 */
const sizeScale = () => effectScale('size')
const speedScale = () => effectScale('speed')

/**
 * How many particles a canvas of this size gets.
 *
 * Per 100k px² rather than a flat number: the same count that looks sparse on a desktop page is a
 * swarm in a 400px canvas window, and the cost of a particle is the same either way.
 */
function count(w: number, h: number, per100k: number, cap: number, coarse: boolean) {
  // ⚠️ the dial multiplies the DESIRED count, before the floor — applied after, a subtle setting
  // on a phone would land under the floor and quietly become an off switch
  const n = amount('background', ((w * h) / 100000) * per100k)
  /**
   * ⚠️ AND THE CAP MOVES WITH IT, or the dial does nothing where it matters most. On a
   * 1200x800 page the area-based count already sits at the cap, so "Lots" was clamped straight
   * back to "Normal" — measured at 15,480 draws against 16,200, a difference nobody could see.
   * The cap is still a cap: doubled at most, and the coarse-pointer ceiling still applies.
   */
  const dialled = Math.min(cap * 2, amount('background', cap))
  return Math.max(6, Math.min(coarse ? Math.round(dialled * 0.45) : dialled, n))
}

/**
 * Waves — bands of water seen from above, rolling up the canvas.
 *
 * Drawn as a handful of sine curves rather than particles: a wave is a continuous thing, and
 * approximating one with hundreds of dots costs more and looks like sand. Each band is a filled
 * path, so the whole effect is a few dozen lineTo calls per frame regardless of canvas size.
 */
function waves(): Effect {
  let bands: Array<{ y: number; amp: number; len: number; speed: number; alpha: number }> = []
  return {
    init(w, h) {
      const n = amount('background', w < 520 ? 4 : 6)
      bands = Array.from({ length: n }, (_, i) => ({
        y: h * (0.35 + (i / n) * 0.75),
        amp: 6 + i * 3,
        len: 220 + i * 90,
        speed: 14 + i * 7,
        alpha: 0.05 + i * 0.022,
      }))
    },
    step({ ctx, w, h, t, paint, px }) {
      // the pointer leans the whole set, so moving across the page pushes the water
      const lean = px == null ? 0 : (px / w - 0.5) * 26
      for (const b of bands) {
        ctx.beginPath()
        ctx.moveTo(0, h)
        for (let x = 0; x <= w; x += 12) {
          const y =
            b.y -
            t * b.speed * 0.35 * speedScale() +
            Math.sin((x + t * b.speed * 6 * speedScale()) / b.len) * b.amp * sizeScale() +
            lean * 0.4
          ctx.lineTo(x, ((y % (h + 120)) + h + 120) % (h + 120))
        }
        ctx.lineTo(w, h)
        ctx.closePath()
        ctx.fillStyle = rgba(paint.accent, b.alpha)
        ctx.fill()
      }
    },
  }
}

/** Bubbles — drifting up, wobbling, popping at the top. The pointer pushes them aside. */
function bubbles(): Effect {
  let ps: Array<{ x: number; y: number; r: number; v: number; phase: number }> = []
  let W = 0
  let H = 0
  return {
    init(w, h, coarse) {
      W = w
      H = h
      ps = Array.from({ length: count(w, h, 9, 90, coarse) }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 2 + Math.random() * 7,
        v: 8 + Math.random() * 22,
        phase: Math.random() * Math.PI * 2,
      }))
    },
    step({ ctx, w, h, t, dt, paint, px, py }) {
      for (const p of ps) {
        p.y -= p.v * dt * speedScale()
        const wobble = Math.sin(t * 1.6 + p.phase) * 8
        let x = p.x + wobble
        if (p.y < -p.r) {
          p.y = h + p.r
          p.x = Math.random() * w
        }
        if (px != null && py != null) {
          const dx = x - px
          const dy = p.y - py
          const d2 = dx * dx + dy * dy
          if (d2 < 90 * 90 && d2 > 1) {
            const push = (1 - Math.sqrt(d2) / 90) * 14
            x += (dx / Math.sqrt(d2)) * push
          }
        }
        ctx.beginPath()
        ctx.arc(x, p.y, p.r * sizeScale(), 0, Math.PI * 2)
        ctx.strokeStyle = rgba(paint.accent, 0.28)
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.fillStyle = rgba(paint.accent, 0.07)
        ctx.fill()
      }
      void W
      void H
    },
  }
}

/**
 * Flames — embers rising from the bottom edge, cooling as they climb.
 *
 * The colour shifts from accent to accent-2 over each ember's life rather than being fixed, which
 * is what reads as heat: a flame that is one colour all the way up is a stream of dots.
 */
function flames(): Effect {
  let ps: Array<{ x: number; y: number; v: number; r: number; life: number; max: number }> = []
  const spawn = (p: (typeof ps)[number], w: number, h: number) => {
    p.x = Math.random() * w
    p.y = h + Math.random() * 20
    p.v = 26 + Math.random() * 46
    p.r = 2 + Math.random() * 6
    p.max = 1.6 + Math.random() * 1.8
    p.life = 0
  }
  return {
    init(w, h, coarse) {
      ps = Array.from({ length: count(w, h, 11, 110, coarse) }, () => {
        const p = { x: 0, y: 0, v: 0, r: 0, life: 0, max: 1 }
        spawn(p, w, h)
        p.life = Math.random() * p.max
        return p
      })
    },
    step({ ctx, w, h, t, dt, paint, px }) {
      const draft = px == null ? 0 : (px / w - 0.5) * 30
      for (const p of ps) {
        p.life += dt * speedScale()
        if (p.life > p.max) spawn(p, w, h)
        p.y -= p.v * dt * speedScale()
        const k = p.life / p.max
        const x = p.x + Math.sin(t * 2.2 + p.y * 0.02) * 6 + draft * k
        const col: [number, number, number] = [
          Math.round(paint.accent[0] + (paint.accent2[0] - paint.accent[0]) * k),
          Math.round(paint.accent[1] + (paint.accent2[1] - paint.accent[1]) * k),
          Math.round(paint.accent[2] + (paint.accent2[2] - paint.accent[2]) * k),
        ]
        ctx.beginPath()
        ctx.arc(x, p.y, p.r * (1 - k * 0.6) * sizeScale(), 0, Math.PI * 2)
        ctx.fillStyle = rgba(col, 0.32 * (1 - k))
        ctx.fill()
      }
    },
  }
}

/** Leaves — falling, spinning, drifting sideways. The pointer stirs them as it passes. */
function leaves(): Effect {
  let ps: Array<{ x: number; y: number; v: number; r: number; spin: number; a: number }> = []
  return {
    init(w, h, coarse) {
      ps = Array.from({ length: count(w, h, 7, 70, coarse) }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        v: 14 + Math.random() * 26,
        r: 4 + Math.random() * 6,
        spin: (Math.random() - 0.5) * 2.4,
        a: Math.random() * Math.PI * 2,
      }))
    },
    step({ ctx, w, h, t, dt, paint, px, py }) {
      for (const p of ps) {
        p.y += p.v * dt * speedScale()
        p.a += p.spin * dt * speedScale()
        let x = p.x + Math.sin(t * 0.9 + p.y * 0.015) * 18
        if (p.y > h + p.r) {
          p.y = -p.r
          p.x = Math.random() * w
        }
        if (px != null && py != null) {
          const dx = x - px
          const dy = p.y - py
          const d2 = dx * dx + dy * dy
          if (d2 < 100 * 100 && d2 > 1) {
            const d = Math.sqrt(d2)
            x += (dx / d) * (1 - d / 100) * 20
            p.a += (1 - d / 100) * dt * 4
          }
        }
        ctx.save()
        ctx.translate(x, p.y)
        ctx.rotate(p.a)
        ctx.beginPath()
        // a leaf is two arcs meeting at a point — cheaper than a path and reads at 8px
        ctx.ellipse(0, 0, p.r * sizeScale(), p.r * 0.45 * sizeScale(), 0, 0, Math.PI * 2)
        ctx.fillStyle = rgba(p.r > 7 ? paint.accent2 : paint.accent, 0.3)
        ctx.fill()
        ctx.restore()
      }
    },
  }
}

/**
 * Which backdrop is on screen right now, allowing for a profile temporarily taking it over.
 *
 * Same shape as the click flair's scope override, and for the same reason: viewing someone's
 * page in their look should show THEIR background, and the alternative — running a second canvas
 * scoped to the profile while yours keeps going behind it — is two simulations painting at once
 * for one visible result. The override swaps what the single site-wide layer draws, and clears
 * when you leave.
 */
let override: BackdropId | null = null
const OVERRIDE_EVENT = 'yaya:backdrop'

export function setBackdropOverride(id: BackdropId | null) {
  if (override === id) return
  override = id
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(OVERRIDE_EVENT))
}

export function backdropOverride(): BackdropId | null {
  return override
}

export function onBackdropOverrideChange(fn: () => void): () => void {
  window.addEventListener(OVERRIDE_EVENT, fn)
  return () => window.removeEventListener(OVERRIDE_EVENT, fn)
}

export function makeEffect(id: BackdropId): Effect | null {
  switch (id) {
    case 'waves':
      return waves()
    case 'bubbles':
      return bubbles()
    case 'flames':
      return flames()
    case 'leaves':
      return leaves()
    default:
      return null
  }
}
