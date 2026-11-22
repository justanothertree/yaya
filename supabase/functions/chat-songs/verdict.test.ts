import { describe, expect, it } from 'vitest'
import { MAX_BYTES, bareMime, lengthFrom, looksLike, verdictFor } from './verdict'

/**
 * ⚠️ THE EDGE FUNCTION ITSELF CANNOT BE ASKED ANYTHING FROM HERE — it needs a deployed runtime, a
 * member's JWT and R2 credentials before a line of it runs. So the decision lives in `verdict.ts`
 * and this is what checks it; what stays in index.ts is a HEAD, a ranged GET and the plumbing.
 */

/** 64 bytes starting with `sig` at `at`, the rest filled with something that is not zero */
const headOf = (sig: number[], at = 0) => {
  const b = new Uint8Array(64).fill(0x5a)
  b.set(sig, at)
  return b
}

/* what each recorder actually writes first: an MP4's first box is `....ftyp` (its length, then
   its type), WebM opens with EBML's magic number, Ogg with its capture pattern */
const MP4 = headOf([0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20])
const WEBM = headOf([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01])
const OGG = headOf([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02])
const HTML = new TextEncoder().encode('<!doctype html><script>alert(1)</script>' + ' '.repeat(23))
const PNG = headOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** a claim and an upload that agree — every field deliberately unlike any default */
const HONEST = {
  claimedBytes: 2_318_406,
  mime: 'audio/webm',
  seenBytes: 2_318_406,
  seenType: 'audio/webm',
  head: WEBM,
}

const ok = (v: ReturnType<typeof verdictFor>) => v.ok
const why = (v: ReturnType<typeof verdictFor>) => (v.ok ? null : v.why)
const drops = (v: ReturnType<typeof verdictFor>) => (v.ok ? false : v.drop)

describe('the ceiling', () => {
  it('is the 5 MB the contract names, in binary megabytes, as the table checks it', () => {
    expect(MAX_BYTES).toBe(5 * 1024 * 1024)
  })
})

describe('a recording that is what it said it was', () => {
  it('is let through, for each of the three kinds this keeps', () => {
    for (const [mime, head] of [
      ['audio/mp4', MP4],
      ['audio/webm', WEBM],
      ['audio/ogg', OGG],
    ] as const) {
      expect(ok(verdictFor({ ...HONEST, mime, seenType: mime, head })), mime).toBe(true)
    }
  })

  it('is let through at exactly 5 MB', () => {
    const edge = { ...HONEST, claimedBytes: MAX_BYTES, seenBytes: MAX_BYTES }
    expect(ok(verdictFor(edge))).toBe(true)
  })

  it('is let through when the store reports the type with parameters or in capitals', () => {
    for (const seenType of ['audio/webm; codecs=opus', 'Audio/WebM', '  audio/webm  ']) {
      expect(ok(verdictFor({ ...HONEST, seenType })), seenType).toBe(true)
    }
  })
})

describe('the size', () => {
  /* the hole pictures/verdict.ts measured, in this file's units: a claim of one byte carrying the
     whole ceiling, which the account's 25 MB would have counted as one byte */
  it('refuses a one-byte claim carrying 5 MB', () => {
    const v = verdictFor({ ...HONEST, claimedBytes: 1, seenBytes: MAX_BYTES })
    expect(ok(v)).toBe(false)
    expect(drops(v)).toBe(true)
  })

  /** ⚠️ ONE BYTE EITHER WAY IS THE WHOLE POINT — a tolerance is a size somebody can hide inside */
  it('refuses a difference of a single byte, in either direction', () => {
    for (const delta of [1, -1]) {
      const v = verdictFor({ ...HONEST, seenBytes: HONEST.seenBytes + delta })
      expect(ok(v), `${delta > 0 ? '+' : '−'}1`).toBe(false)
      expect(drops(v)).toBe(true)
    }
  })

  it('refuses an object over 5 MB even when the claim matches it', () => {
    /* the claim could never have got past chat_song_claim, but the rule must not depend on that */
    const v = verdictFor({ ...HONEST, claimedBytes: MAX_BYTES + 1, seenBytes: MAX_BYTES + 1 })
    expect(ok(v)).toBe(false)
    expect(drops(v)).toBe(true)
    expect(why(v)).toMatch(/5 MB/)
  })

  it('tells nobody how close they got', () => {
    const v = verdictFor({ ...HONEST, seenBytes: HONEST.seenBytes + 1 })
    expect(why(v)).not.toMatch(/\d/)
  })
})

describe('the kind it was stored as', () => {
  /* R2 serves the object with the type it was PUT with, so this is what ▶ would be handed */
  it('refuses an object stored as anything but the kind claimed', () => {
    for (const seenType of [
      'text/html',
      'audio/mpeg',
      'application/octet-stream',
      'audio/ogg',
      '',
      null,
    ]) {
      const v = verdictFor({ ...HONEST, seenType })
      expect(ok(v), String(seenType)).toBe(false)
      expect(drops(v), String(seenType)).toBe(true)
    }
  })

  it('decides that before the first bytes are needed', () => {
    const v = verdictFor({ ...HONEST, seenType: 'text/html', head: null })
    expect(drops(v)).toBe(true)
  })
})

describe('the first bytes', () => {
  it('refuses an object that does not begin like a recording of its kind', () => {
    for (const [label, head] of [
      ['a web page', HTML],
      ['a PNG', PNG],
      ['an Ogg stream claimed as WebM', OGG],
      ['an MP4 claimed as WebM', MP4],
      ['nothing at all', new Uint8Array(0)],
      ['three bytes of the WebM magic', WEBM.slice(0, 3)],
    ] as const) {
      const v = verdictFor({ ...HONEST, head })
      expect(ok(v), label).toBe(false)
      expect(drops(v), label).toBe(true)
      expect(why(v), label).toMatch(/not a recording/)
    }
  })

  it('reads an MP4 by the type four bytes in, not at the start', () => {
    expect(looksLike('audio/mp4', MP4)).toBe(true)
    expect(looksLike('audio/mp4', headOf([0x66, 0x74, 0x79, 0x70]))).toBe(false)
    expect(looksLike('audio/mp4', MP4.slice(0, 7))).toBe(false)
  })

  it('knows no kind beyond the three', () => {
    for (const mime of ['audio/mpeg', 'audio/wav', 'AUDIO/WEBM', '']) {
      expect(looksLike(mime, WEBM), mime).toBe(false)
    }
  })
})

describe('an upload that simply did not arrive, or could not be read', () => {
  it('is refused without deleting anything when the object is not there', () => {
    const v = verdictFor({ ...HONEST, seenBytes: null, seenType: null, head: null })
    expect(ok(v)).toBe(false)
    /* ⚠️ a flaky connection must not become lost work — the claim lets the row go after an hour */
    expect(drops(v), 'a missing object was deleted').toBe(false)
    expect(why(v)).toMatch(/again/)
  })

  it('is refused without deleting anything when only the first bytes could not be read', () => {
    const v = verdictFor({ ...HONEST, head: null })
    expect(ok(v)).toBe(false)
    expect(drops(v), 'an object that is the right size and kind was deleted').toBe(false)
    expect(why(v)).toMatch(/again/)
  })
})

describe('a content type without its parameters', () => {
  it('is lower case and bare', () => {
    expect(bareMime('audio/webm;codecs=opus')).toBe('audio/webm')
    expect(bareMime(' Audio/MP4 ; codecs="mp4a.40.2"')).toBe('audio/mp4')
    expect(bareMime('audio/ogg')).toBe('audio/ogg')
  })

  it('is nothing when there was nothing', () => {
    for (const none of [null, '', '   ', ';codecs=opus']) {
      expect(bareMime(none), JSON.stringify(none)).toBeNull()
    }
  })
})

describe('reading a length off the store’s answer', () => {
  const headers = (v: string | null) => ({ get: () => v })

  it('reads a plain length', () => {
    expect(lengthFrom(headers('2318406'))).toBe(2_318_406)
    expect(lengthFrom(headers(' 5242880 '))).toBe(5_242_880)
    expect(lengthFrom(headers('0'))).toBe(0)
  })

  /**
   * ⚠️ A MISSING HEADER IS NOT A ZERO, and `Number(null)` and `Number('')` are both 0. Read as
   * zero, a 404 would look like an empty object that exists — and `0 !== claimed` would then
   * DELETE a song that had merely not finished uploading.
   */
  it('says nothing rather than a number when the store did not answer with one', () => {
    for (const bad of [null, '', '  ', 'none', '12.5', '-3', '1e3', '0x10', 'NaN']) {
      expect(lengthFrom(headers(bad)), JSON.stringify(bad)).toBeNull()
    }
  })
})
