import type { Features } from './audioFeatures'
import { sample, type RGB } from './palettes'

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
  | 'fountain'
  | 'ring'
  | 'lava'
  | 'matrix'
  | 'fireworks'
  | 'flock'
  | 'tree'
  | 'weave'
  | 'radar'
  | 'helix'
  | 'serpent'
  | 'kaleido'
  | 'bounce'
  | 'sun'
  | 'stack'

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
  ['fountain', '⛲', 'Fountain', 0.86],
  ['ring', '○', 'Ring', 0.4],
  ['lava', '🟠', 'Lava', 0.2],
  ['matrix', '🔣', 'Matrix', 0.75],
  ['fireworks', '🎆', 'Fireworks', 0.9],
  ['flock', '🐦', 'Flock', 0.7],
  ['tree', '🌳', 'Tree', 0.6],
  ['weave', '▓', 'Weave', 0.3],
  ['radar', '📡', 'Radar', 0.92],
  ['helix', '🧬', 'Helix', 0.5],
  ['serpent', '🐍', 'Serpent', 0.8],
  ['kaleido', '❉', 'Kaleido', 0.55],
  ['bounce', '🏐', 'Bounce', 0.82],
  ['sun', '☀️', 'Sun', 0.35],
  ['stack', '📚', 'Stack', 0],
]

export type Ink = {
  accent: [number, number, number]
  accent2: [number, number, number]
  ink: [number, number, number]
  /**
   * The colour ramp this drawing should use, as stops sampled by hue().
   *
   * ⚠️ Every mode asks for colour the same way — "the colour for 0.7" — so no mode has to
   * know which palette is on, and adding a palette changes all sixteen at once. Empty means the
   * viewer chose Theme, and hue() falls back to their accent pair, which is what keeps a profile
   * showing its owner's colours.
   */
  stops: RGB[]
  /**
   * How far off the floor of the ramp to start, 0-1.
   *
   * ⚠️ THE RAMPS ARE GRADIENTS, AND A GRADIENT'S DARK END IS NOT A COLOUR YOU CAN DRAW WITH.
   * Every ramp is authored dark-to-bright the way a fire or a sunset goes, which is right for a
   * filled background and wrong for picking an element's colour: twenty-one of the twenty-seven
   * start below 0.11 luminance and six start below 0.06, so anything asking for a low value was
   * drawn near-black ON a dark page. Quiet music asks for low values almost all of the time.
   *
   * That is why glow had to be "just right" to see anything: bloom adds light additively, so it
   * was being used to put back brightness the ramp had refused to give. Lifting the floor here
   * costs one multiply-add per colour and no fill rate at all, while glow costs a blur and a
   * full-canvas composite every frame — so this is the cheap end of the same want.
   *
   * 0 is exactly the old behaviour, for anyone who liked it.
   */
  lift: number
}

/**
 * Where the pointer is, in the visual's own coordinates.
 *
 * ⚠️ Not every mode should use this. A pointer shoved into Bars or Rain would be decoration
 * bolted onto a chart — those read along an axis, and moving their origin makes them harder to
 * read for no gain. The modes that take it are the ones with a CENTRE to move, a field to push,
 * or something to pluck. Three of the sixteen deliberately ignore it.
 */
export type Pointer = {
  /** CSS pixels inside the surface. Meaningless unless `inside`. */
  x: number
  y: number
  inside: boolean
  /** pixels per second, for modes that care about a flick rather than a position */
  vx: number
  vy: number
  down: boolean
  /** seconds since the last press, and where it landed */
  sinceClick: number
  clickX: number
  clickY: number
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
  /** the mouse, for modes that have somewhere to put it */
  p: Pointer
  ink: Ink
}

/** A mode's centre: the pointer when it is over the canvas, the middle when it is not. */
const centre = (p: Pointer, w: number, h: number): [number, number] =>
  p.inside ? [p.x, p.y] : [w / 2, h / 2]

export type Visual = {
  init(w: number, h: number): void
  draw(f: Frame): void
}

const rgb = (c: [number, number, number], a = 1) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`

/**
 * The viewer's brightness preference, for the drawings that are not the visualiser itself.
 *
 * ⚠️ The profile backdrop and the song map build their own Ink, and they were dark for
 * exactly the same reason - they sample the same gradient ramps. Reading the one setting here
 * means somebody who turned brightness up because the visualiser looked dim does not have to
 * find two more controls that do not exist.
 */
export const readLift = (): number => {
  try {
    const n = Number(localStorage.getItem('viz_bright_v1'))
    return Number.isFinite(n) && n >= 0 && n <= 0.6 ? n : 0.28
  } catch {
    return 0.28
  }
}

/**
 * The colour for a value between 0 and 1 — the one call every mode makes.
 *
 * With a palette chosen it samples that ramp. With Theme chosen there is no ramp, so it blends
 * the viewer's own two accents exactly as this did before palettes existed: same behaviour,
 * same file, one code path.
 */
function hue(ink: Ink, t: number, alpha = 1): string {
  // the floor lift, one multiply-add: see Ink.lift for why the ramps need it
  const raw = Math.max(0, Math.min(1, t))
  const k = ink.lift + raw * (1 - ink.lift)
  const c: RGB = ink.stops.length
    ? sample(ink.stops, k)
    : [
        Math.round(ink.accent[0] + (ink.accent2[0] - ink.accent[0]) * k),
        Math.round(ink.accent[1] + (ink.accent2[1] - ink.accent[1]) * k),
        Math.round(ink.accent[2] + (ink.accent2[2] - ink.accent[2]) * k),
      ]
  return alpha === 1
    ? `rgb(${c[0]}, ${c[1]}, ${c[2]})`
    : `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`
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
/**
 * How strongly the pointer should affect something at `x`, 0–1.
 *
 * ⚠️ Shared by the modes that had NO pointer response at all. Bars, Wave and Rain ignored it
 * completely, which meant the whole Motion tab — the mouse, and the auto-path built on top of it
 * — did nothing on three of the sixteen modes. A control that silently does nothing on the mode
 * you happen to have picked is worse than one that is missing: you conclude the feature is
 * broken rather than that it does not apply.
 *
 * A soft falloff rather than a hard radius, so passing the pointer over a row of bars swells them
 * and lets them down again instead of switching a band on.
 */
function reach(p: Pointer, x: number, top: number, bottom: number, radius: number): number {
  if (!p.inside) return 0
  // ⚠️ Distance to the BAR, not to its tip. Measuring to the top alone meant a quiet band —
  // whose bar is two pixels tall — could only be touched by hovering exactly on that sliver,
  // so the pointer appeared to do nothing across most of the spectrum. Clamping into the bar's
  // vertical span makes "near this column" enough, which is what reaching for a bar means.
  const dy = p.y < top ? top - p.y : p.y > bottom ? p.y - bottom : 0
  const d = Math.hypot(p.x - x, dy)
  if (d > radius) return 0
  const k = 1 - d / radius
  return k * k
}

function bars(): Visual {
  let peaks = new Float32Array(0)
  let n = 0
  return {
    init(w) {
      n = Math.max(8, Math.min(64, Math.floor(w / 14)))
      peaks = new Float32Array(n)
    },
    draw({ ctx, w, h, dt, spec, bins, p, ink }) {
      const gap = Math.max(1, w / n / 6)
      const bw = w / n - gap
      for (let i = 0; i < n; i++) {
        const lo = Math.floor(Math.pow(i / n, 1.7) * bins)
        const hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / n, 1.7) * bins))
        let sum = 0
        for (let k = lo; k < hi; k++) sum += spec[k]
        let v = sum / (hi - lo) / 255
        const x = i * (bw + gap) + gap / 2
        /**
         * The pointer lifts the bars it is over.
         *
         * ⚠️ Measured to the bar's TOP, not to its base, so running along the bottom of the
         * canvas does not swell the whole spectrum at once. You have to reach for a bar, which is
         * what makes it feel like touching them rather than like a proximity field.
         */
        v = Math.min(1, v + reach(p, x + bw / 2, h - v * h * 0.92, h, h * 0.3) * 0.45)
        const bh = Math.max(2, v * h * 0.92)
        ctx.fillStyle = hue(ink, v)
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
    draw({ ctx, w, h, wave: buf, waveN, f, p, ink }) {
      const mid = h / 2
      const amp = h * 0.42
      const step = Math.max(1, Math.floor(waveN / Math.max(1, w)))
      ctx.strokeStyle = rgb(ink.ink, 0.12)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, mid)
      ctx.lineTo(w, mid)
      ctx.stroke()
      /**
       * The pointer drags the line toward itself.
       *
       * ⚠️ A pull toward the cursor's Y, falling off with distance along X — not a vertical
       * offset added to the whole line. Offsetting everything would just move the waveform up and
       * down the screen; pulling locally makes the line stretch, which is the thing that looks
       * like a string being touched.
       */
      const pull = (x: number, y: number) => {
        if (!p.inside) return y
        const k = Math.max(0, 1 - Math.abs(p.x - x) / (w * 0.28))
        return y + (p.y - y) * k * k * 0.7
      }
      const line = (width: number, alpha: number) => {
        ctx.beginPath()
        for (let i = 0; i < waveN; i += step) {
          const x = (i / waveN) * w
          const y = pull(x, mid + ((buf[i] - 128) / 128) * amp)
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.lineWidth = width
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.strokeStyle = hue(ink, 0, alpha)
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
    draw({ ctx, w, h, dt, spec, bins, f, p, ink }) {
      const [cx, cy] = centre(p, w, h)
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
          ctx.strokeStyle = hue(ink, v)
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
    draw({ ctx, w, h, spec, bins, p, ink }) {
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
        ctx.fillStyle = v < 0.04 ? rgb(ink.ink, 0.05) : hue(ink, v)
        ctx.fillRect(w - col, h - (i + 1) * rh, col + 1, rh + 1)
      }
      /**
       * The pointer writes into the spectrogram.
       *
       * ⚠️ Drawn into the NEWEST column, so it scrolls away with the history rather than sitting
       * on top of it as an overlay. That is the whole reason this is the right gesture for this
       * mode: everything here is a record of a moment, so a mark you make should become part of
       * the record and travel left with it. An overlay would be a cursor; this is a pen.
       *
       * It also gives Rain a pointer at all — it had none, which meant the mouse and the
       * auto-path did nothing whatsoever on it.
       */
      if (p.inside) {
        const y = Math.max(0, Math.min(h, p.y))
        ctx.globalAlpha = 1
        ctx.fillStyle = rgb(ink.ink, 0.95)
        ctx.fillRect(w - col, y - 1, col + 1, 3)
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
    draw({ ctx, w, h, wave: buf, waveN, f, p, ink }) {
      const [cx, cy] = centre(p, w, h)
      // holding the button squeezes the figure — a scope's gain knob, basically
      const r = Math.min(w, h) * 0.42 * (p.down ? 0.55 : 1)
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
      ctx.strokeStyle = hue(ink, f.treble)
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
    draw({ ctx, w, h, dt, f, p, ink }) {
      const [cx, cy] = centre(p, w, h)
      const max = Math.hypot(w, h) * 0.6
      if (f.beat) rings.push({ r: 4, hue: f.bass, born: f.t })
      // a click throws one by hand, so the tunnel answers you even in silence
      if (p.down && p.sinceClick < 0.05) rings.push({ r: 4, hue: 1, born: f.t })
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
        ctx.strokeStyle = hue(ink, ring.hue)
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
  type P = { x: number; y: number; vx: number; vy: number; s: number; hr: number }
  let ps: P[] = []
  /**
   * The size the particles were last positioned for.
   *
   * ⚠️ NOT the size init was given. Zoom changes how big the drawing surface is WITHOUT a resize
   * — the modes are told the canvas is w/zoom across, so they lay out for that — and this mode
   * used to keep the width and height it was built with and centre on those forever. Zoom out and
   * the cloud went on orbiting the middle of the old, smaller canvas, which is up in the top-left
   * corner of the new one. That is the reported drift, and it was every mode that remembered a
   * size instead of reading the one it is handed.
   */
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
        /**
         * ⚠️ Each particle keeps its OWN resting radius, and that is what makes this a cloud.
         *
         * One shared radius means one spring equilibrium, and everything drifts onto it — the
         * field collapses into a hollow ring with an empty middle, which is a worse picture than
         * the edge-hugging it replaced. Spreading the rest radii spreads the particles.
         *
         * sqrt, because radius is not area: uniform radii bunch everything in the middle, since
         * a thin ring near the edge holds far more room than one near the centre.
         */
        hr: Math.sqrt(Math.random()) * 0.92,
      }))
    },
    draw({ ctx, w, h, dt, f, p: ptr, ink }) {
      /* the surface changed under us (a zoom, not a resize) — carry the cloud across rather than
         reseeding it, so the picture moves with the frame instead of restarting */
      if (w !== W || h !== H) {
        const sx = w / W
        const sy = h / H
        for (const p of ps) {
          p.x *= sx
          p.y *= sy
        }
        W = w
        H = h
      }
      const cx = W / 2
      const cy = H / 2
      const reach = Math.min(W, H) * 0.46
      for (const p of ps) {
        const dx = p.x - cx
        const dy = p.y - cy
        const d = Math.hypot(dx, dy) || 1
        /**
         * ⚠️ A BREATH, not a constant push.
         *
         * The outward force used to be proportional to bass and permanently outward, so with any
         * bass at all the whole field migrated to the edges and stayed there — wrapping made it
         * worse rather than better, because a particle that wrapped re-entered far from the
         * centre and was immediately pushed out again. It emptied the middle of the picture,
         * which is the part you are looking at.
         *
         * Now bass KICKS outward on the beat and a soft spring pulls everything home between
         * kicks, so the cloud expands and gathers instead of leaving. The spring gets stronger
         * the further out a particle is, which is what stops anything reaching the wall at all.
         */
        const kick = (f.beat ? 900 * (0.4 + f.beatStrength) : 0) + f.bass * 90
        // pulled toward this particle's own rest radius, in both directions, so the cloud fills
        // rather than settling onto a single shell
        const pull = (d / reach - p.hr) * 300
        const radial = kick - pull
        p.vx += (dx / d) * radial * dt + (Math.random() - 0.5) * f.treble * 90 * dt
        p.vy += (dy / d) * radial * dt + (Math.random() - 0.5) * f.treble * 90 * dt
        // a little swirl, so a gathered cloud keeps moving rather than sitting in a lump
        p.vx += (-dy / d) * (12 + f.mid * 40) * dt
        p.vy += (dx / d) * (12 + f.mid * 40) * dt
        /**
         * The pointer repels, and attracts while held.
         *
         * ⚠️ Falls off with distance and is CLAMPED near zero. An inverse-square force with
         * no floor flings a particle to infinity the moment the cursor lands on it and it never
         * returns — the field quietly empties as you wave the mouse around.
         */
        if (ptr.inside) {
          const rx = p.x - ptr.x
          const ry = p.y - ptr.y
          const rd = Math.max(24, Math.hypot(rx, ry))
          const force = ((ptr.down ? -1 : 1) * 9000) / (rd * rd)
          p.vx += (rx / rd) * force * dt * 60
          p.vy += (ry / rd) * force * dt * 60
        }
        p.vx *= 0.97
        p.vy *= 0.97
        p.x += p.vx * dt * 60 * 0.06
        p.y += p.vy * dt * 60 * 0.06
        // ⚠️ No wrapping any more. Wrapping fought the spring — a particle teleporting from
        // one edge to the other reverses which way "home" is, so the two rules disagreed about
        // where every particle should go. The spring alone keeps them in frame.
        const v = Math.min(1, Math.hypot(p.vx, p.vy) / 60)
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.s * (1 + f.level), 0, Math.PI * 2)
        ctx.fillStyle = hue(ink, v)
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
    draw({ ctx, w, h, spec, bins, p, ink }) {
      const next = new Float32Array(cols)
      for (let i = 0; i < cols; i++) next[i] = at(spec, bins, Math.pow(i / cols, 1.6) * 0.8)
      rows.unshift(next)
      if (rows.length > ROWS) rows.pop()
      // pointer height raises or lowers the eye — a flatter view, or a steeper one
      const horizon = h * (p.inside ? 0.12 + (p.y / h) * 0.34 : 0.28)
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
        ctx.strokeStyle = hue(ink, k)
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
  /** seconds until the next ambient ring — see the note in draw */
  let idle = 0
  return {
    init() {
      rs = []
      idle = 0
    },
    draw({ ctx, w, h, dt, f, p, ink }) {
      // your own stone, exactly where you put it
      if (p.down && p.sinceClick < 0.05) {
        rs.push({ x: p.clickX, y: p.clickY, r: 2, strength: 1 })
      }
      /**
       * ⚠️ A RIPPLE THAT ONLY ANSWERS ONSETS SHOWS NOTHING AT ALL ON STEADY SOUND.
       *
       * Every ring here used to need either a beat or a click, so a held pad, a drone, or a quiet
       * passage left the canvas completely black — and a mode that draws nothing is
       * indistinguishable from a mode that is broken. It measured zero painted pixels in an audit
       * of all sixteen; it was the only one that did.
       *
       * A slow ring shed from wherever the pointer is keeps water on the surface between onsets,
       * scaled by loudness so silence really is still. The beat rings below are unchanged and
       * still the loud event; this is the difference between a pond and a blank wall.
       */
      idle -= dt
      if (idle <= 0 && f.level > 0.02) {
        /**
         * ⚠️ Placed by BAND CONTENT, like the beat rings below, not merely at the centre.
         *
         * Centred ambient rings made the mode answer loudness and nothing else: two completely
         * different pieces of music produced an identical picture as long as they were the same
         * volume. Offsetting by treble and bass means bright material ripples from a different
         * place than heavy material does, so what you play is visible and not just that you are
         * playing.
         *
         * Your pointer still wins outright when it is over the canvas, since a stone you place
         * yourself should land where you put it.
         */
        const [cx, cy] = centre(p, w, h)
        const x = p.inside ? cx : w * (0.2 + f.treble * 0.6)
        const y = p.inside ? cy : h * (0.8 - f.bass * 0.55)
        rs.push({ x, y, r: 2, strength: 0.12 + f.level * 0.3 })
        idle = 0.45 - Math.min(0.3, f.level * 0.5)
      }
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
        ctx.strokeStyle = hue(ink, k)
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
    draw({ ctx, w, h, dt, spec, bins, f, p, ink }) {
      // whichever string the pointer is crossing, and only while it is actually moving
      const spacing = h / (N + 1)
      const touched =
        p.inside && Math.abs(p.vx) + Math.abs(p.vy) > 40 ? Math.round(p.y / spacing) - 1 : -1
      for (let i = 0; i < N; i++) {
        const band = at(spec, bins, 0.02 + (i / N) * 0.5)
        // pluck on a beat, otherwise decay — a string rings out, it does not track the envelope
        energy[i] = Math.max(energy[i] - dt * 1.6, f.beat ? Math.max(energy[i], band) : band * 0.55)
        // dragging across a string plucks it, which is what strings are for
        if (i === touched) energy[i] = Math.max(energy[i], 0.85)
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
        ctx.strokeStyle = hue(ink, i / N)
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
    draw({ ctx, w, h, dt, f, p, ink }) {
      const [cx, cy] = centre(p, w, h)
      const R = Math.min(w, h) * (0.2 + f.level * 0.22)
      // eased toward the target so petals morph rather than snap between shapes, and the
      // pointer's height adds petals — sweeping up and down walks through whole flowers
      const target = 2 + f.mid * 6 + f.treble * 3 + (p.inside ? (1 - p.y / h) * 5 : 0)
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
      ctx.strokeStyle = hue(ink, f.bass)
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
  const LAYERS = 7
  return {
    init() {},
    draw({ ctx, w, h, spec, bins, f, p, ink }) {
      // the curtains lean toward the pointer, nearer layers leaning further
      const lean = p.inside ? (p.x / w - 0.5) * 2 : 0
      for (let L = 0; L < LAYERS; L++) {
        const band = at(spec, bins, 0.02 + (L / LAYERS) * 0.4)
        const baseY = h * (0.3 + (L / LAYERS) * 0.4)
        const amp = h * (0.05 + band * 0.22)
        const speed = 0.25 + L * 0.17
        /**
         * Each curtain is drawn twice: a soft body that falls away downward, and a bright crest
         * along its top edge.
         *
         * ⚠️ The crest is what was missing. A gradient alone is a smear — real aurora reads as
         * light because it has a hard bright line where the curtain folds, with the glow hanging
         * beneath it. One extra stroke per layer buys the whole effect.
         */
        const crest: number[] = []
        for (let x = 0; x <= w; x += 8) {
          const u = x / w
          crest.push(
            baseY -
              Math.sin(u * Math.PI * (1.5 + L * 0.6) + f.t * speed + lean * (1 + L * 0.3)) * amp -
              Math.sin(u * Math.PI * 4.3 - f.t * speed * 1.7) * amp * 0.35 -
              // a third, faster ripple that only the treble drives, so cymbals shiver the edge
              Math.sin(u * Math.PI * 9.1 + f.t * 2.4) * amp * 0.12 * f.treble,
          )
        }

        const grad = ctx.createLinearGradient(0, baseY - amp, 0, h)
        const tone = L / (LAYERS - 1)
        grad.addColorStop(0, hue(ink, tone, 0.5 * (0.3 + band)))
        grad.addColorStop(1, hue(ink, tone, 0))
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.moveTo(0, h)
        crest.forEach((y, i) => ctx.lineTo(i * 8, y))
        ctx.lineTo(w, h)
        ctx.closePath()
        ctx.fill()

        ctx.beginPath()
        crest.forEach((y, i) => (i === 0 ? ctx.moveTo(0, y) : ctx.lineTo(i * 8, y)))
        ctx.lineWidth = 1.2 + band * 2.2
        ctx.lineJoin = 'round'
        ctx.strokeStyle = hue(ink, Math.min(1, tone + 0.25), 0.35 + band * 0.65)
        ctx.stroke()
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
    draw({ ctx, w, h, dt, spec, bins, f, p, ink }) {
      const [cx, cy] = centre(p, w, h)
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
        ctx.fillStyle = hue(ink, i / N)
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
  /**
   * ⚠️ ANCHORS ARE POLAR AND FRACTIONAL, not pixels remembered from init.
   *
   * They used to be absolute coordinates worked out once from the size this mode was built with.
   * Zoom does not resize anything — it tells the modes the canvas is w/zoom across — so those
   * anchors went on describing the middle of the old, smaller canvas, and the whole web sat up in
   * the top-left corner of the new one. An angle and a fraction of the short side mean the ring
   * is re-derived from whatever size the frame actually is, and follows a zoom exactly.
   *
   * `seed` carries the drift phase, which used to be taken from the anchor's x. Deriving it from
   * a position that now changes with zoom would make every star jump when you touched the wheel.
   */
  type S = { x: number; y: number; a: number; rf: number; seed: number; band: number }
  let ss: S[] = []
  return {
    init(w, h) {
      const n = Math.max(18, Math.min(54, Math.round((w * h) / 24000)))
      ss = Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2
        const rf = 0.18 + ((i * 37) % 100) / 300
        return {
          a,
          rf,
          seed: Math.cos(a) * rf * 600,
          x: 0,
          y: 0,
          band: (i % 12) / 12,
        }
      })
    },
    draw({ ctx, w, h, spec, bins, f, p, ink }) {
      const pull = f.level * 0.35
      const R = Math.min(w, h)
      for (const s of ss) {
        const v = at(spec, bins, 0.02 + s.band * 0.5)
        const bx = w / 2 + Math.cos(s.a) * R * s.rf
        const by = h / 2 + Math.sin(s.a) * R * s.rf
        // drift around the anchor, and get tugged toward the centre as things get loud
        s.x = bx + Math.sin(f.t * (0.6 + s.band) + s.seed) * 14 * (0.4 + v)
        s.y = by + Math.cos(f.t * (0.5 + s.band) + s.seed) * 14 * (0.4 + v)
        s.x += (w / 2 - s.x) * pull
        s.y += (h / 2 - s.y) * pull
      }
      const near = Math.min(w, h) * 0.17
      const near2 = near * near
      ctx.lineWidth = 1

      /**
       * ⚠️ BUCKETED INTO FIVE PATHS, not one stroke per line.
       *
       * The pairwise loop is O(n²) — around 700 candidate lines at 37 stars, and it was calling
       * beginPath/stroke for every one of them. Measured at 4.65ms a frame on a 1280x700 stage,
       * which is 28% of the entire 60fps budget for one mode; nothing else here costs more than
       * 0.35ms. A stroke is a pipeline flush, so the count of them is what matters, not the
       * length of the lines.
       *
       * Opacity is what forced one stroke per line, since it varies with distance. Rounding it
       * into five bands means five paths and five strokes for the whole web — visually
       * indistinguishable from a smooth gradient, and about thirty times faster.
       *
       * The distance test is squared too: a hypot per pair is a square root nobody needs when
       * the only question is "closer than `near`".
       */
      const BANDS = 5
      const webs: Path2D[] = Array.from({ length: BANDS }, () => new Path2D())
      const cursorWeb: Path2D[] = Array.from({ length: BANDS }, () => new Path2D())

      for (let i = 0; i < ss.length; i++) {
        for (let j = i + 1; j < ss.length; j++) {
          const dx = ss[i].x - ss[j].x
          const dy = ss[i].y - ss[j].y
          const d2 = dx * dx + dy * dy
          if (d2 > near2) continue
          const closeness = 1 - Math.sqrt(d2) / near
          const band = Math.min(BANDS - 1, Math.floor(closeness * BANDS))
          webs[band].moveTo(ss[i].x, ss[i].y)
          webs[band].lineTo(ss[j].x, ss[j].y)
        }
      }
      for (let b = 0; b < BANDS; b++) {
        ctx.strokeStyle = hue(ink, 0, ((b + 0.5) / BANDS) * 0.5)
        ctx.stroke(webs[b])
      }

      // the cursor joins the web: lines reach for it, so the constellation follows you around
      if (p.inside) {
        const reach = near * 1.5
        const reach2 = reach * reach
        for (const s of ss) {
          const dx = s.x - p.x
          const dy = s.y - p.y
          const d2 = dx * dx + dy * dy
          if (d2 > reach2) continue
          const closeness = 1 - Math.sqrt(d2) / reach
          const band = Math.min(BANDS - 1, Math.floor(closeness * BANDS))
          cursorWeb[band].moveTo(p.x, p.y)
          cursorWeb[band].lineTo(s.x, s.y)
        }
        for (let b = 0; b < BANDS; b++) {
          ctx.strokeStyle = hue(ink, 1, ((b + 0.5) / BANDS) * 0.7)
          ctx.stroke(cursorWeb[b])
        }
      }
      for (const s of ss) {
        const v = at(spec, bins, 0.02 + s.band * 0.5)
        ctx.beginPath()
        ctx.arc(s.x, s.y, 1.2 + v * 4, 0, Math.PI * 2)
        ctx.fillStyle = hue(ink, v)
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
    draw({ ctx, w, h, dt, spec, bins, p, ink }) {
      const cw = w / cols
      const ch = h / rows
      const hotX = p.inside ? Math.floor(p.x / cw) : -9
      const hotY = p.inside ? Math.floor(p.y / ch) : -9
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const idx = y * cols + x
          // wrap the spectrum across the grid, low frequencies at the bottom-left
          const frac = ((rows - 1 - y) * cols + x) / (cols * rows)
          const v = at(spec, bins, Math.pow(frac, 1.4) * 0.75)
          heat[idx] = Math.max(heat[idx] - dt * 1.9, v)
          // a soft pool under the cursor rather than one hard tile, so it reads as a torch
          // being carried across the grid
          const near = Math.max(Math.abs(x - hotX), Math.abs(y - hotY))
          if (near <= 1) heat[idx] = Math.max(heat[idx], near === 0 ? 1 : 0.45)
          const k = heat[idx]
          if (k < 0.02) continue
          ctx.fillStyle = hue(ink, k)
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
 * Fountain — the beat throws particles up, and gravity brings them back.
 *
 * ⚠️ the only mode here with real physics. Everything else positions things from the
 * spectrum every frame, so the picture is a direct readout; here the audio applies a FORCE and
 * what you see is the history of those forces. That is why it keeps moving through a quiet
 * passage — the last beat is still falling — and why it reads as a thing being played rather than
 * a meter being driven.
 */
function fountain(): Visual {
  type P = { x: number; y: number; vx: number; vy: number; life: number; tone: number }
  let ps: P[] = []
  return {
    init() {
      ps = []
    },
    draw({ ctx, w, h, dt, f, p: ptr, ink }) {
      const [cx, cy] = centre(ptr, w, h)
      const base = ptr.inside ? cy : h * 0.86
      /* a beat launches a burst; loudness alone trickles, so quiet music still has a spout */
      const launching = f.beat ? 14 + Math.round(f.beatStrength * 22) : f.level > 0.04 ? 2 : 0
      for (let i = 0; i < launching && ps.length < 420; i++) {
        const spread = 0.5 + f.treble * 1.1
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * spread
        const speed = (120 + Math.random() * 190) * (0.5 + f.level + f.bass * 0.9)
        ps.push({
          x: cx + (Math.random() - 0.5) * 12,
          y: base,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1,
          tone: Math.random(),
        })
      }
      const G = 460
      for (const q of ps) {
        q.vy += G * dt
        q.x += q.vx * dt
        q.y += q.vy * dt
        q.life -= dt * 0.42
        const r = 1.4 + q.tone * 2.6 + f.level * 2
        ctx.beginPath()
        ctx.arc(q.x, q.y, r, 0, Math.PI * 2)
        ctx.fillStyle = hue(ink, q.tone, Math.max(0, Math.min(1, q.life)))
        ctx.fill()
      }
      ps = ps.filter((q) => q.life > 0 && q.y < h + 40)
    },
  }
}

/**
 * Ring — the waveform itself, bent into a circle.
 *
 * ⚠️ this is the WAVE, not the spectrum. Radial already draws frequency as spokes; what is
 * missing from a circle is the actual shape of the sound, and wrapping it end to end means the
 * loop closes — a steady tone becomes a still ring, and a noisy one becomes a rough one. Reading
 * the buffer as a closed loop is the whole trick, so the join has no seam.
 */
function ring(): Visual {
  return {
    init() {},
    draw({ ctx, w, h, wave, waveN, f, p: ptr, ink }) {
      const [cx, cy] = centre(ptr, w, h)
      const R = Math.min(w, h) * (0.2 + f.level * 0.1)
      const swing = Math.min(w, h) * 0.16
      const N = Math.min(waveN, 512)
      ctx.lineWidth = 1.5 + f.level * 3
      ctx.strokeStyle = hue(ink, 0.5 + f.mid * 0.4)
      ctx.beginPath()
      for (let i = 0; i <= N; i++) {
        /* i % N so the last point IS the first: the loop closes with no seam */
        const v = (wave[(i % N) * Math.floor(waveN / N)] - 128) / 128
        const a = (i / N) * Math.PI * 2
        const r = R + v * swing
        const x = cx + Math.cos(a) * r
        const y = cy + Math.sin(a) * r
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.stroke()
      /* a second, quieter ring inside, lagging on the bass, so the middle is not empty */
      ctx.beginPath()
      ctx.arc(cx, cy, R * (0.42 + f.bass * 0.3), 0, Math.PI * 2)
      ctx.strokeStyle = hue(ink, f.bass, 0.5)
      ctx.lineWidth = 1 + f.bass * 5
      ctx.stroke()
    },
  }
}

/**
 * Lava — three soft blobs that swell with the bands and melt into each other.
 *
 * ⚠️ no particles and no edges, which is why it is here. Every other mode draws COUNTABLE
 * things — bars, dots, lines — and reads as data even when it is pretty. This one has nothing to
 * count, so it reads as atmosphere, and it is the one to leave running behind something else.
 * Drawn as three gradients composited additively: cheap at any size, and the overlaps make the
 * colours rather than a palette lookup doing it.
 */
function lava(): Visual {
  return {
    init() {},
    draw({ ctx, w, h, f, p: ptr, ink }) {
      const prev = ctx.globalCompositeOperation
      ctx.globalCompositeOperation = 'lighter'
      const bands = [f.bass, f.mid, f.treble]
      for (let i = 0; i < 3; i++) {
        const band = bands[i]
        const a = f.t * (0.18 + i * 0.09)
        const x = w * (0.5 + Math.cos(a + i * 2.1) * 0.26)
        const y = h * (0.5 + Math.sin(a * 1.3 + i * 1.7) * 0.24)
        const r = Math.min(w, h) * (0.18 + band * 0.34)
        const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(1, r))
        g.addColorStop(0, hue(ink, i / 2, 0.5 + band * 0.4))
        g.addColorStop(0.6, hue(ink, i / 2, 0.12 + band * 0.1))
        g.addColorStop(1, hue(ink, i / 2, 0))
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
      }
      /* the pointer is a fourth blob, so there is something to do with a mouse in here */
      if (ptr.inside) {
        const r = Math.min(w, h) * (0.1 + f.level * 0.2)
        const g = ctx.createRadialGradient(ptr.x, ptr.y, 0, ptr.x, ptr.y, Math.max(1, r))
        g.addColorStop(0, hue(ink, 1, 0.45))
        g.addColorStop(1, hue(ink, 1, 0))
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(ptr.x, ptr.y, r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalCompositeOperation = prev
    },
  }
}

/**
 * Matrix — columns of glyphs falling, each column driven by its own slice of the spectrum.
 *
 * ⚠️ the columns fall at a speed set by their BAND, not by a fixed rate — so bass columns
 * pour and treble columns flicker, and the spectrum is legible as motion rather than as height.
 * It is the only mode that draws text, which is most of why it looks unlike the rest.
 *
 * The glyph for a cell is chosen from its position and a slow clock rather than at random per
 * frame: random every frame is a seizure, and a character that holds for a moment is what makes
 * this read as falling code.
 */
function matrix(): Visual {
  const GLYPHS = '01<>[]{}/\\|=+*#$@&%'
  let cols = 0
  let head: number[] = []
  return {
    init(w) {
      /**
       * ⚠️ Capped at 48 columns, not the 64 a wide canvas would allow. Text is the most expensive
       * thing drawn anywhere in this file, and columns multiply by tail length: at 64 wide with a
       * long tail this was averaging around 340 fillText calls a frame, in a file whose own budget
       * note records 700 strokes costing 28% of a frame. 48 keeps the look and roughly halves it.
       */
      cols = Math.max(8, Math.min(48, Math.floor(w / 18)))
      head = Array.from({ length: cols }, () => Math.random() * 40)
    },
    draw({ ctx, w, h, dt, spec, bins, f, p: ptr, ink }) {
      const cw = w / cols
      const size = Math.max(8, Math.min(20, cw * 0.9))
      const rows = Math.ceil(h / size) + 1
      ctx.font = `${size}px ui-monospace, SFMono-Regular, Menlo, monospace`
      ctx.textAlign = 'center'
      for (let c = 0; c < cols; c++) {
        const band = at(spec, bins, 0.02 + (c / cols) * 0.6)
        head[c] += dt * (2 + band * 26 + f.level * 6)
        if (head[c] > rows + 6) head[c] = -Math.random() * 8
        const lit = Math.round(head[c])
        const tail = 5 + Math.round(band * 7)
        for (let k = 0; k < tail; k++) {
          const r = lit - k
          if (r < 0 || r > rows) continue
          const ch = GLYPHS[(c * 7 + r * 3 + Math.floor(f.t * 6)) % GLYPHS.length]
          const fade = 1 - k / tail
          ctx.fillStyle = hue(ink, k === 0 ? 1 : band, fade * (0.25 + band * 0.75))
          ctx.fillText(ch, c * cw + cw / 2, r * size)
        }
      }
      /* the pointer wipes a column bright, which is the one thing a hand can do to falling code */
      if (ptr.inside) {
        const c = Math.max(0, Math.min(cols - 1, Math.floor(ptr.x / cw)))
        head[c] = Math.max(head[c], ptr.y / size)
      }
      ctx.textAlign = 'start'
    },
  }
}

/**
 * Fireworks — a shell per beat, bursting where it runs out of climb.
 *
 * ⚠️ Fountain is a CONTINUOUS spout and this is DISCRETE events, which is why both earn a
 * place. There, the beat adds to a stream that is always running; here, nothing happens at all
 * between beats and each one is a separate object with a life of its own. On quiet music Fountain
 * trickles and this goes dark, and that difference is the point.
 */
function fireworks(): Visual {
  type Spark = { x: number; y: number; vx: number; vy: number; life: number; tone: number }
  type Shell = { x: number; y: number; vy: number; fuse: number; tone: number }
  let shells: Shell[] = []
  let sparks: Spark[] = []
  return {
    init() {
      shells = []
      sparks = []
    },
    draw({ ctx, w, h, dt, f, p: ptr, ink }) {
      if (f.beat && shells.length < 6) {
        shells.push({
          x: ptr.inside ? ptr.x : w * (0.2 + Math.random() * 0.6),
          y: h,
          vy: -(240 + f.beatStrength * 260),
          fuse: 0.5 + Math.random() * 0.4,
          tone: Math.random(),
        })
      }
      const G = 220
      for (const sh of shells) {
        sh.y += sh.vy * dt
        sh.vy += G * dt
        sh.fuse -= dt
        ctx.beginPath()
        ctx.arc(sh.x, sh.y, 2.4, 0, Math.PI * 2)
        ctx.fillStyle = hue(ink, sh.tone)
        ctx.fill()
        if (sh.fuse <= 0 && sparks.length < 500) {
          const n = 26 + Math.round(f.beatStrength * 26)
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2
            const sp = 90 + Math.random() * 150
            sparks.push({
              x: sh.x,
              y: sh.y,
              vx: Math.cos(a) * sp,
              vy: Math.sin(a) * sp,
              life: 1,
              tone: (sh.tone + Math.random() * 0.15) % 1,
            })
          }
        }
      }
      shells = shells.filter((sh) => sh.fuse > 0 && sh.y > -20)
      for (const q of sparks) {
        q.vy += G * 0.6 * dt
        q.x += q.vx * dt
        q.y += q.vy * dt
        q.life -= dt * 0.75
        ctx.beginPath()
        ctx.arc(q.x, q.y, 1.6 + q.life * 1.6, 0, Math.PI * 2)
        ctx.fillStyle = hue(ink, q.tone, Math.max(0, q.life))
        ctx.fill()
      }
      sparks = sparks.filter((q) => q.life > 0)
    },
  }
}

/**
 * Flock — points that steer by their neighbours rather than by the spectrum.
 *
 * ⚠️ the audio does not POSITION anything here; it changes the RULES. Loudness raises the
 * speed, treble raises the urge to separate, bass pulls the flock together — and what you watch
 * is the shape those pressures produce. That is why it is the only mode where the picture is not
 * a function of this frame's numbers, and why it keeps its character through a chorus.
 *
 * The neighbour loop is O(n²), so the count is deliberately small; at 34 birds that is around
 * 560 pair checks a frame, which is affordable, and 80 would not be.
 */
function flock(): Visual {
  type B = { x: number; y: number; vx: number; vy: number; tone: number }
  let bs: B[] = []
  return {
    init(w, h) {
      bs = Array.from({ length: 34 }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 60,
        vy: (Math.random() - 0.5) * 60,
        tone: Math.random(),
      }))
    },
    draw({ ctx, w, h, dt, f, p: ptr, ink }) {
      const speed = 40 + f.level * 220
      const sep = 18 + f.treble * 34
      const cohere = 0.12 + f.bass * 0.5
      for (let i = 0; i < bs.length; i++) {
        const b = bs[i]
        let cx = 0
        let cy = 0
        let ax = 0
        let ay = 0
        let sx = 0
        let sy = 0
        let n = 0
        for (let j = 0; j < bs.length; j++) {
          if (i === j) continue
          const o = bs[j]
          const dx = o.x - b.x
          const dy = o.y - b.y
          const d2 = dx * dx + dy * dy
          if (d2 > 120 * 120) continue
          n++
          cx += o.x
          cy += o.y
          ax += o.vx
          ay += o.vy
          if (d2 < sep * sep) {
            const d = Math.sqrt(d2) || 1
            sx -= dx / d
            sy -= dy / d
          }
        }
        if (n) {
          b.vx += ((cx / n - b.x) * cohere + (ax / n - b.vx) * 0.05 + sx * 40) * dt
          b.vy += ((cy / n - b.y) * cohere + (ay / n - b.vy) * 0.05 + sy * 40) * dt
        }
        /* the pointer is a predator: everything steers away from it */
        if (ptr.inside) {
          const dx = b.x - ptr.x
          const dy = b.y - ptr.y
          const d = Math.hypot(dx, dy)
          if (d < 130) {
            b.vx += (dx / (d || 1)) * 260 * dt
            b.vy += (dy / (d || 1)) * 260 * dt
          }
        }
        const m = Math.hypot(b.vx, b.vy) || 1
        b.vx = (b.vx / m) * speed
        b.vy = (b.vy / m) * speed
        b.x += b.vx * dt
        b.y += b.vy * dt
        if (b.x < 0) b.x += w
        if (b.x > w) b.x -= w
        if (b.y < 0) b.y += h
        if (b.y > h) b.y -= h
        /* drawn as a dart pointing where it is going, so the flock has a direction you can read */
        const a = Math.atan2(b.vy, b.vx)
        const L = 7 + f.level * 6
        ctx.beginPath()
        ctx.moveTo(b.x + Math.cos(a) * L, b.y + Math.sin(a) * L)
        ctx.lineTo(b.x + Math.cos(a + 2.6) * L * 0.6, b.y + Math.sin(a + 2.6) * L * 0.6)
        ctx.lineTo(b.x + Math.cos(a - 2.6) * L * 0.6, b.y + Math.sin(a - 2.6) * L * 0.6)
        ctx.closePath()
        ctx.fillStyle = hue(ink, b.tone)
        ctx.fill()
      }
    },
  }
}

/**
 * Tree — a branching figure that regrows from the bass and sways with the treble.
 *
 * ⚠️ recursion with a HARD DEPTH CAP, because branching doubles: depth 8 is 255 segments
 * and depth 12 would be 4095 for a picture nobody could read. The depth is driven by loudness, so
 * a quiet passage is a sapling and a loud one fills the frame — growth as the readout, rather
 * than height or colour.
 */
function tree(): Visual {
  return {
    init() {},
    draw({ ctx, w, h, f, p: ptr, ink }) {
      const depth = 5 + Math.round(f.level * 3.4)
      const sway =
        (ptr.inside ? (ptr.x / w - 0.5) * 0.5 : 0) + Math.sin(f.t * 0.7) * 0.12 + f.treble * 0.3
      const len0 = Math.min(w, h) * (0.16 + f.bass * 0.1)
      ctx.lineCap = 'round'
      const branch = (x: number, y: number, a: number, len: number, d: number) => {
        if (d > depth || len < 2) return
        const x2 = x + Math.cos(a) * len
        const y2 = y + Math.sin(a) * len
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x2, y2)
        ctx.lineWidth = Math.max(0.6, (depth - d) * 0.9)
        ctx.strokeStyle = hue(ink, d / Math.max(1, depth))
        ctx.stroke()
        const spread = 0.42 + f.mid * 0.4
        branch(x2, y2, a - spread + sway * 0.4, len * 0.74, d + 1)
        branch(x2, y2, a + spread + sway * 0.4, len * 0.74, d + 1)
      }
      branch(w / 2, h, -Math.PI / 2 + sway * 0.3, len0, 0)
    },
  }
}

/**
 * Weave — two sets of lines crossing, each rippling on its own band.
 *
 * ⚠️ the picture is the INTERFERENCE, not the lines. Neither set means anything alone; where
 * they cross at a shallow angle they produce moiré bands that shift with the music, and that is
 * what you are actually watching. It is also the cheapest mode here after Ring — a few dozen
 * strokes, no particles, no state between frames.
 */
function weave(): Visual {
  return {
    init() {},
    draw({ ctx, w, h, spec, bins, f, p: ptr, ink }) {
      const N = 22
      const amp = Math.min(w, h) * (0.03 + f.level * 0.06)
      const lean = ptr.inside ? (ptr.y / h - 0.5) * 0.6 : 0
      ctx.lineWidth = 1.2
      for (let i = 0; i < N; i++) {
        const k = i / (N - 1)
        const band = at(spec, bins, 0.02 + k * 0.5)
        ctx.beginPath()
        for (let x = 0; x <= w; x += 10) {
          const y =
            h * k + Math.sin(x / (60 + k * 90) + f.t * (0.8 + band * 2)) * amp * (0.4 + band * 2)
          if (x === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.strokeStyle = hue(ink, k, 0.35 + band * 0.5)
        ctx.stroke()
      }
      for (let i = 0; i < N; i++) {
        const k = i / (N - 1)
        const band = at(spec, bins, 0.5 + k * 0.45)
        ctx.beginPath()
        for (let y = 0; y <= h; y += 10) {
          const x =
            w * k +
            Math.sin(y / (70 + k * 80) + f.t * (0.6 + band * 1.6) + lean) * amp * (0.4 + band * 2)
          if (y === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.strokeStyle = hue(ink, (k + 0.4) % 1, 0.25 + band * 0.45)
        ctx.stroke()
      }
    },
  }
}

/**
 * Radar — a sweeping arm that paints the spectrum where it passes.
 *
 * ⚠️ this is a spectrogram in POLAR form, and the sweep is what makes it one. Rain scrolls
 * time sideways; here the arm carries time around the circle, so a whole bar of music is visible
 * at once as a ring and you can see a rhythm repeat as a pattern rather than as a stripe. It is
 * also the one mode whose picture depends on WHERE THE ARM IS — everything else is redrawn whole
 * every frame.
 */
function radar(): Visual {
  let angle = 0
  return {
    init() {
      angle = 0
    },
    draw({ ctx, w, h, dt, spec, bins, f, p: ptr, ink }) {
      const [cx, cy] = centre(ptr, w, h)
      const R = Math.min(w, h) * 0.46
      const speed = 1.1 + f.level * 1.4
      const prev = angle
      angle += dt * speed
      /* draw the wedge between where the arm WAS and where it is, so a slow frame leaves no gap */
      const steps = Math.max(1, Math.ceil((angle - prev) / 0.05))
      for (let s = 0; s < steps; s++) {
        const a = prev + ((angle - prev) * s) / steps
        for (let i = 0; i < 26; i++) {
          const k = i / 26
          const v = at(spec, bins, 0.02 + k * 0.6)
          if (v < 0.04) continue
          const r0 = R * (0.14 + k * 0.86)
          ctx.beginPath()
          ctx.arc(cx, cy, r0, a, a + (angle - prev) / steps + 0.02)
          ctx.strokeStyle = hue(ink, v, 0.25 + v * 0.75)
          ctx.lineWidth = (R * 0.86) / 26 + 1
          ctx.stroke()
        }
      }
      /* the arm itself, so you can see where "now" is */
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(angle) * R, cy + Math.sin(angle) * R)
      ctx.strokeStyle = hue(ink, 1, 0.8)
      ctx.lineWidth = 1.5
      ctx.stroke()
    },
  }
}

/**
 * Helix — two strands twisting around each other, with rungs between them.
 *
 * ⚠️ the two strands are the SAME sine half a turn apart, which is what makes them read as
 * one twisted object rather than two wavy lines. The rungs are the proof: they join points that
 * belong together, and without them the eye separates the strands immediately.
 */
function helix(): Visual {
  return {
    init() {},
    draw({ ctx, w, h, spec, bins, f, p: ptr, ink }) {
      const N = 60
      const mid = ptr.inside ? ptr.y : h / 2
      const amp = h * (0.12 + f.level * 0.18)
      const turns = 2.4 + f.bass * 2
      const pts: Array<[number, number, number, number]> = []
      for (let i = 0; i <= N; i++) {
        const k = i / N
        const x = k * w
        const a = k * Math.PI * 2 * turns + f.t * (0.8 + f.mid)
        pts.push([x, mid + Math.sin(a) * amp, x, mid + Math.sin(a + Math.PI) * amp])
      }
      /* rungs first, so the strands are drawn over them and read as in front */
      for (let i = 0; i <= N; i += 3) {
        const [x1, y1, x2, y2] = pts[i]
        const v = at(spec, bins, 0.02 + (i / N) * 0.6)
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.strokeStyle = hue(ink, v, 0.15 + v * 0.5)
        ctx.lineWidth = 1 + v * 2
        ctx.stroke()
      }
      for (const which of [0, 1]) {
        ctx.beginPath()
        pts.forEach(([x1, y1, x2, y2], i) => {
          const x = which ? x2 : x1
          const y = which ? y2 : y1
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.strokeStyle = hue(ink, which ? 0.75 : 0.25)
        ctx.lineWidth = 2 + f.level * 3
        ctx.stroke()
      }
    },
  }
}

/**
 * Serpent — a single line that grows, turns on the beat, and forgets its tail.
 *
 * ⚠️ the only mode with MEMORY of a path. Everything else is a field redrawn each frame;
 * this keeps a queue of where it has been, so what you see is a history rather than a state — and
 * because it only turns on a beat, the shape of the line is the rhythm of the music written down.
 * The queue is capped, which is both the tail length and the whole of its memory management.
 */
function serpent(): Visual {
  let pts: Array<[number, number]> = []
  let dir = 0
  let x = 0
  let y = 0
  return {
    init(w, h) {
      pts = []
      dir = -Math.PI / 4
      x = w / 2
      y = h / 2
    },
    draw({ ctx, w, h, dt, f, p: ptr, ink }) {
      /* a beat turns it; loudness decides how far it travels between turns */
      if (f.beat) dir += (Math.random() < 0.5 ? 1 : -1) * (0.5 + f.beatStrength * 1.1)
      if (ptr.inside) {
        /* steer gently toward the pointer, so it can be led without being dragged */
        const want = Math.atan2(ptr.y - y, ptr.x - x)
        let d = want - dir
        while (d > Math.PI) d -= Math.PI * 2
        while (d < -Math.PI) d += Math.PI * 2
        dir += d * Math.min(1, dt * 1.6)
      }
      const speed = 70 + f.level * 320
      x += Math.cos(dir) * speed * dt
      y += Math.sin(dir) * speed * dt
      if (x < 0) x += w
      if (x > w) x -= w
      if (y < 0) y += h
      if (y > h) y -= h
      pts.push([x, y])
      const MAX = 220
      if (pts.length > MAX) pts.splice(0, pts.length - MAX)

      ctx.lineCap = 'round'
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1]
        const [bx, by] = pts[i]
        /* a wrap puts two points on opposite edges; joining them would draw a line across the
           whole canvas, so the segment is simply skipped */
        if (Math.abs(bx - ax) > w / 2 || Math.abs(by - ay) > h / 2) continue
        const k = i / pts.length
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(bx, by)
        ctx.strokeStyle = hue(ink, k, 0.15 + k * 0.85)
        ctx.lineWidth = 1 + k * (4 + f.level * 6)
        ctx.stroke()
      }
    },
  }
}

/**
 * Kaleido — one small drawing, repeated around a circle and mirrored.
 *
 * ⚠️ the generator is deliberately SIMPLE, because the symmetry does the work. A complex
 * figure repeated twelve times is noise; a few lines repeated twelve times is a pattern. This is
 * also why it is not the same as the Mirror knob, which folds the FINISHED picture of whatever
 * mode you are on — here the wedge is drawn for the purpose, so the seams always meet.
 */
function kaleido(): Visual {
  return {
    init() {},
    draw({ ctx, w, h, spec, bins, f, p: ptr, ink }) {
      const [cx, cy] = centre(ptr, w, h)
      const R = Math.min(w, h) * 0.46
      const SEG = 6 + Math.round(f.bass * 6)
      ctx.save()
      ctx.translate(cx, cy)
      for (let s = 0; s < SEG; s++) {
        ctx.save()
        ctx.rotate((s / SEG) * Math.PI * 2)
        /* every other wedge is flipped, which is what turns a rotation into a reflection */
        if (s % 2) ctx.scale(1, -1)
        ctx.beginPath()
        for (let i = 0; i < 10; i++) {
          const k = i / 10
          const v = at(spec, bins, 0.02 + k * 0.5)
          const r = R * (0.1 + k * 0.9)
          const a = (0.12 + v * 0.5) * (1 + Math.sin(f.t * 0.6 + k * 3) * 0.3)
          const px2 = Math.cos(a) * r
          const py2 = Math.sin(a) * r
          if (i === 0) ctx.moveTo(px2, py2)
          else ctx.lineTo(px2, py2)
        }
        ctx.strokeStyle = hue(ink, s / SEG, 0.5 + f.level * 0.5)
        ctx.lineWidth = 1.5 + f.level * 2.5
        ctx.stroke()
        ctx.restore()
      }
      ctx.restore()
    },
  }
}

/**
 * Bounce — balls kept inside the frame, kicked by the beat.
 *
 * ⚠️ BOUNDED physics, where Fountain and Fireworks both let their particles leave and die.
 * Nothing is ever created or destroyed here, so the same handful of objects accumulate a history
 * with the music — a long quiet passage leaves them resting along the floor, and a loud one has
 * them everywhere. That memory is the whole point, and it is only possible because they cannot
 * escape.
 */
function bounce(): Visual {
  type B = { x: number; y: number; vx: number; vy: number; r: number; tone: number }
  let bs: B[] = []
  return {
    init(w, h) {
      bs = Array.from({ length: 14 }, (_, i) => ({
        x: (w * (i + 0.5)) / 14,
        y: h * 0.5 + Math.random() * h * 0.3,
        vx: (Math.random() - 0.5) * 120,
        vy: 0,
        r: 5 + Math.random() * 12,
        tone: i / 14,
      }))
    },
    draw({ ctx, w, h, dt, f, p: ptr, ink }) {
      const G = 520
      for (const b of bs) {
        if (f.beat) b.vy -= (260 + f.beatStrength * 460) * (0.4 + b.tone)
        b.vy += G * dt
        b.x += b.vx * dt
        b.y += b.vy * dt
        /* the walls take a little energy each time, or one beat would ring forever */
        if (b.x - b.r < 0) {
          b.x = b.r
          b.vx = Math.abs(b.vx) * 0.92
        }
        if (b.x + b.r > w) {
          b.x = w - b.r
          b.vx = -Math.abs(b.vx) * 0.92
        }
        if (b.y + b.r > h) {
          b.y = h - b.r
          b.vy = -Math.abs(b.vy) * 0.72
        }
        if (b.y - b.r < 0) {
          b.y = b.r
          b.vy = Math.abs(b.vy) * 0.72
        }
        if (ptr.inside) {
          const dx = b.x - ptr.x
          const dy = b.y - ptr.y
          const d = Math.hypot(dx, dy)
          if (d < 90) {
            b.vx += (dx / (d || 1)) * 420 * dt
            b.vy += (dy / (d || 1)) * 420 * dt
          }
        }
        ctx.beginPath()
        ctx.arc(b.x, b.y, b.r * (1 + f.level * 0.4), 0, Math.PI * 2)
        ctx.fillStyle = hue(ink, b.tone, 0.55 + f.level * 0.45)
        ctx.fill()
      }
    },
  }
}

/**
 * Sun — a solid disc with a corona whose spikes are the spectrum.
 *
 * ⚠️ Radial draws the spectrum as lines FROM a centre; this draws it as the EDGE of a body.
 * The difference is that a body has an inside — the disc stays lit and breathing whatever the
 * music does, so the mode never goes empty, which is the one thing every purely line-based mode
 * does in a quiet passage.
 */
function sun(): Visual {
  return {
    init() {},
    draw({ ctx, w, h, spec, bins, f, p: ptr, ink }) {
      const [cx, cy] = centre(ptr, w, h)
      const base = Math.min(w, h) * (0.16 + f.bass * 0.06)
      const N = 96

      const g = ctx.createRadialGradient(cx, cy, base * 0.2, cx, cy, base)
      g.addColorStop(0, hue(ink, 1, 0.95))
      g.addColorStop(1, hue(ink, 0.55, 0.75))
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(cx, cy, base, 0, Math.PI * 2)
      ctx.fill()

      /* one closed path for the whole corona, so the flare is a shape rather than N wedges */
      ctx.beginPath()
      for (let i = 0; i <= N; i++) {
        const k = i / N
        const v = at(spec, bins, 0.02 + (k < 0.5 ? k : 1 - k) * 1.1)
        const r = base * (1 + v * 1.5 + Math.sin(k * 40 + f.t * 2) * 0.04)
        const a = k * Math.PI * 2 - Math.PI / 2
        const x = cx + Math.cos(a) * r
        const y = cy + Math.sin(a) * r
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.strokeStyle = hue(ink, 0.85, 0.6 + f.level * 0.4)
      ctx.lineWidth = 1.5 + f.level * 3
      ctx.stroke()
    },
  }
}

/**
 * Stack — past WAVEFORMS piled up the screen, newest at the front.
 *
 * ⚠️ Terrain does this with the spectrum; this does it with the wave, and they look nothing
 * alike. A spectrum is smooth and hill-shaped, so stacking it gives landscape; a waveform is
 * jagged and symmetrical about zero, so stacking it gives something closer to a seismograph roll.
 * Same idea, different data, and the data is what you see.
 */
function stack(): Visual {
  const ROWS = 26
  let rows: Float32Array[] = []
  return {
    init() {
      rows = []
    },
    draw({ ctx, w, h, wave, waveN, f, p: ptr, ink }) {
      const N = 96
      const row = new Float32Array(N)
      for (let i = 0; i < N; i++) {
        row[i] = (wave[Math.floor((i / N) * waveN)] - 128) / 128
      }
      rows.unshift(row)
      if (rows.length > ROWS) rows.pop()
      const lean = ptr.inside ? (ptr.x / w - 0.5) * 0.5 : 0
      const amp = h * (0.035 + f.level * 0.05)
      for (let r = rows.length - 1; r >= 0; r--) {
        const k = r / ROWS
        const y = h * (0.12 + k * 0.8)
        const squeeze = 1 - k * 0.35
        ctx.beginPath()
        for (let i = 0; i < N; i++) {
          const x = w / 2 + (i / (N - 1) - 0.5) * w * squeeze + lean * k * w * 0.2
          const yy = y - rows[r][i] * amp * (1 - k * 0.5)
          if (i === 0) ctx.moveTo(x, yy)
          else ctx.lineTo(x, yy)
        }
        ctx.strokeStyle = hue(ink, 1 - k, 1 - k * 0.85)
        ctx.lineWidth = 1 + (1 - k) * 1.6
        ctx.stroke()
      }
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
    draw({ ctx, w, h, dt, spec, bins, f, p, ink }) {
      const [cx, cy] = centre(p, w, h)
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
      ctx.strokeStyle = hue(ink, f.mid)
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
  fountain,
  ring,
  lava,
  matrix,
  fireworks,
  flock,
  tree,
  weave,
  radar,
  helix,
  serpent,
  kaleido,
  bounce,
  sun,
  stack,
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
