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
  | 'brush'
  | 'note'
  | 'bolt'
  | 'target'
  | 'hand'
  | 'diamond'
  | 'moon'
  | 'paw'
  | 'feather'
  | 'key'
  | 'flame'
  | 'eye'
  | 'rocket'
  | 'crown'
  | 'snowflake'
  | 'anchor'

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
  ['brush', '🖌', 'Brush'],
  ['note', '🎵', 'Note'],
  ['bolt', '⚡', 'Bolt'],
  ['target', '⌖', 'Target'],
  ['hand', '☝', 'Hand'],
  ['diamond', '◆', 'Diamond'],
  ['moon', '☾', 'Moon'],
  ['paw', '🐾', 'Paw'],
  ['feather', '🪶', 'Feather'],
  ['key', '🗝', 'Key'],
  ['flame', '🔥', 'Flame'],
  ['eye', '👁', 'Eye'],
  ['rocket', '🚀', 'Rocket'],
  ['crown', '👑', 'Crown'],
  ['snowflake', '❄', 'Snowflake'],
  ['anchor', '⚓', 'Anchor'],
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
  /**
   * The Paint room's own pointer. Hotspot on the BRISTLE TIP, where paint would actually land —
   * a brush whose hotspot sat on the handle would put every stroke an inch from the hand holding
   * it.
   */
  brush: {
    hot: [4, 24],
    body: (c) =>
      `<path d="M11 17 L21 7 A2.3 2.3 0 0 1 24.3 10.3 L14.3 20.3 Z" fill="${c}" stroke="rgba(0,0,0,.6)" stroke-width="1.5" stroke-linejoin="round"/>` +
      `<path d="M10.6 17.4 L14 20.8 L6.5 25.5 L4 24 Z" fill="${c}" stroke="rgba(0,0,0,.65)" stroke-width="1.5" stroke-linejoin="round"/>`,
  },
  /**
   * For the instrument. Hotspot on the NOTEHEAD, because that is the part a musician reads as the
   * note's position — the stem is just which way it is drawn.
   */
  note: {
    hot: [9, 21],
    body: (c) =>
      `<path d="M14.6 20.5 V5" stroke="rgba(0,0,0,.6)" stroke-width="4.2" stroke-linecap="round"/>` +
      `<path d="M14.6 20.5 V5" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/>` +
      `<path d="M14.6 5.5 C18.6 6.6 21.4 8.6 21.9 12.6" fill="none" stroke="rgba(0,0,0,.6)" stroke-width="4" stroke-linecap="round"/>` +
      `<path d="M14.6 5.5 C18.6 6.6 21.4 8.6 21.9 12.6" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/>` +
      `<ellipse cx="9.6" cy="20.6" rx="5.4" ry="4.1" transform="rotate(-22 9.6 20.6)" fill="${c}" stroke="rgba(0,0,0,.65)" stroke-width="1.5"/>`,
  },
  /**
   * Hotspot at the TOP of the strike, where the bolt comes from, so it points the way an arrow
   * does — a bolt anchored at its lower tip would feel like dragging the cursor behind the shape.
   */
  bolt: {
    hot: [4, 2],
    body: (c) =>
      `<path d="M4 2 L17.5 2 L11.5 11.5 L19.5 11.5 L7 26.5 L10 15.5 L3.5 15.5 Z" fill="${c}" stroke="rgba(0,0,0,.65)" stroke-width="1.5" stroke-linejoin="round"/>`,
  },
  /**
   * Precision without the bulk of Ring: the arms reach past the circle so the exact centre stays
   * visible against a busy drawing, which is where this one is worth having.
   */
  target: {
    hot: [14, 14],
    body: (c) =>
      `<circle cx="14" cy="14" r="8" fill="none" stroke="rgba(0,0,0,.55)" stroke-width="4"/>` +
      `<circle cx="14" cy="14" r="8" fill="none" stroke="${c}" stroke-width="2"/>` +
      `<path d="M14 1.5 V5.5 M14 22.5 V26.5 M1.5 14 H5.5 M22.5 14 H26.5" stroke="rgba(0,0,0,.55)" stroke-width="4" stroke-linecap="round"/>` +
      `<path d="M14 1.5 V5.5 M14 22.5 V26.5 M1.5 14 H5.5 M22.5 14 H26.5" stroke="${c}" stroke-width="2" stroke-linecap="round"/>` +
      `<circle cx="14" cy="14" r="1.6" fill="${c}"/>`,
  },
  /**
   * A pointing finger. Hotspot on the FINGERTIP, which is the one place anybody would expect it
   * — a hand anchored anywhere else feels like it is pointing at something other than what you
   * pressed.
   */
  hand: {
    hot: [10, 2],
    body: (c) =>
      `<path d="M10 2 A2 2 0 0 1 12.5 4 V13 L14 12.6 A1.9 1.9 0 0 1 16.4 14.4 L16.4 15 L18 14.8 A1.9 1.9 0 0 1 20.2 16.6 V17.2 L21.6 17.2 A1.9 1.9 0 0 1 23.4 19 V21.5 C23.4 24.6 20.6 26.5 17 26.5 H14.5 C11 26.5 8.6 24.6 7.8 21.8 L6 16.2 A1.9 1.9 0 0 1 9.4 14.8 L10 16.3 V4 A2 2 0 0 1 10 2 Z" fill="${c}" stroke="rgba(0,0,0,.65)" stroke-width="1.6" stroke-linejoin="round"/>`,
  },
  /** Symmetrical, so its hotspot is simply its middle — the quietest precise pointer here. */
  diamond: {
    hot: [14, 14],
    body: (c) =>
      `<path d="M14 3 L23 14 L14 25 L5 14 Z" fill="${c}" stroke="rgba(0,0,0,.6)" stroke-width="1.6" stroke-linejoin="round"/>` +
      `<circle cx="14" cy="14" r="1.4" fill="rgba(0,0,0,.5)"/>`,
  },
  /**
   * A crescent. Hotspot on the upper HORN rather than the body's middle, because the horn is the
   * part that looks like a point — the centre of a crescent is the empty side of it.
   */
  moon: {
    hot: [17, 3],
    body: (c) =>
      `<path d="M17 3 A11 11 0 1 0 24 17 A8.6 8.6 0 0 1 17 3 Z" fill="${c}" stroke="rgba(0,0,0,.6)" stroke-width="1.6" stroke-linejoin="round"/>`,
  },
  /** Pads and a toe, anchored on the big pad so it presses where the paw looks like it lands. */
  paw: {
    hot: [14, 17],
    body: (c) =>
      `<ellipse cx="14" cy="18.5" rx="6.6" ry="5.4" fill="${c}" stroke="rgba(0,0,0,.6)" stroke-width="1.5"/>` +
      `<ellipse cx="7.6" cy="11.4" rx="2.7" ry="3.4" fill="${c}" stroke="rgba(0,0,0,.6)" stroke-width="1.3"/>` +
      `<ellipse cx="13" cy="8.6" rx="2.7" ry="3.6" fill="${c}" stroke="rgba(0,0,0,.6)" stroke-width="1.3"/>` +
      `<ellipse cx="18.6" cy="10.2" rx="2.7" ry="3.4" fill="${c}" stroke="rgba(0,0,0,.6)" stroke-width="1.3"/>` +
      `<ellipse cx="22.6" cy="15" rx="2.4" ry="2.9" fill="${c}" stroke="rgba(0,0,0,.6)" stroke-width="1.3"/>`,
  },
  /** A quill. Hotspot on the QUILL TIP, the same reasoning as Pen and Brush — the writing end. */
  feather: {
    hot: [4, 25],
    body: (c) =>
      `<path d="M4 25 C9 20 10 14 14 9 C17 5 21 3 24.5 3 C24.5 8 23 13 19.5 16.5 C16 20 10 21 4 25 Z" fill="${c}" stroke="rgba(0,0,0,.6)" stroke-width="1.5" stroke-linejoin="round"/>` +
      `<path d="M6.5 22.5 C11 18.5 15 13.5 22 6" fill="none" stroke="rgba(0,0,0,.5)" stroke-width="1.3"/>`,
  },
  /**
   * Hotspot on the BIT — the toothed end that does the work — rather than the bow you hold. A key
   * anchored at its ring would point with the wrong end, which is the same mistake as anchoring a
   * pen by its cap.
   */
  key: {
    hot: [3, 24],
    body: (c) =>
      `<path d="M3 24 L13.5 13.5" stroke="rgba(0,0,0,.65)" stroke-width="5" stroke-linecap="round"/>` +
      `<path d="M3 24 L13.5 13.5" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>` +
      `<path d="M5.5 21.5 L8 24 M8.5 18.5 L11 21" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/>` +
      `<circle cx="18.5" cy="8.5" r="5.6" fill="none" stroke="rgba(0,0,0,.6)" stroke-width="4.4"/>` +
      `<circle cx="18.5" cy="8.5" r="5.6" fill="none" stroke="${c}" stroke-width="2.4"/>`,
  },
  /**
   * Hotspot at the TIP of the flame, where it tapers — the widest part is the base, and pointing
   * with a base is like pointing with the back of your hand.
   */
  flame: {
    hot: [14, 2],
    body: (c) =>
      `<path d="M14 2 C17 7 20 9 21.5 13 A8 8 0 1 1 6.5 13 C8 10 10.5 9.5 11.5 6.5 C12.6 9 13.4 9.6 14 2 Z" fill="${c}" stroke="rgba(0,0,0,.62)" stroke-width="1.5" stroke-linejoin="round"/>` +
      `<path d="M14 12 C15.6 14.6 16.6 15.8 16.6 17.6 A2.7 2.7 0 1 1 11.4 17.6 C11.4 15.8 12.4 14.6 14 12 Z" fill="rgba(0,0,0,.35)"/>`,
  },
  /** Symmetrical like Diamond, so the pupil is both the middle and the point. */
  eye: {
    hot: [14, 14],
    body: (c) =>
      `<path d="M2.5 14 C6 8.5 10 6 14 6 C18 6 22 8.5 25.5 14 C22 19.5 18 22 14 22 C10 22 6 19.5 2.5 14 Z" fill="${c}" stroke="rgba(0,0,0,.62)" stroke-width="1.5" stroke-linejoin="round"/>` +
      `<circle cx="14" cy="14" r="4.2" fill="rgba(0,0,0,.72)"/>` +
      `<circle cx="14" cy="14" r="1.6" fill="${c}"/>`,
  },
  /** Nose first, like Arrow — a rocket anchored at its fins would point with its exhaust. */
  rocket: {
    hot: [14, 2],
    body: (c) =>
      `<path d="M14 2 C18 6 20 11 20 16 L20 21 L8 21 L8 16 C8 11 10 6 14 2 Z" fill="${c}" stroke="rgba(0,0,0,.62)" stroke-width="1.5" stroke-linejoin="round"/>` +
      `<path d="M8 16 L4 22 L8 21 Z M20 16 L24 22 L20 21 Z" fill="${c}" stroke="rgba(0,0,0,.6)" stroke-width="1.3" stroke-linejoin="round"/>` +
      `<circle cx="14" cy="12" r="2.6" fill="rgba(0,0,0,.55)"/>` +
      `<path d="M11.5 21 L14 26 L16.5 21 Z" fill="rgba(0,0,0,.45)"/>`,
  },
  /** Anchored on the centre spike, which is the tallest point and the one the eye tracks. */
  crown: {
    hot: [14, 3],
    body: (c) =>
      `<path d="M4 22 L5.5 9 L10 14.5 L14 3 L18 14.5 L22.5 9 L24 22 Z" fill="${c}" stroke="rgba(0,0,0,.62)" stroke-width="1.5" stroke-linejoin="round"/>` +
      `<path d="M4.5 19 H23.5" stroke="rgba(0,0,0,.4)" stroke-width="1.4"/>`,
  },
  /** Six-fold and symmetrical, so the hotspot is its middle — the same reasoning as Diamond. */
  snowflake: {
    hot: [14, 14],
    body: (c) =>
      `<g stroke="rgba(0,0,0,.55)" stroke-width="4" stroke-linecap="round">` +
      `<path d="M14 3 V25 M4.5 8.5 L23.5 19.5 M4.5 19.5 L23.5 8.5"/></g>` +
      `<g stroke="${c}" stroke-width="2" stroke-linecap="round">` +
      `<path d="M14 3 V25 M4.5 8.5 L23.5 19.5 M4.5 19.5 L23.5 8.5"/>` +
      `<path d="M14 7 L11 4.5 M14 7 L17 4.5 M14 21 L11 23.5 M14 21 L17 23.5"/></g>`,
  },
  /**
   * Hotspot at the top RING, not the fluke. An anchor hangs from its ring, so that is where the
   * eye reads it as being held — the flukes are the far end of the object.
   */
  anchor: {
    hot: [14, 3],
    body: (c) =>
      `<circle cx="14" cy="5.5" r="3.2" fill="none" stroke="rgba(0,0,0,.6)" stroke-width="4"/>` +
      `<circle cx="14" cy="5.5" r="3.2" fill="none" stroke="${c}" stroke-width="2"/>` +
      `<path d="M14 8.5 V24" stroke="rgba(0,0,0,.6)" stroke-width="4.4" stroke-linecap="round"/>` +
      `<path d="M14 8.5 V24" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/>` +
      `<path d="M8 12 H20" stroke="rgba(0,0,0,.6)" stroke-width="4" stroke-linecap="round"/>` +
      `<path d="M8 12 H20" stroke="${c}" stroke-width="2" stroke-linecap="round"/>` +
      `<path d="M5 18 C5 23 9 25.5 14 25.5 C19 25.5 23 23 23 18" fill="none" stroke="rgba(0,0,0,.6)" stroke-width="4" stroke-linecap="round"/>` +
      `<path d="M5 18 C5 23 9 25.5 14 25.5 C19 25.5 23 23 23 18" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round"/>`,
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
