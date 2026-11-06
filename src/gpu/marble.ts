/**
 * The arithmetic of the Lab's marbling: the uniform, the inks, and the recipe that marbles a
 * sheet by itself. Coordinates are centred, as in marble.wgsl.
 */

/** Hand-packed to match `struct Marble` — marble.test.ts lays the struct out from the shader. */
export const MARBLE = {
  color: 0,
  a: 16,
  b: 24,
  aspect: 32,
  radius: 36,
  sharp: 40,
  spacing: 44,
  op: 48,
  bytes: 64,
} as const

type Pt = readonly [number, number]
type RGB = readonly [number, number, number]

/** One thing done to the tray. */
export type MarbleOp =
  | { op: 'drop'; at: Pt; radius: number; color: RGB }
  | { op: 'stroke'; from: Pt; to: Pt; sharp: number; spacing: number }

export function packMarble(o: MarbleOp, aspect: number, into = new ArrayBuffer(MARBLE.bytes)) {
  const f = new Float32Array(into)
  const u = new Uint32Array(into)
  f.fill(0)
  f[MARBLE.aspect / 4] = aspect
  if (o.op === 'drop') {
    f.set([...o.color, 1], MARBLE.color / 4)
    f.set(o.at, MARBLE.a / 4)
    f[MARBLE.radius / 4] = o.radius
    u[MARBLE.op / 4] = 1
  } else {
    f.set(o.from, MARBLE.a / 4)
    f.set(o.to, MARBLE.b / 4)
    f[MARBLE.sharp / 4] = o.sharp
    f[MARBLE.spacing / 4] = o.spacing
    u[MARBLE.op / 4] = 2
  }
  return into
}

/** the paper, and sets of inks that marblers use together */
export const PAPER: RGB = [0.95, 0.92, 0.84]
export const INKS = {
  ebru: {
    name: 'Ebru',
    inks: [
      [0.12, 0.2, 0.45],
      [0.75, 0.2, 0.15],
      [0.85, 0.65, 0.2],
      [0.18, 0.4, 0.3],
    ],
  },
  ocean: {
    name: 'Ocean',
    inks: [
      [0.05, 0.25, 0.45],
      [0.2, 0.55, 0.7],
      [0.85, 0.92, 0.95],
      [0.1, 0.4, 0.4],
    ],
  },
  sunset: {
    name: 'Sunset',
    inks: [
      [0.55, 0.1, 0.3],
      [0.95, 0.45, 0.2],
      [0.98, 0.78, 0.35],
      [0.35, 0.1, 0.4],
    ],
  },
  ink: {
    name: 'Ink',
    inks: [
      [0.08, 0.08, 0.1],
      [0.4, 0.4, 0.42],
      [0.9, 0.9, 0.88],
      [0.2, 0.2, 0.25],
    ],
  },
} as const satisfies Record<string, { name: string; inks: readonly RGB[] }>
export type InkSet = keyof typeof INKS

/** the tines of a comb, and how sharply they pull */
export const COMB_SPACING = 0.08
export const STYLUS_SHARP = 0.03
export const COMB_SHARP = 0.012

/**
 * The recipe ✨ Marble plays: the classic sequence for a "nonpareil"-like sheet. Float rows of ink
 * in turn, rake across with a coarse comb, comb back with a fine one, then draw a stylus through in
 * a wave — each step a dated op, so the sheet is made in front of you rather than appearing.
 */
export function recipe(aspect: number, inks: readonly RGB[]): { t: number; o: MarbleOp }[] {
  const out: { t: number; o: MarbleOp }[] = []
  let t = 0
  const w = aspect * 0.5
  // drops: a grid, colours in turn, each pushing the ones before it aside
  for (let ring = 0; ring < 3; ring++)
    for (let y = -0.38; y <= 0.381; y += 0.19)
      for (let x = -w + 0.1; x <= w - 0.1 + 1e-9; x += 0.22) {
        const k = (ring + Math.round((x + y) * 10)) % inks.length
        out.push({
          t,
          o: {
            op: 'drop',
            at: [x + ring * 0.03, y + ring * 0.02],
            radius: 0.05 - ring * 0.012,
            color: inks[(k + inks.length) % inks.length],
          },
        })
        t += 0.03
      }
  // a coarse rake top to bottom, then a fine comb back the other way
  const across = (dir: 1 | -1, spacing: number, sharp: number) => {
    for (let s = 0; s < 24; s++) {
      const y0 = dir * (-0.25 + (s / 24) * 0.5)
      const y1 = dir * (-0.25 + ((s + 1) / 24) * 0.5)
      out.push({ t, o: { op: 'stroke', from: [0, y0], to: [0, y1], sharp, spacing } })
      t += 0.04
    }
    t += 0.3
  }
  across(1, 0.16, 0.02)
  across(-1, COMB_SPACING, COMB_SHARP)
  // a stylus wave left to right through the middle
  for (let s = 0; s < 40; s++) {
    const x0 = -w + (s / 40) * 2 * w
    const x1 = -w + ((s + 1) / 40) * 2 * w
    const wave = (x: number) => 0.18 * Math.sin((x / w) * Math.PI * 2)
    out.push({
      t,
      o: {
        op: 'stroke',
        from: [x0, wave(x0)],
        to: [x1, wave(x1)],
        sharp: STYLUS_SHARP * 0.5,
        spacing: 0,
      },
    })
    t += 0.035
  }
  return out
}
