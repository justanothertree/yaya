import type { Effect } from './backdrops'
import {
  binCount,
  fftSize,
  liveTaps,
  readSpectrum,
  readWaveform,
  type TapId,
} from '../audio/audioTap'

/**
 * The visualiser, behind the whole site.
 *
 * ⚠️ EVERYTHING IS LOADED LAZILY. visualModes + audioFeatures are about 20kB of drawing code that
 * belongs to a page most visitors never open; importing them here statically would drag the whole
 * gallery into the main bundle for everyone, because the backdrop is mounted on every page. The
 * dynamic import means the cost is paid only by somebody who actually picks this background, and
 * the effect politely draws nothing for the few frames before it arrives.
 *
 * ⚠️ It mirrors the VISUALISER's settings rather than owning its own. Two separate mode pickers
 * for the same picture would be a puzzle: you would set Nebula in the module, look at your
 * background, and find Bars. Whatever you last chose over there is what you get here.
 *
 * The source is whichever tap is live, preferring music over a call over a bare mic. A background
 * should react to whatever is playing without being told; being asked to pick a source for your
 * wallpaper is a chore nobody wants.
 */

type Mods = typeof import('../audio/visualModes')
type Feats = typeof import('../audio/audioFeatures')

const MODE_KEY = 'viz_mode_v1'
const MIRROR_KEY = 'viz_mirror_v1'
const EVENT = 'yaya:viz-prefs'

/** Fired by the visualiser when its look changes, so the background follows without a reload. */
export function announceVizPrefs() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT))
}

/** Whichever live source is most likely to be the one worth watching. */
const PREFERENCE: TapId[] = ['music', 'shared', 'peers', 'mic', 'local', 'ring']

export function audioBackdrop(): Effect {
  let mods: Mods | null = null
  let feats: Feats | null = null
  let visual: ReturnType<Mods['makeVisual']> | null = null
  let reader: ReturnType<Feats['makeFeatureReader']> | null = null
  let buf: HTMLCanvasElement | null = null
  let bctx: CanvasRenderingContext2D | null = null
  let W = 1
  let H = 1
  let modeId = 'bars'
  let mirror = 1
  let trail = 0
  let dpr = 1

  const spec = new Uint8Array(2048)
  const wav = new Uint8Array(2048)

  const readPrefs = () => {
    try {
      modeId = localStorage.getItem(MODE_KEY) || 'bars'
      const m = Number(localStorage.getItem(MIRROR_KEY))
      mirror = Number.isFinite(m) && m >= 1 && m <= 8 ? m : 1
    } catch {
      /* private mode — the defaults are fine */
    }
  }

  const build = () => {
    if (!mods) return
    const ids = mods.VISUALS.map((v) => v[0]) as string[]
    const id = (ids.includes(modeId) ? modeId : 'bars') as Parameters<Mods['makeVisual']>[0]
    visual = mods.makeVisual(id)
    trail = mods.defaultTrail(id)
    visual.init(W, H)
  }

  if (typeof window !== 'undefined') {
    readPrefs()
    window.addEventListener(EVENT, () => {
      readPrefs()
      build()
    })
    void Promise.all([import('../audio/visualModes'), import('../audio/audioFeatures')]).then(
      ([m, f]) => {
        mods = m
        feats = f
        reader = f.makeFeatureReader()
        build()
      },
    )
  }

  return {
    init(w, h) {
      W = w
      H = h
      if (!buf) buf = document.createElement('canvas')
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      buf.width = Math.round(w * dpr)
      buf.height = Math.round(h * dpr)
      bctx = buf.getContext('2d')
      bctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (visual) visual.init(w, h)
    },

    step({ ctx, w, h, dt, paint, px, py }) {
      if (!mods || !feats || !visual || !reader || !bctx || !buf) return

      const src = PREFERENCE.find((id) => liveTaps().includes(id))
      // No sound anywhere: the modes still animate on their clock, so this stays a moving
      // background rather than a frozen one — but it is fed silence, honestly.
      const bins = src ? Math.min(spec.length, binCount(src)) : 0
      const waveN = src ? Math.min(wav.length, fftSize(src)) : 0
      if (!src || !readSpectrum(src, spec)) spec.fill(0)
      if (!src || !readWaveform(src, wav)) wav.fill(128)

      let sum = 0
      for (let i = 0; i < waveN; i++) {
        const v = (wav[i] - 128) / 128
        sum += v * v
      }
      const rms = waveN ? Math.sqrt(sum / waveN) * 2.5 : 0
      const f = reader.read(spec, Math.max(1, bins), rms, dt)

      // persistence in the buffer, exactly as the module does it
      if (!mods.ownsItsBuffer(modeId as Parameters<Mods['ownsItsBuffer']>[0])) {
        const fade = 1 - Math.max(0, Math.min(0.97, trail))
        bctx.globalCompositeOperation = 'destination-out'
        bctx.fillStyle = `rgba(0,0,0,${fade})`
        bctx.fillRect(0, 0, W, H)
        bctx.globalCompositeOperation = 'source-over'
      }

      visual.draw({
        ctx: bctx,
        w: W,
        h: H,
        dt,
        spec,
        bins: Math.max(1, bins),
        wave: wav,
        waveN: Math.max(2, waveN),
        f,
        p: {
          x: px ?? 0,
          y: py ?? 0,
          inside: px != null && py != null,
          vx: 0,
          vy: 0,
          down: false,
          sinceClick: 99,
          clickX: px ?? 0,
          clickY: py ?? 0,
        },
        ink: paint,
      })

      /**
       * ⚠️ Composited at REDUCED opacity, unlike the module.
       *
       * This is wallpaper, and it sits under text people are trying to read. At full strength
       * Bars behind a paragraph is genuinely unreadable — so the background pays a permanent
       * tax the module does not, and that is the correct trade for something nobody asked to
       * look at directly.
       */
      ctx.save()
      ctx.globalAlpha = 0.32
      if (mirror <= 1) {
        ctx.drawImage(buf, 0, 0, w, h)
      } else {
        const cx = w / 2
        const cy = h / 2
        const seg = (Math.PI * 2) / mirror
        const reach = Math.hypot(w, h)
        for (let i = 0; i < mirror; i++) {
          ctx.save()
          ctx.translate(cx, cy)
          ctx.rotate(i * seg)
          if (i % 2) ctx.scale(1, -1)
          ctx.beginPath()
          ctx.moveTo(0, 0)
          ctx.arc(0, 0, reach, -seg / 2, seg / 2)
          ctx.closePath()
          ctx.clip()
          ctx.translate(-cx, -cy)
          ctx.drawImage(buf, 0, 0, w, h)
          ctx.restore()
        }
      }
      ctx.restore()
    },
  }
}
