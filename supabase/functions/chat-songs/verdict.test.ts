import { describe, expect, it } from 'vitest'
import {
  DRAIN_CAP,
  KINDS,
  MAX_BYTES,
  MAX_JSON_BYTES,
  drain,
  jsonBodyFrom,
  looksLike,
  readAtMost,
  songId,
  uploadFrom,
  verdictFor,
} from './verdict'

/**
 * ⚠️ THE EDGE FUNCTION ITSELF CANNOT BE ASKED ANYTHING FROM HERE — it needs a deployed runtime, a
 * member's JWT and R2 credentials before a line of it runs. So what an upload may be lives in
 * `verdict.ts` and this is what checks it; what stays in index.ts is the RPCs, a PUT and the
 * plumbing.
 */

/** `n` bytes starting with `sig` at `at`, the rest a pattern that is neither zero nor repeating */
const bytesOf = (sig: number[], at = 0, n = 64) => {
  const b = new Uint8Array(n)
  for (let i = 0; i < n; i++) b[i] = (i * 7 + 13) % 251
  b.set(sig, at)
  return b
}

/* what each recorder actually writes first: an MP4's first box is `....ftyp` (its length, then
   its type), WebM opens with EBML's magic number, Ogg with its capture pattern */
const MP4_SIG = [0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]
const WEBM_SIG = [0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01]
const OGG_SIG = [0x4f, 0x67, 0x67, 0x53, 0x00, 0x02]
const MP4 = bytesOf(MP4_SIG)
const WEBM = bytesOf(WEBM_SIG)
const OGG = bytesOf(OGG_SIG)
const HTML = new TextEncoder().encode('<!doctype html><script>alert(1)</script>' + ' '.repeat(23))
const PNG = bytesOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const ok = (v: ReturnType<typeof verdictFor>) => v.ok
const why = (v: ReturnType<typeof verdictFor>) => (v.ok ? null : v.why)

describe('the ceiling and the kinds', () => {
  it('is the 5 MB the contract names, in binary megabytes, as the table checks it', () => {
    expect(MAX_BYTES).toBe(5 * 1024 * 1024)
  })

  it('keeps the three kinds chat_song_claim keeps, and nothing else', () => {
    expect([...KINDS].sort()).toEqual(['audio/mp4', 'audio/ogg', 'audio/webm'])
  })
})

describe('a recording that is what it says it is', () => {
  it('is let through, for each of the three kinds, and says which kind it is', () => {
    for (const [mime, bytes] of [
      ['audio/mp4', MP4],
      ['audio/webm', WEBM],
      ['audio/ogg', OGG],
    ] as const) {
      expect(verdictFor(mime, bytes), mime).toEqual({ ok: true, mime })
    }
  })

  it('is let through at exactly 5 MB', () => {
    expect(ok(verdictFor('audio/webm', bytesOf(WEBM_SIG, 0, MAX_BYTES)))).toBe(true)
  })
})

describe('the size', () => {
  it('refuses nothing at all, in the claim’s words', () => {
    expect(why(verdictFor('audio/webm', new Uint8Array(0)))).toBe('that recording came to nothing')
  })

  /** ⚠️ ONE BYTE OVER IS THE WHOLE POINT, and a real recording's head does not buy it a pass */
  it('refuses one byte past 5 MB, even of a real recording', () => {
    const v = verdictFor('audio/webm', bytesOf(WEBM_SIG, 0, MAX_BYTES + 1))
    expect(why(v)).toBe('that one is over 5 MB')
  })
})

describe('the kind it will be stored as', () => {
  /**
   * ⚠️ NEVER BARED HERE: the claim's `mime` and the stored `content-type` are this one string, so
   * a parameter or a capital would be stored as something the row does not say. WebM's own bytes
   * go with each, so only the string is wrong.
   */
  it('refuses anything but one of the three, exactly as written', () => {
    for (const mime of [
      'audio/webm;codecs=opus',
      'audio/webm; codecs=opus',
      'Audio/WebM',
      ' audio/webm',
      'text/html',
      'audio/mpeg',
      'application/octet-stream',
      '',
      null,
    ]) {
      expect(why(verdictFor(mime, WEBM)), String(mime)).toBe(
        'that is not a kind of recording this keeps',
      )
    }
  })
})

describe('the first bytes', () => {
  it('refuses bytes that do not begin like a recording of their kind', () => {
    for (const [label, bytes] of [
      ['a web page', HTML],
      ['a PNG', PNG],
      ['an Ogg stream sent as WebM', OGG],
      ['an MP4 sent as WebM', MP4],
      ['three bytes of the WebM magic', WEBM.slice(0, 3)],
    ] as const) {
      expect(why(verdictFor('audio/webm', bytes)), label).toBe('that is not a recording')
    }
  })

  it('reads an MP4 by the type four bytes in, not at the start', () => {
    expect(looksLike('audio/mp4', MP4)).toBe(true)
    expect(looksLike('audio/mp4', bytesOf([0x66, 0x74, 0x79, 0x70]))).toBe(false)
    expect(looksLike('audio/mp4', MP4.slice(0, 7))).toBe(false)
  })

  it('knows no kind beyond the three', () => {
    for (const mime of ['audio/mpeg', 'audio/wav', 'AUDIO/WEBM', '']) {
      expect(looksLike(mime, WEBM), mime).toBe(false)
    }
  })
})

/**
 * A body that hands out `chunks` one at a time and counts what it was asked for, so a test can
 * tell "stopped reading" from "read everything and then said no".
 */
function streamOf(chunks: Uint8Array[], highWaterMark = 1) {
  const seen = { pulls: 0, cancelled: false }
  let i = 0
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        seen.pulls++
        if (i < chunks.length) controller.enqueue(chunks[i++])
        else controller.close()
      },
      cancel() {
        seen.cancelled = true
      },
    },
    { highWaterMark },
  )
  return { stream, seen }
}

const MiB = 1024 * 1024

describe('reading the body', () => {
  it('keeps every byte, in order, across chunks of any size', async () => {
    const whole = bytesOf(OGG_SIG, 0, 300_001)
    const cuts = [0, 1, 4, 4_096, 65_537, 200_000, 300_001]
    const { stream } = streamOf(cuts.slice(1).map((end, k) => whole.slice(cuts[k], end)))
    const got = await readAtMost(stream, MAX_BYTES)
    expect('bytes' in got && got.bytes).toEqual(whole)
  })

  it('takes exactly 5 MB, and refuses one byte more', async () => {
    const at = await readAtMost(
      streamOf([new Uint8Array(MAX_BYTES - 1), new Uint8Array(1)]).stream,
      MAX_BYTES,
    )
    expect('bytes' in at && at.bytes.length).toBe(MAX_BYTES)
    const over = await readAtMost(
      streamOf([new Uint8Array(MAX_BYTES), new Uint8Array(1)]).stream,
      MAX_BYTES,
    )
    expect(over).toEqual({ over: true })
  })

  /**
   * ⚠️ THE POINT OF READING A STREAM: a body far past the ceiling is never read to its end. Fifty
   * mebibytes offered a mebibyte at a time must be abandoned at the sixth, and the rest cancelled
   * so the sender stops being read from.
   */
  it('stops at the chunk that passes 5 MB and cancels the rest', async () => {
    const { stream, seen } = streamOf(Array.from({ length: 50 }, () => new Uint8Array(MiB)))
    expect(await readAtMost(stream, MAX_BYTES)).toEqual({ over: true })
    expect(seen.pulls).toBeLessThanOrEqual(Math.ceil(MAX_BYTES / MiB) + 2)
    expect(seen.cancelled).toBe(true)
  })

  it('reads no body as nothing, which the verdict then refuses', async () => {
    const got = await readAtMost(null, MAX_BYTES)
    expect('bytes' in got && got.bytes.length).toBe(0)
    expect('bytes' in got && why(verdictFor('audio/ogg', got.bytes))).toBe(
      'that recording came to nothing',
    )
  })
})

/**
 * ⚠️ A REFUSAL OF AN UPLOAD WAITS FOR ITS BODY TO BE READ OFF, or the platform never sends it
 * (measured, see `drain`). So what matters is that an honest body is read to its very END — the
 * stream reports done — while one past the cap is cut off rather than read for ever.
 */
describe('reading a refused body off', () => {
  /* every byte consumed, counted by what drain says it read — not by the stream's pulls, which its
     own read-ahead makes whether or not anybody finished reading (that assertion was tried first,
     and a drain that stopped at the last byte passed it) */
  it('reads an honest upload to its end, keeping nothing, and does not cancel it', async () => {
    const sizes = [MiB, 3, MiB, 65_537, MiB - 7]
    const { stream, seen } = streamOf(sizes.map((n) => new Uint8Array(n)))
    expect(await drain(stream, MAX_BYTES)).toBe(sizes.reduce((a, b) => a + b, 0))
    expect(seen.cancelled).toBe(false)
  })

  /* ⚠️ WITH NO READ-AHEAD (highWaterMark 0) a pull happens only when somebody reads, so the third
     pull below is drain asking for more after the last byte — the read that hears "done". With the
     default read-ahead the stream closes on its own, and a drain that returned at exactly 5 MB
     without asking passed this test; an independent review found that. */
  it('reads exactly 5 MB to its end, the most an honest client sends', async () => {
    const { stream, seen } = streamOf([new Uint8Array(MAX_BYTES - 1), new Uint8Array(1)], 0)
    expect(await drain(stream, MAX_BYTES)).toBe(MAX_BYTES)
    expect(seen.pulls).toBe(3)
    expect(seen.cancelled).toBe(false)
  })

  it('cuts off a body past the cap instead of reading it for ever', async () => {
    const { stream, seen } = streamOf(Array.from({ length: 50 }, () => new Uint8Array(MiB)))
    const n = await drain(stream, MAX_BYTES)
    expect(n).toBeGreaterThan(MAX_BYTES)
    expect(n).toBeLessThanOrEqual(MAX_BYTES + MiB)
    expect(seen.cancelled).toBe(true)
  })

  it('answers for no body, and for one that breaks off, without throwing', async () => {
    expect(await drain(null, MAX_BYTES)).toBe(0)
    let sent = 0
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ === 0) controller.enqueue(new Uint8Array(10))
        else controller.error(new Error('the connection dropped'))
      },
    })
    expect(await drain(broken, MAX_BYTES)).toBe(10)
  })
})

/**
 * ⚠️ AN UPLOAD OVER 5 MB WAS CANCELLED AT ONCE, and an answer sent over an unread body never
 * arrives (see `drain`). So past the ceiling the rest is read off and thrown away, up to
 * DRAIN_CAP, and only a body past THAT is cut off. No read-ahead (highWaterMark 0), so the pull
 * after the last chunk is the read that heard "done".
 */
describe('an upload over the ceiling', () => {
  it('is read off to its end and answered over, keeping nothing', async () => {
    const { stream, seen } = streamOf([new Uint8Array(MAX_BYTES), new Uint8Array(MiB)], 0)
    expect(await readAtMost(stream, MAX_BYTES, DRAIN_CAP)).toEqual({ over: true })
    expect(seen.pulls).toBe(3)
    expect(seen.cancelled).toBe(false)
  })

  it('is cut off once past the drain cap', async () => {
    const { stream, seen } = streamOf(
      Array.from({ length: 50 }, () => new Uint8Array(MiB)),
      0,
    )
    expect(await readAtMost(stream, MAX_BYTES, DRAIN_CAP)).toEqual({ over: true })
    expect(seen.cancelled).toBe(true)
    expect(seen.pulls).toBeLessThanOrEqual(Math.ceil(DRAIN_CAP / MiB) + 1)
  })

  it('still keeps every byte of one that fits, with a drain cap given', async () => {
    const whole = bytesOf(OGG_SIG, 0, 300_001)
    const { stream } = streamOf([whole.slice(0, 100_000), whole.slice(100_000)])
    const got = await readAtMost(stream, MAX_BYTES, DRAIN_CAP)
    expect('bytes' in got && got.bytes).toEqual(whole)
  })
})

/** a play or remove: its body read to at most MAX_JSON_BYTES, never past DRAIN_CAP */
describe('a play or remove body', () => {
  const enc = (t: string) => new TextEncoder().encode(t)
  const padTo = (n: number) => {
    const base = '{"op":"play","id":"22222222-2222-4222-8222-222222222222"}'
    return base.slice(0, -1) + ' '.repeat(n - base.length) + '}'
  }

  it('reads an op and its id', async () => {
    const got = await jsonBodyFrom(streamOf([enc('{"op":"remove","id":"x"}')]).stream)
    expect(got).toEqual({ value: { op: 'remove', id: 'x' } })
  })

  it('takes exactly MAX_JSON_BYTES, and refuses one byte more with 413', async () => {
    expect(padTo(MAX_JSON_BYTES)).toHaveLength(MAX_JSON_BYTES)
    const at = await jsonBodyFrom(streamOf([enc(padTo(MAX_JSON_BYTES))]).stream)
    expect('value' in at && at.value.op).toBe('play')
    const over = await jsonBodyFrom(streamOf([enc(padTo(MAX_JSON_BYTES + 1))]).stream)
    expect(over).toEqual({ status: 413, error: 'that request is too big' })
  })

  it('reads a big one off to its end before refusing it, and cuts off a huge one', async () => {
    const big = streamOf(
      Array.from({ length: 3 }, () => new Uint8Array(MiB)),
      0,
    )
    expect(await jsonBodyFrom(big.stream)).toEqual({
      status: 413,
      error: 'that request is too big',
    })
    expect(big.seen.pulls).toBe(4)
    expect(big.seen.cancelled).toBe(false)
    const huge = streamOf(
      Array.from({ length: 50 }, () => new Uint8Array(MiB)),
      0,
    )
    expect(await jsonBodyFrom(huge.stream)).toEqual({
      status: 413,
      error: 'that request is too big',
    })
    expect(huge.seen.cancelled).toBe(true)
  })

  it('refuses what is not a JSON object, and a body that breaks off', async () => {
    for (const t of ['', 'null', '3', '"play"', '{"op":', 'not json']) {
      expect(await jsonBodyFrom(streamOf([enc(t)]).stream)).toEqual({
        status: 400,
        error: 'that was not json',
      })
    }
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('the connection dropped'))
      },
    })
    expect(await jsonBodyFrom(broken)).toEqual({ status: 400, error: 'that was not json' })
  })
})

describe('an upload’s headers', () => {
  const ROOM = '3f2c1b7e-9a4d-4c8e-b1f0-6d5e4a3b2c1d'
  const headers = (h: Record<string, string>) => ({ get: (k: string) => h[k] ?? null })
  /* every header set, each to something unlike any default */
  const FULL = {
    'x-song-room': ROOM,
    'x-song-mime': 'audio/mp4',
    'x-song-seconds': '125',
    'x-song-name': encodeURIComponent('Sunday — é 🎵 & 100%'),
  }

  it('reads every part as the client sends it', () => {
    expect(uploadFrom(headers(FULL))).toEqual({
      room: ROOM,
      mime: 'audio/mp4',
      seconds: 125,
      name: 'Sunday — é 🎵 & 100%',
    })
  })

  /**
   * ⚠️ EACH PART DROPPED IN TURN, so a field that is silently ignored cannot hide behind the others
   * being right: the claim refuses a null in its own words, and only a null.
   */
  it('reads a missing part as nothing, one part at a time', () => {
    const empty = { room: null, mime: null, seconds: null, name: '' }
    for (const k of Object.keys(FULL) as (keyof typeof FULL)[]) {
      const rest: Record<string, string> = { ...FULL }
      delete rest[k]
      const got = uploadFrom(headers(rest))
      const part = k.replace('x-song-', '') as keyof typeof empty
      expect(got[part], k).toEqual(empty[part])
      for (const other of Object.keys(empty) as (keyof typeof empty)[]) {
        if (other !== part) expect(got[other], `${other} without ${k}`).not.toEqual(empty[other])
      }
    }
  })

  it('reads a room only when it is an id the database could have made', () => {
    for (const room of [
      'x',
      `${ROOM}x`,
      ` ${ROOM}`,
      ROOM.replace(/-/g, ''),
      "'; drop table x; --",
    ]) {
      expect(uploadFrom(headers({ ...FULL, 'x-song-room': room })).room, room).toBeNull()
    }
  })

  /** ⚠️ `Number('')` is 0 and `Number('1e3')` is 1000: only plain digits are a length */
  it('reads a length only from plain digits', () => {
    for (const secs of ['', ' ', '12.5', '-3', '1e3', '0x10', 'NaN', '125s']) {
      expect(uploadFrom(headers({ ...FULL, 'x-song-seconds': secs })).seconds, secs).toBeNull()
    }
    /* zero is a number, and the claim refuses it as "has no length" */
    expect(uploadFrom(headers({ ...FULL, 'x-song-seconds': '0' })).seconds).toBe(0)
  })

  it('reads a name that does not decode as no name, and never throws', () => {
    expect(uploadFrom(headers({ ...FULL, 'x-song-name': '%E0%A4%A' })).name).toBeNull()
  })

  it('passes the kind on exactly as sent, for the claim and the verdict to refuse', () => {
    const mime = 'audio/webm;codecs=opus'
    expect(uploadFrom(headers({ ...FULL, 'x-song-mime': mime })).mime).toBe(mime)
  })
})

describe('an op’s song id', () => {
  it('is an id the database could have made, or nothing', () => {
    expect(songId('3F2C1B7E-9A4D-4C8E-B1F0-6D5E4A3B2C1D')).toBe(
      '3F2C1B7E-9A4D-4C8E-B1F0-6D5E4A3B2C1D',
    )
    for (const bad of [null, undefined, 3, '', 'x', {}, ['3f2c1b7e-9a4d-4c8e-b1f0-6d5e4a3b2c1d']]) {
      expect(songId(bad), JSON.stringify(bad)).toBeNull()
    }
  })
})
