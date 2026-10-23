/**
 * How big a picture should be before it leaves the browser, and how hard to squeeze it.
 *
 * ⚠️ THE DECISIONS ARE PURE AND THE CANVAS IS NOT, which is the split this project keeps asking
 * for. Drawing to a canvas and asking it for a blob needs a DOM; working out what size to draw at
 * and what to do when the result is still too big does not, and it has UNITS in it — pixels and
 * bytes — so it belongs where a test can ask it a question.
 *
 * ⚠️ COMPRESSING HERE RATHER THAN ANYWHERE ELSE IS THE WHOLE POINT. A 4000x3000 photo off a phone
 * is about 4 MB; at 1600px on the long edge and WebP quality 0.8 it is nearer 200 KB. That is the
 * difference between a picture library that fits in a free tier and one that does not — and
 * because it happens in front of the person, the quality dial is a thing they hold rather than a
 * tax something charges them out of sight.
 */

/** the long edge a kept picture is drawn at */
export const FULL_EDGE = 1600
/** and a thumbnail, which is what a grid loads — roughly a tenth of the bytes */
export const THUMB_EDGE = 320

/**
 * ⚠️ THE SAME NUMBERS THE SERVER CHECKS, and in the same unit. `member_pictures` carries
 * `check (bytes between 1 and 2097152)`, and what is measured here is `Blob.size`, which is bytes
 * of the encoded image — the same thing `octet_length` would count. That agreement is deliberate:
 * CLAUDE.md §4 records a ceiling that leaked because the local one counted UTF-16 code units while
 * the server counted UTF-8 bytes. Binary has no such trap, but a local cap LOOSER than the
 * server's is still a silent half-save, so these exist to refuse before the round trip rather than
 * after it.
 */
export const FULL_BYTES = 2_097_152
export const THUMB_BYTES = 262_144

/** the lowest quality worth offering — below this a photograph stops being one */
export const FLOOR_QUALITY = 0.3

/**
 * The highest quality worth offering, and it is NOT 1.
 *
 * ⚠️ WEBP QUALITY 1.0 IS A DIFFERENT MODE, NOT THE TOP OF THE DIAL. Chrome's encoder switches to
 * near-lossless at exactly 1, and the step is a cliff rather than the last notch of a curve.
 * Measured on 1600×1067 of photographic noise:
 *
 *     q 0.85 → 0.79 MB      q 0.95 → 1.19 MB
 *     q 0.90 → 0.94 MB      q 0.99 → 1.38 MB
 *     q 0.92 → 1.02 MB      q 1.00 → 3.83 MB      ← 2.8× across one hundredth
 *
 * ⚠️ AND THE DIAL USED TO END THERE, WHICH INVERTED IT. The slider ran 30–100 in steps of 5, so
 * the top notch asked for exactly 1.0; 3.83 MB blows the 2 MB ceiling, `nextQuality` walks it
 * down, and the proportional guess — which assumes bytes fall linearly with quality and here
 * they do not remotely — lands at **0.51**. So dragging to maximum produced a visibly worse
 * picture than the notch below it, and the one gesture everybody makes first was the second-worst
 * setting on the control. Measured end to end through `squeeze`: asked 1.0, got 0.51 and 521 KB;
 * asked 0.95, got 0.95 and 1.25 MB.
 *
 * The cap is the fix rather than a cleverer `nextQuality`, because the walk-down is only ever
 * catastrophic from the cliff — stepping down from 0.95 the proportional guess is a sane 0.76 —
 * and because a dial should not offer a setting that means something else.
 */
export const MAX_QUALITY = 0.95

/** Hold a quality inside the band the dial actually offers. */
export function clampQuality(q: number): number {
  if (!Number.isFinite(q)) return MAX_QUALITY
  return Math.min(MAX_QUALITY, Math.max(FLOOR_QUALITY, q))
}

/**
 * Fit a picture inside a square of `edge`, keeping its shape.
 *
 * ⚠️ IT NEVER SCALES UP. A 200px drawing asked to fit 1600 stays 200: enlarging it would spend
 * bytes inventing detail that is not there, and the person who made it small meant it.
 *
 * ⚠️ AND IT NEVER ROUNDS TO ZERO. A very wide, very short picture — a panorama, a scanned
 * ticket — has a short edge that can land under half a pixel, and a canvas of height 0 throws.
 * One pixel is the floor, which keeps the picture drawable even where its shape is extreme.
 */
export function fitWithin(w: number, h: number, edge: number): { w: number; h: number } {
  if (!(w > 0) || !(h > 0) || !(edge > 0)) return { w: 0, h: 0 }
  const long = Math.max(w, h)
  if (long <= edge) return { w: Math.round(w), h: Math.round(h) }
  const k = edge / long
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}

/**
 * What quality to try next, having encoded at `q` and got `bytes`.
 *
 * Null means stop — either it already fits, or quality has gone as low as it usefully goes and
 * the caller should reach for a smaller canvas instead.
 *
 * ⚠️ IT STEPS BY HOW FAR OVER IT IS, not by a fixed notch. A picture 10% too big and one three
 * times too big want very different next guesses, and a fixed ladder spends three or four encodes
 * walking down to where a proportional step lands first time. Each encode is a real cost on a
 * phone — a 12-megapixel image through `toBlob` is not free — so the number of them is the thing
 * worth minimising.
 *
 * ⚠️ AND IT ALWAYS MOVES. `Math.min(q - 0.05, ...)` is what stops a nearly-fitting picture
 * proposing the quality it just tried and looping for ever; the proportional guess alone can
 * round to no change at all when `bytes` is a whisker over `budget`.
 */
export function nextQuality(bytes: number, budget: number, q: number): number | null {
  if (!(bytes > 0) || !(budget > 0)) return null
  if (bytes <= budget) return null
  if (q <= FLOOR_QUALITY) return null
  const guess = q * (budget / bytes)
  const step = Math.min(q - 0.05, guess)
  const next = Math.round(Math.max(FLOOR_QUALITY, step) * 100) / 100
  return next >= q ? null : next
}

/**
 * Bytes, as a person reads them.
 *
 * ⚠️ IT IS FOR A LABEL THAT CHANGES WHILE A SLIDER MOVES, so it rounds hard: "184 KB" rather than
 * "183.59 KB", because the digits after the point are noise at the speed they would change.
 */
export function sayBytes(n: number): string {
  if (!(n > 0)) return '0 KB'
  if (n < 1024) return `${Math.round(n)} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * How much smaller this got — the sentence worth showing beside a quality dial.
 *
 * ⚠️ NULL RATHER THAN "1x" WHEN NOTHING WAS SAVED, for the reason `share` in chronicle/goal.ts
 * returns null for a tick-box: a ratio of one is not an achievement and printing it invites a
 * reader to look for a number that means something.
 */
export function savedBy(from: number, to: number): string | null {
  if (!(from > 0) || !(to > 0) || to >= from) return null
  const k = from / to
  return k < 1.1 ? null : `${k < 10 ? k.toFixed(1) : Math.round(k)}× smaller`
}
