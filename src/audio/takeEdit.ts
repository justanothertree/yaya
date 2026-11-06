/**
 * Looking at a recording, and deciding which part of it to keep.
 *
 * ⚠️ NOTHING HERE TOUCHES THE AUDIO. A trim is two numbers stored beside the take; the blob
 * that came off the microphone is never rewritten, never re-encoded and never shortened. That
 * is the whole design and it is not a convenience — it is the difference between an edit you
 * can take back and one that has eaten the only copy of something somebody sang. takes.ts
 * already makes the harder half of this promise: `putTake` refuses at the cap rather than
 * evicting, because "that silently deletes something somebody sang, which is the one thing a
 * recorder must never do". An edit that rewrites the blob is the same deletion wearing a
 * different hat.
 *
 * So undo is not a stack here. It is the absence of a reason to have one: the original is
 * always still there, and `wholeTake` puts it back.
 *
 * ⚠️ AND IT IS PURE, so it can be asked questions. Everything that needs an AudioContext or a
 * canvas lives in the panel; the arithmetic that decides what you see and what you keep lives
 * here, where `npm run test` can reach it. Same move as play.ts, clipScan.ts and takeFx.ts,
 * each of which explains it in its own header.
 */

/**
 * The shortest span a trim may leave.
 *
 * ⚠️ FROM THE WORLD, NOT FROM TASTE. 20ms is about one cycle of the lowest note a human voice
 * produces — below it there is no pitch to hear, only a click — and a slice of zero frames is
 * a buffer source that ends before it starts, which plays nothing and looks like a broken
 * button. A drag that selects less than this is treated as a mis-click rather than obeyed.
 */
export const MIN_TRIM = 0.02

export type Trim = { from: number; to: number }

const fin = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback)

/** The whole thing, which is what every take starts as and what Reset puts back. */
export const wholeTake = (len: number): Trim => ({ from: 0, to: Math.max(0, fin(len, 0)) })

/** Is this trim the whole take? Decides whether there is anything to reset. */
export function isWhole(trim: Trim | null | undefined, len: number): boolean {
  if (!trim) return true
  const t = clampTrim(trim, len)
  const w = wholeTake(len)
  return Math.abs(t.from - w.from) < 1e-6 && Math.abs(t.to - w.to) < 1e-6
}

/**
 * Put a trim into range, whatever it says.
 *
 * ⚠️ IT TAKES ANYTHING, because a trim is persisted. It goes into IndexedDB beside the blob and
 * comes back out of a store "writable by anything on this origin" — takes.ts says exactly that
 * about its own rows and validates on the way out for the same reason. A reversed pair, a NaN
 * from a half-finished drag, a `to` past the end of a take that was replaced by a shorter
 * re-recording: all reachable, none of them a reason to lose the take.
 *
 * ⚠️ AND A SPAN TOO SHORT TO HEAR BECOMES THE WHOLE TAKE, not a 1ms sliver. Clamping it up to
 * MIN_TRIM would silently keep a span nobody chose; refusing it outright and handing back the
 * whole take is the answer somebody can see and correct.
 */
export function clampTrim(trim: Trim | null | undefined, len: number): Trim {
  const end = Math.max(0, fin(len, 0))
  if (!trim || end <= 0) return wholeTake(end)
  let from = fin(trim.from, 0)
  let to = fin(trim.to, end)
  if (to < from) [from, to] = [to, from]
  from = Math.max(0, Math.min(end, from))
  to = Math.max(0, Math.min(end, to))
  if (to - from < MIN_TRIM) return wholeTake(end)
  return { from, to }
}

/** How long the kept part is. */
export const trimLen = (trim: Trim | null | undefined, len: number): number => {
  const t = clampTrim(trim, len)
  return t.to - t.from
}

/**
 * Where to start a buffer source and how long to let it run, in whole frames.
 *
 * ⚠️ FRAMES, NOT SECONDS, AND THAT IS WHAT MAKES THE EXPORT AGREE WITH THE PLAYBACK. The
 * preview hands seconds to `start(when, offset, duration)` and the export copies samples out of
 * a Float32Array — two different units for one decision is how a saved file ends up a frame or
 * two different from what was auditioned. Both ask this.
 */
export function trimFrames(
  trim: Trim | null | undefined,
  len: number,
  rate: number,
): { offset: number; frames: number } {
  const r = fin(rate, 0)
  if (!(r > 0)) return { offset: 0, frames: 0 }
  const t = clampTrim(trim, len)
  const total = Math.max(0, Math.round(Math.max(0, fin(len, 0)) * r))
  const offset = Math.min(total, Math.max(0, Math.round(t.from * r)))
  const frames = Math.max(0, Math.min(total - offset, Math.round((t.to - t.from) * r)))
  return { offset, frames }
}

/**
 * The envelope to draw: the lowest and highest sample in each column of pixels.
 *
 * ⚠️ MIN AND MAX, NOT AN AVERAGE OR AN RMS. A waveform is a picture of a decision — where does
 * the singing start, where did the dog bark — and that decision is made on PEAKS. An averaged
 * column hides a one-sample click entirely, and an RMS column turns a quiet verse and a loud
 * chorus into two similar grey bars. Both of them smooth away the thing you are looking for.
 *
 * ⚠️ AND EVERY SAMPLE IS LOOKED AT, rather than one in every n. Stepping through a minute of
 * 48kHz audio at a stride is ten times faster and misses exactly the transients this is for: a
 * click lasts a handful of samples and a stride of 1,400 will usually step straight over it.
 * Three million comparisons once per decoded take is nothing; being wrong about where the sound
 * starts is not.
 *
 * Returns a flat array of [min, max] pairs so it can be drawn without allocating per column.
 */
export function peaks(data: ArrayLike<number>, columns: number): Float32Array {
  const cols = Math.max(1, Math.min(100000, Math.floor(fin(columns, 1))))
  const out = new Float32Array(cols * 2)
  const n = data.length
  if (!n) return out
  for (let c = 0; c < cols; c++) {
    /* ⚠️ the bounds are worked out from the COLUMN, not by accumulating a step — a float step
       added `cols` times drifts, and the last column ends up short of the end of the audio */
    const a = Math.floor((c * n) / cols)
    const b = Math.max(a + 1, Math.floor(((c + 1) * n) / cols))
    let lo = Infinity
    let hi = -Infinity
    for (let i = a; i < b && i < n; i++) {
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

/**
 * A drag across the picture, as a span of the take.
 *
 * ⚠️ ORDERED, SO DRAGGING BACKWARDS WORKS. Selecting right-to-left is how about half of people
 * do it and a handler that trusts the order gives a negative span, which reads on screen as the
 * selection refusing to appear.
 */
export function pickRange(x0: number, x1: number, width: number, len: number): Trim {
  const w = fin(width, 0)
  const end = Math.max(0, fin(len, 0))
  if (!(w > 0) || end <= 0) return wholeTake(end)
  const at = (x: number) =>
    Math.max(0, Math.min(end, (Math.max(0, Math.min(w, fin(x, 0))) / w) * end))
  const a = at(x0)
  const b = at(x1)
  return a <= b ? { from: a, to: b } : { from: b, to: a }
}

/** Where a moment in the take sits across the picture, 0..1 — for the selection box and playhead. */
export function atFraction(seconds: number, len: number): number {
  const end = Math.max(0, fin(len, 0))
  if (end <= 0) return 0
  return Math.max(0, Math.min(1, fin(seconds, 0) / end))
}
