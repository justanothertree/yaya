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
 * Fifteen styles, deliberately differentiated by SHAPE and MOTION rather than just palette —
 * radiating dots (sparks), expanding rings (sonar), falling paper (pop), a two-stage launch+burst
 * (rocket), twinkling glyphs (stars, glitter), upward drift (hearts, bubbles), an implosion isn't
 * here but an orbit is, straight rays (beam), angular shards (shatter), soft splats (ink). A style
 * that only changed color on top of the same dots-flying-outward motion as another one was cut or
 * reworked — that's what made the original ripple/confetti/fireworks trio feel thin next to
 * sparks, and it's also why pixels/zap didn't survive their own tryout.
 *
 * The later three hold to the same bar. `glass` is not a recoloured `shatter`: that one throws
 * triangles outward, this one propagates crack LINES from the impact and lets a few pieces fall.
 * `splash` needed a three-keyframe arc, because two keyframes draw a straight line and would
 * have been sparks in blue. `slash` is the only one that takes a direction — it aims along the
 * way the pointer was actually travelling, which is the difference between a swing and a decal.
 */

import { motionReduced } from './motion'

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
  | 'glass'
  | 'splash'
  | 'slash'

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
 * a custom one — without this module knowing anything about themes. `--warn`/`--danger` are read
 * too, for the styles with a wider palette, and fall back to the accent pair when a theme doesn't
 * define them rather than rendering a broken swatch.
 */
function palette(): string[] {
  const s = getComputedStyle(document.documentElement)
  const get = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback
  const a = get('--accent', '#22c55e')
  const b = get('--accent-2', a)
  return [a, b, get('--warn', a), get('--danger', b)]
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
  const [a, b] = palette()
  const N = 8
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
      { duration: 420, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)', fill: 'forwards' },
    ),
  )

  for (let i = 0; i < N; i++) {
    // spread evenly, then jitter — evenly-spaced alone looks mechanical, fully random clumps
    const angle = (i / N) * Math.PI * 2 + (Math.random() - 0.5) * 0.6
    const dist = 18 + Math.random() * 26
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
          duration: 380 + Math.random() * 260,
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
  const [a] = palette()
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
        { duration: 620, delay: i * 140, easing: 'ease-out', fill: 'both' },
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
  const N = 14
  const nodes: HTMLElement[] = []
  const anims: Animation[] = []
  for (let i = 0; i < N; i++) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4
    const dist = 26 + Math.random() * 40
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
          duration: 520 + Math.random() * 220,
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
  const [a] = palette()
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
    { duration: 260, easing: 'cubic-bezier(0.3, 0, 0.6, 1)', fill: 'forwards' },
  )
  track(host, [dot], [climb])

  // The burst is a SEPARATE track() call, kicked off once the climb's own finished promise
  // resolves — .catch() swallows the case where the climb gets cancelled instead (a reduced-
  // motion toggle or unmount mid-flight), so that never surfaces as an unhandled rejection.
  climb.finished
    .then(() => {
      const peakY = y - rise
      const colors = palette()
      const N = 14
      const nodes: HTMLElement[] = []
      const anims: Animation[] = []
      for (let i = 0; i < N; i++) {
        const angle = (i / N) * Math.PI * 2 + (Math.random() - 0.5) * 0.3
        const dist = 26 + Math.random() * 40
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
              duration: 420 + Math.random() * 260,
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
  const N = 7
  const nodes: HTMLElement[] = []
  const anims: Animation[] = []
  for (let i = 0; i < N; i++) {
    const angle = (i / N) * Math.PI * 2 + (Math.random() - 0.5) * 0.5
    const dist = 24 + Math.random() * 36
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
        { duration: 520 + Math.random() * 280, easing: 'ease-out', fill: 'forwards' },
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
  const N = 6
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
        { duration: 620 + Math.random() * 260, easing: 'ease-out', fill: 'forwards' },
      ),
    )
  }
  track(host, nodes, anims)
}

/** Translucent circles drift upward with a wobble and POP (a quick scale-up right before they
 * vanish, not a plain fade) — the pop at the top is what sells "bubble" over "dot that floats". */
function bubbles(host: HTMLElement, x: number, y: number) {
  const [a, b] = palette()
  const N = 8
  const nodes: HTMLElement[] = []
  const anims: Animation[] = []
  for (let i = 0; i < N; i++) {
    const rise = 60 + Math.random() * 60
    const sway = (Math.random() - 0.5) * 40
    const size = 6 + Math.random() * 10
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
        { duration: 680 + Math.random() * 260, easing: 'ease-out', fill: 'forwards' },
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
  const N = 9
  const nodes: HTMLElement[] = []
  const anims: Animation[] = []
  for (let i = 0; i < N; i++) {
    const dist = 6 + Math.random() * 22
    const angle = Math.random() * Math.PI * 2
    const px = x + Math.cos(angle) * dist
    const py = y + Math.sin(angle) * dist
    const p = mkGlyph('✦', px, py, 8 + Math.random() * 6, colors[i % colors.length])
    nodes.push(p)
    anims.push(
      p.animate(
        [
          { transform: 'translate(-50%, -50%) scale(0)', opacity: 0 },
          { transform: 'translate(-50%, -50%) scale(1.2)', opacity: 1, offset: 0.4 },
          { transform: 'translate(-50%, -50%) scale(0)', opacity: 0 },
        ],
        {
          duration: 420 + Math.random() * 200,
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
  const N = 10
  const nodes: HTMLElement[] = []
  const anims: Animation[] = []
  for (let i = 0; i < N; i++) {
    const angle = (i / N) * Math.PI * 2 + (Math.random() - 0.5) * 0.4
    const dist = 20 + Math.random() * 34
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
          duration: 280 + Math.random() * 160,
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
  const [a, b] = palette()
  const N = 5
  const nodes: HTMLElement[] = []
  const anims: Animation[] = []
  for (let i = 0; i < N; i++) {
    const angle = Math.random() * Math.PI * 2
    const dist = Math.random() * 14
    const size = 14 + Math.random() * 22
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
        { duration: 500 + Math.random() * 220, easing: 'ease-out', fill: 'forwards' },
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
  const N = 5
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
  const [a, b] = palette()
  const N = 8
  const nodes: HTMLElement[] = []
  const anims: Animation[] = []
  for (let i = 0; i < N; i++) {
    const angle = (i / N) * 360 + (Math.random() - 0.5) * 8
    const len = 26 + Math.random() * 26
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
        { duration: 380 + Math.random() * 160, easing: 'ease-out', fill: 'forwards' },
      ),
    )
  }
  track(host, nodes, anims)
}

/**
 * Broken glass — a bullet hole, not a starburst.
 *
 * ⚠️ The first version was radial lines only, and radial lines are what `beam` already is: same
 * shape, same motion, different name. What actually distinguishes cracked glass is the WEB —
 * short chords running between neighbouring cracks at a few radii, which is the thing your eye
 * reads as "this pane is broken" rather than "something is shining". So the chords are the
 * effect and the radials are the scaffolding they hang on.
 *
 * The impact point stays dark for a moment too. Real breakage has a hole at the centre; without
 * it the cracks look like they are radiating from nothing.
 */
function glass(host: HTMLElement, x: number, y: number) {
  const [a, b] = palette()
  const nodes: HTMLElement[] = []
  const anims: Animation[] = []

  // the hole: a small dark core that lingers under everything else
  const hole = mk('click-fx-hole', x, y)
  nodes.push(hole)
  anims.push(
    hole.animate(
      [
        { transform: 'translate(-50%, -50%) scale(0.2)', opacity: 0.9 },
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 0.75, offset: 0.2 },
        { transform: 'translate(-50%, -50%) scale(1.1)', opacity: 0 },
      ],
      { duration: 560, easing: 'ease-out', fill: 'forwards' },
    ),
  )

  const RAYS = 7
  const angles: number[] = []
  for (let i = 0; i < RAYS; i++) {
    const deg = (i / RAYS) * 360 + (Math.random() - 0.5) * 30
    angles.push(deg)
    const len = 24 + Math.random() * 30
    const c = mk('click-fx-crack', x, y)
    c.style.width = len + 'px'
    c.style.background = i % 2 ? b : a
    nodes.push(c)
    anims.push(
      c.animate(
        [
          { transform: `rotate(${deg}deg) scaleX(0)`, opacity: 1 },
          { transform: `rotate(${deg}deg) scaleX(1)`, opacity: 1, offset: 0.22 },
          { transform: `rotate(${deg}deg) scaleX(1)`, opacity: 0 },
        ],
        {
          duration: 460 + Math.random() * 160,
          easing: 'cubic-bezier(0.05, 0.9, 0.15, 1)',
          fill: 'forwards',
        },
      ),
    )
  }

  // the web: chords between neighbouring cracks, at two radii. This is the part that makes it
  // glass rather than a starburst.
  for (let ring = 0; ring < 2; ring++) {
    const r = 13 + ring * 13
    for (let i = 0; i < RAYS; i++) {
      const d1 = (angles[i] * Math.PI) / 180
      const d2 = (angles[(i + 1) % RAYS] * Math.PI) / 180
      const x1 = x + Math.cos(d1) * r
      const y1 = y + Math.sin(d1) * r
      const x2 = x + Math.cos(d2) * r
      const y2 = y + Math.sin(d2) * r
      const mx = (x1 + x2) / 2
      const my = (y1 + y2) / 2
      const len = Math.hypot(x2 - x1, y2 - y1)
      const deg = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI
      const seg = mk('click-fx-chord', mx, my)
      seg.style.width = len + 'px'
      seg.style.background = a
      nodes.push(seg)
      anims.push(
        seg.animate(
          [
            { transform: `translate(-50%, -50%) rotate(${deg}deg) scaleX(0)`, opacity: 0.85 },
            {
              transform: `translate(-50%, -50%) rotate(${deg}deg) scaleX(1)`,
              opacity: 0.85,
              offset: 0.35,
            },
            { transform: `translate(-50%, -50%) rotate(${deg}deg) scaleX(1)`, opacity: 0 },
          ],
          {
            duration: 420 + Math.random() * 140,
            // after the crack that carries it has arrived, so the web builds outward
            delay: 40 + ring * 70,
            easing: 'ease-out',
            fill: 'forwards',
          },
        ),
      )
    }
  }

  for (let i = 0; i < 4; i++) {
    const angle = Math.random() * Math.PI * 2
    const dist = 12 + Math.random() * 20
    const pcs = mk('click-fx-shard', x, y)
    pcs.style.background = i % 2 ? a : b
    nodes.push(pcs)
    anims.push(
      pcs.animate(
        [
          { transform: 'translate(-50%, -50%) translate(0, 0) rotate(0deg)', opacity: 0.9 },
          {
            transform: `translate(-50%, -50%) translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist + 18}px) rotate(${(Math.random() - 0.5) * 320}deg)`,
            opacity: 0,
          },
        ],
        {
          duration: 520 + Math.random() * 180,
          delay: 90,
          easing: 'cubic-bezier(0.3, 0.6, 0.5, 1)',
          fill: 'forwards',
        },
      ),
    )
  }
  track(host, nodes, anims)
}

/**
 * Water — rings on a surface, with the droplets as garnish.
 *
 * ⚠️ The first version led with eight droplets on arcs, and eight things flying outward on arcs
 * is `pop` with rounder particles. What says WATER is the concentric rings: a drop hitting a
 * surface makes several, staggered, each expanding and flattening as it goes. So the rings are
 * the effect now and the droplets support them — fewer of them, and each one lands and makes a
 * small ring of its own, which is the detail that sells the surface as wet.
 *
 * Rings are flattened on Y because you are looking at the surface from an angle, not from
 * directly overhead; a perfect circle reads as `sonar`.
 */
function splash(host: HTMLElement, x: number, y: number) {
  const [a, b] = palette()
  const nodes: HTMLElement[] = []
  const anims: Animation[] = []

  // three rings, staggered — one ring is a ping, several is a surface reacting
  for (let i = 0; i < 3; i++) {
    const ring = mk('click-fx-ripple', x, y)
    ring.style.color = i === 1 ? b : a
    nodes.push(ring)
    anims.push(
      ring.animate(
        [
          { transform: 'translate(-50%, -50%) scale(0.15) scaleY(0.45)', opacity: 0.9 },
          { transform: `translate(-50%, -50%) scale(${0.9 + i * 0.45}) scaleY(0.45)`, opacity: 0 },
        ],
        {
          duration: 620 + i * 160,
          delay: i * 130,
          easing: 'cubic-bezier(0.15, 0.75, 0.3, 1)',
          fill: 'forwards',
        },
      ),
    )
  }

  const N = 5
  for (let i = 0; i < N; i++) {
    const spread = (i / (N - 1) - 0.5) * 62 + (Math.random() - 0.5) * 8
    const rise = 18 + Math.random() * 20
    const flight = 520 + Math.random() * 160
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
            transform: `translate(-50%, -50%) translate(${spread}px, 0px) scale(0.5, 1.6)`,
            opacity: 0,
          },
        ],
        { duration: flight, easing: 'cubic-bezier(0.3, 0.1, 0.7, 1)', fill: 'forwards' },
      ),
    )

    // where it comes back down, a small ring of its own — the bit that reads as a wet surface
    const land = mk('click-fx-ripple click-fx-ripple-sm', x + spread, y)
    land.style.color = a
    nodes.push(land)
    anims.push(
      land.animate(
        [
          { transform: 'translate(-50%, -50%) scale(0.1) scaleY(0.4)', opacity: 0.7 },
          { transform: 'translate(-50%, -50%) scale(1) scaleY(0.4)', opacity: 0 },
        ],
        { duration: 380, delay: flight * 0.92, easing: 'ease-out', fill: 'forwards' },
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
  const [a, b] = palette()
  const nodes: HTMLElement[] = []
  const anims: Animation[] = []
  const deg = ((swingAngle ?? Math.random() * Math.PI * 2) * 180) / Math.PI
  const len = 64 + Math.random() * 26

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
    const dist = 10 + Math.random() * 18
    const rad = (perp * Math.PI) / 180
    const along = (deg * Math.PI) / 180
    const px = x + Math.cos(along) * off
    const py = y + Math.sin(along) * off
    const p = mk('click-fx-spark', px, py)
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
        { duration: 320 + Math.random() * 160, easing: 'ease-out', fill: 'forwards' },
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
  glass,
  splash,
  slash,
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
