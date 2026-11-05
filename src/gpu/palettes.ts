import { hue } from './fluid'

/**
 * What a stroke is painted in, shared by every Lab demo that paints: a hue that wanders as you
 * draw, or one that stays near a family. `at` takes seconds, so a stroke drifts through its
 * palette as it goes rather than being one flat colour.
 */
export const PALETTES = {
  rainbow: { name: 'Rainbow', at: (t: number) => hue(t * 0.15) },
  fire: { name: 'Fire', at: (t: number) => hue(0.02 + 0.08 * (0.5 + 0.5 * Math.sin(t * 2))) },
  sea: { name: 'Sea', at: (t: number) => hue(0.5 + 0.12 * (0.5 + 0.5 * Math.sin(t * 1.5))) },
  ink: { name: 'Ink', at: () => [0.8, 0.8, 0.85] as [number, number, number] },
} as const
export type Palette = keyof typeof PALETTES
export const PALETTE_IDS = Object.keys(PALETTES) as Palette[]
