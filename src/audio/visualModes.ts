import type { Features } from './audioFeatures'

/**
 * What the sound LOOKS like — a gallery, not a list.
 *
 * Grown from four to sixteen. The first four were basic for a structural reason rather than a
 * lack of imagination: they were handed raw FFT bins and nothing else, and the only honest thing
 * to do with 512 numbers is draw them, which is a bar chart or a bar chart bent into a circle.
 * The modes below get bands, a beat, and a clock (see audioFeatures.ts), so they can respond to
 * MUSIC instead of to arithmetic.
 *
 * ⚠️ Each one should differ in MECHANISM, not decoration. A recoloured bar chart is not a mode.
 * The test applied to every addition here: could you tell it apart from the others in a
 * thumbnail, with the colours stripped out? Anything that failed was cut rather than kept as
 * filler — the same bar the click flairs are held to.
 *
 * Colours come from the live theme, so a visualiser inherits whatever palette the page wears,
 * including someone else's on their profile.
 */

export type VisualId =
  | 'bars'
  | 'wave'
  | 'radial'
  | 'rain'
  | 'lissajous'
  | 'tunnel'
  | 'nebula'
  | 'terrain'
  | 'ripple'
  | 'strings'
  | 'petals'
  | 'aurora'
  | 'orbit'
  | 'constellation'
  | 'cells'
  | 'spiral'

/** id, icon, label, and how much of the previous frame lingers by default (0 = none, 1 = all). */
export const VISUALS: Array<[VisualId, string, string, number]> = [
  ['bars', '📊', 'Bars', 0],
  ['wave', '〰️', 'Wave', 0],
  ['radial', '◎', 'Radial', 0],
  ['rain', '🌧', 'Rain', 1],
  ['lissajous', '🎗', 'Lissajous', 0.82],
  ['tunnel', '🕳', 'Tunnel', 0.55],
  ['nebula', '🌌', 'Nebula', 0.9],
  ['terrain', '🏔', 'Terrain', 0],
  ['ripple', '💧', 'Ripple', 0.4],
  ['strings', '🎻', 'Strings', 0.3],
  ['petals', '🌸', 'Petals', 0.6],
  ['aurora', '🌠', 'Aurora', 0],
  ['orbit', '🪐', 'Orbit', 0.75],
  ['constellation', '✳️', 'Stars', 0.5],
  ['cells', '🧫', 'Cells', 0],
  ['spiral', '🌀', 'Spiral', 0.7],
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
  bins: number
  /** waveform, 0–255 around 128 */
  wave: Uint8Array
  waveN: number
  /** bands, beat and clock — see audioFeatures.ts */
  f: Features
  ink: Ink
}

export type Visual = {
  init(w: number, h: number): void
  draw(f: Frame): void
}

const rgb = (c: [number, number, number], a = 1) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`

/** Blend two theme colours. Every mode uses this rather than inventing its own palette. */
function mix(a: [number, number, number], b: [number, number, number], t: number): string {
  const k = Math.max(0, Math.min(1, t))
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * k)}, ${Math.round(
    a[1] + (b[1] - a[1]) * k,
  )}, ${Math.round(a[2] + (b[2] - a[2]) * k)})`
}

/** Read a bin by FRACTION of the spectrum, so a mode never hard-codes an index. */
const at = (spec: Uint8Array, bins: number, frac: number) =>
  spec[Math.min(bins - 1, Math.max(0, Math.floor(frac * bins)))] / 255

// ── the original four ────────────────────────────────────────────────────────

/**
 * Bars, with peaks that fall.
 *
 * The falling marker is what makes a bar meter readable: bars alone tell you the level now, and
 * by the time you register a spike it is gone. Bin widths are curved because an FFT is linear in
 * Hz, which crams all of music into the left eighth and leaves the right side dead.
 */
function bars(): Visual {
  let peaks = new Float32Array(0)
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
        const lo = Math.floor(Math.pow(i / n, 1.7) * bins)
        const hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / n, 1.7) * bins))
        let sum = 0
        for (let k = lo; k < hi; k++) sum += spec[k]
        const v = sum / (hi - lo) / 255
        const bh = Math.max(2, v * h * 0.92)
        const x = i * (bw + gap) + gap / 2
        ctx.fillStyle = mix(ink.accent, ink.accent2, v)
        ctx.fillRect(x, h - bh, bw, bh)
        // gravity, not a per-frame step, so it falls the same on a 144Hz screen as a 60Hz one
        peaks[i] = Math.max(peaks[i] - dt * 0.9, v)
        ctx.fillStyle = rgb(ink.ink, 0.75)
        ctx.fillRect(x, h - Math.max(2, peaks[i] * h * 0.92) - 2, bw, 2)
      }
    },
  }
}

/** The waveform, drawn twice — the wide faint pass is a glow that costs one stroke, not a filter. */
function wave(): Visual {
  return {
    init() {},
    draw({ ctx, w, h, wave: buf, waveN, f, ink }) {
      const mid = h / 2
      const amp = h * 0.42
      const step = Math.max(1, Math.floor(waveN / Math.max(1, w)))
      ctx.strokeStyle = rgb(ink.ink, 0.12)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, mid)
      ctx.lineTo(w, mid)
      ctx.stroke()
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
      line(8, 0.12 + f.level * 0.15)
      line(2, 0.95)
    },
  }
}

/** A ring of spokes, mirrored so the loud low end doesn't make the whole figure lean left. */
function radial(): Visual {
  let spin = 0
  return {
    init() {},
    draw({ ctx, w, h, dt, spec, bins, f, ink }) {
      const cx = w / 2
      const cy = h / 2
      const r0 = Math.min(w, h) * (0.16 + f.level * 0.06)
      const max = Math.min(w, h) * 0.44
      spin += dt * (0.15 + f.level * 0.5)
      const spokes = Math.min(96, Math.max(24, Math.floor(bins / 2)))
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(spin)
      for (let i = 0; i < spokes; i++) {
        const v = at(spec, bins, (i / spokes) * 0.7)
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
 * A scrolling spectrogram — time across, pitch up, loudness as colour.
 *
 * ⚠️ Scrolled by blitting the canvas onto itself one column left, not by redrawing a history
 * array. Redrawing costs hundreds of fills a frame and grows with width; a self-blit is one call
 * at any size. The picture IS the history, so a resize loses it.
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
      ctx.drawImage(ctx.canvas, -col, 0, w, h)
      const rows = Math.min(bins, Math.max(1, Math.floor(h)))
      const rh = h / rows
      for (let i = 0; i < rows; i++) {
        const v = at(spec, bins, Math.pow(i / rows, 1.5))
        ctx.globalAlpha = v < 0.04 ? 1 : 0.25 + v * 0.75
        ctx.fillStyle = v < 0.04 ? rgb(ink.ink, 0.05) : mix(ink.accent, ink.accent2, v)
        ctx.fillRect(w - col, h - (i + 1) * rh, col + 1, rh + 1)
      }
      ctx.globalAlpha = 1
    },
  }
}

// ── the new twelve ───────────────────────────────────────────────────────────

/**
 * Lissajous — the waveform plotted against a DELAYED copy of itself.
 *
 * The oldest trick in analogue audio and still the prettiest: an oscilloscope in X/Y mode. A pure
 * tone draws a closed loop, a complex sound draws a knot that breathes, and silence collapses to
 * a dot. Nothing else here reacts to the SHAPE of a wave rather than its energy.
 */
function lissajous(): Visual {
  return {
    init() {},
    draw({ ctx, w, h, wave: buf, waveN, f, ink }) {
      const cx = w / 2
      const cy = h / 2
      const r = Math.min(w, h) * 0.42
      // a quarter-cycle-ish offset — small enough to stay correlated, big enough to open a loop
      const lag = Math.max(1, Math.floor(waveN / 24))
      ctx.beginPath()
      for (let i = 0; i < waveN - lag; i += 2) {
        const x = cx + ((buf[i] - 128) / 128) * r
        const y = cy + ((buf[i + lag] - 128) / 128) * r
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.lineWidth = 1.6
      ctx.lineJoin = 'round'
      ctx.strokeStyle = mix(ink.accent, ink.accent2, f.treble)
      ctx.stroke()
    },
  }
}

/**
 * Rings launched on every beat, receding into the distance.
 *
 * Depth from nothing but scale and fade. Rings are BORN on an onset rather than emitted on a
 * timer, so the tunnel's rhythm is the music's rhythm — a timer would look identical whatever
 * was playing, which is the failure mode of most "reactive" backgrounds.
 */
function tunnel(): Visual {
  type Ring = { r: number; hue: number; born: number }
  let rings: Ring[] = []
  return {
    init() {
      rings = []
    },
    draw({ ctx, w, h, dt, f, ink }) {
      const cx = w / 2
      const cy = h / 2
      const max = Math.hypot(w, h) * 0.6
      if (f.beat) rings.push({ r: 4, hue: f.bass, born: f.t })
      // a slow trickle even in silence, so the shape is legible before anything plays
      if (rings.length === 0 || f.t - rings[rings.length - 1].born > 0.9) {
        rings.push({ r: 4, hue: f.mid, born: f.t })
      }
      for (const ring of rings) ring.r += dt * (60 + f.level * 420)
      rings = rings.filter((ring) => ring.r < max)
      for (const ring of rings) {
        const k = ring.r / max
        ctx.beginPath()
        ctx.arc(cx, cy, ring.r, 0, Math.PI * 2)
        ctx.lineWidth = Math.max(0.5, 6 * (1 - k))
        ctx.strokeStyle = mix(ink.accent, ink.accent2, ring.hue)
        ctx.globalAlpha = Math.max(0, 1 - k) * 0.9
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    },
  }
}

/**
 * A drifting particle field shoved around by the bands.
 *
 * Bass pushes outward, treble adds jitter, and nothing is ever removed — particles wrap. With
 * heavy persistence this smears into something like a long exposure of smoke, which is the point:
 * it is the one mode here whose output depends on the last several SECONDS rather than this frame.
 */
function nebula(): Visual {
  type P = { x: number; y: number; vx: number; vy: number; s: number }
  let ps: P[] = []
  let W = 1
  let H = 1
  return {
    init(w, h) {
      W = w
      H = h
      const n = Math.max(40, Math.min(220, Math.round((w * h) / 9000)))
      ps = Array.from({ length: n }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 20,
        vy: (Math.random() - 0.5) * 20,
        s: 0.6 + Math.random() * 1.8,
      }))
    },
    draw({ ctx, dt, f, ink }) {
      const cx = W / 2
      const cy = H / 2
      for (const p of ps) {
        const dx = p.x - cx
        const dy = p.y - cy
        const d = Math.hypot(dx, dy) || 1
        // bass shoves outward from the middle; treble is brownian fizz
        const push = f.bass * 260
        p.vx += (dx / d) * push * dt + (Math.random() - 0.5) * f.treble * 90 * dt
        p.vy += (dy / d) * push * dt + (Math.random() - 0.5) * f.treble * 90 * dt
        p.vx *= 0.97
        p.vy *= 0.97
        p.x += p.vx * dt * 60 * 0.06
        p.y += p.vy * dt * 60 * 0.06
        if (p.x < 0) p.x += W
        if (p.x > W) p.x -= W
        if (p.y < 0) p.y += H
        if (p.y > H) p.y -= H
        const v = Math.min(1, Math.hypot(p.vx, p.vy) / 60)
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.s * (1 + f.level), 0, Math.PI * 2)
        ctx.fillStyle = mix(ink.accent, ink.accent2, v)
        ctx.globalAlpha = 0.5 + v * 0.5
        ctx.fill()
      }
      ctx.globalAlpha = 1
    },
  }
}

/**
 * The spectrum as a landscape receding to a horizon — every frame a new ridge at the front.
 *
 * A stack of past spectra drawn in perspective, newest nearest. Unlike Rain, which encodes
 * loudness as colour on a flat grid, here loudness is HEIGHT and time is depth, so a bassline
 * becomes a mountain range you can see coming.
 */
function terrain(): Visual {
  const ROWS = 26
  let rows: Float32Array[] = []
  let cols = 48
  return {
    init(w) {
      cols = Math.max(24, Math.min(96, Math.floor(w / 12)))
      rows = []
    },
    draw({ ctx, w, h, spec, bins, ink }) {
      const next = new Float32Array(cols)
      for (let i = 0; i < cols; i++) next[i] = at(spec, bins, Math.pow(i / cols, 1.6) * 0.8)
      rows.unshift(next)
      if (rows.length > ROWS) rows.pop()
      const horizon = h * 0.28
      for (let r = rows.length - 1; r >= 0; r--) {
        // depth 0 = nearest. Perspective: further rows are narrower, higher, and fainter.
        const k = r / ROWS
        const y0 = horizon + (h - horizon) * (1 - k) * 0.92
        const squeeze = 0.25 + (1 - k) * 0.75
        const amp = (h - horizon) * 0.3 * (1 - k * 0.6)
        ctx.beginPath()
        for (let i = 0; i < cols; i++) {
          const x = w / 2 + (i / (cols - 1) - 0.5) * w * squeeze
          const y = y0 - rows[r][i] * amp
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.lineWidth = 1.2
        ctx.strokeStyle = mix(ink.accent2, ink.accent, 1 - k)
        ctx.globalAlpha = 0.15 + (1 - k) * 0.85
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    },
  }
}

/**
 * Water struck on the beat.
 *
 * Expanding circles with a bright leading edge, thrown from wherever the energy suggests rather
 * than always the centre — a beat drops a stone somewhere new each time, so the surface never
 * settles into a pattern.
 */
function ripple(): Visual {
  type R = { x: number; y: number; r: number; strength: number }
  let rs: R[] = []
  return {
    init() {
      rs = []
    },
    draw({ ctx, w, h, dt, f, ink }) {
      if (f.beat) {
        rs.push({
          // placed by band content: bass lands low and left, treble high and right
          x: w * (0.15 + f.treble * 0.7 + Math.random() * 0.15),
          y: h * (0.85 - f.bass * 0.6 - Math.random() * 0.15),
          r: 2,
          strength: 0.4 + f.beatStrength * 0.6,
        })
      }
      const max = Math.hypot(w, h) * 0.5
      for (const r of rs) r.r += dt * (110 + f.level * 260)
      rs = rs.filter((r) => r.r < max)
      for (const r of rs) {
        const k = r.r / max
        ctx.beginPath()
        ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2)
        ctx.lineWidth = Math.max(0.6, 3.5 * (1 - k) * r.strength)
        ctx.strokeStyle = mix(ink.accent, ink.accent2, k)
        ctx.globalAlpha = Math.max(0, 1 - k) * r.strength
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    },
  }
}

/**
 * Plucked strings — each one a standing wave whose amplitude is its band.
 *
 * The strings are always there, so silence is a set of taut lines rather than an empty box, and
 * a beat visibly plucks them. The wobble is a real standing wave (a sine locked at both ends),
 * which is why it reads as a string rather than as a wiggling line.
 */
function strings(): Visual {
  let energy: number[] = []
  const N = 9
  return {
    init() {
      energy = Array(N).fill(0)
    },
    draw({ ctx, w, h, dt, spec, bins, f, ink }) {
      for (let i = 0; i < N; i++) {
        const band = at(spec, bins, 0.02 + (i / N) * 0.5)
        // pluck on a beat, otherwise decay — a string rings out, it does not track the envelope
        energy[i] = Math.max(energy[i] - dt * 1.6, f.beat ? Math.max(energy[i], band) : band * 0.55)
        const y = (h * (i + 1)) / (N + 1)
        const amp = energy[i] * (h / (N + 2)) * 0.9
        // higher strings vibrate faster, like shorter ones do
        const modes = 1 + (i % 3)
        ctx.beginPath()
        for (let x = 0; x <= w; x += 6) {
          const u = x / w
          const yy = y + Math.sin(u * Math.PI * modes) * Math.sin(f.t * (6 + i * 2.4)) * amp
          if (x === 0) ctx.moveTo(x, yy)
          else ctx.lineTo(x, yy)
        }
        ctx.lineWidth = 1 + energy[i] * 2
        ctx.strokeStyle = mix(ink.accent, ink.accent2, i / N)
        ctx.globalAlpha = 0.35 + energy[i] * 0.65
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    },
  }
}

/**
 * A rose curve — r = cos(kθ) — with the petal count driven by the spectrum.
 *
 * Pure maths rather than particles: the whole figure is one continuous polar line, so it stays
 * coherent and symmetrical however loud things get. Changing k by a fraction swings it through
 * completely different flowers, which is what makes it feel alive on a sustained note where a
 * bar chart would just sit still.
 */
function petals(): Visual {
  let k = 3
  return {
    init() {
      k = 3
    },
    draw({ ctx, w, h, dt, f, ink }) {
      const cx = w / 2
      const cy = h / 2
      const R = Math.min(w, h) * (0.2 + f.level * 0.22)
      // eased toward the target so petals morph rather than snap between shapes
      const target = 2 + f.mid * 6 + f.treble * 3
      k += (target - k) * Math.min(1, dt * 2)
      ctx.beginPath()
      for (let i = 0; i <= 720; i++) {
        const th = (i / 720) * Math.PI * 2
        const r = R * (0.35 + 0.65 * Math.abs(Math.cos(k * th + f.t * 0.6)))
        const x = cx + Math.cos(th) * r
        const y = cy + Math.sin(th) * r
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.lineWidth = 1.4 + f.bass * 3
      ctx.strokeStyle = mix(ink.accent, ink.accent2, f.bass)
      ctx.stroke()
    },
  }
}

/**
 * Curtains of light — layered sine ribbons drifting at different rates.
 *
 * Filled bands rather than strokes, each a vertical gradient that fades out at the bottom. The
 * layers move at unrelated speeds so they drift in and out of alignment forever without
 * repeating, which is the trick real aurora footage plays on the eye.
 */
function aurora(): Visual {
  const LAYERS = 5
  return {
    init() {},
    draw({ ctx, w, h, spec, bins, f, ink }) {
      for (let L = 0; L < LAYERS; L++) {
        const band = at(spec, bins, 0.02 + (L / LAYERS) * 0.4)
        const baseY = h * (0.3 + (L / LAYERS) * 0.4)
        const amp = h * (0.05 + band * 0.22)
        const speed = 0.25 + L * 0.17
        const grad = ctx.createLinearGradient(0, baseY - amp, 0, h)
        const c = L % 2 === 0 ? ink.accent : ink.accent2
        grad.addColorStop(0, rgb(c, 0.55 * (0.35 + band)))
        grad.addColorStop(1, rgb(c, 0))
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.moveTo(0, h)
        for (let x = 0; x <= w; x += 8) {
          const u = x / w
          const y =
            baseY -
            Math.sin(u * Math.PI * (1.5 + L * 0.6) + f.t * speed) * amp -
            Math.sin(u * Math.PI * 4.3 - f.t * speed * 1.7) * amp * 0.35
          ctx.lineTo(x, y)
        }
        ctx.lineTo(w, h)
        ctx.closePath()
        ctx.fill()
      }
    },
  }
}

/**
 * Bodies on rings, each band a moon.
 *
 * Orbit RADIUS is the band's energy, so the system breathes; speed is fixed per body so they
 * drift out of phase and never re-form the same arrangement. With trails on, the paths draw
 * themselves in like a spirograph.
 */
function orbit(): Visual {
  const N = 7
  let ang: number[] = []
  let rad: number[] = []
  return {
    init() {
      ang = Array.from({ length: N }, (_, i) => (i / N) * Math.PI * 2)
      rad = Array(N).fill(0)
    },
    draw({ ctx, w, h, dt, spec, bins, f, ink }) {
      const cx = w / 2
      const cy = h / 2
      const R = Math.min(w, h) * 0.42
      for (let i = 0; i < N; i++) {
        const band = at(spec, bins, 0.02 + (i / N) * 0.5)
        rad[i] += (band - rad[i]) * Math.min(1, dt * 6)
        ang[i] += dt * (0.25 + i * 0.13) * (1 + f.level)
        const r = R * (0.25 + rad[i] * 0.75)
        const x = cx + Math.cos(ang[i]) * r
        const y = cy + Math.sin(ang[i]) * r
        ctx.beginPath()
        ctx.arc(x, y, 2 + rad[i] * 9, 0, Math.PI * 2)
        ctx.fillStyle = mix(ink.accent, ink.accent2, i / N)
        ctx.fill()
      }
    },
  }
}

/**
 * Stars that find each other.
 *
 * Points placed on a fixed ring per band, wandering slightly; a line is drawn between any two
 * that come close. The web therefore forms and dissolves with the music rather than being drawn
 * from a fixed table — loud passages pull points together and the whole thing meshes.
 */
function constellation(): Visual {
  type S = { x: number; y: number; bx: number; by: number; band: number }
  let ss: S[] = []
  return {
    init(w, h) {
      const n = Math.max(18, Math.min(54, Math.round((w * h) / 24000)))
      ss = Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2
        const r = Math.min(w, h) * (0.18 + ((i * 37) % 100) / 300)
        return {
          bx: w / 2 + Math.cos(a) * r,
          by: h / 2 + Math.sin(a) * r,
          x: 0,
          y: 0,
          band: (i % 12) / 12,
        }
      })
    },
    draw({ ctx, w, h, spec, bins, f, ink }) {
      const pull = f.level * 0.35
      for (const s of ss) {
        const v = at(spec, bins, 0.02 + s.band * 0.5)
        // drift around the anchor, and get tugged toward the centre as things get loud
        s.x = s.bx + Math.sin(f.t * (0.6 + s.band) + s.bx) * 14 * (0.4 + v)
        s.y = s.by + Math.cos(f.t * (0.5 + s.band) + s.by) * 14 * (0.4 + v)
        s.x += (w / 2 - s.x) * pull
        s.y += (h / 2 - s.y) * pull
      }
      const near = Math.min(w, h) * 0.17
      ctx.lineWidth = 1
      for (let i = 0; i < ss.length; i++) {
        for (let j = i + 1; j < ss.length; j++) {
          const d = Math.hypot(ss[i].x - ss[j].x, ss[i].y - ss[j].y)
          if (d > near) continue
          ctx.beginPath()
          ctx.moveTo(ss[i].x, ss[i].y)
          ctx.lineTo(ss[j].x, ss[j].y)
          ctx.strokeStyle = rgb(ink.accent, (1 - d / near) * 0.5)
          ctx.stroke()
        }
      }
      for (const s of ss) {
        const v = at(spec, bins, 0.02 + s.band * 0.5)
        ctx.beginPath()
        ctx.arc(s.x, s.y, 1.2 + v * 4, 0, Math.PI * 2)
        ctx.fillStyle = mix(ink.accent, ink.accent2, v)
        ctx.fill()
      }
    },
  }
}

/**
 * A grid that lights up — the spectrum as a slab of tiles rather than a line.
 *
 * Each cell owns a slice of the spectrum and holds its brightest recent value, decaying. Reads
 * like studio metering hardware, and it is the only mode where you can see the whole spectrum at
 * once as an area rather than a curve.
 */
function cells(): Visual {
  let cols = 1
  let rows = 1
  let heat = new Float32Array(0)
  return {
    init(w, h) {
      cols = Math.max(6, Math.min(28, Math.floor(w / 34)))
      rows = Math.max(4, Math.min(18, Math.floor(h / 34)))
      heat = new Float32Array(cols * rows)
    },
    draw({ ctx, w, h, dt, spec, bins, ink }) {
      const cw = w / cols
      const ch = h / rows
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const idx = y * cols + x
          // wrap the spectrum across the grid, low frequencies at the bottom-left
          const frac = ((rows - 1 - y) * cols + x) / (cols * rows)
          const v = at(spec, bins, Math.pow(frac, 1.4) * 0.75)
          heat[idx] = Math.max(heat[idx] - dt * 1.9, v)
          const k = heat[idx]
          if (k < 0.02) continue
          ctx.fillStyle = mix(ink.accent, ink.accent2, k)
          ctx.globalAlpha = 0.12 + k * 0.88
          const inset = 1.5
          ctx.fillRect(x * cw + inset, y * ch + inset, cw - inset * 2, ch - inset * 2)
        }
      }
      ctx.globalAlpha = 1
    },
  }
}

/**
 * The spectrum wound onto an Archimedean spiral, low frequencies at the middle.
 *
 * A line chart bent into a coil: one continuous read of the whole range where the eye can follow
 * it from bass at the centre outward, with each turn a wider slice. Turning slowly means a
 * sustained note traces a widening ring rather than sitting still.
 */
function spiral(): Visual {
  let phase = 0
  return {
    init() {
      phase = 0
    },
    draw({ ctx, w, h, dt, spec, bins, f, ink }) {
      const cx = w / 2
      const cy = h / 2
      const R = Math.min(w, h) * 0.46
      const turns = 4
      phase += dt * (0.2 + f.level * 0.7)
      const steps = 520
      ctx.beginPath()
      for (let i = 0; i <= steps; i++) {
        const u = i / steps
        const th = u * Math.PI * 2 * turns + phase
        const v = at(spec, bins, Math.pow(u, 1.3) * 0.8)
        const r = R * u * (0.55 + v * 0.65)
        const x = cx + Math.cos(th) * r
        const y = cy + Math.sin(th) * r
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.lineWidth = 1.3 + f.bass * 2.5
      ctx.lineJoin = 'round'
      ctx.strokeStyle = mix(ink.accent, ink.accent2, f.mid)
      ctx.stroke()
    },
  }
}

const MAKERS: Record<VisualId, () => Visual> = {
  bars,
  wave,
  radial,
  rain,
  lissajous,
  tunnel,
  nebula,
  terrain,
  ripple,
  strings,
  petals,
  aurora,
  orbit,
  constellation,
  cells,
  spiral,
}

export function makeVisual(id: VisualId): Visual {
  return MAKERS[id]()
}

/** How much of the last frame a mode wants kept, before the viewer's own Trails dial. */
export function defaultTrail(id: VisualId): number {
  return VISUALS.find((v) => v[0] === id)?.[3] ?? 0
}

/**
 * Rain paints its own scrolling history and must never be faded by the host.
 *
 * ⚠️ It is the one mode that owns its buffer: the host's persistence pass would eat the
 * spectrogram from underneath it, so it opts out entirely.
 */
export function ownsItsBuffer(id: VisualId): boolean {
  return id === 'rain'
}
