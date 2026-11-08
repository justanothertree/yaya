import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { resumeAudio, sharedCtx } from './context'
import { takeBus } from './takeBus'
import { decodeTake } from './recordTake'
import { setTakeLog, type TakeRow } from './takes'
import { refreshTakeAudio } from './looper'
import { editedBuffer } from './takeAudio'
import { toWav } from './wav'
import {
  canRedo,
  canUndo,
  cutOut,
  editLen,
  isWholeEdit,
  keepOnly,
  logDo,
  loudSpan,
  logNow,
  logRedo,
  logUndo,
  MIN_SPAN,
  peaks,
  pickRange,
  readLog,
  timeToFrac,
  toSource,
  viewAround,
  wholeEdit,
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

export function TakeEditor({ row, onChanged }: { row: TakeRow; onChanged: () => void }) {
  const box = useRef<HTMLCanvasElement | null>(null)
  const [source, setSource] = useState<AudioBuffer | null>(null)
  const [bad, setBad] = useState(false)
  const drag = useRef<{ x0: number; x1: number } | null>(null)
  const [sel, setSel] = useState<Span | null>(null)
  const [playAt, setPlayAt] = useState<number | null>(null)
  const out = useRef<{ src: AudioBufferSourceNode; began: number; from: number } | null>(null)
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
   * Where the sound in this recording is, for the one-press trim.
   *
   * ⚠️ THE TOP AND TAIL IS THE EDIT EVERYBODY MAKES, every time, and until now it was a drag.
   * You press record, get your hand away from the phone, sing, then reach back for the button
   * — so a take has dead air at both ends by construction, and the first thing anybody wants
   * is it gone. Doing it with a drag means finding a boundary by eye in a picture where, on a
   * six-minute take at full view, one pixel is nearly half a second.
   *
   * ⚠️ AND IT IS AN ORDINARY `keepOnly`, which is why it needed no new stored field, no second
   * code path through the renderer and no undo of its own. It composes: trim the ends of a
   * take you have already cut the middle out of, and both decisions survive.
   *
   * ⚠️ MEASURED ONCE PER DECODE. It is one pass over every sample — about 18 million for the
   * six-minute take this was checked against — and the button's own disabled state needs the
   * answer, so it cannot wait for the press.
   */
  const loud = useMemo(() => {
    if (!source) return null
    const chans: Float32Array[] = []
    for (let c = 0; c < source.numberOfChannels; c++) chans.push(source.getChannelData(c))
    return loudSpan(chans, source.duration, source.sampleRate)
  }, [source])
  /* ⚠️ enabled only when pressing it would take something away — not "is there silence
     somewhere", which is still true after you have already trimmed, leaving a live button
     whose only outcome is nothing happening */
  const trimmed = useMemo(() => (loud ? keepOnly(edit, loud, len) : null), [loud, edit, len])
  const canTrim = !!trimmed && editLen(trimmed) < played - MIN_SPAN

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
      const src = ctx.createBufferSource()
      src.buffer = heard
      src.connect(takeBus())
      src.onended = () => {
        if (out.current?.src === src) stop()
      }
      const from = Math.max(0, Math.min(heard.duration, at))
      out.current = { src, began: ctx.currentTime, from }
      src.start(0, from)
      setPlayAt(from)
    },
    [heard, stop],
  )

  /**
   * ⚠️ A TIMER, NOT requestAnimationFrame. CLAUDE.md has rAF firing in the pane on 28 Oct and
   * not firing on 5 Nov, both measured — a playhead built on it works or does not depending on
   * which week somebody checks. 20Hz is plenty for a line crossing a picture.
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
  }, [source, width, sel, edit, view, playAt])

  /** Put a new edit in the history, store it, and tell the loop its audio changed. */
  const apply = useCallback(
    async (next: EditLog, note: string) => {
      setLog(next)
      setSel(null)
      await setTakeLog(row.id, next)
      await refreshTakeAudio(row.id)
      onChanged()
      setSay(note)
    },
    [row.id, onChanged],
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
    drag.current = null
    /* a tap, not a drag — clear it rather than leaving a hairline selection nobody can see */
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
        role="img"
        aria-label={`Waveform, ${secs(len)}${whole ? '' : `, ${secs(played)} kept`}. Drag to choose part of it.`}
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
          onClick={() => (out.current ? stop() : playFrom(0))}
          disabled={!heard}
          title="Hear the edited take"
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
         * ⚠️ NO SELECTION, WHICH IS THE POINT. Keep and Cut both need a drag first; this is the
         * one edit that already knows where it wants to go, and it is also the edit every take
         * needs. See `loud` above for why that is, and takeEdit's `loudSpan` for why the
         * threshold is measured against the take's own loudest moment rather than a fixed
         * level — a recording made at arm's length would otherwise read as silence throughout.
         */}
        <button
          className="btn"
          onClick={() =>
            void apply(
              logDo(log, trimmed!),
              'trimmed — the recording is untouched and Undo puts it back',
            )
          }
          disabled={!canTrim}
          title="Remove the silence before and after the sound"
        >
          Trim ends
        </button>
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
        <button className="btn btn-ghost" onClick={save} disabled={!heard} title="Download a WAV">
          ⬇ Save a copy
        </button>
        <span className="muted take-edit-says">
          {whole
            ? `All ${exact(len)}`
            : `${exact(played)} of ${exact(len)}${parts > 1 ? ` in ${parts} pieces` : ''}`}
          {sel ? ` · chosen ${exact(sel.to - sel.from)}` : ''}
          {say ? ` · ${say}` : ''}
        </span>
      </div>
    </div>
  )
}
