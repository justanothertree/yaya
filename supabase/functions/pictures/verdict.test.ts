import { describe, expect, it } from 'vitest'
import { MAX_BYTES, MAX_THUMB_BYTES, lengthFrom, verdictFor } from './verdict'

/**
 * ⚠️ THE EDGE FUNCTION ITSELF CANNOT BE ASKED ANYTHING FROM HERE — it needs a deployed runtime, a
 * member's JWT and R2 credentials before a line of it runs, and a deploy sends the whole file as
 * one argument with no diff to look at. So the decision lives in `verdict.ts` and this is what
 * checks it; what stays in index.ts is one HEAD request and the plumbing around it.
 */

/** a claim and an upload that agree — every field deliberately unlike any default */
const HONEST = { claimedBytes: 183_204, claimedThumb: 9_118, seenBytes: 183_204, seenThumb: 9_118 }

const ok = (v: ReturnType<typeof verdictFor>) => v.ok
const why = (v: ReturnType<typeof verdictFor>) => (v.ok ? null : v.why)
const drops = (v: ReturnType<typeof verdictFor>) => (v.ok ? false : v.drop)

describe('an upload that is what it said it was', () => {
  it('is let through', () => {
    expect(ok(verdictFor(HONEST))).toBe(true)
  })

  it('is let through at the very top of both ceilings', () => {
    const edge = {
      claimedBytes: MAX_BYTES,
      claimedThumb: MAX_THUMB_BYTES,
      seenBytes: MAX_BYTES,
      seenThumb: MAX_THUMB_BYTES,
    }
    expect(ok(verdictFor(edge))).toBe(true)
  })
})

describe('the thing this exists to stop', () => {
  /**
   * The measured hole, as an experiment rather than a worry: on the live database, inside a
   * rolled-back transaction, a claim of one byte plus one byte was accepted, `picture_ready`
   * flipped it ready without asking R2 anything, and the row went on counting 2 bytes toward a
   * 50 MB ceiling. The presigned PUT binds no content length, so the object at that key can be
   * anything at all.
   */
  it('refuses a one-byte claim carrying two megabytes', () => {
    const v = verdictFor({
      claimedBytes: 1,
      claimedThumb: 1,
      seenBytes: 2_000_000,
      seenThumb: 40_000,
    })
    expect(ok(v)).toBe(false)
    expect(drops(v)).toBe(true)
  })

  /** ⚠️ ONE BYTE OVER IS THE WHOLE POINT — a tolerance is a size somebody can hide inside */
  it('refuses a difference of a single byte, in either direction and either object', () => {
    for (const key of ['seenBytes', 'seenThumb'] as const) {
      for (const delta of [1, -1]) {
        const v = verdictFor({ ...HONEST, [key]: HONEST[key] + delta })
        expect(ok(v), `${key} ${delta > 0 ? '+' : '−'}1`).toBe(false)
        expect(drops(v)).toBe(true)
      }
    }
  })

  it('refuses an oversized object even when the claim matches it', () => {
    /* the claim could never have got past picture_claim, but the rule must not depend on that */
    const big = verdictFor({
      claimedBytes: MAX_BYTES + 1,
      claimedThumb: 9_118,
      seenBytes: MAX_BYTES + 1,
      seenThumb: 9_118,
    })
    expect(ok(big)).toBe(false)
    expect(why(big)).toMatch(/2 MB/)

    const bigThumb = verdictFor({
      claimedBytes: 183_204,
      claimedThumb: MAX_THUMB_BYTES + 1,
      seenBytes: 183_204,
      seenThumb: MAX_THUMB_BYTES + 1,
    })
    expect(ok(bigThumb)).toBe(false)
    expect(why(bigThumb)).toMatch(/thumbnail/)
  })

  it('tells nobody how close they got', () => {
    const v = verdictFor({ ...HONEST, seenBytes: 183_205 })
    expect(why(v)).not.toMatch(/\d{3}/)
  })
})

describe('an upload that simply did not arrive', () => {
  it('is refused without deleting anything', () => {
    for (const missing of [
      { ...HONEST, seenBytes: null },
      { ...HONEST, seenThumb: null },
      { ...HONEST, seenBytes: null, seenThumb: null },
    ]) {
      const v = verdictFor(missing)
      expect(ok(v)).toBe(false)
      /* ⚠️ a flaky connection must not become lost work — the claim sweep handles it after an hour */
      expect(drops(v), 'a missing object was deleted').toBe(false)
      expect(why(v)).toMatch(/again/)
    }
  })
})

describe('reading a length off the store’s answer', () => {
  const headers = (v: string | null) => ({ get: () => v })

  it('reads a plain length', () => {
    expect(lengthFrom(headers('183204'))).toBe(183204)
    expect(lengthFrom(headers('0'))).toBe(0)
  })

  /**
   * ⚠️ A MISSING HEADER IS NOT A ZERO, and `Number(null)` is 0. Read as zero, a 404 would look
   * like an empty object that exists — and `0 !== claimed` would then DELETE a picture that had
   * merely not finished uploading. The null is what routes it to the no-drop branch above.
   */
  it('says nothing rather than zero when the store did not answer with one', () => {
    for (const bad of [null, '', 'none', '12.5', '-3', 'NaN']) {
      expect(lengthFrom(headers(bad)), JSON.stringify(bad)).toBeNull()
    }
  })
})
