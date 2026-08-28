/**
 * How much of an effect you get — one dial, three categories.
 *
 * ⚠️ NOT a fourth list of styles. Every effect already answers "which one"; this answers "how
 * much of it", which is the question people actually ask second — a trail that is perfect at a
 * glance is a smear when you are reading, and a background that reads as texture on a laptop is
 * noise on a small window. Picking a style you like and then turning it down is a different
 * decision from picking a quieter style, and both are reasonable.
 *
 * Three levels rather than a slider. A slider invites fiddling with a number nobody can name, and
 * the difference between 0.82 and 0.86 of a particle count is not a thing anyone can see; three
 * named steps are a choice you can make once and be done with.
 *
 * ⚠️ The multiplier is applied at the point the count or spacing is DECIDED, never to a value
 * that has already been clamped — otherwise "subtle" on a phone lands under the floor that keeps
 * an effect visible at all, and the setting silently becomes an off switch.
 */

export type EffectCategory = 'click' | 'background' | 'trail'
export type AmountLevel = 'subtle' | 'normal' | 'lots'

export const AMOUNT_LEVELS: Array<[AmountLevel, string]> = [
  ['subtle', 'Subtle'],
  ['normal', 'Normal'],
  ['lots', 'Lots'],
]

/** What each level multiplies a count by. Trail spacing divides by it instead — see spacingFor. */
const FACTOR: Record<AmountLevel, number> = {
  subtle: 0.5,
  normal: 1,
  lots: 1.8,
}

const KEY: Record<EffectCategory, string> = {
  click: 'amount_click_v1',
  background: 'amount_background_v1',
  trail: 'amount_trail_v1',
}

const EVENT = 'yaya:effect-amount'

const current: Record<EffectCategory, AmountLevel> = {
  click: 'normal',
  background: 'normal',
  trail: 'normal',
}

function isLevel(v: unknown): v is AmountLevel {
  return v === 'subtle' || v === 'normal' || v === 'lots'
}

// read once at module load; the setter keeps this in step afterwards
try {
  for (const cat of Object.keys(current) as EffectCategory[]) {
    const saved = localStorage.getItem(KEY[cat])
    if (isLevel(saved)) current[cat] = saved
  }
} catch {
  /* private mode — the defaults are right anyway */
}

export function amountLevel(cat: EffectCategory): AmountLevel {
  return current[cat]
}

export function setAmountLevel(cat: EffectCategory, level: AmountLevel) {
  current[cat] = level
  try {
    localStorage.setItem(KEY[cat], level)
  } catch {
    /* applies for this visit */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT))
}

export function onAmountChange(fn: () => void): () => void {
  window.addEventListener(EVENT, fn)
  return () => window.removeEventListener(EVENT, fn)
}

/** Scale a particle COUNT. Always leaves at least one, so "subtle" never means "off". */
export function amount(cat: EffectCategory, n: number): number {
  return Math.max(1, Math.round(n * FACTOR[current[cat]]))
}

/**
 * Scale a trail SPACING — inverted, because spacing is the reciprocal of density.
 *
 * More of an effect means particles closer together, so the multiplier divides here. Getting this
 * backwards is the obvious bug and it would be almost invisible: "lots" would simply look sparse
 * rather than wrong.
 */
export function spacingFor(px: number): number {
  return Math.max(3, Math.round(px / FACTOR[current.trail]))
}

/**
 * The two dials that are genuinely continuous: SIZE and SPEED.
 *
 * ⚠️ Sliders here and named steps for "how much", on purpose. How much of an effect is a choice
 * you make once — three steps is enough and a slider would invite fiddling. Size and speed are
 * different: they are the ones you actually want to nudge until a trail feels right under your
 * own hand, and there is no set of three names that covers "slightly bigger".
 *
 * Both are multipliers around 1, so the stored default is the current behaviour exactly and an
 * untouched setting can never change how anything already looks.
 */
export type ScaleKind = 'size' | 'speed'

/**
 * ⚠️ ONE PAIR PER CATEGORY, not one pair for everything.
 *
 * These started shared, on the reasoning that somebody who wants things bigger wants everything
 * bigger. That was wrong in practice: the three effects are different sizes of thing in different
 * places. A trail wants to be big and slow enough to wave around; a click wants to be quick or it
 * outstays the click; a background wants to be large and slow or it stops being a background. One
 * slider for all three means every setting is a compromise nobody asked for.
 *
 * Both are multipliers around 1, so an untouched dial is exactly the old behaviour.
 */
const SCALE_KEY = (cat: EffectCategory, kind: ScaleKind) => `effect_${kind}_${cat}_v2`
/** The shared keys these replaced. Read once, so an existing setting carries into all three. */
const LEGACY_KEY: Record<ScaleKind, string> = {
  size: 'effect_size_v1',
  speed: 'effect_speed_v1',
}

const scales: Record<EffectCategory, Record<ScaleKind, number>> = {
  click: { size: 1, speed: 1 },
  background: { size: 1, speed: 1 },
  trail: { size: 1, speed: 1 },
}

const okScale = (v: number) => Number.isFinite(v) && v >= 0.5 && v <= 2.5

try {
  // the old shared value first, so somebody who had set it keeps it everywhere…
  const legacy: Partial<Record<ScaleKind, number>> = {}
  for (const k of ['size', 'speed'] as ScaleKind[]) {
    const v = Number(localStorage.getItem(LEGACY_KEY[k]))
    if (okScale(v)) legacy[k] = v
  }
  for (const cat of Object.keys(scales) as EffectCategory[]) {
    for (const k of ['size', 'speed'] as ScaleKind[]) {
      // …then the per-category one on top, which is what they set since
      const v = Number(localStorage.getItem(SCALE_KEY(cat, k)))
      if (okScale(v)) scales[cat][k] = v
      else if (legacy[k] != null) scales[cat][k] = legacy[k]!
    }
  }
} catch {
  /* private mode — the defaults are the old behaviour */
}

export function effectScale(cat: EffectCategory, kind: ScaleKind): number {
  return scales[cat][kind]
}

export function setEffectScale(cat: EffectCategory, kind: ScaleKind, v: number) {
  scales[cat][kind] = Math.min(2.5, Math.max(0.5, v))
  try {
    localStorage.setItem(SCALE_KEY(cat, kind), String(scales[cat][kind]))
  } catch {
    /* applies for this visit */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT))
}

/**
 * The size and duration helpers, bound to one category.
 *
 * Returned as closures rather than taking a category argument at every call site: clickFx and
 * mouseTrail between them call px() and dur() about forty times, and threading a category through
 * all of those is forty chances to pass the wrong one. Each module binds once at the top and its
 * existing calls keep reading — but now they read that module's own dial.
 *
 * ⚠️ The closures read `scales` when CALLED, not when built. Capturing the number here instead
 * would freeze every effect at whatever the dial said on page load.
 */
export function scalesFor(cat: EffectCategory) {
  return {
    /** A pixel size or distance, multiplied by this category's size dial. */
    px: (n: number) => n * scales[cat].size,
    /** A duration, divided by the speed dial — faster means shorter, the intuitive direction. */
    dur: (ms: number) => Math.max(60, Math.round(ms / scales[cat].speed)),
  }
}
