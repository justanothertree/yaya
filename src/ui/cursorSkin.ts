/**
 * The pointer itself as a flair.
 *
 * ⚠️ NATIVE `cursor`, NOT A DRAWN ELEMENT. The obvious implementation is a div that follows the
 * mouse with the real one hidden — the party cursors already do exactly that for other people —
 * and for your OWN pointer it is the wrong answer every time. A drawn cursor is composited a
 * frame behind the hardware one, so it lags a few milliseconds behind where you know your hand
 * is; that gap is small enough to be hard to name and large enough to make the whole site feel
 * slow. It also stops existing the moment a menu, a file dialog or another window is over the
 * page. The browser's own cursor has none of those problems and costs nothing per frame.
 *
 * The cost is what the platform allows: 32px, no animation, and a PNG/SVG the OS draws. That is a
 * fair trade for a pointer that is never late.
 *
 * ⚠️ TEXT FIELDS KEEP THEIR I-BEAM. A skin that replaces every cursor everywhere takes the
 * I-beam off inputs and the resize arrows off anything draggable, and those are not decoration —
 * they are how you know where you can type. A flair that makes the site harder to use has stopped
 * being a flair.
 */

export type CursorSkin =
  | 'system'
  | 'arrow'
  | 'dot'
  | 'ring'
  | 'cross'
  | 'pen'
  | 'wand'
  | 'pixel'
  | 'heart'
  | 'star'
  | 'leaf'
  | 'ghost'

export const CURSOR_OPTIONS: Array<[CursorSkin, string, string]> = [
  ['system', '↖', 'System'],
  ['arrow', '➤', 'Arrow'],
  ['dot', '•', 'Dot'],
  ['ring', '◎', 'Ring'],
  ['cross', '✛', 'Cross'],
  ['pen', '🖋', 'Pen'],
  ['wand', '✨', 'Wand'],
  ['pixel', '🕹', 'Pixel'],
  ['heart', '❤', 'Heart'],
  ['star', '★', 'Star'],
  ['leaf', '🍃', 'Leaf'],
  ['ghost', '👻', 'Ghost'],
]

export const CURSOR_IDS = CURSOR_OPTIONS.map(([id]) => id)

export function isCursorSkin(v: unknown): v is CursorSkin {
  return typeof v === 'string' && (CURSOR_IDS as string[]).includes(v)
}

/**
 * Each skin: the shape, and where its point actually is.
 *
 * ⚠️ The HOTSPOT is the whole reason this is a table rather than a list of pictures. It is the
 * pixel the operating system treats as "where you clicked", and if it does not sit on the tip of
 * the drawn shape then everything on the site is a few pixels away from where it looks. A
 * crosshair points from its middle; an arrow points from its corner; a pen points from its nib.
 * Getting this wrong is not a cosmetic problem, it is a site where you keep missing buttons.
 */
type Skin = { body: (c: string) => string; hot: [number, number] }

const SKINS: Record<Exclude<CursorSkin, 'system'>, Skin> = {
  arrow: {
    hot: [3, 2],
    body: (c) =>
      `<path d="M3 2 L3 22 L8.5 16.8 L12 25 L15.6 23.4 L12.1 15.6 L19.4 15.3 Z" fill="${c}" stroke="rgba(0,0,0,.65)" stroke-width="1.6" stroke-linejoin="round"/>`,
  },
  dot: {
    hot: [14, 14],
    body: (c) =>
      `<circle cx="14" cy="14" r="5" fill="${c}" stroke="rgba(0,0,0,.6)" stroke-width="1.5"/>`,
  },
  ring: {
    hot: [14, 14],
    body: (c) =>
      `<circle cx="14" cy="14" r="8.5" fill="none" stroke="rgba(0,0,0,.55)" stroke-width="4.5"/>` +
      `<circle cx="14" cy="14" r="8.5" fill="none" stroke="${c}" stroke-width="2.5"/>` +
      `<circle cx="14" cy="14" r="1.5" fill="${c}"/>`,
  },
  cross: {
    hot: [14, 14],
    body: (c) =>
      `<path d="M14 3 V11 M14 17 V25 M3 14 H11 M17 14 H25" stroke="rgba(0,0,0,.6)" stroke-width="4.5" stroke-linecap="round"/>` +
      `<path d="M14 3 V11 M14 17 V25 M3 14 H11 M17 14 H25" stroke="${c}" stroke-width="2" stroke-linecap="round"/>`,
  },
  pen: {
    hot: [3, 25],
    body: (c) =>
      `<path d="M3 25 L6.5 17.5 L20 4 A2.6 2.6 0 0 1 24 8 L10.5 21.5 Z" fill="${c}" stroke="rgba(0,0,0,.65)" stroke-width="1.6" stroke-linejoin="round"/>` +
      `<path d="M6.5 17.5 L10.5 21.5" stroke="rgba(0,0,0,.5)" stroke-width="1.4"/>`,
  },
  wand: {
    hot: [3, 25],
    body: (c) =>
      `<path d="M3 25 L17 11" stroke="rgba(0,0,0,.65)" stroke-width="5" stroke-linecap="round"/>` +
      `<path d="M3 25 L17 11" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>` +
      `<path d="M20 3 L21.9 8.1 L27 10 L21.9 11.9 L20 17 L18.1 11.9 L13 10 L18.1 8.1 Z" fill="${c}" stroke="rgba(0,0,0,.6)" stroke-width="1.2" stroke-linejoin="round"/>`,
  },
  pixel: {
    hot: [2, 1],
    body: (c) =>
      // ⚠️ drawn on a grid of 3px squares, so it reads as pixel art rather than as a blurry arrow
      `<path d="M2 1 h3 v3 h3 v3 h3 v3 h3 v3 h3 v3 h-6 v3 h-3 v3 h-3 v-3 h-3 Z" fill="${c}" stroke="rgba(0,0,0,.7)" stroke-width="1.4" stroke-linejoin="miter" shape-rendering="crispEdges"/>`,
  },
  heart: {
    hot: [14, 6],
    body: (c) =>
      `<path d="M14 25 C6 18.5 3 14.5 3 10.5 A5.5 5.5 0 0 1 14 8 A5.5 5.5 0 0 1 25 10.5 C25 14.5 22 18.5 14 25 Z" fill="${c}" stroke="rgba(0,0,0,.6)" stroke-width="1.6" stroke-linejoin="round"/>`,
  },
  star: {
    hot: [14, 3],
    body: (c) =>
      `<path d="M14 3 L17.4 10.6 L25.6 11.5 L19.5 17 L21.2 25 L14 20.9 L6.8 25 L8.5 17 L2.4 11.5 L10.6 10.6 Z" fill="${c}" stroke="rgba(0,0,0,.6)" stroke-width="1.5" stroke-linejoin="round"/>`,
  },
  leaf: {
    hot: [4, 24],
    body: (c) =>
      `<path d="M4 24 C4 12 12 4 24 4 C24 16 16 24 4 24 Z" fill="${c}" stroke="rgba(0,0,0,.6)" stroke-width="1.6" stroke-linejoin="round"/>` +
      `<path d="M6 22 C12 16 17 11 22 7" stroke="rgba(0,0,0,.45)" stroke-width="1.4" fill="none"/>`,
  },
  ghost: {
    hot: [14, 4],
    body: (c) =>
      `<path d="M4 25 V12 A10 10 0 0 1 24 12 V25 L20.5 22 L17 25 L14 22 L11 25 L7.5 22 Z" fill="${c}" stroke="rgba(0,0,0,.6)" stroke-width="1.6" stroke-linejoin="round"/>` +
      `<circle cx="10.5" cy="13" r="1.9" fill="rgba(0,0,0,.75)"/>` +
      `<circle cx="17.5" cy="13" r="1.9" fill="rgba(0,0,0,.75)"/>`,
  },
}

/**
 * ⚠️ 28px inside a 28px box, and no larger.
 *
 * Browsers refuse a cursor image over 128px outright, and several platforms quietly fall back to
 * the system arrow well before that — a cursor that vanishes on one machine and works on another
 * is worse than one that is slightly small everywhere.
 */
const SIZE = 28

function dataUri(skin: Skin, colour: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 28 28">` +
    skin.body(colour) +
    `</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

const STYLE_ID = 'cursor-skin'

/**
 * Put the skin on the page.
 *
 * Written as a stylesheet rather than an inline style so one rule can carry the exceptions. The
 * `:not()` list is the accessibility half of the feature: text entry keeps its I-beam, and
 * anything the browser gives a resize or grab cursor keeps that too, because those cursors are
 * telling you what you can do rather than decorating the page.
 *
 * `colour` comes from the live theme, so the pointer follows your palette like every other flair
 * — call this again when the accent changes.
 */
export function applyCursorSkin(id: CursorSkin, colour: string) {
  const existing = document.getElementById(STYLE_ID)
  if (id === 'system') {
    existing?.remove()
    return
  }
  const skin = SKINS[id]
  if (!skin) {
    existing?.remove()
    return
  }
  const url = dataUri(skin, colour)
  const [hx, hy] = skin.hot
  const el = (existing as HTMLStyleElement | null) ?? document.createElement('style')
  el.id = STYLE_ID
  /**
   * ⚠️ `, auto` at the end is not optional. If the image fails to load for any reason the whole
   * declaration is invalid without a keyword fallback, and the page is left with no cursor at
   * all — an invisible pointer, which is about the worst thing a decoration can do.
   */
  el.textContent =
    `:root[data-cursor] body, ` +
    `:root[data-cursor] body *:not(input):not(textarea):not(select):not([contenteditable]):not([contenteditable] *) ` +
    `{ cursor: ${url} ${hx} ${hy}, auto; }`
  if (!existing) document.head.appendChild(el)
  document.documentElement.setAttribute('data-cursor', id)
}
