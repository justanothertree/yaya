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
const SCALE_KEY = { size: 'effect_size_v1', speed: 'effect_speed_v1' } as const
export type ScaleKind = keyof typeof SCALE_KEY

const scales: Record<ScaleKind, number> = { size: 1, speed: 1 }

try {
  for (const k of Object.keys(scales) as ScaleKind[]) {
    const v = Number(localStorage.getItem(SCALE_KEY[k]))
    if (Number.isFinite(v) && v >= 0.5 && v <= 2.5) scales[k] = v
  }
} catch {
  /* private mode — the defaults are the old behaviour */
}

export function effectScale(kind: ScaleKind): number {
  return scales[kind]
}

export function setEffectScale(kind: ScaleKind, v: number) {
  scales[kind] = Math.min(2.5, Math.max(0.5, v))
  try {
    localStorage.setItem(SCALE_KEY[kind], String(scales[kind]))
  } catch {
    /* applies for this visit */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT))
}

/** A duration, divided by the speed dial — faster means shorter, which is the intuitive direction. */
export function dur(ms: number): number {
  return Math.max(60, Math.round(ms / scales.speed))
}

/** A pixel size or distance, multiplied by the size dial. */
export function px(n: number): number {
  return n * scales.size
}
