/**
 * What R2 would charge for a month, from the three figures Cloudflare reports.
 *
 * ⚠️ IT IS MONEY ON A SCREEN, WHICH IS WHY IT IS NOT IN THE JSX. The Usage panel's whole job is
 * answering "am I about to be charged", and the Browser pane cannot help: the admin panel needs a
 * session the preview harness has not got, and the figures come from a relay that is not running
 * locally. A screenshot of that proves the card mounts. The arithmetic is asserted here or not at
 * all — which is the same argument `server/lib/r2ops.mjs` is built on, one layer up.
 *
 * ⚠️ AND `null` PROPAGATES. Any unknown input makes the answer unknown, rather than being treated
 * as zero and quietly dropped out of a sum. A bill computed from two of three figures is a
 * smaller number than the truth, presented with the same confidence — the one failure this panel
 * must not have. The relay answers `null` for a field Cloudflare did not send; so does this.
 *
 * Prices and allowances read from developers.cloudflare.com/r2/pricing on 3 Nov 2026.
 */

/** 10 GB-month of standard storage free each month, then $0.015 per GB-month. */
export const R2_FREE_GB_MONTH = 10
export const R2_PER_GB_MONTH = 0.015
/** 1 million Class A operations (writes and lists) free, then $4.50 per million. */
export const R2_FREE_A = 1_000_000
export const R2_PER_M_A = 4.5
/** 10 million Class B operations (reads) free, then $0.36 per million. */
export const R2_FREE_B = 10_000_000
export const R2_PER_M_B = 0.36

const GB = 1024 * 1024 * 1024

export type R2Figures = {
  /** peak payload + metadata over the month, in bytes */
  bytes?: number | null
  classA?: number | null
  classB?: number | null
}

export type R2Cost = {
  /** share of the free allowance used, 0–1 and beyond, or null when not known */
  storageShare: number | null
  writeShare: number | null
  readShare: number | null
  /** dollars past the free tier, or null when ANY figure is unknown — see the header */
  owed: number | null
}

const known = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n)

/**
 * ⚠️ THE STORAGE SHARE COMPARES A PEAK TO AN AVERAGE, AND THAT IS DELIBERATE. R2's allowance is
 * 10 GB-MONTH — a time-average — while `r2StorageAdaptiveGroups` reports a level and the relay
 * takes its maximum over the window. The peak is always at least the average, so this reads HIGH
 * rather than low. For a figure whose job is "go and look", erring that way is the only sane
 * direction; the card says so on screen rather than leaving the unit mismatch invisible.
 */
export function r2Cost(f: R2Figures): R2Cost {
  const gb = known(f.bytes) ? f.bytes / GB : null
  const storageShare = gb === null ? null : gb / R2_FREE_GB_MONTH
  const writeShare = known(f.classA) ? f.classA / R2_FREE_A : null
  const readShare = known(f.classB) ? f.classB / R2_FREE_B : null

  const owed =
    gb === null || !known(f.classA) || !known(f.classB)
      ? null
      : Math.max(0, gb - R2_FREE_GB_MONTH) * R2_PER_GB_MONTH +
        (Math.max(0, f.classA - R2_FREE_A) / 1e6) * R2_PER_M_A +
        (Math.max(0, f.classB - R2_FREE_B) / 1e6) * R2_PER_M_B

  return { storageShare, writeShare, readShare, owed }
}
