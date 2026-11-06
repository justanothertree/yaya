import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { resumeAudio, sharedCtx } from './context'
import { takeBus } from './takeBus'
import { decodeTake } from './recordTake'
import { setTakeTrim, type TakeRow } from './takes'
import { retrimTake } from './looper'
import { toWav } from './wav'
import { atFraction, clampTrim, isWhole, peaks, pickRange, trimFrames, type Trim } from './takeEdit'

/**
 * Seeing a recording, and choosing the part worth keeping.
 *
 * ⚠️ THE MISSING STEP, AND THE ONE EVERYTHING ELSE WAITED ON. The panel could record a take,
 * play it, place it on the loop and put six effects through it — and you could not LOOK at it.
 * A take was a duration and a file size in a list, so the first question anybody has about a
 * recording ("where does the singing actually start") had no answer short of listening to the
 * whole thing again, and the one edit everybody wants — throw away the four seconds of fumbling
 * at the front — could not be expressed at all.
 *
 * ⚠️ AND IT CUTS NOTHING. "Keep this bit" writes two numbers next to the take; the blob that
 * came off the microphone is never rewritten. takes.ts already refuses to evict a take at the
 * storage cap because "that silently deletes something somebody sang, which is the one thing a
 * recorder must never do" — an editor that re-encodes the audio is the same deletion with a
 * nicer name. So Whole take is not an undo stack, it is the removal of a view, and it works
 * after a reload, after a trim of a trim, and after the tab has been closed for a week.
 *
 * ⚠️ ONE SET OF ARITHMETIC, IN takeEdit.ts. What the picture shows, what a drag selects and
 * what the export writes are three readings of the same two numbers — so they are one function
 * each, pure, tested, and asked by all three callers rather than re-derived per call site.
 */

/** How tall the picture is, in CSS pixels. Enough to see a breath; short enough for a phone. */
const TALL = 86

const secs = (n: number) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`
const exact = (n: number) => `${n.toFixed(2)}s`

export function TakeEditor({ row, onChanged }: { row: TakeRow; onChanged: () => void }) {
  const box = useRef<HTMLCanvasElement | null>(null)
  const [buf, setBuf] = useState<AudioBuffer | null>(null)
  const [bad, setBad] = useState(false)
  /** the drag in progress, in CSS pixels across the canvas */
  const drag = useRef<{ x0: number; x1: number } | null>(null)
  const [sel, setSel] = useState<Trim | null>(null)
  const [playAt, setPlayAt] = useState<number | null>(null)
  const out = useRef<{ src: AudioBufferSourceNode; began: number; from: number } | null>(null)
  const [say, setSay] = useState('')
  const [width, setWidth] = useState(0)

  const len = buf?.duration ?? row.len
  /* memoised so the draw effect can depend on it honestly — clampTrim returns a fresh object
     every call, and a dependency that is never equal redraws the canvas on every render */
  const trim = useMemo(() => clampTrim(row.trim, len), [row.trim, len])
  const whole = isWhole(row.trim, len)

  /* decode once; the blob is the thing that persists and this is derived from it */
  useEffect(() => {
    let alive = true
    setBad(false)
    void decodeTake(row.blob).then((b) => {
      if (!alive) return
      if (!b) return setBad(true)
      setBuf(b)
    })
    return () => {
      alive = false
    }
  }, [row.blob])

  /**
   * How wide to draw, measured from the element three different ways.
   *
   * ⚠️ NOT ResizeObserver ALONE, AND THAT IS A MEASUREMENT RATHER THAN A PRECAUTION. CLAUDE.md
   * records RO firing in the Browser pane on 28 Oct, including the initial callback that the
   * spec guarantees on `observe()`. Measured again here on 6 Nov with the pane hidden: **zero
   * callbacks**, through an element that went 1045 → 499 → 1045 CSS pixels while being watched.
   * The canvas drew itself at 120px and stretched it across a thousand.
   *
   * The cause is almost certainly not RO: delivery is tied to the end of a frame, and the same
   * file records rAF not firing while the pane is hidden (re-measured 5 Nov, having fired on
   * 28 Oct). One frame loop, two APIs that ride it. So this is a pane artifact and RO is
   * probably fine in a real browser — but "probably fine in the thing I cannot check" is not a
   * foundation for whether a waveform is legible.
   *
   * So the measurement does not depend on a frame at all. A layout effect runs after every
   * render and is what makes this correct on mount, on decode, and on any state change; the
   * window listener catches a rotation or a pane resize (`resize_window` does fire one,
   * measured 28 Oct); and RO stays as the one that also catches a SIBLING changing size with
   * the window still, which neither of the others can see.
   */
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    /* guarded, or setting state from a layout effect that runs every render is a loop */
    const take = () => {
      const w = el.clientWidth
      setWidth((was) => (Math.abs(was - w) >= 1 ? w : was))
    }
    take()
    window.addEventListener('resize', take)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(take) : null
    ro?.observe(el)
    return () => {
      window.removeEventListener('resize', take)
      ro?.disconnect()
    }
  })

  const stop = useCallback(() => {
    const on = out.current
    out.current = null
    setPlayAt(null)
    if (!on) return
    try {
      on.src.stop()
    } catch {
      /* already finished on its own */
    }
  }, [])

  /* ⚠️ a preview left running sings over whatever room you went to next — see the same
     teardown in TakesPanel */
  useEffect(() => () => stop(), [stop])

  /**
   * Play a span.
   *
   * ⚠️ THE SAME FRAMES THE EXPORT USES. `start(when, offset, duration)` takes seconds and the
   * export copies samples, so asking takeEdit for ONE answer in frames is what stops a saved
   * file being a frame or two different from what was auditioned.
   */
  const playSpan = useCallback(
    (span: Trim) => {
      if (!buf) return
      stop()
      resumeAudio()
      const ctx = sharedCtx()
      const { offset, frames } = trimFrames(span, buf.duration, buf.sampleRate)
      if (!frames) return
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(takeBus())
      src.onended = () => {
        if (out.current?.src === src) stop()
      }
      out.current = { src, began: ctx.currentTime, from: span.from }
      src.start(0, offset / buf.sampleRate, frames / buf.sampleRate)
      setPlayAt(span.from)
    },
    [buf, stop],
  )

  /**
   * ⚠️ A TIMER, NOT requestAnimationFrame. CLAUDE.md has rAF firing in the pane on 28 Oct and
   * NOT firing on 5 Nov, both measured — so a playhead built on it is a feature that works or
   * does not depending on which week somebody checks. 20Hz is plenty for a line crossing a
   * picture and costs nothing.
   */
  const running = playAt != null
  useEffect(() => {
    if (!running) return
    const t = window.setInterval(() => {
      const on = out.current
      if (!on) return
      setPlayAt(on.from + (sharedCtx().currentTime - on.began))
    }, 50)
    return () => window.clearInterval(t)
  }, [running])

  /* draw */
  useEffect(() => {
    const el = box.current
    if (!el || !buf || !(width > 0)) return
    const dpr = Math.min(3, window.devicePixelRatio || 1)
    el.width = Math.max(1, Math.round(width * dpr))
    el.height = Math.round(TALL * dpr)
    const g = el.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, width, TALL)

    /* ⚠️ read from the element, so the picture follows the theme — this site has several and
       a hard-coded green is invisible on one of them. `--accent` and `--muted` are the two the
       rest of the room is drawn with. */
    const css = getComputedStyle(el)
    const ink = css.getPropertyValue('--accent').trim() || '#22c55e'
    const dim = css.getPropertyValue('--muted').trim() || '#9090b0'
    const mid = TALL / 2
    const cols = Math.max(1, Math.floor(width))
    const env = peaks(buf.getChannelData(0), cols)

    /* what is NOT kept, drawn first and faint, so the trim reads as a window rather than as
       the audio having been destroyed */
    const show = sel ?? trim
    g.fillStyle = dim
    g.globalAlpha = 0.35
    for (let c = 0; c < cols; c++) {
      const lo = env[c * 2]
      const hi = env[c * 2 + 1]
      g.fillRect(c, mid - hi * mid, 1, Math.max(1, (hi - lo) * mid))
    }
    g.globalAlpha = 1
    const a = Math.round(atFraction(show.from, len) * width)
    const b = Math.round(atFraction(show.to, len) * width)
    g.fillStyle = ink
    for (let c = a; c < b && c < cols; c++) {
      const lo = env[c * 2]
      const hi = env[c * 2 + 1]
      g.fillRect(c, mid - hi * mid, 1, Math.max(1, (hi - lo) * mid))
    }
    /* the edges of the kept part, so a selection with quiet audio in it is still visible */
    g.strokeStyle = ink
    g.globalAlpha = 0.8
    g.beginPath()
    g.moveTo(a + 0.5, 0)
    g.lineTo(a + 0.5, TALL)
    g.moveTo(b - 0.5, 0)
    g.lineTo(b - 0.5, TALL)
    g.stroke()
    g.globalAlpha = 1

    if (playAt != null) {
      const x = Math.round(atFraction(playAt, len) * width)
      g.strokeStyle = '#f6c177'
      g.beginPath()
      g.moveTo(x + 0.5, 0)
      g.lineTo(x + 0.5, TALL)
      g.stroke()
    }
  }, [buf, width, sel, trim, len, playAt])

  const xOf = (e: React.PointerEvent) => e.clientX - e.currentTarget.getBoundingClientRect().left

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!buf) return
    const x = xOf(e)
    drag.current = { x0: x, x1: x }
    setSel(pickRange(x, x, width, len))
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* ⚠️ allowed to fail — capture is an enhancement that keeps a drag alive when the
         pointer leaves the box, and CLAUDE.md records a synthetic pointerId taking the rest
         of a handler down with it. The selection is the point; the capture is not. */
    }
  }
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drag.current || !buf) return
    drag.current.x1 = xOf(e)
    setSel(pickRange(drag.current.x0, drag.current.x1, width, len))
  }
  const onUp = () => {
    drag.current = null
  }

  const keep = useCallback(async () => {
    if (!sel) return
    const next = clampTrim(sel, len)
    await setTakeTrim(row.id, next)
    setSel(null)
    /* the loop caches a decoded buffer per take, so it has to be told the span moved */
    await retrimTake(row.id)
    onChanged()
    /* ⚠️ NOT a repeat of the summary beside it, which already says what is kept — measured
       on screen as "Keeping 1.00s of 4.00s · Keeping 1.00s of 4.00s." The thing somebody
       wants to know after pressing a button called Keep is what happened to the rest. */
    setSay(`the recording itself is untouched`)
  }, [sel, len, row.id, onChanged])

  const resetAll = useCallback(async () => {
    await setTakeTrim(row.id, null)
    setSel(null)
    await retrimTake(row.id)
    onChanged()
    setSay('nothing was ever removed')
  }, [row.id, onChanged])

  /**
   * ⚠️ WHAT YOU HEAR, NOT WHAT WAS RECORDED. The file carries the kept span and nothing else,
   * because a "save" that quietly hands back the four seconds of fumbling you just trimmed off
   * is the one outcome nobody expects. The original is still in the browser, untouched, and
   * Whole take brings it back — so this is a copy of a decision, not a destruction of one.
   *
   * ⚠️ AND IT IS MIXED TO MONO, because toWav writes a mono header and has done since it was
   * written for the debug capture. Averaging the channels is right for a voice; it is wrong for
   * a stereo field, and a microphone take has not got one. Said here rather than discovered.
   */
  const save = useCallback(() => {
    if (!buf) return
    const { offset, frames } = trimFrames(row.trim, buf.duration, buf.sampleRate)
    if (!frames) return setSay('Nothing to save.')
    const mix = new Float32Array(frames)
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch)
      for (let i = 0; i < frames; i++) mix[i] += d[offset + i] / buf.numberOfChannels
    }
    const url = URL.createObjectURL(toWav(mix, buf.sampleRate))
    const a = document.createElement('a')
    a.href = url
    a.download = `take-${new Date(row.at).toISOString().slice(0, 19).replace(/[:T]/g, '-')}.wav`
    a.click()
    /* ⚠️ revoked, or every save leaks the whole file for as long as the tab is open */
    setTimeout(() => URL.revokeObjectURL(url), 10000)
    setSay(`Saved ${exact(frames / buf.sampleRate)} as a WAV.`)
  }, [buf, row.trim, row.at])

  if (bad)
    return (
      <div className="take-edit">
        <span className="muted">This recording will not open in this browser.</span>
      </div>
    )

  return (
    <div className="take-edit">
      <canvas
        ref={box}
        className="take-edit-wave"
        style={{ height: TALL }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        /* ⚠️ a drag across this must not be read as a page scroll on a phone — the same
           reason the keyboard sets it, see InstrumentRoom */
        aria-label={`Waveform, ${secs(len)}. Drag to choose part of it.`}
        role="img"
      />
      {!buf && <span className="muted">Opening…</span>}
      <div className="take-edit-bar">
        <button
          className="btn btn-ghost"
          onClick={() => (out.current ? stop() : playSpan(sel ?? trim))}
          disabled={!buf}
          title={sel ? 'Hear what you have chosen' : 'Hear the part that is kept'}
        >
          {out.current ? '■' : '▶'} {sel ? 'Selection' : 'Play'}
        </button>
        <button className="btn" onClick={() => void keep()} disabled={!sel} title="Keep only this">
          Keep this bit
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => void resetAll()}
          disabled={whole}
          title="Undo the trim — the recording was never changed"
        >
          Whole take
        </button>
        <button className="btn btn-ghost" onClick={save} disabled={!buf} title="Download a WAV">
          ⬇ Save a copy
        </button>
        <span className="muted take-edit-says">
          {sel
            ? `Chosen ${exact(sel.to - sel.from)}`
            : whole
              ? `All ${exact(len)}`
              : `Keeping ${exact(trim.to - trim.from)} of ${exact(len)}`}
          {say ? ` · ${say}` : ''}
        </span>
      </div>
    </div>
  )
}
