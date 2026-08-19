/**
 * What a person's page LOOKS like — their colour and their banner.
 *
 * Two problems this solves at once.
 *
 * 1. Every profile looked identical. The only visual identity was a first initial in a circle
 *    tinted `var(--accent)` — the SAME accent for everyone, because it's the site's colour, not
 *    theirs. Thirty-odd members, one look.
 * 2. The banner asked you to paste an image URL. The single banner anyone ever made has
 *    `url: "what"` saved in it — the field asked for something you can't guess, so it got a shrug
 *    and rendered nothing. Typing a URL is also the one customisation that can't be made safe or
 *    reliable: it loads a stranger's host (leaking every viewer's IP to it), and it 404s later.
 *
 * So: nothing is typed. A colour is DERIVED from who you are and is different for everyone before
 * anyone touches a setting, and a banner is PICKED from a set of generated looks. Both render from
 * CSS gradients alone — no uploads, no external requests, no storage, nothing to break.
 */

/** Stable small hash of a string — same input, same colour, on every device and every render. */
function hashOf(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

/**
 * Someone's own hue, derived from their username.
 *
 * Deterministic on purpose: it needs to be the same colour in the header, in a list and on
 * someone else's screen, without a lookup or a column. Derived rather than random so it never
 * changes under them either.
 *
 * ⚠️ QUANTISED TO 12 STOPS, not `hash % 360`. Raw hashes put real members 5° apart — measured
 * on the actual directory — and two hues that close don't read as "different colours", they read
 * as one colour rendered slightly wrong. With ~33 members you cannot hand out 33 distinguishable
 * hues anyway, so the honest choice is a repeat rather than a near-miss: any two people now
 * either clearly differ or plainly match.
 */
const HUE_STOPS = 12
export function hueFor(username: string): number {
  // offset so the stops aren't all dead-on primaries
  return (hashOf(username.toLowerCase()) % HUE_STOPS) * (360 / HUE_STOPS) + 15
}

/**
 * A second axis, so twelve hues don't mean twelve looks.
 *
 * Twelve stops across ~33 members collides constantly (three pairs in the first eight, measured).
 * Depth multiplies the distinct looks to 36 WITHOUT narrowing the hue gaps — the thing that made
 * raw hashes unreadable. Two people can still land identical; that's fine and honest. What this
 * avoids is the confusing middle ground.
 */
const DEPTHS = [
  { from: 62, to: 48 },
  { from: 52, to: 38 },
  { from: 42, to: 28 },
] as const

/**
 * The avatar circle's colours.
 *
 * Fixed high saturation rather than anything theme-derived: this circle carries white text in
 * both light and dark mode, so its contrast can't be allowed to drift with the palette. A
 * gradient rather than a flat fill because a flat circle of arbitrary hue looks like a default,
 * and this is meant to look chosen.
 */
export function avatarStyle(username: string): React.CSSProperties {
  const h = hueFor(username)
  // a different slice of the hash from the one picking the hue, so the two axes don't correlate
  const d = DEPTHS[Math.floor(hashOf(username.toLowerCase()) / 97) % DEPTHS.length]
  return {
    background: `linear-gradient(140deg, hsl(${h} 72% ${d.from}%), hsl(${(h + 40) % 360} 70% ${d.to}%))`,
    color: '#fff',
  }
}

/**
 * The banner looks.
 *
 * Each is a pure CSS background built from ONE hue, so every style works in every colour and the
 * set stays coherent instead of becoming a pile of unrelated images. They're deliberately
 * different in kind — soft blobs, hard geometry, rings, rays — so the choice is real rather than
 * eight variations on a gradient.
 */
export const BANNER_STYLES = {
  aurora: {
    label: 'Aurora',
    css: (h: number) =>
      `radial-gradient(60% 120% at 20% 20%, hsl(${h} 80% 60% / 0.85), transparent 60%),` +
      `radial-gradient(50% 110% at 80% 30%, hsl(${(h + 60) % 360} 85% 55% / 0.8), transparent 60%),` +
      `radial-gradient(70% 130% at 50% 90%, hsl(${(h + 300) % 360} 75% 50% / 0.7), transparent 60%),` +
      `linear-gradient(160deg, hsl(${h} 45% 18%), hsl(${(h + 40) % 360} 50% 12%))`,
  },
  dusk: {
    label: 'Dusk',
    css: (h: number) =>
      `linear-gradient(180deg, hsl(${h} 70% 55%), hsl(${(h + 25) % 360} 65% 38%) 45%, hsl(${(h + 45) % 360} 60% 18%))`,
  },
  rays: {
    label: 'Rays',
    css: (h: number) =>
      `repeating-conic-gradient(from 200deg at 50% 120%, hsl(${h} 80% 58% / 0.9) 0deg 6deg, transparent 6deg 14deg),` +
      `linear-gradient(180deg, hsl(${(h + 20) % 360} 60% 22%), hsl(${h} 55% 14%))`,
  },
  grid: {
    label: 'Grid',
    css: (h: number) =>
      `repeating-linear-gradient(0deg, hsl(${h} 70% 70% / 0.22) 0 1px, transparent 1px 22px),` +
      `repeating-linear-gradient(90deg, hsl(${h} 70% 70% / 0.22) 0 1px, transparent 1px 22px),` +
      `linear-gradient(140deg, hsl(${h} 55% 24%), hsl(${(h + 40) % 360} 60% 14%))`,
  },
  bands: {
    label: 'Bands',
    css: (h: number) =>
      `repeating-linear-gradient(115deg, hsl(${h} 75% 55%) 0 26px, hsl(${(h + 30) % 360} 70% 45%) 26px 52px, hsl(${(h + 60) % 360} 65% 35%) 52px 78px)`,
  },
  bubbles: {
    label: 'Bubbles',
    css: (h: number) =>
      `radial-gradient(circle at 15% 70%, hsl(${h} 85% 62% / 0.9) 0 10%, transparent 10.5%),` +
      `radial-gradient(circle at 42% 28%, hsl(${(h + 45) % 360} 85% 58% / 0.85) 0 7%, transparent 7.5%),` +
      `radial-gradient(circle at 68% 75%, hsl(${(h + 90) % 360} 80% 60% / 0.8) 0 12%, transparent 12.5%),` +
      `radial-gradient(circle at 88% 35%, hsl(${(h + 20) % 360} 85% 55% / 0.9) 0 6%, transparent 6.5%),` +
      `linear-gradient(150deg, hsl(${h} 50% 20%), hsl(${(h + 50) % 360} 55% 12%))`,
  },
  rings: {
    label: 'Rings',
    css: (h: number) =>
      `repeating-radial-gradient(circle at 30% 120%, hsl(${h} 80% 62% / 0.55) 0 14px, transparent 14px 34px),` +
      `linear-gradient(140deg, hsl(${(h + 30) % 360} 55% 22%), hsl(${h} 60% 12%))`,
  },
  ember: {
    label: 'Ember',
    css: (h: number) =>
      `radial-gradient(120% 100% at 50% 130%, hsl(${h} 95% 62%), hsl(${(h + 25) % 360} 85% 45%) 35%, hsl(${(h + 45) % 360} 70% 18%) 70%, hsl(${(h + 50) % 360} 60% 8%))`,
  },
} as const

export type BannerStyle = keyof typeof BANNER_STYLES

/** Not exported: the only thing that should ever read a raw config is bannerBackground below,
 *  which is what everything else calls. */
const isBannerStyle = (v: unknown): v is BannerStyle => typeof v === 'string' && v in BANNER_STYLES

/**
 * Resolve a banner block's saved config into a background.
 *
 * Falls back to the person's own derived hue when they never picked one, which is what makes
 * "add a banner" produce something that already looks like theirs with zero further choices.
 */
export function bannerBackground(
  config: Record<string, unknown>,
  username: string,
): { background: string; style: BannerStyle; hue: number } {
  const style: BannerStyle = isBannerStyle(config.style) ? config.style : 'aurora'
  const hue =
    typeof config.hue === 'number' && config.hue >= 0 && config.hue < 360
      ? config.hue
      : hueFor(username)
  return { background: BANNER_STYLES[style].css(hue), style, hue }
}
