/**
 * What the sound LOOKS like — four ways of drawing the same numbers.
 *
 * Split from the component for the same reason backdrops.ts is: a canvas effect is a step
 * function and some state, and mixing that into a file that also does React state and event
 * listeners makes both harder to read. Adding a fifth mode should mean adding one entry here and
 * nothing else.
 *
 * ⚠️ Every mode reads the SAME buffers, filled once per frame by the caller. A mode that fetched
 * its own copy from the analyser would be reading the same node twice a frame for no gain.
 *
 * Colours come from the live theme, so a visualiser inherits whatever palette the page is wearing
 * — including someone else's, on their profile.
 */

export type VisualId = 'bars' | 'wave' | 'radial' | 'rain'

export const VISUALS: Array<[VisualId, string, string]> = [
  ['bars', '📊', 'Bars'],
  ['wave', '〰️', 'Wave'],
  ['radial', '◎', 'Radial'],
  ['rain', '🌧', 'Rain'],
]

export type Ink = {
  accent: [number, number, number]
  accent2: [number, number, number]
  ink: [number, number, number]
}

export type Frame = {
  ctx: CanvasRenderingContext2D
  w: number
  h: number
  dt: number
  /** frequency bins, 0–255 */
  spec: Uint8Array
  /** how many of `spec` are worth drawing — the top octave is mostly empty on speech */
  bins: number
  /** waveform, 0–255 around 128 */
  wave: Uint8Array
  waveN: number
  /** overall loudness 0–1, already sensitivity-scaled */
  level: number
  ink: Ink
}

export type Visual = {
  init(w: number, h: number): void
  draw(f: Frame): void
}

const rgb = (c: [number, number, number], a = 1) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`

/** Blend two theme colours, so a bar can run accent → accent-2 up its own height. */
function mix(a: [number, number, number], b: [number, number, number], t: number): string {
  const at = Math.max(0, Math.min(1, t))
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * at)}, ${Math.round(
    a[1] + (b[1] - a[1]) * at,
  )}, ${Math.round(a[2] + (b[2] - a[2]) * at)})`
}

/**
 * Bars, with peaks that fall.
 *
 * The falling peak marker is the detail that makes a bar meter readable: bars alone tell you the
 * level now, and by the time you have registered a spike it is already gone. A marker that drops
 * slowly holds the loudest moment of the last half-second where your eye can still find it.
 *
 * ⚠️ Bin widths are curved, not linear. An FFT hands back bins spaced evenly in Hz, which puts
 * nearly all of speech and music in the left eighth of the display and leaves the rest flat —
 * that is the usual reason a home-made visualiser looks dead down its whole right-hand side.
 */
function bars(): Visual {
  let peaks: Float32Array = new Float32Array(0)
  let n = 0
  return {
    init(w) {
      n = Math.max(8, Math.min(64, Math.floor(w / 14)))
      peaks = new Float32Array(n)
    },
    draw({ ctx, w, h, dt, spec, bins, ink }) {
      const gap = Math.max(1, w / n / 6)
      const bw = w / n - gap
      for (let i = 0; i < n; i++) {
        // spread the bins across the bars on a curve, so the low end gets room to breathe
        const lo = Math.floor(Math.pow(i / n, 1.7) * bins)
        const hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / n, 1.7) * bins))
        let sum = 0
        for (let k = lo; k < hi; k++) sum += spec[k]
        const v = sum / (hi - lo) / 255
        const bh = Math.max(2, v * h * 0.92)
        const x = i * (bw + gap) + gap / 2
        ctx.fillStyle = mix(ink.accent, ink.accent2, v)
        ctx.fillRect(x, h - bh, bw, bh)

        // gravity on the marker rather than a fixed step per frame, so it falls at the same rate
        // on a 144Hz screen as on a 60Hz one
        peaks[i] = Math.max(peaks[i] - dt * 0.9, v)
        const py = h - Math.max(2, peaks[i] * h * 0.92)
        ctx.fillStyle = rgb(ink.ink, 0.75)
        ctx.fillRect(x, py - 2, bw, 2)
      }
    },
  }
}

/**
 * The waveform itself, drawn twice — once solid, once as a wide soft copy underneath.
 *
 * The soft copy is a glow without a shadow filter. `shadowBlur` on a path this long is one of the
 * few canvas calls that will genuinely cost frames on an integrated GPU; a second stroke at low
 * alpha and four times the width reads the same and costs one more stroke.
 */
function wave(): Visual {
  return {
    init() {},
    draw({ ctx, w, h, wave: buf, waveN, level, ink }) {
      const mid = h / 2
      const amp = h * 0.42
      // never draw more points than there are pixels across
      const step = Math.max(1, Math.floor(waveN / Math.max(1, w)))
      const line = (width: number, alpha: number) => {
        ctx.beginPath()
        for (let i = 0; i < waveN; i += step) {
          const x = (i / waveN) * w
          const y = mid + ((buf[i] - 128) / 128) * amp
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.lineWidth = width
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.strokeStyle = rgb(ink.accent, alpha)
        ctx.stroke()
      }
      // a centre line first, so silence reads as silence rather than an empty box
      ctx.strokeStyle = rgb(ink.ink, 0.12)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, mid)
      ctx.lineTo(w, mid)
      ctx.stroke()
      line(8, 0.12 + level * 0.15)
      line(2, 0.95)
    },
  }
}

/**
 * A ring that breathes, with the spectrum as spokes around it.
 *
 * ⚠️ Mirrored across the vertical axis: half the bins drawn twice rather than all of them once.
 * A full sweep puts the loud low end all on one side, so the whole figure leans permanently left
 * — which reads as a bug even though it is exactly what the data says.
 */
function radial(): Visual {
  let spin = 0
  return {
    init() {},
    draw({ ctx, w, h, dt, spec, bins, level, ink }) {
      const cx = w / 2
      const cy = h / 2
      const r0 = Math.min(w, h) * (0.16 + level * 0.06)
      const max = Math.min(w, h) * 0.44
      spin += dt * (0.15 + level * 0.5)
      const spokes = Math.min(96, Math.max(24, Math.floor(bins / 2)))
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(spin)
      for (let i = 0; i < spokes; i++) {
        // only the lower 70% of the range: the top of an FFT is near-silent on voice and would
        // be a band of stubs that never move
        const v = spec[Math.floor((i / spokes) * bins * 0.7)] / 255
        const len = r0 + v * (max - r0)
        const a = (i / spokes) * Math.PI
        for (const dir of [1, -1]) {
          const ang = a * dir - Math.PI / 2
          ctx.beginPath()
          ctx.moveTo(Math.cos(ang) * r0, Math.sin(ang) * r0)
          ctx.lineTo(Math.cos(ang) * len, Math.sin(ang) * len)
          ctx.lineWidth = 2
          ctx.strokeStyle = mix(ink.accent, ink.accent2, v)
          ctx.stroke()
        }
      }
      ctx.restore()
      ctx.beginPath()
      ctx.arc(cx, cy, r0, 0, Math.PI * 2)
      ctx.strokeStyle = rgb(ink.ink, 0.3)
      ctx.lineWidth = 1
      ctx.stroke()
    },
  }
}

/**
 * A scrolling spectrogram — time along the x axis, pitch up the y, loudness as colour.
 *
 * ⚠️ Scrolled by copying the canvas onto itself one column left, NOT by keeping a history array
 * and redrawing every column each frame. Redrawing means hundreds of fills per frame and the cost
 * grows with the width of the window; blitting the canvas onto itself is one call at any size.
 * The trade is that the picture IS the history, so a resize loses it — which is why init only
 * marks it for a repaint instead of trying to rescale what was there.
 */
function rain(): Visual {
  let cleared = false
  return {
    init() {
      cleared = false
    },
    draw({ ctx, w, h, spec, bins, ink }) {
      if (!cleared) {
        ctx.fillStyle = rgb(ink.ink, 0.06)
        ctx.fillRect(0, 0, w, h)
        cleared = true
      }
      const col = 2
      // shift everything left by one column, then draw the new one at the right edge. The
      // transform is already dpr-scaled, so this is in CSS pixels like everything else.
      ctx.drawImage(ctx.canvas, -col, 0, w, h)
      const rows = Math.min(bins, Math.max(1, Math.floor(h)))
      const rh = h / rows
      for (let i = 0; i < rows; i++) {
        // low frequencies at the bottom, which is the way every spectrogram is read
        const v = spec[Math.floor(Math.pow(i / rows, 1.5) * bins)] / 255
        ctx.globalAlpha = v < 0.04 ? 1 : 0.25 + v * 0.75
        ctx.fillStyle = v < 0.04 ? rgb(ink.ink, 0.05) : mix(ink.accent, ink.accent2, v)
        ctx.fillRect(w - col, h - (i + 1) * rh, col + 1, rh + 1)
      }
      ctx.globalAlpha = 1
    },
  }
}

const MAKERS: Record<VisualId, () => Visual> = { bars, wave, radial, rain }

export function makeVisual(id: VisualId): Visual {
  return MAKERS[id]()
}

/** Rain paints its own history; the others need the canvas wiped each frame. */
export function clearsEachFrame(id: VisualId): boolean {
  return id !== 'rain'
}
