/**
 * A custom palette, built from three colours.
 *
 * WHY THREE AND NOT TWENTY-TWO
 *
 * The built-in themes each set ~22 tokens, but they aren't 22 independent decisions — they're
 * three choices plus a set of relationships. `--panel` is the background lifted slightly toward
 * the text colour; `--border` is the text colour at 10% alpha; `--muted` is the text colour
 * pulled back toward the background. Handing someone 22 colour pickers would be a wall of
 * jargon and most combinations would look broken. Handing them three and deriving the rest from
 * the same relationships the real themes use means every palette is coherent by construction.
 *
 * The one token that is NOT a free choice is `--btn-text`, the colour printed on top of the
 * accent. Picking it by eye is how the alt theme ended up at 3.36:1 — below the 4.5:1 that
 * normal text needs. Here it's computed: black or white, whichever contrasts better with the
 * accent the user chose. That failure mode is now unreachable.
 */

export type PaletteSeed = {
  bg: string
  text: string
  accent: string
}

export const DEFAULT_SEED: PaletteSeed = { bg: '#08080f', text: '#eeeef8', accent: '#22c55e' }

const KEY = 'theme.custom.v1'
const SAVED_KEY = 'theme.custom.saved.v1'

/** A palette the user made and kept, under a name they chose. */
export type SavedPalette = { name: string; seed: PaletteSeed }

export function loadSavedPalettes(): SavedPalette[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY)
    const list = raw ? (JSON.parse(raw) as SavedPalette[]) : []
    return Array.isArray(list)
      ? list
          .filter((p) => p && typeof p.name === 'string' && parseHex(p.seed?.bg ?? ''))
          .slice(0, 24)
      : []
  } catch {
    return []
  }
}

export function writeSavedPalettes(list: SavedPalette[]) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(list.slice(0, 24)))
  } catch {
    /* private mode — it just won't persist */
  }
}

/* ── colour maths ───────────────────────────────────────────────────────── */

type RGB = { r: number; g: number; b: number }

export function parseHex(hex: string): RGB | null {
  const h = hex.trim().replace(/^#/, '')
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  }
}

const toHex = ({ r, g, b }: RGB) =>
  '#' +
  [r, g, b]
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')

/** `amount` 0 = all of `a`, 1 = all of `b`. Plain sRGB mixing, which is what the hand-written
 *  themes effectively did, so derived surfaces land where the originals sit. */
function mix(a: RGB, b: RGB, amount: number): RGB {
  return {
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
  }
}

const rgba = ({ r, g, b }: RGB, alpha: number) => `rgba(${r}, ${g}, ${b}, ${alpha})`

/** Relative luminance, per WCAG. */
function luminance({ r, g, b }: RGB): number {
  const ch = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
}

/** WCAG contrast ratio, 1–21. */
export function contrast(a: string, b: string): number {
  const ra = parseHex(a)
  const rb = parseHex(b)
  if (!ra || !rb) return 1
  const la = luminance(ra)
  const lb = luminance(rb)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * AA for normal text is 4.5:1. 3:1 only passes for large text (24px, or 18.7px bold) and for
 * the boundaries of UI components — which is exactly the distinction that makes "it looked
 * fine" and "it passes" different answers.
 */
export function rate(ratio: number): 'aa' | 'large' | 'fail' {
  if (ratio >= 4.5) return 'aa'
  if (ratio >= 3) return 'large'
  return 'fail'
}

/** Black or white on top of `bg`, whichever a reader can actually see. */
export function readableOn(bg: string): string {
  return contrast('#ffffff', bg) >= contrast('#0b0f19', bg) ? '#ffffff' : '#0b0f19'
}

/* ── HSL, for the picker ────────────────────────────────────────────────── */

export type HSL = { h: number; s: number; l: number }

/** h 0–360, s/l 0–1. */
export function hexToHsl(hex: string): HSL {
  const c = parseHex(hex) ?? { r: 0, g: 0, b: 0 }
  const r = c.r / 255
  const g = c.g / 255
  const b = c.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  return { h, s, l }
}

export function hslToHex({ h, s, l }: HSL): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hh = ((h % 360) + 360) % 360
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1))
  const m = l - c / 2
  const seg = Math.floor(hh / 60) % 6
  const table: Array<[number, number, number]> = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ]
  const [r, g, b] = table[seg]
  return toHex({ r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 })
}

/* ── the framework ──────────────────────────────────────────────────────── */

/**
 * Expand three colours into the full token set, using the same relationships the built-in
 * themes use. Returns CSS custom properties ready to be written onto an element.
 */
export function derivePalette(seed: PaletteSeed): Record<string, string> {
  const bg = parseHex(seed.bg) ?? parseHex(DEFAULT_SEED.bg)!
  const text = parseHex(seed.text) ?? parseHex(DEFAULT_SEED.text)!
  const accentHex = parseHex(seed.accent) ? seed.accent : DEFAULT_SEED.accent

  // Surfaces: the background lifted toward the text colour by increasing amounts. This is the
  // one relationship that makes a palette feel like a system rather than a set of colours.
  const lift = (amount: number) => toHex(mix(bg, text, amount))

  return {
    '--bg': toHex(bg),
    '--bg-grad1': lift(0.05),
    '--panel': lift(0.08),
    '--card2': lift(0.1),
    '--b1': lift(0.12),
    '--b2': lift(0.18),
    '--text': toHex(text),
    // far enough back to read as secondary, near enough to stay legible — the built-in themes
    // sit around 8:1 against their background and this lands in the same place
    '--muted': toHex(mix(text, bg, 0.42)),
    '--accent': accentHex,
    // A second accent for the few places that need contrast against the first. Rotating hue is
    // enough: it stays in the family without asking the user for a fourth decision.
    '--accent-2': rotateHue(accentHex, 150),
    /**
     * ⚠️ THE FLAIR RAMP — five colours where the effects used to have two.
     *
     * Click flairs, mouse trails and animated backgrounds all read their colours off the
     * document, and all any of them could find was the accent pair. Every effect on the site
     * therefore drew in the same two hues, which is most of why a dozen distinct flairs read as
     * variations on one thing: the eye takes the colour before it takes the shape.
     *
     * DERIVED FROM THE ACCENT, never asked for. A ramp the person has to choose is a fifth
     * decision on top of three, and the whole design of this file is that you pick one colour and
     * everything else follows. Rotating the hue by a little (+/-35°) gives neighbours that always
     * agree with the accent, and the existing +150° second accent gives one that deliberately
     * does not — so the ramp has both harmony and contrast without a chance of clashing, whatever
     * accent somebody picks.
     *
     * Ordered so ADJACENT stops are close: an effect that walks the ramp gets a gradient, and one
     * that picks at random still never lands on two colours that fight.
     */
    '--fx-0': rotateHue(accentHex, -35),
    '--fx-1': accentHex,
    '--fx-2': rotateHue(accentHex, 35),
    '--fx-3': rotateHue(accentHex, 105),
    '--fx-4': rotateHue(accentHex, 150),
    // computed, never chosen — see the note at the top of this file
    '--btn-text': readableOn(accentHex),
    '--surface': `linear-gradient(180deg, ${rgba(text, 0.025)}, ${rgba(text, 0)})`,
    '--border': rgba(text, 0.1),
    '--border-strong': rgba(text, 0.17),
    '--nav-bg': rgba(bg, 0.72),
    '--nav-current-bg': rgba(text, 0.08),
    '--control-bg': rgba(text, 0.06),
    '--icon-bg': rgba(text, 0.06),
    '--icon-bg-hover': rgba(text, 0.1),
    '--icon-border': rgba(text, 0.09),
    '--icon-border-hover': rgba(text, 0.16),
  }
}

/**
 * Move a colour away from the accent — by hue where that works, by lightness where it cannot.
 *
 * ⚠️ ROTATING THE HUE OF A GREY DOES NOTHING. White, black and any grey have no saturation to
 * carry a hue, so hslToHex hands back the colour it was given. Every derived colour therefore
 * collapsed onto the accent: --accent-2 equalled --accent, and all five ramp stops were the same
 * value. Visibly, a white accent made the snake and the apple the same white — and the same for
 * black. The board still worked; you simply could not see what you were eating.
 *
 * It is not only the extremes. #8a8f8a has just enough saturation to satisfy a `s === 0` guard
 * and still produced five stops differing by three in one channel, which is identical to the eye.
 * So the correction FADES IN as saturation runs out rather than switching on at zero: full
 * lightness separation on a true grey, none at all by the time a colour is properly coloured, and
 * a smooth blend between, so dragging a saturation slider never jumps.
 *
 * The lightness spread is monotonic in `degrees` and moves AWAY from whichever end the accent
 * sits at — a white accent darkens, a black one lightens — so the stops stay ordered and none of
 * them clips into the wall it started against.
 */
function rotateHue(hex: string, degrees: number): string {
  if (!parseHex(hex)) return hex
  const { h, s, l } = hexToHsl(hex)
  // 0 when the colour is saturated enough for hue alone, 1 on a true grey
  const flat = Math.max(0, Math.min(1, 1 - s / 0.25))
  if (flat <= 0) return hslToHex({ h: h + degrees, s, l })
  /**
   * The rotations actually used run -35..150, mapped onto that span monotonically — with a
   * FLOOR, so the smallest one still moves.
   *
   * ⚠️ Without the 0.12 the -35 stop maps to zero shift and lands exactly on the untouched
   * accent, leaving four distinct colours where five were asked for. The failure is quiet: the
   * ramp still works, it just has a duplicate in it, and only a count catches that.
   */
  const p = 0.12 + 0.88 * Math.max(0, Math.min(1, (degrees + 35) / 185))
  const away = l > 0.5 ? -1 : 1
  const shifted = l + away * p * 0.45 * flat
  return hslToHex({ h: h + degrees, s, l: Math.max(0, Math.min(1, shifted)) })
}

/* ── applying and saving ────────────────────────────────────────────────── */

/**
 * Written as inline custom properties on <html>, which beats any `[data-theme]` block in the
 * stylesheet. That's deliberate: the palette then works without adding a CSS block for it, and
 * removing the properties falls straight back to whichever built-in theme is selected.
 */
export function applyPalette(seed: PaletteSeed | null) {
  const el = document.documentElement
  const tokens = derivePalette(DEFAULT_SEED)
  if (!seed) {
    Object.keys(tokens).forEach((k) => el.style.removeProperty(k))
    return
  }
  const next = derivePalette(seed)
  Object.entries(next).forEach(([k, v]) => el.style.setProperty(k, v))
}

export function loadPalette(): PaletteSeed | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<PaletteSeed>
    if (!p || !parseHex(p.bg ?? '') || !parseHex(p.text ?? '') || !parseHex(p.accent ?? '')) {
      return null
    }
    return { bg: p.bg!, text: p.text!, accent: p.accent! }
  } catch {
    return null
  }
}

export function savePalette(seed: PaletteSeed | null) {
  try {
    if (seed) localStorage.setItem(KEY, JSON.stringify(seed))
    else localStorage.removeItem(KEY)
  } catch {
    /* private mode — it just won't persist */
  }
}
