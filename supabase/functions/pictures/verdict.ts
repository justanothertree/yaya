/**
 * Whether what actually landed in R2 is what was claimed.
 *
 * ⚠️ THE CEILINGS WERE BEING APPLIED TO A NUMBER THE CLIENT CHOSE. `picture_claim` enforces 2 MB a
 * picture, 256 KB a thumbnail, 500 pictures and 50 MB an account — all against `p_bytes` and
 * `p_thumb_bytes` sent by the browser. The presigned PUT that comes back is signed with
 * `signQuery`, which binds the method, the key and an expiry and **not** a content length, so R2
 * accepts an object of any size at that key. Nothing between the claim and `picture_ready` ever
 * looked at what arrived.
 *
 * Measured on the live database, 28 Oct 2026, inside a rolled-back transaction: a claim of
 * `bytes: 1, thumbBytes: 1` was accepted, `picture_ready` flipped it ready without asking R2
 * anything, and the row went on counting **2 bytes** toward a 52,428,800-byte ceiling. Repeat 500
 * times and the account is at its row limit having stored whatever it liked, billed to Evan.
 *
 * ⚠️ IT LIVES IN ITS OWN FILE SO IT CAN BE ASKED A QUESTION. An edge function needs a deployed
 * runtime, a member's JWT and R2 credentials before any of it runs, so a rule written inline there
 * is a rule nobody can check — the same reason `sanitizeSettings` moved out of the relay. What is
 * left in index.ts is the HEAD request and the plumbing; the decision is here, and `verdict.test.ts`
 * asks it.
 */

/** What the claim said, and what the store says it actually holds. */
export type Sizes = {
  /** bytes the browser said the full picture would be, as recorded by `picture_claim` */
  claimedBytes: number
  claimedThumb: number
  /** `content-length` from a HEAD on each key, or null when the object is not there at all */
  seenBytes: number | null
  seenThumb: number | null
}

export type Verdict = { ok: true } | { ok: false; why: string; drop: boolean }

/** The ceilings `picture_claim` and the table's CHECK constraints both hold. */
export const MAX_BYTES = 2_097_152
export const MAX_THUMB_BYTES = 262_144

/**
 * ⚠️ EXACT, NOT "WITHIN THE CEILING". Refusing only what is oversized would still let somebody
 * claim one byte and store two megabytes, which is under the ceiling and nineteen times what the
 * account was charged for. The browser PUTs the very blob it measured, so any difference at all
 * means the two are not the same object — there is no honest reason for a tolerance here, and a
 * tolerance is a size somebody can hide inside.
 */
export function verdictFor(s: Sizes): Verdict {
  if (s.seenBytes === null || s.seenThumb === null) {
    /* ⚠️ NOT DROPPED. A missing object is the ordinary shape of an upload that failed partway —
       the browser says so itself and `picture_claim` sweeps unready rows after an hour. Deleting
       here would turn a flaky connection into lost work on the retry. */
    return { ok: false, why: 'that picture never finished going up — try it again', drop: false }
  }
  if (s.seenBytes > MAX_BYTES) {
    return {
      ok: false,
      why: 'what arrived is over the 2 MB a picture may be',
      drop: true,
    }
  }
  if (s.seenThumb > MAX_THUMB_BYTES) {
    return {
      ok: false,
      why: 'the thumbnail that arrived is over what a thumbnail may be',
      drop: true,
    }
  }
  if (s.seenBytes !== s.claimedBytes || s.seenThumb !== s.claimedThumb) {
    /* ⚠️ THE SENTENCE NAMES NO FIGURES. Somebody doing this on purpose does not need telling how
       close they got, and somebody who hit it by accident cannot act on the numbers either. */
    return { ok: false, why: 'that is not the picture this account was told about', drop: true }
  }
  return { ok: true }
}

/**
 * `content-length` as a number, or null when the store did not say.
 *
 * ⚠️ A MISSING HEADER IS NOT A ZERO. R2 answers a HEAD on a missing key with 404 and no length,
 * and `Number(null)` is 0 — which would read as an empty object that exists, and `0 !== claimed`
 * would delete a picture that had simply not arrived yet.
 */
export function lengthFrom(headers: { get(name: string): string | null }): number | null {
  const raw = headers.get('content-length')
  /* ⚠️ AN EMPTY STRING IS NOT A ZERO EITHER, and `Number('')` is 0 — this file's first version
     said so about `null` and then walked into the same trap one line down. An empty header would
     have read as a zero-byte object that exists, which is a mismatch, which deletes the picture. */
  if (raw === null || raw.trim() === '') return null
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 ? n : null
}
