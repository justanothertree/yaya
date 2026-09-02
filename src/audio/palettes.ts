export type RGB = [number, number, number]

/**
 * Colour ramps for the visualiser.
 *
 * ⚠️ EVERY MODE WAS LIMITED TO TWO COLOURS — your accent and your second accent — because that is
 * all the theme had to offer. Sixteen modes drawing the same two hues look far more alike than
 * they are: the shapes differ completely and the eye reads "green-to-red" first. A ramp of four or
 * five stops changes every mode at once, which is why this is worth more than another mode would
 * be.
 *
 * A ramp rather than a set of swatches, because that is how the modes actually ask for colour:
 * "give me the colour for 0.7" — loudness, distance, depth, band. Something that answers any
 * number between 0 and 1 fits every mode without a single one needing to know which palette is on.
 */

export type Palette = {
  id: string
  label: string
  /** left to right, sampled by hue(); at least two, no useful maximum */
  stops: RGB[]
}

/**
 * ⚠️ 'theme' is first and is the default, and it is the only one with no colours of its own.
 *
 * It takes your accent pair, so somebody who has carefully set a palette on the site keeps seeing
 * it here, and the profile-look system keeps working — a visitor watching your profile's
 * background still gets YOUR colours rather than a stranger's taste. Every other entry overrides
 * the theme deliberately.
 */
export const PALETTES: Palette[] = [
  { id: 'theme', label: 'Theme', stops: [] },
  {
    id: 'ember',
    label: 'Ember',
    stops: [
      [40, 6, 10],
      [156, 26, 20],
      [232, 96, 20],
      [252, 196, 62],
      [255, 246, 214],
    ],
  },
  {
    id: 'ocean',
    label: 'Ocean',
    stops: [
      [6, 22, 60],
      [12, 74, 122],
      [22, 150, 168],
      [124, 226, 220],
      [232, 252, 250],
    ],
  },
  {
    id: 'neon',
    label: 'Neon',
    stops: [
      [22, 4, 46],
      [156, 20, 168],
      [232, 40, 148],
      [82, 132, 255],
      [96, 244, 255],
    ],
  },
  {
    id: 'forest',
    label: 'Forest',
    stops: [
      [10, 30, 18],
      [26, 86, 44],
      [90, 158, 52],
      [188, 214, 84],
      [242, 246, 198],
    ],
  },
  {
    id: 'candy',
    label: 'Candy',
    stops: [
      [92, 20, 74],
      [226, 62, 138],
      [255, 128, 148],
      [255, 190, 158],
      [255, 240, 226],
    ],
  },
  {
    // the false-colour scale a thermal camera uses: black through purple and red to white hot
    id: 'infrared',
    label: 'Infrared',
    stops: [
      [4, 2, 18],
      [82, 12, 110],
      [198, 34, 74],
      [248, 148, 24],
      [255, 250, 210],
    ],
  },
  {
    id: 'aurora',
    label: 'Aurora',
    stops: [
      [8, 24, 40],
      [24, 168, 130],
      [96, 226, 178],
      [138, 128, 240],
      [232, 156, 232],
    ],
  },
  {
    id: 'sunset',
    label: 'Sunset',
    stops: [
      [24, 16, 62],
      [104, 44, 130],
      [214, 84, 108],
      [248, 156, 74],
      [255, 224, 150],
    ],
  },
  {
    id: 'ice',
    label: 'Ice',
    stops: [
      [10, 26, 58],
      [42, 92, 168],
      [120, 176, 232],
      [196, 230, 250],
      [255, 255, 255],
    ],
  },
  {
    // deliberately colourless: with sixteen modes and five tools, sometimes the SHAPE is the
    // thing you want to look at, and every hue in the room is a distraction from it
    id: 'mono',
    label: 'Mono',
    stops: [
      [26, 26, 30],
      [120, 120, 128],
      [210, 210, 216],
      [255, 255, 255],
    ],
  },
  {
    // warm neutrals, which nothing else here covers: every other ramp is a hue, this one is earth
    id: 'desert',
    label: 'Desert',
    stops: [
      [42, 26, 16],
      [107, 58, 30],
      [184, 118, 58],
      [224, 176, 112],
      [246, 230, 200],
    ],
  },
  {
    // deep violet without Neon's glare — the same end of the wheel played quietly
    id: 'plum',
    label: 'Plum',
    stops: [
      [28, 10, 36],
      [78, 20, 80],
      [142, 42, 114],
      [200, 106, 160],
      [240, 200, 220],
    ],
  },
  {
    // Forest is a vivid green; this is the muted, yellower one, for when the shape is the point
    id: 'moss',
    label: 'Moss',
    stops: [
      [20, 24, 12],
      [56, 72, 28],
      [110, 132, 52],
      [168, 184, 98],
      [226, 232, 180],
    ],
  },
  {
    // Ice goes to white through pale blue; this goes to silver through indigo, and stays dark
    // much longer — the difference between a bright winter and a clear night
    id: 'midnight',
    label: 'Midnight',
    stops: [
      [4, 6, 15],
      [18, 32, 74],
      [42, 74, 140],
      [106, 134, 200],
      [200, 216, 244],
    ],
  },
  {
    /**
     * The whole wheel, rather than a journey between two ends of one.
     *
     * ⚠️ EVERY OTHER RAMP HERE IS A GRADIENT AND THIS ONE IS A CYCLE, which is the point: with a
     * gradient, a mode's quiet end and its loud end are always different colours, so loudness
     * reads as position along a fixed scale. Here hue is unbound — it keeps going round, so what
     * you see is the shape moving through colour rather than a meter filling up.
     *
     * ⚠️ It ends where it starts, on red. Stopping at magenta would put a hard seam between the
     * top of the ramp and the bottom, visible in every mode that wraps an angle — the ring modes
     * would show a scar down one side.
     */
    id: 'spectrum',
    label: 'Spectrum',
    stops: [
      [255, 48, 48],
      [255, 168, 32],
      [244, 232, 48],
      [72, 208, 88],
      [48, 200, 208],
      [64, 112, 240],
      [148, 72, 224],
      [232, 64, 168],
      [255, 48, 48],
    ],
  },
]

export const paletteById = (id: string): Palette => PALETTES.find((p) => p.id === id) ?? PALETTES[0]

/**
 * Sample a ramp at 0–1.
 *
 * ⚠️ Interpolated in plain RGB, not a perceptual space. Oklab would give smoother mid-tones, and
 * it would also mean a colour-space conversion per drawn element — these run tens of thousands of
 * times a second across sixteen modes. The stops are placed close enough together that straight
 * interpolation between neighbours has no visible banding, which buys the same result for none of
 * the cost.
 */
export function sample(stops: RGB[], t: number): RGB {
  if (!stops.length) return [255, 255, 255]
  if (stops.length === 1) return stops[0]
  const k = Math.max(0, Math.min(1, t)) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(k))
  const f = k - i
  const a = stops[i]
  const b = stops[i + 1]
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ]
}
