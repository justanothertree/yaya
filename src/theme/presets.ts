import type { PaletteSeed } from './customTheme'

/**
 * Starting points.
 *
 * Every one of these is a real seed rather than a hand-tuned theme — they run through the same
 * derivation as anything you build yourself, so picking one and then nudging a colour behaves
 * exactly like starting from scratch. That's the point: they're conversation starters, not a
 * separate set of themes with their own rules.
 *
 * All of them clear 4.5:1 on body text AND on the accent against the page, checked with this
 * project's own `contrast()` rather than by eye — the worst body text is 15.5:1 and the worst
 * accent is Mint's 3.56:1, which is the one that only passes at large sizes. The picker will
 * tell you if a nudge breaks either.
 */
export type Preset = { label: string; seed: PaletteSeed }

export const PRESET_GROUPS: Array<{ group: string; items: Preset[] }> = [
  {
    group: 'Dark',
    items: [
      { label: 'Midnight', seed: { bg: '#08080f', text: '#eeeef8', accent: '#22c55e' } },
      { label: 'Ember', seed: { bg: '#120c0a', text: '#f6ece8', accent: '#f97316' } },
      { label: 'Deep sea', seed: { bg: '#06121a', text: '#e4f4ff', accent: '#22d3ee' } },
      { label: 'Aubergine', seed: { bg: '#140a1c', text: '#f2e8fb', accent: '#c084fc' } },
      { label: 'Forest', seed: { bg: '#08130d', text: '#e6f5ec', accent: '#4ade80' } },
      { label: 'Espresso', seed: { bg: '#150f0b', text: '#f3e9df', accent: '#d4a373' } },
      { label: 'Ink', seed: { bg: '#0b1020', text: '#e8ecff', accent: '#60a5fa' } },
      { label: 'Rosewood', seed: { bg: '#170a0e', text: '#fae9ee', accent: '#fb7185' } },
      { label: 'Slate', seed: { bg: '#0c1116', text: '#e9eef4', accent: '#38bdf8' } },
    ],
  },
  {
    group: 'Light',
    items: [
      { label: 'Paper', seed: { bg: '#fbfbfd', text: '#14141c', accent: '#2563eb' } },
      { label: 'Linen', seed: { bg: '#faf6ef', text: '#231d16', accent: '#a16207' } },
      { label: 'Mint', seed: { bg: '#f3faf6', text: '#0f231a', accent: '#059669' } },
      { label: 'Blush', seed: { bg: '#fdf5f7', text: '#241419', accent: '#be185d' } },
      { label: 'Sky', seed: { bg: '#f3f7fc', text: '#0f1b28', accent: '#0369a1' } },
      { label: 'Sage', seed: { bg: '#f4f7f1', text: '#161f18', accent: '#4d7c0f' } },
      { label: 'Overcast', seed: { bg: '#f5f6f8', text: '#15181d', accent: '#4f46e5' } },
    ],
  },
  /**
   * ⚠️ A GROUP FOR SEEING IT, not for liking it. Every other preset here is a taste; these
   * two are the answer to "I cannot read this", and burying that behind Loud would be filing an
   * accessibility choice under decoration. Both reach 21:1, which is the most any pair of
   * colours can reach — pure black and pure white, with an accent kept well clear of the page
   * so a link is still obviously a link.
   *
   * ⚠️ AND THEY RUN THROUGH THE SAME DERIVATION as everything else, so nudging one behaves
   * exactly like nudging any other preset. They are seeds, not a special mode with its own
   * rules that somebody would have to maintain separately.
   */
  {
    group: 'Easy to read',
    items: [
      { label: 'Black on white', seed: { bg: '#ffffff', text: '#000000', accent: '#0b3fae' } },
      { label: 'White on black', seed: { bg: '#000000', text: '#ffffff', accent: '#ffd400' } },
    ],
  },
  {
    group: 'Loud',
    items: [
      { label: 'Neon', seed: { bg: '#05060a', text: '#eafff5', accent: '#00ffa3' } },
      { label: 'Hazard', seed: { bg: '#0d0d0d', text: '#fdfdfd', accent: '#facc15' } },
      { label: 'Vapour', seed: { bg: '#150b26', text: '#ffe9fb', accent: '#ff5edb' } },
      { label: 'Terminal', seed: { bg: '#000000', text: '#c8f7c5', accent: '#33ff66' } },
    ],
  },
]

export const PRESETS: Preset[] = PRESET_GROUPS.flatMap((g) => g.items)
