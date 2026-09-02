import { BACKDROPS, type BackdropId } from '../profile/backdrops'
import { loadPalette, savePalette, type PaletteSeed } from '../theme/customTheme'
import {
  AMOUNT_LEVELS,
  amountLevel,
  effectScale,
  setAmountLevel,
  setEffectScale,
  type AmountLevel,
  type EffectCategory,
} from './effectAmount'
import { CURSOR_IDS, type CursorSkin } from './cursorSkin'
import { FX_STYLES } from './fxStyles'
import type { FxStyle } from './clickFx'
import { TRAIL_IDS, type TrailStyle } from './mouseTrail'

/**
 * A whole appearance, kept as one thing.
 *
 * ⚠️ THE PROBLEM THIS SOLVES IS NOT "NOT ENOUGH CHOICE". There are 33 click effects, 29 trails,
 * 28 pointers, 19 backgrounds and 28 palettes — around fourteen million combinations — and every
 * one of them was stored in its own separate key with no notion that they belonged together.
 * Three things followed from that, and all three are worse than any missing option:
 *
 *   - trying something COST you what you had, because there was no way back but memory
 *   - a combination you liked died the next time you touched anything
 *   - nobody would ever find most of it, because fourteen million is not a browsable number
 *
 * A Look is those settings under one name. It makes the range usable rather than larger, which is
 * why it is worth more than the next twenty options would be.
 *
 * ⚠️ CAPTURE AND APPLY ARE DEFINED TOGETHER, ON PURPOSE. They are exact opposites, and the way
 * this goes wrong is one of them learning about a new setting and the other not — you would save
 * a Look, load it, and quietly get the old cursor back with no error anywhere. Keeping them in one
 * file, adjacent, is what makes that omission obvious while it is being written.
 */

export type Look = {
  v: 1
  name: string
  theme: 'light' | 'dark' | 'alt'
  /** the custom palette, or null for the theme's own colours */
  palette: PaletteSeed | null
  background: BackdropId
  /** null means clicks do nothing */
  click: FxStyle | null
  trail: TrailStyle
  cursor: CursorSkin
  amounts: Record<EffectCategory, AmountLevel>
  size: Record<EffectCategory, number>
  speed: Record<EffectCategory, number>
}

/** What the dialog already owns, so applying a Look goes through the same setters a click does. */
export type LookControls = {
  onTheme: (t: 'light' | 'dark' | 'alt') => void
  onCustomPalette: (on: boolean) => void
  onBackground: (b: BackdropId) => void
  sparksOn: boolean
  onToggleSparks: () => void
  onSparksStyle: (s: FxStyle) => void
  onTrailStyle: (t: TrailStyle) => void
  setCursor: (c: CursorSkin) => void
}

const CATS: EffectCategory[] = ['click', 'background', 'trail']
const THEMES = ['light', 'dark', 'alt'] as const
const AMOUNTS = AMOUNT_LEVELS.map(([id]) => id)

const pick = <T>(list: readonly T[], v: unknown, fallback: T): T =>
  (list as readonly unknown[]).includes(v) ? (v as T) : fallback

const clamp = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d

/**
 * Read a Look from anywhere — storage, a starter, one day somebody else's profile — without ever
 * throwing.
 *
 * ⚠️ Every field is checked against the list the UI actually offers rather than merely being
 * type-cast. A Look is a plausible thing to paste to a friend, and a pasted one naming a cursor
 * that does not exist must land on the default rather than leaving the page with no pointer.
 */
export function readLook(v: unknown): Look | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const name = typeof o.name === 'string' ? o.name.slice(0, 40).trim() : ''
  if (!name) return null
  const amounts = (o.amounts ?? {}) as Record<string, unknown>
  const size = (o.size ?? {}) as Record<string, unknown>
  const speed = (o.speed ?? {}) as Record<string, unknown>
  const seed = o.palette as Partial<PaletteSeed> | null | undefined
  const hex = /^#[0-9a-fA-F]{6}$/
  const palette =
    seed &&
    hex.test(String(seed.bg)) &&
    hex.test(String(seed.text)) &&
    hex.test(String(seed.accent))
      ? { bg: seed.bg as string, text: seed.text as string, accent: seed.accent as string }
      : null

  return {
    v: 1,
    name,
    theme: pick(THEMES, o.theme, 'dark'),
    palette,
    background: pick(
      BACKDROPS.map(([id]) => id),
      o.background,
      'none',
    ),
    click: o.click === null ? null : pick(FX_STYLES, o.click, 'sparks'),
    trail: pick(TRAIL_IDS, o.trail, 'none'),
    cursor: pick(CURSOR_IDS, o.cursor, 'system'),
    amounts: Object.fromEntries(
      CATS.map((c) => [c, pick(AMOUNTS, amounts[c], 'normal')]),
    ) as Look['amounts'],
    size: Object.fromEntries(CATS.map((c) => [c, clamp(size[c], 0.4, 2.2, 1)])) as Look['size'],
    speed: Object.fromEntries(CATS.map((c) => [c, clamp(speed[c], 0.4, 2.2, 1)])) as Look['speed'],
  }
}

/** Everything the page currently looks like, as one object. */
export function captureLook(
  name: string,
  now: {
    theme: Look['theme']
    customPalette: boolean
    background: BackdropId
    sparksOn: boolean
    sparksStyle: FxStyle
    trailStyle: TrailStyle
    cursor: CursorSkin
  },
): Look {
  return {
    v: 1,
    name: name.slice(0, 40).trim() || 'Untitled',
    theme: now.theme,
    palette: now.customPalette ? loadPalette() : null,
    background: now.background,
    click: now.sparksOn ? now.sparksStyle : null,
    trail: now.trailStyle,
    cursor: now.cursor,
    amounts: Object.fromEntries(CATS.map((c) => [c, amountLevel(c)])) as Look['amounts'],
    size: Object.fromEntries(CATS.map((c) => [c, effectScale(c, 'size')])) as Look['size'],
    speed: Object.fromEntries(CATS.map((c) => [c, effectScale(c, 'speed')])) as Look['speed'],
  }
}

/**
 * Put a Look on the page.
 *
 * ⚠️ Through the SETTERS the dialog already uses, never by writing storage directly. Half of these
 * are React state as well as a stored value, and a Look that wrote localStorage would change the
 * page and leave every control in the panel showing the old answer until a reload.
 */
export function applyLook(look: Look, c: LookControls) {
  /* the palette has to be written before the flag that switches it on, or the theme turns custom
     and reads whatever seed happened to be there from last time */
  if (look.palette) savePalette(look.palette)
  c.onTheme(look.theme)
  c.onCustomPalette(!!look.palette)
  c.onBackground(look.background)
  if (look.click) {
    c.onSparksStyle(look.click)
    if (!c.sparksOn) c.onToggleSparks()
  } else if (c.sparksOn) {
    c.onToggleSparks()
  }
  c.onTrailStyle(look.trail)
  c.setCursor(look.cursor)
  for (const cat of CATS) {
    setAmountLevel(cat, look.amounts[cat])
    setEffectScale(cat, 'size', look.size[cat])
    setEffectScale(cat, 'speed', look.speed[cat])
  }
}

/**
 * Looks that ship with the site.
 *
 * ⚠️ These exist to be DISCOVERY, not decoration. Fourteen million combinations means nobody was
 * ever going to meet Carbon with Fog and a Magnet click by clicking around; a starter is the only
 * realistic way most of what has been built gets seen at all. Each one deliberately reaches for
 * options a person is unlikely to pair by accident.
 */
export const STARTERS: Look[] = [
  {
    v: 1,
    name: 'Deep sea',
    theme: 'dark',
    palette: { bg: '#06122a', text: '#cfe9f5', accent: '#1696a8' },
    background: 'bubbles',
    click: 'ink',
    trail: 'rise',
    cursor: 'dot',
    amounts: { click: 'normal', background: 'subtle', trail: 'normal' },
    size: { click: 1, background: 1.2, trail: 1 },
    speed: { click: 0.8, background: 0.6, trail: 0.8 },
  },
  {
    v: 1,
    name: 'Workshop',
    theme: 'light',
    palette: { bg: '#f4f1ea', text: '#2a2622', accent: '#a2521f' },
    background: 'fog',
    click: 'dust',
    trail: 'pencil' as TrailStyle,
    cursor: 'pen',
    amounts: { click: 'subtle', background: 'subtle', trail: 'subtle' },
    size: { click: 0.9, background: 1, trail: 0.9 },
    speed: { click: 1, background: 0.7, trail: 1 },
  },
  {
    v: 1,
    name: 'Arcade',
    theme: 'dark',
    palette: { bg: '#0d0320', text: '#ffe8ff', accent: '#e82894' },
    background: 'grid',
    click: 'pixels',
    trail: 'grid',
    cursor: 'pixel',
    amounts: { click: 'lots', background: 'normal', trail: 'normal' },
    size: { click: 1, background: 1, trail: 1 },
    speed: { click: 1.4, background: 1.2, trail: 1.3 },
  },
  {
    v: 1,
    name: 'Night garden',
    theme: 'dark',
    palette: { bg: '#0a1410', text: '#dff2e4', accent: '#5a9e34' },
    background: 'fireflies' as BackdropId,
    click: 'bloom',
    trail: 'fireflies',
    cursor: 'leaf',
    amounts: { click: 'normal', background: 'normal', trail: 'subtle' },
    size: { click: 1.1, background: 1, trail: 1 },
    speed: { click: 0.7, background: 0.6, trail: 0.7 },
  },
  {
    v: 1,
    name: 'Ink and paper',
    theme: 'light',
    palette: { bg: '#faf8f3', text: '#171512', accent: '#171512' },
    background: 'none',
    click: 'ink',
    trail: 'ink',
    cursor: 'nib' as CursorSkin,
    amounts: { click: 'subtle', background: 'subtle', trail: 'subtle' },
    size: { click: 1, background: 1, trail: 1.1 },
    speed: { click: 1, background: 1, trail: 0.9 },
  },
  {
    v: 1,
    name: 'Storm front',
    theme: 'dark',
    palette: { bg: '#101418', text: '#e8eef8', accent: '#8fa6c8' },
    background: 'rain',
    click: 'lightning',
    trail: 'rain',
    cursor: 'bolt',
    amounts: { click: 'normal', background: 'lots', trail: 'normal' },
    size: { click: 1.1, background: 1, trail: 1 },
    speed: { click: 1.3, background: 1.4, trail: 1.3 },
  },
  {
    v: 1,
    name: 'Carbon',
    theme: 'dark',
    palette: { bg: '#0e0e10', text: '#d2d2d8', accent: '#ff6030' },
    background: 'fog',
    click: 'magnet',
    trail: 'wire',
    cursor: 'target',
    amounts: { click: 'subtle', background: 'subtle', trail: 'normal' },
    size: { click: 1, background: 1.3, trail: 1 },
    speed: { click: 1, background: 0.5, trail: 1.1 },
  },
  {
    v: 1,
    name: 'Party',
    theme: 'dark',
    palette: { bg: '#1a0a24', text: '#ffeaf6', accent: '#ffa820' },
    background: 'confetti',
    click: 'balloons',
    trail: 'confetti',
    cursor: 'crown',
    amounts: { click: 'lots', background: 'normal', trail: 'lots' },
    size: { click: 1.2, background: 1, trail: 1 },
    speed: { click: 1.2, background: 1, trail: 1.2 },
  },
].map((l) => readLook(l) as Look)

/**
 * Something completely random, which is the only other way to meet fourteen million combinations.
 *
 * ⚠️ Amounts and speeds are NOT randomised to their extremes. A shuffle that can hand somebody
 * "lots" of everything at double speed produces a page they will immediately turn off, and the
 * point of the button is to be pressed repeatedly.
 */
export function randomLook(name = 'Surprise'): Look {
  const any = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]
  const moderate = () => any(['subtle', 'normal'] as AmountLevel[])
  return readLook({
    v: 1,
    name,
    theme: any(THEMES),
    palette: null,
    background: any(BACKDROPS.map(([id]) => id)),
    click: any(FX_STYLES),
    trail: any(TRAIL_IDS.filter((t) => t !== 'none')),
    cursor: any(CURSOR_IDS),
    amounts: { click: moderate(), background: moderate(), trail: moderate() },
    size: { click: 1, background: 1, trail: 1 },
    speed: { click: 1, background: 1, trail: 1 },
  }) as Look
}

// ── the ones you save ───────────────────────────────────────────────────────
const KEY = 'looks_v1'
const MAX = 24

let mine: Look[] = read()
const listeners = new Set<() => void>()

function read(): Look[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const list = JSON.parse(raw)
    return Array.isArray(list) ? (list.map(readLook).filter(Boolean) as Look[]).slice(0, MAX) : []
  } catch {
    return []
  }
}

function write(next: Look[]) {
  mine = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* private mode — they last for this visit */
  }
  listeners.forEach((l) => l())
}

export const myLooks = () => mine
export function subscribeLooks(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Saving under a name that already exists replaces it, which is what "save" means everywhere. */
export function saveLook(look: Look) {
  const without = mine.filter((l) => l.name.toLowerCase() !== look.name.toLowerCase())
  write([look, ...without].slice(0, MAX))
}

export function removeLook(name: string) {
  write(mine.filter((l) => l.name !== name))
}
