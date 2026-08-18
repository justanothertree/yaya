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
 */

export type FxStyle = 'sparks' | 'ripple' | 'confetti' | 'fireworks'

const LAYER_ID = 'click-fx-layer'
/** Concurrent bursts to allow. A fast clicker shouldn't be able to pile up hundreds of nodes. */
const MAX_BURSTS = 6

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
 * too, for confetti's extra colour, and fall back to the accent pair when a theme doesn't define
 * them rather than rendering a broken swatch.
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

/** The minimal end of the range: one expanding ring, nothing else. A quiet acknowledgement. */
function ripple(host: HTMLElement, x: number, y: number) {
  const [a] = palette()
  const ring = mk('click-fx-ripple', x, y)
  ring.style.borderColor = a
  const anim = ring.animate(
    [
      { transform: 'translate(-50%, -50%) scale(0.15)', opacity: 0.6 },
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 0 },
    ],
    { duration: 520, easing: 'ease-out', fill: 'forwards' },
  )
  track(host, [ring], [anim])
}

/** The playful end: small rotating rectangles that pop out and tumble under light gravity. */
function confetti(host: HTMLElement, x: number, y: number) {
  const colors = palette()
  const N = 10
  const nodes: HTMLElement[] = []
  const anims: Animation[] = []
  for (let i = 0; i < N; i++) {
    const angle = Math.random() * Math.PI * 2
    const dist = 22 + Math.random() * 34
    // gravity: the flight arcs downward regardless of launch angle, which is what makes
    // scattered rectangles read as confetti falling rather than a symmetric burst
    const dx = Math.cos(angle) * dist
    const dy = Math.sin(angle) * dist * 0.6 + 24
    const spin = (Math.random() - 0.5) * 540
    const p = mk('click-fx-confetti', x, y)
    p.style.background = colors[i % colors.length]
    nodes.push(p)
    anims.push(
      p.animate(
        [
          { transform: 'translate(-50%, -50%) translate(0, 0) rotate(0deg)', opacity: 1 },
          {
            transform: `translate(-50%, -50%) translate(${dx * 0.5}px, ${dy * 0.4}px) rotate(${spin * 0.5}deg)`,
            opacity: 1,
            offset: 0.5,
          },
          {
            transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) rotate(${spin}deg)`,
            opacity: 0,
          },
        ],
        { duration: 620 + Math.random() * 260, easing: 'ease-in', fill: 'forwards' },
      ),
    )
  }
  track(host, nodes, anims)
}

/** The dramatic end: a ring plus two waves of sparks at different speeds, wider and busier. */
function fireworks(host: HTMLElement, x: number, y: number) {
  const colors = palette()
  const nodes: HTMLElement[] = []
  const anims: Animation[] = []

  const ring = mk('click-fx-ring', x, y)
  ring.style.borderColor = colors[0]
  ring.style.width = '54px'
  ring.style.height = '54px'
  nodes.push(ring)
  anims.push(
    ring.animate(
      [
        { transform: 'translate(-50%, -50%) scale(0.15)', opacity: 0.85 },
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 0 },
      ],
      { duration: 500, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)', fill: 'forwards' },
    ),
  )

  const N = 16
  for (let i = 0; i < N; i++) {
    const angle = (i / N) * Math.PI * 2 + (Math.random() - 0.5) * 0.3
    const dist = 30 + Math.random() * 46
    const p = mk('click-fx-spark', x, y)
    p.style.background = colors[i % colors.length]
    // slightly bigger than the plain sparks style, so a busier burst still reads as sparks
    // rather than dust
    p.style.width = '7px'
    p.style.height = '7px'
    nodes.push(p)
    anims.push(
      p.animate(
        [
          { transform: 'translate(-50%, -50%) translate(0, 0) scale(1)', opacity: 1 },
          {
            transform: `translate(-50%, -50%) translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px) scale(0.15)`,
            opacity: 0,
          },
        ],
        {
          duration: 460 + Math.random() * 340,
          easing: 'cubic-bezier(0.1, 0.6, 0.15, 1)',
          fill: 'forwards',
        },
      ),
    )
  }
  track(host, nodes, anims)
}

const BUILDERS: Record<FxStyle, (host: HTMLElement, x: number, y: number) => void> = {
  sparks,
  ripple,
  confetti,
  fireworks,
}

function burst(x: number, y: number) {
  if (live >= MAX_BURSTS) return
  BUILDERS[style](layer(), x, y)
}

function onPointerDown(e: PointerEvent) {
  if (!enabled) return
  // Primary button only: a right-click opens a menu and a middle-click pans the canvas, and
  // neither is the kind of "I pressed this" moment the effect is acknowledging.
  if (e.button !== 0) return
  burst(e.clientX, e.clientY)
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
  // Someone who has asked for less motion has asked for exactly this kind of thing to stop.
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return () => {}
  if (typeof Element.prototype.animate !== 'function') return () => {}
  installed = true
  window.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true })
  return () => {
    installed = false
    window.removeEventListener('pointerdown', onPointerDown, { capture: true })
    document.getElementById(LAYER_ID)?.remove()
  }
}
