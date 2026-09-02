import type { FxStyle } from './clickFx'

/**
 * Every click flair, with the label and glyph it is offered under.
 *
 * ⚠️ ONE LIST, because there are now two pickers — the cog and the profile look editor — and a
 * style that exists in one but not the other is a style half the site cannot choose. The same
 * trap as the relay's sanitizeSettings allowlist, where a setting missing from one side did not
 * half-work, it silently reverted.
 *
 * Its own module rather than an export from either picker: react-refresh/only-export-components
 * will not let a component file export a constant, and importing it from a component would drag
 * that component into the other's chunk.
 */
export const FX_STYLE_OPTIONS: Array<[FxStyle, string, string]> = [
  ['sparks', '✨', 'Sparks'],
  ['sonar', '◎', 'Sonar'],
  ['pop', '🎊', 'Pop'],
  ['rocket', '🚀', 'Rocket'],
  ['stars', '★', 'Stars'],
  ['hearts', '❤', 'Hearts'],
  ['bubbles', '🫧', 'Bubbles'],
  ['glitter', '✦', 'Glitter'],
  ['shatter', '△', 'Shatter'],
  ['ink', '💧', 'Ink'],
  ['orbit', '⟳', 'Orbit'],
  ['beam', '☀', 'Beam'],
  ['splash', '💦', 'Splash'],
  ['slash', '🗡', 'Slash'],
  ['implode', '🕳', 'Implode'],
  ['bloom', '🌸', 'Bloom'],
  ['dust', '🌬', 'Dust'],
  ['notes', '🎵', 'Notes'],
  ['snow', '❄', 'Snow'],
  ['vortex', '🌀', 'Vortex'],
  ['firework', '🎆', 'Firework'],
]

/** The style ids alone, for anywhere that only needs to cycle or validate them. */
export const FX_STYLES: FxStyle[] = FX_STYLE_OPTIONS.map(([s]) => s)
