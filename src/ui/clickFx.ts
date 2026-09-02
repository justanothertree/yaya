/**
 * Click flair — a small effect where you click, in one of several styles.
 *
 * Built on the Web Animations API rather than CSS keyframes: each burst wants its own random
 * angle, distance, rotation and duration per particle, and doing that in CSS means either
 * writing every particle's end position into an inline style anyway or shipping a stylesheet of
 * near-identical keyframes for numbers that were only ever going to be randomised at runtime.
 * `element.animate()` takes the numbers directly and hands back a `finished` promise, which is
 * also how the nodes get cleaned up without a timer to keep in sync with the animation.
 *
 * Everything is drawn in a single fixed, `pointer-events: none` layer, so nothing here can ever
 * eat a click or shift the page — the effect is structurally incapable of interfering with the
 * thing you clicked, no matter which style is picked.
 *
 * Seventeen styles, deliberately differentiated by SHAPE and MOTION rather than just palette —
 * radiating dots (sparks), expanding rings (sonar), falling paper (pop), a two-stage launch+burst
 * (rocket), twinkling glyphs (stars, glitter), upward drift (hearts, bubbles), an implosion isn't
 * here but an orbit is, straight rays (beam), angular shards (shatter), soft splats (ink). A style
 * that only changed color on top of the same dots-flying-outward motion as another one was cut or
 * reworked — that's what made the original ripple/confetti/fireworks trio feel thin next to
 * sparks, and it's also why pixels/zap didn't survive their own tryout.
 *
 * `splash` leads with concentric rings rather than droplets, because droplets on arcs are `pop`
 * however they are coloured. `slash` is the only one that takes a DIRECTION — it aims along the
 * way the pointer was actually travelling, which is the difference between a swing and a decal.
 *
 * ⚠️ `glass` was cut rather than fixed twice. Radial lines from a point is what `beam` already
 * is, and the web of chords that would have made it read as broken glass never stopped looking
 * like a diagram of one. A style that needs explaining before it lands has failed the bar in the
 * paragraph above; the honest move was to drop it and spend the slot on something that works.
 *
 * `implode` fills the gap this header has named all along. `bloom` opens by rotating and scaling
 * rather than travelling, which nothing else here does. `dust` is the only slow, soft-edged one —
 * the single style you could leave on all day without noticing it.
 */

import { motionReduced } from './motion'
import { amount, scalesFor } from './effectAmount'

// bound once, read live: every px()/dur() below is now on the CLICK dial specifically, rather
// than a single pair of sliders shared with trails and backgrounds
const { dur, px } = scalesFor('click')

export type FxStyle =
  | 'sparks'
  | 'sonar'
  | 'pop'
  | 'rocket'
  | 'stars'
  | 'hearts'
  | 'bubbles'
  | 'glitter'
  | 'shatter'
  | 'ink'
  | 'orbit'
  | 'beam'
  | 'splash'
  | 'slash'
  | 'implode'
  | 'bloom'
  | 'dust'
  | 'notes'
  | 'snow'
  | 'vortex'
  | 'firework'
  | 'coin'
  | 'lightning'
  | 'leaves'
  | 'pixels'

const LAYER_ID = 'click-fx-layer'
/** Concurrent bursts to allow. A fast clicker shouldn't be able to pile up hundreds of nodes. */
const MAX_BURSTS = 6

/**
 * The direction the pointer was travelling, for `slash`.
 *
 * A cut has to go SOMEWHERE, and a fixed diagonal reads as a decal stamped on the page rather
 * than a swing. Two numbers updated on pointermove is enough to aim it along the way your hand
 * was actually moving; a click with no prior movement (a tap, a keyboard-driven click) falls
 * back to a random angle so it never looks stuck.
 */
let lastMoveX = 0
let lastMoveY = 0
let swingAngle: number | null = null

let installed = false
let enabled = true
let style: FxStyle = 'sparks'
let live = 0

function layer(): HTMLElement {
  let el = document.getElementById(LAYER_ID)
  if (!el) {
    el = document.createElement('div')
    el.id = LAYER_ID
    el.setAttribute('aria-hidden', 'true')
    document.body.appendChild(el)
  }
  return el
}

/**
 * Read colours straight off the document so every style follows the active palette — including
 * a custom one — without this module knowing anything about themes.
 *
 * ⚠️ THE FLAIR RAMP, not the accent pair. This used to return accent, accent-2, --warn and
 * --danger: two real palette colours plus two STATUS colours borrowed because nothing else was
 * available. That is why the flairs all looked related — seventeen styles drawing the same two
 * hues, with a warning yellow and an error red thrown in, which belong to a different language
 * entirely. The ramp is five colours designed to sit together (see customTheme.ts), so the
 * styles differ by colour as well as by shape.
 *
 * Falls back to the accent pair on a theme that predates the ramp, so nothing renders blank.
 */
function palette(): string[] {
  const s = getComputedStyle(document.documentElement)
  const get = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback
  const a = get('--accent', '#22c55e')
  const b = get('--accent-2', a)
  const ramp = [0, 1, 2, 3, 4].map((i) => s.getPropertyValue(`--fx-${i}`).trim()).filter(Boolean)
  return ramp.length >= 2 ? ramp : [a, b, get('--warn', a), get('--danger', b)]
}

/**
 * The classic CONTRASTING pair, for the styles built around exactly two colours.
 *
 * ⚠️ Not palette()[0] and palette()[1]. The ramp is ordered by hue so that anything walking
 * it gets a gradient — which means its first two entries are neighbours, nearly the same colour.
 * A beam whose core and glow were two shades of the same green would read as a bug, and taking
 * the two ends instead keeps these styles looking exactly as they did before the ramp existed.
 *
 * So the two kinds of style get what each needs from one ramp: spread for the many-coloured
 * ones, opposition for the two-coloured ones.
 */
function pair(): [string, string] {
  const p = palette()
  return [p[1] ?? p[0], p[p.length - 1]]
}

/**
 * Track a set of animations and remove their nodes once every one finishes. Shared by every
 * style below rather than each reimplementing the same cleanup.
 */
function track(host: HTMLElement, nodes: HTMLElement[], anims: Animation[]) {
  live++
  for (const n of nodes) host.appendChild(n)
  Promise.allSettled(anims.map((an) => an.finished)).then(() => {
    for (const n of nodes) n.remove()
    live--
  })
}

function mk(cls: string, x: number, y: number) {
  const el = document.createElement('i')
  el.className = cls
  el.style.left = x + 'px'
  el.style.top = y + 'px'
  return el
}

/** A dot-shaped particle rendered as a text glyph instead — same positioning, a character
 * instead of a coloured box, for styles where the SHAPE itself (star, heart, bolt) is the point. */
function mkGlyph(char: string, x: number, y: number, size: number, color?: string) {
  const el = mk('click-fx-glyph', x, y)
  el.textContent = char
  el.style.fontSize = size + 'px'
  if (color) el.style.color = color
  return el
}

/** The original: a ring plus 8 radiating dots. Reads as a clean, energetic "that registered". */
function sparks(host: HTMLElement, x: number, y: number) {
  const [a, b] = pair()
  const N = amount('click', 8)
  const nodes: HTMLElement[] = []
  const anims: Animation[] = []

  const ring = mk('click-fx-ring', x, y)
  ring.style.borderColor = a
  nodes.push(ring)
  anims.push(
    ring.animate(
      [
        { transform: 'translate(-50%, -50%) scale(0.2)', opacity: 0.9 },
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 0 },
      ],
      // fill: 'forwards' matters everywhere in this file: without it an element snaps back to
      // its base style the moment its OWN animation ends, and sits there fully visible until
      // every other animation in the burst finishes and the nodes are removed together.
      { duration: dur(420), easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)', fill: 'forwards' },
    ),
  )

  for (let i = 0; i < N; i++) {
    // spread evenly, then jitter — evenly-spaced alone looks mechanical, fully random clumps
    const angle = (i / N) * Math.PI * 2 + (Math.random() - 0.5) * 0.6
    const dist = px(18 + Math.random() * 26)
    const p = mk('click-fx-spark', x, y)
    p.style.background = i % 3 === 0 ? b : a
    nodes.push(p)
    anims.push(
      p.animate(
        [
          { transform: 'translate(-50%, -50%) translate(0, 0) scale(1)', opacity: 1 },
          {
            transform: `translate(-50%, -50%) translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px) scale(0.2)`,
            opacity: 0,
          },
        ],
        {
          duration: dur(380 + Math.random() * 260),
          easing: 'cubic-bezier(0.15, 0.7, 0.2, 1)',
          fill: 'forwards',
        },
      ),
    )
  }
  track(host, nodes, anims)
}

/** Ripple's replacement: three rings pinging outward in sequence, like sonar, instead of one
 * plain ring — the staggered layering is what makes it read as more than "a flash" while
 * staying the calm, quiet option in the set. */
function sonar(host: HTMLElement, x: number, y: number) {
  const [a] = pair()
  const nodes: HTMLElement[] = []
  const anims: Animation[] = []
  for (let i = 0; i < 3; i++) {
    const ring = mk('click-fx-sonar', x, y)
    ring.style.borderColor = a
    nodes.push(ring)
    anims.push(
      ring.animate(
        [
          { transform: 'translate(-50%, -50%) scale(0.1)', opacity: 0.55 },
          { transform: 'translate(-50%, -50%) scale(1)', opacity: 0 },
        ],
        // fill: 'both' (not just 'forwards') so the ring holds its FIRST keyframe during its own
        // delay too — without it, a delayed animation shows the element's un-animated base state
        // until its delay elapses, which here would be a flash at full size before shrinking back
        // to start.
        { duration: dur(620), delay: i * 140, easing: 'ease-out', fill: 'both' },
      ),
    )
  }
  track(host, nodes, anims)
}

/** Confetti's replacement: faster, brighter, and biased upward before gravity takes it — actual
 * flutter comes from the spin reversing direction partway through the fall instead of one clean
 * spin the whole way, which is what paper falling actually looks like. */
function pop(host: HTMLElement, x: number, y: number) {
  const colors = [...palette(), '#fff']
  const N = amount('click', 14)
  const nodes: HTMLElement[] = []
  const anims: Animation[] = []
  for (let i = 0; i < N; i++) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4
    const dist = px(26 + Math.random() * 40)
    const dx = Math.cos(angle) * dist
    const dy = Math.sin(angle) * dist
    const spin = 220 + Math.random() * 260
    const p = mk('click-fx-pop', x, y)
    p.style.background = colors[i % colors.length]
    nodes.push(p)
    anims.push(
      p.animate(
        [
          { transform: 'translate(-50%, -50%) translate(0, 0) rotate(0deg)', opacity: 1 },
          {
            transform: `translate(-50%, -50%) translate(${dx * 0.55}px, ${dy * 0.4 - 10}px) rotate(${spin}deg)`,
            opacity: 1,
            offset: 0.4,
          },
          {
            transform: `translate(-50%, -50%) translate(${dx}px, ${dy + 46}px) rotate(${spin - 160}deg)`,
            opacity: 0,
          },
        ],
        {
          duration: dur(520 + Math.random() * 220),
          easing: 'cubic-bezier(0.15, 0.7, 0.3, 1)',
          fill: 'forwards',
        },
      ),
    )
  }
  track(host, nodes, anims)
}

/** Fireworks' replacement: an actual two-stage rocket — a dot climbs from the click point, THEN
 * bursts at its peak. The old version was just a busier version of sparks at the same spot,
 * which is exactly why it read as "too similar"; this one moves before it explodes. */
function rocket(host: HTMLElement, x: number, y: number) {
  const [a] = pair()
  const rise = 70 + Math.random() * 30
  const dot = mk('click-fx-spark', x, y)
  dot.style.background = a
  dot.style.width = '5px'
  dot.style.height = '5px'
  const climb = dot.animate(
    [
      { transform: 'translate(-50%, -50%) translate(0, 0)', opacity: 1 },
      {
        transform: `translate(-50%, -50%) translate(${(Math.random() - 0.5) * 20}px, ${-rise}px)`,
        opacity: 1,
      },
    ],
    { duration: dur(260), easing: 'cubic-bezier(0.3, 0, 0.6, 1)', fill: 'forwards' },
  )
  track(host, [dot], [climb])

  // The burst is a SEPARATE track() call, kicked off once the climb's own finished promise
  // resolves — .catch() swallows the case where the climb gets cancelled instead (a reduced-
  // motion toggle or unmount mid-flight), so that never surfaces as an unhandled rejection.
  climb.finished
    .then(() => {
      const peakY = y - rise
      const colors = palette()
      const N = amount('click', 14)
      const nodes: HTMLElement[] = []
      const anims: Animation[] = []
      for (let i = 0; i < N; i++) {
        const angle = (i / N) * Math.PI * 2 + (Math.random() - 0.5) * 0.3
        const dist = px(26 + Math.random() * 40)
        const p = mk('click-fx-spark', x, peakY)
        p.style.background = colors[i % colors.length]
        nodes.push(p)
        anims.push(
          p.animate(
            [
              { transform: 'translate(-50%, -50%) translate(0, 0) scale(1)', opacity: 1 },
              {
                transform: `translate(-50%, -50%) translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist + 14}px) scale(0.15)`,
                opacity: 0,
              },
            ],
            {
              duration: dur(420 + Math.random() * 260),
              easing: 'cubic-bezier(0.1, 0.6, 0.15, 1)',
              fill: 'forwards',
            },
          ),
        )
      }
      track(host, nodes, anims)
    })
    .catch(() => {})
}

/** Stars radiate out AND twinkle (a scale pulse mid-flight, not just shrinking) — the twinkle is
 * what reads as "star" rather than "dot with a star drawn on it". */
function stars(host: HTMLElement, x: number, y: number) {
  const colors = palette()
  const N = amount('click', 7)
  const nodes: HTMLElement[] = []
  const anims: Animation[] = []
  for (let i = 0; i < N; i++) {
    const angle = (i / N) * Math.PI * 2 + (Math.random() - 0.5) * 0.5
    const dist = px(24 + Math.random() * 36)
    const p = mkGlyph('★', x, y, 12 + Math.random() * 6, colors[i % colors.length])
    nodes.push(p)
    anims.push(
      p.animate(
        [
          {
            transform: 'translate(-50%, -50%) translate(0, 0) scale(0.4) rotate(0deg)',
            opacity: 1,
          },
          {
            transform: `translate(-50%, -50%) translate(${Math.cos(angle) * dist * 0.6}px, ${Math.sin(angle) * dist * 0.6}px) scale(1.15) rotate(60deg)`,
            opacity: 1,
            offset: 0.5,
          },
          {
            transform: `translate(-50%, -50%) translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px) scale(0.3) rotate(120deg)`,
            opacity: 0,
          },
        ],
        { duration: dur(520 + Math.random() * 280), easing: 'ease-out', fill: 'forwards' },
      ),
    )
  }
  track(host, nodes, anims)
}

/** Hearts drift straight UP with a gentle side-to-side sway, unlike everything else here which
 * flies outward from the click — the upward-only motion is what makes it read as "released"
 * rather than "exploded". Fixed red rather than the theme palette: a heart reads as itself only
 * in that color family. */
function hearts(host: HTMLElement, x: number, y: number) {
  const N = amount('click', 6)
  const nodes: HTMLElement[] = []
  const anims: Animation[] = []
  for (let i = 0; i < N; i++) {
    const rise = 50 + Math.random() * 40
    const sway = (Math.random() - 0.5) * 30
    const p = mkGlyph('❤', x + (Math.random() - 0.5) * 16, y, 13 + Math.random() * 5)
    p.style.color = i % 2 ? '#f43f5e' : '#fb7185'
    nodes.push(p)
    anims.push(
      p.animate(
        [
          { transform: 'translate(-50%, -50%) translate(0, 0) scale(0.6)', opacity: 1 },
          {
            transform: `translate(-50%, -50%) translate(${sway}px, ${-rise * 0.6}px) scale(1)`,
            opacity: 1,
            offset: 0.5,
          },
          {
            transform: `translate(-50%, -50%) translate(${sway * 1.6}px, ${-rise}px) scale(0.8)`,
            opacity: 0,
          },
        ],
        { duration: dur(620 + Math.random() * 260), easing: 'ease-out', fill: 'forwards' },
      ),
    )
  }
  track(host, nodes, anims)
}

/** Translucent circles drift upward with a wobble and POP (a quick scale-up right before they
 * vanish, not a plain fade) — the pop at the top is what sells "bubble" over "dot that floats". */
function bubbles(host: HTMLElement, x: number, y: number) {
  const [a, b] = pair()
  const N = amount('click', 8)
  const nodes: HTMLElement[] = []
  const anims: Animation[] = []
  for (let i = 0; i < N; i++) {
    const rise = 60 + Math.random() * 60
    const sway = (Math.random() - 0.5) * 40
    const size = px(6 + Math.random() * 10)
    const p = mk('click-fx-bubble', x + (Math.random() - 0.5) * 18, y)
    p.style.width = size + 'px'
    p.style.height = size + 'px'
    p.style.color = i % 2 ? a : b
    nodes.push(p)
    anims.push(
      p.animate(
        [
          { transform: 'translate(-50%, -50%) translate(0, 0) scale(0.5)', opacity: 0.8 },
          {
            transform: `translate(-50%, -50%) translate(${sway}px, ${-rise}px) scale(1)`,
            opacity: 0.7,
            offset: 0.75,
          },
          {
            transform: `translate(-50%, -50%) translate(${sway * 1.1}px, ${-rise - 10}px) scale(1.6)`,
            opacity: 0,
          },
        ],
        { duration: dur(680 + Math.random() * 260), easing: 'ease-out', fill: 'forwards' },
      ),
    )
  }
  track(host, nodes, anims)
}

/** Tiny points of light that barely move and blink in and out at slightly different times — this
 * is the genuinely subtle option now. Sonar still travels outward in rings; this mostly just
 * twinkles in place near the click. */
function glitter(host: HTMLElement, x: number, y: number) {
  const colors = palette()
  const N = amount('click', 9)
  const nodes: HTMLElement[] = []
  const anims: Animation[] = []
  for (let i = 0; i < N; i++) {
    const dist = px(6 + Math.random() * 22)
    const angle = Math.random() * Math.PI * 2
    // gx/gy, not px/py: `px` is the size scale imported at the top of this file
    const gx = x + Math.cos(angle) * dist
    const gy = y + Math.sin(angle) * dist
    const p = mkGlyph('✦', gx, gy, 8 + Math.random() * 6, colors[i % colors.length])
    nodes.push(p)
    anims.push(
      p.animate(
        [
          { transform: 'translate(-50%, -50%) scale(0)', opacity: 0 },
          { transform: 'translate(-50%, -50%) scale(1.2)', opacity: 1, offset: 0.4 },
          { transform: 'translate(-50%, -50%) scale(0)', opacity: 0 },
        ],
        {
          duration: dur(420 + Math.random() * 200),
          delay: Math.random() * 180,
          easing: 'ease-in-out',
          fill: 'both',
        },
      ),
    )
  }
  track(host, nodes, anims)
}

/** Angular shards instead of round dots or soft rectangles, flying fast and stopping short with
 * no lingering drift — the only style built to look like something broke rather than dissolved. */
function shatter(host: HTMLElement, x: number, y: number) {
  const colors = palette()
  const N = amount('click', 10)
  const nodes: HTMLElement[] = []
  const anims: Animation[] = []
  for (let i = 0; i < N; i++) {
    const angle = (i / N) * Math.PI * 2 + (Math.random() - 0.5) * 0.4
    const dist = px(20 + Math.random() * 34)
    const spin = (Math.random() - 0.5) * 360
    const p = mk('click-fx-shard', x, y)
    p.style.background = colors[i % colors.length]
    nodes.push(p)
    anims.push(
      p.animate(
        [
          { transform: 'translate(-50%, -50%) translate(0, 0) rotate(0deg) scale(1)', opacity: 1 },
          {
            transform: `translate(-50%, -50%) translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px) rotate(${spin}deg) scale(0.4)`,
            opacity: 0,
          },
        ],
        {
          duration: dur(280 + Math.random() * 160),
          easing: 'cubic-bezier(0.1, 0.8, 0.2, 1)',
          fill: 'forwards',
        },
      ),
    )
  }
  track(host, nodes, anims)
}

/** A handful of overlapping filled, blurred blobs instead of dots or rings — reads as a splash
 * landing, not a burst radiating evenly. */
function ink(host: HTMLElement, x: number, y: number) {
  const [a, b] = pair()
  const N = amount('click', 5)
  const nodes: HTMLElement[] = []
  const anims: Animation[] = []
  for (let i = 0; i < N; i++) {
    const angle = Math.random() * Math.PI * 2
    const dist = Math.random() * 14
    const size = px(14 + Math.random() * 22)
    const p = mk('click-fx-ink', x + Math.cos(angle) * dist, y + Math.sin(angle) * dist)
    p.style.width = size + 'px'
    p.style.height = size + 'px'
    p.style.background = i % 2 ? a : b
    nodes.push(p)
    anims.push(
      p.animate(
        [
          { transform: 'translate(-50%, -50%) scale(0.1)', opacity: 0.5 },
          { transform: 'translate(-50%, -50%) scale(1)', opacity: 0 },
        ],
        { duration: dur(500 + Math.random() * 220), easing: 'ease-out', fill: 'forwards' },
      ),
    )
  }
  track(host, nodes, anims)
}

/** Dots sweep around the click point on a circular path instead of flying away from it — the
 * only style here where the motion is rotation around a fixed radius rather than radiating
 * outward or drifting in one direction. Built from an explicit keyframe list because a curved
 * path isn't expressible as a start/end pair of transforms. */
function orbit(host: HTMLElement, x: number, y: number) {
  const colors = palette()
  const N = amount('click', 5)
  const nodes: HTMLElement[] = []
  const anims: Animation[] = []
  for (let i = 0; i < N; i++) {
    const r = 20 + i * 6
    const start = (i / N) * Math.PI * 2
    const dir = i % 2 ? -1 : 1
    const steps = 10
    const kf: Keyframe[] = []
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const ang = start + dir * t * Math.PI * 1.6
      kf.push({
        transform: `translate(-50%, -50%) translate(${Math.cos(ang) * r}px, ${Math.sin(ang) * r}px) scale(${1 - t * 0.7})`,
        opacity: 1 - t,
      })
    }
    const p = mk('click-fx-spark', x, y)
    p.style.background = colors[i % colors.length]
    nodes.push(p)
    anims.push(p.animate(kf, { duration: 560 + i * 40, easing: 'ease-out', fill: 'forwards' }))
  }
  track(host, nodes, anims)
}

/** Thin rays instead of dots — a sunburst / camera-flash silhouette, the only style here built
 * from lines rather than points. Each ray's rotation is set directly on the element (not
 * animated) so `transform-origin: top center` keeps every ray pivoting on the exact click point
 * while `.animate()` only grows and shrinks its height. */
function beam(host: HTMLElement, x: number, y: number) {
  const [a, b] = pair()
  const N = amount('click', 8)
  const nodes: HTMLElement[] = []
  const anims: Animation[] = []
  for (let i = 0; i < N; i++) {
    const angle = (i / N) * 360 + (Math.random() - 0.5) * 8
    const len = px(26 + Math.random() * 26)
    const p = mk('click-fx-beam', x, y)
    p.style.background = i % 2 ? a : b
    p.style.transformOrigin = 'top center'
    p.style.transform = `translate(-50%, 0) rotate(${angle}deg)`
    nodes.push(p)
    anims.push(
      p.animate(
        [
          { height: '0px', opacity: 0.9 },
          { height: len + 'px', opacity: 0.5, offset: 0.5 },
          { height: '0px', opacity: 0 },
        ],
        { duration: dur(380 + Math.random() * 160), easing: 'ease-out', fill: 'forwards' },
      ),
    )
  }
  track(host, nodes, anims)
}

/**
 * Implode — everything rushes IN and vanishes into the point.
 *
 * The file header has named this gap all along: "an implosion isn't here but an orbit is". Every
 * other style pushes outward, so inward is the one motion the set genuinely lacked, and it reads
 * completely differently for it — an outward burst says "that happened", an inward one says
 * "that was taken".
 *
 * Eased IN rather than out, so the particles accelerate toward the centre. A linear version just
 * looks like sparks running backwards.
 */
function implode(host: HTMLElement, x: number, y: number) {
  const colors = palette()
  const N = amount('click', 12)
  const nodes: HTMLElement[] = []
  const anims: Animation[] = []
  for (let i = 0; i < N; i++) {
    const angle = (i / N) * Math.PI * 2 + (Math.random() - 0.5) * 0.5
    const dist = px(34 + Math.random() * 26)
    const p = mk('click-fx-spark', x, y)
    p.style.background = colors[i % colors.length]
    nodes.push(p)
    anims.push(
      p.animate(
        [
          {
            transform: `translate(-50%, -50%) translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px) scale(0.5)`,
            opacity: 0,
          },
          {
            transform: `translate(-50%, -50%) translate(${Math.cos(angle) * dist * 0.7}px, ${Math.sin(angle) * dist * 0.7}px) scale(1)`,
            opacity: 1,
            offset: 0.25,
          },
          { transform: 'translate(-50%, -50%) translate(0, 0) scale(0.2)', opacity: 0 },
        ],
        {
          duration: dur(380 + Math.random() * 120),
          easing: 'cubic-bezier(0.7, 0, 0.9, 0.3)',
          fill: 'forwards',
        },
      ),
    )
  }
  // a flash as they arrive, so the vanishing has a punctuation mark
  const flash = mk('click-fx-ring', x, y)
  flash.style.color = colors[0]
  nodes.push(flash)
  anims.push(
    flash.animate(
      [
        { transform: 'translate(-50%, -50%) scale(0.05)', opacity: 0 },
        { transform: 'translate(-50%, -50%) scale(0.05)', opacity: 0.9, offset: 0.72 },
        { transform: 'translate(-50%, -50%) scale(0.5)', opacity: 0 },
      ],
      { duration: dur(520), easing: 'ease-out', fill: 'forwards' },
    ),
  )
  track(host, nodes, anims)
}

/**
 * Bloom — petals opening out of the point.
 *
 * The motion is ROTATION and SCALE rather than travel: each petal grows from nothing while
 * turning, so the shape opens instead of flying apart. Nothing else in the set does that — every
 * other style moves particles from A to B — which is what keeps it from being sparks with rounder
 * dots.
 */
function bloom(host: HTMLElement, x: number, y: number) {
  const [a, b] = pair()
  const N = amount('click', 6)
  const nodes: HTMLElement[] = []
  const anims: Animation[] = []
  const turn = Math.random() * 360
  for (let i = 0; i < N; i++) {
    const deg = turn + (i / N) * 360
    const petal = mk('click-fx-petal', x, y)
    petal.style.background = i % 2 ? a : b
    nodes.push(petal)
    anims.push(
      petal.animate(
        [
          {
            transform: `translate(-50%, -50%) rotate(${deg}deg) translateY(0px) scale(0.2)`,
            opacity: 0.95,
          },
          {
            transform: `translate(-50%, -50%) rotate(${deg + 26}deg) translateY(-15px) scale(1)`,
            opacity: 0.75,
            offset: 0.55,
          },
          {
            transform: `translate(-50%, -50%) rotate(${deg + 40}deg) translateY(-22px) scale(0.9)`,
            opacity: 0,
          },
        ],
        {
          duration: dur(520 + Math.random() * 140),
          easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)',
          fill: 'forwards',
        },
      ),
    )
  }
  track(host, nodes, anims)
}

/**
 * Dust — a soft puff that spreads and lifts.
 *
 * Slow and diffuse where the rest of the set is quick and sharp: blurred, low opacity, drifting
 * UPWARD as it expands, so it behaves like something disturbed rather than something emitted. The
 * only style here you could leave on all day without noticing it.
 */
function dust(host: HTMLElement, x: number, y: number) {
  const [a, b] = pair()
  const N = amount('click', 7)
  const nodes: HTMLElement[] = []
  const anims: Animation[] = []
  for (let i = 0; i < N; i++) {
    const angle = Math.random() * Math.PI * 2
    const dist = px(10 + Math.random() * 26)
    const p = mk('click-fx-dust', x, y)
    p.style.background = i % 3 === 0 ? b : a
    const size = px(10 + Math.random() * 16)
    p.style.width = size + 'px'
    p.style.height = size + 'px'
    nodes.push(p)
    anims.push(
      p.animate(
        [
          { transform: 'translate(-50%, -50%) translate(0, 0) scale(0.3)', opacity: 0.5 },
          {
            transform: `translate(-50%, -50%) translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist - 18}px) scale(1.5)`,
            opacity: 0,
          },
        ],
        {
          duration: dur(900 + Math.random() * 300),
          easing: 'cubic-bezier(0.2, 0.6, 0.4, 1)',
          fill: 'forwards',
        },
      ),
    )
  }
  track(host, nodes, anims)
}

/**
 * Water — rings on a surface.
 *
 * ⚠️ The landing rings are gone. Each droplet used to leave a small ring where it came down,
 * and because they all came down at the same height that was a ROW of circles across the click —
 * a shape water never makes. The idea was right and the geometry was wrong. The rings that read
 * as water are the concentric ones at the impact, so there are more of those instead, staggered
 * and each nudged slightly off-centre so they overlap the way real ones do rather than sitting
 * like a target.
 *
 * Flattened on Y because you are looking at the surface at an angle; a true circle reads as sonar.
 */
function splash(host: HTMLElement, x: number, y: number) {
  const [a, b] = pair()
  const nodes: HTMLElement[] = []
  const anims: Animation[] = []

  for (let i = 0; i < 4; i++) {
    const ox = (Math.random() - 0.5) * 10
    const oy = (Math.random() - 0.5) * 5
    const ring = mk('click-fx-ripple', x + ox, y + oy)
    ring.style.color = i === 1 ? b : a
    nodes.push(ring)
    anims.push(
      ring.animate(
        [
          { transform: 'translate(-50%, -50%) scale(0.12) scaleY(0.42)', opacity: 0.85 },
          { transform: `translate(-50%, -50%) scale(${0.8 + i * 0.4}) scaleY(0.42)`, opacity: 0 },
        ],
        {
          duration: 620 + i * 150,
          delay: i * 110,
          easing: 'cubic-bezier(0.15, 0.75, 0.3, 1)',
          fill: 'forwards',
        },
      ),
    )
  }

  const N = amount('click', 5)
  for (let i = 0; i < N; i++) {
    const spread = (i / (N - 1) - 0.5) * 58 + (Math.random() - 0.5) * 10
    const rise = 18 + Math.random() * 20
    const d = mk('click-fx-drop', x, y)
    d.style.background = i % 2 ? b : a
    nodes.push(d)
    anims.push(
      d.animate(
        [
          { transform: 'translate(-50%, -50%) translate(0, 0) scale(0.7, 1.4)', opacity: 1 },
          {
            transform: `translate(-50%, -50%) translate(${spread * 0.55}px, ${-rise}px) scale(1.1, 0.9)`,
            opacity: 1,
            offset: 0.45,
          },
          {
            transform: `translate(-50%, -50%) translate(${spread}px, 2px) scale(0.5, 1.6)`,
            opacity: 0,
          },
        ],
        {
          duration: dur(520 + Math.random() * 160),
          easing: 'cubic-bezier(0.3, 0.1, 0.7, 1)',
          fill: 'forwards',
        },
      ),
    )
  }
  track(host, nodes, anims)
}

/**
 * A blade stroke, aimed along the way your hand was moving.
 *
 * ⚠️ The angle is the reason this works. A cut at a fixed diagonal reads as a decal stamped on
 * the page; following the pointer's own direction makes it a swing you performed. swingAngle is
 * whatever the last real pointer movement was, and a click with no movement behind it — a tap, a
 * keyboard click — gets a random angle rather than always the same one.
 *
 * Two strokes, not one: a bright fast slash, and a thinner gash that lingers a beat longer
 * underneath it. One line alone looks like a loading bar.
 */
function slash(host: HTMLElement, x: number, y: number) {
  const [a, b] = pair()
  const nodes: HTMLElement[] = []
  const anims: Animation[] = []
  const deg = ((swingAngle ?? Math.random() * Math.PI * 2) * 180) / Math.PI
  const len = px(64 + Math.random() * 26)

  for (const [i, colour] of [a, b].entries()) {
    const cut = mk(i === 0 ? 'click-fx-cut' : 'click-fx-gash', x, y)
    cut.style.width = len + 'px'
    cut.style.background = colour
    nodes.push(cut)
    anims.push(
      cut.animate(
        [
          { transform: `translate(-50%, -50%) rotate(${deg}deg) scaleX(0)`, opacity: 1 },
          {
            transform: `translate(-50%, -50%) rotate(${deg}deg) scaleX(1)`,
            opacity: 1,
            offset: 0.3,
          },
          { transform: `translate(-50%, -50%) rotate(${deg}deg) scaleX(1)`, opacity: 0 },
        ],
        {
          duration: i === 0 ? 300 : 520,
          easing: 'cubic-bezier(0.05, 0.9, 0.1, 1)',
          fill: 'forwards',
        },
      ),
    )
  }

  // a little spray off the edge of the stroke, thrown perpendicular to it
  for (let i = 0; i < 5; i++) {
    const off = (Math.random() - 0.5) * len * 0.8
    const perp = deg + 90 + (Math.random() - 0.5) * 40
    const dist = px(10 + Math.random() * 18)
    const rad = (perp * Math.PI) / 180
    const along = (deg * Math.PI) / 180
    // sx/sy, not px/py: `px` is the size scale imported at the top of this file
    const sx = x + Math.cos(along) * off
    const sy = y + Math.sin(along) * off
    const p = mk('click-fx-spark', sx, sy)
    p.style.background = b
    nodes.push(p)
    anims.push(
      p.animate(
        [
          { transform: 'translate(-50%, -50%) translate(0, 0) scale(1)', opacity: 1 },
          {
            transform: `translate(-50%, -50%) translate(${Math.cos(rad) * dist}px, ${Math.sin(rad) * dist}px) scale(0.3)`,
            opacity: 0,
          },
        ],
        { duration: dur(320 + Math.random() * 160), easing: 'ease-out', fill: 'forwards' },
      ),
    )
  }
  track(host, nodes, anims)
}

/**
 * Notes — a little phrase rising out of the click.
 *
 * The one style that belongs to this site in particular: there is a synthesiser, a looper and a
 * visualiser behind these buttons, and a click that leaves music behind reads as part of them.
 *
 * ⚠️ they rise in a STAGGERED line rather than a burst. Notes on a stave are read left to
 * right, so a radial spray of them looks like debris; a drifting column looks like a phrase. The
 * sideways drift alternates so the column leans rather than marching straight up.
 */
function notes(host: HTMLElement, x: number, y: number) {
  const colors = palette()
  const GLYPHS = ['\u266a', '\u266b', '\u266c', '\u2669']
  const N = amount('click', 5)
  const nodes: HTMLElement[] = []
  const anims: Animation[] = []
  for (let i = 0; i < N; i++) {
    const lean = (i % 2 === 0 ? 1 : -1) * (8 + Math.random() * 16)
    const rise = px(34 + Math.random() * 26)
    const g = mkGlyph(
      GLYPHS[i % GLYPHS.length],
      x + (Math.random() - 0.5) * 10,
      y,
      13 + Math.random() * 7,
      colors[i % colors.length],
    )
    nodes.push(g)
    anims.push(
      g.animate(
        [
          { transform: 'translate(-50%, -50%) translate(0, 0) scale(0.5)', opacity: 0 },
          {
            transform: `translate(-50%, -50%) translate(${lean * 0.4}px, ${-rise * 0.45}px) scale(1)`,
            opacity: 1,
            offset: 0.35,
          },
          {
            transform: `translate(-50%, -50%) translate(${lean}px, ${-rise}px) scale(0.85)`,
            opacity: 0,
          },
        ],
        {
          duration: dur(900 + Math.random() * 400),
          /* each note starts a beat after the last, which is what makes it a phrase */
          delay: i * 70,
          easing: 'cubic-bezier(0.25, 0.8, 0.4, 1)',
          fill: 'forwards',
        },
      ),
    )
  }
  track(host, nodes, anims)
}

/**
 * Snow — flakes that fall instead of flying.
 *
 * ⚠️ every other style here moves AWAY from the click; this one moves DOWN. That is the
 * whole of it. Gravity is the one motion none of the others have, so it reads as different even
 * though the particles are ordinary, and the horizontal sway is a sine rather than a straight
 * drift so each flake wanders the way a real one does.
 */
function snow(host: HTMLElement, x: number, y: number) {
  const colors = palette()
  const N = amount('click', 9)
  const nodes: HTMLElement[] = []
  const anims: Animation[] = []
  for (let i = 0; i < N; i++) {
    const sway = (Math.random() - 0.5) * 34
    const fall = px(30 + Math.random() * 40)
    const g = mkGlyph(
      '\u2744',
      x + (Math.random() - 0.5) * 30,
      y - 6,
      8 + Math.random() * 8,
      colors[i % colors.length],
    )
    nodes.push(g)
    anims.push(
      g.animate(
        [
          { transform: 'translate(-50%, -50%) translate(0, 0) rotate(0deg)', opacity: 0 },
          { opacity: 0.9, offset: 0.2 },
          {
            transform: `translate(-50%, -50%) translate(${sway}px, ${fall}px) rotate(${180 + Math.random() * 180}deg)`,
            opacity: 0,
          },
        ],
        {
          duration: dur(1100 + Math.random() * 500),
          delay: Math.random() * 160,
          easing: 'cubic-bezier(0.4, 0.1, 0.7, 1)',
          fill: 'forwards',
        },
      ),
    )
  }
  track(host, nodes, anims)
}

/**
 * Vortex — everything sucked into the point you pressed.
 *
 * ⚠️ it starts wide and ends AT the cursor, the reverse of every other style. Because the
 * particles converge, the click reads as the destination rather than the source — which is what
 * makes it feel like a button pulling itself shut. The spiral comes from advancing the angle as
 * the radius shrinks; a straight inward line looks like a collapse, not a whirl.
 */
function vortex(host: HTMLElement, x: number, y: number) {
  const [a, b] = pair()
  const N = amount('click', 12)
  const nodes: HTMLElement[] = []
  const anims: Animation[] = []
  const spin = Math.random() < 0.5 ? 1 : -1
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2
    const r0 = px(30 + Math.random() * 22)
    const a1 = a0 + spin * 1.9
    const dot = mk('click-fx-spark', x, y)
    dot.style.background = i % 3 === 0 ? b : a
    nodes.push(dot)
    anims.push(
      dot.animate(
        [
          {
            transform: `translate(-50%, -50%) translate(${Math.cos(a0) * r0}px, ${Math.sin(a0) * r0}px) scale(1)`,
            opacity: 0,
          },
          { opacity: 1, offset: 0.25 },
          {
            transform: `translate(-50%, -50%) translate(${Math.cos(a1) * r0 * 0.45}px, ${Math.sin(a1) * r0 * 0.45}px) scale(0.7)`,
            opacity: 0.9,
            offset: 0.65,
          },
          { transform: 'translate(-50%, -50%) translate(0, 0) scale(0)', opacity: 0 },
        ],
        {
          duration: dur(620 + Math.random() * 200),
          easing: 'cubic-bezier(0.5, 0, 0.75, 0)',
          fill: 'forwards',
        },
      ),
    )
  }
  track(host, nodes, anims)
}

/**
 * Firework — a shell that goes up, bursts, and leaves sparks falling.
 *
 * ⚠️ it is the only style with two ACTS, and the delay between them is the effect. A burst
 * on its own is already here twice over (Sparks, Pop); what a firework has that those do not is
 * the wait — a single rising dot, a pause, and only then the flash. The sparks are given a small
 * downward drift at the end so they die like embers rather than freezing in a ring.
 */
function firework(host: HTMLElement, x: number, y: number) {
  const colors = palette()
  const N = amount('click', 14)
  const nodes: HTMLElement[] = []
  const anims: Animation[] = []
  const climb = px(30 + Math.random() * 16)
  const RISE = dur(300)

  const shell = mk('click-fx-spark', x, y)
  shell.style.background = colors[0]
  nodes.push(shell)
  anims.push(
    shell.animate(
      [
        { transform: 'translate(-50%, -50%) translate(0, 0) scale(1)', opacity: 1 },
        {
          transform: `translate(-50%, -50%) translate(0, ${-climb}px) scale(0.6)`,
          opacity: 0,
        },
      ],
      { duration: RISE, easing: 'cubic-bezier(0.2, 0.7, 0.4, 1)', fill: 'forwards' },
    ),
  )

  for (let i = 0; i < N; i++) {
    const angle = (i / N) * Math.PI * 2 + Math.random() * 0.2
    const dist = px(22 + Math.random() * 30)
    const sp = mk('click-fx-spark', x, y - climb)
    sp.style.background = colors[i % colors.length]
    nodes.push(sp)
    anims.push(
      sp.animate(
        [
          { transform: 'translate(-50%, -50%) translate(0, 0) scale(0.4)', opacity: 0 },
          { opacity: 1, offset: 0.1 },
          {
            transform: `translate(-50%, -50%) translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist + 14}px) scale(0.5)`,
            opacity: 0,
          },
        ],
        {
          duration: dur(720 + Math.random() * 260),
          /* the pause IS the firework — see above */
          delay: RISE,
          easing: 'cubic-bezier(0.1, 0.7, 0.3, 1)',
          fill: 'forwards',
        },
      ),
    )
  }
  track(host, nodes, anims)
}

/**
 * Coins — struck upward, flipping, and falling back past where they started.
 *
 * ⚠️ the flip is a scaleX through zero, not a rotation. A coin seen edge-on is INFINITELY
 * THIN, which a rotate cannot express — spinning a circle just looks like a circle. Squashing its
 * width to nothing and back is what the eye reads as a coin turning over.
 */
function coin(host: HTMLElement, x: number, y: number) {
  const colors = palette()
  const N = amount('click', 5)
  const nodes: HTMLElement[] = []
  const anims: Animation[] = []
  for (let i = 0; i < N; i++) {
    const drift = (Math.random() - 0.5) * 46
    const up = px(28 + Math.random() * 24)
    const size = px(9 + Math.random() * 5)
    const c = mk('click-fx-spark', x, y)
    c.style.width = size + 'px'
    c.style.height = size + 'px'
    c.style.borderRadius = '50%'
    c.style.background = colors[i % colors.length]
    nodes.push(c)
    anims.push(
      c.animate(
        [
          { transform: 'translate(-50%, -50%) translate(0, 0) scaleX(1)', opacity: 1 },
          {
            transform: `translate(-50%, -50%) translate(${drift * 0.5}px, ${-up}px) scaleX(0.05)`,
            opacity: 1,
            offset: 0.45,
          },
          {
            transform: `translate(-50%, -50%) translate(${drift}px, ${up * 0.7}px) scaleX(1)`,
            opacity: 0,
          },
        ],
        {
          duration: dur(820 + Math.random() * 260),
          easing: 'cubic-bezier(0.3, 0.1, 0.5, 1)',
          fill: 'forwards',
        },
      ),
    )
  }
  track(host, nodes, anims)
}

/**
 * Lightning — a bolt that arrives from off the top rather than growing out of the click.
 *
 * ⚠️ the only effect whose ORIGIN is not where you pressed. Everything else radiates from
 * the point, so they all share a silhouette; this one comes down to it, which makes the click
 * look like a target instead of a source. The jag is built from a few segments with alternating
 * offsets, because a smooth curve reads as a rope and a truly random walk reads as a scribble.
 */
function lightning(host: HTMLElement, x: number, y: number) {
  const [a, b] = pair()
  const nodes: HTMLElement[] = []
  const anims: Animation[] = []
  const SEGS = 5
  const top = y - px(80)
  let cx = x + (Math.random() - 0.5) * 30
  let cy = top
  for (let i = 0; i < SEGS; i++) {
    const t = (i + 1) / SEGS
    const nx = x + (1 - t) * (Math.random() - 0.5) * 34
    const ny = top + (y - top) * t
    const len = Math.hypot(nx - cx, ny - cy)
    const ang = (Math.atan2(ny - cy, nx - cx) * 180) / Math.PI
    const seg = mk('click-fx-spark', cx, cy)
    seg.style.width = len + 'px'
    seg.style.height = px(3) + 'px'
    seg.style.background = i === SEGS - 1 ? b : a
    seg.style.transformOrigin = '0 50%'
    nodes.push(seg)
    anims.push(
      seg.animate(
        [
          { transform: `translate(0, -50%) rotate(${ang}deg) scaleX(0)`, opacity: 1 },
          { transform: `translate(0, -50%) rotate(${ang}deg) scaleX(1)`, opacity: 1, offset: 0.3 },
          { transform: `translate(0, -50%) rotate(${ang}deg) scaleX(1)`, opacity: 0 },
        ],
        {
          duration: dur(420),
          /* each segment lights a moment after the one above it, so the bolt travels down */
          delay: i * 26,
          easing: 'steps(3, end)',
          fill: 'forwards',
        },
      ),
    )
    cx = nx
    cy = ny
  }
  track(host, nodes, anims)
}

/**
 * Leaves — glyphs that flutter down, turning as they go.
 *
 * ⚠️ falls like Snow but TUMBLES, and that is the difference worth having: a flake drifts
 * flat, a leaf turns over. The horizontal motion is a sine of its own phase rather than a straight
 * drift, so each one swings rather than sliding.
 */
function leaves(host: HTMLElement, x: number, y: number) {
  const colors = palette()
  const GLYPHS = ['🍂', '🍃', '🍁']
  const N = amount('click', 6)
  const nodes: HTMLElement[] = []
  const anims: Animation[] = []
  for (let i = 0; i < N; i++) {
    const swing = 20 + Math.random() * 26
    const fall = px(36 + Math.random() * 34)
    const dir = Math.random() < 0.5 ? 1 : -1
    const g = mkGlyph(
      GLYPHS[i % GLYPHS.length],
      x + (Math.random() - 0.5) * 22,
      y - 4,
      12 + Math.random() * 8,
      colors[i % colors.length],
    )
    nodes.push(g)
    anims.push(
      g.animate(
        [
          { transform: 'translate(-50%, -50%) translate(0, 0) rotate(0deg)', opacity: 0 },
          { opacity: 1, offset: 0.15 },
          {
            transform: `translate(-50%, -50%) translate(${dir * swing}px, ${fall * 0.5}px) rotate(${dir * 120}deg)`,
            opacity: 0.9,
            offset: 0.55,
          },
          {
            transform: `translate(-50%, -50%) translate(${-dir * swing * 0.4}px, ${fall}px) rotate(${dir * 300}deg)`,
            opacity: 0,
          },
        ],
        {
          duration: dur(1300 + Math.random() * 600),
          delay: Math.random() * 180,
          easing: 'cubic-bezier(0.35, 0.1, 0.6, 1)',
          fill: 'forwards',
        },
      ),
    )
  }
  track(host, nodes, anims)
}

/**
 * Pixels — square blocks that scatter on a grid and snap out.
 *
 * ⚠️ positions are ROUNDED to a step and the easing is stepped, so nothing here moves
 * smoothly. Every other effect is built out of continuous motion; refusing that is the entire
 * character of this one, and it is what makes it sit with the Pixel cursor rather than beside it.
 */
function pixels(host: HTMLElement, x: number, y: number) {
  const colors = palette()
  const N = amount('click', 10)
  const STEP = 7
  const nodes: HTMLElement[] = []
  const anims: Animation[] = []
  for (let i = 0; i < N; i++) {
    const angle = (i / N) * Math.PI * 2 + (Math.random() - 0.5) * 0.6
    const dist = px(18 + Math.random() * 26)
    const tx = Math.round((Math.cos(angle) * dist) / STEP) * STEP
    const ty = Math.round((Math.sin(angle) * dist) / STEP) * STEP
    const size = px(STEP)
    const b = mk('click-fx-spark', Math.round(x / STEP) * STEP, Math.round(y / STEP) * STEP)
    b.style.width = size + 'px'
    b.style.height = size + 'px'
    b.style.borderRadius = '0'
    b.style.background = colors[i % colors.length]
    nodes.push(b)
    anims.push(
      b.animate(
        [
          { transform: 'translate(-50%, -50%) translate(0, 0)', opacity: 1 },
          { transform: `translate(-50%, -50%) translate(${tx}px, ${ty}px)`, opacity: 1 },
          { transform: `translate(-50%, -50%) translate(${tx}px, ${ty}px)`, opacity: 0 },
        ],
        {
          duration: dur(560 + Math.random() * 180),
          easing: 'steps(4, end)',
          fill: 'forwards',
        },
      ),
    )
  }
  track(host, nodes, anims)
}

const BUILDERS: Record<FxStyle, (host: HTMLElement, x: number, y: number) => void> = {
  sparks,
  sonar,
  pop,
  rocket,
  stars,
  hearts,
  bubbles,
  glitter,
  shatter,
  ink,
  orbit,
  beam,
  splash,
  slash,
  implode,
  bloom,
  dust,
  notes,
  snow,
  vortex,
  firework,
  coin,
  lightning,
  leaves,
  pixels,
}

function onPointerMove(e: PointerEvent) {
  const dx = e.clientX - lastMoveX
  const dy = e.clientY - lastMoveY
  // ignore jitter: a couple of pixels is a resting hand, not a swing
  if (dx * dx + dy * dy > 16) swingAngle = Math.atan2(dy, dx)
  lastMoveX = e.clientX
  lastMoveY = e.clientY
}

function burst(x: number, y: number, target: EventTarget | null) {
  if (live >= MAX_BURSTS) return
  const inScope =
    scopeEl != null && scopeStyle != null && target instanceof Node && scopeEl.contains(target)
  BUILDERS[inScope ? scopeStyle! : style](layer(), x, y)
}

/**
 * One element that plays a DIFFERENT style from the rest of the page.
 *
 * Wearing someone's flair used to swap the site-wide style, so their sparks fired on every click
 * anywhere — the nav, the launcher, other windows — their taste leaking off their own page.
 * Suppressing clicks outside fixed the leak and replaced it with a worse bug: no flair at all
 * out there, when what you want is your own.
 *
 * So this overrides rather than confines. Inside the element you get theirs, outside you get
 * whatever you already had, and the site-wide style is never touched — which also means there is
 * nothing to restore, and no way to strand a visitor wearing a stranger's flair.
 */
let scopeEl: Element | null = null
let scopeStyle: FxStyle | null = null

/** Give one element its own style. Pass (null, null) to drop the override. */
export function setClickFxScope(el: Element | null, fxStyle: FxStyle | null) {
  scopeEl = el
  scopeStyle = fxStyle
}

function onPointerDown(e: PointerEvent) {
  if (!enabled) return
  /**
   * ⚠️ Checked HERE, not at install. It used to bail out of installing at all when the OS asked
   * for reduced motion, which meant the site's own reduce-motion switch could never turn the
   * effect back off once it was running — and could never let it run for someone who turned the
   * switch off. Asking per click is free and always current: the answer can change while the tab
   * is open, from the switch or from the OS.
   */
  if (motionReduced()) return
  // Primary button only: a right-click opens a menu and a middle-click pans the canvas, and
  // neither is the kind of "I pressed this" moment the effect is acknowledging.
  if (e.button !== 0) return
  burst(e.clientX, e.clientY, e.target)
}

/** Turn flair on or off at runtime. Persisted by the caller, not here. */
export function setClickFxEnabled(on: boolean) {
  enabled = on
  if (!on) document.getElementById(LAYER_ID)?.replaceChildren()
}

/** Switch which style plays. Takes effect on the next click — nothing needs to restart. */
export function setClickFxStyle(next: FxStyle) {
  style = next
}

/**
 * Play one burst on demand, at a fixed point — used by the style picker's preview buttons so
 * choosing a style shows what it looks like immediately, without needing a real click.
 */
export function previewClickFx(fxStyle: FxStyle, x: number, y: number) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  BUILDERS[fxStyle](layer(), x, y)
}

/**
 * Start listening. Returns a cleanup so React can tear it down.
 *
 * `capture: true` so a burst still happens when the thing you clicked stops propagation —
 * plenty of menus and dialogs do, and those are exactly the satisfying things to click.
 */
export function installClickFx(): () => void {
  if (installed) return () => {}
  if (typeof Element.prototype.animate !== 'function') return () => {}
  installed = true
  window.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true })
  window.addEventListener('pointermove', onPointerMove, { passive: true })
  return () => {
    installed = false
    window.removeEventListener('pointerdown', onPointerDown, { capture: true })
    window.removeEventListener('pointermove', onPointerMove)
    document.getElementById(LAYER_ID)?.remove()
  }
}
