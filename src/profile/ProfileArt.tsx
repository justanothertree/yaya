import { useEffect, useMemo, useRef, useState } from 'react'
import { frameCount, paintDrawing, readDrawing, type Drawing } from '../draw/strokes'

/**
 * Somebody's pictures on their page, one at a time.
 *
 * ⚠️ NOTHING IS HOSTED. A drawing is the strokes that made it, so the visitor's browser draws it —
 * no image file, no upload, no CDN, and no third party told that somebody looked at this page.
 * Same reasoning as the song block, and the same reason both were possible without a byte of
 * storage: the format was chosen for this.
 *
 * ⚠️ It redraws on RESIZE rather than scaling a bitmap, so the picture is sharp in a block a
 * third of the page wide and sharp again full width. That is the whole payoff of coordinates
 * being fractions.
 */

const SHUFFLE_MS = 7000
/** How tall a picture may make its block, as a multiple of its width. */
const MAX_RATIO = 1.25

/**
 * A replay redraws the picture from the start on every step, so the number of STEPS is what it
 * costs — not the number of strokes. Capping it means a two-hundred-stroke drawing draws itself
 * in forty-eight repaints with several strokes appearing at once, rather than two hundred
 * repaints of an ever-longer list. The same cap the GIF uses, for the same reason.
 */
const REPLAY_STEPS = 48
/** how long the finished picture sits there before it starts again */
const REPLAY_HOLD_MS = 2600

export function ArtBlock({ cfg }: { cfg: Record<string, unknown> }) {
  const host = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const [i, setI] = useState(0)
  const redraw = useRef<(() => void) | null>(null)

  /**
   * ⚠️ MEMOISED, and it matters far more than it looks.
   *
   * These are rebuilt by parsing cfg.art, so without this every render produced brand new Drawing
   * objects — a new `current` each time. The effect below depends on it, so the ResizeObserver
   * was being torn down and rebuilt on every render, and the frame reset that arrived with
   * animation would have fired on every render too and pinned the animation to frame 0 for good.
   */
  const pieces: Drawing[] = useMemo(
    () => (Array.isArray(cfg.art) ? (cfg.art.map(readDrawing).filter(Boolean) as Drawing[]) : []),
    [cfg.art],
  )
  const shuffle = cfg.shuffle !== false
  const current = pieces[i % Math.max(1, pieces.length)]

  /**
   * ⚠️ CLAMPED HERE, not trusted from the config. This object came out of somebody else's row
   * and is rendered in a visitor's browser: a speed of 100000 is a timer firing as fast as the
   * machine allows on a page the visitor did not write. It is the same rule readDrawing applies to
   * every other number that travels, and the reason that function exists.
   */
  const replay = cfg.replay === true
  const replaySpeed =
    typeof cfg.replaySpeed === 'number' && Number.isFinite(cfg.replaySpeed)
      ? Math.max(1, Math.min(60, Math.round(cfg.replaySpeed)))
      : 12

  /**
   * ⚠️ A DRAWING WITH FRAMES PLAYS ITSELF, and its own fps is the speed.
   *
   * The speed belongs to the drawing rather than to the block because it is a property of the
   * animation — eight frames of a walk cycle and three frames of a blinking sign want completely
   * different rates, and the person who drew it is the only one who knows which. A block-level
   * speed would be one number wrong for every picture after the first.
   *
   * ⚠️ OFF IF THE VISITOR ASKED FOR LESS MOTION. This is somebody else's page moving on its
   * own in the corner of their eye, which is exactly what prefers-reduced-motion is for. It is
   * checked live rather than once, because the setting can change while the page is open.
   */
  const frames = current ? frameCount(current) : 0
  const [f, setF] = useState(0)
  const frameRef = useRef(0)
  frameRef.current = f
  const [still, setStill] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  )
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const on = () => setStill(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  const plays = cfg.autoplay !== false && !still
  /** back to the first frame when the shuffle moves on, or the next drawing starts mid-stride */
  useEffect(() => setF(0), [i])

  /**
   * How much of the picture is drawn so far, or null for all of it.
   *
   * ⚠️ A REPLAY IS JUST A DRAWING WITH FEWER STROKES — the same sentence the paint room's own
   * replay is built on, and the reason there is no second render path here to keep correct. It
   * slices the list `draw` already paints from.
   *
   * ⚠️ ONLY FOR A PICTURE WITH NO FRAMES. One made in the frame editor already has motion of
   * its own and plays it above; drawing an animation stroke by stroke would be two answers to the
   * same question, and neither is what the person who made it meant.
   *
   * ⚠️ NOT gated on `autoplay`. That switch says "play the animation" and is only offered when
   * a chosen picture HAS frames — having it silently also stop the replays would make one
   * checkbox mean two things. Both obey prefers-reduced-motion, which is the switch that matters.
   */
  const [upTo, setUpTo] = useState<number | null>(null)
  const upToRef = useRef<number | null>(null)
  upToRef.current = upTo

  useEffect(() => {
    const n = current?.strokes.length ?? 0
    if (!replay || still || frames > 1 || n < 2) {
      setUpTo(null)
      return
    }
    const steps = Math.min(REPLAY_STEPS, n)
    const per = n / steps
    /* the wall-clock length is strokes ÷ speed however many steps that is split into, so the
       speed on the block means the same thing as the speed on the download */
    const ms = Math.max(40, Math.round(((n / replaySpeed) * 1000) / steps))
    let k = 0
    let t = 0
    const step = () => {
      k = k >= steps ? 1 : k + 1
      setUpTo(Math.min(n, Math.round(k * per)))
      /* the finished picture is the one worth looking at, so it stays up longer than a stroke */
      t = window.setTimeout(tick, k >= steps ? REPLAY_HOLD_MS : ms)
    }
    const tick = () => {
      // ⚠️ same reason as the shuffle below: nobody is watching a background tab
      if (document.visibilityState !== 'visible') {
        t = window.setTimeout(tick, 1000)
        return
      }
      step()
    }
    /* ⚠️ THE FIRST STROKE GOES UP NOW, not one interval from now. `upTo` survives the effect
       re-running, so waiting for the first tick meant a new picture spent that interval drawn to
       the PREVIOUS picture's progress — a shuffle landing on a fresh drawing already half done,
       which then jumped back to the start. Found by watching the trace, not by reading this. */
    step()
    return () => window.clearTimeout(t)
  }, [replay, still, frames, current, replaySpeed])

  useEffect(() => {
    if (!plays || frames < 2) return
    const fps = Math.max(1, Math.min(24, current?.fps ?? 8))
    const t = window.setInterval(
      () => {
        // ⚠️ same reason as the shuffle above: nobody is watching a background tab
        if (document.visibilityState === 'visible') setF((n) => (n + 1) % frames)
      },
      Math.round(1000 / fps),
    )
    return () => window.clearInterval(t)
  }, [plays, frames, current?.fps])

  /**
   * ⚠️ Paused while the tab is hidden and when there is only one picture. A timer redrawing a
   * canvas every few seconds in a background tab is a battery cost with nobody watching, and a
   * "shuffle" between one picture and itself is just a repaint.
   */
  useEffect(() => {
    if (!shuffle || pieces.length < 2) return
    const tick = () => {
      if (document.visibilityState === 'visible') setI((n) => n + 1)
    }
    const t = window.setInterval(tick, SHUFFLE_MS)
    return () => window.clearInterval(t)
  }, [shuffle, pieces.length])

  useEffect(() => {
    const el = cv.current
    const box = host.current
    if (!el || !box || !current) return
    const ctx = el.getContext('2d')
    if (!ctx) return

    /**
     * ⚠️ THIS BLOCK USED TO GROW UNTIL THE BROWSER GAVE UP, and the loop is worth spelling out
     * because nothing about it looks wrong line by line.
     *
     * A canvas with no CSS size lays out at its `width`/`height` ATTRIBUTES, in CSS pixels. This
     * measured the host, multiplied by devicePixelRatio and wrote that into the attributes — so on
     * a 2x screen the canvas laid out twice as wide as the box it was measured from. The host is a
     * block and grew to fit its child. The ResizeObserver saw the host change, measured it again,
     * and multiplied again. Every pass doubled it. On a phone at 3x it ran away faster.
     *
     * Two things break the cycle, and both are needed:
     *
     *   · the CSS size is set explicitly, so the backing store can be whatever the screen wants
     *     without the layout following it
     *   · the HEIGHT comes from the drawing's own ratio rather than from measuring, so height is
     *     computed from width and never read back
     *
     * Width is then the only thing measured, and nothing this function does can change it.
     */
    let lastW = 0
    const draw = () => {
      const w = Math.round(box.clientWidth)
      if (w < 1) return
      /* ⚠️ WIDTH OVER HEIGHT — see the note on Drawing.ratio. This read it as height over
         width, so every landscape drawing was rendered as a tall thin panel and the picture
         inside it squeezed to match. The fallback is a landscape 3:2, the same default
         readDrawing uses, rather than the 0.6 that only made sense upside down. */
      const wh = current.ratio > 0.05 && current.ratio < 20 ? current.ratio : 1.5
      /**
       * ⚠️ THE BLOCK IS CAPPED, AND THE PICTURE IS FITTED INSIDE IT rather than the block being
       * whatever shape the paper was.
       *
       * Height was taken straight from the drawing's own ratio, which is up to 20 — so a tall
       * sketch made a block twenty times as tall as it is wide. Measured on the live profile: a
       * ratio of 3.35, which in a full-width block around 800px is a 2680px tall panel, and at
       * dpr 2 a backing store of 1600x5360. That is 8.6 megapixels repainted on every resize and
       * every animation frame — the stretch and the lag are the same fact.
       *
       * So the panel stops at MAX_RATIO and a taller picture is drawn NARROWER to keep its
       * shape, centred, with the page showing either side. Letterboxing preserves what was drawn;
       * squashing it to fit would not, and a page is not the place to distort somebody's work.
       */
      /* MAX_RATIO is still "how tall the panel may get, as a multiple of its width", so as a
         width-over-height number the cap is its reciprocal: anything narrower than this is
         letterboxed rather than allowed to make a very tall block. */
      const shown = Math.max(wh, 1 / MAX_RATIO)
      const h = Math.max(60, Math.round(w / shown))
      // the picture keeps its own proportions inside that panel
      const pw = wh < 1 / MAX_RATIO ? Math.round(h * wh) : w
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      el.style.width = w + 'px'
      el.style.height = h + 'px'
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr)
        el.height = Math.round(h * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.save()
      ctx.translate(Math.round((w - pw) / 2), 0)
      /* ⚠️ `part`, not `shown` — `shown` above is the aspect ratio this panel settled on, and
         the two live in the same function. */
      const k = upToRef.current
      const part =
        k != null && k < current.strokes.length
          ? { ...current, strokes: current.strokes.slice(0, k) }
          : current
      paintDrawing(ctx, part, pw, h, { frame: frameRef.current })
      ctx.restore()
      lastW = w
    }
    draw()
    /* ⚠️ redraw only when the WIDTH actually changed. The observer also fires for the height
       this function just set, and answering that would be the same loop in a politer form. */
    const ro = new ResizeObserver(() => {
      if (Math.round(box.clientWidth) !== lastW) draw()
    })
    ro.observe(box)
    /**
     * ⚠️ HANDED OUT THROUGH A REF so a frame change can repaint WITHOUT re-running this effect.
     * Adding the frame to the dependencies would tear down and rebuild the ResizeObserver on
     * every tick of the animation — a new observer several times a second, for a redraw.
     */
    redraw.current = draw
    return () => {
      redraw.current = null
      ro.disconnect()
    }
  }, [current])

  /* ⚠️ BOTH, as one string. Either number changing means repaint, and depending on the two
     separately would be two effects racing to call the same function. */
  const redrawOn = `${f}:${upTo}`
  useEffect(() => {
    redraw.current?.()
  }, [redrawOn])

  if (!pieces.length) return null

  return (
    <div
      className="card profile-block profile-art"
      ref={host}
      /* the picture's own paper, or the page showing through where it is transparent */
      style={current?.bg ? { background: current.bg } : undefined}
    >
      <canvas ref={cv} aria-label={current?.name ?? 'Drawing'} />
      <span className="profile-art-name muted">
        {current?.name}
        {pieces.length > 1 && (
          <span className="profile-art-dots" aria-hidden>
            {pieces.map((_, n) => (
              <i key={n} className={n === i % pieces.length ? 'is-on' : undefined} />
            ))}
          </span>
        )}
      </span>
    </div>
  )
}
