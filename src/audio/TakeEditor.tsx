import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { resumeAudio, sharedCtx } from './context'
import { takeBus } from './takeBus'
import { decodeTake } from './recordTake'
import { setTakeLog, type TakeRow } from './takes'
import { refreshTakeAudio } from './looper'
import { editedBuffer } from './takeAudio'
import { toWav } from './wav'
import { heardTime } from './heard'
import { makeAudition, type Audition, type VoiceFx } from './takeFx'
import {
  canRedo,
  canUndo,
  cutOut,
  editLen,
  isWholeEdit,
  keepOnly,
  logDo,
  logNow,
  logRedo,
  logUndo,
  MIN_SPAN,
  peaks,
  pickRange,
  playedFrom,
  readLog,
  timeToFrac,
  toSource,
  trimTo,
  viewAround,
  wholeEdit,
  xToTime,
  zoomView,
  clampView,
  panView,
  type EditLog,
  type Span,
  type View,
} from './takeEdit'

/**
 * Seeing a recording, choosing part of it, and being able to change your mind.
 *
 * ⚠️ EVERY EDIT IS A STEP IN A LIST, which is what makes undo real rather than a special case.
 * The first pass had one operation and one escape from it — "Whole take" — and that is not
 * undo, it is a reset: it cannot take back the second of two edits, and it has nothing to say
 * about an edit you want back after changing your mind twice. The list is in takeEdit.ts and
 * it is persisted, so Undo still works tomorrow.
 *
 * ⚠️ AND IT CUTS NOTHING. Keep, Cut, Undo and Redo all move two numbers in a list beside the
 * take; the blob that came off the microphone is never rewritten. takes.ts refuses to evict a
 * recording at the storage cap because "that silently deletes something somebody sang, which
 * is the one thing a recorder must never do" — an editor that re-encodes the audio is the same
 * deletion with a nicer name.
 *
 * ⚠️ THE PICTURE IS ON THE SOURCE CLOCK, THE PLAYHEAD ARRIVES ON THE PLAYED ONE. You look at
 * the whole recording, with the cut parts dimmed so you can see what you removed and put it
 * back; the playing buffer only knows about the edited result. `toSource` is the only way
 * across, and no code here subtracts its way between them.
 */

/** How tall the picture is, in CSS pixels. Enough to see a breath; short enough for a phone. */
const TALL = 86

const secs = (n: number) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`
const exact = (n: number) => `${n.toFixed(2)}s`
/** where an edge or the cursor sits — to the millisecond, because that is the unit a trim is in */
const ms = (n: number) => `${n.toFixed(3)}s`

/**
 * How far a finger may move and still be a tap rather than a drag, in CSS pixels.
 *
 * ⚠️ A TAP PLACES THE CURSOR AND A DRAG CHOOSES A PART, so the line between them is the whole
 * gesture. Zero would turn every tap into a sliver of selection — a thumb is never perfectly
 * still — and anything near the width of a selection worth keeping would swallow short drags.
 */
const TAP_PX = 4

/**
 * @param sound what the take is heard through — its own sound, or null for as recorded. The
 *   panel owns it; the editor only plays through it, so the list's ▶ and this one agree.
 */
export function TakeEditor({
  row,
  sound,
  onChanged,
}: {
  row: TakeRow
  sound: VoiceFx | null
  onChanged: () => void
}) {
  const box = useRef<HTMLCanvasElement | null>(null)
  const [source, setSource] = useState<AudioBuffer | null>(null)
  const [bad, setBad] = useState(false)
  const drag = useRef<{ x0: number; x1: number } | null>(null)
  const [sel, setSel] = useState<Span | null>(null)
  const [playAt, setPlayAt] = useState<number | null>(null)
  /**
   * Where the cursor sits, in the RECORDING's time — placed by a tap, moved by ‹ › and the arrow
   * keys. It is where ▶ starts and where ⇤ and ⇥ trim to.
   *
   * ⚠️ SOURCE TIME LIKE THE PICTURE, NOT PLAYED TIME LIKE THE PLAYHEAD, because it is a place on
   * the picture: a cursor in a cut region is somewhere you can see and point at, and moving it
   * must not jump across the gap the way a played-time position would.
   */
  const [cursor, setCursor] = useState<number | null>(null)
  const out = useRef<{
    src: AudioBufferSourceNode
    aud: Audition
    began: number
    from: number
  } | null>(null)
  const [say, setSay] = useState('')
  const [width, setWidth] = useState(0)

  const len = source?.duration ?? row.len
  /** the stored history is the truth; state is a copy of it that the buttons move */
  const [log, setLog] = useState<EditLog>(() => readLog(row.log, row.trim, row.len))
  const edit = useMemo(() => logNow(log), [log])
  const played = editLen(edit)
  const [view, setView] = useState<View>(() => ({ from: 0, to: row.len }))
  const zoomed = view.to - view.from < len - 1e-6

  /**
   * Decode once — and ONCE HAS TO MEAN ONCE, which it did not.
   *
   * ⚠️ `row.blob` IS A NEW OBJECT EVERY TIME THE LIST IS REFRESHED, so "decode once" was a
   * comment rather than a fact. `allTakes` is `store.getAll()` and IndexedDB structured-clones
   * on the way out, so an unchanged row comes back holding a fresh Blob — and `apply` refreshes
   * the list after every Keep, Cut, Trim, Undo and Redo, because the ✎ marker in the row has
   * to follow the edit. This effect therefore re-ran on each of them, and its last line put the
   * view back to the whole recording.
   *
   * Measured in the pane on a one-minute take: zoomed to **3.75s of 60.00s shown**, pressed
   * Trim ends, and the label read **whole recording** again — with the edit itself perfectly
   * correct. Same with Undo, from 7.50s. That is the one thing you are zoomed in FOR: you find a
   * boundary at a quarter of a second, cut, and are thrown back to a picture where a pixel is
   * most of a second. It also re-read the blob and re-decoded it every time — 70ms and a 5MB
   * read for a minute of audio, around half a second for the six-minute take this editor was
   * built against, plus a fresh 2.9-million-sample `loudSpan` pass for a button whose answer
   * cannot have changed.
   *
   * `row.id` is the identity of the AUDIO, where the blob is only the identity of one read of
   * it: this editor never rewrites bytes — `setTakeLog` copies the row and replaces the log
   * alone, and a new recording or an opened file always mints a new id — so the same id is
   * always the same sound. A different take is a different `key` in TakesPanel and so a
   * different component, which is what makes this honest rather than merely cheaper.
   */
  useEffect(() => {
    let alive = true
    setBad(false)
    void decodeTake(row.blob).then((b) => {
      if (!alive) return
      if (!b) return setBad(true)
      setSource(b)
      setLog(readLog(row.log, row.trim, b.duration))
      setView({ from: 0, to: b.duration })
    })
    return () => {
      alive = false
    }
    // the blob, the log and the trim all belong to this id, and the log is owned by `apply` from
    // here on — see above for why re-running this on a new Blob object was the bug
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id])

  /**
   * ⚠️ ONE FUNCTION BUILDS WHAT YOU HEAR, HERE AND IN THE LOOP AND IN THE EXPORT. Three
   * renderings of one edit is three chances to disagree, and the first pass of this editor
   * shipped with exactly that — the list's play button playing the whole take while the
   * editor and the transport played the trimmed one.
   */
  const heard = useMemo(() => (source ? editedBuffer(source, edit) : null), [source, edit])

  /**
   * How wide to draw, measured three ways and not depending on a frame.
   *
   * ⚠️ NOT ResizeObserver ALONE. Measured 6 Nov with the pane hidden: zero callbacks, not even
   * the initial one the spec guarantees on `observe()`, through an element that went
   * 1045 → 499 → 1045 CSS pixels. Delivery rides the end of a frame and rAF does not fire
   * while the pane is hidden, so one frame loop takes both out. The layout effect is what
   * makes this correct; RO stays only for a SIBLING resizing with the window still.
   */
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
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
    on.aud.dispose()
  }, [])

  /* ⚠️ a preview left running sings over whatever room you went to next */
  useEffect(() => () => stop(), [stop])

  /** Play the edited result, from a played-time offset. */
  const playFrom = useCallback(
    (at: number) => {
      if (!heard) return
      stop()
      resumeAudio()
      const ctx = sharedCtx()
      /* ⚠️ THROUGH THE TAKE'S SOUND, the same chain the loop uses — see makeAudition */
      const aud = makeAudition(ctx, takeBus())
      aud.hear(sound)
      const src = ctx.createBufferSource()
      src.buffer = heard
      src.connect(aud.in)
      src.onended = () => {
        if (out.current?.src !== src) return
        out.current = null
        setPlayAt(null)
        /* the echo and the room ring on past the last sample, so they are let finish */
        window.setTimeout(() => aud.dispose(), 4000)
      }
      const from = Math.max(0, Math.min(heard.duration, at))
      out.current = { src, aud, began: ctx.currentTime, from }
      src.start(0, from)
      setPlayAt(from)
    },
    [heard, stop, sound],
  )

  /* a slider moved, or the comparison pressed, while this plays — heard at once */
  const soundKey = JSON.stringify(sound)
  useEffect(() => {
    out.current?.aud.hear(sound)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key is the sound's identity
  }, [soundKey])

  /**
   * ⚠️ A TIMER, NOT requestAnimationFrame. CLAUDE.md has rAF firing in the pane on 28 Oct and
   * not firing on 5 Nov, both measured — a playhead built on it works or does not depending on
   * which week somebody checks. 20Hz is plenty for a line crossing a picture.
   *
   * ⚠️ AND THE HEARD CLOCK, NOT THE RENDER CLOCK. `currentTime` is what is being rendered,
   * which on a Bluetooth headset is a fifth of a second ahead of what is being heard — so a line
   * drawn from it reaches a consonant before you do, and a trim placed by ear against it lands
   * late. See heard.ts. Held at `from` until the first sound arrives rather than drawn behind it.
   */
  const running = playAt != null
  useEffect(() => {
    if (!running) return
    const t = window.setInterval(() => {
      const on = out.current
      if (!on) return
      const ctx = sharedCtx()
      const end = on.src.buffer?.duration ?? Infinity
      const at = on.from + (heardTime(ctx, performance.now()) - on.began)
      setPlayAt(Math.min(end, Math.max(on.from, at)))
    }, 50)
    return () => window.clearInterval(t)
  }, [running])

  /* draw */
  useEffect(() => {
    const el = box.current
    if (!el || !source || !(width > 0)) return
    const dpr = Math.min(3, window.devicePixelRatio || 1)
    el.width = Math.max(1, Math.round(width * dpr))
    el.height = Math.round(TALL * dpr)
    const g = el.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, width, TALL)

    const css = getComputedStyle(el)
    const ink = css.getPropertyValue('--accent').trim() || '#22c55e'
    const dim = css.getPropertyValue('--muted').trim() || '#9090b0'
    const mid = TALL / 2
    const cols = Math.max(1, Math.floor(width))
    const rate = source.sampleRate
    const env = peaks(
      source.getChannelData(0),
      cols,
      Math.floor(view.from * rate),
      Math.ceil(view.to * rate),
    )
    const colAt = (t: number) => Math.round(timeToFrac(t, view) * width)

    /* everything, faint — so a cut reads as a window onto the recording rather than as the
       recording having been destroyed, and so you can see what to put back */
    const bar = (c: number, colour: string, alpha: number) => {
      const lo = env[c * 2]
      const hi = env[c * 2 + 1]
      g.globalAlpha = alpha
      g.fillStyle = colour
      g.fillRect(c, mid - hi * mid, 1, Math.max(1, (hi - lo) * mid))
      g.globalAlpha = 1
    }
    for (let c = 0; c < cols; c++) bar(c, dim, 0.3)

    /* the kept spans, solid */
    for (const s of edit.keep) {
      const a = Math.max(0, colAt(s.from))
      const b = Math.min(cols, colAt(s.to))
      for (let c = a; c < b; c++) bar(c, ink, 1)
    }

    /* the selection, as a box rather than a colour, so it reads on top of kept and cut alike */
    if (sel) {
      const a = colAt(sel.from)
      const b = colAt(sel.to)
      g.fillStyle = ink
      g.globalAlpha = 0.16
      g.fillRect(a, 0, Math.max(1, b - a), TALL)
      g.globalAlpha = 0.85
      g.strokeStyle = ink
      g.beginPath()
      g.moveTo(a + 0.5, 0)
      g.lineTo(a + 0.5, TALL)
      g.moveTo(b - 0.5, 0)
      g.lineTo(b - 0.5, TALL)
      g.stroke()
      g.globalAlpha = 1
    }

    /* the cursor, dashed so it never reads as the playhead — it is where things will happen,
       not where they are happening */
    if (cursor != null && playAt == null) {
      const x = colAt(cursor)
      g.strokeStyle = ink
      g.setLineDash([3, 3])
      g.beginPath()
      g.moveTo(x + 0.5, 0)
      g.lineTo(x + 0.5, TALL)
      g.stroke()
      g.setLineDash([])
    }

    /* ⚠️ the playhead arrives in PLAYED time and the picture is in SOURCE time */
    if (playAt != null) {
      const at = toSource(edit, playAt)
      if (at != null) {
        const x = colAt(at)
        g.strokeStyle = '#f6c177'
        g.beginPath()
        g.moveTo(x + 0.5, 0)
        g.lineTo(x + 0.5, TALL)
        g.stroke()
      }
    }
  }, [source, width, sel, edit, view, playAt, cursor])

  /** Put a new edit in the history, store it, and tell the loop its audio changed. */
  const apply = useCallback(
    async (next: EditLog, note: string) => {
      /* ⚠️ what is playing is the OLD edit's buffer, so its position means nothing against the
         new one — the playhead would be drawn through a picture the sound no longer matches */
      stop()
      setLog(next)
      setSel(null)
      await setTakeLog(row.id, next)
      await refreshTakeAudio(row.id)
      onChanged()
      setSay(note)
    },
    [row.id, onChanged, stop],
  )

  const xOf = (e: React.PointerEvent) => e.clientX - e.currentTarget.getBoundingClientRect().left

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!source) return
    const x = xOf(e)
    drag.current = { x0: x, x1: x }
    setSel(pickRange(x, x, width, view))
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* ⚠️ allowed to fail — capture keeps a drag alive when the pointer leaves the box, and
         CLAUDE.md records a synthetic pointerId taking the rest of a handler down with it.
         The selection is the point; the capture is not. */
    }
  }
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drag.current || !source) return
    drag.current.x1 = xOf(e)
    setSel(pickRange(drag.current.x0, drag.current.x1, width, view))
  }
  const onUp = () => {
    const d = drag.current
    drag.current = null
    if (!d || !source) return
    /**
     * ⚠️ A TAP PUTS THE CURSOR THERE — AND IF SOMETHING IS PLAYING, PLAYS FROM THERE. That is the
     * seek, and it is a tap rather than a separate scrubber because the picture is already the
     * map of the recording: the place you can see the breath is the place you touch.
     */
    if (Math.abs(d.x1 - d.x0) < TAP_PX) {
      setSel(null)
      const t = Math.max(0, Math.min(len, xToTime(d.x0, width, view)))
      setCursor(t)
      if (out.current) playFrom(playedFrom(edit, t) ?? 0)
      return
    }
    /* a drag too short to keep — clear it rather than leaving a hairline nobody can see */
    setSel((s) => (s && s.to - s.from < MIN_SPAN ? null : s))
  }
  const onCancel = () => {
    drag.current = null
    setSel((s) => (s && s.to - s.from < MIN_SPAN ? null : s))
  }

  /**
   * ⚠️ WHAT YOU HEAR, NOT WHAT WAS RECORDED. The file carries the edited result, because a
   * "save" that quietly hands back the four seconds you just cut is the one outcome nobody
   * expects. The original is still in the browser and Undo brings it back, so this is a copy
   * of a decision rather than the destruction of one.
   *
   * ⚠️ MIXED TO MONO, because toWav writes a mono header and has since it was written for the
   * debug capture. Averaging is right for a voice; it is wrong for a stereo field, and a
   * microphone take has not got one.
   */
  const save = useCallback(() => {
    if (!heard) return
    const n = heard.length
    if (!n) return setSay('nothing to save')
    const mix = new Float32Array(n)
    for (let c = 0; c < heard.numberOfChannels; c++) {
      const d = heard.getChannelData(c)
      for (let i = 0; i < n; i++) mix[i] += d[i] / heard.numberOfChannels
    }
    const url = URL.createObjectURL(toWav(mix, heard.sampleRate))
    const a = document.createElement('a')
    a.href = url
    a.download = `take-${new Date(row.at).toISOString().slice(0, 19).replace(/[:T]/g, '-')}.wav`
    a.click()
    /* ⚠️ revoked, or every save leaks the whole file for as long as the tab is open */
    setTimeout(() => URL.revokeObjectURL(url), 10000)
    setSay(`saved ${exact(n / heard.sampleRate)}`)
  }, [heard, row.at])

  if (bad)
    return (
      <div className="take-edit">
        <span className="muted">This recording will not open in this browser.</span>
      </div>
    )

  const whole = isWholeEdit(edit, len)
  const span = view.to - view.from
  const canKeep = !!sel && sel.to - sel.from >= MIN_SPAN
  const parts = edit.keep.length
  /** one pixel of the picture as it is zoomed now — the finest a nudge can mean anything */
  const step = Math.max(0.001, span / Math.max(1, width))
  const nudge = (by: number) => setCursor((c) => Math.max(0, Math.min(len, (c ?? view.from) + by)))
  /** where a trim lands: under the moving playhead while it plays, at the cursor otherwise */
  const here = running ? (playAt != null ? toSource(edit, playAt) : null) : cursor
  const toStart = here != null ? trimTo(edit, 'start', here, len) : null
  const toEnd = here != null ? trimTo(edit, 'end', here, len) : null
  /** play from the cursor if there is one, and from the top if it sits past the end */
  const fromCursor = () => playFrom(cursor != null ? (playedFrom(edit, cursor) ?? 0) : 0)

  return (
    <div className="take-edit">
      <canvas
        ref={box}
        className="take-edit-wave"
        style={{ height: TALL }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        /* ⚠️ A SLIDER TO A KEYBOARD, because the cursor is the one thing here a keyboard can
           move: arrows step it a pixel of the current zoom, Shift ten, Home and End go to the
           ends. Arrows are free to take — the room's own key handler leaves them alone so the
           page can scroll, and this only takes them while the picture has focus. */
        tabIndex={0}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={Number(len.toFixed(3))}
        aria-valuenow={Number((cursor ?? 0).toFixed(3))}
        aria-valuetext={cursor == null ? 'no cursor' : ms(cursor)}
        aria-label={`Waveform, ${secs(len)}${whole ? '' : `, ${secs(played)} kept`}. Tap to place the cursor, drag to choose part of it.`}
        onKeyDown={(e) => {
          const by = e.shiftKey ? step * 10 : step
          if (e.key === 'ArrowLeft') nudge(-by)
          else if (e.key === 'ArrowRight') nudge(by)
          else if (e.key === 'Home') setCursor(0)
          else if (e.key === 'End') setCursor(len)
          else return
          e.preventDefault()
        }}
      />
      {/**
       * ⚠️ BUTTONS AND A SLIDER, NOT A PINCH. A drag on the picture already means "choose a
       * part", which is the one gesture that must never be ambiguous — and on a phone a pinch
       * or a two-finger pan shares its first touch with that drag, so the room would have to
       * guess what you meant from how your second finger lands. A slider is unmistakable, it
       * works with one thumb, and it says where you are in the take by where it sits.
       */}
      <div className="take-edit-bar">
        <button
          className="btn btn-ghost"
          onClick={() =>
            setView(
              zoomView(view, 0.5, sel ? (sel.from + sel.to) / 2 : (view.from + view.to) / 2, len),
            )
          }
          disabled={!source}
          title="Look closer"
        >
          ＋<span className="sr-only">Zoom in</span>
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => setView(zoomView(view, 2, (view.from + view.to) / 2, len))}
          disabled={!source || !zoomed}
          title="Look wider"
        >
          －<span className="sr-only">Zoom out</span>
        </button>
        {/**
         * ⚠️ TWO BUTTONS, BECAUSE ONE CHANGED MEANING UNDER YOUR HAND. This was a single
         * control that fitted the selection when there was one and the whole take when there
         * was not — which reads fine until you are zoomed in WITH a selection, and then there
         * is no way back out short of pressing － six times. Measured in the pane: after a
         * drag at 0.25s zoom the only ⤢ on screen zoomed further in.
         *
         * A tap on the picture clears a selection, so the pair is always reachable; the title
         * says so, because nothing else on screen would.
         */}
        <button
          className="btn btn-ghost"
          onClick={() => setView(clampView({ from: 0, to: len }, len))}
          disabled={!source || !zoomed}
          title="Show the whole recording"
        >
          ⤢ All
        </button>
        {sel && (
          <button
            className="btn btn-ghost"
            onClick={() => setView(viewAround(sel, len))}
            disabled={!source}
            title="Fill the picture with what you chose — tap the picture to clear it"
          >
            ⤢ Selection
          </button>
        )}
        {zoomed && (
          <label className="take-edit-scroll" title="Move along the recording">
            <span className="sr-only">Position in the recording</span>
            <input
              type="range"
              min={0}
              max={Math.max(0, len - span)}
              step={Math.max(0.001, span / 200)}
              value={view.from}
              onChange={(e) => setView(panView(view, Number(e.target.value), len))}
            />
          </label>
        )}
        <span className="muted take-edit-zoom">
          {zoomed ? `${exact(span)} of ${exact(len)} shown` : 'whole recording'}
        </span>
      </div>

      <div className="take-edit-bar">
        <button
          className="btn btn-ghost"
          onClick={() => (out.current ? stop() : fromCursor())}
          disabled={!heard}
          title="Hear the edited take — from the cursor, if you have placed one"
        >
          {out.current ? '■' : '▶'} Play
        </button>
        <button
          className="btn"
          onClick={() =>
            void apply(
              logDo(log, keepOnly(edit, sel!, len)),
              'kept — nothing was removed from the recording',
            )
          }
          disabled={!canKeep}
          title="Keep only this"
        >
          Keep
        </button>
        {/**
         * ⚠️ THE GAP CLOSES, which is the whole difference from Keep and the reason it needed
         * the list rather than a second pair of numbers. takeEdit's `cutOut` refuses to remove
         * everything: a drag across the whole picture followed by Cut would otherwise leave a
         * take that plays nothing, which on screen is indistinguishable from a broken one.
         */}
        <button
          className="btn"
          onClick={() =>
            void apply(
              logDo(log, cutOut(edit, sel!, len)),
              'cut — the gap is closed and the recording is untouched',
            )
          }
          disabled={!canKeep}
          title="Remove this and close the gap"
        >
          Cut
        </button>
        {/**
         * ⚠️ THE ENDS ARE SET AT A POINT, NOT DRAGGED — which is what makes them precise. A drag
         * is as fine as a pixel; a cursor can be nudged a pixel at a time at any zoom, and while
         * the take plays these follow the playhead, so an edge can be placed by ear as well as by
         * eye. Moving an edge outward restores what an earlier edit cut: the recording is whole
         * underneath, so it is as cheap as moving it in, and one press is one step for Undo.
         *
         * ⚠️ THEY REPLACE "Trim ends", which guessed where the sound was and is gone on request.
         * A take trimmed by it keeps that trim — it was an ordinary step in the stored history,
         * and nothing about the history depended on the button that made it.
         */}
        <span className="take-edit-pair">
          <button
            className="btn"
            onClick={() => {
              const at = here!
              void apply(logDo(log, toStart!), `starts at ${ms(at)}`).then(() => setCursor(at))
            }}
            disabled={!toStart}
            title="Start the take at the cursor"
          >
            ⇤ Start here
          </button>
          <button
            className="btn"
            onClick={() => {
              const next = toEnd!
              /* the cursor steps back from the new end, so ▶ hears the cut-off straight away */
              const back = toSource(next, Math.max(0, editLen(next) - 2))
              void apply(logDo(log, next), `ends at ${ms(here!)} — ▶ plays the last 2s`).then(() =>
                setCursor(back),
              )
            }}
            disabled={!toEnd}
            title="End the take at the cursor"
          >
            End here ⇥
          </button>
        </span>
        {cursor != null && !running && (
          <span className="take-edit-pair take-edit-cursor">
            <button
              className="btn btn-ghost"
              onClick={() => nudge(-step)}
              title="Move the cursor earlier"
            >
              ‹<span className="sr-only">Earlier</span>
            </button>
            <span className="muted">{ms(cursor)}</span>
            <button
              className="btn btn-ghost"
              onClick={() => nudge(step)}
              title="Move the cursor later"
            >
              ›<span className="sr-only">Later</span>
            </button>
          </span>
        )}
        {/**
         * ⚠️ WORDS, AND KEPT TOGETHER. They were ↶ and ↷ with the names hidden for screen
         * readers, which `mobile-audit` passes — its wordless rule reads the accessibility
         * tree, and an sr-only span is a real name there. Eyes are a different question: at
         * 375 the two glyphs are near-identical, and a screenshot showed the row wrapping
         * BETWEEN them, so Undo ended one line and Redo began the next as if they were
         * unrelated. Undo is the whole of "forgiving" in this editor; it should not be the
         * control nobody can find.
         */}
        <span className="take-edit-pair">
          <button
            className="btn btn-ghost"
            onClick={() => void apply(logUndo(log), 'undone')}
            disabled={!canUndo(log)}
            title="Take back the last edit"
          >
            ↶ Undo
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => void apply(logRedo(log), 'redone')}
            disabled={!canRedo(log)}
            title="Put the last edit back"
          >
            ↷ Redo
          </button>
        </span>
        {/**
         * ⚠️ STILL HERE, AND IT IS NOT UNDO. Undo steps back through what you did; this goes
         * straight to the recording as it was, in one press, and is itself an edit you can
         * undo. Keeping both is the difference between "that last cut was wrong" and "start
         * again" — two different thoughts, and asking somebody to press Undo eleven times to
         * express the second is how an editor stops feeling forgiving.
         */}
        <button
          className="btn btn-ghost"
          onClick={() => void apply(logDo(log, wholeEdit(len)), 'back to the whole recording')}
          disabled={whole}
          title="Back to the whole recording — itself undoable"
        >
          Whole take
        </button>
        {/* ⚠️ AS RECORDED, AND IT SAYS SO. The copy has always been the edited take without its
            sound — and with previews now playing through that sound, an unlabelled "Save a
            copy" would hand back something other than what was just heard. Whether it should
            carry the sound is a decision about what an export means, so it is named, not made:
            see docs/2026-11-08-a-take-has-its-own-sound.md. ⬇ Stems is the processed export. */}
        <button
          className="btn btn-ghost"
          onClick={save}
          disabled={!heard}
          title="A WAV of the edited take, without its sound settings"
        >
          ⬇ Save as recorded
        </button>
        <span className="muted take-edit-says">
          {whole
            ? `All ${exact(len)}`
            : `${exact(played)} of ${exact(len)}${parts > 1 ? ` in ${parts} pieces` : ''}`}
          {sel ? ` · chosen ${exact(sel.to - sel.from)}` : ''}
          {say
            ? ` · ${say}`
            : cursor == null && !sel && !running
              ? ' · tap the picture to place the cursor'
              : ''}
        </span>
      </div>
    </div>
  )
}
