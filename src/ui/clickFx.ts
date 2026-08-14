/**
 * Click sparks — a small burst of light where you click.
 *
 * Deliberately built on the Web Animations API rather than CSS keyframes: each burst wants its
 * own random angle, distance and duration, and doing that in CSS means either writing the
 * particles' end positions into inline styles anyway or shipping a stylesheet of near-identical
 * keyframes. `element.animate()` takes the numbers directly and hands back a `finished` promise,
 * which is also how the nodes get cleaned up without a timer to keep in sync.
 *
 * Everything is drawn in a fixed, `pointer-events: none` layer, so nothing here can ever eat a
 * click or shift the page — the effect is incapable of interfering with the thing you clicked.
 */

const LAYER_ID = 'click-fx-layer'
/** Concurrent bursts to allow. A fast clicker shouldn't be able to pile up hundreds of nodes. */
const MAX_BURSTS = 6
const SPARKS = 8

let installed = false
let enabled = true
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
 * Read the accent straight off the document so sparks follow the active palette — including a
 * custom one — without this module knowing anything about themes.
 */
function accents(): [string, string] {
  const s = getComputedStyle(document.documentElement)
  const a = s.getPropertyValue('--accent').trim() || '#22c55e'
  const b = s.getPropertyValue('--accent-2').trim() || a
  return [a, b]
}

function burst(x: number, y: number) {
  if (live >= MAX_BURSTS) return
  live++
  const host = layer()
  const [a, b] = accents()
  const nodes: HTMLElement[] = []
  const anims: Array<Animation> = []

  // the ring: a quick expanding outline that reads as "that registered"
  const ring = document.createElement('i')
  ring.className = 'click-fx-ring'
  ring.style.left = x + 'px'
  ring.style.top = y + 'px'
  ring.style.borderColor = a
  host.appendChild(ring)
  nodes.push(ring)
  anims.push(
    ring.animate(
      [
        { transform: 'translate(-50%, -50%) scale(0.2)', opacity: 0.9 },
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 0 },
      ],
      // fill: 'forwards' matters. Without it an element snaps back to its BASE style the moment
      // its own animation ends — fully opaque, back at the click point — and sits there until
      // every other animation in the burst has finished and the nodes are removed together.
      // The ring is the shortest of them, so it was the most visible: a circle and a dot left
      // behind after the sparks had gone.
      { duration: 420, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)', fill: 'forwards' },
    ),
  )

  for (let i = 0; i < SPARKS; i++) {
    // spread evenly, then jitter — evenly-spaced alone looks mechanical, fully random clumps
    const angle = (i / SPARKS) * Math.PI * 2 + (Math.random() - 0.5) * 0.6
    const dist = 18 + Math.random() * 26
    const p = document.createElement('i')
    p.className = 'click-fx-spark'
    p.style.left = x + 'px'
    p.style.top = y + 'px'
    p.style.background = i % 3 === 0 ? b : a
    host.appendChild(p)
    nodes.push(p)
    anims.push(
      p.animate(
        [
          { transform: 'translate(-50%, -50%) translate(0, 0) scale(1)', opacity: 1 },
          {
            transform: `translate(-50%, -50%) translate(${Math.cos(angle) * dist}px, ${
              Math.sin(angle) * dist
            }px) scale(0.2)`,
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

  Promise.allSettled(anims.map((an) => an.finished)).then(() => {
    for (const n of nodes) n.remove()
    live--
  })
}

function onPointerDown(e: PointerEvent) {
  if (!enabled) return
  // Primary button only: a right-click opens a menu and a middle-click pans the canvas, and
  // neither is the kind of "I pressed this" moment the effect is acknowledging.
  if (e.button !== 0) return
  burst(e.clientX, e.clientY)
}

/** Turn sparks on or off at runtime. Persisted by the caller, not here. */
export function setClickFxEnabled(on: boolean) {
  enabled = on
  if (!on) document.getElementById(LAYER_ID)?.replaceChildren()
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
