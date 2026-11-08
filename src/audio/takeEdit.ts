/**
 * Which parts of a recording to play, and every edit as a change to that list.
 *
 * ⚠️ A LIST OF KEPT SPANS, NOT A TRIM — and this replaced a `{from, to}` because the second
 * operation would not fit in it. Keeping the middle of a take is one span; cutting a cough out
 * of the middle and closing the gap is two, and bolting a `cut` field beside a `trim` field
 * would have been two mechanisms that have to agree about which wins. One list answers both:
 *
 *     keep this bit   →  the list becomes the part you chose
 *     cut this bit    →  the list loses that part and the rest closes up
 *
 * and everything downstream — how long it plays, where the playhead is, what the export
 * writes, what the loop schedules — is one reading of that list rather than four features that
 * each learned about trimming separately.
 *
 * ⚠️ NOTHING HERE TOUCHES THE AUDIO. The list is numbers stored beside the take; the blob that
 * came off the microphone is never rewritten, never re-encoded and never shortened. takes.ts
 * already refuses to evict at the storage cap because "that silently deletes something somebody
 * sang, which is the one thing a recorder must never do" — an edit that rewrites the blob is
 * the same deletion wearing a different hat. Undo is therefore not a trick: every step is a
 * list, and going back is reading an earlier one.
 *
 * ⚠️ TWO CLOCKS, AND CONFUSING THEM IS THE BUG THIS MODULE EXISTS TO PREVENT. **Source time**
 * is a position in the recording as it was made; **played time** is a position in the edited
 * result. They are the same number only while nothing has been cut. The waveform is drawn on
 * the SOURCE clock — so you can see the part you removed, and put it back — while a playhead
 * arrives on the PLAYED clock, which is why `toSource` exists and why no caller is allowed to
 * subtract its way between them.
 *
 * ⚠️ AND IT IS PURE, so it can be asked questions. Everything needing an AudioContext or a
 * canvas lives in the panel. Same move as play.ts, clipScan.ts and takeFx.ts.
 */

/**
 * The shortest span an edit may leave.
 *
 * ⚠️ FROM THE WORLD, NOT FROM TASTE. 20ms is about one cycle of the lowest note a human voice
 * produces — below it there is no pitch to hear, only a click — and a slice of zero frames is
 * a buffer source that ends before it starts, which plays nothing and looks like a broken
 * button. A drag that selects less than this is treated as a mis-click rather than obeyed.
 */
export const MIN_SPAN = 0.02

/**
 * How many steps of undo a take remembers.
 *
 * ⚠️ BOUNDED BECAUSE IT IS PERSISTED. The history goes into IndexedDB beside the audio, so an
 * unbounded one is a row that grows for ever inside a store with a hard cap on it — and the
 * thing it would eventually squeeze out is somebody's recording. Forty steps is far more than
 * anybody undoes in a sitting and costs a few hundred bytes.
 */
export const HISTORY_MAX = 40

/**
 * The join between two kept spans, in seconds.
 *
 * ⚠️ A HARD SPLICE IS A CLICK, AND IT IS THE SAME MEASUREMENT AS THE ECHO SLIDER. Cutting a
 * piece out and closing the gap butts two unrelated waveforms together, which is a step
 * discontinuity — measured on this project's own delay line at **1.813** against a natural
 * per-sample slew of **0.0288**, sixty-three times anything the signal can do by itself. Five
 * milliseconds is long enough to remove it and short enough that a consonant survives: a voice
 * does not change in 5ms, and 240 samples at 48kHz is a quarter of one cycle of the lowest
 * note in it.
 */
export const JOIN_FADE = 0.005

export type Span = { from: number; to: number }
/** The kept parts, in source seconds: sorted, disjoint, none shorter than MIN_SPAN. */
export type Edit = { keep: Span[] }

const fin = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback)
const bound = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Everything, which is what a take starts as and what Whole take puts back. */
export const wholeEdit = (len: number): Edit => {
  const end = Math.max(0, fin(len, 0))
  return { keep: end > 0 ? [{ from: 0, to: end }] : [] }
}

/**
 * Put any list of spans into a shape the rest of this file can trust.
 *
 * ⚠️ IT TAKES ANYTHING, because an edit is persisted. It comes back out of a store "writable by
 * anything on this origin" — takes.ts says exactly that about its own rows and validates on the
 * way out for the same reason. A reversed pair, a NaN from a half-finished drag, overlapping
 * spans from two operations, a `to` past the end of a take that was replaced by a shorter
 * re-recording: all reachable, and none of them a reason to lose the recording.
 */
export function normalise(spans: readonly Span[] | null | undefined, len: number): Edit {
  const end = Math.max(0, fin(len, 0))
  if (!end || !Array.isArray(spans)) return wholeEdit(end)
  const clean: Span[] = []
  for (const s of spans) {
    if (!s || typeof s !== 'object') continue
    let from = fin((s as Span).from, NaN)
    let to = fin((s as Span).to, NaN)
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue
    if (to < from) [from, to] = [to, from]
    from = bound(from, 0, end)
    to = bound(to, 0, end)
    if (to - from < MIN_SPAN) continue
    clean.push({ from, to })
  }
  clean.sort((a, b) => a.from - b.from)
  /* ⚠️ MERGED, NOT JUST SORTED. Two operations can leave spans that touch or overlap, and a
     list with a 0.3s span inside a 0.5s one plays that audio twice — which sounds like a
     stutter nobody asked for and is very hard to see in a list of numbers. */
  const out: Span[] = []
  for (const s of clean) {
    const last = out[out.length - 1]
    if (last && s.from <= last.to) last.to = Math.max(last.to, s.to)
    else out.push({ ...s })
  }
  /* an edit that keeps nothing is not an edit, it is a deleted take — see cutOut */
  return out.length ? { keep: out } : wholeEdit(end)
}

/** Is this the whole recording? Decides whether there is anything to put back. */
export function isWholeEdit(edit: Edit | null | undefined, len: number): boolean {
  const e = edit ?? wholeEdit(len)
  const end = Math.max(0, fin(len, 0))
  if (e.keep.length !== 1) return false
  return e.keep[0].from < 1e-6 && e.keep[0].to > end - 1e-6
}

/** How long the edited result plays for. */
export const editLen = (edit: Edit | null | undefined): number =>
  (edit?.keep ?? []).reduce((n, s) => n + Math.max(0, s.to - s.from), 0)

/** Keep only what is inside this selection — the trim. */
export function keepOnly(edit: Edit, sel: Span, len: number): Edit {
  const want = normalise([sel], len).keep[0]
  if (!want) return edit
  const out: Span[] = []
  for (const s of edit.keep) {
    const from = Math.max(s.from, want.from)
    const to = Math.min(s.to, want.to)
    if (to - from >= MIN_SPAN) out.push({ from, to })
  }
  /* ⚠️ a selection that misses every kept span leaves the edit alone rather than emptying it.
     Keeping nothing is not something a Keep button should ever be able to do. */
  return out.length ? { keep: out } : edit
}

/**
 * Take this selection out and close the gap.
 *
 * ⚠️ IT REFUSES TO REMOVE EVERYTHING. A drag across the whole waveform followed by Cut would
 * otherwise leave a take that plays nothing — indistinguishable on screen from a broken one,
 * and reachable by one clumsy gesture. Deleting a recording is what the ✕ is for, and it asks
 * first.
 */
export function cutOut(edit: Edit, sel: Span, len: number): Edit {
  const gone = normalise([sel], len).keep[0]
  if (!gone) return edit
  const out: Span[] = []
  for (const s of edit.keep) {
    /* a span the cut does not reach survives whole, and must be decided FIRST — working it
       out from the two halves instead is how a span the cut misses ends up rebuilt wrong */
    if (gone.to <= s.from || gone.from >= s.to) {
      out.push({ ...s })
      continue
    }
    const left = { from: s.from, to: Math.min(s.to, gone.from) }
    const right = { from: Math.max(s.from, gone.to), to: s.to }
    /* either side may be too short to be worth keeping, and both may be */
    if (left.to - left.from >= MIN_SPAN) out.push(left)
    if (right.to - right.from >= MIN_SPAN) out.push(right)
  }
  /* ⚠️ `normalise` is what refuses to keep nothing, and there was a second guard here doing
     the same job. Perturbing the line showed it: removing it changed no test, because both
     paths answer "the whole take". Two guards for one rule is one of them never exercised,
     so the rule lives in one place — read the end of `normalise`. */
  return normalise(out, len)
}

/**
 * Where in the RECORDING a moment of the edited result came from.
 *
 * ⚠️ THE PLAYHEAD NEEDS THIS AND SUBTRACTION WILL NOT DO IT. The waveform is drawn on the
 * source clock so you can see what was cut; a playing buffer reports its position on the
 * played clock. With two cuts in a take those differ by different amounts in different places,
 * so the only correct conversion is to walk the kept spans.
 *
 * Returns null past the end of the edited result.
 */
export function toSource(edit: Edit, played: number): number | null {
  let left = fin(played, -1)
  if (left < 0) return null
  for (const s of edit.keep) {
    const n = s.to - s.from
    if (left < n) return s.from + left
    left -= n
  }
  return null
}

/** The other direction: where a moment of the recording lands in the result, or null if cut. */
export function toPlayed(edit: Edit, source: number): number | null {
  const at = fin(source, -1)
  if (at < 0) return null
  let before = 0
  for (const s of edit.keep) {
    if (at < s.from) return null
    if (at <= s.to) return before + (at - s.from)
    before += s.to - s.from
  }
  return null
}

/**
 * Where to start playing so the first thing heard is this moment of the recording, or the first
 * kept moment after it.
 *
 * ⚠️ NOT `toPlayed`, WHICH ANSWERS NULL FOR A MOMENT THAT WAS CUT. A tap lands wherever a
 * finger lands, and a cut region is drawn right there on the picture — so "play from here"
 * inside one has to mean "from the next thing you will hear", not "nothing". Null only past
 * the end, where there is nothing left to play.
 */
export function playedFrom(edit: Edit, source: number): number | null {
  const at = fin(source, -1)
  let before = 0
  for (const s of edit.keep) {
    if (at < s.from) return before
    if (at < s.to) return before + (at - s.from)
    before += s.to - s.from
  }
  return null
}

/**
 * Start the take at this moment of the recording, or end it there.
 *
 * ⚠️ IT CAN GIVE BACK AS WELL AS TAKE AWAY, which is what makes it the precise way to trim. A
 * start placed BEFORE the first kept moment reaches back into what an earlier edit cut and
 * restores it — the recording was never touched, so moving an edge outward is as cheap as
 * moving it in. Only the outer edges move outward; a piece cut from the middle stays cut,
 * because that was a separate decision and this button is about the ends.
 *
 * ⚠️ NULL WHEN IT WOULD DO NOTHING OR LEAVE NOTHING — an edge past the other edge, or the edge
 * already where it was asked to go — so the button's disabled state is this function's answer
 * rather than a second copy of its rules.
 */
export function trimTo(edit: Edit, side: 'start' | 'end', at: number, len: number): Edit | null {
  if (!Number.isFinite(at) || !edit.keep.length) return null
  const t = bound(at, 0, fin(len, 0))
  const keep = edit.keep
  const first = keep[0]
  const last = keep[keep.length - 1]
  let spans: Span[]
  if (side === 'start') {
    if (t > last.to - MIN_SPAN) return null
    spans =
      t <= first.from
        ? [{ from: t, to: first.to }, ...keep.slice(1)]
        : keep.map((s) => ({ from: Math.max(s.from, t), to: s.to }))
  } else {
    if (t < first.from + MIN_SPAN) return null
    spans =
      t >= last.to
        ? [...keep.slice(0, -1), { from: last.from, to: t }]
        : keep.map((s) => ({ from: s.from, to: Math.min(s.to, t) }))
  }
  const kept = spans.filter((s) => s.to - s.from >= MIN_SPAN)
  if (!kept.length) return null
  const next = normalise(kept, len)
  const same =
    next.keep.length === keep.length &&
    next.keep.every((s, i) => s.from === keep[i].from && s.to === keep[i].to)
  return same ? null : next
}

/** Each kept span as whole frames, which is the one unit preview, loop and export all ask in. */
export function editFrames(
  edit: Edit,
  len: number,
  rate: number,
): { offset: number; frames: number }[] {
  const r = fin(rate, 0)
  if (!(r > 0)) return []
  const total = Math.max(0, Math.round(Math.max(0, fin(len, 0)) * r))
  const out: { offset: number; frames: number }[] = []
  for (const s of normalise(edit.keep, len).keep) {
    const offset = bound(Math.round(s.from * r), 0, total)
    const frames = bound(Math.round((s.to - s.from) * r), 0, total - offset)
    if (frames > 0) out.push({ offset, frames })
  }
  return out
}

/**
 * The edited audio, as samples.
 *
 * ⚠️ ONE FUNCTION FOR THE PREVIEW, THE LOOP AND THE EXPORT, which is what makes them agree
 * rather than three call sites that have to be kept in step. The brief for this pass asks that
 * they never disagree after an edit, an undo, a save or a reload; the cheapest way to promise
 * that is to have one answer.
 *
 * ⚠️ AND IT FADES EVERY JOIN. See JOIN_FADE: butting two unrelated waveforms together is a step
 * discontinuity and a step discontinuity is a click. The fade is clamped to a quarter of the
 * shorter side so a very short span is not faded into nothing.
 */
export function renderSamples(
  channels: readonly Float32Array[],
  edit: Edit,
  len: number,
  rate: number,
): Float32Array[] {
  const plan = editFrames(edit, len, rate)
  const total = plan.reduce((n, p) => n + p.frames, 0)
  const out = channels.map(() => new Float32Array(total))
  if (!total) return out
  const fade = Math.max(1, Math.round(JOIN_FADE * Math.max(1, fin(rate, 48000))))
  for (let c = 0; c < channels.length; c++) {
    const src = channels[c]
    const dst = out[c]
    let at = 0
    for (const p of plan) {
      const n = p.frames
      /* ⚠️ a quarter of the span, so a 20ms keep is not 10ms of fade in and 10ms of fade out */
      const f = Math.min(fade, Math.floor(n / 4) || 1)
      for (let i = 0; i < n; i++) {
        const v = src[p.offset + i] ?? 0
        const up = i < f ? (i + 1) / (f + 1) : 1
        const down = i >= n - f ? (n - i) / (f + 1) : 1
        dst[at + i] = v * up * down
      }
      at += n
    }
  }
  return out
}

/**
 * The envelope to draw: the lowest and highest sample in each column of pixels.
 *
 * ⚠️ MIN AND MAX, NOT AN AVERAGE OR AN RMS. A waveform is a picture of a decision — where does
 * the singing start, where did the dog bark — and that decision is made on PEAKS. An averaged
 * column hides a one-sample click entirely, and an RMS column turns a quiet verse and a loud
 * chorus into two similar grey bars. Both of them smooth away the thing you are looking for.
 *
 * ⚠️ AND EVERY SAMPLE IS LOOKED AT, rather than one in every n. Stepping through at a stride is
 * ten times faster and misses exactly the transients this is for: a click lasts a handful of
 * samples and a stride of 1,400 will usually step straight over it.
 *
 * Returns a flat array of [min, max] pairs so it can be drawn without allocating per column.
 */
export function peaks(data: ArrayLike<number>, columns: number, from = 0, to = -1): Float32Array {
  const cols = Math.max(1, Math.min(100000, Math.floor(fin(columns, 1))))
  const out = new Float32Array(cols * 2)
  const a0 = Math.max(0, Math.min(data.length, Math.floor(fin(from, 0))))
  const b0 = to < 0 ? data.length : Math.max(a0, Math.min(data.length, Math.floor(fin(to, 0))))
  const n = b0 - a0
  if (n <= 0) return out
  for (let c = 0; c < cols; c++) {
    /* ⚠️ the bounds are worked out from the COLUMN, not by accumulating a step — a float step
       added `cols` times drifts, and the last column ends up short of the end of the audio */
    const a = a0 + Math.floor((c * n) / cols)
    const b = Math.max(a + 1, a0 + Math.floor(((c + 1) * n) / cols))
    let lo = Infinity
    let hi = -Infinity
    for (let i = a; i < b && i < b0; i++) {
      const v = data[i]
      /* NaN fails both comparisons, so a corrupt sample cannot drag the envelope to the edge */
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    out[c * 2] = lo === Infinity ? 0 : lo
    out[c * 2 + 1] = hi === -Infinity ? 0 : hi
  }
  return out
}

/* ── the visible window, for zooming into a long take ─────────────────────────────────── */

/** What part of the source the picture is showing, in seconds. */
export type View = { from: number; to: number }

/**
 * The narrowest window the picture may show.
 *
 * ⚠️ IT IS A WIDTH IN TIME, NOT A ZOOM FACTOR, because what matters is how accurately you can
 * put an edge down. At 300 CSS pixels a 0.2s window is about 0.7ms per pixel, which is finer
 * than any edit anybody makes on a voice and already deep inside a single vowel.
 */
export const MIN_VIEW = 0.2

export function clampView(view: View | null | undefined, len: number): View {
  const end = Math.max(0, fin(len, 0))
  if (!view || end <= 0) return { from: 0, to: end }
  let from = fin(view.from, 0)
  let to = fin(view.to, end)
  if (to < from) [from, to] = [to, from]
  let span = Math.min(end, Math.max(Math.min(MIN_VIEW, end), to - from))
  if (span <= 0) span = end
  from = bound(from, 0, Math.max(0, end - span))
  return { from, to: from + span }
}

/**
 * Zoom about a fixed point — the thing under your finger stays under your finger.
 *
 * ⚠️ ANCHORED, BECAUSE A ZOOM THAT RECENTRES IS A ZOOM YOU HAVE TO CHASE. Zooming on the middle
 * of the window moves whatever you were looking at off the edge the moment you are not already
 * centred on it, which on a long take means two or three corrections per press.
 */
export function zoomView(view: View, by: number, anchor: number, len: number): View {
  const v = clampView(view, len)
  const end = Math.max(0, fin(len, 0))
  const factor = fin(by, 1)
  if (!(factor > 0) || end <= 0) return v
  const span = bound((v.to - v.from) * factor, Math.min(MIN_VIEW, end), end)
  const a = bound(fin(anchor, (v.from + v.to) / 2), v.from, v.to)
  /* keep the anchor at the same fraction across the picture */
  const share = v.to - v.from > 0 ? (a - v.from) / (v.to - v.from) : 0.5
  return clampView({ from: a - share * span, to: a - share * span + span }, len)
}

/** Slide the window without changing how much it shows. */
export function panView(view: View, to: number, len: number): View {
  const v = clampView(view, len)
  const span = v.to - v.from
  return clampView({ from: fin(to, v.from), to: fin(to, v.from) + span }, len)
}

/** Put a span on screen with a little room around it, for "zoom to what I chose". */
export function viewAround(span: Span, len: number): View {
  const end = Math.max(0, fin(len, 0))
  const width = Math.max(MIN_VIEW, (span.to - span.from) * 1.4)
  const mid = (span.from + span.to) / 2
  return clampView({ from: mid - width / 2, to: mid + width / 2 }, end)
}

/** A pixel across the picture, as a moment of the recording. */
export function xToTime(x: number, width: number, view: View): number {
  const w = fin(width, 0)
  if (!(w > 0)) return view.from
  return view.from + bound(fin(x, 0) / w, 0, 1) * (view.to - view.from)
}

/** A moment of the recording, as a fraction across the picture. Outside 0..1 when off screen. */
export function timeToFrac(t: number, view: View): number {
  const span = view.to - view.from
  if (!(span > 0)) return 0
  return (fin(t, view.from) - view.from) / span
}

/**
 * A drag across the picture, as a span of the recording.
 *
 * ⚠️ ORDERED, SO DRAGGING BACKWARDS WORKS. Selecting right-to-left is how about half of people
 * do it and a handler that trusts the order gives a negative span, which reads on screen as the
 * selection refusing to appear.
 */
export function pickRange(x0: number, x1: number, width: number, view: View): Span {
  const a = xToTime(x0, width, view)
  const b = xToTime(x1, width, view)
  return a <= b ? { from: a, to: b } : { from: b, to: a }
}

/* ── undo and redo ────────────────────────────────────────────────────────────────────── */

/**
 * Every edit this take has been through, and where in that line we are standing.
 *
 * ⚠️ AN INDEX, NOT TWO STACKS, because the behaviour that has to be right is BRANCHING: undo
 * twice, then make a new edit, and the two steps you had undone must be gone rather than
 * waiting to reappear on the next redo. With an index that is one truncation; with a pair of
 * stacks it is a thing you have to remember to do in the one place nobody tests.
 */
export type EditLog = { steps: Edit[]; at: number }

export const logNow = (log: EditLog): Edit => log.steps[log.at] ?? { keep: [] }
export const canUndo = (log: EditLog): boolean => log.at > 0
export const canRedo = (log: EditLog): boolean => log.at < log.steps.length - 1

export const startLog = (edit: Edit): EditLog => ({ steps: [edit], at: 0 })

export function logDo(log: EditLog, next: Edit): EditLog {
  /* everything after where we stand is a future that did not happen */
  const steps = log.steps.slice(0, log.at + 1)
  steps.push(next)
  /* ⚠️ the OLDEST goes, and `at` comes with it — dropping from the front without moving the
     index silently rewinds the take to an earlier edit on the 41st change */
  const over = Math.max(0, steps.length - HISTORY_MAX)
  return { steps: steps.slice(over), at: steps.length - 1 - over }
}

export const logUndo = (log: EditLog): EditLog =>
  canUndo(log) ? { steps: log.steps, at: log.at - 1 } : log
export const logRedo = (log: EditLog): EditLog =>
  canRedo(log) ? { steps: log.steps, at: log.at + 1 } : log

/**
 * Read a log back out of storage, from whatever is actually there.
 *
 * ⚠️ IT UNDERSTANDS THE OLD SHAPE. The first pass stored `trim: {from, to}`, and a take trimmed
 * before this change must not lose its edit — a migration that drops data is the same failure
 * as an editor that rewrites the blob, just quieter. A legacy trim becomes a one-span edit with
 * the whole take behind it in the history, so the first thing Undo does is put it back.
 */
export function readLog(raw: unknown, legacyTrim: unknown, len: number): EditLog {
  const whole = wholeEdit(len)
  const asLog = raw as { steps?: unknown; at?: unknown } | null | undefined
  if (asLog && Array.isArray(asLog.steps) && asLog.steps.length) {
    const steps = asLog.steps.map((s) => normalise((s as Edit)?.keep, len)).slice(-HISTORY_MAX)
    const at = bound(Math.round(fin(asLog.at as number, steps.length - 1)), 0, steps.length - 1)
    return { steps, at }
  }
  const t = legacyTrim as Span | null | undefined
  if (t && Number.isFinite(t.from) && Number.isFinite(t.to)) {
    const one = normalise([t], len)
    if (!isWholeEdit(one, len)) return { steps: [whole, one], at: 1 }
  }
  return startLog(whole)
}
