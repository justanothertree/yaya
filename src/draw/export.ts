import { GifEncoder } from './gif'
import { frameCount, paintDrawing, type Drawing } from './strokes'

/**
 * A drawing, as a file you can send somebody.
 *
 * ⚠️ THE ANIMATION WAS ALREADY IN THE DATA, which is the only reason this is a small feature. A
 * picture here is the list of operations that made it, not the pixels they left (see strokes.ts),
 * so "watch it being drawn" is replaying the first k strokes for rising k — no recording, no
 * capture, no second representation to keep in step. A paint program that stored bitmaps could
 * not offer this at all without having decided to record from the start.
 *
 * ⚠️ TWO KINDS OF GIF, AND THE CALLER NAMES WHICH. They were inferred from the drawing at
 * first — frames if it had them, the replay if it did not — which is the right answer and the
 * wrong interface. Both arrived under one button called "Animation", so on a flat picture that
 * button produced a replay and there was no way to see that a frames export existed at all. It
 * was reported as missing, which it was: a feature you cannot name is one you do not have. They
 * are two buttons now, each enabled exactly when it means something.
 *
 * ⚠️ NOTHING IS UPLOADED. A file is made in the tab and handed to the browser. This is the piece
 * of "exporting art" that needs no storage, no bucket and no bill — worth being explicit about,
 * because the rest of that idea (hosting rendered media) does, and this is not it.
 */

/** Height from a width — Drawing.ratio is width over height, and reading it the other way round
    has been a bug here twice. @see Drawing.ratio */
export const sizeOf = (d: Drawing, width: number) => {
  const wh = d.ratio > 0.05 && d.ratio < 20 ? d.ratio : 1
  return { w: Math.max(8, Math.round(width)), h: Math.max(8, Math.round(width / wh)) }
}

export const STILL_WIDTHS: Array<[string, number]> = [
  ['Small', 800],
  ['Medium', 1600],
  ['Big', 2400],
]

/**
 * ⚠️ MUCH SMALLER THAN THE STILL, on purpose. A GIF stores every frame as its own image, so
 * doubling the width roughly quadruples the file — and this is the format people paste into a
 * chat, where four megabytes is a failed upload rather than a nicer picture. 480 is a comfortable
 * Discord embed; the still is there for when the size is what matters.
 */
export const MOTION_WIDTHS: Array<[string, number]> = [
  ['Small', 320],
  ['Medium', 480],
  ['Big', 640],
]

function surface(d: Drawing, width: number, opaque: boolean) {
  const { w, h } = sizeOf(d, width)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: opaque })
  if (!ctx) return null
  return { c, ctx, w, h }
}

/**
 * ⚠️ THE PAPER IS BEHIND THE PICTURE, NOT IN IT. paintDrawing clears and replays strokes; the
 * background is a colour the page puts behind the canvas, because erasing is destination-out and
 * a background painted into the picture would be rubbed out along with the paint. So every
 * renderer has to lay it down itself, and this is the only place that decides what "no paper"
 * means for a file: transparent in a PNG, and white in a GIF, which cannot do both.
 */
function paper(
  ctx: CanvasRenderingContext2D,
  d: Drawing,
  w: number,
  h: number,
  fallback: string | null,
) {
  ctx.clearRect(0, 0, w, h)
  const fill = d.bg ?? fallback
  if (!fill) return
  ctx.save()
  ctx.fillStyle = fill
  ctx.fillRect(0, 0, w, h)
  ctx.restore()
}

/** A still of the finished picture. Transparent where the drawing has no paper. */
export async function stillOf(d: Drawing, width: number): Promise<Blob | null> {
  const s = surface(d, width, false)
  if (!s) return null
  paper(s.ctx, d, s.w, s.h, null)
  /* the last frame of an animation is not "the picture" — the first is what it is a picture OF,
     and is what its thumbnail shows everywhere else on the site */
  paintDrawing(s.ctx, d, s.w, s.h, { frame: 0 })
  return new Promise((done) => s.c.toBlob((b) => done(b), 'image/png'))
}

export type MotionKind = 'frames' | 'timelapse'

export type Motion = {
  kind: MotionKind
  /** how many images the GIF will hold */
  steps: number
  /** how long it runs for, in seconds */
  seconds: number
  /** frames a second, or strokes a second — see `unit` */
  speed: number
  min: number
  max: number
  unit: 'frames' | 'strokes'
  /** hundredths of a second each image is held for */
  delay: number
}

const MAX_STEPS = 48
const HOLD = 140 // hundredths of a second to sit on the finished picture
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const tenth = (v: number) => Math.round(v * 10) / 10

/**
 * What a GIF of this would be, worked out before making one — so the panel can say what it is
 * about to do rather than the person finding out from the result, and so the speed control can
 * show the length changing as it moves.
 *
 * @param kind which of the two to describe. Null back means this drawing cannot do that one —
 * a picture with no frames has no animation, and a picture with frames is not replayed stroke by
 * stroke because `paintDrawing` shows one frame at a time, so a replay of one would be the first
 * frame being drawn and nothing else. The panel says which instead of hiding the button.
 * @param speed frames a second for an animation, strokes a second for a replay. Omitted means
 * the drawing's own answer.
 */
export function motionOf(d: Drawing, kind: MotionKind, speed?: number): Motion | null {
  const frames = frameCount(d)
  if (kind === 'frames') {
    if (frames < 2) return null
    /**
     * ⚠️ ITS OWN fps IS THE DEFAULT, NOT THE RULE. The speed a walk cycle was drawn at is
     * almost always the speed it should play at — but a GIF is a thing you send to somebody, and
     * "the same but slower so they can see it" is a reasonable thing to want from a file without
     * being a change to the drawing. 24 is the ceiling readDrawing already imposes.
     */
    const min = 1
    const max = 24
    const s = clamp(Math.round(speed ?? d.fps ?? 8), min, max)
    const delay = Math.max(2, Math.round(100 / s))
    return {
      kind,
      steps: frames,
      speed: s,
      min,
      max,
      unit: 'frames',
      delay,
      seconds: tenth((frames * delay) / 100),
    }
  }
  const n = d.strokes.length
  if (n < 2 || frames > 1) return null
  const min = 1
  const max = 60
  /**
   * ⚠️ THE DEFAULT IS A LENGTH, NOT A RATE, and then it is expressed as a rate so the slider
   * has somewhere to start. A fixed strokes-per-second would make a four-stroke sketch flash past
   * and a four-hundred-stroke one run for most of a minute; aiming at five seconds gives every
   * drawing a watchable default, and the slider is there for when five seconds is not what you
   * wanted. Strokes a second is the same unit the room's ▶ Replay slider uses, deliberately.
   */
  const s = clamp(Math.round(speed ?? n / 5), min, max)
  const steps = Math.min(MAX_STEPS, n)
  /* ⚠️ More strokes than images: a long drawing puts several strokes in each step rather than
     growing the file, so the speed asked for is still the speed it plays at. 2 is GIF's own
     floor — a shorter delay is treated as 10 by most viewers, which would be slower, not faster. */
  const delay = clamp(Math.round(((n / s) * 100) / steps), 2, 200)
  return {
    kind,
    steps,
    speed: s,
    min,
    max,
    unit: 'strokes',
    delay,
    seconds: tenth((steps * delay + HOLD) / 100),
  }
}

export type Progress = (done: number, total: number) => void

/**
 * The drawing as an animated GIF.
 *
 * ⚠️ IT YIELDS BETWEEN FRAMES. Replaying a few hundred strokes at 480px, forty-eight times, is
 * seconds of work on the main thread — and a tab that stops answering is indistinguishable from a
 * tab that has crashed. A worker would be better and is not worth a second bundle entry here:
 * handing the frame back to the browser costs almost nothing and keeps the progress line moving.
 */
export async function motionGifOf(
  d: Drawing,
  width: number,
  kind: MotionKind,
  speed?: number,
  onStep?: Progress,
): Promise<Blob | null> {
  const plan = motionOf(d, kind, speed)
  if (!plan) return null
  const s = surface(d, width, true)
  if (!s) return null
  const { ctx, w, h } = s

  const enc = new GifEncoder(w, h)

  for (let i = 0; i < plan.steps; i++) {
    /* ⚠️ Opaque, always. GIF's one transparent index means "leave what was underneath", which
       cannot express an eraser — and a picture being drawn is the one thing that erases. */
    paper(ctx, d, w, h, '#ffffff')
    if (plan.kind === 'frames') {
      paintDrawing(ctx, d, w, h, { frame: i })
    } else {
      /* the first k strokes, k climbing to all of them — the drawing, drawing itself */
      const k = Math.max(1, Math.round(((i + 1) * d.strokes.length) / plan.steps))
      paintDrawing(ctx, { ...d, strokes: d.strokes.slice(0, k) }, w, h)
    }
    const last = i === plan.steps - 1
    enc.add(
      ctx.getImageData(0, 0, w, h).data,
      plan.delay + (last && plan.kind === 'timelapse' ? HOLD : 0),
    )
    onStep?.(i + 1, plan.steps)
    await new Promise((r) => setTimeout(r, 0))
  }

  const bytes = enc.finish()
  return bytes.length ? new Blob([bytes], { type: 'image/gif' }) : null
}

/** A filename somebody can find again: the picture's own name, the date, nothing else. */
export function fileNameFor(d: Drawing, ext: string): string {
  const slug =
    d.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'drawing'
  const at = new Date()
  const stamp = `${at.getFullYear()}${String(at.getMonth() + 1).padStart(2, '0')}${String(at.getDate()).padStart(2, '0')}`
  return `${slug}-${stamp}.${ext}`
}

/**
 * Hand a file to the browser.
 *
 * ⚠️ The object URL holds the whole file in memory until it is let go of — the same note the
 * account backup carries, and the reason both revoke on a timer rather than immediately: revoking
 * in the same tick can beat the download starting in some browsers.
 */
export function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Bytes, for a line of copy that has to fit on a phone. */
export const sizeLabel = (n: number) =>
  n < 1024 * 1024
    ? `${Math.max(1, Math.round(n / 1024))} KB`
    : `${(n / (1024 * 1024)).toFixed(1)} MB`
