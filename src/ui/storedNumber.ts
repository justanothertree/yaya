/**
 * Read a number out of localStorage, or admit there isn't one.
 *
 * ⚠️ THIS EXISTS BECAUSE `Number(null)` IS `0`, NOT `NaN`.
 *
 * The natural-looking line
 *
 *     const v = Number(localStorage.getItem(KEY))
 *     if (Number.isFinite(v) && v >= 0 && v <= 1) setting = v
 *
 * is correct for every range that excludes zero and silently wrong for every range that
 * includes it. A missing key becomes 0, 0 is finite, 0 passes `>= 0` — so the stored value
 * wins even though nothing was stored, and the default it was supposed to fall back to is
 * discarded. It had already done real damage: the mixer's three channels all defaulted to
 * SILENT for anyone who had never touched a volume slider, which presents as "the music player
 * is broken" rather than as anything to do with storage. The synth's effect defaults went the
 * same way, and two trail settings were forced to 0 instead of the mode's own preference.
 *
 * Returning null for "nothing stored" makes the caller write the fallback out loud, which is
 * the only version of this that cannot rot.
 */
export function storedNumber(key: string, min: number, max: number): number | null {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(key)
  } catch {
    return null // private mode — indistinguishable from never having set it, and treated the same
  }
  if (raw == null || raw === '') return null
  const v = Number(raw)
  return Number.isFinite(v) && v >= min && v <= max ? v : null
}
