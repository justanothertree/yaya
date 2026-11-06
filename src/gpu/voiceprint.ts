/**
 * The arithmetic of the Lab's voiceprint: a picture of sound you can paint on and play. Each column
 * is a moment, each row a pitch, and how bright a cell is says how loud that pitch is then.
 *
 * ⚠️ BOTH DIRECTIONS RUN ON THE GPU. Listening, a compute pass takes the newest 1,024 samples of the
 * microphone and does a FAST FOURIER TRANSFORM in its workgroup's memory — ten stages of butterflies,
 * every thread doing two — to say how much of each pitch is in them; the result is the newest column.
 * Playing, another pass does ADDITIVE SYNTHESIS: every sample of the output is the sum of one sine
 * per row, at that row's pitch and the loudness the picture gives it there (eased between columns),
 * and the samples come back to be played. Painting a level line is a pure note; a slanting one is a
 * glide; a voice, played back, is a ghost of itself. `fft` and `synth` are the same sums;
 * voiceprint.test.ts holds them to a plain Fourier sum and to a tuning fork.
 */

/** Hand-packed to match `struct Print` — voiceprint.test.ts lays the struct out from the shader. */
export const PRINT = {
  size: 0,
  columns: 8,
  rows: 12,
  head: 16,
  rate: 20,
  perColumn: 24,
  first: 28,
  dabs: 32,
  playing: 36,
  playhead: 40,
  bytes: 48,
} as const

/** moments across, pitches up */
export const COLUMNS = 512
export const ROWS = 256
/** samples a column of the picture holds: one frame's worth at 60 a second */
export const COLUMN_SECONDS = 1 / 60
/** the transform's length */
export const FFT = 1024
/** the lowest and highest pitch shown, Hz: rows are spaced evenly in pitch between them */
export const LOW = 80
export const HIGH = 8000

/** the pitch of a row (0 at the bottom) */
export const rowHz = (row: number) => LOW * (HIGH / LOW) ** (row / (ROWS - 1))
/** and the row a pitch falls on, not rounded */
export const hzRow = (hz: number) => (Math.log(hz / LOW) / Math.log(HIGH / LOW)) * (ROWS - 1)

/** a radix-2 FFT of re/im in place (n a power of two) — mirrored in voiceprint.wgsl */
export function fft(re: Float64Array, im: Float64Array) {
  const n = re.length
  // put each sample where its index, bits reversed, says
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len *= 2) {
    const half = len / 2
    for (let start = 0; start < n; start += len)
      for (let k = 0; k < half; k++) {
        const a = (-2 * Math.PI * k) / len
        const wr = Math.cos(a)
        const wi = Math.sin(a)
        const i = start + k
        const j = i + half
        const tr = re[j] * wr - im[j] * wi
        const ti = re[j] * wi + im[j] * wr
        re[j] = re[i] - tr
        im[j] = im[i] - ti
        re[i] += tr
        im[i] += ti
      }
  }
}

/** the Hann window, which keeps a note's energy in its own bins instead of smearing it */
export const hann = (i: number, n = FFT) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))

/**
 * One column of the picture from the newest FFT samples at `rate`: each row's loudness is the
 * spectrum read at that row's pitch (between bins), scaled so a full-scale sine reads about 1.
 * Mirrored in voiceprint.wgsl's `column`.
 */
export function columnOf(samples: ArrayLike<number>, rate: number): Float32Array {
  const re = new Float64Array(FFT)
  const im = new Float64Array(FFT)
  for (let i = 0; i < FFT; i++) re[i] = samples[i] * hann(i)
  fft(re, im)
  const out = new Float32Array(ROWS)
  for (let r = 0; r < ROWS; r++) out[r] = loudnessAt(re, im, rate, rowHz(r))
  return out
}

/** a spectrum's loudness at a pitch, read linearly between its bins — mirrored in the shader */
export function loudnessAt(re: ArrayLike<number>, im: ArrayLike<number>, rate: number, hz: number) {
  const b = (hz * FFT) / rate
  const b0 = Math.min(FFT / 2 - 1, Math.floor(b))
  const f = Math.min(1, b - b0)
  const m = (k: number) => Math.hypot(re[k], im[k])
  // a Hann-windowed full-scale sine peaks at FFT/4 in its bin
  return ((m(b0) * (1 - f) + m(b0 + 1) * f) / (FFT / 4)) ** 0.5
}

/**
 * The sound of a stretch of the picture, sample by sample: the sum over rows of a sine at the
 * row's pitch, its loudness eased between the columns either side, its phase a function of the
 * time alone so no sine ever jumps from one column to the next. Mirrored in voiceprint.wgsl's
 * `play`. `print` is columns × rows, row-major by column.
 */
export function synth(
  print: ArrayLike<number>,
  columns: number,
  rate: number,
  from = 0,
  count?: number,
): Float32Array {
  const per = Math.round(rate * COLUMN_SECONDS)
  const n = count ?? columns * per
  const out = new Float32Array(n)
  for (let s = 0; s < n; s++) {
    const t = (from + s) / rate
    const at = (from + s) / per
    const c0 = Math.min(columns - 1, Math.floor(at))
    const c1 = Math.min(columns - 1, c0 + 1)
    const f = at - Math.floor(at)
    let sum = 0
    for (let r = 0; r < ROWS; r++) {
      const a = print[c0 * ROWS + r] * (1 - f) + print[c1 * ROWS + r] * f
      if (a > 0.003) sum += a * a * Math.sin(2 * Math.PI * rowHz(r) * t)
    }
    out[s] = sum
  }
  return out
}

export type Dab = { column: number; row: number; strength: number }

export const TOOLS = { paint: '🖌 Paint', erase: '🧽 Erase' } as const
export type Tool = keyof typeof TOOLS

/**
 * The picture it starts with, so Play has something to play before anybody sings: a little tune
 * written in level strokes, a glide, and a chord — in the same units the microphone writes.
 */
export function startingPrint(): Float32Array<ArrayBuffer> {
  const p = new Float32Array(COLUMNS * ROWS)
  const note = (c0: number, c1: number, hz: number, a = 0.7) => {
    const r = Math.round(hzRow(hz))
    for (let c = c0; c < c1; c++)
      for (const [dr, k] of [
        [-1, 0.35],
        [0, 1],
        [1, 0.35],
      ] as const)
        p[c * ROWS + r + dr] = Math.max(p[c * ROWS + r + dr], a * k)
  }
  // C major arpeggio, then a glide up, then a chord
  const C = 261.63
  const semis = [0, 4, 7, 12, 7, 4, 0]
  semis.forEach((s, i) => note(20 + i * 32, 46 + i * 32, C * 2 ** (s / 12)))
  for (let c = 260; c < 330; c++) {
    const hz = C * 2 ** ((12 * (c - 260)) / 70 / 12)
    const r = Math.round(hzRow(hz))
    p[c * ROWS + r] = 0.7
  }
  for (const s of [0, 4, 7, 12]) note(350, 470, C * 2 ** (s / 12), 0.5)
  return p
}

export type PrintFrame = {
  w: number
  h: number
  head: number
  rate: number
  from: number
  dabs: number
  playing: boolean
  playhead: number
}

export function packPrint(p: PrintFrame, into = new ArrayBuffer(PRINT.bytes)) {
  const u = new Uint32Array(into)
  const f = new Float32Array(into)
  u[0] = p.w
  u[1] = p.h
  u[PRINT.columns / 4] = COLUMNS
  u[PRINT.rows / 4] = ROWS
  u[PRINT.head / 4] = p.head
  f[PRINT.rate / 4] = p.rate
  u[PRINT.perColumn / 4] = Math.round(p.rate * COLUMN_SECONDS)
  u[PRINT.first / 4] = p.from
  u[PRINT.dabs / 4] = p.dabs
  u[PRINT.playing / 4] = p.playing ? 1 : 0
  f[PRINT.playhead / 4] = p.playhead
  return into
}
