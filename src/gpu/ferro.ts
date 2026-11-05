/**
 * The arithmetic of the Lab's ferrofluid: a pool of black magnetic liquid in a dish, which rises
 * into a field of spikes wherever a magnet is held under it.
 *
 * ⚠️ THE SPIKES ARE A PATTERN, NOT A SHAPE ANYBODY DRAWS. Real ferrofluid spikes come from an
 * instability (Rosensweig's): past a critical field the flat surface cannot stay flat, and the
 * wavelength it chooses is the fluid's own. The Swift–Hohenberg equation is the textbook model of
 * exactly that —
 *
 *     ∂u/∂t = r(x)·u − ((k₀² + ∇²)/k₀²)²·u + g·u² − u³
 *
 * — flat where `r` is negative, patterned with wavelength 2π/k₀ where it is positive, and with
 * `g > 0` the pattern is HEXAGONS OF UPWARD SPIKES, which is what ferrofluid makes. Here `r` is the
 * magnets' field. The stiff part, (k₀² + ∇²)², is solved exactly in Fourier space and the rest
 * stepped explicitly: one forward FFT and one inverse a step, done on the GPU a row or a column per
 * workgroup in shared memory. `fft` and `stepSH` here are the CPU's copies, which ferro.test.ts
 * holds to a plain DFT and to the pattern's wavelength, and the GPU probe holds the shader to.
 */

/** Hand-packed to match `struct Ferro` — ferro.test.ts lays the struct out from the shader. */
export const FERRO = {
  size: 0,
  grid: 8,
  /* four magnets, a vec4f each (x, y, strength, unused), named rather than an array so the layout
     test can read them — wgslLayout knows vectors, not arrays */
  m0: 16,
  m1: 32,
  m2: 48,
  m3: 64,
  count: 80,
  dt: 84,
  k0: 88,
  g: 92,
  spike: 96,
  light: 104,
  tick: 112,
  bytes: 128,
} as const

/** the simulation's side, in cells: a power of two, for the FFT, and one workgroup's row */
export const N = 256
/** most magnets at once (fingers) */
export const MAX_MAGNETS = 4
/** the spikes' spacing, in cells */
export const WAVELENGTH = 11
export const K0 = (2 * Math.PI) / WAVELENGTH
/** the quadratic term: positive, so the pattern is upward spikes on hexagons */
export const G = 1.1
/** where the field is nothing, how fast the surface goes flat */
export const R_REST = -0.15
/**
 * How much growth a unit of field gives. ⚠️ A FULL MAGNET GIVES r = 0.25 AND NO MORE, because the
 * pattern's shape depends on it: measured on a 64² grid with g = 1.1, r = 0.2 settles into
 * hexagonal spikes (peaks twice as far up as the troughs go down, skew 0.8) and r = 0.5 into
 * stripes and mazes (skew 0.05). Two magnets together still go past it — and real ferrofluid does
 * turn to labyrinths in a strong field.
 */
export const R_GAIN = 0.4

export type Magnet = { x: number; y: number; s: number }

/* ---------------------------------------------------------------- the FFT -------------------- */

/**
 * In-place radix-2 FFT of a length-2ⁿ complex sequence, as the shader does it: bit-reversed order
 * in, butterflies out. `inverse` conjugates the twiddles and divides by n.
 */
export function fft(
  re: Float64Array | Float32Array,
  im: Float64Array | Float32Array,
  inverse = false,
) {
  const n = re.length
  const bits = Math.log2(n)
  for (let i = 0; i < n; i++) {
    const j = reverse(i, bits)
    if (j > i) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  const sign = inverse ? 1 : -1
  for (let half = 1; half < n; half *= 2) {
    for (let k = 0; k < n / 2; k++) {
      const j = k % half
      const i = Math.floor(k / half) * half * 2 + j
      const a = (sign * Math.PI * j) / half
      const wr = Math.cos(a)
      const wi = Math.sin(a)
      const br = re[i + half] * wr - im[i + half] * wi
      const bi = re[i + half] * wi + im[i + half] * wr
      re[i + half] = re[i] - br
      im[i + half] = im[i] - bi
      re[i] += br
      im[i] += bi
    }
  }
  if (inverse)
    for (let i = 0; i < n; i++) {
      re[i] /= n
      im[i] /= n
    }
}

export function reverse(i: number, bits: number) {
  let r = 0
  for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
  return r
}

/** a 2D FFT of an n×n grid, rows then columns */
export function fft2(re: Float64Array, im: Float64Array, n: number, inverse = false) {
  const r = new Float64Array(n)
  const i = new Float64Array(n)
  for (let y = 0; y < n; y++) {
    r.set(re.subarray(y * n, y * n + n))
    i.set(im.subarray(y * n, y * n + n))
    fft(r, i, inverse)
    re.set(r, y * n)
    im.set(i, y * n)
  }
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      r[y] = re[y * n + x]
      i[y] = im[y * n + x]
    }
    fft(r, i, inverse)
    for (let y = 0; y < n; y++) {
      re[y * n + x] = r[y]
      im[y * n + x] = i[y]
    }
  }
}

/* ---------------------------------------------------------------- the pattern ---------------- */

/** a frequency index's wavenumber: 0..n/2 up, then the negative half */
export const wave = (i: number, n: number) => ((i <= n / 2 ? i : i - n) * 2 * Math.PI) / n

/**
 * The stiff part's exact step, for one Fourier mode: 1 / (1 + dt·((k₀² − k²)/k₀²)²).
 *
 * ⚠️ SCALED BY k₀², which the textbook form (k₀ = 1) never needs. Unscaled, with spikes 11 cells
 * apart (k₀ ≈ 0.57), the flat mode's damping is k₀⁴ ≈ 0.1 — weaker than the field's growth — so
 * the whole pool rose as one flat lump instead of into spikes. Scaled, every wavelength is damped
 * as it would be at k₀ = 1, the flat mode by 1, and only k₀ itself is free.
 */
export const damping = (kx: number, ky: number, dt: number, k0 = K0) =>
  1 / (1 + dt * ((k0 * k0 - kx * kx - ky * ky) / (k0 * k0)) ** 2)

/**
 * One semi-implicit step of Swift–Hohenberg on an n×n periodic grid: the field's own growth, the
 * quadratic and the cubic terms explicitly, then the (k₀² + ∇²)² part exactly in Fourier space.
 */
export function stepSH(u: Float64Array, r: Float64Array, n: number, dt: number, g = G, k0 = K0) {
  const re = new Float64Array(n * n)
  const im = new Float64Array(n * n)
  for (let i = 0; i < n * n; i++) {
    const v = u[i]
    re[i] = v + dt * (r[i] * v + g * v * v - v * v * v)
  }
  fft2(re, im, n)
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const d = damping(wave(x, n), wave(y, n), dt, k0)
      re[y * n + x] *= d
      im[y * n + x] *= d
    }
  fft2(re, im, n, true)
  u.set(re)
}

/* ---------------------------------------------------------------- magnets and the pool -------- */

/** the twiddle factors the shader reads rather than computing: e^(−2πi·j/N) for j < N/2 */
export function twiddles(n = N): Float32Array<ArrayBuffer> {
  const t = new Float32Array(n)
  for (let j = 0; j < n / 2; j++) {
    t[2 * j] = Math.cos((-2 * Math.PI * j) / n)
    t[2 * j + 1] = Math.sin((-2 * Math.PI * j) / n)
  }
  return t
}

/** how far a magnet's pull reaches, in cells */
export const REACH = 60

/** the magnets' field at a cell, 0 and up: each falls off like a dipole seen from above */
export function field(x: number, y: number, magnets: readonly Magnet[]) {
  let b = 0
  for (const m of magnets) {
    const d2 = ((x - m.x) ** 2 + (y - m.y) ** 2) / (REACH * REACH)
    b += m.s / (1 + d2) ** 1.5
  }
  return b
}

/** the puddle's radius, as a fraction of the dish's side */
export const POOL = 0.3

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * How much liquid is at a cell, 0..1, as the shader's `pool`: a puddle in the middle of the dish,
 * drawn out toward each magnet by how hard it pulls.
 */
export function pool(x: number, y: number, magnets: readonly Magnet[], n = N) {
  let amount = smooth(n * POOL, n * POOL - 10, Math.hypot(x - n / 2, y - n / 2))
  for (const m of magnets) {
    const d2 = ((x - m.x) ** 2 + (y - m.y) ** 2) / (REACH * REACH * 0.7)
    amount += m.s * Math.exp(-d2) * 0.9
  }
  return smooth(0.35, 0.65, amount)
}

/** the shader's noise, a u32 hash of the cell and the frame, 0..1 */
export function noiseAt(x: number, y: number, tick: number) {
  let h = (Math.imul(x, 1973) + Math.imul(y, 9277) + Math.imul(tick, 26699)) >>> 0
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

/** the growth rate the field gives the surface: negative (flat) at rest, positive under a magnet */
export const growth = (b: number) => R_REST + R_GAIN * b

/**
 * A magnet's strength while held and after: it gathers over about a second — the spikes come up as
 * you hold, rather than appearing — and lets go a little faster.
 */
export function ramp(s: number, held: boolean, dt: number, most = 1) {
  const want = held ? most : 0
  const rate = held ? 1.6 : 2.6
  return s + (want - s) * (1 - Math.exp(-rate * dt))
}

/** the loudness in the low bins of a spectrum (0..255 bytes), 0..1 — the bass, for the speaker */
export function bass(bins: Uint8Array, upTo = 12) {
  let sum = 0
  const n = Math.min(upTo, bins.length)
  for (let i = 1; i < n; i++) sum += bins[i]
  return n > 1 ? sum / (n - 1) / 255 : 0
}

export function packFerro(
  p: {
    w: number
    h: number
    magnets: readonly Magnet[]
    dt: number
    spike: readonly [number, number]
    light: readonly [number, number]
    tick: number
  },
  into = new ArrayBuffer(FERRO.bytes),
) {
  const u = new Uint32Array(into)
  const f = new Float32Array(into)
  u[0] = p.w
  u[1] = p.h
  u[2] = N
  u[3] = N
  const ms = p.magnets.slice(0, MAX_MAGNETS)
  ms.forEach((m, i) => f.set([m.x, m.y, m.s, 0], FERRO.m0 / 4 + i * 4))
  u[FERRO.count / 4] = ms.length
  f[FERRO.dt / 4] = p.dt
  f[FERRO.k0 / 4] = K0
  f[FERRO.g / 4] = G
  f.set(p.spike, FERRO.spike / 4)
  f.set(p.light, FERRO.light / 4)
  u[FERRO.tick / 4] = p.tick
  return into
}
